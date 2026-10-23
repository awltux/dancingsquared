// The Daily's boundary job, as a module: which challenges a day needs, and writing the ones that validate.
//
// WHAT THE JOB IS FOR, in DESIGN.md 9 and 11: the Daily is "a read of the published artefact, not a generation
// per request", so something has to generate and check it AHEAD of the day — and that something is this. The
// artefact is small because a puzzle is derivable from `(seed, level, poolVersion)` (§7): what is published is a
// number, which is what makes the challenge identical for every player at a level without a table of boards.
//
// WHY IT VALIDATES RATHER THAN JUST COMPUTING. `dailyEntry` is pure arithmetic and cannot fail; GENERATING the
// puzzle from it can (§7.2: a seed that no longer generates is the finding the lint exists for). So the job
// generates each level's challenge and writes the row ONLY when it comes back ok. A day published with a seed
// that does not generate is a day where every player at that level gets a refusal, so the refusal is reported at
// the boundary instead — and the day's other levels still publish, because one broken level is not a reason to
// serve nobody a Daily.
import { GENERATOR_VERSION, POOL_VERSION, dailyEntry, isUtcDay, type ScheduleEntry } from 'dancing-squared-game';
import { levelAt, publishableLevels, puzzleFor } from './levels.ts';
import { publishedDailyKey } from './keys.ts';
import type { ItemStore } from './ports.ts';

/** One level's challenge for one day, as the artefact stores it: a seed, a level and a pool version. */
export function challengeFor(levelIndex: number, day: string): ScheduleEntry {
  return dailyEntry(levelAt(levelIndex), POOL_VERSION, day);
}

/** What publishing a day did, level by level. Both lists are reported: a refusal is a finding, not a silence. */
export interface PublishReport {
  readonly day: string;
  readonly published: { levelIndex: number; seed: number }[];
  readonly refused: { levelIndex: number; reason: string }[];
}

/**
 * Publish one UTC day, for the levels asked for (default: every level the corpus can fill).
 *
 * A ROW IS REPLACED, NOT APPENDED, and the artefact is deterministic — so re-running this for a day is a no-op
 * in content and the version stamp is what tells an operator the write happened. `publishedAtMs` is stamped
 * from the caller's clock so the job stays testable.
 */
export async function publishDay(store: ItemStore, day: string, options: { levels?: readonly number[]; nowMs: number }): Promise<PublishReport> {
  if (!isUtcDay(day)) throw new Error(`${JSON.stringify(day)} is not a UTC day (expected YYYY-MM-DD)`);
  const levels = options.levels ?? publishableLevels();
  const published: { levelIndex: number; seed: number }[] = [];
  const refused: { levelIndex: number; reason: string }[] = [];

  for (const levelIndex of levels) {
    const entry = challengeFor(levelIndex, day);
    const generated = puzzleFor(entry.seed, levelAt(levelIndex), 'daily');
    if (!generated.ok) {
      refused.push({ levelIndex, reason: generated.reason });
      continue;
    }
    const key = publishedDailyKey(levelIndex, day);
    const value = {
      seed: entry.seed,
      levelIndex: entry.levelIndex,
      poolVersion: entry.poolVersion,
      /**
       * WHICH GENERATOR BUILT THESE BOARDS, so a build that no longer generates them can say so instead of serving
       * them. The row stores the PUZZLE, not just the seed, so a generator change is invisible until something
       * disagrees — and the disagreement would be a run refused for "not solved" on a challenge the player actually
       * solved. `stored-drill.ts` has stamped this fact since the drills were frozen; the Daily gained it with `g7`,
       * the change that made a Daily's seed mean something else (a walk through 5-10 waypoints).
       */
      generatorVersion: GENERATOR_VERSION,
      publishedAtMs: options.nowMs,
      // THE PUZZLE ITSELF, BUILT HERE AND RECOVERED BY THE READ. The boundary job is the only thing that BUILDS a
      // challenge; GET /puzzle only recovers one, because building costs 9.4-15.1 s (DESIGN.md §7.1) and doing it on
      // a read held the request open while every other request queued behind it. Storing it is what makes "recover"
      // possible in a process that never built it — a separate Lambda invocation, or a server restarted since — and it
      // is the same shape drills already use (stored-drill.ts). The BOARDS are stored and the READINGS are not: the
      // readings are `applicableMoves` for one board (719 ms cold, cached after), and carrying them would put the row
      // near DynamoDB's 400 KB item limit for no gain.
      puzzle: generated.puzzle,
    };
    // THE SAME READ-MODIFY-WRITE AS EVERYTHING ELSE, and it converges for the same reason: the row's value does
    // not depend on what was there, so a loser of the race simply writes the same bytes on the next attempt.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await store.get(key);
      if (await store.put(key, value, current?.rev ?? null)) break;
      if (attempt === 2) throw new Error(`could not publish ${key.pk}/${key.sk}: another writer kept winning`);
    }
    published.push({ levelIndex, seed: entry.seed });
  }
  return { day, published, refused };
}
