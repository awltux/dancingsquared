// THE RECORDED INTERACTION, pinned: what a press is worth, who decides it, and what a claim cannot beat.
//
// WHY THIS IS A GATE. DESIGN.md §11.1's A22 turns `attempts` from a field a submission carries into a count the
// server made, and `attemptFactor` is a SCORE FACTOR: the review that produced §11.1 measured a hidden factor at
// 21 -> 100 in the same family (one hidden hint). So the checks here are all attempts to lie or to be believed:
// a submission claiming zero wrong tries after three of them, a transcript the recorded presses cannot account
// for, a run with no press log at all, and a press for a drill the server never issued. Each is measured beside
// the honest case, because a verifier that refused everything would pass every refusal and fail every run.
//
// THE CACHE IS WHY THIS PROBE IS FAST. `puzzleFor` memoises (levels.ts), and a press regenerates the puzzle to
// derive the correct option — MEASURED at 158.6 ms per distinct seed against 0.0 ms for a repeat, which is the
// difference between a probe that runs in a second and one that runs for a minute.
//
// Usage: node api/test/press-log-probe.mjs
import { drillCurrent } from '../src/handlers/drill.ts';
import { postDrillAnswer } from '../src/handlers/answer.ts';
import { postRun } from '../src/handlers/runs.ts';
import { STATUS } from '../src/status.ts';
import { attemptKey } from '../src/keys.ts';
import { levelAt, puzzleFor } from '../src/levels.ts';
import { seedLocalRegimes } from '../src/local-regime.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { MAX_PRESSES } from '../src/press-log.ts';
import { ROUTES, PLANNED_ENDPOINTS } from '../src/routes.ts';
import { scoreRun } from 'dancing-squared-game';
import { LOCAL_SCHEDULE } from 'dancing-squared-game/schedule-fixture';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = 1;
const CLOCK = 1_700_000_000_000;
const devId = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;
const ROW = { attempt: (name, drillId) => attemptKey(devId(name), 'drill', drillId) };

let now = CLOCK;
const depsFor = (store) => ({ store, clock: { nowMs: () => now }, identityOf: devIdentityOf });
const get = (player, level = LEVEL) => ({ method: 'GET', path: '/drill/current', query: { level: String(level) }, body: null, headers: player ? { 'x-dev-player': player } : {} });
const press = (player, drillId, step, call) => ({ method: 'POST', path: '/drill/answer', query: {}, body: { drillId, step, call }, headers: player ? { 'x-dev-player': player } : {} });
const submit = (player, body) => ({ method: 'POST', path: '/runs', query: {}, body, headers: player ? { 'x-dev-player': player } : {} });

async function fresh() {
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  return { store, deps: depsFor(store) };
}

/** The drill this player is on, its puzzle, and the calls that are correct at each step. */
async function issue(deps, player) {
  const served = await drillCurrent(get(player), deps);
  const drill = served.body.drill;
  const generated = puzzleFor(drill.seed, levelAt(LEVEL));
  if (!generated.ok) throw new Error(`the probe's seed does not generate: ${generated.reason}`);
  const puzzle = generated.puzzle;
  return { drill, puzzle, correct: puzzle.steps.map((step) => step.moves[step.correctIndex].call) };
}

/** A call that is legal from this step's board and is NOT the correct option — the wrong button to press. */
function wrongCall(puzzle, stepIndex) {
  const step = puzzle.steps[stepIndex];
  const option = step.moves.find((move, index) => index !== step.correctIndex);
  if (!option) throw new Error('this step has no wrong option to press');
  return option.call;
}

console.log('== 1. every press is recorded, and the SERVER decides what it was worth ==');
{
  const { store, deps } = await fresh();
  const { drill, puzzle, correct } = await issue(deps, 'p1');

  const right = await postDrillAnswer(press('p1', drill.id, 0, correct[0]), deps);
  check(right.status === STATUS.ok && right.body.verdict === 'correct' && right.body.attempts === 0, `a correct press is called correct and costs nothing (${right.body.verdict}, attempts ${right.body.attempts})`);

  const wrong = wrongCall(puzzle, 0);
  now += 4000;
  const bad = await postDrillAnswer(press('p1', drill.id, 0, wrong), deps);
  check(bad.status === STATUS.ok && bad.body.verdict === 'wrong' && bad.body.attempts === 1, `a wrong press is called wrong and counted (${bad.body.verdict}, attempts ${bad.body.attempts})`);

  // THE ILLEGAL BUTTON IS A PRESS LIKE ANY OTHER: it is the step's own `unknown` call, and the server's interest in
  // it is only that it is not the correct option. The engine's PROSE for it stays the client's business (§8).
  if (puzzle.steps[0].unknown) {
    const illegal = await postDrillAnswer(press('p1', drill.id, 0, puzzle.steps[0].unknown.call), deps);
    check(illegal.status === STATUS.ok && illegal.body.verdict === 'wrong' && illegal.body.attempts === 2, `the illegal choice counts as a wrong try too (attempts ${illegal.body.attempts})`);
  } else {
    check(true, 'this puzzle authors no illegal choice, so there is no illegal press to count at level 1');
  }

  // THE TIMES ARE THE SERVER'S, taken as each press arrived — not from anything the press carried.
  const logged = (await store.get(ROW.attempt('p1', drill.id))).value.presses;
  check(logged.length === (puzzle.steps[0].unknown ? 3 : 2), `the log holds one row per press (${logged.length})`);
  check(logged[1].atMs === CLOCK + 4000 && logged[0].atMs === CLOCK, `stamped by the server as they arrived (${logged.map((each) => each.atMs - CLOCK).join(', ')} ms after the start)`);
  check(logged[1].step === 0 && logged[1].call === wrong, 'each row names the step and the call the player chose');

  // A PRESS FOR A DRILL NOBODY ISSUED IS REFUSED, like every other drill-scoped write.
  const stale = await postDrillAnswer(press('p1', '1:9', 0, correct[0]), deps);
  check(stale.status === STATUS.conflict && stale.body.error.code === 'stale_drill', `a press against a drill that is not in flight is refused (${stale.status} ${stale.body.error?.code})`);
  const noId = await postDrillAnswer({ ...press(null, drill.id, 0, correct[0]), headers: {} }, deps);
  check(noId.status === STATUS.unauthenticated, `and a press with no identity is a 401 (${noId.status})`);
  const outOfRange = await postDrillAnswer(press('p1', drill.id, 9, correct[0]), deps);
  check(outOfRange.status === STATUS.badRequest && outOfRange.body.error.code === 'bad_step', `a press for a step the drill does not have is refused (${outOfRange.body.error?.code})`);
  const longCall = await postDrillAnswer(press('p1', drill.id, 0, 'x'.repeat(200)), deps);
  check(longCall.status === STATUS.badRequest && longCall.body.error.code === 'bad_call', `and so is a call that is not a name (${longCall.body.error?.code})`);
}

console.log('\n== 2. a submission claiming zero wrong tries is scored on the ones the server SAW ==');
{
  const { store, deps } = await fresh();
  const { drill, puzzle, correct } = await issue(deps, 'p2');
  // TWO WRONG PRESSES AND THEN THE RIGHT ONES, which is a player who tried twice before getting it.
  const wrong = wrongCall(puzzle, 0);
  await postDrillAnswer(press('p2', drill.id, 0, wrong), deps);
  await postDrillAnswer(press('p2', drill.id, 0, wrong), deps);
  for (let step = 0; step < correct.length; step++) await postDrillAnswer(press('p2', drill.id, step, correct[step]), deps);
  now += 60_000;

  const lied = await postRun(submit('p2', { runId: 'run-lie', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 60, hintsUsed: 0, attempts: 0, calls: correct }), deps);
  check(lied.status === STATUS.ok, `the run is accepted (${lied.status})`);
  const measured = scoreRun({ level: levelAt(LEVEL), shortest: puzzle.shortest, moves: puzzle.shortest, clockSeconds: 60, hintsUsed: 0, attempts: 2 });
  const asClaimed = scoreRun({ level: levelAt(LEVEL), shortest: puzzle.shortest, moves: puzzle.shortest, clockSeconds: 60, hintsUsed: 0, attempts: 0 });
  check(lied.body.run.score === measured.score, `and scored on the TWO wrong tries the server recorded (${lied.body.run.score})`);
  // THE NEGATIVE CONTROL IS THE CLAIM'S OWN SCORE, MEASURED: believing `attempts: 0` would have paid this, and the
  // gap is exactly what a client could win by not being believed.
  check(asClaimed.score > measured.score, `NEGATIVE CONTROL: believing the claim would have paid ${asClaimed.score} against ${measured.score}`);

  // AND THE RECORD KEEPS BOTH, so the disagreement is visible to an operator (A25).
  const row = (await store.get({ pk: `runs#${devId('p2')}`, sk: 'run#run-lie' })).value;
  check(row.attempts === 2 && row.claimedAttempts === 0, `the run row holds the recorded count (${row.attempts}) beside the claimed one (${row.claimedAttempts})`);

  // A TRANSCRIPT THE LOG CANNOT EXPLAIN IS REFUSED rather than counted: here the only press is the WRONG one, so
  // the correct call the run claims to have played was never made. The code names the side that is wrong, because
  // the fix differs (`no_press_log` is a client that posted nothing; this is a transcript the log disagrees with).
  const { deps: ghostDeps } = await fresh();
  const ghost = await issue(ghostDeps, 'p5');
  await postDrillAnswer(press('p5', ghost.drill.id, 0, wrongCall(ghost.puzzle, 0)), ghostDeps);
  now += 60_000;
  const unexplained = await postRun(submit('p5', { runId: 'run-ghost', mode: 'drill', levelIndex: LEVEL, drillId: ghost.drill.id, elapsedSeconds: 60, hintsUsed: 0, attempts: 0, calls: ghost.correct }), ghostDeps);
  check(unexplained.status === STATUS.badRequest && unexplained.body.error.code === 'unexplained_calls', `a transcript whose calls were never pressed is refused (${unexplained.status} ${unexplained.body.error?.code})`);
}

console.log('\n== 3. no press log means no count, so the run is refused rather than trusted ==');
{
  const { store, deps } = await fresh();
  const { drill, correct } = await issue(deps, 'p3');
  now += 60_000;
  const unlogged = await postRun(submit('p3', { runId: 'run-unlogged', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 60, hintsUsed: 0, attempts: 0, calls: correct }), deps);
  check(unlogged.status === STATUS.conflict && unlogged.body.error.code === 'no_press_log', `a run with no recorded press is refused (${unlogged.status} ${unlogged.body.error?.code})`);
  check((await store.get({ pk: `runs#${devId('p3')}`, sk: 'run#run-unlogged' })) === null, 'and nothing was written for it');

  // THE HONEST PATH IS ONE PRESS PER STEP, and the check above is only meaningful beside it.
  for (let step = 0; step < correct.length; step++) await postDrillAnswer(press('p3', drill.id, step, correct[step]), deps);
  const logged = await postRun(submit('p3', { runId: 'run-logged', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 60, hintsUsed: 0, attempts: 0, calls: correct }), deps);
  check(logged.status === STATUS.ok && logged.body.run.score > 0, `while the same run after its presses is accepted (${logged.status}, ${logged.body.run?.score} points)`);

  // THE LOG IS BOUNDED, and the refusal says so rather than dropping a press after the fact: a dropped press would
  // change `attempts` silently, which is the disagreement A25 exists to make visible.
  const { deps: boundDeps } = await fresh();
  const second = await issue(boundDeps, 'p4');
  const wrong = wrongCall(second.puzzle, 0);
  for (let index = 0; index < MAX_PRESSES; index++) await postDrillAnswer(press('p4', second.drill.id, 0, wrong), boundDeps);
  const full = await postDrillAnswer(press('p4', second.drill.id, 0, wrong), boundDeps);
  check(full.status === STATUS.conflict && full.body.error.code === 'press_log_full', `the ${MAX_PRESSES + 1}th press on one drill is refused (${full.status} ${full.body.error?.code})`);
}

console.log('\n== 4. the route table says where the endpoint is ==');
{
  check(ROUTES.some((route) => route.method === 'POST' && route.path === '/drill/answer'), 'POST /drill/answer is in the route table, so the dev server serves it');
  check(ROUTES.length < PLANNED_ENDPOINTS, `${ROUTES.length} of ${PLANNED_ENDPOINTS} endpoints exist, so /health still reports a real gap`);
  // THE SEED THE PROBE USED IS THE FIXTURE'S, so a level whose schedule changed would fail here rather than in a
  // player's browser: the press endpoints are drill-scoped, and a drill comes from the published regime.
  check(LOCAL_SCHEDULE.some((entry) => entry.levelIndex === LEVEL), 'the local fixture still publishes level 1, which is what every check above played');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
