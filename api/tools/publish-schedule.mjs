// Publish a level's Drill season: the authoring pipeline of DESIGN.md 7.2, run by hand or by a job.
//
//   npm run api:publish-schedule                          levels 1-3, a 31-drill season
//   npm run api:publish-schedule -- --levels 1,2 --season 7
//   npm run api:publish-schedule -- --dry-run             show what would be written, write nothing
//
// THE GUARD FIRST, because this WRITES (AGENTS.md §8 trap 21, which cost a real table). Then the store: publishing
// into memory would be gone before anything could read it, so `DSQ_STORE=dynamodb` is required and `openStore`
// reports a missing table with the command that creates it.
//
// WHAT IT PUBLISHES IS A SEED, A LEVEL AND A POOL VERSION — no puzzle, no board, no media (DESIGN.md 11). Every
// seed is validated by GENERATING it (§7.2: "the lint re-runs the generator rather than trusting the author's
// memory"), so a season that cannot be filled is reported and the process exits non-zero: a schedule published
// short would serve the players at that level nothing after the gap.
import { configFromEnv, realServiceWarning } from '../src/config.ts';
import { generateSeason, levelIsPublishable, lintSeason, publishSeason, seasonVersion, SERVED_LEVELS } from '../src/schedule-publishing.ts';
import { publishableLevels } from '../src/levels.ts';
import { openStore } from '../src/store/open.ts';

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
};

const config = configFromEnv();
const warning = realServiceWarning(config);
if (warning) {
  console.error(`api:publish-schedule refuses to run: ${warning}`);
  process.exit(1);
}
const season = Number(valueOf('--season') ?? 31);
if (!Number.isInteger(season) || season < 1) {
  console.error('--season must be a positive integer');
  process.exit(1);
}
const levelsFlag = valueOf('--levels');
const levels = levelsFlag ? levelsFlag.split(',').map((part) => Number(part.trim())) : [...SERVED_LEVELS];
const dryRun = argv.includes('--dry-run');
// A DRY RUN NEEDS NO STORE AT ALL, which is what makes it usable for a first look at a season's cost; a real run
// needs DynamoDB, because a season written into this process would be gone before anything could read it.
if (!dryRun && config.store !== 'dynamodb') {
  console.error('api:publish-schedule refuses to run: DSQ_STORE is not dynamodb, and a season published into this process would be gone before anything could read it');
  process.exit(1);
}
const all = publishableLevels();
const unreachable = levels.filter((level) => !levelIsPublishable(level));
if (unreachable.length) {
  console.error(`levels ${unreachable.join(', ')} are not in 1..${all[all.length - 1]}: the corpus cannot fill their pools`);
  process.exit(1);
}

const opened = dryRun ? null : await openStore(config);
console.log(`api:publish-schedule season ${season} for level(s) ${levels.join(', ')}${dryRun ? ' (dry run)' : ` against ${opened.label}`}`);

let failures = 0;
for (const levelIndex of levels) {
  const started = Date.now();
  const authored = generateSeason(levelIndex, { season });
  const seconds = (Date.now() - started) / 1000;
  // THE DESIGN'S OWN LINT, on the entries as they would be published. It runs the STRUCTURAL checks here
  // (duplicates, order, pool version) and not the re-generating ones, because every seed was generated to be
  // accepted; a probe runs the full lint on a short season, which is where the expensive proof belongs.
  const findings = lintSeason(authored.entries, levelIndex, false);
  if (authored.skipped.length) {
    for (const skipped of authored.skipped) console.log(`  level ${levelIndex}: skipped seed ${skipped.seed} — ${skipped.reason}`);
  }
  if (findings.length) {
    failures++;
    for (const finding of findings) console.error(`  level ${levelIndex}: REFUSED BY THE LINT — ${finding}`);
    continue;
  }
  if (authored.entries.length < season) {
    failures++;
    console.error(`  level ${levelIndex}: cannot fill a season of ${season} (found ${authored.entries.length} in ${authored.attempts} candidates)`);
    continue;
  }
  const version = seasonVersion(authored.entries[0].poolVersion, season);
  if (!dryRun && opened) await publishSeason(opened.store, levelIndex, authored.entries, version);
  console.log(`  level ${levelIndex}: ${authored.entries.length} seeds, ${version}, ${authored.attempts - authored.entries.length} skipped, ${seconds.toFixed(1)} s${dryRun ? ' (not written)' : ''}`);
}
process.exit(failures === 0 ? 0 : 1);
