// THE COGNITO PROVIDER: the six account operations, spoken to the AWS Cognito API directly.
//
// WHY THIS EXISTS. REPORTED: "account management must be compatible with the AWS Cognito API." Until this module the client
// had exactly one way to create an account or change a password: the local API's `/auth/*` routes, which only the emulator
// serves (`api/src/auth/emulator.ts`) — so an account made in this app was an account in a dev adapter, and a real
// deployment had no sign-up at all. The operations below are the provider's own, with its operation names, its field names
// and its error names, so a pool is something this build can be pointed at rather than something it would have to be
// rewritten for.
//
// THE CLIENT SPEAKS TO COGNITO DIRECTLY, AND THAT IS A DECISION WITH A REASON. Cognito's user-pool API is a public endpoint
// whose app client has a `ClientId` and NO SECRET (a browser cannot keep one), and the operations used here are the ones AWS
// allows from a browser — `SignUp`, `ConfirmSignUp`, `InitiateAuth`, `ChangePassword`, `GlobalSignOut`. The alternative is a
// server proxy, and it would put every player's password through our API for no gain: the token this app ultimately sends is
// verified by `api/src/auth/` with the pool's keys either way (DESIGN.md §11.2).
//
// WHAT IT DELIBERATELY DOES NOT DO: it does not verify anything. The ID token's payload is DECODED for `sub` and `email` —
// which is all the UI needs, and which is what the server's verifier will confirm when the token is used. Reading claims
// before verification is safe exactly because nothing here grants access: the access token is a bearer credential the API
// checks, and a forged one is refused there.
//
// THE ERROR NAMES ARE PART OF THE CONTRACT. Cognito answers a refusal with `{"__type":"NotAuthorizedException","message":…}`
// and a 400, and it distinguishes cases this app shows differently: an unconfirmed account, a code that is wrong, a password
// the pool's policy rejects, an address that already has an account. So the mapping below is by NAME, and the sentence the
// player reads is the provider's own wording.
import type { ApiResult } from './api.ts';

/** The user pool this build talks to. A region and a public app client, both from the build's environment. */
export interface CognitoConfig {
  readonly region: string;
  readonly clientId: string;
}

/**
 * The pool this build is pointed at, or null when it is not.
 *
 * `VITE_COGNITO_REGION` AND `VITE_COGNITO_CLIENT_ID` MUST BOTH BE SET, and a build missing one is a build with no provider
 * rather than a build with half of one: guessing a region from a client id is impossible, and guessing "us-east-1" is how a
 * sign-in reaches the wrong pool. The pair is read from the environment here and nowhere else, so a probe can hand its own.
 */
export function cognitoConfigFrom(env: Record<string, string | undefined>): CognitoConfig | null {
  const region = env['VITE_COGNITO_REGION'];
  const clientId = env['VITE_COGNITO_CLIENT_ID'];
  if (typeof region !== 'string' || region === '' || typeof clientId !== 'string' || clientId === '') return null;
  return { region, clientId };
}

/**
 * The account operations, named as this app's other providers name them.
 *
 * THE NAMES ARE THE APP'S AND NOT THE PROVIDER'S, so `net/standing.ts` can decide from one list which forms to offer and both
 * providers answer to the same words: `POST /auth/signup` is `SignUp` here and a route in the emulator. That is what keeps the
 * UI free of a provider branch.
 */
export const COGNITO_ROUTES: readonly string[] = [
  'POST /auth/signup',
  'POST /auth/confirm',
  'POST /auth/signin',
  'POST /auth/refresh',
  'POST /auth/signout',
  'POST /auth/password',
];

/** The provider operation a route name means. Throws on a name this build does not know, which is a programming error. */
const OPERATION: Readonly<Record<string, string>> = {
  'POST /auth/signup': 'SignUp',
  'POST /auth/confirm': 'ConfirmSignUp',
  'POST /auth/signin': 'InitiateAuth',
  'POST /auth/refresh': 'InitiateAuth',
  'POST /auth/signout': 'GlobalSignOut',
  'POST /auth/password': 'ChangePassword',
};

/** The type `__type` prefixes a refusal with; the name itself is the part this app keys on. */
function errorNameOf(raw: Record<string, unknown>): string {
  const type = typeof raw['__type'] === 'string' ? raw['__type'] : '';
  // Cognito sometimes answers `com.amazonaws.cognito.identityprovider.model.NotAuthorizedException` and sometimes the bare
  // name, so the last segment is the comparison the code has to make.
  return type.slice(type.lastIndexOf('#') + 1).split(':')[0].split('.').pop() ?? '';
}

/** Provider error names → the stable codes this app's failure type carries. One row per case the UI shows differently. */
const CODE_OF: Readonly<Record<string, string>> = {
  NotAuthorizedException: 'bad_credentials',
  UserNotFoundException: 'bad_credentials',
  UsernameExistsException: 'email_taken',
  AliasExistsException: 'email_taken',
  UserNotConfirmedException: 'unconfirmed',
  CodeMismatchException: 'bad_code',
  ExpiredCodeException: 'bad_code',
  InvalidPasswordException: 'bad_password',
  InvalidParameterException: 'bad_request',
  LimitExceededException: 'too_many_requests',
  TooManyRequestsException: 'too_many_requests',
};

/** A pool endpoint and a refusal, as this app's result type. */
function failureOf(raw: Record<string, unknown>, fallback: string): ApiResult<never> {
  const name = errorNameOf(raw);
  const message = typeof raw['message'] === 'string' ? raw['message'] : typeof raw['Message'] === 'string' ? raw['Message'] : '';
  return {
    ok: false,
    failure: { code: CODE_OF[name] ?? fallback, message: message === '' ? `the account provider refused the request (${name || 'no error name'})` : message },
  };
}

/** What a call needs from the outside world: a `fetch`, and how long to wait for it (both injected, as `api.ts` does). */
export interface CognitoDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
}

/** The JSON 1.1 content type the user-pool API speaks, and the header that selects the operation. */
const CONTENT_TYPE = 'application/x-amz-json-1.1';

/**
 * One call to the pool's endpoint, answering either the operation's document or this app's failure.
 *
 * NOTHING HERE RETRIES. A retried `InitiateAuth` spends a rate-limit quota that the pool counts per client, and a retried
 * `SignUp` on a lost answer creates a second account attempt against the same address — both are decisions for the caller,
 * and neither is one this module can make safely on its own.
 */
export async function cognitoCall(
  deps: CognitoDeps,
  config: CognitoConfig,
  route: string,
  body: Record<string, unknown>,
): Promise<ApiResult<Record<string, unknown>>> {
  const operation = OPERATION[route];
  if (!operation) throw new Error(`no Cognito operation for ${route}`);
  let response: Response;
  try {
    response = await deps.fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE, 'x-amz-target': `AWSCognitoIdentityProviderService.${operation}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch (error) {
    // A NETWORK FAILURE IS A TYPEERROR IN THE BROWSER AND AN ABORT IS A DIFFERENT ONE AGAIN, and both mean the same thing to a
    // player: the provider could not be reached. The `api.ts` transport reports it the same way, which is why the two look
    // alike in the UI.
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return {
      ok: false,
      failure: {
        code: timedOut ? 'timeout' : 'unreachable',
        message: timedOut ? 'the account provider did not answer in time' : 'the account provider could not be reached',
      },
    };
  }
  let document: unknown = null;
  try {
    document = await response.json();
  } catch {
    /* an empty body is legal for GlobalSignOut and ConfirmSignUp */
  }
  const raw = typeof document === 'object' && document !== null ? (document as Record<string, unknown>) : {};
  if (!response.ok) return failureOf(raw, 'provider_refused');
  return { ok: true, value: raw };
}

/**
 * The `sub` and `email` out of an ID token — DECODED, NOT VERIFIED (see the header: nothing here grants access).
 *
 * It is base64url JSON with the padding stripped, which is why the padding is put back before decoding: `atob` refuses a
 * length that is not a multiple of four, and a token whose payload happened to be that length would otherwise "fail to parse"
 * for a reason that has nothing to do with the token.
 */
export function claimsOf(idToken: string): { sub: string; email: string } | null {
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts[1] === '') return null;
  const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
  let payload: unknown;
  try {
    payload = JSON.parse(atob(padded));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const claims = payload as Record<string, unknown>;
  const sub = typeof claims['sub'] === 'string' ? claims['sub'] : '';
  const email = typeof claims['email'] === 'string' ? claims['email'] : '';
  if (sub === '') return null;
  return { sub, email };
}

/**
 * `AuthenticationResult` as the shape `session.ts` already understands.
 *
 * THE RENAMES ARE THE WHOLE OF IT: Cognito's `AccessToken`/`RefreshToken`/`ExpiresIn` become the lowercase fields the session
 * store has always read, and the player's identity comes from the ID token's claims. A REFRESH ANSWERS WITHOUT A NEW REFRESH
 * TOKEN (Cognito keeps the original), so the caller passes the one it holds through `refreshToken`.
 */
export function sessionShapeOf(
  result: Record<string, unknown>,
  refreshToken: string,
): Record<string, unknown> | null {
  const accessToken = result['AccessToken'];
  const idToken = result['IdToken'];
  const expiresIn = result['ExpiresIn'];
  if (typeof accessToken !== 'string' || typeof idToken !== 'string') return null;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  const claims = claimsOf(idToken);
  if (!claims) return null;
  return { accessToken, refreshToken, playerId: claims.sub, email: claims.email, expiresInSeconds: expiresIn };
}
