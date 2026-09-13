// FormationMatcher: matches boards to call setups and to named formations, and
// recognizes/snaps boards. Owns the two match caches (matchMemo, which caches
// call-variant matching by board signature; formationMatchCache, which caches
// the best-named-formation match). It reads the shared SequencerConfig for the
// matching tolerances and holds no board state.

import { matchFormations, type FormationMatch, type Matchable } from './match.js';
import { CallLibrary } from './library.js';
import { SequencerConfig } from './config.js';
import { DEFAULT_MATCH_MAX, KNOWN_FORMATION_MAX, STANDARD_FORMATIONS, canonicalName } from './constants.js';
import type { Board, RecognizedFormation, VariantMatch } from './types.js';

/** Two formation matches within this of each other are treated as tied when
 * deciding whether a board IS a given formation (they are the same geometry). */
const MATCH_TIE_EPS = 1e-9;

export class FormationMatcher {
  // Caches the best call-variant match for a (board geometry + call) pair. Boards
  // are immutable (always cloned before mutation), so a given signature + call
  // always yields the same result, and the same pair recurs a lot while probing
  // legality and continuations.
  private matchMemo = new Map<string, VariantMatch | null>();

  // Caches the best-named-formation match for an exact board geometry signature.
  // `knownFormation` (is the result known?) and `snapBoard` (snap it onto slots)
  // both scan the named formations, so each board is scanned once regardless of
  // how many callers probe it.
  private formationMatchCache = new Map<string, { f: { name: string; dancers: Matchable[] }; m: FormationMatch } | null>();

  /** How close two match errors must be to count as a TIE when deciding between a variant that
   * matches directly and one that needs a reflection. Exact equality is too brittle: an authored
   * setup and its mirror can land a rounding step apart. */
  private static readonly REFLECT_TIE_EPS = 1e-6;

  constructor(private readonly library: CallLibrary, private readonly config: SequencerConfig) {}

  clearCaches(): void {
    this.matchMemo.clear();
    this.formationMatchCache.clear();
  }

  /** The board as a list of matchable dancers. */
  matchables(board: Board): Matchable[] {
    return board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender, couple: d.couple }));
  }

  /** Which of a call's variants matches the given board, within `maxError`. */
  findMatchingVariant(board: Board, callName: string, maxError: number): VariantMatch | null {
    // Every authored variant, `sequencer="no"` ones included: filtering them was measured
    // as a change for the worse and is recorded, not applied (CallLibrary.matchableVariants).
    const variants = this.library.matchableVariants(callName);
    if (variants.length === 0) return null;
    // Key on the call's position/heading signature. When the call is gender-
    // specific the result depends on the board's GENDER arrangement too; home
    // couple is always included because identity-aware matching (keeps
    // heads/sides on their home couples) depends on it.
    const genderSensitive = variants.some((v) => v.genderSpecific);
    const key = `${maxError}|${callName}|${board.dancers
      .map((d) => `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}${genderSensitive ? '|' + d.gender : ''}|c${d.couple}`)
      .join(';')}`;
    const cached = this.matchMemo.get(key);
    if (cached !== undefined) return cached;
    const src = this.matchables(board);
    let best: VariantMatch | null = null;
    for (const v of variants) {
      const tgt = v.dancers.map((d) => this.library.variantMatchable(d));
      const m = matchFormations(src, tgt, maxError, !!v.genderSpecific);
      // The whole-board APPLY path needs a full 1:1 mapping (every board dancer
      // maps to a variant dancer). A SUBSET match (m.subset set) is handled by the
      // parallel-subset path, not a whole-board apply — so it is rejected here.
      if (!m || m.subset) continue;
      // Least error wins; on an EQUAL error, a variant matching WITHOUT reflection wins over
      // one that needs it. Reflection is real and stays available - `prd.md` §9.5 matches "up to
      // translation, rotation and reflection" - but it must be the FALLBACK, never the tie
      // winner, because a mirrored match applies mirrored motion and the two variants are not
      // interchangeable.
      //
      // MEASURED, and this is not hypothetical. On a right-hand wave, `Left Swing Thru` matched a
      // `from="Left-Hand Waves"` variant by REFLECTION at error 0.0000 AND a
      // `from="Right-Hand Waves"` variant directly at error 0.0000. The tie went to array order,
      // so the mirrored variant won, and its motion sent the wave's end dancers from y=±3 to
      // y=±7 - the span of the set more than doubled, the board stopped being a formation at all,
      // and the finish then refused with "no setup matches". Same reasoning as the recorded
      // decision that "a mirrored candidate must never decide an arrangement": a reflection must
      // not decide a call either when a direct reading is available at the same error.
      const better = best === null
        || m.error < best.error - FormationMatcher.REFLECT_TIE_EPS
        || (Math.abs(m.error - best.error) <= FormationMatcher.REFLECT_TIE_EPS && best.reflect && !m.reflect);
      if (better) {
        best = { variant: v, mapping: m.mapping, error: m.error, rot: m.rot, reflect: m.reflect, cSrc: m.cSrc, cTgt: m.cTgt };
      }
    }
    this.matchMemo.set(key, best);
    return best;
  }

  /** Whether the board IS the named formation — not merely closest to it.
   *
   * Formations inside the curated recognition set are answered consistently with
   * `recognize`, so `isAt(x)` can never contradict the label on screen: the match
   * must be within the same tight tolerance the sequencer uses to accept a call's
   * setup as matching a board (DEFAULT_MATCH_MAX), and it must be (tied-)best
   * among the curated formations. Otherwise a board that is really a T-Bone is
   * also "at" an Eight Chain Thru 3.14 away — which additionally let the solver
   * accept a getout/getin that had not reached its target.
   *
   * Formations OUTSIDE the curated set (T-Bones, mixed columns, …) are not
   * something `recognize` will ever label, so they are answered geometrically:
   * the tight match above is the whole test.
   */
  matchesNamed(board: Board, name: string): boolean {
    const canonical = canonicalName(name);
    const f = this.library.getNamedFormations().find((x) => x.name === canonical);
    if (!f || f.dancers.length !== board.dancers.length) return false;
    const src = this.matchables(board);
    // Match with the PERMISSIVE tolerance, then gate the resulting error against
    // the tight one below. Passing the tight tolerance straight in would also
    // tighten matchFormations' distance-signature quick reject (sigTol scales with
    // maxError), which can reject a board whose error would have been tiny.
    const m = matchFormations(src, f.dancers);
    if (!m || m.error > DEFAULT_MATCH_MAX + this.config.matchMargin) return false;
    if (!STANDARD_FORMATIONS.includes(canonical)) return true;
    const rec = this.recognize(board);
    if (rec.name === null) return false;
    return m.error <= rec.error + MATCH_TIE_EPS;
  }

  /** The name of any formation in the FULL catalog that `board` matches, else
   * null. Unlike `recognize` (restricted to a curated list for stable display
   * labels), this is permissive: any standard formation the result lands in
   * counts as "known". */
  knownFormation(board: Board): string | null {
    const best = this.bestFormationMatch(board);
    return best && best.m.error <= KNOWN_FORMATION_MAX + this.config.matchMargin ? best.f.name : null;
  }

  /** Clamp a computed end board onto the nearest recognized formation's canonical
   * slots, when the board is within `snapMaxError`. Identity (id/couple/gender)
   * is preserved; only x/y/heading are snapped. */
  snapBoard(board: Board): Board {
    if (this.config.snapMaxError <= 0) return board;
    const best = this.bestFormationMatch(board);
    if (!best || best.m.error > this.config.snapMaxError) return board;
    const { f, m } = best;
    const snapped = board.dancers.map((d, i) => {
      const p = rebasedPose(f.dancers[m.mapping[i]], m);
      return { ...d, x: p.x, y: p.y, heading: p.heading };
    });
    return { dancers: snapped };
  }

  private bestFormationMatch(board: Board): { f: { name: string; dancers: Matchable[] }; m: FormationMatch } | null {
    const sig = this.formationSig(board);
    const cached = this.formationMatchCache.get(sig);
    if (cached !== undefined) return cached;
    const src = this.matchables(board);
    let best: { f: { name: string; dancers: Matchable[] }; m: FormationMatch } | null = null;
    for (const f of this.library.getUniqueFormations()) {
      if (f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers, this.snapMatchMax());
      if (m && (best === null || m.error < best.m.error)) best = { f, m };
    }
    this.formationMatchCache.set(sig, best);
    return best;
  }

  /** Tolerance used for the shared formation scan: loose enough to catch boards
   * that land in a recognized formation. The snap itself then applies the tight
   * `snapMaxError`; knownFormation applies `KNOWN_FORMATION_MAX`. */
  private snapMatchMax(): number {
    return Math.max(this.config.snapMaxError, KNOWN_FORMATION_MAX + this.config.matchMargin);
  }

  /** Exact per-dancer geometry signature (finer than boardSig, which bins for
   * search dedup) so cached formation matches are keyed to the exact pose. */
  private formationSig(board: Board): string {
    return board.dancers.map((d) => `${d.x.toFixed(5)},${d.y.toFixed(5)},${d.heading.toFixed(5)}`).join(';');
  }

  /** Recognize the board against the curated standard formations.
   *
   * A label is only reported when the board genuinely IS that formation: a board
   * that merely happens to be CLOSEST to a curated name — e.g. a T-Bone 3.14 away
   * from Double Pass Thru — reports no formation rather than a confident wrong
   * one. `matchesNamed` applies the same threshold, so `isAt(x)` cannot contradict
   * the label reported here. */
  recognize(board: Board): RecognizedFormation {
    const src = this.matchables(board);
    const symmetric = isSymmetric(board);
    let best: RecognizedFormation = { name: null, error: Infinity, symmetric };
    for (const f of this.library.getNamedFormations()) {
      if (!STANDARD_FORMATIONS.includes(f.name) || f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers);
      if (m && m.error < best.error) best = { name: f.name, error: m.error, symmetric };
    }
    if (best.name === null || best.error > DEFAULT_MATCH_MAX + this.config.matchMargin) {
      return { name: null, error: 0, symmetric };
    }
    return best;
  }

  /** The formation STATE of a board: the best-matching recognized formation name
   * plus the rotation/reflection transform that overlays the canonical formation
   * onto this board. Returns null when the board doesn't match any. */
  formationState(board: Board): { name: string; rot: number; reflect: boolean; cSrc: { x: number; y: number }; cTgt: { x: number; y: number } } | null {
    const src = this.matchables(board);
    let best: FormationMatch | null = null;
    for (const f of this.library.getNamedFormations()) {
      if (!STANDARD_FORMATIONS.includes(f.name) || f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers);
      if (m && (best === null || m.error < best.error)) best = m;
    }
    if (!best) return null;
    let name: string | null = null;
    for (const f of this.library.getNamedFormations()) {
      if (!STANDARD_FORMATIONS.includes(f.name) || f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers);
      if (m && m.error === best.error) { name = f.name; break; }
    }
    if (!name) return null;
    return { name, rot: best.rot, reflect: best.reflect, cSrc: best.cSrc, cTgt: best.cTgt };
  }
}

function isSymmetric(board: Board): boolean {
  const ds = board.dancers;
  return ds.length % 2 === 0 && ds.every((d) => ds.some((o) => Math.hypot(d.x + o.x, d.y + o.y) < 0.2));
}

// Transform a canonical-start pose into the board's OWN frame using a match's
// rotation/reflection and the two centers. Shared by snapBoard (clamp onto slots)
// and the applicator's re-base.
export function rebasedPose(pose: { x: number; y: number; heading: number }, m: { rot: number; reflect: boolean; cSrc: { x: number; y: number }; cTgt: { x: number; y: number } }): { x: number; y: number; heading: number } {
  let x = pose.x - m.cTgt.x;
  let y = pose.y - m.cTgt.y;
  if (m.reflect) x = -x;
  const rx = x * Math.cos(m.rot) - y * Math.sin(m.rot);
  const ry = x * Math.sin(m.rot) + y * Math.cos(m.rot);
  return { x: rx + m.cSrc.x, y: ry + m.cSrc.y, heading: normAngleWrap(pose.heading + m.rot + (m.reflect ? Math.PI : 0)) };
}

/**
 * A variant dancer's MOTION (from `from` to `to`, both in the variant's own frame) expressed in the
 * dancer's local frame, then corrected for a REFLECTED match. Callers rotate the result back out by
 * the dancer's board heading to get the world displacement.
 *
 * THE REFLECTION IS WHY THIS IS A FUNCTION AND NOT TWO INLINE EXPRESSIONS. Expressing a
 * displacement in the dancer's own frame (rotate by `-from.heading`) and turning it back out by
 * their board heading is a RIGID ROTATION, which is only the right transform while the
 * variant->board map is a rotation. A reflected match is a mirror, and a mirror swaps left for
 * right; the local frame's `+y` IS the dancer's left because headings are ccw-positive, so the
 * lateral component has to be negated along with the reflection. `rebasedPose` mirrors the
 * POSITION (`x = -x`) and nothing mirrored the MOTION.
 *
 * MEASURED, and this has now gone wrong twice. On the canonical `Ocean Waves` board, `Single
 * Hinge` matches `from="Left-Hand Waves"` at error 0.000 with `reflect=true`, and without the
 * correction each mini-wave's two dancers moved `(+1,+1)` and `(-1,-1)` in world space - APART,
 * from 2 to 4.47 - instead of pivoting about their joined hands, which grew the set's extent from
 * 7.21 to 8.94 and left the board an unnamed arrangement. It is shared with `sequence.ts`'s
 * `evaluateVariantAt` because that is the same arithmetic on the same match: when only the
 * applicator was corrected, the ANIMATION still played the unmirrored motion and
 * `behaviour-audit`'s "the last animated frame lands on the applied board" gate failed with a
 * 4.00-unit jump on the final beat. Two copies of this expression drift; one cannot.
 */
export function localMotion(from: { x: number; y: number; heading: number }, to: { x: number; y: number; heading: number }, reflect: boolean): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const c = Math.cos(-from.heading);
  const s = Math.sin(-from.heading);
  const local = { x: dx * c - dy * s, y: dx * s + dy * c };
  return reflect ? { x: local.x, y: -local.y } : local;
}

function normAngleWrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
