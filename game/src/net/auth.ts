// The game's sign-in path: which provider is in play, the six account calls, and the session's lifetime.
//
// WHAT THIS FILE IS FOR, AND WHAT IT IS NOT. DESIGN.md §11.2 makes the identity a server fact — a verified token
// or an absent one — and the client's half of that is exactly three things: discover the provider, run the sign-in
// flow when there is one, and keep the session's access token fresh. It is NOT a second account system: every rule
// about who a player is lives in `api/src/auth/` or in the pool itself, and this module only carries the answer.
//
// TWO PROVIDERS, ONE SET OF CALLS. REPORTED: "account management must be compatible with the AWS Cognito API." So every
// function below asks `providerOf(deps)` and dispatches: with a pool configured (`VITE_COGNITO_REGION` +
// `VITE_COGNITO_CLIENT_ID`) the calls go to the Cognito user-pool API with its own operation and field names
// (`net/cognito.ts`), and without one they go to this API's `/auth/*` routes, which is what the local emulator serves. The
// ROUTE NAMES ARE THE APP'S EITHER WAY — `POST /auth/signup` and friends — so `net/standing.ts` decides which forms to offer
// from one list, and no screen has a provider branch in it.
//
// THE MODE IS DISCOVERED, NOT COMPILED IN (§11.2). `/health` is an anonymous read that names the mode and, when there is
// one, the routes the server serves — so `dev` shows no sign-in UI at all and `emulate` calls the local emulator. A build
// with a pool does not ask: it knows, and the answer is `cognito` with the operations that pool serves. `VITE_AUTH_MODE`
// still pins the mode for a build that must not ask.
//
// EVERY CALL ANSWERS WITH THE TYPED RESULT `api.ts` USES, because a refusal from an auth endpoint is content a
// player has to be shown ("that password is wrong") and not an exception. The one case that is NOT a failure is
// a failed REFRESH: it means the session is over, and the honest answer is to sign the player out rather than to
// report an outage they cannot act on.
import { apiCall, type ApiDeps, type ApiResult } from './api.ts';
import { COGNITO_ROUTES, cognitoCall, sessionShapeOf, type CognitoConfig } from './cognito.ts';
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
interface AuthDiscovery {
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
 * Which provider the calls below go to: the pool when the build named one, this API's routes otherwise.
 *
 * IT IS READ FROM THE DEPENDENCIES AND NOT FROM `import.meta.env` HERE, for the reason `api.ts` records: a dependency is a
 * value a probe can hand over, and an env var read at the point of use is one no probe can reach.
 */
function providerOf(deps: ApiDeps): CognitoConfig | null {
  return deps.cognito ?? null;
}

/** The six route names both providers answer to, in the order the UI asks about them. */
const API_ROUTES: readonly string[] = [
  'POST /auth/signup',
  'POST /auth/confirm',
  'POST /auth/signin',
  'POST /auth/refresh',
  'POST /auth/signout',
  'POST /auth/password',
];

/**
 * `GET /health` — which mode the API was started in, and which account routes it serves.
 *
 * A BUILD THAT PINNED `VITE_AUTH_MODE` DOES NOT ASK, and that is the second half of the same decision: the mode
 * is what decides whether a token or a header names the player, and a build that knows its own answer should not
 * be able to be told a different one by whatever is listening on the base URL.
 *
 * A BUILD WITH A POOL DOES NOT ASK EITHER, and answers `cognito` with the operations the pool serves: the pool is the
 * provider, `api/src/auth/` verifies its tokens, and the API's `/auth/*` routes are the emulator's, not the pool's.
 */
export async function discoverAuth(deps: ApiDeps): Promise<ApiResult<AuthDiscovery>> {
  const pool = providerOf(deps);
  if (pool) return { ok: true, value: { mode: 'cognito', signin: COGNITO_ROUTES } };
  const pinned = asMode(deps.modeOverride);
  if (pinned) return { ok: true, value: { mode: pinned, signin: pinned === 'emulate' ? API_ROUTES : [] } };
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
interface SignupAnswer {
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
 *
 * THE POOL ANSWERS `UserConfirmed` AND `UserSub` RATHER THAN AN EMAIL AND A PLAYER ID, and it never returns the confirmation
 * code — there is a mail sender at the other end. So the same shape is built from those, with `confirmCode: null`, and the UI's
 * confirm step is the one that asks for the code a player reads in their inbox.
 */
export async function signUp(email: string, password: string, deps: ApiDeps): Promise<ApiResult<SignupAnswer>> {
  const pool = providerOf(deps);
  if (pool) {
    const answer = await cognitoCall(deps, pool, 'POST /auth/signup', { ClientId: pool.clientId, Username: email, Password: password });
    if (!answer.ok) return answer;
    const sub = typeof answer.value['UserSub'] === 'string' ? answer.value['UserSub'] : '';
    if (sub === '') {
      return { ok: false, failure: { code: 'bad_response', message: 'the account provider did not answer with the account it created' } };
    }
    return { ok: true, value: { email, playerId: sub, confirmed: answer.value['UserConfirmed'] === true, confirmCode: null } };
  }
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

/**
 * `POST /auth/confirm` — hand back the code that confirms an account.
 *
 * THE POOL TAKES THE ADDRESS AS `Username`, because this app signs up with an email and a pool configured for email-as-username
 * is the case DESIGN.md §11.2 assumes. A pool using phone numbers or a separate username would need that value carried
 * through, which is a change to this function and not a silent guess.
 */
export async function confirmAccount(email: string, code: string, deps: ApiDeps): Promise<ApiResult<{ confirmed: boolean }>> {
  const pool = providerOf(deps);
  if (pool) {
    const answer = await cognitoCall(deps, pool, 'POST /auth/confirm', { ClientId: pool.clientId, Username: email, ConfirmationCode: code });
    return answer.ok ? { ok: true, value: { confirmed: true } } : answer;
  }
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
 * `POST /auth/password` — change the password of the account in the request body.
 *
 * THE EMAIL IS THE CALLER'S ARGUMENT AND NOT A SESSION FIELD, because this build's client has no session endpoint to ask
 * "who am I": the address is stored with the session at sign-in (`SignedIn.email`) and passed in from there, which is the same
 * value the server keys the account on. It is sent WITH the current password, and the server checks both — a session alone
 * does not authorise a password change (`api/src/auth/emulator.ts` says why).
 *
 * IT DOES NOT TOUCH THE STORED SESSION. A successful change revokes every REFRESH token, so the next refresh signs this device
 * out, but the access token in hand is still good until it expires — rewriting the session here would be a lie about what the
 * server said.
 */
export async function changePassword(email: string, currentPassword: string, newPassword: string, deps: ApiDeps): Promise<ApiResult<{ revoked: number }>> {
  const pool = providerOf(deps);
  if (pool) {
    // THE POOL AUTHORISES WITH THE ACCESS TOKEN, NOT WITH THE EMAIL: `ChangePassword` takes `PreviousPassword` and the caller's
    // own access token, so no address travels and the token cannot be one for a different account. A pool also revokes every
    // other session on its own (`GlobalSignOut` semantics for a password change are the pool's), so the count this app can
    // report is 0 — "the provider decided", which is the truth.
    const session = readSession(deps);
    if (!session) return { ok: false, failure: { code: 'no_session', message: 'there is no session to change a password for' } };
    const answer = await cognitoCall(deps, pool, 'POST /auth/password', {
      AccessToken: session.accessToken,
      PreviousPassword: currentPassword,
      ProposedPassword: newPassword,
    });
    return answer.ok ? { ok: true, value: { revoked: 0 } } : answer;
  }
  const answer = await apiCall<Record<string, unknown>>(
    deps,
    '/auth/password',
    { method: 'POST', body: { email, currentPassword, newPassword } },
    NO_IDENTITY,
  );
  if (!answer.ok) return answer;
  return { ok: true, value: { revoked: typeof answer.value.revoked === 'number' ? answer.value.revoked : 0 } };
}

/**
 * `POST /auth/signin` — start a session, and STORE it.
 *
 * THE SESSION IS WRITTEN HERE AND NOWHERE ELSE, which is what keeps "the app thinks it is signed in" and "there
 * is a token to send" the same fact. An answer this build cannot read as a session is refused AND nothing is
 * written, so a half-understood sign-in cannot leave a stale session behind.
 */
export async function signIn(email: string, password: string, deps: ApiDeps, nowMs = Date.now()): Promise<ApiResult<SignedIn>> {
  const pool = providerOf(deps);
  let raw: Record<string, unknown>;
  if (pool) {
    // `USER_PASSWORD_AUTH` IS THE FLOW A BROWSER CAN RUN: no hosted UI, no redirect, one POST. A pool that has it disabled is
    // refused by the pool itself (`InvalidParameterException`), which the error mapping carries through as a sentence.
    const answer = await cognitoCall(deps, pool, 'POST /auth/signin', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: pool.clientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    if (!answer.ok) return answer;
    const result = answer.value['AuthenticationResult'];
    const shaped = typeof result === 'object' && result !== null
      ? sessionShapeOf(result as Record<string, unknown>, typeof (result as Record<string, unknown>)['RefreshToken'] === 'string' ? String((result as Record<string, unknown>)['RefreshToken']) : '')
      : null;
    if (!shaped) {
      clearSession(deps);
      return { ok: false, failure: { code: 'bad_response', message: 'the account provider did not answer with a session this app can use' } };
    }
    raw = shaped;
  } else {
    const answer = await apiCall<Record<string, unknown>>(deps, '/auth/signin', { method: 'POST', body: { email, password } }, NO_IDENTITY);
    if (!answer.ok) return answer;
    raw = answer.value;
  }
  const session = sessionFromAuth(raw, nowMs);
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
async function refreshSession(deps: ApiDeps, nowMs = Date.now()): Promise<ApiResult<SignedIn>> {
  const current = readSession(deps);
  if (!current) return { ok: false, failure: { code: 'no_session', message: 'there is no session to refresh' } };
  const pool = providerOf(deps);
  let raw: Record<string, unknown>;
  if (pool) {
    // A REFRESH ANSWERS WITH NO NEW REFRESH TOKEN, so the one already held is carried forward — which is also why the stored
    // token is not dropped on a failed refresh below: the pool's refusal is what ends the session, not this client's bookkeeping.
    const answer = await cognitoCall(deps, pool, 'POST /auth/refresh', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: pool.clientId,
      AuthParameters: { REFRESH_TOKEN: current.refreshToken },
    });
    if (!answer.ok) {
      clearSession(deps);
      return answer;
    }
    const result = answer.value['AuthenticationResult'];
    const shaped = typeof result === 'object' && result !== null
      ? sessionShapeOf(result as Record<string, unknown>, current.refreshToken)
      : null;
    if (!shaped) {
      clearSession(deps);
      return { ok: false, failure: { code: 'bad_response', message: 'the account provider did not answer with a session this app can use' } };
    }
    raw = shaped;
  } else {
    const answer = await apiCall<Record<string, unknown>>(deps, '/auth/refresh', { method: 'POST', body: { refreshToken: current.refreshToken } }, NO_IDENTITY);
    if (!answer.ok) {
      // THE SESSION IS OVER AND THE STORE MUST SAY SO. A refresh token the server refuses (expired, rotated away,
      // revoked) is not an outage to report: it is the end of a session, and leaving the dead token in storage
      // would have every later request answered `401` for a reason the player could not see.
      clearSession(deps);
      return answer;
    }
    raw = answer.value;
  }
  const session = sessionFromAuth(raw, nowMs);
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
  const pool = providerOf(deps);
  // THE POOL'S SIGN-OUT IS `GlobalSignOut`, which revokes every session of the account rather than the one refresh token — the
  // right semantics for "sign out" on a shared machine, and the reason the answer is a boolean and not a count.
  const answer = pool
    ? await cognitoCall(deps, pool, 'POST /auth/signout', { AccessToken: session.accessToken })
    : await apiCall<Record<string, unknown>>(deps, '/auth/signout', { method: 'POST', body: { refreshToken: session.refreshToken } }, NO_IDENTITY);
  clearSession(deps);
  return answer.ok ? { ok: true, value: { revoked: true } } : answer;
}

/** Who the app believes is signed in: the session if there is one, and nothing else. */
export function currentPlayer(deps: ApiDeps): SignedIn | null {
  const session = readSession(deps);
  return session ? { playerId: session.playerId, email: session.email } : null;
}
