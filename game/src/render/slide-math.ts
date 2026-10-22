// THE SLIDE, as arithmetic: where the three board slots are at `t` of the way through a change of waypoint pair.
//
// WHY IT IS A MODULE AND NOT FOUR LINES IN THE STAGE. The transition is the one part of the display that is a
// NUMERICAL claim — "the pair moves one slot left, and the incoming board arrives from the right" — and a claim like
// that is worth a probe rather than a screenshot. It imports nothing, so `game/test/slide-probe.mjs` loads it under
// node's type stripping and measures the endpoints, the direction and the monotonicity.
//
// THE THREE SLOTS ARE THE THREE BOARD VIEWS: the left board leaves, the right board takes the left slot, and the
// incoming board arrives where the right one was. At `t = 1` the incoming board is EXACTLY in the right slot, so the
// commit can swap the roles without moving anything and the picture does not jump.

export interface SlideOffsets {
  /** Where the board that is leaving sits. */
  left: number;
  /** Where the board that is moving into the left slot sits. */
  right: number;
  /** Where the arriving board sits. */
  incoming: number;
}

/**
 * Ease-in-out over [0, 1], so the pair does not start and stop dead.
 *
 * THE HALF-WAY POINT IS EXACT, and the endpoints are exact, which is what lets the commit drop the animation at
 * `t = 1` without a visible step: `ease(0.5) === 0.5` keeps the three slots evenly spaced at the midpoint.
 */
export function ease(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - 2 * (1 - clamped) * (1 - clamped);
}

/**
 * The three slots at `t`, given the resting distance `centre` of a board from the middle of the canvas.
 *
 * THE DIRECTION IS THE PLAYER'S, and getting it wrong is the defect this parameter exists for: both buttons used to
 * move the pair LEFT, so paging back to an earlier waypoint slid the boards the wrong way — reported as "the left
 * button should slide the boards to the right, but it currently slides the boards to the left". Going FORWARD is a
 * step left (the route reads left to right, so the pair advances by moving left), and going BACK is its mirror.
 *
 * AT REST the slots are `-centre`, `+centre` and `+3·centre`: the two boards on screen, and the arriving one waiting
 * off to the right. `direction = 1` (forward) carries them one slot LEFT — `-3·centre`, `-centre`, `+centre` — and
 * `direction = -1` (back) carries them one slot RIGHT, with the arriving board waiting off to the LEFT instead, at
 * `-3·centre`. Either way it is a translation of three fixed positions rather than a redraw, and either way the
 * arriving board ends exactly in a resting slot.
 */
export function slideOffsets(t: number, centre: number, direction: 1 | -1 = 1): SlideOffsets {
  const step = 2 * centre * ease(t);
  return direction === 1
    ? { left: -centre - step, right: centre - step, incoming: 3 * centre - step }
    : { left: -centre + step, right: centre + step, incoming: -3 * centre + step };
}
