// JWT verification: the ONE place a token becomes a player id, and it is the same code in every mode.
//
// WHY THIS IS ONE MODULE WITH TWO KEY SOURCES. The emulator (a local development adapter, `emulator.ts`) and the
// deployment differ in WHERE the keys come from — a secret this process generated, or the Cognito pool's JWKS — and
// in nothing else. Sharing the verification means a local sign-in exercises the checks the deployment makes:
// signature, `alg`, expiry, issuer and audience. MEASURED, and it is how `auth-probe.mjs` can claim the emulator
// proves anything: the token it issues is checked by this function, not by a second, weaker one.
//
// NO DEPENDENCY. `node:crypto` verifies HMAC (`createHmac`) and RSA (`verify` with a key built from a JWK, which
// Node has supported natively since v15), and a JWT is base64url plus a signature — so the whole thing is ~90
// lines rather than a library, and AGENTS.md §4.5's "no new dependency without a reason" stays untouched.
//
// EVERY FAILURE IS `null`, NOT AN EXCEPTION. A malformed token, an expired one, a wrong audience and a forged
// signature are all "this caller is not that player", which is a state the API answers with 401 — not a bug that
// should surface as a 500. The reason is deliberately NOT returned to the caller: it is an oracle for an attacker
// and a support question for everyone else, so the handler reports `unauthenticated` and the reason goes nowhere.
import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature, type JsonWebKey } from 'node:crypto';

/** What a verified token says about the caller. Only `sub` is used as an identity. */
export interface JwtClaims {
  readonly sub: string;
  readonly email: string | null;
  readonly expiresAtSeconds: number;
  readonly issuer: string;
}

/** A source of the verification key for one token, or null when it cannot offer one. */
type KeySource = (header: { alg: string; kid?: string }) => ReturnType<typeof createPublicKey> | Buffer | null;

interface VerifyOptions {
  readonly issuer: string;
  /** The expected audience. Cognito puts `aud` on an ID token and `client_id` on an ACCESS token, so both are read. */
  readonly audience: string;
  readonly keys: KeySource;
  readonly nowMs: () => number;
  /** Clock slack for `exp`, in seconds. Small: a token is either current or it is not. */
  readonly skewSeconds?: number;
}

/** base64url → bytes, with the padding Node's decoder wants restored. */
function decodeBase64Url(text: string): Buffer {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

/** The two JSON segments of a token, or null when it is not shaped like one. */
function segments(token: string): { header: Record<string, unknown>; claims: Record<string, unknown>; signed: string; signature: Buffer } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(decodeBase64Url(parts[0]).toString('utf8')) as Record<string, unknown>;
    const claims = JSON.parse(decodeBase64Url(parts[1]).toString('utf8')) as Record<string, unknown>;
    return { header, claims, signed: `${parts[0]}.${parts[1]}`, signature: decodeBase64Url(parts[2]) };
  } catch {
    return null;
  }
}

/**
 * The HMAC of a token's `header.payload`, which is both what a signature IS and what the emulator signs with.
 *
 * IT IS EXPORTED SO SIGNING AND VERIFICATION CANNOT DRIFT: the emulator's `mint` calls this and `signatureIsValid`
 * calls it, so "the token it issues is the token this verifier accepts" is one function rather than two
 * implementations of the same three lines that agree until one of them is edited.
 */
export function hmacSignature(secret: Buffer, signed: string): Buffer {
  return createHmac('sha256', secret).update(signed).digest();
}

/** The signature check for one algorithm. Anything else is refused rather than guessed at. */
function signatureIsValid(alg: string, signed: string, signature: Buffer, key: Buffer | ReturnType<typeof createPublicKey>): boolean {
  if (alg === 'HS256') {
    if (!Buffer.isBuffer(key)) return false;
    const expected = hmacSignature(key, signed);
    // TIMING-SAFE, because a byte-by-byte comparison of a MAC leaks how much of a forgery was right.
    return expected.length === signature.length && timingSafeEqual(expected, signature);
  }
  if (alg === 'RS256') {
    if (Buffer.isBuffer(key)) return false;
    return verifySignature('RSA-SHA256', Buffer.from(signed, 'utf8'), key, signature);
  }
  return false;
}

/**
 * Verify a token and return what it claims, or null.
 *
 * THE ORDER IS THE CONVENTION: signature first (so an unverified token never reaches the claim checks), then the
 * algorithm, then `exp`, then `iss`, then the audience. `alg: 'none'` is not a case here — it falls through the
 * algorithm check and is refused, which is the only safe reading of an unsecured JWT.
 */
export function verifyToken(token: string, options: VerifyOptions): JwtClaims | null {
  const parsed = segments(token);
  if (!parsed) return null;
  const alg = typeof parsed.header['alg'] === 'string' ? parsed.header['alg'] : '';
  const kid = typeof parsed.header['kid'] === 'string' ? parsed.header['kid'] : undefined;
  const key = options.keys({ alg, ...(kid === undefined ? {} : { kid }) });
  if (!key) return null;
  if (!signatureIsValid(alg, parsed.signed, parsed.signature, key)) return null;

  const { claims } = parsed;
  const expires = claims['exp'];
  if (typeof expires !== 'number' || expires + (options.skewSeconds ?? 0) <= options.nowMs() / 1000) return null;
  if (claims['iss'] !== options.issuer) return null;
  // COGNITO'S TWO SPELLINGS, both accepted: an ID token carries `aud`, an ACCESS token carries `client_id`.
  const audience = claims['aud'] ?? claims['client_id'];
  if (audience !== options.audience) return null;

  const sub = claims['sub'];
  if (typeof sub !== 'string' || sub.length === 0) return null;
  return {
    sub,
    email: typeof claims['email'] === 'string' ? claims['email'] : null,
    expiresAtSeconds: expires,
    issuer: options.issuer,
  };
}

/** A key source for a single HMAC secret — what the emulator signs with. */
export function hmacKeys(secret: Buffer): KeySource {
  return ({ alg }) => (alg === 'HS256' ? secret : null);
}

/**
 * A key source for a JWKS document, by `kid` (or the only key when the token names none).
 *
 * IT TAKES THE DOCUMENT RATHER THAN FETCHING IT, so this module stays free of I/O and a probe can verify a
 * signature against a key it generated. The deployment fetches Cognito's JWKS and hands the parsed document here
 * (and caches it) — that is the adapter's job, not the verifier's.
 */
export function jwksKeys(jwks: { keys?: readonly JsonWebKey[] }): KeySource {
  return ({ alg, kid }) => {
    if (alg !== 'RS256') return null;
    const keys = jwks.keys ?? [];
    const chosen = kid ? keys.find((key) => (key as { kid?: string }).kid === kid) : keys[0];
    if (!chosen) return null;
    try {
      return createPublicKey({ key: chosen, format: 'jwk' });
    } catch {
      // A key this runtime cannot read is a configuration finding, not a caller's fault — but it is still "no
      // key for this token", and a forged token must never be the thing that surfaces it.
      return null;
    }
  };
}
