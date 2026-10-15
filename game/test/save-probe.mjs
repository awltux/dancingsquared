// THE SAVED GAME, pinned: what survives a version change, what survives a pool change, what a hand-edited
// record is allowed to say, and how big the thing is.
//
// WHY THIS IS A GATE AND NOT A NOTE. Everything here is a rule about data the PLAYER controls: `localStorage`
// is a text file they can edit, a browser extension can rewrite, and an older build of this app wrote. A
// loader that trusted it would let a hand-edited balance mint hints on the Daily (DESIGN.md 10 makes a hint
// a currency), and a loader that threw on it would turn a typo into an unplayable game. Each check names the
// wrong rule it rules out, and the negative controls are MEASURED by breaking the implementation on purpose.
//
// THE STORAGE IS INJECTED, which is why this needs no browser: `store.ts` is pure over a `StorageLike`, so
// the fake below, a store that throws, and a store full of nonsense are all just objects.
//
// Usage: node game/test/save-probe.mjs
import {
  emptySave,
  loadGame,
  newRunId,
  recordRun,
  saveGame,
  wallGapMs,
  bestScore,
  SAVE_VERSION,
} from '../src/game/store.ts';
import { Stopwatch } from '../src/game/clock.ts';
import { HINT_CAP, HINT_SUCCESS_STEP, MAX_SAVED_RUNS, SAVE_KEY, SCORE_VERSION } from '../src/puzzle/config.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const POOL = 'ms-1';

/** An in-memory Storage, so a probe can be a browser. */
const memory = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, v),
  };
};
/** A store that refuses to be READ — a blocked origin, private mode. */
const blockedRead = () => ({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
/** A store that reads but refuses to be WRITTEN — a full quota. */
const blockedWrite = (initial) => ({ ...memory(initial), setItem: () => { throw new Error('quota'); } });

const run = (over = {}) => ({
  runId: 'run-1',
  mode: 'drill',
  levelIndex: 1,
  poolVersion: POOL,
  seed: 7,
  position: 0,
  options: ['Allemande Left'],
  elapsedSeconds: 12.5,
  attempts: 1,
  score: 80,
  scoreVersion: SCORE_VERSION,
  recordedAtMs: 1000,
  ...over,
});

const save = (over = {}) => ({ ...emptySave(POOL, 3, 5000), ...over });

/**
 * A JSON string with keys SORTED at every level, so "the same data" is a comparison rather than an accident
 * of which module built the object first: the loader returns its own key order (the `RunRecord` interface's),
 * and a plain `JSON.stringify` comparison would fail on that alone. What this check is for is a difference
 * in SHAPE, not the order the fields happen to be written in.
 */
const stable = (value) => JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);

console.log('== 1. a full record round trips ==');
{
  const storage = memory();
  const state = {
    ...save({
      drillPosition: 5,
      // The RUN ID rides with the run it belongs to: it is what Phase 5's claim is idempotent on, so a resume
      // keeps it rather than minting a second one (and a record without one is refused — see section 14).
      drillRun: { runId: 'run-drill', startedAtMs: 900, attempts: 2, index: 1, options: ['Boys Run'] },
      daily: {
        runId: 'run-daily', day: '2026-10-15', levelIndex: 3, moves: ['Boys Run'], hintsUsed: 1,
        hintedCall: 'Boys Run', elapsedMs: 1500, outcome: 'playing', savedAtMs: 5000,
      },
    }),
    hints: { hints: 2, successes: 7 },
    runs: [run(), run({ runId: 'run-2', mode: 'daily', day: '2026-10-15', moves: ['Allemande Left'], hintsUsed: 1, position: undefined, options: undefined })],
  };
  check(saveGame(storage, state) === true, 'the state is written');
  const loaded = loadGame(storage, POOL);
  check(loaded.saving === true && loaded.dropped === 0, `it loads cleanly (${loaded.dropped} dropped)`);
  check(stable(loaded.state) === stable(state), 'and comes back with exactly the same data');
}

console.log('\n== 2. a store that refuses is not a broken app ==');
{
  const read = loadGame(blockedRead(), POOL);
  check(read.state === null, 'a store that throws on READ yields no state rather than throwing');
  // NEGATIVE CONTROL: `saving` is the flag the screen says "saving is off" from, and a loader that reported
  // `saving: true` here would promise the player their progress is kept when nothing is.
  check(read.saving === false, 'and reports that saving is OFF, so the screen can say so');
  const storage = blockedWrite({});
  check(saveGame(storage, save()) === false, 'a store that throws on WRITE returns false');
  const empty = loadGame(memory(), POOL);
  check(empty.state === null && empty.saving === true, 'while a store with no record is simply empty, and saving is fine');
}

console.log('\n== 3. unparseable text is discarded, not guessed at ==');
{
  for (const junk of ['not json at all', '[]', 'null', '"a string"', '42']) {
    const loaded = loadGame(memory({ [SAVE_KEY]: junk }), POOL);
    check(loaded.state === null, `${JSON.stringify(junk)} yields no state`);
  }
  // NEGATIVE CONTROL: a loader without the shape check would return `"a string"` as a state and crash on the
  // first field read, which is a blank page rather than a fresh game.
}

console.log('\n== 4. a schema change discards the whole record ==');
{
  const older = { ...save(), version: SAVE_VERSION - 1, hints: { hints: 3, successes: 2 } };
  const loaded = loadGame(memory({ [SAVE_KEY]: JSON.stringify(older) }), POOL);
  // NEGATIVE CONTROL, MEASURED: deleting the version check reddens TWO checks — this one and section 3's `[]`,
  // because an empty array passes a bare `typeof === 'object'` test and only the version field rules it out.
  check(loaded.state === null, 'a record from an older schema is not adopted');
}

console.log('\n== 5. a POOL change keeps the hints and drops the rest ==');
{
  const stale = {
    ...save({ drillPosition: 4, runs: [run()], drillRun: { startedAtMs: 1, attempts: 0, index: 0, options: [] } }),
    poolVersion: 'ms-0-old',
    hints: { hints: 2, successes: 6 },
  };
  const loaded = loadGame(memory({ [SAVE_KEY]: JSON.stringify(stale) }), POOL);
  check(loaded.state !== null, 'the record still yields a state');
  check(loaded.state.hints.hints === 2 && loaded.state.hints.successes === 6, `and the hint balance survives it (${loaded.state.hints.hints} held, ${loaded.state.hints.successes} counted)`);
  check(loaded.state.runs.length === 0, 'while the runs are dropped: their seeds are meaningless against the new pool');
  check(loaded.state.drillPosition === 0 && loaded.state.drillRun === null, 'and the progression is dropped with them');
  check(loaded.state.levelIndex === 3, 'and the LEVEL survives, because it is not puzzle data');
  // NEGATIVE CONTROLS, MEASURED, one check each: dropping the hints with the pool reddens 'the hint balance
  // survives it', and keeping the runs reddens 'while the runs are dropped'.
}

console.log('\n== 6. what is read back is CLAMPED ==');
{
  const edited = { ...save(), hints: { hints: 99, successes: 42 } };
  const loaded = loadGame(memory({ [SAVE_KEY]: JSON.stringify(edited) }), POOL);
  // NEGATIVE CONTROL, MEASURED: removing `sanitiseLedger` from the loader reddens THREE checks — both clamps
  // here and the non-numbers case — and a hand-edited `hints: 99` would let the Daily's hint button mint
  // minutes.
  check(loaded.state.hints.hints === HINT_CAP, `a hand-edited balance is clamped to the cap (${loaded.state.hints.hints})`);
  check(loaded.state.hints.successes === HINT_SUCCESS_STEP - 1, `and the count is clamped below the step (${loaded.state.hints.successes})`);
  const nonsense = { ...save(), hints: { hints: 'lots', successes: -5 } };
  const other = loadGame(memory({ [SAVE_KEY]: JSON.stringify(nonsense) }), POOL);
  check(other.state.hints.hints === 0 && other.state.hints.successes === 0, 'and a ledger that is not numbers becomes an empty one');
  // THE FINISHED SET IS A SET OF POSITIONS, so a hand-edited one cannot invent a position that was never
  // played — and a string or a negative in it is dropped rather than carried into the hint rule.
  const badFinished = loadGame(memory({ [SAVE_KEY]: JSON.stringify({ ...save(), finished: [2, 'x', -1, 3.9, null] }) }), POOL);
  // NEGATIVE CONTROL, MEASURED: reading the set straight off the record instead of through `intList` reddens
  // this check and nothing else.
  check(badFinished.state.finished.join(',') === '2,3', `a hand-edited finished set keeps only real positions (${badFinished.state.finished.join(',')})`);
  const badLevel = loadGame(memory({ [SAVE_KEY]: JSON.stringify({ ...save(), levelIndex: -3, drillPosition: 'x' }) }), POOL);
  check(badLevel.state.levelIndex === 1, `a level that is not a level falls back to 1 (${badLevel.state.levelIndex})`);
  check(badLevel.state.drillPosition === 0, 'and a position that is not a number falls back to 0');
}

console.log('\n== 6b. a run record without an ID is refused whole ==');
{
  // THE ID IS THE CLAIM KEY, so a record that has lost it cannot be submitted idempotently: Phase 5 would
  // either drop the run or claim it twice. Refusing the record is the only answer that cannot double-count —
  // and it costs the player nothing they can see, because the drill simply re-issues.
  const noDrillId = loadGame(memory({ [SAVE_KEY]: JSON.stringify({ ...save(), drillRun: { startedAtMs: 1, attempts: 0, index: 0, options: [] } }) }), POOL);
  check(noDrillId.state.drillRun === null, 'a drill record with no runId is not carried');
  const noDailyId = loadGame(memory({ [SAVE_KEY]: JSON.stringify({ ...save(), daily: { day: '2026-10-15', levelIndex: 1, moves: [], hintsUsed: 0, hintedCall: null, elapsedMs: 0, outcome: 'playing', savedAtMs: 0 } }) }), POOL);
  check(noDailyId.state.daily === null, 'nor is a Daily record with no runId');
  // THE HINT COUNT IS BOUNDED BY THE BALANCE. A run cannot have spent more hints than a player can hold
  // (DESIGN.md 10), the charge is folded into the elapsed time, and the elapsed is what the score's time
  // factor reads — so an unbounded count is an unbounded score for a run nobody played.
  const manyHints = loadGame(memory({ [SAVE_KEY]: JSON.stringify({ ...save(), daily: { runId: 'r', day: '2026-10-15', levelIndex: 1, moves: [], hintsUsed: 99, hintedCall: null, elapsedMs: 0, outcome: 'playing', savedAtMs: 0 } }) }), POOL);
  check(manyHints.state.daily.hintsUsed === HINT_CAP, `a record claiming 99 hints is clamped to the cap (${manyHints.state.daily.hintsUsed})`);
  // NEGATIVE CONTROLS, MEASURED, one line each: relaxing the DRILL's id check reddens the drill check above,
  // and relaxing the Daily's reddens the Daily one. Neither can be a single control, because the two records
  // are validated in different functions — which is also why a store cannot mint an id for a run it did not
  // issue: dropping the record is the only answer that cannot double-claim.
}

console.log('\n== 7. a run recorded twice is ONE run ==');
{
  const once = recordRun(save(), run());
  const twice = recordRun(once, run());
  // NEGATIVE CONTROL, MEASURED: an append without the dedupe reddens BOTH checks here, and the consequence is
  // Phase 5 claiming the same run twice — the ledger's `runId` exists to make that impossible.
  check(twice.runs.length === 1, `the same runId twice is one entry (${twice.runs.length})`);
  const third = recordRun(twice, run({ runId: 'run-2' }));
  check(third.runs.length === 2 && third.runs[1].runId === 'run-2', 'and a different id is a second entry, newest last');
}

console.log('\n== 8. the ledger is a bounded QUEUE, newest kept ==');
{
  let state = save();
  const total = MAX_SAVED_RUNS + 150;
  for (let i = 0; i < total; i++) state = recordRun(state, run({ runId: `run-${i}`, score: i }));
  check(state.runs.length === MAX_SAVED_RUNS, `recording ${total} runs keeps ${MAX_SAVED_RUNS} (${state.runs.length})`);
  // NEGATIVE CONTROL, MEASURED: trimming from the newest end (`slice(0, MAX)`) reddens BOTH ordering checks
  // here — it would keep the OLDEST runs, which are the ones Phase 5 has already claimed.
  check(state.runs[state.runs.length - 1].runId === `run-${total - 1}`, `and the NEWEST is the last one kept (${state.runs[state.runs.length - 1].runId})`);
  check(state.runs[0].runId === `run-${total - MAX_SAVED_RUNS}`, `with the oldest ${total - MAX_SAVED_RUNS} dropped (first kept ${state.runs[0].runId})`);
}

console.log('\n== 9. a run that is not a run is dropped and COUNTED ==');
{
  const mixed = {
    ...save(),
    runs: [run(), { runId: 'broken' }, run({ runId: 'run-3', elapsedSeconds: 'soon' })],
  };
  const loaded = loadGame(memory({ [SAVE_KEY]: JSON.stringify(mixed) }), POOL);
  check(loaded.state.runs.length === 1, `only the well-formed run survives (${loaded.state.runs.length})`);
  // The dropped count is reported so a silent zero cannot be a coverage gap: the loader's silence about bad
  // data is itself a bug (AGENTS.md 4.1), so the number reaches the console from the shell.
  check(loaded.dropped === 2, `and the two unusable records are COUNTED (${loaded.dropped})`);
}

console.log('\n== 10. ids are unique, with and without crypto ==');
{
  const withCrypto = new Set();
  for (let i = 0; i < 1000; i++) withCrypto.add(newRunId(1000 + i));
  check(withCrypto.size === 1000, `1000 ids from the platform are all distinct (${withCrypto.size})`);
  // THE FALLBACK IS THE PATH A NON-SECURE ORIGIN TAKES, and it is measured by removing `crypto` rather than
  // by reading the branch: a LAN `http://` build has no `randomUUID` at all.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  const without = new Set();
  for (let i = 0; i < 100; i++) without.add(newRunId(2000 + i));
  if (original) Object.defineProperty(globalThis, 'crypto', original);
  check(without.size === 100, `and 100 from the stamped fallback are distinct too (${without.size})`);
  check([...without].every((id) => id.startsWith('r')), 'and the fallback ids are recognisable by their prefix');

  // ACROSS A RELOAD, WHICH IS THE CASE THE COUNTER ALONE CANNOT COVER. The counter is module state, so it
  // restarts at zero when the page does — and two runs recorded in the same millisecond either side of a
  // reload would then collide, which `recordRun`'s dedupe turns into a SILENTLY DROPPED RUN. A second module
  // instance is what a reload IS for this module, and it is loaded for real (a query string is a different
  // URL, so Node evaluates it again) rather than mocked.
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  // TWO FRESH INSTANCES, not this one: the counter of a module instance has already moved past zero by here
  // (the loop above took 100 ids from it), and a reload that restarts at zero would then look unique for the
  // wrong reason. MEASURED while writing this: the first version of the check passed with the entropy REMOVED
  // for exactly that reason, which is a check no alternative fails.
  const loadA = await import('../src/game/store.ts?load-a');
  const firstIds = [loadA.newRunId(5000), loadA.newRunId(5000)];
  const loadB = await import('../src/game/store.ts?load-b');
  const secondIds = [loadB.newRunId(5000), loadB.newRunId(5000)];
  if (original) Object.defineProperty(globalThis, 'crypto', original);
  // NEGATIVE CONTROL, MEASURED: dropping the random part of the fallback makes the two loads produce the SAME
  // two ids — same millisecond, counter back at one — so the set holds 2 rather than 4 and this check is the
  // only one that reddens.
  check(new Set([...firstIds, ...secondIds]).size === 4, `four ids from two loads of the module in the same millisecond are all distinct (${new Set([...firstIds, ...secondIds]).size})`);
}

console.log('\n== 11. the best score counts only this build\'s weights ==');
{
  const runs = [run({ score: 400, scoreVersion: SCORE_VERSION - 1 }), run({ runId: 'b', score: 120 }), run({ runId: 'c', score: 90 })];
  check(bestScore(runs, SCORE_VERSION) === 120, `an old-weight run does not win the comparison (${bestScore(runs, SCORE_VERSION)})`);
  check(bestScore([], SCORE_VERSION) === null, 'and an empty ledger has no best');
  // NEGATIVE CONTROL, MEASURED: ignoring `scoreVersion` reddens the first check, and the readout would
  // advertise a score the current weights could not produce.
}

console.log('\n== 12. the gap rule ==');
{
  check(wallGapMs(1000, 4000) === 3000, 'a page closed for three seconds charges three seconds');
  check(wallGapMs(1000, 1000) === 0, 'no time away is no gap');
  // A clock that moved backwards — an NTP correction, a manual change — must not hand time back.
  check(wallGapMs(4000, 1000) === 0, 'and a clock that moved backwards charges nothing rather than a negative gap');
}

console.log('\n== 13. how big the record is ==');
{
  let state = save({ drillPosition: 9, drillRun: { startedAtMs: 1, attempts: 3, index: 1, options: ['Boys Run'] } });
  for (let i = 0; i < MAX_SAVED_RUNS; i++) {
    state = recordRun(state, run({
      runId: `run-${i}-${'x'.repeat(20)}`,
      mode: i % 2 === 0 ? 'drill' : 'daily',
      day: '2026-10-15',
      moves: ['Allemande Left in the Alamo Style', 'Cast Off Three Quarters', 'Boys Run'],
      options: ['Allemande Left in the Alamo Style', 'Cast Off Three Quarters'],
      hintsUsed: 1,
    }));
  }
  const bytes = JSON.stringify(state).length;
  console.log(`       a full save (version + 4 daily/drill records + ${MAX_SAVED_RUNS} runs of long call names): ${bytes} bytes`);
  check(bytes < 200_000, `and it is small enough for localStorage by two orders of magnitude (${bytes} < 200000)`);
  const back = loadGame(memory({ [SAVE_KEY]: JSON.stringify(state) }), POOL);
  check(back.state.runs.length === MAX_SAVED_RUNS && back.dropped === 0, 'and a full record loads without dropping anything');
}

console.log('\n== 14. a resumed clock is RE-BASED, not restarted ==');
{
  // THE ORIGIN MOVES AND THE READING FOLLOWS, which is why there is no separate "elapsed so far" field for a
  // resumed run to disagree with. Measured on the clock itself, before any run uses it.
  const clock = new Stopwatch();
  clock.start(1000);
  check(clock.elapsedSeconds(3000) === 2, `a started clock reads the time since it started (${clock.elapsedSeconds(3000)}s)`);
  clock.resume(20000, 40000);
  check(clock.isRunning, 'a re-based clock is running');
  check(clock.elapsedSeconds(20000) === 40, `and reads exactly the elapsed it was handed (${clock.elapsedSeconds(20000)}s)`);
  check(clock.elapsedSeconds(25000) === 45, 'and keeps counting from there');
  // A STOPPED CLOCK IS FROZEN WHERE IT WAS, which is the second half of the resume rule: a finished run gets
  // no gap because its clock had already stopped.
  clock.stop(30000);
  check(clock.isStopped && clock.elapsedSeconds(90000) === 50, `and stopping freezes it (${clock.elapsedSeconds(90000)}s)`);
  // NEGATIVE CONTROLS, MEASURED: a `resume` that kept its old origin reddens THREE checks here — the two
  // "exactly the elapsed" readings and the frozen reading after `stop`.
  const negative = new Stopwatch();
  negative.resume(1000, -5000);
  check(negative.elapsedSeconds(1000) === 0, 'a negative elapsed reads as zero at the moment of the resume');
  // THE LATER READING IS WHAT THE CLAMP IS FOR, and the first check does not catch it: `elapsedSeconds` floors
  // at zero on its own, so an origin five seconds in the FUTURE still reads 0 now and then jumps. MEASURED:
  // removing the clamp in `resume` leaves the check above green and reddens this one.
  check(negative.elapsedSeconds(3000) === 2, `and two seconds later it reads two (${negative.elapsedSeconds(3000)}s, where an unclamped origin would read five seconds ahead of the run)`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
