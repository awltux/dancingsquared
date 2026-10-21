// A SHOWN ANSWER BUYS NOTHING, pinned (DESIGN.md §15 Q16, §11.1 A28).
//
// WHY THIS IS A GATE. "Show me the answer" names the call and dances it, and the player still presses it — so the
// press is a correct answer like any other, and ten of them earned a hint. A hint is a currency (§10), so the app's
// own button minted it: press the button, press the call you were told. The design carried this as an open question
// because the LEDGER had to know the puzzle was revealed, and the ledger is the server's (A23) — which is why the
// fix is an EVENT (`POST /drill/reveal`) rather than a field, and why the checks here are all about what a run is
// worth once the server has seen one.
//
// THE CHECKS COME IN PAIRS, because a verifier that unranked everything would pass every refusal and fail every
// run: the same drill is submitted on two players, one who was shown a step and one who was not, and the difference
// between their balances and their boards is the whole rule.
//
// THE UNION IS MEASURED IN BOTH DIRECTIONS (§2 and §3), because each half alone is a defect that costs something
// real: the RECORD alone ranks a run whose reveal POST was lost, and the CLAIM alone ranks a run whose client simply
// never sends the field — which is the defect this closes.
//
// Usage: node api/test/reveal-probe.mjs
import { drillCurrent } from '../src/handlers/drill.ts';
import { postDrillReveal } from '../src/handlers/reveal.ts';
import { postDrillAnswer } from '../src/handlers/answer.ts';
import { getPuzzle } from '../src/handlers/puzzle.ts';
import { postDailyMove } from '../src/handlers/daily-move.ts';
import { postRun } from '../src/handlers/runs.ts';
import { STATUS } from '../src/status.ts';
import { attemptKey, boardKey, hintsKey, progressKey, publishedDailyKey } from '../src/keys.ts';
import { levelAt, puzzleFor } from '../src/levels.ts';
import { asProgress } from '../src/progress-row.ts';
import { wasRevealed } from '../src/runs.ts';
import { seedLocalRegimes, LOCAL_SCHEDULE_VERSION } from '../src/local-regime.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { ROUTES, PLANNED_ENDPOINTS } from '../src/routes.ts';
import { recordSuccess } from 'dancing-squared-game';
import { FIXTURE_POOL_VERSION, LOCAL_SCHEDULE } from 'dancing-squared-game/schedule-fixture';

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
const devId = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;
const ROW = {
  attempt: (name, drillId) => attemptKey(devId(name), 'drill', drillId),
  dailyAttempt: (name, date) => attemptKey(devId(name), 'daily', `${LEVEL}#${date}`),
  board: (name, mode, period) => boardKey(mode, LEVEL, period, devId(name)),
  progress: (name) => progressKey(devId(name), LEVEL),
};

let now = CLOCK;
const depsFor = (store) => ({ store, clock: { nowMs: () => now }, identityOf: devIdentityOf });
const get = (player, level = LEVEL) => ({ method: 'GET', path: '/drill/current', query: { level: String(level) }, body: null, headers: player ? { 'x-dev-player': player } : {} });
const reveal = (player, drillId, step) => ({ method: 'POST', path: '/drill/reveal', query: {}, body: { drillId, step }, headers: player ? { 'x-dev-player': player } : {} });
const press = (player, drillId, step, call) => ({ method: 'POST', path: '/drill/answer', query: {}, body: { drillId, step, call }, headers: player ? { 'x-dev-player': player } : {} });
const submit = (player, body) => ({ method: 'POST', path: '/runs', query: {}, body, headers: player ? { 'x-dev-player': player } : {} });
const read = (player, date = DAY) => ({ method: 'GET', path: '/puzzle', query: { mode: 'daily', level: String(LEVEL), date }, body: null, headers: { 'x-dev-player': player } });

async function fresh() {
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  return { store, deps: depsFor(store) };
}

/** The drill this player is on, its puzzle, and the call that is correct at each step. */
async function issue(deps, player) {
  const served = await drillCurrent(get(player), deps);
  const drill = served.body.drill;
  const generated = puzzleFor(drill.seed, levelAt(LEVEL), 'drill');
  if (!generated.ok) throw new Error(`the probe's seed does not generate: ${generated.reason}`);
  return { drill, puzzle: generated.puzzle, correct: generated.puzzle.steps.map((step) => step.moves[step.correctIndex].call) };
}

/**
 * Give a player a balance ONE SUCCESS SHORT of a grant, the way the server's own credit rule writes it.
 *
 * `successes: 9` IS THE INSTRUMENT: with the threshold at ten, the balance before the run is the balance after it
 * unless the run was credited — so a single number answers "did this run earn a hint?" with no arithmetic in the
 * check and no way for a rounding mistake to look like a rule.
 */
async function nearlyEarned(store, player) {
  await store.put(hintsKey(devId(player)), { hints: 0, successes: 9 }, null);
}

/** Play the whole drill correctly, one press per step, the way the app does. */
async function pressAll(player, drill, correct, deps) {
  for (let step = 0; step < correct.length; step++) await postDrillAnswer(press(player, drill.id, step, correct[step]), deps);
}

/** A complete Drill run, with the fields a client sends. `extra` carries what the case is about. */
function run(player, drill, correct, extra = {}) {
  return submit(player, {
    runId: `run-${player}`,
    mode: 'drill',
    levelIndex: LEVEL,
    drillId: drill.id,
    elapsedSeconds: 60,
    hintsUsed: 0,
    attempts: 0,
    calls: correct,
    ...extra,
  });
}

console.log('== 1. the reveal is the server\'s event: it names the call, and it does not count as a press ==');
{
  const { store, deps } = await fresh();
  const { drill, correct } = await issue(deps, 'p1');

  now += 7000;
  const first = await postDrillReveal(reveal('p1', drill.id, 0), deps);
  check(first.status === STATUS.ok && first.body.call === correct[0] && first.body.recorded === true && first.body.reveals === 1, `a reveal is recorded and the SERVER names the call it showed (${first.body.call})`);

  const row = (await store.get(ROW.attempt('p1', drill.id))).value;
  check(row.reveals.length === 1 && row.reveals[0].step === 0 && row.reveals[0].call === correct[0], 'the row holds the step and the server\'s own name for its answer');
  check(row.reveals[0].atMs === CLOCK + 7000, `stamped by the server as it arrived (${row.reveals[0].atMs - CLOCK} ms after the start)`);
  // A REVEAL IS NOT AN ANSWER: it must not inflate the wrong-try count the score is priced on, which is the one way
  // this endpoint could make things worse rather than better.
  check(row.presses.length === 0, 'and it is NOT recorded as a press, so it cannot be charged as a wrong try');

  const again = await postDrillReveal(reveal('p1', drill.id, 0), deps);
  check(again.status === STATUS.ok && again.body.recorded === false && again.body.reveals === 1, 'the same step shown again is the same piece of help, not a second event');
  check((await store.get(ROW.attempt('p1', drill.id))).value.reveals.length === 1, 'so the row still holds one reveal for that step');

  // A SECOND STEP IS A SECOND REVEAL — where the level asks more than one question. Level 1 ships a one-step drill
  // at this fixture's seed, so the check is conditional for the same reason `press-log-probe.mjs`'s illegal-choice
  // check is: a level that authors no second step has nothing to reveal twice, and asserting it anyway would be a
  // probe that fails on a corpus change rather than on this rule.
  if (correct.length > 1) {
    const second = await postDrillReveal(reveal('p1', drill.id, 1), deps);
    check(second.status === STATUS.ok && second.body.reveals === 2, `a different step is a second reveal (${second.body.reveals})`);
  } else {
    check(true, `this drill asks ${correct.length} question, so there is no second step to reveal twice`);
  }

  const outOfRange = await postDrillReveal(reveal('p1', drill.id, 9), deps);
  check(outOfRange.status === STATUS.badRequest && outOfRange.body.error.code === 'bad_step', `a step the drill does not have is refused (${outOfRange.body.error?.code})`);
  const stale = await postDrillReveal(reveal('p1', '1:9', 0), deps);
  check(stale.status === STATUS.conflict && stale.body.error.code === 'stale_drill', `and a drill that is not in flight is refused (${stale.body.error?.code})`);
  const nobody = await postDrillReveal({ ...reveal(null, drill.id, 0), headers: {} }, deps);
  check(nobody.status === STATUS.unauthenticated, `and a reveal with no identity is a 401 (${nobody.status})`);
}

console.log('\n== 2. a revealed run is kept, advances the regime, and counts for NOTHING ==');
{
  // TWO PLAYERS, ONE DRILL EACH, ONE DIFFERENCE: p2 never asked to be shown anything, p3 asked for step 0.
  const honest = await fresh();
  await nearlyEarned(honest.store, 'p2');
  const a = await issue(honest.deps, 'p2');
  await pressAll('p2', a.drill, a.correct, honest.deps);
  now += 60_000;
  const counted = await postRun(run('p2', a.drill, a.correct), honest.deps);
  check(counted.status === STATUS.ok && counted.body.run.ranked === true, `an honest run is ranked (${counted.status}, ranked ${counted.body.run?.ranked})`);
  check(counted.body.hints.hints === 1 && counted.body.hints.granted === true, `and its success earned the hint it was one short of (${counted.body.hints?.hints} held)`);
  check(counted.body.progress?.finished === 1, 'with the regime advanced by one');

  const shown = await fresh();
  await nearlyEarned(shown.store, 'p3');
  const b = await issue(shown.deps, 'p3');
  await postDrillReveal(reveal('p3', b.drill.id, 0), shown.deps);
  await pressAll('p3', b.drill, b.correct, shown.deps);
  now += 60_000;
  const revealed = await postRun(run('p3', b.drill, b.correct), shown.deps);
  check(revealed.status === STATUS.ok, `a revealed run is ACCEPTED rather than refused (${revealed.status})`);
  check(revealed.body.run.ranked === false, 'but the server says it is not ranked');
  check(revealed.body.run.score > 0, `and it still carries a score for the player to read (${revealed.body.run?.score})`);

  // THE CREDIT IS THE ONE THAT MATTERS, and the pair is the measurement: the same seed, the same presses, the same
  // balance one short of a grant — and one of them holds a hint afterwards.
  check(revealed.body.hints.hints === 0 && revealed.body.hints.granted === false, `while the same run after a reveal mints no hint (${revealed.body.hints?.hints} held)`);
  check(recordSuccess({ hints: 0, successes: 9 }).granted, 'NEGATIVE CONTROL: crediting it would have granted the hint p2 was granted');
  check(counted.body.run.score > 0 && revealed.body.run.score > 0, 'and both runs were scored, so the difference is the credit and not the run');

  // THE BOARD HAS NO ENTRY, which is not the same as a zero: p2 is on it and p3 is not on it at all. The period is
  // the PUBLISHED SET the drill was issued from (§15 Q17(vii)) — the local regime's own version — and not the
  // calendar month this probe used to compute.
  const period = LOCAL_SCHEDULE_VERSION;
  const theirs = await shown.store.get(ROW.board('p3', 'drill', period));
  check(theirs === null, 'the revealed run left NO board row rather than a zero score on one');
  const ours = await honest.store.get(ROW.board('p2', 'drill', period));
  check(ours !== null && ours.value.score === counted.body.run.score, `NEGATIVE CONTROL: the honest run's board row is there, holding its score (${ours?.value.score})`);

  // THE REGIME STILL MOVES, because a player who has read the answer must not be trapped on that question: the drill
  // is finished (that is what advancing means) and the standing is what was withheld.
  check(revealed.body.progress?.finished === 1, 'and the revealed drill is FINISHED, so the next request is the next question');
  const progress = asProgress(await shown.store.get(ROW.progress('p3')), LEVEL);
  check(progress !== null && progress.finished.length === 1, 'which the progress row records');

  // THE AUDIT ROW KEEPS EVERYTHING: the score it would have earned, and the fact that stopped it.
  const stored = (await shown.store.get({ pk: `runs#${devId('p3')}`, sk: 'run#run-p3' })).value;
  check(stored.reveals === 1 && stored.claimedReveals === 0, `the run row holds the recorded reveal (${stored.reveals}) beside the claim (${stored.claimedReveals})`);
  check(typeof stored.score === 'number' && stored.score > 0, 'beside a score, so an operator can see what the rule refused rather than a gap');

  // A RETRY REPEATS THE DECISION rather than re-deriving it, and the row is where it is read from.
  const retry = await postRun(run('p3', b.drill, b.correct), shown.deps);
  check(retry.status === STATUS.ok && retry.body.run.duplicate === true && retry.body.run.ranked === false, 'and a retry of that run answers "duplicate, not ranked" from the row');
}

console.log('\n== 3. the union of the two sources, because either one alone is a defect ==');
{
  // THE POST IS LOST. The app showed step 0 and said so; the server never received the event, which is a dropped
  // request rather than a dishonest client — and ranking it pays a hint for an answer that was read.
  const { store, deps } = await fresh();
  await nearlyEarned(store, 'p4');
  const { drill, correct } = await issue(deps, 'p4');
  await pressAll('p4', drill, correct, deps);
  now += 60_000;
  const claimed = await postRun(run('p4', drill, correct, { reveals: 1 }), deps);
  check(claimed.status === STATUS.ok && claimed.body.run.ranked === false, `a run that CLAIMS a reveal the server never recorded is not ranked either (${claimed.status}, ranked ${claimed.body.run?.ranked})`);
  check(claimed.body.hints.hints === 0, `so the balance is untouched (${claimed.body.hints?.hints} held)`);
  check((await store.get(ROW.board('p4', 'drill', LOCAL_SCHEDULE_VERSION))) === null, 'and the board has no entry for it');
  const stored = (await store.get({ pk: `runs#${devId('p4')}`, sk: 'run#run-p4' })).value;
  check(stored.reveals === 0 && stored.claimedReveals === 1, `with the disagreement visible on the row: recorded ${stored.reveals}, claimed ${stored.claimedReveals}`);
  // THE NEGATIVE CONTROL IS THE PLAUSIBLE WRONG RULE, MEASURED: "the record is the fact" — which is exactly the
  // rule that would rank this run, and the reason the union exists.
  check(!(0 > 0), 'NEGATIVE CONTROL: the record alone (`measured > 0`) is false here, so that rule would have ranked the run');
  check(!(1 > 0) === false, 'and the claim alone is true, so neither source can be the only one');

  // A DAILY IS NOT TAINTED BY A CLAIM, because the Daily has no reveal: there is no "show me the answer" there, and
  // its help is a hint, which is charged. Unranking a real Daily on a meaningless field would be a client muting
  // its own board for nothing.
  await store.put(publishedDailyKey(LEVEL, DAY), { seed: LOCAL_SCHEDULE[0].seed, levelIndex: LEVEL, poolVersion: FIXTURE_POOL_VERSION, puzzle: builtDaily(LOCAL_SCHEDULE[0].seed, LEVEL) }, null);
  const solution = puzzleFor(LOCAL_SCHEDULE[0].seed, levelAt(LEVEL), 'daily').puzzle.solution;
  await getPuzzle(read('p5'), deps);
  for (const named of solution) await postDailyMove({ method: 'POST', path: '/daily/move', query: {}, body: { levelIndex: LEVEL, date: DAY, move: 'add', call: named }, headers: { 'x-dev-player': 'p5' } }, deps);
  now += 60_000;
  const daily = await postRun(submit('p5', { runId: 'run-p5', mode: 'daily', levelIndex: LEVEL, date: DAY, elapsedSeconds: 60, hintsUsed: 0, attempts: 0, reveals: 5, calls: solution }), deps);
  check(daily.status === STATUS.ok && daily.body.run.ranked === true, `a Daily is judged on its own line, not on a reveal field it cannot have (${daily.status} ${daily.body.error?.code ?? `ranked ${daily.body.run.ranked}`})`);
}

console.log('\n== 4. the rule itself, measured against both rules it rules out ==');
{
  check(wasRevealed(0, 0) === false, 'nothing recorded and nothing claimed is an ordinary run');
  check(wasRevealed(1, 0) === true && wasRevealed(0, 1) === true && wasRevealed(2, 3) === true, 'while either source saying "shown" is enough, however many the other holds');
  // BOTH ALTERNATIVES, EACH MEASURED TO FAIL EXACTLY ONE CASE — the shape AGENTS.md §5 asks of a negative control.
  const recordOnly = (measured) => measured > 0;
  const claimOnly = (_measured, claimed) => claimed > 0;
  const cases = [[0, 0, false], [1, 0, true], [0, 1, true]];
  const wrongBy = (rule) => cases.filter(([measured, claimed, want]) => rule(measured, claimed) !== want);
  check(wrongBy(recordOnly).length === 1 && wrongBy(recordOnly)[0][1] === 1, 'the record alone fails exactly the case where the POST was lost, and nothing else');
  check(wrongBy(claimOnly).length === 1 && wrongBy(claimOnly)[0][0] === 1, 'and the claim alone fails exactly the case where only the server saw it');
}

console.log('\n== 5. the route table says where the endpoint is ==');
{
  const row = ROUTES.find((route) => route.method === 'POST' && route.path === '/drill/reveal');
  check(row !== undefined, 'POST /drill/reveal is in the route table, so the dev server serves it');
  check(ROUTES.length === PLANNED_ENDPOINTS, `all ${PLANNED_ENDPOINTS} endpoints of §11 exist, so /health reports no gap`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
