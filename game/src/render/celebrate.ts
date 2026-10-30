// THE SUCCESS ANIMATION: what a waypoint's border does when the player REACHES it.
//
// REPORTED: "Add a success animation to a waypoint when a waypoint is solved. Currently, there is no feedback other
// than changing the outline colour. Also, it jumps to the next waypoint instantly, and this is confusing to the
// player." The second half is the stage's slide (a change of pair animates, including after a motion — see
// `GameStage.drawPair`); this module is the first half, and both of its rules are here rather than in
// `stage-view.ts` because THE TRANSITION THAT MEANS SUCCESS and THE CURVE the border flashes with are arithmetic a
// probe can drive with no scene graph, no renderer and no browser (AGENTS.md §4.3, §5).
//
// WHICH BORDER. A waypoint is reached when its state goes from `next` to `solved`, and that transition IS the
// success: `next` is the one waypoint the player can reach from where they are, so nothing else can turn green by
// being reached (`waypoint-pair.ts`). The stage therefore never needs to know what `progress` is; the pair's own
// states carry the fact, which is what keeps this rule in one place instead of being re-derived by the shell.
//
// TWO SHAPES OF IT, and the pair's indices tell them apart:
//
//   * an ADVANCE — the left index moves by one and the board that was on the right was `next` and is now `solved`;
//   * THE GOAL — both indices stay put (there is no pair past the last waypoint) and the right border turns green.
//
// WHAT IS NOT A SUCCESS, and this is the half that a careless rule gets wrong: PAGING. The edge zones walk the same
// boards, so an advance whose arriving left board was ALREADY `solved` is a player looking back or forward through a
// route they have earned, and paging forward from the live pair lands on `next` rather than `solved`. Neither may
// flash the border, or the animation would mean "you paged the route".
//
// THE CURVE IS ONE PULSE, NOT A STROBE. `pulse` is exact at both ends — `t = 0` and `t = 1` are the resting border —
// because a curve that leaves the border dimmer than it found it would make the solved state read weaker than the
// pending one. One pulse in `CELEBRATE_MS` is 1.9 flashes a second, under the three-per-second bound photosensitivity
// guidance sets, and it is ONE rather than several: the job is to mark a success, not to flicker at the player.

import type { WaypointState } from '../puzzle/waypoint-pair.ts';

/** How long a border pulses for. Long enough to be seen after a 320 ms slide ends, short enough not to nag. */
export const CELEBRATE_MS = 520;

/** The lowest the border's opacity multiplier goes at the peak of the pulse. */
export const CELEBRATE_FLOOR = 0.22;

/** How far the border is mixed towards white at the peak — the brightening is what carries the flash. */
export const CELEBRATE_WHITEN = 0.7;

/** How much the ring grows at the peak, as a multiplier. Small: it must not reach into the neighbouring board. */
export const CELEBRATE_GROW = 0.06;

/**
 * The four facts a pair reports about its borders, which is all either rule below needs.
 *
 * IT IS A SUBSET, DELIBERATELY: `WaypointPair` satisfies it, and so does a `StagePair` by reading its
 * `leftState`/`rightState` — so the rule is shared by the caption side and the drawing side without either one owning
 * a copy of the other's type.
 */
export interface BorderReading {
  readonly leftIndex: number;
  readonly rightIndex: number;
  readonly left: WaypointState;
  readonly right: WaypointState;
}

/**
 * Which border just became solved, given the pair drawn before this one — `'left'` or `'right'` for the BOARD (not
 * the screen slot), and null when nothing was reached.
 *
 * `null` ALSO MEANS "NO PREVIOUS PAIR": the first pair of a puzzle is a paint, not a success, and the stage passes
 * null for exactly that case.
 */
export function justSolved(previous: BorderReading | null, next: BorderReading): 'left' | 'right' | null {
  if (!previous) return null;
  const samePair = previous.leftIndex === next.leftIndex && previous.rightIndex === next.rightIndex;
  if (samePair) {
    // THE GOAL: the pair cannot advance past the last waypoint, so the last success shows up as the right border
    // turning green while both indices stay where they are.
    return previous.right !== 'solved' && next.right === 'solved' ? 'right' : null;
  }
  // AN ADVANCE, and only the board that was PENDING can be the one that succeeded: `next` is the one waypoint the
  // player can reach, so a board arriving as `solved` was that board. The direction test is what excludes paging
  // BACK — where the arriving left board is solved because the player has already stood there — and the state test is
  // what excludes paging forward, where the arriving board is a preview and reads `next`.
  if (next.leftIndex > previous.leftIndex) {
    return previous.right !== 'solved' && next.left === 'solved' ? 'left' : null;
  }
  return null;
}

/** A border's look at one instant of the pulse: an opacity multiplier, a mix towards white, and a size multiplier. */
export interface Pulse {
  /** Multiplier on the border's resting opacity, so 1 at both ends of the curve and `CELEBRATE_FLOOR` at the peak. */
  readonly opacity: number;
  /** How far the border's colour is mixed towards white, 0 at both ends. */
  readonly whiten: number;
  /** The ring's size multiplier in the floor plane, 1 at both ends. */
  readonly scale: number;
}

/** The pulse at fraction `t` of `CELEBRATE_MS`, clamped outside `[0, 1]`. */
export function pulse(t: number): Pulse {
  const clamped = Math.min(Math.max(t, 0), 1);
  // ONE half-sine over the interval: zero at both ends and one at the middle, so the border leaves and returns to
  // exactly the look it had. `Math.sin` is what makes both ends exact — a ramp such as `1 - t` would be brightest at
  // the start and would leave the border dimmer than the state it is celebrating.
  const bump = Math.sin(Math.PI * clamped);
  return {
    opacity: 1 - (1 - CELEBRATE_FLOOR) * bump,
    whiten: CELEBRATE_WHITEN * bump,
    scale: 1 + CELEBRATE_GROW * bump,
  };
}
