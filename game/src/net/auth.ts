// The game's sign-in path: what mode the server is in, the five account calls, and the session's lifetime.
//
// WHAT THIS FILE IS FOR, AND WHAT IT IS NOT. DESIGN.md §11.2 makes the identity a server fact — a verified token
// or an absent one — and the client's half of that is exactly three things: discover the mode the server was
// started in, run the sign-in flow when the server offers one, and keep the session's access token fresh. It is
// NOT a second account system: every rule about who a player is lives in `api/src/auth/`, and this module only
// carries the answer.
//
// THE MODE IS DISCOVERED, NOT COMPILED IN (§11.2). `/health` is an anonymous read that names the mode and, when
// there is one, the emulator's sign-in routes — so `dev` shows no sign-in UI at all and `emulate` calls the local
// emulator. `VITE_AUTH_MODE` pins it for a build that must not ask, and it is an OVERRIDE RATHER THAN A GUESS:
// the operator who sets it is the one who knows what they deployed.
//
// EVERY CALL ANSWERS WITH THE TYPED RESULT `api.ts` USES, because a refusal from an auth endpoint is content a
// player has to be shown ("that password is wrong") and not an exception. The one case that is NOT a failure is
// a failed REFRESH: it means the session is over, and the honest answer is to sign the player out rather than to
// report an outage they cannot act on.
import { apiCall, type ApiDeps, type ApiResult } from './api.ts';
import { clearSession, readSession, sessionFromAuth, writeSession, type Session } from './session.ts';

/**
 * Every call in this module is ANONYMOUS — no identity header at all — because the credentials it needs are in the
 * body (`apiCall`'s `anonymous`). MEASURED: without it a signup also sent the device id, which the server ignores,
 * which a token mode refuses to advertise in CORS, and which puts a stable browser identifier on a request that
 * has no use for one.
 */
const NO_IDENTITY = { anonymous: true } as const;

/** The modes of DESIGN.md §11.2, as `/health` reports them. */
export type AuthMode = 'dev' | 'emulate' | 'cognito';

/** What the server said about how it knows who is asking. */
export interface AuthDiscovery {
  readonly mode: AuthMode;
  /**
   * The sign-in routes the server actually serves: empty in `dev`, the emulator's five in `emulate`.
   *
   * IT IS READ RATHER THAN ASSUMED, so a client cannot offer a sign-in the server will answer `404` to — which is
   * what "the emulator's routes are unrouted in every other mode" means from this side (§11.2, and measured in
   * `api/test/auth-probe.mjs`).
   */
  readonly signin: readonly string[];
}

/** The three modes, so a value from the network is checked rather than trusted. */
function asMode(value: unknown): AuthMode | null {
  return value === 'dev' || value === 'emulate' || value === 'cognito' ? value : null;
}

/**
 * `GET /health` — which mode the API was started in.
 *
 * A BUILD THAT PINNED `VITE_AUTH_MODE` DOES NOT ASK, and that is the second half of the same decision: the mode
 * is what decides whether a token or a header names the player, and a build that knows its own answer should not
 * be able to be told a different one by whatever is listening on the base URL.
 */
export async function discoverAuth(deps: ApiDeps): Promise<ApiResult<AuthDiscovery>> {
  const pinned = asMode(deps.modeOverride);
  if (pinned) return { ok: true, value: { mode: pinned, signin: [] } };
  const answer = await apiCall<{ auth?: { mode?: unknown; signin?: unknown } }>(deps, '/health', { method: 'GET' }, NO_IDENTITY);
  if (!answer.ok) return answer;
  const mode = asMode(answer.value.auth?.mode);
  if (!mode) {
    // AN API THAT DOES NOT NAME ITS MODE IS NOT ONE THIS BUILD CAN SIGN IN TO, and saying so is better than
    // assuming `dev` (which would send a header the server may ignore) or `cognito` (which would send the browser
    // somewhere that does not exist).
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not say which identity mode it is in' } };
  }
  const signin = Array.isArray(answer.value.auth?.signin) ? (answer.value.auth?.signin as string[]).filter((route) => typeof route === 'string') : [];
  return { ok: true, value: { mode, signin } };
}

/** What a successful signup answers. `confirmCode` is present only while the account is unconfirmed. */
export interface SignupAnswer {
  readonly email: string;
  readonly playerId: string;
  readonly confirmed: boolean;
  /**
   * The code the emulator would have emailed, RETURNED because there is no mail sender locally, or null when the
   * account is already confirmed. A real provider answers without one, which is why the UI must not require it.
   */
  readonly confirmCode: string | null;
}

/**
 * `POST /auth/signup` — create an account.
 *
 * A MALFORMED ANSWER IS REFUSED rather than half-read, for the same reason the drill's is: `email` is what the
 * confirm step asks with, and an `undefined` there would become the string "undefined" in a request.
 */
export async function signUp(email: string, password: string, deps: ApiDeps): Promise<ApiResult<SignupAnswer>> {
  const answer = await apiCall<Record<string, unknown>>(deps, '/auth/signup', { method: 'POST', body: { email, password } }, NO_IDENTITY);
  if (!answer.ok) return answer;
  const value = answer.value;
  if (typeof value.email !== 'string' || typeof value.playerId !== 'string') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not answer with the account it created' } };
  }
  return {
    ok: true,
    value: {
      email: value.email,
      playerId: value.playerId,
      confirmed: value.confirmed === true,
      confirmCode: typeof value.confirmCode === 'string' ? value.confirmCode : null,
    },
  };
}

/** `POST /auth/confirm` — hand back the code that confirms an account. */
export async function confirmAccount(email: string, code: string, deps: ApiDeps): Promise<ApiResult<{ confirmed: boolean }>> {
  const answer = await apiCall<Record<string, unknown>>(deps, '/auth/confirm', { method: 'POST', body: { email, code } }, NO_IDENTITY);
  if (!answer.ok) return answer;
  return { ok: true, value: { confirmed: answer.value.confirmed === true } };
}

/** A signed-in player, as the UI needs them: the id the board is keyed on and the address they typed. */
export interface SignedIn {
  readonly playerId: string;
  readonly email: string;
}

/**
 * `POST /auth/signin` — start a session, and STORE it.
 *
 * THE SESSION IS WRITTEN HERE AND NOWHERE ELSE, which is what keeps "the app thinks it is signed in" and "there
 * is a token to send" the same fact. An answer this build cannot read as a session is refused AND nothing is
 * written, so a half-understood sign-in cannot leave a stale session behind.
 */
export async function signIn(email: string, password: string, deps: ApiDeps, nowMs = Date.now()): Promise<ApiResult<SignedIn>> {
  const answer = await apiCall<Record<string, unknown>>(deps, '/auth/signin', { method: 'POST', body: { email, password } }, NO_IDENTITY);
  if (!answer.ok) return answer;
  const session = sessionFromAuth(answer.value, nowMs);
  if (!session) {
    clearSession(deps);
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not answer with a session this app can use' } };
  }
  writeSession(deps, session);
  return { ok: true, value: { playerId: session.playerId, email: session.email } };
}

/**
 * `POST /auth/refresh` — trade the refresh token for a new pair, and store it.
 *
 * IT IS NOT CALLED ON EVERY REQUEST. A refresh token is good ONCE (the emulator rotates it, §11.2), so a client
 * that refreshed speculatively would burn the session it was trying to keep; `refreshIfExpired` is the only
 * caller, and it asks the clock first.
 */
export async function refreshSession(deps: ApiDeps, nowMs = Date.now()): Promise<ApiResult<SignedIn>> {
  const current = readSession(deps);
  if (!current) return { ok: false, failure: { code: 'no_session', message: 'there is no session to refresh' } };
  const answer = await apiCall<Record<string, unknown>>(deps, '/auth/refresh', { method: 'POST', body: { refreshToken: current.refreshToken } }, NO_IDENTITY);
  if (!answer.ok) {
    // THE SESSION IS OVER AND THE STORE MUST SAY SO. A refresh token the server refuses (expired, rotated away,
    // revoked) is not an outage to report: it is the end of a session, and leaving the dead token in storage
    // would have every later request answered `401` for a reason the player could not see.
    clearSession(deps);
    return answer;
  }
  const session = sessionFromAuth(answer.value, nowMs);
  if (!session) {
    clearSession(deps);
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not answer with a session this app can use' } };
  }
  writeSession(deps, session);
  return { ok: true, value: { playerId: session.playerId, email: session.email } };
}

/**
 * Refresh ONLY when the access token is close to its expiry, and say what happened.
 *
 * `stillFresh` IS THE INTERESTING ANSWER: it means nothing was asked of the server, which is the behaviour that
 * keeps a boot from spending a refresh token every time the app is reloaded. MEASURED in
 * `game/test/auth-client-probe.mjs` by counting the fetches, because a client that refreshed unconditionally
 * would look identical from the outside until the second reload.
 */
export async function refreshIfExpired(
  deps: ApiDeps,
  nowMs = Date.now(),
): Promise<{ kind: 'no_session' } | { kind: 'still_fresh' } | { kind: 'refreshed'; session: Session } | { kind: 'signed_out' }> {
  const session = readSession(deps);
  if (!session) return { kind: 'no_session' };
  if (nowMs < session.expiresAtMs) return { kind: 'still_fresh' };
  const answer = await refreshSession(deps, nowMs);
  if (!answer.ok) return { kind: 'signed_out' };
  const refreshed = readSession(deps);
  return refreshed ? { kind: 'refreshed', session: refreshed } : { kind: 'signed_out' };
}

/**
 * `POST /auth/signout` — end the session, LOCALLY FIRST.
 *
 * THE LOCAL SESSION IS DROPPED EVEN WHEN THE SERVER CANNOT BE REACHED. The player asked to sign out, and "the
 * network was down so you are still signed in" is the wrong answer on a shared machine — so the stored tokens go
 * regardless, and the server's revocation is best effort. What that leaves behind is a live refresh-token id on
 * the server until it expires, which is stated rather than hidden (DESIGN.md §11.2). A FAILED ANSWER THEREFORE
 * MEANS "THE SERVER WAS NOT TOLD", NOT "YOU ARE STILL SIGNED IN", and the caller is expected to say exactly that.
 */
export async function signOut(deps: ApiDeps): Promise<ApiResult<{ revoked: boolean }>> {
  const session = readSession(deps);
  if (!session) {
    clearSession(deps);
    return { ok: true, value: { revoked: false } };
  }
  const answer = await apiCall<Record<string, unknown>>(deps, '/auth/signout', { method: 'POST', body: { refreshToken: session.refreshToken } }, NO_IDENTITY);
  clearSession(deps);
  return answer.ok ? { ok: true, value: { revoked: answer.value.revoked === true } } : answer;
}

/** Who the app believes is signed in: the session if there is one, and nothing else. */
export function currentPlayer(deps: ApiDeps): SignedIn | null {
  const session = readSession(deps);
  return session ? { playerId: session.playerId, email: session.email } : null;
}
