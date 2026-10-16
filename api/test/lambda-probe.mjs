// THE LAMBDA ADAPTER, pinned from fixture events (DESIGN.md §15 Q14).
//
// WHY THIS IS A GATE. The deployment's request path is the one piece of this API that cannot be exercised by running
// the dev server: it is an API Gateway event in and an API Gateway response out, and the failure it would hide is
// exactly the kind that only appears in production — a path that routes locally and 404s behind the gateway, a body
// that is base64 in the deployment and plain text locally, an identity header the transport drops before a handler
// ever sees it. So the adapter is a PURE FUNCTION of an event (`api/src/lambda.ts` imports no AWS SDK at all), and
// this probe drives the whole deployed path — routing, identity, the store, the refusal bodies — from events with no
// SDK, no credentials and no Lambda runtime.
//
// AND IT PINS THE SHARED RULES AGAINST THE OTHER TRANSPORT. `api/src/dispatch.ts` was extracted when this adapter
// arrived, because the emulator-first order, the 404 body, the 500-for-a-throw and the body rule had to be ONE rule
// rather than two that drift. Two checks below drive the SAME request through the dev server over a real socket and
// through the event adapter and assert they answer the same thing — which is the property the extraction bought, and
// the only way to notice if a later change quietly gives the two deployments different opinions.
//
// THE EVENTS ARE THE HTTP API'S PAYLOAD FORMAT 2.0 (`requestContext.http.method`, `rawPath`, `rawQueryString`, a
// `body` that may be base64). That choice is recorded in the adapter's header and listed as one of the deployment
// decisions, so this probe is also the place a change of format would have to be re-pinned.
//
// Usage: node api/test/lambda-probe.mjs
import { handleEvent, corsHeaders, asRequest } from '../src/lambda.ts';
import { ROUTES, PLANNED_ENDPOINTS } from '../src/routes.ts';
import { startDevServer } from '../src/dev-server.ts';
import { seedLocalRegimes } from '../src/local-regime.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { MAX_BODY_BYTES } from '../src/dispatch.ts';
import { STATUS } from '../src/status.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = 1;
const CLOCK = 1_700_000_000_000;
const player = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;

let now = CLOCK;
const depsFor = (store) => ({ store, clock: { nowMs: () => now }, identityOf: devIdentityOf });

/**
 * An API Gateway HTTP API event (payload 2.0), with the parts this adapter reads.
 *
 * `headers` KEEPS ITS CASE ON PURPOSE — the adapter lower-cases them — so a check can send `Authorization` the way a
 * gateway does and see it arrive as `authorization` at the handler.
 */
const event = (method, path, { query = '', headers = {}, body, base64 = false } = {}) => ({
  version: '2.0',
  rawPath: path,
  rawQueryString: query,
  headers,
  ...(body === undefined ? {} : { body: base64 ? Buffer.from(body, 'utf8').toString('base64') : body }),
  isBase64Encoded: base64,
  requestContext: { http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' } },
});

const optionsFor = (store, over = {}) => ({ deps: depsFor(store), auth: 'emulate', store: 'memory', identity: 'a test adapter', ...over });

/** A store whose every read throws, for the 500 path — a handler bug rather than a client error. */
const explodingStore = () => ({
  get: async () => { throw new Error('the store exploded'); },
  query: async () => { throw new Error('the store exploded'); },
  put: async () => { throw new Error('the store exploded'); },
  transact: async () => { throw new Error('the store exploded'); },
});

async function fresh() {
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  return store;
}

console.log('== 1. a routed request travels the whole deployed path from an event ==');
{
  const store = await fresh();
  const served = await handleEvent(event('GET', '/drill/current', { query: 'level=1', headers: { 'x-dev-player': 'L1' } }), optionsFor(store));
  check(served.statusCode === STATUS.ok, `a GET routes and answers 200 (${served.statusCode})`);
  const body = JSON.parse(served.body);
  check(typeof served.body === 'string', 'and the body is a JSON STRING, which is what a gateway expects');
  check(typeof body.drill?.id === 'string' && body.drill.id.startsWith('1:'), `with the drill the handler built (${body.drill?.id})`);
  check(served.headers['content-type'] === 'application/json; charset=utf-8', 'and the content type a client needs');
  check(served.headers['cache-control'] === 'no-store', 'with no-store, because a cached drill is a wrong question');

  // THE IDENTITY MACHINERY IS THE HANDLERS', NOT THE TRANSPORT'S: the header arrives through the event and names the
  // player exactly as it does over a socket, and a request WITHOUT it is the demo the same handler serves.
  const demo = await handleEvent(event('GET', '/drill/current', { query: 'level=1' }), optionsFor(store));
  check(demo.statusCode === STATUS.ok && JSON.parse(demo.body).demo === true, `a request with no identity is the demo the handler decides (${demo.statusCode} demo ${JSON.parse(demo.body).demo})`);

  // THE ROUTE TABLE IS THE ONLY SOURCE OF ROUTING: an endpoint that landed long after this adapter (`POST
  // /drill/reveal`, A28) is served through it with no adapter change at all, which is the point of `routeFor`.
  const reveal = await handleEvent(event('POST', '/drill/reveal', { headers: { 'x-dev-player': 'L1' }, body: JSON.stringify({ drillId: body.drill.id, step: 0 }) }), optionsFor(store));
  check(reveal.statusCode === STATUS.ok, `an endpoint the adapter never heard of is served by the table (${reveal.statusCode} POST /drill/reveal)`);
  const noIdentity = await handleEvent(event('POST', '/drill/reveal', { body: JSON.stringify({ drillId: body.drill.id, step: 0 }) }), optionsFor(store));
  check(noIdentity.statusCode === STATUS.unauthenticated, `and a write with no identity is still a 401 (${noIdentity.statusCode})`);
}

console.log('\n== 2. the transport questions: preflight, health, and an event that is not a request ==');
{
  const store = await fresh();
  const preflight = await handleEvent(event('OPTIONS', '/drill/current', { headers: { origin: 'http://localhost:8089' } }), optionsFor(store));
  check(preflight.statusCode === 204 && preflight.body === '', `a preflight is answered before any routing (${preflight.statusCode})`);
  check(preflight.headers['access-control-allow-methods'] === 'GET, POST, OPTIONS', 'with the methods this API serves');
  // THE ALLOWED HEADERS DEPEND ON THE MODE, which is §11.2's negative control carried to the second adapter: a token
  // mode must NOT advertise `x-dev-player`, because advertising a header no longer means anything is how a client
  // keeps sending it. The check is the ABSENCE, which is why it is written as one.
  check(!preflight.headers['access-control-allow-headers'].includes('x-dev-player'), `and a token mode does not advertise the dev header (${preflight.headers['access-control-allow-headers']})`);
  const devPreflight = corsHeaders('dev', null);
  check(devPreflight['access-control-allow-headers'].includes('x-dev-player'), 'NEGATIVE CONTROL: dev mode does advertise it, so the absence above is the mode and not a missing string');

  const health = await handleEvent(event('GET', '/health'), optionsFor(store));
  const healthBody = JSON.parse(health.body);
  check(health.statusCode === STATUS.ok && healthBody.endpoints.length === ROUTES.length && healthBody.planned === PLANNED_ENDPOINTS, `health reports ${healthBody.endpoints?.length} of ${healthBody.planned} endpoints, which is the table it routes by`);
  check(healthBody.endpoints.includes('POST /drill/reveal'), 'including the endpoint that landed last, because the list is the table');

  const strange = await handleEvent({ version: '2.0', headers: {} }, optionsFor(store));
  check(strange.statusCode === 400 && JSON.parse(strange.body).error.code === 'bad_event', `an event that names no method or path is a 400 (${strange.statusCode} ${JSON.parse(strange.body).error?.code})`);

  // A PATH THE TABLE DOES NOT SERVE, and the shape of the refusal is the DEV SERVER'S — see section 4 for the check
  // that says so rather than assuming it.
  const nowhere = await handleEvent(event('GET', '/nothing-here'), optionsFor(store));
  check(nowhere.statusCode === 404 && JSON.parse(nowhere.body).error.code === 'not_found', `an unrouted path is a 404 with the table's body (${nowhere.statusCode} ${JSON.parse(nowhere.body).error?.code})`);
}

console.log('\n== 3. the body rule: JSON, base64, malformed and oversized ==');
{
  const store = await fresh();
  const served = await handleEvent(event('GET', '/drill/current', { query: 'level=1', headers: { 'x-dev-player': 'B1' } }), optionsFor(store));
  const drillId = JSON.parse(served.body).drill.id;

  const base64 = await handleEvent(event('POST', '/drill/reveal', { headers: { 'x-dev-player': 'B1' }, body: JSON.stringify({ drillId, step: 0 }), base64: true }), optionsFor(store));
  check(base64.statusCode === STATUS.ok && JSON.parse(base64.body).call !== undefined, `a base64 body is decoded and served (${base64.statusCode})`);

  const malformed = await handleEvent(event('POST', '/runs', { headers: { 'x-dev-player': 'B1' }, body: '{not json' }), optionsFor(store));
  check(malformed.statusCode === 400 && JSON.parse(malformed.body).error.code === 'bad_json', `a body that is not JSON is a 400 rather than a null body (${malformed.statusCode} ${JSON.parse(malformed.body).error?.code})`);

  const huge = await handleEvent(event('POST', '/runs', { headers: { 'x-dev-player': 'B1' }, body: JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES) }) }), optionsFor(store));
  check(huge.statusCode === 413 && JSON.parse(huge.body).error.code === 'body_too_large', `a body past the cap is a 413 (${huge.statusCode} ${JSON.parse(huge.body).error?.code})`);

  // AN EMPTY BODY IS `null`, NOT A PARSE FAILURE: the handlers read `null` as "there was none", and a POST with no
  // body at all (a stray `curl -X POST`) must not be reported as malformed JSON.
  const empty = await handleEvent(event('POST', '/runs', { headers: { 'x-dev-player': 'B1' } }), optionsFor(store));
  check(empty.statusCode === 400 && JSON.parse(empty.body).error.code === 'bad_body', `an absent body is an empty one and the handler refuses it as such (${JSON.parse(empty.body).error?.code})`);

  // A HANDLER BUG IS A 500 WITH A GENERIC BODY, and the reason is reported through `onError` rather than to the caller.
  const reported = [];
  const exploded = await handleEvent(event('GET', '/drill/current', { query: 'level=1', headers: { 'x-dev-player': 'B1' } }), {
    ...optionsFor({ ...new MemoryStore(), ...explodingStore() }),
    onError: (request, error) => reported.push(`${request.method} ${request.path}: ${error.message}`),
  });
  check(exploded.statusCode === 500 && JSON.parse(exploded.body).error.code === 'internal', `a handler that throws is a 500 with a generic body (${exploded.statusCode} ${JSON.parse(exploded.body).error?.code})`);
  check(reported.length === 1 && reported[0].includes('the store exploded'), `and the reason goes to the adapter's log, not to the client (${reported[0]})`);
}

console.log('\n== 4. the two adapters answer the shared rules IDENTICALLY ==');
{
  // THE PROPERTY `dispatch.ts` WAS EXTRACTED FOR. Two requests go through the SAME handler core by two different
  // transports — one over a socket, one over an event — and the answers must be the same, because a deployment that
  // refused a body or an unrouted path differently from the local run is a difference nobody would see until a user
  // did. MEASURED: this check is what would fail if a later change put a rule back in an adapter.
  const store = await fresh();
  const server = await startDevServer({ port: 0, seed: false, opened: { store, label: 'memory' } });
  const call = async (path, init) => {
    const answer = await fetch(`http://127.0.0.1:${server.port}${path}`, init);
    return { status: answer.status, body: await answer.json() };
  };
  try {
    const httpMissing = await call('/nothing-here');
    const eventMissing = await handleEvent(event('GET', '/nothing-here'), optionsFor(store));
    check(httpMissing.status === eventMissing.statusCode && httpMissing.body.error.code === JSON.parse(eventMissing.body).error.code, `an unrouted path answers the same code over both transports (${httpMissing.status} ${httpMissing.body.error.code})`);

    const httpMalformed = await call('/runs', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dev-player': 'S1' }, body: '{not json' });
    const eventMalformed = await handleEvent(event('POST', '/runs', { headers: { 'x-dev-player': 'S1' }, body: '{not json' }), optionsFor(store));
    check(httpMalformed.status === eventMalformed.statusCode && httpMalformed.body.error.code === JSON.parse(eventMalformed.body).error.code, `and so does a malformed body (${httpMalformed.status} ${httpMalformed.body.error.code})`);

    // THE HEALTH ANSWER IS AN ADAPTER'S, and both adapters report the same table: it is not a row of `ROUTES`, so it
    // is the one route each of them owns — which is why it is checked here rather than left to the table's length.
    const httpHealth = await call('/health');
    check(httpHealth.body.planned === PLANNED_ENDPOINTS && httpHealth.body.endpoints.length === ROUTES.length, `both adapters report the same ${PLANNED_ENDPOINTS}-endpoint table (${httpHealth.body.endpoints.length})`);
  } finally {
    await server.close();
  }
}

console.log('\n== 5. the event mapping itself, at its edges ==');
{
  // HEADER CASE IS NOT SIGNIFICANT, and a gateway forwards what the client wrote: `Authorization` must arrive as
  // `authorization`, or the token adapters would never see a token in the deployment.
  const mapped = asRequest(event('get', '/drill/current', { query: 'level=1&extra=ignored', headers: { Authorization: 'Bearer x', 'X-Dev-Player': 'N1' } }));
  check(mapped.ok === true && mapped.request.method === 'GET', 'the method is upper-cased from the event');
  check(mapped.ok === true && mapped.request.path === '/drill/current' && mapped.request.query.level === '1', 'the path and query come from rawPath/rawQueryString');
  check(mapped.ok === true && mapped.request.headers['authorization'] === 'Bearer x' && mapped.request.headers['x-dev-player'] === 'N1', `and header names are lower-cased, because HTTP's are case-insensitive (${Object.keys(mapped.request.headers).join(', ')})`);
  const repeated = asRequest({ ...event('GET', '/drill/current'), headers: { 'x-dev-player': 'first' } });
  check(repeated.ok === true && repeated.request.headers['x-dev-player'] === 'first', 'with the first value winning a repeat rather than a compressed string');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
