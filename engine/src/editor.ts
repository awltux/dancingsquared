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

import type { BezierData, CallBundle, DancerSpec, Gender, Hands, Pose, Seg } from './types.js';
import { DEG, poseFor } from './core.js';
// The DERIVED identity of an edited start formation: `assignHomeIdentity` is the same
// read the renderer colours by, so the editor's `couple` column cannot disagree with the
// stage next to it.
import { assignHomeIdentity } from './sequencer/identity.js';

function normAngleSafe(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

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
 */
export function deriveFormationMapping(
  coreStart: { x: number; y: number }[],
  formation: FormDancer[],
): number[] {
  if (formation.length !== coreStart.length) {
    throw new Error(
      `deriveFormationMapping: cannot align ${formation.length} dancers to a ${coreStart.length}-dancer core — refusing to pair them by array index`,
    );
  }
  const cCore = centroid(coreStart);
  let bestMap: number[] | null = null; // bestMap[j] = core slot for formation dancer j
  let bestErr = Infinity;
  for (const rot of ORIGIN_ROTS) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // Rotate the formation about the ORIGIN (position + heading).
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
    const { mapping, error } = greedyAssignEditor(moved, coreStart);
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

// Greedy 1:1 assignment: map[j] = core index, minimizing position+facing.
function greedyAssignEditor(
  moved: { x: number; y: number; heading: number }[],
  core: { x: number; y: number; heading?: number }[],
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
    for (let i = 0; i < core.length; i++) {
      if (used[i]) continue;
      const h = core[i].heading;
      const dx = moved[j].x - core[i].x;
      const dy = moved[j].y - core[i].y;
      const dh = h === undefined ? 0 : Math.abs(normAngleSafe(moved[j].heading - h)) * 0.5;
      const d = Math.hypot(dx, dy) + dh;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
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

// ------------------------------------------------------------------ pad segments

function rot(a: number, v: { x: number; y: number }): { x: number; y: number } {
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
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
  const a = normAngleSafe(to.heading - from.heading);
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
    const he = Math.abs(normAngleSafe(actual[i].heading - ordered[i].heading));
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
          Math.abs(normAngleSafe(cur[i].heading - formation[s].heading)) * 0.5;
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
    Math.abs(normAngleSafe(pose.heading - target.heading)) <= 1e-9
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
    heading = Math.max(heading, Math.abs(normAngleSafe(p.heading - q.heading)));
  }
  return { pos, heading };
}

/** Serialize an arbitrary call bundle as a taminations-style `<tam>` XML string.
 *
 * EVERY DECLARATION THE BUNDLE CARRIES IS WRITTEN BACK OUT, and the two attributes that
 * used to be dropped are the ones that change behaviour:
 *
 *  - `sequencer` decides whether the sequencer may MATCH this variant. A fix or a created
 *    position is registered from this XML (`Catalog.registrationXml`), so dropping it
 *    re-opened the demonstration hole the flag exists to close: an edit to the
 *    `sequencer="no"` half of a call came back as an ordinary, matchable setup.
 *  - `actives` says WHICH dancers the tam's paths describe, which is the whole reason
 *    `Centers Split Two` currently applies as a whole-board `Pass Thru`. An editor has no
 *    business erasing the attribute that records that.
 *
 * The edit is written in EXPANDED form: named `<move select="…"/>` references come out as
 * explicit `<movement>` Beziers. The two are the same animation (`resolvePath` expands the
 * first into the second), and `editor.mjs` proves the round trip both ways. */
export function callToXml(call: CallBundle, name?: string): string {
  const from = name ?? (call.from || call.title);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  // A mirrored (half-set) dancer is authored at base (x,y,a) and rendered 180deg
  // about the origin. The XML format has no `mirror` attribute, so serialize it
  // as the equivalent NON-mirror dancer (base -x,-y,a+180 with the same path) so
  // re-parsing reproduces the full-set motion.
  const dancers = call.dancers
    .map((d) => {
      const x = d.mirror ? -d.x : d.x;
      const y = d.mirror ? -d.y : d.y;
      const a = d.mirror ? d.angleDeg + 180 : d.angleDeg;
      return `        <dancer gender="${d.gender}" x="${rf(x)}" y="${rf(y)}" angle="${rf(a)}"/>`;
    })
    .join('\n');
  const paths = call.dancers
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
    `parts="${esc(call.parts)}"`,
    call.sequencerMode ? `sequencer="${call.sequencerMode}"` : '',
    call.actives ? `actives="${esc(call.actives)}"` : '',
  ]
    .filter((a) => a !== '')
    .join(' ');
  const taminator = call.taminator ? `\n    <taminator>${esc(call.taminator)}</taminator>` : '';
  return (
    `  <tam ${attrs}>\n` +
    `    <formation>\n${dancers}\n    </formation>\n` +
    `${paths}${taminator}\n  </tam>`
  );
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
