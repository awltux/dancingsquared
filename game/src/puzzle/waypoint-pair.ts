// THE WAYPOINT PAIR: which two boards the stage shows, and what their borders say.
//
// THE STAGE SHOWS THE CURRENT WAYPOINT AND THE NEXT ONE — "the setup and the next waypoint" — and both boards are
// stages of the SAME puzzle rather than a start and a goal. This module is the arithmetic of which two, and of the
// three states a border can report; it draws nothing and knows no mode.
//
// WHY IT IS A MODULE. The rule is asked from two places that must agree — the drawing and the captions — and it is
// the only part of the display that can be checked without a browser (AGENTS.md §4.3: a rule that lives only in a
// screen has no gate). The three states are a rule rather than a palette:
//
//   solved  the player has stood in this formation, in order — `i <= progress`
//   next    the one waypoint that can be reached from where the player is now — `i === progress + 1`
//   locked  beyond that, and it CANNOT be solved yet, because waypoints are reached in sequence
//
// THE SEQUENCE IS A READOUT, NOT A GATE (DESIGN.md §9.1): no call is refused and correctness is still the goal
// board. What the sequence does decide is which waypoint may read as solved — a later one cannot, because the
// player has not stood in the earlier formation yet.
//
// LIVE VERSUS PREVIEW is the one thing the indices alone cannot say. At the front (`cursor === null`) the left
// board is the PLAYER'S OWN BOARD rather than the waypoint's: the Daily lets a player leave the generated route,
// and hiding where they actually stand to show a waypoint they are not on would be the one thing this display
// must never do. Its border reads `solved` there whatever the indices say, because "you are here" is the state.

export type WaypointState = 'solved' | 'next' | 'locked';

export interface WaypointPair {
  /** The waypoint drawn on the left, and the one on the right. */
  leftIndex: number;
  rightIndex: number;
  left: WaypointState;
  right: WaypointState;
  /** Whether the pair may page further, which is false at each end of the sequence. */
  canPrev: boolean;
  canNext: boolean;
  /** True when the pair is the live one (the player's board and the next waypoint) rather than a preview. */
  live: boolean;
}

/** What the border of waypoint `index` says, given how many waypoints the player has reached IN ORDER. */
export function stageState(index: number, progress: number): WaypointState {
  if (index <= progress) return 'solved';
  if (index === progress + 1) return 'next';
  return 'locked';
}

/**
 * The pair to show.
 *
 * `count` is the number of waypoints the puzzle has (at least two — a start and an end), `progress` is how many
 * the player has reached in order (`waypointReached`), and `cursor` is the left index the player has paged to or
 * `null` to follow the front.
 *
 * THE FRONT IS CLAMPED TO `count - 2`, because a pair needs a right-hand board: once the last waypoint is reached
 * there is nothing after it, so the stage rests on the final two and both are solved. Everything here is clamped
 * rather than trusted, for the reason `block.ts` clamps its sets: a bad index must not be able to take the boards
 * off the screen.
 */
export function waypointPair(count: number, progress: number, cursor: number | null): WaypointPair {
  const last = Math.max(count - 1, 0);
  const maxLeft = Math.max(count - 2, 0);
  const reached = Math.min(Math.max(Math.floor(progress), 0), last);
  const front = Math.min(reached, maxLeft);
  const leftIndex = cursor === null ? front : Math.min(Math.max(Math.floor(cursor), 0), maxLeft);
  const rightIndex = Math.min(leftIndex + 1, last);
  const live = cursor === null;
  return {
    leftIndex,
    rightIndex,
    // THE LIVE LEFT BOARD IS WHERE THE PLAYER IS, so it is always 'solved': it is the arrangement they are standing
    // in, which is `front` by definition. Only a preview can show a left board that is not solved yet.
    left: live ? 'solved' : stageState(leftIndex, reached),
    right: stageState(rightIndex, reached),
    canPrev: leftIndex > 0,
    canNext: leftIndex < maxLeft,
    live,
  };
}
