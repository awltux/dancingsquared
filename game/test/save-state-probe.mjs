// THE SAVED GAME AS THE SHELL USES IT, pinned: one finish per issued drill, one spend per hint, a Daily that a drill
// mutation cannot erase, a `saving` flag that is the last write's answer, and — the rule the server-only score added —
// a solve that credits NOTHING locally, because the score and the hint balance are the server's.
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
import { emptySave } from '../src/game/store.ts';
import { EMPTY_LEDGER, recordSuccess } from '../src/puzzle/hints.ts';
import { HINT_CAP, HINT_SUCCESS_STEP, SAVE_KEY } from '../src/puzzle/config.ts';

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

console.log('== 1. a position counts ONCE, and a solve credits NOTHING locally ==');
{
  const state = open(memory()).state;
  const first = state.markFinished(0);
  check(first.firstTime, 'the first solve of a position is new');
  const again = state.markFinished(0);
  check(!again.firstTime, 'and solving the SAME position again is not');

  // NINE DISTINCT POSITIONS, THEN THE FIRST ONE FOUR MORE TIMES. This is the shape a reload and a
  // Next-and-return actually produce — the fixture re-issues entry 0 and it is solved again — so the check is
  // the real sequence rather than a second call in isolation.
  for (let i = 1; i < HINT_SUCCESS_STEP; i++) state.markFinished(i);
  for (let i = 0; i < 4; i++) state.markFinished(0);
  check(state.finishedPositions.length === HINT_SUCCESS_STEP,
    `ten distinct positions are recorded, and the replays add none (${state.finishedPositions.length})`);
  // THE SERVER IS THE ONE POINT OF TRUTH FOR THE BALANCE (DESIGN.md 10, 11), so the device credits nothing at all:
  // fourteen solves, nine of them distinct, leave the cached ledger at zero until the server states one.
  check(state.hints.hints === 0 && state.hints.successes === 0,
    `and the device credits no hint for any of it (${state.hints.hints} held, ${state.hints.successes} counted)`);

  // NEGATIVE CONTROL, MEASURED: the rule as it stood while the device kept a ledger — `recordSuccess` on every
  // solve — grants a hint on this same fourteen-solve sequence (ten counted successes). It reddens ONLY the
  // zero-credit check above; the finished-set checks pass under it, because the earning rule never looked at the set.
  let farmed = EMPTY_LEDGER;
  for (let i = 0; i < HINT_SUCCESS_STEP + 4; i++) farmed = recordSuccess(farmed).ledger;
  check(farmed.hints === 1 && state.hints.hints === 0,
    `NEGATIVE CONTROL: paying each solve locally would hold ${farmed.hints} hint here`);
}

// THERE IS NO == 1b, 1c OR 2 any more. They measured the device's GRANT — a revealed drill earning nothing, the
// tenth distinct position minting a hint — and the device no longer pays a hint or scores a run at all: the server
// counts the finished drills from its own Progress rows and debits from its own balance. The rules still hold, and
// are measured where they now live: `game/test/hint-ledger-probe.mjs` pins the ten-distinct rule in `hints.ts`, and
// `api/test/reveal-probe.mjs` MEASURED that a revealed drill grants nothing (its negative control records what the
// same solve would have paid). What remains here is the set the grid draws, which is the device's half.

console.log('\n== 1d. FINISHED and PASSED are different sets, which is what the level grid draws ==');
{
  // THE DEVICE'S HALF OF THE SERVER'S RULE: a revealed solve finishes a position without passing it. The grid shows "done"
  // against "done and passed", so a ledger that called a revealed solve a pass would tell a player they had learned a
  // drill they were shown the answer to. (A SKIP USED TO BE THE OTHER PRODUCER HERE; the control is withdrawn, so there is
  // no local writer for it any more — `save-state.ts` records why the set stays.)
  const state = open(memory()).state;
  state.markFinished(0);
  state.markFinished(1, { revealed: true });
  state.markFinished(2, { revealed: true });
  check(state.finishedPositions.join(',') === '0,1,2', `three positions are finished (${state.finishedPositions.join(',')})`);
  check(state.passedPositions.join(',') === '0', `and only the unaided solve is passed (${state.passedPositions.join(',')})`);
  // THE GETTERS ARE COPIES: a caller renders them, and must not be able to reorder the record by sorting what it was
  // handed — sorting the returned array is the first thing a grid does.
  const copy = [...state.finishedPositions].sort((a, b) => b - a);
  check(copy.join(',') === '2,1,0' && state.finishedPositions.join(',') === '0,1,2',
    'the returned lists are copies, so a caller cannot mutate the record');
  // A RECORD FROM BEFORE THE SPLIT reads as "finished, pass unknown" rather than as a failure. Written the way a real
  // old record exists: the current one with the field removed, so this is the migration and not a shape I invented.
  const storage = memory();
  const raw = { ...emptySave(POOL, 1, 0), finished: [0] };
  delete raw.passed;
  storage.map.set(SAVE_KEY, JSON.stringify(raw));
  const legacy = open(storage).state;
  check(legacy.finishedPositions.join(',') === '0' && legacy.passedPositions.length === 0,
    `a record written before the pass set existed still loads (${legacy.finishedPositions.length} finished, ${legacy.passedPositions.length} passed)`);
  // A HAND-EDITED RECORD THAT PASSES WHAT IT DOES NOT CALL FINISHED is a contradiction; the reader drops the
  // impossible half rather than inventing a meaning for it.
  const impossibleStorage = memory();
  impossibleStorage.map.set(SAVE_KEY, JSON.stringify({ ...emptySave(POOL, 1, 0), finished: [0], passed: [0, 5] }));
  const impossible = open(impossibleStorage).state;
  check(impossible.passedPositions.join(',') === '0',
    `a pass outside the finished set is dropped (${impossible.passedPositions.join(',') || 'none'})`);
}

console.log('\n== 2. the grant lands on the tenth DISTINCT drill, ON THE SERVER ==');
{
  // THE DEVICE HAS NO COPY OF THIS RULE ANY MORE, and the section stays as a pointer rather than a deleted gap:
  // `recordSuccess` is the rule, `game/test/hint-ledger-probe.mjs` pins it, and `api/src/handlers/runs.ts` is the
  // one caller that pays a hint. What is checked here is the part the device still owns — that it states no
  // balance the server did not send, so a fresh game reports zero whatever it has finished.
  const state = open(memory()).state;
  const tenth = state.markFinished(HINT_SUCCESS_STEP - 1);
  check(tenth.firstTime, `the ${HINT_SUCCESS_STEP}th distinct position is recorded as new (${tenth.firstTime})`);
  check(state.hints.hints === 0 && state.hints.successes === 0,
    `and the device holds no balance of its own to grant from (${state.hints.hints} held, ${state.hints.successes} counted)`);
  check(recordSuccess({ hints: 0, successes: HINT_SUCCESS_STEP - 1 }).granted,
    'NEGATIVE CONTROL: the rule itself does grant on the tenth distinct position, so the zero above is the device not paying');
}

// THERE IS NO == 3. It measured the device's run ledger (record a run once, by id; the best score follows it), and
// that ledger is gone: a run's score is the server's row for the account, so the device keeps no copy to record.
// The rule it pinned — a Daily repaint must not append the same run every frame — moved to the server's idempotent
// `POST /runs`, which `api/test/runs-probe.mjs` measures.

console.log('\n== 4. a spend with an empty balance changes NOTHING ==');
{
  const state = open(memory()).state;
  check(state.hints.hints === 0, 'a fresh game holds no hints');
  check(state.spendHint() === false, 'and asking to spend one reports that it did not');
  check(state.hints.hints === 0, 'and the balance is untouched at zero');
  // THE BALANCE ARRIVES FROM THE SERVER, so it is adopted rather than earned: `hints.ts` owns the earning rule, but
  // nothing on the device calls it any more (the server does, per run). The state must not become a second
  // implementation of it, which is why this section never re-derives a grant.
  state.adoptHints({ hints: HINT_CAP, successes: 0 });
  check(state.hints.hints === HINT_CAP, `the balance the server stated is here to spend (${state.hints.hints} held)`);
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
  // AND THE DEVICE ADDS NOTHING ON TOP OF IT: a solve after an adopted balance leaves the cached numbers exactly as
  // the server stated them, because a local solve is a practice record and pays nothing.
  const before = state.hints;
  state.markFinished(0);
  check(state.hints.hints === before.hints && state.hints.successes === before.successes,
    `and a local solve does not touch an adopted balance (${state.hints.hints} held, ${state.hints.successes} counted)`);
}

console.log('\n== 5. what is written is what a fresh page reads ==');
{
  const storage = memory();
  const first = open(storage).state;
  for (let i = 0; i < HINT_SUCCESS_STEP; i++) first.markFinished(i);
  // A BALANCE THE SERVER STATED IS PART OF THE RECORD and must survive the write like everything else — this is the
  // cache `adoptHints` holds, which is why the reload check below is about the CACHE and not about earning.
  first.adoptHints({ hints: 1, successes: 0 });
  first.persist({ levelIndex: 2, position: 5, drill: { runId: 'd', startedAtMs: 1, attempts: 2, index: 3, options: ['Boys Run'] }, daily: DAILY, wallNowMs: 6000 });
  check(storage.map.has(SAVE_KEY), `the write reaches the injected storage (${SAVE_KEY})`);

  // A SECOND PAGE, not a second read of the same object: `open` is what a reload calls, and it must rebuild
  // everything the shell reads from the text alone.
  const second = open(storage).state;
  check(second.position === 5, `the issued drill position survives (${second.position})`);
  check(second.levelIndex === 2, `and the level it was issued at (${second.levelIndex})`);
  check(second.hints.hints === 1 && second.hints.successes === 0, `and the cached balance the server stated (${second.hints.hints} held, ${second.hints.successes} counted)`);
  check(second.drillRun?.index === 3, `and the drill in flight (step ${second.drillRun?.index})`);
  check(second.daily?.runId === 'daily-1', `and the Daily in flight (${second.daily?.runId})`);
  check(second.resumed, 'and it reports itself as a resumed game');
  // THE FINISHED SET SURVIVES TOO, and it is measured by its EFFECT rather than by reading it: re-solving a
  // position the first page counted must not count again on the second.
  check(!second.markFinished(0).firstTime, 'and a drill solved before the reload is still counted as solved');

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
  check(state.markFinished(0).firstTime, 'and a drill can still be solved');
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
