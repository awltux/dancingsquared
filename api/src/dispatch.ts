// ONE REQUEST, ONE ROUTE, ONE ANSWER — the part of a serving adapter that is not about its transport.
//
// WHY THIS IS ITS OWN MODULE, AND WHY IT WAS EXTRACTED WHEN THE SECOND ADAPTER ARRIVED. There are now two ways a
// request reaches these handlers: the local `node:http` dev server, and the Lambda behind API Gateway. Each owns its
// transport — sockets versus events, headers versus `requestContext` — and NOTHING ELSE. What must not be written
// twice is the part that decides things: that the emulator's routes come first and only where an emulator exists,
// that an unrouted path answers the 404 shape the client already reads, and that a THROW is a 500 with a generic
// body. Two copies of those three rules is how the two deployments come to disagree about a refusal, which
// `AGENTS.md` §4.3 forbids in the same words it forbids a second routing table — and the routing table itself was
// already shared (`routes.ts`, imported by both).
//
// A THROW IS A BUG IN A HANDLER, NOT A CLIENT ERROR. It is reported to the adapter's own log (the injected
// `onError`, which is `console.error` locally and the Lambda's log in the deployment) and answered with a sentence
// that says nothing about the stack: the client is not the audience for one.
import type { ApiRequest, ApiResult, Deps } from './ports.ts';
import { routeFor } from './routes.ts';

/** A JSON body larger than this is refused: nothing this API takes is bigger than a move list. */
export const MAX_BODY_BYTES = 64 * 1024;

/** The refusal a body over the cap gets, in one place because BOTH adapters answer it and a browser sees the words. */
export function bodyTooLarge(): ApiResult {
  return { status: 413, body: { error: { code: 'body_too_large', message: `the request body is larger than ${MAX_BODY_BYTES} bytes` } } };
}

/**
 * A request body's text as the handlers see it, or the refusal that answers it.
 *
 * THE RULE LIVES HERE BECAUSE THE TWO ADAPTERS MUST NOT DISAGREE ABOUT IT, which is the same argument as `dispatch`
 * itself: a body that is not JSON is a CLIENT error (400 `bad_json`), and `null` means "there was no body" to every
 * handler — so an adapter that turned a parse failure into `null` would serve a malformed submission as an empty one,
 * and one that turned it into a 500 would blame the server for the caller's bytes. (The dev server did exactly the
 * latter until this module existed, because `JSON.parse` threw into its transport catch; that is a behaviour change
 * and it is the honest one, so it is stated in the change that made it.)
 *
 * THE BYTE CAP IS CHECKED ON THE TEXT, which is why the dev server ALSO caps its stream below: that one is about not
 * buffering a body it is going to refuse, and this one is about the answer.
 */
export function parseBody(text: string): { body: unknown } | { refusal: ApiResult } {
  if (text === '') return { body: null };
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { refusal: bodyTooLarge() };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { refusal: { status: 400, body: { error: { code: 'bad_json', message: 'the request body is not JSON' } } } };
  }
}

/** What an emulator can do for a request: answer it, or null when the path is not one of its routes. */
export interface EmulatorLike {
  handle(request: ApiRequest): Promise<ApiResult | null>;
}

interface DispatchOptions {
  /** The identity mode's emulator, or null in a mode that has none (`dev`, `cognito`). ORDER MATTERS: see below. */
  readonly emulator: EmulatorLike | null;
  /** Where a handler's throw is reported. The message never reaches the client. */
  readonly onError?: (request: ApiRequest, error: unknown) => void;
}

/**
 * Serve one request: the emulator's routes, then the table, then 404 — and a 500 for anything that throws.
 *
 * THE EMULATOR COMES FIRST AND ONLY WHEN IT EXISTS, which is what keeps DESIGN.md §11.2's promise honest: in `dev`
 * and `cognito` mode these paths are unrouted, exactly as any unknown path is, so the handler core never learns that
 * authentication has a shape. In the `emulate` mode the five `/auth/*` routes are served here and are NOT rows of
 * `ROUTES` — they are not endpoints of §11, and counting them there would make `/health`'s gap number lie.
 */
export async function dispatch(request: ApiRequest, deps: Deps, options: DispatchOptions): Promise<ApiResult> {
  try {
    const emulated = options.emulator ? await options.emulator.handle(request) : null;
    if (emulated) return emulated;
    const route = routeFor(request.method, request.path);
    if (route) return await route.handler(request, deps);
    return { status: 404, body: { error: { code: 'not_found', message: `nothing serves ${request.path}` } } };
  } catch (error) {
    options.onError?.(request, error);
    return { status: 500, body: { error: { code: 'internal', message: 'the request could not be handled' } } };
  }
}
