// THE FLOOR'S TWO GRIDS, and the magnet that pulls a dragged point onto whichever one is showing.
//
// WHY THIS IS ITS OWN MODULE, with no DOM and no `three`: the rule has to be measurable. Every probe in
// `poc/tools` runs under plain node against `engine/dist`, and this app's UI modules build DOM - so a rule
// that lived inside `editor-ui.ts` could only ever be MIRRORED by a probe, which is one edit away from a
// probe that measures a copy of the rule rather than the rule. Here the probe imports it, so the square
// magnet and the radial one are stated once and measured once.
//
// THE GRID THE CALLER CAN SEE IS THE BOARD'S, not the dancer's. A dragged point is snapped in board
// coordinates, before it is taken into the dancer's local frame, because a grid turned with the dancer
// lines up with the lines on the floor only when the dancer happens to be square to it. The cost is on the
// other side and is stated plainly: the numbers left in the tile are a grid point's dancer-local
// coordinates, so they are not round when the dancer is turned.

/** The board's own unit: one drawn cell of the square grid, and one circle of the radial one. */
export const SNAP_CELL = 1;

/**
 * How close a point must come to a DRAWN line before the magnet pulls it in.
 *
 * A MAGNET AND NOT A LOCK. Rounding from anywhere in the cell would make the drag quantised - every
 * position a grid position - which is a different gesture from "help me land on the line". The pull is a
 * DISTANCE, so it is the same size everywhere on the floor and reads as the same number of pixels in the
 * flat view; `poc/tools/snap-grid-probe.mjs` converts it for a 1080p frame rather than leaving it a
 * number somebody liked.
 */
export const SNAP_TOL = SNAP_CELL / 4;

/**
 * The HALF grid's pull, and it is deliberately weaker than the whole grid's.
 *
 * HALF POSITIONS ARE WHERE THIS DANCE'S OWN COORDINATES LIVE. MEASURED over the move registry
 * (`poc/tools/snap-grid-probe.mjs`): 61% of the authored coordinates sit on half units against 46% on
 * whole ones - a half-slot step is an ordinary thing to author - so a magnet that only knew the drawn
 * lines would refuse the position the assets use most.
 *
 * Two tiers rather than one finer grid, so the DRAWN lines keep their precedence: a whole unit wins
 * whenever both are in range, which is why this pull is half as wide. A point a quarter of a unit from
 * both lands on the drawn line.
 *
 * AND BOTH GRIDS NOW DRAW THE HALF POSITIONS, faintly - the square grid as half LINES (`squareHalfOffsets`)
 * and the radial one as half RINGS (`radialCircleRadii`), in ONE shared material so that they are the same
 * mark. Asked for in that order: the radial half rings first ("Add a half grid line for the circles. Make
 * this more subtle than the unit circles."), then "Add the same subtle half-grid line used by the radial grid
 * to the square grid." A half position is where 61% of this dance's coordinates live, so drawing it is a real
 * reading; it is still NOT a division, so it is drawn in a colour of its own (a violet-grey at hue 270 against
 * the divisions' 212) and at a lower alpha - which is what keeps it a guide rather than a line of the same
 * standing. `radial-grid-probe.mjs` reads the material and requires it to stay dimmer than the divisions and
 * clear of the cardinal spokes.
 */
export const SNAP_HALF_TOL = SNAP_CELL / 8;

/** Which floor grid the board is drawing, and therefore which magnet the drags use. */
export type GridMode = 'square' | 'radial';

export interface Point {
  x: number;
  y: number;
}

/** How many spokes the radial grid draws: one every 22.5 degrees. */
export const RADIAL_SPOKES = 16;
/** The angle between two neighbouring spokes, in radians. */
export const RADIAL_SPOKE_STEP = (Math.PI * 2) / RADIAL_SPOKES;
/** A spoke is drawn in the bright "centre line" colour every this many spokes, so the four compass
 *  directions of the radial grid are the same four lines the square grid highlights. */
export const RADIAL_CARDINAL_EVERY = RADIAL_SPOKES / 4;

/**
 * The circles the radial grid draws on a floor of half-size `half`.
 *
 * THE RADII ARE THE EXISTING DIVISIONS, not a second set of numbers: the square grid draws a line every
 * whole unit out to the edge and overlays one every two, and the radial grid draws the circle at the same
 * whole units with the same even ones overlaid. So switching grids changes the SHAPE of the reference and
 * not its scale, and one "unit" means the same thing on both.
 *
 * `halves` ARE DRAWN, FAINTLY. A half position is where most of this dance's own coordinates live (61% of
 * them), so the ring between two divisions is a real reading rather than decoration - and it is still NOT a
 * division, so it is drawn in a colour and an alpha of its own. `squareHalfOffsets` is the same treatment on
 * the square grid, and the shared `halfMat` in `scene.ts` is the same MATERIAL: the two grids put the mark at
 * the SAME offsets in the SAME line, and `radial-grid-probe.mjs` recomputes the contrast and the hue gap from
 * that material rather than trusting a comment.
 */
export function radialCircleRadii(half: number): { fine: number[]; coarse: number[]; halves: number[] } {
  const fine: number[] = [];
  const coarse: number[] = [];
  const halves: number[] = [];
  for (let r = 1; r <= Math.floor(half); r++) {
    fine.push(r);
    if (r % 2 === 0) coarse.push(r);
    // The half ring BELOW this division, which is how every one of them gets one - including the 0.5 ring
    // that has no division under it, and no ring at the floor`s own edge + 0.5, which would hang off it.
    halves.push(r - 0.5);
  }
  return { fine, coarse, halves };
}

/**
 * THE HALF LINES the SQUARE grid draws, as unsigned offsets from the origin: 0.5, 1.5, … 9.5.
 *
 * IT IS THE SAME SET THE RADIAL GRID PUTS ITS HALF RINGS AT - `radialCircleRadii(half).halves` - and that is
 * the point rather than a coincidence: "the same subtle half-grid line used by the radial grid" means the same
 * POSITIONS in the same MATERIAL, so the half mark reads identically whichever grid is on the floor. The two
 * are computed separately because the shapes are different (an offset on an axis, a radius), and
 * `radial-grid-probe.mjs` pins that they AGREE rather than deriving one from the other.
 *
 * NOTHING AT 0 OR `half`: those are the divisions and the edge of the floor, and the grid already draws them.
 * The value is unsigned - the caller mirrors it - so `v` and `-v` are one entry.
 */
export function squareHalfOffsets(half: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.floor(half); i++) out.push(i + 0.5);
  return out;
}

/**
 * Pull a single coordinate onto the nearest grid line, or leave it exactly where it is.
 *
 * BOTH AXES ARE HANDLED INDEPENDENTLY, so a point can land on a line in x and stay free in y - which is
 * what "on the grid" means for a control point, and it avoids rounding a coordinate the caller did not
 * put near anything.
 */
export function snapToAxis(v: number): number {
  const whole = Math.round(v / SNAP_CELL) * SNAP_CELL;
  if (Math.abs(v - whole) <= SNAP_TOL) return whole;
  const half = Math.round(v / (SNAP_CELL / 2)) * (SNAP_CELL / 2);
  if (Math.abs(v - half) <= SNAP_HALF_TOL) return half;
  return v;
}

/** The square magnet: today's rule, unchanged, one axis at a time. */
export function snapSquare(p: Point): Point {
  return { x: snapToAxis(p.x), y: snapToAxis(p.y) };
}

/**
 * The radial magnet: the same ruler in polar form.
 *
 * TWO COORDINATES, TWO TIERS, EXACTLY AS THE SQUARE MAGNET HAS THEM:
 *
 *   - the RADIUS goes through `snapToAxis`, the rule the square grid already uses - whole circle first,
 *     then the half positions the assets are full of - so the circles pull exactly as the lines do; and
 *   - the ANGLE is pulled onto the nearest of the 16 spokes only when the point is already close to it.
 *
 * THE SPOKE'S CLOSENESS IS A DISTANCE, NOT AN ANGLE, and that is the one design decision here. A fixed
 * angular window behaves differently at every radius: half a spoke is 22.5 degrees, so a window a quarter
 * of that wide would move a point nearly a whole unit across the floor at the outermost circle and almost nothing at
 * r = 1. The magnet's whole premise is that the pull is a distance - the square one measures it in units
 * and the probe converts it to pixels - so the test here is the PERPENDICULAR DISTANCE from the point to
 * the spoke, `r * sin(delta)`, against the same `SNAP_TOL`. The pull then feels identical at every
 * radius, which is what "works in a similar way, but along the spokes and circles" has to mean.
 *
 * NO HALF TIER FOR THE ANGLE, and the reason is the measurement that justifies the square grid's. The
 * half tier exists because 61% of the corpus's authored coordinates sit on half units. Nothing in this
 * corpus authors an angle on the floor, so a 32-spoke tier would be a magnet for a position the grid does
 * not draw. It is one line to add if that ever changes; it is not added on a guess.
 *
 * BOTH TIERS APPLY AT ONCE, so a point near a circle AND a spoke lands on their intersection - which is
 * the grid point - for the same reason x and y are handled independently in the square magnet.
 */
export function snapRadial(p: Point): Point {
  const r = Math.hypot(p.x, p.y);
  // THE ORIGIN IS ALREADY ON THE GRID: it is the centre every circle is drawn about and the start of every
  // spoke, and `atan2(0, 0)` would otherwise invent an angle for it.
  if (!(r > 0)) return p;
  const th = Math.atan2(p.y, p.x);
  const rs = snapToAxis(r);
  const spoke = Math.round(th / RADIAL_SPOKE_STEP) * RADIAL_SPOKE_STEP;
  const ths = Math.abs(r * Math.sin(th - spoke)) <= SNAP_TOL ? spoke : th;
  // NEITHER COORDINATE MOVED, so the point is handed back UNTOUCHED rather than rebuilt from its own polar
  // form. `atan2` -> `cos`/`sin` is not the identity in floating point, and a magnet that nudged a point it
  // had decided not to move would be applying exactly the rounding this whole rule exists to avoid - the
  // square magnet's own promise is that a point outside it is left EXACTLY where it was.
  if (rs === r && ths === th) return p;
  return { x: rs * Math.cos(ths), y: rs * Math.sin(ths) };
}

/** The magnet for whichever grid is showing. One entry point, so no drag can snap to the wrong grid. */
export function snapBoard(p: Point, mode: GridMode): Point {
  return mode === 'radial' ? snapRadial(p) : snapSquare(p);
}

/**
 * A CHORD THAT LIES ON ONE OF THE RADIAL GRID'S OWN CIRCLES - the case where the grid can fit the curve for the
 * caller.
 *
 * Asked for as: "call editor: if radial grid and start and end points of the current curve are on the same radial
 * circumference and the distance between the ends is less than half, offer a mid point control that when clicked
 * calibrates the bezier controls best fit of the curve to the radial line it's connected to. This makes accurate
 * fitting to radial circles so much easier than manually adjusting the controls."
 *
 * WHY IT IS WORTH A CONTROL: an arc and the straight chord between its ends differ by the SAGITTA, and a caller
 * placing two control points by eye cannot hit the fourth decimal of a curve they cannot see the difference of.
 * The grid already knows the answer - the circle is drawn on the floor - so the fit is arithmetic.
 *
 * THE LIMIT IS A QUARTER TURN, NOT A LENGTH. The first version took the request's "the distance between the ends
 * is less than half [a cell]" literally, and that turned out to refuse everything real: MEASURED over the ms
 * level's 976 moves, **108** have both ends on one drawn circle but NONE of them is under half a cell - the
 * corpus's arcs are quarter and eighth turns, not slivers - so the control could never appear. Withdrawn for:
 * "I think a radius of quarter or less is more workable with bezier", which is the standard fact about cubics and
 * the one that matters here: a cubic traces a quarter circle to about 0.03% of the radius, and past a right angle
 * the error climbs quickly (`radial-arc-fit-probe.mjs` measures both). So the condition is the SWEEP, and the
 * length limit is gone - "a quarter or less" was already the intent, and a chord limit is the same rule stated in
 * a worse coordinate. Same board, same measurement: **98** of those 108 curves are within the quarter, and the
 * ten that are not (112.6deg) are refused.
 *
 * THE OTHER TWO CONDITIONS are refusals rather than nudges. The two ends must be on the SAME circumference
 * (`|r0 - r1| <= tol`), and that circumference must be one the grid DRAWS (within the same tolerance) - the
 * request says "the radial line it's connected to", not "any circle through these two points", and a fit onto a
 * circle nobody can see is the guess this control exists to remove.
 *
 * `tol` DEFAULTS TO THE MAGNET'S HALF TIER, `SNAP_CELL / 8`. That is deliberate rather than convenient: it is
 * the distance within which this app already says a point is "on" a half-position, so a pair of ends the CTRL
 * magnet would have pulled onto the circle is exactly a pair this accepts - and a pair it would have left alone
 * is one this refuses. It is also what makes the workflow work: snap the ends with CTRL, then press the dot.
 */
export const RADIAL_ARC_MAX_SWEEP = Math.PI / 2;

export interface RadialArcFit {
  /** The DRAWN radius the two ends are on, which is the circle the fit will follow. */
  radius: number;
  /** The radius each end actually sits at, in the order they were given. */
  radii: [number, number];
  /** The point halfway along the ARC - on the circle, where the control is offered. */
  mid: Point;
  /** The angle swept, signed: positive turns anticlockwise about the set centre. */
  sweep: number;
  /**
   * THE RADIUS MISMATCH THIS FIT WAS ACCEPTED AT, relative to the radius - so the cubic can be built with the
   * SAME tolerance it was offered under.
   *
   * This exists because the two halves of the feature disagreed once, in the field: the rule accepted a pair
   * whose radii differed by up to the magnet's tier, drew the control, and then the engine's `arcBezierAbout`
   * refused the same pair at its own default 5% - so the dot appeared and pressing it said "the two ends are not
   * on one circle". MEASURED in the browser on `ms/grand_spin.xml` move 2, whose ends sit at 1.5 and a little
   * over. One tolerance, stated once, carried from the rule to the fit.
   */
  tolRel: number;
}

export function radialArcFit(
  from: Point,
  to: Point,
  radii: readonly number[],
  tol = SNAP_HALF_TOL,
): RadialArcFit | null {
  const r0 = Math.hypot(from.x, from.y);
  const r1 = Math.hypot(to.x, to.y);
  // A point at the centre has no circumference to sit on.
  if (!(r0 > 0) || !(r1 > 0)) return null;
  if (Math.abs(r0 - r1) > tol) return null;
  const a0 = Math.atan2(from.y, from.x);
  const a1 = Math.atan2(to.y, to.x);
  // THE SHORT WAY ROUND, because that is the arc the caller means between two points on a circle - and the long
  // one would be the rest of the circle. It also makes the sweep the thing "a quarter or less" is measured
  // against, with no second rule for the direction of travel.
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  if (!(Math.abs(sweep) > 0)) return null;
  if (Math.abs(sweep) > RADIAL_ARC_MAX_SWEEP) return null;
  // THE GRID'S OWN CIRCLES, nearest first: the fit follows a line the caller can see.
  const mean = (r0 + r1) / 2;
  let drawn: number | null = null;
  for (const r of radii) {
    if (Math.abs(mean - r) <= tol && (drawn === null || Math.abs(mean - r) < Math.abs(mean - drawn))) drawn = r;
  }
  if (drawn === null) return null;
  const aMid = a0 + sweep / 2;
  return {
    radius: drawn,
    radii: [r0, r1],
    mid: { x: drawn * Math.cos(aMid), y: drawn * Math.sin(aMid) },
    sweep,
    tolRel: tol / mean,
  };
}



