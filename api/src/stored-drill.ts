// ONE PUBLISHED DRILL: the seed and the BOARDS that seed names, stored rather than regenerated on read.
//
// WHY THE BOARDS ARE STORED. The owner's rule is that this is a multi-player game and every player must travel
// the same progression. A puzzle is a pure function of `(seed, level, poolVersion)` only while the generator's
// code is unchanged — so regenerating on read makes "the same progression" a promise about a build rather than
// about the data. Storing the boards freezes it: a drill already published cannot change under a player, and a
// generator change is DETECTED (`GENERATOR_VERSION`) instead of silently rewriting a level mid-flight.
//
// WHY ONE ROW PER DRILL. A puzzle is ~11 KB, so a level's 100 would be ~1.1 MB in one item against DynamoDB's
// 400 KB ceiling. Per-drill rows also make the serving read one `get`, and they keep the level grid free of
// puzzle bytes — the grid asks only for the schedule's length and the player's own per-cell facts.
//
// WHAT IS NOT HERE, ON PURPOSE: no clock, no HTTP, no regime rules. Publishing writes; serving reads. The
// decision about WHICH drill is the player's is `drill-regime.ts`'s and is not touched by the storage change.
import { GENERATOR_VERSION, type Puzzle, type ScheduleEntry } from 'dancing-squared-game';
import { drillKey } from './keys.ts';
import { levelAt, puzzleFor } from './levels.ts';
import type { ItemStore } from './ports.ts';

/**
 * A published drill as it is stored.
 *
 * THE SEED AND THE POOL VERSION ARE PROVENANCE, not inputs: once the boards are here, nothing needs to
 * regenerate them. They are kept because they are what a log line and a diagnostic need to say which drill this
 * is, and because the ISSUED record already carries them (`IssuedDrill`), so a stored row that disagrees with
 * itself is a corruption finding rather than a puzzle question.
 */
interface StoredDrill {
  readonly scheduleVersion: string;
  readonly generatorVersion: string;
  readonly seed: number;
  readonly levelIndex: number;
  readonly poolVersion: string;
  readonly puzzle: Puzzle;
}

/**
 * A stored row as a drill, or null.
 *
 * STRICT, AND LOUD WHEN IT FAILS, for the reason `progress-row.ts` gives about its own parser: a row this build
 * cannot read is either a schema change or corruption, and the alternative — treating it as "no drill" — would
 * answer every player at that level with a refusal that looks like an unpublished level.
 */
export function asStoredDrill(value: unknown): StoredDrill | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
  if (!text(v['scheduleVersion']) || !text(v['generatorVersion']) || !text(v['poolVersion'])) return null;
  if (typeof v['seed'] !== 'number' || !Number.isFinite(v['seed'])) return null;
  if (typeof v['levelIndex'] !== 'number' || !Number.isInteger(v['levelIndex'])) return null;
  const puzzle = v['puzzle'];
  if (!puzzle || typeof puzzle !== 'object') return null;
  const p = puzzle as Record<string, unknown>;
  // ENOUGH OF THE PUZZLE TO PROVE IT IS ONE: the fields the client draws from, and the steps it dances.
  if (p['mode'] !== 'drill') return null;
  if (!Array.isArray(p['steps']) || p['steps'].length === 0) return null;
  if (!p['start'] || !p['goal']) return null;
  return {
    scheduleVersion: v['scheduleVersion'],
    generatorVersion: v['generatorVersion'],
    seed: v['seed'],
    levelIndex: v['levelIndex'],
    poolVersion: v['poolVersion'],
    puzzle: puzzle as Puzzle,
  };
}

/** The value written for one drill. One place, so a writer cannot invent a shape the reader rejects. */
function storedValue(levelIndex: number, entry: ScheduleEntry, scheduleVersion: string, puzzle: Puzzle): Readonly<Record<string, unknown>> {
  return {
    scheduleVersion,
    generatorVersion: GENERATOR_VERSION,
    seed: entry.seed,
    levelIndex,
    poolVersion: entry.poolVersion,
    puzzle,
  };
}

/**
 * Write every drill of a level, BEFORE the schedule that publishes them.
 *
 * THE ORDER IS THE SAFETY PROPERTY: a reader that can see the new schedule must find the drills it names, so the
 * drills go first and the schedule row is the last write. A crash between them leaves the previous schedule and
 * a few unused drill rows, which is invisible; the other order leaves a level that refuses every player.
 *
 * THE GENERATION IS ALREADY PAID FOR: `generateSeason` validates each seed by generating it through `puzzleFor`,
 * whose cache makes this pass a `Map` lookup rather than a second generation — and a caller that republishes a
 * regime it already generated (the probes' fixtures) pays one lookup for the same reason.
 */
export async function storeDrills(
  store: ItemStore,
  levelIndex: number,
  entries: readonly ScheduleEntry[],
  scheduleVersion: string,
): Promise<void> {
  const level = levelAt(levelIndex);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const generated = puzzleFor(entry.seed, level, 'drill');
    if (!generated.ok) {
      throw new Error(`cannot publish level ${levelIndex} entry ${index}: seed ${entry.seed} does not generate (${generated.reason})`);
    }
    const key = drillKey(levelIndex, index);
    const value = storedValue(levelIndex, entry, scheduleVersion, generated.puzzle);
    let written = false;
    for (let attempt = 0; attempt < 3 && !written; attempt++) {
      const current = await store.get(key);
      written = await store.put(key, value, current?.rev ?? null);
    }
    if (!written) throw new Error(`could not write ${key.pk}/${key.sk}: another writer kept winning`);
  }
}

/** What reading one published drill produced. */
type DrillRead = { readonly ok: true; readonly puzzle: Puzzle } | { readonly ok: false; readonly reason: string };

/**
 * The published boards for one position, or why they cannot be served.
 *
 * THREE REFUSALS, EACH NAMING ITS OWN CAUSE, because the operator's next move differs: a missing row is an
 * unpublished drill (publish it), an unreadable one is corruption or a schema change, and a version mismatch is a
 * STALE STORE (republish). Folding them into one "unavailable" is how a republish gets diagnosed as a bug.
 */
export async function readDrill(
  store: ItemStore,
  levelIndex: number,
  index: number,
  poolVersion: string,
): Promise<DrillRead> {
  const stored = await store.get(drillKey(levelIndex, index));
  if (!stored) {
    return { ok: false, reason: `level ${levelIndex} has no published drill at entry ${index}` };
  }
  const drill = asStoredDrill(stored.value);
  if (!drill) {
    return { ok: false, reason: `the published drill at level ${levelIndex} entry ${index} is not a record this build can read` };
  }
  if (drill.generatorVersion !== GENERATOR_VERSION) {
    return {
      ok: false,
      reason: `level ${levelIndex} entry ${index} was generated by ${drill.generatorVersion} and this build is ${GENERATOR_VERSION} — republish the level`,
    };
  }
  if (drill.poolVersion !== poolVersion) {
    return {
      ok: false,
      reason: `level ${levelIndex} entry ${index} was generated against pool ${drill.poolVersion}, and this drill was issued from ${poolVersion}`,
    };
  }
  return { ok: true, puzzle: drill.puzzle };
}
