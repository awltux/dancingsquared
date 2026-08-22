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
import type { CallBundle, DancerSpec } from '../types.js';

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

export class Sequencer {
  private variants: Map<string, CallBundle[]> = new Map();
  private modules: Map<string, string[]> = new Map(); // module name -> call names
  private namedFormations: { name: string; dancers: Matchable[] }[] = [];

  board: Board;
  private matchMargin = 0;
  private rebaseFactor = 1; // 1 = reset drift to the call's canonical setup, 0 = keep it

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

  private evaluateVariantAt(board: Board, m: { variant: CallBundle; mapping: number[]; error: number }, localBeat: number): Board {
    const { variant, mapping } = m;
    const f = this.rebaseFactor;
    const newDancers = board.dancers.map((d, i) => {
      const t = variant.dancers[mapping[i]];
      const start = poseFor(t, 0);
      const cur = poseFor(t, Math.min(localBeat, dancerBeats(t)));
      const localDisp = rot(-start.heading, { x: cur.x - start.x, y: cur.y - start.y });
      const delta = normAngle(cur.heading - start.heading);
      // Same re-base blend as applyToBoardInner so the animation matches the board.
      const bx = d.x + (start.x - d.x) * f;
      const by = d.y + (start.y - d.y) * f;
      const bh = normAngle(d.heading + (start.heading - d.heading) * f);
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

  /** Which of this call's variants matches the given board? */
  private findMatchingVariant(board: Board, callName: string): { variant: CallBundle; mapping: number[]; error: number } | null {
    const variants = this.variants.get(callName);
    if (!variants) return null;
    const src = this.matchables(board);
    let best: { variant: CallBundle; mapping: number[]; error: number } | null = null;
    for (const v of variants) {
      const tgt = v.dancers.map((d) => this.variantMatchable(d));
      const m = matchFormations(src, tgt, DEFAULT_MATCH_MAX + this.matchMargin);
      if (m && (best === null || m.error < best.error)) best = { variant: v, mapping: m.mapping, error: m.error };
    }
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
    // from its canonical setup and margin drift never accumulates. The search
    // paths pass rebase=false and use pure relative motion so a getout can still
    // un-permute dancers back home.
    const f = rebase ? this.rebaseFactor : 0;
    const newDancers = board.dancers.map((d, i) => {
      const t = variant.dancers[mapping[i]];
      const start = poseFor(t, 0);
      const end = poseFor(t, dancerBeats(t));
      const localDisp = rot(-start.heading, { x: end.x - start.x, y: end.y - start.y });
      const delta = normAngle(end.heading - start.heading);
      // Blend the dancer's base toward the call's canonical start (f=1 full
      // reset, f=0 keep the board exactly where it was) so margin-based drift
      // doesn't accumulate, then apply the canonical motion.
      const bx = d.x + (start.x - d.x) * f;
      const by = d.y + (start.y - d.y) * f;
      const bh = normAngle(d.heading + (start.heading - d.heading) * f);
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
    const names: string[] = [];
    for (const name of this.variants.keys()) {
      const res = this.applySearch(board, name);
      if (res.legal && this.knownFormation(res.board) !== null) names.push(name);
    }
    // User-defined modules: legal iff every contained call is legal in sequence
    // and the whole module ends in a known formation.
    for (const mname of this.modules.keys()) {
      const res = this.applySearch(board, mname);
      if (res.legal && this.knownFormation(res.board) !== null) names.push(mname);
    }
    return names;
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
   * Bounded BFS search for a sequence of legal calls that ends in the target
   * formation (default: a squared set). Returns the call path or null.
   *
   * For the default home target the search also requires the final board to
   * restore the START FASR (dancers back with their partners, in sequence) —
   * not merely land on a geometrically-congruent square with the identities
   * permuted.
   */
  getout(opts: { target?: string; maxCalls?: number } = {}): string[] | null {
    const target = opts.target ?? 'Static Square';
    const maxCalls = opts.maxCalls ?? 5;
    const queue: { board: Board; path: string[] }[] = [{ board: cloneBoard(this.board), path: [] }];
    const seen = new Set<string>([boardSig(this.board)]);
    while (queue.length) {
      const { board, path } = queue.shift()!;
      if (path.length > 0 && this.reachesTarget(board, target)) return path;
      if (path.length >= maxCalls) continue;
      for (const name of this.legalCalls(board)) {
        const res = this.applySearch(board, name);
        if (!res.legal) continue;
        const sig = boardSig(res.board);
        if (seen.has(sig)) continue;
        seen.add(sig);
        queue.push({ board: res.board, path: [...path, name] });
      }
    }
    return null;
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
  // `depth` calls?
  private canGetoutFrom(board: Board, target: string, depth: number): boolean {
    if (this.reachesTarget(board, target)) return true;
    if (depth <= 0) return false;
    for (const name of this.legalCalls(board)) {
      const res = this.applySearch(board, name);
      if (res.legal && this.canGetoutFrom(res.board, target, depth - 1)) return true;
    }
    return false;
  }

  /**
   * "Fix it" helper: the legal calls from the current board that keep a getout
   * alive (i.e. after playing one of them, a home-returning sequence still
   * exists within `depth` calls). Useful to steer a choreography home.
   */
  fixIt(opts: { target?: string; depth?: number } = {}): string[] {
    const target = opts.target ?? 'Static Square';
    const depth = opts.depth ?? 3;
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

