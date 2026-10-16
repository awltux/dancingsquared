// The player's session, as the browser keeps it: ONE JSON item, and the one place its shape is written down.
//
// WHY ONE KEY AND NOT THREE. An access token, a refresh token and the player's id have to agree with each other:
// a torn write that updated the token but not the player would credit one player's run to another, and three keys
// are three chances to be half-written. One item means a session is either present and complete or absent.
//
// IT IS NOT A SECRET AND NOT AN ACCOUNT. `localStorage` is readable by any script on this origin, which is exactly
// why the ACCESS token is short-lived and the refresh token is the thing worth stealing — and why it rotates on
// every use (DESIGN.md §11.2). The boundary against an attacker who can run script on this page is XSS, not
// storage, and this module does not pretend otherwise.
//
// IT OWNS NO NETWORK AND NO UI, which is what makes it probe-loadable: `auth.ts` decides when a session is
// written and `api.ts` reads the token out of it, so both agree about the shape by importing it rather than by
// spelling the key twice.

/** A signed-in session: what the auth endpoints answer with, plus the moment the access token stops working. */
export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly playerId: string;
  readonly email: string;
  /**
   * When to STOP USING the access token — the server's expiry with a skew already subtracted, so a request is not
   * sent with a token that expires in flight and answered `401` for a reason the player cannot act on.
   */
  readonly expiresAtMs: number;
}

/** The slice of `localStorage` this needs, so a probe can hand it a `Map`. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The one key. Namespaced like the saved game (`dsq.game.save`) and the device id. */
export const SESSION_KEY = 'dsq.game.session';

/**
 * How early an access token is treated as dead, in milliseconds.
 *
 * A MINUTE, MEASURED AGAINST WHAT THE SERVER WILL ACCEPT RATHER THAN AGAINST A CLOCK: the emulator's tokens live
 * an hour and the game's own request timeout is 8 s (`api.ts`), so a minute is far more than a request can take
 * and far less than a session. The alternative — using the token until it fails — turns an expiry into a
 * refused submission, and a refused submission is the one failure this app must not invent.
 */
export const SESSION_SKEW_MS = 60_000;

/** The session as stored, or null when there is none or it is not one this build can read. */
export function readSession(store: SessionStore): Session | null {
  const raw = store.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return asSession(JSON.parse(raw));
  } catch {
    // A SESSION THAT CANNOT BE PARSED IS NOT A SESSION. The alternative is guessing at a half-written value and
    // sending whatever came out of it as an identity, which is worse than asking the player to sign in again.
    return null;
  }
}

/** Write a session. The whole item is replaced, so a stale refresh token cannot survive a new sign-in. */
export function writeSession(store: SessionStore, session: Session): void {
  store.setItem(SESSION_KEY, JSON.stringify(session));
}

/** Forget the session. Idempotent: clearing what is not there is the state the caller wanted. */
export function clearSession(store: SessionStore): void {
  store.removeItem(SESSION_KEY);
}

/**
 * The access token, for the one caller that only needs that: `api.ts`'s identity headers.
 *
 * IT DOES NOT CHECK `expiresAtMs`, DELIBERATELY. Sending a token that has just expired gets a `401` the server
 * can explain; deciding here that the session is over would silently turn a signed-in player into an anonymous
 * one, and their run would be recorded against a device instead of an account. `auth.ts` refreshes on a timer of
 * its own (`refreshIfExpired`), and this is the reader.
 */
export function accessTokenOf(store: SessionStore): string | null {
  return readSession(store)?.accessToken ?? null;
}

/** Every field of a session, checked: a shape that half-parsed would send half an identity. */
export function asSession(raw: unknown): Session | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.accessToken !== 'string' || value.accessToken === '') return null;
  if (typeof value.refreshToken !== 'string' || value.refreshToken === '') return null;
  if (typeof value.playerId !== 'string' || value.playerId === '') return null;
  if (typeof value.email !== 'string') return null;
  if (typeof value.expiresAtMs !== 'number' || !Number.isFinite(value.expiresAtMs)) return null;
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    playerId: value.playerId,
    email: value.email,
    expiresAtMs: value.expiresAtMs,
  };
}

/**
 * A sign-in or refresh answer, as a session, or null when the answer is not one.
 *
 * `nowMs` IS AN ARGUMENT because this module has no clock of its own (AGENTS.md §4.3): the caller passes the time
 * it acted at, so a probe can pin the arithmetic instead of reading the machine's clock twice.
 */
export function sessionFromAuth(raw: unknown, nowMs: number): Session | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const expiresInSeconds = value.expiresInSeconds;
  if (typeof expiresInSeconds !== 'number' || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) return null;
  return asSession({
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    playerId: value.playerId,
    email: typeof value.email === 'string' ? value.email : '',
    expiresAtMs: nowMs + expiresInSeconds * 1000 - SESSION_SKEW_MS,
  });
}
