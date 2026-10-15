// The level ladder — one concern, one formula, and the levels it produces are PINNED by a probe.
//
// ============================================================================================
// THE LADDER IS DERIVED FROM MEASUREMENT, not from the design's prose alone. DESIGN.md 5 states three
// rules ("L1 = { poolSize: 10, depth: 1 }", "depth rises 1 → 2 → 3", "poolSize grows by 5 every 3
// levels") and leaves the rest to the generator, so this file answers the question the prose cannot:
// WHICH LEVELS CAN ACTUALLY PRODUCE A PUZZLE?
//
// MEASURED by `game/test/ladder-census-probe.mjs`, 6 seeds per cell, 50 000-node budget:
//
//   pool  depth 1            depth 2            depth 3
//   10    3 opts   150ms     2 opts   260ms     2 opts   290ms
//   15    3 opts   113ms     2 opts   379ms     2 opts   516ms
//   25    3 opts   209ms     2 opts   655ms     2 opts   893ms
//   30    3 opts   384ms     2 opts   908ms     2 opts  2026ms
//   35    3 opts   295ms     3 opts  1304ms     3 opts  3345ms   <- 3 options become possible
//   40    3 opts   365ms     3 opts  1657ms     3 opts  4361ms
//   45    3 opts   382ms     3 opts  1825ms     2 opts  7176ms   <- depth 3 regresses to 2 options
//
// TWO FINDINGS, neither of which the design could have known:
//
// 1. A 3-OPTION QUESTION NEEDS A POOL OF AT LEAST 35. Below that, the reachable board graph has no route
//    from the squared set in which every played-from board offers three distinct endings, so the level
//    can only be asked with TWO options. That is why `optionCount` is a per-level value rather than the
//    constant 3: a ladder that insisted on three would have levels 1..6 with no puzzles at all.
//
// 2. DEPTH 3 IS EXPENSIVE AND NOT UNIFORMLY POSSIBLE. It generates at most pools, but its worst case
//    grows to ~4-7 s, which is too slow for a browser — the Daily regenerates on the client (DESIGN.md
//    4.4). DEPTH IS THEREFORE CAPPED AT 2.
//
// WHAT THE DESIGN ASKS FOR AND WHAT THIS SHIPS, stated rather than quietly differenced: the design wants
// depth to rise to 3 and options to be 3. This ships depth 2 (for the client's budget) and 3 options only
// where the corpus supports them. The alternative — publishing levels that cannot generate a puzzle — is
// not a game. Both findings are recorded as corrections to DESIGN.md §5, with these numbers.

import type { LevelSpec } from './types.ts';

/** The pool every level starts from. DESIGN.md 5: "L1 is 10 calls". */
export const BASE_POOL = 10;

/** How much the pool grows per widening step, and how many levels apart those steps are. */
export const POOL_STEP = 5;
export const POOL_STEP_LEVELS = 3;

/** The deepest solution the ladder asks for. See finding 2 above. */
export const MAX_DEPTH = 2;

/** The smallest pool at which a 3-option question generates. See finding 1 above. */
export const THREE_OPTION_MIN_POOL = 35;

/** How many options a step presents at this level. */
export function optionCountFor(poolSize: number): number {
  return poolSize >= THREE_OPTION_MIN_POOL ? 3 : 2;
}

/**
 * The level at `index` (1-based), or `null` for an index below 1.
 *
 * TOTAL AND CLOSED-FORM, with no table: a table would be one more thing to keep in step with the design,
 * and the formula is four lines. `depth` rises 1 → 2 and stays; the pool widens by 5 every 3 levels from
 * L4, which is where depth has finished rising.
 */
export function levelSpec(index: number): LevelSpec | null {
  if (!Number.isInteger(index) || index < 1) return null;
  const depth = index === 1 ? 1 : MAX_DEPTH;
  const widenings = index >= 4 ? Math.floor((index - 4) / POOL_STEP_LEVELS) : 0;
  // L2 and L3 sit between the base pool and the first widening; L2's extra 5 is a CHOICE, not a
  // derivation — see `game/DESIGN.md` §5 for the alternative reading and the numbers against it.
  const poolSize = index === 1 ? BASE_POOL : BASE_POOL + POOL_STEP + widenings * POOL_STEP;
  return { index, poolSize, depth, optionCount: optionCountFor(poolSize) };
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
