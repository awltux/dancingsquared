// The API client's contract, PINNED — with a fake fetch and a fake storage, so no server and no browser.
//
// WHY THIS IS A GATE. This module is the game's only outbound path, and it is OPT-IN: with no base URL the game
// must be exactly the offline app it has always been, and with one every failure mode of a network — a refusal,
// a proxy's HTML error page, an unreachable host, a timeout — has to arrive as a typed answer rather than a
// crash or a wrong puzzle. None of that can be seen in a typecheck, and a browser can only show one of the five.
//
// Usage: node game/test/api-client-probe.mjs
import { advanceDrill, apiConfigured, dailyChallenge, deviceId, issueDrill, normaliseBase, recordDrillAnswer, spendHint, submitRun } from '../src/net/api.ts';
import { SESSION_KEY } from '../src/net/session.ts';

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
    removeItem: (key) => {
      map.delete(key);
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
  return { store, fetch, api: { base, fetch: fetch.impl, getItem: store.getItem, setItem: store.setItem, removeItem: store.removeItem, timeoutMs: 1000 } };
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
  // AN UNKNOWN MODE IS NOT `dev`, SO THE REQUEST CARRIES NO IDENTITY AT ALL. This is the check a BROWSER produced:
  // a custom header makes the request non-simple, so it is preflighted, and a token mode deliberately does not
  // advertise `x-dev-player` (`api/src/dev-server.ts`, pinned by `api/test/auth-probe.mjs`). MEASURED at
  // `http://localhost:8089` against `DSQ_AUTH=emulate`: with the header unconditional, a signed-out player's demo
  // drill answered `TypeError — the server could not be reached`, which is the one read §11.2 promises them.
  // NEGATIVE CONTROL: the unconditional rule this replaced puts a device id here, and ONLY this check fails it.
  check(device === undefined, 'a mode this client has not learned sends NO device id (that header would fail a token-mode preflight)');
  check(call.init.headers.authorization === undefined, 'and no token, so the request claims to be nobody — which is what the server reads as a demo');
  check(wired.store.writes.length === 0, `NEGATIVE CONTROL: and no device id was even minted (${wired.store.writes.length} storage write(s))`);

  // IN `dev` THE DEVICE ID **IS** THE IDENTITY, and it must still be minted once and reused: a device id that
  // changed per call would make every request a different player, and the server's whole regime is keyed on it.
  const dev = deps('http://127.0.0.1:8090', { status: 200, body: { drill: DRILL, regime: { finished: 4, length: 12 } } });
  dev.api.modeOverride = 'dev';
  await issueDrill(2, dev.api);
  const deviceIdSent = dev.fetch.calls[0].init.headers['x-dev-player'];
  check(typeof deviceIdSent === 'string' && deviceIdSent.length > 0, `under dev the device id names the player (${deviceIdSent})`);
  check(dev.store.map.get('dsq.game.device') === deviceIdSent, 'which was minted into storage on first use');
  const second = await issueDrill(2, dev.api);
  check(second.ok && dev.fetch.calls[1].init.headers['x-dev-player'] === deviceIdSent, 'and the same id on the next request');
  check(deviceId(dev.api) === deviceIdSent, 'and through the exported accessor');
  check(dev.store.writes.length === 1, `NEGATIVE CONTROL: two requests wrote storage ${dev.store.writes.length} time(s)`);
}

console.log('\n== 3. a session, when there is one, replaces the device id ==');
{
    // THE SESSION IS SEEDED AS THE STORED ITEM session.ts WRITES, so this probe and uth-client-probe.mjs cannot
  // disagree about where a token lives — the shape is imported rather than spelled.
  const wired = deps('http://localhost:8090', { status: 200, body: { drill: DRILL, regime: { finished: 0, length: 3 } } }, { [SESSION_KEY]: JSON.stringify({ accessToken: 'jwt-abc', refreshToken: 'r-1', playerId: 'emu:1', email: 'eve@example.com', expiresAtMs: Date.now() + 3_600_000 }) });
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

console.log('\n== 5. the Daily is a READ of the published challenge ==');
{
  const CHALLENGE = { day: '2026-10-15', levelIndex: 2, seed: 1268207204, poolVersion: 'ms-1', publishedAtMs: 1700000000000, playable: true };
  const wired = deps('http://localhost:8090', { status: 200, body: { daily: CHALLENGE } });
  const answer = await dailyChallenge(2, '2026-10-15', wired.api);
  check(answer.ok === true && answer.value.seed === 1268207204, `the published seed is read (${answer.value?.seed})`);
  check(answer.value.playable === true && answer.value.levelIndex === 2, `with the level and playability (${answer.value?.levelIndex}, ${answer.value?.playable})`);
  const call = wired.fetch.calls[0];
  check(call.url === 'http://localhost:8090/puzzle?mode=daily&level=2&date=2026-10-15', `the query names the mode, the level and the date (${call.url})`);
  check(call.init.method === 'GET', `and it is a read, not a POST (${call.init.method})`);

  // A DAY NOBODY PUBLISHED IS THE SERVER'S OWN REFUSAL, verbatim: the fix is an operator running the boundary job,
  // and a client that invented a seed here would play a question nobody validated (§9).
  const unpublished = deps('http://localhost:8090', { status: 404, body: { error: { code: 'no_published_daily', message: 'level 2 has no published challenge for 2026-10-16' } } });
  const missing = await dailyChallenge(2, '2026-10-16', unpublished.api);
  check(missing.ok === false && missing.failure.code === 'no_published_daily', `an unpublished day is refused (${missing.failure?.code})`);
  check(missing.failure.message.includes('2026-10-16'), `and the sentence names the day (${missing.failure?.message})`);

  // A CHALLENGE FROM ANOTHER POOL IS FLAGGED, not silently played: `playable` is the server's own answer to "can
  // this build regenerate it", and the client refuses rather than generating a board that cannot be scored.
  const foreign = deps('http://localhost:8090', { status: 200, body: { daily: { ...CHALLENGE, poolVersion: 'ms-0', playable: false } } });
  const stale = await dailyChallenge(2, '2026-10-15', foreign.api);
  check(stale.ok === true && stale.value.playable === false, `a challenge from another pool arrives with playable: false (${stale.value?.playable})`);

  // THE SEED IS THE ONE FIELD THAT MUST BE THERE: without it the generator would draw today's challenge from
  // `undefined`, which is the same class of failure the drill's check covers.
  const noSeed = deps('http://localhost:8090', { status: 200, body: { daily: { day: '2026-10-15', levelIndex: 2, poolVersion: 'ms-1' } } });
  const malformed = await dailyChallenge(2, '2026-10-15', noSeed.api);
  check(malformed.ok === false && malformed.failure.code === 'bad_response', `a challenge with no seed is refused (${malformed.failure?.code})`);
  const noRow = deps('http://localhost:8090', { status: 200, body: {} });
  const absent = await dailyChallenge(2, '2026-10-15', noRow.api);
  check(absent.ok === false && absent.failure.code === 'bad_response', `and so is a body with no challenge in it (${absent.failure?.code})`);
}

console.log('\n== 6. advancing sends the drill id it is advancing ==');
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

console.log('\n== 7. a completed run is handed over, and what comes back is what is adopted ==');
{
  const OUTCOME = {
    run: { runId: 'run-1', score: 100, elapsedSeconds: 12, scoreVersion: 1, clamped: false, duplicate: false },
    hints: { hints: 0, successes: 1, granted: false },
    board: { period: '2026-10', score: 100, runs: 1 },
    progress: { finished: 1 },
  };
  const wired = deps('http://localhost:8090', { status: 200, body: OUTCOME });
  const body = {
    runId: 'run-1',
    mode: 'drill',
    levelIndex: 1,
    drillId: '1:0',
    elapsedSeconds: 12,
    hintsUsed: 0,
    attempts: 1,
    calls: ['Allemande Left in the Alamo Style'],
    score: 120,
  };
  const answer = await submitRun(body, wired.api);
  check(answer.ok === true, `the run is accepted (${answer.ok})`);
  // WHAT IS ADOPTED IS THE SERVER'S, not the claim: the score, the balance and the board row all come from the
  // answer, which is the whole point of submitting rather than keeping a local ledger.
  check(answer.value.run.score === 100 && answer.value.run.clamped === false, `the server's score comes back (${answer.value.run.score})`);
  check(answer.value.hints.successes === 1 && answer.value.hints.hints === 0, `with the balance it counted (${answer.value.hints.hints} held, ${answer.value.hints.successes} counted)`);
  check(answer.value.board.runs === 1 && answer.value.board.period === '2026-10', `and the board row it wrote (${answer.value.board.runs} run, ${answer.value.board.period})`);
  check(answer.value.progress?.finished === 1, `and the progress it recorded (${answer.value.progress?.finished})`);
  const call = wired.fetch.calls[0];
  check(call.url === 'http://localhost:8090/runs' && call.init.method === 'POST', `posted to /runs (${call.init.method} ${call.url})`);
  const sent = JSON.parse(call.init.body);
  check(sent.calls.length === 1 && sent.calls[0] === 'Allemande Left in the Alamo Style', `with the transcript as it happened (${sent.calls.join(' → ')})`);
  check(sent.elapsedSeconds === 12 && sent.hintsUsed === 0 && sent.attempts === 1, 'and the run\'s own measured facts, not a verdict about them');

  // A CLAMP IS REPORTED SO THE PLAYER CAN BE TOLD, because a silently lowered score is the kind of thing that
  // looks like a bug in the game rather than a rule about claims.
  const clamped = deps('http://localhost:8090', { status: 200, body: { ...OUTCOME, run: { ...OUTCOME.run, score: 40, clamped: true } } });
  const lowered = await submitRun({ ...body, score: 999_999 }, clamped.api);
  check(lowered.ok === true && lowered.value.run.clamped === true && lowered.value.run.score === 40, `a clamped score comes back with the flag (${lowered.value.run.score}, clamped ${lowered.value.run.clamped})`);

  // A REFUSAL IS THE SERVER'S OWN SENTENCE, which the caller shows — and then keeps the local record instead,
  // because an outage or a stale drill must not cost the player the run.
  const stale = deps('http://localhost:8090', { status: 409, body: { error: { code: 'stale_drill', message: 'the drill in flight is 1:1, not 1:0' } } });
  const refused = await submitRun(body, stale.api);
  check(refused.ok === false && refused.failure.code === 'stale_drill' && refused.failure.message.includes('1:1'), `a refused run keeps the server's reason (${refused.failure?.code}: ${refused.failure?.message})`);

  // A RESPONSE WITH NO SCORE AND BALANCE IS NOT HALF-ADOPTED: a caller that adopted `undefined` would wipe the
  // local balance while telling the player the run was recorded.
  const empty = deps('http://localhost:8090', { status: 200, body: { run: { runId: 'run-1' } } });
  const malformed = await submitRun(body, empty.api);
  check(malformed.ok === false && malformed.failure.code === 'bad_response', `a run answer with no score or balance is refused (${malformed.failure?.code})`);
}

console.log('\n== 8. a Daily submission names its date and carries its line ==');
{
  const OUTCOME = {
    run: { runId: 'd-1', score: 42, elapsedSeconds: 70, scoreVersion: 1, clamped: false, duplicate: false },
    hints: { hints: 0, successes: 1, granted: false },
    board: { period: '2026-10-15', score: 42, runs: 1 },
    progress: null,
  };
  const wired = deps('http://localhost:8090', { status: 200, body: OUTCOME });
  const answer = await submitRun(
    { runId: 'd-1', mode: 'daily', levelIndex: 2, date: '2026-10-15', elapsedSeconds: 10, hintsUsed: 1, attempts: 0, calls: ['Allemande Left', 'Boys Run'], score: 50 },
    wired.api,
  );
  check(answer.ok === true && answer.value.board.period === '2026-10-15', `a Daily run is accepted against its day (${answer.value.board.period})`);
  check(answer.value.progress === null, 'and it reports no progress, because a Daily finishes no drill');
  const sent = JSON.parse(wired.fetch.calls[0].init.body);
  // ONE FACT, ONE NAME: the body's day field is `date`, the same word DESIGN.md 11's table uses for the query
  // parameter — a client that had to know `day` here and `date` there was the wart this probe was written to close.
  check(sent.date === '2026-10-15' && sent.day === undefined, `the body names the date and not a second word for it (${JSON.stringify(sent).slice(0, 60)}…)`);
  check(sent.drillId === undefined && sent.mode === 'daily', 'with no drillId, because a Daily answers no issued drill');
  check(sent.calls.length === 2 && sent.hintsUsed === 1, `and the line with the hints it spent (${sent.calls.length} calls, ${sent.hintsUsed} hint)`);
}

console.log('\n== 9. a press is recorded as it happens, and the server decides what it was worth ==');
{
  // THE REQUEST IS THE CONTRACT (DESIGN.md 11.1, A22): the server derives the verdict from the puzzle it issued, so
  // what this module may send is only the step and the call — never a verdict and never a time.
  const posted = deps('http://localhost:8090', { status: 200, body: { verdict: 'wrong', attempts: 2, presses: 3 } });
  const answer = await recordDrillAnswer('1:3', 0, 'Boys Run', posted.api);
  check(answer.ok === true && answer.value.verdict === 'wrong' && answer.value.attempts === 2, `the server's verdict and count come back (${answer.value?.verdict}, ${answer.value?.attempts})`);
  const sent = JSON.parse(posted.fetch.calls[0].init.body);
  check(posted.fetch.calls[0].url === 'http://localhost:8090/drill/answer' && posted.fetch.calls[0].init.method === 'POST', 'posted to the endpoint the route table names');
  check(sent.drillId === '1:3' && sent.step === 0 && sent.call === 'Boys Run', `carrying the step and the call (${JSON.stringify(sent)})`);
  check(sent.verdict === undefined && sent.atMs === undefined, 'and NOT a verdict or a time, which are the server\'s business');

  // A VERDICT THIS BUILD DOES NOT KNOW IS REFUSED RATHER THAN GUESSED: the caller shows feedback from it.
  const strange = deps('http://localhost:8090', { status: 200, body: { verdict: 'maybe', attempts: 0 } });
  const unknown = await recordDrillAnswer('1:3', 0, 'Boys Run', strange.api);
  check(unknown.ok === false && unknown.failure.code === 'bad_response', `an unknown verdict is refused (${unknown.failure?.code})`);
}

console.log('\n== 10. a hint is spent by the SERVER, and the balance it answers with is the one adopted ==');
{
  // THE SPEND IS THE EVENT (DESIGN.md 11.1, A23): the app asks before it takes the hint, because a hint the server
  // did not record is a run it refuses — so the request must name the CHALLENGE (level and day) and nothing else.
  const posted = deps('http://localhost:8090', { status: 200, body: { hints: { hints: 2, successes: 0 }, spent: 1 } });
  const answer = await spendHint(1, '2026-10-15', posted.api);
  check(answer.ok === true && answer.value.hints.hints === 2 && answer.value.spent === 1, `the balance the server holds comes back (${answer.value?.hints.hints} left)`);
  const sent = JSON.parse(posted.fetch.calls[0].init.body);
  check(posted.fetch.calls[0].url === 'http://localhost:8090/me/hints' && posted.fetch.calls[0].init.method === 'POST', 'posted to the endpoint the route table names');
  check(sent.levelIndex === 1 && sent.date === '2026-10-15' && Object.keys(sent).length === 2, `naming the challenge and nothing else (${JSON.stringify(sent)})`);
  const refused = deps('http://localhost:8090', { status: 409, body: { error: { code: 'no_hints', message: 'no hint is held' } } });
  const denied = await spendHint(1, '2026-10-15', refused.api);
  check(denied.ok === false && denied.failure.code === 'no_hints', `a refusal keeps the server's code, which the app shows instead of spending (${denied.failure?.code})`);
  const odd = deps('http://localhost:8090', { status: 200, body: { spent: 1 } });
  const unreadable = await spendHint(1, '2026-10-15', odd.api);
  check(unreadable.ok === false && unreadable.failure.code === 'bad_response', `and an answer with no balance is refused rather than adopted (${unreadable.failure?.code})`);
}console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
