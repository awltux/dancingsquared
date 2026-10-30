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
// LIVE VERSUS PREVIEW is the one thing the indices alone cannot say. At the front (`cursor === null`) the pair is the
// question being asked NOW, and `left` reads `solved` there whatever the indices say — because the player has stood in
// that waypoint's arrangement, which is what makes it the "Now" board.
//
// THE LEFT BOARD IS THE WAYPOINT, NOT THE PLAYER'S OWN POSE. It used to be the player's board at the front, on the theory
// that hiding where they actually stand would be a lie; the report below is the counter-example, and the caption is why:
// over that slot the app prints "<n>: <name>" for the WAYPOINT, so a wrong-but-legal call that moved the set left the
// call's own landing drawn under a caption naming a different arrangement. `pairLeftBoard` is the one place the choice is
// made.
import type { Board } from 'dancing-squared-engine';

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
 * THE PAIR THE PLAYER IS SOLVING FROM — the last completed waypoint and the next one — which is what the Now/Target
 * switches scrub back to before they flip.
 *
 * REPORTED: "The [Now, Target] widget currently applies to the currently displayed board which might not be the one to be
 * solved, but I want them to first scrub to the last completed (green) board the subsequent uncompleted board. The
 * 'Now|Target' buttons will flip between the point where the player is supposed to be solving." So the pair the widget
 * acts on is not whichever preview the arrows left on screen: it is this one.
 *
 * IT CLEARS THE CURSOR AND THE HOLD, and the HOLD is the part that is easy to miss. After a success the window is held so
 * the right-hand board does not auto-skip (see `waypointPair`), which leaves the pair showing the waypoint JUST REACHED on
 * the right — two solved boards, not the one to solve next. Scrubbing past the hold is what makes "Target" mean the
 * uncompleted board rather than the one the player has just finished; `game/test/waypoint-pair-probe.mjs` pins both the
 * pair and that difference, because "it looks live" is true of both.
 */
export function solvingPair(count: number, progress: number): WaypointPair {
  return waypointPair(count, progress, null, null);
}

/**
 * The pair to show.
 *
 * `count` is the number of waypoints the puzzle has (at least two — a start and an end), `progress` is how many
 * the player has reached in order (`waypointReached`), and `cursor` is the left index the player has paged to or
 * `null` to follow the front.
 *
 * `hold` IS THE FRONT WHILE THE PAIR IS LIVE, and it is what stops a SUCCESS from moving the window. REPORTED: "when
 * the player selects the correct call, the animation correctly plays in the left hand, but the right hand immediately
 * auto-skips to the next board … Moving to the next waypoint should be left to the player by pressing the navigation
 * buttons." Without it the front is `min(progress, count - 2)`, so reaching a waypoint advances the window the instant
 * the call lands: the right-hand board the player was aiming at is replaced by the one after it, in the middle of the
 * animation they were watching. With it the window stays where it was — left, the player's own board, right, the
 * waypoint they just reached — and the arrow is the way on. `null` follows the front, which is the state before the
 * first success and after any page or undo.
 *
 * THE FRONT IS CLAMPED TO `count - 2`, because a pair needs a right-hand board: once the last waypoint is reached
 * there is nothing after it, so the stage rests on the final two and both are solved. Everything here is clamped
 * rather than trusted, for the reason `block.ts` clamps its sets: a bad index must not be able to take the boards
 * off the screen.
 */
export function waypointPair(count: number, progress: number, cursor: number | null, hold: number | null = null): WaypointPair {
  const last = Math.max(count - 1, 0);
  const maxLeft = Math.max(count - 2, 0);
  const reached = Math.min(Math.max(Math.floor(progress), 0), last);
  const followed = Math.min(reached, maxLeft);
  const front = hold === null ? followed : Math.min(Math.max(Math.floor(hold), 0), maxLeft);
  const leftIndex = cursor === null ? front : Math.min(Math.max(Math.floor(cursor), 0), maxLeft);
  const rightIndex = Math.min(leftIndex + 1, last);
  const live = cursor === null;
  return {
    leftIndex,
    rightIndex,
    // THE LIVE LEFT BOARD IS THE WAYPOINT THE PLAYER IS SOLVING FROM, so it is 'solved': they have stood in that
    // arrangement — that is what progress counted. Only a preview can show a left board that is not solved yet.
    left: live ? 'solved' : stageState(leftIndex, reached),
    right: stageState(rightIndex, reached),
    canPrev: leftIndex > 0,
    canNext: leftIndex < maxLeft,
    live,
  };
}

/**
 * WHICH BOARD THE LEFT SLOT SHOWS: THE WAYPOINT, and the caller's own board only when the list has no such index.
 *
 * REPORTED: "Drill and Daily: After attempting an incorrect call and the two-second pause, reset the board to the 'Now'
 * setup. Currently it seem to leave the end of the incorrect call in place." MEASURED on the Drill first, because it is
 * the mode with the two-second hold: a wrong-but-legal answer played its motion (~4 s), held the landing for
 * `LANDING_HOLD_MS`, and the shell then cleared it — the instrument read `ends=1 draw=pair` and the board afterwards was
 * the question's own. So the DRILL already does it. THE DAILY DID NOT, and this function is why: its live left slot was
 * the PLAYER'S OWN board (`DailyRun.view().board`), so a wrong-but-legal call — which the Daily applies, because every
 * reading it offers is legal — left the call's landing drawn in the slot whose caption reads "Now: <waypoint>". The
 * picture and the words described two different arrangements.
 *
 * THE LANDING IS STILL SHOWN: `stage.drawMotion` samples the engine's walk, and the hold keeps its last frame for
 * two seconds, so the player always sees where the call left the set. What changes is the RESTING pair — the state the
 * reset returns to — which is the two waypoints the captions name.
 *
 * `own` IS THE FALLBACK RATHER THAN A CASE: a preview or a live pair whose index the list has not got must still draw
 * something, and the player's own board is the only board in hand. A probe drives all three.
 */
export function pairLeftBoard(pair: WaypointPair, boards: readonly Board[], own: Board): Board {
  return boards[pair.leftIndex] ?? own;
}
