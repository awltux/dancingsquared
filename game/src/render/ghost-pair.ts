// THE GHOST LAYER'S PAIRING RULE: WHICH DANCER ON THE TARGET BOARD IS WHICH DANCER HERE.
//
// WHY IT EXISTS. A narrow viewport can only afford one board at full size (see `ui/layout.ts`), but a waypoint pair is a
// COMPARISON — where you stand, and where you have to be — so hiding one board costs the player the very thing the game
// teaches unless the missing picture is still on the floor. The ghost layer draws the other board's dancers as dim
// markers on the focused board, and this module decides WHERE each one goes. REPORTED, before it: "The two boards are
// awkward due to screen realestate. Is there a way that only one board is shown at a time but it's obvious how to
// navigate between them."
//
// THE PAIRING IS BY DANCER IDENTITY (`SeqDancer.id`), NOT BY INDEX OR POSITION. A call moves people around the floor, so
// the third dancer in the array is not the third dancer in the picture: index-pairing would draw one dancer's target on
// another dancer's body, and it would look plausible while being wrong — the worst kind of wrong for a teaching aid. The
// engine carries an id through every apply (that is what `sameBoardById` and `reorderLike` are for), so the identity is
// there to use. THE FALLBACK IS THE INDEX, and only when the two boards have the SAME COUNT: a board rebuilt by hand (a
// probe, a corpus formation that never went through a call) may not carry matching ids, and refusing to draw anything
// would be a worse outcome than drawing the honest reading of the array order. A COUNT MISMATCH IS ONLY FATAL WHEN THE
// IDS CANNOT PAIR: a six-dancer board against the eight it came from pairs the six by identity and is drawn — MEASURED,
// that is the shape a half-set fixture has — while two boards that share no ids and differ in count have no honest
// pairing at all and the module returns `null`, which is the same absence a refusal is.
//
// `moved` IS PART OF THE ANSWER, because the ghost layer's job is to say WHAT CHANGES. MEASURED against the drawing: a
// dancer's flat marker is about 1.2 board units wide, so a 0.05-unit offset is 4 % of the marker — invisible at any
// size — and a heading difference under 0.02 rad (1.1 degrees) cannot be seen on a rectangle either. A ghost inside
// those tolerances would be a second copy of the dancer sitting exactly under the first, so the renderer draws it much
// fainter than a ghost that marks a move; the flag is what lets it, and the threshold is stated here rather than in the
// renderer.
//
// NO DOM, NO `three`, NO CLOCK: this is arithmetic over two boards, so `game/test/ghost-pair-probe.mjs` can drive it.

import type { Board } from 'dancing-squared-engine';
// THE ENGINE'S NORMALISER, not a local `atan2(sin, cos)`: it is a DIFFERENT rule at the -PI seam (that spelling
// returns -PI where `normAngle` keeps +PI), and `engine/test/angle-normalisation.mjs` §4b is the census that would
// otherwise read this file as a second copy. The game imports engine VALUES where a pure rule needs one.
import { normAngle } from 'dancing-squared-engine';

/** A point on the floor the focused board's dancer has to reach, and whether it is anywhere new. */
export interface GhostPose {
  /** The index in the FOCUSED board whose dancer this ghost belongs to. */
  dancerIndex: number;
  /** Where that dancer stands on the OTHER board. */
  pose: { x: number; y: number; heading: number };
  /** False when the other board puts this dancer where they already are, by the tolerances in the header. */
  moved: boolean;
}

/** Below these, a ghost cannot be told from the dancer underneath it. See the header's measurement. */
export const GHOST_POSITION_EPS = 0.05;
export const GHOST_HEADING_EPS = 0.02;

/** The shortest way round from one heading to another, in radians. */
const headingDelta = (a: number, b: number): number => Math.abs(normAngle(b - a));

/**
 * One ghost per dancer of `focused`, taken from `other`, or `null` when the two cannot be paired honestly.
 *
 * The order of the result is the FOCUSED board's order, so a caller may index it by dancer and a probe may assert it.
 */
export function ghostPoses(focused: Board, other: Board): GhostPose[] | null {
  const sameCount = focused.dancers.length === other.dancers.length;
  const byId = new Map<number, number>();
  other.dancers.forEach((dancer, index) => {
    if (!byId.has(dancer.id)) byId.set(dancer.id, index);
  });
  const out: GhostPose[] = [];
  for (let i = 0; i < focused.dancers.length; i++) {
    const mine = focused.dancers[i];
    const at = byId.get(mine.id);
    const index = at !== undefined ? at : sameCount ? i : -1;
    const source = index === -1 ? undefined : other.dancers[index];
    if (!source) return null;
    const distance = Math.hypot(source.x - mine.x, source.y - mine.y);
    out.push({
      dancerIndex: i,
      pose: { x: source.x, y: source.y, heading: source.heading },
      moved: distance > GHOST_POSITION_EPS || headingDelta(mine.heading, source.heading) > GHOST_HEADING_EPS,
    });
  }
  return out;
}
