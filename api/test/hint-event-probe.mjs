// THE HINT SPEND AS AN EVENT, pinned (DESIGN.md 11.1, A23).
//
// WHY THIS IS A GATE. A hint is a 60-second charge folded into the elapsed the score is computed from, and the
// spend used to be a FIELD in the submission — so a client could take the help and report none, keeping the time
// the hint bought. The review that produced §11.1 measured that family at up to 4.8x. Now the balance moves when
// the hint is TAKEN and the run is charged for what was recorded, so the checks here are: the debit happens once
// and against the challenge that was read, the run is charged the 60 seconds, a claim the record cannot corroborate
// is REFUSED, and the bound is refused rather than silently ignored.
//
// HINTS ARE SPENT ON THE DAILY (§10: earned on the drill line, spent where the player is stuck), which is also why
// this probe reads the challenge before it spends: the attempt row that records the read is what the spend is
// charged to, and a challenge nobody read cannot be hinted at.
//
// Usage: node api/test/hint-event-probe.mjs
import { getPuzzle } from '../src/handlers/puzzle.ts';
import { postHint } from '../src/handlers/hints.ts';
import { postDailyMove } from '../src/handlers/daily-move.ts';
import { postRun } from '../src/handlers/runs.ts';
import { STATUS } from '../src/status.ts';
import { attemptKey, hintsKey, publishedDailyKey } from '../src/keys.ts';
import { levelAt, puzzleFor, runtimeFor } from '../src/levels.ts';
import { seedLocalRegimes } from '../src/local-regime.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { asAttempt, asAttemptItem } from '../src/attempt-row.ts';
import { MAX_HINTS_PER_ATTEMPT } from '../src/handlers/hints.ts';
import { GENERATOR_VERSION, scoreRun } from 'dancing-squared-game';
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
const OTHER_DAY = '2026-10-16';
const CLOCK = 1_700_000_000_000;

const devId = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;
const ROW = { attempt: (name, level, date) => attemptKey(devId(name), 'daily', `${level}#${date}`), hints: (name) => hintsKey(devId(name)) };

let now = CLOCK;
const depsFor = (store) => ({ store, clock: { nowMs: () => now }, identityOf: devIdentityOf });
const read = (player, level = LEVEL, date = DAY) => ({ method: 'GET', path: '/puzzle', query: { mode: 'daily', level: String(level), date }, body: null, headers: { 'x-dev-player': player } });
const hint = (player, level, date) => ({ method: 'POST', path: '/me/hints', query: {}, body: { levelIndex: level, date }, headers: { 'x-dev-player': player } });
const submit = (player, body) => ({ method: 'POST', path: '/runs', query: {}, body, headers: { 'x-dev-player': player } });

/**
 * Record a line as the moves that built it (DESIGN.md §11.1, A22's Daily half).
 *
 * A Daily submission is scored on the line the SERVER holds and is refused `line_mismatch` when its claim disagrees,
 * so a probe that submits a Daily without playing it is testing a client that cannot exist.
 */
async function recordLine(player, level, date, line, deps) {
  for (const named of line) {
    const posted = await postDailyMove({ method: 'POST', path: '/daily/move', query: {}, body: { levelIndex: level, date, move: 'add', call: named }, headers: { 'x-dev-player': player } }, deps);
    if (posted.status !== STATUS.ok) throw new Error(`the probe could not record a move: ${posted.status} ${posted.body.error?.code}`);
  }
}

/** Publish a day at a level with the fixture's first seed, so there is a challenge to hint at. */
async function publish(store, level, date, seed) {
  await store.put(publishedDailyKey(level, date), { seed, levelIndex: level, poolVersion: FIXTURE_POOL_VERSION, generatorVersion: GENERATOR_VERSION, puzzle: builtDaily(seed, level) }, null);
}

/**
 * Give a player a hint balance the way the server does — by writing the row its own credit rule writes.
 *
 * IT CARRIES THE REVISION IT READ, because a create-only write here silently does nothing the second time (the row
 * exists), which would make a later check report `no_hints` for the wrong reason. A fixture that fails quietly is
 * worse than no fixture.
 */
async function grant(store, player, hints) {
  const key = ROW.hints(player);
  const existing = await store.get(key);
  if (!(await store.put(key, { hints, successes: 0 }, existing?.rev ?? null))) throw new Error('the probe could not set the hint balance');
}

async function fresh() {
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const seed = LOCAL_SCHEDULE.find((entry) => entry.levelIndex === LEVEL).seed;
  await publish(store, LEVEL, DAY, seed);
  await publish(store, LEVEL, OTHER_DAY, seed);
  return { store, deps: depsFor(store), seed, solution: puzzleFor(seed, levelAt(LEVEL), 'daily').puzzle.solution };
}

console.log('== 1. a hint is spent once, against the challenge that was READ ==');
{
  const { store, deps, seed } = await fresh();
  // NO BALANCE, NO HINT: the balance is the server's, so a player holding none is refused rather than helped and
  // charged later.
  await getPuzzle(read('h1'), deps);
  const broke = await postHint(hint('h1', LEVEL, DAY), deps);
  check(broke.status === STATUS.conflict && broke.body.error.code === 'no_hints', `a player holding no hint is refused (${broke.status} ${broke.body.error?.code})`);
  check((await store.get(ROW.attempt('h1', LEVEL, DAY))).value.hints.length === 0, 'and nothing was recorded for the refusal');

  // A CHALLENGE NOBODY READ cannot be charged, even with a balance: the attempt row is what the spend hangs on.
  await grant(store, 'h1', 2);
  const unread = await postHint(hint('h1', LEVEL, OTHER_DAY), deps);
  check(unread.status === STATUS.conflict && unread.body.error.code === 'no_attempt_row', `a hint on a challenge this player never read is refused (${unread.status} ${unread.body.error?.code})`);
  check((await store.get(ROW.hints('h1'))).value.hints === 2, 'and the balance is untouched by that refusal');

  now += 7000;
  const spent = await postHint(hint('h1', LEVEL, DAY), deps);
  check(spent.status === STATUS.ok && spent.body.hints.hints === 1 && spent.body.spent === 1, `a hint is spent and the balance debited (${spent.body.hints?.hints} left, spent ${spent.body.spent})`);
  const row = (await store.get(ROW.attempt('h1', LEVEL, DAY))).value;
  check(row.hints.length === 1 && row.hints[0].atMs === CLOCK + 7000, `with the event stamped by the SERVER (${row.hints[0].atMs - CLOCK} ms after the read)`);
  check(typeof row.startedAtMs === 'number', 'and the start stamp the clock is measured from is still there, because one item holds both');
  // THE CALL IS THE SERVER'S NOW (A23's naming). This challenge has NO recorded moves yet, so the board §10's look-up
  // runs over is the puzzle's START — and the check is against the ENGINE's own offered list rather than a literal.
  // NEGATIVE CONTROL: the rule this replaced left the field EMPTY (a placeholder for a name the client held), so the
  // first comparison below is the one it fails.
  const puzzle = puzzleFor(seed, levelAt(LEVEL), 'daily').puzzle;
  const offered = runtimeFor(levelAt(LEVEL)).applier.offered(puzzle.start).map((move) => move.call);
  check(typeof row.hints[0].call === 'string' && row.hints[0].call !== '' && offered.includes(row.hints[0].call), `NEGATIVE CONTROL: the hint's call is named by the SERVER from the recorded board (${row.hints[0].call})`);
  check(spent.body.call === row.hints[0].call, `and the answer carries the same name, so the app can show the server's rather than a second one (${spent.body.call})`);

  const badDay = await postHint(hint('h1', LEVEL, 'yesterday'), deps);
  check(badDay.status === STATUS.badRequest && badDay.body.error.code === 'bad_date', `a date that is not a day is refused (${badDay.body.error?.code})`);
  const anon = await postHint({ ...hint('h1', LEVEL, DAY), headers: {} }, deps);
  check(anon.status === STATUS.unauthenticated, `and a hint with no identity is a 401 (${anon.status})`);
}

console.log('\n== 2. the run is CHARGED for what was recorded, and a claim it cannot corroborate is refused ==');
{
  const { store, deps, solution } = await fresh();
  await getPuzzle(read('h2'), deps);
  // THE HINT IS TAKEN BEFORE THE LINE IS RECORDED, and that is the ORDER a player does it in: a hint is what you take
  // when you are stuck, which is before the moves that unstuck you. It also keeps the scenario a real one — a hint taken
  // from a SOLVED board has nothing to name (`POST /me/hints` answers `409 nothing_to_name`, which is the rule §10 states
  // and `hint-event-probe`'s own section 1 relies on), so recording the whole line first made this probe depend on the
  // look-up inventing a call for a run that was already over.
  await grant(store, 'h2', 1);
  const spent = await postHint(hint('h2', LEVEL, DAY), deps);
  check(spent.status === STATUS.ok, `the hint is spent before the line is recorded (${spent.status} ${spent.body.error?.code ?? ''})`);
  // THE LINE IS PLAYED BEFORE IT IS SUBMITTED: the recorded moves are what the run is scored on and the claim is
  // cross-checked against them (A22's Daily half).
  await recordLine('h2', LEVEL, DAY, solution, deps);
  now += 60_000;

  // THE LYING SUBMISSION: a hint was taken and the run claims none. The charge is the RECORDED spend (A23).
  const lied = await postRun(submit('h2', { runId: 'run-hide', mode: 'daily', levelIndex: LEVEL, date: DAY, elapsedSeconds: 60, hintsUsed: 0, calls: solution }), deps);
  const charged = scoreRun({ level: levelAt(LEVEL), shortest: solution.length, moves: solution.length, clockSeconds: 60, hintsUsed: 1, attempts: 0 });
  const asClaimed = scoreRun({ level: levelAt(LEVEL), shortest: solution.length, moves: solution.length, clockSeconds: 60, hintsUsed: 0, attempts: 0 });
  check(lied.status === STATUS.ok && lied.body.run.score === charged.score, `a run hiding a recorded hint is charged the 60 seconds (${lied.body.run?.score})`);
  check(asClaimed.score > charged.score, `NEGATIVE CONTROL: hiding it would have paid ${asClaimed.score} against ${charged.score}`);
  check(lied.body.hints.hints === 0, `and the balance is 0 rather than debited twice (${lied.body.hints.hints})`);
  const row = (await store.get({ pk: `runs#${devId('h2')}`, sk: 'run#run-hide' })).value;
  check(row.hintsUsed === 1 && row.claimedHints === 0, `the run row holds the recorded spend (${row.hintsUsed}) beside the claim (${row.claimedHints})`);

  // THE OTHER DIRECTION: a claim of help the server never recorded is REFUSED, because the only way to spend a hint
  // is through this endpoint — and scoring it would charge the help while the help itself stayed unrecorded.
  await getPuzzle(read('h3'), deps);
  await recordLine('h3', LEVEL, DAY, solution, deps);
  // THE CLOCK HAS TO COVER THE CLAIM FIRST, or the refusal would be `impossible_elapsed` and this check would be
  // measuring the wrong rule — MEASURED: the first version of it did exactly that.
  now += 60_000;
  const invented = await postRun(submit('h3', { runId: 'run-invent', mode: 'daily', levelIndex: LEVEL, date: DAY, elapsedSeconds: 60, hintsUsed: 1, calls: solution }), deps);
  check(invented.status === STATUS.badRequest && invented.body.error.code === 'unrecorded_hints', `a run claiming a hint that was never spent is refused (${invented.status} ${invented.body.error?.code})`);
  check((await store.get({ pk: `runs#${devId('h3')}`, sk: 'run#run-invent' })) === null, 'and nothing was written for it');
}

console.log('\n== 3. the bound, and the item holds what both writers put in it ==');
{
  const { store, deps } = await fresh();
  await getPuzzle(read('h4'), deps);
  // FOUR HELD, WHERE THE CREDIT RULE GRANTS AT MOST THREE: the fixture writes the row directly so the endpoint's
  // OWN bound is what is measured rather than the ledger's.
  await grant(store, 'h4', 4);
  let last = null;
  for (let index = 0; index < MAX_HINTS_PER_ATTEMPT; index++) last = await postHint(hint('h4', LEVEL, DAY), deps);
  check(last.status === STATUS.ok && last.body.hints.hints === 1, `${MAX_HINTS_PER_ATTEMPT} hints are allowed on one challenge (${last.body.hints?.hints} left)`);
  const fourth = await postHint(hint('h4', LEVEL, DAY), deps);
  check(fourth.status === STATUS.conflict && fourth.body.error.code === 'hints_exhausted', `and the ${MAX_HINTS_PER_ATTEMPT + 1}th is refused (${fourth.body.error?.code})`);
  check((await store.get(ROW.hints('h4'))).value.hints === 1, 'with the balance untouched by the refusal');

  // ONE ITEM, THREE WRITERS, AND NONE ERASES ANOTHER. MEASURED because it is how this stage's first draft lost
  // data: a writer that rebuilt the row from its own field alone dropped what the others had put there — a cheat
  // nobody would have had to attempt, only a hint that quietly stopped costing anything. The third writer is A28's
  // reveal, and this check is why every one of them creates the row through `emptyAttempt` rather than spelling the
  // shape out: adding `reveals` made this fixture fail with "Cannot read properties of undefined", which is the
  // instrument working rather than a nuisance.
  const written = asAttemptItem({ startedAtMs: CLOCK, presses: [{ step: 0, call: 'Boys Run', atMs: CLOCK }], moves: [{ kind: 'add', call: 'Boys Run', atMs: CLOCK }], hints: [{ step: 0, call: '', atMs: CLOCK }], reveals: [{ step: 0, call: 'Swing', atMs: CLOCK }] });
  const round = asAttempt({ rev: 1, value: written });
  check(round?.startedAtMs === CLOCK && round.presses.length === 1 && round.moves.length === 1 && round.hints.length === 1 && round.reveals.length === 1, `a row with every field reads back with every field (${JSON.stringify(written).slice(0, 60)}…)`);
  const noStamp = asAttemptItem({ startedAtMs: null, presses: [], moves: [], hints: [], reveals: [] });
  check(noStamp.startedAtMs === undefined, 'and a Drill row writes NO start stamp rather than a null one');
  check(asAttempt({ rev: 1, value: { startedAtMs: CLOCK, hints: [{ step: 0, call: '', atMs: CLOCK }] } })?.presses.length === 0, 'while a row written before presses existed still reads as a fresh log');
  check(asAttempt({ rev: 1, value: { startedAtMs: CLOCK, presses: [], hints: [] } })?.moves.length === 0, 'and a row written before the Daily had a move log reads as an empty one, not as unreadable');
  // THE SAME CONTRACT FOR A28'S FIELD: a Drill row written by the build before reveals existed reads as "nothing was
  // shown", which is the only safe reading of a row that predates the rule (the run's standing is unranked ONLY if a
  // reveal is there, so an old row must not be treated as revealed).
  check(asAttempt({ rev: 1, value: { startedAtMs: CLOCK, presses: [], hints: [] } })?.reveals.length === 0, 'and a row written before reveals existed holds no reveal rather than failing to read');
  // AN EMPTY CALL IS CORRUPTION HERE, where a hint row may hold one for history: nothing wrote a reveal before this
  // build, so there is no legacy to tolerate.
  check(asAttempt({ rev: 1, value: { startedAtMs: CLOCK, presses: [], hints: [], reveals: [{ step: 0, call: '', atMs: CLOCK }] } }) === null, 'while a reveal that names nothing is unreadable rather than an empty one');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
