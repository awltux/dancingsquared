// CallApplicator: applies a call (or module) to a board. Handles the whole-board
// apply with re-base/snap, the pure-relative search apply, probabilistic
// selection, and the parallel-subset path. Owns the per-variant pose/matrix
// caches. Depends on the FormationMatcher (to find which variant applies) and the
// CallLibrary (variants + modules), and reads the shared SequencerConfig.

import { dancerBeats, poseFor } from '../core.js';
import { matchFormations, type Matchable } from './match.js';
import { FormationMatcher, rebasedPose, localMotion } from './matcher.js';
import { CallLibrary } from './library.js';
import { SequencerConfig, type ApplyPermission } from './config.js';
import type { Going } from '../going.js';
import { DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX, canonicalName, isKnownCouple } from './constants.js';
import { normAngle } from '../moves.js';
import { bodyGap, worstBodyGap, type BodyPair } from './bodies.js';
import { apply5, dancerMatrix, poseToVec, type Mat5 } from '../matrix.js';
import { splitSelection, resolveReading } from './selection.js';
import { readCallName } from './call-name.js';
import type { CallTitle } from './call-titles.js';
import type { CallNameHow } from './call-name.js';
import type { Board, CallStep, GroupStep, LaneRun, ModuleStep, SeqDancer, VariantMatch } from './types.js';
import { isGroupStep, normalizeGroupLane, stepLabel } from './types.js';
import { applyCodedToSelection, findCodedMove, isDeferredCall } from './coded-moves.js';
import { resolveStepForward } from './step-forward.js';
import type { CallBundle, Pose } from '../types.js';

const rot = (a: number, v: { x: number; y: number }) => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

export interface ApplyResult {
  board: Board;
  legal: boolean;
  reason?: string;
  /**
   * Set only by the PARALLEL path: the variant it tiled with and the groups it tiled the board
   * into. The grouping is invisible in the result board - a group that the call does not move ends up
   * exactly where it started - so the walk-through animator had to re-derive it, and its own
   * predicate (`matchingVariantInfo`, FULL tilings only) is subtly weaker than this one (which also
   * accepts `partitionPartial`). MEASURED disagreement on 2 of 13 survey pairs, both `Right and Left
   * Thru`, where the animator animated TWO groups of four that the applicator had applied as ONE:
   * the four dancers the call never moves were then spun and dragged out and back. Reporting the
   * grouping removes the second implementation rather than trying to keep the two in step.
   */
  parallel?: { variant: CallBundle; groups: SeqDancer[][] };
  /**
   * Set only by the "while" path: one run per GROUP, in the order the groups were given, carrying the
   * boards the lane passed through - `boards[0]` is the step's own start board and `boards[i + 1]` is
   * the board after `calls[i]`.
   *
   * WHY THE BOARDS ARE REPORTED rather than re-derived by the animator. A lane of several calls is
   * sequential INSIDE a simultaneous step, so its second call starts from where its first left the
   * group - a board that exists nowhere in the step's `before`/`after` pair. The walk-through animator
   * could apply the lane again to find it, which would be a second implementation of the apply (the
   * exact mistake `ApplyResult.parallel` was added to remove) and would run once per frame. Reporting
   * the boards makes the animation read the apply that actually happened.
   */
  lanes?: LaneRun[];
  /**
   * The worst body overlap found anywhere along the call's motion, when the path guard ran and found
   * one. `gap` is negative and its magnitude is the penetration depth.
   *
   * PRESENT IN BOTH MODES. `'report'` records this and applies the call anyway; `'guard'` additionally
   * refuses the tiling that produced it. So a caller can always ask "was this call clean?" without
   * having to switch behaviour on, which is what makes the count trackable before the guard is enabled.
   */
  bodyCollision?: BodyPair;
  /**
   * Set only when the string the caller passed was READ rather than published: the canonical title, the
   * selection it was read under, and which step of `readCallName` found it.
   *
   * IT IS REPORTED BECAUSE A SILENT RENAME IS THE THING THIS REPO KEEPS REGRETTING. `Promenade Full` is not a
   * title any more, so `applyToBoard(board, 'Promenade Full')` now dances `Promenade` — and a caller that never
   * learns its name is dead keeps asking for it, keeps getting an answer, and never sees the retitle. With this
   * field the app can say "read as Promenade", and a harness can assert a stale name was reported rather than
   * quietly obeyed (AGENTS.md §11.2.6: a title is an API, and a rename is a migration).
   *
   * ABSENT WHEN THE LIBRARY PUBLISHED THE NAME, deliberately: a title applied as itself was not read, and a
   * refusal is not a reading either — `applyToBoard(board, 'Headz Promenade')` refuses with no `readAs`, so
   * "unknown" never arrives dressed as an interpretation.
   */
  readAs?: { title: CallTitle; selection: string | null; how: CallNameHow };
}

/**
 * The gap below which a board has "dancers on top of each other" — used by the implicit adjustment
 * (`adjustToSetup`), which is the one place in the engine that deliberately moves dancers a long way.
 *
 * WHY `0.6` AND NOT `1.0`. This was 1.0, "the SAME 1.0 the Sweep's `SWEEP_COLLISION_MIN` and
 * `facing-audit.mjs`'s COLLISION class use", and the shared number is exactly the problem: 1.0 is the
 * CLEARANCE a legitimate two-dancer `Dosado` maintains, not a collision. MEASURED, every tiled
 * `Dosado` variant's authored pair passes at `min 1.000` — `Facing Dancers Far` 1.000, `Facing
 * Dancers` 1.000, `Compact` 1.000, `Close` 1.000, `Opposite Boy`/`Opposite Girl` 1.000 — so a
 * threshold sitting ON that value flags the calls it is meant to protect. Reported as "if
 * `BODY_COLLISION_MIN=1.0` is the distance between bodies for it to be considered a collision, then
 * most Dosado calls will be invalidated, since they intentionally pass at a distance of 1".
 *
 * THE CORPUS PUTS THE NATURAL CUT LOWER STILL, and this is worth recording so the next reader does not
 * have to re-derive it. Sweeping the 1580-module corpus for the closest pair over each whole motion —
 * these figures are CENTRE DISTANCES, the measure this constant used to use:
 *
 *     1.0  refuses 704 (44.6%)      0.6  refuses 98 (6.2%)      0.15  refuses 41 (2.6%)
 *
 * and that distribution is bimodal with an EMPTY band at `[0.1, 0.2)`: 45 modules are real
 * degeneracies (41 of them below 0.1) and the rest are legitimate walks, 401 of which pass at
 * `0.9-1.0` precisely because a Dosado is SUPPOSED to. So 0.6 is a conservative improvement rather
 * than the sharpest choice. It is kept at 0.6 because this constant guards the IMPLICIT ADJUSTMENT,
 * which moves dancers a long way on purpose and deserves the looser tolerance.
 *
 * DO NOT READ THAT EMPTY BAND AS A THRESHOLD TO REUSE. It belongs to the centre-distance distribution
 * alone and it DISAPPEARS once bodies are measured as bodies — the oriented model's own distribution
 * is a long tail with no clean cut, which is why `BODY_PATH_CLEARANCE` is contact (zero) rather than a
 * number lifted from this histogram. The two constants answer different questions and their units are
 * not interchangeable.
 *
 * NOTE THIS DOES NOT FIX THE SQUARED-SET DOSADO. That call's endpoint gap is a clean 2.000, so it is
 * refused at neither 1.0 nor 0.6; its body overlap (-0.390) exists only mid-motion and is invisible to
 * an endpoint check at ANY threshold. See `BODY_PATH_CLEARANCE`.
 */
const BODY_COLLISION_MIN = 0.6;
export { BODY_COLLISION_MIN };

/**
 * The clearance a tiled call must keep BETWEEN its endpoints, for the path-level guard.
 *
 * ZERO, AND THE MEANING IS EXACT: bodies may touch, they may not occupy the same space. A gap of 0 is
 * contact, anything below it is two volumes intersecting.
 *
 * WHY NOT A LOOSER NUMBER, WHICH IS WHAT WAS TRIED FIRST. The draft used 0.15, justified by an EMPTY
 * band at `[0.1, 0.2)` in the corpus distribution. That band is real but it belongs to the
 * CENTRE-DISTANCE distribution — the very measure this work replaced — and it VANISHES once bodies are
 * measured as bodies. MEASURED under the oriented model, the 1580-module corpus buckets as:
 *
 *     [-0.1, 0.0)  497      [0.0, 0.1)  180      [0.1, 0.2)  1      [0.2, 0.3)  27 ...
 *
 * which is a long tail with NO clean separation anywhere, so there is no defensible non-zero cut to
 * find. 0.15 would have refused 904 modules, and leaving a comment claiming a band that only exists
 * under the superseded model would have been worse than picking no number at all.
 *
 * WHY A SEPARATE NUMBER FROM `BODY_COLLISION_MIN` AT ALL. The two ask different questions.
 * `BODY_COLLISION_MIN` tolerates a long deliberate GLIDE during an implicit adjustment, where the
 * caller has accepted that dancers are being moved a long way. This one asks only "does this call walk
 * two bodies through each other while it plays", and there the honest answer is zero.
 *
 * THE COST, STATED PLAINLY, because it is the reason `'guard'` is not the default: 723 of 1580 corpus
 * modules (45.8%) overlap their bodies somewhere in their motion, so a guard at 0 refuses all of them.
 * That is a correct verdict on the current corpus — it is not a reason to loosen the threshold.
 *
 * MEASURED, the reported defect and its neighbours are caught: the squared-set `Dosado` reaches -0.390,
 * `Right and Left Thru` -0.283, `Touch a Quarter` -0.750; while a legitimate two-dancer `Dosado` stays
 * at +1.000 and is untouched.
 */
const BODY_PATH_CLEARANCE = 0.0;
export { BODY_PATH_CLEARANCE };

/**
 * The least number of samples the parallel path's collision check takes over a call.
 *
 * WHY IT IS NOT "EVERY HALF BEAT", WHICH IS WHAT IT WAS. `authoredPathGap` sampled at a FIXED 0.5 beats,
 * so a caller's number had a resolution that depended on how long the call is, while the instrument that
 * judges this engine's faults samples 24 points of every call. A predicate coarser than its judge is how a
 * `Chain Down the Line` candidate that interpenetrates at ONE beat was reported clean and deferred to last -
 * MEASURED: the deferral moved that pair from a clean body to one the gate counted, taking the coincident
 * count 295 -> 296 and the animation faults 272 -> 273. Sampling `total / PATH_SAMPLES` when that is finer
 * than 0.5 closes the gap: the iteration count is at least this and otherwise follows the fixed step.
 */
const PATH_SAMPLES = 24;
export { PATH_SAMPLES };

/**
 * The genders a set of dancers carries, as a comparable key. Used to prefer a group that reproduces
 * the genders the authored setup declares.
 */
function genderKey(ds: { gender?: string }[]): string {
  return ds.map((d) => d.gender ?? '?').sort().join(',');
}

/**
 * Whether `group` reproduces the AUTHORS' genders for the setup it matched — the same multiset, so a
 * `{boy, girl}` setup wants a boy and a girl, and a `{girl, girl}` setup wants two girls.
 *
 * WHY THIS IS A PREFERENCE RATHER THAN A CONSTRAINT. Both tilings can be geometrically valid: a
 * `Facing Dancers` setup is satisfied by two boys standing the same way as by a boy and a girl, and
 * at a loose tolerance the search finds the same-gender one FIRST purely because it branches on the
 * lowest dancer index. MEASURED, and this is the reported defect: `Single Circle Right Full` from a
 * `Static Square` produced the pairs `#5b+#7b #6g+#8g #1b+#3b #2g+#4g` — four same-gender pairs
 * where the call is a couple's call. The authored setup for that variant is `(boy, girl)`, so the
 * boy-girl tiling is the one the corpus asked for.
 *
 * A CONSTRAINT WOULD BE WRONG, because a same-gender GROUP is legitimate for some calls ("Boys Run"
 * selects two boys; the corpus authors same-gender setups). So the multiset is compared, not the
 * dancers: where the setup itself declares two of a gender, two of that gender is a match.
 */
function respectsAuthoredGenders(group: SeqDancer[], setup: Matchable[]): boolean {
  return genderKey(group) === genderKey(setup);
}

/**
 * How many dancers of each REAL couple the whole board holds. `UNKNOWN_COUPLE` is not a couple, so it
 * is absent from the map and imposes no constraint rather than being treated as one.
 */
function coupleTotals(dancers: SeqDancer[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const d of dancers) if (isKnownCouple(d.couple)) totals.set(d.couple, (totals.get(d.couple) ?? 0) + 1);
  return totals;
}

/**
 * Whether `block` holds EVERY dancer of each real couple it touches — i.e. no couple is split.
 *
 * ONE IMPLEMENTATION, because it is the same rule in `partition` and in `partitionsFor`, and the two
 * disagreeing about what "couple coherence" means is exactly the kind of drift this file has been
 * bitten by. MEASURED as load-bearing rather than cosmetic: relaxing it for the Sweep took refusals
 * 4 -> 0 and figures 98 -> 96, and it is what makes a tiling well posed.
 */
function blockKeepsCouples(block: SeqDancer[], totals: Map<number, number>): boolean {
  const here = new Map<number, number>();
  for (const d of block) if (isKnownCouple(d.couple)) here.set(d.couple, (here.get(d.couple) ?? 0) + 1);
  for (const [c, k] of here) if (k !== (totals.get(c) ?? 0)) return false;
  return true;
}

/**
 * How many groupings `partitionsFor` will hand back before it gives up. Bell(8) = **4140** is the
 * absolute bound on the set partitions of eight dancers, so this cap can only bite for a call whose
 * variants span many sizes — but it is not decoration: it is the bound that makes enumerating
 * groupings safe to call at all, and `truncated` is reported rather than swallowed.
 */
export const MIXED_PARTITION_CAP = 4096;

/**
 * Every way to split `dancers` into blocks whose sizes are ALL drawn from `sizes`, with no couple
 * split across blocks — the enumeration a MIXED (multi-arity) reading would need.
 *
 * WHY IT EXISTS. `partition` tiles the board with copies of ONE setup, and `parallelApply` loops over
 * a call's variants one at a time, so a call whose variants span sizes can only ever split the board
 * into EQUAL groups. A call with a 4-dancer and a 2-dancer authoring could in principle act on two
 * dancers in one place and four in another at once, and nothing could express that.
 *
 * AND THE MEASUREMENT THAT SAYS NOT TO WIRE IT UP, recorded here because this function exists for a
 * reader who is about to try. Over the real ms catalogue and the FSM's own 1013 state boards
 * (133 named + 880 embedded setups), the mixed pool is EMPTY of witnesses:
 *
 *   - of 273 titles, 107 have variants at more than one built size, and **104 of those are {4,8}** —
 *     which admits no mixed shape at all, because 8 is the whole-board apply and [4,4] is already
 *     reachable homogeneously. One is `{6,8}` (`Column Circulate`): 8 - 6 = 2, and it has no 2-dancer
 *     authoring, so it admits nothing either.
 *   - the remaining TWO are `{2,4,8}` — `Step to a Wave` and `Step to a Left-Hand Wave` — whose only
 *     mixed shape is **4+2+2** (210 labelled partitions each).
 *   - over all 1013 boards there are **9** where every block of some mixed partition matches a
 *     variant of its own size, and the engine ALREADY APPLIES the call on all 9 by its ordinary
 *     whole-board or homogeneous-parallel reading. **Zero would be new.**
 *   - and couple coherence is not what refuses them: dropping the rule changes the count not at all
 *     (9 before, 9 after), so the rule is not the blocker a future attempt should reach for.
 *
 * So this is the plan's own rule applied to the plan's own next step — "each new reading has to be
 * justified against a witness before it is admitted" — and the witness does not exist. It is wired to
 * `reading-census.mjs`'s reporter, which PINS the zero so a catalogue change that creates a mixed
 * pool fails the gate and forces the decision rather than silently unblocking it.
 *
 * The homogeneous partitions are returned too (a caller can pick them out by block size); the cap and
 * the couple rule are the only restrictions.
 */
export function partitionsFor(
  dancers: SeqDancer[],
  sizes: Iterable<number>,
  cap: number = MIXED_PARTITION_CAP,
): { partitions: SeqDancer[][][]; truncated: boolean } {
  const allowed = new Set([...sizes].filter((k) => k >= 2));
  const n = dancers.length;
  const out: SeqDancer[][][] = [];
  if (allowed.size === 0 || n === 0) return { partitions: out, truncated: false };
  const maxK = Math.max(...allowed);
  const totals = coupleTotals(dancers);
  const blocks: number[][] = [];
  let truncated = false;
  const rec = (next: number): void => {
    if (truncated) return;
    if (next === n) {
      if (!blocks.every((b) => allowed.has(b.length))) return;
      const grouped = blocks.map((b) => b.map((i) => dancers[i]));
      if (!grouped.every((g) => blockKeepsCouples(g, totals))) return;
      if (out.length >= cap) { truncated = true; return; }
      out.push(grouped);
      return;
    }
    for (const b of blocks) {
      // A block longer than the largest allowed size can never be completed validly, so prune it
      // rather than discovering that at the end. Bell(8) bounds the search either way; this keeps it
      // proportional to the answer rather than to the space.
      if (b.length + 1 > maxK) continue;
      b.push(next);
      rec(next + 1);
      b.pop();
      if (truncated) return;
    }
    blocks.push([next]);
    rec(next + 1);
    blocks.pop();
  };
  rec(0);
  return { partitions: out, truncated };
}

/**
 * The backtracking search behind `CallApplicator.partition`, as a class with NAMED STEPS.
 *
 * WHY A CLASS. The rule it implements is one sentence - "cut the board into disjoint copies of the
 * setup, keeping couples together, and take the first tiling found" - but the search is genuinely
 * recursive, and it was written as three nested arrow functions that called each other through
 * captured `used`/`result`/`totalError`. Debuggers step through closures badly: the body has no
 * breakpointable name of its own, and the captured state is not inspectable. Here every step is a
 * method and every piece of state is a field, so `nextAnchoredGroup` -> `searchCombos` -> `tryGroup`
 * can each be breakpointed and the recursion walked in and out.
 *
 * STATE, and why each is what it is:
 *   `used`    the board slots already placed in a group. The search ALWAYS expands the lowest
 *             unplaced index (`firstUnused`), which is what makes it complete: any tiling must place
 *             that dancer somewhere, so branching on its group covers the space.
 *   `result`  the groups placed so far, in placement order - the answer when the search completes.
 *   `totalError`  the running sum, saved/restored around each branch.
 *
 * THE SEARCH ORDER IS BEHAVIOUR, NOT STYLE. `partition` returns the FIRST tiling it finds, so the
 * order candidates are tried decides which of several valid tilings comes back. Everything here -
 * expanding the lowest unplaced index, `remaining` in ascending index order, the combos taken in that
 * order - is what the closure version did, and `test/tools/partition-capture.mjs` was captured
 * against it so a drift shows up as a diff.
 */
class PartitionSearch {
  private readonly k: number;
  private readonly n: number;
  private readonly coupleTotals: ReturnType<typeof coupleTotals>;
  private readonly used: boolean[];
  private readonly result: SeqDancer[][] = [];
  private totalError = 0;
  /** Scratch for the current combination. Allocated once, exactly as the closure version did. */
  private readonly combo: number[];

  constructor(
    private readonly setup: Matchable[],
    private readonly dancers: SeqDancer[],
    private readonly maxError: number,
    /**
     * Whether a group must reproduce the setup's GENDERS, not merely its geometry.
     *
     * This is the tam's own `sequencer="gender-specific"` declaration (`convert.ts`), which the
     * whole-board matcher has always honoured (`matcher.ts`) and this path never did - so a
     * gender-specific call could be TILED in a way the same call could not be applied whole. A
     * `{boy, girl}` setup then matches only a boy and a girl, which is what makes a circle a
     * couple's call rather than any two dancers standing the same way.
     */
    private readonly requireGender = false,
  ) {
    this.k = setup.length;
    this.n = dancers.length;
    this.combo = new Array<number>(Math.max(0, this.k - 1));
    this.coupleTotals = coupleTotals(dancers);
    this.used = new Array<boolean>(this.n).fill(false);
  }

  /** The tiling, or null when the board cannot be cut into copies of the setup. */
  run(): { groups: SeqDancer[][]; error: number } | null {
    if (this.n === 0 || this.n % this.k !== 0) return null;
    return this.next() ? { groups: this.result, error: this.totalError } : null;
  }

  /** Place one more group, anchored on the lowest unplaced dancer. True once everything is placed. */
  private next(): boolean {
    const anchor = this.firstUnused();
    if (anchor === -1) return true;
    return this.nextAnchoredGroup(anchor);
  }

  /** The lowest board index not yet placed, or -1 when none is left. */
  private firstUnused(): number {
    for (let i = 0; i < this.n; i++) if (!this.used[i]) return i;
    return -1;
  }

  /**
   * Every way to complete a group containing `anchorIdx`, tried in index order; true if one of them
   * leads to a complete tiling.
   *
   * `remaining` is recomputed on entry rather than carried, because `used` changes underneath this
   * call during the recursion below.
   */
  private nextAnchoredGroup(anchorIdx: number): boolean {
    const remaining: number[] = [];
    for (let i = 0; i < this.n; i++) if (!this.used[i] && i !== anchorIdx) remaining.push(i);
    if (remaining.length < this.k - 1) return false;
    this.searchCombos(remaining, anchorIdx, 0, 0);
    return this.placed;
  }

  /**
   * Depth-first over the combinations of `remaining` taken `k - 1` at a time.
   *
   * IT RETURNS NOTHING AND IS READ FROM `placed`, which is the one structural change from the closure
   * version and is deliberate: the old version threaded a `boolean` back up through three levels, and
   * a debugger following that return value jumps out of the recursion and lands in the caller with no
   * obvious reason. Success is recorded in `placed` instead - set by `tryGroup` when a complete
   * tiling is reached, and every level simply stops early once it sees it - so the value is visible
   * on the instance at any breakpoint and the control flow needs no unwinding to explain.
   */
  private searchCombos(remaining: number[], anchorIdx: number, start: number, depth: number): void {
    if (this.placed) return;
    if (depth === this.k - 1) {
      const combo = new Array<number>(this.k - 1);
      for (let i = 0; i < this.k - 1; i++) combo[i] = this.combo[i];
      this.tryGroup([anchorIdx, ...combo]);
      return;
    }
    for (let i = start; i < remaining.length && !this.placed; i++) {
      this.combo[depth] = remaining[i];
      this.searchCombos(remaining, anchorIdx, i + 1, depth + 1);
    }
  }

  /**
   * Place `idx` as a group if it forms a match and keeps couples together, then recurse into the rest
   * of the board; true when that produced a complete tiling.
   *
   * The undo block is the backtrack: the group is popped, its error taken back off the total, and the
   * slots released before the caller tries the next combination.
   */
  private tryGroup(idx: number[]): boolean {
    const group = idx.map((i) => this.dancers[i]);
    const m = matchFormations(
      group.map((d) => ({ x: d.x, y: d.y, heading: d.heading })),
      this.setup,
      this.maxError,
      this.requireGender,
    );
    if (!m || !this.keepsCouplesWhole(group)) return false;
    for (const i of idx) this.used[i] = true;
    this.result.push(group);
    const saved = this.totalError;
    this.totalError += m.error;
    if (this.next()) {
      this.placed = true;
      return true;
    }
    this.totalError = saved;
    this.result.pop();
    for (const i of idx) this.used[i] = false;
    return false;
  }

  /** Set once a complete tiling exists. See `searchCombos` for why success is recorded here. */
  private placed = false;

  /**
   * Whether `group` may stand as a subset: a real couple must never be split across groups.
   * `UNKNOWN_COUPLE` is not a couple, so it imposes no constraint - treating it as one would wrongly
   * forbid or force partitions. The rule itself lives in `blockKeepsCouples`, shared with
   * `partitionsFor`.
   */
  private keepsCouplesWhole(group: SeqDancer[]): boolean {
    return blockKeepsCouples(group, this.coupleTotals);
  }
}

export class CallApplicator {
  /** How deep the scoped-tam fallback may nest. See the fallback in `applyToBoardInner`. */
  private static readonly MAX_SCOPED_DEPTH = 2;
  private scopedDepth = 0;
  private variantEndCache = new WeakMap<CallBundle, Pose[]>();
  private variantMatrixCache = new WeakMap<CallBundle, Mat5[] | null>();

  constructor(
    private readonly library: CallLibrary,
    private readonly matcher: FormationMatcher,
    private readonly config: SequencerConfig,
    private resolveSelection: (board: Board, selection: string) => number[] | null = () => null,
  ) {}

  /** Set the selection resolver (the Grouping's resolveSelection). Called after
   * construction to break the applicator<->grouping cycle. */
  setSelectionResolver(fn: (board: Board, selection: string) => number[] | null): void {
    this.resolveSelection = fn;
  }

  /** The permission predicate, injected by the Sequencer (see `ApplyPermission`). Null means "ask nobody", which is
   * the state before the wiring runs and the state a bare `CallApplicator` built by a harness starts in. */
  private permission: ApplyPermission | null = null;

  /**
   * Set the permission predicate. Injected rather than imported, exactly like `setSelectionResolver` above, so the
   * geometry layer owns no policy and `permissions.ts` learns nothing about boards.
   */
  setPermissionResolver(fn: ApplyPermission): void {
    this.permission = fn;
  }

  /** Apply a call (or module) to a COPY of the given board (does not mutate).
   * The interactive apply re-bases the board onto the call's canonical start so
   * margin-based drift doesn't accumulate on the live sequence. Accepts a call
   * title, a CallStep carrying an optional dancer selection, or a GroupStep. */
  applyToBoard(board: Board, callName: string | CallStep | GroupStep): ApplyResult {
    return this.applyStepInner(board, callName, [], true);
  }

  /** Apply a call using PURE relative motion - no drift re-base. Used by the
   * search operations (legalCalls, getout, fixIt) where re-basing would pin
   * dancers to their current (possibly permuted) positions and destroy the
   * identity information those searches need to un-permute home. */
  applySearch(board: Board, callName: string | CallStep | GroupStep): ApplyResult {
    return this.applyStepInner(board, callName, [], false);
  }

  private applyToBoardInner(
    board: Board,
    rawCallName: string,
    stack: string[],
    rebase: boolean,
    allowParallel = true,
  ): ApplyResult {
    // A NAME THIS LIBRARY PUBLISHES IS APPLIED AS ITSELF, and the reading below only ever runs for a string the
    // library does NOT publish — the rule `selection.ts` states as "does the library publish this name", and the
    // reason `Heads Pass Thru` (a TITLE that begins with a selection phrase) is not reread as a reading.
    //
    // AND THEN THE READING IS THE ONE PLACE A RAW STRING BECOMES A CALL (`readCallName`): a description, a spoken
    // name, a selection, a trailing modifier or All8 shorthand. It runs HERE, at the reading boundary, so every
    // caller that hands the engine a string — the picker, the sequencer panel, the All8 import, a harness — gets
    // the same interpretation. WHAT IT READ COMES BACK ON THE RESULT as `readAs`, because a silent rename is how
    // a caller keeps using a dead name for months without noticing.
    let read: ReturnType<typeof readCallName> | null = null;
    if (!this.library.hasCall(rawCallName) && !this.library.hasModule(rawCallName)) {
      const attempt = readCallName(rawCallName);
      if (attempt.ok && attempt.title && (attempt.title !== rawCallName || attempt.selection)) read = attempt;
    }
    const applied = read
      ? read.selection
        ? this.applySelected(board, read.selection, read.title!, rebase, undefined, stack)
        : this.applyToBoardResolved(board, read.title!, stack, rebase, allowParallel)
      : this.applyToBoardResolved(board, rawCallName, stack, rebase, allowParallel);
    return read ? { ...applied, readAs: { title: read.title!, selection: read.selection, how: read.how } } : applied;
  }

  /** The apply itself, once the name is canonical. */
  private applyToBoardResolved(
    board: Board,
    callName: string,
    stack: string[],
    rebase: boolean,
    allowParallel: boolean,
  ): ApplyResult {
    if (this.library.hasModule(callName)) {
      if (stack.includes(callName)) {
        return { board: cloneBoard(board), legal: false, reason: `Module cycle: ${callName}` };
      }
      const nextStack = [...stack, callName];
      let cur = board;
      for (const sub of this.library.getModule(callName)!) {
        const r = this.applyStepInner(cur, sub, nextStack, rebase, allowParallel);
        if (!r.legal) {
          const label = stepLabel(sub);
          // THE SUB-STEP'S OWN REASON IS CARRIED, not swallowed. A module whose step a permission RULE refused used
          // to report only "not legal here", which is the one message that hides the fact that a rule (and not the
          // geometry) said no — the same distinction `permissions.ts`'s header draws. Appended rather than replaced,
          // so the module and the step are still named first.
          return {
            board: cloneBoard(board),
            legal: false,
            reason: `Module ${callName}: "${label}" not legal here${r.reason ? ` — ${r.reason}` : ''}`,
          };
        }
        cur = r.board;
      }
      return { board: cur, legal: true };
    }

    // A call name may carry a dancer-selection prefix, e.g. "Centers Pass Thru"
    // or "Same 4 Star Thru". Only route to the subset path when the full name is
    // NOT itself a registered call (e.g. "Heads Pass Thru" IS a catalog title and
    // must keep its whole-board behaviour).
    const sel = splitSelection(callName);
    if (sel.selection && !this.library.hasCall(callName) && !this.library.hasModule(callName)) {
      return this.applySelected(board, sel.selection, sel.call, rebase, undefined, stack);
    }

    const matchTol = rebase ? DEFAULT_MATCH_MAX + this.config.matchMargin : SEARCH_MATCH_MAX + this.config.matchMargin;
    // BEFORE THE MATCHER, so an all-refused call reports the RULE's reason rather than the geometric no-setup one.
    const bodyRefused = this.goingRefusal(board, callName);
    if (bodyRefused !== null) return { board: cloneBoard(board), legal: false, reason: bodyRefused };
    const match = this.matcher.findMatchingVariant(board, callName, matchTol);
    if (!match) {
      const par = this.parallelApply(board, callName, rebase, matchTol);
      if (par) return par;
      // CALLERLAB'S IMPLICIT ADJUSTMENT, owed by a Fold (see `Board.adjustToNextSetup` for the
      // convention and its scope). `Fold` and `Cross Fold` "can create formations that are very
      // unusual at Mainstream", and CALLERLAB's own comment says callers normalize them on the NEXT
      // call - *"Double Pass Thru implicitly tells dancers that they should be in the starting
      // formation for that call (facing Tandems)"*.
      //
      // The reading is: match the board against the call's own setup with the SEARCH tolerance and
      // RE-BASE onto it, which is literally "danced as if the Tandems were facing". The permission is
      // the scope - `foldRule` is its only setter and every apply result is a freshly built board, so
      // this can only ever run for the single call that follows a Fold/Cross Fold, and only after the
      // strict reading has already refused. Held to the INTERACTIVE path on purpose: the search path
      // enumerates legal calls for the solver, where a force-fit is not a normalization but a bogus
      // edge (the "loose-tolerance force-fits" already recorded against the `fixIt` list).
      if (rebase && board.adjustToNextSetup) {
        const adjusted = this.adjustToSetup(board, callName);
        if (adjusted) return adjusted;
      }
      // THE SCOPED-TAM FALLBACK. A name with a selection prefix that is ALSO a catalogue title
      // ("Heads Pass Thru", "Sides Pass Thru") takes the whole-board path above, on the reasoning
      // that the catalogue's own scoped tam knows best - and it does, WHEN it covers the board. The
      // shipped scoped tams are authored for a squared set (heads pass thru, sides wait), so on any
      // OTHER arrangement the prefix is doing the work the tam cannot, and the engine refused a call
      // whose generic reading is perfectly well defined: gather the named group, apply the BASE call
      // to them.
      //
      // MEASURED, twice, in the census's EXACT bucket - the five cases where a same-size setup
      // overlays the board's positions AND facings at error 0.000 and the call is still refused:
      // `figm174 Heads Pass Thru` and `figm224 Sides Pass Thru`, both from a Double Pass Thru whose
      // named four stand in a box while the scoped tam wants a squared set. It is strictly additive
      // by construction - it only runs where the whole-board reading AND the parallel tiling have
      // already both failed, so it can turn a refusal into an application but never replace one -
      // which is the same `catalogueFallback` shape the coded moves use.
      if (sel.selection && this.library.hasCall(callName) && this.scopedDepth < CallApplicator.MAX_SCOPED_DEPTH) {
        // The name that closes the cycle is suppressed, not the capability. `applySelected`'s
        // second reading looks the SCOPED catalogue name back up (`"${group} ${callName}"`), so
        // passing the full name we are already failing on tells it to skip exactly that one:
        // `Pass Thru` -> scoped lookup -> `Centers Pass Thru` -> fallback -> applySelected ->
        // scoped lookup -> ... MEASURED as a `Maximum call stack size exceeded` inside `partition`
        // in getout-behaviour; the census's 188 figures never reached it because none of them hits
        // that pair of names on a tiling board.
        //
        // Disabling the scoped lookup OUTRIGHT here was tried first and MEASURED one figure worse
        // (88 -> 87): the cycle is not always a cycle, and a one-level lookup still rescues calls
        // the catalogue publishes only in their group-scoped form (the `Cross Run` case the
        // reading exists for). Suppressing the single name keeps that and breaks the loop.
        //
        // The DEPTH CAP is the termination guarantee rather than a second guess at the cycle: a
        // scoped lookup can also walk between TWO names (`Centers X` -> `Ends X` -> `Centers X`),
        // which suppression alone cannot catch. Nothing measured needs more than one level.
        this.scopedDepth++;
        let scoped: ApplyResult;
        try {
          scoped = this.applySelected(board, sel.selection, sel.call, rebase, callName, stack);
        } finally {
          this.scopedDepth--;
        }
        if (scoped.legal) return scoped;
      }
      return {
        board: cloneBoard(board),
        legal: false,
        reason: this.library.hasCall(callName)
          ? 'No setup in this call matches the current formation.'
          : `Unknown call: ${callName}`,
      };
    }
    if (rebase && this.config.selectionMode === 'probabilistic') {
      const par = allowParallel ? this.parallelApply(board, callName, rebase, matchTol) : null;
      const chosen = this.selectInterpretation(
        { kind: 'whole', error: match.error, run: () => this.applyWholeBoard(board, callName, match, rebase) },
        par ? { kind: 'parallel', error: par.error, run: () => par } : null,
      );
      return chosen;
    }
    return this.applyWholeBoard(board, callName, match, rebase);
  }

  /** Apply a single call step (string or {selection, call}) to a copy of `board`. */
  applyStep(board: Board, step: ModuleStep): ApplyResult {
    return this.applyStepInner(board, step, [], true);
  }

  /**
   * THE PERMISSION GATE, IN ONE PLACE, AT THE READING BOUNDARY.
   *
   * A "reading" is what a caller asked for: one call, optionally for a named group, or a "while" step whose lanes
   * each name one. Everything BELOW this method is how the engine makes that true — matching a variant, tiling the
   * board into groups, falling back to the scoped tam — and none of it is a question the rules were written about.
   * So the gate belongs here and nowhere else, and that placement is load-bearing in two directions:
   *
   *  - A rule that denies the whole-board reading (`All 8`) must not fire again for the SUBSET apply that
   *    `applySelected` performs internally to answer a named group; that internal apply is the reading's own
   *    implementation, and asking twice would refuse a group the rules explicitly allow (the shipped `Lead Right`
   *    rules allow exactly four `Couple #N` readings and deny `All 8`).
   *  - A rule that denies a MODULE also denies it, transitively: the module expands by calling this method per
   *    sub-step, so a module holding a suppressed call refuses with that call's own reason. That is the wanted
   *    direction — a module is not a way around the rule — and it costs one ask per sub-step, not per sample.
   *
   * THE REASON IS THE RULE'S, verbatim. `permissions.ts` requires every deny to carry one so a refusal can never be
   * a bare "no"; passing it through is what makes `legalNext` and `applyToBoard` explain themselves identically.
   */
  private permissionRefusal(board: Board, step: ModuleStep): string | null {
    if (!this.permission) return null;
    const ask = (call: string, group: string | null): string | null => {
      // THE READING-LEVEL ASK (`going` null): the body is not chosen yet. A rule keyed on a body is applied by the
      // CANDIDATE filter, which knows which body it is asking about (`FormationMatcher.allowsGoing`).
      const r = this.permission!(board, { call, group, going: null });
      return r.allowed ? null : (r.reason ?? `not permitted here: ${call}`);
    };
    if (typeof step === 'string') {
      // THE READING, resolved by the ONE helper the picker also uses (`resolveReading`): a name the catalogue publishes
      // ("Heads Pass Thru" is a `<tam title=...>` in `ms/pass_thru.xml`) is applied as a whole-board call, so asking the
      // rules about "Pass Thru" for the heads would be a question nobody wrote a rule about.
      const r = resolveReading(step, (n) => this.library.hasCall(n) || this.library.hasModule(n));
      return ask(r.call, r.group);
    }
    if (isGroupStep(step)) {
      // Every lane's every call, because a lane naming a suppressed call is a suppressed step: the step is atomic
      // (`applyGroupStep` refuses the whole step if any lane refuses), so the gate has to be too.
      for (const raw of step.groups) {
        const g = normalizeGroupLane(raw);
        for (const call of g.calls) {
          const why = ask(splitSelection(call).call, g.selection);
          if (why !== null) return why;
        }
      }
      return null;
    }
    if (step.selection) return ask(step.call, step.selection);
    return ask(step.call, null);
  }

  /**
   * The refusal the permission layer demands for a call's BODIES, or null.
   *
   * WHY THIS EXISTS AS WELL AS THE CANDIDATE FILTER. The filter runs inside the matcher and is silent, so a call whose
   * every body a rule refuses would report "No setup in this call matches the current formation." — the one message that
   * hides the fact that a RULE said no.
   *
   * ONLY A BODY-KEYED DENIAL COUNTS (`bodyKeyed`), for the reason `FormationMatcher.allowsGoing` records: a rule that
   * denies the whole `All 8` READING was already decided at the boundary with the group the reading named, and honouring
   * it here would refuse every group reading of the same call.
   */
  private goingRefusal(board: Board, callName: string): string | null {
    if (!this.permission) return null;
    const goings = new Set<Going>();
    for (const v of this.library.matchableVariants(callName)) if (v.going) goings.add(v.going);
    if (goings.size === 0) return null;
    let reason: string | null = null;
    for (const going of goings) {
      const r = this.permission(board, { call: callName, group: null, going });
      // ONE SURVIVING BODY IS ENOUGH, and a reading-level answer is not this gate's business.
      if (r.allowed || r.bodyKeyed !== true) return null;
      reason = r.reason ?? reason;
    }
    return reason ?? `no body of ${callName} is permitted here`;
  }

  private applyStepInner(
    board: Board,
    step: ModuleStep,
    stack: string[],
    rebase: boolean,
    allowParallel = true,
  ): ApplyResult {
    const refused = this.permissionRefusal(board, step);
    if (refused !== null) return { board: cloneBoard(board), legal: false, reason: refused };
    if (typeof step === 'string') return this.applyToBoardInner(board, step, stack, rebase, allowParallel);
    if (isGroupStep(step)) return this.applyGroupStep(board, step, stack, rebase);
    if (step.selection) return this.applySelected(board, step.selection, step.call, rebase, undefined, stack);
    return this.applyToBoardInner(board, step.call, stack, rebase, allowParallel);
  }

  /**
   * THE "WHILE" STEP: several groups dance their own calls AT THE SAME TIME.
   *
   * CALLERLAB's `Centers Square Thru while Outsides Trade` is the shape, and the engine had no way to
   * say it: the catalogue hand-authors the whole combination as one `<tam>`'s per-dancer paths (that
   * is what `ms/running_bear.xml` is, all 248 lines of it, with the sub-calls named only in comments),
   * so the STRUCTURE was invisible and could not be reused or composed.
   *
   * THE RULES ARE IN `GroupStep`'s doc comment; the three that shape this function:
   *
   * ATOMIC. Each group is applied with `applySelected`, which already owns the two readings a
   * selection needs (the subset as its own formation, or the whole pattern with only the selected
   * dancers kept) and already merges by dancer id. If ANY group refuses, the whole step refuses with
   * that group's reason - a partially-danced "while" is not something a caller can call.
   *
   * DISJOINT, and checked BEFORE any work. The groups are computed from the same original board and
   * merged by id, so an overlap would silently let one group's result overwrite the other's. It is
   * refused with the dancer's id and the two selections rather than tolerated.
   *
   * A LANE'S CALLS RUN ONE AFTER ANOTHER, from the board the call before it left. Every lane still
   * STARTS from the step's own board, which is what keeps the lanes simultaneous, and each lane's
   * intermediate boards are reported on the result so the animator can follow the same path without
   * applying anything again (`ApplyResult.lanes`). A failure names the lane AND which call in it
   * refused, because "Sides Trade then Hinge" has two places to look and the caller chose both.
   *
   * WHY THE STACK IS THREADED. A group's call may be a call that reaches a module, and a module may
   * in turn contain this step - the same cycle the sequential expansion guards against. `applySelected`
   * already takes the stack; passing it here is what keeps the guard unbroken through the new form.
   *
   * THE RESULT PRESERVES THE BOARD'S ARRAY ORDER (`board.dancers.map`), because that order is the
   * renderer's binding - see `reorderLike`.
   */
  private applyGroupStep(board: Board, step: GroupStep, stack: string[], rebase: boolean): ApplyResult {
    if (step.groups.length === 0) {
      return { board: cloneBoard(board), legal: false, reason: 'A "while" step needs at least one group.' };
    }
    const resolved: { selection: string; calls: string[]; ids: number[] }[] = [];
    const claimed = new Map<number, string>();
    for (const raw of step.groups) {
      const g = normalizeGroupLane(raw);
      if (g.calls.length === 0) {
        return { board: cloneBoard(board), legal: false, reason: `A "while" group needs at least one call: "${g.selection}" names none.` };
      }
      // A group names CALLS, not a module. See `GroupStep`: a lane can say everything a module would say by
      // listing the calls, and a module would bring a second expansion, cycle guard and start formation.
      for (const call of g.calls) {
        if (this.library.hasModule(call) || this.library.hasModule(canonicalName(call))) {
          return { board: cloneBoard(board), legal: false, reason: `A "while" group must name calls, not the module "${call}" - list the calls the module holds instead.` };
        }
      }
      const ids = this.resolveSelection(board, g.selection);
      if (!ids || ids.length === 0) {
        return { board: cloneBoard(board), legal: false, reason: `Unresolvable selection in a "while" step: ${g.selection}` };
      }
      for (const id of ids) {
        const other = claimed.get(id);
        if (other !== undefined) {
          const d = board.dancers.find((x) => x.id === id);
          return {
            board: cloneBoard(board),
            legal: false,
            reason: `A "while" step's groups must be disjoint: dancer ${id}${d ? ` (couple ${d.couple})` : ''} is in both "${other}" and "${g.selection}".`,
          };
        }
        claimed.set(id, g.selection);
      }
      resolved.push({ selection: g.selection, calls: g.calls, ids });
    }
    // A DEPENDENT CALL LIVES IN A LANE OF ITS OWN. `Step Forward and Back if Possible` asks whether the spot its
    // dancers left is still free, and the answer comes from the OTHER groups' end poses - which exist at the end
    // of the step and nowhere in the middle of a lane. So a deferred call may be a lane's only call (today's
    // shape) and nothing else; a lane that would put it mid-sequence is refused rather than resolved against a
    // board nobody has reached.
    for (const g of resolved) {
      const dependent = g.calls.filter((c) => isDeferredCall(c));
      if (dependent.length > 0 && g.calls.length > 1) {
        return {
          board: cloneBoard(board),
          legal: false,
          reason: `"${g.selection} ${g.calls.join(' then ')}": "${dependent[0]}" resolves against the other groups' END poses, so it cannot sit in the middle of a lane - give it a lane of its own, or put it last and alone.`,
        };
      }
    }
    const moved = new Map<number, SeqDancer>();
    // ---- THE DEFERRED GROUP IS APPLIED LAST, AGAINST WHAT THE OTHERS LEFT ON THE FLOOR. -----------
    //
    // Every other group here is INDEPENDENT: it is applied to the same original board and its dancers are
    // merged by id, which is what makes the step simultaneous. A deferred group (`CodedMove.deferred`, which
    // today is `Step Forward`) is the one shape that cannot work that way - its dancers step forward and then
    // each decides whether to step BACK to the spot it left, and that depends on whether somebody has since
    // moved onto it. So the groups are split: the others are applied and merged first, and the deferred group
    // is resolved against the board that leaves.
    //
    // TWO DEPENDENT GROUPS HAVE NO ANSWER, and neither does a deferred group with nothing to depend on, so
    // both are refused with the reason rather than resolved in some arbitrary order. The rules are stated on
    // `CodedMove.deferred`; this is where they are enforced.
    const deferred = resolved.filter((g) => g.calls.length === 1 && isDeferredCall(g.calls[0]));
    if (deferred.length > 1) {
      const names = deferred.map((g) => `"${g.selection} ${g.calls.join(' then ')}"`).join(' and ');
      return {
        board: cloneBoard(board),
        legal: false,
        reason: `A "while" step may have at most ONE group that depends on the others, and this one has ${deferred.length} (${names}) - each would have to be resolved after the other.`,
      };
    }
    if (deferred.length === 1 && resolved.length === 1) {
      const g = deferred[0];
      return {
        board: cloneBoard(board),
        legal: false,
        reason: `"${g.selection} ${g.calls.join(' then ')}" resolves against the other dancers' end poses, so it needs a partner call in the same "while" step - on its own there is nothing to resolve against.`,
      };
    }
    const lanes: LaneRun[] = [];
    for (const g of resolved) {
      if (g.calls.length === 1 && isDeferredCall(g.calls[0])) continue;
      // THE LANE RUNS FROM THE STEP'S OWN BOARD, one call after another, and the boards between them are
      // kept: that is the whole of "a lane" - each call starts where the one before it left the group, and
      // every lane still starts at beat 0 of the step, which is what keeps the lanes simultaneous.
      const boards: Board[] = [board];
      let running = board;
      for (let i = 0; i < g.calls.length; i++) {
        const call = g.calls[i];
        const r = this.applySelected(running, g.selection, call, rebase, undefined, stack);
        if (!r.legal) {
          const which = g.calls.length > 1 ? `call ${i + 1} of ${g.calls.length} (${call})` : call;
          return { board: cloneBoard(board), legal: false, reason: `"${g.selection} ${g.calls.join(' then ')}" in a "while" step: ${which} refused - ${r.reason ?? 'refused'}` };
        }
        running = r.board;
        boards.push(running);
      }
      lanes.push({ selection: g.selection, ids: g.ids, calls: [...g.calls], boards });
      const inGroup = new Set(g.ids);
      for (const d of running.dancers) if (inGroup.has(d.id)) moved.set(d.id, d);
    }
    if (deferred.length === 1) {
      const g = deferred[0];
      const call = g.calls[0];
      // THE HALF-WAY BOARD COMES FROM THE MOVE, not from applying its call. `Step Forward and Back if Possible`
      // is a whole call whose answer IS the decision, so `applySelected` would hand this an already-RESOLVED
      // board and the question would be asked about the wrong start. `deferredHalf` is the forward motion on its
      // own (see `CodedMove.deferredHalf`); a deferred call without one falls back to its ordinary apply.
      const half = findCodedMove(call)?.deferredHalf;
      const stepped: ApplyResult = half
        ? { board: half(board, g.ids), legal: true }
        : this.applySelected(board, g.selection, call, rebase, undefined, stack);
      if (!stepped.legal) {
        return { board: cloneBoard(board), legal: false, reason: `"${g.selection} ${call}" in a "while" step: ${stepped.reason ?? 'refused'}` };
      }
      // Everyone else's END pose: the groups merged above, and every dancer no group claims (they never moved).
      // The deferred dancers are left out of this board rather than included at their start poses - see
      // `resolveStepForward`, which ignores their entries anyway and is asked about SOMEBODY ELSE'S body.
      const inGroup = new Set(g.ids);
      const others: Board = {
        dancers: board.dancers
          .filter((d) => !inGroup.has(d.id))
          .map((d) => moved.get(d.id) ?? { ...d }),
      };
      const settled = resolveStepForward(board, stepped.board, others, g.ids);
      for (const id of g.ids) {
        const d = settled.board.dancers.find((x) => x.id === id);
        if (d) moved.set(id, d);
      }
      // THE TWO LEGS ITS MOVE IS MADE OF, so the animator can draw the round trip without applying anything:
      // the forward board (which is where the dancers are while they are out) and the resolved one.
      lanes.push({ selection: g.selection, ids: g.ids, calls: [call], boards: [board, stepped.board, settled.board] });
    }
    return { board: { dancers: board.dancers.map((d) => moved.get(d.id) ?? { ...d }) }, legal: true, lanes };
  }

  /**
   * The implicit adjustment itself: match the board against the call's own setup at the SEARCH
   * tolerance and re-base onto it, then dance the call from there.
   *
   * `applyWholeBoard` with `rebase = true` places each dancer on its mapped setup slot before
   * applying the local motion, which is what makes this a NORMALIZATION rather than a force-fit: the
   * call then runs from its documented starting formation. A 4-dancer setup is still handled by the
   * parallel path (the witnesses are single-box reads of an 8-dancer board), which is why both
   * readings are offered rather than only the whole-board one.
   *
   * AND IT MUST LEAVE A BODY. Normalizing onto a setup while the dancers stand several units away is
   * a big move, and it is only a normalization if the result is still a set of dancers. MEASURED, and
   * this guard exists because the trap was walked into: without it the adjustment ran `figm83`'s
   * first `Ladies Chain` from a board 4.0 away from its setup and left two dancers on one spot, which
   * `facing-audit.mjs` re-classified from `coverage?` to **COLLISION** (refusal boards 39 → 38 but
   * COLLISION 3 → 4) — a laundered body error, which is exactly what an implicit adjustment must not
   * be. With the guard, `figm83` keeps its original refusal and the one real gain is kept.
   *
   * THE TOLERANCE IS `SEARCH_MATCH_MAX`, AND LOOSENING IT WAS MEASURED AND REFUTED. CALLERLAB's own
   * flagship example of the convention ("Girls Fold, Double Pass Thru") argues for a snap loose enough
   * to accept `figm30`, whose `Double Pass Thru` setup is **17.88** away, so the adjustment was run at
   * **24.0**: figures **114 → 114** — no gain at all — while `facing-audit.mjs`'s refusal list went
   * **38 → 39**, moving `figm142` back into it. A looser tolerance changes WHICH VARIANT wins (least
   * error for the whole-board reading, first that tiles for the parallel one), so the effect is not
   * monotonic, and the variant it picks at 24.0 is rejected by the collision guard where the one
   * picked at 6.0 is accepted. Reverted.
   *
   * A per-dancer DISPLACEMENT bound was the alternative and is rejected as an arbitrary threshold: the
   * case known to be WRONG (`figm83`) moves dancers **2.00**, the case known to be right (`figm142`)
   * **0.50**, and `figm71` and `figm136` sit at 2.00 and 2.06 — two cases a hair apart on opposite
   * sides of any such number. What separates good from bad here is the RESULT
   * (`BODY_COLLISION_MIN`), not the distance.
   *
   * THE RESULT IS NOW MEASURED AS A BODY GAP, NOT A CENTRE DISTANCE. This used to be
   * `Math.hypot(dx, dy) < BODY_COLLISION_MIN`, which cannot distinguish two dancers `0.5` apart facing
   * the same way (no overlap) from two `0.5` apart facing each other (overlap by 0.25) — see
   * `bodies.ts`. The threshold is unchanged in spirit; only the measure behind it is now the right one.
   *
   * STILL AN ENDPOINT CHECK. This function asks about the board the adjustment produced, and nothing
   * here looks between the endpoints — that is `BODY_PATH_CLEARANCE`'s job, and keeping the two
   * questions apart is deliberate: a single threshold cannot serve both, which is why they were split.
   */
  private adjustToSetup(board: Board, callName: string): (ApplyResult & { error: number }) | null {
    const tol = SEARCH_MATCH_MAX + this.config.matchMargin;
    const leavesABody = (r: ApplyResult & { error: number }): (ApplyResult & { error: number }) | null => {
      const phys = r.board.dancers.filter((d) => !d.isGhost);
      for (let i = 0; i < phys.length; i++) {
        for (let j = i + 1; j < phys.length; j++) {
          if (bodyGap(phys[i], phys[j]) < BODY_COLLISION_MIN) return null;
        }
      }
      return r;
    };
    const loose = this.matcher.findMatchingVariant(board, callName, tol);
    if (loose) return leavesABody({ ...this.applyWholeBoard(board, callName, loose, true), error: loose.error });
    const par = this.parallelApply(board, callName, true, tol);
    return par ? leavesABody(par) : null;
  }

  private applyWholeBoard(board: Board, callName: string, match: VariantMatch, rebase: boolean): ApplyResult {
    const { variant, mapping } = match;
    const f = rebase ? this.config.rebaseFactor : 0;
    const ends = this.endPoses(variant);
    const mats = rebase ? this.variantMatrices(variant) : null;
    const newDancers = board.dancers.map((d, i) => {
      const t = variant.dancers[mapping[i]];
      const start = poseFor(t, 0);
      const end = mats ? (() => {
        const v = poseToVec(start.x, start.y, start.heading);
        const o = apply5(mats[mapping[i]], v);
        return { x: o[0], y: o[1], heading: Math.atan2(o[3], o[2]) };
      })() : ends[mapping[i]];
      // The displacement is expressed in the DANCER's own frame and turned back into the board's
      // frame by the dancer's own heading - see `localMotion`, which owns that transform and the
      // reflected-match handedness correction that goes with it.
      const localDisp = localMotion(start, end, match.reflect);
      const delta = normAngle(end.heading - start.heading);
      const base = rebase ? rebasedPose(start, match) : start;
      const bx = d.x + (base.x - d.x) * f;
      const by = d.y + (base.y - d.y) * f;
      const bh = normAngle(d.heading + (base.heading - d.heading) * f);
      const disp = rot(bh, localDisp);
      // Record which direction this dancer last turned, for calls that depend on the remembered
      // direction ("and Roll" is the reason this exists).
      //
      // THE SIGN WAS INVERTED. `Move.turn` is documented in the engine's own vocabulary as
      // "net heading change in radians (+ = left / CCW)" (`moves.ts:32`), and `FaceLeft` is
      // `mv('Face Left', 0, 0, +PI/2)` - so a POSITIVE net delta is a LEFT turn. This used to
      // write `delta > 0 ? 'right' : 'left'`, i.e. exactly backwards, so every consumer of the
      // metadata would have rolled the wrong way. Nothing consumed it yet, which is why no gate
      // caught it; the invariant is now asserted instead of assumed.
      //
      // A NET TURN OF ~180 DEGREES has no direction from the delta alone - left and right give the
      // same number - and that is not a corner case: it is what `Partner Trade` does, and the
      // corpus's "and Roll" lines are exactly `... --PtTrd --&Roll`. The reference resolves it from
      // the path's HALFWAY tangent (`bezier.dart rolling()`: "If it's 180 then use angle at halfway
      // point"). We can do the same, because the engine already computes a pose at any time along
      // the path: take the heading change over the FIRST half and read its sign. Falling back to
      // "no direction" instead would leave `Roll` refusing on every one of those lines - measured,
      // 6 of them - which is what this replaced.
      const TURN_EPS = 1e-6;
      let turnDir = d.lastTurnDir;
      const isHalfTurn = Math.abs(Math.abs(delta) - Math.PI) <= 1e-3;
      const dirFrom = isHalfTurn
        ? normAngle(poseFor(t, dancerBeats(t) / 2).heading - start.heading)
        : delta;
      if (dirFrom > TURN_EPS) turnDir = 'left';
      else if (dirFrom < -TURN_EPS) turnDir = 'right';
      return { ...d, x: bx + disp.x, y: by + disp.y, heading: normAngle(bh + delta), lastTurnDir: turnDir };
    });
    // Snap only the INTERACTIVE path (rebase): the search path must preserve pure
    // relative motion so a getout can still un-permute dancers back home.
    return { board: rebase ? this.matcher.snapBoard({ dancers: newDancers }) : { dancers: newDancers }, legal: true };
  }

  /** Apply a call to ONLY the selected dancers of a board, leaving everyone else
   * in place.
   *
   * Two readings are possible and the engine tries them in this order:
   *
   *  1. ISOLATED - gather the selected dancers, centre them, and match the call
   *     against them as a formation of their own. This is right when the selection
   *     really does stand as its own setup.
   *
   *  2. ALONG THE WHOLE PATTERN - apply the call to the whole board and keep only
   *     the selected dancers' new poses. This is right when the call is defined by
   *     the formation the dancers are standing IN, which is the normal case for
   *     group-scoped calls: "Girls Circulate" in a wave means the girls walk the
   *     wave's circulate path, not that four girls form a separate wave. The
   *     isolated reading cannot see that, because the girls of an ocean wave are a
   *     2x2 block that is not any Circulate variant at all.
   *
   * The fallback is strictly additive - the isolated reading is still tried first,
   * so nothing that already worked changes - and it is skipped when the whole-board
   * reading would itself be illegal (e.g. "Centers Pass Thru" from a squared set,
   * where nobody is facing anyone).
   *
   * Returns legal=false if neither reading works.
   *
   * AND EVERY READING'S ANSWER IS CHECKED FOR A CORRUPT BOARD, in one place, at this method's exit. A
   * group-scoped call moves PART of the board, so its result is a merge: the selected dancers take poses
   * from some reading and the rest keep the poses they already held. When the reading also relocates the
   * dancers it did NOT select onto the movers' destinations, two of them end on one spot. MEASURED, that
   * has TWO sources rather than one, which is why the check is not inside either reading:
   *
   *   - the WHOLE-FORMATION fallback's merge        `Girls Circulate` from a wave template gave
   *                                                `i1&i2@-2.00,3.00` and `i5&i6@2.00,-3.00`
   *   - the ISOLATED SUBSET reading's own apply     `Ends Box the Gnat` from an `Eight Chain Thru`
   *                                                leaves `1&7` at gap -0.45 with `3&5` STACKED
   *
   * Over a sweep of 5 boards x 8 groups x 16 whole-set calls, 381 of the 608 combinations applied and 60 of
   * those left overlapping bodies: 52 through the fallback and 8 through the isolated reading. Gating only
   * the fallback therefore fixed 52 and left the `Ends`/`Leaders` cases corrupt.
   *
   * WHY NOT REFUSE THE FALLBACK OUTRIGHT, which was the first attempt and is NOT what this does. That was
   * measured as a wash with a wider blast radius than it looked: corpus successes unchanged at 75, but five
   * published lines moved from "stopped only at the finish" to an earlier body stop, and the ENGINE GAPS
   * list grew from 25 to 31 names - including calls like `Star Thru` that the fallback serves for EVERY
   * group-scoped call, so the extra names could not be distinguished from refusals the check introduced
   * itself. On the same sweep, refusing the fallback outright would have refused 309 of the 381; this
   * refuses 60, and every one of them is a board with two bodies in the same space, which is a board no
   * reading was entitled to produce.
   *
   * WHAT THE THRESHOLD IS NOT: `BODY_COLLISION_MIN` (0.6). That guards the implicit ADJUSTMENT, which moves
   * dancers a long way on purpose, and its own doc block says not to reuse it. This is an ENDPOINT check on
   * a finished board, where `BODY_PATH_CLEARANCE` - contact, zero - is exactly right: bodies may touch, they
   * may not occupy the same space.
   *
   * WHAT THIS CANNOT CATCH, deliberately: the squared-set `Boys`/`Girls Dosado`, whose endpoint gap is a
   * clean 2.000 and whose body overlap (-0.390) exists only MID-MOTION. An endpoint check cannot see it at
   * any threshold (see `BODY_PATH_CLEARANCE`'s note), which is why those stay with the `PERMISSION_RULES`
   * denial and the path-level guard. */
  applySelected(board: Board, selection: string, callName: string, rebase: boolean, suppressScopedName?: string, stack: string[] = []): ApplyResult {
    const r = this.applySelectedInner(board, selection, callName, rebase, suppressScopedName, stack);
    if (!r.legal) return r;
    const clash = worstBodyGap(r.board);
    if (clash && clash.gap < BODY_PATH_CLEARANCE) {
      return {
        board: cloneBoard(board),
        legal: false,
        reason: `"${selection} ${callName}" is not legal for the selected dancers: it would leave ${clash.id1} and `
          + `${clash.id2} on the same spot (body gap ${clash.gap.toFixed(2)}), because the reading moves the dancers it `
          + `did not select onto the ones it did. Call it for the whole board, or pick a call this group can dance alone.`,
      };
    }
    return r;
  }

  private applySelectedInner(board: Board, selection: string, callName: string, rebase: boolean, suppressScopedName?: string, stack: string[] = []): ApplyResult {
    const byId = new Map(board.dancers.map((d) => [d.id, d]));
    const ids = this.resolveSelection(board, selection);
    if (!ids || ids.length === 0) {
      return { board: cloneBoard(board), legal: false, reason: `Unresolvable selection: ${selection}` };
    }
    const selected = ids.map((id) => byId.get(id)).filter((d): d is SeqDancer => !!d);
    // A CODED CALL FOR A NAMED GROUP IS ANSWERED FROM THE REGISTRY FIRST, and it is answered HERE rather than
    // at each of the callers that need it, because they all had the same hole: the coded table lives in the
    // Sequencer, so a selection plus a coded call reached this method, went to the catalogue, and died with
    // `"... not legal for selected dancers"`. Who needs it:
    //
    //   - `Sequencer.groupCanPerform`, which is the question the CALL PICKER asks - measured, `Heads Step
    //     Forward` was allowed by the permission layer and then dropped from `legalNext` because this said no,
    //     so the call existed and could not be chosen;
    //   - `Applicator.applyGroupStep`, for a "while" group, whose selection and call are carried SEPARATELY.
    //
    // THE READINGS ARE `applyCodedToSelection`'s three - the same function `Sequencer.tryCodedMove` uses for the
    // one-name form - so a coded call cannot mean one thing written as `Heads Step Forward` and another as a
    // group. It returns null for anything that is not a coded move, so the catalogue path below runs exactly as
    // it did before: strictly additive, and it can only turn a refusal into an application.
    const coded = applyCodedToSelection(board, callName, ids);
    if (coded) return coded;
    // Center the subset about its own origin so the call's canonical setup applies.
    let cx = 0, cy = 0;
    for (const d of selected) { cx += d.x; cy += d.y; }
    cx /= selected.length; cy /= selected.length;
    const subBoard: Board = { dancers: selected.map((d) => ({ ...d, x: d.x - cx, y: d.y - cy })) };
    // THE MODULE STACK IS THREADED, not reset. It used to be `[]` here, which meant the cycle guard
    // did not survive a selection: a module whose step selects a group and calls a name that reaches
    // the same module would recurse until the stack blew. A `GroupStep` raises the stakes, because it
    // is a new way to re-enter, so the stack is passed in and handed on.
    const r = this.applyToBoardInner(subBoard, callName, stack, rebase, false);
    if (r.legal) {
      // Merge moved subset dancers back by id; non-selected dancers unchanged.
      const moved = new Map(r.board.dancers.map((d) => [d.id, d]));
      const merged = board.dancers.map((d) => {
        if (d.isGhost) return d;
        const m = moved.get(d.id);
        if (!m) return d;
        // Re-apply the centering offset we removed.
        return { ...m, x: m.x + cx, y: m.y + cy };
      });
      return { board: { dancers: merged }, legal: true };
    }
    // A call the catalogue publishes ONLY in its group-scoped form. `Cross Run` is
    // the worked example: `ms/run.xml` has nine `Centers Cross Run` and nine
    // `Ends Cross Run` tams and NO bare title at all, so a *gender* selection can
    // never find it by name - even when that selection IS all centres or all ends
    // and the scoped form therefore applies verbatim. All8 writes exactly this,
    // and annotates the scoped form itself:
    //
    //   ! B-XRun   G-XRun   --PromH   (C-XRun both times)
    //   !! G-XRun  B-XRun   --PromH   (E-XRun both times)
    //
    // MEASURED on the published get-outs: all three of the corpus's `XRun`
    // refusals are of this kind - two where the gender selects all four CENTRES
    // and one where it selects all four ENDS. Refusing them was the bug, not the
    // missing call.
    //
    // The WHOLE board performs the scoped call, deliberately, and NOT the subset:
    // `Centers Cross Run` means the centres cross-run AND the ends dodge, so the
    // call moves all eight and a subset reading would drop the dodgers. This is
    // only reached when the bare name is unknown AND the scoped name is a real
    // catalogue call AND the selection is exactly that group, so nothing that
    // matches today changes interpretation.
    // THE SELECTION'S OWN SCOPE, alongside `Centers`/`Ends`.
    //
    // That loop was written for the calls the catalogue publishes ONLY in their scoped form (`Cross
    // Run`), so it is guarded by "the base name is UNKNOWN" and hardcodes the two groups. A call can
    // equally have BOTH a generic authoring and a scoped one, and then neither guard helps. MEASURED,
    // `ms/forward_and_back.xml` carries `tam title="Sides Forward and Back" display="none"`, yet
    //   applySelected(board, 'Sides', 'Forward and Back')  -> REFUSED
    //   applyToBoardInner(board, 'Sides Forward and Back') -> APPLIES (it finds that tam by name)
    // so the same step has two readings and only one works. A "while" group carries the DECOMPOSED form,
    // so a group step could refuse a pair that `groupCanPerform` - the picker's own filter - reports as
    // legal, which is how the parallel-call button came to do nothing.
    //
    // The same exact-cover test applies, and `suppressScopedName`/`MAX_SCOPED_DEPTH` remain the
    // termination guarantee.
    {
      const own = `${selection} ${callName}`;
      if (own !== suppressScopedName && this.scopedDepth < CallApplicator.MAX_SCOPED_DEPTH
        && this.library.hasCall(own)) {
        const ownIds = this.resolveSelection(board, selection);
        if (ownIds && ownIds.length === ids.length && ids.every((id) => ownIds.includes(id))) {
          this.scopedDepth++;
          let scoped: ApplyResult;
          try {
            scoped = this.applyToBoardInner(board, own, stack, rebase, true);
          } finally {
            this.scopedDepth--;
          }
          if (scoped.legal) return scoped;
        }
      }
    }
    if (!this.library.hasCall(callName)) {
      for (const group of ['Centers', 'Ends'] as const) {
        const scopedName = `${group} ${callName}`;
        if (!this.library.hasCall(scopedName)) continue;
        // Already failing on this exact name one level up - re-entering it is the cycle.
        if (scopedName === suppressScopedName) continue;
        const groupIds = this.resolveSelection(board, group);
        if (!groupIds || groupIds.length !== ids.length) continue;
        const groupSet = new Set(groupIds);
        if (!ids.every((id) => groupSet.has(id))) continue;
        const scoped = this.applyToBoardInner(board, scopedName, stack, rebase, true);
        if (scoped.legal) return scoped;
      }
    }
    // Fallback: the call as the WHOLE formation performs it, with only the
    // selected dancers actually moving. The parallel path is allowed here because
    // for many of these calls it is the only one that matches - an Eight Chain box
    // is not a "U-Turn Back" setup as a whole, but it is two facing couples, which
    // is. parallelApply disables parallel recursion internally, so this terminates.
    const whole = this.applyToBoardInner(board, callName, stack, rebase, true);
    if (whole.legal) {
      const moved = new Map(whole.board.dancers.map((d) => [d.id, d]));
      const picked = new Set(ids);
      // A WHOLE-FORMATION READING THAT NEVER TOUCHES THE SELECTION IS NOT AN ANSWER. `parallelApply` reports the
      // groups it tiled, and a dancer it did not tile keeps its OWN pose (its merge is `movedById.get(d.id) ?? d`),
      // so when no reported group holds a selected dancer the merge below copies every selected dancer's ORIGINAL
      // pose: the board comes back unchanged and the apply is still LEGAL, so the caller charges the beats for a
      // step that moved nobody. Reported as TODO.md P0.3; the witness is `Circle Four Left 3/4` scoped to the sides
      // of the lane board `All Except Heads Step Forward` leaves, where the whole-board reading tiles the heads
      // (`5+6+1+2`) and holds none of the selected 3,4,7,8.
      //
      // WHY THIS CONDITION AND NOT "the selected dancers all end where they started": a real call can end exactly
      // where it began (`Heads Forward and Back`, which `selection.mjs` asserts as the control), and refusing
      // those is a different, larger bug. MEASURED over the ms catalogue x 4 boards x 6 selections: 81 scoped
      // applies are legal AND leave the board unchanged, and that call is one of them. This condition fires only
      // where the mechanism makes the no-op INEVITABLE - the selected dancers are in no group at all - so it
      // refuses the defect and nothing else.
      if (whole.parallel && !whole.parallel.groups.some((g) => g.some((d) => picked.has(d.id)))) {
        return {
          board: cloneBoard(board),
          legal: false,
          reason: `"${selection} ${callName}" is not legal for the selected dancers: the whole-formation reading tiles `
            + `the board into ${whole.parallel.groups.map((g) => g.map((d) => d.id).join('+')).join(' | ')}, and no group `
            + `holds a selected dancer, so every selected dancer would be left exactly where they stand. Call it for the `
            + `whole board, or pick a call this group can dance alone.`,
        };
      }
      // THIS MERGE USED TO BE THE ONLY SOURCE OF A CORRUPT BOARD, and it is no longer the only one - see
      // `applySelected`'s own doc block for the two and the single place both are now checked. The merge
      // itself is unchanged: it keeps the non-selected dancers where they stand while the selected ones take
      // their poses from the whole-formation motion.
      return {
        board: { dancers: board.dancers.map((d) => (d.isGhost || !picked.has(d.id) ? d : moved.get(d.id) ?? d)) },
        legal: true,
      };
    }
    return { board: cloneBoard(board), legal: false, reason: `"${callName}" not legal for selected dancers` };
  }

  private selectInterpretation(
    whole: { kind: 'whole'; error: number; run: () => ApplyResult },
    parallel: { kind: 'parallel'; error: number; run: () => ApplyResult } | null,
  ): ApplyResult {
    if (!parallel) return whole.run();
    const wWhole = 1 / (1 + whole.error);
    const wPar = 1 / (1 + parallel.error);
    const r = this.config.rand();
    return r < wWhole / (wWhole + wPar) ? whole.run() : parallel.run();
  }

  /** The canonical end pose of each dancer of a variant (pure, cached). */
  private endPoses(variant: CallBundle): Pose[] {
    let end = this.variantEndCache.get(variant);
    if (!end) {
      end = variant.dancers.map((d) => poseFor(d, dancerBeats(d)));
      this.variantEndCache.set(variant, end);
    }
    return end;
  }

  /** Per-dancer matrix (canonical start -> canonical end) for a variant, or null
   * if it can't be built. Indexed by the variant dancer's canonical order. */
  private variantMatrices(variant: CallBundle): Mat5[] | null {
    const cached = this.variantMatrixCache.get(variant);
    if (cached !== undefined) return cached;
    const M: Mat5[] = [];
    for (const d of variant.dancers) {
      const s = poseFor(d, 0);
      const e = poseFor(d, dancerBeats(d));
      if (!isFinite(s.x) || !isFinite(e.x)) {
        this.variantMatrixCache.set(variant, null);
        return null;
      }
      M.push(dancerMatrix(s.x, s.y, s.heading, e.x, e.y, e.heading));
    }
    this.variantMatrixCache.set(variant, M);
    return M;
  }

  // ------------------------------------------------------------ parallel action

  /**
   * The worst body gap anywhere on the board along a whole tiled call's motion, or null when nothing
   * comes close.
   *
   * BOARD-WIDE, NOT PER GROUP, and that distinction is the difference between catching the reported
   * defect and missing it entirely. MEASURED on the squared-set `Dosado`: the worst pair WITHIN any
   * single group is `-0.053` (`6+1`), while the worst pair on the BOARD is `-0.390` on `1+4` — two
   * dancers in DIFFERENT groups. Tiling decides who dances with whom; it does not stop two groups from
   * sweeping through each other, and a per-group test is blind to exactly that.
   *
   * So the groups are posed independently (each along its own authored path, exactly as
   * `evaluateParallelAt` animates them) and then compared against EACH OTHER as one board.
   *
   * THE TRANSFORM IS `evaluateVariantAt`'s, deliberately duplicated rather than approximated. That
   * method (in `sequence.ts`) computes each dancer's displacement in the VARIANT's own frame and then
   * rotates it into the board's, using `rebasedPose` for the reference pose and `localMotion` for the
   * displacement. Running a different interpolation here would mean the guard judges a path the
   * animator never plays — the guard and the animation have to agree by construction, not by luck.
   *
   * SAMPLED ON THE SAME 0.5-BEAT GRID the corpus scan uses, so a threshold measured with the scan is
   * the threshold the guard enforces. The grid runs to the LONGEST group's beat count, so a short
   * group holds its final pose while a longer one finishes — the same reading `durationBeats` gives a
   * parallel step.
   */
  private authoredPathGap(
    groups: SeqDancer[][],
    callName: string,
    step = 0.5,
  ): { worst: BodyPair | null; covered: boolean } {
    // Each dancer's own pose source in the variant that tiled it, plus that group's match.
    const sources: { d: SeqDancer; v: CallBundle['dancers'][number]; m: VariantMatch }[] = [];
    let total = 0;
    let expected = 0;
    for (const group of groups) {
      expected += group.filter((d) => !d.isGhost).length;
      const gb: Board = { dancers: group.map((d) => ({ ...d })) };
      const m = this.matcher.findMatchingVariant(gb, callName, SEARCH_MATCH_MAX + this.config.matchMargin);
      // A GROUP WITH NO MATCH IS NOT CHECKED AT ALL, and that used to be invisible: `continue` left its
      // dancers out of every sampled frame, so the pair returned was a minimum over a SUBSET and read exactly
      // like a clean answer. `covered` is what says whether the number is over every dancer.
      if (!m) continue;
      const { variant, mapping } = m;
      for (let i = 0; i < group.length; i++) {
        const v = variant.dancers[mapping[i]];
        sources.push({ d: group[i], v, m });
        total = Math.max(total, dancerBeats(v));
      }
    }
    const covered = sources.filter((s) => !s.d.isGhost).length === expected;
    if (sources.length === 0 || !(total > 0)) return { worst: null, covered: false };

    let worst: BodyPair | null = null;
    // AT LEAST `PATH_SAMPLES` OVER THE CALL, and 0.5 beats otherwise - see `PATH_SAMPLES` for the witness
    // that made the fixed step a defect in this predicate.
    const fine = Math.min(step, total / PATH_SAMPLES);
    for (let t = 0; t <= total + 1e-9; t += fine) {
      const all = sources.map(({ d, v, m }) => {
        const start = poseFor(v, 0);
        const cur = poseFor(v, Math.min(t, dancerBeats(v)));
        const localDisp = localMotion(start, cur, m.reflect);
        const base = rebasedPose(start, m);
        const disp = rot(base.heading, localDisp);
        return {
          ...d,
          x: base.x + disp.x,
          y: base.y + disp.y,
          heading: normAngle(base.heading + normAngle(cur.heading - start.heading)),
        };
      });
      // GHOSTS EXCLUDED, matching `worstBodyGap`: a ghost occupies no collision space.
      const phys = all.filter((d) => !d.isGhost);
      for (let i = 0; i < phys.length; i++) {
        for (let j = i + 1; j < phys.length; j++) {
          const gap = bodyGap(phys[i], phys[j]);
          if (!worst || gap < worst.gap) worst = { id1: phys[i].id, id2: phys[j].id, gap };
        }
      }
    }
    return { worst, covered };
  }

  parallelApply(
    board: Board,
    callName: string,
    rebase: boolean,
    matchTol: number,
  ): (ApplyResult & { error: number }) | null {
    // Every authored variant, `sequencer="no"` ones included — see
    // CallLibrary.matchableVariants for the measurement that keeps this unfiltered.
    // A REFUSED BODY IS NOT TILED EITHER: the parallel path enumerates variants itself, so it filters them the same way
    // the whole-board matcher does, or a body the rules refuse could still be danced by tiling the board into groups.
    const variants = this.library.matchableVariants(callName).filter((v) => this.matcher.allowsGoing(board, callName, v.going));
    if (variants.length === 0) return null;
    const phys = board.dancers.filter((d) => !d.isGhost);
    const n = phys.length;
    const ghosts = board.dancers.filter((d) => d.isGhost);
    // ---- EVERY variant that tiles, with its error, BEFORE any of them is applied. --------------
    //
    // IT USED TO RETURN ON THE FIRST VARIANT THAT TILED. `part.error` was computed and then thrown
    // away for the choice, so the authored setup that happened to sit EARLIER IN THE FILE won
    // whatever its fit - which is not "first fit is as good as it gets", it is "document order
    // decides which of two readings of the same call is danced". The format's identity for a setup
    // is `(title, formation xor from)`, and picking by position discards exactly that.
    //
    // WHY IT GENERALLY DOES NOT SHOW. `partition` only hands back a tiling inside `matchTol`, and
    // two authored setups of one title are usually far enough apart in shape that a board clears the
    // tolerance for AT MOST ONE of them, so there is no competition to resolve. It is also not what
    // makes `Single Circle Left Full` wrong from `Normal Lines`: there only the plain setup tiles at
    // the interactive tolerance (error 0, against Far refused outright), so first-fit and
    // lowest-error agree. At 6.0 BOTH tile (Far 4.5142, plain 6.2832) and the ordering is what
    // decides. This change removes the ordering as a factor; it does not by itself explain any
    // reported wrong instance.
    //
    // The candidate list keeps the board's EVEN division rule - `square-dancing.md` section 7.2.1:
    // "a board that cannot be split evenly into equal subsets (e.g. 6 dancers for a 4-dancer
    // subset) has no clean partition and must not force one". A full tiling is still preferred over
    // a partial one FOR THE SAME VARIANT, so nothing that worked before changes shape.
    const candidates: { v: CallBundle; groups: SeqDancer[][]; error: number; index: number }[] = [];
    variants.forEach((v, index) => {
      const setup = v.dancers.map((d) => this.library.variantMatchable(d));
      const k = setup.length;
      if (k <= 1 || k >= n || n % k !== 0) return;
      // THE VARIANT'S OWN DECLARATION, so a tam marked `sequencer="gender-specific"` is tiled under
      // the same gender rule it is applied under whole-board. Unmarked tams partition gender-blind,
      // exactly as before - the preference below is what keeps the reported same-gender grouping from
      // winning when a boy-girl tiling exists.
      const gendered = !!v.genderSpecific;
      const part = this.partition(setup, phys, matchTol, gendered)
        ?? this.partitionPartial(setup, phys, matchTol, gendered);
      if (!part || part.groups.length === 0) return;
      candidates.push({ v, groups: part.groups, error: part.error, index });
    });
    if (candidates.length === 0) return null;
    // ERROR ASCENDING, THEN DOCUMENT ORDER. The second key is not decoration: two variants can fit a
    // board at the SAME total error, and the tie has to be broken by something stable rather than by
    // whatever order the Map happened to iterate in. Registration order is that thing, and it is what
    // the old code used - so a tie resolves exactly as before and only a STRICT improvement moves.
    candidates.sort((a, b) => (a.error - b.error) || (a.index - b.index));
    // MEASURED CAVEAT: DOCUMENT ORDER IS STABLE BUT IT IS NOT NEUTRAL, and the size of that is known.
    // With the `Lead Right` / `Lead Left` bodies pooled under one title, **86 of 276** (title, board) pairs
    // change which body runs when the blocks are reversed, and the gate's own criterion calls **21** of them
    // collapses the order decides - a clean ~2.0 against ~0.0. Corpus-wide the same test is rare: **46 of
    // 7900** pairs (0.6%) over 790 multi-setup titles, **5** of them collapse-deciding. So this key is doing
    // its job of being stable, and it is NOT choosing the better body - it cannot, because a collapse is only
    // visible on the destination and nothing has been applied yet.
    // WHICH RULE WOULD CHOOSE BETTER, measured against every candidate over the pooled family (86 pairs, the
    // gate's criterion, each body forced alone through a synthetic name): prefer the candidate whose
    // APPLICATION does not collapse - **83 clean, 0 collapsing, 3 with no clean body at all** (`Lead Left` on
    // `3 and 1 lines #2`, `Completed Double Pass Thru`, `Double Pass Thru`: authoring, not arbitration);
    // naming the board **0 clean / 86 cannot choose** (these setups are relational by construction); tightest
    // spacing **48 collapsing**; widest **49**. The survivors are ambiguous - **65 of 86** have more than one
    // clean body - so this key stays, as the tie-break among the sane ones rather than as the only one.
    // Apply best-fit-first, keeping the old "first one whose sub-applies are all legal wins" rule: a
    // lower-error tiling whose per-group call does not apply is not a better answer, it is not an
    // answer at all.
    // THE ANSWER OF LAST RESORT. With the guard OFF a candidate whose bodies interpenetrate is not REFUSED -
    // it is DEFERRED, because a later candidate in this same (error, document order) order that does not walk
    // two bodies through each other is a strictly better answer to the same question, while keeping the first
    // one means this changes nothing when no better candidate exists. That is the difference from `'guard'`,
    // which refuses the call outright and so refuses 45.8% of the corpus (`BODY_PATH_CLEARANCE`'s note): this
    // can only replace a colliding body with a non-colliding one, never turn a legal application into a
    // refusal. MEASURED over the pooled `Lead Right`/`Lead Left` family (86 order-sensitive pairs): the order
    // decides a collapse on 21 of them, and "prefer the body that does not interpenetrate" is the only one of
    // four candidate rules that picks none (83 clean / 0 collapsing / 3 with no clean body at all).
    let fallback: (ApplyResult & { error: number }) | null = null;
    for (const cand of candidates) {
      const { v, groups, error } = cand;
      // Apply the call to each subset independently (disable parallel recursion).
      // Use rebase=false (PURE RELATIVE motion) so the parallel result preserves
      // every group's movement.
      const merged: SeqDancer[] = [];
      let ok = true;
      for (const group of groups) {
        const subBoard: Board = { dancers: group.map((d) => ({ ...d })) };
        const r = this.applyToBoardInner(subBoard, callName, [], false, false);
        if (!r.legal) { ok = false; break; }
        merged.push(...r.board.dancers);
      }
      if (!ok) continue;
      // ---- THE PATH GUARD. Last of the candidate filters, and the only one that looks BETWEEN the
      // endpoints. `keepsCouplesWhole` and the per-group legality check above both judge the board a
      // candidate PRODUCES; this judges the motion it plays to get there.
      //
      // WHY IT FALLS THROUGH rather than throwing: a refused candidate is simply a worse answer, not
      // an error, and the loop is already written to advance to the next-best tiling. Only when no
      // candidate survives does the call become illegal — which is the honest answer for a call the
      // engine cannot dance without two bodies occupying the same space.
      let bodyCollision: BodyPair | null = null;
      // NOT PROVEN CLEAN is deliberately wider than "interpenetrates": a candidate whose check could not
      // cover every dancer has not been shown to be clean either, and reading that silence as a clean bill of
      // health is the failure mode already recorded (PLAN.md 3). It only ever feeds the DEFERRAL - the
      // `'guard'` branch above is untouched, so the guard behaves exactly as it did.
      let notProvenClean = false;
      if (this.config.bodyCollisionMode !== 'off') {
        const gap = this.authoredPathGap(groups, callName);
        bodyCollision = gap.worst;
        const interpenetrates = !!bodyCollision && bodyCollision.gap < BODY_PATH_CLEARANCE;
        if (interpenetrates && this.config.bodyCollisionMode === 'guard') continue;
        notProvenClean = interpenetrates || !gap.covered;
      }
      // Restore the board's OWN dancer order. The groups were concatenated in
      // partition order, which permuted the array; callers pair dancers by array
      // position (the renderer draws view[i] from poses[i]), so a permuted board
      // made the dancers appear to swap places once a subset call completed.
      const movedById = new Map(merged.map((d) => [d.id, d]));
      const result = {
        board: { dancers: board.dancers.map((d) => movedById.get(d.id) ?? d) },
        legal: true,
        error,
        // Carry the grouping out so the animator follows the tiling that was APPLIED rather than
        // re-deriving one. See `ApplyResult.parallel`.
        parallel: { variant: v, groups },
        // And carry the collision out, so `'report'` mode can surface what `'guard'` mode would
        // refuse — that is the number that has to be tracked before the guard is switched on.
        ...(bodyCollision ? { bodyCollision } : {}),
      };
      if (notProvenClean) {
        if (!fallback) fallback = result;
        continue;
      }
      return result;
    }
    return fallback;
  }

  /**
   * The board tiled into 4-dancer FACING-COUPLE boxes, or null.
   *
   * This is `parallelApply`'s variant loop without the "apply the call inside each box" half, for a
   * rule that acts PER BOX instead of per subset: `Sweep a Quarter` rotates each facing-couple box a
   * quarter turn about the box's own centre, which is not any one call and cannot be expressed by
   * applying a call to the box.
   *
   * The grouping comes from the engine's own `partition`, i.e. from `matchFormations` with couple
   * coherence, rather than from ad-hoc geometry, and that was a measured decision: on All8's eight
   * `Sweep 1/4` cases a hand-written "find the facing pairs and group them" produces several
   * different tilings of the same board, and `figm21` and `figm150` — the same chain with the same
   * preceding call — do not tile the same way.
   *
   * The SETUP is swept over scales rather than taken from a call, because a facing-couple box has no
   * canonical size: CALLERLAB's starting formation is "Facing Couples only" and the corner cases in
   * the corpus run from a tight 2x2 (`figm21`'s couples are TWO apart) to a 2x6 rectangle
   * (`figm63`'s centres). `partition`'s own tolerance then decides which of these the board actually
   * is, and a board that no scale tiles is refused - which is what keeps `figm150`'s malformed board
   * from being laundered into a success.
   *
   * Only a FULL tiling counts: `partitionPartial` is deliberately not consulted, because a Sweep
   * applies to each facing-couple box and a board that does not divide into boxes is not a Sweep
   * board.
   */
  boxGroups(board: Board, matchTol: number): SeqDancer[][] | null {
    const phys = board.dancers.filter((d) => !d.isGhost);
    const n = phys.length;
    if (n === 0 || n % 4 !== 0) return null;
    // A STALE COUPLE PAIRING DOES BLOCK THIS TILING, and fixing that is REFUTED — measured, so it is
    // not retried. `partition` below enforces COUPLE COHERENCE (a stored couple's two dancers must
    // land in the same box), and after a `Flutterwheel` the stored pairing straddles the boxes:
    // `figm` #17/#120's physical couples are (#2,#5) (#7,#8) (#4,#3) (#1,#6) while the stored ones
    // are (1,2) (3,4) (5,6) (7,8). Reading CALLERLAB's temporary couple number here (the convention
    // `promenadeProblem` uses) DOES make the tiling succeed — `Sweep 1/4` refusals 6 -> 4 — and it is
    // still WRONG: those boards are Normal Lines whose facing-couple boxes are FOUR apart, so a box
    // 2 wide and 4 tall rotating 90 degrees about its own centre becomes 4 wide and 2 tall, and the
    // two boxes meet at x = 0 with four dancers on two spots. The figures then refuse on `Promenade`
    // from an UNNAMED board (Promenade refusals 4 -> 6). The refusal was therefore right, and only
    // its REASON was wrong: a board of lines cannot Sweep at all on this geometry.
    //
    // Couples separated by `s`, each couple 2 wide, facing each other along x.
    for (const s of [2, 3, 4, 6, 8]) {
      const setup: Matchable[] = [
        { x: -s / 2, y: 1, heading: 0 },
        { x: -s / 2, y: -1, heading: 0 },
        { x: s / 2, y: -1, heading: Math.PI },
        { x: s / 2, y: 1, heading: Math.PI },
      ];
      const part = this.partition(setup, phys, matchTol);
      if (part && part.groups.length === n / 4) return part.groups;
      // ...and the same box along the other axis, which is what a "lines facing" board is.
      const rotated: Matchable[] = setup.map((d) => ({
        x: -d.y, y: d.x, heading: normAngle(d.heading + Math.PI / 2),
      }));
      const part2 = this.partition(rotated, phys, matchTol);
      if (part2 && part2.groups.length === n / 4) return part2.groups;
    }
    return null;
  }

  /**
   * Split `dancers` into disjoint `setup`-sized groups that each match `setup`, and report the total
   * error. Returns null when no such tiling exists.
   *
   * THE SEARCH IS A SEPARATE OBJECT RATHER THAN THREE NESTED CLOSURES, and that is for the DEBUGGER.
   * This was one method holding `canComplete`, which held `searchCombos`, which called back into
   * `next` - three arrow functions capturing `used`, `result` and `totalError` by reference. A
   * stepper cannot place a breakpoint on a closure's body or inspect the captured state reliably, so
   * stepping "into" the recursion showed the call site and then left. `PartitionSearch` below gives
   * every step of the search a NAME and puts its state in FIELDS, so a debugger can breakpoint
   * `nextAnchoredGroup`, `searchCombos` and `tryGroup` individually, read `used`/`result`/`totalError`
   * on the instance, and walk in and out of the recursion.
   *
   * The algorithm is UNCHANGED, including the order in which candidate groups are tried - that order
   * decides WHICH valid tiling is returned, so it is behaviour, not style. Pinned by
   * `test/tools/partition-capture.mjs` before and after the rewrite.
   */
  partition(setup: Matchable[], dancers: SeqDancer[], maxError: number, requireGender = false): { groups: SeqDancer[][]; error: number } | null {
    return new PartitionSearch(setup, dancers, maxError, requireGender).run();
  }

  /** Whether `dancers` can be partitioned into disjoint copies of `setup` (used
   * by the analyzer to decide a parallel-subset interpretation exists). */
  partitionExists(setup: Matchable[], dancers: SeqDancer[], maxError: number): boolean {
    return this.partition(setup, dancers, maxError) !== null;
  }

  /**
   * The PARTIAL reading of `partition`: disjoint copies of `setup` covering as much of the board
   * as they can, with the dancers in no copy left where they stand.
   *
   * WHY IT EXISTS. `partition` requires the setup to tile the whole board, so a call whose setup
   * matches SOME boxes and not others is refused outright - and that is a whole family, not a
   * corner case, because a set whose boxes are not congruent is exactly what a `Trade By` or a
   * `Double Pass Thru` is: couples facing each other in the middle and couples facing out on the
   * ends. Measured, three separate published get-outs stop this way:
   *
   *   - `Box the Gnat` from a `Trade By`: the facing pair matches, the outer couples do not.
   *   - `Turn Thru` from a `Double Pass Thru`: same shape, measured best-group 3.000 while the
   *     four-dancer SUBSET matches at 0.000.
   *   - `Slide Thru`, `Recycle` and others reached on boards with no recognised formation.
   *
   * `square-dancing.md` §7.5 is explicit that "a call acts on everyone it applies to", so applying
   * to the boxes that qualify and leaving the rest is the documented reading rather than a
   * loosening. It is also STRICTLY ADDITIVE here: `parallelApply` tries `partition` first and only
   * falls back to this, so a board that tiles today behaves exactly as before, and this can only
   * turn a REFUSAL into an application.
   */
  partitionPartial(setup: Matchable[], dancers: SeqDancer[], maxError: number, requireGender = false): { groups: SeqDancer[][]; error: number } | null {
    const k = setup.length;
    const n = dancers.length;
    if (k < 2 || k > n) return null;
    const used = new Array<boolean>(n).fill(false);
    const groups: SeqDancer[][] = [];
    let totalError = 0;
    for (let anchor = 0; anchor < n; anchor++) {
      if (used[anchor]) continue;
      const rest: number[] = [];
      for (let i = 0; i < n; i++) if (!used[i] && i !== anchor) rest.push(i);
      if (rest.length < k - 1) break;
      // EVERY group of k containing this anchor that still matches, best (lowest error) first; null
      // when none does, in which case the anchor is simply left unmatched and we move on.
      //
      // IT USED TO TAKE THE FIRST MATCH IN COMBINATION ORDER, which is why a same-gender pair could
      // win: the groups are geometrically interchangeable, so index order decided, and the choice at
      // one anchor then FORCED the rest of the tiling. MEASURED on `Facing Dancers Far` from a
      // `Static Square`: four boy-girl pairs exist at error 0.0000, but taking `#8g+#3b` first used
      // up `#3b`'s only partner and the run fell through to a same-gender pair at error 2.0.
      const found: { idx: number[]; error: number; gendered: boolean }[] = [];
      const combo = new Array<number>(k - 1);
      const search = (start: number, depth: number): void => {
        if (depth === k - 1) {
          const idx = [anchor, ...combo];
          const group = idx.map((i) => dancers[i]);
          const m = matchFormations(
            group.map((d) => ({ x: d.x, y: d.y, heading: d.heading })),
            setup,
            maxError,
            requireGender,
          );
          if (m) found.push({ idx, error: m.error, gendered: respectsAuthoredGenders(group, setup) });
          return;
        }
        for (let i = start; i < rest.length; i++) {
          combo[depth] = rest[i];
          search(i + 1, depth + 1);
        }
      };
      search(0, 0);
      if (found.length === 0) continue;
      // THE AUTHORS' GENDERS FIRST, then the fit. A group that reproduces the setup's gender multiset
      // is what the corpus asked for; a same-gender one is a FALLBACK, kept for the calls whose
      // setups are legitimately same-gender and for boards where nothing else matches.
      found.sort((a, b) => (Number(b.gendered) - Number(a.gendered)) || (a.error - b.error));
      const best = found[0];
      for (const i of best.idx) used[i] = true;
      groups.push(best.idx.map((i) => dancers[i]));
      totalError += best.error;
    }
    return groups.length > 0 ? { groups, error: totalError } : null;
  }
}

function cloneBoard(b: Board): Board {
  return { dancers: b.dancers.map((d) => ({ ...d })) };
}
