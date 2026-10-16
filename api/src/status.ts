// The transport-level answers every endpoint shares: a status per outcome, one error body, and the identity gate.
//
// WHY THESE MOVED OUT OF `handlers/drill.ts`. They were local to the first handler, and the second one needs
// exactly the same three: a status code per outcome, `{ error: { code, message } }` as the only failure shape,
// and the identity question. Three copies of an error body is how two endpoints come to answer differently
// for the same failure.
//
// WHY THERE ARE NOW TWO IDENTITY GATES. DESIGN.md 11.1's A20 splits the endpoints by intent: a WRITE without an
// identity is a refusal, and a READ without one is a DEMO that must write nothing. One function could not say
// both, and the version that said only the first was the reason a signed-out visitor got a 401 from
// `GET /puzzle` — an endpoint that does not use the player id at all.
import type { ApiRequest, ApiResult, Deps, Identity } from './ports.ts';

/** The status codes this API uses, named so a probe and a reader agree about them rather than by number. */
export const STATUS = {
  ok: 200,
  badRequest: 400,
  unauthenticated: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  unavailable: 503,
} as const;

/** An error body every refusal shares, so a client has one shape to read. */
export const failure = (status: number, code: string, message: string): ApiResult => ({
  status,
  body: { error: { code, message } },
});

/**
 * The identity, or the refusal to return: a missing identity on a WRITE is never a 500 — it is who is asking.
 *
 * THE MESSAGE NAMES THE REMEDY RATHER THAN THE FIELD, because the caller is a browser and not a developer: a
 * signed-out visitor who reaches a write has found a path the client does not offer, and the honest answer is
 * that submitting needs an account (DESIGN.md 11.2's "a signed-out caller gets a demo, not a wall" — the wall is
 * on the WRITE, where it belongs).
 */
export function requireIdentity(request: ApiRequest, deps: Deps): { identity: Identity } | { refusal: ApiResult } {
  const identity = deps.identityOf(request);
  if (!identity) return { refusal: failure(STATUS.unauthenticated, 'unauthenticated', 'this endpoint needs a signed-in player') };
  return { identity };
}

/**
 * The identity, or null: for a READ that answers a signed-out caller too (DESIGN.md 11.1's A20).
 *
 * IT IS DELIBERATELY NOT A REFUSAL. A read that returns null here must answer WITHOUT the player-specific parts
 * and WRITE NOTHING — no Progress row, no attempt row — because the whole point of the demo is that nothing of
 * an unverified visitor's is stored. That obligation cannot be enforced by this function, so it is enforced by
 * the probe: `auth-probe.mjs` reads the drill and the challenge anonymously through a counting store and asserts
 * that the count did not move and the store did not grow, with an identified read as the control that shows the
 * instrument can see a write at all.
 */
export function optionalIdentity(request: ApiRequest, deps: Deps): Identity | null {
  return deps.identityOf(request);
}
