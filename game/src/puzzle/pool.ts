// The call pool: the ordered titles a level draws from, and the mapping from a level to the calls it
// may use. Pure data plus a slice — the interesting decisions are in `calls-data.ts` (the order and its
// provenance) and `levels.ts` (the ladder).

import { CALLS_IN_ORDER, POOL_VERSION } from './calls-data.ts';
import type { LevelSpec } from './types.ts';

export { POOL_VERSION };

export interface CallPool {
  /** Every title, in teaching order. `poolFor` slices it. */
  readonly order: readonly string[];
  /** The pool version every puzzle generated from this pool carries. */
  readonly version: string;
}

/** The shipped pool. */
export const MAIN_POOL: CallPool = { order: CALLS_IN_ORDER, version: POOL_VERSION };

/**
 * The titles a level may use: the FIRST `level.poolSize` of the order.
 *
 * `poolSize` is a count, so the slice boundary is where the off-by-one lives and there is nowhere else
 * it can be. A level asking for more calls than exist gets all of them rather than an empty pool —
 * the ceiling is a MEASURED property of the ladder (DESIGN.md 5: "do not invent the ladder's
 * ceiling"), and a measurement that silently ran past the end of the list would report the list's
 * length as if it were the ceiling.
 */
export function poolFor(level: LevelSpec, pool: CallPool = MAIN_POOL): string[] {
  return pool.order.slice(0, Math.min(level.poolSize, pool.order.length));
}

/** Whether the pool is long enough to fill this level. Reported by the ladder measurement rather than
 * asserted here, because "the pool ran out" and "generation failed" are different findings. */
export function poolIsComplete(level: LevelSpec, pool: CallPool = MAIN_POOL): boolean {
  return level.poolSize <= pool.order.length;
}
