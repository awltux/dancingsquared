// The API client's contract, PINNED — with a fake fetch and a fake storage, so no server and no browser.
//
// WHY THIS IS A GATE. This module is the game's only outbound path, and it is OPT-IN: with no base URL the game
// must be exactly the offline app it has always been, and with one every failure mode of a network — a refusal,
// a proxy's HTML error page, an unreachable host, a timeout — has to arrive as a typed answer rather than a
// crash or a wrong puzzle. None of that can be seen in a typecheck, and a browser can only show one of the five.
//
// Usage: node game/test/api-client-probe.mjs
import { advanceDrill, apiConfigured, deviceId, issueDrill, normaliseBase } from '../src/net/api.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** A storage the probe owns, with a count of what was written. */
const storage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    map,
    writes,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, value);
      writes.push(key);
    },
  };
};

/** A fetch that records its calls and answers from a script. */
const fetching = (answer) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const scripted = typeof answer === 'function' ? answer(url, init) : answer;
    if (scripted instanceof Error) throw scripted;
    if (scripted instanceof Promise) return scripted;
    return {
      ok: scripted.status >= 200 && scripted.status < 300,
      status: scripted.status,
      json: async () => {
        if (scripted.body === undefined) throw new SyntaxError('not json');
        return scripted.body;
      },
    };
  };
  return { calls, impl };
};

const DRILL = {
  id: '1:3',
  index: 3,
  levelIndex: 1,
  seed: 42,
  poolVersion: 'ms-1',
  issuedAtMs: 1700000000000,
  optionLabels: ['Boys Run', 'Bend the Line'],
  resumed: false,
};
const deps = (base, scripted, initial) => {
  const store = storage(initial);
  const fetch = fetching(scripted);
  return { store, fetch, api: { base, fetch: fetch.impl, getItem: store.getItem, setItem: store.setItem, timeoutMs: 1000 } };
};

console.log('== 1. with no base configured, nothing is called at all ==');
{
  const wired = deps('', { status: 200, body: { drill: DRILL, regime: { finished: 0, length: 12 } } });
  check(apiConfigured() === false, 'the app reports itself as OFFLINE (import.meta.env has no VITE_API_BASE in a probe)');
  const answer = await issueDrill(1, wired.api);
  check(answer.ok === false && answer.failure.code === 'no_api', `and a call refuses without the network (${answer.failure?.code})`);
  // NEGATIVE CONTROL, MEASURED: the fetch was never called. A client that reached for the network anyway would
  // fire a relative URL at whatever served the page — which reads as a mysterious 404 rather than "no API".
  check(wired.fetch.calls.length === 0, `NEGATIVE CONTROL: fetch was called ${wired.fetch.calls.length} times`);
}

console.log('\n== 2. the request is the one the endpoint documents ==');
{
  // THE TRAILING SLASH IS STRIPPED BY `normaliseBase`, and it is measured as a FUNCTION because a probe cannot set
  // `import.meta.env`: a base ending in `/` would otherwise build `…8090//drill/current`, which some proxies
  // answer and others do not — a difference nobody would find without a check.
  check(normaliseBase('http://127.0.0.1:8090///') === 'http://127.0.0.1:8090', `a base with trailing slashes is normalised (${normaliseBase('http://127.0.0.1:8090///')})`);
  check(normaliseBase(undefined) === '' && normaliseBase('') === '', 'and an unset or empty base stays empty, which is what "offline" is measured as');
  const wired = deps('http://127.0.0.1:8090', { status: 200, body: { drill: DRILL, regime: { finished: 4, length: 12 } } });
  const answer = await issueDrill(2, wired.api);
  check(answer.ok === true, `a drill is issued (${answer.ok})`);
  check(answer.value.drill.id === '1:3' && answer.value.drill.seed === 42 && answer.value.drill.resumed === false, `and parsed (${answer.value.drill.id}, seed ${answer.value.drill.seed})`);
  check(answer.value.regime.finished === 4 && answer.value.regime.length === 12, `with the regime counts (${answer.value.regime.finished} of ${answer.value.regime.length})`);
  const call = wired.fetch.calls[0];
  check(call.url === 'http://127.0.0.1:8090/drill/current?level=2', `the URL is the path and the query with no double slash (${call.url})`);
  check(call.init.method === 'GET', `and the method is GET (${call.init.method})`);
  const device = call.init.headers['x-dev-player'];
  check(typeof device === 'string' && device.length > 0, `carrying the anonymous device id as the dev identity (${device})`);
  check(wired.store.map.get('dsq.game.device') === device, 'which was minted into storage on first use');
  // THE ID IS STABLE, not minted per call: a device id that changed would make every request a different player,
  // and the server's whole regime is keyed on it.
  const second = await issueDrill(2, wired.api);
  check(second.ok && wired.fetch.calls[1].init.headers['x-dev-player'] === device, 'and the same id on the next request');
  check(deviceId(wired.api) === device, 'and through the exported accessor');
  // NEGATIVE CONTROL, MEASURED: the id was minted ONCE across two requests. A client that minted per call would
  // make every request a different player, and the server's regime is keyed on the id.
  check(wired.store.writes.length === 1, `NEGATIVE CONTROL: two requests wrote storage ${wired.store.writes.length} time(s)`);
}

console.log('\n== 3. a token, when there is one, replaces the device id ==');
{
  const wired = deps('http://localhost:8090', { status: 200, body: { drill: DRILL, regime: { finished: 0, length: 3 } } }, { 'dsq.game.token': 'jwt-abc' });
  await issueDrill(1, wired.api);
  const headers = wired.fetch.calls[0].init.headers;
  check(headers.authorization === 'Bearer jwt-abc', `the token rides in Authorization (${headers.authorization})`);
  check(headers['x-dev-player'] === undefined, 'NEGATIVE CONTROL: and the device id is NOT also sent, so a signed-in player is never two identities');
}

console.log('\n== 4. every failure is a typed refusal, and the server\'s own words are kept ==');
{
  const refused = deps('http://localhost:8090', { status: 409, body: { error: { code: 'stale_drill', message: 'the drill in flight is 1:4, not 1:3' } } });
  const answer = await issueDrill(1, refused.api);
  check(answer.ok === false && answer.failure.code === 'stale_drill', `a refusal carries the server's code (${answer.failure?.code})`);
  check(answer.failure.message === 'the drill in flight is 1:4, not 1:3', `and its message VERBATIM, because that is what the player is shown (${answer.failure?.message})`);

  // A PROXY'S HTML ERROR PAGE: the shape is not this API's, and the answer must still be usable.
  const proxied = deps('http://localhost:8090', { status: 502, body: undefined });
  const gateway = await issueDrill(1, proxied.api);
  check(gateway.ok === false && gateway.failure.code === 'http_502', `an unparseable error body falls back to the status (${gateway.failure?.code})`);
  check(gateway.failure.message.includes('502'), `with a sentence that names it (${gateway.failure?.message})`);

  // AN UNREACHABLE SERVER — including this request's own timeout, which surfaces as a throw from `fetch`.
  const dead = deps('http://localhost:9999', new TypeError('fetch failed'));
  const unreachable = await issueDrill(1, dead.api);
  check(unreachable.ok === false && unreachable.failure.code === 'unreachable', `a dead server is a refusal, not a crash (${unreachable.failure?.code})`);
  const aborted = deps('http://localhost:8090', new DOMException('The operation was aborted', 'TimeoutError'));
  const timedOut = await issueDrill(1, aborted.api);
  check(timedOut.ok === false && timedOut.failure.code === 'unreachable' && timedOut.failure.message.includes('TimeoutError'), `and so is a timeout, naming what happened (${timedOut.failure?.message})`);

  // A MALFORMED DRILL IS NEVER GENERATED FROM. This is the check that protects the player from a wrong puzzle
  // presented as a right one: `asIssuedDrill` refuses a body without a seed, so the caller cannot reach the
  // generator with `undefined`.
  const partial = deps('http://localhost:8090', { status: 200, body: { drill: { id: '1:0', index: 0, levelIndex: 1 }, regime: { finished: 0, length: 3 } } });
  const malformed = await issueDrill(1, partial.api);
  check(malformed.ok === false && malformed.failure.code === 'bad_response', `a drill with no seed is refused (${malformed.failure?.code})`);
  check(malformed.failure.message.includes('generate'), `and the sentence says why it matters (${malformed.failure?.message})`);

  // THE COMPLETE REGIME IS ITS OWN ANSWER, not an error with a status: the season being over is a state a screen
  // renders, and the caller needs to tell it apart from a server that is down.
  const complete = deps('http://localhost:8090', { status: 200, body: { drill: null, regime: { finished: 12, length: 12 } } });
  const over = await issueDrill(1, complete.api);
  check(over.ok === false && over.failure.code === 'regime_complete', `a finished season is reported as such (${over.failure?.code})`);

  // A TOLERATED MISSING FIELD, measured so nobody adds a second required one by accident: the option labels are
  // the server's cross-check, and a server that stops sending them must not break the client.
  const noLabels = deps('http://localhost:8090', { status: 200, body: { drill: { ...DRILL, optionLabels: undefined }, regime: { finished: 0, length: 3 } } });
  const tolerated = await issueDrill(1, noLabels.api);
  check(tolerated.ok === true && tolerated.value.drill.optionLabels === null, `a drill without option labels still parses (${tolerated.value?.drill?.optionLabels})`);
}

console.log('\n== 5. advancing sends the drill id it is advancing ==');
{
  const wired = deps('http://localhost:8090', { status: 200, body: { regime: { finished: 5, length: 12 } } });
  const answer = await advanceDrill('1:4', wired.api);
  check(answer.ok === true && answer.value.regime.finished === 5, `an advance answers with the regime (${answer.value?.regime?.finished})`);
  const call = wired.fetch.calls[0];
  check(call.url === 'http://localhost:8090/drill/advance', `posted to the path with no query (${call.url})`);
  check(call.init.method === 'POST' && JSON.parse(call.init.body).drillId === '1:4', `with the drill id in the body (${call.init.body})`);
  check(call.init.headers['content-type'] === 'application/json', 'and a JSON content type');
  const refused = deps('http://localhost:8090', { status: 409, body: { error: { code: 'stale_drill', message: 'this player has no drill in flight' } } });
  const again = await advanceDrill('1:4', refused.api);
  check(again.ok === false && again.failure.code === 'stale_drill', `a repeated advance is the server's refusal (${again.failure?.code})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
