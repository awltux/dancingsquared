// THE DAILY'S WAYPOINTS: the arrangements a route passes through, as things a player can be ON rather than calls.
//
// WHY WAYPOINTS AND NOT A CALL SEQUENCE. MEASURED on a full enumeration of a Daily at pool 20 (DESIGN.md §9.1): 192
// readings leave the start, 2 546 477 distinct three-call lines exist, and exactly ONE of them reaches the goal — so
// "the line" is not something a player can be warned about usefully, and "did you repeat a call" is worse: many
// different calls land on the same board, so a repeat is neither necessary nor sufficient for a loop.
//
// THE EQUALITY IS THE ENGINE'S CONGRUENCE TEST at this game's tolerance (`sameArrangement` -> `congruentWithin` in
// `engine/src/sequencer/cells.ts`): positions AND headings, quotiented by the eight rotations and both reflections, and
// compared WITH A TOLERANCE rather than by a quantised key. So two DIFFERENT calls that leave the set in the same
// arrangement satisfy the same waypoint, which is exactly the robustness the call-name approach lacked — and a board that
// is the arrangement to within the drift two call paths produce counts, which a key could refuse. MEASURED, 11 of 12
// generated routes visit a NEW arrangement at every stage, and all 12 end in an arrangement different from the start.
//
// THE RECOGNISER'S NAME IS A CAPTION, NEVER THE TEST. MEASURED, the same route names as "Static Square → (unnamed) →
// Static Square → Static Square": the names are rotation-invariant, so they cannot tell the stages apart. The relation can.
import { congruentWithin, type Board } from 'dancing-squared-engine';

/**
 * HOW CLOSE two boards must be to count as the same arrangement — the game's policy over the ENGINE's mechanism
 * (`congruentWithin`, `engine/src/sequencer/cells.ts`), and the number is measured on both sides.
 *
 * WHY A TOLERANCE AND NOT A KEY. A quantised key used to be the test, and it is a BUCKET: positions and headings
 * rounded to `CELL_ROUND`. Two call paths that land on the same formation drift by a few hundredths (each is re-based
 * through its own authored path), so a board that IS the goal's arrangement can key into an adjacent cell and be told it
 * is not the goal. REPORTED: "The game offered 'Circle Right 1/2 Home' from 'Circle' to 'Square Set' and reports
 * '… does not leave the set on the goal board.' but to me it looks as if it does end on 'squared set'." MEASURED over
 * the 108 baked drills: 10 distractors were the goal's formation within 0.06 units and 0.06 rad, the reported one at
 * 0.0364 units and 0.0195 rad (0.046 in this metric) — all keyed apart.
 *
 * SO THE NUMBER IS BOUNDED FROM BOTH SIDES, and both bounds are gates:
 *   - ABOVE the drift that must be absorbed: 0.077 is the worst such case over the baked season (one dancer 0.069 off
 *     plus 0.015 rad), measured by `goal-arrangement-probe.mjs`'s census — 0.1 clears it.
 *   - BELOW half the closest two DISTINCT arrangements in the corpus: `engine/test/congruence.mjs` MEASURES that
 *     separation at 0.5892 over the corpus's 134 distinct arrangements, so anything under 0.2946 cannot merge two
 *     formations — 0.1 clears it with a factor of nearly three.
 * The metric is the engine's `maxDancerError`: `distance + 0.5 * angular difference`, so a pure facing difference costs
 * half a unit per radian — 1.57 rad (a quarter turn) is 0.79, comfortably refused.
 *
 * WHY NOT JUST WIDEN `CELL_ROUND`: it is a KEY. Formation, arrangement and setup ids are persisted (and permission
 * rules name them), so moving the lattice would move every id in the corpus — and it would still be a bucket, which is
 * the wrong shape of answer for "is the set in the arrangement the puzzle asked for".
 */
export const ARRANGEMENT_TOL = 0.1;

/**
 * Whether the two boards are the same arrangement — the ENGINE's congruence test at this game's tolerance.
 *
 * A WAYPOINT IS AN ARRANGEMENT, NOT A POSE: the player is "on" waypoint k when their board's arrangement equals it,
 * whatever rotation or reflection they arrived by, and to within the drift two call paths produce. That is the same
 * quotient `matchFormations` uses, so the game and the engine agree about what counts as the same arrangement.
 */
export function sameArrangement(a: Board, b: Board): boolean {
  return congruentWithin(a, b, ARRANGEMENT_TOL);
}

/**
 * Whether `board` has REACHED `goal` — the same equivalence a waypoint uses, and not a stricter one.
 *
 * REPORTED: "Each Waypoint might have multiple solutions. A waypoint has been passed when the dancers are in the setup
 * described by the waypoint, regardless of what calls were used to get there. I have managed to get the dancers in the
 * position of the waypoint, but the game has refused it as a solution. I can only assume it is also expecting a
 * specific move." THE ASSUMPTION WAS RIGHT, and the inconsistency was here: the waypoint tick asked the arrangement
 * key's equivalence (the eight rotations and the reflection) while the GOAL asked `sameBoardById`, which is identity. So a
 * player who reached the goal's ARRANGEMENT rotated or reflected was told the set was not on the goal board, and the
 * only way to satisfy the game was to find the one call that landed the identical board. MEASURED over 40 generated
 * level-1 Dailies (all one step): 9 of the 40 offer a call from the start whose board is congruent to the goal but not
 * identical to it, so nearly a quarter of the puzzles at that level had a solution the game refused.
 *
 * AND THE SAME TEST WAS STILL TOO SHARP AT ITS OWN SEAM, which is the second report: the key it used quantises, so a
 * board the MATCHER would call congruent could key apart and be refused. Hence `sameArrangement`, which is the engine's
 * tolerance test — the reasons and the two measured bounds are on `ARRANGEMENT_TOL` above.
 *
 * WHY CONGRUENCE IS THE RIGHT TEST AND IDENTITY IS NOT. The engine's own matcher quotients by exactly these eight
 * symmetries when it asks whether a board is a formation (`cells.ts`), so a rotated squared set IS the formation the
 * goal names — and a puzzle whose own waypoints are judged that way cannot then demand more of its last one. The
 * alternative, loosening further to POSITIONS ONLY, is refused and was already measured against: a positions-only key
 * conflates a squared set with `Static Facing Out` and with both `Static MiniWaves`, which are four different
 * formations, and the player's board would be "in the goal" while facing the wrong way.
 */
export function reachedGoal(board: Board, goal: Board): boolean {
  return sameArrangement(board, goal);
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
 * the picture to show. Progress is counted against the same boards with `sameArrangement`, so nothing here depends on a
 * key that quantises.
 *
 * THE LAST WAYPOINT IS THE ROUTE'S LAST BOARD, whichever board the collapse would have kept. A run of boards that share
 * an arrangement keeps its FIRST board for every waypoint but the last — the collapse is about "a call that stayed in its
 * arrangement is not a new waypoint", not about which POSE to draw. The final waypoint is the picture the player is
 * working towards, so it has to be the board the route actually ends on, in its own orientation. REPORTED: "The game
 * offers a drill of 'Circle Right 1/2' starting from 'Circle' to 'Circle' … but the target setup is displayed in its
 * default orientation … it doesn't look like the final setup." MEASURED on the shipped bake: 2 of 108 puzzles had a
 * trailing run, and for both the pair's right-hand slot showed a board one stage early (0.083 and 0.001 from the landing);
 * a one-board list degenerates completely, because `waypointPair(1, …)` puts waypoint 0 in BOTH slots, so the target
 * became the START board.
 *
 * The count is unchanged, and `waypointReached` compares arrangements, so progress and the win test are untouched: the
 * board substituted here is in the same arrangement as the one it replaces.
 */
export function waypointBoards(path: readonly Board[]): Board[] {
  const out: Board[] = [];
  for (const board of path) {
    const last = out[out.length - 1];
    if (last && sameArrangement(last, board)) continue;
    out.push(board);
  }
  const landing = path[path.length - 1];
  if (landing && out[out.length - 1] !== landing) out[out.length - 1] = landing;
  return out;
}

/**
 * How many of `waypoints`, IN ORDER, the player has stood on.
 *
 * IN ORDER IS THE RULE, and it is what makes the sequence a sequence rather than a set: a route may revisit an
 * arrangement (MEASURED, 1 of 12 does), and a player who returns to waypoint 1 after reaching waypoint 2 has not
 * unmade the progress — they have wasted a call, which the allowance prices on its own.
 *
 * A WAYPOINT IS REACHED WHEN THE BOARD IS IN ITS ARRANGEMENT (`sameArrangement`, the engine's congruence at this
 * game's tolerance) — not when it is the identical pose, and not when it merely shares a quantised key. The count is
 * monotone over the line the player actually played, so it is recomputable from the moves at any time and never needs
 * storing.
 */
export function waypointReached(waypoints: readonly Board[], boards: readonly Board[]): number {
  let k = 0;
  for (const board of boards) {
    if (k < waypoints.length && sameArrangement(board, waypoints[k])) k++;
  }
  return k;
}
