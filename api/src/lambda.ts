// The Lambda behind API Gateway: the same handlers, over an event rather than a socket.
//
// IT IS AN ADAPTER AND NOTHING ELSE, exactly like `dev-server.ts`, and the two now share the part that decides
// anything (`dispatch.ts`): the emulator's routes first and only where an emulator exists, the 404 shape for an
// unrouted path, and the 500 for a handler that throws. What this file owns is the TRANSPORT: an API Gateway event in,
// an API Gateway response out. That is the whole difference between a developer's laptop and the deployment, and
// keeping it that small is what makes the local run evidence about the deployed one (`AGENTS.md` §1's api row).
//
// NO AWS SDK IS IMPORTED, AND THAT IS A DESIGN CHOICE RATHER THAN AN OMISSION. This module is a pure function of an
// event, a `Deps` and a little configuration, so a probe drives the WHOLE deployed path — routing, identity, the
// store, the refusal bodies — from fixture events with no SDK, no credentials and no Lambda runtime. The things that
// really do need AWS (the table, the pool, the log) belong to the composition root that builds `Deps` and calls this,
// and `AGENTS.md` §6 says where their identifiers live: a config file plus `DSQ_*` overrides, never a literal.
//
// THE EVENT SHAPE IS API GATEWAY'S HTTP API (payload format 2.0), and the choice is recorded as a decision rather
// than assumed: `requestContext.http.method`, `rawPath`, `rawQueryString` and a `body` that may be base64. A REST API
// (payload 1.0) sends `httpMethod`, `path`, `queryStringParameters` and `headers` instead — one more mapping
// function, and `DESIGN.md` §15 Q14 lists the choice among the decisions the deployment still needs. 2.0 is the
// default here because it is what an HTTP API gives, it is cheaper per request, and its event is the smaller object.
import type { ApiRequest, ApiResult, Deps } from './ports.ts';
import { dispatch, parseBody, type EmulatorLike } from './dispatch.ts';
import { PLANNED_ENDPOINTS, ROUTES } from './routes.ts';

/** The HTTP API's event, as much of it as this adapter reads. Everything is `unknown` until `asRequest` looks. */
interface HttpApiEvent {
  readonly rawPath?: unknown;
  readonly rawQueryString?: unknown;
  readonly headers?: unknown;
  readonly body?: unknown;
  readonly isBase64Encoded?: unknown;
  readonly requestContext?: { readonly http?: { readonly method?: unknown } } | unknown;
}

/** What an API Gateway HTTP API answers with, payload 2.0. */
interface HttpApiResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

interface LambdaOptions {
  readonly deps: Deps;
  /** The identity mode's emulator, or null in a mode that has none. */
  readonly emulator?: EmulatorLike | null;
  /** The identity mode, for the CORS headers and for `/health`'s answer. */
  readonly auth: string;
  /** The store's name, for `/health`. Named rather than implied, for the reason the dev server's `/health` names it. */
  readonly store: string;
  /** A note about the identity machinery, for `/health`. */
  readonly identity: string;
  /**
   * The origin to allow, or null for `*`.
   *
   * A DEPLOYMENT SHOULD SET IT. `*` is what the local server uses because it is bound to 127.0.0.1, has no cookies
   * and takes its credentials in a header the caller must write; a deployed API is reachable by anyone, so the
   * origin is a decision (`DSQ_CORS_ORIGIN`) rather than a default — which is why it is passed in and not computed.
   */
  readonly corsOrigin?: string | null;
  readonly onError?: (request: ApiRequest, error: unknown) => void;
}

/**
 * The CORS headers a browser needs, in the one place a token mode can be told from `dev`.
 *
 * THE ALLOWED HEADERS DEPEND ON THE IDENTITY MODE, so this mirrors the dev server's rule rather than inventing a
 * second one: `dev` lets the browser send `x-dev-player` and a token mode does not, because advertising a header that
 * no longer means anything is how a client keeps sending it (§11.2's negative control). A deployment runs `cognito`,
 * where `dev` is refused outright (`config.ts`), so the deployed answer never advertises it.
 *
 * A GATEWAY CAN DO THIS INSTEAD, and the deployment should decide which: API Gateway's own CORS configuration
 * answers preflights without invoking the function at all, which is cheaper. This file answers them anyway, because
 * a function that is only correct behind a configured gateway is a function whose correctness lives in Terraform.
 */
export function corsHeaders(auth: string, origin: string | null): Record<string, string> {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-headers': auth === 'dev' ? 'content-type, authorization, x-dev-player' : 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
  };
}

/** The event's headers as a plain map, lower-cased, because HTTP header names are case-insensitive. */
function asHeaders(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // THE FIRST VALUE WINS ON A REPEAT, and only a string is a header. Compressing a repeated `cookie` would be a
    // change to what the request means; this API reads `authorization` and `x-dev-player`, neither of which repeats.
    if (typeof value === 'string' && out[key.toLowerCase()] === undefined) out[key.toLowerCase()] = value;
  }
  return out;
}

/** The query string as a map, parsed from `rawQueryString` the way the dev server parses a URL's. */
function asQuery(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw === '') return {};
  return Object.fromEntries(new URLSearchParams(raw));
}

/**
 * The event as the handlers see it, or a refusal this adapter owns.
 *
 * THE BODY IS PARSED, NOT GUESSED: a malformed JSON body is a 400 rather than a body of `null`, because `null` means
 * "there was none" to every handler and a request that sent broken JSON must not be served as though it sent
 * nothing. The base64 flag is honoured, and the size cap is enforced BEFORE parsing, for the reason the dev server
 * has one at all: nothing this API takes is bigger than a move list.
 */
export function asRequest(event: HttpApiEvent): { ok: true; request: ApiRequest } | { ok: false; response: HttpApiResponse; headers: Record<string, string> } {
  const context = event.requestContext;
  const http = typeof context === 'object' && context !== null ? (context as { http?: { method?: unknown } }).http : undefined;
  const method = typeof http?.method === 'string' ? http.method.toUpperCase() : '';
  const path = typeof event.rawPath === 'string' && event.rawPath !== '' ? event.rawPath : '';
  if (method === '' || path === '') {
    return {
      ok: false,
      response: { statusCode: 400, headers: {}, body: JSON.stringify({ error: { code: 'bad_event', message: 'the event names no method or no path' } }) },
      headers: {},
    };
  }
  const headers = asHeaders(event.headers);
  let body: unknown = null;
  if (typeof event.body === 'string' && event.body !== '') {
    const text = event.isBase64Encoded === true ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    // THE RULE IS THE SHARED ONE (`parseBody`), so this adapter and the dev server cannot answer a malformed or
    // oversized body differently — the second adapter is exactly why it moved out of the dev server.
    const parsed = parseBody(text);
    if ('refusal' in parsed) {
      return {
        ok: false,
        response: { statusCode: parsed.refusal.status, headers: {}, body: JSON.stringify(parsed.refusal.body) },
        headers: {},
      };
    }
    body = parsed.body;
  }
  return { ok: true, request: { method, path, query: asQuery(event.rawQueryString), body, headers } };
}

/**
 * The handler a Lambda runs.
 *
 * THE ORDER IS THE DEV SERVER'S, and it is the same file that decides it (`dispatch`): a preflight is answered before
 * any routing (it names a route rather than asking for one), then `/health` — which is an ADAPTER route and not a row
 * of `ROUTES`, because it answers what THIS process serves rather than being an endpoint of DESIGN.md 11 — then the
 * handlers. `/health` reports the endpoints and `planned`, so a deploy smoke test can read the same gap number the
 * local run prints.
 */
export async function handleEvent(event: HttpApiEvent, options: LambdaOptions): Promise<HttpApiResponse> {
  const cors = corsHeaders(options.auth, options.corsOrigin ?? null);
  const parsed = asRequest(event);
  if (!parsed.ok) return { ...parsed.response, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } };
  const request = parsed.request;

  if (request.method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const result: ApiResult = request.path === '/health'
    ? {
        status: 200,
        body: {
          ok: true,
          store: options.store,
          auth: { mode: options.auth, identity: options.identity },
          endpoints: ROUTES.map((route) => `${route.method} ${route.path}`),
          planned: PLANNED_ENDPOINTS,
        },
      }
    : await dispatch(request, options.deps, {
        emulator: options.emulator ?? null,
        ...(options.onError ? { onError: options.onError } : {}),
      });

  return {
    statusCode: result.status,
    headers: {
      ...cors,
      'content-type': 'application/json; charset=utf-8',
      // NOTHING HERE IS CACHEABLE, for the reason the dev server gives: the endpoints are per-player and the
      // Progress row moves under them, so a cached drill is a wrong question.
      'cache-control': 'no-store',
    },
    body: JSON.stringify(result.body),
  };
}
