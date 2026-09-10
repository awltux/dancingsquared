// CallApplicator: applies a call (or module) to a board. Handles the whole-board
// apply with re-base/snap, the pure-relative search apply, probabilistic
// selection, and the parallel-subset path. Owns the per-variant pose/matrix
// caches. Depends on the FormationMatcher (to find which variant applies) and the
// CallLibrary (variants + modules), and reads the shared SequencerConfig.

import { dancerBeats, poseFor } from '../core.js';
import { matchFormations, type Matchable } from './match.js';
import { FormationMatcher, rebasedPose } from './matcher.js';
import { CallLibrary } from './library.js';
import { SequencerConfig } from './config.js';
import { DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX, isKnownCouple } from './constants.js';
import { normAngle } from './identity.js';
import { apply5, dancerMatrix, poseToVec, type Mat5 } from '../matrix.js';
import { splitSelection } from './selection.js';
import type { Board, CallStep, SeqDancer, VariantMatch } from './types.js';
import type { CallBundle, Pose } from '../types.js';

const rot = (a: number, v: { x: number; y: number }) => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

export interface ApplyResult {
  board: Board;
  legal: boolean;
  reason?: string;
}

export class CallApplicator {
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

  /** Apply a call (or module) to a COPY of the given board (does not mutate).
   * The interactive apply re-bases the board onto the call's canonical start so
   * margin-based drift doesn't accumulate on the live sequence. Accepts a call
   * title or a CallStep carrying an optional dancer selection. */
  applyToBoard(board: Board, callName: string | CallStep): ApplyResult {
    return this.applyStepInner(board, callName, [], true);
  }

  /** Apply a call using PURE relative motion — no drift re-base. Used by the
   * search operations (legalCalls, getout, fixIt) where re-basing would pin
   * dancers to their current (possibly permuted) positions and destroy the
   * identity information those searches need to un-permute home. */
  applySearch(board: Board, callName: string | CallStep): ApplyResult {
    return this.applyStepInner(board, callName, [], false);
  }

  private applyToBoardInner(
    board: Board,
    callName: string,
    stack: string[],
    rebase: boolean,
    allowParallel = true,
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
          const label = typeof sub === 'string' ? sub : sub.call;
          return { board: cloneBoard(board), legal: false, reason: `Module ${callName}: "${label}" not legal here` };
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
      return this.applySelected(board, sel.selection, sel.call, rebase);
    }

    const matchTol = rebase ? DEFAULT_MATCH_MAX + this.config.matchMargin : SEARCH_MATCH_MAX + this.config.matchMargin;
    const match = this.matcher.findMatchingVariant(board, callName, matchTol);
    if (!match) {
      const par = this.parallelApply(board, callName, rebase, matchTol);
      if (par) return par;
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
  applyStep(board: Board, step: string | CallStep): ApplyResult {
    return this.applyStepInner(board, step, [], true);
  }

  private applyStepInner(
    board: Board,
    step: string | CallStep,
    stack: string[],
    rebase: boolean,
    allowParallel = true,
  ): ApplyResult {
    if (typeof step === 'string') return this.applyToBoardInner(board, step, stack, rebase, allowParallel);
    if (step.selection) return this.applySelected(board, step.selection, step.call, rebase);
    return this.applyToBoardInner(board, step.call, stack, rebase, allowParallel);
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
      const localDisp = rot(-start.heading, { x: end.x - start.x, y: end.y - start.y });
      const delta = normAngle(end.heading - start.heading);
      const base = rebase ? rebasedPose(start, match) : start;
      const bx = d.x + (base.x - d.x) * f;
      const by = d.y + (base.y - d.y) * f;
      const bh = normAngle(d.heading + (base.heading - d.heading) * f);
      const disp = rot(bh, localDisp);
      // Record which direction this dancer last turned (net heading delta), for
      // non-compositional calls that depend on the remembered turn direction.
      const turnDir = Math.abs(delta) < 1e-6 ? d.lastTurnDir : delta > 0 ? 'right' : 'left';
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
   * Returns legal=false if neither reading works. */
  applySelected(board: Board, selection: string, callName: string, rebase: boolean): ApplyResult {
    const byId = new Map(board.dancers.map((d) => [d.id, d]));
    const ids = this.resolveSelection(board, selection);
    if (!ids || ids.length === 0) {
      return { board: cloneBoard(board), legal: false, reason: `Unresolvable selection: ${selection}` };
    }
    const selected = ids.map((id) => byId.get(id)).filter((d): d is SeqDancer => !!d);
    // Center the subset about its own origin so the call's canonical setup applies.
    let cx = 0, cy = 0;
    for (const d of selected) { cx += d.x; cy += d.y; }
    cx /= selected.length; cy /= selected.length;
    const subBoard: Board = { dancers: selected.map((d) => ({ ...d, x: d.x - cx, y: d.y - cy })) };
    const r = this.applyToBoardInner(subBoard, callName, [], rebase, false);
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
    // Fallback: the call as the WHOLE formation performs it, with only the
    // selected dancers actually moving. The parallel path is allowed here because
    // for many of these calls it is the only one that matches - an Eight Chain box
    // is not a "U-Turn Back" setup as a whole, but it is two facing couples, which
    // is. parallelApply disables parallel recursion internally, so this terminates.
    const whole = this.applyToBoardInner(board, callName, [], rebase, true);
    if (whole.legal) {
      const moved = new Map(whole.board.dancers.map((d) => [d.id, d]));
      const picked = new Set(ids);
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

  parallelApply(
    board: Board,
    callName: string,
    rebase: boolean,
    matchTol: number,
  ): (ApplyResult & { error: number }) | null {
    const variants = this.library.getVariants(callName);
    if (!variants) return null;
    const phys = board.dancers.filter((d) => !d.isGhost);
    const n = phys.length;
    const ghosts = board.dancers.filter((d) => d.isGhost);
    for (const v of variants) {
      const setup = v.dancers.map((d) => this.library.variantMatchable(d));
      const k = setup.length;
      if (k <= 1 || k >= n || n % k !== 0) continue; // need >=2 full subsets, even split
      const part = this.partition(setup, phys, matchTol);
      if (!part) continue;
      const { groups, error } = part;
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
      if (ok) {
        // Restore the board's OWN dancer order. The groups were concatenated in
        // partition order, which permuted the array; callers pair dancers by array
        // position (the renderer draws view[i] from poses[i]), so a permuted board
        // made the dancers appear to swap places once a subset call completed.
        const movedById = new Map(merged.map((d) => [d.id, d]));
        return { board: { dancers: board.dancers.map((d) => movedById.get(d.id) ?? d) }, legal: true, error };
      }
    }
    return null;
  }

  partition(setup: Matchable[], dancers: SeqDancer[], maxError: number): { groups: SeqDancer[][]; error: number } | null {
    const k = setup.length;    const n = dancers.length;
    if (n === 0 || n % k !== 0) return null;
    const coupleCount = new Map<number, number>();
    for (const d of dancers) {
      if (isKnownCouple(d.couple)) coupleCount.set(d.couple, (coupleCount.get(d.couple) ?? 0) + 1);
    }
    // A real couple must never be split across subsets. UNKNOWN_COUPLE is not a
    // couple, so it imposes no constraint rather than being treated as one
    // (treating it as a couple would wrongly forbid or force partitions).
    const isCoupleCoherent = (group: SeqDancer[]): boolean => {
      const couples = new Set(group.map((d) => d.couple).filter(isKnownCouple));
      for (const c of couples) {
        const need = coupleCount.get(c) ?? 0;
        if (group.filter((d) => d.couple === c).length !== need) return false;
      }
      return true;
    };
    const used = new Array<boolean>(n).fill(false);
    const result: SeqDancer[][] = [];
    let totalError = 0;

    const canComplete = (anchorIdx: number): boolean => {
      const remaining: number[] = [];
      for (let i = 0; i < n; i++) if (!used[i] && i !== anchorIdx) remaining.push(i);
      if (remaining.length < k - 1) return false;
      const combo = new Array<number>(k - 1);
      const searchCombos = (start: number, depth: number): boolean => {
        if (depth === k - 1) {
          const idx = [anchorIdx, ...combo];
          const group = idx.map((i) => dancers[i]);
          const m = matchFormations(
            group.map((d) => ({ x: d.x, y: d.y, heading: d.heading })),
            setup,
            maxError,
          );
          if (!m || !isCoupleCoherent(group)) return false;
          for (const i of idx) used[i] = true;
          result.push(group);
          const saved = totalError;
          totalError += m.error;
          if (next()) return true;
          totalError = saved;
          result.pop();
          for (const i of idx) used[i] = false;
          return false;
        }
        for (let i = start; i < remaining.length; i++) {
          combo[depth] = remaining[i];
          if (searchCombos(i + 1, depth + 1)) return true;
        }
        return false;
      };
      return searchCombos(0, 0);
    };

    const next = (): boolean => {
      const a = used.findIndex((u) => !u);
      if (a === -1) return true;
      return canComplete(a);
    };

    return next() ? { groups: result, error: totalError } : null;
  }

  /** Whether `dancers` can be partitioned into disjoint copies of `setup` (used
   * by the analyzer to decide a parallel-subset interpretation exists). */
  partitionExists(setup: Matchable[], dancers: SeqDancer[], maxError: number): boolean {
    return this.partition(setup, dancers, maxError) !== null;
  }
}

function cloneBoard(b: Board): Board {
  return { dancers: b.dancers.map((d) => ({ ...d })) };
}
