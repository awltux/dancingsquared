// The API client's contract, PINNED — with a fake fetch and a fake storage, so no server and no browser.
//
// WHY THIS IS A GATE. This module is the game's only outbound path, and it is OPT-IN: with no base URL the game
// must be exactly the offline app it has always been, and with one every failure mode of a network — a refusal,
// a proxy's HTML error page, an unreachable host, a timeout — has to arrive as a typed answer rather than a
// crash or a wrong puzzle. None of that can be seen in a typecheck, and a browser can only show one of the five.
//
// Usage: node game/test/api-client-probe.mjs
import { advanceDrill, apiConfigured, dailyChallenge, deviceId, fetchLeaderboard, importLedger, issueDrill, ledgerEntryOf, normaliseBase, recordDailyMove, recordDrillAnswer, pollDaily, recordDrillReveal, replayDrill, spendHint, submitRun } from '../src/net/api.ts';
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

/**
 * A MINIMAL PUZZLE, hand-built rather than generated.
 *
 * WHY NOT GENERATE ONE: this probe measures the WIRE, so the fixture has to be a value that arrived as JSON, not a
 * board the engine just built — and a hand-built one makes a malformed variant (below) one field away. The board is
 * eight dancers because that is the engine's own invariant and `parsePuzzle` checks it; the POSITIONS are arbitrary
 * squares, because nothing here compares them.
 */
const board = (k) => ({
  dancers: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, couple: (i >> 1) + 1, gender: i % 2 === 0 ? 'boy' : 'girl', x: (i % 2) + k, y: (i >> 1) + k, heading: 0 })),
});
const PUZZLE = {
  mode: 'drill',
  seed: 42,
  level: { index: 1, poolSize: 10, depth: 1, optionCount: 2 },
  poolVersion: 'ms-1',
  start: board(1),
  goal: board(3),
  path: [board(1), board(3)],
  steps: [{ from: board(1), moves: [{ call: 'Boys Run', board: board(3) }, { call: 'Bend the Line', board: board(2) }], correctIndex: 0, after: board(3) }],
  solution: ['Boys Run'],
  shortest: 1,
  alternatePath: false,
  explored: 2,
};

const DRILL = {
  id: '1:3',
  index: 3,
  levelIndex: 1,
  seed: 42,
  poolVersion: 'ms-1',
  issuedAtMs: 1700000000000,
  puzzle: PUZZLE,
  resumed: false,
};
const deps = (base, scripted, initial) => {
  const store = storage(initial);
  const fetch = fetching(scripted);
  return { store, fetch, api: { base, fetch: fetch.impl, getItem: store.getItem, setItem: store.setItem, removeItem: store.removeItem, timeoutMs: 1000 } };
};

console.log('== 1. with no base configured, nothing is called at all ==');
{
  const wired = deps('', { status: 200, body: { drill: DRILL, regime: { finished: [], passed: [], length: 12 } } });
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
  const wired = deps('http://127.0.0.1:8090', { status: 200, body: { drill: DRILL, regime: { finished: [0, 1, 2, 3], passed: [0, 1], length: 12 } } });
  const answer = await issueDrill(2, wired.api);
  check(answer.ok === true, `a drill is issued (${answer.ok})`);
  check(answer.value.drill.id === '1:3' && answer.value.drill.seed === 42 && answer.value.drill.resumed === false, `and parsed (${answer.value.drill.id}, seed ${answer.value.drill.seed})`);
  check(answer.value.regime.finished.length === 4 && answer.value.regime.length === 12, `with the regime cells (${answer.value.regime.finished.length} done, ${answer.value.regime.passed.length} passed, of ${answer.value.regime.length})`);
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
  const dev = deps('http://127.0.0.1:8090', { status: 200, body: { drill: DRILL, regime: { finished: [0, 1, 2, 3], passed: [0, 1], length: 12 } } });
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
    // THE SESSION IS SEEDED AS THE STORED ITEM session.ts WRITES, so this probe and `auth-client-probe.mjs` cannot
  // disagree about where a token lives — the shape is imported rather than spelled.
  const wired = deps('http://localhost:8090', { status: 200, body: { drill: DRILL, regime: { finished: [], passed: [], length: 3 } } }, { [SESSION_KEY]: JSON.stringify({ accessToken: 'jwt-abc', refreshToken: 'r-1', playerId: 'emu:1', email: 'eve@example.com', expiresAtMs: Date.now() + 3_600_000 }) });
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
  const partial = deps('http://localhost:8090', { status: 200, body: { drill: { id: '1:0', index: 0, levelIndex: 1 }, regime: { finished: [], passed: [], length: 3 } } });
  const malformed = await issueDrill(1, partial.api);
  check(malformed.ok === false && malformed.failure.code === 'bad_response', `a drill with no seed is refused (${malformed.failure?.code})`);
  check(malformed.failure.message.includes('generate'), `and the sentence says why it matters (${malformed.failure?.message})`);

  // THE COMPLETE REGIME IS ITS OWN ANSWER, not an error with a status: the season being over is a state a screen
  // renders, and the caller needs to tell it apart from a server that is down.
  const complete = deps('http://localhost:8090', { status: 200, body: { drill: null, regime: { finished: [0,1,2,3,4,5,6,7,8,9,10,11], passed: [], length: 12 } } });
  const over = await issueDrill(1, complete.api);
  check(over.ok === false && over.failure.code === 'regime_complete', `a finished season is reported as such (${over.failure?.code})`);

  // A DRILL WITH NO PUZZLE IS REFUSED, and this is the check that moved when the client's generator went: the seed
  // alone used to be enough because `main.ts` could draw from it, and now it cannot. Absent and malformed are the
  // same refusal on purpose — a payload without boards is one nothing on this side can turn into a question.
  const noPuzzle = deps('http://localhost:8090', { status: 200, body: { drill: { ...DRILL, puzzle: undefined }, regime: { finished: [], passed: [], length: 3 } } });
  const noPuzzleAnswer = await issueDrill(1, noPuzzle.api);
  check(noPuzzleAnswer.ok === false && noPuzzleAnswer.failure.code === 'bad_response', `a drill with no puzzle at all is refused (${noPuzzleAnswer.failure?.code})`);

  // AND A PUZZLE THAT IS THERE BUT WRONG, one field at a time. The distinction that used to matter (absent means
  // "generate it") is gone, so every one of these is the same sentence to the player.
  for (const [broken, why] of [
    [{ ...PUZZLE, steps: 'none' }, 'no steps at all'],
    [{ ...PUZZLE, goal: { dancers: [] } }, 'a goal board with no dancers'],
    [{ ...PUZZLE, steps: [{ ...PUZZLE.steps[0], correctIndex: 5 }] }, 'a correct index past the options'],
    [{ ...PUZZLE, mode: 'challenge' }, 'a mode this app does not know'],
  ]) {
    const scripted = deps('http://localhost:8090', { status: 200, body: { drill: { ...DRILL, puzzle: broken }, regime: { finished: [], passed: [], length: 3 } } });
    const bad = await issueDrill(1, scripted.api);
    check(bad.ok === false && bad.failure.code === 'bad_response', `a puzzle with ${why} is refused as a bad response (${bad.failure?.code})`);
  }
}

console.log('\n== 5. the Daily is a READ of the published challenge ==');
{
  const CHALLENGE = { day: '2026-10-15', levelIndex: 2, seed: 1268207204, poolVersion: 'ms-1', publishedAtMs: 1700000000000, playable: true, puzzle: { ...PUZZLE, mode: 'daily', level: { index: 2, poolSize: 15, depth: 1, optionCount: 2 } } };
  const wired = deps('http://localhost:8090', { status: 200, body: { daily: CHALLENGE } });
  const answer = await dailyChallenge(2, '2026-10-15', wired.api);
  check(answer.ok === true && answer.value.seed === 1268207204, `the published seed is read (${answer.value?.seed})`);
  check(answer.value.playable === true && answer.value.levelIndex === 2, `with the level and playability (${answer.value?.levelIndex}, ${answer.value?.playable})`);
  // THE BOARDS COME WITH IT NOW: the client generates nothing, so a challenge without a puzzle would be unplayable.
  check(answer.value.puzzle?.mode === 'daily' && answer.value.puzzle?.steps.length === 1, `and the puzzle the server generated (${answer.value?.puzzle?.mode}, ${answer.value?.puzzle?.steps?.length} step(s))`);
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

  // THE DAILY GETS A LONGER WINDOW THAN EVERYTHING ELSE, because creating one outlives the shared 8 s timeout.
  // MEASURED: a Daily generation at the shipped level-1 pool is 9.4-15.1 s (DESIGN.md §7.1), so the ordinary first
  // press of the day expired before the work finished — reported as "the Today's Button seems to hang the app".
  // MEASURED HERE with a 1 ms window and a stub that answers after 40 ms: the Daily still succeeds, and the same
  // window still aborts a drill read, which is the NEGATIVE CONTROL — the override is the Daily's, not a global
  // loosening. THE STUB HONOURS THE SIGNAL, without which neither check measures anything: the probe's own fetch
  // helper ignores `init.signal`, so a first version of this check passed for both calls and reported the aborted one
  // as a malformed BODY rather than a timeout.
  const slowBody = { daily: { ...CHALLENGE } };
  const slowFetch = (_url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => slowBody }), 40);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('AbortError'));
      });
    });
  const tolerant = deps('http://localhost:8090', slowFetch);
  const tight = { ...tolerant.api, timeoutMs: 1 };
  const patient = await dailyChallenge(2, '2026-10-15', tight);
  check(patient.ok === true && patient.value.seed === CHALLENGE.seed, `a Daily that takes longer than the shared timeout is still allowed to arrive (${patient.ok}, seed ${patient.value?.seed})`);
  const intolerant = deps('http://localhost:8090', slowFetch);
  const aborted = await issueDrill(1, { ...intolerant.api, timeoutMs: 1 });
  check(aborted.ok === false && aborted.failure.code === 'unreachable', `NEGATIVE CONTROL: the same 1 ms window aborts a drill read (${aborted.failure?.code})`);
}

console.log('\n== 5c. a hint spend waits for the write the server is still doing ==');
{
  // REPORTED: "I earned a hint, but the hint button doesn't seem to do anything." MEASURED in the dev server's own log:
  // one `POST /me/hints` answered **200 after 88 295 ms** — the first hint in a process builds the hint's distance table,
  // which `api/src/levels.ts` measures at 79-91 s — while this client's shared 8 s window had given up long before. That
  // is worse than a failed request: the spend COMMITTED, so the player paid a hint they never saw, and every press after
  // it was refused for a balance they no longer held.
  //
  // THE WIDER WINDOW IS THE FIX, AND THIS IS THE CHECK: the stub answers well after the shared window and far inside the
  // hint's own, so a client that used the shared window is aborted and one that widens it arrives. The NEGATIVE CONTROL
  // is the same stub with a call that does not widen (`issueDrill`), which the identical 1 ms window aborts — so a
  // global loosening of the timeout would not pass both checks.
  const slowHint = (_url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => resolve({ ok: true, status: 200, json: async () => ({ hints: { hints: 0, successes: 0 }, spent: 1, call: 'Boys Run' }) }),
        40,
      );
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('AbortError'));
      });
    });
  const patient = deps('http://localhost:8090', slowHint);
  const hintAnswer = await spendHint(1, '2026-10-15', { ...patient.api, timeoutMs: 1 });
  check(
    hintAnswer.ok === true && hintAnswer.value.call === 'Boys Run',
    `a hint spend slower than the shared window still arrives, and names its call (${hintAnswer.ok}, ${hintAnswer.value?.call})`,
  );
  const narrow = deps('http://localhost:8090', slowHint);
  const shortCall = await issueDrill(1, { ...narrow.api, timeoutMs: 1 });
  check(shortCall.ok === false && shortCall.failure.code === 'unreachable', `NEGATIVE CONTROL: the same 1 ms window aborts a call that did not widen it (${shortCall.failure?.code})`);
}

console.log('\n== 5b. the Daily is POLLED in the BACKGROUND, never awaited as one long request ==');
{
  // REPORTED TWICE. First: "the app still hangs … it needs an asynchronous mechanism to poll if Todays Daily is
  // available." Then, of the first fix: "The call to fetchDaily never returns and the UI hangs on the promise … This
  // fetchDaily should trigger a background job on the server that generates the challenge and then the ui polls it
  // intermittently." The server side was already the trigger (`202 { ready: false }` + a deferred generation); what was
  // wrong was the CLIENT, which awaited the whole loop. `pollDaily` now reschedules itself on a timer and returns a
  // handle, so nothing waits on it.
  const CHALLENGE = { day: '2026-10-15', levelIndex: 2, seed: 1268207204, poolVersion: 'ms-1', publishedAtMs: 1700000000000, playable: true, puzzle: { ...PUZZLE, mode: 'daily', level: { index: 2, poolSize: 15, depth: 1, optionCount: 2 } } };
  const NOT_READY = { ...CHALLENGE, ready: false, puzzle: null, readings: [] };
  const READY = { ...CHALLENGE, ready: true };

  /** Run a poll to completion, collecting every answer it hands over. `stopAfter` cancels it after N answers. */
  const poll = (api, options, stopAfter = Infinity) =>
    new Promise((resolve) => {
      const answers = [];
      let handle = null;
      handle = pollDaily(2, '2026-10-15', api, {
        onAnswer: (answer, state) => {
          answers.push({ answer, state });
          if (answers.length >= stopAfter) {
            handle?.stop();
            resolve({ answers, stopped: true });
          } else if (!answer.ok || answer.value.ready || state.gaveUp) {
            resolve({ answers, stopped: false });
          }
        },
      }, options);
    });

  let asked = 0;
  const notReadyTwice = () => {
    asked++;
    return { status: asked <= 2 ? 202 : 200, body: { daily: asked <= 2 ? NOT_READY : READY } };
  };
  const wired = deps('http://localhost:8090', notReadyTwice);
  const finished = await poll(wired.api, { attempts: 10, intervalMs: 1 });
  const last = finished.answers[finished.answers.length - 1];
  check(last.answer.ok === true && last.answer.value.ready === true, `the poll ends on the challenge once it is ready (${last.answer.ok}, ready ${last.answer.value?.ready})`);
  check(last.answer.value.puzzle?.steps.length === 1, `with its boards (${last.answer.value?.puzzle?.steps?.length} step(s))`);
  check(asked === 3, `it asked THREE times for two "not ready" answers (${asked})`);
  check(finished.answers.length === 3, `and handed over every answer, so the panel can count the wait (${finished.answers.length})`);
  // THE HANDLE, NOT A PROMISE: the poll returns immediately and the caller owns the lifetime. That is the shape the
  // report asked for — "the UI polls it intermittently" — and it is what lets a level change cancel it.
  check(typeof pollDaily(2, '2026-10-15', wired.api, { onAnswer: () => {} }, { attempts: 1, intervalMs: 1 }).stop === 'function',
    'the poll returns a handle with stop(), so nothing is awaited');

  // A REFUSAL IS FINAL AND IS NOT RETRIED: a day nobody published, a foreign pool and an unreachable server all mean
  // "asking again will not help", and a poll that retried them would spin for a minute before saying so.
  let refusedCalls = 0;
  const refuse = () => {
    refusedCalls++;
    return { status: 404, body: { error: { code: 'no_published_daily', message: 'level 2 has no published challenge for 2026-10-16' } } };
  };
  const dead = deps('http://localhost:8090', refuse);
  const refused = await poll(dead.api, { attempts: 10, intervalMs: 1 });
  const refusal = refused.answers[refused.answers.length - 1];
  check(refusal.answer.ok === false && refusal.answer.failure.code === 'no_published_daily', `NEGATIVE CONTROL: a refusal comes back as itself (${refusal.answer.failure?.code})`);
  check(refusedCalls === 1, `NEGATIVE CONTROL: and is NOT retried — one request, not ten (${refusedCalls})`);

  // THE BUDGET IS BOUNDED: a server that is never ready is given up on rather than polled for ever, and the last answer
  // carries `gaveUp` so the panel can say the server did not finish rather than pretending nothing happened.
  let neverReady = 0;
  const stuck = deps('http://localhost:8090', () => {
    neverReady++;
    return { status: 202, body: { daily: NOT_READY } };
  });
  const gaveUp = await poll(stuck.api, { attempts: 3, intervalMs: 1 });
  const lastStuck = gaveUp.answers[gaveUp.answers.length - 1];
  check(lastStuck.state.gaveUp === true && lastStuck.answer.ok === true && lastStuck.answer.value.ready === false,
    `a server that never finishes is given up on, flagged, with its last answer (gaveUp ${lastStuck.state.gaveUp})`);
  check(neverReady === 3, `after exactly the attempt budget (${neverReady})`);

  // AND stop() ACTUALLY STOPS IT: this is the rule that makes a level change safe, because an answer for the level the
  // player left must not be applied to the regime they are on now.
  let afterStop = 0;
  const endless = deps('http://localhost:8090', () => {
    afterStop++;
    return { status: 202, body: { daily: NOT_READY } };
  });
  const cancelled = await poll(endless.api, { attempts: 100, intervalMs: 1 }, 2);
  const stoppedAt = afterStop;
  await new Promise((resolve) => setTimeout(resolve, 30));
  check(cancelled.stopped === true, 'the poll can be cancelled by its own caller');
  check(afterStop === stoppedAt, `NEGATIVE CONTROL: and NO further request follows the cancel (${afterStop} after ${stoppedAt})`);
}

console.log('\n== 6. advancing sends the drill id it is advancing ==');
{
  const wired = deps('http://localhost:8090', { status: 200, body: { regime: { finished: [0,1,2,3,4], passed: [0,1], length: 12 } } });
  const answer = await advanceDrill('1:4', wired.api);
  check(answer.ok === true && answer.value.regime.finished.length === 5, `an advance answers with the regime (${answer.value?.regime?.finished?.length} done)`);
  const call = wired.fetch.calls[0];
  check(call.url === 'http://localhost:8090/drill/advance', `posted to the path with no query (${call.url})`);
  check(call.init.method === 'POST' && JSON.parse(call.init.body).drillId === '1:4', `with the drill id in the body (${call.init.body})`);
  check(call.init.headers['content-type'] === 'application/json', 'and a JSON content type');
  const refused = deps('http://localhost:8090', { status: 409, body: { error: { code: 'stale_drill', message: 'this player has no drill in flight' } } });
  const again = await advanceDrill('1:4', refused.api);
  check(again.ok === false && again.failure.code === 'stale_drill', `a repeated advance is the server's refusal (${again.failure?.code})`);
}

console.log('\n== 6b. a REATTEMPT names the position, and reads back as the drill the block offers ==');
{
  // THE CLIENT SIDE OF THE SKIPPED-DRILL DEFECT: pressing a `done-not-passed` cell asks for a POSITION BY NUMBER, which
  // is the one thing the order otherwise refuses. The request shape is pinned here because the press itself is DOM and
  // this probe does not load `src/ui/`.
  const wired = deps('http://localhost:8090', {
    status: 200,
    body: { drill: { ...DRILL, index: 3, id: '1:3', replay: true, resumed: false }, regime: { finished: [0, 1, 2, 3], passed: [0, 2], length: 12 } },
  });
  const answer = await replayDrill(3, wired.api);
  check(answer.ok === true && answer.value.drill.index === 3, `a reattempt answers with the drill it asked for (${answer.value?.drill?.index})`);
  check(answer.ok === true && answer.value.drill.replay === true, 'and the answer says it is a reattempt, which is what the shell keys on');
  check(answer.ok === true && answer.value.regime.passed.length === 2, `and with the regime, whose pass set is what the block draws (${answer.value?.regime?.passed?.length} passed)`);
  const call = wired.fetch.calls[0];
  check(call.url === 'http://localhost:8090/drill/replay', `posted to its own path (${call.url})`);
  check(call.init.method === 'POST' && JSON.parse(call.init.body).index === 3, `with the POSITION in the body, not a drill id (${call.init.body})`);
  // A REFUSAL IS PASSED THROUGH, not pre-empted: the three causes are the server's own and its sentence is what the
  // player reads, so a client that filtered locally would be a second implementation of `replayDrill`.
  const refused = deps('http://localhost:8090', { status: 409, body: { error: { code: 'already_passed', message: 'position 3 was already passed' } } });
  const again = await replayDrill(3, refused.api);
  check(again.ok === false && again.failure.code === 'already_passed', `a refused reattempt is the server's code and sentence (${again.failure?.code})`);
  // AND A MALFORMED DRILL IS REFUSED rather than shown, for the reason every other read here refuses one.
  const malformed = deps('http://localhost:8090', { status: 200, body: { drill: { id: '1:3', index: 3 }, regime: {} } });
  const bad = await replayDrill(3, malformed.api);
  check(bad.ok === false && bad.failure.code === 'bad_response', `a drill with no boards is a bad response (${bad.failure?.code})`);
}

console.log('\n== 7. a completed run is handed over, and what comes back is what is adopted ==');
{
  const OUTCOME = {
    run: { runId: 'run-1', score: 100, elapsedSeconds: 12, scoreVersion: 1, clamped: false, duplicate: false, ranked: true },
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
    reveals: 0,
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
  // THE REVEAL COUNT IS DECLARED (A28), and it is checked as SENT rather than as adopted because it is the claim the
  // server unions with its own record: a client that dropped the field would submit a revealed run as a ranked one.
  const shown = deps('http://localhost:8090', { status: 200, body: OUTCOME });
  const revealed = await submitRun({ ...body, reveals: 2 }, shown.api);
  const revealedSent = JSON.parse(shown.fetch.calls[0].init.body);
  check(revealed.ok === true && revealedSent.reveals === 2, `a run that was shown two answers declares them (${revealedSent.reveals})`);
  // AND THE SERVER'S ANSWER ABOUT WHETHER IT COUNTED IS ADOPTED, because `granted: false` is the ordinary case and the
  // app could not otherwise tell an unranked run from one that simply earned nothing.
  const unranked = deps('http://localhost:8090', { status: 200, body: { ...OUTCOME, run: { ...OUTCOME.run, ranked: false } } });
  const kept = await submitRun({ ...body, reveals: 1 }, unranked.api);
  check(kept.ok === true && kept.value.run.ranked === false, 'and a run the server did not rank comes back saying so');
  // NEGATIVE CONTROL, MEASURED: the SAME reply with the flag ABSENT reads as ranked, which is the reading that keeps
  // an older server's reply from printing "not ranked" for a run it accepted. The check above is the only one a
  // `=== true` reading reddens, and it would redden it in the direction that matters — a ranked run reported unranked.
  const older = deps('http://localhost:8090', { status: 200, body: { ...OUTCOME, run: { runId: 'run-1', score: 100, elapsedSeconds: 12, scoreVersion: 1, clamped: false, duplicate: false } } });
  const silent = await submitRun(body, older.api);
  check(silent.ok === true && silent.value.run.ranked === true, 'while a reply with no flag at all reads as ranked rather than as a refusal');

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

console.log('\n== 9b. a REVEAL is posted as the event it is, and the server names the call ==');
{
  // THE BODY IS THE WHOLE CONTRACT (DESIGN.md §15 Q16, A28): which drill and which step — never the call it was
  // shown, because the server looks that up from the puzzle it issued, exactly as the verdict above is derived rather
  // than claimed. Sending a step and a call would be a second source for one fact.
  const posted = deps('http://localhost:8090', { status: 200, body: { call: 'Allemande Left', step: 0, reveals: 1, recorded: true } });
  const answer = await recordDrillReveal('1:3', 0, posted.api);
  check(answer.ok === true && answer.value.call === 'Allemande Left' && answer.value.recorded === true, `the server's own name for the step comes back (${answer.value?.call})`);
  const call = posted.fetch.calls[0];
  check(call.url === 'http://localhost:8090/drill/reveal' && call.init.method === 'POST', `posted to /drill/reveal (${call.init.method} ${call.url})`);
  const sent = JSON.parse(call.init.body);
  check(sent.drillId === '1:3' && sent.step === 0 && Object.keys(sent).length === 2, `carrying the drill and the step and nothing else (${JSON.stringify(sent)})`);
  // A SECOND PRESS OF THE SAME BUTTON IS NOT A SECOND PIECE OF HELP, and the flag is how the app could tell — the
  // server deduplicates by step, so the row holds one event however many times the player asked.
  const again = deps('http://localhost:8090', { status: 200, body: { call: 'Allemande Left', step: 0, reveals: 1, recorded: false } });
  const repeat = await recordDrillReveal('1:3', 0, again.api);
  check(repeat.ok === true && repeat.value.recorded === false, 'and a step already shown is answered as already shown');
  // A REVEAL THE SERVER DID NOT NAME IS REFUSED RATHER THAN FILLED IN, the same rule `spendHint` follows: a second
  // name for one fact is exactly the divergence the shared look-up exists to remove.
  const nameless = deps('http://localhost:8090', { status: 200, body: { reveals: 1, recorded: true } });
  const unnamed = await recordDrillReveal('1:3', 0, nameless.api);
  check(unnamed.ok === false && unnamed.failure.code === 'bad_response', `a reveal with no call is refused (${unnamed.failure?.code})`);
}

console.log('\n== 10. a hint is spent by the SERVER, and the balance it answers with is the one adopted ==');
{
  // THE SPEND IS THE EVENT (DESIGN.md 11.1, A23): the app asks before it takes the hint, because a hint the server
  // did not record is a run it refuses — so the request must name the CHALLENGE (level and day) and nothing else.
  const posted = deps('http://localhost:8090', { status: 200, body: { hints: { hints: 2, successes: 0 }, spent: 1, call: 'Boys Run' } });
  const answer = await spendHint(1, '2026-10-15', posted.api);
  check(answer.ok === true && answer.value.hints.hints === 2 && answer.value.spent === 1, `the balance the server holds comes back (${answer.value?.hints.hints} left)`);
  // THE NAME IS THE SERVER'S (A23's naming): it looked the call up from the line it RECORDED, so the app shows that
  // one rather than a second name of its own.
  check(answer.value.call === 'Boys Run', `with the call the server named (${answer.value?.call})`);
  const sent = JSON.parse(posted.fetch.calls[0].init.body);
  check(posted.fetch.calls[0].url === 'http://localhost:8090/me/hints' && posted.fetch.calls[0].init.method === 'POST', 'posted to the endpoint the route table names');
  check(sent.levelIndex === 1 && sent.date === '2026-10-15' && Object.keys(sent).length === 2, `naming the challenge and nothing else (${JSON.stringify(sent)})`);
  // A SPEND THAT NAMES NOTHING IS REFUSED RATHER THAN FILLED IN HERE. The server's own rule is that a hint which
  // cannot say anything is not a hint, so this answer cannot happen — and a client that invented a name would be the
  // second name the shared look-up exists to remove. NEGATIVE CONTROL: the plausible wrong rule, "the name stays the
  // client's", reads this answer as a spend and shows a call the server never recorded.
  const nameless = deps('http://localhost:8090', { status: 200, body: { hints: { hints: 2, successes: 0 }, spent: 1 } });
  const unnamed = await spendHint(1, '2026-10-15', nameless.api);
  check(unnamed.ok === false && unnamed.failure.code === 'bad_response', `NEGATIVE CONTROL: a spend with no name is refused (${unnamed.failure?.code})`);
  const refused = deps('http://localhost:8090', { status: 409, body: { error: { code: 'no_hints', message: 'no hint is held' } } });
  const denied = await spendHint(1, '2026-10-15', refused.api);
  check(denied.ok === false && denied.failure.code === 'no_hints', `a refusal keeps the server's code, which the app shows instead of spending (${denied.failure?.code})`);
  const odd = deps('http://localhost:8090', { status: 200, body: { spent: 1 } });
  const unreadable = await spendHint(1, '2026-10-15', odd.api);
  check(unreadable.ok === false && unreadable.failure.code === 'bad_response', `and an answer with no balance is refused rather than adopted (${unreadable.failure?.code})`);
}

console.log('\n== 11. the device ledger is imported as HISTORY, and an empty one is never sent ==');
{
  // THE MAPPING IS THE RULE (DESIGN.md 11.1, A26). Locally the two modes name the transcript differently — a Drill
  // keeps one call per step in `options`, a Daily keeps its line in `moves` — and the imported row has a single
  // `calls` list, where a wrong mapping is invisible: an absent transcript is TOLERATED by the endpoint and stored
  // as history with no line, so the run is kept and its line silently lost.
  const record = (over) => ({
    runId: 'r1',
    mode: 'drill',
    levelIndex: 1,
    poolVersion: 'ms-1',
    seed: 42,
    position: 0,
    options: ['Boys Run', 'Bend the Line'],
    elapsedSeconds: 12.5,
    attempts: 1,
    score: 80,
    scoreVersion: 1,
    recordedAtMs: 1_700_000_000_000,
    ...over,
  });
  const drill = ledgerEntryOf(record({}));
  check(JSON.stringify(drill.calls) === '["Boys Run","Bend the Line"]', `a Drill's transcript is its \`options\` (${JSON.stringify(drill.calls)})`);
  check(drill.date === null && drill.hintsUsed === 0, 'and it has no date and no hint spend, which only a Daily has');
  // NEGATIVE CONTROL: a mapping that read ONE field for both modes sends the Daily with an empty `calls`, and the
  // endpoint accepts it — so ONLY this check fails that rule, and it fails on the second line below.
  const daily = ledgerEntryOf(record({ runId: 'r2', mode: 'daily', day: '2026-10-16', moves: ['Boys Run'], hintsUsed: 1, options: undefined, position: undefined }));
  check(JSON.stringify(daily.calls) === '["Boys Run"]', `NEGATIVE CONTROL: a Daily's transcript is its \`moves\` (${JSON.stringify(daily.calls)})`);
  check(daily.date === '2026-10-16' && daily.hintsUsed === 1, 'and it carries the day and the hints it spent');

  // THE REQUEST IS THE CONTRACT: the whole ledger under `runs`, as the endpoint's own shape rather than the local
  // record's, and the counts back — which are how a first sign-in is told from a retry.
  const wired = deps('http://localhost:8090', { status: 200, body: { imported: 1, skipped: 1, total: 2, unverified: true } });
  const answer = await importLedger([record({}), record({ runId: 'r2', mode: 'daily', day: '2026-10-16', moves: ['Boys Run'], hintsUsed: 1, options: undefined })], wired.api);
  check(wired.fetch.calls[0].url === 'http://localhost:8090/me/runs:bulk' && wired.fetch.calls[0].init.method === 'POST', `posted to the endpoint the route table names (${wired.fetch.calls[0].init.method})`);
  const sent = JSON.parse(wired.fetch.calls[0].init.body);
  check(Array.isArray(sent.runs) && sent.runs.length === 2, `carrying the whole ledger under \`runs\` (${sent.runs?.length} of 2)`);
  check(sent.runs[1].date === '2026-10-16' && sent.runs[1].calls.length === 1 && sent.runs[1].options === undefined, `in the endpoint's shape and not the record's (${JSON.stringify(sent.runs[1])})`);
  check(answer.ok === true && answer.value.imported === 1 && answer.value.skipped === 1 && answer.value.total === 2, `and the counts come back (${answer.value?.imported} imported, ${answer.value?.skipped} skipped)`);

  // AN EMPTY LEDGER IS ANSWERED LOCALLY, with no request: the endpoint refuses one (`bad_ledger`) and A25's refusal
  // tally is applied at the route table, so a client that posted it on every first sign-in would put the COMMONEST
  // case into the operator's signal that someone is probing. NEGATIVE CONTROL: the naive client posts `{runs: []}`,
  // and the fetch count is the only thing that shows it.
  const empty = deps('http://localhost:8090', { status: 400, body: { error: { code: 'bad_ledger', message: 'the ledger is empty' } } });
  const nothing = await importLedger([], empty.api);
  check(nothing.ok === false && nothing.failure.code === 'nothing_to_import', `an empty ledger is answered without asking (${nothing.failure?.code})`);
  check(empty.fetch.calls.length === 0, `NEGATIVE CONTROL: and nothing was sent (${empty.fetch.calls.length} fetches)`);

  // THE COUNTS ARE THE ANSWER, so an answer without them is not read as "nothing was imported".
  const silent = deps('http://localhost:8090', { status: 200, body: { unverified: true } });
  const unread = await importLedger([record({})], silent.api);
  check(unread.ok === false && unread.failure.code === 'bad_response', `an answer with no counts is refused (${unread.failure?.code})`);
}

console.log('\n== 12. a Daily move is recorded as a MOVE, not as a line ==');
{
  // THE REQUEST IS THE CONTRACT (DESIGN.md 11.1, A22's Daily half). The server derives the line by replaying these
  // moves through the same session this app drives, so the client must send what the player DID — a client that
  // sent its line instead would be handing over the number §6 prices (`wasteFactor`), which is the lie this
  // endpoint exists to make impossible.
  const posted = deps('http://localhost:8090', { status: 200, body: { recorded: 4 } });
  const answer = await recordDailyMove(1, '2026-10-16', 'add', 'Boys Run', posted.api);
  check(posted.fetch.calls[0].url === 'http://localhost:8090/daily/move' && posted.fetch.calls[0].init.method === 'POST', `posted to the endpoint the route table names (${posted.fetch.calls[0].init.method})`);
  const sent = JSON.parse(posted.fetch.calls[0].init.body);
  check(sent.move === 'add' && sent.call === 'Boys Run' && sent.levelIndex === 1 && sent.date === '2026-10-16', `carrying the move, the call and the challenge (${JSON.stringify(sent)})`);
  check(sent.calls === undefined, 'and NOT a line, which is the number the server is deriving for itself');
  check(answer.ok === true && answer.value.recorded === 4, `and the server's count comes back (${answer.value?.recorded})`);

  // AN UNDO NAMES NO CALL, and it does not send a null one either: a field that is always null is a field a reader
  // has to interpret, and the server's own log makes the same distinction between an add and the other two.
  const undone = deps('http://localhost:8090', { status: 200, body: { recorded: 5 } });
  await recordDailyMove(1, '2026-10-16', 'undo', null, undone.api);
  const undoBody = JSON.parse(undone.fetch.calls[0].init.body);
  // NEGATIVE CONTROL: the plausible wrong rule, "always name a call, null when there is none", sends `call: null`
  // here and fails exactly this check — the add above agrees with it, which is why nothing else catches it.
  check(undoBody.move === 'undo' && Object.keys(undoBody).length === 3, `NEGATIVE CONTROL: an undo carries three keys and no call (${JSON.stringify(undoBody)})`);

  // THE COUNT IS THE ANSWER, so an answer without it is not read as a zero.
  const silent = deps('http://localhost:8090', { status: 200, body: {} });
  const unread = await recordDailyMove(1, '2026-10-16', 'redo', null, silent.api);
  check(unread.ok === false && unread.failure.code === 'bad_response', `an answer with no count is refused (${unread.failure?.code})`);
}

console.log('\n== 13. the board is one request, and a PARTIAL one is not shown as the standings ==');
{
  // THE REQUEST IS THE CONTRACT (DESIGN.md §6, §11): the period is the CALLER's, because a Daily board is a day and a
  // Drill board is a season — a client that derived its own would ask for a board nobody was on.
  const posted = deps('http://localhost:8090', { status: 200, body: { board: { mode: 'drill', levelIndex: 2, period: '2026-10', entries: [{ playerId: 'p1', score: 120, runs: 3 }, { playerId: 'p2', score: 40, runs: 1 }], examined: 2, truncated: false } } });
  const answer = await fetchLeaderboard('drill', 2, '2026-10', posted.api);
  check(posted.fetch.calls[0].url === 'http://localhost:8090/leaderboard?mode=drill&level=2&period=2026-10' && posted.fetch.calls[0].init.method === 'GET', `asked for one board, naming all three facts (${posted.fetch.calls[0].url})`);
  check(answer.ok === true && answer.value.entries.length === 2 && answer.value.entries[0].playerId === 'p1' && answer.value.entries[0].score === 120, `and the ranks come back in the server's order (${answer.value?.entries?.map((each) => each.playerId).join(',')})`);
  check(answer.value.mode === 'drill' && answer.value.levelIndex === 2 && answer.value.period === '2026-10', 'with the board named, so the screen cannot show one board under another one\'s heading');
  check(answer.value.examined === 2 && answer.value.truncated === false, `and the size of the read (${answer.value?.examined}, truncated ${answer.value?.truncated})`);

  // A PARTIAL RANKING IS REPORTED AS PARTIAL. The server ranks the partition it could read, and its sort key is the
  // player rather than the score — so a board past its cap is a cut-off list, and a client that dropped this flag
  // would present one as the standings. NEGATIVE CONTROL: the plausible wrong rule, "a board answered is a board
  // complete", reads `truncated` as false here and fails exactly this check.
  const capped = deps('http://localhost:8090', { status: 200, body: { board: { mode: 'drill', levelIndex: 2, period: '2026-10', entries: [{ playerId: 'p1', score: 120, runs: 3 }], examined: 1000, truncated: true } } });
  const partial = await fetchLeaderboard('drill', 2, '2026-10', capped.api);
  check(partial.value.truncated === true && partial.value.examined === 1000, `NEGATIVE CONTROL: a truncated board is reported as truncated (${partial.value?.examined} rows read, truncated ${partial.value?.truncated})`);

  // AN ANSWER THIS APP CANNOT SHOW IS REFUSED RATHER THAN HALF-READ: no list, and a rank that is not one.
  for (const [body, why] of [[{ board: { mode: 'drill', levelIndex: 1, period: '2026-10' } }, 'a board with no entries'], [{ board: { mode: 'drill', levelIndex: 1, period: '2026-10', entries: [{ playerId: 'p1', score: 'lots', runs: 1 }], examined: 1 } }, 'a rank whose score is not a number']]) {
    const odd = deps('http://localhost:8090', { status: 200, body });
    const refused = await fetchLeaderboard('drill', 1, '2026-10', odd.api);
    check(refused.ok === false && refused.failure.code === 'bad_response', `${why} is refused (${refused.failure?.code})`);
  }
  // AND AN EMPTY BOARD IS A BOARD: "nobody has played this yet" is an answer, not a failure to read one.
  const nobody = deps('http://localhost:8090', { status: 200, body: { board: { mode: 'daily', levelIndex: 1, period: '2026-10-16', entries: [], examined: 0, truncated: false } } });
  const empty = await fetchLeaderboard('daily', 1, '2026-10-16', nobody.api);
  check(empty.ok === true && empty.value.entries.length === 0 && empty.value.examined === 0, `an empty board is shown as empty (${empty.status ?? ''}${empty.value?.entries?.length} entries)`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
