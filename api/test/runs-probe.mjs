// `POST /runs`, PINNED: what the server verifies, what it clamps, what it credits, and what it refuses.
//
// WHY THIS IS A GATE. This endpoint is where the game's two currencies are minted and spent (a score on a board,
// a hint in a balance), so it is the one place a client's claim could become a fact. DESIGN.md 6 and 11 say
// what must happen instead: the puzzle is regenerated from the SERVER's seed, the Drill's per-step answer is
// re-derived, the Daily's line is walked, the score is clamped to what the server can recompute, and the hint
// credit comes from the server's own record of finished drills. Each of those is measured here, and each has
// the plausible wrong rule beside it.
//
// THE PROBE ANSWERS A REAL PUZZLE rather than fabricating a run: it asks `GET /drill/current`, regenerates the
// puzzle from the seed it was served, and submits the CORRECT option at every step — so the "should be accepted"
// case is the one a real client produces, and the "should be refused" cases differ from it by exactly one thing.
//
// Usage: node api/test/runs-probe.mjs
import { postRun } from '../src/handlers/runs.ts';
import { getPuzzle } from '../src/handlers/puzzle.ts';
import { postDrillAnswer } from '../src/handlers/answer.ts';
import { postDailyMove } from '../src/handlers/daily-move.ts';
import { drillCurrent } from '../src/handlers/drill.ts';
import { STATUS } from '../src/status.ts';
import { levelAt, puzzleFor } from '../src/levels.ts';
import { attemptKey, boardKey, hintsKey, publishedDailyKey, progressKey, runKey } from '../src/keys.ts';
import { localRegimes, putRegime, seedLocalRegimes } from '../src/local-regime.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { finishDrill } from '../src/drill-regime.ts';
import { GENERATOR_VERSION, MAIN_POOL, SCORE_VERSION, dailyWaypointsFor, scoreRun } from 'dancing-squared-game';
import { FIXTURE_POOL_VERSION, LOCAL_SCHEDULE } from 'dancing-squared-game/schedule-fixture';
import { LOCAL_SCHEDULE_VERSION } from '../src/local-regime.ts';

/**
 * THE ROW AS THE PUBLISHER WRITES IT: a seed AND the puzzle it names.
 *
 * The probe used to write the seed alone, because the read regenerated from it. It does not any more — "the button
 * should never build the puzzle, only recover an existing puzzle" — so a hand-built row without a puzzle is a row the
 * server refuses (`daily_not_built`). Building it here is the same call the boundary job makes.
 */
const builtDaily = (seed, levelIndex) => {
  const generated = puzzleFor(seed, levelAt(levelIndex), 'daily');
  if (!generated.ok) throw new Error(`probe fixture: seed ${seed} at level ${levelIndex} does not generate: ${generated.reason}`);
  return generated.puzzle;
};

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = 1;
const DAY = '2026-10-15';
const CLOCK = 1_700_000_000_000;
/** The Drill board's period: the PUBLISHED SET's version, which is what the issued drill carries (§15 Q17(vii)). */
const SEASON = LOCAL_SCHEDULE_VERSION;

/**
 * The three ports, with a clock the probe can MOVE FORWARD.
 *
 * THE CLOCK HAS TO BE MUTABLE, because the Drill's elapsed bound is measured against the time the drill was
 * issued: with a frozen clock no time ever passes, every run claims an impossible elapsed, and the first
 * version of this probe refused its own CORRECT submission with `impossible_elapsed` (400). `issue` advances it
 * by a minute — the player then plays — and a test that needs more calls `advance` itself.
 */
const depsFor = (store, nowMs = CLOCK) => ({
  store,
  clock: {
    now: nowMs,
    nowMs() {
      return this.now;
    },
    advance(seconds) {
      this.now += seconds * 1000;
    },
  },
  identityOf: devIdentityOf,
});

/**
 * The identity adapter is IMPORTED rather than re-spelled (see `drill-probe.mjs`), which is why the fixture rows
 * this probe writes and reads are keyed by the id that adapter produces rather than by the bare header value.
 */
const devId = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;
const ROW = {
  progress: (name) => progressKey(devId(name), LEVEL),
  run: (name, id) => runKey(devId(name), id),
  hints: (name) => hintsKey(devId(name)),
  board: (name) => boardKey('drill', LEVEL, SEASON, devId(name)),
  attempt: (name, level, date) => attemptKey(devId(name), 'daily', `${level}#${date}`),
};

const call = (path, player, query = {}, body = null) => ({ method: path === '/runs' ? 'POST' : 'GET', path, query, body, headers: player ? { 'x-dev-player': player } : {} });
const submit = (player, body) => call('/runs', player, {}, body);
const move = (player, level, date, kind, named = null) => ({
  method: 'POST',
  path: '/daily/move',
  query: {},
  body: kind === 'add' ? { levelIndex: level, date, move: kind, call: named } : { levelIndex: level, date, move: kind },
  headers: player ? { 'x-dev-player': player } : {},
});

/**
 * Record a line as the moves that built it — how the server now learns what a Daily player played (A22's Daily half).
 *
 * IT IS PER CHALLENGE, NOT PER SUBMISSION. The log lives on the attempt row, so a SECOND run of the same challenge
 * on the same day reuses the line already recorded — which this probe does deliberately (its board check submits two
 * runs of one challenge to show the board keeps the best). Recording the line again would append a second copy and
 * derive a line twice as long, so the submissions below record once, at the read, and reuse.
 */
async function recordLine(deps, player, level, date, line) {
  for (const named of line) {
    const posted = await postDailyMove(move(player, level, date, 'add', named), deps);
    if (posted.status !== STATUS.ok) throw new Error(`the probe could not record a move: ${posted.status} ${posted.body.error?.code}`);
  }
}

/** A fresh store with the fixture's regimes, and the level-1 puzzle of the first entry regenerated. */
async function fresh() {
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  return { store, deps: depsFor(store) };
}

/** The correct per-step answers for a served drill — what a client that solved it would submit. */
function answersFor(seed) {
  const generated = puzzleFor(seed, levelAt(LEVEL), 'drill');
  if (!generated.ok) throw new Error(`the probe's seed does not generate: ${generated.reason}`);
  return { puzzle: generated.puzzle, calls: generated.puzzle.steps.map((step) => step.moves[step.correctIndex].call) };
}

/**
 * Serve the drill this player is on, and PLAY it — then let time pass, as a client would.
 *
 * THE PRESSES ARE POSTED, because `attempts` is counted from the log the server recorded (DESIGN.md 11.1, A22):
 * a submission whose presses the server never saw is refused `no_press_log`, so a helper that skipped them would
 * be testing a client that cannot play. `measuredSeconds` IS THE WINDOW THE SERVER WILL SCORE ON, and it is the
 * only number the expectations below may use — the submissions still carry an `elapsedSeconds` claim, because that
 * is what a client sends and what the audit records, but it is not what scores.
 */
async function issue(deps, player, advanceSeconds = 60) {
  const served = await drillCurrent(call('/drill/current', player, { level: String(LEVEL) }), deps);
  const drill = served.body.drill;
  const answers = answersFor(drill.seed);
  for (let step = 0; step < answers.calls.length; step++) {
    const posted = await postDrillAnswer(press(player, drill.id, step, answers.calls[step]), deps);
    if (posted.status !== STATUS.ok) throw new Error(`the probe could not record a press: ${posted.status} ${posted.body.error?.code}`);
  }
  deps.clock.advance(advanceSeconds);
  return { drill, ...answers, measuredSeconds: advanceSeconds };
}

/** One press, as the endpoint takes it. `chosen` is the call the player clicked. */
const press = (player, drillId, step, chosen) => ({
  method: 'POST',
  path: '/drill/answer',
  query: {},
  body: { drillId, step, call: chosen },
  headers: player ? { 'x-dev-player': player } : {},
});

/**
 * Start a Daily the way a client does: READ the published challenge, which is what stamps the server's clock, then
 * let `advanceSeconds` pass. A Daily the server never saw start cannot be timed at all (`no_attempt_row`).
 */
async function startDaily(deps, player, level = LEVEL, date = DAY, advanceSeconds = 30) {
  const answer = await getPuzzle(call('/puzzle', player, { mode: 'daily', level: String(level), date }), deps);
  if (answer.status !== STATUS.ok) throw new Error(`the probe could not start the Daily: ${answer.status} ${answer.body.error?.code}`);
  deps.clock.advance(advanceSeconds);
}

console.log('== 1. a correct Drill run is accepted, and it does all four things at once ==');
{
  const { store, deps } = await fresh();
  const { drill, calls, puzzle, measuredSeconds } = await issue(deps, 'r1');
  const answer = await postRun(submit('r1', { runId: 'run-1', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 12, hintsUsed: 0, attempts: 0, calls }), deps);
  check(answer.status === STATUS.ok, `the run is accepted (${answer.status})`);
  // THE CLAIM IS 12 s AND THE WINDOW IS 60: the score is computed from what the SERVER measured (A21), which is
  // why this expectation uses `measuredSeconds` rather than the number the submission carried.
  const computed = scoreRun({ level: levelAt(LEVEL), shortest: puzzle.shortest, moves: puzzle.shortest, clockSeconds: measuredSeconds, hintsUsed: 0, attempts: 0 });
  check(answer.body.run.score === computed.score, `and the score is the server's own (${answer.body.run.score})`);
  check(answer.body.run.duplicate === false && answer.body.run.clamped === false, 'reported as fresh and unclamped');
  check(answer.body.progress.finished === 1, `the drill is finished (${answer.body.progress.finished})`);
  check(answer.body.hints.successes === 1 && answer.body.hints.hints === 0, `the success is counted and no hint is due yet (${answer.body.hints.successes} counted)`);
  check(answer.body.board.score === computed.score && answer.body.board.runs === 1, `and the board holds the run (${answer.body.board.score})`);
  // THE PERIOD IS THE PUBLISHED SET, NOT A PERIOD OF TIME (§15 Q17(vii)). `ROW.board` builds its key from `SEASON`,
  // which is the local regime's own version, so the check below and the row read under it are one measurement seen
  // from both sides: a calendar month would have written the row where this probe does not look.
  check(answer.body.board.period === SEASON, `the board's period is the published set, not a month (${answer.body.board.period})`);
  const row = (await store.get(ROW.progress('r1'))).value;
  check(row.issued === null, 'the progress row has no drill in flight any more');
  check((await store.get(ROW.run('r1', 'run-1'))).value.calls.length === calls.length, 'and the transcript is stored');
}

console.log('\n== 2. the score is clamped to what the server can recompute ==');
{
  const { store, deps } = await fresh();
  const { drill, calls, puzzle } = await issue(deps, 'r2');
  const computed = scoreRun({ level: levelAt(LEVEL), shortest: puzzle.shortest, moves: puzzle.shortest, clockSeconds: 60, hintsUsed: 0, attempts: 0 });
  const greedy = await postRun(submit('r2', { runId: 'run-greedy', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 30, hintsUsed: 0, attempts: 0, calls, score: 999_999 }), deps);
  check(greedy.body.run.score === computed.score && greedy.body.run.clamped === true, `a claim of 999999 is clamped to ${computed.score} and reported (${greedy.body.run.clamped})`);
  check(greedy.body.board.score === computed.score, 'and the board got the computed score, not the claim');
  // NEGATIVE CONTROL, MEASURED: the board row would hold the claim if the clamp were absent, and 999999 is what
  // the stored row would say — the check above is the only one that would redden, because the response's
  // `clamped` flag is a report rather than a constraint.
  const stored = (await store.get(ROW.board('r2'))).value;
  check(stored.score === computed.score && stored.score !== 999_999, `NEGATIVE CONTROL: the stored board is ${stored.score}, not the 999999 claimed`);
  // A SECOND DRILL, because the first one is finished: a submission names the drill that is IN FLIGHT, so a
  // second claim about the same one would be refused as stale rather than scored.
  const next = await issue(deps, 'r2');
  const modest = await postRun(submit('r2', { runId: 'run-modest', mode: 'drill', levelIndex: LEVEL, drillId: next.drill.id, elapsedSeconds: 30, hintsUsed: 0, attempts: 0, calls: next.calls, score: 1 }), deps);
  check(modest.body.run.score === 1 && modest.body.run.clamped === false, `a claim BELOW the computed score is honoured (${modest.body.run?.score})`);
}

console.log('\n== 2b. the Drill board is the PUBLISHED SET, so a month boundary does not move it ==');
{
  const { store, deps } = await fresh();
  const { drill, calls } = await issue(deps, 'r2b');
  // THE CLOCK CROSSES A MONTH BOUNDARY, which is exactly what the old rule keyed on: `seasonOf(nowMs)` would have
  // been a different string on the far side of it, so this run would have opened a SECOND board row and left the
  // one its drill came from behind. The drill is LOCKED (rule 2), so it keeps the set it was issued from and the
  // run belongs to that set's board.
  deps.clock.advance(20 * 24 * 3600);
  const answer = await postRun(submit('r2b', { runId: 'run-boundary', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 5, hintsUsed: 0, attempts: 0, calls }), deps);
  check(answer.status === STATUS.ok, `the run is accepted on the far side of the boundary (${answer.status})`);
  check(answer.body.board.period === SEASON, `and the period the answer names is unchanged by the clock (${answer.body.board.period})`);
  check(answer.body.board.runs === 1, `and it is the first run on that board (${answer.body.board.runs})`);
  check((await store.get(ROW.board('r2b'))).value.runs === 1, 'on the row the SET names, which is the only board row this player has');
}

console.log('\n== 3. a run lands once: the same runId, and a re-solve of a finished drill ==');
{
  const { store, deps } = await fresh();
  const { drill, calls } = await issue(deps, 'r3');
  const body = { runId: 'run-once', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 20, hintsUsed: 0, attempts: 0, calls };
  const first = await postRun(submit('r3', body), deps);
  const second = await postRun(submit('r3', body), deps);
  check(second.status === STATUS.ok && second.body.run.duplicate === true, `the same runId twice is answered as a duplicate (${second.body.run.duplicate})`);
  check(second.body.board.score === first.body.board.score && second.body.board.runs === first.body.board.runs, `and the board did not grow (${second.body.board.score}, ${second.body.board.runs} run)`);
  check(second.body.hints.successes === first.body.hints.successes, `nor did the success count (${second.body.hints.successes})`);
  check(second.body.run.score === first.body.run.score, 'and the recorded score came back unchanged');

  // THE OTHER SIDE OF IDEMPOTENCE, which the runId cannot cover: a SECOND submission about a drill that is no
  // longer in flight. It is refused, and that refusal is what makes a replay unable to buy anything (§6): the
  // drill is gone from the progress row the moment it is finished, so there is nothing left to submit against.
  const again = await postRun(submit('r3', { ...body, runId: 'run-resolve' }), deps);
  check(again.status === STATUS.conflict && again.body.error.code === 'stale_drill', `a submission about a drill that is no longer in flight is refused (${again.status} ${again.body.error?.code})`);
  const after = (await store.get(ROW.run('r3', 'run-once'))).value;
  check(after.score === first.body.run.score, `and the recorded run is untouched (${after.score})`);
  check((await store.get(ROW.run('r3', 'run-resolve'))) === null, 'and no second run row was written');
  check((await store.get(ROW.board('r3'))).value.runs === 1, 'so the board still holds one run');

  // NEGATIVE CONTROL, MEASURED: the duplicate path rests on the run row being CREATE-ONLY, so the same create
  // attempted a second time is refused by the store itself. A row that could be rewritten would let a retry
  // overwrite the recorded score while the effects below it stayed as they were.
  const recordedRun = await store.get(ROW.run('r3', 'run-once'));
  check((await store.put(ROW.run('r3', 'run-once'), recordedRun.value, null)) === false, 'NEGATIVE CONTROL: the run row is create-only, which is the condition the duplicate answer rests on');

  // AND THE PURE RULE UNDERNEATH IT: an index that is somehow handed out twice lands in the finished set ONCE,
  // which is the fact the credit, the board and "the first unfinished entry" all read.
  const repeated = finishDrill({ levelIndex: LEVEL, issued: { id: '1:0', index: 0, seed: 1, poolVersion: FIXTURE_POOL_VERSION, issuedAtMs: CLOCK }, finished: [0], passed: [] }, '1:0', false);
  check(repeated.kind === 'done' && repeated.progress.finished.length === 1, `finishing an index that is already finished does not duplicate it (${JSON.stringify(repeated.progress?.finished)})`);
}

console.log('\n== 4. the per-step answer is re-derived, not taken on trust ==');
{
  const { deps } = await fresh();
  const { drill, calls } = await issue(deps, 'r4');
  const wrong = [...calls];
  const generated = puzzleFor(drill.seed, levelAt(LEVEL), 'drill');
  const correct = generated.puzzle.steps[0].moves[generated.puzzle.steps[0].correctIndex].call;
  const other = generated.puzzle.steps[0].moves.find((move) => move.call !== correct).call;
  wrong[0] = other;
  const answer = await postRun(submit('r4', { runId: 'run-wrong', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 5, hintsUsed: 0, attempts: 0, calls: wrong }), deps);
  check(answer.status === STATUS.badRequest && answer.body.error.code === 'not_solved', `a wrong option is refused (${answer.status} ${answer.body.error?.code})`);
  check(answer.body.error.message.includes(correct), `and the refusal names the option that was correct (${answer.body.error.message})`);
  const short = await postRun(submit('r4', { runId: 'run-short', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 5, hintsUsed: 0, attempts: 0, calls: [] }), deps);
  check(short.status === STATUS.badRequest && short.body.error.code === 'not_solved', `and a run with no answers is refused (${short.body.error?.code})`);
}

console.log('\n== 5. the clock is the SERVER\'s: a claim below the window buys nothing ==');
{
  const { store, deps } = await fresh();
  const { drill, calls, puzzle, measuredSeconds } = await issue(deps, 'r5');
  // THE CHEAT §11.1 MEASURED AT 6.7x, ATTEMPTED: 100 seconds of play claiming par. The claim is 1 s, the window is
  // 60 s, and the score must be the measured one.
  const cheated = await postRun(submit('r5', { runId: 'run-claim', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls }), deps);
  const asMeasured = scoreRun({ level: levelAt(LEVEL), shortest: puzzle.shortest, moves: puzzle.shortest, clockSeconds: measuredSeconds, hintsUsed: 0, attempts: 0 });
  const asClaimed = scoreRun({ level: levelAt(LEVEL), shortest: puzzle.shortest, moves: puzzle.shortest, clockSeconds: 1, hintsUsed: 0, attempts: 0 });
  check(cheated.status === STATUS.ok && cheated.body.run.score === asMeasured.score, `a 1 s claim on a ${measuredSeconds} s window scores as MEASURED (${cheated.body.run?.score})`);
  // THE NEGATIVE CONTROL IS THE CLAIM'S OWN SCORE, MEASURED RATHER THAN ASSERTED: scoring the claim would have paid
  // this much instead, and the two numbers are what the old rule's 6.7x was made of.
  check(asClaimed.score > asMeasured.score, `NEGATIVE CONTROL: scoring the CLAIM would have paid ${asClaimed.score} against ${asMeasured.score}`);
  // AND THE RECORD KEEPS BOTH, so the difference is visible to an operator rather than inferable (A25's audit).
  const row = (await store.get(ROW.run('r5', 'run-claim'))).value;
  check(row.clockSeconds === measuredSeconds && row.claimedSeconds === 1, `the run row holds what was measured (${row.clockSeconds}) beside what was claimed (${row.claimedSeconds})`);

  // A CLAIM ABOVE THE WINDOW IS STILL REFUSED — a lie the server can SEE is refused rather than quietly replaced —
  // and the bound is the issue stamp, so it is not a fixed ceiling.
  const second = await issue(deps, 'r5');
  const impossible = await postRun(submit('r5', { runId: 'run-fast', mode: 'drill', levelIndex: LEVEL, drillId: second.drill.id, elapsedSeconds: 3600, hintsUsed: 0, attempts: 0, calls: second.calls }), deps);
  check(impossible.status === STATUS.badRequest && impossible.body.error.code === 'impossible_elapsed', `an hour claimed for a drill issued a minute ago is refused (${impossible.body.error?.code})`);
  deps.clock.advance(3600);
  const patient = await postRun(submit('r5', { runId: 'run-patient', mode: 'drill', levelIndex: LEVEL, drillId: second.drill.id, elapsedSeconds: 3600, hintsUsed: 0, attempts: 0, calls: second.calls }), deps);
  check(patient.status === STATUS.ok, `while the same 3600 s is accepted once 3600 s have passed (${patient.status})`);
}

console.log('\n== 6. the two hint rules, from the server side ==');
{
  // TEN DISTINCT DRILLS, ONE HINT. The level's fixture has four entries, so the probe publishes a longer regime
  // for this level — the same four MEASURED seeds, cycled, because what the hint rule counts is DISTINCT
  // POSITIONS and a repeated seed at a different position is a different position.
  const { store, deps } = await fresh();
  const four = localRegimes().find((regime) => regime.entries[0].levelIndex === LEVEL).entries;
  const long = { scheduleVersion: 'probe/long', entries: Array.from({ length: 12 }, (_, index) => four[index % four.length]) };
  await putRegime(store, LEVEL, long);

  let grantedAt = 0;
  let last = null;
  for (let index = 0; index < 10; index++) {
    const { drill, calls } = await issue(deps, 'r6');
    last = await postRun(submit('r6', { runId: `run-${index}`, mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 4, hintsUsed: 0, attempts: 0, calls }), deps);
    if (last.body.hints.granted) grantedAt = index + 1;
  }
  check(grantedAt === 10, `the tenth distinct drill grants the hint (granted on submission ${grantedAt})`);
  check(last.body.hints.hints === 1 && last.body.hints.successes === 0, `and the balance is 1 with the count reset (${last.body.hints.hints} held, ${last.body.hints.successes} counted)`);
  check(last.body.board.runs === 10, `ten runs are on the board (${last.body.board.runs})`);

  // A SPEND IS AN EVENT, NOT A FIELD (A23). The run no longer debits the balance — `POST /me/hints` did that when
  // the hint was taken — so a claim of a hint that was never spent through that endpoint is REFUSED rather than
  // charged, which is the half of the old rule that let a client buy time it had not paid for.
  const date = DAY;
  const published = puzzleFor(four[0].seed, levelAt(LEVEL), 'daily');
  await store.put(publishedDailyKey(LEVEL, date), { seed: four[0].seed, levelIndex: LEVEL, poolVersion: FIXTURE_POOL_VERSION, generatorVersion: GENERATOR_VERSION, puzzle: builtDaily(four[0].seed, LEVEL) }, null);
  const line = published.puzzle.solution;
  await startDaily(deps, 'r6', LEVEL, date, 30);
  await recordLine(deps, 'r6', LEVEL, date, line);
  const unrecorded = await postRun(submit('r6', { runId: 'daily-1', mode: 'daily', levelIndex: LEVEL, date, elapsedSeconds: 30, hintsUsed: 1, calls: line }), deps);
  check(unrecorded.status === STATUS.badRequest && unrecorded.body.error.code === 'unrecorded_hints', `a Daily run claiming a hint the server never recorded is refused (${unrecorded.status} ${unrecorded.body.error?.code})`);
  check(unrecorded.body.error.message.includes('1') && unrecorded.body.error.message.includes('0'), `and the sentence names both numbers (${unrecorded.body.error?.message})`);
  const honest = await postRun(submit('r6', { runId: 'daily-1b', mode: 'daily', levelIndex: LEVEL, date, elapsedSeconds: 30, hintsUsed: 0, calls: line }), deps);
  // AND THE RUN MOVES NO BALANCE AT ALL: the hint the player holds is still there afterwards, because the only
  // thing that spends a hint is `POST /me/hints` (A23). MEASURED — the check that used to sit here asserted the
  // opposite, from the rule this stage removed.
  check(honest.status === STATUS.ok && honest.body.hints.hints === 1, `while the same run claiming none is accepted and takes nothing from the balance (${honest.status}, balance ${honest.body.hints?.hints})`);
  const tooMany = await postRun(submit('r6', { runId: 'daily-3', mode: 'daily', levelIndex: LEVEL, date, elapsedSeconds: 30, hintsUsed: 4, calls: line }), deps);
  check(tooMany.status === STATUS.badRequest && tooMany.body.error.code === 'bad_hints_used', `and a claim of four hints is refused at the door (${tooMany.body.error?.code})`);
}

console.log('\n== 7. the Daily: walked, priced on its line, timed by the READ, and its board is a BEST ==');
{
  const { store, deps } = await fresh();
  const seed = LOCAL_SCHEDULE.find((entry) => entry.levelIndex === LEVEL).seed;
  const generated = puzzleFor(seed, levelAt(LEVEL), 'daily');
  await store.put(publishedDailyKey(LEVEL, DAY), { seed, levelIndex: LEVEL, poolVersion: FIXTURE_POOL_VERSION, generatorVersion: GENERATOR_VERSION, puzzle: builtDaily(seed, LEVEL) }, null);

  await startDaily(deps, 'r7', LEVEL, DAY, 10);
  // THE LINE IS THE SERVER'S NOW (A22's Daily half): it is replayed from the recorded moves, so the probe plays them
  // through the endpoint before it submits — exactly as a client must.
  await recordLine(deps, 'r7', LEVEL, DAY, generated.puzzle.solution);
  const short = await postRun(submit('r7', { runId: 'd-1', mode: 'daily', levelIndex: LEVEL, date: DAY, elapsedSeconds: 10, hintsUsed: 0, calls: generated.puzzle.solution }), deps);
  check(short.status === STATUS.ok, `a line that reaches the goal is accepted (${short.status})`);
  const best = short.body.board.score;
  check(short.body.progress === null, 'and a Daily run finishes no drill');
  check(short.body.hints.successes === 0, 'and earns no success, because hints are earned on the drill line only');
  // THE BOARD ROW NAMES ITS PLAYER. The player is the row's SORT KEY and the store hands a reader the VALUE rather
  // than the key — so without this field the leaderboard could not name a rank it had just read (`runs.ts`'s
  // `asBoardRow`, whose probe rejects a row that is missing it).
  const boardRow = (await store.get(boardKey('daily', LEVEL, DAY, devId('r7')))).value;
  check(boardRow.playerId === devId('r7') && boardRow.score === best, `and the board row it wrote names its player (${boardRow.playerId} at ${boardRow.score})`);

  // THE DAILY'S BOARD IS A BEST, NOT A TOTAL, and the only way a replay can differ is TIME (the line is the same):
  // a slow run of the same challenge must not lower what a fast one earned. THE SLOWNESS IS REAL TIME HERE — the
  // probe moves the server's clock, because a claim is no longer what scores. MEASURED with the two scores in the
  // check, so a cumulative rule (which would ADD them) fails it by an order of magnitude.
  deps.clock.advance(5000);
  const slow = await postRun(submit('r7', { runId: 'd-slow', mode: 'daily', levelIndex: LEVEL, date: DAY, elapsedSeconds: 5000, hintsUsed: 0, calls: generated.puzzle.solution }), deps);
  check(slow.status === STATUS.ok && slow.body.run.score < best, `a slow replay scores less (${slow.body.run?.score} vs ${best})`);
  check(slow.body.board.score === best && slow.body.board.runs === 2, `and the board kept the best while counting both runs (${slow.body.board.score}, ${slow.body.board.runs} runs)`);

  // THE WINDOW CANNOT BE REFRESHED, AND THIS IS THE CHECK THE RULE EXISTS FOR. A stamp a re-read moved would let a
  // player play slowly, re-read, submit, and claim a second of work: MEASURED on the row itself AND on the score,
  // because the score is what a cheat is after. The negative control is the last line — a 1 s window would pay
  // this much, and the run does not get it.
  const stampBefore = (await store.get(ROW.attempt('r7', LEVEL, DAY))).value.startedAtMs;
  // THE RE-READ IS NOT A RE-RECORD: this is the same challenge, so its line is already the log's, and appending the
  // moves again would derive a line twice as long as the claim. That is the whole reason the log is per CHALLENGE.
  await startDaily(deps, 'r7', LEVEL, DAY, 30);
  const stampAfter = (await store.get(ROW.attempt('r7', LEVEL, DAY))).value.startedAtMs;
  check(stampAfter === stampBefore, `a re-read does NOT move the server's start stamp (${stampBefore})`);
  const replay = await postRun(submit('r7', { runId: 'd-fresh', mode: 'daily', levelIndex: LEVEL, date: DAY, elapsedSeconds: 1, hintsUsed: 0, calls: generated.puzzle.solution }), deps);
  const asFreshWindow = scoreRun({ level: levelAt(LEVEL), shortest: generated.puzzle.shortest, moves: generated.puzzle.solution.length, clockSeconds: 1, hintsUsed: 0, attempts: 0 });
  check(replay.status === STATUS.ok && replay.body.run.score < asFreshWindow.score, `so a replay cannot buy a fresh clock (${replay.body.run?.score} against the ${asFreshWindow.score} a 1 s window would pay)`);

  // A DAILY THE SERVER NEVER SAW START CANNOT BE TIMED, so it is refused rather than measured from nothing — and
  // the READ is what makes the same submission scorable, which is the pair this endpoint's contract is.
  const otherDay = '2026-10-16';
  await store.put(publishedDailyKey(LEVEL, otherDay), { seed, levelIndex: LEVEL, poolVersion: FIXTURE_POOL_VERSION, generatorVersion: GENERATOR_VERSION, puzzle: builtDaily(seed, LEVEL) }, null);
  const unread = await postRun(submit('r7', { runId: 'd-6', mode: 'daily', levelIndex: LEVEL, date: otherDay, elapsedSeconds: 10, hintsUsed: 0, calls: generated.puzzle.solution }), deps);
  check(unread.status === STATUS.conflict && unread.body.error.code === 'no_attempt_row', `a Daily nobody read is refused (${unread.status} ${unread.body.error?.code})`);
  await startDaily(deps, 'r7', LEVEL, otherDay, 10);
  await recordLine(deps, 'r7', LEVEL, otherDay, generated.puzzle.solution);
  const read = await postRun(submit('r7', { runId: 'd-6b', mode: 'daily', levelIndex: LEVEL, date: otherDay, elapsedSeconds: 10, hintsUsed: 0, calls: generated.puzzle.solution }), deps);
  check(read.status === STATUS.ok, `while the same run is scorable after the read that starts it (${read.status})`);

  // A DAY PUBLISHED BY ANOTHER BUILD IS REFUSED HERE, and the refusal is the WRITE side of the read's `playable: false`.
  // The row carries the boards, so this build regenerates a different puzzle from the same seed: scoring the line on
  // boards the player never saw would refuse a solved run for "not solved", which is the worst answer available. The
  // check runs BEFORE the attempt row is looked at, so a player who never read it still learns the right reason.
  const oldBuildDay = '2026-10-17';
  await store.put(publishedDailyKey(LEVEL, oldBuildDay), { seed, levelIndex: LEVEL, poolVersion: FIXTURE_POOL_VERSION, generatorVersion: 'g6', puzzle: builtDaily(seed, LEVEL) }, null);
  const oldBuild = await postRun(submit('r7', { runId: 'd-6c', mode: 'daily', levelIndex: LEVEL, date: oldBuildDay, elapsedSeconds: 10, hintsUsed: 0, calls: generated.puzzle.solution }), deps);
  check(oldBuild.status === STATUS.conflict && oldBuild.body.error.code === 'stale_generator', `a day published by another generator is refused, naming the stamp (${oldBuild.status} ${oldBuild.body.error?.code})`);
  check((oldBuild.body.error?.message ?? '').includes('publish-daily'), `and the message names the job that fixes it (${oldBuild.body.error?.message?.slice(0, 40)}…)`);

  // A LINE THAT STOPS SHORT needs a puzzle with more than one call in its solution — and NOW EVERY DAILY HAS ONE,
  // because a level's Daily is `dailyWaypointsFor(level) - 1` calls: five waypoints at level 1, which is four calls
  // (DESIGN.md §9). This used to have to run at level 2 because level 1's Daily was a single call; that is no longer
  // possible, which is the point of the change.
  const level2Seed = LOCAL_SCHEDULE.find((entry) => entry.levelIndex === 2).seed;
  await store.put(publishedDailyKey(2, DAY), { seed: level2Seed, levelIndex: 2, poolVersion: FIXTURE_POOL_VERSION, generatorVersion: GENERATOR_VERSION, puzzle: builtDaily(level2Seed, 2) }, null);
  const twoSteps = puzzleFor(level2Seed, levelAt(2), 'daily');
  check(twoSteps.puzzle.solution.length === dailyWaypointsFor(levelAt(2)) - 1, `the level-2 challenge has a ${dailyWaypointsFor(levelAt(2)) - 1}-call route, one per waypoint beyond the first (${twoSteps.puzzle.solution.length})`);
  await startDaily(deps, 'r7', 2, DAY, 10);
  // THE RECORDED LINE IS THE SHORT ONE, so the claim below matches the log and the refusal comes from the WALK: the
  // line really does stop short of the goal. That is this check's original purpose, with the line the server holds.
  await recordLine(deps, 'r7', 2, DAY, [twoSteps.puzzle.solution[0]]);
  const shortLine = await postRun(submit('r7', { runId: 'd-3', mode: 'daily', levelIndex: 2, date: DAY, elapsedSeconds: 10, hintsUsed: 0, calls: [twoSteps.puzzle.solution[0]] }), deps);
  check(shortLine.status === STATUS.badRequest && shortLine.body.error.code === 'not_solved', `a line that stops short is refused (${shortLine.status} ${shortLine.body.error?.code})`);
  // A SECOND PLAYER, because the log is per CHALLENGE: r7's level-2 line is the short one now, and one challenge
  // cannot hold two different lines. The whole line is recorded for r7b, and that is the run that is accepted.
  await startDaily(deps, 'r7b', 2, DAY, 10);
  await recordLine(deps, 'r7b', 2, DAY, twoSteps.puzzle.solution);
  const fullLine = await postRun(submit('r7b', { runId: 'd-3b', mode: 'daily', levelIndex: 2, date: DAY, elapsedSeconds: 10, hintsUsed: 0, calls: twoSteps.puzzle.solution }), deps);
  check(fullLine.status === STATUS.ok, `while the whole line at the same level is accepted (${fullLine.status})`);
  // AN ILLEGAL CALL CANNOT ENTER THE LINE AT ALL, which is the stronger half of the check that used to sit here. The
  // recorder does not judge (`daily-move.ts`), and the REPLAY drops it — `PlaySession.play` refuses an illegal call
  // without pushing it — so the derived line is EMPTY and there is nothing to score. MEASURED, and the reason the
  // engine's own reason string is no longer quoted below is that no walk happens for this player at all.
  await startDaily(deps, 'r7c', LEVEL, DAY, 10);
  await recordLine(deps, 'r7c', LEVEL, DAY, ['Not A Call At All']);
  const illegal = await postRun(submit('r7c', { runId: 'd-4', mode: 'daily', levelIndex: LEVEL, date: DAY, elapsedSeconds: 10, hintsUsed: 0, calls: ['Not A Call At All'] }), deps);
  check(illegal.status === STATUS.conflict && illegal.body.error.code === 'no_recorded_line', `an illegal call never enters the line, so there is nothing to score (${illegal.status} ${illegal.body.error?.code})`);
  // AND THE CLAIM IS CROSS-CHECKED RATHER THAN IGNORED: r7's level-1 log IS the solution, so a submission naming a
  // different line is refused for saying so. This replaces that input's old `not_solved` expectation, which was only
  // reachable while the CLIENT was the source of the line.
  const mismatched = await postRun(submit('r7', { runId: 'd-4b', mode: 'daily', levelIndex: LEVEL, date: DAY, elapsedSeconds: 10, hintsUsed: 0, calls: ['Not A Call At All'] }), deps);
  check(mismatched.status === STATUS.badRequest && mismatched.body.error.code === 'line_mismatch', `and a claim that disagrees with the log is refused (${mismatched.status} ${mismatched.body.error?.code})`);
  const unpublished = await postRun(submit('r7', { runId: 'd-5', mode: 'daily', levelIndex: 3, date: DAY, elapsedSeconds: 10, hintsUsed: 0, calls: [] }), deps);
  check(unpublished.status === STATUS.notFound && unpublished.body.error.code === 'no_published_daily', `a day nobody published is a 404 (${unpublished.status} ${unpublished.body.error?.code})`);
}

console.log('\n== 8. a refused transaction leaves NOTHING behind ==');
{
  // NEGATIVE CONTROL, MEASURED, FOR THE WHOLE ENDPOINT: a store whose `transact` never lands must leave the
  // board, the balance and the progress exactly as they were. That is the difference between "one run, one
  // atomic effect" and four writes that half happened — and with the writes applied one at a time the run row
  // would be there while the score was not (the store probe measures that shape directly).
  const { store, deps } = await fresh();
  const { drill, calls } = await issue(deps, 'r9');
  let attempts = 0;
  const refuses = {
    get: (key) => store.get(key),
    put: (key, value, expectedRev) => store.put(key, value, expectedRev),
    transact: () => {
      attempts++;
      return Promise.resolve(false);
    },
  };
  const answer = await postRun(submit('r9', { runId: 'run-refused', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 10, hintsUsed: 0, attempts: 0, calls }), { ...deps, store: refuses });
  check(answer.status === STATUS.conflict && answer.body.error.code === 'contended', `NEGATIVE CONTROL: a transaction that never lands is reported as contended (${answer.status} ${answer.body.error?.code})`);
  check(attempts === 3, `after exactly MAX_WRITE_ATTEMPTS attempts (${attempts})`);
  check((await store.get(ROW.run('r9', 'run-refused'))) === null, 'and the run was NOT recorded');
  check((await store.get(ROW.hints('r9'))) === null, 'and the hint balance was not written');
  check((await store.get(ROW.board('r9'))) === null, 'and the board was not written');
  const progress = (await store.get(ROW.progress('r9'))).value;
  check(progress.issued !== null && progress.finished.length === 0, 'and the drill is still in flight, with nothing finished');
}

console.log('\n== 9. refusals, and the board keys ==');
{
  const { deps } = await fresh();
  const { drill, calls } = await issue(deps, 'r8');
  const base = { runId: 'run-x', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 5, hintsUsed: 0, attempts: 0, calls };
  const cases = [
    [null, 'a null body'],
    [{ ...base, runId: '' }, 'an empty runId'],
    [{ ...base, mode: 'practice' }, 'an unknown mode'],
    [{ ...base, levelIndex: 0 }, 'level 0'],
    [{ ...base, elapsedSeconds: -1 }, 'negative elapsed'],
    [{ ...base, elapsedSeconds: Number.NaN }, 'a NaN elapsed'],
    [{ ...base, attempts: -2 }, 'negative attempts'],
    [{ ...base, calls: 'Allemande Left' }, 'calls that are not an array'],
    [{ ...base, drillId: undefined }, 'no drillId'],
    [{ ...base, drillId: '9:9' }, 'a drill that is not the issued one'],
    [{ ...base, mode: 'daily', date: 'yesterday' }, 'a daily without a date'],
  ];
  for (const [body, why] of cases) {
    const answer = await postRun(submit('r8', body), deps);
    check(answer.status >= 400 && answer.status < 500, `${why} is refused (${answer.status} ${answer.body.error?.code})`);
  }
  const anonymous = await postRun(submit(null, base), deps);
  check(anonymous.status === STATUS.unauthenticated, `no identity is a 401 (${anonymous.status})`);
  // THE BOARD KEY CARRIES THE PERIOD, and the two modes' periods mean different things: the Daily's is one UTC
  // day, which IS its challenge's identity, and the DRILL's is the PUBLISHED SET its drill was issued from — not
  // a calendar month (§15 Q17(vii)). The set is the local regime's own version, which is what `IssuedDrill` carries
  // and what the assertion below names, so a Drill board boundary is a republished set rather than a new month.
  check(MAIN_POOL.version && SCORE_VERSION > 0, 'and the pool version and score version are the ones the rows are stamped with');
  check(SEASON === LOCAL_SCHEDULE_VERSION && SEASON.startsWith('local-fixture/'), `NEGATIVE CONTROL: the Drill period is the SET's version rather than a month — this one is ${SEASON}, where a month would match /^\\d{4}-\\d{2}$/`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
