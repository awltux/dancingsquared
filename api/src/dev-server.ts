// The local dev server: the same handlers, over `node:http`, with a store and an identity mode from configuration.
//
// IT IS AN ADAPTER AND NOTHING ELSE. It parses an HTTP exchange into an `ApiRequest`, calls the route's
// handler, and serialises the `ApiResult` — every rule lives in `handlers/`, `drill-regime.ts` and `auth/`, all
// of which are driven by probes that never open a socket. What this file owns is WHICH IDENTITY MACHINERY THE
// PROCESS BUILT (DESIGN.md 11.2): `dev` trusts `x-dev-player`, `emulate` signs and verifies real JWTs against
// local accounts, and `cognito` verifies a token against the pool's keys. The mode is chosen once, at boot, and
// printed, because the difference between them is the difference between "a header names the player" and "a
// signature does".
//
// WHY NOT A FRAMEWORK. Six routes, one JSON body shape, no cookies, no sessions, no static files: the node
// http module is the whole dependency list, and a framework would add a routing DSL to read in order to learn
// the same table that `routes.ts` already states.
//
// Run:   npm run dev:api          (in-memory store, port 8090)
//        npm run dev:api:ddb      (DynamoDB Local, after `npm run api:table`)
//        DSQ_AUTH=emulate npm run dev:api
import http from 'node:http';
import { randomBytes, type JsonWebKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { utcDay } from 'dancing-squared-game';
import { authRefusal, configFromEnv, devServerRefusal, type AuthMode, type Config } from './config.ts';
import { publishDay } from './daily-publishing.ts';
import { SERVED_LEVELS } from './schedule-publishing.ts';
import { MemoryStore } from './store/memory.ts';
import { openStore, type OpenedStore } from './store/open.ts';
import { PLANNED_ENDPOINTS, ROUTES, routeFor } from './routes.ts';
import { seedLocalRegimes } from './local-regime.ts';
import { createEmulator, type Emulator } from './auth/emulator.ts';
import { devIdentityOf, tokenIdentityOf } from './auth/identity.ts';
import { jwksKeys, verifyToken, type JwtClaims } from './auth/verify.ts';
import type { ApiRequest, ApiResult, Deps, IdentityOf, ItemStore } from './ports.ts';

/** A JSON body larger than this is refused rather than buffered: nothing this API takes is bigger than a move list. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The identity machinery for one mode: the adapter the handlers see, and the emulator's routes when there are any.
 *
 * THE MODE IS THE ONLY THING THAT DECIDES WHETHER A HEADER CAN NAME A PLAYER, so the choice is made here, once,
 * rather than inside a function that branches per request. `emulate` and `cognito` both build `tokenIdentityOf`,
 * which has no expression that reads `x-dev-player` (`auth/identity.ts`) — so "a header is not an identity" is a
 * property of the code that runs, not of a check that has to remember to run.
 *
 * A PER-PROCESS SECRET IS THE DEFAULT IN `emulate`, AND THAT IS THE HONEST BEHAVIOUR: restarting the dev server
 * invalidates the tokens it issued, which is what a session that lives in one process should do. `DSQ_AUTH_SECRET`
 * pins it when a token must outlive the process — a `curl` in another shell, or a browser still holding one after
 * a restart.
 */
function identityFor(options: {
  readonly auth: AuthMode;
  readonly authSecret: string | null;
  readonly requireConfirmation: boolean;
  readonly cognitoVerify?: (token: string) => JwtClaims | null;
  readonly announce?: (message: string) => void;
  readonly store: ItemStore;
  readonly clock: { nowMs(): number };
}): { identityOf: IdentityOf; emulator: Emulator | null; note: string } {
  if (options.auth === 'dev') {
    return { identityOf: devIdentityOf, emulator: null, note: 'x-dev-player: <name> (or Authorization: Bearer dev:<name>) — NOT for production' };
  }
  if (options.auth === 'emulate') {
    const secret = options.authSecret ? Buffer.from(options.authSecret, 'hex') : randomBytes(32);
    const emulator = createEmulator({
      store: options.store,
      clock: options.clock,
      secret,
      requireConfirmation: options.requireConfirmation,
      ...(options.announce ? { announce: options.announce } : {}),
    });
    const source = options.authSecret ? 'DSQ_AUTH_SECRET' : 'a secret minted for this process (tokens die with it)';
    return {
      identityOf: tokenIdentityOf({ source: 'emulator', verify: emulator.verify }),
      emulator,
      note: `emulator sign-in at ${emulator.routes.join(', ')}; signing with ${source}`,
    };
  }
  if (!options.cognitoVerify) throw new Error('cognito mode needs a verifier — startFromEnv refuses without DSQ_COGNITO_JWKS_FILE');
  return { identityOf: tokenIdentityOf({ source: 'cognito', verify: options.cognitoVerify }), emulator: null, note: 'a Cognito token, verified against the configured JWKS' };
}

/** Everything the handlers need, with the identity mode's choice of adapter already made. */
export function depsFor(store: ItemStore, identityOf: IdentityOf, clock: { nowMs(): number } = { nowMs: () => Date.now() }): Deps {
  return { store, clock, identityOf };
}

async function readBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error(`the request body is larger than ${MAX_BODY_BYTES} bytes`);
    chunks.push(buffer);
  }
  if (size === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * THE CORS HEADERS A BROWSER NEEDS, and they are the DEV SERVER'S business rather than a handler's.
 *
 * MEASURED, and it is how this was found: with the game on `:8089` and this server on `:8090`, the page's fetch
 * failed with a `TypeError` and the app showed "the server could not be reached" — a cross-origin request with no
 * `Access-Control-Allow-Origin`. The requests also carry a JSON content type, so the browser sends a PREFLIGHT
 * and an unhandled `OPTIONS` refuses the real request before it is made.
 *
 * THE ALLOWED HEADERS DEPEND ON THE IDENTITY MODE, which is why this is a function and not a constant: `dev` lets
 * the browser send `x-dev-player`, and a token mode does not — advertising a header that no longer means anything
 * is how a client keeps sending it.
 *
 * A DEPLOYMENT DOES THIS AT THE GATEWAY, not here: API Gateway's HTTP API has a CORS configuration, and the
 * handler core must not learn about origins. `*` is safe in THIS server because it is bound to 127.0.0.1, has no
 * cookies and no sessions — the credentials it takes are a header the caller must write, not one a browser
 * attaches by itself. `DSQ_CORS_ORIGIN` narrows it for a run that is reachable from somewhere else.
 */
function corsHeaders(auth: AuthMode, origin: string | null): Record<string, string> {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-headers': auth === 'dev' ? 'content-type, authorization, x-dev-player' : 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
  };
}

function send(response: http.ServerResponse, result: ApiResult, headers: Record<string, string>): void {
  const payload = JSON.stringify(result.body);
  response.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers,
    // NOTHING HERE IS CACHEABLE, and saying so is what keeps a browser from serving a stale drill after a
    // reload — the endpoints are per-player and the Progress row moves under them.
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/**
 * The `/health` answer: WHAT THIS PROCESS IS SERVING, so a stack script or a deploy smoke test can read it.
 *
 * THE STORE IS NAMED RATHER THAN IMPLIED. A `/health` that answered only `ok: true` would read the same against
 * an empty DynamoDB table and against a memory store that had just been forgotten, and "which store am I
 * talking to" is the first question a development run has.
 *
 * AND SO IS THE IDENTITY MODE (DESIGN.md 11.2): the client reads it ONCE, anonymously, and picks its flow —
 * `dev` shows no sign-in UI, `emulate` calls the emulator, `cognito` uses the hosted flow. The emulator's routes
 * are reported beside the API's own `endpoints` rather than inside them, because they are not endpoints of
 * DESIGN.md 11 and counting them there would make the "how many of the six exist" gap lie.
 */
function health(opened: OpenedStore, auth: AuthMode, identityNote: string, emulator: Emulator | null): ApiResult {
  return {
    status: 200,
    body: {
      ok: true,
      store: opened.label,
      auth: { mode: auth, identity: identityNote, signin: emulator ? emulator.routes : [] },
      endpoints: ROUTES.map((route) => `${route.method} ${route.path}`),
      planned: PLANNED_ENDPOINTS,
    },
  };
}

export interface DevServer {
  readonly port: number;
  readonly store: ItemStore;
  readonly label: string;
  close(): Promise<void>;
}

/** How a probe or a stack script starts this server. Every field is optional; the defaults are the local run. */
export interface DevServerOptions {
  readonly port?: number;
  readonly seed?: boolean;
  readonly opened?: OpenedStore;
  /**
   * The identity mode. IT DEFAULTS TO `dev` AND EVERY PROBE NAMES IT, because a probe that inherited the default
   * would change what it tests the day the default changes. (The probes that drive the handlers directly do not
   * come through here at all: they build a `Deps` and pick an adapter — usually `devIdentityOf` — themselves.)
   */
  readonly auth?: AuthMode;
  /** The emulator's signing secret, HEX. Absent mints one per process. */
  readonly authSecret?: string | null;
  readonly requireConfirmation?: boolean;
  readonly corsOrigin?: string | null;
  readonly cognitoVerify?: (token: string) => JwtClaims | null;
  readonly announce?: (message: string) => void;
}

/**
 * Start the server over an opened store, seeded with the local fixture.
 *
 * `port: 0` BINDS AN EPHEMERAL PORT AND REPORTS IT, which is what lets a probe drive the whole stack over a
 * real socket without picking a number two runs could share.
 */
export async function startDevServer(options: DevServerOptions = {}): Promise<DevServer> {
  const opened: OpenedStore = options.opened ?? { store: new MemoryStore(), label: 'memory' };
  const auth: AuthMode = options.auth ?? 'dev';
  const levels = options.seed === false ? [] : await seedLocalRegimes(opened.store);
  // AND TODAY'S DAILY, because the in-memory store is PER PROCESS: the boundary job publishes into a shared store,
  // so a separate `api:publish-daily` run could never reach this one. This is the local stand-in for BOTH
  // publishers, and it is why a developer gets a playable Daily with no setup — while a real deployment runs the
  // jobs instead (`api:publish-schedule`, `api:publish-daily`).
  //
  // ONLY THE SERVED LEVELS, NOT ALL 33 THE CORPUS CAN FILL: generation is ~0.1 s at level 1 and ~1 s at levels 2
  // and 3 (DESIGN.md 7.1's census), but ~2.5 minutes at a deep level, so seeding the whole ladder would be an hour
  // of boot. MEASURED: the three levels add about 2 s to the dev server's start.
  //
  // A SERVER LEFT RUNNING ACROSS MIDNIGHT SERVES YESTERDAY'S SEED AS UNPUBLISHED, which is the honest behaviour:
  // the boundary is a scheduled job's business, and the client is told `no_published_daily` rather than being
  // handed a challenge nobody validated.
  const day = utcDay(new Date());
  const daily = options.seed === false ? null : await publishDay(opened.store, day, { levels: [...SERVED_LEVELS], nowMs: Date.now() });
  const clock = { nowMs: () => Date.now() };
  const identity = identityFor({
    auth,
    authSecret: options.authSecret ?? null,
    requireConfirmation: options.requireConfirmation ?? false,
    ...(options.cognitoVerify ? { cognitoVerify: options.cognitoVerify } : {}),
    ...(options.announce ? { announce: options.announce } : {}),
    store: opened.store,
    clock,
  });
  const deps = depsFor(opened.store, identity.identityOf, clock);
  const headers = corsHeaders(auth, options.corsOrigin ?? null);

  const server = http.createServer((request, response) => {
    void (async () => {
      const started = Date.now();
      const url = new URL(request.url ?? '/', 'http://localhost');
      let result: ApiResult;
      try {
        if (request.method === 'OPTIONS') {
          // THE PREFLIGHT IS ANSWERED BEFORE ANY ROUTING, because it names a route that does exist rather than
          // asking this server to serve it.
          response.writeHead(204, headers);
          response.end();
          console.log(`204 OPTIONS ${url.pathname} (preflight) 0 ms`);
          return;
        }
        if (url.pathname === '/health') {
          result = health(opened, auth, identity.note, identity.emulator);
        } else {
          const apiRequest: ApiRequest = {
            method: request.method ?? 'GET',
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            body: await readBody(request),
            headers: Object.fromEntries(
              Object.entries(request.headers).filter(([, value]) => typeof value === 'string') as [string, string][],
            ),
          };
          // THE EMULATOR'S ROUTES COME FIRST, AND ONLY WHEN IT EXISTS: in `dev` and `cognito` mode these paths are
          // unrouted, exactly as any unknown path is, so the handler core never learns that authentication has a
          // shape (DESIGN.md 11.2).
          const emulated = identity.emulator ? await identity.emulator.handle(apiRequest) : null;
          if (emulated) {
            result = emulated;
          } else {
            const route = routeFor(apiRequest.method, url.pathname);
            result = route
              ? await route.handler(apiRequest, deps)
              : { status: 404, body: { error: { code: 'not_found', message: `nothing serves ${url.pathname}` } } };
          }
        }
      } catch (error) {
        // A THROW IS A BUG IN A HANDLER, NOT A CLIENT ERROR, so it is a 500 with the message in the log and a
        // generic one in the body: the client is not the audience for a stack trace.
        console.error(`${request.method} ${url.pathname} threw:`, error);
        result = { status: 500, body: { error: { code: 'internal', message: 'the request could not be handled' } } };
      }
      send(response, result, headers);
      console.log(`${result.status} ${request.method} ${url.pathname}${url.search} ${Date.now() - started} ms`);
    })();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });

  if (levels.length) console.log(`dev:api seeded the local fixture for level(s) ${levels.join(', ')}`);
  if (daily) console.log(`dev:api published ${daily.day} for level(s) ${daily.published.map((entry) => entry.levelIndex).join(', ')}`);
  return {
    port,
    store: opened.store,
    label: opened.label,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The verifier `cognito` mode runs on, from a JWKS document on disk. The deployment fetches the same document. */
function cognitoVerifierFrom(config: Config): (token: string) => JwtClaims | null {
  if (!config.cognitoJwksFile) {
    throw new Error('DSQ_AUTH=cognito needs DSQ_COGNITO_JWKS_FILE locally: the dev server reads the pool keys from a file rather than fetching them');
  }
  if (!config.cognitoIssuer || !config.cognitoAudience) {
    throw new Error('DSQ_AUTH=cognito needs DSQ_COGNITO_ISSUER and DSQ_COGNITO_AUDIENCE');
  }
  const jwks = JSON.parse(readFileSync(config.cognitoJwksFile, 'utf8')) as { keys?: readonly JsonWebKey[] };
  const keys = jwksKeys(jwks);
  const issuer = config.cognitoIssuer;
  const audience = config.cognitoAudience;
  return (token) => verifyToken(token, { issuer, audience, keys, nowMs: () => Date.now() });
}

/** Start from the environment: the store, the port, the seed and the identity mode all come from `configFromEnv`. */
export async function startFromEnv(): Promise<DevServer> {
  const config = configFromEnv();
  // THE STORE DECIDES WHETHER THAT MATTERS: the memory store never leaves this process, and only a DynamoDB run
  // needs an endpoint. See `devServerRefusal`, which exists because applying the warning unconditionally made the
  // ordinary local run refuse to start (found by loading the page in a browser, with the API pointed at memory).
  const refusal = devServerRefusal(config) ?? authRefusal(config);
  if (refusal) throw new Error(`dev:api refuses to start: ${refusal}`);
  const server = await startDevServer({
    port: config.port,
    opened: await openStore(config),
    auth: config.auth,
    authSecret: config.authSecret,
    requireConfirmation: config.confirmAccounts,
    corsOrigin: config.corsOrigin,
    ...(config.auth === 'cognito' ? { cognitoVerify: cognitoVerifierFrom(config) } : {}),
  });
  console.log(`dev:api listening on http://127.0.0.1:${server.port}/ store: ${server.label}`);
  // THE BANNER SAYS WHICH IDENTITY THE PROCESS BUILT, because the difference is not visible from the routes and
  // the whole hazard of the development mode is that it looks like any other run (AGENTS.md §6, §8 trap 23).
  console.log(`       auth: ${config.auth} — ${authNote(config)}`);
  return server;
}

/** One line, in the banner, naming what an identity is in this mode. */
function authNote(config: Config): string {
  if (config.auth === 'dev') return 'x-dev-player: <name> names the player — NOT for production';
  if (config.auth === 'emulate') {
    const confirmation = config.confirmAccounts ? 'signup requires the printed code (DSQ_AUTH_CONFIRM=1)' : 'signup confirms immediately';
    return `local accounts at POST /auth/signup|confirm|signin|refresh|signout; ${confirmation}`;
  }
  return `Cognito tokens for ${config.cognitoIssuer ?? '(no issuer)'} (JWKS: ${config.cognitoJwksFile ?? 'none'})`;
}

// THE MAIN-MODULE GUARD IS WHAT KEEPS THE PROBE POSSIBLE: `test/drill-probe.mjs` imports `startDevServer` to
// drive a real socket, and a file that listened at import time could not be imported by anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startFromEnv();
}
