// A COMPLETED DRILL CAN BE WATCHED BACK — and the read writes nothing, pinned.
//
// WHY THIS IS A GATE. REPORTED: "Allow completed levels to be replayed, not re-solved." The block's cells route to
// `POST /drill/replay`, which REOPENS a position (a write: the reattempt becomes the drill in flight) and refuses a
// PASSED one with `already_passed` — "nothing for a reattempt to earn". That refusal is right for an attempt and wrong
// for a rewatch, so a completed cell could not be opened at all. `GET /drill/replay` answers the other question: it
// reads a FINISHED position and its published boards, so the app can play the calls back.
//
// THE PROPERTY THAT MATTERS MOST IS THE ONE A READ CAN BREAK: a rewatch must leave the progress row — and therefore the
// order, the clock and anything a later submission is scored against — EXACTLY as it found it. That is measured on the
// row's revision and bytes, not asserted.
//
// Usage: node api/test/drill-watch-probe.mjs
import { drillReplay, drillReplayRead } from '../src/handlers/drill.ts';
import { STATUS } from '../src/status.ts';
import { seedLocalRegimes } from '../src/local-regime.ts';
import { progressKey } from '../src/keys.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { readDrill } from '../src/stored-drill.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { FIXTURE_POOL_VERSION } from 'dancing-squared-game/schedule-fixture';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = 1;
const CLOCK = 1_700_000_000_000;
// THE PROGRESS ROW IS THE TEST'S INPUT, written the way `drill-probe.mjs` writes one: the ORDER is the server's, and a
// row saying "finished and passed" is exactly what a player who solved position 1 has.
const depsFor = (store) => ({ store, clock: { nowMs: () => CLOCK }, identityOf: devIdentityOf });
const devId = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;
const progressRow = (name) => progressKey(devId(name), LEVEL);
const read = (player, index) => ({ method: 'GET', path: '/drill/replay', query: index === undefined ? {} : { index: String(index) }, body: null, headers: player ? { 'x-dev-player': player } : {} });

async function store() {
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  return store;
}

console.log('== 1. a PASSED position reads, with the boards it was asked with ==');
{
  const inner = await store();
  await inner.put(progressRow('w1'), { levelIndex: LEVEL, issued: null, finished: [0, 1], passed: [0] }, null);
  const deps = depsFor(inner);
  const answer = await drillReplayRead(read('w1', 0), deps);
  check(answer.status === STATUS.ok, `the passed position is answered (${answer.status} ${answer.body.error?.code ?? ''})`);
  const replay = answer.body.replay;
  check(replay?.index === 0 && replay?.levelIndex === LEVEL, `and it names the position and the level (${replay?.index}, ${replay?.levelIndex})`);
  check(replay?.passed === true, 'saying it was PASSED, so the panel can tell a solve from a skip');
  const published = await readDrill(inner, LEVEL, 0, FIXTURE_POOL_VERSION);
  check(published.ok && JSON.stringify(replay.puzzle) === JSON.stringify(published.puzzle),
    `and the boards are the PUBLISHED ones, byte for byte (${replay.puzzle?.path?.length} board(s) in the route)`);
}

console.log('\n== 2. THE READ WRITES NOTHING ==');
{
  const inner = await store();
  await inner.put(progressRow('w2'), { levelIndex: LEVEL, issued: null, finished: [0], passed: [0] }, null);
  const deps = depsFor(inner);
  const before = await inner.get(progressRow('w2'));
  const answer = await drillReplayRead(read('w2', 0), deps);
  const after = await inner.get(progressRow('w2'));
  check(answer.status === STATUS.ok, 'the replay reads');
  check(after.rev === before.rev, `and the progress row is the same revision (${before.rev} -> ${after.rev})`);
  check(JSON.stringify(after.value) === JSON.stringify(before.value), 'with the same bytes, so nothing was recorded');
  check(after.value.issued === null, 'and nothing is in flight, so the read did not make the position the issued drill');
}

console.log('\n== 3. a finished-but-SKIPPED position reads too, and says which it was ==');
{
  const inner = await store();
  await inner.put(progressRow('w3'), { levelIndex: LEVEL, issued: null, finished: [0, 1], passed: [0] }, null);
  const answer = await drillReplayRead(read('w3', 1), depsFor(inner));
  check(answer.status === STATUS.ok && answer.body.replay.passed === false, `a finished position that was not passed is watchable, reported as not passed (${answer.status}, passed=${answer.body.replay?.passed})`);
}

console.log('\n== 4. what is NOT watchable ==');
{
  const inner = await store();
  await inner.put(progressRow('w4'), { levelIndex: LEVEL, issued: null, finished: [0], passed: [0] }, null);
  const deps = depsFor(inner);
  const ahead = await drillReplayRead(read('w4', 1), deps);
  check(ahead.status === STATUS.conflict && ahead.body.error.code === 'not_finished', `a position ahead of the order is refused (${ahead.status} ${ahead.body.error?.code})`);
  const beyond = await drillReplayRead(read('w4', 9999), deps);
  check(beyond.status === STATUS.conflict && beyond.body.error.code === 'no_entry', `and so is one the regime does not have (${beyond.status} ${beyond.body.error?.code})`);
  const malformed = await drillReplayRead(read('w4', undefined), deps);
  check(malformed.status === STATUS.badRequest && malformed.body.error.code === 'bad_index', `a request with no index is a client error (${malformed.status} ${malformed.body.error?.code})`);
  const fractional = await drillReplayRead(read('w4', 0.5), deps);
  check(fractional.status === STATUS.badRequest, `and so is a fractional one (${fractional.status})`);
  const anonymous = await drillReplayRead(read(null, 0), deps);
  check(anonymous.status === STATUS.unauthenticated, `a caller with no identity is refused (${anonymous.status})`);
}

console.log('\n== 5. the REATTEMPT still refuses a passed position — the two endpoints ask different questions ==');
{
  const inner = await store();
  await inner.put(progressRow('w5'), { levelIndex: LEVEL, issued: null, finished: [0], passed: [0] }, null);
  const deps = depsFor(inner);
  const watch = await drillReplayRead(read('w5', 0), deps);
  const retry = await drillReplay({ method: 'POST', path: '/drill/replay', query: {}, body: { index: 0 }, headers: { 'x-dev-player': 'w5' } }, deps);
  check(watch.status === STATUS.ok, `the watch answers (${watch.status})`);
  // NEGATIVE CONTROL: if the watch had simply been routed to the reattempt, THIS would be the answer — and the app
  // would show "there is nothing for a reattempt to earn" where it asked to watch a completed drill.
  check(retry.status === STATUS.conflict && retry.body.error.code === 'already_passed', `while the reattempt is still refused for it (${retry.status} ${retry.body.error?.code})`);
  const after = await inner.get(progressRow('w5'));
  check(after.value.issued === null, 'and the reattempt being refused wrote nothing either');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
