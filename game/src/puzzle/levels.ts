// The level ladder — one concern, one formula, and the levels it produces are PINNED by a probe.
//
// ============================================================================================
// THE LADDER IS DERIVED FROM MEASUREMENT, not from the design's prose alone. DESIGN.md §5 states the shape
// ("L1 is the smallest pool", "depth rises", "the pool grows by 4 a level") and leaves the numbers to the
// generator, so this file answers the question the prose cannot: WHICH LEVELS CAN ACTUALLY PRODUCE A PUZZLE?
//
// MEASURED by `game/tools/measure-ladder.mjs` and by a depth sweep (5 seeds per cell, 50 000-node budget). The sweep
// below is from **the squared-set generator** — the one that opened every question on home — so its timings are that
// generator's worst-case wall time for one puzzle at the cell. Its option COUNT column is deliberately gone: it was
// whatever `optionCountFor` returned then, and that floor has since been re-measured (finding 1), so leaving the column
// would print a number this file no longer agrees with.
//
//   pool  depth 2     depth 3
//   10        56 ms   FAILS        <- "no board is reachable in exactly 3 call(s)"
//   15        34 ms   FAILS
//   20       292 ms   423 ms   <- depth 3 becomes possible
//   24       494 ms  1035 ms
//   28       634 ms  1879 ms
//   32       730 ms  2662 ms
//   36       834 ms  3095 ms
//   45       971 ms  3169 ms
//   55      1442 ms  4899 ms
//
// THREE FINDINGS, none of which the design could have known:
//
// 1. A 3-OPTION QUESTION NEEDED A POOL OF 35 **ONLY BECAUSE EVERY START WAS A SQUARED SET**, and that was never a
//    fact about the pool. Below 35 a squared set offers too few calls to carry a three-way question — but the level's
//    own formations do. RE-MEASURED once the generator began drawing its start from them (`optionCountFor`'s floor is
//    now a constant again): a three-option question generates from a pool of **5** (5 of 5 seeds) and fails at **4**,
//    where no start offers three distinct endings. So the floor is the START's fan-out, not the pool's size, and the
//    per-level `optionCount` survives only because level 1 is pinned to two by product decision.
//
// 2. DEPTH 3 STILL NEEDS A POOL OF AT LEAST 20, and that is a HARD floor rather than a cost — the one finding the
//    start-board change did NOT move. RE-MEASURED over the same start set: at pools 10 and 15, 0 of 5 seeds find a
//    named board reachable in exactly three calls from ANY of the level's formations (those pools declare two named
//    ones); at pool 20, 5 of 5 do. This is why `BASE_POOL` is well above the 10 the design first proposed: the Daily
//    is asked in three calls (DESIGN.md §9), so every level has to be able to answer in three.
//
// 3. DEPTH 3 IS EXPENSIVE — 0.4 s at pool 20 rising to ~4.9 s at pool 55 — and it used to be the reason the ladder
//    stopped at depth 2, because the CLIENT generated. It does not any more (DESIGN.md §9: the serving layer
//    generates, the client applies), so depth 3 is a publish-time cost with a cache in front of it — and the Daily's
//    publisher is a midnight trigger (DESIGN.md §9), which is what makes that the right place for it. IT GOT MORE
//    EXPENSIVE with the start-board change and the re-measurement above says by how much: 5 seeds of 5 at pool 20
//    worst-case **1.6 s** (was 0.42 s), at pool 25 **2.1 s**, at the shipped level-1 pool **4.0 s** — because a
//    generation now tries the level's formations in order until one yields a puzzle. WHAT SHIPPED: the Drill keeps
//    `MAX_DEPTH = 2` (its questions are one call at L1 and two after, which is what a three-button question is for),
//    and the DAILY is asked in `DAILY_DEPTH = 3` calls at every level, which is the "multi-call, at least three" the
//    mode was specified with.
//
// All three findings are recorded as corrections to DESIGN.md §5, with these numbers.

import type { LevelSpec } from './types.ts';

/**
 * The pool every level starts from.
 *
 * IT IS 57 BECAUSE LEVEL 1 MUST TEACH WHOLE FAMILIES, and 57 is the smallest prefix of `calls-data.ts` that
 * does. `poolFor` is a PREFIX, so the boundary is a COUNT, and a count can land in the middle of a family —
 * it did: at 20, level 1 taught `Circle Four Left` and never `Circle Four Right`, because the corpus's first
 * 24 titles are all Circle. MEASURED by `node game/tools/pool-families.mjs 10`, after the order was grouped so
 * each corpus file's titles are contiguous: 57 titles is the TENTH whole family — Circle 32, Dosado 5,
 * Double Pass Thru 5, Alamo Style 3, Allemande 1, Arm Turns 4, Bend the Line 2, Box the Gnat 1,
 * California Twirl 1, Cast Off 3/4 3. `test/pool-probe.mjs` pins that the shipped boundary splits no family,
 * so re-curating the order cannot quietly half-teach one again.
 *
 * IT IS ALSO WELL ABOVE `DEPTH3_MIN_POOL`, which finding 2 requires: a level that cannot be asked a three-call
 * question cannot carry the Daily at all, and the design's original "L1 is 10 calls" could not answer one.
 */
export const BASE_POOL = 57;

/**
 * How much the pool grows per level.
 *
 * FOUR A LEVEL is the owner's rule (DESIGN.md §5 decision 4), kept: it is the shape a Mainstream pool can sustain
 * over a season, and with the floor at 20 it puts three-option questions at L5 (pool 36) where the old
 * five-every-three-levels formula reached them at L16.
 */
export const POOL_STEP = 4;

/** The deepest solution the DRILL asks for. See finding 3 above. */
export const MAX_DEPTH = 2;

/**
 * The deepest solution the DAILY asks for, at EVERY level — "always multi-call, at least three" (DESIGN.md §9).
 *
 * IT IS NOT ON THE LEVEL, deliberately: a level's `depth` is the Drill's question length, and the Daily's is a
 * property of the mode. Two numbers on one type would be two things to keep in step, and the one that drifted would
 * be the Daily's silently.
 */
export const DAILY_DEPTH = 3;

/**
 * The smallest pool at which a 3-option question generates. See finding 1 above.
 *
 * FIVE, NOT THIRTY-FIVE. The old floor was the SQUARED SET's: from home, a pool below 35 offered too few calls for a
 * three-way question. The level's own formations do not have that restriction, and RE-MEASURED over them a
 * three-option question generates from a pool of 5 (5 of 5 seeds) and fails at 4, where no start offers the three
 * distinct endings the question needs. No shipped level is anywhere near this line — the ladder's floor is
 * `BASE_POOL` — so this is a documented boundary rather than something a player can reach.
 */
export const THREE_OPTION_MIN_POOL = 5;

/**
 * The smallest pool at which a three-call puzzle generates at all. See finding 2 above.
 *
 * UNMOVED by the start-board change, and re-measured to say so: 0 of 5 seeds at pools 10 and 15 (from any of the two
 * named formations those pools declare), 5 of 5 at pool 20. This is the floor `BASE_POOL` has to clear, because the
 * Daily asks three calls at every level.
 */
export const DEPTH3_MIN_POOL = 20;

/**
 * How many drills a level holds — the whole of a level's block, 10×10 (DESIGN.md §15 Q17(v)).
 *
 * IT IS HERE BECAUSE TWO SIDES NEED THE SAME NUMBER AND NEITHER MAY OWN IT. The publisher fills a level to this
 * size (`api/tools/publish-schedule.mjs`'s `--season` default), and the serving side promotes a player out of a
 * level when that level's block is full (`api/src/ladder.ts`). A second copy of `100` on either side is how "all
 * the level's drills are finished" and "the level is full" come to disagree, and the disagreement is INVISIBLE
 * because each side is self-consistent: the player is simply never promoted, or is promoted early.
 *
 * IT IS NOT `poolSize` AND NOT A SEASON. `poolSize` is how many CALLS a level may use, and a season is one
 * publication's worth of entries — a calendar month of additions, per Q17(i)–(iii). This is the total a level's
 * block shows, and because a repeated puzzle published at a NEW index is a new entry, a level can always be
 * filled to it (Q17: "why promotion stays reachable").
 */
export const LEVEL_SIZE = 100;

/** How many options a step presents at this level. */
export function optionCountFor(poolSize: number): number {
  return poolSize >= THREE_OPTION_MIN_POOL ? 3 : 2;
}

/**
 * The level at `index` (1-based), or `null` for an index below 1.
 *
 * TOTAL AND CLOSED-FORM, with no table: a table would be one more thing to keep in step with the design, and the
 * formula is two lines. `depth` is 1 at L1 (the teaching level: one call, two options) and `MAX_DEPTH` after; the
 * pool grows by `POOL_STEP` every level from the floor of `BASE_POOL`.
 */
export function levelSpec(index: number): LevelSpec | null {
  if (!Number.isInteger(index) || index < 1) return null;
  const depth = index === 1 ? 1 : MAX_DEPTH;
  const poolSize = BASE_POOL + POOL_STEP * (index - 1);
  // LEVEL 1 STAYS A TWO-OPTION QUESTION, and it is pinned rather than derived. `optionCountFor` would give
  // three here, because the pool is now far above `THREE_OPTION_MIN_POOL` — but the teaching level's shape is
  // a product decision (one call, a right answer and a wrong one), and letting it change as a SIDE EFFECT of
  // the pool growing is exactly how a teaching level becomes a three-button question nobody chose.
  const optionCount = index === 1 ? 2 : optionCountFor(poolSize);
  return { index, poolSize, depth, optionCount };
}

/**
 * The level as the DAILY asks it: the same pool, `DAILY_DEPTH` calls.
 *
 * WHY A FUNCTION RATHER THAN A FIELD OR A SECOND LADDER. The Daily and the Drill are one progression — a player's
 * level is one number — but they ask different-length questions, and the generator takes the depth from the spec it
 * is handed. So the depth is applied at the boundary where a puzzle is generated for a mode, which is also where
 * the seed and the cache key are decided (`api/src/levels.ts`), rather than being carried on the level for every
 * reader to ignore.
 */
export function dailySpec(level: LevelSpec): LevelSpec {
  return { ...level, depth: DAILY_DEPTH };
}

/** The first `n` levels, for a census or a UI. Stops where `levelSpec` would return null. */
export function firstLevels(n: number): LevelSpec[] {
  const out: LevelSpec[] = [];
  for (let i = 1; i <= n; i++) {
    const spec = levelSpec(i);
    if (spec) out.push(spec);
  }
  return out;
}
