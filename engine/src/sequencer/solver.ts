// HomeSolver: finds sequences that return the set home (getout), take it home to
// a target formation (getin), or keep a getout alive (fixIt). Owns the
// home-scoring and reachability caches and the matrix fast-path cache. It holds
// no board state — callers pass the current board.

import { fitRigidMatrix, identity5, mul5, type Mat5 } from '../matrix.js';
import { matchFormations, type Matchable } from './match.js';
import { FormationMatcher } from './matcher.js';
import { CallApplicator } from './applicator.js';
import { CallLibrary } from './library.js';
import { LegalityChecker } from './legality.js';
import { SequencerConfig } from './config.js';
import { KNOWN_FORMATION_MAX, canonicalName } from './constants.js';
import { makeSquaredSet, cloneBoard, boardSig } from './board.js';
import { fasrKey, homeFasrKey } from './fasr.js';
import type { Board, SeqDancer } from './types.js';

export class HomeSolver {
  private homeScoreCache = new Map<string, number>();
  private canGetoutMemo = new Map<string, boolean>();
  private rigidGetoutCache: { name: string; M: Mat5; image: Matchable[]; seqDancers: SeqDancer[] }[] | null = null;

  constructor(
    private readonly library: CallLibrary,
    private readonly matcher: FormationMatcher,
    private readonly applicator: CallApplicator,
    private readonly legality: LegalityChecker,
    private readonly config: SequencerConfig,
  ) {}

  clearCaches(): void {
    this.homeScoreCache.clear();
    this.canGetoutMemo.clear();
  }

  /** Calls that are equivalent to `call` from `board`: legal from the board and
   * reach the same end formation. Each remains a separate edge. */
  equivalentCalls(board: Board, call: string): { name: string; res: { board: Board; legal: boolean } }[] {
    const baseRes = this.applicator.applySearch(board, call);
    if (!baseRes.legal) return [];
    const baseEnd = this.matcher.knownFormation(baseRes.board);
    if (baseEnd === null) return [];
    const out: { name: string; res: { board: Board; legal: boolean } }[] = [];
    for (const name of this.library.callNames()) {
      if (name === call) continue;
      const res = this.applicator.applySearch(board, name);
      if (!res.legal) continue;
      if (this.matcher.knownFormation(res.board) === baseEnd) out.push({ name, res });
    }
    return out;
  }

  /** Search candidates from `board`: the legal calls (and modules), each widened
   * with its equivalent calls when config.useEquivalents is on. Candidates are
   * deduped by end-board signature so two equivalents reaching the same board are
   * not searched twice, while still keeping the alternative call names available
   * for the returned path. */
  private searchCandidates(board: Board): { name: string; res: { board: Board; legal: boolean } }[] {
    const base = this.legality.searchLegalCalls(board);
    if (!this.config.useEquivalents) return base;
    const bySig = new Map<string, { name: string; res: { board: Board; legal: boolean }; alternates: string[] }>();
    for (const c of base) {
      const sig = boardSig(c.res.board);
      const existing = bySig.get(sig);
      if (existing) { existing.alternates.push(c.name); continue; }
      bySig.set(sig, { name: c.name, res: c.res, alternates: [] });
    }
    // For each end-board signature, also find equivalent calls reaching the same
    // end FORMATION (not just same board) and record them as alternates.
    const out: { name: string; res: { board: Board; legal: boolean } }[] = [];
    for (const { name, res, alternates } of bySig.values()) {
      out.push({ name, res });
      for (const alt of alternates) out.push({ name: alt, res });
      if (this.config.useEquivalents) {
        for (const eq of this.equivalentCalls(board, name)) {
          out.push({ name: eq.name, res: eq.res });
        }
      }
    }
    return out;
  }

  /** Search for a sequence of legal calls that ends in the target formation
   * (default: a squared set). Returns the call path or null. */
  getout(board: Board, opts: { target?: string; maxCalls?: number; budget?: number } = {}): string[] | null {
    const target = canonicalName(opts.target ?? 'Static Square');
    const maxCalls = opts.maxCalls ?? 5;
    const budget = opts.budget ?? 400;
    this.canGetoutMemo.clear();

    const isHomeTarget = target === 'Static Square';
    if (isHomeTarget) {
      const rigid = this.rigidSingleCallGetout(board);
      if (rigid && this.verifyInteractivePath(board, rigid, target)) return rigid;
      if (this.config.useCollapsedModules) {
        const module = this.collapsedModuleGetout(board);
        if (module && this.verifyInteractivePath(board, module, target)) return module;
      }
    }

    const greedy = this.greedyHome(board, target, maxCalls);
    if (greedy && this.verifyInteractivePath(board, greedy, target)) return greedy;

    const seen = new Set<string>([boardSig(board)]);
    const state = { nodes: 0, budget };
    return this.getoutPath(board, target, maxCalls, [], seen, state, (path) =>
      this.verifyInteractivePath(board, path, target),
    );
  }

  /** Replay a candidate getout path through the INTERACTIVE apply path to confirm
   * every call is genuinely legal and the final board reaches `target`. */
  private verifyInteractivePath(board: Board, path: string[], target: string): boolean {
    let b = cloneBoard(board);
    for (const name of path) {
      const r = this.applicator.applyToBoard(b, name);
      if (!r.legal) return false;
      b = r.board;
    }
    return this.reachesTarget(b, target);
  }

  /** Greedy best-first: at each step pick the legal call whose result scores
   * closest to home, never moving to a worse-scoring board. */
  private greedyHome(board: Board, target: string, maxCalls: number): string[] | null {
    let b = cloneBoard(board);
    const path: string[] = [];
    const seen = new Set<string>([boardSig(b)]);
    let curScore = -Infinity;
    for (let i = 0; i < maxCalls; i++) {
      if (path.length > 0 && this.reachesTarget(b, target)) return path;
      let best: { name: string; res: { board: Board; legal: boolean } } | null = null;
      let bestScore = -Infinity;
      for (const c of this.searchCandidates(b)) {
        const sig = boardSig(c.res.board);
        if (seen.has(sig)) continue;
        const s = this.homeScore(c.res.board);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      if (!best || bestScore < curScore) return null;
      seen.add(boardSig(best.res.board));
      b = best.res.board;
      path.push(best.name);
      curScore = bestScore;
    }
    return this.reachesTarget(b, target) ? path : null;
  }

  // ----------------------------------------------------------------- matrix fast-path

  private buildRigidGetoutCache(): { name: string; M: Mat5; image: Matchable[]; seqDancers: SeqDancer[] }[] {
    if (this.rigidGetoutCache) return this.rigidGetoutCache;
    const home = makeSquaredSet();
    const homeDancers = home.dancers;
    const out: { name: string; M: Mat5; image: Matchable[]; seqDancers: SeqDancer[] }[] = [];
    for (const name of this.library.callNames()) {
      if (this.library.hasModule(name)) continue;
      const res = this.applicator.applyToBoard(home, name);
      if (!res.legal) continue;
      const fit = fitRigidMatrix(homeDancers, res.board.dancers, 1e-3);
      if (!fit) continue;
      const M2 = mul5(fit.M, fit.M);
      const I = identity5();
      let selfInverse = true;
      for (let r = 0; r < 5 && selfInverse; r++)
        for (let c = 0; c < 5; c++)
          if (Math.abs(M2[r][c] - I[r][c]) > 1e-6) {
            selfInverse = false;
            break;
          }
      if (!selfInverse) continue;
      out.push({ name, M: fit.M, image: this.matcher.matchables(res.board), seqDancers: res.board.dancers });
    }
    this.rigidGetoutCache = out;
    return out;
  }

  private rigidSingleCallGetout(board: Board): string[] | null {
    const cur = this.matcher.matchables(board);
    for (const e of this.buildRigidGetoutCache()) {
      if (matchFormations(cur, e.image, KNOWN_FORMATION_MAX + this.config.matchMargin) === null) continue;
      const res = this.applicator.applySearch(board, e.name);
      if (res.legal && this.reachesTarget(res.board, 'Static Square')) return [e.name];
    }
    return null;
  }

  /** A collapsed-module fast-path: if a registered module is rigid, self-inverse,
   * and collapsible (no non-compositional call), and the current board is the
   * image of home under that module, then the module returns home in ONE step.
   * Mirrors the single-call rigid getout but for an entire module. */
  private collapsedModuleGetout(board: Board): string[] | null {
    const cur = this.matcher.matchables(board);
    for (const name of this.library.moduleNames()) {
      if (!this.config.useCollapsedModules) break;
      if (!this.moduleRigidSelfInverse(name)) continue;
      const home = makeSquaredSet();
      const res = this.applicator.applySearch(home, name);
      if (!res.legal) continue;
      const image = this.matcher.matchables(res.board);
      if (matchFormations(cur, image, KNOWN_FORMATION_MAX + this.config.matchMargin) === null) continue;
      const back = this.applicator.applySearch(board, name);
      if (back.legal && this.reachesTarget(back.board, 'Static Square')) return [name];
    }
    return null;
  }

  /** Whether a module is rigid + self-inverse when applied from home, and contains
   * no non-compositional call (so it is safely collapsible). */
  private moduleRigidSelfInverse(name: string): boolean {
    if (this.library.isNonCompositional(name)) return false;
    const home = makeSquaredSet();
    const res = this.applicator.applySearch(home, name);
    if (!res.legal) return false;
    const fit = fitRigidMatrix(home.dancers, res.board.dancers, 1e-3);
    if (!fit) return false;
    const M2 = mul5(fit.M, fit.M);
    const I = identity5();
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++)
        if (Math.abs(M2[r][c] - I[r][c]) > 1e-6) return false;
    return true;
  }

  /** Matrix-based getout: if the current board is exactly the image of home under
   * a rigid, self-inverse call, returns that SAME single call as a guaranteed,
   * replayable getout. */
  matrixGetout(board: Board): string[] | null {
    return this.rigidSingleCallGetout(board);
  }

  /** Depth-first getout search. */
  private getoutPath(
    board: Board,
    target: string,
    depth: number,
    path: string[],
    seen: Set<string>,
    state: { nodes: number; budget: number },
    validate?: (path: string[]) => boolean,
  ): string[] | null {
    if (depth <= 0) return null;
    if (state.nodes >= state.budget) return null;
    const candidates = this.searchCandidates(board);
    candidates.sort((a, b) => this.homeScore(b.res.board) - this.homeScore(a.res.board));
    for (const { name, res } of candidates) {
      const sig = boardSig(res.board);
      if (seen.has(sig)) continue;
      seen.add(sig);
      state.nodes++;
      path.push(name);
      if (this.reachesTarget(res.board, target)) {
        if (!validate || validate([...path])) return [...path];
      }
      const sub = this.getoutPath(res.board, target, depth - 1, path, seen, state, validate);
      if (sub) return sub;
      path.pop();
    }
    return null;
  }

  /** Closeness of `board` to the home squared set; higher is closer. */
  closenessToHome(board: Board): number {
    return this.homeScore(board);
  }

  private homeScore(board: Board): number {
    const sig = boardSig(board);
    const cached = this.homeScoreCache.get(sig);
    if (cached !== undefined) return cached;
    let s = 0;
    const sq = this.library.getNamedFormations().find((f) => f.name === 'Static Square');
    if (sq && sq.dancers.length === board.dancers.length) {
      const m = matchFormations(this.matcher.matchables(board), sq.dancers, 1e9);
      if (m) s -= m.error * 100;
    }
    const seq = this.sequenceOf(board);
    if (seq === 'in') s += 10;
    else if (seq === 'out') s += 1;
    this.homeScoreCache.set(sig, s);
    return s;
  }

  /** Cheap in/out-of-sequence status of a board (identity order around the set). */
  private sequenceOf(board: Board): string {
    const dancers = board.dancers;
    const cx = dancers.reduce((s, d) => s + d.x, 0) / dancers.length;
    const cy = dancers.reduce((s, d) => s + d.y, 0) / dancers.length;
    const boys = dancers.filter((d) => d.gender === 'boy');
    const angles = new Map<number, number>();
    for (const d of boys) angles.set(d.couple, Math.atan2(d.y - cy, d.x - cx));
    if (angles.size !== 4) return 'unknown';
    const order = [...angles.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
    const is = (pat: string) =>
      order.some((_, i) => [order[i], order[(i + 1) % 4], order[(i + 2) % 4], order[(i + 3) % 4]].join() === pat);
    if (is('1,2,3,4')) return 'in';
    if (is('1,4,3,2')) return 'out';
    return 'unknown';
  }

  /** Whether `board` counts as "reaching" the getout target. For the home target
   * this additionally requires the board to reproduce the start/home FASR. */
  private reachesTarget(board: Board, target: string): boolean {
    const canonical = canonicalName(target);
    if (!this.matcher.matchesNamed(board, canonical)) return false;
    if (canonical === 'Static Square') return fasrKey(board) === homeFasrKey();
    return true;
  }

  private canGetoutFrom(board: Board, target: string, depth: number): boolean {
    const key = `${target}|${depth}|${board.dancers
      .map((d) => `${d.id},${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}`)
      .join(';')}`;
    const memo = this.canGetoutMemo.get(key);
    if (memo !== undefined) return memo;
    let result = false;
    if (!this.reachesTarget(board, target) && depth > 0) {
      for (const { name, res } of this.searchCandidates(board)) {
        if (res.legal && this.canGetoutFrom(res.board, target, depth - 1)) {
          result = true;
          break;
        }
      }
    } else {
      result = this.reachesTarget(board, target);
    }
    this.canGetoutMemo.set(key, result);
    return result;
  }

  /** The legal calls from the current board that keep a getout alive. */
  fixIt(board: Board, opts: { target?: string; depth?: number } = {}): string[] {
    const target = canonicalName(opts.target ?? 'Static Square');
    const depth = opts.depth ?? 3;
    this.canGetoutMemo.clear();
    return this.searchCandidates(board)
      .filter(({ name, res }) => res.legal && this.canGetoutFrom(res.board, target, depth))
      .map(({ name }) => name);
  }

  /** Search for a sequence of legal calls that takes the set FROM home INTO the
   * target formation — the mirror companion of `getout`. */
  getin(_board: Board, opts: { target?: string; maxCalls?: number; budget?: number } = {}): string[] | null {
    const target = canonicalName(opts.target ?? 'Facing Couples');
    const maxCalls = opts.maxCalls ?? 5;
    const budget = opts.budget ?? 400;
    const home = makeSquaredSet();
    const seen = new Set<string>([boardSig(home)]);
    const state = { nodes: 0, budget };
    return this.getinPath(home, target, maxCalls, [], seen, state);
  }

  /** Depth-first getin search: from `board`, find a forward path to `target`. */
  private getinPath(
    board: Board,
    target: string,
    depth: number,
    path: string[],
    seen: Set<string>,
    state: { nodes: number; budget: number },
  ): string[] | null {
    if (state.nodes > state.budget) return null;
    if (depth === 0) return null;
    for (const c of this.searchCandidates(board)) {
      state.nodes++;
      const sig = boardSig(c.res.board);
      if (seen.has(sig)) continue;
      const nextPath = [...path, c.name];
      if (this.reachesTarget(c.res.board, target)) return nextPath;
      seen.add(sig);
      const r = this.getinPath(c.res.board, target, depth - 1, nextPath, seen, state);
      if (r) return r;
      seen.delete(sig);
    }
    return null;
  }
}
