// THE WHOLE PATH OVER HTTP, for a SIGNED-IN player in `emulate` mode: the four stages that landed, wired together.
//
// WHY THIS IS A GATE. Every rule the cheat-resistance stages added is measured in-process by a probe that calls the
// handler — but a handler is not the thing a browser talks to. What this adds is the WIRE: the mode discovery, a
// real sign-up and sign-in, a token that has to be verified by the same code the deployment runs, the press
// endpoint, the hint endpoint's refusal, and a run whose score comes back from the server. A regression in any of
// those (a route dropped from the table, a body field renamed, CORS, a handler that only works when called
// directly) is invisible to every other probe and total in a browser.
//
// IT IS ALSO THE ONLY PLACE THE CHAIN IS MEASURED END TO END FOR AN ACCOUNT: `auth-probe.mjs` drives the emulator
// over HTTP but stops at "the token serves a stored drill", and `runs-probe.mjs` drives the run handlers directly
// with a dev header.
//
// Usage: node api/test/end-to-end-probe.mjs
import { startDevServer } from '../src/dev-server.ts';
import { ROUTES, PLANNED_ENDPOINTS } from '../src/routes.ts';
import { levelAt, puzzleFor } from '../src/levels.ts';
import { utcDay } from 'dancing-squared-game';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const server = await startDevServer({ port: 0, auth: 'emulate' });
const base = `http://127.0.0.1:${server.port}`;
const json = (headers) => ({ 'content-type': 'application/json', ...headers });
const call = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, options);
  return { status: response.status, body: await response.json(), headers: response.headers };
};
const email = 'e2e@example.com';

try {
  console.log('== 1. what the process says it is ==');
  {
    const health = await call('/health');
    check(health.status === 200 && health.body.store === 'memory', `health answers for this store (${health.body.store})`);
    check(health.body.auth.mode === 'emulate' && health.body.auth.signin.includes('POST /auth/signin'), `and names the mode and the sign-in routes it serves (${health.body.auth.mode})`);
    check(health.body.endpoints.length === ROUTES.length && health.body.planned === PLANNED_ENDPOINTS, `with ${health.body.endpoints.length} of ${health.body.planned} endpoints served, which is the table it routes by`);
    check(health.body.endpoints.includes('POST /drill/answer') && health.body.endpoints.includes('POST /me/hints'), 'including the two the recording stages added');
  }

  console.log('\n== 2. an account, over HTTP, with no provider ==');
  let token = null;
  let playerId = null;
  {
    const signup = await call('/auth/signup', { method: 'POST', headers: json(), body: JSON.stringify({ email, password: 'correct horse' }) });
    check(signup.status === 200 && signup.body.confirmed === true, `signing up confirms immediately when the mode does not require a code (${signup.status})`);
    const signin = await call('/auth/signin', { method: 'POST', headers: json(), body: JSON.stringify({ email, password: 'correct horse' }) });
    token = signin.body.accessToken;
    playerId = signin.body.playerId;
    check(signin.status === 200 && typeof token === 'string' && typeof playerId === 'string', `and signing in issues a token for ${playerId}`);
    const refused = await call('/auth/signin', { method: 'POST', headers: json(), body: JSON.stringify({ email, password: 'wrong horse' }) });
    check(refused.status === 401 && refused.body.error.code === 'bad_credentials', `NEGATIVE CONTROL for the sign-in above: a wrong password is a 401 over the wire too (${refused.status})`);
  }

  const auth = { authorization: `Bearer ${token}` };
  // THE PROBE TIMES ITSELF, because the assertion below is about the SERVER's window: a claim of 1 s is only
  // distinguishable from the measurement if the measurement is smaller than it, and printing the probe's own wall
  // time is how a slow machine shows up as a failed premise instead of a mysterious number.
  const startedAt = performance.now();

  console.log('\n== 3. the drill is served to the TOKEN, and a press is recorded ==');
  let drill = null;
  let correct = null;
  {
    const served = await call('/drill/current?level=1', { headers: auth });
    drill = served.body.drill;
    check(served.status === 200 && drill !== null && served.body.demo === undefined, `the drill is served to a verified token (${drill?.id})`);
    const generated = puzzleFor(drill.seed, levelAt(1));
    if (!generated.ok) throw new Error(`the served seed does not generate: ${generated.reason}`);
    correct = generated.puzzle.steps.map((step) => step.moves[step.correctIndex].call);
    check(correct.length >= 1, `and this app regenerates it from the seed the server sent (${correct.length} step(s))`);

    // A WRONG PRESS FIRST, so the count this endpoint reports has something to count — and the verdict is the
    // SERVER's, derived from the puzzle it issued rather than from anything the press carried.
    const options = generated.puzzle.steps[0].moves;
    const wrong = options.find((_, index) => index !== generated.puzzle.steps[0].correctIndex).call;
    const bad = await call('/drill/answer', { method: 'POST', headers: json(auth), body: JSON.stringify({ drillId: drill.id, step: 0, call: wrong }) });
    check(bad.status === 200 && bad.body.verdict === 'wrong' && bad.body.attempts === 1, `NEGATIVE CONTROL for the press below: a wrong press is recorded and called wrong (${bad.body.verdict}, ${bad.body.attempts})`);
    const good = await call('/drill/answer', { method: 'POST', headers: json(auth), body: JSON.stringify({ drillId: drill.id, step: 0, call: correct[0] }) });
    check(good.status === 200 && good.body.verdict === 'correct' && good.body.attempts === 1, `and the right one is correct without adding to the count (${good.body.attempts})`);
    // ONE PRESS PER STEP, so the transcript the run carries is explained by what the server recorded (A22).
    for (let step = 1; step < correct.length; step++) {
      await call('/drill/answer', { method: 'POST', headers: json(auth), body: JSON.stringify({ drillId: drill.id, step, call: correct[step] }) });
    }
  }

  console.log('\n== 4. the hint endpoint, and the balance it refuses without ==');
  {
    const spent = await call('/me/hints', { method: 'POST', headers: json(auth), body: JSON.stringify({ levelIndex: 1, date: utcDay(new Date()) }) });
    check(spent.status === 409 && spent.body.error.code === 'no_hints', `a hint with no balance is refused rather than granted (${spent.status} ${spent.body.error?.code})`);
    const anonymous = await call('/me/hints', { method: 'POST', headers: json(), body: JSON.stringify({ levelIndex: 1, date: utcDay(new Date()) }) });
    check(anonymous.status === 401, `and the same call with no token is a 401 (${anonymous.status})`);
  }

  console.log('\n== 5. the run is scored on what the SERVER measured and counted ==');
  {
    const submitted = await call('/runs', {
      method: 'POST',
      headers: json(auth),
      // THE CLAIM IS DELIBERATELY A LIE IN BOTH FIELDS: 1 second where the window is longer, and zero wrong tries
      // where one was recorded. The answer is the server's numbers (A21, A22).
      body: JSON.stringify({ runId: 'e2e-run-1', mode: 'drill', levelIndex: 1, drillId: drill.id, elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls: correct }),
    });
    check(submitted.status === 200, `the run is accepted (${submitted.status} ${submitted.body.error?.code ?? ''})`);
    // THE CLAIM WAS 1 s AND THE WINDOW IS MILLISECONDS, so the number that comes back is the SERVER's — a client
    // cannot buy time by claiming it (A21). The elapsed may not exceed the wall time the probe itself observed.
    const wallSeconds = (performance.now() - startedAt) / 1000;
    check(wallSeconds < 1, `the probe's own round trip is under a second, so the claim is distinguishable (${wallSeconds.toFixed(2)} s)`);
    check(submitted.body.run.elapsedSeconds < 1 && submitted.body.run.elapsedSeconds <= wallSeconds + 1, `and the elapsed is the measured window, not the 1 s claimed (${submitted.body.run?.elapsedSeconds?.toFixed?.(2)} s against ${wallSeconds.toFixed(2)} s of wall time)`);
    check(submitted.body.run.score > 0 && submitted.body.progress?.finished === 1, `with a score and a finished drill (${submitted.body.run?.score} points, ${submitted.body.progress?.finished} finished)`);
    check(submitted.body.duplicate === undefined || submitted.body.run.duplicate === false, 'reported as a first submission');
  }

  console.log('\n== 6. the Daily, from the published challenge to a scored line ==');
  {
    const day = utcDay(new Date());
    const published = await call(`/puzzle?mode=daily&level=1&date=${day}`, { headers: auth });
    check(published.status === 200 && typeof published.body.daily?.seed === 'number', `today's challenge is published and readable (${published.status})`);
    const generated = puzzleFor(published.body.daily.seed, levelAt(1));
    if (!generated.ok) throw new Error(`the published seed does not generate: ${generated.reason}`);
    const line = generated.puzzle.solution;
    const scored = await call('/runs', {
      method: 'POST',
      headers: json(auth),
      body: JSON.stringify({ runId: 'e2e-daily-1', mode: 'daily', levelIndex: 1, date: day, elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls: line }),
    });
    check(scored.status === 200 && scored.body.board.runs === 1, `a Daily solved from the published seed is scored (${scored.status}, board ${scored.body.board?.score})`);
    check(scored.body.run.elapsedSeconds < 1, `on the window since the READ that stamped it, not the second it claimed (${scored.body.run?.elapsedSeconds?.toFixed?.(2)} s)`);
  }

  console.log('\n== 7. the boundary, re-measured at the end of the chain ==');
  {
    const header = await call('/drill/current?level=1', { headers: { 'x-dev-player': 'e2e@example.com' } });
    check(header.status === 200 && header.body.demo === true, `NEGATIVE CONTROL for every token above: a header that is not a token gets the anonymous demo in this mode (${header.status}, demo=${header.body.demo})`);
    const write = await call('/drill/answer', { method: 'POST', headers: json({ 'x-dev-player': 'e2e@example.com' }), body: JSON.stringify({ drillId: '1:0', step: 0, call: 'X' }) });
    check(write.status === 401, `and cannot write (${write.status})`);
    const noToken = await call('/runs', { method: 'POST', headers: json(), body: JSON.stringify({ runId: 'e2e-nope', mode: 'drill', levelIndex: 1, drillId: '1:0', elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls: [] }) });
    check(noToken.status === 401, `nor submit (${noToken.status})`);
  }

  console.log('\n== 8. giving up on a challenge is recorded, once, and does not bar the run ==');
  {
    const day = utcDay(new Date());
    const abandoned = await call('/daily/abandon', { method: 'POST', headers: json(auth), body: JSON.stringify({ levelIndex: 1, date: day }) });
    check(abandoned.status === 200 && abandoned.body.abandoned === true, `giving up is recorded (${abandoned.status})`);
    check(abandoned.body.hintsSpent === 0, `with the hints actually spent (${abandoned.body.hintsSpent})`);
    // IDEMPOTENT, AND IT KEEPS THE FIRST STAMP: giving up twice must not quietly move the moment the player walked
    // away, which is the only number this endpoint exists for.
    const again = await call('/daily/abandon', { method: 'POST', headers: json(auth), body: JSON.stringify({ levelIndex: 1, date: day }) });
    check(again.body.abandonedAtMs === abandoned.body.abandonedAtMs, `NEGATIVE CONTROL: giving up twice keeps the first stamp (${again.body.abandonedAtMs})`);

    // AND A LATER SUBMISSION IS STILL SCORED, because the app lets a player replay both lines after giving up: an
    // abandonment is a fact about the ATTEMPT, and the run is scored on its own terms.
    const published = await call(`/puzzle?mode=daily&level=1&date=${day}`, { headers: auth });
    const line = puzzleFor(published.body.daily.seed, levelAt(1)).puzzle.solution;
    const scored = await call('/runs', {
      method: 'POST',
      headers: json(auth),
      body: JSON.stringify({ runId: 'e2e-daily-2', mode: 'daily', levelIndex: 1, date: day, elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls: line }),
    });
    check(scored.status === 200 && scored.body.board.runs === 2, `and the run after it is scored as usual (${scored.status}, ${scored.body.board?.runs} runs on the board)`);

    const unread = await call('/daily/abandon', { method: 'POST', headers: json(auth), body: JSON.stringify({ levelIndex: 1, date: '2030-01-01' }) });
    check(unread.status === 409 && unread.body.error.code === 'no_attempt_row', `while a challenge nobody read has nothing to abandon (${unread.body.error?.code})`);
    const anonymous = await call('/daily/abandon', { method: 'POST', headers: json(), body: JSON.stringify({ levelIndex: 1, date: day }) });
    check(anonymous.status === 401, `and abandoning needs an identity (${anonymous.status})`);
  }
} finally {
  await server.close();
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
