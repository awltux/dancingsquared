// Tolerant formation matching.
//
// Given the board dancers and a candidate formation (or a call's <tam> start
// setup), find whether they represent the same formation up to translation,
// rotation (multiples of 90deg) and reflection, and produce a mapping from the
// board dancers to the candidate dancers. This is the core of both "recognize
// the current formation" and "apply this call's setup".

import { isKnownCouple } from './constants.js';

export interface Matchable {
  x: number;
  y: number;
  heading: number; // radians
  gender?: 'boy' | 'girl' | 'phantom';
  // Home-square couple (1..4). When present on BOTH the source (board) and the
  // target (call setup), matching prefers an alignment that maps each dancer to
  // a slot of the SAME home couple. This is what keeps a "Heads X"/"Sides X"
  // call acting on the ORIGINAL head/side couples (home identity) instead of
  // whoever currently stands at the N/S position after the set has rotated.
  // UNKNOWN_COUPLE (0) means "identity unknown" and never matches.
  couple?: number;
}

export interface FormationMatch {
  mapping: number[]; // mapping[boardIdx] = candidateIdx
  error: number; // total offset (position + facing)
  rot: number; // the rotation applied to the target to overlay it on the source
  reflect: boolean; // whether a reflection (mirror) was applied to the target
  cSrc: { x: number; y: number }; // center of the source (board)
  cTgt: { x: number; y: number }; // center of the target (candidate)
  // When the match is a SUBSET match (source.length > target.length), `subset`
  // lists the source dancer indices selected to form the target (length ==
  // target.length). `mapping` then only covers those indices; the others are -1.
  subset?: number[];
}

// Gender compatibility for gender-specific matching. 'phantom' is a wildcard
// (matches boy, girl or phantom); any two real genders must be equal.
function genderCompatible(a: Matchable['gender'], b: Matchable['gender']): boolean {
  if (!a || !b || a === 'phantom' || b === 'phantom') return true;
  return a === b;
}

const ROTS = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (-3 * Math.PI) / 4, -Math.PI / 2, -Math.PI / 4];

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

// Rotate then (optionally) reflect a copy of `target`, and center it. Gender is
// carried with the dancer through the transform.
function transformTarget(target: Matchable[], rot: number, reflect: boolean, c: { x: number; y: number }): Matchable[] {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return target.map((d) => {
    let x = d.x - c.x;
    let y = d.y - c.y;
    if (reflect) x = -x;
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return { x: rx, y: ry, heading: d.heading + rot + (reflect ? Math.PI : 0), gender: d.gender, couple: d.couple };
  });
}

function greedyAssign(
  source: Matchable[],
  target: Matchable[],
  requireGender: boolean,
): { mapping: number[]; error: number } {  const mapping = new Array(source.length).fill(-1);
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
      if (requireGender && !genderCompatible(source[i].gender, target[j].gender)) continue;
      const dx = source[i].x - target[j].x;
      const dy = source[i].y - target[j].y;
      const d = Math.hypot(dx, dy) + angDiff(source[i].heading, target[j].heading) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best === -1) return { mapping: [], error: Infinity }; // no gender-compatible slot
    used[best] = true;
    mapping[i] = best;
    error += bestD;
  }
  return { mapping, error };
}

/**
 * The sorted pairwise-distance signature of a set, invariant to
 * translation/rotation/reflection. Two congruent sets always produce the same
 * sorted list of pairwise distances, so comparing signatures (element-wise on
 * the sorted arrays) is a correct, ORDER-INDEPENDENT quick reject: it does not
 * assume the dancers are indexed in the same order in both sets.
 */
function distanceSignature(ds: Matchable[]): number[] {
  const d: number[] = [];
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) d.push(Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  return d.sort((a, b) => a - b);
}

// How many source<->target pairs share the same home couple, counted only when
// both dancers carry a REAL couple (1..4). Used as a tie-break in
// matchEqualLength so a rotationally-symmetric setup resolves to the alignment
// that keeps each dancer on its home couple — which is what makes "Heads X"/
// "Sides X" act on the ORIGINAL head/side couples rather than whoever currently
// stands at N/S.
//
// INDEX INDEPENDENCE: UNKNOWN_COUPLE (0) is not a couple. A board synthesised
// from geometry alone carries it, so those dancers contribute nothing here and
// an index-derived placeholder can never decide a match.
function identityScore(source: Matchable[], target: Matchable[], mapping: number[]): number {
  let s = 0;
  for (let i = 0; i < source.length; i++) {
    const j = mapping[i];
    if (j < 0) continue;
    const a = source[i].couple;
    const b = target[j].couple;
    if (isKnownCouple(a) && isKnownCouple(b) && a === b) s++;
  }
  return s;
}

/** Match `source` against `target`, both assumed EQUAL length, up to
 * rotation/reflection. Returns the best alignment or null. Order-independent
 * (uses the sorted distance signature + greedy one-to-all assignment). */
function matchEqualLength(  source: Matchable[],
  target: Matchable[],
  maxError: number,
  requireGender: boolean,
): FormationMatch | null {
  const s1 = distanceSignature(source);
  const s2 = distanceSignature(target);
  // This is the tolerance that ACTUALLY binds, not `maxError`. Moving one dancer changes its
  // distance to every other dancer by at most the displacement, so a caller passing maxError = 6.0
  // gets an effective per-dancer allowance of 0.5, not 6.0. Measured and pinned in
  // test/selection.mjs; see the note on KNOWN_FORMATION_MAX in constants.ts.
  const sigTol = maxError / 12;
  for (let k = 0; k < s1.length; k++) {
    if (Math.abs(s1[k] - s2[k]) > sigTol) return null;
  }

  const cSrc = center(source);
  const cTgt = center(target);
  const centered = source.map((d) => ({ x: d.x - cSrc.x, y: d.y - cSrc.y, heading: d.heading, gender: d.gender, couple: d.couple }));
  let best: FormationMatch | null = null;
  let bestIdent = -1;
  for (const rot of ROTS) {
    for (const reflect of [false, true]) {
      const t = transformTarget(target, rot, reflect, cTgt);
      const res = greedyAssign(centered, t, requireGender);
      if (!isFinite(res.error)) continue;
      const ident = identityScore(centered, t, res.mapping);
      if (
        best === null ||
        res.error < best.error - TIE_EPS ||
        (Math.abs(res.error - best.error) <= TIE_EPS && ident > bestIdent)
      ) {
        best = { mapping: res.mapping, error: res.error, rot, reflect, cSrc, cTgt };
        bestIdent = ident;
      }
    }
  }
  return best !== null && best.error <= maxError ? best : null;
}

/** Enumerate all k-combinations of the indices 0..n-1, calling `visit` for each. */
function forEachCombination(n: number, k: number, visit: (combo: number[]) => void): void {
  if (k > n) return;
  const idx = new Array<number>(k);
  const rec = (start: number, depth: number): void => {
    if (depth === k) {
      visit(idx);
      return;
    }
    for (let i = start; i <= n - (k - depth); i++) {
      idx[depth] = i;
      rec(i + 1, depth + 1);
    }
  };
  rec(0, 0);
}

/**
 * Find whether `source` (a board, usually 8 dancers) CONTAINS `target` (a
 * candidate formation or call setup, which may be a partial set of 2 or 4
 * dancers) up to translation/rotation/reflection. Returns the best mapping +
 * total offset, or null if no match within `maxError`.
 *
 * Lengths:
 *  - `source.length === target.length`: a full one-to-one match (any dancer
 *    ordering works — the sorted distance signature + greedy assignment make it
 *    order-independent).
 *  - `source.length > target.length`: a SUBSET match — we search all
 *    (source.length choose target.length) subsets of the board and return the
 *    best one that reproduces the target. `match.subset` lists the chosen board
 *    indices.
 *  - `source.length < target.length`: impossible (target bigger than board) ->
 *    null.
 *
 * When `requireGender` is true, the mapping must also be GENDER-CONSISTENT: each
 * board dancer is only assigned to a candidate slot whose gender is compatible.
 * This is used for gender-specific calls (e.g. "Boys Turn Back"), so a call
 * only applies when the board's boy/girl arrangement actually matches its setup.
 * Recognition and generic calls pass false and ignore gender.
 */
export function matchFormations(
  source: Matchable[],
  target: Matchable[],
  maxError = 6.0,
  requireGender = false,
): FormationMatch | null {
  if (target.length === 0 || source.length < target.length) return null;
  if (source.length === target.length) {
    return matchEqualLength(source, target, maxError, requireGender);
  }
  // Best single subset match.
  return matchFormationsAll(source, target, maxError, requireGender, 1)[0] ?? null;
}

/**
 * Like `matchFormations`, but returns ALL (up to `maxMatches`) DISJOINT subsets
 * of `source` that reproduce the smaller `target` — i.e. the target formation
 * appearing several times in the board at once (e.g. four separate Facing
 * Couples in a squared set). Each result has `match.subset` = the board indices
 * of that copy; the copies are pairwise disjoint (no dancer is reused). Sorted
 * by error (best first). Returns [] when `target` is not present or when
 * `source.length < target.length`.
 */
export function matchFormationsAll(
  source: Matchable[],
  target: Matchable[],
  maxError = 6.0,
  requireGender = false,
  maxMatches = Infinity,
): FormationMatch[] {
  if (target.length === 0 || source.length < target.length) return [];
  if (source.length === target.length) {
    const m = matchEqualLength(source, target, maxError, requireGender);
    return m ? [m] : [];
  }

  // Collect every matching subset (expanded to full source-index mappings).
  const tgtSig = distanceSignature(target);
  // This is the tolerance that ACTUALLY binds, not `maxError`. Moving one dancer changes its
  // distance to every other dancer by at most the displacement, so a caller passing maxError = 6.0
  // gets an effective per-dancer allowance of 0.5, not 6.0. Measured and pinned in
  // test/selection.mjs; see the note on KNOWN_FORMATION_MAX in constants.ts.
  const sigTol = maxError / 12;
  const candidates: { m: FormationMatch; combo: number[] }[] = [];
  forEachCombination(source.length, target.length, (combo) => {
    // Snapshot the combo: forEachCombination reuses one internal array, so store
    // a copy to keep each candidate's subset/mapping stable.
    const selected = [...combo];
    const sub = selected.map((i) => source[i]);
    const sSig = distanceSignature(sub);
    for (let k = 0; k < sSig.length; k++) {
      if (Math.abs(sSig[k] - tgtSig[k]) > sigTol) return;
    }
    const m = matchEqualLength(sub, target, maxError, requireGender);
    if (!m) return;
    const mapping = new Array<number>(source.length).fill(-1);
    for (let s = 0; s < selected.length; s++) mapping[selected[s]] = m.mapping[s];
    candidates.push({ m: { ...m, mapping, subset: selected }, combo: selected });
  });

  // Greedily pack as many DISJOINT matches as possible, best (lowest error) first.
  candidates.sort((a, b) => a.m.error - b.m.error);
  const results: FormationMatch[] = [];
  const used = new Set<number>();
  for (const c of candidates) {
    if (results.length >= maxMatches) break;
    const combo = c.combo;
    if (combo.some((i) => used.has(i))) continue;
    for (const i of combo) used.add(i);
    results.push(c.m);
  }
  return results;
}

/** Position error of a single mapped pair (for the recognized-formation label). */
export function pairError(a: Matchable, b: Matchable): number {
  return Math.hypot(a.x - b.x, a.y - b.y) + angDiff(a.heading, b.heading) * 0.5;
}
