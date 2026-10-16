// The local sign-in emulator: real accounts, real JWTs, no provider.
//
// WHY THIS EXISTS AT ALL, and it is the requirement rather than a convenience: local development must not need
// Cognito, AND the sign-in feature must still be testable. Those pull in opposite directions — the mode that
// needs no provider is the mode that verifies nothing — so this file is the resolution: it SIGNS with the same
// verifier (`verify.ts`) and the same algorithms the deployment uses, over accounts in the same item table. A
// probe that signs up, confirms, signs in, refreshes and signs out therefore exercises the checks a real token
// meets: signature, `alg`, expiry, issuer, audience. What it does NOT exercise is Cognito itself (key rotation,
// pool configuration, the hosted UI), which is why §11.2 calls it an emulator and not a test double.
//
// IT IS A DEV ADAPTER, NOT A SECOND AUTH SYSTEM. It is constructed only in `DSQ_AUTH=emulate`, its five routes
// are unrouted in every other mode, and it is not imported by the deployment at all — so "which endpoints can
// create an account" is answerable by reading the one file that is not on the production path.
//
// WHAT IT DELIBERATELY IS NOT: it has no email sending (the confirmation code is printed and, locally, returned
// so the shortest path is two calls), no password reset, no rate limiting, no session list, and no attempt to
// resist an attacker who can already write to the store — a local emulator is not a security boundary, and
// claiming otherwise would make its refusals look like protection. It does hash passwords with `scrypt` and it
// does compare in constant time, because doing those cheaply is not extra work and their absence is the kind of
// habit that survives into a system that IS a boundary.
import { randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Clock, type ItemStore } from '../ports.ts';
import { accountKey } from '../keys.ts';
import { failure, STATUS } from '../status.ts';
import { hmacSignature, hmacKeys, verifyToken, type JwtClaims } from './verify.ts';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** The issuer and audience the emulator signs with. Distinct from Cognito's, so a token says where it came from. */
export const EMULATOR_ISSUER = 'dsq-emulator';
export const EMULATOR_AUDIENCE = 'dsq-game';

/** One hour. Short enough that expiry is observable in a probe, long enough to play a Daily. */
const ACCESS_TOKEN_SECONDS = 3600;

/** Thirty days, which is a session rather than an authorisation. */
const REFRESH_TOKEN_DAYS = 30;

/** How many live refresh-token ids one account keeps. The oldest is dropped, so the item stays bounded. */
const MAX_REFRESH_TOKENS = 5;

/** The scrypt output length. The parameters are the defaults (N=16384, r=8, p=1): 16 MB and ~50 ms per sign-in. */
const SCRYPT_KEY_BYTES = 32;

/** The salt an unknown email is hashed against, so a sign-in costs the same whether or not the account exists. */
const ABSENT_SALT = Buffer.alloc(16);

/** A password rule, stated once. Deliberately a length rule: composition rules are theatre. */
const MIN_PASSWORD_LENGTH = 8;

/** One email rule, deliberately loose: something, an `@`, something, a dot, something, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A stored account, as this module writes it. */
interface Account {
  readonly playerId: string;
  readonly email: string;
  readonly salt: string;
  readonly hash: string;
  readonly confirmed: boolean;
  readonly confirmCode: string | null;
  readonly createdAtMs: number;
  readonly refreshTokens: readonly { readonly id: string; readonly issuedAtMs: number }[];
}

export interface Emulator {
  /** The routes this adapter serves, so `/health` can name them while `ROUTES` stays the API's own table. */
  readonly routes: readonly string[];
  /** The route's answer, or null when the path is not one of the emulator's. */
  handle(request: ApiRequest): Promise<ApiResult | null>;
  /** The verifier, so the dev server builds ONE identity adapter from the same secret that signs. */
  verify(token: string): JwtClaims | null;
}

function asAccount(stored: { readonly value: Readonly<Record<string, unknown>> } | null): Account | null {
  if (!stored) return null;
  const value = stored.value as Partial<Account> & { refreshTokens?: unknown };
  if (typeof value.playerId !== 'string' || typeof value.email !== 'string' || typeof value.salt !== 'string'
    || typeof value.hash !== 'string' || typeof value.confirmed !== 'boolean' || typeof value.createdAtMs !== 'number') return null;
  const tokens = Array.isArray(value.refreshTokens) ? value.refreshTokens : [];
  const refreshTokens: { id: string; issuedAtMs: number }[] = [];
  for (const raw of tokens) {
    const token = raw as { id?: unknown; issuedAtMs?: unknown };
    if (typeof token.id !== 'string' || typeof token.issuedAtMs !== 'number') return null;
    refreshTokens.push({ id: token.id, issuedAtMs: token.issuedAtMs });
  }
  return {
    playerId: value.playerId,
    email: value.email,
    salt: value.salt,
    hash: value.hash,
    confirmed: value.confirmed,
    confirmCode: typeof value.confirmCode === 'string' ? value.confirmCode : null,
    createdAtMs: value.createdAtMs,
    refreshTokens,
  };
}

/** The stored form, field by field, so an extra property cannot ride along into the table. */
function asItem(account: Account): Record<string, unknown> {
  return {
    playerId: account.playerId,
    email: account.email,
    salt: account.salt,
    hash: account.hash,
    confirmed: account.confirmed,
    confirmCode: account.confirmCode,
    createdAtMs: account.createdAtMs,
    refreshTokens: account.refreshTokens,
  };
}

const b64 = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

/** A constant-time string comparison, for the two secrets this module compares: the password hash and the code. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The base64url email in a refresh token, or null when the token is not shaped like one. */
function refreshParts(token: unknown): { email: string; id: string } | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { email: Buffer.from(parts[0], 'base64url').toString('utf8'), id: parts[1] };
}

/**
 * A string field from a JSON body, trimmed, or null.
 *
 * BODIES ARRIVE AS `unknown` AND ARE NEVER TRUSTED, and everything is trimmed — including the password, at both
 * ends of the flow, so a password that picks up a space from a copy-paste still signs in the second time exactly
 * as it did the first. The trim is not a validation rule; it is the same normalisation applied twice.
 */
function text(body: unknown, field: string): string | null {
  const value = (body as Record<string, unknown> | null)?.[field];
  return typeof value === 'string' ? value.trim() : null;
}

export interface EmulatorOptions {
  readonly store: ItemStore;
  readonly clock: Clock;
  /** The HMAC secret. A per-process secret is fine: a token that does not survive a restart is a session. */
  readonly secret: Buffer;
  /** Whether signup requires a confirmation code. False (the default) confirms immediately — one call, not two. */
  readonly requireConfirmation: boolean;
  /** Where the confirmation code is announced, because there is no mail sender. Injected so a probe can read it. */
  readonly announce?: (message: string) => void;
}

export function createEmulator(options: EmulatorOptions): Emulator {
  const { store, clock, secret } = options;
  const nowMs = (): number => clock.nowMs();
  const announce = options.announce ?? ((message: string) => console.log(message));

  /** A signed access token for an account. The header is the emulator's, and the HMAC is the shared one. */
  const mint = (account: Account): { accessToken: string; expiresInSeconds: number } => {
    const issuedAtSeconds = Math.floor(nowMs() / 1000);
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64(JSON.stringify({
      sub: account.playerId,
      email: account.email,
      iss: EMULATOR_ISSUER,
      aud: EMULATOR_AUDIENCE,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + ACCESS_TOKEN_SECONDS,
    }));
    return {
      accessToken: `${header}.${payload}.${b64(hmacSignature(secret, `${header}.${payload}`))}`,
      expiresInSeconds: ACCESS_TOKEN_SECONDS,
    };
  };

  /**
   * Add a refresh token to an account and return the pair.
   *
   * THE TOKEN IS `<base64url email>.<random id>`, and the id is the secret: the email is the lookup, so a refresh
   * needs no second key shape and no lookup by value (which this store has no operation for). The email in the
   * token is not a disclosure — the caller typed it to sign in, and the access token's payload carries it anyway.
   * The id is compared in constant time and rotated on every use, so a stolen token works at most once.
   */
  const issueRefresh = (account: Account): { account: Account; refreshToken: string } => {
    const id = randomBytes(24).toString('base64url');
    const kept = [...account.refreshTokens, { id, issuedAtMs: nowMs() }]
      .filter((token) => nowMs() - token.issuedAtMs < REFRESH_TOKEN_DAYS * 86_400_000)
      .slice(-MAX_REFRESH_TOKENS);
    return { account: { ...account, refreshTokens: kept }, refreshToken: `${b64(account.email)}.${id}` };
  };

  /**
   * Read, change, write — with the same compare-and-set loop the handlers use, for the same reason: two requests
   * for one account (a double-clicked button, two tabs) both hold the refresh-token list, and one of them must
   * lose rather than overwrite the other's freshly issued token.
   *
   * `change` RETURNS THE ANSWER AS WELL AS THE ROW, because the two callers that write without issuing a token
   * (confirm, signout) report what they did, and a generic `{ ok: true }` would make signout indistinguishable
   * from a no-op.
   */
  const mutate = async (
    email: string,
    change: (account: Account) => { account: Account; body: unknown } | ApiResult,
  ): Promise<ApiResult> => {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const stored = await store.get(accountKey(email));
      const account = asAccount(stored);
      if (!account) return failure(STATUS.notFound, 'no_account', `no account exists for ${email}`);
      const next = change(account);
      if ('status' in next) return next;
      if (await store.put(accountKey(email), asItem(next.account), stored?.rev ?? null)) {
        return { status: STATUS.ok, body: next.body };
      }
    }
    return failure(STATUS.conflict, 'contended', 'another request is writing this account; try again');
  };

  const signup = async (request: ApiRequest): Promise<ApiResult> => {
    const rawEmail = text(request.body, 'email');
    const password = text(request.body, 'password');
    if (!rawEmail || !EMAIL_PATTERN.test(rawEmail) || rawEmail.length > 254) {
      return failure(STATUS.badRequest, 'bad_email', 'email must be a single address, as user@example.com');
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return failure(STATUS.badRequest, 'bad_password', `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const email = rawEmail.toLowerCase();
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, SCRYPT_KEY_BYTES);
    const account: Account = {
      // THE PREFIX IS THE NAMESPACE: a Cognito `sub` is a bare uuid, so an emulator account can never be mistaken
      // for one, and a stored row's key says which provider wrote it.
      playerId: `emu:${randomUUID()}`,
      email,
      salt: salt.toString('base64'),
      hash: hash.toString('base64'),
      confirmed: !options.requireConfirmation,
      confirmCode: options.requireConfirmation ? String(randomInt(100_000, 1_000_000)) : null,
      createdAtMs: nowMs(),
      refreshTokens: [],
    };
    if (!(await store.put(accountKey(email), asItem(account), null))) {
      // ALREADY SIGNED UP IS 409, AND IT IS SAID BEFORE THE PASSWORD IS LOOKED AT. An unconfirmed account is the
      // one exception: returning its code again is how a developer who lost the console line continues, and it
      // reveals nothing that a second signup with the same address would not ("this address is registered").
      const existing = asAccount(await store.get(accountKey(email)));
      if (existing && !existing.confirmed && existing.confirmCode) {
        announce(`dev:api emulator: ${email} is already signed up and unconfirmed; the code is ${existing.confirmCode}`);
        return { status: STATUS.ok, body: { ok: true, email, playerId: existing.playerId, confirmed: false, confirmCode: existing.confirmCode } };
      }
      return failure(STATUS.conflict, 'email_taken', `${email} already has an account`);
    }
    if (account.confirmCode) announce(`dev:api emulator: confirmation code for ${email} is ${account.confirmCode}`);
    return {
      status: STATUS.ok,
      body: {
        ok: true,
        email,
        playerId: account.playerId,
        confirmed: account.confirmed,
        // RETURNED AS WELL AS PRINTED, because there is no mail sender: the code is not a secret from the person
        // who just chose the password, and a caller who has to parse a console line to test sign-in will not.
        confirmCode: account.confirmCode,
      },
    };
  };

  const confirm = async (request: ApiRequest): Promise<ApiResult> => {
    const email = text(request.body, 'email')?.toLowerCase();
    const code = text(request.body, 'code');
    if (!email || !code) return failure(STATUS.badRequest, 'bad_request', 'email and code are required');
    return mutate(email, (account) => {
      if (account.confirmed) return { account, body: { ok: true, confirmed: true } };
      if (!account.confirmCode || !sameSecret(account.confirmCode, code)) {
        return failure(STATUS.unauthenticated, 'bad_code', 'that confirmation code is not right');
      }
      return { account: { ...account, confirmed: true, confirmCode: null }, body: { ok: true, confirmed: true } };
    });
  };

  const signin = async (request: ApiRequest): Promise<ApiResult> => {
    const email = text(request.body, 'email')?.toLowerCase();
    const password = text(request.body, 'password') ?? '';
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const stored = email ? await store.get(accountKey(email)) : null;
      const account = asAccount(stored);
      // ONE ANSWER FOR AN UNKNOWN EMAIL AND A WRONG PASSWORD, AND THE SAME WORK FOR BOTH: the hash is computed
      // against a dummy salt when there is no account, because differing work — let alone a differing message —
      // turns this endpoint into a way to find out which addresses are registered.
      const hash = (await scrypt(password, account ? Buffer.from(account.salt, 'base64') : ABSENT_SALT, SCRYPT_KEY_BYTES)).toString('base64');
      if (!account || !sameSecret(account.hash, hash)) {
        return failure(STATUS.unauthenticated, 'bad_credentials', 'email or password is wrong');
      }
      if (!account.confirmed) return failure(STATUS.forbidden, 'unconfirmed', 'this account has not been confirmed yet');
      const issued = issueRefresh(account);
      if (await store.put(accountKey(account.email), asItem(issued.account), stored?.rev ?? null)) {
        return {
          status: STATUS.ok,
          body: { ...mint(account), refreshToken: issued.refreshToken, playerId: account.playerId, email: account.email },
        };
      }
    }
    return failure(STATUS.conflict, 'contended', 'another request is writing this account; try again');
  };

  const refresh = async (request: ApiRequest): Promise<ApiResult> => {
    const parts = refreshParts(text(request.body, 'refreshToken'));
    if (!parts) return failure(STATUS.unauthenticated, 'bad_refresh_token', 'that refresh token is not one this server issued');
    const email = parts.email.toLowerCase();
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const stored = await store.get(accountKey(email));
      const account = asAccount(stored);
      // ROTATION: the presented id is removed as a new one is added, so a stolen refresh token is good once and
      // its use invalidates the thief's next attempt. It is the cheapest session-revocation story there is.
      if (!account) return failure(STATUS.unauthenticated, 'bad_refresh_token', 'that refresh token is not one this server issued');
      if (!account.refreshTokens.some((token) => sameSecret(token.id, parts.id))) {
        return failure(STATUS.unauthenticated, 'bad_refresh_token', 'that refresh token is no longer live');
      }
      const issued = issueRefresh({ ...account, refreshTokens: account.refreshTokens.filter((token) => !sameSecret(token.id, parts.id)) });
      if (await store.put(accountKey(account.email), asItem(issued.account), stored?.rev ?? null)) {
        return {
          status: STATUS.ok,
          body: { ...mint(issued.account), refreshToken: issued.refreshToken, playerId: account.playerId, email: account.email },
        };
      }
    }
    return failure(STATUS.conflict, 'contended', 'another request is writing this account; try again');
  };

  const signout = async (request: ApiRequest): Promise<ApiResult> => {
    const parts = refreshParts(text(request.body, 'refreshToken'));
    if (!parts) return { status: STATUS.ok, body: { ok: true, revoked: false } };
    const email = parts.email.toLowerCase();
    const account = asAccount(await store.get(accountKey(email)));
    if (!account || !account.refreshTokens.some((token) => sameSecret(token.id, parts.id))) {
      // IDEMPOTENT ON PURPOSE: signing out twice, or with a token already rotated away, is not an error — the
      // client's intent is "this session must stop working", and it does.
      return { status: STATUS.ok, body: { ok: true, revoked: false } };
    }
    return mutate(email, (current) => ({
      account: { ...current, refreshTokens: current.refreshTokens.filter((token) => !sameSecret(token.id, parts.id)) },
      body: { ok: true, revoked: true },
    }));
  };

  const handlers: readonly { method: string; path: string; handler: (request: ApiRequest) => Promise<ApiResult> }[] = [
    { method: 'POST', path: '/auth/signup', handler: signup },
    { method: 'POST', path: '/auth/confirm', handler: confirm },
    { method: 'POST', path: '/auth/signin', handler: signin },
    { method: 'POST', path: '/auth/refresh', handler: refresh },
    { method: 'POST', path: '/auth/signout', handler: signout },
  ];

  return {
    routes: handlers.map((route) => `${route.method} ${route.path}`),
    handle: async (request) => {
      const path = request.path.length > 1 && request.path.endsWith('/') ? request.path.slice(0, -1) : request.path;
      const route = handlers.find((candidate) => candidate.method === request.method.toUpperCase() && candidate.path === path);
      return route ? route.handler(request) : null;
    },
    verify: (token) => verifyToken(token, {
      issuer: EMULATOR_ISSUER,
      audience: EMULATOR_AUDIENCE,
      keys: hmacKeys(secret),
      nowMs,
    }),
  };
}
