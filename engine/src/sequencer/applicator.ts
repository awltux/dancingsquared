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
import { DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX } from './constants.js';
import { normAngle } from './identity.js';
import { apply5, dancerMatrix, poseToVec, type Mat5 } from '../matrix.js';
import type { Board, SeqDancer, VariantMatch } from './types.js';
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
  ) {}

  /** Apply a call (or module) to a COPY of the given board (does not mutate).
   * The interactive apply re-bases the board onto the call's canonical start so
   * margin-based drift doesn't accumulate on the live sequence. */
  applyToBoard(board: Board, callName: string): ApplyResult {
    return this.applyToBoardInner(board, callName, [], true);
  }

  /** Apply a call using PURE relative motion Ã¢â‚¬â€ no drift re-base. Used by the
   * search operations (legalCalls, getout, fixIt) where re-basing would pin
   * dancers to their current (possibly permuted) positions and destroy the
   * identity information those searches need to un-permute home. */
  applySearch(board: Board, callName: string): ApplyResult {
    return this.applyToBoardInner(board, callName, [], false);
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
        const r = this.applyToBoardInner(cur, sub, nextStack, rebase, allowParallel);
        if (!r.legal) {
          return { board: cloneBoard(board), legal: false, reason: `Module ${callName}: "${sub}" not legal here` };
        }
        cur = r.board;
      }
      return { board: cur, legal: true };
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
      return { ...d, x: bx + disp.x, y: by + disp.y, heading: normAngle(bh + delta) };
    });
    // Snap only the INTERACTIVE path (rebase): the search path must preserve pure
    // relative motion so a getout can still un-permute dancers back home.
    return { board: rebase ? this.matcher.snapBoard({ dancers: newDancers }) : { dancers: newDancers }, legal: true };
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
      if (ok) return { board: { dancers: [...merged, ...ghosts] }, legal: true, error };
    }
    return null;
  }

  partition(setup: Matchable[], dancers: SeqDancer[], maxError: number): { groups: SeqDancer[][]; error: number } | null {
    const k = setup.length;    const n = dancers.length;
    if (n === 0 || n % k !== 0) return null;
    const coupleCount = new Map<number, number>();
    for (const d of dancers) coupleCount.set(d.couple, (coupleCount.get(d.couple) ?? 0) + 1);
    const isCoupleCoherent = (group: SeqDancer[]): boolean => {
      const couples = new Set(group.map((d) => d.couple));
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
