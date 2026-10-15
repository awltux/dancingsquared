// The local dev server: the same handlers, over `node:http`, with an in-memory store.
//
// IT IS AN ADAPTER AND NOTHING ELSE. It parses an HTTP exchange into an `ApiRequest`, calls the route's
// handler, and serialises the `ApiResult` — every rule lives in `handlers/` and `drill-regime.ts`, both of
// which are driven by probes that never open a socket. The one thing this file owns is the DEVELOPMENT
// IDENTITY: a real deployment gets `sub` from a Cognito JWT checked by API Gateway's authorizer, which is
// configuration rather than code, so locally there is nothing to check and `x-dev-player` names the player.
//
// WHY NOT A FRAMEWORK. Six routes, one JSON body shape, no cookies, no sessions, no static files: the node
// http module is the whole dependency list, and a framework would add a routing DSL to read in order to learn
// the same table that `routes.ts` already states.
//
// Run:   npm run dev:api          (from the repo root; listens on 8090 unless DSQ_PORT says otherwise)
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { MemoryStore } from './store/memory.ts';
import { PLANNED_ENDPOINTS, ROUTES, routeFor } from './routes.ts';
import { seedLocalRegimes } from './local-regime.ts';
import type { ApiRequest, ApiResult, Deps } from './ports.ts';

/** A JSON body larger than this is refused rather than buffered: nothing this API takes is bigger than a move list. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The development identity.
 *
 * TWO SPELLINGS, ONE MEANING: `x-dev-player: alice` and `Authorization: Bearer dev:alice` both name the same
 * player, because a browser test and a `curl` are the two ways a developer drives this and neither should
 * have to know the other's habit. `dev:` is prefixed onto the value so a development id can never collide with
 * a Cognito `sub` if a row is ever copied between the two.
 */
export function devIdentity(request: ApiRequest): string | null {
  const direct = request.headers['x-dev-player'];
  if (direct) return `dev:${direct}`;
  const bearer = request.headers['authorization'];
  const match = bearer ? /^Bearer\s+dev:(.+)$/i.exec(bearer) : null;
  return match ? `dev:${match[1]}` : null;
}

/** Everything the handlers need, with the local choices made explicit. */
export function devDeps(store: MemoryStore): Deps {
  return { store, clock: { nowMs: () => Date.now() }, playerIdOf: devIdentity };
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

function send(response: http.ServerResponse, result: ApiResult): void {
  const payload = JSON.stringify(result.body);
  response.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // NOTHING HERE IS CACHEABLE, and saying so is what keeps a browser from serving a stale drill after a
    // reload — the endpoints are per-player and the Progress row moves under them.
    'cache-control': 'no-store',
  });
  response.end(payload);
}

/** The `/health` answer: what this process is serving, so a stack script or a deploy smoke test can read it. */
function health(store: MemoryStore): ApiResult {
  return {
    status: 200,
    body: {
      ok: true,
      store: 'memory',
      endpoints: ROUTES.map((route) => `${route.method} ${route.path}`),
      planned: PLANNED_ENDPOINTS,
      keys: store.size,
    },
  };
}

export interface DevServer {
  readonly port: number;
  readonly store: MemoryStore;
  close(): Promise<void>;
}

/**
 * Start the server, seeded with the local fixture.
 *
 * `port: 0` BINDS AN EPHEMERAL PORT AND REPORTS IT, which is what lets a probe drive the whole stack over a
 * real socket without picking a number two runs could share.
 */
export async function startDevServer(options: { port?: number; seed?: boolean } = {}): Promise<DevServer> {
  const store = new MemoryStore();
  const levels = options.seed === false ? [] : await seedLocalRegimes(store);
  const deps = devDeps(store);

  const server = http.createServer((request, response) => {
    void (async () => {
      const started = Date.now();
      const url = new URL(request.url ?? '/', 'http://localhost');
      let result: ApiResult;
      try {
        if (url.pathname === '/health') {
          result = health(store);
        } else {
          const route = routeFor(request.method ?? 'GET', url.pathname);
          if (!route) {
            result = { status: 404, body: { error: { code: 'not_found', message: `nothing serves ${url.pathname}` } } };
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
            result = await route.handler(apiRequest, deps);
          }
        }
      } catch (error) {
        // A THROW IS A BUG IN A HANDLER, NOT A CLIENT ERROR, so it is a 500 with the message in the log and a
        // generic one in the body: the client is not the audience for a stack trace.
        console.error(`${request.method} ${url.pathname} threw:`, error);
        result = { status: 500, body: { error: { code: 'internal', message: 'the request could not be handled' } } };
      }
      send(response, result);
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
  return {
    port,
    store,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// THE MAIN-MODULE GUARD IS WHAT KEEPS THE PROBE POSSIBLE: `test/drill-probe.mjs` imports `startDevServer` to
// drive a real socket, and a file that listened at import time could not be imported by anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env['DSQ_PORT'] ?? 8090);
  const server = await startDevServer({ port });
  console.log(`dev:api listening on http://127.0.0.1:${server.port}/ (x-dev-player: <name> to be someone)`);
}
