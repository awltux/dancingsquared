// Publish the Daily's challenges: the boundary job, run by hand or by a schedule.
//
//   npm run api:publish-daily                    today (UTC), every level the corpus can fill
//   npm run api:publish-daily -- --day 2026-11-01
//   npm run api:publish-daily -- --levels 1,2,3
//
// THE GUARD FIRST, because this WRITES: with no `DSQ_DDB_ENDPOINT` it would publish into whatever account the
// ambient credentials belong to (AGENTS.md §8 trap 21, which is how `npm run api:table` created a real table).
// `DSQ_ALLOW_REAL_AWS=1` is the deliberate override.
//
// IT PUBLISHES AHEAD OF THE DAY, which is the whole point: the Daily is "a read of the published artefact, not a
// generation per request" (DESIGN.md 11), so this is what makes `GET /puzzle` cheap and what makes a seed that no
// longer generates a finding at the boundary instead of a refusal for every player at that level.
import { utcDay } from 'dancing-squared-game';
import { configFromEnv, realServiceWarning } from '../src/config.ts';
import { publishDay, publishableLevels } from '../src/daily-publishing.ts';
import { openStore } from '../src/store/open.ts';

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
};

const config = configFromEnv();
const warning = realServiceWarning(config);
if (warning) {
  console.error(`api:publish-daily refuses to run: ${warning}`);
  process.exit(1);
}

const day = valueOf('--day') ?? utcDay(new Date());
const levelsFlag = valueOf('--levels');
const levels = levelsFlag ? levelsFlag.split(',').map((part) => Number(part.trim())) : publishableLevels();
// A LEVEL WITH NO POOL BEHIND IT CANNOT BE PUBLISHED, and asking for one is a mistake worth naming rather than a
// silent skip: `publishableLevels` is the ladder the corpus fills, and the flag is for narrowing it (a smoke
// test, one level's re-publish), not for reaching past it.
const all = publishableLevels();
const unreachable = levels.filter((level) => !all.includes(level));
if (unreachable.length) {
  console.error(`levels ${unreachable.join(', ')} are not in 1..${all[all.length - 1]}: the corpus cannot fill their pools`);
  process.exit(1);
}

// A PUBLISH INTO MEMORY IS A PUBLISH NOBODY CAN READ: the row lives in this process and dies with it, while the
// endpoint that serves it runs somewhere else. So the store must be DynamoDB — the one the dev server and the
// future Lambda open, through the same `openStore`, which also reports a missing table with the fix.
if (config.store !== 'dynamodb') {
  console.error('api:publish-daily refuses to run: DSQ_STORE is not dynamodb, and a schedule published into this process would be gone before anything could read it');
  process.exit(1);
}
const opened = await openStore(config);
const report = await publishDay(opened.store, day, { levels, nowMs: Date.now() });

console.log(`api:publish-daily ${day} against ${opened.label}`);
for (const entry of report.published) console.log(`  published level ${entry.levelIndex}: seed ${entry.seed}`);
for (const entry of report.refused) console.log(`  REFUSED level ${entry.levelIndex}: ${entry.reason}`);
console.log(`  ${report.published.length} published, ${report.refused.length} refused`);
// A REFUSAL IS A NON-ZERO EXIT, because a script that reports a finding and succeeds is a script nobody reads.
process.exit(report.refused.length === 0 ? 0 : 1);
