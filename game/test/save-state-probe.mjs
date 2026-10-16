// THE SAVED GAME AS THE SHELL USES IT, pinned: one success per issued drill, one run entry per `runId`, one
// spend per hint, a Daily that a drill mutation cannot erase, and a `saving` flag that is the last write's
// answer.
//
// WHY THIS IS A GATE AND NOT A NOTE. These rules lived in `main.ts` as four module-level variables written
// from wherever a handler happened to need them, so the only instrument that could see them was a browser —
// and one of them (a drill mutation writing `daily: null` over an un-resumed attempt) was in fact found in a
// browser, after it had shipped. `save-state.ts` exists so the rules are reachable from a probe; this is the
// probe, and it is the reason the next person can change a handler without re-deriving what it may write.
//
// THE STORAGE IS INJECTED (`SaveState.open` takes a `StorageLike`), so the fake below and the store that
// throws are both just objects and no page is needed.
//
// Usage: node game/test/save-state-probe.mjs
import { SaveState } from '../src/game/save-state.ts';
import { EMPTY_LEDGER, recordSuccess } from '../src/puzzle/hints.ts';
import { HINT_CAP, HINT_SUCCESS_STEP, SAVE_KEY, SCORE_VERSION } from '../src/puzzle/config.ts';

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
/** A store that refuses both ways — a blocked origin, private mode. */
const blocked = () => ({
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
});
/** A store that reads but refuses to be WRITTEN — a full quota. */
const readOnly = (initial = {}) => ({ ...memory(initial), setItem: () => { throw new Error('quota'); } });

const open = (storage) => SaveState.open(storage, POOL);

const DAILY = {
  runId: 'daily-1',
  day: '2026-10-15',
  levelIndex: 1,
  moves: ['Allemande Left'],
  hintsUsed: 1,
  hintedCall: 'Boys Run',
  elapsedMs: 9000,
  outcome: 'playing',
  savedAtMs: 5000,
};

console.log('== 1. a position counts ONCE, however many times it is solved ==');
{
  const state = open(memory()).state;
  const first = state.countSuccess(0);
  check(first.firstTime && !first.granted, 'the first solve of a position is counted (and grants nothing at a zero balance)');
  const again = state.countSuccess(0);
  check(!again.firstTime && !again.granted, 'and solving the SAME position again is neither counted nor granted');

  // NINE DISTINCT POSITIONS, THEN THE FIRST ONE FOUR MORE TIMES. This is the shape a reload and a
  // Next-and-return actually produce — the fixture re-issues entry 0 and it is solved again — so the check is
  // the real sequence rather than a second call in isolation.
  for (let i = 1; i < HINT_SUCCESS_STEP - 1; i++) state.countSuccess(i);
  const earned = state.hints;
  for (let i = 0; i < 4; i++) state.countSuccess(0);
  check(state.hints.hints === 0 && state.hints.successes === earned.successes,
    `four replays of an already-finished drill leave the ledger untouched (${state.hints.hints} held, ${state.hints.successes} counted)`);

  // NEGATIVE CONTROL, MEASURED: the rule as it stood before the finished set existed — `recordSuccess` on
  // every solve, with no memory of which positions were already counted. Driven through the SAME sequence, it
  // grants here (9 counted + the first replay completes the step), which is the farm this section rules out.
  // Only the check above reddens for it: the two checks before it pass under the wrong rule as well.
  let farmed = EMPTY_LEDGER;
  for (let i = 0; i < HINT_SUCCESS_STEP - 1; i++) farmed = recordSuccess(farmed).ledger;
  farmed = recordSuccess(farmed).ledger;
  check(farmed.hints === 1, `NEGATIVE CONTROL: a rule with no finished set mints a hint on the first replay (${farmed.hints} held where the state holds ${state.hints.hints})`);
}

console.log('\n== 1b. a REVEALED drill is finished and earns NOTHING (DESIGN.md §15 Q16, A28) ==');
{
  // NINE DISTINCT POSITIONS IN, ONE SHORT OF A GRANT, which is §2's sequence so the instrument is the rule rather
  // than an arithmetic fixture: the next success completes the step unless the drill was shown.
  const state = open(memory()).state;
  for (let i = 0; i < HINT_SUCCESS_STEP - 1; i++) state.countSuccess(i);
  const revealed = state.countSuccess(HINT_SUCCESS_STEP - 1, { revealed: true });
  check(revealed.firstTime, 'a revealed drill is COUNTED — the player did answer it');
  check(!revealed.granted && state.hints.hints === 0, `and it grants nothing (${state.hints.hints} held, where the ${HINT_SUCCESS_STEP}th success would have completed the step)`);
  // NEGATIVE CONTROL, MEASURED: the same position on the same ledger WITHOUT the flag — the rule as it stood before
  // A28, which grants here. Only the check above reddens for it.
  const ordinary = open(memory()).state;
  for (let i = 0; i < HINT_SUCCESS_STEP - 1; i++) ordinary.countSuccess(i);
  check(ordinary.countSuccess(HINT_SUCCESS_STEP - 1).granted, 'NEGATIVE CONTROL: the same drill NOT revealed grants the hint');
  // AND THE POSITION IS STILL FINISHED, which is the other half of the rule: skipping the record entirely would leave
  // the revealed position able to earn on a replay, which is the farm §1 rules out.
  check(!state.countSuccess(HINT_SUCCESS_STEP - 1, { revealed: true }).firstTime, 'while the position stays finished, so a replay cannot earn it either');
  check(state.hints.hints === 0, `and the balance is still untouched (${state.hints.hints} held)`);
}

console.log('\n== 2. the grant lands on the tenth DISTINCT drill ==');
{
  // THE CONTROL FOR THESE CHECKS IS SECTION 1'S, and it is the same rule one position earlier: the wrong rule
  // — counting successes instead of distinct positions — grants on a REPLAY of the ninth drill, so it is the
  // number of DISTINCT drills that these checks read, not the number of solves.
  const state = open(memory()).state;
  let granted = 0;
  for (let i = 0; i < HINT_SUCCESS_STEP - 1; i++) if (state.countSuccess(i).granted) granted++;
  check(granted === 0 && state.hints.hints === 0, `the first ${HINT_SUCCESS_STEP - 1} successes grant nothing (${granted} grants)`);
  const tenth = state.countSuccess(HINT_SUCCESS_STEP - 1);
  check(tenth.firstTime && tenth.granted, `the ${HINT_SUCCESS_STEP}th distinct position grants one hint`);
  check(state.hints.hints === 1 && state.hints.successes === 0, `and the balance is one with the count reset (${state.hints.hints} held, ${state.hints.successes} counted)`);
  check(!state.countSuccess(HINT_SUCCESS_STEP - 1).granted, 'and re-solving the granting drill grants nothing more');
  check(state.hints.hints === 1, `nor spends it (${state.hints.hints} held)`);
}

console.log('\n== 3. a run is recorded once, by id ==');
{
  const state = open(memory()).state;
  const run = (over = {}) => ({
    runId: 'run-1', mode: 'drill', levelIndex: 1, poolVersion: POOL, seed: 7, position: 0,
    options: ['Allemande Left'], elapsedSeconds: 12.5, attempts: 1, score: 80,
    scoreVersion: SCORE_VERSION, recordedAtMs: 1000, ...over,
  });
  check(state.addRun(run()) === 1, 'the first entry is added (1)');
  check(state.addRun(run()) === 0, 'and the same id the second time adds NOTHING (0)');
  check(state.runs.length === 1, `so the ledger holds one run, not two (${state.runs.length})`);
  check(state.addRun(run({ runId: 'run-2', score: 100 })) === 1, 'a different id is a different run (1)');
  check(state.best === 100, `and the best score follows the ledger (${state.best})`);

  // NEGATIVE CONTROL, MEASURED: the append that has no id in it — `[...runs, run]` — adds the second entry
  // and would make the Daily's repaint (which runs on every frame) grow the ledger by one per frame. It
  // reddens ONLY the two checks above; the length check passes under it, because 1 versus 2 is exactly what
  // those two report.
  const appended = [...state.runs, run()].length;
  check(appended === state.runs.length + 1, `NEGATIVE CONTROL: an append with no dedupe grows the ledger (${appended} where the state holds ${state.runs.length})`);
}

console.log('\n== 4. a spend with an empty balance changes NOTHING ==');
{
  const state = open(memory()).state;
  check(state.hints.hints === 0, 'a fresh game holds no hints');
  check(state.spendHint() === false, 'and asking to spend one reports that it did not');
  check(state.hints.hints === 0, 'and the balance is untouched at zero');
  // EARNING AT THE CAP IS RULE 2 OF `hints.ts`, restated here only to get a balance to spend: the state must
  // not become a second implementation of the earning rule, so it is reached the way a player reaches it.
  for (let i = 0; i < HINT_SUCCESS_STEP * HINT_CAP; i++) state.countSuccess(i);
  check(state.hints.hints === HINT_CAP, `earning reaches the cap and stops (${state.hints.hints} held)`);
  const successes = state.hints.successes;
  check(state.spendHint() === true, 'a spend with a balance reports that it happened');
  check(state.hints.hints === HINT_CAP - 1, `and costs exactly one (${state.hints.hints} held)`);
  check(state.hints.successes === successes, 'and leaves the progress towards the next hint alone');

  // NEGATIVE CONTROL, MEASURED: a spend that decrements without asking — `hints - 1` — takes the empty
  // balance to -1, which is a hint the Daily would name out of nothing. It reddens only the empty-balance
  // pair above.
  check(EMPTY_LEDGER.hints - 1 === -1, `NEGATIVE CONTROL: an unguarded spend goes negative (${EMPTY_LEDGER.hints - 1} where the state stays at 0)`);
}

console.log('\n== 4b. a balance the server states is ADOPTED, and it is the whole balance ==');
{
  const state = open(memory()).state;
  state.adoptHints({ hints: 2, successes: 7 });
  check(state.hints.hints === 2 && state.hints.successes === 7, `the server's numbers replace the local ones (${state.hints.hints} held, ${state.hints.successes} counted)`);
  // THE PROGRESS IS ADOPTED TOO, not just the balance: the server counts successes from its own record of finished
  // drills, so keeping the local count would make the next grant disagree with the server that awards it.
  state.adoptHints({ hints: 2, successes: 0 });
  check(state.hints.successes === 0, 'NEGATIVE CONTROL: a stated count of 0 is adopted as 0, not ignored as "nothing to say"');
  // AND THE LOCAL RULE STILL WORKS ON TOP OF IT, because offline there is no server to ask (rule 1 in the module
  // header): a success after an adopted balance counts normally.
  const before = state.hints.successes;
  state.countSuccess(0);
  check(state.hints.successes === before + 1, `and the local earning rule still runs on an adopted balance (${state.hints.successes})`);
}

console.log('\n== 5. what is written is what a fresh page reads ==');
{
  const storage = memory();
  const first = open(storage).state;
  first.addRun({
    runId: 'run-1', mode: 'daily', levelIndex: 2, poolVersion: POOL, seed: 9, day: '2026-10-15',
    moves: ['Allemande Left'], hintsUsed: 0, elapsedSeconds: 30, attempts: 0, score: 120,
    scoreVersion: SCORE_VERSION, recordedAtMs: 2000,
  });
  for (let i = 0; i < HINT_SUCCESS_STEP; i++) first.countSuccess(i);
  first.persist({ levelIndex: 2, position: 5, drill: { runId: 'd', startedAtMs: 1, attempts: 2, index: 3, options: ['Boys Run'] }, daily: DAILY, wallNowMs: 6000 });
  check(storage.map.has(SAVE_KEY), `the write reaches the injected storage (${SAVE_KEY})`);

  // A SECOND PAGE, not a second read of the same object: `open` is what a reload calls, and it must rebuild
  // everything the shell reads from the text alone.
  const second = open(storage).state;
  check(second.position === 5, `the issued drill position survives (${second.position})`);
  check(second.levelIndex === 2, `and the level it was issued at (${second.levelIndex})`);
  check(second.hints.hints === 1 && second.hints.successes === 0, `and the balance (${second.hints.hints} held, ${second.hints.successes} counted)`);
  check(second.runs.length === 1 && second.best === 120, `and the ledger (${second.runs.length} run, best ${second.best})`);
  check(second.drillRun?.index === 3, `and the drill in flight (step ${second.drillRun?.index})`);
  check(second.daily?.runId === 'daily-1', `and the Daily in flight (${second.daily?.runId})`);
  check(second.resumed, 'and it reports itself as a resumed game');
  // THE FINISHED SET SURVIVES TOO, and it is measured by its EFFECT rather than by reading it: re-solving a
  // position the first page counted must not count again on the second.
  check(!second.countSuccess(0).firstTime, 'and a drill solved before the reload is still counted as solved');

  const fresh = open(memory()).state;
  check(!fresh.resumed && fresh.position === 0, 'while a device with nothing stored opens a fresh game');

  // THE KEEP-WHAT-IS-STORED RULE IS ABOUT THE DAILY AND NOTHING ELSE. Over-applying it — "keep the stored
  // value for any field the caller did not set" — would leave a finished drill in the record for the next
  // reload to resume, so the rule has to be measured on both sides of the line. The shell clears the drill
  // (`drill: null`) the moment it is over, and clears the position with it.
  second.persist({ levelIndex: 1, position: 0, drill: null, daily: null, wallNowMs: 9000 });
  const third = open(storage).state;
  check(third.drillRun === null && third.position === 0, `a drill that is over is CLEARED by the next write (drill ${third.drillRun}, position ${third.position})`);
  check(third.daily?.runId === 'daily-1', 'while the Daily is the ONE field that keeps what was stored');
}

console.log('\n== 6. a browser that refuses to save is reported, and the game goes on ==');
{
  const state = open(blocked()).state;
  check(state.saving === false, 'a storage that throws on read opens the game with saving off');
  check(state.countSuccess(0).firstTime, 'and a drill can still be solved');
  check(state.spendHint() === false && state.saving === false, 'and a spend reports itself rather than throwing');
  check(!state.persist({ levelIndex: 1, position: 1, drill: null, daily: null, wallNowMs: 1 }), 'and a write reports that it did not land');

  // THE FLAG IS THE LAST WRITE'S ANSWER, not a property of the browser: a store that reads fine and refuses
  // to write opens as saving, and only the failed write turns the readout off.
  const quota = readOnly();
  const limited = open(quota).state;
  check(limited.saving === true, 'a store that reads but cannot write opens as saving');
  limited.persist({ levelIndex: 1, position: 0, drill: null, daily: null, wallNowMs: 1 });
  check(limited.saving === false, 'and the failed write is what turns it off');
  // NEGATIVE CONTROL, MEASURED: a flag fixed at boot — `saving` as `open` returned it — still reads true
  // after that same refused write, which is the footer claiming a game is being kept that is not. Only the
  // check above reddens for it; the "opens as saving" check passes under both rules.
  check(open(readOnly()).state.saving === true && limited.saving === false,
    `NEGATIVE CONTROL: the value at boot is not the answer after a write (${open(readOnly()).state.saving} at open, ${limited.saving} after)`);
}

console.log('\n== 7. a drill mutation cannot erase the Daily ==');
{
  const storage = memory();
  const state = open(storage).state;
  state.persist({ levelIndex: 1, position: 0, drill: null, daily: DAILY, wallNowMs: 6000 });
  check(state.daily?.runId === 'daily-1', 'a Daily in flight is stored');

  // THE SHELL BOOTS ON THE DRILL, so the first mutation of a session happens with no Daily in memory and
  // passes `daily: null`. MEASURED IN THE BROWSER before this rule existed: doing exactly that and reloading
  // showed today's Daily back at 0:00 with an empty line.
  state.persist({ levelIndex: 1, position: 0, drill: null, daily: null, wallNowMs: 7000 });
  check(state.daily?.runId === 'daily-1', `and a drill mutation with no Daily in memory keeps it (${state.daily?.runId})`);
  check(open(storage).state.daily?.runId === 'daily-1', 'and it is still there after a reload');

  // A LIVE DAILY REPLACES IT, otherwise the field would be write-only and a second attempt could never be
  // resumed.
  state.persist({ levelIndex: 1, position: 0, drill: null, daily: { ...DAILY, runId: 'daily-2', hintsUsed: 0 }, wallNowMs: 9000 });
  check(state.daily?.runId === 'daily-2', `while a live Daily does replace it (${state.daily?.runId})`);

  // NEGATIVE CONTROL, MEASURED: the rule as written before — `daily: parts.daily` — puts `null` in the record,
  // and the reload reads nothing back. It reddens only the two "keeps it" checks above.
  const wiped = { ...JSON.parse(storage.map.get(SAVE_KEY)), daily: null, savedAtMs: 9000 };
  const control = memory({ [SAVE_KEY]: JSON.stringify(wiped) });
  check(open(control).state.daily === null, 'NEGATIVE CONTROL: a record written with a null Daily resumes nothing');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
