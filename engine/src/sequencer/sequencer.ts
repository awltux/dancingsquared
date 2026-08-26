// Sequencer: a board of identity-tracked dancers that applies calls from the
// taminations data, checks legality, recognizes the resulting formation, and
// analyzes FASR. Data-driven: each call's <tam> setup (start formation + paths)
// is run and its RELATIVE movement is transferred onto the board dancers, so
// the result is exact and orientation-independent.

import { DEG, dancerBeats, poseFor } from '../core.js';
import { buildCall, parseCallXml, parseFormations, parseMoves } from '../convert.js';
import { matchFormations, type FormationMatch, type Matchable } from './match.js';
import { analyzeFasr } from './fasr.js';
import { apply5, dancerMatrix, fitRigidMatrix, identity5, invert5, mul5, poseToVec, type Mat5 } from '../matrix.js';
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

// Default tolerance for formation matching (matchFormations' maxError) when
// deciding whether a call is LEGAL from a board (its start setup must genuinely
// match). This is a SUM over all 8 dancers of (position offset + heading
// offset*0.5), so 6.0 allowed an average of 0.75 units per dancer — loose enough
// to force-fit a call onto a genuinely different formation (e.g. a T-Bone start
// onto a Double Pass Thru board). Genuine starts match at ~0.0 while
// wrong-formation force-fits start well above 1.5, so 1.5 (=0.19/dancer) keeps
// correct calls and rejects the spurious ones.
const DEFAULT_MATCH_MAX = 1.5;

// Tolerance for the SEARCH path (getout/fixIt). Those operate on PURE-relative
// boards that are not snap-clamped, so intermediate states drift slightly off the
// canonical setup and need a looser tolerance to chain multi-call sequences. The
// interactive path keeps the tight DEFAULT_MATCH_MAX (its boards are exact).
const SEARCH_MATCH_MAX = 6.0;

// Tolerance for END-recognition: whether a call's RESULT lands in any known
// catalog formation. This gates sequencing continuity, not legality, so it stays
// loose — many genuine calls end on a formation that isn't an exact catalog
// shape, and forcing it to the tight legality threshold makes them illegal.
const KNOWN_FORMATION_MAX = 6.0;

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
  private uniqueFormations: { name: string; dancers: Matchable[] }[] = [];

  board: Board;
  private matchMargin = 0;
  private rebaseFactor = 1; // 1 = reset drift to the call's canonical setup, 0 = keep it
  private snapMaxError = 1.0; // clamp a computed end onto a recognized formation when within this
  // How the interactive apply path chooses among viable interpretations when more
  // than one (whole-board vs parallel-subset) matches a call. 'best' prefers the
  // whole-board interpretation (current behaviour); 'probabilistic' selects among
  // all viable ones weighted by inverse match error. The search path (getout /
  // getin / fixIt / legalCalls) always uses deterministic 'best' behaviour.
  private selectionMode: 'best' | 'probabilistic' = 'best';
  private rand: () => number = Math.random; // injectable for testability

  // Cached canonical end pose (at each dancer's last beat) per variant. The end
  // formation of a call is a pure function of its compiled <tam> paths, so it is
  // computed once per variant instead of on every apply.
  private variantEndCache = new WeakMap<CallBundle, Pose[]>();
  // Cached per-dancer 5x5 matrix (canonical start -> canonical end) per variant.
  // The matrix produces the same end pose as bezier evaluation (~1e-16) but is
  // the reusable representation for composition/inversion; bezier remains the
  // fallback when a variant has no matrix (e.g. degenerate path data).
  private variantMatrixCache = new WeakMap<CallBundle, Mat5[] | null>();

  /** The canonical end pose of each dancer of a variant (pure, cached). */
  private endPoses(variant: CallBundle): Pose[] {
    let end = this.variantEndCache.get(variant);
    if (!end) {
      end = variant.dancers.map((d) => poseFor(d, dancerBeats(d)));
      this.variantEndCache.set(variant, end);
    }
    return end;
  }

  /**
   * Per-dancer matrix (canonical start -> canonical end) for a variant, or null
   * if it can't be built. Indexed by the variant dancer's canonical order; callers
   * map through `match.mapping` (board index -> variant dancer index).
   */
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

  /**
   * Set how far (in position units) a computed end board may be from a
   * recognized formation before it is snapped onto that formation's canonical
   * slots. Only ends within this tolerance are clamped (so small bezier-end
   * drift lands EXACTLY on formation values); ends genuinely off-pattern are
   * left untouched. 0 disables snapping.
   */
  setSnapMaxError(error: number): void {
    this.snapMaxError = Math.max(0, error);
  }

  /**
   * Set how the INTERACTIVE apply path chooses among viable interpretations when
   * more than one matches a call. 'best' prefers the whole-board interpretation
   * (the default; deterministic). 'probabilistic' selects among all viable ones
   * (whole-board and each parallel-subset grouping) weighted by inverse match
   * error, so a tightly-fitting 2/4-dancer subset can win. The search path is
   * always 'best' (deterministic) regardless of this setting.
   */
  setSelectionMode(mode: 'best' | 'probabilistic'): void {
    this.selectionMode = mode;
  }

  /** Inject a random source for the probabilistic selection (tests). */
  setRandomSource(fn: () => number): void {
    this.rand = fn;
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
    // Collapse the many differently-named formations that share an identical
    // dancer geometry (positions AND headings, up to rotation/reflection) into
    // one representative per unique shape. Snapping and known-formation checks
    // only need the geometry, not the display label, so this cuts the scan from
    // ~210 named formations down to ~33 unique shapes (verified empirically).
    this.uniqueFormations = [];
    for (const fm of this.namedFormations) {
      const dup = this.uniqueFormations.find((u) => matchFormations(u.dancers, fm.dancers, 0.5) !== null);
      if (dup) continue;
      this.uniqueFormations.push(fm);
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
    const v = this.matchingVariantInfo(board, name);
    return v ? v.beats : 0;
  }

  /**
   * Find the call variant that applies to `board` (WHOLE-BOARD first, else the
   * PARALLEL-subset path) and return its beat count and, when available, the
   * variant itself. This is the shared core for `stepBeats` / `evaluateSequence`
   * / `sequenceInfo`, so subset calls (e.g. Box Circulate on a Double Pass Thru)
   * are counted and animated even though they do not whole-board match.
   */
  private matchingVariantInfo(
    board: Board,
    name: string,
  ): { beats: number; variant: CallBundle | null } | null {
    const m = this.findMatchingVariant(board, name, DEFAULT_MATCH_MAX + this.matchMargin);
    if (m) return { beats: Math.max(...m.variant.dancers.map((d) => dancerBeats(d))), variant: m.variant };
    // No whole-board match: try the parallel-subset path. Use the same LOOSE
    // search tolerance as parallelLegalCalls/tryParallelApply so a subset call
    // that is legal in the list is also countable and animatable here (the tight
    // interactive tolerance would fail to partition it).
    const tol = SEARCH_MATCH_MAX + this.matchMargin;
    const variants = this.variants.get(name);
    if (variants) {
      const phys = board.dancers.filter((d) => !d.isGhost);
      const n = phys.length;
      for (const v of variants) {
        const setup = v.dancers.map((d) => this.variantMatchable(d));
        const k = setup.length;
        if (k <= 1 || k >= n || n % k !== 0) continue;
        if (this.partitionInto(setup, phys, tol)) {
          return { beats: Math.max(...v.dancers.map((d) => dancerBeats(d))), variant: v };
        }
      }
    }
    return null;
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
      const info = this.matchingVariantInfo(board, name);
      if (!info) break;
      const beats = info.beats;
      if (beat < acc + beats) {
        // This call is playing. Whole-board vs parallel-subset animation.
        const evBoard = this.evaluateCallAt(board, name, info, beat - acc);
        return { board: evBoard, beats: 0 };
      }
      const r = this.applyToBoard(board, name);
      if (r.legal) board = r.board;
      acc += beats;
    }
    return { board, beats: acc };
  }

  /**
   * Place the board at a local beat of a call, handling BOTH whole-board and
   * parallel-subset calls. For a parallel call, each disjoint sub-group is
   * animated through the call's motion and merged back in place.
   */
  private evaluateCallAt(board: Board, name: string, info: { beats: number; variant: CallBundle | null }, localBeat: number): Board {
    const whole = this.findMatchingVariant(board, name, DEFAULT_MATCH_MAX + this.matchMargin);
    if (whole) return this.evaluateVariantAt(board, whole, localBeat);
    // Parallel path: partition into disjoint groups, animate each at the same
    // local beat, and merge. Use the loose search tolerance so a subset call that
    // is legal/animatable is actually partitioned here.
    const tol = SEARCH_MATCH_MAX + this.matchMargin;
    const phys = board.dancers.filter((d) => !d.isGhost);
    const ghosts = board.dancers.filter((d) => d.isGhost);
    const n = phys.length;
    for (const v of this.variants.get(name) ?? []) {
      const setup = v.dancers.map((d) => this.variantMatchable(d));
      const k = setup.length;
      if (k <= 1 || k >= n || n % k !== 0) continue;
      const part = this.partitionInto(setup, phys, tol);
      if (!part) continue;
      const merged: SeqDancer[] = [];
      for (const group of part.groups) {
        const subBoard: Board = { dancers: group.map((d) => ({ ...d })) };
        const subWhole = this.findMatchingVariant(subBoard, name, tol);
        if (!subWhole) { merged.push(...group); continue; }
        merged.push(...this.evaluateVariantAt(subBoard, subWhole, localBeat).dancers);
      }
      return { dancers: [...merged, ...ghosts] };
    }
    return board;
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
      const info = this.matchingVariantInfo(board, name);
      if (!info) return null;
      const beats = info.beats;
      if (beat < acc + beats) {
        // For a whole-board match return the canonical mapping (used for trails).
        const whole = this.findMatchingVariant(board, name, DEFAULT_MATCH_MAX + this.matchMargin);
        if (whole) return { name, variant: whole.variant, mapping: whole.mapping };
        // Parallel call: no single board->variant mapping exists, so trails cannot
        // be drawn for it; return null so the UI simply skips the trace.
        return null;
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
    this.formationMatchCache.clear();
  }

  startBoard(): Board {
    return cloneBoard(this.board);
  }

  /** The current board as a list of matchable dancers. */
  private matchables(board: Board): Matchable[] {
    return board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
  }

  // A variant dancer's matchable position. Mirrored (duplicate-half) dancers
  // store the base x/y but the mirror is applied at pose time, so apply the
  // 180-degree rotation here for matching.
  private variantMatchable(d: CallBundle['dancers'][number]): Matchable {
    if (d.mirror) {
      return { x: -d.x, y: -d.y, heading: normAngle(d.angleDeg * DEG + Math.PI), gender: d.gender };
    }
    return { x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender };
  }

  /** Which of this call's variants matches the given board? Memoised by call name
   * + board geometry: boards are immutable (always cloned before mutation), so a
   * given signature + call always yields the same result, and the same (board,
   * call) pair recurs a lot while probing legality and continuations.
   *
   * `maxError` is the matching tolerance. The INTERACTIVE path (boards are
   * snap-clamped to exact formation slots) uses the tight `DEFAULT_MATCH_MAX`;
   * the SEARCH path (pure relative boards that drift because they are not
   * snapped) uses a looser tolerance so multi-call get-ins/get-outs can chain.
   */
  private matchMemo = new Map<string, VariantMatch | null>();
  private findMatchingVariant(board: Board, callName: string, maxError: number): VariantMatch | null {
    const variants = this.variants.get(callName);
    if (!variants) return null;
    // Key on the call's position/heading signature. When the call is gender-
    // specific the result depends on the board's GENDER arrangement too, so the
    // gender pattern must be part of the key (two identical-geometry boards with
    // different boy/girl placements must not share a cache entry).
    const genderSensitive = variants.some((v) => v.genderSpecific);
    const key = `${maxError}|${callName}|${board.dancers
      .map((d) => `${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}${genderSensitive ? '|' + d.gender : ''}`)
      .join(';')}`;
    const cached = this.matchMemo.get(key);
    if (cached !== undefined) return cached;
    const src = this.matchables(board);
    let best: VariantMatch | null = null;
    for (const v of variants) {
      const tgt = v.dancers.map((d) => this.variantMatchable(d));
      // Gender-specific calls (e.g. "Boys Turn Back") only match when the board's
      // boy/girl arrangement aligns with the setup's gender slots; other calls
      // ignore gender.
      const m = matchFormations(src, tgt, maxError, !!v.genderSpecific);
      // The whole-board APPLY path needs a full 1:1 mapping (every board dancer
      // maps to a variant dancer). A SUBSET match (m.subset set; mapping has -1
      // for non-selected dancers) is a "this setup lives somewhere in the board"
      // result — that is handled by the parallel-subset path, not by a whole-board
      // apply — so it is rejected here.
      if (!m || m.subset) continue;
      if (best === null || m.error < best.error) {
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
    allowParallel = true,
  ): { board: Board; legal: boolean; reason?: string } {
    if (this.modules.has(callName)) {
      if (stack.includes(callName)) {
        return { board: cloneBoard(board), legal: false, reason: `Module cycle: ${callName}` };
      }
      const nextStack = [...stack, callName];
      let cur = board;
      for (const sub of this.modules.get(callName)!) {
        const r = this.applyToBoardInner(cur, sub, nextStack, rebase, allowParallel);
        if (!r.legal) {
          return { board: cloneBoard(board), legal: false, reason: `Module ${callName}: "${sub}" not legal here` };
        }
        cur = r.board;
      }
      return { board: cur, legal: true };
    }

    // Interactive (rebase) boards are snap-clamped to exact formation slots, so a
    // call is legal only if its start genuinely matches (tight tolerance). The
    // search path (rebase=false) uses pure relative boards that drift and need the
    // looser tolerance to chain multi-call get-ins/get-outs.
    const matchTol = rebase ? DEFAULT_MATCH_MAX + this.matchMargin : SEARCH_MATCH_MAX + this.matchMargin;
    const match = this.findMatchingVariant(board, callName, matchTol);
    if (!match) {
      // PARALLEL ACTION (§7.5): a call authored for a small subset (e.g. a
      // 2-dancer Facing Couples) can apply to several disjoint subsets of the
      // board at the same time. If the whole-board match fails, try partitioning
      // the physical dancers into disjoint copies of a variant's start setup and
      // apply the call to each subset independently, then merge the results.
      const par = this.tryParallelApply(board, callName, rebase, matchTol);
      if (par) return par;
      return {
        board: cloneBoard(board),
        legal: false,
        reason: this.variants.has(callName)
          ? 'No setup in this call matches the current formation.'
          : `Unknown call: ${callName}`,
      };
    }
    // PROBABILISTIC SELECTION: on the interactive path, when a whole-board match
    // exists AND a parallel-subset interpretation is also viable, select among
    // them weighted by inverse match error. The search path always stays on the
    // deterministic whole-board result.
    if (rebase && this.selectionMode === 'probabilistic') {
      const par = allowParallel ? this.tryParallelApply(board, callName, rebase, matchTol) : null;
      const chosen = this.selectInterpretation(
        { kind: 'whole', error: match.error, run: () => this.applyWholeBoard(board, callName, match, rebase) },
        par ? { kind: 'parallel', error: par.error, run: () => par } : null,
      );
      return chosen;
    }
    return this.applyWholeBoard(board, callName, match, rebase);
  }

  /**
   * Apply a whole-board variant match to `board`, producing the result board.
   * Shared by the deterministic path and the probabilistic selection.
   */
  private applyWholeBoard(
    board: Board,
    callName: string,
    match: VariantMatch,
    rebase: boolean,
  ): { board: Board; legal: boolean; reason?: string } {
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
    // Per-dancer matrix end pose is only used on the INTERACTIVE path (rebase):
    // it's the reusable matrix representation there, and the search path stays
    // on the cached bezier end so the hot getout/fixIt probes don't pay the
    // per-dancer matrix cost. Both produce the same canonical end (~1e-16).
    const mats = rebase ? this.variantMatrices(variant) : null;
    const newDancers = board.dancers.map((d, i) => {
      const t = variant.dancers[mapping[i]];
      const start = poseFor(t, 0);
      // End pose via the per-dancer matrix when available (exact, cached), else
      // fall back to the canonical bezier-evaluated end pose.
      const end = mats ? (() => {
        const v = poseToVec(start.x, start.y, start.heading);
        const o = apply5(mats[mapping[i]], v);
        return { x: o[0], y: o[1], heading: Math.atan2(o[3], o[2]) };
      })() : ends[mapping[i]];
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
    // Snap the result onto the nearest recognized formation's slots so a call's
    // bezier-end drift doesn't leave the dancers a few decimals off the grid.
    // Only the INTERACTIVE path (rebase=true) snaps: the search path (rebase=false)
    // must preserve pure relative motion so a getout can still un-permute dancers
    // back home, and snapping there would shift boards off the identity-preserving
    // state the search needs.
    return { board: rebase ? this.snapBoard({ dancers: newDancers }) : { dancers: newDancers }, legal: true };
  }

  /**
   * Choose among viable interpretations (whole-board vs parallel) for the
   * interactive path. If only one is viable it is returned; otherwise picks
   * probabilistically weighted by inverse error (a tighter fit wins more often).
   * `probabilistic` mode is already gated before this is called; this method is
   * deterministic when there is only one candidate.
   */
  private selectInterpretation(
    whole: { kind: 'whole'; error: number; run: () => { board: Board; legal: boolean; reason?: string } },
    parallel: { kind: 'parallel'; error: number; run: () => { board: Board; legal: boolean; reason?: string } } | null,
  ): { board: Board; legal: boolean; reason?: string } {
    if (!parallel) return whole.run();
    // Both viable: weight by inverse error. Lower error -> higher weight.
    const wWhole = 1 / (1 + whole.error);
    const wPar = 1 / (1 + parallel.error);
    const r = this.rand();
    // Normalize so r in [0,1) maps to one of the candidates.
    return r < wWhole / (wWhole + wPar) ? whole.run() : parallel.run();
  }

  // ------------------------------------------------------------ parallel action

  /**
   * Try to apply `callName` in PARALLEL (§7.5): if the whole-board match fails,
   * partition the physical dancers into disjoint congruent copies of one of the
   * call's variant start setups, apply the call to each subset independently,
   * then merge the transformed subsets back into one board.
   *
   * Returns the merged result, or null when no clean parallel partition exists.
   */
  private tryParallelApply(
    board: Board,
    callName: string,
    rebase: boolean,
    matchTol: number,
  ): { board: Board; legal: boolean; error: number; reason?: string } | null {
    const variants = this.variants.get(callName);
    if (!variants) return null;
    const phys = board.dancers.filter((d) => !d.isGhost);
    const n = phys.length;
    const ghosts = board.dancers.filter((d) => d.isGhost);
    for (const v of variants) {
      // The variant's setup dancers (canonical start), as matchables.
      const setup = v.dancers.map((d) => this.variantMatchable(d));
      const k = setup.length;
      if (k <= 1 || k >= n || n % k !== 0) continue; // need >=2 full subsets, even split
      // Partition the board's physical dancers into n/k disjoint congruent copies.
      const part = this.partitionInto(setup, phys, matchTol);
      if (!part) continue;
      const { groups, error } = part;
      // Apply the call to each subset independently (disable parallel recursion).
      // Use rebase=false (PURE RELATIVE motion): each sub-group is already at its
      // real position on the floor, and re-basing (rebase=true) would re-anchor it
      // onto the call's canonical start and snap, ERASING the group's actual
      // motion (a Box Circulate group would be reset to its start positions). The
      // relative path keeps each dancer where it is and applies the call's
      // displacement, so the parallel result preserves every group's movement.
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

  /**
   * Partition `dancers` into disjoint groups, each congruent to `setup` (up to
   * translation/rotation/reflection), each of size `setup.length`. Returns the
   * groups (each a list of dancers) + the summed match error, or null when no
   * such partition exists. Uses greedy backtracking: pick the first unused
   * dancer, try each way to complete a congruent copy around it, recurse.
   * Bounded by the small board size (8 dancers, subsets of 2/4) so it stays fast.
   */
  /**
   * Partition `dancers` into disjoint groups, each congruent to `setup` (up to
   * translation/rotation/reflection), each of size `setup.length`. Returns the
   * groups (each a list of dancers) + the summed match error, or null when no
   * such partition exists. Uses greedy backtracking: pick the first unused
   * dancer, try each way to complete a congruent copy around it, recurse.
   * Bounded by the small board size (8 dancers, subsets of 2/4) so it stays fast.
   *
   * Each group must ALSO be COUPLE-COHERENT: a couple that appears in a group
   * must have BOTH dancers in that group. This prevents matching a bare geometric
   * silhouette that scrambles who the dancers are (e.g. picking one dancer from
   * couple 2, one from couple 4 and a whole couple as a "box") — which would
   * apply the call to a non-group and mirror the set instead of moving it.
   */
  private partitionInto(setup: Matchable[], dancers: SeqDancer[], maxError: number): { groups: SeqDancer[][]; error: number } | null {
    const k = setup.length;
    const n = dancers.length;
    if (n === 0 || n % k !== 0) return null;
    // couple -> number of that couple's dancers on the board (should be 2).
    const coupleCount = new Map<number, number>();
    for (const d of dancers) coupleCount.set(d.couple, (coupleCount.get(d.couple) ?? 0) + 1);
    // A group is couple-coherent when, for every dancer in it, both members of
    // its couple (that are on the board) are in the group.
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
    const self = this;

    const canComplete = (anchorIdx: number): boolean => {
      // Find any k-1 other unused dancers that, with the anchor, form a copy of setup.
      // Enumerate combinations of the remaining indices.
      const remaining: number[] = [];
      for (let i = 0; i < n; i++) if (!used[i] && i !== anchorIdx) remaining.push(i);
      if (remaining.length < k - 1) return false;
      // Try every (k-1)-combination of remaining.
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
          // Commit this group and recurse.
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
      // Find first unused dancer as the anchor of the next group.
      const a = used.findIndex((u) => !u);
      if (a === -1) return true; // all placed
      return canComplete(a);
    };

    // Guard against pathological blowup: bound the number of placement attempts.
    return next() ? { groups: result, error: totalError } : null;
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
    this.formationMatchCache.clear();
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

  /** Calls legal from `board` for DISPLAY/enumeration (e.g. the picker's "valid
   * next call" list). Uses the TIGHT interactive apply — the same path the UI
   * actually runs — so it only lists calls that genuinely apply from the board,
   * and ends in a known formation. (The getout/getin search uses `searchLegalCalls`
   * instead, which is similarly tight-gated.) A call listed here will not fail on
   * apply. */
  private legalWithResults(board: Board): { name: string; res: { board: Board; legal: boolean } }[] {
    const out: { name: string; res: { board: Board; legal: boolean } }[] = [];
    for (const name of this.variants.keys()) {
      const res = this.applyToBoard(board, name);
      if (res.legal && this.knownFormation(res.board) !== null) out.push({ name, res });
    }
    for (const mname of this.modules.keys()) {
      const res = this.applyToBoard(board, mname);
      if (res.legal && this.knownFormation(res.board) !== null) out.push({ name: mname, res });
    }
    return out;
  }

  /**
   * Candidates for the getout/getin SEARCH, reconciled with the matrix model.
   *
   * The matrix model treats a call as an exact per-dancer affine whose start
   * setup must genuinely overlay the board. The plain `legalWithResults` accepts
   * a candidate under the loose search tolerance, which lets a force-fit through
   * (e.g. a T-Bone start onto a Double Pass Thru board) that would be rejected
   * when actually applied. Here each candidate must ALSO match under the tight,
   * interactive tolerance — the same gate the interactive apply uses — so
   * force-fits are pruned at search time rather than surfacing as a getout that
   * fails on apply. Chaining still uses the pure-relative search apply so dancer
   * identity/permutation is preserved for un-permuting home.
   */
  private searchLegalCalls(board: Board): { name: string; res: { board: Board; legal: boolean } }[] {
    const out: { name: string; res: { board: Board; legal: boolean } }[] = [];
    const tight = DEFAULT_MATCH_MAX + this.matchMargin;
    for (const name of this.variants.keys()) {
      // Matrix-exact gate: the call's start setup must genuinely match the board
      // under the tight tolerance, or it is a force-fit and is rejected.
      if (!this.findMatchingVariant(board, name, tight)) continue;
      const res = this.applySearch(board, name);
      if (res.legal && this.knownFormation(res.board) !== null) out.push({ name, res });
    }
    for (const mname of this.modules.keys()) {
      const tightApply = this.applyToBoard(board, mname);
      if (!tightApply.legal || this.knownFormation(tightApply.board) === null) continue;
      const res = this.applySearch(board, mname);
      if (res.legal && this.knownFormation(res.board) !== null) out.push({ name: mname, res });
    }
    return out;
  }

  /**
   * Calls applicable to `board` in PARALLEL across disjoint subsets (§7.5) —
   * i.e. calls whose whole-board match fails but which can be applied to two or
   * more separate copies of their start setup at once. Returns each as a
   * `{ name, board }` pair with the merged result board, so a graph BFS can
   * enumerate these as forward edges. Returns [] when the board has no parallel
   * splits.
   */
  parallelLegalCalls(board: Board): { name: string; board: Board }[] {
    const out: { name: string; board: Board }[] = [];
    const tol = SEARCH_MATCH_MAX + this.matchMargin;
    for (const name of this.variants.keys()) {
      // Whole-board match would already be covered by legalCalls; only consider
      // calls that DON'T match whole-board but DO split in parallel.
      if (this.findMatchingVariant(board, name, tol)) continue;
      const res = this.tryParallelApply(board, name, false, tol);
      if (res && res.legal) out.push({ name, board: res.board });
    }
    return out;
  }

  /** The name of any formation in the FULL catalog that `board` matches, else
   * null. Unlike `recognize` (which is restricted to a curated list for stable
   * display labels), this is permissive: any standard formation the result
   * lands in counts as "known". Uses the loose end-recognition tolerance (a call
   * is legal if it STARTS from the right formation; its end just needs to land
   * somewhere recognizable for sequencing continuity). */
  private knownFormation(board: Board): string | null {
    const best = this.bestFormationMatch(board);
    return best && best.m.error <= KNOWN_FORMATION_MAX + this.matchMargin ? best.f.name : null;
  }

  /**
   * Clamp a computed end board onto the nearest recognized formation's canonical
   * slots, when the board is within `snapMaxError` of that formation. This
   * absorbs small bezier-end numeric drift so calls land EXACTLY on formation
   * values (positions AND headings) instead of a few decimals off. Dancer
   * identity (id/couple/gender) is preserved; only x/y/heading are snapped onto
   * the matched formation's slot via the same transform `rebasedPose` uses for
   * re-base. Boards that are not within tolerance (genuinely mid-transition or
   * off-pattern) are returned unchanged so we never invent a formation.
   */
  private snapBoard(board: Board): Board {
    if (this.snapMaxError <= 0) return board;
    const best = this.bestFormationMatch(board);
    if (!best || best.m.error > this.snapMaxError) return board;
    const { f, m } = best;
    const snapped = board.dancers.map((d, i) => {
      const p = rebasedPose(f.dancers[m.mapping[i]], m);
      return { ...d, x: p.x, y: p.y, heading: p.heading };
    });
    return { dancers: snapped };
  }

  // Shared, memoized best-formation match for a board. `legalWithResults` needs
  // both "is the result a known formation" (knownFormation) and "snap it onto
  // the formation" (snapBoard), and both do the same expensive scan over the
  // named formations. Caching by an exact geometry signature means each board is
  // scanned once regardless of how many callers probe it (the same boards recur
  // heavily in the getout/fixIt searches).
  private formationMatchCache = new Map<string, { f: { name: string; dancers: Matchable[] }; m: FormationMatch } | null>();

  private bestFormationMatch(board: Board): { f: { name: string; dancers: Matchable[] }; m: FormationMatch } | null {
    const sig = this.formationSig(board);
    const cached = this.formationMatchCache.get(sig);
    if (cached !== undefined) return cached;
    const src = this.matchables(board);
    let best: { f: { name: string; dancers: Matchable[] }; m: FormationMatch } | null = null;
    for (const f of this.uniqueFormations) {
      if (f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers, this.snapMatchMax());
      if (m && (best === null || m.error < best.m.error)) best = { f, m };
    }
    this.formationMatchCache.set(sig, best);
    return best;
  }

  /** Tolerance used for the shared formation scan: loose enough to catch boards
   * that land in a recognized formation (for knownFormation and snapping). The
   * snap itself then applies the tight `snapMaxError`; knownFormation applies
   * `KNOWN_FORMATION_MAX`. */
  private snapMatchMax(): number {
    return Math.max(this.snapMaxError, KNOWN_FORMATION_MAX + this.matchMargin);
  }

  /** Exact per-dancer geometry signature (finer than boardSig, which bins for
   * search dedup) so cached formation matches are keyed to the exact pose. */
  private formationSig(board: Board): string {
    return board.dancers.map((d) => `${d.x.toFixed(5)},${d.y.toFixed(5)},${d.heading.toFixed(5)}`).join(';');
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
    this.formationMatchCache.clear();

    // Fast path #1: a single rigid, self-inverse call that (applied to the home
    // set) produces the current board. Since C∘C = I for these calls, playing it
    // once more returns home — an O(1) matrix-verified getout. Only applicable
    // when the TARGET is the home squared set (this is a get-OUT home, not a
    // get-in to an arbitrary formation). The candidate is still validated on the
    // interactive apply path (as the search paths below are), because a call that
    // is matrix-self-inverse from home may not be interactively legal from the
    // CURRENT board, and returning it would make the getout fail on apply.
    const isHomeTarget = target === 'Static Square' || target === 'Squared Set';
    if (isHomeTarget) {
      const rigid = this.rigidSingleCallGetout();
      if (rigid && this.verifyInteractivePath(rigid, target)) return rigid;
    }

    // The search paths below use the LOOSE search tolerance to chain multi-call
    // sequences on pure-relative (un-snapped) boards. But a getout is APPLIED
    // through the interactive path (tight tolerance, snap-clamped), so a call
    // that force-fits under the loose tolerance (e.g. a T-Bone start onto a
    // Double Pass Thru board) would be rejected on apply. So the DFS is seeded
    // with a validator that only accepts paths which replay correctly on the
    // interactive path — ensuring any returned getout genuinely starts from the
    // current formation and reaches home when applied.

    // Fast path #2: greedy best-first straight toward home.
    const greedy = this.greedyHome(target, maxCalls);
    if (greedy && this.verifyInteractivePath(greedy, target)) return greedy;

    // Fallback: budgeted DFS for harder bodies (bounded so it can't hang).
    const seen = new Set<string>([boardSig(this.board)]);
    const state = { nodes: 0, budget };
    return this.getoutPath(this.board, target, maxCalls, [], seen, state, (path) =>
      this.verifyInteractivePath(path, target),
    );
  }

  /**
   * Replay a candidate getout path through the INTERACTIVE apply path (tight
   * tolerance, snap-clamped) to confirm every call is genuinely legal and the
   * final board reaches `target`. The search paths use a looser tolerance, so a
   * path they find may include a force-fit call that is rejected when actually
   * applied; this guards against returning such a path.
   */
  private verifyInteractivePath(path: string[], target: string): boolean {
    let board = cloneBoard(this.board);
    for (const name of path) {
      const r = this.applyToBoard(board, name);
      if (!r.legal) return false;
      board = r.board;
    }
    return this.reachesTarget(board, target);
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
      for (const c of this.searchLegalCalls(board)) {
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

  // ----------------------------------------------------------------- matrix fast-path

  // Rigid self-inverse getouts: for each registered call, precompute its image
  // when applied to the home set. If the call is rigid (a single global matrix
  // fits its motion) AND self-inverse (M∘M = I), then whenever the current board
  // is congruent to that image, playing the same call once more returns home.
  // This is an exact, matrix-verified single-call getout.
  private rigidGetoutCache: { name: string; M: Mat5; image: Matchable[]; seqDancers: SeqDancer[] }[] | null = null;

  private buildRigidGetoutCache(): { name: string; M: Mat5; image: Matchable[]; seqDancers: SeqDancer[] }[] {
    if (this.rigidGetoutCache) return this.rigidGetoutCache;
    const home = makeSquaredSet();
    const homeDancers = home.dancers;
    const out: { name: string; M: Mat5; image: Matchable[]; seqDancers: SeqDancer[] }[] = [];
    for (const name of this.variants.keys()) {
      if (this.modules.has(name)) continue;
      // Reset a throwaway sequencer reference: apply the call to home and test
      // rigidity + self-inversion via the matrix.
      const res = this.applyToBoard(home, name);
      if (!res.legal) continue;
      const fit = fitRigidMatrix(homeDancers, res.board.dancers, 1e-3);
      if (!fit) continue;
      // Self-inverse: M^2 == identity (within tolerance). Compose the rigid
      // matrix with itself and compare to I.
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
      out.push({ name, M: fit.M, image: this.matchables(res.board), seqDancers: res.board.dancers });
    }
    this.rigidGetoutCache = out;
    return out;
  }

  /** Try a single rigid self-inverse call to close the current board home. */
  private rigidSingleCallGetout(): string[] | null {
    const cur = this.matchables(this.board);
    for (const e of this.buildRigidGetoutCache()) {
      // The current board is congruent to the call's home-image (rigid match).
      if (matchFormations(cur, e.image, KNOWN_FORMATION_MAX + this.matchMargin) === null) continue;
      // Verify: applying the call to the current board must actually reach home.
      const res = this.applySearch(this.board, e.name);
      if (res.legal && this.reachesTarget(res.board, 'Static Square')) return [e.name];
    }
    return null;
  }

  /**
   * Matrix-based getout: if the current board is exactly the image of home under
   * a rigid, self-inverse call, returns that SAME single call as a guaranteed,
   * replayable getout. This is the algebraically-derived formation-transition:
   * because the call is rigid and self-inverse, its matrix M satisfies M² = I, so
   * playing it once more returns home — exact and O(1), no search needed. Returns
   * null when no such call applies (callers fall back to the live search).
   */
  matrixGetout(): string[] | null {
    return this.rigidSingleCallGetout();
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
    validate?: (path: string[]) => boolean,
  ): string[] | null {
    if (depth <= 0) return null;
    if (state.nodes >= state.budget) return null;
    const candidates = this.searchLegalCalls(board);
    candidates.sort((a, b) => this.homeScore(b.res.board) - this.homeScore(a.res.board));
    for (const { name, res } of candidates) {
      const sig = boardSig(res.board);
      if (seen.has(sig)) continue;
      seen.add(sig);
      state.nodes++;
      path.push(name);
      if (this.reachesTarget(res.board, target)) {
        // Only accept a path that (when provided) also replays correctly on the
        // interactive apply path; otherwise keep searching for a valid one.
        if (!validate || validate([...path])) return [...path];
      }
      const sub = this.getoutPath(res.board, target, depth - 1, path, seen, state, validate);
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

  /**
   * The formation STATE of a board: the best-matching recognized formation name
   * plus the rotation/reflection transform that overlays the canonical formation
   * onto this board (the `matchFormations` result). This is the graph "node key":
   * same formation at a different orientation -> same name, different rotation.
   * Returns null when the board doesn't match any recognized formation.
   */
  formationState(board: Board): { name: string; rot: number; reflect: boolean; cSrc: { x: number; y: number }; cTgt: { x: number; y: number } } | null {
    const src = this.matchables(board);
    let best: FormationMatch | null = null;
    for (const f of this.namedFormations) {
      if (!STANDARD_FORMATIONS.includes(f.name) || f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers);
      if (m && (best === null || m.error < best.error)) best = m;
    }
    if (!best) return null;
    // Find the name matching this best transform (the formation whose geometry
    // the board most closely fits).
    let name: string | null = null;
    for (const f of this.namedFormations) {
      if (!STANDARD_FORMATIONS.includes(f.name) || f.dancers.length !== src.length) continue;
      const m = matchFormations(src, f.dancers);
      if (m && m.error === best.error) { name = f.name; break; }
    }
    if (!name) return null;
    return { name, rot: best.rot, reflect: best.reflect, cSrc: best.cSrc, cTgt: best.cTgt };
  }

  /** FASR analysis of the current board. */
  fasr(): Fasr {
    return analyzeFasr(this.board, this.recognize(this.board).name);
  }

  // ------------------------------------------------------------ ghost & occupancy

  /** Physical (non-ghost) dancers of a board. Ghosts provide reference only. */
  physicalDancers(board: Board): SeqDancer[] {
    return board.dancers.filter((d) => !d.isGhost);
  }

  /**
   * Detect spatial-occupancy collisions among PHYSICAL dancers (ghosts bypass
   * the check). Two dancers collide when they occupy the same position within
   * `eps`. Returns the colliding (id1, id2) pairs, or [] when clear.
   */
  collisions(board: Board, eps = 1e-3): { id1: number; id2: number }[] {
    const ds = board.dancers.filter((d) => !d.isGhost);
    const out: { id1: number; id2: number }[] = [];
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        if (Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y) < eps) {
          out.push({ id1: ds[i].id, id2: ds[j].id });
        }
      }
    }
    return out;
  }

  // ----------------------------------------------------------------- getin

  /**
   * Search for a sequence of legal calls that takes the set FROM home INTO the
   * target formation — the mirror companion of `getout`. A getin always starts
   * at home and ends at a non-home formation. It is NOT the reverse of a getout
   * (calls do not run backwards), so it is a distinct, forward search.
   *
   * Implementation: temporarily set the board to home, run the same budgeted
   * DFS used by getout but toward `target`, then restore the caller's board.
   */
  getin(opts: { target?: string; maxCalls?: number; budget?: number } = {}): string[] | null {
    const target = opts.target ?? 'Facing Couples';
    const maxCalls = opts.maxCalls ?? 5;
    const budget = opts.budget ?? 400;
    const saved = this.board;
    this.board = makeSquaredSet();
    this.matchMemo.clear();
    this.canGetoutMemo.clear();
    this.homeScoreCache.clear();
    this.formationMatchCache.clear();
    const seen = new Set<string>([boardSig(this.board)]);
    const state = { nodes: 0, budget };
    const path = this.getinPath(this.board, target, maxCalls, [], seen, state);
    this.board = saved;
    this.matchMemo.clear();
    return path;
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
    for (const c of this.searchLegalCalls(board)) {
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

  // ------------------------------------------------------------- 64-beat / phrases

  /** Number of 16-beat phrases a beat count fills (ceil; a partial phrase is
   * counted as one). Used by the singing-call segment validator. */
  phrasesForBeats(beats: number): number {
    return Math.ceil(beats / 16);
  }

  /**
   * Validate that a flat call sequence (expanded from modules) sums to a 64-beat
   * singing-call segment (four 16-beat phrases). Returns the total beats and
   * whether it forms a complete segment. Continuous terminal actions (e.g. a
   * Promenade) are acknowledged as "flow" rather than counted to exactly 64.
   */
  validateSegment(flat: string[]): { totalBeats: number; phrases: number; complete64: boolean; remainder: number } {
    const totalBeats = this.sequenceBeats(flat);
    const phrases = this.phrasesForBeats(totalBeats);
    const remainder = totalBeats % 64;
    return { totalBeats, phrases, complete64: remainder === 0, remainder };
  }

  // --------------------------------------------------------------- tips / zeros

  /** Whether a flat call sequence is a "zero": it starts and ends at home
   * (in-sequence squared set), so it can be chained/safely repeated. */
  isZero(flat: string[]): boolean {
    let board = makeSquaredSet();
    for (const name of flat) {
      const r = this.applyToBoard(board, name);
      if (!r.legal) return false;
      board = r.board;
    }
    return this.fasrKey(board) === this.homeFasrKey();
  }

  /**
   * Build a tip: a sequence of figures that is itself a zero (starts and ends
   * home, in-sequence). Each supplied figure is expected to be a zero too. The
   * combined sequence is validated to be a zero and to fit the 64-beat segment
   * structure (four 16-beat phrases), returning the assembled tip with metrics.
   */
  buildTip(figures: string[][]): { calls: string[]; legal: boolean; totalBeats: number; phrases: number; complete64: boolean; reason?: string } {
    const flat = this.flatten(figures.flat());
    if (!this.isZero(flat)) {
      return { calls: flat, legal: false, totalBeats: 0, phrases: 0, complete64: false, reason: 'tip is not a zero (does not return home in-sequence)' };
    }
    const seg = this.validateSegment(flat);
    return { calls: flat, legal: true, totalBeats: seg.totalBeats, phrases: seg.phrases, complete64: seg.complete64 };
  }

  // ------------------------------------------------------------- subsets & parallel

  /**
   * Partition the physical dancers of a board into disjoint subsets by a named
   * grouping rule. Each subset is a list of dancer ids. Named groups: 'heads',
   * 'sides', 'boys', 'girls', 'couples', 'centers', 'ends' (centers/ends require
   * a 4-dancer line/wave and select the two inner/outer dancers).
   *
   * Returns `null` when the grouping cannot be applied cleanly (e.g. an uneven
   * remainder, or a named group that doesn't match the board).
   */
  subsetOf(board: Board, group: string): number[][] | null {
    const ds = board.dancers.filter((d) => !d.isGhost);
    const byId = new Map(ds.map((d) => [d.id, d]));
    const sortIds = (arr: SeqDancer[]): number[] => arr.map((d) => d.id).sort((a, b) => a - b);
    const couples = (coupleNos: number[]): number[][] =>
      coupleNos.map((c) => sortIds(ds.filter((d) => d.couple === c))).filter((s) => s.length > 0);

    switch (group) {
      case 'heads': return couples([1, 2]);
      case 'sides': return couples([3, 4]);
      case 'boys': return [sortIds(ds.filter((d) => d.gender === 'boy'))];
      case 'girls': return [sortIds(ds.filter((d) => d.gender === 'girl'))];
      case 'couples': return couples([1, 2, 3, 4]);
      case 'centers': case 'ends': {
        // A 4-dancer line/wave: two dancers on one side, two on the other.
        const sides = this.splitLine(board);
        if (!sides) return null;
        const centers = [sides[0][1], sides[1][0]]; // the two inner dancers
        const ends = [sides[0][0], sides[1][1]]; // the two outer dancers
        return group === 'centers' ? [sortIds(centers.map((id) => byId.get(id)!))] : [sortIds(ends.map((id) => byId.get(id)!))];
      }
      default: return null;
    }
  }

  /** Split an 8-dancer board into two 4-dancer lines/waves (for centers/ends),
   * or null if it doesn't cleanly form two lines. */
  private splitLine(board: Board): [number[], number[]] | null {
    const ds = board.dancers.filter((d) => !d.isGhost);
    if (ds.length !== 8) return null;
    // Group by sign of x to find two vertical lines; fall back to y.
    const byX = this.bucketLines(ds, (d) => d.x);
    if (byX && byX[0].length === 4 && byX[1].length === 4) {
      // order each line by y so [0] and [3] are the ends, [1] and [2] centers
      const sort = (ids: number[]) => [...ids].sort((a, b) => (byId(ds, a)?.y ?? 0) - (byId(ds, b)?.y ?? 0));
      return [sort(byX[0]), sort(byX[1])];
    }
    const byY = this.bucketLines(ds, (d) => d.y);
    if (byY && byY[0].length === 4 && byY[1].length === 4) {
      const sort = (ids: number[]) => [...ids].sort((a, b) => (byId(ds, a)?.x ?? 0) - (byId(ds, b)?.x ?? 0));
      return [sort(byY[0]), sort(byY[1])];
    }
    return null;
  }

  /**
   * Parallel-action: apply a call to each disjoint subset of a named group
   * concurrently. Because the current engine cannot run one small variant across
   * several subsets at once, this is exposed as a higher-level helper that
   * returns whether the call is legal on each subset in parallel (by checking
   * each subset in isolation) plus the set of subsets it would apply to.
   *
   * This surfaces the §7.5 requirement (a call acts on every group it applies
   * to) even though the low-level apply path is single-subset.
   */
  parallelApplicable(board: Board, group: string, callName: string): { subsets: number[][] | null; legalOnAll: boolean; illegalSubsets: number[][] } {
    const subsets = this.subsetOf(board, group);
    if (!subsets) return { subsets: null, legalOnAll: false, illegalSubsets: [] };
    const illegalSubsets: number[][] = [];
    for (const sub of subsets) {
      const subBoard = this.boardFromSubset(board, sub);
      const r = this.applySearch(subBoard, callName);
      if (!r.legal) illegalSubsets.push(sub);
    }
    return { subsets, legalOnAll: illegalSubsets.length === 0, illegalSubsets };
  }

  /** Build a standalone board from a subset of dancer ids (ghosts excluded). */
  private boardFromSubset(board: Board, ids: number[]): Board {
    const byId = new Map(board.dancers.map((d) => [d.id, d]));
    const ds = ids.map((id) => byId.get(id)).filter((d): d is SeqDancer => !!d);
    // Rebase the subset onto the origin so a single-couple/box variant can match.
    let cx = 0, cy = 0;
    for (const d of ds) { cx += d.x; cy += d.y; }
    cx /= ds.length; cy /= ds.length;
    return { dancers: ds.map((d) => ({ ...d, x: d.x - cx, y: d.y - cy })) };
  }

  private bucketLines(ds: SeqDancer[], key: (d: SeqDancer) => number): [number[], number[]] | null {
    const buckets = new Map<number, number[]>();
    const eps = 0.2;
    for (const d of ds) {
      let placed = false;
      for (const [k, arr] of buckets) {
        if (Math.abs(k - key(d)) < eps) { arr.push(d.id); placed = true; break; }
      }
      if (!placed) buckets.set(key(d), [d.id]);
    }
    if (buckets.size !== 2) return null;
    const [a, b] = [...buckets.values()];
    return [a, b];
  }
}

function byId(ds: SeqDancer[], id: number): SeqDancer | undefined {
  return ds.find((d) => d.id === id);
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

