// The local regime: which drills the app serves, in order.
//
// LOCAL FIXTURE, PER DESIGN.md §13's PHASE 2 — the Drill's real order is authored and served by the
// database (§7.2, §8), and this file stands in for it until Phase 5 so the mode is playable and testable
// with no AWS resource. It is the app's stand-in for a `schedule#<level>` row, and it is deliberately the
// same SHAPE as one: an ordered list of `{ seed, levelIndex }` with nothing else, because a published
// entry is a seed and a level and no puzzle (decision 13).
//
// THE SEEDS ARE MEASURED, NOT CHOSEN. Every entry below was found by generating it: seeds 1..4 generate at
// each of levels 1..3, and each carries an illegal option (the `unknown` slot needs a refused call to
// exist). `game/test/schedule-fixture-probe.mjs` RE-RUNS that generation, so a corpus or generator change
// that breaks one of these seeds turns the gate red instead of shipping a player a blank board. The
// measurement is the probe's, and this comment only records where the numbers came from.
//
// LEVELS 1..3 ARE THE POINT. P1 measured that level 1 is depth 1 with two options and levels 2+ are depth 2,
// and that a three-option question needs a pool of at least 35 titles (L16). So the fixture is exactly the
// part of the ladder that always generates — three levels, two options, no 3-button question — which keeps
// "the fixture is what broke" off the list of reasons the app can fail.
import type { ScheduleEntry } from '../puzzle/types.ts';

export type ScheduleFixture = readonly ScheduleEntry[];

/** The pool version these entries were validated against. A mismatch is what `lintSchedule` reports. */
export const FIXTURE_POOL_VERSION = 'ms-1';

export const LOCAL_SCHEDULE: ScheduleFixture = [
  { seed: 1, levelIndex: 1, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 2, levelIndex: 1, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 3, levelIndex: 1, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 4, levelIndex: 1, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 1, levelIndex: 2, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 2, levelIndex: 2, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 3, levelIndex: 2, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 4, levelIndex: 2, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 1, levelIndex: 3, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 2, levelIndex: 3, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 3, levelIndex: 3, poolVersion: FIXTURE_POOL_VERSION },
  { seed: 4, levelIndex: 3, poolVersion: FIXTURE_POOL_VERSION },
];

/**
 * The entry at `position`, wrapping round the end.
 *
 * WRAPPING RATHER THAN REFUSING, because the fixture is a DEMO of a regime and not the regime itself: a
 * player who finishes the twelfth drill should get the first one again rather than an empty screen, and
 * the real "you have finished the season" behaviour belongs with the season boundary that §6 leaves open.
 */
export function scheduleEntryFor(position: number): ScheduleEntry {
  const n = LOCAL_SCHEDULE.length;
  return LOCAL_SCHEDULE[((position % n) + n) % n];
}

/** How many entries the fixture holds — what the UI shows as "drill 3 of 12". */
export function scheduleLength(): number {
  return LOCAL_SCHEDULE.length;
}
