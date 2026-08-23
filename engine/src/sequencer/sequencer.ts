// Sequencer: a board of identity-tracked dancers that applies calls from the
// taminations data, checks legality, recognizes the resulting formation, and
// analyzes FASR. Data-driven: each call's <tam> setup (start formation + paths)
// is run and its RELATIVE movement is transferred onto the board dancers, so
// the result is exact and orientation-independent.

import { DEG, dancerBeats, poseFor } from '../core.js';
import { buildCall, parseCallXml, parseFormations, parseMoves } from '../convert.js';
import { matchFormations, type Matchable } from './match.js';
import { analyzeFasr } from './fasr.js';
import type { Board, Fasr, Module, RecognizedFormation, SeqDancer, SeqStep } from './types.js';
import type { CallBundle, DancerSpec, Pose } from '../types.js';

// ------------------------------------------------------------ starting board

// Home Squared Set: 4 couples, each a boy+girl side by side at one side of the
// square. Couple 1 north, 2 east, 3 south, 4 west.
function makeSquaredSet(): Board {
  const mk = (id: number, couple: number, gender: 'boy' | 'girl', x: number, y: number, angleDeg: number): SeqDancer => ({
    id,
    couple,
    gender,
    x,
    y,
    heading: angleDeg * DEG,
  });
  return {
    dancers: [
      mk(1, 3, 'boy', 1, 3, 270), // couple 3 north, facing south (center)
      mk(2, 3, 'girl', -1, 3, 270),
      mk(3, 2, 'boy', 3, -1, 180), // couple 2 east, facing west (center)
      mk(4, 2, 'girl', 3, 1, 180),
      mk(5, 1, 'boy', -1, -3, 90), // couple 1 south (nearest viewer), facing north (center)
      mk(6, 1, 'girl', 1, -3, 90),
      mk(7, 4, 'boy', -3, 1, 0), // couple 4 west, facing east (center)
      mk(8, 4, 'girl', -3, -1, 0),
    ],
  };
}

const normAngle = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const rot = (a: number, v: { x: number; y: number }) => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

/**
 * Transform a canonical-start pose into the board's OWN frame using the match's
 * rotation/reflection and the two centers. Re-base must use this: it places each
 * dancer onto the canonical SHAPE at the board's current location/orientation.
 * Using the raw canonical pose instead would snap dancers to the canonical
 * orientation, spinning the whole set whenever a call's setup is authored at a
 * different absolute rotation (the source of both the 180 and 90 degree flips).
 */
function rebasedPose(pose: { x: number; y: number; heading: number }, m: { rot: number; reflect: boolean; cSrc: { x: number; y: number }; cTgt: { x: number; y: number } }): { x: number; y: number; heading: number } {
  let x = pose.x - m.cTgt.x;
  let y = pose.y - m.cTgt.y;
  if (m.reflect) x = -x;
  const rx = x * Math.cos(m.rot) - y * Math.sin(m.rot);
  const ry = x * Math.sin(m.rot) + y * Math.cos(m.rot);
  return { x: rx + m.cSrc.x, y: ry + m.cSrc.y, heading: normAngle(pose.heading + m.rot + (m.reflect ? Math.PI : 0)) };
}

// Standard Mainstream formations used for RECOGNITION. Matching against a
// curated list avoids mislabeling a setup as a congruent-but-unrelated named
// formation (many 4-dancer setups become geometrically congruent once mirrored,
// e.g. "Single File Promenade" vs "Squared Set").
const STANDARD_FORMATIONS = [
  'Squared Set',
  'Static Square',
  'Normal Lines',
  'Double Pass Thru',
  'Quarter Tag',
  'Tidal Line RH',
  'Tidal Wave RH',
  'Separated Columns',
  'Alamo Wave',
  'Eight Chain Thru',
  'Two-Faced Lines',
  'Ocean Waves RH',
];

// ------------------------------------------------------------ Sequencer

// Default tolerance for formation matching (matchFormations' maxError).
const DEFAULT_MATCH_MAX = 6.0;

// A matched call variant plus the rigid transform (rotation/reflection + both
// centers) that overlays its canonical setup onto the board.
interface VariantMatch {
  variant: CallBundle;
  mapping: number[];
  error: number;
  rot: number;
  reflect: boolean;
  cSrc: { x: number; y: number };
  cTgt: { x: number; y: number };
}

// Calls that are conceptually sequences of multiple smaller calls (e.g. Running
// Bear) but are authored in the data as a single call. The picker shows these as
// "modules" so their composite nature is visible. Extend this list as more are
// identified; user-defined modules (registerModule) are handled separately.
const CURATED_MODULE_CALLS: string[] = ['Running Bear'];

export class Sequencer {
  private variants: Map<string, CallBundle[]> = new Map();
  private modules: Map<string, string[]> = new Map(); // module name -> call names
  private namedFormations: { name: string; dancers: Matchable[] }[] = [];

  board: Board;
  private matchMargin = 0;
  private rebaseFactor = 1; // 1 = reset drift to the call's canonical setup, 0 = keep it

  // Cached canonical end pose (at each dancer's last beat) per variant. The end
  // formation of a call is a pure function of its compiled <tam> paths, so it is
  // computed once per variant instead of on every apply.
  private variantEndCache = new WeakMap<CallBundle, Pose[]>();

  /** The canonical end pose of each dancer of a variant (pure, cached). */
  private endPoses(variant: CallBundle): Pose[] {
    let end = this.variantEndCache.get(variant);
    if (!end) {
      end = variant.dancers.map((d) => poseFor(d, dancerBeats(d)));
      this.variantEndCache.set(variant, end);
    }
    return end;
  }

  /** Set an extra matching tolerance (in position units) added to the default
   * when matching the current board against a next call's start setup, and when
   * checking whether a result lands in a known formation. A larger margin lets
   * a slightly-off end position still line up with viable next calls. */
  setMatchMargin(margin: number): void {
    this.matchMargin = margin;
  }

  /** Set how much of the difference between the board's current position and the
   * call's canonical start is absorbed when the call is applied (0..1). At 1 the
   * dancers are reset onto the canonical setup so margin-based drift doesn't
   * accumulate; lower values ease across the difference instead of snapping. */
  setRebaseFactor(factor: number): void {
    this.rebaseFactor = Math.max(0, Math.min(1, factor));
  }

  constructor(
    private movesXml: string,
    private formationsXml: string,
    calls: { name: string; xml: string }[] = [],
  ) {
    const f = parseFormations(formationsXml);
    const base = [...f.entries()].map(([name, ds]) => ({
      name,
      dancers: ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG })),
    }));
    // Mirror 4-dancer (half-group) named formations to 8 so an 8-dancer board
    // can be recognized against them (e.g. Squared Set, Normal Lines).
    this.namedFormations = [];
    for (const fm of base) {
      if (fm.dancers.length === 8) {
        this.namedFormations.push(fm);
      } else if (fm.dancers.length === 4) {
        const mirror = fm.dancers.map((d) => ({ x: -d.x, y: -d.y, heading: normAngle(d.heading + Math.PI) }));
        const merged = fm.dancers.concat(mirror);
        if (!merged.some((a) => merged.some((b) => a !== b && Math.hypot(a.x - b.x, a.y - b.y) < 0.01))) {
          this.namedFormations.push({ name: fm.name, dancers: merged });
        }
      }
    }
    this.board = makeSquaredSet();
    for (const c of calls) {
      try {
        this.register(c.name, c.xml);
      } catch {
        // Skip a call whose data fails to build; it just won't be applicable.
      }
    }
  }

  /** Register a call so it can be applied by name. */
  register(name: string, xml: string): void {
    this.variants.set(name, this.loadVariants(xml));
  }

  /**
   * Register a user-defined module: a named sequence of calls that behaves like
   * a single call (a fix/getout). Calls may reference built-in calls or other
   * modules (nesting); cycles are rejected at apply time.
   */
  registerModule(name: string, calls: string[]): void {
    this.modules.set(name, [...calls]);
  }

  /** Registered user-defined module names. */
  listModules(): string[] {
    return [...this.modules.keys()];
  }

  /**
   * Whether a call name is a "module" for picker purposes: either a user-defined
   * module (registerModule) or a curated composite call (e.g. Running Bear).
   */
  isModule(name: string): boolean {
    return this.modules.has(name) || CURATED_MODULE_CALLS.includes(name);
  }

  /** Registered modules as objects. */
  getModules(): Module[] {
    return [...this.modules.entries()].map(([name, calls]) => ({ name, calls }));
  }

  // ---- sequence animation ----

  /** Flatten a sequence, expanding user-defined modules (cycle-guarded). */
  flatten(sequence: string[]): string[] {
    const out: string[] = [];
    const expand = (names: string[], stack: string[]): void => {
      for (const n of names) {
        if (this.modules.has(n)) {
          if (stack.includes(n)) continue; // cycle guard
          expand(this.modules.get(n)!, [...stack, n]);
        } else {
          out.push(n);
        }
      }
    };
    expand(sequence, []);
    return out;
  }

  /** Beats of the variant of `name` that matches `board` (0 if none). */
  stepBeats(board: Board, name: string): number {
    const m = this.findMatchingVariant(board, name);
    if (!m) return 0;
    return Math.max(...m.variant.dancers.map((d) => dancerBeats(d)));
  }

  /** Total beats to play a flat sequence starting from home. */
  sequenceBeats(flat: string[]): number {
    let board = makeSquaredSet();
    let total = 0;
    for (const name of flat) {
      total += this.stepBeats(board, name);
      const r = this.applyToBoard(board, name);
      if (r.legal) board = r.board;
    }
    return total;
  }

  /**
   * Evaluate the board at a global beat of a flat sequence, starting from home.
   * During a call the dancers are placed at that call's intermediate motion.
   */
  evaluateSequence(flat: string[], beat: number): { board: Board; beats: number } {
    let board = makeSquaredSet();
    let acc = 0;
    for (const name of flat) {
      const m = this.findMatchingVariant(board, name);
      if (!m) break;
      const beats = Math.max(...m.variant.dancers.map((d) => dancerBeats(d)));
      if (beat < acc + beats) {
        return { board: this.evaluateVariantAt(board, m, beat - acc), beats: 0 };
      }
      const r = this.applyToBoard(board, name);
      if (r.legal) board = r.board;
      acc += beats;
    }
    return { board, beats: acc };
  }

  /**
   * Which call in `flat` is playing at global `beat`, together with its matched
   * variant (canonical dancers) and the board->variant mapping. Returns null past
   * the end of the sequence. Mirrors the board accumulation in evaluateSequence,
   * so the variant + mapping correspond exactly to what is displayed. The UI uses
   * it to draw the currently-playing call's floor trace.
   */
  sequenceInfo(flat: string[], beat: number): { name: string; variant: CallBundle; mapping: number[] } | null {
    let board = makeSquaredSet();
    let acc = 0;
    for (const name of flat) {
      const m = this.findMatchingVariant(board, name);
      if (!m) return null;
      const beats = Math.max(...m.variant.dancers.map((d) => dancerBeats(d)));
      if (beat < acc + beats) {
        return { name, variant: m.variant, mapping: m.mapping };
      }
      const r = this.applyToBoard(board, name);
      if (r.legal) board = r.board;
      acc += beats;
    }
    return null;
  }

  private evaluateVariantAt(board: Board, m: VariantMatch, localBeat: number): Board {
    const { variant, mapping } = m;
    const f = this.rebaseFactor;
    const newDancers = board.dancers.map((d, i) => {
      const t = variant.dancers[mapping[i]];
      const start = poseFor(t, 0);
      const cur = poseFor(t, Math.min(localBeat, dancerBeats(t)));
      const localDisp = rot(-start.heading, { x: cur.x - start.x, y: cur.y - start.y });
      const delta = normAngle(cur.heading - start.heading);
      // Same re-base blend as applyToBoardInner (canonical pose transformed into
      // the board's frame) so the animation matches the board.
      const base = rebasedPose(start, m);
      const bx = d.x + (base.x - d.x) * f;
      const by = d.y + (base.y - d.y) * f;
      const bh = normAngle(d.heading + (base.heading - d.heading) * f);
      const disp = rot(bh, localDisp);
      return { ...d, x: bx + disp.x, y: by + disp.y, heading: normAngle(bh + delta) };
    });
    return { dancers: newDancers };
  }

  private loadVariants(callXml: string): CallBundle[] {
    const moves = parseMoves(this.movesXml);
    const formations = parseFormations(this.formationsXml);
    const tams = parseCallXml(callXml);
    return tams.map((tam) => buildCall(tam, formations, moves, true));
  }

  reset(): void {
    this.board = makeSquaredSet();
    this.matchMemo.clear();
    this.homeScoreCache.clear();
  }

  startBoard(): Board {
    return cloneBoard(this.board);
  }

  /** The current board as a list of matchable dancers. */
  private matchables(board: Board): Matchable[] {
    return board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading }));
  }

  // A variant dancer's matchable position. Mirrored (duplicate-half) dancers
  // store the base x/y but the mirror is applied at pose time, so apply the
  // 180-degree rotation here for matching.
  private variantMatchable(d: CallBundle['dancers'][number]): Matchable {
    if (d.mirror) {
      return { x: -d.x, y: -d.y, heading: normAngle(d.angleDeg * DEG + Math.PI) };
    }
    return { x: d.x, y: d.y, heading: d.angleDeg * DEG };
  }

  /** Which of this call's variants matches the given board? Memoised by call name
   * + board geometry: boards are immutable (always cloned before mutation), so a
   * given signature + call always yields the same result, and the same (board,
   * call) pair recurs a lot while probing legality and continuations. */
  private matchMemo = new Map<string, VariantMatch | null>();
  private findMatchingVariant(board: Board, callName: string): VariantMatch | null {
    const variants = this.variants.get(callName);
    if (!variants) return null;
    // Key on the call's position/heading signature only (id is irrelevant to the
    // geometric match, so two boards with identical geometry share a cache entry).
    const key = `${callName}|${board.dancers
      .map((d) => `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}`)
      .join(';')}`;
    const cached = this.matchMemo.get(key);
    if (cached !== undefined) return cached;
    const src = this.matchables(board);
    let best: VariantMatch | null = null;
    for (const v of variants) {
      const tgt = v.dancers.map((d) => this.variantMatchable(d));
      const m = matchFormations(src, tgt, DEFAULT_MATCH_MAX + this.matchMargin);
      if (m && (best === null || m.error < best.error)) {
        best = { variant: v, mapping: m.mapping, error: m.error, rot: m.rot, reflect: m.reflect, cSrc: m.cSrc, cTgt: m.cTgt };
      }
    }
    this.matchMemo.set(key, best);
    return best;
  }

  /** Apply a call (or module) to a COPY of the given board (does not mutate).
   *
   * The interactive apply re-bases the board onto the call's canonical start so
   * margin-based drift doesn't accumulate on the live sequence. */
  applyToBoard(board: Board, callName: string): { board: Board; legal: boolean; reason?: string } {
    return this.applyToBoardInner(board, callName, [], true);
  }

  /**
   * Apply a call to a copy of the board using PURE relative motion — no drift
   * re-base. Used by the search operations (legalCalls, getout, fixIt, etc.)
   * where re-basing onto the matched variant's start would pin dancers to their
   * current (possibly permuted) positions and destroy the identity information
   * those searches need to un-permute a board back home.
   */
  private applySearch(board: Board, callName: string): { board: Board; legal: boolean; reason?: string } {
    return this.applyToBoardInner(board, callName, [], false);
  }

  private applyToBoardInner(
    board: Board,
    callName: string,
    stack: string[],
    rebase: boolean,
  ): { board: Board; legal: boolean; reason?: string } {
    if (this.modules.has(callName)) {
      if (stack.includes(callName)) {
        return { board: cloneBoard(board), legal: false, reason: `Module cycle: ${callName}` };
      }
      const nextStack = [...stack, callName];
      let cur = board;
      for (const sub of this.modules.get(callName)!) {
        const r = this.applyToBoardInner(cur, sub, nextStack, rebase);
        if (!r.legal) {
          return { board: cloneBoard(board), legal: false, reason: `Module ${callName}: "${sub}" not legal here` };
        }
        cur = r.board;
      }
      return { board: cur, legal: true };
    }

    const match = this.findMatchingVariant(board, callName);
    if (!match) {
      return {
        board: cloneBoard(board),
        legal: false,
        reason: this.variants.has(callName)
          ? 'No setup in this call matches the current formation.'
          : `Unknown call: ${callName}`,
      };
    }
    const { variant, mapping } = match;
    // Re-base for the interactive apply: snap each dancer onto the call's
    // canonical start (times the rebase factor) so the next call always executes
    // from its canonical setup and margin drift never accumulates. The base is
    // the canonical pose transformed into the board's OWN frame (via the match's
    // rotation/reflection), so the set is not spun when a setup is authored at a
    // different absolute orientation. The search paths pass rebase=false and use
    // pure relative motion so a getout can still un-permute dancers back home.
    const f = rebase ? this.rebaseFactor : 0;
    const ends = this.endPoses(variant);
    const newDancers = board.dancers.map((d, i) => {
      const t = variant.dancers[mapping[i]];
      const start = poseFor(t, 0);
      const end = ends[mapping[i]];
      const localDisp = rot(-start.heading, { x: end.x - start.x, y: end.y - start.y });
      const delta = normAngle(end.heading - start.heading);
      // Blend the dancer's base toward the (rebased) call start (f=1 full reset,
      // f=0 keep the board exactly where it was), then apply the canonical motion.
      const base = rebase ? rebasedPose(start, match) : start;
      const bx = d.x + (base.x - d.x) * f;
      const by = d.y + (base.y - d.y) * f;
      const bh = normAngle(d.heading + (base.heading - d.heading) * f);
      const disp = rot(bh, localDisp);
      return { ...d, x: bx + disp.x, y: by + disp.y, heading: normAngle(bh + delta) };
    });
    return { board: { dancers: newDancers }, legal: true };
  }

  /**
   * Apply a call to the current board, advancing the sequencer state. Returns
   * the new board + legality + recognized formation.
   */
  apply(callName: string): SeqStep {
    const res = this.applyToBoard(this.board, callName);
    this.board = res.board;
    this.matchMemo.clear(); // the primary board moved; start a fresh match cache
    this.homeScoreCache.clear();
    return { call: callName, legal: res.legal, reason: res.reason, board: res.board, formation: this.recognize(res.board) };
  }

  /** Whether a board matches the named formation (by tolerant matching). */
  private matchesNamed(board: Board, name: string): boolean {
    const f = this.namedFormations.find((x) => x.name === name);
    if (!f || f.dancers.length !== board.dancers.length) return false;
    return matchFormations(this.matchables(board), f.dancers) !== null;
  }

  /** Whether the current (or given) board is at the named formation. */
  isAt(name: string, board: Board = this.board): boolean {
    return this.matchesNamed(board, name);
  }

  /** Calls legal from a given board (does not mutate state).
   *
   * A call counts as a valid *next* call only if it both (a) starts in a setup
   * that matches the current board AND (b) ends in a known formation — i.e. the
   * result matches ANY formation in the full taminations formations catalog.
   * Calls that strand the dancers in a setup with no catalog formation are
   * withheld, so the sequence always lands somewhere recognizable.
   */
  legalCalls(board: Board): string[] {
    return this.legalWithResults(board).map((x) => x.name);
  }

  /** Legal calls from `board`, each paired with its already-computed result board
   * so a caller (e.g. the getout heuristic) can inspect the outcome without
   * re-applying the call. */
  private legalWithResults(board: Board): { name: string; res: { board: Board; legal: boolean } }[] {
    const out: { name: string; res: { board: Board; legal: boolean } }[] = [];
    for (const name of this.variants.keys()) {
      const res = this.applySearch(board, name);
      if (res.legal && this.knownFormation(res.board) !== null) out.push({ name, res });
    }
    // User-defined modules: legal iff every contained call is legal in sequence
    // and the whole module ends in a known formation.
    for (const mname of this.modules.keys()) {
      const res = this.applySearch(board, mname);
      if (res.legal && this.knownFormation(res.board) !== null) out.push({ name: mname, res });
    }
    return out;
  }

  /** The name of any formation in the FULL catalog that `board` matches, else
   * null. Unlike `recognize` (which is restricted to a curated list for stable
   * display labels), this is permissive: any standard formation the result
   * lands in counts as "known". */
  private knownFormation(board: Board): string | null {
    const src = this.matchables(board);
    for (const f of this.namedFormations) {
      if (f.dancers.length !== src.length) continue;
      if (matchFormations(src, f.dancers, DEFAULT_MATCH_MAX + this.matchMargin)) return f.name;
    }
    return null;
  }

  /** Calls legal from the current board. */
  legalNext(): string[] {
    return this.legalCalls(this.board);
  }

  /**
   * Search for a sequence of legal calls that ends in the target formation
   * (default: a squared set). Returns the call path or null.
   *
   * Uses a depth-first search that descends the most promising (home-closest)
   * branches first, dedupes visited boards, and is capped by a node budget so a
   * hard-to-close state can never hang the UI. Callers that exhaust the budget
   * get null and may retry. For the default home target the search also requires
   * the final board to restore the START FASR (dancers back in sequence) — not
   * merely land on a geometrically-congruent square with identities permuted.
   */
  getout(opts: { target?: string; maxCalls?: number; budget?: number } = {}): string[] | null {
    const target = opts.target ?? 'Static Square';
    const maxCalls = opts.maxCalls ?? 5;
    const budget = opts.budget ?? 400;
    this.matchMemo.clear();
    this.canGetoutMemo.clear();
    this.homeScoreCache.clear();

    // Fast path: greedy best-first straight toward home. Handles the common
    // "nearly home" body in milliseconds with no backtracking.
    const greedy = this.greedyHome(target, maxCalls);
    if (greedy) return greedy;

    // Fallback: budgeted DFS for harder bodies (bounded so it can't hang).
    const seen = new Set<string>([boardSig(this.board)]);
    const state = { nodes: 0, budget };
    return this.getoutPath(this.board, target, maxCalls, [], seen, state);
  }

  /** Greedy best-first: at each step pick the legal call whose result scores
   * closest to home, never moving to a worse-scoring board. Returns a valid home
   * path or null (when stuck or out of calls). */
  private greedyHome(target: string, maxCalls: number): string[] | null {
    let board = cloneBoard(this.board);
    const path: string[] = [];
    const seen = new Set<string>([boardSig(board)]);
    let curScore = -Infinity;
    for (let i = 0; i < maxCalls; i++) {
      if (path.length > 0 && this.reachesTarget(board, target)) return path;
      let best: { name: string; res: { board: Board; legal: boolean } } | null = null;
      let bestScore = -Infinity;
      for (const c of this.legalWithResults(board)) {
        const sig = boardSig(c.res.board);
        if (seen.has(sig)) continue;
        const s = this.homeScore(c.res.board);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      if (!best || bestScore < curScore) return null; // no move, or not improving
      seen.add(boardSig(best.res.board));
      board = best.res.board;
      path.push(best.name);
      curScore = bestScore;
    }
    return this.reachesTarget(board, target) ? path : null;
  }

  /** Depth-first getout search. `depth` = calls still allowed (remaining).
   * Candidates are ordered by how close their result lands to the target (for
   * the home target: geometric closeness to the squared set plus in-sequence
   * ordering), so promising branches are descended first. `seen` dedupes by board
   * signature so the same state is never revisited (the BFS used the same guard)
   * — without it the DFS would explore cycles exponentially. */
  private getoutPath(
    board: Board,
    target: string,
    depth: number,
    path: string[],
    seen: Set<string>,
    state: { nodes: number; budget: number },
  ): string[] | null {
    if (depth <= 0) return null;
    if (state.nodes >= state.budget) return null;
    const candidates = this.legalWithResults(board);
    candidates.sort((a, b) => this.homeScore(b.res.board) - this.homeScore(a.res.board));
    for (const { name, res } of candidates) {
      const sig = boardSig(res.board);
      if (seen.has(sig)) continue;
      seen.add(sig);
      state.nodes++;
      path.push(name);
      if (this.reachesTarget(res.board, target)) return [...path];
      const sub = this.getoutPath(res.board, target, depth - 1, path, seen, state);
      if (sub) return sub;
      path.pop();
    }
    return null;
  }

  /** Closeness of `board` (default: current) to the home squared set; higher is
   * closer. Exposed for callers (e.g. tip generation) to prefer easily-closable
   * boards so a getout home is short and cheap. */
  closenessToHome(board: Board = this.board): number {
    return this.homeScore(board);
  }

  /** Closeness of `board` to the home squared set (higher = closer). Uses the
   * rigid-match error to the square (always finite because the huge tolerance
   * disables the pairwise-signature quick-reject), so even boards far from home
   * get an ordering signal — plus a bonus for being in sequence. Cached by board
   * signature; used only as a getout-ordering heuristic. */
  private homeScoreCache = new Map<string, number>();
  private homeScore(board: Board): number {
    const sig = boardSig(board);
    const cached = this.homeScoreCache.get(sig);
    if (cached !== undefined) return cached;
    let s = 0;
    const sq = this.namedFormations.find((f) => f.name === 'Static Square');
    if (sq && sq.dancers.length === board.dancers.length) {
      const m = matchFormations(this.matchables(board), sq.dancers, 1e9);
      if (m) s -= m.error * 100; // geometric closeness dominates (the hard part)
    }
    const seq = this.sequenceOf(board);
    if (seq === 'in') s += 10; // sequence fix is usually 1-2 calls once at the square
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

  // Whether `board` counts as "reaching" the getout target. For the home target
  // ('Static Square') this additionally requires the board to reproduce the
  // start/home FASR (identity restored, in sequence), so the ending FASR equals
  // the starting FASR.
  private reachesTarget(board: Board, target: string): boolean {
    if (!this.matchesNamed(board, target)) return false;
    if (target === 'Static Square') return this.fasrKey(board) === this.homeFasrKey();
    return true;
  }

  /** A canonical key of a board's FASR (sequence + relationships). */
  private fasrKey(board: Board): string {
    const f = analyzeFasr(board, null);
    return `${f.sequence}|${JSON.stringify(f.relationship)}`;
  }

  /** The FASR key of the fresh home squared set. */
  private homeFasrKey(): string {
    return this.fasrKey(makeSquaredSet());
  }

  // Is a getout (sequence ending at `target`) reachable from `board` within
  // `depth` calls? Memoised: the reachability is deterministic, so revisiting the
  // same full board state at the same remaining depth is a no-op. Without this the
  // search is exponential over the legal-call branching and can hang the UI/tests.
  private canGetoutMemo = new Map<string, boolean>();
  private canGetoutFrom(board: Board, target: string, depth: number): boolean {
    const key = `${target}|${depth}|${board.dancers
      .map((d) => `${d.id},${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}`)
      .join(';')}`;
    const memo = this.canGetoutMemo.get(key);
    if (memo !== undefined) return memo;
    let result = false;
    if (!this.reachesTarget(board, target) && depth > 0) {
      for (const name of this.legalCalls(board)) {
        const res = this.applySearch(board, name);
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

  /**
   * "Fix it" helper: the legal calls from the current board that keep a getout
   * alive (i.e. after playing one of them, a home-returning sequence still
   * exists within `depth` calls). Useful to steer a choreography home.
   */
  fixIt(opts: { target?: string; depth?: number } = {}): string[] {
    const target = opts.target ?? 'Static Square';
    const depth = opts.depth ?? 3;
    this.canGetoutMemo.clear(); // memo is per-fixIt exploration
    return this.legalCalls(this.board).filter((name) => {
      const res = this.applySearch(this.board, name);
      return res.legal && this.canGetoutFrom(res.board, target, depth);
    });
  }

  /** Recognize the board against the curated standard formations. */
  recognize(board: Board): RecognizedFormation {
    const src = this.matchables(board);
    const symmetric = isSymmetric(board);
    let best: RecognizedFormation = { name: null, error: Infinity, symmetric };
    for (const f of this.namedFormations) {
      if (!STANDARD_FORMATIONS.includes(f.name) || f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers);
      if (m && m.error < best.error) best = { name: f.name, error: m.error, symmetric };
    }
    if (best.name === null) best.error = 0;
    return best;
  }

  /** FASR analysis of the current board. */
  fasr(): Fasr {
    return analyzeFasr(this.board, this.recognize(this.board).name);
  }
}

function isSymmetric(board: Board): boolean {
  const ds = board.dancers;
  return ds.length % 2 === 0 && ds.every((d) => ds.some((o) => Math.hypot(d.x + o.x, d.y + o.y) < 0.2));
}

function cloneBoard(b: Board): Board {
  return { dancers: b.dancers.map((d) => ({ ...d })) };
}

// ------------------------------------------------------------ identity

// The home squared-set positions (dancer id -> its home pose). Identity (which
// couple / which dancer id) is fixed from this square at the start of the dance
// and never changes, regardless of where a call moves the dancers.
const HOME_MATCHABLES: Matchable[] = makeSquaredSet().dancers.map((d) => ({
  x: d.x,
  y: d.y,
  heading: d.heading,
}));

/**
 * Stamp each dancer of a full-set call with its home-square identity (id +
 * couple) by matching the call's start formation to the home squared set up to
 * rotation/reflection. Callers then colour by `couple` (a stable property of
 * the dancer) instead of re-deriving identity from position or array index each
 * call.
 *
 * Mirrored (half-set) dancers use their full-set position for matching. When the
 * call's setup isn't an 8-dancer home square (e.g. a smaller group or a phantom
 * setup), no identity can be assigned and the dancers are returned un-stamped.
 */
export function assignHomeIdentity(dancers: DancerSpec[]): DancerSpec[] {
  if (dancers.length !== HOME_MATCHABLES.length) return dancers;
  const full = dancers.map((d): Matchable => {
    if (d.mirror) return { x: -d.x, y: -d.y, heading: normAngle(d.angleDeg * DEG + Math.PI) };
    return { x: d.x, y: d.y, heading: d.angleDeg * DEG };
  });
  const m = matchFormations(full, HOME_MATCHABLES);
  if (!m) return dancers;
  const home = makeSquaredSet().dancers;
  return dancers.map((d, i) => {
    const h = home[m.mapping[i]];
    return { ...d, id: h.id, couple: h.couple };
  });
}

// Rotation/translation/reflection-invariant signature for BFS dedup: the sorted
// pairwise-distance multiset + each dancer's radius/heading-binned profile.
function boardSig(b: Board): string {
  const ds = b.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading }));
  const dists: number[] = [];
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) dists.push(Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  dists.sort((a, c) => a - c);
  return dists.map((d) => d.toFixed(2)).join('|');
}

