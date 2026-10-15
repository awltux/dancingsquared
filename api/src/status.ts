// The transport-level answers every endpoint shares: a status per outcome, one error body, and the identity gate.
//
// WHY THESE MOVED OUT OF `handlers/drill.ts`. They were local to the first handler, and the second one needs
// exactly the same three: a status code per outcome, `{ error: { code, message } }` as the only failure shape,
// and the `playerIdOf` question. Three copies of an error body is how two endpoints come to answer differently
// for the same failure.
import type { ApiRequest, ApiResult, Deps } from './ports.ts';

/** The status codes this API uses, named so a probe and a reader agree about them rather than by number. */
export const STATUS = {
  ok: 200,
  badRequest: 400,
  unauthenticated: 401,
  notFound: 404,
  conflict: 409,
  unavailable: 503,
} as const;

/** An error body every refusal shares, so a client has one shape to read. */
export const failure = (status: number, code: string, message: string): ApiResult => ({
  status,
  body: { error: { code, message } },
});

/** The `playerId`, or the refusal to return: a missing identity is never a 500 — it is who is asking. */
export function identity(request: ApiRequest, deps: Deps): { playerId: string } | { refusal: ApiResult } {
  const playerId = deps.playerIdOf(request);
  if (!playerId) return { refusal: failure(STATUS.unauthenticated, 'unauthenticated', 'no player id on this request') };
  return { playerId };
}
