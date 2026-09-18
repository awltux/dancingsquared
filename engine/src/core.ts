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
//  - 'travel': always face along the instantaneous direction of motion
//    (the translation-tangent heading). Simpler, "always walk forward" look.
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
    travelHeading = segStartHeading + bezierAngle(s.translate, tt);
    const pt = bezierPoint(s.translate, tt);
    m = mul(m, translateBy(pt.x, pt.y));
    const a = bezierAngle(s.rotate ?? s.translate, tt);
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

// ------------------------------------------------------------------ call

export function callTotalBeats(call: CallBundle): number {
  return call.totalBeats;
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
