// THE DEV SERVER ROLLS OVER AT MIDNIGHT, pinned.
//
// WHY THIS IS A GATE, and it is a REPORTED defect rather than a hypothesis: "There is no Todays Daily published. Why
// hasn't the daily create been triggered?" The dev server published the day AT BOOT and never again, so a process left
// running across the UTC boundary kept serving nothing for the new day — every read answering `no_published_daily`,
// which is the correct answer to "a day nobody published" and therefore looked like the read's fault. The in-memory
// store is PER PROCESS, so the boundary job in another process (`npm run api:publish-daily`) can never reach it: the
// boot publish is the stand-in for that job here, and a stand-in that only acts once is not a stand-in.
//
// WHAT IS MEASURED. The rollover is driven through the handle the interval calls (`publishDueDay`, exposed for exactly
// this reason — a probe cannot wait for a real midnight), with the clock INJECTED and the levels NARROWED to one. Each
// check is the property the tick depends on: the day publishes once and only when due, the read refuses it until it
// is published, and the rows are the SAME artefact the boot publish writes (a stamp from the injected clock, and a
// built puzzle the read recovers rather than builds).
//
// NOT MEASURED, SAID OUT LOUD: the 60-second TIMER ITSELF is never waited on. What the timer can do wrong is publish
// twice, publish a day that is not due, or keep the process alive — the first two are the checks here, and the third
// is pinned by the whole suite: `close()` clears the interval and the interval is unref'd, so a probe that forgot to
// close would still exit, and one that left the loop alive would hang `api/tools/verify-probes.mjs` rather than fail a
// check. The scheduled job on a real deployment is `api:publish-schedule`, not this.
//
// Usage: node api/test/daily-rollover-probe.mjs
import { startDevServer } from '../src/dev-server.ts';
import { publishedDailyKey } from '../src/keys.ts';
import { levelAt, puzzleFor } from '../src/levels.ts';
import { dailyEntry, MAIN_POOL, utcDay } from 'dancing-squared-game';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const DAY_A_MS = Date.UTC(2026, 9, 23, 12, 0, 0);
const DAY_A = '2026-10-23';
const DAY_B_MS = DAY_A_MS + 86_400_000;
const DAY_B = '2026-10-24';
const DAY_C = '2026-10-25';

/** The clock the server reads. It is mutable so the probe can cross midnight without moving the wall clock. */
let now = DAY_A_MS;
const announced = [];

const server = await startDevServer({
  port: 0,
  seed: false,
  auth: 'dev',
  nowMs: () => now,
  dailyLevels: [1],
  announce: (message) => announced.push(message),
});
const base = `http://127.0.0.1:${server.port}`;
const read = async (day) => {
  const response = await fetch(`${base}/puzzle?mode=daily&level=1&date=${day}`);
  return { status: response.status, body: await response.json() };
};
const row = (day) => server.store.get(publishedDailyKey(1, day)).then((item) => item?.value ?? null);

try {
  console.log('== 1. the read refuses a day nobody published, and does not build it ==');
  // `seed: false` IS THE FIXTURE: no boot publish at all, so this is the state a server is in on the day after its
  // boot. If the read generated on demand, this check and the whole probe would be meaningless — which is why the
  // first check is the refusal rather than the publish.
  const beforeA = await read(DAY_A);
  check(beforeA.status === 404 && beforeA.body.error?.code === 'no_published_daily', `an unpublished day is a 404 no_published_daily (${beforeA.status} ${beforeA.body.error?.code})`);
  check((await row(DAY_A)) === null, 'and the read created no row: the server never invents a challenge (DESIGN.md 9)');
  check(announced.length === 0, `and a server asked not to seed announced nothing at boot (${announced.length} line(s))`);

  console.log('\n== 2. the rollover publishes the day the clock reports ==');
  const reportA = await server.publishDueDay();
  check(reportA !== null && reportA.day === DAY_A, `publishDueDay publishes the due day (${reportA?.day})`);
  check(reportA.published.some((entry) => entry.levelIndex === 1) && reportA.refused.length === 0, `for the level it was told to serve, with nothing refused (${reportA.published.length} published, ${reportA.refused.length} refused)`);
  // THE KEY IS THE PUBLISHER'S OWN, imported from `keys.ts` rather than spelled here: a probe with its own copy of the
  // row's identity would keep passing after the publisher moved, which is the "import the rule" law (§5).
  check((await server.store.get(publishedDailyKey(1, DAY_A))) !== null, 'the row is in the store, under the key the publisher derives');
  // THE STAMP COMES FROM THE INJECTED CLOCK, which is what makes the injection visible rather than decorative: a
  // rollover that stamped `Date.now()` would write today's real date on a day the probe says is 2026.
  const rowA = await row(DAY_A);
  check(rowA.publishedAtMs === DAY_A_MS, `stamped from the injected clock (${rowA.publishedAtMs} against ${DAY_A_MS})`);
  check(rowA.puzzle !== undefined && rowA.puzzle !== null, 'and it carries the BUILT puzzle, so the read has something to recover');

  console.log('\n== 3. the same day reads back, and it is the client\'s own derivation ==');
  const afterA = await read(DAY_A);
  check(afterA.status === 200, `the published day reads (${afterA.status})`);
  // IMPORTED, NOT RESTATED: `dailyEntry` is the function the client calls to derive its Daily, so this is the
  // "one derivation" check rather than "the row reads back".
  const derivedA = dailyEntry(levelAt(1), MAIN_POOL.version, DAY_A);
  check(afterA.body.daily?.seed === derivedA.seed, `and its seed is what the client's dailyEntry computes (${afterA.body.daily?.seed})`);
  const generatedA = puzzleFor(derivedA.seed, levelAt(1), 'daily');
  check(generatedA.ok && JSON.stringify(afterA.body.daily.puzzle) === JSON.stringify(generatedA.puzzle), `and it carries that seed's puzzle, exactly (${afterA.body.daily.puzzle?.steps?.length} step(s))`);

  console.log('\n== 4. one publish per day, not one per tick ==');
  const again = await server.publishDueDay();
  check(again === null, `a second call on the same day does nothing (${JSON.stringify(again)})`);
  const rowAgain = await row(DAY_A);
  check(rowAgain.publishedAtMs === DAY_A_MS && JSON.stringify(rowAgain) === JSON.stringify(rowA), 'and it did not rewrite the row, so the guard is a comparison and not a cheap re-publish');
  check(announced.filter((line) => line.includes(DAY_A)).length === 1, `and announced the publish once (${announced.filter((line) => line.includes(DAY_A)).length} line(s))`);
  // THE ROW IS A REPLACE, NOT AN APPEND, and the key is derived — so the probe can also ask the store directly.

  console.log('\n== 5. crossing midnight publishes the NEXT day and leaves the old one alone ==');
  now = DAY_B_MS;
  const reportB = await server.publishDueDay();
  check(reportB !== null && reportB.day === DAY_B, `the rollover publishes the new day (${reportB?.day})`);
  const rowB = await row(DAY_B);
  check(rowB !== null && rowB.publishedAtMs === DAY_B_MS, `stamped from the moved clock (${rowB?.publishedAtMs})`);
  check(utcDay(new Date(DAY_B_MS)) === DAY_B && reportA.published[0].seed !== reportB.published[0].seed, `and it is a different challenge, because the seed is day-bound (${reportA.published[0].seed} then ${reportB.published[0].seed})`);
  check((await row(DAY_A)).publishedAtMs === DAY_A_MS, 'YESTERDAY IS UNTOUCHED: a rollover adds a day, it does not rewrite the last one');
  const bothA = await read(DAY_A);
  const bothB = await read(DAY_B);
  check(bothA.status === 200 && bothB.status === 200, `and both days read (${bothA.status}, ${bothB.status})`);

  console.log('\n== 6. what is published is the DUE day, not any day ==');
  // THE NEGATIVE CONTROL for the whole probe: a rollover that published "the newest challenge" rather than "the due
  // day" would pass section 5. Asking for a day the clock has not reached must still be refused.
  const future = await read(DAY_C);
  check(future.status === 404 && future.body.error?.code === 'no_published_daily', `a day the clock has not reached is still refused (${future.status} ${future.body.error?.code})`);
  check((await row(DAY_C)) === null, 'and the rollover did not publish it');
} finally {
  await server.close();
}
// THE INTERVAL IS GONE AFTER CLOSE, and the check is the suite itself rather than a line here: `close()` clears it and
// it was unref'd, so this probe returns and the runner exits. A timer left behind would hang the gate, not redden it.
check(typeof server.publishDueDay === 'function', 'the handle the interval calls is exposed, which is what let this probe drive it without a midnight');

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
