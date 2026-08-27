// Formation FSM helper: keys FSM states on the NORMALISED formation (so all
// orientations of a shape are one state), and computes the orientation delta
// between consecutive transitions. Orientation is never part of the state
// identity; it is carried on the edge as a delta at 45-degree (eighth-turn)
// granularity.

import { matchFormations, type Matchable } from './match.js';

/** Steps per full turn. Orientation deltas are quantised to this many steps. */
export const ORIENTATION_STEPS = 8;
/** One orientation step in radians (45 degrees). */
export const ORIENTATION_STEP = (2 * Math.PI) / ORIENTATION_STEPS;

/** The normalised FSM state of a board: the best-matching standard formation
 * name with its absolute orientation REMOVED. Rotations that map a formation
 * onto itself (or any rotation of the shape) collapse to the same state key.
 * Returns null when the board matches no standard formation. */
export function normalisedState(
  formations: { name: string; dancers: Matchable[] }[],
  boardDancers: Matchable[],
  standardNames: string[],
): { key: string; rot: number } | null {
  let best: { name: string; rot: number; error: number } | null = null;
  for (const f of formations) {
    if (!standardNames.includes(f.name) || f.dancers.length !== boardDancers.length) continue;
    const m = matchFormations(boardDancers, f.dancers);
    if (m && (best === null || m.error < best.error)) best = { name: f.name, rot: m.rot, error: m.error };
  }
  if (!best) return null;
  // State key = normalised formation name (orientation removed).
  return { key: best.name, rot: best.rot };
}

/** The orientation delta (in eighth-turn steps) from `rotStart` to `rotEnd`,
 * wrapped to the nearest multiple of 45 degrees. Positive = counter-clockwise. */
export function orientationDeltaSteps(rotStart: number, rotEnd: number): number {
  let d = (rotEnd - rotStart) / ORIENTATION_STEP;
  const half = ORIENTATION_STEPS / 2;
  d = ((d % ORIENTATION_STEPS) + ORIENTATION_STEPS) % ORIENTATION_STEPS;
  if (d > half) d -= ORIENTATION_STEPS;
  return Math.round(d);
}
