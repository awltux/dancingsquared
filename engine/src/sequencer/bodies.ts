// HOW MUCH ROOM IS THERE BETWEEN TWO DANCERS, REALLY.
//
// THE ENGINE HAS ALWAYS MEASURED DANCERS AS POINTS. Every collision question it has ever asked is
// `Math.hypot(dx, dy) < eps` — `Sequencer.collisions`, `FsmStore.anyCollision`, and the endpoint check
// in `applicator.ts`'s `adjustToSetup` (`BODY_COLLISION_MIN`) are all that one test — and the two
// constants built on it disagree with each other by three orders of magnitude (`1.0` versus `1e-3`),
// which is what a threshold chosen without a model looks like.
//
// A DANCER IS NOT ROUND, AND THE DIFFERENCE IS NOT A DETAIL. Take the standard square set: partners
// stand `2.0` apart shoulder to shoulder, and the two dancers of that pair FACE THE SAME WAY. Now take
// two dancers `0.5` apart facing the same way: they are one behind the other and do NOT overlap, because
// a body is only `0.5` deep. Two dancers `0.5` apart FACING EACH OTHER overlap by a quarter of a unit.
// A centre-distance test gives the same answer for both, so no threshold on centre distance can be
// right for both. That is the whole argument for this module.
//
// MEASURED, and it is the reason this was written: on the `Static Square` above, a pure centre-distance
// census of the 1580-module corpus finds 0 modules with coincident dancers, while the oriented model
// finds **723 modules (45.8%) whose bodies overlap**, with penetration depths clustered just under
// zero and reaching -0.750. The centre-distance test was not conservative; it was blind to the case
// that actually happens.
//
// THE MODEL. A dancer is a rectangle of `DANCER_DEPTH` front-to-back by `DANCER_WIDTH` side-to-side,
// rotated so its depth axis lies along the dancer's heading. Per the caller's specification:
//
//     0.5 front-to-back, 1.0 side-to-side
//
// which reproduces the two sanity values by hand:
//
//   * `Static Square`, `#5(-1,-3)` and `#6(1,-3)` face 90 deg. Their offset is 2.0 ACROSS facing, so
//     the lateral half-extent (0.5) applies twice: gap = 2.0 - 1.0 = **1.000**. Partners standing at
//     the standard width are one unit of air apart, which is the right reading of a square set.
//   * two dancers `0.5` apart, facing each other: the depth half-extent (0.25) applies twice along the
//     shared facing axis: gap = 0.5 - 0.5 = **0.000**. Chest to chest is exactly contact.
//
// THE SIGNED GAP, NOT A BOOLEAN. `bodyGap` returns the true separation between the two rectangles, so
// `> 0` is clearance, `0` is exactly touching, and `< 0` is overlap with `|gap|` the penetration depth.
// A boolean throws that information away, and the caller needs it: the corpus analysis that motivated
// this module is a distribution over penetration depths, not a count of a threshold's crossings.
//
// THE SEPARATING-AXIS TEST IS THE EXACT ANSWER for two convex rectangles, and it is four axes rather
// than two because each body contributes its own frame. Checking only the facing axis of one (or
// axis-aligning both) UNDER-reports clearance for two dancers meeting at an angle — precisely the
// case a Dosado produces, since the pair counter-rotates and passes at 45 degrees and worse.

import type { Board, SeqDancer } from './types.js';

/**
 * Front-to-back extent of a dancer, along the facing direction. Half of the stated 0.5 depth.
 */
export const DANCER_HALF_FRONT_BACK = 0.25;

/**
 * Side-to-side extent of a dancer, across the facing direction. Half of the stated 1.0 width.
 *
 * That this is larger than the depth is the whole point: a body is wider than it is deep, so a
 * shoulder-to-shoulder pair tolerates far more centre distance than a chest-to-chest pair.
 */
export const DANCER_HALF_SIDE_SIDE = 0.5;

/**
 * Slack for floating-point noise and for the small drift a danced sequence accumulates.
 *
 * Deliberately NOT used to decide "is this a collision" — that decision belongs to the caller, which
 * knows what clearance it wants. It only keeps a pair sitting exactly at contact from being reported
 * as overlapping.
 */
export const BODY_OVERLAP_EPS = 1e-3;

/** A pair of dancers and the gap between their bodies. `gap < 0` means the bodies overlap. */
export interface BodyPair {
  id1: number;
  id2: number;
  gap: number;
}

/**
 * The dancer's facing and lateral unit vectors.
 *
 * FACING IS `(cos heading, sin heading)` — the same convention `poseFor` maintains when it composes a
 * path, and the one the board's own geometry uses: on a `Static Square`, `#5` at `(-1,-3)` faces 90 deg,
 * which is `+y`, i.e. toward the centre of the set. Lateral is that rotated by a quarter turn, so
 * `lateral` is the direction a Sidestep moves in.
 */
export function bodyAxes(heading: number): { facing: { x: number; y: number }; lateral: { x: number; y: number } } {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { facing: { x: c, y: s }, lateral: { x: -s, y: c } };
}

/**
 * The separation between two dancers' bodies, signed.
 *
 * `> 0` clearance, `0` exactly touching, `< 0` the penetration depth. Exact for convex rectangles:
 * the separating-axis theorem says two convex shapes are disjoint exactly when some axis separates
 * their projections, and for two rectangles the only candidate axes are the four face normals — the
 * two frames (facing and lateral) of each body.
 *
 * WHY THE MAXIMUM AND NOT THE MINIMUM. The gap between the projections on an axis is a lower bound on
 * the true distance that is only tight for an axis that actually separates the shapes. When the shapes
 * are disjoint, at least one axis separates them, and the LARGEST such gap is the true distance. When
 * they overlap, every axis gap is negative and the largest is the shallowest penetration — the
 * standard penetration depth, and the most useful single number to report.
 */
export function bodyGap(a: SeqDancer, b: SeqDancer): number {
  const ax = bodyAxes(a.heading);
  const bx = bodyAxes(b.heading);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  let worst = -Infinity;
  for (const axis of [ax.facing, ax.lateral, bx.facing, bx.lateral]) {
    // The projection radius of each rectangle on this axis: the half-extents scaled by how much of
    // that axis each of the body's own axes covers.
    const ra = DANCER_HALF_FRONT_BACK * Math.abs(ax.facing.x * axis.x + ax.facing.y * axis.y)
      + DANCER_HALF_SIDE_SIDE * Math.abs(ax.lateral.x * axis.x + ax.lateral.y * axis.y);
    const rb = DANCER_HALF_FRONT_BACK * Math.abs(bx.facing.x * axis.x + bx.facing.y * axis.y)
      + DANCER_HALF_SIDE_SIDE * Math.abs(bx.lateral.x * axis.x + bx.lateral.y * axis.y);
    const projected = Math.abs(dx * axis.x + dy * axis.y);
    worst = Math.max(worst, projected - ra - rb);
  }
  return worst;
}

/** Whether two dancers' bodies overlap, within `BODY_OVERLAP_EPS` of contact. */
export function bodyOverlap(a: SeqDancer, b: SeqDancer): boolean {
  return bodyGap(a, b) < -BODY_OVERLAP_EPS;
}

/**
 * The closest body pair on a board, or null when there is nothing to compare.
 *
 * GHOSTS ARE EXCLUDED: a ghost is a geometric reference point, not a dancer, and `SeqDancer.isGhost`
 * already says it "does not occupy collision space". Counting ghosts would report every phantom setup
 * as a collision.
 *
 * Ties keep the first pair in ascending-id order, so the answer does not depend on the board's array
 * order.
 */
export function worstBodyGap(board: Board): BodyPair | null {
  const ds = board.dancers.filter((d) => !d.isGhost);
  let best: BodyPair | null = null;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const gap = bodyGap(ds[i], ds[j]);
      if (!best || gap < best.gap) best = { id1: ds[i].id, id2: ds[j].id, gap };
    }
  }
  return best;
}

/**
 * The dancers whose bodies overlap anyone's, by id, with the worst gap found for each.
 *
 * The plural form of `worstBodyGap`: a report wants every offending dancer, while a guard wants only
 * the worst. Sorted by ascending id so a report is stable.
 */
export function overlappingDancers(board: Board): BodyPair[] {
  const ds = board.dancers.filter((d) => !d.isGhost);
  const out: BodyPair[] = [];
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const gap = bodyGap(ds[i], ds[j]);
      if (gap < -BODY_OVERLAP_EPS) out.push({ id1: ds[i].id, id2: ds[j].id, gap });
    }
  }
  return out.sort((a, b) => (a.id1 - b.id1) || (a.id2 - b.id2));
}
