// Pure, immutable math core for the dancing-squared engine.
// This mirrors the semantics of taminations' lib/math/*.dart but is a clean
// TypeScript port with no renderer dependencies. Everything here is
// side-effect free: given a dancer spec and a beat, produce a Pose.

import type { BezierData, CallBundle, DancerSpec, Hands, Pose, Seg } from './types.js';

export const DEG = Math.PI / 180;

// ---------------------------------------------------------------- Bezier

export function bezierPoint(b: BezierData, t: number): { x: number; y: number } {
  const mt = 1 - t;
  const x = mt * mt * mt * 0 + 3 * mt * mt * t * b.cx1 + 3 * mt * t * t * b.cx2 + t * t * t * b.x2;
  const y = mt * mt * mt * 0 + 3 * mt * mt * t * b.cy1 + 3 * mt * t * t * b.cy2 + t * t * t * b.y2;
  return { x, y };
}

// Facing angle (radians) = atan2 of the tangent.
export function bezierAngle(b: BezierData, t: number): number {
  const mt = 1 - t;
  const dx = 3 * mt * mt * (b.cx1 - 0) + 6 * mt * t * (b.cx2 - b.cx1) + 3 * t * t * (b.x2 - b.cx2);
  const dy = 3 * mt * mt * (b.cy1 - 0) + 6 * mt * t * (b.cy2 - b.cy1) + 3 * t * t * (b.y2 - b.cy2);
  return Math.atan2(dy, dx);
}

// THE DIRECTION THE CURVE DEPARTS IN — a direction even when the curve is at rest.
//
// A FACING CURVE IS READ AS A TURN, `angle(t) - <the datum>`, and the datum comes from this function.
// `bezierAngle(b, 0)` IS that datum whenever the curve has a start tangent — and it is NOT A DIRECTION when it
// does not: a cubic with `cx1 = cy1 = 0` leaves its own start at rest (C1 = P0), so `atan2(0, 0)` answers 0 by
// IEEE convention whatever the curve then does. Using that 0 as the datum reads a turn of pi on any such curve
// whose interior runs along -X, which a mirror produces exactly.
//
// MEASURED (the witness this was found by): `ms/circle.virtual.xml`, four dancers holding for 8 beats, written by
// `padSegment(pose, pose, beats)` as `cx3="0" cx4="1" cy4="0" x4="1" y4="0"` — control points (0,0) (0,0) (1,0)
// (1,0). Read against `bezierAngle(...,0)` the ORIGINAL is a turn of 0 everywhere (its interior runs +X, matching
// the bogus datum); the Y-mirrored curve negates `cx1, cx2, x2`, so its interior runs -X and the turn reads pi.
// The dancer's heading went 90, -90…-90, 90 where a reflection must leave a no-turn curve alone.
//
// THE RULE IS THE CURVE'S OWN LIMITING DIRECTION. `B'(t) = 3[(1-t)^2 (C1-P0) + 2(1-t)t (C2-C1) + t^2 (P3-C2)]`,
// so as t -> 0 the leading non-vanishing term is the first non-zero of (C1-P0), (C2-P0), (P3-P0) — computed
// exactly, with no epsilon and no resampling. This curve's local frame puts P0 at the origin, so those three are
// the control values themselves.
//
// IT IS IDENTITY WHERE THE OLD DATUM WAS ALREADY WELL-DEFINED, so no shipped heading can move. MEASURED by
// `engine/test/departure-angle.mjs` over every `<movement>` in `assets/moves.xml` and the authored level files
// (3,301 tags: 1,970 carrying a facing curve, 1,331 facing-less, 0 with no curve of their own): **10** start at
// rest, **10** have a collapsed exit handle — the same ten curves, a hold being degenerate at both ends — and
// every one of them departs AND arrives along +X, which is what `atan2(0, 0)` answers anyway. So the corpus
// cannot distinguish the two datums, which is why the harness's control is a CONSTRUCTED mirror rather than a
// corpus case.
//
// THE ALTERNATIVE REJECTED: call a curve with no start tangent a NO-TURN curve. It agrees with this rule on every
// curve the corpus has, and it is wrong the first time a curve departs from rest AND turns — such a curve has a
// real sweep, and that rule would report 0 and drop it. `engine/test/departure-angle.mjs` pins both: the hold that
// must mirror to itself, and a from-rest curve that must report its 135-degree sweep rather than 0.
//
// `-0` IS ZERO HERE, and that is not an aside: the mirror negates a coordinate, and negating 0 gives -0. `-0 === 0`
// is true, so a rested curve is detected whichever sign of zero the negation left behind.
export function departureAngle(b: BezierData): number {
  for (const [dx, dy] of [[b.cx1, b.cy1], [b.cx2, b.cy2], [b.x2, b.y2]]) {
    if (dx !== 0 || dy !== 0) return Math.atan2(dy, dx);
  }
  // A curve with no displacement at all is a POINT, and a point has no direction: 0 is the same convention
  // `atan2(0, 0)` already gives, and a point cannot turn.
  return 0;
}

// THE DIRECTION THE CURVE ARRIVES IN — the same rule at the other end, and it is not symmetry for its own sake.
//
// THE SAME HOLE EXISTS AT t = 1, and the hold above has it at BOTH ends: `C2 = P3` makes `B'(1)` the zero vector,
// so `bezierAngle(b, 1)` is `atan2(0, 0) = 0` again. MEASURED with only the departure end fixed: the Y-mirrored
// hold read 90 degrees for t = 0…7 and then jumped to -90 at the LAST instant (t = 1), because the arrival datum
// was still the bogus 0 while the true arrival direction was -X. A turn is only as right as both of its ends.
//
// By the same expansion, as t -> 1 the leading non-vanishing term is the first non-zero of (P3-C2), (P3-C1),
// (P3-P0).
export function arrivalAngle(b: BezierData): number {
  for (const [dx, dy] of [[b.x2 - b.cx2, b.y2 - b.cy2], [b.x2 - b.cx1, b.y2 - b.cy1], [b.x2, b.y2]]) {
    if (dx !== 0 || dy !== 0) return Math.atan2(dy, dx);
  }
  return 0;
}

/**
 * The angle of the curve AT `t`, defined at the two ends as well.
 *
 * `bezierAngle` is `atan2` of the derivative, which is the angle everywhere except where the derivative vanishes
 * — the ends of every curve that starts or ends at rest, which is what a hold is. There the limit direction
 * (`departureAngle` / `arrivalAngle`) is the angle, and this is the ONE place that says so, so a caller cannot
 * fix one end and leave the other (which is exactly the mistake MEASURED above).
 */
export function curveAngle(b: BezierData, t: number): number {
  if (t <= 0) return departureAngle(b);
  if (t >= 1) return arrivalAngle(b);
  return bezierAngle(b, t);
}

// ---------------------------------------------------------------- Transform
// 2D affine transform = rotation+translation (no scale/shear). apply(T, p) = R*p + t.

export interface Transform {
  cos: number;
  sin: number;
  tx: number;
  ty: number;
}

export function ident(): Transform {
  return { cos: 1, sin: 0, tx: 0, ty: 0 };
}

export function fromPosAngle(x: number, y: number, angleRad: number): Transform {
  return { cos: Math.cos(angleRad), sin: Math.sin(angleRad), tx: x, ty: y };
}

// mul(A, B): apply B first, then A  (column-vector convention).
export function mul(a: Transform, b: Transform): Transform {
  return {
    cos: a.cos * b.cos - a.sin * b.sin,
    sin: a.sin * b.cos + a.cos * b.sin,
    tx: a.cos * b.tx - a.sin * b.ty + a.tx,
    ty: a.sin * b.tx + a.cos * b.ty + a.ty,
  };
}

export function apply(t: Transform, p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: t.cos * p.x - t.sin * p.y + t.tx,
    y: t.sin * p.x + t.cos * p.y + t.ty,
  };
}

export function translateBy(dx: number, dy: number): Transform {
  return { cos: 1, sin: 0, tx: dx, ty: dy };
}

export function rotateBy(angleRad: number): Transform {
  return { cos: Math.cos(angleRad), sin: Math.sin(angleRad), tx: 0, ty: 0 };
}

// ---------------------------------------------------------------- Path eval

function handsAtBeat(path: Seg[], t: number): Hands {
  let rem = t;
  for (const s of path) {
    if (rem < s.beats) return s.hands;
    rem -= s.beats;
  }
  return path.length ? path[path.length - 1].hands : 'none';
}

export type HeadingMode = 'rotation' | 'travel';

// Evaluate a dancer's world pose at beat t (absolute call time).
//
// Two facing interpretations come straight out of the data:
//  - 'rotation': the dedicated facing (rotation) Bezier (`cx3/cx4/cy4/x4/y4`),
//    falling back to the translation tangent when absent. This is what
//    taminations uses and is authoritative (it intentionally makes a dancer
//    walk forward OR backward along the path, e.g. in a Wheel).
//    EITHER WAY IT IS READ AS A TURN - the angle the move is played in, less
//    the angle the curve itself starts at. See the note at `const a` below:
//    without that, a curve that does not begin along the dancer's own +X
//    snaps the facing at the move's start rather than continuing it.
//  - 'travel': always face along the instantaneous direction of motion
//    (the translation-tangent heading, absolutely - that IS what this mode
//    means). Simpler, "always walk forward" look.
export function poseFor(dancer: DancerSpec, t: number, headingMode: HeadingMode = 'rotation'): Pose {
  const start = fromPosAngle(dancer.x, dancer.y, dancer.angleDeg * DEG);
  let m = start;
  let rem = t;
  let heading = Math.atan2(start.sin, start.cos);
  let travelHeading = heading;
  for (const s of dancer.path) {
    if (rem <= 0) break;
    const local = Math.min(rem, s.beats);
    const tt = s.beats > 0 ? local / s.beats : 0;
    const segStartHeading = heading;
    travelHeading = segStartHeading + curveAngle(s.translate, tt);
    const pt = bezierPoint(s.translate, tt);
    m = mul(m, translateBy(pt.x, pt.y));
    // A FACING CURVE IS A TURN, AND A TURN STARTS AT ZERO.
    //
    // Both channels are read with `bezierAngle`, which is `atan2` of the derivative - but they MEAN
    // different things. A `rotate` curve expresses the heading the move turns through, so its angle at
    // t=0 is where the dancer already is; a `translate` curve expresses where the move goes, so its angle
    // at t=0 is the direction the path DEPARTS in. Read as a turn, only the first of those starts at zero.
    //
    // THE CORPUS CANNOT TELL THEM APART, which is why this went unnoticed: measured over every shipped
    // curve, all 4128 `rotate` curves and all 5860 moves with no facing have an angle of EXACTLY 0 at
    // t=0 (`poc/tools/start-facing-probe.mjs`). A dancer walks forward along +X in its own frame, so the
    // departure direction is the facing it already had, and the two readings agree.
    //
    // AN AUTHORED MOVE BREAKS THAT. A sidestep departs across the dancer's facing and a back-up departs
    // behind it, so the raw travel tangent is 90 or 180 degrees at t=0 - and the dancer SNAPPED to face
    // it at the move's start, then turned back. Subtracting the curve's own start makes the profile a
    // turn: the heading continues from where the previous move left it, and the dancer turns only as much
    // as the path itself turns. For a straight back-up that is a turn of zero - the dancer backs up still
    // facing forward, which is the dance.
    const facing = s.rotate ?? s.translate;
    const a = curveAngle(facing, tt) - departureAngle(facing);
    m = mul(m, rotateBy(a));
    heading = Math.atan2(m.sin, m.cos);
    rem -= local;
  }
  const finalHeading = headingMode === 'travel' ? travelHeading : heading;
  if (dancer.mirror) {
    // The duplicate half is a 180-degree rotation about the origin.
    const h = Math.atan2(Math.sin(finalHeading + Math.PI), Math.cos(finalHeading + Math.PI));
    return { x: -m.tx, y: -m.ty, heading: h, hands: handsAtBeat(dancer.path, t) };
  }
  return { x: m.tx, y: m.ty, heading: finalHeading, hands: handsAtBeat(dancer.path, t) };
}

// Total path beats for one dancer.
export function dancerBeats(dancer: DancerSpec): number {
  return dancer.path.reduce((sum, s) => sum + s.beats, 0);
}


export function allPoses(call: CallBundle, t: number, headingMode: HeadingMode = 'rotation'): Pose[] {
  return call.dancers.map((d) => poseFor(d, t, headingMode));
}

// Sample a full path trail for one dancer (for visualization).
export function sampleTrail(dancer: DancerSpec, steps = 60): { x: number; y: number }[] {
  const total = dancerBeats(dancer);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total;
    const p = poseFor(dancer, t);
    pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

/**
 * Sample ONE STRETCH of a dancer's path - the poses between two absolute beats - so the
 * editor can highlight the part of the track that one move is responsible for.
 *
 * `from`/`to` are clamped to the dancer's own path (a move's range always is inside it, but
 * a caller asking about a call whose `beats` exceed the longest path is not an error, it is
 * the pause at the end). Both endpoints are included and are EXACTLY `poseFor` at those
 * beats, so a highlight can be compared to the trail it sits on rather than merely looking
 * about right. A zero-length range collapses to a single repeated point, which is what a
 * movement with no beats deserves.
 */
export function sampleTrailRange(dancer: DancerSpec, from: number, to: number, steps = 48): { x: number; y: number }[] {
  const total = dancerBeats(dancer);
  const a = Math.max(0, Math.min(total, from));
  const b = Math.max(0, Math.min(total, to));
  const n = Math.max(1, Math.round(steps));
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const p = poseFor(dancer, a + ((b - a) * i) / n);
    pts.push({ x: p.x, y: p.y });
  }
  return pts;
}
