// THE DAILY'S WAYPOINTS: the arrangements a route passes through, as things a player can be ON rather than calls.
//
// WHY WAYPOINTS AND NOT A CALL SEQUENCE. MEASURED on a full enumeration of a Daily at pool 20 (DESIGN.md §9.1): 192
// readings leave the start, 2 546 477 distinct three-call lines exist, and exactly ONE of them reaches the goal — so
// "the line" is not something a player can be warned about usefully, and "did you repeat a call" is worse: many
// different calls land on the same board, so a repeat is neither necessary nor sufficient for a loop.
//
// THE EQUALITY IS `geometryKey`, the engine's own: positions AND headings, quotiented by the eight rotations and the
// reflection — "two boards share a key precisely when the matcher would call them congruent" (`cells.ts`). So two
// DIFFERENT calls that leave the set in the same arrangement satisfy the same waypoint, which is exactly the
// robustness the call-name approach lacked. MEASURED, 11 of 12 generated routes visit a NEW arrangement at every
// stage, and all 12 end in an arrangement different from the start.
//
// THE RECOGNISER'S NAME IS A CAPTION, NEVER THE TEST. MEASURED, the same route names as "Static Square → (unnamed) →
// Static Square → Static Square": the names are rotation-invariant, so they cannot tell the stages apart. The key can.
import { boardMatchables, geometryKey, type Board } from 'dancing-squared-engine';

/**
 * The arrangement `board` is in, as a comparable string.
 *
 * A WAYPOINT IS A KEY, NOT A POSE: the player is "on" waypoint k when their board's key equals it, whatever rotation
 * or reflection they arrived by. That is the same quotient `matchFormations` uses, so the game and the engine agree
 * about what counts as the same arrangement.
 */
export function arrangementKey(board: Board): string {
  return geometryKey(boardMatchables(board));
}

/**
 * Whether `board` has REACHED `goal` — the same equivalence a waypoint uses, and not a stricter one.
 *
 * REPORTED: "Each Waypoint might have multiple solutions. A waypoint has been passed when the dancers are in the setup
 * described by the waypoint, regardless of what calls were used to get there. I have managed to get the dancers in the
 * position of the waypoint, but the game has refused it as a solution. I can only assume it is also expecting a
 * specific move." THE ASSUMPTION WAS RIGHT, and the inconsistency was here: the waypoint tick asked
 * `arrangementKey`'s equivalence (the eight rotations and the reflection) while the GOAL asked `sameBoardById`, which
 * is identity. So a player who reached the goal's ARRANGEMENT rotated or reflected was told the set was not on the
 * goal board, and the only way to satisfy the game was to find the one call that landed the identical board.
 * MEASURED over 40 generated level-1 Dailies (all one step): **9 of the 40 offer a call from the start whose board is
 * congruent to the goal but not identical to it**, so nearly a quarter of the puzzles at that level had a solution the
 * game refused.
 *
 * WHY CONGRUENCE IS THE RIGHT TEST AND IDENTITY IS NOT. The engine's own matcher quotients by exactly these eight
 * symmetries when it asks whether a board is a formation (`cells.ts`: "two boards share a key precisely when the
 * matcher would call them congruent"), so a rotated squared set IS the formation the goal names — and a puzzle whose
 * own waypoints are judged that way cannot then demand more of its last one. The alternative, loosening further to
 * POSITIONS ONLY, is refused and was already measured against: a positions-only key conflates a squared set with
 * `Static Facing Out` and with both `Static MiniWaves` (`cells.ts`), which are four different formations, and the
 * player's board would be "in the goal" while facing the wrong way.
 */
export function reachedGoal(board: Board, goal: Board): boolean {
  return arrangementKey(board) === arrangementKey(goal);
}

/**
 * THE PUZZLE'S WAYPOINTS: the route's boards, with CONSECUTIVE EQUAL FORMATIONS COLLAPSED.
 *
 * A WAYPOINT IS A FORMATION, so a step that leaves the set in the arrangement it was already in has not reached
 * a new waypoint — it has done something else (turned the set, swapped the couples, pivoted). The route is a list
 * of CALLS' boards; the waypoints are the formations along it, and the two are not the same length UNLESS the route
 * was built for the count:
 *
 * MEASURED, and it is why the Daily's generator walks instead of searching: when the route came from a search for "a
 * board exactly three calls away", **16 of 24 level-1 routes repeated a formation in consecutive stages**, so the
 * waypoint count was **2..4** where the board count was 4 — the reported two-waypoint Daily. `generator.ts`'s
 * `walkDaily` now REFUSES a step that stays in its own arrangement, so a generated Daily's list is exactly the
 * level's ladder (`levels.ts`'s `dailyWaypointsFor`, 5..10) and this function has nothing left to collapse. It stays
 * because the collapse is the definition of a waypoint, not a workaround for a loose generator.
 *
 * CONSECUTIVE ONLY, DELIBERATELY. A route that RETURNS to an earlier formation (A → B → A) has three waypoints,
 * not two: the player must stand in the earlier arrangement again to have passed through it the second time, which
 * is what `waypointReached` asks for and what makes a round trip cost something. Collapsing by SET MEMBERSHIP would
 * quietly delete that requirement.
 *
 * THE START IS ALWAYS WAYPOINT 1, and this returns the boards themselves rather than keys or names: a caller wants
 * the picture to show. The keys are recomputable with `arrangementKey`, which is what progress is counted against.
 */
export function waypointBoards(path: readonly Board[]): Board[] {
  const out: Board[] = [];
  let last: string | null = null;
  for (const board of path) {
    const key = arrangementKey(board);
    if (key === last) continue;
    out.push(board);
    last = key;
  }
  return out;
}

/**
 * How many of `waypoints`, IN ORDER, the player has stood on.
 *
 * IN ORDER IS THE RULE, and it is what makes the sequence a sequence rather than a set: a route may revisit an
 * arrangement (MEASURED, 1 of 12 does), and a player who returns to waypoint 1 after reaching waypoint 2 has not
 * unmade the progress — they have wasted a call, which the allowance prices on its own.
 *
 * `reached[k]` is true when the board at some point equalled waypoint k, so this is a monotone count over the line
 * the player actually played. The line is the session's, so the count can be recomputed from `moves` at any time and
 * never needs storing.
 */
export function waypointReached(waypoints: readonly string[], keysPlayed: readonly string[]): number {
  let k = 0;
  for (const key of keysPlayed) {
    if (k < waypoints.length && key === waypoints[k]) k++;
  }
  return k;
}
