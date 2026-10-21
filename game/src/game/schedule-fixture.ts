// The local regime: which drills the app serves, in order.
//
// LOCAL FIXTURE, PER DESIGN.md §13's PHASE 2 — the Drill's real order is authored and served by the
// database (§7.2, §8), and this file stands in for it until Phase 5 so the mode is playable and testable
// with no AWS resource. It is the app's stand-in for a `schedule#<level>` row, and it is deliberately the
// same SHAPE as one: an ordered list of `{ seed, levelIndex }` with nothing else, because a published
// entry is a seed and a level and no puzzle (decision 13).
//
// THIS FILE IS SEEDS ONLY, AND THE PUZZLES ARE BESIDE IT. The client generates nothing (DESIGN.md §9), so the
// boards the fixture season draws are BAKED in `season-data.ts` and paired with these entries by POSITION in
// `season.ts`. The split is what keeps the 133 KB of boards out of the API's import graph: `api/src/local-regime.ts`
// imports this file for the seeds, and never the data.
//
// THE SEEDS ARE MEASURED, NOT CHOSEN. Every entry below was found by generating it: seeds 1..100 generate at
// level 1 and seeds 1..4 at each of levels 2 and 3, and each carries an illegal option (the `unknown` slot needs a
// refused call to exist). `game/test/schedule-fixture-probe.mjs` RE-RUNS that generation, so a corpus or generator
// change that breaks one of these seeds turns the gate red instead of shipping a player a blank board — and it
// compares the result with the baked board, which is what catches a stale `season-data.ts`. The
// measurement is the probe's, and this comment only records where the numbers came from.
//
// LEVEL 1 IS A FULL BLOCK AND LEVELS 2-3 ARE A DEMO OF PROGRESSION. Level 1 is `LEVEL_SIZE` entries because the level
// screen draws one cell per drill and a four-cell block would be a screen telling the truth about a demo; levels 2
// and 3 keep four entries each, which is enough to exercise the ladder moving a player on. P1 measured that level 1
// is depth 1 with two options and levels 2+ are depth 2, and that a three-option question needs a pool of at least 35
// titles — the fixture is the part of the ladder that always generates, which keeps "the fixture is what broke" off
// the list of reasons the app can fail.
import { POOL_VERSION } from '../puzzle/pool.ts';
import { LEVEL_SIZE } from '../puzzle/levels.ts';
import type { ScheduleEntry } from '../puzzle/types.ts';

export type ScheduleFixture = readonly ScheduleEntry[];

/**
 * The pool version these entries were validated against.
 *
 * IT IS `POOL_VERSION` ITSELF, not a second copy of the string. It used to be the literal `'ms-1'`, which
 * is a duplicate of the shipped pool's version with no gate that would notice the two drifting apart:
 * MEASURED, nothing under `game/` compares a fixture entry's version against `MAIN_POOL.version` — the
 * schedule-lint probe builds its own entries from `MAIN_POOL.version` — so a bumped pool would have left
 * this file claiming the old one silently. It stays a named export because it reads better at the
 * call sites below ("validated against THE FIXTURE's pool") than the raw constant would.
 */
export const FIXTURE_POOL_VERSION = POOL_VERSION;

/** `count` seeds from 1, at one level. The seeds are the SAME for every level, and that is what the lint reports. */
function seeds(levelIndex: number, count: number): ScheduleEntry[] {
  return Array.from({ length: count }, (_, i) => ({ seed: i + 1, levelIndex, poolVersion: FIXTURE_POOL_VERSION }));
}

/**
 * THE FIXTURE: a FULL level 1 (the 10x10 block) and a DEMO of levels 2 and 3.
 *
 * LEVEL 1 IS `LEVEL_SIZE` ENTRIES because a level's block is 100 drills and the level screen draws one cell per drill
 * — a fixture of 4 would make the grid 4% full and the screen would be telling the truth about a demo rather than
 * about the game. Levels 2 and 3 keep four each: they are there so PROGRESSION is exercisable, and baking 100 at every
 * level costs ~11 KB of boards each (MEASURED: the 13-puzzle bake is 135 KB, the 108-puzzle one is 1.1 MB) for
 * content nobody plays offline yet.
 *
 * IT IS BUILT FROM A COUNT RATHER THAN SPELLED OUT, which is a change of shape and not of rule: the numbers were
 * always the measurement's, and `test/schedule-fixture-probe.mjs` still RE-GENERATES every entry and compares it with
 * the bake, so a seed that stops generating is a red gate rather than a listed entry nobody checks.
 */
export const LOCAL_SCHEDULE: ScheduleFixture = [
  ...seeds(1, LEVEL_SIZE),
  ...seeds(2, 4),
  ...seeds(3, 4),
];

/**
 * The entry at `position`, wrapping round the end.
 *
 * WRAPPING RATHER THAN REFUSING, because the fixture is a DEMO of a regime and not the regime itself: a
 * player who finishes the twelfth drill should get the first one again rather than an empty screen, and
 * the real "you have finished the season" behaviour belongs with the season boundary that §6 leaves open.
 */
/**
 * The fixture POSITION `position` names, wrapped into range.
 *
 * IT IS EXPORTED BECAUSE TWO THINGS INDEX OFF IT NOW: the SEED (`scheduleEntryFor`) and the BAKED PUZZLE
 * (`season.ts`). Two copies of the wrap is how "drill 3 of 12" comes to show one entry's question and another
 * entry's boards — and the wrap is not decoration: a player who finishes the twelfth drill gets the first again.
 */
export function schedulePosition(position: number): number {
  const n = LOCAL_SCHEDULE.length;
  return ((position % n) + n) % n;
}

export function scheduleEntryFor(position: number): ScheduleEntry {
  return LOCAL_SCHEDULE[schedulePosition(position)];
}

/** How many entries the fixture holds — what the UI shows as "drill 3 of 12". */
export function scheduleLength(): number {
  return LOCAL_SCHEDULE.length;
}
