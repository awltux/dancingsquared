// THE IMPORTED LEDGER IS HISTORY AND NOTHING ELSE, pinned (DESIGN.md 11.1, A26).
//
// WHY THIS IS A GATE. `POST /me/runs:bulk` is the one endpoint that takes a client's word for a run — it has to, or
// a device's offline play would be lost — and the rule that keeps it honest is what it does NOT write: no board
// entry, no hint credit, no finished drill. A flag somebody has to remember to check is a flag somebody will forget,
// so the checks here are the ABSENCE of those rows, measured before and after.
//
// Usage: node api/test/history-probe.mjs
import { postBulkRuns } from '../src/handlers/bulk.ts';
import { postRun } from '../src/handlers/runs.ts';
import { STATUS } from '../src/status.ts';
import { boardKey, hintsKey, historyKey, progressKey } from '../src/keys.ts';
import { levelAt, puzzleFor } from '../src/levels.ts';
import { seedLocalRegimes } from '../src/local-regime.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { asHistoryRun, MAX_IMPORTED_RUNS } from '../src/history.ts';
import { LOCAL_SCHEDULE } from 'dancing-squared-game/schedule-fixture';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = 1;
const CLOCK = 1_700_000_000_000;
const SEASON = '2026-10';
const devId = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;
const ROW = {
  history: (name, runId) => historyKey(devId(name), runId),
  board: (name) => boardKey('drill', LEVEL, SEASON, devId(name)),
  hints: (name) => hintsKey(devId(name)),
  progress: (name) => progressKey(devId(name), LEVEL),
};

const depsFor = (store) => ({ store, clock: { nowMs: () => CLOCK }, identityOf: devIdentityOf });
const bulk = (player, runs) => ({ method: 'POST', path: '/me/runs:bulk', query: {}, body: { runs }, headers: player ? { 'x-dev-player': player } : {} });

const led = (runId, over = {}) => ({ runId, mode: 'drill', levelIndex: LEVEL, score: 40, elapsedSeconds: 20, hintsUsed: 0, calls: ['Boys Run'], ...over });

async function fresh() {
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  return { store, deps: depsFor(store) };
}

console.log('== 1. the ledger is kept, and it buys NOTHING ==');
{
  const { store, deps } = await fresh();
  const imported = await postBulkRuns(bulk('b1', [led('old-1'), led('old-2', { mode: 'daily', score: 77, date: '2026-10-14' })]), deps);
  check(imported.status === STATUS.ok && imported.body.imported === 2 && imported.body.skipped === 0, `two runs are imported (${imported.body.imported} imported, ${imported.body.skipped} skipped)`);
  check(imported.body.unverified === true, 'and the answer says they are unverified, so the client can label them');

  const first = await store.get(ROW.history('b1', 'old-1'));
  check(first !== null && asHistoryRun(first)?.score === 40, 'a row is kept per run, under the device id it carried');
  check(first.value.unverified === true && first.value.importedAtMs === CLOCK, 'marked unverified and stamped with the SERVER import time, which is the only time this row can honestly claim');
  check((await store.get(ROW.history('b1', 'old-2'))).value.mode === 'daily', 'and a daily is kept as one');

  // THE RULE, MEASURED AS ABSENCE: this is what makes the import history rather than a result. Each row is the
  // thing the same runs would have written through `POST /runs`, and none of them exists.
  check((await store.get(ROW.board('b1'))) === null, 'NEGATIVE CONTROL: no board entry was written, so an offline ledger cannot reach a leaderboard');
  check((await store.get(ROW.hints('b1'))) === null, 'no hint balance, so imported runs earn no hints');
  check((await store.get(ROW.progress('b1'))) === null, 'and no Progress row, so no drill was advanced by one');
  check((await store.get({ pk: `runs#${devId('b1')}`, sk: 'run#old-1' })) === null, 'nor a run row in the results partition, which is where every verified run lives');
}

console.log('\n== 2. importing twice is free, and the FIRST import wins ==');
{
  const { store, deps } = await fresh();
  const first = await postBulkRuns(bulk('b2', [led('old-1', { score: 40 })]), deps);
  check(first.body.imported === 1, `the first import takes the run (${first.body.imported})`);
  const again = await postBulkRuns(bulk('b2', [led('old-1', { score: 999 })]), deps);
  // THE SAME ID WITH A BETTER SCORE CHANGES NOTHING: a second import is a retry, not an edit, and the alternative
  // would be an endpoint that lets a client rewrite its own history upward.
  check(again.body.imported === 0 && again.body.skipped === 1, `NEGATIVE CONTROL: a second import of the same id is SKIPPED (${again.body.skipped} skipped)`);
  check((await store.get(ROW.history('b2', 'old-1'))).value.score === 40, `and the stored score is the FIRST one (${(await store.get(ROW.history('b2', 'old-1'))).value.score})`);

  // A LEDGER THAT MIXES OLD AND NEW IS THE ORDINARY CASE: one call, one skip, one import.
  const mixed = await postBulkRuns(bulk('b2', [led('old-1'), led('fresh-1')]), deps);
  check(mixed.body.imported === 1 && mixed.body.skipped === 1 && mixed.body.total === 2, `a mixed ledger reports both (${mixed.body.imported} imported, ${mixed.body.skipped} skipped of ${mixed.body.total})`);
}

console.log('\n== 3. the body is a client\'s, so it is checked before anything is written ==');
{
  const { store, deps } = await fresh();
  const cases = [
    [{ runs: [] }, 'bad_ledger', 'an empty ledger'],
    [{ runs: 'nope' }, 'bad_ledger', 'a runs field that is not an array'],
    [null, 'bad_ledger', 'no body at all'],
    [{ runs: [led(''), ] }, 'bad_run', 'a run with no id'],
    [{ runs: [led('x', { score: 'lots' })] }, 'bad_run', 'a score that is not a number'],
    [{ runs: [led('x', { mode: 'solo' })] }, 'bad_run', 'a mode this API does not have'],
    [{ runs: [led('x', { calls: 'Boys Run' })] }, 'bad_run', 'calls that are not a list'],
    [{ runs: Array.from({ length: MAX_IMPORTED_RUNS + 1 }, (_, index) => led(`r-${index}`)) }, 'ledger_too_long', `${MAX_IMPORTED_RUNS + 1} runs in one call`],
  ];
  for (const [body, code, why] of cases) {
    const answer = await postBulkRuns({ ...bulk('b3', []), body }, deps);
    check(answer.status === STATUS.badRequest && answer.body.error.code === code, `${why} is refused (${answer.body.error?.code})`);
  }
  // AND A REFUSAL WRITES NOTHING AT ALL: one bad entry must not import the good ones before it, or the device and
  // the server would disagree about what was kept.
  const mixedBad = await postBulkRuns(bulk('b3', [led('good-1'), led('bad-1', { score: -1 })]), deps);
  check(mixedBad.status === STATUS.badRequest, `a ledger with one bad entry is refused (${mixedBad.body.error?.code})`);
  check((await store.get(ROW.history('b3', 'good-1'))) === null, 'and the good entry before it was NOT written');

  const anonymous = await postBulkRuns({ ...bulk(null, [led('old-1')]), headers: {} }, deps);
  check(anonymous.status === STATUS.unauthenticated, `and an import with no identity is a 401 (${anonymous.status})`);
}

console.log('\n== 4. the two partitions do not mix ==');
{
  const { store, deps } = await fresh();
  // A VERIFIED RUN AND AN IMPORTED ONE WITH THE SAME ID, which is the collision a shared key would have caused: the
  // results partition is keyed by runId too, and one row kind for both would let an import shadow a result.
  const import1 = await postBulkRuns(bulk('b4', [led('same-id', { score: 11 })]), deps);
  check(import1.status === STATUS.ok, `an import under an id a verified run might also use (${import1.status})`);
  const generated = puzzleFor(LOCAL_SCHEDULE.find((entry) => entry.levelIndex === LEVEL).seed, levelAt(LEVEL), 'drill');
  const verified = await postRun({ method: 'POST', path: '/runs', query: {}, body: { runId: 'same-id', mode: 'drill', levelIndex: LEVEL, drillId: '1:0', elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls: generated.puzzle.solution }, headers: { 'x-dev-player': 'b4' } }, deps);
  check(verified.status >= 400, `while the verified path still checks its own rules for that id (${verified.status} ${verified.body.error?.code})`);
  check((await store.get(ROW.history('b4', 'same-id'))).value.score === 11, `and the history row is untouched by the attempt (${(await store.get(ROW.history('b4', 'same-id'))).value.score})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
