// The Daily's boundary job and its read, PINNED.
//
// WHY THIS IS A GATE. `GET /puzzle` is the one endpoint whose answer must be IDENTICAL for every player at a
// level, and the thing that makes it identical is that the client and the server derive the same challenge from
// the same inputs (DESIGN.md 9). So the central check here is not "the row reads back" — it is that the row's
// seed is EXACTLY what the client's own `dailyEntry` computes for that level and day, imported rather than
// restated. Beside it: the boundary job validates before it publishes, refusing a day nobody published rather
// than inventing one, and the ladder of levels the corpus can actually fill.
//
// Usage: node api/test/daily-puzzle-probe.mjs
import { publishDay, challengeFor } from '../src/daily-publishing.ts';
import { getPuzzle } from '../src/handlers/puzzle.ts';
import { STATUS } from '../src/status.ts';
import { publishedDailyKey } from '../src/keys.ts';
import { levelAt, publishableLevels } from '../src/levels.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { configFromEnv, devServerRefusal, realServiceWarning, ALLOW_REAL_AWS } from '../src/config.ts';
import { MAIN_POOL, dailyEntry, isUtcDay, poolIsComplete, utcDay } from 'dancing-squared-game';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!failures && !cond) failures = 1;
  else if (!cond) failures++;
};

const DAY = '2026-10-15';
const CLOCK = 1_700_000_000_000;
const LEVELS = [1, 2, 3];

// THE IDENTITY ADAPTER IS IMPORTED, NOT RE-SPELLED: what "a header names a player" means is `devIdentityOf`'s
// business, and a probe that restated it would keep passing after the adapter changed.
const depsFor = (store) => ({ store, clock: { nowMs: () => CLOCK }, identityOf: devIdentityOf });
const ask = (player, query) => ({ method: 'GET', path: '/puzzle', query, body: null, headers: player ? { 'x-dev-player': player } : {} });

console.log('== 1. what is published is EXACTLY what the client derives ==');
{
  const store = new MemoryStore();
  const report = await publishDay(store, DAY, { levels: LEVELS, nowMs: CLOCK });
  check(report.published.length === LEVELS.length && report.refused.length === 0, `the job publishes every level it was asked for (${report.published.length} published, ${report.refused.length} refused)`);

  for (const levelIndex of LEVELS) {
    const answer = await getPuzzle(ask('p1', { mode: 'daily', level: String(levelIndex), date: DAY }), depsFor(store));
    check(answer.status === STATUS.ok, `level ${levelIndex} reads back (${answer.status})`);
    // THE CLIENT'S OWN DERIVATION, IMPORTED: the same pure function the app calls to build its Daily.
    const derived = dailyEntry(levelAt(levelIndex), MAIN_POOL.version, DAY);
    check(answer.body.daily.seed === derived.seed, `and its seed is the one the client's own dailyEntry computes (${answer.body.daily.seed})`);
    check(answer.body.daily.levelIndex === levelIndex && answer.body.daily.poolVersion === MAIN_POOL.version, `with the level and pool version beside it (${answer.body.daily.levelIndex}, ${answer.body.daily.poolVersion})`);
    check(answer.body.daily.publishedAtMs === CLOCK, `and the publish stamp (${answer.body.daily.publishedAtMs})`);
    check(answer.body.daily.playable === true, 'and it is playable by this build');
    // NEGATIVE CONTROL FOR THE WHOLE ENDPOINT, MEASURED: the seed is LEVEL-BOUND and DAY-BOUND, so a server that
    // returned one number for everything would satisfy the checks above for exactly one level.
    const otherLevel = dailyEntry(levelAt(levelIndex + 1), MAIN_POOL.version, DAY).seed;
    const otherDay = dailyEntry(levelAt(levelIndex), MAIN_POOL.version, '2026-10-16').seed;
    check(otherLevel !== answer.body.daily.seed && otherDay !== answer.body.daily.seed, `NEGATIVE CONTROL: a different level (${otherLevel}) and a different day (${otherDay}) both give a different seed`);
  }
}

console.log('\n== 2. the read is a READ: no row, no answer ==');
{
  const store = new MemoryStore();
  await publishDay(store, DAY, { levels: [1], nowMs: CLOCK });
  const deps = depsFor(store);
  const unpublishedLevel = await getPuzzle(ask('p2', { mode: 'daily', level: '2', date: DAY }), deps);
  check(unpublishedLevel.status === STATUS.notFound && unpublishedLevel.body.error.code === 'no_published_daily', `a level nobody published is a 404 (${unpublishedLevel.status} ${unpublishedLevel.body.error?.code})`);
  const day = '2026-10-16';
  const unpublishedDay = await getPuzzle(ask('p2', { mode: 'daily', level: '1', date: day }), deps);
  check(unpublishedDay.status === STATUS.notFound, `and so is a day nobody published (${unpublishedDay.status})`);
  check((await store.get(publishedDailyKey(1, day))) === null, 'and the read did not CREATE a row — the server never invents a challenge (DESIGN.md 9)');

  // A PUBLISHED CHALLENGE FROM ANOTHER POOL IS REPORTED AS UNPLAYABLE rather than served as if it were fine: a
  // seed is only meaningful against the pool it was validated at (§7.2), and the client must not generate a
  // board the server would then refuse to score.
  await store.put(publishedDailyKey(2, DAY), { seed: 7, levelIndex: 2, poolVersion: 'ms-0', publishedAtMs: CLOCK }, null);
  const stale = await getPuzzle(ask('p2', { mode: 'daily', level: '2', date: DAY }), deps);
  check(stale.status === STATUS.ok && stale.body.daily.playable === false, `a challenge from another pool reads back as NOT playable (${stale.body.daily?.playable} for pool ${stale.body.daily?.poolVersion})`);
  const fresh = await getPuzzle(ask('p2', { mode: 'daily', level: '1', date: DAY }), deps);
  check(fresh.body.daily.playable === true, 'NEGATIVE CONTROL: while one from this pool is playable, so the flag is a comparison and not a constant');
}

console.log('\n== 3. what the query must carry ==');
{
  const store = new MemoryStore();
  await publishDay(store, DAY, { levels: [1], nowMs: CLOCK });
  const deps = depsFor(store);
  const cases = [
    [{ mode: 'daily', date: DAY }, 'no level'],
    [{ mode: 'daily', level: '0', date: DAY }, 'level 0'],
    [{ mode: 'daily', level: 'abc', date: DAY }, 'a level that is not a number'],
    [{ mode: 'daily', level: '1.5', date: DAY }, 'a fractional level'],
    [{ mode: 'daily', level: '1' }, 'no date'],
    [{ mode: 'daily', level: '1', date: '2026-02-30' }, 'a day that does not exist'],
    [{ mode: 'daily', level: '1', date: '15/10/2026' }, 'a day in another shape'],
  ];
  for (const [query, why] of cases) {
    const answer = await getPuzzle(ask('p3', query), deps);
    check(answer.status === STATUS.badRequest, `${why} is a 400 (${answer.status} ${answer.body.error?.code})`);
  }
  // MODE IS REQUIRED TO BE THE ONE THIS ENDPOINT SERVES, and the default is daily: a client that omits it is
  // asking for the published challenge, which is the only thing `/puzzle` has.
  const noMode = await getPuzzle(ask('p3', { level: '1', date: DAY }), deps);
  check(noMode.status === STATUS.ok, `an omitted mode defaults to daily (${noMode.status})`);
  const wrongMode = await getPuzzle(ask('p3', { mode: 'drill', level: '1', date: DAY }), deps);
  check(wrongMode.status === STATUS.badRequest && wrongMode.body.error.code === 'bad_mode', `and a Drill is refused, because the Drill's order is served by /drill/current (${wrongMode.body.error?.code})`);
  // NO IDENTITY IS NEEDED AND NONE IS READ: the answer is the published artefact, identical for every caller, so
  // a signed-out browser gets it rather than a 401 for a request that never mentioned the player (§11.2's demo).
  const anonymous = await getPuzzle(ask(null, { mode: 'daily', level: '1', date: DAY }), deps);
  check(anonymous.status === STATUS.ok, `no identity is served the same challenge (${anonymous.status})`);
  check(JSON.stringify(anonymous.body) === JSON.stringify((await getPuzzle(ask('p3', { mode: 'daily', level: '1', date: DAY }), deps)).body), 'BYTE FOR BYTE, so there is no player-specific part for an identity to decide');
}

console.log('\n== 4. publishing the same day twice changes nothing that matters ==');
{
  const store = new MemoryStore();
  const first = await publishDay(store, DAY, { levels: [1], nowMs: CLOCK });
  const row = (await store.get(publishedDailyKey(1, DAY))).value;
  const second = await publishDay(store, DAY, { levels: [1], nowMs: CLOCK + 60_000 });
  const again = (await store.get(publishedDailyKey(1, DAY))).value;
  check(first.published[0].seed === second.published[0].seed && row.seed === again.seed, `a re-publish produces the same seed (${row.seed})`);
  check(again.publishedAtMs === CLOCK + 60_000, 'and stamps the new write, so an operator can see it ran');
  const malformed = await publishDay(store, '2026-02-30', { levels: [1], nowMs: CLOCK }).then(() => 'published', (error) => error.message);
  check(typeof malformed === 'string' && malformed.includes('not a UTC day'), `and a day that does not exist is refused rather than hashed (${malformed})`);
}

console.log('\n== 5. the levels the corpus can fill ==');
{
  const levels = publishableLevels();
  const last = levels[levels.length - 1];
  const beyond = levelAt(last + 1);
  check(levels.every((level) => poolIsComplete(levelAt(level), MAIN_POOL)), `every published level's pool is complete (${levels.length} levels, 1..${last})`);
  check(!poolIsComplete(beyond, MAIN_POOL), `and the next one is not: level ${last + 1} asks for ${beyond.poolSize} titles and the corpus carries ${MAIN_POOL.order.length}`);
  // NEGATIVE CONTROL: the ladder itself is TOTAL, so a publisher that trusted `levelSpec` alone would publish
  // forever. MEASURED: level 900 is a level (a pool of 1505 and depth 2) with nothing behind it.
  check(levelAt(900).poolSize === 1505, `NEGATIVE CONTROL: level 900 is still a level of the ladder (pool ${levelAt(900).poolSize}), which is why the boundary is the POOL and not the ladder`);
  check(publishableLevels().length === levels.length, 'and the list is stable across calls');
}

console.log('\n== 6. the setup tools refuse to touch a service nobody named ==');
{
  // THE GUARD IS MEASURED HERE because the tool that publishes is the one that would otherwise write into
  // whatever account the ambient credentials belong to (AGENTS.md §8 trap 21 cost a real table).
  const local = configFromEnv({ DSQ_STORE: 'dynamodb', DSQ_DDB_ENDPOINT: 'http://127.0.0.1:8000' });
  check(realServiceWarning(local) === null, 'a configured endpoint needs no opt-in');
  const real = configFromEnv({ DSQ_STORE: 'dynamodb' });
  const warning = realServiceWarning(real);
  check(typeof warning === 'string' && warning.includes('DSQ_DDB_ENDPOINT'), `no endpoint refuses and names the way forward (${warning})`);
  check(realServiceWarning(real, { [ALLOW_REAL_AWS]: '1' }) === null, `and ${ALLOW_REAL_AWS}=1 is the deliberate override`);
  // THE DEV SERVER ASKS A NARROWER QUESTION THAN THE TOOLS DO, and this pair is the measurement: a memory store
  // never leaves the process, so an endpoint is irrelevant to it — MEASURED, applying the warning unconditionally
  // made `npm run dev:api` refuse to start, which a browser found.
  check(devServerRefusal(local) === null && devServerRefusal(configFromEnv({ DSQ_STORE: 'memory' })) === null, 'the dev server starts with the MEMORY store and no endpoint, which is its normal local configuration');
  check(typeof devServerRefusal(real) === 'string', 'NEGATIVE CONTROL: while a DynamoDB run with no endpoint is still refused');
  check(challengeFor(1, DAY).seed === dailyEntry(levelAt(1), MAIN_POOL.version, DAY).seed, 'and the job\'s own challenge is the client\'s derivation, through one function');
  check(isUtcDay(utcDay(new Date(CLOCK))) && utcDay(new Date(CLOCK)) === '2023-11-14', `while the day comes from the clock in UTC (${utcDay(new Date(CLOCK))})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
