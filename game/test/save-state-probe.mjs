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
import { HINT_SUCCESS_STEP, SAVE_KEY } from '../src/puzzle/config.ts';

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
  // NOTHING IS CREDITED HERE AND THERE IS NOTHING TO CREDIT: the balance is the server's and this module holds no
  // copy of it (REPORTED: "The hint bank should be stored on the server, not locally"), so a solve cannot move it.
  check(state.hints === undefined, `and the state exposes no balance of its own (${typeof state.hints})`);

  // NEGATIVE CONTROL, MEASURED: the append that has no membership test — `[...finished, position]` — records fourteen
  // positions for fourteen solves. It reddens ONLY the ten-distinct check above; the "is new" pair passes under it for
  // the FIRST solve, which is why the set is measured with replays in it.
  const appended = [...state.finishedPositions, 0];
  check(appended.length === state.finishedPositions.length + 1, `NEGATIVE CONTROL: an append with no guard grows the set (${appended.length} where the state holds ${state.finishedPositions.length})`);
}

// THERE IS NO == 1b, 1c, 2, 4 OR 4b any more. They measured the device's GRANT — a revealed drill earning nothing, the
// tenth distinct position minting a hint, a spend against a local balance and the server's stated balance adopted into
// the record — and the device holds no balance at all now: the server counts the finished drills from its own Progress
// rows and debits from its own row (`hintsKey`), and the app shows the number `GET /me/profile` sends. The rules still
// hold, and are measured where they now live: `game/test/hint-ledger-probe.mjs` pins the ten-distinct rule in
// `hints.ts`, `api/test/reveal-probe.mjs` MEASURED that a revealed drill grants nothing, and `api/test/hint-event-probe.mjs`
// drives the spend. What remains here is the set the grid draws, which is the shell's memory.

console.log('\n== 1d. FINISHED and PASSED are different sets, which is what the level grid draws ==');
{
  // THE SHELL'S HALF OF THE SERVER'S RULE: a revealed solve finishes a position without passing it. The grid shows "done"
  // against "done and passed", so a record that called a revealed solve a pass would tell a player they had learned a
  // drill they were shown the answer to. (A SKIP USED TO BE THE OTHER PRODUCER HERE; the control is withdrawn, so there is
  // no local writer for it any more — `save-state.ts` records why the set stays.)
  const state = open(memory()).state;
  state.markFinished(0);
  state.markFinished(1, { revealed: true });
  state.markFinished(2, { revealed: true });
  check(state.finishedPositions.join(',') === '0,1,2', `three positions are finished (${state.finishedPositions.join(',')})`);
  check(state.passedPositions.join(',') === '0', `and only the unaided solve is passed (${state.passedPositions.join(',')})`);
  // THE GETTERS ARE COPIES: a caller renders them, and must not be able to reorder the set by sorting what it was
  // handed — sorting the returned array is the first thing a grid does.
  const copy = [...state.finishedPositions].sort((a, b) => b - a);
  check(copy.join(',') === '2,1,0' && state.finishedPositions.join(',') === '0,1,2',
    'the returned lists are copies, so a caller cannot mutate the set');
  // THE SETS ARE NOT IN THE FILE, and a record that names them is not read: they mirrored the server's Progress row in
  // text the player can edit, which is the "a lot of data on the client that can be used to cheat" the report named. A
  // reload therefore starts the grid empty, and the server's `regime` is what fills it for a signed-in player.
  const storage = memory();
  storage.map.set(SAVE_KEY, JSON.stringify({ ...emptySave(POOL, 1, 0), finished: [0, 1], passed: [0] }));
  const legacy = open(storage).state;
  check(legacy.finishedPositions.length === 0 && legacy.passedPositions.length === 0,
    `a stored record naming finished and passed positions is not read (${legacy.finishedPositions.length} finished, ${legacy.passedPositions.length} passed)`);
}

// THERE IS NO == 2. It pinned the grant landing on the tenth DISTINCT drill, and that grant is the server's now (see the
// note above §1d). There is no == 3 either: it measured the device's run ledger, which is gone with the local score.

console.log('\n== 5. what is written is what a fresh page reads ==');
{
  const storage = memory();
  const first = open(storage).state;
  for (let i = 0; i < HINT_SUCCESS_STEP; i++) first.markFinished(i);
  first.persist({ levelIndex: 2, position: 5, drill: { runId: 'd', startedAtMs: 1, attempts: 2, index: 3, options: ['Boys Run'] }, daily: DAILY, wallNowMs: 6000 });
  check(storage.map.has(SAVE_KEY), `the write reaches the injected storage (${SAVE_KEY})`);

  // A SECOND PAGE, not a second read of the same object: `open` is what a reload calls, and it must rebuild
  // everything the shell reads from the text alone.
  const second = open(storage).state;
  check(second.position === 5, `the issued drill position survives (${second.position})`);
  check(second.levelIndex === 2, `and the level it was issued at (${second.levelIndex})`);
  check(second.drillRun?.index === 3, `and the drill in flight (step ${second.drillRun?.index})`);
  check(second.daily?.runId === 'daily-1', `and the Daily in flight (${second.daily?.runId})`);
  check(second.resumed, 'and it reports itself as a resumed game');
  // THE GRID'S SETS DO NOT SURVIVE, and that is the temporary-data rule rather than an omission: they are the shell's
  // memory, a signed-in player's grid comes back from the server's `regime`, and a practice grid is worth nothing after
  // the page. NEGATIVE CONTROL: persisting them — the shape this probe used to pin — reddens this check alone.
  check(second.finishedPositions.length === 0 && second.passedPositions.length === 0,
    `while the grid's finished and passed sets are MEMORY ONLY (${second.finishedPositions.length} finished, ${second.passedPositions.length} passed)`);

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
  check(state.spendHint === undefined && state.saving === false, 'and the state has no spend of its own to report');
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
