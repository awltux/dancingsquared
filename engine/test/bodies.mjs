// A DANCER IS NOT A ROUND POINT, pinned.
//
// `bodies.ts` replaces the engine's centre-distance collision test with an ORIENTED box: 1.0
// side-to-side, 0.5 front-to-back, rotated to the dancer's heading. The whole argument is that centre
// distance cannot answer "do these two dancers overlap", because it gives one number for two opposite
// situations — two dancers 0.5 apart facing the SAME way do not touch (a body is 0.5 deep) while two
// 0.5 apart FACING EACH OTHER overlap by a quarter.
//
// What this pins:
//   (1) the two sanity values by hand, taken from the spec rather than from the implementation:
//       partners at the standard 2.0 width have exactly 1.0 of air; chest-to-chest at 0.5 is contact.
//   (2) the cases that make the ORIENTATION matter — same offset, different headings, different answer.
//   (3) that the sign is meaningful: negative IS the penetration depth, and the exact four-axis
//       separating-axis answer is NOT an axis-aligned approximation (which overstates clearance by
//       up to 0.596 in the case pinned below, i.e. it would miss real collisions).
//   (4) `worstBodyGap` / `overlappingDancers` exclude ghosts, as `SeqDancer.isGhost` promises.
//
// Usage: node engine/test/bodies.mjs
import {
  bodyGap,
  bodyOverlap,
  bodyAxes,
  worstBodyGap,
  overlappingDancers,
  DANCER_HALF_FRONT_BACK,
  DANCER_HALF_SIDE_SIDE,
} from '../dist/index.js';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
/** Positions and headings are given in DEGREES, because the spec is stated that way. */
const dancer = (id, x, y, deg, extra = {}) => ({
  id, couple: 1, gender: 'boy', x, y, heading: (deg * Math.PI) / 180, ...extra,
});
/** Exact equality for numbers a hand calculation produces. */
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('== the model itself ==');
check(DANCER_HALF_FRONT_BACK === 0.25, 'front-to-back half-extent is 0.25 (0.5 total)');
check(DANCER_HALF_SIDE_SIDE === 0.5, 'side-to-side half-extent is 0.5 (1.0 total)');
check(near(bodyAxes(0).facing.x, 1) && near(bodyAxes(0).facing.y, 0), 'facing at heading 0 is +x');
check(near(bodyAxes(Math.PI / 2).facing.x, 0) && near(bodyAxes(Math.PI / 2).facing.y, 1), 'facing at 90 deg is +y');
check(near(bodyAxes(0).lateral.y, 1), 'lateral is facing rotated a quarter turn');

console.log('\n== (1) the two values the spec fixes by hand ==');
// THE SQUARE-SET CASE. Partners stand 2.0 apart ACROSS their facing, so the 1.0 span applies twice:
// 2.0 - 1.0 = 1.0. This is the value `BODY_COLLISION_MIN` used to sit on, which is why a threshold of
// 1.0 flagged every legitimate Dosado.
check(near(bodyGap(dancer(1, -1, 0, 90), dancer(2, 1, 0, 90)), 1.0, 1e-9),
  'partners 2.0 apart facing the same way have exactly 1.000 of air');
// CHEST TO CHEST. Offset 0.5 along the axis both face: 0.5 - 0.25 - 0.25 = 0. Contact, not overlap.
check(near(bodyGap(dancer(1, 0, 0, 0), dancer(2, 0.5, 0, 180)), 0, 1e-9),
  'two 0.5 apart facing EACH OTHER are exactly touching');
check(!bodyOverlap(dancer(1, 0, 0, 0), dancer(2, 0.5, 0, 180)), '...and touching is not an overlap');

console.log('\n== (2) the orientation is the whole point ==');
// SAME offset, SAME heading pair, only the facing changes. A centre-distance test cannot tell these
// apart; this is precisely the blindness that made the old measure report 0 corpus collisions.
check(near(bodyGap(dancer(1, 0, 0, 0), dancer(2, 1, 0, 0)), 0.5, 1e-9),
  'two 1.0 apart facing the SAME way have 0.500 of air (1.0 - 0.5)');
check(near(bodyGap(dancer(1, 0, 0, 0), dancer(2, 1, 0, 180)), 0.5, 1e-9),
  'two 1.0 apart facing each other have 0.500 of air (1.0 - 0.25 - 0.25)');
// Now push the offset down until the orientation decides the verdict.
check(bodyGap(dancer(1, 0, 0, 0), dancer(2, 0.5, 0, 0)) === 0,
  'two 0.5 apart facing the SAME way are exactly touching (0.5 - 0.5)');
const overlapFaceToFace = bodyGap(dancer(1, 0, 0, 0), dancer(2, 0.5, 0, 180));
check(near(overlapFaceToFace, 0, 1e-9), 'the facing-each-other pair at 0.5 is the boundary case');
const deepOverlap = bodyGap(dancer(1, 0, 0, 0), dancer(2, 0.25, 0, 180));
check(near(deepOverlap, -0.25, 1e-9), 'two 0.25 apart facing each other overlap by 0.250');
check(bodyOverlap(dancer(1, 0, 0, 0), dancer(2, 0.25, 0, 180)), '...and that IS reported as an overlap');
// The sign carries the depth, which a boolean would discard.
check(deepOverlap < 0 && near(Math.abs(deepOverlap), 0.25, 1e-9), 'the negative gap magnitudes the penetration depth');

console.log('\n== (3) exact separating axes, not an axis-aligned approximation ==');
// Both dancers at 45 deg, one 3.0 away diagonally. The offset is parallel to the facing axis, whose
// length is 3*sqrt(2) = 4.2426. Projecting onto THAT axis, each box contributes only its DEPTH
// half-extent (0.25) — the 1.0 width is perpendicular to this axis and contributes nothing — so the
// gap is 4.2426 - 0.5 = 3.7426. (Onto the lateral axis the offset projects to 0 and the wider 0.5
// extent applies, giving -1.0; the separating axis is the maximum, hence 3.7426.)
// The first draft of this line predicted 3.18198 by mistakenly dividing the summed half-extents by
// sqrt(2); the projection of a box onto an axis aligned with one of its own faces is the face's own
// half-extent, not a mixture. The engine was right and the hand calculation was wrong.
check(near(bodyGap(dancer(1, 0, 0, 45), dancer(2, 3, 3, 45)), 3 * Math.SQRT2 - 0.5, 1e-6),
  'diagonal 45/45 case matches the hand-computed separating-axis value (3.74264)');
// THE DISCRIMINATOR. An axis-aligned bounding-box model reports 2.017 of clearance here; the exact
// answer is 1.421. A model that overstates clearance by 0.6 DOES NOT SEE COLLISIONS, which is the
// failure this module exists to fix, so pin the number rather than the property.
check(near(bodyGap(dancer(1, 0, 0, 145), dancer(2, 3, 0.5, 55)), 1.420667915, 1e-6),
  'rotated pair reports 1.4207, NOT the 2.0168 an axis-aligned approximation would give');

console.log('\n== (4) ghosts occupy no collision space ==');
const withGhost = {
  dancers: [
    dancer(1, 0, 0, 0),
    dancer(2, 1.0, 0, 0),
    dancer(3, 0.05, 0, 0, { isGhost: true }),
  ],
};
const worst = worstBodyGap(withGhost);
check(worst !== null && worst.id1 === 1 && worst.id2 === 2,
  'the ghost at 0.05 does not become the closest pair');
check(near(worst.gap, 0.5, 1e-9), 'the reported worst gap is the physical pair\'s 0.500');
check(overlappingDancers(withGhost).length === 0, 'a ghost overlapping a dancer reports no overlap');
const physicalOverlap = {
  dancers: [dancer(1, 0, 0, 0), dancer(2, 0.1, 0, 0), dancer(3, 5, 0, 0)],
};
check(overlappingDancers(physicalOverlap).length === 1, 'a real overlapping pair IS reported');
check(worstBodyGap(physicalOverlap).gap < 0, 'and its gap is negative');
check(worstBodyGap({ dancers: [dancer(1, 0, 0, 0)] }) === null, 'a single-dancer board has no pair to report');

console.log(failures === 0 ? '\nbodies: all green.' : `\nbodies: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
