// Who is asking: the two adapters that turn a request into an `Identity`, and the rule that separates them.
//
// THE WHOLE SECURITY PROPERTY OF THIS FILE IS ONE SENTENCE: the token adapters never read `x-dev-player`, and the
// dev adapter is constructed only when the mode says so. MEASURED, and it is how §11.1 was found — the dev
// adapter once accepted `x-dev-player: <anyone>` as that player in every mode there was, so possession of a
// header was possession of an account. Splitting the two here, rather than inside one function that branches on
// the mode, is what makes that a property of the TYPE: `tokenIdentityOf` has no expression that could return an
// identity from a header, so no future edit to it can reintroduce one by accident.
import type { ApiRequest, Identity, IdentityOf } from '../ports.ts';
import type { JwtClaims } from './verify.ts';

/**
 * The development identity — a header naming a player, and NOTHING ELSE.
 *
 * TWO SPELLINGS, ONE MEANING: `x-dev-player: alice` and `Authorization: Bearer dev:alice` both name the same
 * player, because a browser test and a `curl` are the two ways a developer drives this and neither should have
 * to know the other's habit. `dev:` is prefixed onto the value so a development id can never collide with a
 * Cognito `sub` or an emulator id if a row is ever copied between the two.
 *
 * IT IS UNVERIFIABLE BY CONSTRUCTION: there is no signature to check, so the id is exactly what the caller
 * wrote. That is why `authRefusal` (config.ts) refuses to build this adapter in production, and why the boot
 * banner names the mode rather than whispering it.
 */
export function devIdentityOf(request: ApiRequest): Identity | null {
  const direct = request.headers['x-dev-player'];
  if (direct) return { playerId: `dev:${direct}`, source: 'dev' };
  const bearer = request.headers['authorization'];
  const match = bearer ? /^Bearer\s+dev:(.+)$/i.exec(bearer) : null;
  return match ? { playerId: `dev:${match[1]}`, source: 'dev' } : null;
}

/**
 * The token identity: `Authorization: Bearer <jwt>`, verified, and that is the ONLY input.
 *
 * A FAILED VERIFICATION IS `null` RATHER THAN AN ERROR, so an expired token, a token signed with the wrong key
 * and no token at all all become the same 401 — which is what the caller should learn, and no more.
 *
 * THE PLAYER ID IS THE TOKEN'S `sub`, unprefixed, so the stored rows are keyed exactly as DESIGN.md 11.2 says
 * they are. The namespaces stay separate because the ISSUERS are separate: the emulator mints `emu:<uuid>` as
 * its `sub`, Cognito mints a uuid, and the dev adapter writes `dev:<name>` — so no two sources can name the
 * same row, and the row's own key says which source wrote it.
 */
export function tokenIdentityOf(options: {
  readonly source: 'emulator' | 'cognito';
  readonly verify: (token: string) => JwtClaims | null;
}): IdentityOf {
  return (request) => {
    const header = request.headers['authorization'];
    const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
    if (!match) return null;
    // `dev:` IS REFUSED HERE EVEN IN A TOKEN MODE, so that a stray development header cannot name a player in
    // the one place a header must mean nothing. Without this, a caller who wrote `Bearer dev:alice` would have
    // to be saved by the emulator's signature check — a correct check, but the wrong reason to be safe.
    if (/^dev:/i.test(match[1])) return null;
    const claims = options.verify(match[1]);
    if (!claims) return null;
    return { playerId: claims.sub, source: options.source };
  };
}
