// Tolerant formation matching.
//
// Given the board dancers and a candidate formation (or a call's <tam> start
// setup), find whether they represent the same formation up to translation,
// rotation (multiples of 90deg) and reflection, and produce a mapping from the
// board dancers to the candidate dancers. This is the core of both "recognize
// the current formation" and "apply this call's setup".

export interface Matchable {
  x: number;
  y: number;
  heading: number; // radians
}

export interface FormationMatch {
  mapping: number[]; // mapping[boardIdx] = candidateIdx
  error: number; // total offset (position + facing)
  rot: number; // the rotation applied to the target to overlay it on the source
  reflect: boolean; // whether a reflection (mirror) was applied to the target
  cSrc: { x: number; y: number }; // center of the source (board)
  cTgt: { x: number; y: number }; // center of the target (candidate)
}

const ROTS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

// When two alignments tie on error (common for rotationally-symmetric
// formations like a squared set, where all four rotations fit equally well),
// prefer the EARLIER one — i.e. the smallest rotation, no reflection. This keeps
// a symmetric board from being re-oriented to an arbitrary 90/180/-90 rotation
// during a re-base (which would spin the whole set), and otherwise only breaks
// floating-point ties that are geometrically equivalent.
const TIE_EPS = 1e-9;

const angDiff = (a: number, b: number) => {
  let d = (a - b) % (2 * Math.PI);
  if (d < -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
};

function center(ds: Matchable[]): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  for (const d of ds) {
    cx += d.x;
    cy += d.y;
  }
  return { x: cx / ds.length, y: cy / ds.length };
}

// Rotate then (optionally) reflect a copy of `target`, and center it.
function transformTarget(target: Matchable[], rot: number, reflect: boolean, c: { x: number; y: number }): Matchable[] {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return target.map((d) => {
    let x = d.x - c.x;
    let y = d.y - c.y;
    if (reflect) x = -x;
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return { x: rx, y: ry, heading: d.heading + rot + (reflect ? Math.PI : 0) };
  });
}

function greedyAssign(source: Matchable[], target: Matchable[]): { mapping: number[]; error: number } {
  const mapping = new Array(source.length).fill(-1);
  const used = new Array(target.length).fill(false);
  const order = source
    .map((_, i) => i)
    .sort((a, b) => (source[a].x ** 2 + source[a].y ** 2) - (source[b].x ** 2 + source[b].y ** 2));
  let error = 0;
  for (const i of order) {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < target.length; j++) {
      if (used[j]) continue;
      const dx = source[i].x - target[j].x;
      const dy = source[i].y - target[j].y;
      const d = Math.hypot(dx, dy) + angDiff(source[i].heading, target[j].heading) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    used[best] = true;
    mapping[i] = best;
    error += bestD;
  }
  return { mapping, error };
}

/**
 * Find whether `source` (board) and `target` (candidate) are the same formation
 * up to translation/rotation/reflection. Returns the best mapping + total
 * offset, or null if the best error exceeds `maxError`.
 */
export function matchFormations(
  source: Matchable[],
  target: Matchable[],
  maxError = 6.0,
): FormationMatch | null {
  if (source.length !== target.length) return null;

  // Quick reject: the sorted pairwise-distance signature is invariant to
  // translation/rotation/reflection, so formations that differ in spacing are
  // definitely not the same. This stops recognition matching unrelated setups.
  const sig = (ds: Matchable[]) => {
    const d: number[] = [];
    for (let i = 0; i < ds.length; i++)
      for (let j = i + 1; j < ds.length; j++) d.push(Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
    return d.sort((a, b) => a - b);
  };
  const s1 = sig(source);
  const s2 = sig(target);
  // Signature tolerance scales with maxError so a caller-provided margin also
  // relaxes this quick reject (0.5 at the default maxError of 6.0).
  const sigTol = maxError / 12;
  for (let k = 0; k < s1.length; k++) {
    if (Math.abs(s1[k] - s2[k]) > sigTol) return null;
  }

  const cSrc = center(source);
  const cTgt = center(target);
  const centered = source.map((d) => ({ x: d.x - cSrc.x, y: d.y - cSrc.y, heading: d.heading }));
  let best: FormationMatch | null = null;
  for (const rot of ROTS) {
    for (const reflect of [false, true]) {
      const t = transformTarget(target, rot, reflect, cTgt);
      const res = greedyAssign(centered, t);
      if (best === null || res.error < best.error - TIE_EPS) {
        best = { mapping: res.mapping, error: res.error, rot, reflect, cSrc, cTgt };
      }
    }
  }
  return best !== null && best.error <= maxError ? best : null;
}

/** Position error of a single mapped pair (for the recognized-formation label). */
export function pairError(a: Matchable, b: Matchable): number {
  return Math.hypot(a.x - b.x, a.y - b.y) + angDiff(a.heading, b.heading) * 0.5;
}
