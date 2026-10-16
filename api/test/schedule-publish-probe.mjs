// The Drill's season, PINNED: what is authored, what is validated, and that the endpoint serves it.
//
// WHY THIS IS A GATE. A published season is what every player at a level works through in the same order
// (DESIGN.md 8, decision 10), so an entry that does not generate is a blank board for everyone at that level at
// once — which is why §7.2 says every seed passes the quality gates "or the build fails", and why the lint
// re-runs the generator rather than trusting the author. The rules measured here are the authoring ones: the
// scan's skip, the prefix property (a longer season cannot rewrite an issued drill), the design's own lint, and
// that `GET /drill/current` serves what this published.
//
// Usage: node api/test/schedule-publish-probe.mjs
import { generateSeason, levelIsPublishable, lintSeason, publishSeason, seasonVersion, SCAN_PATIENCE, SERVED_LEVELS } from '../src/schedule-publishing.ts';
import { levelAt, publishableLevels, puzzleFor } from '../src/levels.ts';
import { drillCurrent } from '../src/handlers/drill.ts';
import { STATUS } from '../src/status.ts';
import { scheduleKey } from '../src/keys.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { MAIN_POOL, POOL_VERSION } from 'dancing-squared-game';
import { FIXTURE_POOL_VERSION } from 'dancing-squared-game/schedule-fixture';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('== 1. a season is authored by scanning, and a seed that cannot generate is SKIPPED ==');
{
  // THE REAL SCAN, SHORT AND HONEST: three entries at level 1, every one accepted by generating it.
  const authored = generateSeason(1, { season: 3 });
  check(authored.entries.length === 3, `three entries are authored (${authored.entries.length} from ${authored.attempts} candidates)`);
  for (const entry of authored.entries) {
    const generated = puzzleFor(entry.seed, levelAt(1));
    check(generated.ok, `and seed ${entry.seed} generates (${generated.ok ? 'ok' : generated.reason})`);
  }
  check(authored.skipped.length === 0, `with nothing skipped: MEASURED, seeds 1..40 at level 1 all generate (${authored.skipped.length} skips)`);
  check(authored.entries.every((entry) => entry.levelIndex === 1 && entry.poolVersion === POOL_VERSION), `and every entry carries the level and the pool version (${authored.entries[0].poolVersion})`);

  // THE SKIP RULE NEEDS ITS OWN CONTROL, and it cannot be demonstrated with the real generator: no affordable
  // range at level 1 contains a refusal (measured above), so the predicate is injected. THIS IS THE CONTROL for
  // "the scan takes the first N identifiers" — the plausible wrong rule — and it is the only check that catches
  // it, because every other check here uses seeds that all generate.
  const refusesThree = (seed) => (seed === 3 ? { ok: false, reason: 'refused for the probe' } : { ok: true });
  const skipping = generateSeason(1, { season: 3, accepts: refusesThree });
  check(skipping.skipped.length === 1 && skipping.skipped[0].seed === 3, `NEGATIVE CONTROL: an unacceptable seed is skipped and REPORTED (${JSON.stringify(skipping.skipped)})`);
  check(skipping.entries.map((entry) => entry.seed).join(',') === '1,2,4', `NEGATIVE CONTROL: so the season is 1,2,4 rather than the first three integers (${skipping.entries.map((e) => e.seed).join(',')})`);

  // AND A LEVEL THAT CANNOT FILL A SEASON IS REPORTED RATHER THAN LOOPED ON: the scan is bounded at
  // `SCAN_PATIENCE` candidates per entry, and hitting the bound is a finding.
  const never = generateSeason(1, { season: 2, accepts: () => ({ ok: false, reason: 'nothing generates' }) });
  check(never.entries.length === 0 && never.attempts === 2 * SCAN_PATIENCE, `a level that can fill nothing gives up after ${never.attempts} candidates rather than spinning (${never.entries.length} authored)`);
}

console.log('\n== 2. the season is deterministic, and a longer one has the shorter as its PREFIX ==');
{
  const three = generateSeason(1, { season: 3 }).entries.map((entry) => entry.seed);
  const again = generateSeason(1, { season: 3 }).entries.map((entry) => entry.seed);
  check(three.join(',') === again.join(','), `the same request authors the same season (${three.join(',')})`);
  // THE PREFIX IS THE FAIRNESS PROPERTY: extending a season appends drills rather than re-rolling them, so a
  // player in the middle of a published season is not moved to a different seed by a later publish (§8: a
  // schedule edit cannot rewrite a drill already handed out).
  const five = generateSeason(1, { season: 5 }).entries.map((entry) => entry.seed);
  check(five.slice(0, 3).join(',') === three.join(','), `and a five-drill season STARTS with the three-drill one (${five.join(',')})`);
  check(five.length === 5 && new Set(five).size === 5, `with five distinct seeds (${five.length} seeds, ${new Set(five).size} distinct)`);
  check(seasonVersion(POOL_VERSION, 3) !== seasonVersion(POOL_VERSION, 5), `and the version names the length, so a republished season is distinguishable (${seasonVersion(POOL_VERSION, 3)} vs ${seasonVersion(POOL_VERSION, 5)})`);
}

console.log('\n== 3. the design\'s own lint accepts what is authored, with the generator re-run ==');
{
  const entries = generateSeason(1, { season: 3 }).entries;
  // STRUCTURAL ONLY: what the tool runs at publish time.
  check(lintSeason(entries, 1, false).length === 0, 'the structural lint is clean');
  // AND THE FULL ONE, which regenerates every entry (§7.2's actual gate). It is affordable on three entries,
  // which is why the probe pays for it and the tool does not pay for it twice per season.
  const findings = lintSeason(entries, 1, true);
  check(findings.length === 0, `and the full lint — every seed regenerated — is clean too (${findings.length} findings)`);
  // NEGATIVE CONTROL, MEASURED: the same lint REJECTS a season whose entry does not belong to the level it
  // claims, which is the finding §7.2 exists for and the one a hand-edited row would produce.
  const foreign = [{ seed: entries[0].seed, levelIndex: 1, poolVersion: FIXTURE_POOL_VERSION }, { seed: entries[1].seed, levelIndex: 1, poolVersion: 'ms-0' }];
  const bad = lintSeason(foreign, 1, false);
  check(bad.length === 1 && bad[0].includes('ms-0'), `NEGATIVE CONTROL: an entry from another pool is refused by the lint (${bad[0]})`);
  const duplicated = lintSeason([entries[0], entries[0]], 1, false);
  check(duplicated.length === 1 && duplicated[0].includes('already appears'), `NEGATIVE CONTROL: and a repeated seed is reported (${duplicated[0]})`);
  const empty = lintSeason([], 1, false);
  check(empty.length === 1 && empty[0].includes('empty'), `NEGATIVE CONTROL: and an empty season is reported (${empty[0]})`);
  // THE LINT CANNOT REFUSE A LEVEL THE CORPUS CANNOT FILL, and that is not a gap in it: the ladder is TOTAL
  // (`levelSpec(999)` is a level — section 5 measures it), so "is this level playable" is the POOL's question and
  // it is answered by `levelIsPublishable` before the lint is asked anything. Two gates, two questions.
  check(lintSeason([{ seed: 1, levelIndex: 999, poolVersion: POOL_VERSION }], 999, false).length === 0, 'and the lint says nothing about a level the corpus cannot fill, because that is the publisher\'s own guard');
}

console.log('\n== 4. what is published is what the endpoint SERVES ==');
{
  const store = new MemoryStore();
  const entries = generateSeason(1, { season: 3 }).entries;
  await publishSeason(store, 1, entries, seasonVersion(POOL_VERSION, 3));
  const row = (await store.get(scheduleKey(1))).value;
  check(row.entries.length === 3 && row.scheduleVersion === seasonVersion(POOL_VERSION, 3), `the row holds the season and its version (${row.scheduleVersion})`);
  check(JSON.stringify(row.entries) === JSON.stringify(entries), 'and the entries are stored verbatim — a seed, a level and a pool version, no puzzle');

  const deps = { store, clock: { nowMs: () => 1_700_000_000_000 }, identityOf: devIdentityOf };
  const served = await drillCurrent(
    { method: 'GET', path: '/drill/current', query: { level: '1' }, body: null, headers: { 'x-dev-player': 'p1' } },
    deps,
  );
  check(served.status === STATUS.ok, `and the endpoint serves from it (${served.status} ${served.body.error?.code ?? ''})`);
  check(served.body.drill.seed === entries[0].seed && served.body.drill.id === '1:0', `starting at the season's first seed (${served.body.drill.seed})`);
  check(served.body.regime.length === 3, `and reporting the season's length (${served.body.regime.length})`);
  // THE NEGATIVE CONTROL FOR THE END-TO-END PATH: the LOCAL FIXTURE's level 1 seed differs from the authored
  // season's first seed, so "it served the fixture" is a distinguishable answer rather than the same number.
  check(entries[0].seed !== 0 && (await store.get(scheduleKey(2))) === null, 'NEGATIVE CONTROL: only level 1 was published, so nothing else can be served from it');
}

console.log('\n== 5. which levels can be published ==');
{
  const all = publishableLevels();
  check(SERVED_LEVELS.every((level) => levelIsPublishable(level)), `the levels the app serves today are publishable (${SERVED_LEVELS.join(', ')})`);
  check(!levelIsPublishable(all[all.length - 1] + 1), `and the level after the corpus's last is not (${all[all.length - 1] + 1} asks for ${levelAt(all[all.length - 1] + 1).poolSize} titles)`);
  check(!levelIsPublishable(0), 'nor is a level below the ladder');
  check(MAIN_POOL.version === POOL_VERSION, `and the pool version the seasons are stamped with is the one the endpoints check (${POOL_VERSION})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
