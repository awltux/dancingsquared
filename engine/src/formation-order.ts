// REORDERING A FORMATION'S DANCER ORDER WITHOUT MOVING ANYBODY.
//
// WHY THIS IS A RULE AND NOT A SCRIPT. A named formation's `<dancer>` list is not decoration: a `<tam>`'s
// `<path>` list is paired with those dancers BY INDEX (`buildCallImpl` pairs `dancers[i]` with `paths[i]`,
// with a half-set tam replaying one path for its mirrored partner). So the ORDER of a formation is part of
// the formation, and changing it changes which track every dancer gets. Reported as: "I have discovered
// that the Circle formation is out of order. I want to create a formation that ensures the dancer index
// goes in order of a square set (zero Square in FASR terms), [0,1] at the south, [2,3] at the east."
//
// THE FACT THAT MAKES THIS A PERMUTATION RATHER THAN A REWRITE. A path is authored in the dancer's OWN
// frame (`square-dancing.md` §7.1 and `core.ts`: +X is the way the dancer faces when the move begins). A
// 180-degree turn about the set centre maps a dancer's frame onto its ANTIPODE's frame, so the two
// dancers share a LOCAL track - which is exactly what the corpus's half-set completion already relies on
// (`convert.ts`'s `mirrorToFull` puts each written dancer's path on its antipode unchanged). So the same
// board in a new order is the same paths in a new order, and no curve is touched.
//
// THE TWO PAIRING MODES ARE NOT INTERCHANGEABLE, which is why `halfTurn` is an option rather than the
// rule:
//
//   - HALF-SET tam (`paths.length === formation written count`): one path per written dancer, and the
//     mirrored half reuses those local paths. A new written dancer may therefore take the old path of
//     ANY dancer on the same spot up to a half turn.
//   - WHOLE-SET tam (`paths.length === 2 * written`): the parser completes the formation to the full set
//     and pairs all eight paths 1:1, so every dancer has its OWN path and the antipode's path is NOT
//     interchangeable. Matching must then be exact.
//
// MEASURED (this module's first use, `scripts/reorder-formation.mjs`): reordering `Circle`'s four written
// dancers from W,N,E,S to S,E,N,W and permuting the 22 tams that name it by `[2,3,0,1]` reproduces every
// dependent board to a worst sampled position difference of 3.23e-15 (16 samples per track; the limit is
// 1e-6). The rejected alternative is a whole-tam re-export through `callToXml`: it rewrites formatting,
// drops comments and turns 4-path tams into 8-path ones, so the diff cannot be reviewed.
//
// THE COMPASS ORDER IS THE COMPARISON, not an authority. `formationCompassOrder` reads a completed set's
// pairs and names where each pair sits - which is how "the Circle formation is out of order" became a
// measurement (`Circle` was W,N,E,S where a square set is S,E,N,W). It is used to CHECK an order, never to
// impose one: the caller chooses the order and this module only asks whether the spots are the same.

// `DEG` COMES FROM `core.ts`, WHICH OWNS IT — this module used to declare its own `Math.PI / 180` four lines below,
// a second spelling of a unit the engine already exports (`poc/tools/end-spin-probe.mjs` binds it the same way,
// `const DEG = engine.DEG`). `engine/test/angle-normalisation.mjs` §5 is the census that keeps it at one.
import { DEG, poseFor } from './core.js';
import { normAngle } from './moves.js';
// THE ENGINE'S TOLERANCES, from the module that owns them. `TOL` here WAS the XML round trip's 1e-3 under a local
// name - the same rule `startsFromFormation` uses, written twice - and `sameSpot`'s comparisons were against a bare
// 1e-9. Both are the engine's now: see `tolerances.ts` for why the first is not `ARC_TOL` and the second is not
// `SAME_BOARD_TOL`.
import { EXACT_TOL, XML_ROUND_TRIP_TOL } from './tolerances.js';
import type { CallBundle } from './types.js';
// `FormDancer` is declared with the editor's instance model; `CallBundle` is a core type. Both are
// type-only imports, so this module adds nothing to the runtime graph but `poseFor` and `DEG`.
import type { FormDancer } from './editor.js';

/** The four compass points a couple can stand on, going counter-clockwise: the square set's couple order. */
export type CompassPoint = 'south' | 'east' | 'north' | 'west';

/** The compass points in the order FASR's Sequence field numbers the home couples (1, 2, 3, 4). */
export const COMPASS_SEQUENCE: readonly CompassPoint[] = ['south', 'east', 'north', 'west'];

/** The angle of each compass point, in degrees measured from +X (the board frame `atan2(y, x)` uses). */
const COMPASS_ANGLE: Record<CompassPoint, number> = { south: 270, east: 0, north: 90, west: 180 };

/**
 * Are these the same spot, allowing a 180-degree turn about the set centre - i.e. the same LOCAL frame?
 *
 * A dancer at `(x, y)` facing `h` and one at `(-x, -y)` facing `h + pi` face the same way in their own
 * frames: every local control point is identical. That is the relation `mirrorToFull` relies on, and it is
 * the one this module uses to move a path between a dancer and its antipode without touching a curve.
 */
export function sameSpotUpToHalfTurn(a: FormDancer, b: FormDancer, tol = XML_ROUND_TRIP_TOL): boolean {
  const exact = Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(normAngle(a.heading - b.heading)) <= tol;
  if (exact) return genderOk(a, b);
  const turned = Math.abs(a.x + b.x) <= tol && Math.abs(a.y + b.y) <= tol && Math.abs(normAngle(a.heading - (b.heading + Math.PI))) <= tol;
  return turned && genderOk(a, b);
}

/** The same spot with no rotation allowed: the rule a whole-set tam's own paths need. */
export function sameSpotExact(a: FormDancer, b: FormDancer, tol = XML_ROUND_TRIP_TOL): boolean {
  return (
    Math.abs(a.x - b.x) <= tol &&
    Math.abs(a.y - b.y) <= tol &&
    Math.abs(normAngle(a.heading - b.heading)) <= tol &&
    genderOk(a, b)
  );
}

/** A spot with no declared gender does not constrain the other side, the way `startsFromFormation` reads it. */
function genderOk(a: FormDancer, b: FormDancer): boolean {
  return a.gender === undefined || b.gender === undefined || a.gender === b.gender;
}

/** Why a reorder cannot be expressed as a path permutation. Each is a refusal, never a guess. */
export type ReorderRefusal = 'size-mismatch' | 'no-partner' | 'not-a-permutation';

export type ReorderPlan =
  | { ok: true; permutation: number[] }
  | { ok: false; reason: ReorderRefusal; index: number };

/**
 * The permutation that re-expresses a formation's OLD authored order as its NEW one, or a refusal.
 *
 * `permutation[i]` is the index in `oldDancers` of the path that the new dancer `i` must take. The spots
 * must be the same SET - every new spot must be an old spot - or there is nothing to permute and the caller
 * has changed the shape rather than its order.
 *
 * `halfTurn: true` (the default) is the half-set rule: a path may move to an antipodal spot. `halfTurn:
 * false` is the whole-set rule: exact spots only. See the header for why they differ.
 */
export function formationReorderPermutation(
  oldDancers: FormDancer[],
  newDancers: FormDancer[],
  opts: { halfTurn?: boolean; tol?: number } = {},
): ReorderPlan {
  if (oldDancers.length !== newDancers.length) {
    return { ok: false, reason: 'size-mismatch', index: Math.min(oldDancers.length, newDancers.length) };
  }
  const halfTurn = opts.halfTurn ?? true;
  const tol = opts.tol ?? XML_ROUND_TRIP_TOL;
  const same = halfTurn ? sameSpotUpToHalfTurn : sameSpotExact;
  const used = new Array(oldDancers.length).fill(false);
  const permutation: number[] = [];
  for (const dancer of newDancers) {
    const at = oldDancers.findIndex((old, j) => !used[j] && same(old, dancer, tol));
    if (at < 0) return { ok: false, reason: 'no-partner', index: permutation.length };
    used[at] = true;
    permutation.push(at);
  }
  // Two new dancers claiming one old spot would have been caught by `used`, but a caller passing duplicate
  // spots in `newDancers` still has to be refused: a formation cannot have two dancers in one place.
  if (new Set(permutation).size !== permutation.length) return { ok: false, reason: 'not-a-permutation', index: 0 };
  return { ok: true, permutation };
}

/** `items` re-ordered so that `out[i] === items[permutation[i]]`. Lengths are the caller's contract. */
export function permuteBy<T>(items: T[], permutation: number[]): T[] {
  return permutation.map((j) => items[j]);
}

/**
 * Where each CONSECUTIVE PAIR of a completed formation sits on the compass, or `null` when it does not
 * sit on it at all.
 *
 * Pairs are consecutive because that is how a half-set tam is laid out and how the corpus writes a couple
 * (boy then girl, §7.1.1). Each pair's direction is the CIRCULAR mean of its two dancers - the plain
 * average of the two angles fails across the 0/360 boundary, which is the bug this comment exists to stop
 * being reintroduced: with an average, `(337.5 + 22.5) / 2` reads 180 (west) instead of 0 (east) and the
 * east couple of `Circle` matched the west one.
 */
export function formationCompassOrder(
  completed: FormDancer[],
  tol = 1,
): { order: CompassPoint[]; worst: number } | null {
  if (completed.length === 0 || completed.length % 2 !== 0) return null;
  const order: CompassPoint[] = [];
  let worst = 0;
  for (let k = 0; k < completed.length / 2; k++) {
    const a = completed[2 * k];
    const b = completed[2 * k + 1];
    const sx = Math.cos(Math.atan2(a.y, a.x)) + Math.cos(Math.atan2(b.y, b.x));
    const sy = Math.sin(Math.atan2(a.y, a.x)) + Math.sin(Math.atan2(b.y, b.x));
    // A pair straddling the origin has no direction at all: that is a formation of concentric pairs, not a
    // ring, and the caller has to be told the compass cannot name it rather than given a made-up point.
    if (Math.hypot(sx, sy) < EXACT_TOL) return null;
    const mid = ((Math.atan2(sy, sx) / DEG) + 360) % 360;
    const best = COMPASS_SEQUENCE.map((point) => ({
      point,
      error: Math.abs(((mid - COMPASS_ANGLE[point] + 540) % 360) - 180),
    })).sort((a2, b2) => a2.error - b2.error)[0];
    if (best.error > tol) return null;
    worst = Math.max(worst, best.error);
    order.push(best.point);
  }
  return { order, worst };
}

/** The compass order as the four letters a report or a pin can carry, e.g. `SENW`. */
export function compassLetters(order: CompassPoint[]): string {
  return order.map((point) => point[0].toUpperCase()).join('');
}

/** A formation's completed (whole-set) dancers, for a caller that has only the authored half. */
export function completedFormation(authored: FormDancer[]): FormDancer[] {
  return [...authored, ...authored.map((d) => ({ x: -d.x, y: -d.y, heading: d.heading + Math.PI, gender: d.gender }))];
}

export interface GeometryComparison {
  ok: boolean;
  /** The worst sampled POSITION difference, over every dancer and every sample. */
  worst: number;
  /** How many dancers of `after` had no dancer of `before` at the same start pose. */
  unmatched: number;
  /** Which dancer and sample set the worst difference, for a failure message. */
  worstDancer: number | null;
}

/**
 * Do these two builds of the SAME call put every dancer through the same track?
 *
 * BY START POSE, NOT BY INDEX, because the index is the thing a formation reorder changes. A dancer is
 * matched to the dancer of `before` that starts on the same spot facing the same way, and then the two
 * tracks are sampled at the same beats and compared. This is the whole acceptance test of a reorder: the
 * ORDER may change, nobody may move.
 *
 * The tolerance is the caller's, and no default is offered: `1e-6` is right for a conversion that only
 * permutes existing curves, while a conversion that re-derives a curve needs the XML round trip's 1e-3.
 */
export function compareGeometry(
  before: CallBundle,
  after: CallBundle,
  opts: { samples?: number; tol?: number } = {},
): GeometryComparison {
  const samples = opts.samples ?? 16;
  const tol = opts.tol ?? 1e-6;
  let worst = 0;
  let unmatched = 0;
  let worstDancer: number | null = null;
  let ok = true;
  if (before.dancers.length !== after.dancers.length) {
    return { ok: false, worst: Infinity, unmatched: after.dancers.length, worstDancer: null };
  }
  for (let i = 0; i < after.dancers.length; i++) {
    const dancer = after.dancers[i];
    const start = poseFor(dancer, 0);
    const match = before.dancers.find((other) => {
      const p = poseFor(other, 0);
      return Math.abs(p.x - start.x) <= tol && Math.abs(p.y - start.y) <= tol && Math.abs(normAngle(p.heading - start.heading)) <= tol;
    });
    if (!match) {
      unmatched++;
      ok = false;
      continue;
    }
    for (let s = 0; s <= samples; s++) {
      const t = (before.beats * s) / samples;
      const a = poseFor(match, t);
      const b = poseFor(dancer, (after.beats * s) / samples);
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > worst) {
        worst = distance;
        worstDancer = i;
      }
      if (distance > tol) ok = false;
    }
  }
  return { ok, worst, unmatched, worstDancer };
}
