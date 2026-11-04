// THE "PLACE FORMATION" RULE: WHICH SPOT OF THE CHOSEN SHAPE EACH DANCER FINISHES ON, WHEN THE ARRANGEMENT IS NOT THE
// ONE THE SETUP PICKER CAN APPLY.
//
// WHY THIS EXISTS, next to the setup placement rather than beside it. The End setup picker's placement answers "which
// spot does dancer i own in this SETUP", and it derives that from the dancers' arrangement - the engine's
// `deriveFormationMapping` over the start poses, with the formation's declared genders preferred. That is the right
// question when the call finishes in the arrangement the formation was authored with, and the wrong one when the same
// SHAPE is reached in a different order. Reported as: "Rename the 'Place End' button to 'Place Setup'. Add another Button
// that does 'Place Formation'. This will only assign the position and rotation to the nearest dancers as their last
// position and rotation. It will only work if the dancers are already quite close. This is appropriate for 'Heads Wheel
// round and make an arch, Sides dive thru' from 'Promenade 2'. It ends in a 'Two-Faced lines LH' formation rotated by 45
// deg, but the setup is in a different order, so it doesn't match cleanly when applied using 'Place Setup'."
//
// MEASURED on that witness (`ms/dive_thru.xml`, `Heads Wheel Around and make an Arch, Sides Dive Thru`, 8 dancers, 8
// beats): its end board is 0.3575 units from `Two-Faced Lines LH` turned 45 degrees, worst pair 0.3575, and the heading
// agrees to 0.15 degrees and the genders at 8 of 8 spots - but the pairing that gets there is the REVERSED one within
// each line (dancer 1 -> spot 3, 2 -> 4, 3 -> 2, 4 -> 1, 5 -> 7, 6 -> 8, 7 -> 6, 8 -> 5), which is exactly what the
// setup placement cannot express. `endFormationMatch` returns null for the same board (0.3575 is seven times its 0.05
// naming margin), which is why the End setup row says "Unknown Setup" there.
//
// THE RULE IS THEREFORE BY DISTANCE ONLY: every dancer takes the nearest free spot of the TURNED target, closest pair
// first, and the operation is refused unless every dancer got one inside `END_SNAP_TOL`. Nothing is rotated into place:
// the caller has already chosen the shape and its turn, so the spots' own positions and headings are what gets written
// (the panel applies them with the engine's `placeDancerEnd`, which is the same "position and rotation, path left alone"
// placement the setup button uses).
//
// GENDER AND HEADING ARE REPORTED, NEVER GATING. A two-faced line's LH and RH variants stand on the SAME EIGHT SPOTS, so
// no distance can tell them apart - MEASURED: `Two-Faced Lines RH` fits the same witness at the same 0.3575 but with 8 of
// 8 genders disagreeing and 179.85 degrees of heading error per dancer. Reporting those two numbers is what lets a caller
// see they picked the other variant; refusing on them would refuse the reported call whenever a line is reversed.
//
// THIS MODULE IS DOM-FREE AND IMPORTS NOTHING (the `scrub-keep.ts`/`move-nav.ts` pattern), so
// `poc/tools/end-place-formation-probe.mjs` loads it through node's type stripping and measures the rule itself rather
// than a copy of it.

/** A dancer's or a spot's pose, and the gender a spot may declare (used only for the report). */
export interface SnapPose {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly gender?: string;
}

/** The pairing in force, and the worst numbers it was achieved with. */
export interface SnapMatch {
  /** `pairing[dancer] = spot`, a permutation of `0..n-1`. */
  readonly pairing: readonly number[];
  /** The largest dancer-to-spot distance in the pairing, in board units. */
  readonly worst: number;
  /** The largest facing difference in the pairing, in radians (reported, never gating). */
  readonly worstHeading: number;
  /** How many pairs put a dancer on a spot declared for the other gender (reported, never gating). */
  readonly genderMisses: number;
}

/** Why the snap refused, in the words the panel shows. */
export interface SnapRefusal {
  readonly refused: string;
}

/**
 * HOW CLOSE IS "ALREADY QUITE CLOSE": half a board unit, and each of the three reasons is a measurement.
 *
 *   1. THE WITNESS NEEDS 0.3575 (above), so anything under that would refuse the call this button was asked for.
 *   2. HALF THE MINIMUM SPOT SEPARATION. A named formation's own spots are at least 0.9998 units apart (the engine's
 *      `END_BOARD_TOL` measurement), so at 0.5 no point can be nearer than a tie to two spots of one formation - the
 *      pairing can never be riding on "which of two spots did you mean".
 *   3. TEN TIMES THE NAMING MARGIN (0.05) and twice the near-match filter's (0.2). Naming is a RE-BASE and its margin is
 *      how far a name may nudge the dance; this button is a nudge by request, so it has to be looser than a name - but
 *      still small enough that the dancers are standing in the shape, which is what the caller checks by eye.
 *
 * It is a default, not a law: the panel passes it and every caller may pass its own.
 */
export const END_SNAP_TOL = 0.5;

/** Wrap an angle difference into (-pi, pi]. Local rather than imported so this module stays dependency-free. */
function normAngle(a: number): number {
  const twoPi = Math.PI * 2;
  const r = ((a + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}

/**
 * Pair every dancer with a spot of the target by NEAREST FIRST, and refuse unless they all fit inside `tol`.
 *
 * CLOSEST PAIR FIRST, DETERMINISTICALLY: all pairs inside the tolerance are sorted by distance and then by dancer and
 * spot index, and each is taken when both its dancer and its spot are still free. The tie-break on the indices is what
 * makes the result reproducible - two dancers equidistant from two spots must not pair differently between renders.
 *
 * GREEDY IS DELIBERATELY CONSERVATIVE: a greedy choice can block an assignment that a global matching would find, and
 * then this REFUSES rather than searching. A refusal is a sentence the caller reads ("dancer 3 has no spot within
 * 0.50"), and it is honest - the dancers are not standing in that shape - where a cleverer search would place eight
 * dancers on a shape they are not in.
 *
 * @param dancers the call's END board, in the call's own dancer order
 * @param spots   the target formation's spots, ALREADY TURNED to the chosen rotation
 * @param tol     the largest distance a dancer may be from the spot it takes
 */
export function snapToNearestSpots(
  dancers: readonly SnapPose[],
  spots: readonly SnapPose[],
  tol: number = END_SNAP_TOL,
): SnapMatch | SnapRefusal {
  if (dancers.length === 0) return { refused: 'nothing to place' };
  if (dancers.length !== spots.length) {
    return { refused: `the call has ${dancers.length} dancers and the formation has ${spots.length} spots` };
  }
  const n = dancers.length;
  const pairs: { d: number; i: number; j: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = Math.hypot(dancers[i].x - spots[j].x, dancers[i].y - spots[j].y);
      if (d <= tol) pairs.push({ d, i, j });
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  const pairing = new Array<number>(n).fill(-1);
  const taken = new Array<boolean>(n).fill(false);
  let placed = 0;
  for (const p of pairs) {
    if (pairing[p.i] !== -1 || taken[p.j]) continue;
    pairing[p.i] = p.j;
    taken[p.j] = true;
    placed++;
  }
  if (placed !== n) {
    // NAME THE DANCERS, not just the count: the caller fixes the shape by moving a body, and "one dancer" does not say
    // which. The nearest spot each unplaced dancer actually has is the useful number, so the sentence carries it.
    const stranded = pairing
      .map((spot, i) => (spot === -1 ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => {
        let nearest = Infinity;
        for (const s of spots) nearest = Math.min(nearest, Math.hypot(dancers[i].x - s.x, dancers[i].y - s.y));
        return `dancer ${i + 1} (nearest spot ${nearest.toFixed(2)})`;
      });
    return { refused: `${stranded.join(', ')} ${stranded.length === 1 ? 'is' : 'are'} further than ${tol.toFixed(2)} from every free spot` };
  }
  let worst = 0;
  let worstHeading = 0;
  let genderMisses = 0;
  for (let i = 0; i < n; i++) {
    const spot = spots[pairing[i]];
    worst = Math.max(worst, Math.hypot(dancers[i].x - spot.x, dancers[i].y - spot.y));
    worstHeading = Math.max(worstHeading, Math.abs(normAngle(dancers[i].heading - spot.heading)));
    if (spot.gender !== undefined && dancers[i].gender !== undefined && spot.gender !== dancers[i].gender) genderMisses++;
  }
  return { pairing, worst, worstHeading, genderMisses };
}
