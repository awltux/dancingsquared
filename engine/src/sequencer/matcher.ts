// FormationMatcher: matches boards to call setups and to named formations, and
// recognizes/snaps boards. Owns the two match caches (matchMemo, which caches
// call-variant matching by board signature; formationMatchCache, which caches
// the best-named-formation match). It reads the shared SequencerConfig for the
// matching tolerances and holds no board state.

import { matchFormations, type FormationMatch, type Matchable } from './match.js';
import { CallLibrary } from './library.js';
import { SequencerConfig, type ApplyPermission } from './config.js';
import { DEFAULT_MATCH_MAX, KNOWN_FORMATION_MAX, STANDARD_FORMATIONS, canonicalName } from './constants.js';
import { findCouplePairs, COUPLE_WIDTH, COUPLE_WIDTH_TOL } from './couples.js';
import { DEG } from '../core.js';
import type { Going } from '../going.js';
import type { CallBundle, DancerSpec, Seg } from '../types.js';
import type { Board, RecognizedFormation, VariantMatch } from './types.js';
import { resolveVirtual, type VirtualOptions, type VirtualOutcome } from './virtual-call.js';

/** Two formation matches within this of each other are treated as tied when
 * deciding whether a board IS a given formation (they are the same geometry). */
const MATCH_TIE_EPS = 1e-9;

/**
 * CALLS WHOSE GENDER REQUIREMENT IS PER **COUPLE**, NOT PER **SLOT**.
 *
 * The catalogue's `gender-specific` attribute pins a gender to each SLOT of an authored setup, and
 * the matcher enforces it slot for slot. For most calls that is exactly right — a `Boys Run` slot is
 * a boy's slot. For `Allemande Left` it is an OVER-CONSTRAINT: CALLERLAB's definition is "Dancers
 * face their corners and turn 1/2 by the left arm", the corner is a fact about the dancer's HOME
 * POSITION, and every dancer does the same 180-degree turn. So the requirement the call really has
 * is the one CALLERLAB states for couples generally — **each couple is a man and a woman,
 * side-agnostic** — and a HALF-SASHayed square satisfies it. `gender-specific` rejects that board,
 * which is what refused `figm203` (the `Rollaway` in its chain half-sashays every couple) and the
 * three `Allemande Left` stops the census attributes to a Static Square.
 *
 * THE BOARD, NOT THE MAPPING, IS WHAT IS CHECKED. The retry runs the SAME geometric match with the
 * gender constraint off and then requires the board itself to be a set of man-and-woman couples
 * (`boardHasCoupleGenderPairs`). That is safe HERE because the call's motion is gender-symmetric —
 * every dancer turns 180 with its corner — so which slot a dancer is mapped to cannot change what
 * that dancer does. The list is therefore deliberately ONE call; adding a slot-sensitive call
 * (`Ladies Chain`, `Boys Circulate`) would apply a slot's motion to the wrong dancer.
 *
 * THE WITNESSES, and one of PLAN.md's two was a mistake worth recording: a half-sashayed square
 * MUST become legal, and a square of four SAME-GENDER couples must stay refused. `features.mjs`'s
 * `swappedG` is NOT the second witness — measured, it flips every dancer's gender, which in a
 * normal square leaves every couple one boy and one girl, i.e. it IS the half-sashayed square. Its
 * assertion (`legal === false`) was the opposite of CALLERLAB and is corrected with this change; a
 * genuine same-gender-couples witness is added alongside it.
 */
export const PAIR_GENDER_CALLS = new Set(['allemande left']);

/** The standard couple separation is owned by `couples.ts`, which is the ONE definition of "standing
 *  as a couple". Re-exported so existing readers keep working. */
export { COUPLE_WIDTH, COUPLE_WIDTH_TOL } from './couples.js';

/**
 * Whether every physical dancer is part of a couple — two dancers `COUPLE_WIDTH` apart, side by
 * side, facing the same way — and every one of those couples is a man and a woman. A board that is
 * not a couple arrangement at all (a wave, a line, facing couples, a broken body) is NOT eligible:
 * this is a relaxation of the gender gate only, never of the geometry.
 *
 * THE PAIRING ITSELF LIVES IN `couples.ts`, which is the ONE definition of "standing as a couple"
 * (`findCouplePairs`). This asks the same question the partner relation does, so the two cannot drift
 * into disagreeing about what a couple is - which is exactly how `boardHasCoupleGenderPairs` and the
 * partner logic came to be two implementations of one rule.
 */
export function boardHasCoupleGenderPairs(board: Board): boolean {
  const phys = board.dancers.filter((d) => !d.isGhost);
  if (phys.length === 0 || phys.length % 2 !== 0) return false;
  const pairs = findCouplePairs(board);
  return pairs.length * 2 === phys.length;
}

/**
 * THE ROLE READING: for some `gender-specific` calls the authored paths are ROLE motions — "what a
 * boy does, what a girl does" — rather than the motions of two particular SLOTS.
 *
 * WHY IT IS NEEDED, measured. `Heads Rollaway` half-sashays the two head couples, so every dancer
 * still faces an opposite-gender dancer and `Star Thru` is legal from there — but the catalogue's
 * `Static Square` setup pins `boy` to the south-west slot, and after the rollaway the BOY stands on
 * the south-EAST slot. Slot-wise gender matching therefore refuses an EXACT geometry match
 * (`figm#185`, `figm#186`; measured error 0.000 with the gender constraint off). The same thing
 * refuses `figm#102` (a `Star Thru` on an `Eight Chain Thru`, exact match, error 0.000) and
 * `figm#15` (`Box the Gnat`, exact match at a 2x separation). All four are CALLERLAB calls refused
 * only because an earlier call in the chain left the interacting pairs' two dancers on each other's
 * side — `Rollaway` does that to a couple. Which upstream call did it in the other two chains was
 * NOT traced; what IS measured is that dropping the gender constraint makes the geometry match at
 * error 0.000 and that the gender constraint is the only thing refusing it.
 *
 * WHY THE DATA SETTLES IT RATHER THAN AN ARGUMENT. `BezierData` is authored in DANCER-LOCAL space
 * (`types.ts`: "+X is the dancer's initial facing direction, +Y is to the dancer's left"), so a
 * slot's path IS its local motion and two slots can be compared directly. Grouping every
 * `gender-specific` variant's slots by `(gender, active)` — `active` meaning the slot has a
 * non-empty path, which is how the tams express "the side couples stand" — and comparing paths
 * WITHIN each group gives 145 of 287 variants that are ROLE-UNIFORM: every dancer of a given gender
 * performs an identical local motion, so the gender does resolve the motion. The other 142 differ
 * from slot to slot (one of the two `Star Thru <Eight Chain Thru>` tams is uniform and the other is
 * not; `Wave the Boys`, `Ramble`, `Twist the Line <Normal Lines>` and `Brace Thru <Eight Chain Thru>`
 * are firmly in the second kind — in those a boy on one side does what a boy on the other side does
 * NOT). `roleUniformMotions` returns the table for the first kind and null for the second, so the
 * reading is enabled per VARIANT by the catalogue's own data, never by a hand-maintained call list.
 *
 * WHY IT CANNOT CHANGE A WORKING CASE. When the board already satisfies the slot genders, the board
 * dancer's gender at slot `j` is `j`'s authored gender, so the role motion looked up IS `j`'s own
 * path — the reading reproduces the existing motion exactly. It is also tried strictly LAST, after
 * both the slot-wise reading and the per-couple retry have failed, so it can only turn a refusal
 * into an application. What it adds is exactly the half-sashayed case: the geometry still has to
 * land on the authored slots, and the board must still preserve the authored gender MULTISET of the
 * setup's own interacting pairs (`anyPairingKeepsGenders`), so a board that is not the call's gender
 * structure at all is still refused.
 */
export function segsEqual(a: Seg[], b: Seg[]): boolean {
  if (a.length !== b.length) return false;
  const KEYS = ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2'] as const;
  for (let i = 0; i < a.length; i++) {
    if (a[i].beats !== b[i].beats || a[i].hands !== b[i].hands) return false;
    for (const k of KEYS) if (a[i].translate[k] !== b[i].translate[k]) return false;
    const ra = a[i].rotate;
    const rb = b[i].rotate;
    if ((ra === null) !== (rb === null)) return false;
    if (ra && rb) for (const k of KEYS) if (ra[k] !== rb[k]) return false;
  }
  return true;
}

/** Whether a slot's path actually moves the dancer — the tams' own way of saying "this slot is not
 * one of the actives" (`Heads Star Thru` gives the two side couples an empty `<path/>`). */
function slotIsActive(d: DancerSpec): boolean {
  return d.path.length > 0;
}

/** The role key a board dancer occupies in a slot: the dancer's own GENDER (the role) plus whether
 * the SLOT is an active one (a positional fact about the setup, not about the dancer). */
function roleKey(gender: Matchable['gender'], active: boolean): string {
  return `${gender}|${active ? 'active' : 'stand'}`;
}

/** The motion each role performs, or null when the variant's paths differ WITHIN a role and so
 * cannot be resolved by gender at all (see the block comment above for the measured split). */
export function roleUniformMotions(variant: CallBundle): Map<string, Seg[]> | null {
  const table = new Map<string, Seg[]>();
  for (const d of variant.dancers) {
    const key = roleKey(d.gender, slotIsActive(d));
    const seen = table.get(key);
    if (seen === undefined) table.set(key, d.path);
    else if (!segsEqual(seen, d.path)) return null;
  }
  return table;
}

/**
 * The slots a slot may interact with: about a couple's width away and facing the SAME way (a couple,
 * side by side) or the OPPOSITE way (a facing pair — the two dancers who join right hands).
 */
function slotPartners(v: CallBundle, j: number): number[] {
  const heading = (i: number) => v.dancers[i].angleDeg * DEG;
  const out: number[] = [];
  for (let o = 0; o < v.dancers.length; o++) {
    if (o === j) continue;
    const dist = Math.hypot(v.dancers[j].x - v.dancers[o].x, v.dancers[j].y - v.dancers[o].y);
    if (Math.abs(dist - COUPLE_WIDTH) > COUPLE_WIDTH_TOL) continue;
    const dh = Math.abs(normAngleWrap(heading(o) - heading(j)));
    if (dh <= 0.05 || Math.abs(dh - Math.PI) <= 0.05) out.push(o);
  }
  return out;
}

/**
 * Whether the board's genders preserve the authored gender MULTISET of SOME way of pairing the
 * variant's own interacting slots.
 *
 * SOME way, not one way, because the pairing is genuinely ambiguous and a greedy first-match picks
 * wrong: an `Eight Chain Thru` setup's slots are two apart in BOTH axes, so the eight slots form two
 * 4-cycles and only one of each cycle's two perfect matchings keeps the gender multisets — measured
 * on `figm#102`, where the greedy reading rejected the very case this reading exists to accept.
 *
 * This is the strongest structural check the role reading can make without claiming to know WHY a
 * call is gender-specific, and it is what refuses a square of four same-gender couples: every
 * authored couple is `{boy, girl}` and holding two girls there is not a swap of roles. `Rollaway`'s
 * half-sashayed square keeps one boy and one girl on each couple's two slots, so it passes.
 */
function anyPairingKeepsGenders(v: CallBundle, genderAtSlot: (Matchable['gender'])[]): boolean {
  const k = v.dancers.length;
  if (k % 2 !== 0) return false;
  const opts: number[][] = [];
  for (let j = 0; j < k; j++) opts.push(slotPartners(v, j));
  const used = new Array<boolean>(k).fill(false);
  const sameGenders = (a: number, b: number): boolean => {
    if (genderAtSlot[a] === undefined || genderAtSlot[b] === undefined) return false;
    const authored = [v.dancers[a].gender, v.dancers[b].gender].map(String).sort().join('|');
    const actual = [genderAtSlot[a], genderAtSlot[b]].map(String).sort().join('|');
    return authored === actual;
  };
  const rec = (): boolean => {
    let j = -1;
    for (let i = 0; i < k; i++) if (!used[i]) { j = i; break; }
    if (j < 0) return true;
    used[j] = true;
    for (const o of opts[j]) {
      if (used[o] || !sameGenders(j, o)) continue;
      used[o] = true;
      if (rec()) return true;
      used[o] = false;
    }
    used[j] = false;
    return false;
  };
  return rec();
}

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
  private formationMatchCache = new Map<string, { f: { name: string; dancers: Matchable[] }; m: FormationMatch; second: number } | null>();

  // Caches a subwhole-set call's resolution onto an exact board, REFUSALS INCLUDED (see `virtualCall`).
  private virtualCache = new Map<string, VirtualOutcome>();
  private virtualHits = 0;
  private virtualMisses = 0;

  /** How close two match errors must be to count as a TIE when deciding between a variant that
   * matches directly and one that needs a reflection. Exact equality is too brittle: an authored
   * setup and its mirror can land a rounding step apart. */
  private static readonly REFLECT_TIE_EPS = 1e-6;

  constructor(private readonly library: CallLibrary, private readonly config: SequencerConfig) {}

  /** The permission predicate, injected by the Sequencer (see `ApplyPermission`). Null means "ask nobody". */
  private permission: ApplyPermission | null = null;

  /**
   * Set the permission predicate. Injected rather than imported, exactly like `CallApplicator.setPermissionResolver`, so
   * the geometry layer owns no policy and this class never learns what a level or a board name means.
   */
  setPermissionResolver(fn: ApplyPermission): void {
    this.permission = fn;
  }

  /**
   * Whether the rules admit this BODY, for the candidate filter.
   *
   * `going === null` is allowed without asking: a variant whose title names no body has nothing for a body-keyed rule to
   * match, and asking would only re-ask the reading-level question the boundary already answered.
   *
   * THE GROUP IS NULL because the answer is about the BODY, not about who dances it: a group-scoped rule is enforced at
   * the reading boundary, where the group is actually known.
   */
  private goingAllowed(board: Board, callName: string, going: Going | null): boolean {
    if (!this.permission || going === null) return true;
    const r = this.permission(board, { call: callName, group: null, going });
    if (r.allowed) return true;
    // ONLY A BODY-KEYED RULE FILTERS A BODY. A denial from a reading-level rule was decided at the boundary, with the
    // group the reading named; honouring it here would refuse every group reading of a call whose `All 8` reading is
    // suppressed — measured against the shipped `Lead Right` rules, which allow four `Couple #N` readings and deny `All 8`.
    return r.bodyKeyed !== true;
  }

  /** `goingAllowed` for a caller that is FILTERING a variant list of its own (`CallApplicator.parallelApply`). */
  allowsGoing(board: Board, callName: string, going: Going | null): boolean {
    return this.goingAllowed(board, callName, going);
  }

  /**
   * A subwhole-set call resolved onto this board as a whole-board virtual call, MEMOISED beside the other two
   * caches.
   *
   * THE KEY IS THE BOARD'S EXACT POSE SET (`formationSig`, the same identity `formationMatchCache` keys on), plus
   * the call and the caller's placement preference — NEVER the formation's name. A name hides rotation and
   * arrangement, so a name-keyed cache would answer a turned board with the placement it resolved for the
   * unturned one, silently; TODOs item 39 carries that as the first thing that would make the feature wrong, and
   * the harness pins it by turning a board 90 degrees and requiring a MISS and a different placement.
   *
   * REFUSALS ARE CACHED TOO. A miss on a call that cannot be placed is as expensive as a hit (it sweeps every
   * variant), and the engine's contract is that a refusal is a VALUE — so `{ legal: false, reason }` is stored
   * like any other answer. `virtualCacheStats` exists so a gate can prove the cache is used rather than assume it.
   */
  virtualCall(board: Board, callName: string, opts: VirtualOptions = {}): VirtualOutcome {
    const variants = this.library.matchableVariants(callName);
    if (variants.length === 0) return { legal: false, reason: `Unknown call: ${callName}`, tried: 'the catalogue' };
    const prefer = opts.preferPlacement ? [...opts.preferPlacement].sort((a, b) => a - b).join(',') : '-';
    const key = `${opts.matchTol ?? DEFAULT_MATCH_MAX}|${callName}|${prefer}|${this.formationSig(board)}`;
    const cached = this.virtualCache.get(key);
    if (cached !== undefined) {
      this.virtualHits++;
      return cached;
    }
    this.virtualMisses++;
    const out = resolveVirtual(board, variants, (b) => this.knownFormation(b), opts);
    this.virtualCache.set(key, out);
    return out;
  }

  /** Hit and miss counts for the virtual-call cache. Cleared by `clearCaches`, like the caches themselves. */
  virtualCacheStats(): { hits: number; misses: number; size: number } {
    return { hits: this.virtualHits, misses: this.virtualMisses, size: this.virtualCache.size };
  }

  clearCaches(): void {
    this.matchMemo.clear();
    this.formationMatchCache.clear();
    this.virtualCache.clear();
    this.virtualHits = 0;
    this.virtualMisses = 0;
  }

  /** The board as a list of matchable dancers. */
  matchables(board: Board): Matchable[] {
    return board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender, couple: d.couple }));
  }

  /** Which of a call's variants matches the given board, within `maxError`. */
  findMatchingVariant(board: Board, callName: string, maxError: number): VariantMatch | null {
    // Every authored variant, `sequencer="no"` ones included: filtering them was measured
    // as a change for the worse and is recorded, not applied (CallLibrary.matchableVariants).
    //
    // A BODY THE RULES REFUSE IS NOT A CANDIDATE, and it is filtered HERE — before the fit, not after the winner is
    // chosen. Refusing after the fact would let a denied body win the tie-break and be replaced by a worse one, which is
    // "the engine silently danced something else"; this way the set the tie-break sees never contains a refused body.
    // The filter is silent by design: `CallApplicator` owns the refusal SENTENCE, because it is the layer that knows
    // when every body has been refused and can say so once (`goingRefusal`).
    const variants = this.library.matchableVariants(callName).filter((v) => this.goingAllowed(board, callName, v.going));
    if (variants.length === 0) return null;
    // Key on the call's position/heading signature. When the call is gender-
    // specific the result depends on the board's GENDER arrangement too; home
    // couple is always included because identity-aware matching (keeps
    // heads/sides on their home couples) depends on it.
    const genderSensitive = variants.some((v) => v.genderSpecific);
    const perPair = PAIR_GENDER_CALLS.has(callName.trim().toLowerCase()) && boardHasCoupleGenderPairs(board);
    const key = `${maxError}|${callName}|${perPair ? 'pair|' : ''}${board.dancers
      .map((d) => `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}${genderSensitive ? '|' + d.gender : ''}|c${d.couple}`)
      .join(';')}`;
    const cached = this.matchMemo.get(key);
    if (cached !== undefined) return cached;
    const src = this.matchables(board);
    const run = (requireGender: boolean): VariantMatch | null => {
      let best: VariantMatch | null = null;
      for (const v of variants) {
        const tgt = v.dancers.map((d) => this.library.variantMatchable(d));
        const m = matchFormations(src, tgt, maxError, requireGender && !!v.genderSpecific);
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
      return best;
    };
    /**
     * Geometry from the SLOT, motion from the ROLE.
     *
     * The geometric match is run with the gender constraint OFF, and then each slot's PATH is
     * replaced by the motion its occupant's own gender performs. The START pose is left as authored,
     * which is what keeps the geometry honest — the dancers must still stand exactly on the setup's
     * slots — and because a path is expressed in the dancer's local frame, taking the motion from
     * another slot of the same role is well defined.
     */
    const runRole = (): VariantMatch | null => {
      let bestRole: VariantMatch | null = null;
      for (const v of variants) {
        if (!v.genderSpecific) continue;
        const roles = roleUniformMotions(v);
        if (!roles) continue;
        const tgt = v.dancers.map((d) => this.library.variantMatchable(d));
        const m = matchFormations(src, tgt, maxError, false);
        if (!m || m.subset) continue;
        // Which dancer stands on each slot, and therefore which ROLE each slot is being asked to
        // play on this board.
        const genderAtSlot: (Matchable['gender'])[] = new Array(tgt.length);
        for (let i = 0; i < src.length; i++) genderAtSlot[m.mapping[i]] = src[i].gender;
        if (!anyPairingKeepsGenders(v, genderAtSlot)) continue;
        const dancers: DancerSpec[] = [];
        let complete = true;
        for (let j = 0; j < v.dancers.length; j++) {
          const motion = roles.get(roleKey(genderAtSlot[j], slotIsActive(v.dancers[j])));
          if (!motion) { complete = false; break; }
          dancers.push({ ...v.dancers[j], path: motion });
        }
        if (!complete) continue;
        const better = bestRole === null
          || m.error < bestRole.error - FormationMatcher.REFLECT_TIE_EPS
          || (Math.abs(m.error - bestRole.error) <= FormationMatcher.REFLECT_TIE_EPS && bestRole.reflect && !m.reflect);
        if (better) {
          bestRole = {
            variant: { ...v, dancers },
            mapping: m.mapping,
            error: m.error,
            rot: m.rot,
            reflect: m.reflect,
            cSrc: m.cSrc,
            cTgt: m.cTgt,
          };
        }
      }
      return bestRole;
    };
    let best = run(true);
    // THE PER-COUPLE GENDER RETRY. See PAIR_GENDER_CALLS for what this is and the two witnesses.
    // The strict (per-slot) reading is tried FIRST, so nothing that matches today changes.
    if (best === null && perPair) best = run(false);
    // THE ROLE READING. See `roleUniformMotions` for the data and the four measured witnesses.
    if (best === null) best = runRole();
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

  /**
   * The name of any formation in the FULL catalog that `board` matches, else `null`.
   *
   * Unlike `recognize` (restricted to a curated list for stable display labels), the SCAN is
   * permissive: any standard formation the result lands in counts. But a NAME is an identity, and
   * three things disqualify one:
   *
   * 1. **Nothing is close enough.** The gate is `KNOWN_FORMATION_MAX + margin`.
   * 2. **No single dancer is close enough.** `error` is a SUM over the dancers, so the scan's own
   *    binding tolerance — the distance-signature filter at `maxError / 12`, i.e. ~0.625 per dancer
   *    at the default gate — is only ever applied to POSITIONS. The heading half of the error is
   *    unbounded by it. Measured: `Boys Turn Back` from `Stars RH` matched `Stars RH` at total error
   *    3.14 with every position identical and ONE DANCER 180 DEGREES OUT. Applying the effective
   *    allowance to each dancer's own error refuses it.
   * 3. **The best is TIED.** A tied best match is not an identity — it is an artefact of which
   *    candidate the library happened to hold first. This is the recorded case that made the FSM
   *    asset move 76 edges under unrelated library changes: the board `Face In` leaves from a
   *    squared set (four exact mini-waves) matches `O In` and `O Trade By` at EXACTLY the same error,
   *    pi, and the winner was library scan order. `recognize` already returns null for it, so the two
   *    namers disagreed about whether the board is named at all.
   *
   * MEASURED over 133 named FSM states x 273 ms calls = 2247 currently-admitted applications: the
   * tie rule alone refuses 613, and only 7 of those tie at error 0 (all seven are genuine
   * `T-Bone DRDR` / `T-Bone LULU` mirror ambiguities, which is what a tie means). The per-dancer
   * rule refuses 761; the tie rule leaves 155 names whose worst dancer is 0.65..1.57 out. The union
   * refuses 768, of which exactly TWO sit within 0.075 of the allowance boundary.
   *
   * REFUSING IS NOT DROPPING. `legalWithResults` admits an application with an unnamed end, so a call
   * this refuses stays LEGAL and is recorded — with a null end — rather than vanishing. That pairing
   * is the whole reason the two changes have to land together: refusing more names alone would have
   * silently removed applications from the FSM.
   */
  knownFormation(board: Board): string | null {
    const best = this.bestFormationMatch(board);
    if (!best) return null;
    const tol = KNOWN_FORMATION_MAX + this.config.matchMargin;
    if (best.m.error > tol) return null;
    if (best.m.maxDancerError > tol / 12) return null;
    if (best.second - best.m.error <= MATCH_TIE_EPS) return null;
    return best.f.name;
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

  /**
   * The best-matching named formation for a board, plus the RUNNER-UP's error.
   *
   * `second` is the whole reason this returns a triple rather than a pair: `knownFormation` refuses a
   * tied best match, and a tie cannot be seen from the winner alone. It is the smallest error among
   * every other candidate that matched at all, so when the best is replaced the previous best becomes
   * the candidate second.
   */
  private bestFormationMatch(board: Board): { f: { name: string; dancers: Matchable[] }; m: FormationMatch; second: number } | null {
    const sig = this.formationSig(board);
    const cached = this.formationMatchCache.get(sig);
    if (cached !== undefined) return cached;
    const src = this.matchables(board);
    let best: { f: { name: string; dancers: Matchable[] }; m: FormationMatch; second: number } | null = null;
    let second = Infinity;
    for (const f of this.library.getUniqueFormations()) {
      if (f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers, this.snapMatchMax());
      if (!m) continue;
      if (best === null || m.error < best.m.error) {
        if (best !== null) second = Math.min(second, best.m.error);
        best = { f, m, second: Infinity };
      } else {
        second = Math.min(second, m.error);
      }
    }
    if (best !== null) best.second = second;
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

  /**
   * The CORPUS FORMATION this board is, over EVERY formation the library holds rather than the curated standard set.
   *
   * WHY IT EXISTS, AND WHY IT IS NOT `recognize`. `recognize` answers "what is this board CALLED" and is deliberately
   * narrowed to `STANDARD_FORMATIONS`, because a board merely CLOSEST to one of 291 corpus names may be congruent to
   * several and a confident wrong label is worse than none. This answers a different question — "is this arrangement
   * one the corpus DEFINES" — which is what a caller needs when the name is only a caption and the arrangement's
   * validity is the point. MEASURED, the difference is large: at level 1, 13 of the 44 start formations have no
   * one-call outcome the curated recogniser can name, so a generator gating on the NAME refused them outright.
   *
   * THE THRESHOLD IS `recognize`'s OWN, applied to the whole library: the best match under `DEFAULT_MATCH_MAX` plus the
   * configured margin, or null. So this never accepts a board `recognize` would have called a different formation — it
   * only stops demanding that the formation be one of the twenty-odd curated names.
   */
  corpusFormation(board: Board): { name: string; error: number } | null {
    const src = this.matchables(board);
    let best: { name: string; error: number } | null = null;
    for (const f of this.library.getNamedFormations()) {
      if (f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers);
      if (m && (best === null || m.error < best.error)) best = { name: f.name, error: m.error };
    }
    if (best === null || best.error > DEFAULT_MATCH_MAX + this.config.matchMargin) return null;
    return best;
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
