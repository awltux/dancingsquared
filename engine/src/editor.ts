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

import type { BezierData, CallBundle, DancerSpec, Gender, Hands, Seg } from './types.js';
import { DEG, poseFor } from './core.js';

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

/** Serialize an arbitrary call bundle as a taminations-style `<tam>` XML string. */
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
      return `        <dancer gender="${d.gender}" x="${r2(x)}" y="${r2(y)}" angle="${r2(a)}"/>`;
    })
    .join('\n');
  const paths = call.dancers
    .map(
      (d) =>
        `    <path>\n` +
        d.path.map((s) => `      <movement hands="${s.hands}" beats="${r2(s.beats)}" ${bezAttr(s.translate)}${s.rotate ? ' ' + bezRotAttr(s.rotate) : ''}/>`).join('\n') +
        `\n    </path>`,
    )
    .join('\n');
  return (
    `  <tam title="${esc(call.title)}" from="${esc(from)}" parts="${esc(call.parts)}">\n` +
    `    <formation>\n${dancers}\n    </formation>\n` +
    `${paths}\n  </tam>`
  );
}

/** Export a synthesized setup as a taminations-style `<tam>` XML string. */
export function setupToXml(core: CallBundle, setup: NewSetup): string {
  return callToXml(synthesizeSetup(core, setup), setup.name);
}

function bezAttr(b: BezierData): string {
  return `cx1="${r2(b.cx1)}" cy1="${r2(b.cy1)}" cx2="${r2(b.cx2)}" cy2="${r2(b.cy2)}" x2="${r2(b.x2)}" y2="${r2(b.y2)}"`;
}
function bezRotAttr(b: BezierData): string {
  return `cx3="${r2(b.cx1)}" cx4="${r2(b.cx2)}" cy4="${r2(b.cy2)}" x4="${r2(b.x2)}" y4="${r2(b.y2)}"`;
}
function r2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}
