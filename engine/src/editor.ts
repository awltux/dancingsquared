// Call editor: synthesize a new setup for a call by padding its core moves.
//
// A taminations call is authored for one or more concrete setups (start
// formation -> core movement -> end formation). To add a *missing* setup, the
// user supplies a new start formation and a new end formation (described as
// dancer positions/headings); the editor inserts padding:
//
//   [newStart] --padIn--> [coreStart] --core--> [coreEnd] --padOut--> [newEnd]
//
// The pad-in moves each dancer from the new start spot to the core's native
// start spot; the pad-out moves them from the core's native end to the new end.
// Each pad segment is a straight-line translate plus a turn, built with the same
// Bezier convention taminations uses (`Movement.fromTransform`).

import type { BezierData, CallBundle, DancerSpec, Gender, Hands, Pose, Seg, Symmetry } from './types.js';
import { DEG, bezierAngle, bezierPoint, poseFor } from './core.js';
// THE HAND STATE'S MIRROR, imported rather than restated: `mirrorDancerMoves` swaps left for right exactly
// as the converter's own `reflect="-1"` does, and this is the one definition of that rule.
// `esc` comes from the same module for the same reason: it is the XML escape rule, this module writes `<tam>`
// XML, and it used to carry a BYTE-IDENTICAL copy of that one-line lambda (the two were compared character by
// character when they were collapsed). `poc/tools/escape-probe.mjs` pins the rule's character set.
import { esc, swapLR } from './convert.js';
// The DERIVED identity of an edited start formation: `assignHomeIdentity` is the same
// read the renderer colours by, so the editor's `couple` column cannot disagree with the
// stage next to it.
import { assignHomeIdentity } from './sequencer/identity.js';
// THE ONE RADIAN NORMALISER. This module used to carry its own `normAngleSafe` — the while-loop spelling of
// the same (-PI, PI] rule `moves.ts` defines — and the two differed only in the last ulp. A rule with two
// spellings in one engine is a rule whose owner cannot be found, so the local copy is gone.
import { normAngle } from './moves.js';

export interface FormDancer {
  x: number;
  y: number;
  heading: number; // radians, 0 = +X, ccw
  gender?: Gender;
}

export interface NewSetup {
  name: string;
  /** Start formation, aligned to `core.dancers` order (length == dancer count). */
  start: FormDancer[];
  /** End formation, aligned to `core.dancers` order. */
  end: FormDancer[];
  /** Beats for each padding segment (default 2). */
  padBeats?: number;
}

// ------------------------------------------------------------------- Procrustes

interface Rigid {
  cos: number;
  sin: number;
  tx: number;
  ty: number;
  error: number;
}
export type { Rigid };

/** Best rigid transform (rotation + translation) mapping `src` onto `dst`. */
export function rigidFit(src: { x: number; y: number }[], dst: { x: number; y: number }[]): Rigid {
  const n = Math.min(src.length, dst.length);
  const cs = { x: 0, y: 0 };
  const cd = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    cs.x += src[i].x;
    cs.y += src[i].y;
    cd.x += dst[i].x;
    cd.y += dst[i].y;
  }
  cs.x /= n;
  cs.y /= n;
  cd.x /= n;
  cd.y /= n;
  let sxx = 0;
  let sxy = 0;
  let syx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i].x - cs.x;
    const py = src[i].y - cs.y;
    const qx = dst[i].x - cd.x;
    const qy = dst[i].y - cd.y;
    sxx += px * qx;
    sxy += px * qy;
    syx += py * qx;
    syy += py * qy;
  }
  const angle = Math.atan2(sxy - syx, sxx + syy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tx = cd.x - (cos * cs.x - sin * cs.y);
  const ty = cd.y - (sin * cs.x + cos * cs.y);
  let error = 0;
  for (let i = 0; i < n; i++) {
    const ax = cos * src[i].x - sin * src[i].y + tx - dst[i].x;
    const ay = sin * src[i].x + cos * src[i].y + ty - dst[i].y;
    error += ax * ax + ay * ay;
  }
  return { cos, sin, tx, ty, error: Math.sqrt(error / n) };
}

/**
 * Turn a whole formation about the BOARD CENTRE - every spot AND every facing.
 *
 * WHY THE ORIGIN. It is the floor's own centre, and it is the point the corpus's rotated shapes are
 * related about: `deriveFormationMapping` tries every multiple of 45 degrees ABOUT THE ORIGIN when it
 * derives a spot correspondence, so a target turned by one of those steps is still paired, and paired the
 * same way (the correspondence centring in that function undoes any translation, so the pivot does not
 * change WHICH spot a dancer gets - only where that spot is).
 *
 * POSITIVE `theta` IS COUNTER-CLOCKWISE in the board's own frame (0 = +X, positive = towards +Y), which is
 * counter-clockwise on screen: the scene puts board +y at world -z and the camera's up is -z
 * (`poc/src/scene.ts`).
 *
 * HEADINGS COME BACK WRAPPED into the range `poseFor` reports, (-pi, pi]. The two products and the sum are
 * the same arithmetic `deriveFormationMapping` uses for its candidate rotations, which keeps its own copy
 * ON PURPOSE - see the note there for the measured cost of making it call this instead.
 *
 * The editor's End setup picker offers the corpus's formations in the orientation `formations.xml` writes
 * them, which is not always the orientation the call being edited finishes in - reported as "some
 * formations seem rotated compared with where I want the last move to terminate". This is the rigid turn
 * behind the control that fixes it.
 */
export function rotateFormation(poses: FormDancer[], theta: number): FormDancer[] {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return poses.map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
    heading: normAngle(p.heading + theta),
    gender: p.gender,
  }));
}

/**
 * Derive the geometric correspondence between two equal-length dancer lists:
 * `result[i]` is the index in `formation` of the dancer that belongs to slot i
 * of `coreStart`. The correspondence is found by trying whole-set rotations about
 * the origin (any multiple of 45 degrees) plus a centring translation, and
 * keeping the best 1:1 assignment by position + facing.
 *
 * INDEX INDEPENDENCE: this is the ONLY way a pairing between the two lists is
 * established — never array order. It throws when the lists hold different
 * numbers of dancers, or when the assignment cannot fill every slot, rather than
 * silently pairing dancers by array index.
 *
 * `preferGender` passes through to the assignment, and is OFF by default so that
 * every existing caller keeps the pure geometry it has always had. See
 * `greedyAssignEditor` for why the ARRANGEMENT is part of a correspondence and
 * what the flag changes.
 *
 * `coreStart` DECLARES THE FIELDS THE RULE READS. It used to be typed `{x, y}[]`, which is what let the
 * panel's `endPairing` pass positions only and have `preferGender` silently do NOTHING: the assignment skips
 * a spot only when BOTH sides declare a gender, so a caller that forgot the field got the geometry alone and
 * no error. Widened to the same shape `greedyAssignEditor` takes, plus the guard below, so the request is
 * either honoured or refused rather than quietly degraded.
 */
export function deriveFormationMapping(
  coreStart: { x: number; y: number; heading?: number; gender?: Gender }[],
  formation: FormDancer[],
  preferGender = false,
): number[] {
  if (formation.length !== coreStart.length) {
    throw new Error(
      `deriveFormationMapping: cannot align ${formation.length} dancers to a ${coreStart.length}-dancer core — refusing to pair them by array index`,
    );
  }
  // A PREFERENCE OVER NOTHING IS A BUG IN THE CALLER, NOT A TOLERANCE. MEASURED: with the start poses carrying
  // no gender the flag is inert and the panel paired 4 of 8 dancers with a spot the formation declares for
  // the other gender, which is the reported "boys and girls flipped, facing the opposite way".
  if (preferGender) {
    const sexes = (list: { gender?: Gender }[]) => list.some((p) => p.gender !== undefined);
    const missing = [
      sexes(coreStart) ? null : 'the start poses',
      sexes(formation) ? null : 'the formation',
    ].filter((s): s is string => s !== null);
    if (missing.length > 0) {
      throw new Error(
        `deriveFormationMapping: preferGender was asked for but no gender is declared on ${missing.join(' or ')} — the preference would be inert; pass the dancers' genders`,
      );
    }
  }
  const cCore = centroid(coreStart);
  let bestMap: number[] | null = null; // bestMap[j] = core slot for formation dancer j
  let bestErr = Infinity;
  for (const rot of ORIGIN_ROTS) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // Rotate the formation about the ORIGIN (position + heading). THE SAME ARITHMETIC AS `rotateFormation`,
    // deliberately NOT that function: this one adds the angle to the heading WITHOUT wrapping it, and
    // wrapping the candidate here is a real change to the answer - MEASURED by `poc/tools/end-pair-probe.mjs`,
    // it flips one index-for-index agreement (82 -> 81 of 2208) and two (call, formation) pairings (1727 ->
    // 1729 on the wrong gender) on near-ties, for no gain: the comparison below wraps the DIFFERENCE anyway
    // (`normAngle(moved - h)`), so the two forms are the same rule and differ only in the last ulp.
    const rotated: FormDancer[] = formation.map((f) => ({
      x: f.x * cos - f.y * sin,
      y: f.x * sin + f.y * cos,
      heading: f.heading + rot,
      gender: f.gender,
    }));
    // Center it on the core before greedy assignment (handles off-origin sets).
    const cr = centroid(rotated);
    const moved = rotated.map((f) => ({
      x: f.x + (cCore.x - cr.x),
      y: f.y + (cCore.y - cr.y),
      heading: f.heading,
      gender: f.gender,
    }));
    const { mapping, error } = greedyAssignEditor(moved, coreStart, preferGender);
    if (error < bestErr) {
      bestErr = error;
      bestMap = mapping;
    }
  }
  if (!bestMap || bestMap.some((i) => i < 0)) {
    throw new Error(
      'deriveFormationMapping: geometric alignment did not determine a 1:1 mapping — refusing to fall back to array index',
    );
  }
  // Invert (formation dancer j -> core slot i) into the requested direction.
  const order = new Array<number>(coreStart.length).fill(-1);
  for (let j = 0; j < bestMap.length; j++) order[bestMap[j]] = j;
  if (order.some((j) => j < 0)) {
    throw new Error(
      'deriveFormationMapping: geometric alignment did not cover every slot — refusing to fall back to array index',
    );
  }
  return order;
}

/** Reorder `formation` into `coreStart` slot order using the GEOMETRIC mapping.
 * For an array that is already in core order this is the identity, so it is safe
 * to apply unconditionally at a join boundary. */
function orderLikeCore(coreStart: { x: number; y: number }[], formation: FormDancer[]): FormDancer[] {
  return deriveFormationMapping(coreStart, formation).map((j) => {
    const f = formation[j];
    return { x: f.x, y: f.y, heading: f.heading, gender: f.gender };
  });
}

/**
 * Align a catalog/pre/post formation to the core's start formation so its
 * dancers are placed in `core.dancers` order. Matching may require a whole-set
 * ROTATION ABOUT THE ORIGIN (any multiple of 45 degrees) plus a centering
 * translation, so each candidate rotation is tried and the best 1:1 mapping
 * (position + facing) is kept. Returns a FormDancer[] where result[i] is the
 * chosen formation's dancer mapped to core dancer i, keeping its ORIGINAL
 * coordinates/heading.
 *
 * INDEX INDEPENDENCE: the correspondence between the two lists is DERIVED from
 * geometry (see deriveFormationMapping) and never assumed from array order.
 */
export function alignFormationToCore(
  coreStart: { x: number; y: number }[],
  formation: FormDancer[],
): FormDancer[] {
  return orderLikeCore(coreStart, formation);
}


function centroid(ds: { x: number; y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const d of ds) {
    x += d.x;
    y += d.y;
  }
  return ds.length ? { x: x / ds.length, y: y / ds.length } : { x: 0, y: 0 };
}

/**
 * Greedy 1:1 assignment: map[j] = core index, minimizing position+facing.
 *
 * `preferGender` IS OFF BY DEFAULT AND THAT IS LOAD-BEARING: with it off this is the pure geometry every
 * existing caller has always got, bit for bit, so turning the flag on somewhere cannot move anything
 * elsewhere. With it on, a dancer is first offered only the spots whose DECLARED GENDER is its own, and a
 * second pass over every remaining spot makes the assignment TOTAL when the two gender counts do not line
 * up - the same two passes `assignStartSlots` has always used for the start of a track.
 *
 * WHY THE ARRANGEMENT BELONGS IN THE CORRESPONDENCE AT ALL: a formation's genders are not decoration, they
 * are the ARRANGEMENT (which spots hold a boy and which a girl), and every gate that reads a board reads
 * it. Pair a dancer with a spot the formation declares for the other gender and the shape comes out right
 * while the SETUP is a different one - the caller asks to finish in the waves and gets the same wave shape
 * with the boys on the wrong side. MEASURED over every call in the ms level against every formation the
 * picker offers (`poc/tools/end-pair-probe.mjs`): the geometry alone puts somebody on the other gender's
 * spot in **77.7%** of the 2278 pairings, 8840 spots in total.
 */
function greedyAssignEditor(
  moved: { x: number; y: number; heading: number; gender?: Gender }[],
  core: { x: number; y: number; heading?: number; gender?: Gender }[],
  preferGender = false,
): { mapping: number[]; error: number } {
  const mapping = new Array<number>(moved.length).fill(-1);
  const used = new Array<boolean>(core.length).fill(false);
  let error = 0;
  // Assign from the formation dancer farthest from the set center first.
  const order = moved
    .map((_, i) => i)
    .sort((a, b) => (moved[a].x ** 2 + moved[a].y ** 2) - (moved[b].x ** 2 + moved[b].y ** 2));
  for (const j of order) {
    let best = -1;
    let bestD = Infinity;
    for (const pass of preferGender ? [0, 1] : [1]) {
      bestD = Infinity;
      for (let i = 0; i < core.length; i++) {
        if (used[i]) continue;
        const wants = moved[j].gender;
        const has = core[i].gender;
        // Pass 0 keeps the formation's declared arrangement; pass 1 is what makes the assignment total
        // when it cannot be kept - a formation of eight boys cannot take four girls twice.
        if (pass === 0 && wants !== undefined && has !== undefined && has !== wants) continue;
        const h = core[i].heading;
        const dx = moved[j].x - core[i].x;
        const dy = moved[j].y - core[i].y;
        const dh = h === undefined ? 0 : Math.abs(normAngle(moved[j].heading - h)) * 0.5;
        const d = Math.hypot(dx, dy) + dh;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) break;
    }
    used[best] = true;
    mapping[j] = best;
    error += bestD;
  }
  return { mapping, error };
}

// Rotation granularity for editor alignment. Kept in step with the matcher
// (match.ts ROTS): recognition accepts any multiple of 45 degrees, so alignment
// must try the same steps or a 45-degree-offset formation cannot be aligned
// geometrically at all. Rot 0 is tried first so equal-error (symmetric) cases
// keep the unrotated alignment instead of spinning the set.
const ORIGIN_ROTS = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (-3 * Math.PI) / 4, -Math.PI / 2, -Math.PI / 4];

// ------------------------------------------------------------------ circle fit

/** A cubic that follows a circle: the circle, how far the curve strays from it, and how far round it goes. */
export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
  /** The worst distance from the curve to the circle over 33 samples. */
  maxDev: number;
  /** `maxDev / r` - the number the caller's "closely" is about, since a big arc tolerates more absolute slop. */
  relDev: number;
  /** Signed turn from the curve's start to its end about the centre, in radians. A quarter arc is ±PI/2. */
  sweep: number;
}

/**
 * HOW CLOSELY A CUBIC MUST FOLLOW A CIRCLE TO COUNT AS AN ARC — 2% of its own radius.
 *
 * IT IS ONE CONSTANT BECAUSE IT WAS THREE. The default here was a literal `0.02`, and `poc/src/editor-ui.ts`
 * held `ARC_FIT_TOL = 0.02` for the panel's three call sites, and `engine/test/editor.mjs` compared the
 * corpus's deviations against a third `0.02` printed as "2%". Three copies of one decision, none of them
 * able to notice the others move — the shape §11.4.4 calls a defect even when all three agree.
 *
 * AND THE NUMBER IS A GAP RATHER THAN A GUESS, which is what makes it safe to be exact. MEASURED over the
 * 234 ms curves that have a centre at all: the worst curve that IS an arc deviates 1.47e-2 of its radius and
 * the closest curve that is not deviates 4.99e-2, so 0.02 sits in an empty band with a 3.4x margin and the
 * threshold's exact value does not matter. `engine/test/editor.mjs` pins both sides of that band, so if the
 * corpus ever fills it the gate says so instead of a curve being quietly reclassified.
 */
export const ARC_FIT_TOL = 0.02;

/**
 * THE CIRCLE A CUBIC FOLLOWS, when it follows one - or null.
 *
 * A cubic Bezier does not have a centre, so "this curve is an arc" is a FIT, and the fit is exact where it
 * matters: a curve that IS the standard circular-arc construction has its end tangents perpendicular to the
 * radii at its ends, so the centre is where the two perpendiculars MEET - one linear solve, no search. Any
 * other cubic is measured against that circle and refused if it strays too far.
 *
 * THE TWO END TANGENTS ARE THE WHOLE TEST, and that is why this is cheap and stable rather than a least
 * squares over samples: for a true arc, `p0` and `p3` are both exactly `r` from the centre, and the tangent
 * at each is exactly perpendicular to its radius. So the candidate centres are the intersections of the two
 * perpendiculars - four sign combinations, of which the one that fits is kept. Parallel tangents (a straight
 * walk) have no intersection at all and return null, which is the honest answer: a straight line is not a
 * circle of infinite radius.
 *
 * `tolRel` is the caller's word "closely", as a fraction of the radius, and it is RELATIVE because the
 * absolute error of the standard construction scales with the radius: the best cubic for a quarter circle
 * misses by 2.73e-4 of the radius whatever the radius is (`engine/test/editor.mjs` 17 pins that number), so
 * the tolerance has to be a ratio to mean anything. MEASURED over the corpus in
 * `poc/tools/arc-centre-probe.mjs`, which is also where the default comes from.
 */
export function fitCircle(b: BezierData, tolRel = ARC_FIT_TOL): CircleFit | null {
  const p0 = { x: 0, y: 0 };
  const p3 = { x: b.x2, y: b.y2 };
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (!(chord > 1e-9)) return null; // a closed or degenerate curve: not a single arc
  const t0 = bezierAngle(b, 0);
  const t1 = bezierAngle(b, 1);
  const normals = [t0 + Math.PI / 2, t0 - Math.PI / 2];
  const endNormals = [t1 + Math.PI / 2, t1 - Math.PI / 2];
  let best: CircleFit | null = null;
  for (const a0 of normals) {
    for (const a1 of endNormals) {
      const n0 = { x: Math.cos(a0), y: Math.sin(a0) };
      const n1 = { x: Math.cos(a1), y: Math.sin(a1) };
      // p0 + u*n0 = p3 + v*n1  ->  u*n0 - v*n1 = p3 - p0
      const det = n0.x * -n1.y - n0.y * -n1.x;
      if (Math.abs(det) < 1e-9) continue; // parallel perpendiculars: a straight walk
      const rx = p3.x - p0.x;
      const ry = p3.y - p0.y;
      const u = (rx * -n1.y - ry * -n1.x) / det;
      if (!(u > 0)) continue; // the centre is behind the start: the other sign combination owns it
      const cx = p0.x + u * n0.x;
      const cy = p0.y + u * n0.y;
      const r = u;
      let maxDev = 0;
      for (let i = 0; i <= 32; i++) {
        const p = bezierPoint(b, i / 32);
        maxDev = Math.max(maxDev, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
      }
      const relDev = maxDev / r;
      if (best === null || relDev < best.relDev) {
        const a = Math.atan2(p0.y - cy, p0.x - cx);
        const c = Math.atan2(p3.y - cy, p3.x - cx);
        const sweep = normAngle(c - a);
        best = { cx, cy, r, maxDev, relDev, sweep };
      }
    }
  }
  if (!best || best.relDev > tolRel) return null;
  return best;
}

// ------------------------------------------------------------------ swinging an arc

/**
 * Rotate a curve's EXIT TANGENT by `theta`, holding its endpoint and its entry.
 *
 * The exit tangent of a cubic is the direction of `p3 - p2`, so the handle VECTOR is what turns - not `p2`
 * itself, which would move the tangent by less than `theta` and leave the endpoint behind. `p1` is untouched,
 * so the direction the move was entered with does not change: this re-aims where a move LEAVES from, and
 * nothing else about it.
 */
/**
 * Whether a curve HAS a departure direction to turn.
 *
 * `bezierAngle` reads the tangent at `t = 1` as the direction of `p3 - p2`, so a curve whose exit handle has
 * collapsed onto its endpoint reports a direction of `atan2(0, 0) = 0` - a CONVENTION, not a direction. There
 * is nothing there to rotate, and pretending otherwise either does nothing (rotating a zero vector) or
 * invents geometry (giving a deliberately still move a bulge). MEASURED: 22 of the 134 arc-ish moves in the
 * ms level have a previous move in exactly that state, and every one of them is why the rule below refuses to
 * claim it turned a joint it cannot.
 */
export function hasExitDirection(b: BezierData): boolean {
  return Math.hypot(b.x2 - b.cx2, b.y2 - b.cy2) > 0;
}

export function rotateCurveExit(b: BezierData, theta: number): BezierData {
  const dx = b.x2 - b.cx2;
  const dy = b.y2 - b.cy2;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  return { ...b, cx2: b.x2 - rx, cy2: b.y2 - ry };
}

/** Rotate every control and the endpoint of a curve about its own start point: a rigid swing. */
export function rotateCurveAboutStart(b: BezierData, theta: number): BezierData {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const rot = (x: number, y: number) => ({ x: x * c - y * s, y: x * s + y * c });
  const p1 = rot(b.cx1, b.cy1);
  const p2 = rot(b.cx2, b.cy2);
  const p3 = rot(b.x2, b.y2);
  return { ...b, cx1: p1.x, cy1: p1.y, cx2: p2.x, cy2: p2.y, x2: p3.x, y2: p3.y };
}

/**
 * A move's "face along travel" heading profile, written as a FACING CURVE THE FORMAT CAN CARRY.
 *
 * A travel curve's tangent starts at `bezierAngle(t, 0) = atan2(cy1, cx1)`, which is off the dancer's
 * forward axis whenever the path departs at an angle - and a facing curve's FIRST control has no `y` in
 * the format at all (`tamination.dtd` declares the rotate as `cx3, cx4, cy4, x4, y4`; `bezRotAttr` emits
 * those five and never `sel.cy1`). So a facing curve copied straight from a travel curve - which is what
 * `swingArcAboutStart` used to write - loses its first span the moment the file is re-read, and the corpus
 * contains no such facing for exactly that reason (`poc/tools/facing-handle-probe.mjs` section 1 pins
 * `cy1 === 0` over every one of them).
 *
 * The construction keeps BOTH ends: turn the whole curve so its start lies on the forward axis (which is
 * what drives `cy1` to 0), then turn its exit tangent back so the heading change it ENDS on is the one it
 * started with. The end matters more than the middle here - the heading a move ends on is the frame the
 * next move is played in, which is the thing `swingArcAboutStart` is holding.
 */
function facingFromTravel(t: BezierData): BezierData {
  const a0 = bezierAngle(t, 0);
  return rotateCurveExit(rotateCurveAboutStart(t, -a0), a0);
}

/**
 * SWING AN ARC ABOUT ITS START POINT, KEEPING THE DANCE TANGENT-CONTINUOUS ACROSS THE JOINT.
 *
 * The caller drags the centre of a curve that is closely a circle, and the gesture is a rigid rotation of the
 * whole curve about its start: the radius and the arc are preserved EXACTLY (a rigid motion cannot change
 * either) and the end swings round the start at a fixed distance.
 *
 * A RIGID ROTATION TURNS THE JOINT WITH IT, and that is the thing worth getting right. The direction the
 * dancer ARRIVES with is "perpendicular to the radius" on any arc, so it cannot be held while the arc
 * rotates - holding it is what stops the curve being an arc at all. What CAN be held is the TRANSITION: the
 * previous move's exit tangent is turned by the same `theta`, so the dancer leaves the previous move along the
 * new entry direction instead of hitting a corner.
 *
 * AND THE FRAME AFTER THE PREVIOUS MOVE MUST NOT MOVE, or the swing would be undone: `poseFor` reads the
 * heading change of a move as `bezierAngle(rotate ?? translate, 1)`, so re-aiming that move's travel would
 * also rotate the frame this arc is played in - and rotating the arc in a rotated frame puts it back where it
 * started, a gesture that visibly does nothing. So:
 *
 *   - if the previous move HAS a facing curve, its heading change is authored and re-aiming the travel does
 *     not touch it - nothing more to do;
 *   - if it has NONE, the travel curve WAS the facing, so one is written: a copy of the ORIGINAL travel
 *     curve, which is exactly the heading profile the move already had ("face along travel"), frozen so that
 *     re-aiming the path cannot turn the frame.
 *
 * `k` = 0 has no previous move: the call simply starts in a different direction, which is the honest answer
 * for the first move of a call - there is no joint to keep.
 */
export function swingArcAboutStart(call: CallBundle, dancer: number, k: number, theta: number, tolRel = 0.02): CallBundle {
  const base = normalizeInstance(call);
  const d = base.dancers[dancer];
  if (!d) throw new Error(`swingArcAboutStart: no dancer ${dancer}`);
  const seg = d.path[k];
  if (!seg) throw new Error(`swingArcAboutStart: dancer ${dancer} has no move ${k}`);
  if (!fitCircle(seg.translate, tolRel)) {
    throw new Error(`swingArcAboutStart: dancer ${dancer}'s move ${k} is not closely a circle, so it has no centre to swing about`);
  }
  const swung = setMove(base, dancer, k, { ...seg, translate: rotateCurveAboutStart(seg.translate, theta) });
  if (k === 0) return swung;
  const original = d.path[k - 1];
  // A PREVIOUS MOVE WITH NO DEPARTURE DIRECTION CANNOT FOLLOW, and it is left alone rather than given one:
  // its exit handle has collapsed onto its endpoint (a `Stand`, or any move that arrives with nothing left to
  // travel), so there is no direction to turn - and inventing one would deform a move that was authored to
  // sit still. The tangent the engine reports there is `atan2(0, 0)` either way, so the JOINT KEEPS WHATEVER
  // ANGLE IT HAD and the panel says so; that is a measurement, not an oversight. It also means the frame
  // does not rotate in that case, so no facing curve is needed and none is written.
  if (!hasExitDirection(original.translate)) return swung;
  const prev = swung.dancers[dancer].path[k - 1];
  const reaimed: Seg = {
    ...prev,
    translate: rotateCurveExit(prev.translate, theta),
    // A facing curve only where the move had none: then its travel WAS its facing, and freezing the ORIGINAL
    // travel curve keeps the heading change - and therefore the frame - exactly what it was. Written through
    // `facingFromTravel` rather than as a copy, because the FIRST control of a facing curve has no `y` in
    // the format: a copy survived only until the file was re-read, at which point its first span was gone.
    rotate: original.rotate ? prev.rotate : facingFromTravel(original.translate),
  };
  return setMove(swung, dancer, k - 1, reaimed);
}

// ------------------------------------------------------------------ pad segments

function rot(a: number, v: { x: number; y: number }): { x: number; y: number } {
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
}

/**
 * Move a move's END POINT to `(x2, y2)`, holding the direction the dancer LEAVES on.
 *
 * WHAT "THE END POINT MOVES" MEANS, AND WHY THE DIRECTION HAS TO BE HELD WITH IT. A move's translation
 * curve is authored in dancer-local coordinates, and `poseFor` composes the chain as
 * `m = m * translateBy(p3); m = m * rotateBy(a)` with `a = bezierAngle(rotate ?? translate, 1)`. So the
 * point the move ends on is `p3`, and the heading it ends on - which IS the frame the NEXT move is played
 * in - is the angle of the curve's tangent at `t = 1`, which for a cubic is exactly the direction of
 * `p3 - p2`. Moving `p3` alone therefore changes BOTH, and the second one is a side effect nobody asked
 * for: the rest of the track swings.
 *
 * `bezierAngle` is `atan2` of that tangent, so only its DIRECTION matters - and preserving the exit handle
 * VECTOR `p3 - p2` outright makes the tangent at `t = 1` bit-identical, which:
 *
 *   - leaves a move with NO facing curve ending on exactly the heading it ended on;
 *   - leaves the travel direction at the end of the move unchanged when there IS one, where the heading
 *     comes from the rotation curve instead (`bezierAngle(s.rotate ?? ...)`) and would otherwise be the
 *     only thing holding the two together;
 *   - and therefore leaves the frame the next move starts in ROTATED exactly as it was, so the whole
 *     downstream track keeps its shape, its headings and its direction, and is merely carried to the new
 *     end point. MEASURED in `editor.mjs` section 22, both with and without a facing curve.
 *
 * The handle vector is held rather than its length alone because it is the one quantity that fixes both
 * the direction and the exit shape (the last span of the cubic), so the curve stays as close to what the
 * caller authored as a change of destination can.
 *
 * THE HANDLE VECTOR IS PRESERVED, INCLUDING WHEN IT IS THE ZERO VECTOR: `p2` moves with `p3`, so a curve
 * whose exit handle is degenerate STAYS degenerate and `atan2(0, 0)` goes on reporting the heading it
 * reported before. Leaving `p2` behind instead INVENTS a tangent where there was none, and the tail swings -
 * which is what the corpus sweep caught (`poc/tools/move-end-probe.mjs`): **144 of the 884** movable moves in
 * the ms level have a zero-length exit handle, and every one of them turned by up to 35deg under the guard
 * that was supposed to be handling that case.
 */
export function moveCurveEnd(b: BezierData, x2: number, y2: number): BezierData {
  const dx = b.x2 - b.cx2;
  const dy = b.y2 - b.cy2;
  return { ...b, cx2: x2 - dx, cy2: y2 - dy, x2, y2 };
}

/**
 * HOLD THE FOLLOWING TRACE: rotate every move after `k` about its own start by `-delta`, so that a facing
 * edit at `k` changes the HEADINGS and leaves the following paths' floor placement bit-identical.
 *
 * WHY THIS IS NEEDED, and it is a defect of the GESTURE rather than of the format. `poseFor` places each
 * move's local curve in the frame the move STARTS in (`m = m * translateBy(p); m = m * rotateBy(a)`), so
 * turning the heading a move ends on by `delta` rotates every later local curve by `delta` on the floor.
 * That is the composition working, but it means a facing drag changes the facing AND the following path by
 * the SAME angle - so the angle between the dancer's facing and the direction they leave on is a constant
 * of the data, and the one relationship a facing expresses is the one thing the control cannot set.
 * MEASURED (`poc/tools/facing-chain-probe.mjs`): a 10.000deg edit to `Circle Left`'s move 2 moves every
 * later drawn direction by 10.00deg and every later heading by 10.000deg.
 *
 * THE COMPENSATION IS EXACT AND IS A RIGID ROTATION. A later move's floor point is
 * `p0 + R(theta) * local`; the edit takes `theta` to `theta + delta`, so taking `local` to `R(-delta) *
 * local` leaves the product unchanged - same start, same shape, same floor direction, same end point. Note
 * what is NOT touched: the `rotate` curve, so the same turnaround happens; and the frame beyond, because a
 * later move with no facing curve has its heading contribution fall by `delta` while the incoming frame
 * rises by `delta`, and one WITH a facing curve contributes the same as before. So no cascade is needed -
 * one pass over the tail is the whole operation.
 *
 * `delta = 0` is the IDENTITY, so a drag that has not moved writes byte-identical XML.
 */
export function holdFollowingTrace(call: CallBundle, dancer: number, k: number, delta: number): CallBundle {
  const d = call.dancers[dancer];
  if (!d || delta === 0) return call;
  let next = call;
  for (let j = k + 1; j < d.path.length; j++) {
    const seg = next.dancers[dancer].path[j];
    if (!seg) break;
    next = setMove(next, dancer, j, { ...seg, translate: rotateCurveAboutStart(seg.translate, -delta) });
  }
  return next;
}

// ------------------------------------------------------------------ the run-level circle

/**
 * The largest turn ONE move may carry, and it is the corpus's own limit rather than a taste.
 *
 * MEASURED (`poc/tools/wysiwyg-path-probe.mjs` part 1): of the **10884** travel curves in the corpus that lie on
 * a circle within 2% of its radius, the sweeps run from 10.1deg to **90.0deg** with a median of exactly 90deg -
 * NOT ONE exceeds a quarter. So the format's own convention is at most a quarter turn per move, and a 360deg
 * `Circle Left` is authored as EIGHT moves of 45deg.
 *
 * AND IT IS THE ACCURACY LIMIT TOO, which is why it is enforced rather than merely observed. The standard
 * construction's error is O(theta^6): a quarter arc misses its circle by 2.72e-4 of the radius, and a single
 * cubic SEMICIRCLE is about 100x worse (2.7e-2). Past a quarter the curve visibly leaves the circle, so a run
 * that cannot carry the turn in quarters is refused with the number of moves it needs.
 */
export const RUN_ARC_MAX = Math.PI / 2;

/** How many moves a turn needs, at most a quarter each. Always at least one, so a tiny turn is not zero. */
export function runCircleMoveCount(sweep: number): number {
  return Math.max(1, Math.ceil(Math.abs(sweep) / RUN_ARC_MAX - 1e-9));
}

/**
 * Radians as degrees, for a message a caller reads.
 *
 * `DEG` IN THIS ENGINE IS `PI / 180` - it converts degrees TO radians - so `rad * DEG` is not a conversion at
 * all, it is a number 3283 times too small. That is not a hypothetical: it made this file's own refusal say
 * "move 2 would have to turn 0.0deg" for a move that had to turn 120, which reads as a broken guard rather
 * than a broken run.
 */
function degrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** A circle and the turn to be taken on it. */
export interface RunCircle {
  cx: number;
  cy: number;
  r: number;
  /** The signed total turn: positive is counter-clockwise, and the sign is which way round the circle. */
  sweep: number;
}

/**
 * How far a RUN of moves turns, in radians - the sum of the turns its individual moves make.
 *
 * It exists because `fitCircleRun` can say no: a run that is not close enough to a circle has no centre, no
 * radius and no sweep, but it still TURNS, and that turn is the only thing that can tell a `circleThrough` on
 * its ends whether the run goes a little way round or most of the way round. Without it the minor arc is
 * chosen, and for a run whose ends are close together - a near-closed orbit - the minor arc is nothing at all:
 * MEASURED, `ms/circle.xml` moves 2..9 turn 361.2deg and the minor arc between those ends is 1.2deg, which
 * collapsed a 16.34-unit orbit to 0.06. The sweep of a fitted circle is the better answer when there is one
 * because it is measured on the whole path; this is the answer that always exists.
 */
export function runTurn(call: CallBundle, index: number, kFrom: number, kTo: number): number {
  const dancer = call.dancers[index];
  if (!dancer) return 0;
  let total = 0;
  for (let k = Math.max(0, kFrom); k <= kTo && k < dancer.path.length; k++) {
    const t = dancer.path[k].translate;
    total += normAngle(bezierAngle(t, 1) - bezierAngle(t, 0));
  }
  return total;
}

/**
 * The circle of radius `radius` through two points, on the side of the chord the caller names - or null when
 * there is none.
 *
 * THIS IS THE WHOLE DEGREE OF FREEDOM, and it is worth stating because it is smaller than it looks. A circular
 * arc has five numbers (centre, radius, and the two angles); pinning BOTH endpoints is four equations, so
 * **one continuous degree of freedom remains** - the radius - **plus one discrete one**, which side of the
 * chord the centre falls on. Everything else follows, INCLUDING both end headings: an arc's tangent is
 * perpendicular to its radius, so the heading the run arrives on is *derived*, not chosen. That is why this is
 * a safe primitive: there is no way to ask for an arc that does not join up.
 *
 * The sweep returned is the MINOR arc unless a `turn` is given, and a major arc is the same circle with the
 * other sign of the centre's offset - so the two are never ambiguous when the caller has nothing to say.
 *
 * Two cases have no answer and return null rather than a guess: COINCIDENT endpoints (the chord is a point, so
 * it defines no circle at all - a full turn is a different parameterisation, and this is exactly the case
 * `fitCircle`'s own chord guard refuses) and a radius too SHORT to span the chord (`r < d/2`).
 */
export function circleThrough(
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
  side: 1 | -1,
  turn?: number,
): RunCircle | null {
  const r = Math.abs(radius);
  if (!(r > 1e-9)) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-9)) return null;
  if (r < d / 2 - 1e-9) return null;
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
  const ux = dx / d;
  const uy = dy / d;
  const cx = (a.x + b.x) / 2 + side * h * -uy;
  const cy = (a.y + b.y) / 2 + side * h * ux;
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const a1 = Math.atan2(b.y - cy, b.x - cx);
  // ------------------------------------------------------------------ minor is NOT enough
  //
  // THERE ARE TWO ARCS THROUGH TWO POINTS ON A GIVEN CIRCLE, and the endpoints do not say which. This function
  // used to return the minor one always, and the failure is not theoretical: MEASURED over the ms level
  // (`poc/tools/run-circle-probe.mjs`), **48 of 527** runs lost most of their length when re-laid on their own
  // circle, and the worst were catastrophic - `ms/circle.xml` moves 2..9 turn **361.2deg** through a chord of
  // **0.0554** on a radius of 2.595, so the minor arc between those ends is **1.2deg** and a 16.34-unit orbit
  // collapsed to 0.06. That is the flagship case: a 360deg `Circle Left`, whose ends are the same point.
  //
  // The missing quantity is the one SVG calls `large-arc-flag`, and the honest place to get it is THE RUN
  // ITSELF: `turn` is the turn the run already takes, and the arc is the sweep going from `a` to `b` that
  // agrees with it. Sweeps congruent modulo a full turn are the SAME arc through the same two points, so
  // adding whole turns changes nothing about where the ends are and only says how many times round - which is
  // exactly the difference between the minor and the major arc, and between a 3/4 turn and a -1/4 turn.
  // A 3/4 turn is the case that proves the wrap is needed: its ends are 90deg apart, so the base sweep is
  // **-90deg** and the answer is base + 360 = 270, not "the closest of two candidates".
  //
  // With no `turn` the minor arc is returned, which is the old behaviour and the right default for a run that
  // has no turn of its own to keep.
  //
  // THE LINE BELOW IS NOT A NORMALISER, and must not be "consolidated" into `normAngle`: it picks the 2PI-
  // CONGRUENT VALUE NEAREST `turn`, which is what keeps a 3/4 turn a 3/4 turn instead of -1/4. `normAngle`
  // collapses into (-PI, PI] and cannot say 270 degrees at all.
  const base = normAngle(a1 - a0);
  const sweep = Number.isFinite(turn) ? base + Math.round(((turn as number) - base) / (2 * Math.PI)) * 2 * Math.PI : base;
  return { cx, cy, r, sweep };
}

/** The world pose of one dancer at absolute beat `t`, or the pose a run starts from. */
function frameAt(dancer: DancerSpec, beat: number): Pose {
  return poseFor(dancer, beat);
}

/** The beat at which move `k` begins for this dancer. */
function moveStartBeat(dancer: DancerSpec, k: number): number {
  return k === 0 ? 0 : moveBeatRange(dancer, k - 1).to;
}

/** The beat at which move `k` ends for this dancer. */
function moveEndBeat(dancer: DancerSpec, k: number): number {
  return moveBeatRange(dancer, k).to;
}

/**
 * The circle a RUN of consecutive moves follows, or null.
 *
 * THE END TANGENTS CANNOT DO THIS JOB, which is why it is a least-squares fit over the whole run rather than
 * the exact one-linear-solve construction `fitCircle` uses for a single curve. That construction finds the
 * centre where the two end perpendiculars MEET, and a run may CLOSE ON ITSELF: `ms/circle.xml` is a 360deg
 * `Circle Left` whose start and end tangents are PARALLEL, so the perpendiculars never meet and the answer
 * would be "a straight line". Sampling the run and fitting the points has no such blind spot.
 *
 * Kasa's algebraic fit, so the caveat is recorded rather than hidden: on a PARTIAL arc it is biased toward
 * small circles, because the algebraic residual is `d(2r + d)` rather than `d`. It is used here because the
 * run is sampled densely across the whole turn, where that bias is smallest, and because the alternative
 * (Pratt/Taubin) is a generalised eigenproblem for a gain this measurement does not need. `tolRel` is the
 * caller's "closely", relative to the radius, exactly as `fitCircle`'s is.
 *
 * AND A RELATIVE TOLERANCE ALONE IS NOT ENOUGH, which is the other half of this function. A nearly STRAIGHT run
 * can sit inside any relative tolerance on a huge enough circle, and then the circle says nothing about the
 * run: MEASURED, `ms/grand_spin.xml` moves 22..23 are a 1.5-unit path that turns 2.67deg, and Kasa describes
 * them as a circle of radius **28.23** at a relative deviation of 1.6e-2, just inside the default. Re-laying
 * that run on that circle moved its end 0.73 units. `RUN_FIT_MAX_DEV` bounds the worst deviation against the
 * run's OWN LENGTH as well, and the corpus separates cleanly: of 2253 accepted run fits the two bad ones sit at
 * **29.9%** and **14.7%** of the path length and the worst that SHOULD be kept is **3.8%**, so any threshold
 * between them makes the same decision on every run in the corpus.
 */
export const RUN_FIT_MAX_DEV = 0.05;

export function fitCircleRun(call: CallBundle, index: number, kFrom: number, kTo: number, tolRel = ARC_FIT_TOL, samplesPerMove = 8): CircleFit | null {
  const dancer = call.dancers[index];
  if (!dancer) return null;
  if (kFrom < 0 || kTo >= dancer.path.length || kTo < kFrom) return null;
  const pts: { x: number; y: number }[] = [];
  for (let k = kFrom; k <= kTo; k++) {
    const from = moveStartBeat(dancer, k);
    const to = moveEndBeat(dancer, k);
    for (let i = 0; i <= samplesPerMove; i++) {
      if (k > kFrom && i === 0) continue; // the shared joint is written by the previous move's t=1
      const p = frameAt(dancer, from + ((to - from) * i) / samplesPerMove);
      pts.push({ x: p.x, y: p.y });
    }
  }
  if (pts.length < 3) return null;
  let Suu = 0, Svv = 0, Suv = 0, Su = 0, Sv = 0, Sw = 0, Suw = 0, Svw = 0;
  for (const p of pts) {
    const w = p.x * p.x + p.y * p.y;
    Suu += p.x * p.x; Svv += p.y * p.y; Suv += p.x * p.y;
    Su += p.x; Sv += p.y; Sw += w;
    Suw += p.x * w; Svw += p.y * w;
  }
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [[Suu, Suv, Su], [Suv, Svv, Sv], [Su, Sv, pts.length]];
  const rhs = [-Suw, -Svw, -Sw];
  const det = det3(M);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const swap = (c: number) => M.map((row, i) => row.map((v, j) => (j === c ? rhs[i] : v)));
  const D = det3(swap(0)) / det;
  const E = det3(swap(1)) / det;
  const F = det3(swap(2)) / det;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
  const relDev = maxDev / r;
  if (relDev > tolRel) return null;
  // The absolute half of the test - see RUN_FIT_MAX_DEV. The run's own length is the polyline the samples
  // already are, so this costs one pass and no extra sampling.
  let runLength = 0;
  for (let i = 1; i < pts.length; i++) runLength += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (!(runLength > 1e-9) || maxDev > RUN_FIT_MAX_DEV * runLength) return null;
  let sweep = 0;
  let prev = Math.atan2(pts[0].y - cy, pts[0].x - cx);
  for (let i = 1; i < pts.length; i++) {
    const ang = Math.atan2(pts[i].y - cy, pts[i].x - cx);
    sweep += normAngle(ang - prev);
    prev = ang;
  }
  return { cx, cy, r, maxDev, relDev, sweep };
}

/**
 * Lay a RUN of consecutive moves along an arc, leaving everything outside the run EXACTLY as it was.
 *
 * The run keeps its move count, its beats and its hands: what changes is only the shape between its two ends,
 * which is the point. THE TURN IS SPREAD IN PROPORTION TO BEATS, so a call that spends twice as long on one
 * part of its circle travels twice as far round it - and a 45deg `Circle Left` move stays a 45deg move.
 *
 * HOW THE FRAMES ARE HANDLED, because this is where a path rewrite goes wrong. The stored curve is local: the
 * arc is built in WORLD coordinates and then re-expressed in the frame each move starts in, and THAT FRAME
 * MOVES WITH THE REWRITE. So the frames are recomputed as the run is written, not read from where they used to
 * be:
 *  - the frame's position is the sub-arc's own start point, so the joints land ON the circle;
 *  - the frame's heading advances by the FACING channel's own rule - a move with a `rotate` curve keeps its
 *    authored turn (which is the thing a caller wrote), and a move without one takes the arc's tangent, so a
 *    dancer with no facing curve ends up walking the circle;
 *  - the facing curves themselves are not touched. The relative turn a move was authored with survives, and
 *    only the frame it is played in is new.
 *
 * THROWS rather than approximating, in three cases, each with the reason: a turn a move would have to take
 * more than a quarter of (naming how many moves it needs), a run that starts off the circle, and a run with a
 * move that has no beats.
 */
export function setRunCircle(call: CallBundle, index: number, kFrom: number, kTo: number, circle: RunCircle, tolRel = 0.02): CallBundle {
  const dancer = call.dancers[index];
  if (!dancer) throw new Error(`no dancer ${index}`);
  if (kFrom < 0 || kTo >= dancer.path.length || kTo < kFrom) throw new Error(`no such run ${kFrom}..${kTo}`);
  const r = Math.abs(circle.r);
  if (!(r > 1e-9)) throw new Error('the circle has no radius');
  const run = dancer.path.slice(kFrom, kTo + 1);
  if (run.some((s) => !(s.beats > 0))) throw new Error('the run contains a move with no beats, so there is nothing to spread the turn over');
  const totalBeats = run.reduce((s, g) => s + g.beats, 0);
  const need = runCircleMoveCount(circle.sweep);
  if (need > run.length) {
    throw new Error(`a ${degrees(Math.abs(circle.sweep)).toFixed(1)}deg turn needs ${need} moves and the run has ${run.length}`);
  }
  const thetas = run.map((s) => (circle.sweep * s.beats) / totalBeats);
  thetas.forEach((theta, i) => {
    if (Math.abs(theta) > RUN_ARC_MAX + 1e-9) {
      throw new Error(`move ${kFrom + i + 1} would have to turn ${degrees(Math.abs(theta)).toFixed(1)}deg and a move carries at most 90deg - spread the turn over more moves, or over moves with more even beats`);
    }
  });
  const start = frameAt(dancer, moveStartBeat(dancer, kFrom));
  const off = Math.hypot(start.x - circle.cx, start.y - circle.cy);
  if (!(off > 1e-9)) throw new Error('the run starts at the centre of the circle, which is no radius at all');
  if (Math.abs(off - r) > tolRel * Math.max(1, r)) {
    throw new Error(`the run starts ${off.toFixed(3)} from the centre and the radius asked for is ${r.toFixed(3)}, which is a different circle`);
  }
  // THE RADIUS IS THE ONE THAT PASSES THROUGH WHERE THE RUN STARTS, so the start lands exactly on the circle by
  // construction and the run's first pose does not move at all. That matters because the centre is what a
  // caller means by "this circle" and the radius is only how big it is - and it is what lets a run be re-laid
  // on its OWN LEAST-SQUARES FIT, which by definition does not put the sampled points exactly on the circle
  // (measured: ms/circle.xml's fit sits 2.597 units from the centre at a fitted radius of 2.595). The
  // tolerance above is what stops that from becoming licence to move the run onto a different circle
  // altogether. The one thing this costs is the END: it lands where this circle puts it, which is within the
  // fit's own error of where it was, and that is the honest price of snapping a run onto a circle.
  const rr = off;
  const next = dancer.path.slice();
  let angle = Math.atan2(start.y - circle.cy, start.x - circle.cx);
  let h = start.heading;
  let px = start.x;
  let py = start.y;
  for (let i = 0; i < run.length; i++) {
    const seg = run[i];
    const theta = thetas[i];
    const a0 = angle;
    const a1 = angle + theta;
    const kk = (4 / 3) * Math.tan(theta / 4);
    const P0 = { x: circle.cx + rr * Math.cos(a0), y: circle.cy + rr * Math.sin(a0) };
    const P3 = { x: circle.cx + rr * Math.cos(a1), y: circle.cy + rr * Math.sin(a1) };
    const P1 = { x: P0.x - kk * rr * Math.sin(a0), y: P0.y + kk * rr * Math.cos(a0) };
    const P2 = { x: P3.x + kk * rr * Math.sin(a1), y: P3.y - kk * rr * Math.cos(a1) };
    // Into this move's own frame: the frame's position is the sub-arc's start, its heading is the dancer's.
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    const inv = (q: { x: number; y: number }) => ({
      x: cos * (q.x - px) + sin * (q.y - py),
      y: -sin * (q.x - px) + cos * (q.y - py),
    });
    const p1 = inv(P1);
    const p2 = inv(P2);
    const p3 = inv(P3);
    next[kFrom + i] = {
      ...seg,
      translate: { cx1: p1.x, cy1: p1.y, cx2: p2.x, cy2: p2.y, x2: p3.x, y2: p3.y },
    };
    // Advance the frame the way the FACING channel says, so an authored turn survives and a missing facing
    // curve keeps meaning "walk the way you are going".
    px = P3.x;
    py = P3.y;
    h = seg.rotate ? h + bezierAngle(seg.rotate, 1) : Math.atan2(P3.y - P2.y, P3.x - P2.x);
    angle = a1;
  }
  const dancers = call.dancers.slice();
  dancers[index] = { ...dancer, path: next };
  return { ...call, dancers };
}

/** Build one padding segment that carries a dancer from `from` to `to`. */
export function padSegment(from: { x: number; y: number; heading: number }, to: { x: number; y: number; heading: number }, beats: number): Seg {
  const d = rot(-from.heading, { x: to.x - from.x, y: to.y - from.y });
  const translate: BezierData = {
    cx1: d.x / 3,
    cy1: d.y / 3,
    cx2: (d.x * 2) / 3,
    cy2: (d.y * 2) / 3,
    x2: d.x,
    y2: d.y,
  };
  const a = normAngle(to.heading - from.heading);
  // Rotation Bezier, same construction as taminations Movement.fromTransform.
  const dx = Math.abs(a) / 3;
  const rotate: BezierData = {
    cx1: dx,
    cy1: 0,
    cx2: Math.cos(a / 2) - dx * Math.cos(a),
    cy2: Math.sin(a / 2) - dx * Math.sin(a),
    x2: Math.cos(a / 2),
    y2: Math.sin(a / 2),
  };
  return { beats, hands: 'none', translate, rotate };
}

// ------------------------------------------------------------------ synthesis

/**
 * Synthesize a new setup for `core` by padding its core moves from `setup.start`
 * to the core's native start, then from the core's native end to `setup.end`.
 *
 * Mirrored (half-set) core dancers are supported: poseFor already yields their
 * actual full-set start/end positions, and re-basing them at those positions
 * with `mirror:false` reproduces the authored path exactly.
 *
 * INDEX INDEPENDENCE: `setup.start` / `setup.end` are treated as dancer SETS. The
 * correspondence to the core is derived geometrically (orderLikeCore), so passing
 * them already in core order is the identity and passing them in any other order
 * is corrected rather than silently swapping dancers' start/end spots.
 */
export function synthesizeSetup(core: CallBundle, setup: NewSetup): CallBundle {
  if (setup.start.length !== core.dancers.length || setup.end.length !== core.dancers.length) {
    throw new Error(
      `synthesizeSetup: start/end must have ${core.dancers.length} dancers (got ${setup.start.length}/${setup.end.length})`,
    );
  }
  const padBeats = setup.padBeats ?? 2;
  const coreBeats = core.beats;
  const coreStartPoses = core.dancers.map((d) => poseFor(d, 0));
  const coreEndPoses = core.dancers.map((d) => poseFor(d, core.beats));
  // The new START is matched against the core's start (the pad-in leaves from it)
  // and the new END against the core's end (the pad-out arrives from it), each by
  // geometry rather than trusting array order.
  const start = orderLikeCore(coreStartPoses, setup.start);
  const end = orderLikeCore(coreEndPoses, setup.end);

  const newDancers: DancerSpec[] = core.dancers.map((d, i) => {
    const coreStart = poseFor(d, 0);
    const coreEnd = poseFor(d, coreBeats);
    const s = start[i];
    const e = end[i];
    const padIn = padSegment({ x: s.x, y: s.y, heading: s.heading }, { x: coreStart.x, y: coreStart.y, heading: coreStart.heading }, padBeats);
    const padOut = padSegment({ x: coreEnd.x, y: coreEnd.y, heading: coreEnd.heading }, { x: e.x, y: e.y, heading: e.heading }, padBeats);
    padOut.hands = d.path.length ? d.path[d.path.length - 1].hands : 'none';
    return {
      gender: d.gender,
      x: s.x,
      y: s.y,
      angleDeg: s.heading / DEG,
      mirror: false,
      path: [padIn, ...d.path, padOut],
    };
  });

  const beats = padBeats + coreBeats + padBeats;
  return {
    title: core.title,
    from: setup.name,
    // NULL, and it is the same answer the round trip gives: `setupToXml` writes this bundle in EMBED
    // mode, where the dancers are inline and `callToXml` emits no `formation` attribute at all. So
    // this setup reaches the state vocabulary through `allVariantSetups()` (its GEOMETRY), not through
    // a declared name - which is right, because `setup.name` is a user's LABEL for a shape, not a
    // reference into `formations.xml`.
    formation: null,
    // An EDITOR-authored bundle starts from a board, not from a corpus definition, so it has no stored tags.
    formationTag: { fid: null, aid: null },
    // THE SAME BODY: a synthesised setup re-poses the call on a different start set, which cannot change how it goes.
    // Leaving it off would make a `- Far` authoring indistinguishable from a plain one once re-posed.
    going: core.going,
    parts: core.parts,
    taminator: core.taminator,
    dancers: newDancers,
    beats,
    leadin: core.leadin,
    leadout: core.leadout,
    totalBeats: core.leadin + beats + core.leadout,
    // A synthesised setup is the SAME call with a different start set, so it inherits the
    // core's sequencer flags. Leaving them off would be actively wrong now that
    // `forSequencer` gates matching: a synthesised variant of a `sequencer="no"` call
    // would default to eligible and re-open the demonstration hole the gate exists to
    // close, and a synthesised variant of a `gender-specific` call would silently lose
    // its gender gate.
    sequencerMode: core.sequencerMode,
    forSequencer: core.forSequencer,
    genderSpecific: core.genderSpecific,
    // A SYNTHESIZED SETUP IS A WHOLE SET, so its symmetry is 1 - take the eight dancers as written.
    // This is the declaration of a fact the reader already had to know: `rebuildInstance` reads an
    // exported instance back with `mirror: false` precisely because the eight dancers are explicit
    // and completing them again would return sixteen. Stating it here means the datum travels with
    // the bundle instead of living in the reader.
    symmetry: 1,
  };
}

export interface ChainSpec {
  name: string;
  /** New start (e.g. a pre-call's end). Treated as a dancer SET: the
   * correspondence to `coreA` is derived geometrically, not from array order. */
  start: FormDancer[];
  /** New end (e.g. a post-call's start). Same: a set, matched geometrically. */
  end: FormDancer[];
  /** Beats for the leading pad-in / trailing pad-out (default 1). */
  leadBeats?: number;
  /** Beats for the connector between the two cores (default 2). */
  connectorBeats?: number;
}

/**
 * Synthesize a new setup by CONCATENATING two existing setups of the same call
 * with a small connector between them:
 *
 *   [start] --lead-in--> coreA.start, then coreA runs, then a connector into
 *   coreB.start, then coreB runs, ending at [end].
 *
 * This reuses the START-anchored setup's core as the lead-in and the
 * END-anchored setup's core as the lead-out, matching the "reuse existing
 * lead-in/out moves" goal. Mirrored (half-set) dancers are re-based at their
 * full-set positions like synthesizeSetup.
 *
 * INDEX INDEPENDENCE: the two cores are JOINTLY aligned on a common reference
 * (coreA's start formation) and the identity of a dancer is coreA's dancer index.
 * Which coreB dancer that same person becomes is therefore DERIVED by geometry —
 * it is NOT assumed to be coreB.dancers[i]. `spec.start`/`spec.end` are likewise
 * matched geometrically rather than trusted in array order.
 */
export function synthesizeSetupChain(coreA: CallBundle, coreB: CallBundle, spec: ChainSpec): CallBundle {
  const n = coreA.dancers.length;
  if (coreB.dancers.length !== n || spec.start.length !== n || spec.end.length !== n) {
    throw new Error(
      `synthesizeSetupChain: cores/start/end must all have ${n} dancers (got ${coreA.dancers.length}/${coreB.dancers.length}/${spec.start.length}/${spec.end.length})`,
    );
  }
  const leadBeats = spec.leadBeats ?? 1;
  const connBeats = spec.connectorBeats ?? 2;

  const aStarts = coreA.dancers.map((d) => poseFor(d, 0));
  const bStarts = coreB.dancers.map((d) => poseFor(d, 0));
  const bEnds = coreB.dancers.map((d) => poseFor(d, coreB.beats));
  // coreA identity i -> the coreB dancer that is the same person, by geometry.
  const bFor = deriveFormationMapping(aStarts, bStarts);
  // The new start is matched against coreA's start; the new end against coreB's
  // end (the pad-out arrives from it).
  const start = orderLikeCore(aStarts, spec.start);
  const end = orderLikeCore(bEnds, spec.end);

  const newDancers: DancerSpec[] = coreA.dancers.map((d, i) => {
    const bi = bFor[i];
    const aStart = poseFor(coreA.dancers[i], 0);
    const aEnd = poseFor(coreA.dancers[i], coreA.beats);
    const bStart = poseFor(coreB.dancers[bi], 0);
    const bEnd = poseFor(coreB.dancers[bi], coreB.beats);
    const s = start[i];
    const e = end[bi];
    const padIn = padSegment(s, aStart, leadBeats);
    const connector = padSegment(aEnd, bStart, connBeats);
    const padOut = padSegment(bEnd, e, leadBeats);
    return {
      gender: d.gender,
      x: s.x,
      y: s.y,
      angleDeg: s.heading / DEG,
      mirror: false,
      path: [padIn, ...coreA.dancers[i].path, connector, ...coreB.dancers[bi].path, padOut],
    };
  });

  const beats = leadBeats + coreA.beats + connBeats + coreB.beats + leadBeats;
  return {
    title: coreA.title,
    from: spec.name,
    // NULL, for the same reason as `synthesizeSetup`: an EMBED-mode authoring with a user's label.
    formation: null,
    // An EDITOR-authored bundle starts from a board, not from a corpus definition, so it has no stored tags.
    formationTag: { fid: null, aid: null },
    going: coreA.going,
    parts: coreA.parts,
    taminator: coreA.taminator,
    dancers: newDancers,
    beats,
    leadin: coreA.leadin,
    leadout: coreA.leadout,
    totalBeats: coreA.leadin + beats + coreA.leadout,
    // Inherited from the FIRST core of the chain, for the same reason as synthesizeSetup.
    sequencerMode: coreA.sequencerMode,
    forSequencer: coreA.forSequencer,
    genderSpecific: coreA.genderSpecific,
    // Whole set, as with synthesizeSetup: the chain is written out dancer by dancer.
    symmetry: 1,
  };
}

// ------------------------------------------------------------------ closure fix

/** The actual end poses (positions + headings) of a call's dancers. */
export function endPoses(call: CallBundle): FormDancer[] {
  return call.dancers.map((d) => {
    const p = poseFor(d, call.beats);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
}

export interface ClosureDiscrepancy {
  actual: FormDancer[]; // the call's real end poses
  target: FormDancer[]; // the intended end, re-ordered into the call's dancer order
  maxPosErr: number; // worst-case position delta to target
  maxHeadingErr: number; // worst-case heading delta to target (radians)
}

/**
 * Measure how far each dancer's end diverges from the intended target. `target`
 * is treated as a dancer SET and re-ordered into the call's dancer order by
 * geometry (via the call's start poses), so the correspondence is derived rather
 * than assumed from array position. Build the target with `alignTargetToStart`
 * (or use the call's own start poses for a round-trip fix).
 */
export function closureDiscrepancy(call: CallBundle, target: FormDancer[]): ClosureDiscrepancy {
  const actual = endPoses(call);
  const ordered = orderLikeCore(call.dancers.map((d) => poseFor(d, 0)), target);
  let maxPosErr = 0;
  let maxHeadingErr = 0;
  for (let i = 0; i < actual.length && i < ordered.length; i++) {
    const pe = Math.hypot(actual[i].x - ordered[i].x, actual[i].y - ordered[i].y);
    const he = Math.abs(normAngle(actual[i].heading - ordered[i].heading));
    if (pe > maxPosErr) maxPosErr = pe;
    if (he > maxHeadingErr) maxHeadingErr = he;
  }
  return { actual, target: ordered, maxPosErr, maxHeadingErr };
}

/**
 * Align a picked target FORMATION to the call's START poses (which carry the
 * correct dancer identities), returning a FormDancer[] in the call's dancer
 * order. Aligning to the start — not the possibly-misaligned end — keeps each
 * dancer assigned to their own intended spot.
 */
export function alignTargetToStart(call: CallBundle, formation: FormDancer[]): FormDancer[] {
  const start = call.dancers.map((d) => {
    const p = poseFor(d, 0);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
  return alignFormationToCore(start, formation);
}

/**
 * Fix a call that doesn't close cleanly WITHOUT changing the beat count. It
 * retargets each dancer's LAST move segment so the dancer ends at the intended
 * end, adjusting that segment's geometry while keeping its beats (and so the
 * call's total beats) unchanged. This is identical for mirrored and non-mirrored
 * dancers (the mirror is an involution), so half-set calls are handled too.
 *
 * INDEX INDEPENDENCE: `target` is treated as a dancer SET and re-ordered into the
 * call's dancer order by geometry (via the call's start poses), rather than being
 * trusted in array order.
 */
export function correctEndTo(call: CallBundle, target: FormDancer[]): CallBundle {
  const segBeats = (path: Seg[]): number => path.reduce((s, x) => s + x.beats, 0);
  const ordered = orderLikeCore(call.dancers.map((d) => poseFor(d, 0)), target);
  const newDancers = call.dancers.map((d, i) => {
    const path = d.path;
    if (path.length === 0) return d;
    const last = path[path.length - 1];
    const before = path.slice(0, -1);
    // Pose just before the last segment (mirror-aware via poseFor).
    const pre = poseFor({ ...d, path: before }, segBeats(before));
    const t = ordered[i];
    const seg = padSegment({ x: pre.x, y: pre.y, heading: pre.heading }, { x: t.x, y: t.y, heading: t.heading }, last.beats);
    seg.hands = last.hands;
    return { ...d, path: [...before, seg] };
  });
  return { ...call, dancers: newDancers }; // beats / totalBeats unchanged
}

// ------------------------------------------------------------------ call instance
//
// A CALL INSTANCE is one `<tam>`: a start formation, a start-to-end path for every
// dancer, and the bookkeeping around them. The editor's first job is to let a caller
// edit that instance DIRECTLY - the start formation and its arrangement (which spot
// holds a boy and which a girl), the end formation, and the moves that carry each
// dancer from one to the other - rather than only re-framing a call by padding it.
//
// THE MODEL IS THE BUNDLE. `DancerSpec` already IS a start pose plus a path, and
// `CallBundle` already IS an instance, so the editor edits a bundle and needs no
// parallel representation to drift out of step with the renderer, the matcher or the
// XML codec. What it adds is the OPERATIONS, and every one of them returns a NEW
// bundle.
//
// FULL-SET COORDINATES, ALWAYS. A tam authored for half the set carries four dancers
// and `mirror: true`, and its published (x, y, angle) are in HALF-set space: letting a
// caller edit those numbers would be editing a frame they never see, and a start edit
// applied to the wrong frame moves a dancer to the mirror image of the spot that was
// typed. Every operation therefore normalizes first. The normalization is exact ALGEBRA -
// a mirrored dancer's pose is the base pose under a 180-degree rotation about the origin,
// which is precisely `fromPosAngle(-x, -y, a + pi)`, and that left factor commutes with
// the whole path chain - and it is exact IN FLOATING POINT to within one ulp, because
// `cos(a + pi)` is not bit-identical to `-cos(a)`. MEASURED over the corpus witnesses in
// `editor.mjs`: worst pose gap 2.3e-15 units, the same order as the round-off in the
// operations it is comparing. Nothing here treats that as zero.

/** One dancer of an editable call instance, reported in FULL-SET coordinates. */
export interface InstanceDancer {
  /** Index into `call.dancers`; the identity the mutators take. */
  index: number;
  gender: Gender;
  start: FormDancer;
  /** The pose the dancer arrives at when the call's LAST beat is reached. */
  end: FormDancer;
  /**
   * Home-square couple and dancer id, DERIVED from the start formation by
   * `assignHomeIdentity` (the same read the renderer colours by), or null when the
   * start formation is not a home-like 8-dancer set. NOT editable and NOT exported:
   * a taminations `<dancer>` declares only gender/x/y/angle, so `couple` is a READ of
   * the arrangement, not a field of the format. See the note on `setDancerGender`.
   */
  couple: number | null;
  id: number | null;
  /** Sum of this dancer's own segment beats (the call's own `beats` is their max). */
  beats: number;
  /** A COPY of the dancer's moves, so editing the report cannot edit the bundle. */
  moves: Seg[];
}

function cloneSegs(path: Seg[]): Seg[] {
  return path.map((s) => ({
    beats: s.beats,
    hands: s.hands,
    translate: { ...s.translate },
    rotate: s.rotate ? { ...s.rotate } : null,
  }));
}

function pathBeats(path: Seg[]): number {
  return path.reduce((n, s) => n + s.beats, 0);
}

/** The longest dancer's own path length: the converter's own definition of a call's
 *  `beats` (`buildCallImpl`). A shorter dancer simply stops when it is done. */
export function instanceBeats(call: CallBundle): number {
  return call.dancers.reduce((m, d) => Math.max(m, pathBeats(d.path)), 0);
}

/**
 * The stretch of a dancer's own beat clock that ONE of its moves occupies: `[from, to)`.
 *
 * This is the range the editor highlights on that dancer's track, and it is the dancer's OWN
 * clock rather than the call's: a call whose `beats` exceed the longest path (a pause) leaves
 * that surplus AFTER the last move, so the last move's `to` is the dancer's path total and
 * not necessarily `call.beats`. Deriving it here rather than in the UI is what makes it
 * measurable - `editor.mjs` checks that the pose at `from` and the pose at `to` are the poses
 * at that move's two ends, on a call with several moves per dancer.
 */
export function moveBeatRange(dancer: DancerSpec, moveIndex: number): { from: number; to: number } {
  const moves = dancer.path;
  if (!Number.isInteger(moveIndex) || moveIndex < 0 || moveIndex >= moves.length) {
    throw new Error(`moveBeatRange: the dancer has no move ${moveIndex} (it has ${moves.length})`);
  }
  let from = 0;
  for (let k = 0; k < moveIndex; k++) from += moves[k].beats;
  return { from, to: from + moves[moveIndex].beats };
}

/** Re-time the call after a MOVE edit.
 *
 * `beats` is normally the longest dancer's path, and that is what a re-timed move should
 * produce. But an authored tam may declare `beats` LONGER than every one of its paths - a
 * pause, expressed by trailing zero-travel movement - and both obvious rules are wrong
 * for it:
 *
 *   - `beats = max(path)` silently CUTS the pause off the end of an unrelated edit
 *     (MEASURED: an 14-beat call whose longest path is 10, edited by half a beat on a
 *     shorter dancer, came back at 10.5 - a 3.5-beat pause destroyed by a change that
 *     never touched it); and
 *   - leaving `beats` alone ignores a genuine re-time.
 *
 * So the PAUSE IS CARRIED AS A DELTA: whatever the authored number exceeds the longest
 * path by, it keeps exceeding it by. A call with no pause (the two are equal) simply
 * follows its longest path. */
function retime(call: CallBundle, beforeMax: number): CallBundle {
  const after = instanceBeats(call);
  const beats = call.beats === beforeMax ? after : call.beats + (after - beforeMax);
  return { ...call, beats, totalBeats: call.leadin + beats + call.leadout };
}

/** Rewrite a call instance in FULL-SET coordinates: every dancer explicit, no mirrors.
 *
 * Exact ALGEBRA and exact in floating point to one ulp - see the section note, and note
 * that `editor.mjs` pins the ulp rather than rounding it away. Idempotent, and the identity
 * it needs (`id` / `couple`) is carried across rather than re-derived, so a caller's
 * declared identity is not silently replaced by a guess. */
export function normalizeInstance(call: CallBundle): CallBundle {
  const dancers: DancerSpec[] = call.dancers.map((d) => {
    const p = poseFor(d, 0);
    const out: DancerSpec = {
      gender: d.gender,
      x: p.x,
      y: p.y,
      angleDeg: p.heading / DEG,
      mirror: false,
      path: cloneSegs(d.path),
    };
    if (d.id != null) out.id = d.id;
    if (d.couple != null) out.couple = d.couple;
    return out;
  });
  return { ...call, dancers };
}

/** The call instance as an editable TABLE: one row per dancer, full-set coordinates,
 *  with the derived identity and the moves. This is what the editor UI renders and
 *  what `editor.mjs` measures the round trip against. */
export function instanceTable(call: CallBundle): InstanceDancer[] {
  const full = call.dancers.some((d) => d.mirror) ? normalizeInstance(call) : call;
  const stamped = assignHomeIdentity(full.dancers);
  return stamped.map((d, i) => {
    const s = poseFor(d, 0);
    const e = poseFor(d, full.beats);
    return {
      index: i,
      gender: d.gender,
      start: { x: s.x, y: s.y, heading: s.heading, gender: d.gender },
      end: { x: e.x, y: e.y, heading: e.heading, gender: d.gender },
      couple: d.couple ?? null,
      id: d.id ?? null,
      beats: pathBeats(d.path),
      moves: cloneSegs(d.path),
    };
  });
}

function requireDancer(call: CallBundle, index: number): CallBundle {
  if (!Number.isInteger(index) || index < 0 || index >= call.dancers.length) {
    throw new Error(`instance edit: dancer ${index} is out of range (the instance has ${call.dancers.length})`);
  }
  return call.dancers.some((d) => d.mirror) ? normalizeInstance(call) : call;
}

/** Move dancer `index`'s START pose (and optionally its gender).
 *
 * A path is authored in dancer-LOCAL coordinates, with +X the dancer's initial facing, so
 * re-posing the start does NOT leave the movement alone - it re-frames it:
 *
 *   - translating the start translates the whole path by the same vector, so every later
 *     pose moves with it; and
 *   - changing the start heading rotates the whole path about the start by the same angle.
 *
 * That is the authored semantics and the reason an edit here is an edit of the INSTANCE:
 * the choreography is carried through verbatim, in the frame the caller just chose. An
 * edit that should NOT move the end belongs on `setDancerEnd` instead. */
export function setDancerStart(call: CallBundle, index: number, pose: FormDancer): CallBundle {
  const base = requireDancer(call, index);
  const dancers = base.dancers.map((d, j) =>
    j === index
      ? { ...d, x: pose.x, y: pose.y, angleDeg: pose.heading / DEG, gender: pose.gender ?? d.gender }
      : d,
  );
  return { ...base, dancers };
}

/** Set dancer `index`'s gender: the ONLY thing that changes a formation's ARRANGEMENT,
 *  in the FASR sense of "which spots are occupied by boys and which by girls".
 *
 * A taminations `<dancer>` declares gender/x/y/angle, so this edit is carried by the XML
 * exactly as made; `couple` is a read of the result and follows from it. */
export function setDancerGender(call: CallBundle, index: number, gender: Gender): CallBundle {
  const base = requireDancer(call, index);
  const dancers = base.dancers.map((d, j) => (j === index ? { ...d, gender } : d));
  return { ...base, dancers };
}

/** Send dancer `index` to `pose` at the END of the call, holding the beat count.
 *
 * Only the dancer's LAST move is re-aimed (the same construction `correctEndTo` uses for
 * a whole set), so every earlier move, and every other dancer, is untouched. */
export function setDancerEnd(call: CallBundle, index: number, pose: FormDancer): CallBundle {
  const base = requireDancer(call, index);
  const d = base.dancers[index];
  if (d.path.length === 0) {
    throw new Error(`instance edit: dancer ${index} has no moves to re-aim at an end pose`);
  }
  const last = d.path[d.path.length - 1];
  const before = d.path.slice(0, -1);
  const pre = poseFor({ ...d, path: before }, pathBeats(before));
  const seg = padSegment({ x: pre.x, y: pre.y, heading: pre.heading }, { x: pose.x, y: pose.y, heading: pose.heading }, last.beats);
  seg.hands = last.hands;
  const dancers = base.dancers.map((x, j) => (j === index ? { ...x, path: [...before, seg] } : x));
  return retime({ ...base, dancers }, instanceBeats(base));
}

/**
 * Move one dancer's LAST segment so the call finishes on `pose` - POSITION AND ROTATION - while KEEPING the
 * way that move's facing is authored.
 *
 * WHY NOT `setDancerEnd`. That re-aims through `padSegment`, which carries the turn on a `rotate` curve over
 * a STRAIGHT path - so a move authored to face along its travel (`rotate: null`, `types.ts`) comes out
 * explicit, and the caller has silently changed what the tile MEANS. This is the placement behind the
 * editor's "Place end" button, where moving the dancers is the whole intent and re-authoring the facing is
 * not.
 *
 *   - `rotate !== null` (an authored facing curve): the turn goes on that curve, exactly as `padSegment`
 *     builds it, because there the curve decides the heading and the path never does.
 *   - `rotate === null` (the facing follows the path): the PATH is aimed instead. `core.ts` reads the
 *     heading change as `bezierAngle(translate, 1) - bezierAngle(translate, 0)`, so a cubic that departs
 *     along the dancer's own facing and ARRIVES along the target's realises exactly
 *     `to.heading - pre.heading` with `rotate` left null. A straight line cannot: its direction never
 *     changes, so re-aiming a straight path leaves the dancer facing where it already was.
 *   - THE PLACEMENT ASKS FOR NO TRANSLATION (the spot is where the dancer already is, and only the rotation
 *     changes): there is no path to aim, and a degenerate cubic's arrival tangent is `atan2(0, 0) = 0`, so
 *     the turn would be silently LOST. The turn therefore goes on a facing curve - the ONE case where this
 *     changes the move's facing mode - and it falls back to `padSegment`.
 *
 * THE CONDITION IS THE PLACEMENT'S OWN DISPLACEMENT, NOT THE MOVE'S. A move authored as a pivot that is
 * asked to finish somewhere else gets the aimed path like any other travel move: the caller has asked for
 * travel, so what the move did before is not the question.
 *
 * Beats and hands are held, every earlier move is untouched, and every other dancer is untouched - the same
 * contract `setDancerEnd` documents. */
export function placeDancerEnd(call: CallBundle, index: number, pose: FormDancer): CallBundle {
  const base = requireDancer(call, index);
  const d = base.dancers[index];
  if (d.path.length === 0) {
    throw new Error(`instance edit: dancer ${index} has no moves to place an end pose on`);
  }
  const last = d.path[d.path.length - 1];
  const before = d.path.slice(0, -1);
  const pre = poseFor({ ...d, path: before }, pathBeats(before));
  const to = { x: pose.x, y: pose.y, heading: pose.heading };
  let seg: Seg;
  // THE LOCAL FRAME, the way `padSegment` builds it: the dancer's own facing is local +X, so the target is
  // turned back by `pre.heading` and the departure handle lies along +X.
  const local = rot(-pre.heading, { x: to.x - pre.x, y: to.y - pre.y });
  const turn = normAngle(to.heading - pre.heading);
  const handle = Math.hypot(local.x, local.y) / 3;
  if (last.rotate === null && handle >= 1e-9) {
    seg = {
      beats: last.beats,
      hands: last.hands,
      // THE ARRIVAL TANGENT IS THE TARGET HEADING: the derivative at t=1 is 3*(P3-P2), so putting P2 one
      // handle back along `turn` from the target makes the path arrive already facing the way the spot
      // faces, and the heading change the pose reads is exactly `turn`.
      translate: {
        cx1: handle,
        cy1: 0,
        cx2: local.x - handle * Math.cos(turn),
        cy2: local.y - handle * Math.sin(turn),
        x2: local.x,
        y2: local.y,
      },
      rotate: null,
    };
  } else {
    seg = padSegment({ x: pre.x, y: pre.y, heading: pre.heading }, to, last.beats);
    seg.hands = last.hands;
  }
  const dancers = base.dancers.map((x, j) => (j === index ? { ...x, path: [...before, seg] } : x));
  return retime({ ...base, dancers }, instanceBeats(base));
}

/** Replace one of dancer `index`'s moves. Beats are re-timed by `retime`. */
export function setMove(call: CallBundle, index: number, moveIndex: number, seg: Seg): CallBundle {
  const base = requireDancer(call, index);
  const moves = base.dancers[index].path;
  if (!Number.isInteger(moveIndex) || moveIndex < 0 || moveIndex >= moves.length) {
    throw new Error(`instance edit: dancer ${index} has no move ${moveIndex} (it has ${moves.length})`);
  }
  const beforeMax = instanceBeats(base);
  const path = moves.map((s, k) => (k === moveIndex ? cloneSegs([seg])[0] : s));
  const dancers = base.dancers.map((d, j) => (j === index ? { ...d, path } : d));
  return retime({ ...base, dancers }, beforeMax);
}

/** Insert a move for dancer `index` (at the end by default). */
export function addMove(call: CallBundle, index: number, seg: Seg, at?: number): CallBundle {
  const base = requireDancer(call, index);
  const moves = base.dancers[index].path;
  const k = at == null ? moves.length : Math.max(0, Math.min(moves.length, at));
  const beforeMax = instanceBeats(base);
  const path = [...moves.slice(0, k), cloneSegs([seg])[0], ...moves.slice(k)];
  const dancers = base.dancers.map((d, j) => (j === index ? { ...d, path } : d));
  return retime({ ...base, dancers }, beforeMax);
}

/** Delete one of dancer `index`'s moves. */
export function removeMove(call: CallBundle, index: number, moveIndex: number): CallBundle {
  const base = requireDancer(call, index);
  const moves = base.dancers[index].path;
  if (!Number.isInteger(moveIndex) || moveIndex < 0 || moveIndex >= moves.length) {
    throw new Error(`instance edit: dancer ${index} has no move ${moveIndex} (it has ${moves.length})`);
  }
  const beforeMax = instanceBeats(base);
  const path = moves.filter((_, k) => k !== moveIndex);
  const dancers = base.dancers.map((d, j) => (j === index ? { ...d, path } : d));
  return retime({ ...base, dancers }, beforeMax);
}

/**
 * Replace ALL of dancer `index`'s moves with `path` - the whole trace, in one edit.
 *
 * THIS IS THE COPY A "MAKE THIS DANCER DO WHAT THAT ONE DOES" GESTURE NEEDS, and it is deliberately a
 * PATH-level edit rather than a loop of `setMove`s. The caller's question is about the TRACE, and a trace
 * assembled move by move is a second implementation of "the same" that can disagree with the first at every
 * boundary - including where the two paths differ in LENGTH, which a loop cannot express at all. Beats are
 * re-timed by `retime`, exactly as the per-move edits are, so a donor with a longer or shorter path carries
 * the call's own clock with it rather than leaving a pause behind.
 *
 * A PATH IS AUTHORED IN THE DANCER'S OWN FRAME (`types.ts`: +X is the dancer's initial facing and P0 is its
 * own origin), so copying one dancer's path onto another needs NO coordinate transform - the local frame IS
 * the transform, and what the receiving dancer gets is the donor's motion relative to ITS OWN start pose.
 * Moving the start pose is a different edit (`setDancerStart`) and is not done here; neither is the gender
 * or the home identity, which are the formation's rather than the trace's.
 *
 * The segments are CLONED, so the two dancers never share a `Seg` object: the editor keys a copied
 * coordinate on the segment itself, and a shared move would light up on both dancers at once.
 */
export function setDancerPath(call: CallBundle, index: number, path: Seg[]): CallBundle {
  const base = requireDancer(call, index);
  const beforeMax = instanceBeats(base);
  const next = cloneSegs(path);
  const dancers = base.dancers.map((d, j) => (j === index ? { ...d, path: next } : d));
  return retime({ ...base, dancers }, beforeMax);
}

// ------------------------------------------------------------------ mirroring a track

/** Which of THE DANCER'S OWN AXES a track is mirrored across: the local `x`, which is the line the dancer
 *  faces along, or the local `y`, which is the line across it - `types.ts` puts `+X` on the facing and `+Y`
 *  to the dancer's LEFT. */
export type MirrorAxis = 'x' | 'y';

/**
 * MIRROR ONE DANCER'S MOVES ACROSS ONE OF THE DANCER'S OWN AXES, LEAVING THE START POSE EXACTLY WHERE IT IS -
 * POSITION AND ROTATION BOTH. This is the Call editor's `X` / `Y` buttons: the authored track is replaced by
 * its mirror image in the very frame the track is authored in, and the dancer does not move, does not turn,
 * and is not re-stationed.
 *
 * THE RULE IS ONE QUARTER-TURN REFLECTION PER MOVE, ABOUT THE DANCER'S OWN FRAME:
 *
 *     X:  (x, y) -> (x, -y)      reflect about the local X axis - the line the dancer faces along
 *     Y:  (x, y) -> (-x, y)      reflect about the local Y axis - the line across the facing
 *
 * so `X` is the left-for-right mirror and `Y` the forward-for-back one. A path is authored in dancer-LOCAL
 * coordinates (`types.ts`: the origin is the dancer's spot when the move begins and +X is the facing at that
 * instant), so these two axes are not a choice of pivot at all - they ARE the frame the moves are written in.
 *
 * A BOARD-AXIS READING WAS SHIPPED FIRST AND REPLACED ON REQUEST - *"after some experimentation I realise that
 * it should be along the dancers local X and Y axis"*. It reflected about the BOARD's axis as the dancer's
 * frame sees it (`beta = phi - h0`), which is a quarter turn only for a dancer facing along the board's axis,
 * and everywhere else it had to SPLIT the facing channel onto the local +X axis to stay writable at all - the
 * tell that the board's frame is not the frame the moves are written in. What the format cannot carry is a
 * reflection about a line that is not a quarter turn away: reflecting BOTH channels about `beta` writes
 * `cy1 = sin(2*beta)*cx1`, which `bezRotAttr` has no `cy3` for, and the probe's control measures exactly that -
 * 444 of 444 diagonal facings unrepresentable (AGENTS.md §8 trap 18). THE LOCAL AXES CANNOT DO IT: both are
 * quarter turns, so `cy1` stays exactly 0 for every facing of every dancer, whatever way they face.
 *
 * WHAT IS EXACT, MEASURED by `poc/tools/mirror-moves-probe.mjs` over the shipped corpus at every joint and
 * every sampled instant of every move:
 *
 *   - POSITIONS. The mirrored world position is the original's mirror about the chosen axis through the
 *     DANCER'S OWN START: for `X` the line the dancer faces along, for `Y` the line across it.
 *   - HEADINGS. The mirrored heading is the original's mirror about the DANCER'S OWN START FACING, whichever
 *     of the two axes is chosen - because `poseFor` reads a facing curve as a TURN and a reflection negates
 *     every turn, whichever line it is about.
 *
 * SO `X` IS A FULL RIGID MIRROR OF THE TRACK AND `Y` IS NOT, and the pinned start pose is the reason rather
 * than the arithmetic: a reflection about a line at angle `theta` maps the start heading `h0` to `2*theta - h0`,
 * which is `h0` itself only when the line IS the facing. `X` is that line, so positions and headings reflect
 * about one axis; for `Y` the positions reflect about the left-hand line while the facing profile stays
 * mirrored about the facing - the only pair of readings available with the dancer still facing the way they
 * started, which is what "dont move the dancers start position or rotation" asks for.
 *
 * BOTH CHANNELS TAKE THE SAME SIGN FLIP (`mirrorLocalCurve`), which the format also requires: the facing's
 * `cy1` is 0 in the corpus and a sign flip of x or y leaves it 0, so every mirrored facing survives an export
 * - the probe pins that through `callToXml` and a re-read.
 *
 * HANDS SWAP LEFT FOR RIGHT (`swapLR`), which is the corpus's own mirror convention (`reflect="-1"` is
 * `scale(1, -1)`) rather than a second decision made here. Beats, the number of moves, the gender and every
 * dancer not asked for are untouched.
 *
 * MIRRORING TWICE IS THE IDENTITY: each axis is a sign flip of one coordinate and the hand swap is an
 * involution - which is what makes an accidental double press harmless, and the probe measures it rather than
 * trusting it.
 */
export function mirrorDancerMoves(call: CallBundle, index: number, axis: MirrorAxis): CallBundle {
  const base = requireDancer(call, index);
  const d = base.dancers[index];
  return setDancerPath(
    base,
    index,
    d.path.map((s) => ({
      ...s,
      translate: mirrorLocalCurve(s.translate, axis),
      rotate: s.rotate ? mirrorLocalCurve(s.rotate, axis) : null,
      hands: swapLR(s.hands),
    })),
  );
}

/**
 * ONE LOCAL CURVE REFLECTED ABOUT ONE OF THE DANCER'S OWN AXES - a single sign flip of one coordinate, which
 * is all a quarter-turn reflection is: `X` negates y (left for right), `Y` negates x (forward for back).
 *
 * ONE FUNCTION FOR BOTH CHANNELS, and that is the local reading's own property rather than an economy: a
 * reflection negates every turn whichever line it is about, so the facing channel wants the same flip as the
 * travel channel - and a quarter turn is the one family of flips the format can write back (`bezRotAttr` has
 * no `cy3`, so a facing whose first control moved off the local +X axis would lose its first span).
 */
function mirrorLocalCurve(b: BezierData, axis: MirrorAxis): BezierData {
  return axis === 'x'
    ? { ...b, cy1: -b.cy1, cy2: -b.cy2, y2: -b.y2 }
    : { ...b, cx1: -b.cx1, cx2: -b.cx2, x2: -b.x2 };
}

/**
 * SWITCH TWO DANCERS: everything each one is, at the other one's index.
 *
 * Asked for as: "With two dancers selected, the button will switch the selected dancers." The two ENTRIES trade
 * places outright - start pose (x, y, heading), the whole path, the gender, and the half-set mirror flag - so
 * after the swap index `a` holds exactly what index `b` held. That is the operation the phrase names, and it is
 * also the only version of it that leaves a coherent track: a path is authored in the dancer's OWN frame
 * (`+X` is the dancer's initial facing and P0 is its own origin, see `setDancerStart`), so moving a path WITHOUT
 * its start pose re-frames every move into a frame it was not written in, and the first move stops meeting the
 * pose it departs from. Moving the whole entry re-frames nothing: the world path at `a` afterwards is the world
 * path `b` had before, exactly.
 *
 * WHAT DOES NOT MOVE, and it is the one thing a reader might expect to. `id`/`couple` are the HOME-SQUARE
 * identity, and `assignHomeIdentity` DERIVES them from where a dancer stands - they are not independent state,
 * which is why swapping the poses swaps them too and why nothing here copies them across by hand. `beats` needs
 * no attention either: the multiset of paths is unchanged, so the instance's own length is unchanged and
 * `retime` has nothing to do.
 *
 * THE SEGMENTS ARE SHARED WITH THE BUNDLE THEY CAME FROM rather than cloned. `setDancerPath` clones because a
 * COPIED move has to be a new object - the editor keys the clipboard and the highlighted coordinate on the `Seg`
 * itself, and a shared one would light up on two dancers at once. A swap is the opposite case: the objects move
 * to a different index and are still one move each, so the copies keyed on them follow the move to its new
 * dancer, which is what the caller means by swapping it.
 *
 * Swapping a dancer with itself is the identity, and it is answered rather than refused: the UI can only reach
 * this with two distinct ticks, and a caller that dedupes nothing should not get an exception for asking for
 * nothing.
 */
export function swapDancers(call: CallBundle, a: number, b: number): CallBundle {
  const base = requireDancer(call, a);
  if (a === b) return base;
  const full = requireDancer(base, b);
  const dancers = full.dancers.map((d, j) => (j === a ? full.dancers[b] : j === b ? full.dancers[a] : d));
  return { ...full, dancers };
}

// ------------------------------------------------------------------ cloning a start
//
// CLONING A CALL ONTO A DIFFERENT START SETUP. A `<tam>` is authored for ONE start formation,
// and its moves are written in dancer-LOCAL coordinates - each move's origin is where the
// dancer stands when the move begins, and its +X is the dancer's facing. So the authoring
// unit is really `[start formation] + [local move chain]`, and re-using the chain from a
// different start is the cheap half of authoring a new setup for a call.
//
// WHAT GOES WRONG WITHOUT THIS SECTION. Re-posing the start re-frames the WHOLE chain
// (`setDancerStart` documents exactly that), so the set no longer performs the intended
// whole-set motion and the END board comes apart: for `Circle Left` re-based from a squared
// set onto Facing Lines the ends move by as much as the difference between the two
// formations. That is the "now invalid track", and it is measured rather than asserted -
// `endPoseError` is how the editor shows it, and `editor.mjs` pins the size on a witness.
//
// THE FIX IS ONE MOVE PER DANCER, NOT A WHOLE TRACK. The END FORMATION IS KEPT EXACTLY, and
// only the FIRST move is re-aimed, so that it carries the dancer from the new start to the
// pose where the ORIGINAL track resumes (`connectStart`). Every later move is untouched, and
// because a local chain composes identically from the same pose, every pose from that
// boundary onward - including the end - comes back bit-for-bit. The clone therefore walks
// in from the new setup, then dances the call exactly as authored, and finishes where the
// call always finished.
//
// EVERY REFERENCE IS TO THE FINISH, NOT THE START. It would be easy to re-aim the first move
// at the OLD START's first boundary instead; that would move the end with the start and
// would not be a clone of anything. The anchor is the pose of the ANCESTOR's track at that
// boundary, which is what makes the end invariant.

/**
 * Re-base a call instance's START formation onto `formation`, leaving every MOVE untouched.
 *
 * The dancers are assigned to the formation's spots GEOMETRICALLY - nearest first, from the
 * outside in, the same rule the rest of this module uses - and, whenever the counts allow, a
 * dancer only takes a spot whose declared gender matches its own. That second rule is what
 * makes the result actually be the setup that was asked for: a formation declares which
 * spots hold boys and which hold girls, and an assignment that ignored it would produce a
 * board that merely LOOKS like the formation. The first pass is a preference, not a
 * constraint, so a formation whose gender counts do not match the dancers' still assigns
 * (by geometry) rather than refusing.
 *
 * GENDER IS THE DANCER'S, NOT THE SPOT'S. A dancer keeps its own gender and identity; the
 * assignment chooses where it stands. Silently swapping somebody's gender to fit a spot
 * would change WHO is dancing, and identity here is data.
 *
 * The result's track is NOT valid on its own - it ends wherever the old chain now carries
 * it. `connectStart` is the other half, and `endPoseError` measures what is left to do.
 */
export function setStartFormation(call: CallBundle, formation: FormDancer[]): CallBundle {
  const base = normalizeInstance(call);
  const n = base.dancers.length;
  if (formation.length !== n) {
    throw new Error(
      `setStartFormation: the formation has ${formation.length} dancers and the call has ${n} - refusing to re-base a track onto the wrong number of dancers`,
    );
  }
  const slotOf = assignStartSlots(base, formation);
  const dancers = base.dancers.map((d, i) => ({
    ...d,
    x: formation[slotOf[i]].x,
    y: formation[slotOf[i]].y,
    angleDeg: formation[slotOf[i]].heading / DEG,
  }));
  return { ...base, dancers };
}

/**
 * Assign each dancer of `call` to a spot of `formation`: `slotOf[i]` is the formation index
 * dancer `i` stands on. Dancers are placed from the OUTSIDE IN (the far ones have the fewest
 * good options), scoring position plus half the facing difference, and a spot whose declared
 * gender is the dancer's own is preferred in a first pass over any spot at all.
 */
function assignStartSlots(call: CallBundle, formation: FormDancer[]): number[] {
  const n = call.dancers.length;
  const cur = call.dancers.map((d) => poseFor(d, 0));
  const used = new Array<boolean>(n).fill(false);
  const slotOf = new Array<number>(n).fill(-1);
  const order = cur.map((_, i) => i).sort((a, b) => cur[b].x ** 2 + cur[b].y ** 2 - (cur[a].x ** 2 + cur[a].y ** 2));
  for (const i of order) {
    const wants = call.dancers[i].gender;
    let best = -1;
    // Pass 0 keeps the formation's declared arrangement; pass 1 is what makes the assignment
    // TOTAL when the gender counts do not line up, rather than leaving a dancer out.
    for (const pass of [0, 1]) {
      let bestD = Infinity;
      for (let s = 0; s < n; s++) {
        if (used[s]) continue;
        const g = formation[s].gender;
        if (pass === 0 && g !== undefined && g !== wants) continue;
        const d =
          Math.hypot(cur[i].x - formation[s].x, cur[i].y - formation[s].y) +
          Math.abs(normAngle(cur[i].heading - formation[s].heading)) * 0.5;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best >= 0) break;
    }
    used[best] = true;
    slotOf[i] = best;
  }
  return slotOf;
}

/** Whether a dancer's pose is already the `target` pose, to within floating-point noise.
 *  Used to leave an authored first move ALONE when it already reaches the track. */
function poseIs(pose: Pose, target: { x: number; y: number; heading: number }): boolean {
  return (
    Math.abs(pose.x - target.x) <= 1e-9 &&
    Math.abs(pose.y - target.y) <= 1e-9 &&
    Math.abs(normAngle(pose.heading - target.heading)) <= 1e-9
  );
}

/**
 * Complete a re-based track: re-aim each dancer's FIRST move so it connects the new start to
 * `reference`'s own track, leaving the END FORMATION exactly where the reference put it.
 *
 * ONE MOVE PER DANCER, AND ONLY THE FIRST. The anchor is `reference`'s pose at the end of ITS
 * first move - the point where the authored chain resumes - so the END composes from the same
 * pose it always did and comes back. The re-aimed move keeps the ORIGINAL first move's beats
 * and hands: this re-aims a movement, it does not re-time the call. (Where the first moves
 * agree on beats - which a re-base guarantees, since it does not touch them - every pose from
 * that boundary onward is the reference's, not merely the end.)
 *
 * A dancer whose OWN first move ALREADY ends on the anchor is left exactly as authored. That
 * is not politeness either: it is what makes `connectStart(ancestor, ancestor)` the identity,
 * so an already-good track is not restraightened into a pad when nothing asked for it.
 *
 * A dancer with no first move, or with a first move of zero beats, CANNOT be connected -
 * there is no time in which to walk in - so it is left alone and stays wrong. That is a
 * measurement, not an oversight: `endPoseError` reports it, and the editor shows it.
 */
export function connectStart(call: CallBundle, reference: CallBundle): CallBundle {
  const base = normalizeInstance(call);
  const ref = reference.dancers.some((d) => d.mirror) ? normalizeInstance(reference) : reference;
  if (ref.dancers.length !== base.dancers.length) {
    throw new Error(
      `connectStart: the reference has ${ref.dancers.length} dancers and the call has ${base.dancers.length} - a clone and its ancestor must match dancer for dancer`,
    );
  }
  const dancers = base.dancers.map((d, i) => {
    const r = ref.dancers[i];
    if (d.path.length === 0 || r.path.length === 0) return d;
    const first = d.path[0];
    if (!(first.beats > 0)) return d;
    const anchor = poseFor(r, moveBeatRange(r, 0).to);
    // ALREADY THERE means the dancer's OWN first move ends on the anchor - not that its start
    // is the anchor, which is a different question with a different answer for every dancer.
    // Getting this wrong re-aims an authored first curve into a straight pad even when the
    // track needed nothing, which is how `connectStart(ancestor, ancestor)` stops being the
    // identity it has to be.
    if (poseIs(poseFor(d, moveBeatRange(d, 0).to), anchor)) return d;
    const start = poseFor(d, 0);
    const seg = padSegment(
      { x: start.x, y: start.y, heading: start.heading },
      { x: anchor.x, y: anchor.y, heading: anchor.heading },
      first.beats,
    );
    seg.hands = first.hands;
    return { ...d, path: [seg, ...d.path.slice(1)] };
  });
  return { ...base, dancers };
}

/**
 * How far apart two calls' END poses are, DANCER BY INDEX.
 *
 * Index-for-index is the right comparison HERE and it is not the same question
 * `closureDiscrepancy` answers: that one re-derives a correspondence geometrically because it
 * is measuring against an independent target formation, whereas a clone and its ancestor share
 * their dancer order and their identity, and re-deriving a correspondence between them could
 * hide exactly the error being measured by pairing a dancer with somebody else.
 */
export function endPoseError(a: CallBundle, b: CallBundle): { pos: number; heading: number } {
  const n = Math.min(a.dancers.length, b.dancers.length);
  let pos = 0;
  let heading = 0;
  for (let i = 0; i < n; i++) {
    const p = poseFor(a.dancers[i], a.beats);
    const q = poseFor(b.dancers[i], b.beats);
    pos = Math.max(pos, Math.hypot(p.x - q.x, p.y - q.y));
    heading = Math.max(heading, Math.abs(normAngle(p.heading - q.heading)));
  }
  return { pos, heading };
}

// ------------------------------------------------------------------ the quarter arc

/**
 * The control-point distance that makes a cubic Bezier a quarter of a circle.
 *
 * `4/3 * (sqrt(2) - 1)`, the standard constant: a cubic with its control points at that fraction of
 * the way along perpendicular tangents is a quarter conic to within 2.7e-4 of the radius, which is
 * the best a cubic can do and is far below anything visible on this board.
 */
export const ARC_K = (4 / 3) * (Math.SQRT2 - 1);

/**
 * How far from an exact quarter arc a curve may be and still be read as one.
 *
 * It is tied to the EXPORT rather than chosen for feel: `callToXml` writes four decimals, so a curve
 * that was exactly an arc comes back within 5e-5 of one, and a tolerance tighter than that would
 * make the panel's own "this curve is an arc" flag flicker off after a save and a reload. 1e-3 is
 * 20x the rounding and still a tenth of the coarsest control point in the corpus.
 */
export const ARC_TOL = 1e-3;

/**
 * The tolerance on being a RIGHT ANGLE, for the panel's disable rule, and it is deliberately two
 * orders looser than `ARC_TOL`.
 *
 * The two measure different things: `ARC_TOL` asks whether a curve's COORDINATES are a quarter arc,
 * which the export's four decimals decide, while this asks whether the handles' DIRECTIONS are a
 * right angle - and a direction is not degraded by the rounding of a length. Half a degree is far
 * below anything a caller could mean by "perpendicular" and far above the noise in the assets'
 * two-decimal lengths.
 */
export const ARC_ANGLE_TOL = (0.5 * Math.PI) / 180;

/** A length below which a handle has no direction and no size to speak of. */
const ARC_EPS = 1e-9;

/**
 * THE CUBIC THAT TRACES A CIRCULAR ARC about `centre`, from `from` to `to`, in whatever coordinate
 * system the three are given in.
 *
 * WHY THIS IS NOT `arcBezier`. `arcBezier` builds ONE QUARTER of a circle from two handle LENGTHS and a
 * start direction - the canonical conic, in the dancer-local frame, which is what the panel's arc fields
 * read and write. This is the other question: given two points and the centre of the circle they stand
 * on, what cubic follows that circle between them? It answers for ANY sweep, not only a quarter, and it
 * keeps the END POINTS FIXED (the caller has already placed them), which is what a fit into an existing
 * chain has to do.
 *
 * THE CONSTRUCTION is the standard one, and it is a fit rather than a solution: a cubic cannot trace a
 * circle exactly, so the control points are placed at `(4/3) * tan(sweep / 4)` of the radius along each
 * end's TANGENT. That is exact to four decimals for a quarter turn and far better than that for the
 * short chords this exists for - and it is the SAME constant the rest of this module uses, since
 * `(4/3) * tan(PI/8)` IS `ARC_K`. A caller working in the dancer-local frame can therefore hand the
 * result to the same export path as any other curve, and the two ways of stating an arc agree.
 *
 * WORKED, for a quarter turn: from `(r, 0)` to `(0, r)` about the origin, the start tangent is `(0, 1)`
 * and the finish tangent `(-1, 0)`, so the controls are `(r, r * ARC_K)` and `(r * ARC_K, r)` - the
 * textbook quarter-circle cubic. `radial-grid-probe.mjs` checks exactly that against `ARC_K`.
 *
 * Null when the arc cannot be described: a point ON the centre (no radius, no tangent), a degenerate
 * sweep, or a radius that differs between the two ends by more than `tolRel` - the ends of an arc lie on
 * ONE circle, and a pair that does not is a caller error rather than a curve to fit.
 */
export function arcBezierAbout(
  centre: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
  tolRel = 0.05,
): { cx1: number; cy1: number; cx2: number; cy2: number } | null {
  const r0 = Math.hypot(from.x - centre.x, from.y - centre.y);
  const r1 = Math.hypot(to.x - centre.x, to.y - centre.y);
  if (r0 < ARC_EPS || r1 < ARC_EPS) return null;
  const r = (r0 + r1) / 2;
  if (Math.abs(r0 - r1) > tolRel * r) return null;
  const a0 = Math.atan2(from.y - centre.y, from.x - centre.x);
  const a1 = Math.atan2(to.y - centre.y, to.x - centre.x);
  // THE SHORT WAY ROUND, because that is the arc a caller means between two close points - and the
  // long one would be the rest of the circle.
  const sweep = normAngle(a1 - a0);
  if (Math.abs(sweep) < ARC_EPS) return null;
  const reach = r * (4 / 3) * Math.tan(Math.abs(sweep) / 4);
  // The tangent at each end, in the direction of travel: for a POSITIVE (anticlockwise) sweep the
  // tangent is the radius turned +90 degrees.
  const s = sweep > 0 ? 1 : -1;
  const t0 = { x: -s * Math.sin(a0), y: s * Math.cos(a0) };
  const t1 = { x: -s * Math.sin(a1), y: s * Math.cos(a1) };
  return {
    cx1: from.x + reach * t0.x,
    cy1: from.y + reach * t0.y,
    cx2: to.x - reach * t1.x,
    cy2: to.y - reach * t1.y,
  };
}

/**
 * A quarter arc, described by its two HANDLE LENGTHS and the direction of the first - which is what
 * the panel shows and drags, and what the projection below reads.
 *
 * THE QUADRANT KEEPS THE CURVE'S OWN HANDLE DIRECTIONS. That is the whole definition: a quarter arc's
 * two end tangents are PERPENDICULAR to each other (they are tangents at two radii a quadrant apart),
 * so the family is parameterised by the start direction plus the two lengths, and the corner - and
 * with it the endpoint - follows from them.
 *
 *  - `x` is the START handle's length, along `angle`. It is never negative: the direction carries the
 *    sign, and a move that travels backwards simply has its direction pointing backwards.
 *  - `y` is the FINISH handle's length, along `angle + 90deg`. Its SIGN is the turn: positive turns
 *    the dancer's left, negative right.
 *  - `|x| === |y|` is exactly a CIRCLE: equal semi-axes. That is the panel's "a circle if the offsets
 *    are equal, otherwise an ellipse".
 *  - `angle` is the start direction in the dancer's local frame. A FACING curve's is always 0 or PI,
 *    because the `<rotate>` element has no `cy3`: its first control point is pinned to the x axis.
 */
export interface ArcParams {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** The quarter arc as a Bezier, in the dancer-local frame both curves are authored in. */
export function arcBezier(p: ArcParams): BezierData {
  const ux = Math.cos(p.angle);
  const uy = Math.sin(p.angle);
  const wx = -uy; // w = u rotated +90deg
  const wy = ux;
  const a = p.x / ARC_K;
  const b = p.y / ARC_K;
  // The conic's corner: a along the start direction, b along the finish direction.
  const x2 = a * ux + b * wx;
  const y2 = a * uy + b * wy;
  // The finish handle runs back from the corner along -w, its length exactly `y`.
  return { cx1: p.x * ux, cy1: p.x * uy, cx2: x2 - p.y * wx, cy2: y2 - p.y * wy, x2, y2 };
}

/**
 * The angle between the curve's two handle directions, or null when one of them has no length to
 * have a direction.
 *
 * This is the test the panel's disable rule turns on, so it is a function rather than arithmetic in
 * the UI. A quarter arc needs this to be a RIGHT ANGLE.
 */
export function arcCorner(b: BezierData): number | null {
  const x = Math.hypot(b.cx1, b.cy1);
  const e = Math.hypot(b.x2 - b.cx2, b.y2 - b.cy2);
  if (x <= ARC_EPS || e <= ARC_EPS) return null;
  const ux = b.cx1 / x;
  const uy = b.cy1 / x;
  const ex = (b.x2 - b.cx2) / e;
  const ey = (b.y2 - b.cy2) / e;
  // The signed angle from the start direction to the finish direction.
  return Math.atan2(ux * ey - uy * ex, ux * ex + uy * ey);
}

/**
 * Read a curve as a quarter arc, or null when it is not one.
 *
 * The relations ARE the definition, and asking them of the numbers is deliberately not the same as
 * re-deriving an arc: a curve that is nearly one but not is NOT an arc, and the panel's lock has to
 * say so rather than quietly round it into the family.
 *
 * A CURVE WITH NO HANDLE LENGTH AT ALL IS NOT AN ARC, which is a definition rather than a
 * technicality: every coordinate zero - a `Stand` - is the degenerate member of the family, but there
 * is no shape there to lock and no length for the panel to size anything from. Reporting it as an arc
 * would tick the box and lock the fields on a curve nobody can do anything with. (The first version
 * did exactly that and counted 138 corpus `Stand`s as "already arcs".) A curve with only ONE zero
 * handle IS a member, and is reported as one.
 */
export function arcOf(b: BezierData): ArcParams | null {
  const x = Math.hypot(b.cx1, b.cy1);
  const ex = b.x2 - b.cx2;
  const ey = b.y2 - b.cy2;
  const yLen = Math.hypot(ex, ey);
  if (x <= ARC_EPS && yLen <= ARC_EPS) return null;
  // The start direction, with the frame's +x standing in when the handle has no length: cx1 = 0 and
  // cy1 = 0 is "no change of heading at the start", and atan2(0, 0) is 0.
  const ux = x > ARC_EPS ? b.cx1 / x : 1;
  const uy = x > ARC_EPS ? b.cy1 / x : 0;
  const wx = -uy;
  const wy = ux;
  const tol = ARC_TOL * Math.max(1, x, yLen);
  // THE FINISH HANDLE MUST BE PERPENDICULAR TO THE START ONE - the condition a quarter arc cannot do
  // without, and the one the panel disables the checkbox for.
  if (Math.abs(ex * ux + ey * uy) > tol) return null;
  const y = ex * wx + ey * wy;
  // And the corner must be where the two lengths put it.
  const a = x / ARC_K;
  const bq = y / ARC_K;
  if (Math.hypot(b.x2 - (a * ux + bq * wx), b.y2 - (a * uy + bq * wy)) > tol) return null;
  return { x, y, angle: Math.atan2(uy, ux) };
}

/**
 * Whether an arc's two handle lengths are equal, which is the panel's "a circle if the offsets are
 * equal, otherwise an ellipse".
 *
 * A RELATIVE TOLERANCE, AND THE MEASUREMENT IS THE REASON: the two lengths are recovered from a
 * subtraction, so a `Forward` - authored `cx1="0.333" cx2="0.667" x2="1"` - has handles of 0.333 and
 * 0.33300000000000002. They are the same length, and an equality test would call that walk an ellipse.
 */
export function arcIsCircle(p: ArcParams): boolean {
  return Math.abs(p.x - Math.abs(p.y)) <= 1e-9 * Math.max(1, p.x, Math.abs(p.y));
}

/** How far a curve is from being free to become a quarter arc - the panel's DISABLE reason. */
export type ArcBlocker = 'no-handle-length' | 'handles-not-perpendicular' | 'starts-backwards';

/**
 * Why this curve cannot be locked to a quarter arc, or null when it can.
 *
 * The panel shows the reason rather than a dead checkbox, and this is one place rather than two: the
 * moment the box is enabled is exactly the moment a projection exists.
 *
 * `allowBackwards` is false for a facing curve: a start handle pointing along -x means a heading
 * change of 180deg at t = 0, i.e. the dancer snapping round to face the other way as the move begins.
 * MEASURED over the corpus, no authored facing curve does that (every `cx1` is >= 0), so a facing
 * curve that does is refused rather than silently flipped.
 */
export function arcBlocker(b: BezierData, allowBackwards: boolean): ArcBlocker | null {
  if (arcOf(b)) return null; // already a quarter arc
  const xLen = Math.hypot(b.cx1, b.cy1);
  const yLen = Math.hypot(b.x2 - b.cx2, b.y2 - b.cy2);
  if (xLen <= ARC_EPS && yLen <= ARC_EPS) return 'no-handle-length';
  if (!allowBackwards && b.cx1 < 0) return 'starts-backwards';
  // With one handle of zero length there is no angle to check, and the other handle's direction is
  // the only hint there is - the projection takes it and closes the arc as a circle.
  if (xLen > ARC_EPS && yLen > ARC_EPS) {
    const corner = arcCorner(b);
    if (corner === null || Math.abs(Math.abs(corner) - Math.PI / 2) > ARC_ANGLE_TOL) return 'handles-not-perpendicular';
  }
  return null;
}

/**
 * The quarter arc closest to a curve, or null when the curve gives NO HINT of how big to make one.
 *
 * THE HINT IS THE HANDLE LENGTHS, AND THE DIRECTIONS ARE KEPT AS THEY ARE: the arc keeps both
 * handles' lengths and both handles' directions, and imposes only the conic's own relation between
 * them - so nothing about which way the dancer travels or faces changes. What moves is the ENDPOINT,
 * to the conic's corner; that is visible, and it is the price of the constraint.
 *
 * A handle of ZERO LENGTH IS NO HINT, and the cases are separated rather than papered over: one zero
 * handle takes its size from the other (which gives a CIRCLE, the only shape the remaining length can
 * justify), and BOTH zero means there is nothing to go on at all, so the answer is `null` and the
 * panel says so instead of inventing a size. A `Stand` is exactly that case.
 *
 * `allowBackwards` is false for a facing curve, for the reason `arcBlocker` gives.
 */
export function projectToArc(b: BezierData, allowBackwards: boolean): ArcParams | null {
  const already = arcOf(b);
  if (already) return already;
  if (arcBlocker(b, allowBackwards)) return null;
  const xLen = Math.hypot(b.cx1, b.cy1);
  const yLen = Math.hypot(b.x2 - b.cx2, b.y2 - b.cy2);
  const angle = xLen > ARC_EPS ? Math.atan2(b.cy1, b.cx1) : 0;
  if (xLen > ARC_EPS && yLen <= ARC_EPS) {
    // One handle only: a circle, turning the way the move actually turns. Mid-move is where the turn
    // is well defined even when the end tangent is the zero vector.
    const ySign = bezierAngle(b, 0.5) < 0 ? -1 : 1;
    return { x: xLen, y: ySign * xLen, angle };
  }
  if (yLen > ARC_EPS && xLen <= ARC_EPS) return { x: yLen, y: yLen, angle };
  const wx = -Math.sin(angle);
  const wy = Math.cos(angle);
  const y = (b.x2 - b.cx2) * wx + (b.y2 - b.cy2) * wy;
  return { x: xLen, y, angle };
}

/**
 * A facing curve's DIRECTION PROFILE, scaled so that two curves meaning the same facing compare equal.
 *
 * THE FACING CURVE'S MEANING IS SCALE-INVARIANT, and that is not a detail of the arithmetic: `poseFor`
 * reads it with `bezierAngle`, which is `atan2` of the derivative, so multiplying all five numbers by
 * any positive factor leaves the heading at EVERY instant exactly as it was. Two such curves are the
 * same facing and a group edit of them is safe.
 *
 * Comparing the raw numbers instead says they differ, and that is a real defect rather than a
 * theoretical one - MEASURED (`poc/tools/coords-gate-probe.mjs`): after completing a cloned track, the
 * editor refused group edits on differences of 0.0 units and 0.0 degrees, i.e. on dancers whose curves
 * put them in exactly the same places facing exactly the same ways. A caller reported the same thing in
 * words: "selecting multiple dancers is no longer activating the bezier edit mode - they look the same."
 * They did look the same. They WERE the same.
 *
 * The profile is the three derivative spans, normalised by the first non-zero one's length, so a
 * positive rescaling cancels and a NEGATIVE one (a 180deg flip) does not. Null when the curve has no
 * direction at all - every derivative span zero, which is a hold.
 */
export function facingProfile(b: BezierData): number[] | null {
  const d = [b.cx1, b.cy1, b.cx2 - b.cx1, b.cy2 - b.cy1, b.x2 - b.cx2, b.y2 - b.cy2];
  const scale = Math.hypot(d[0], d[1]) || Math.hypot(d[2], d[3]) || Math.hypot(d[4], d[5]);
  if (scale <= 1e-12) return null;
  return d.map((v) => v / scale);
}

/**
 * Whether two facing curves mean the same headings, to within `tolDeg` degrees.
 *
 * With the default 0 this asks whether they are the same PROFILE up to a positive scale - exact, and the
 * fast path. With a tolerance it also samples the heading, because a heading is what it is only where it
 * is evaluated: the exact test cannot tell a curve from one that differs by a degree in the middle if the
 * difference is not a rescaling.
 *
 * NINE SAMPLES, and the honest bound is that it is a sample: two cubics whose headings agree at nine
 * instants could in principle differ between them. The alternative is a bound on `atan2` of a difference
 * of two derivative cubics, which blows up wherever the derivative passes near zero - and a facing curve
 * is FULL of those, since a hold's derivative is the zero vector. Sampling a heading is the measure that
 * means something here.
 */
export function sameFacing(a: BezierData | null, b: BezierData | null, tolDeg = 0): boolean {
  if ((a == null) !== (b == null)) return false;
  if (!a || !b) return true;
  const pa = facingProfile(a);
  const pb = facingProfile(b);
  if (pa == null && pb == null) return true; // both holds: no direction, so nothing to disagree about
  if (pa != null && pb != null && pa.every((v, i) => Math.abs(v - pb[i]) <= 1e-9)) return true;
  const tol = (tolDeg * Math.PI) / 180;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const d = bezierAngle(a, t) - bezierAngle(b, t);
    if (Math.abs(normAngle(d)) > tol) return false;
  }
  return true;
}

/** One move's curve set to a quarter arc - `travel` for the path, `facing` for the heading. */
export function setMoveArc(call: CallBundle, dancer: number, index: number, curve: 'travel' | 'facing', params: ArcParams): CallBundle {
  const seg = call.dancers[dancer]?.path[index];
  if (!seg) return call;
  const b = arcBezier(params);
  return setMove(call, dancer, index, curve === 'travel' ? { ...seg, translate: b } : { ...seg, rotate: b });
}

/** How `callToXml` writes the call's START formation.
 *
 *  `embed` is the inline `<formation>` block: self-contained, round-trip-safe, and what every
 *  editor-authored tam carried until now.
 *
 *  `reference` is `formation="Name"` with NO geometry, which is what the CORPUS's own tams use
 *  (`<tam title="Circle Four Left 1/4" from="Facing Couples" formation="Facing Couples">`). It is
 *  the form to write when the formation is one the corpus already carries: the created call then
 *  names it once instead of repeating its eight dancers, and an edit to the formation reaches every
 *  call that starts from it. It is ONLY correct when the named formation resolves AND is the shape
 *  the call actually starts from, which is what `startsFromFormation` checks - a reference to a
 *  formation that has drifted, or that exists only in one browser's local store, is a call that
 *  either starts somewhere else or does not load at all. */
export type FormationRef = 'embed' | 'reference';

export interface CallXmlOptions {
  formation?: FormationRef;
  /**
   * How many copies of the WRITTEN dancers make the set - the format's own `asymmetric` declaration read
   * backwards, and the same `Symmetry` the parser carries.
   *
   *   `1` (the DEFAULT, and what this writer has always produced) writes every dancer out and declares
   *       `asymmetric="true"`, so the text is self-contained whatever the geometry is.
   *   `2` writes the HALF set and no attribute, which is the corpus's own convention: the reader
   *       supplies the second half by rotating the written dancers 180 degrees about the board centre.
   *
   * `2` IS ONLY HONOURED WHEN THE CALL REALLY IS A HALF, because a half-set text for a set that is not
   * one reads back as a DIFFERENT CALL - the second half would be invented rather than described. Ask
   * `halfSetReport` first if the reason matters to the caller; without asking, the whole-set form is
   * written instead, which is always correct.
   */
  symmetry?: Symmetry;
  /**
   * Attributes written LAST on the `<tam>`, for a caller whose own convention records something the format
   * does not name.
   *
   * ONE CALLER: `book/tools/make-virtual.mjs` writes `parent_id="V1-…"` on a generated whole-set instance,
   * naming the call variant it was placed FROM — the identity `VirtualCallInfo.sourceStart` makes derivable.
   * It goes through the writer rather than a hand-built tag because the writer owns both rules the attribute
   * needs: the VALUE is escaped with the XML escaper (`esc`: `& < "`, AGENTS §6), and the NAME is refused when
   * it is not an XML name, which no escaper can protect — a bad name produces a file whose parse error names
   * something else entirely.
   */
  extraAttrs?: Readonly<Record<string, string>>;
}

/** Whether a call can be written as a HALF set, and what stops it when it cannot. */
export interface HalfSetReport {
  ok: boolean;
  /** How many dancers the half-set text would carry, when `ok`. */
  half: number;
  /** Why it cannot be, when it cannot - written to be shown to a caller as-is. */
  reason?: string;
}

/** Rotate a pose 180 degrees about the board centre: the transform the format's second half IS. */
const antipode = (p: { x: number; y: number; heading: number }) =>
  ({ x: -p.x, y: -p.y, heading: p.heading + Math.PI });

/** Whether two Beziers are the same curve, to `tol`. */
function sameBezier(a: BezierData | null | undefined, b: BezierData | null | undefined, tol: number): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return Math.abs(a.cx1 - b.cx1) <= tol && Math.abs(a.cy1 - b.cy1) <= tol
    && Math.abs(a.cx2 - b.cx2) <= tol && Math.abs(a.cy2 - b.cy2) <= tol
    && Math.abs(a.x2 - b.x2) <= tol && Math.abs(a.y2 - b.y2) <= tol;
}

/**
 * Whether `call` is a HALF SET: whether the second half of its dancers, and of their paths, is exactly
 * the first half turned 180 degrees about the board centre.
 *
 * THIS IS THE WHOLE PRECONDITION FOR DROPPING `asymmetric="true"`, and it has to be checked rather than
 * assumed because the format cannot say "the second half is not derivable" - it can only say "here is
 * the whole set". Both parts matter and neither implies the other:
 *
 *   - THE POSES. Dancer `i + n/2` must stand at `-dancer i`'s position, facing 180 degrees round, with
 *     the same gender (a rotation preserves gender, so a pair that crosses genders is not a rotation of
 *     anything). The gender half of this is also what makes the written half carry HALF of each gender
 *     rather than an equal number of boys and girls - a six-dancer set of four boys and two girls writes
 *     a half of two boys and one girl - which is what `half` means here.
 *   - THE PATHS. A half-set tam writes ONE path per written dancer and the reader replays that path for
 *     both halves, so the second half's path must already BE the first half's path rotated - which for a
 *     dancer-local Bezier means the IDENTICAL control points, because the rotation is applied to the
 *     dancer rather than to the curve. An edited call whose second half was moved by hand fails here
 *     even though its start poses may still pair up.
 *
 * The pairing is by INDEX (`i` with `i + n/2`), which is not an arbitrary choice: it is the pairing
 * `mirrorToFull` creates, so it is the only pairing a half-set text can reproduce. A call whose halves
 * pair up in some OTHER order is not one this writer can describe, and saying so is the point.
 */
export function halfSetReport(call: CallBundle, tol = 1e-3): HalfSetReport {
  const n = call.dancers.length;
  if (n === 0 || n % 2 !== 0) return { ok: false, half: 0, reason: `the set has ${n} dancers, which is not an even number of them` };
  const half = n / 2;
  const boys = call.dancers.filter((d) => d.gender === 'boy').length;
  const girls = call.dancers.filter((d) => d.gender === 'girl').length;
  // HALF OF EACH GENDER, WHICH IS NOT THE SAME AS EQUAL NUMBERS OF BOYS AND GIRLS. A six-dancer set of
  // four boys and two girls writes a half of two boys and ONE girl; what the rotation requires is that
  // each gender's count be EVEN, because the pairing pairs a dancer with another dancer of its own
  // gender, so an odd count could not be divided between the halves at all. Requiring `boys === girls`
  // was the first version of this and it refused exactly the sets the half-set form is FOR.
  if (boys % 2 !== 0 || girls % 2 !== 0) {
    return { ok: false, half, reason: `the set has ${boys} boys and ${girls} girls, and a half set splits each gender in two, so both counts have to be even` };
  }
  for (let i = 0; i < half; i++) {
    const a = call.dancers[i];
    const b = call.dancers[i + half];
    // The base half has to be the one that is written out, so a mirrored entry cannot be written
    // verbatim: its stored coordinates are the AUTHORED half-set numbers, not the placed pose.
    if (a.mirror) return { ok: false, half, reason: `dancer ${i + 1} is stored as a mirrored half-set entry, so its coordinates are not the whole-set ones a half-set text would need` };
    const pa = poseFor(a, 0);
    const want = antipode(pa);
    const pb = poseFor(b, 0);
    const gap = Math.max(Math.abs(pb.x - want.x), Math.abs(pb.y - want.y), Math.abs(normAngle(pb.heading - want.heading)));
    if (gap > tol) {
      return { ok: false, half, reason: `dancer ${i + half + 1} is not dancer ${i + 1} turned 180 degrees about the centre (it is ${gap.toFixed(2)} off)` };
    }
    if (a.gender !== b.gender) {
      return { ok: false, half, reason: `dancer ${i + 1} is a ${a.gender} and dancer ${i + half + 1} is a ${b.gender}, and turning a dancer 180 degrees does not change that` };
    }
    if (a.path.length !== b.path.length) {
      return { ok: false, half, reason: `dancer ${i + 1} has ${a.path.length} move(s) and dancer ${i + half + 1} has ${b.path.length}, so the second half is not the first half's path` };
    }
    for (let k = 0; k < a.path.length; k++) {
      const sa = a.path[k];
      const sb = b.path[k];
      if (sa.hands !== sb.hands || Math.abs(sa.beats - sb.beats) > tol
        || !sameBezier(sa.translate, sb.translate, tol) || !sameBezier(sa.rotate, sb.rotate, tol)) {
        return { ok: false, half, reason: `dancer ${i + half + 1}'s move ${k + 1} is not dancer ${i + 1}'s, and a half-set tam replays the written half's paths for both` };
      }
    }
  }
  return { ok: true, half };
}

/** An XML NAME (what a tag or attribute may be called): a letter, `_` or `:` to start, then name characters. */
const XML_ATTRIBUTE_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

/** Serialize an arbitrary call bundle as a taminations-style `<tam>` XML string.
 *
 * EVERY DECLARATION THE BUNDLE CARRIES IS WRITTEN BACK OUT, and the three attributes that
 * used to be dropped are the ones that change behaviour:
 *
 *  - `sequencer` decides whether the sequencer may MATCH this variant. A fix or a created
 *    position is registered from this XML (`Catalog.registrationXml`), so dropping it
 *    re-opened the demonstration hole the flag exists to close: an edit to the
 *    `sequencer="no"` half of a call came back as an ordinary, matchable setup.
 *  - `actives` says WHICH dancers the tam's paths describe, which is the whole reason
 *    `Centers Split Two` currently applies as a whole-board `Pass Thru`. An editor has no
 *    business erasing the attribute that records that.
 *  - `asymmetric` says HOW MANY COPIES of the written dancers make the set. The output is
 *    always a whole set (every dancer is written out), so this is always written, and
 *    without it a whole set whose geometry has no antipodal pair came back DOUBLED by the
 *    registration path. See the attribute's own note below for the measurement.
 *
 * The edit is written in EXPANDED form: named `<move select="…"/>` references come out as
 * explicit `<movement>` Beziers. The two are the same animation (`resolvePath` expands the
 * first into the second), and `editor.mjs` proves the round trip both ways. */
export function callToXml(call: CallBundle, name?: string, opts: CallXmlOptions = {}): string {
  const from = name ?? (call.from || call.title);
  const reference = opts.formation === 'reference';
  // THE HALF-SET FORM, and it is only taken when the call really is a half - see `CallXmlOptions.symmetry`.
  // The written dancers are then the FIRST HALF and the written paths are theirs, one per dancer, which is
  // what the corpus's own half-set tams carry (the `formation="Normal Lines"` tams in `ms/sashay.xml`).
  const halfReport = opts.symmetry === 2 ? halfSetReport(call) : null;
  const halfSet = halfReport?.ok === true;
  const written = halfSet ? call.dancers.slice(0, halfReport.half) : call.dancers;
  // A mirrored (half-set) dancer is authored at base (x,y,a) and rendered 180deg
  // about the origin. The XML format has no `mirror` attribute, so serialize it
  // as the equivalent NON-mirror dancer (base -x,-y,a+180 with the same path) so
  // re-parsing reproduces the full-set motion.
  const dancers = written
    .map((d) => {
      const x = d.mirror ? -d.x : d.x;
      const y = d.mirror ? -d.y : d.y;
      const a = d.mirror ? d.angleDeg + 180 : d.angleDeg;
      return `        <dancer gender="${d.gender}" x="${rf(x)}" y="${rf(y)}" angle="${rfAngle(a)}"/>`;
    })
    .join('\n');
  const paths = written
    .map(
      (d) =>
        `    <path>\n` +
        d.path.map((s) => `      <movement hands="${s.hands}" beats="${rf(s.beats)}" ${bezAttr(s.translate)}${s.rotate ? ' ' + bezRotAttr(s.rotate) : ''}/>`).join('\n') +
        `\n    </path>`,
    )
    .join('\n');
  const attrs = [
    `title="${esc(call.title)}"`,
    `from="${esc(from)}"`,
    // THE REFERENCE NAMES THE FORMATION THE GEOMETRY WOULD HAVE COME FROM, and it is the attribute
    // the parser resolves (`buildCallImpl`: "inline wins over named attribute"). Written ONLY in
    // reference mode: alongside an inline block it would be dead data that reads like a second
    // source of truth for where the dancers stand.
    reference ? `formation="${esc(from)}"` : '',
    `parts="${esc(call.parts)}"`,
    call.sequencerMode ? `sequencer="${call.sequencerMode}"` : '',
    call.actives ? `actives="${esc(call.actives)}"` : '',
    // THE EMITTED SHAPE IS A WHOLE SET BY DEFAULT - IN EMBED MODE, where every dancer is written out
    // (a mirrored half-set dancer is serialized as the equivalent NON-mirror dancer, see above, so the
    // text carries the full set and the completion must not add another). So that is the mode that
    // says so.
    //
    // A HALF SET SAYS NOTHING, because saying nothing is what declares it: the reader's rule is
    // "symmetry 2 unless the tam declares otherwise", so the ABSENCE of the attribute is the HALF, and
    // writing `asymmetric="true"` beside four dancers would ask the reader to take four dancers as the
    // whole set. Which of the two is written is `opts.symmetry`, and the half is only written when
    // `halfSetReport` has confirmed the geometry supports it.
    //
    // NOT IN REFERENCE MODE, and the distinction is not pedantry: there the dancers come from the
    // NAMED formation, so the attribute would be describing a shape this writer did not write - and a
    // name like `Facing Couples Compact` is authored as TWO dancers declaring FOUR. Writing
    // `asymmetric="true"` beside such a name says "take the name's two dancers as the whole set",
    // which is false. It happens to round-trip today, because a reference tam carries one path per
    // COMPLETED dancer and `buildCallImpl`'s full-set branch places the missing half from the path
    // count; the attribute would be a second, contradicting source of truth for the same fact.
    //
    // MEASURED, and it is a real defect this closes rather than a formality: an exported eight-dancer
    // set whose geometry contains NO antipodal pair was re-read by the sequencer's registration path
    // (`CallLibrary.loadVariants` -> `buildCall(..., mirror: true)`) as SIXTEEN dancers, because
    // `mirrorToFull`'s antipode test could not tell it was already whole. `data.ts`'s `rebuildInstance`
    // passes `mirror: false` and its comment says that is the protection - but `registrationXml`
    // registers the SAME xml through `library.register`, where that flag does not apply, so the
    // protection covered only half the readers. The declaration covers all of them. A HALF set needs no
    // such protection, and that is not luck: its eight dancers come from a completion the reader is
    // being TOLD to perform, so `mirror: true` and `mirror: false` agree about it only once the text
    // says which - which is why `data.ts` now reads the declaration instead of passing `false`.
    reference || halfSet ? '' : 'asymmetric="true"',
    ...Object.entries(opts.extraAttrs ?? {}).map(([name, value]) => {
      if (!XML_ATTRIBUTE_NAME.test(name)) {
        throw new Error(`callToXml: "${name}" is not an XML attribute name, and an escaper cannot protect a NAME injected into the tag`);
      }
      return `${name}="${esc(value)}"`;
    }),
  ]
    .filter((a) => a !== '')
    .join(' ');
  const taminator = call.taminator ? `\n    <taminator>${esc(call.taminator)}</taminator>` : '';
  const body = reference ? '' : `    <formation>\n${dancers}\n    </formation>\n`;
  return `  <tam ${attrs}>\n` + body + `${paths}${taminator}\n  </tam>`;
}

/**
 * Whether `poses` is the formation `call` STARTS FROM, dancer for dancer, so that a
 * `formation="Name"` reference describes the call.
 *
 * INDEX FOR INDEX, and that is not a formality: a tam's paths are assigned to the formation's
 * dancers BY POSITION IN THE LIST (`buildCallImpl` pairs `dancers[i]` with `paths[i]`, mirroring a
 * four-dancer formation to eight before it does). So a call whose dancers merely occupy the same SET
 * of spots in a different order is NOT described by that reference - re-parsing it would hand each
 * dancer somebody else's path. `synthesizeSetup` produces exactly that case whenever the core call
 * orders its dancers differently from the formation, which is why this is checked rather than
 * assumed.
 *
 * The tolerance is the XML's own: the exporter rounds to four decimals, so a formation that has been
 * through the corpus once comes back within about 1e-4.
 */
export function startsFromFormation(call: CallBundle, poses: FormDancer[], tol = 1e-3): boolean {
  if (call.dancers.length !== poses.length) return false;
  for (let i = 0; i < poses.length; i++) {
    const d = call.dancers[i];
    const p = poseFor(d, 0);
    if (Math.abs(p.x - poses[i].x) > tol || Math.abs(p.y - poses[i].y) > tol) return false;
    if (Math.abs(normAngle(p.heading - poses[i].heading)) > tol) return false;
    // GENDER IS PART OF THE FORMATION rather than decoration: it is the arrangement the call's
    // gender gates read, so a reference to a shape with the boys and girls swapped is a different
    // setup, and the block has to be written out instead.
    if (poses[i].gender !== undefined && d.gender !== poses[i].gender) return false;
  }
  return true;
}

/**
 * How far the END lookup lets a dancer be from a formation's spot, per axis of the question.
 *
 * BOTH CARRY AN ERROR MARGIN, and both are measurements rather than preferences. A path is a CHAIN of
 * Bezier segments whose rotation parts are exported to four decimals, so the error accumulates along the
 * chain: the end POSITION drifts as well as the facing, and the 1e-3 that `startsFromFormation` uses - the
 * XML's own rounding - is too tight for it. Reported as "can you see why Call='Almo Swing thru':
 * Setup='Alamo Wave' doesnt detect an 'Alamo Wave' as the end formation?" That board stands 0.0023 units
 * off the spot with 0.07 degrees of facing error, so only a positional margin could have named it.
 *
 * MEASURED over the catalogue's 5432 tams, the residuals these tolerances actually ADMIT: the worst
 * position is 0.05 units (`As Couples Turn and Deal` from a Tidal Line RH ends on a Normal Lines Compact
 * with two of its eight dancers 0.05 wide of it) and the worst facing is 3.8 degrees (`Circle Left 1/2
 * Home` from Normal Lines ends on a Squared Set), against margins of 5e-2 units and 7.5e-2 rad. 2947 tams
 * get an end name at these margins.
 *
 * AND NEITHER MARGIN CAN CONFUSE TWO BOARDS, which is the thing that would make a name WRONG rather than
 * merely generous. MEASURED over `formations.xml`: the two closest spots of ONE named board are 0.9998
 * units apart ("Promenade"), so with a 0.05 margin no dancer is within reach of two of them; and with an
 * exact bottleneck assignment over every pair of different named boards at every size, the closest two
 * boards are 0.5 UNITS apart (`Box LH` / `Box LH Compact`, `Adjacent Dancers` / `Adjacent Dancers
 * Compact`), so a board would have to be within 0.25 of both to fit two names - five times this positional
 * margin. On the facing side the closest two standings on the SAME spots are 89.5 DEGREES apart at eight
 * dancers (89.5 at four, 180 at twelve), 21 times the facing margin. The pairs that differ by nothing at
 * all are arrangement variants of ONE board (`Normal Lines` / `Sashayed Lines`), which is what
 * `endFormationName` sorts out.
 *
 * SELECTING A NAME IS A RE-BASE, so a margin is also how far the end can be nudged by taking one: 5e-2
 * units is under 1% of the square's own width, which is not something a caller can see on the floor.
 */
export interface EndBoardTolerance {
  position: number;
  heading: number;
}
export const END_BOARD_TOL: EndBoardTolerance = { position: 5e-2, heading: 7.5e-2 };

/**
 * The call's END board: the pose of every dancer at the call's own last beat.
 *
 * THE END POSE IS NOT STORED, it is derived (`poseFor(d, beats)`), so it is read at the call's length
 * rather than at 0 - which is the whole difference between this and the start question.
 */
function endBoard(call: CallBundle): FormDancer[] {
  const beats = instanceBeats(call);
  return call.dancers.map((d) => {
    const p = poseFor(d, beats);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
}

/**
 * The end board against ONE formation: the number of spots whose GENDER disagrees, or `null` when the
 * formation's spots are not this board at all - the wrong size, or a spot nobody stands on.
 *
 * POSITION AND HEADING ARE THE MATCH; gender is CONSULTED, never required, which is how the two ends
 * differ. The board is compared as a SET, so the call's own dancer order is irrelevant.
 */
function endBoardGenderMisses(ends: FormDancer[], poses: FormDancer[], tol: EndBoardTolerance): number | null {
  if (ends.length !== poses.length) return null;
  // GREEDY IS EXACT HERE: the two closest spots of any named board are 0.9998 units apart (measured over
  // `formations.xml`) and the margin is 0.05, so no dancer is ever claimable by two spots. Two DANCERS can
  // coincide - a phantom call does - and then either answers for the spot, which is the same answer. `used`
  // is what stops one dancer answering for TWO spots and making a coincidence look like an arrangement: the
  // duplicated-spot check in `editor.mjs` (20b) is the control for it.
  const used = new Array(ends.length).fill(false);
  let misses = 0;
  for (const spot of poses) {
    let hit = -1;
    for (let i = 0; i < ends.length; i++) {
      if (used[i]) continue;
      const p = ends[i];
      if (Math.hypot(p.x - spot.x, p.y - spot.y) > tol.position) continue;
      if (Math.abs(normAngle(p.heading - spot.heading)) > tol.heading) continue;
      hit = i;
      break;
    }
    if (hit < 0) return null;
    used[hit] = true;
    if (spot.gender !== undefined && ends[hit].gender !== spot.gender) misses++;
  }
  return misses;
}

/**
 * Whether `poses` is the SHAPE the call ends on - and the difference from `startsFromFormation` is the
 * point of it.
 *
 * A tam's paths are paired with a formation's dancers BY POSITION IN THE LIST, so the START question has
 * to be answered dancer for dancer (and on genders). The END question is "which named shape is this
 * board?", and where a dancer sits in the call's own array is an accident of how that tam was authored.
 * MEASURED on the corpus: `Promenade Home` (Right and Left Grand Static Square) finishes on a Squared Set
 * to within 0.006 degrees, and was refused index for index because its end order is S,E,W,N with the
 * couples swapped against the formation file's S,W,N,E - so the editor's End setup row read "Unknown
 * formation" for want of this rule.
 *
 * GENDER IS NOT PART OF THE ANSWER either: a formation file's arrangement is one authoring of a board,
 * and the genders on a call's end board are whichever dancers happened to finish there. `endFormationName`
 * uses the disagreement count only to CHOOSE between arrangement variants.
 */
export function endsOnFormation(call: CallBundle, poses: FormDancer[], tol: EndBoardTolerance = END_BOARD_TOL): boolean {
  return endBoardGenderMisses(endBoard(call), poses, tol) !== null;
}

/**
 * THE NAME THE END PICKER OPENS ON: of the named formations whose SHAPE is this board, the one whose
 * genders agree at the most spots, or `null` when the board has no name.
 *
 * MORE THAN ONE NAME CAN FIT, because the corpus carries arrangement variants of a single board - the
 * same spots and facings with the boys and girls swapped. MEASURED over the catalogue's 5432 tams: 2947
 * end boards carry a name at `END_BOARD_TOL`, 1134 of them fit more than one, and genders settle 962 of
 * those uniquely. The remaining 172 fit two arrangement variants equally badly (an "Any Hand" call whose
 * end board is neither arrangement), and a tie falls to the ORDER OF `formations`, which the editor passes
 * name-sorted - measured on `a1/any_hand_concept.xml`, whose end fits `Normal Lines` and `Sashayed Lines`
 * with four disagreements each and is shown as `Normal Lines`.
 */
export function endFormationName(
  call: CallBundle,
  formations: readonly { name: string; poses: FormDancer[] }[],
  tol: EndBoardTolerance = END_BOARD_TOL,
): string | null {
  const ends = endBoard(call);
  let best: { name: string; misses: number } | null = null;
  for (const f of formations) {
    const misses = endBoardGenderMisses(ends, f.poses, tol);
    if (misses === null) continue;
    if (!best || misses < best.misses) best = { name: f.name, misses };
  }
  return best?.name ?? null;
}

/**
 * The `<tam>` for a call, NAMING its start formation when the app can resolve that name and the call
 * really starts from it, and embedding the block otherwise.
 *
 * `posesOf` is how the app answers "is that formation in the corpus" - the engine has no business
 * knowing a browser's storage or which files an app ships - and it is asked rather than assumed because
 * a reference to a formation that does not resolve is a call that loads NOWHERE, which is a far worse
 * outcome than a repeated `<formation>` block. `startsFromFormation` is the other half: the name must
 * also describe the shape the call starts from, dancer for dancer.
 */
export function callToXmlNamed(call: CallBundle, name: string, posesOf: (n: string) => FormDancer[] | null, opts: CallXmlOptions = {}): string {
  const poses = posesOf(name);
  return callToXml(call, name, {
    ...opts,
    formation: poses != null && startsFromFormation(call, poses) ? 'reference' : 'embed',
  });
}

/** Export a synthesized setup as a taminations-style `<tam>` XML string. */
export function setupToXml(core: CallBundle, setup: NewSetup): string {
  return callToXml(synthesizeSetup(core, setup), setup.name);
}

function bezAttr(b: BezierData): string {
  return `cx1="${rf(b.cx1)}" cy1="${rf(b.cy1)}" cx2="${rf(b.cx2)}" cy2="${rf(b.cy2)}" x2="${rf(b.x2)}" y2="${rf(b.y2)}"`;
}
function bezRotAttr(b: BezierData): string {
  return `cx3="${rf(b.cx1)}" cx4="${rf(b.cx2)}" cy4="${rf(b.cy2)}" x4="${rf(b.x2)}" y4="${rf(b.y2)}"`;
}
/**
 * Export precision.
 *
 * Two decimals is the asset files' own house style, and it is NOT enough for the editor's
 * round trip: a path is a CHAIN of segments, each exporting its rotation Bezier to the
 * nearest 0.01, so the heading error accumulates along the chain and the final pose is out
 * by the distance travelled since. MEASURED on `ms/circle.xml` edited to 10.5 beats: the
 * end pose came back 0.0672 units out - 13 times the rounding of any single coordinate -
 * which is a dancer standing visibly off its spot. At four decimals the same path is out
 * by 0.0008, and `editor.mjs` pins both numbers.
 */
function rf(n: number): string {
  return (Math.round(n * 1e4) / 1e4).toString();
}
/** The angle a dancer is WRITTEN with, canonical in `[0, 360)`.
 *
 * A FACING HAS TWO SPELLINGS AND A GEOMETRY HAS ONE, so the exported text must not depend on which code
 * path built the bundle. `angleDeg` is authored, or derived from a pose, and the two disagree; MEASURED
 * (witness `ms/alamo_style.xml`, dancer 0, move 3): `requireDancer` normalises a half-set bundle through
 * `normalizeInstance`, which re-derives each mirrored dancer's start heading from `poseFor` - so a no-op
 * edit exported `angle="270"` as `angle="-90"`, the SAME facing, on two lines that have nothing to do
 * with the move that was edited. Two of the 64 exported lines differed and the file was dirtied by a
 * handle being dropped back where it started (`poc/tools/facing-handle-probe.mjs`).
 *
 * The obvious fix - stop `normalizeInstance` re-deriving the angle - is rejected: it is the one function
 * that rewrites a bundle in full-set coordinates, its output is pinned to one ulp by `editor.mjs`, and a
 * mirrored dancer's `angleDeg` is its BASE angle, which is not the full-set facing at all. Canonicalising
 * the WRITTEN value fixes every path at once, including the 15 negative angles the corpus authors
 * (`angle="-90"` and friends): those re-save as their positive equivalents, same facing, and the
 * round trip's heading agreement is unchanged because it is measured through `poseFor`, not through text.
 */
function rfAngle(deg: number): string {
  const wrapped = ((deg % 360) + 360) % 360;
  // 359.9999999999999 is 360 to within the export's own precision, and writing `360` would be out of
  // range for a reader that expects a half-open interval.
  return rf(wrapped >= 360 - 5e-5 ? 0 : wrapped);
}
