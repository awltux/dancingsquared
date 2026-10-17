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
