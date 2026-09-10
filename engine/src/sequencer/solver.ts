// HomeSolver: finds sequences that return the set home (getout), take it home to
// a target formation (getin), or keep a getout alive (fixIt). Owns the
// home-scoring and reachability caches and the matrix fast-path cache. It holds
// no board state — callers pass the current board.
//
// THE CALLER CONVENTION (decided; see square-dancing.md §9.1 step 5 and prd.md §14):
// a get-out succeeds by reaching a state from which a standard finish CLOSES the
// square — `Allemande Left`, `Right and Left Grand` or `Promenade` — not by sitting
// on the literal home board. That is how callers write get-outs, and how All8's
// published ones end (`--AL` / `--RLG` / `--Prom`).
//
// This is implemented as a FINAL EDGE rather than as a looser goal: when a board is
// one finish away from home, the search appends that finish to the path it returns.
// A returned path therefore still ends on the literal home board, so every consumer
// (the FSM amendment gate, the UI's "apply getout", the tests) keeps the contract it
// already had — while the search gains the finishes, including the geometry-derived
// `Promenade`, as edges it can actually use.

import { fitRigidMatrix, identity5, mul5, type Mat5 } from '../matrix.js';
import { matchFormations, type Matchable } from './match.js';
import { FormationMatcher } from './matcher.js';
import { CallApplicator } from './applicator.js';
import { CallLibrary } from './library.js';
import { LegalityChecker } from './legality.js';
import { SequencerConfig, emptySearchStats, type SearchStats } from './config.js';
import { KNOWN_FORMATION_MAX, STANDARD_FINISHES, canonicalName } from './constants.js';
import { applyCodedMove } from './coded-moves.js';
import { makeSquaredSet, cloneBoard, boardSig } from './board.js';
import { fasrKey, homeFasrKey } from './fasr.js';
import type { Board, SeqDancer } from './types.js';

export class HomeSolver {
  private homeScoreCache = new Map<string, number>();
  private canGetoutMemo = new Map<string, boolean>();
  private finishCache = new Map<string, string[] | null>();
  private rigidGetoutCache: { name: string; M: Mat5; image: Matchable[]; seqDancers: SeqDancer[] }[] | null = null;
  /** Search cost counters. Written only when config.collectStats is on. */
  private stats: SearchStats = emptySearchStats();

  constructor(
    private readonly library: CallLibrary,
    private readonly matcher: FormationMatcher,
    private readonly applicator: CallApplicator,
    private readonly legality: LegalityChecker,
    private readonly config: SequencerConfig,
  ) {}

  /** What the last search cost. See SearchStats for why this exists at all. */
  searchStats(): SearchStats {
    return { ...this.stats, elapsedMs: this.stats.elapsedMs };
  }

  /** Zero the counters and start the clock. Called at the top of every public search so the
   * numbers describe ONE search rather than a session. */
  private beginStats(): number {
    if (!this.config.collectStats) return 0;
    this.stats = emptySearchStats();
    return Date.now();
  }

  private endStats(started: number): void {
    if (this.config.collectStats) this.stats.elapsedMs = Date.now() - started;
  }

  clearCaches(): void {
    this.homeScoreCache.clear();
    this.canGetoutMemo.clear();
    this.finishCache.clear();
  }

  /** Apply a call the way the SEQUENCER would: a geometry-derived call first (the
   * registry the Sequencer also uses, so `Promenade` is playable here), otherwise
   * the catalog through the interactive apply path. */
  private applyInteractive(board: Board, name: string): { board: Board; legal: boolean; reason?: string } {
    return applyCodedMove(board, name) ?? this.applicator.applyToBoard(board, name);
  }

  /**
   * How `board` closes: `[]` when it is already the home squared set, `[finish]` when
   * one standard finish closes it, or null when it is not a goal.
   *
   * That is the caller convention, applied at the goal test rather than only at the
   * end of the returned path. Memoised by board signature: the DFS asks this for every
   * candidate edge, and each answer costs up to one apply per finish.
   */
  private finishToHome(board: Board): string[] | null {
    if (this.reachesTarget(board, 'Static Square')) return [];
    // Keyed on the FULL pose including headings: whether a finish is legal depends on
    // facing, and `boardSig` is positions only, so keying on it would let two boards
    // that differ only by facing share an answer.
    const sig = board.dancers
      .map((d) => `${d.id},${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}`)
      .join(';');
    const cached = this.finishCache.get(sig);
    if (cached !== undefined) return cached;
    let result: string[] | null = null;
    for (const finish of STANDARD_FINISHES) {
      const r = this.applyInteractive(board, finish);
      if (!r.legal) continue;
      if (this.reachesTarget(r.board, 'Static Square')) { result = [finish]; break; }
    }
    this.finishCache.set(sig, result);
    return result;
  }
  /** The calls that complete `board` to `target`, `[]` when it is already there, or
   * null when it is not a goal. A non-home target has no finish: it is reached
   * literally or not at all. */
  private goalFinish(board: Board, target: string): string[] | null {
    if (canonicalName(target) !== 'Static Square') return this.reachesTarget(board, target) ? [] : null;
    return this.finishToHome(board);
  }

  // REMOVED: the private `equivalentCalls(board, call)`. It answered "which calls legal from
  // this board reach the same end formation as `call`" by scanning the WHOLE CATALOGUE, and
  // `searchCandidates` called it once per distinct end board - the L x C term. The answer is
  // derivable from the candidate list `searchCandidates` already has, so it lives there now.
  // The public query is unchanged: `Sequencer.equivalentCalls`.

  /** Search candidates from `board`: the legal calls (and modules), each widened
   * with its equivalent calls when config.useEquivalents is on. Candidates are
   * deduped by end-board signature so two equivalents reaching the same board are
   * not searched twice, while still keeping the alternative call names available
   * for the returned path.
   *
   * THE COST, and why this is written the way it is. `searchLegalCalls` is ONE scan of the
   * catalogue, which is the unavoidable C term. The equivalents used to be found by calling
   * `equivalentCalls`, which scanned the WHOLE CATALOGUE AGAIN - once per distinct end board -
   * making a node cost C + L x C. Measured on the published catalogue (C = 2211 titles) with
   * L between 24 and 286, that second term was 53 000 to 634 000 applies per node: about 99% of
   * the bill, and the reason a getout that does NOT exist took 134 seconds while one that does
   * took seconds.
   *
   * The fix is that the answer was already in hand. A call's equivalents are precisely the other
   * calls that are LEGAL from this board and reach the same end formation - and `base` is
   * exactly the list of calls legal from this board, with their end boards. Grouping `base` by
   * `knownFormation` therefore reproduces `equivalentCalls` from work already done, and the
   * L x C term disappears rather than shrinking. */
  private searchCandidates(board: Board): { name: string; res: { board: Board; legal: boolean } }[] {
    const base = this.legality.searchLegalCalls(board);
    if (this.config.collectStats) {
      this.stats.candidateScans++;
      this.stats.candidateCalls += base.length;
    }
    if (!this.config.useEquivalents) return base;
    const bySig = new Map<string, { name: string; res: { board: Board; legal: boolean }; alternates: string[] }>();
    for (const c of base) {
      const sig = boardSig(c.res.board);
      const existing = bySig.get(sig);
      if (existing) { existing.alternates.push(c.name); continue; }
      bySig.set(sig, { name: c.name, res: c.res, alternates: [] });
    }
    if (this.config.collectStats) this.stats.distinctEndBoards += bySig.size;
    // Group the candidates already in hand by end FORMATION: these are the equivalents.
    const byEndFormation = new Map<string, { name: string; res: { board: Board; legal: boolean } }[]>();
    for (const c of base) {
      const f = this.matcher.knownFormation(c.res.board);
      if (f === null) continue;
      const bucket = byEndFormation.get(f);
      if (bucket) bucket.push(c); else byEndFormation.set(f, [c]);
    }
    const out: { name: string; res: { board: Board; legal: boolean } }[] = [];
    // Dedupe by (name, end board). The equivalents loop below visits every candidate that ends
    // in the same formation, so a call reachable from several of them - `Promenade` reaches home
    // from all of them - was pushed once per visit, and `fixIt` returned it ELEVEN times. Two
    // entries with the same name AND the same end board are the same edge; the same name
    // reaching a DIFFERENT board is a genuinely different edge and is kept.
    const emitted = new Set<string>();
    const push = (name: string, res: { board: Board; legal: boolean }) => {
      const key = `${name}|${boardSig(res.board)}`;
      if (emitted.has(key)) return;
      emitted.add(key);
      out.push({ name, res });
    };
    for (const { name, res, alternates } of bySig.values()) {
      push(name, res);
      for (const alt of alternates) push(alt, res);
      const end = this.matcher.knownFormation(res.board);
      if (end === null) continue;
      const named = new Set([name, ...alternates]);
      for (const eq of byEndFormation.get(end) ?? []) {
        if (named.has(eq.name)) continue;
        push(eq.name, eq.res);
      }
    }
    return out;
  }

  /**
   * Search for a sequence of legal calls that takes the set home. Returns the call
   * path or null.
   *
   * Under the caller convention a sequence that reaches a state a standard finish
   * closes COUNTS as a getout, and the finish is appended to the path, so:
   *   * `maxCalls` bounds the length of the path RETURNED, finish included;
   *   * a board that is a finish away from home yields `[...body, 'Allemande Left']`
   *     (or `Right and Left Grand` / `Promenade`), which is exactly how a caller -
   *     and All8's published get-outs - write it;
   *   * `Promenade` is a usable final edge even though it is geometry-derived and
   *     absent from the catalog.
   */
  getout(board: Board, opts: { target?: string; maxCalls?: number; budget?: number } = {}): string[] | null {
    const started = this.beginStats();
    try {
      return this.getoutInner(board, opts);
    } finally {
      this.endStats(started);
    }
  }

  private getoutInner(board: Board, opts: { target?: string; maxCalls?: number; budget?: number } = {}): string[] | null {
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
    return this.getoutPath(board, target, maxCalls, maxCalls, [], seen, state, (path) =>
      this.verifyInteractivePath(board, path, target),
    );
  }

  /** Replay a candidate getout path through the INTERACTIVE apply path to confirm
   * every call is genuinely legal and the final board reaches `target`. A path that
   * closes with a standard finish is replayed through it too, so a claimed finish is
   * verified rather than assumed. */
  private verifyInteractivePath(board: Board, path: string[], target: string): boolean {
    let b = cloneBoard(board);
    for (const name of path) {
      const r = this.applyInteractive(b, name);
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
      if (path.length > 0) {
        const finish = this.goalFinish(b, target);
        if (finish && path.length + finish.length <= maxCalls) return [...path, ...finish];
      }
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
    const finish = this.goalFinish(b, target);
    return finish && path.length + finish.length <= maxCalls ? [...path, ...finish] : null;
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

  /** Depth-first getout search. `depth` is the remaining body depth; `maxCalls` is
   * the length the RETURNED path may have, an appended finish included. */
  private getoutPath(
    board: Board,
    target: string,
    depth: number,
    maxCalls: number,
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
      if (this.config.collectStats) this.stats.nodes = state.nodes;
      path.push(name);
      // The board is a goal either literally or because a standard finish closes it
      // from there (the caller convention); in the second case the finish is part of
      // the path, so what is returned still ends on the home board.
      const finish = this.goalFinish(res.board, target);
      if (finish && path.length + finish.length <= maxCalls) {
        const full = [...path, ...finish];
        if (!validate || validate(full)) return full;
      }
      const sub = this.getoutPath(res.board, target, depth - 1, maxCalls, path, seen, state, validate);
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
    // A board is "already a getout" under the caller convention when a standard
    // finish closes it, so fixIt offers the calls that keep that true.
    let result = this.goalFinish(board, target) !== null;
    if (!result && depth > 0) {
      for (const { name, res } of this.searchCandidates(board)) {
        if (res.legal && this.canGetoutFrom(res.board, target, depth - 1)) { result = true; break; }
      }
    }
    this.canGetoutMemo.set(key, result);
    return result;
  }

  /** The legal calls from the current board that keep a getout alive. */
  fixIt(board: Board, opts: { target?: string; depth?: number } = {}): string[] {
    const started = this.beginStats();
    try {
      const target = canonicalName(opts.target ?? 'Static Square');
      const depth = opts.depth ?? 3;
      this.canGetoutMemo.clear();
      return this.searchCandidates(board)
        .filter(({ name, res }) => res.legal && this.canGetoutFrom(res.board, target, depth))
        .map(({ name }) => name);
    } finally {
      this.endStats(started);
    }
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
