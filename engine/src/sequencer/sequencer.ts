// Sequencer facade: wires the collaborators (CallLibrary, FormationMatcher,
// CallApplicator, LegalityChecker, SequenceAnalyzer, HomeSolver, Grouping) and
// owns the current board + shared config. Each public method delegates to the
// collaborator that owns that responsibility, so the heavy logic lives in small,
// focused classes instead of one god-class.

import { SequencerConfig, emptySearchStats, type SearchStats } from './config.js';
import { CallLibrary } from './library.js';
import { FormationMatcher } from './matcher.js';
import { CallApplicator } from './applicator.js';
import { LegalityChecker } from './legality.js';
import { SequenceAnalyzer } from './sequence.js';
import { HomeSolver } from './solver.js';
import { Grouping } from './grouping.js';
import { splitSelection } from './selection.js';
import { FsmStore, type FsmAmendment } from './fsm-store.js';
import { type FsmExport } from './fsm-export.js';
import { FsmTable, type FsmTableEdge, type FsmTableData, FSM_TABLE_SCHEMA_VERSION } from './fsm-table.js';
import { makeSquaredSet, cloneBoard } from './board.js';
import { HOME_DANCERS } from './identity.js';
import { matchFormations } from './match.js';
import { mul5, dancerMatrix, type Mat5 } from '../matrix.js';
import { applyMoveToBoard, applyFaceInOutToBoard, FaceLeft, FaceRight, FaceHalf } from '../moves.js';
import { CODED_MOVE_NAMES, applyCodedMove, codedMoveApplies, findCodedMove } from './coded-moves.js';
import { analyzeFasr } from './fasr.js';
import { normalisedState, ORIENTATION_STEP } from './fsm.js';
import { STANDARD_FORMATIONS, UNKNOWN_COUPLE, canonicalName } from './constants.js';
import type { Matchable } from './match.js';
import type { Board, CallStep, Fasr, Module, RecognizedFormation, SeqDancer, SeqStep, VariantMatch } from './types.js';
import type { CallBundle } from '../types.js';

export { assignHomeIdentity } from './identity.js';

export class Sequencer {
  board: Board;

  private readonly config = new SequencerConfig();
  private readonly library: CallLibrary;
  private readonly matcher: FormationMatcher;
  private readonly applicator: CallApplicator;
  private readonly legality: LegalityChecker;
  private readonly analyzer: SequenceAnalyzer;
  private readonly solver: HomeSolver;
  private readonly grouping: Grouping;
  private readonly fsmStore: FsmStore;
  private fsmTable: FsmTable | null = null;

  constructor(movesXml: string, formationsXml: string, calls: { name: string; xml: string }[] = []) {
    this.library = new CallLibrary(movesXml, formationsXml);
    this.matcher = new FormationMatcher(this.library, this.config);
    this.applicator = new CallApplicator(this.library, this.matcher, this.config);
    this.grouping = new Grouping(this.applicator);
    this.applicator.setSelectionResolver((board, selection) => this.grouping.resolveSelection(board, selection));
    this.legality = new LegalityChecker(this.library, this.matcher, this.applicator, this.config);
    this.analyzer = new SequenceAnalyzer(this.library, this.matcher, this.applicator, this.config);
    this.solver = new HomeSolver(this.library, this.matcher, this.applicator, this.legality, this.config);
    this.fsmStore = new FsmStore(this.applicator, this.matcher, this.solver);
    this.board = makeSquaredSet();
    for (const c of calls) {
      try {
        this.register(c.name, c.xml);
      } catch {
        // Skip a call whose data fails to build; it just won't be applicable.
      }
    }
    // The body-relative coded calls (pure pivots / re-facings) come from the
    // shared registry, so the analyzer replays and animates them identically.
  }

  /** If `name` is one of the registered geometry-derived calls (the body-relative
   * coded pivots, or a whole-set resolve such as Promenade), return its result:
   * the transformed board when it applies, or the board unchanged plus the reason
   * when it carries a precondition that this board does not meet. Returns null
   * when `name` is not a coded move at all, so the catalogue can handle it. */
  private tryCodedMove(board: Board, name: string): { board: Board; legal: boolean; reason?: string } | null {
    const whole = applyCodedMove(board, name);
    if (whole) return whole;
    // A coded move with a dancer selection, e.g. "Girls U-Turn Back": the selected
    // dancers pivot and everyone else stays put. This has to be handled HERE rather
    // than in the applicator's selection path, because coded moves are per-dancer
    // transforms applied straight from geometry - the applicator matches catalog
    // setups, and the coded table lives in this class. Left to the applicator it
    // fails with "not legal for selected dancers" even though the pivot is trivially
    // well defined for any subset, which is how every "Girls U-Turn Back" line in the
    // published get-out corpus was stopping.
    const sel = splitSelection(name);
    if (!sel.selection) return null;
    const base = findCodedMove(sel.call);
    if (!base) return null;
    const ids = this.grouping.resolveSelection(board, sel.selection);
    if (!ids || ids.length === 0) return null;
    // A move that moves NON-designated dancers as well (a Run's walker, a Trade's intervening
    // dancers) has to compute the whole board itself — the whole-board-transform-then-filter
    // trick below would discard the walker's motion and leave two dancers on one spot.
    if (base.applyToSelection) {
      const r = base.applyToSelection(board, ids);
      return 'reason' in r ? { board, legal: false, reason: r.reason } : { board: r.board, legal: true };
    }
    if (base.precondition) {
      // A whole-set resolve has no half-set reading, so a genuine subset is left to
      // the applicator to refuse - EXCEPT that "All <resolve>" is just the resolve:
      // All8 writes `A-Prom`, and "all" is the whole set already, so the group prefix
      // adds nothing and the call must not fail on account of it.
      const everyone = board.dancers.filter((d) => !d.isGhost).map((d) => d.id);
      return ids.length === everyone.length ? applyCodedMove(board, sel.call) : null;
    }
    const byId = new Map(base.apply(board).dancers.map((d) => [d.id, d]));
    const picked = new Set(ids);
    return {
      legal: true,
      board: {
        dancers: board.dancers.map((d) => (d.isGhost || !picked.has(d.id) ? d : byId.get(d.id) ?? d)),
      },
    };
  }

  // ---- registration & modules ----

  register(name: string, xml: string): void {
    this.library.register(name, xml);
  }

  registerModule(name: string, calls: (string | CallStep)[]): void {
    this.library.registerModule(name, calls);
  }

  listModules(): string[] {
    return this.library.listModules();
  }

  isModule(name: string): boolean {
    return this.library.isModule(name);
  }

  getModules(): Module[] {
    return this.library.getModules();
  }

  flatten(sequence: (string | CallStep)[]): (string | CallStep)[] {
    return this.library.flatten(sequence);
  }

  // ---- tuning (delegates to the shared config) ----

  setMatchMargin(margin: number): void {
    this.config.matchMargin = margin;
  }

  setRebaseFactor(factor: number): void {
    this.config.rebaseFactor = Math.max(0, Math.min(1, factor));
  }

  setSnapMaxError(error: number): void {
    this.config.snapMaxError = Math.max(0, error);
  }

  setSelectionMode(mode: 'best' | 'probabilistic'): void {
    this.config.selectionMode = mode;
  }

  setRandomSource(fn: () => number): void {
    this.config.rand = fn;
  }

  setUseEquivalents(on: boolean): void {
    this.config.useEquivalents = on;
  }

  setUseCollapsedModules(on: boolean): void {
    this.config.useCollapsedModules = on;
  }

  // ---- board state ----

  reset(): void {
    this.board = makeSquaredSet();
    this.matcher.clearCaches();
    this.solver.clearCaches();
  }

  startBoard(): Board {
    return cloneBoard(this.board);
  }

  /** Set the current board explicitly (copied), clearing the match/solver caches
   * like reset()/setFormation(). Used to re-establish a sequence's START board
   * before replaying its history, e.g. after setFormation. */
  setBoard(board: Board): void {
    this.board = cloneBoard(board);
    this.matcher.clearCaches();
    this.solver.clearCaches();
  }

  apply(callName: string): SeqStep {
    const res = this.tryCodedMove(this.board, callName) ?? this.applicator.applyToBoard(this.board, callName);
    this.board = res.board;
    this.matcher.clearCaches();
    this.solver.clearCaches();
    return { call: callName, legal: res.legal, reason: res.reason, board: res.board, formation: this.recognize(res.board) };
  }

  /** Apply a call step (string or {selection, call}) to the current board. */
  applyStep(step: string | CallStep): SeqStep {
    const coded = typeof step === 'string' ? this.tryCodedMove(this.board, step) : null;
    const res = coded ?? this.applicator.applyStep(this.board, step);
    this.board = res.board;
    this.matcher.clearCaches();
    this.solver.clearCaches();
    const label = typeof step === 'string' ? step : step.call;
    return { call: label, legal: res.legal, reason: res.reason, board: res.board, formation: this.recognize(res.board) };
  }

  applyToBoard(board: Board, callName: string | CallStep): { board: Board; legal: boolean; reason?: string } {
    const coded = typeof callName === 'string' ? this.tryCodedMove(board, callName) : null;
    if (coded) return coded;
    return typeof callName === 'string'
      ? this.applicator.applyToBoard(board, callName)
      : this.applicator.applyStep(board, callName);
  }

  /** Canonical start positions (as matchables) of each of a call's variants, in
   * the order they were registered. Read-only introspection for building
   * synthetic boards / debug traces; empty when the call is unknown. */
  variantStarts(name: string): Matchable[][] {
    const variants = this.library.getVariants(name);
    if (!variants) return [];
    return variants.map((v) => v.dancers.map((d) => this.library.variantMatchable(d)));
  }

  // ---- library introspection (passthroughs) ----

  hasCall(name: string): boolean {
    return this.library.hasCall(name);
  }

  getVariants(name: string): CallBundle[] | undefined {
    return this.library.getVariants(name);
  }

  /** The variants the sequencer may match from a board — `getVariants` preferring the
   * `sequencer`-eligible setups, with a documented last-resort fallback to the
   * demonstration animations for a call that has no eligible setup at all. */
  matchableVariants(name: string): CallBundle[] {
    return this.library.matchableVariants(name);
  }

  /** Strictly the `sequencer`-eligible variants. Empty means the catalogue has NO
   * sequencer setup for this call — the call is only animated, not callable, and the
   * engine is currently reaching it through `matchableVariants`' fallback. Use this to
   * report that gap (32 titles today) rather than to match with. */
  sequencerVariants(name: string): CallBundle[] {
    return this.library.sequencerVariants(name);
  }

  /** Whether a call has any sequencer-eligible setup. */
  hasSequencerSetup(name: string): boolean {
    return this.library.hasSequencerSetup(name);
  }

  getUniqueFormations(): { name: string; dancers: Matchable[] }[] {
    return this.library.getUniqueFormations();
  }

  /** Every call variant's start setup (mirror-aware matchables), including the
   * embedded/inline formations not in the named catalog. */
  allVariantSetups(): Matchable[][] {
    return this.library.allVariantSetups();
  }

  // ---- formation selection (debug / board seeding) ----

  /** The named formations selectable as a starting board (deduped by geometry). */
  listFormations(): string[] {
    return this.library.getUniqueFormations().map((f) => f.name).sort((a, b) => a.localeCompare(b));
  }

  /** Build a synthetic board sitting in the named formation `name`, with home
   * identity stamped when the geometry is home-like. Returns null if unknown. */
  boardForFormation(name: string): Board | null {
    return this.syntheticBoard(name);
  }

  /** Set the current board to a synthetic board in `name`. Returns false if the
   * formation is unknown (board left unchanged). */
  setFormation(name: string): boolean {
    const b = this.syntheticBoard(name);
    if (!b) return false;
    this.board = b;
    this.matcher.clearCaches();
    this.solver.clearCaches();
    return true;
  }

  // ---- matcher introspection (passthroughs) ----

  findMatchingVariant(board: Board, callName: string, maxError: number): VariantMatch | null {
    return this.matcher.findMatchingVariant(board, callName, maxError);
  }

  knownFormation(board: Board): string | null {
    return this.matcher.knownFormation(board);
  }

  snapBoard(board: Board): Board {
    return this.matcher.snapBoard(board);
  }

  matchesNamed(board: Board, name: string): boolean {
    return this.matcher.matchesNamed(board, name);
  }

  // ---- legality ----

  legalCalls(board: Board): string[] {
    return this.legality.legalCalls(board);
  }

  legalNext(): string[] {
    const base = this.legality.legalCalls(this.board);
    // A coded move is listed only when it actually applies: the pivots always do,
    // but a whole-set resolve such as Promenade has preconditions.
    const derived = CODED_MOVE_NAMES.filter((n) => {
      if (base.includes(n)) return false;
      const move = findCodedMove(n);
      return !move || codedMoveApplies(move, this.board);
    });
    return base.concat(derived);
  }

  /** The acting-group selector strings that resolve to a proper (non-empty,
   * not-everyone) subset on `board`. */
  subsetGroups(board: Board): string[] {
    const names = [
      'Heads', 'Sides', 'Boys', 'Girls', 'Men', 'Women', 'Ladies', 'Centers',
      'Ends', 'Couples', 'Leaders', 'Trailers', 'Beaus', 'Belles',
      'Couple #1', 'Couple #2', 'Couple #3', 'Couple #4',
    ];
    const n = board.dancers.filter((d) => !d.isGhost).length;
    return names.filter((s) => {
      const ids = this.grouping.resolveSelection(board, s);
      return !!ids && ids.length > 0 && ids.length < n;
    });
  }


  parallelLegalCalls(board: Board): { name: string; board: Board }[] {
    return this.legality.parallelLegalCalls(board);
  }

  // ---- equivalent-call substitution ----

  /** Calls that are choreographically equivalent to `call` from `board`: they are
   * legal from the board AND reach the same end formation. Each equivalent
   * remains a SEPARATE edge (they are not merged) — this is the set a resolver
   * can substitute to widen a getout/getin search. */
  equivalentCalls(board: Board, call: string): string[] {
    const baseRes = this.applicator.applyToBoard(board, call);
    if (!baseRes.legal) return [];
    const baseEnd = this.matcher.knownFormation(baseRes.board);
    if (baseEnd === null) return [];
    const out: string[] = [];
    for (const name of this.library.callNames()) {
      if (name === call) continue;
      const res = this.applicator.applyToBoard(board, name);
      if (!res.legal) continue;
      if (this.matcher.knownFormation(res.board) === baseEnd) out.push(name);
    }
    return out;
  }

  // ---- generative-prefix expansion ----

  /** Concrete calls in a generative-prefix family, e.g. "anything_and_roll" maps
   * to the registered calls whose file base name carries that prefix. Each
   * concrete member is a distinct transition. Returns [] when the prefix is not
   * registered. */
  expandGenerativePrefix(prefix: string): string[] {
    const canonical = canonicalName(prefix);
    const names: string[] = [];
    for (const name of this.library.callNames()) {
      // Match the family: the call's registered name equals the prefix, or starts
      // with "<prefix>_" (e.g. "anything_and_roll", "anything_and_cross").
      if (name === canonical || name.startsWith(canonical + '_')) names.push(name);
    }
    return names;
  }

  // ---- recognition & FASR ----

  isAt(name: string, board: Board = this.board): boolean {
    return this.matcher.matchesNamed(board, name);
  }

  recognize(board: Board): RecognizedFormation {
    return this.matcher.recognize(board);
  }

  formationState(board: Board): { name: string; rot: number; reflect: boolean; cSrc: { x: number; y: number }; cTgt: { x: number; y: number } } | null {
    return this.matcher.formationState(board);
  }

  fasr(): Fasr {
    return analyzeFasr(this.board, this.recognize(this.board).name);
  }

  // ---- normalised FSM state & orientation delta ----

  /** The normalised FSM state of a board: the formation name with orientation
   * removed (all rotations of a shape collapse to one state). Returns null when
   * the board matches no standard formation. */
  fsmState(board: Board = this.board): { key: string; rot: number } | null {
    const matchables = this.matcher.matchables(board);
    return normalisedState(this.library.getNamedFormations(), matchables, STANDARD_FORMATIONS);
  }

  /** The orientation delta (in 45-degree/eighth-turn steps) from a start board to
   * an end board, computed from the dancers' actual heading change (the true set
   * rotation, independent of formation symmetry). Positive is counter-clockwise.
   * Returns null when the two boards resolve to different normalised formations
   * or when no dancer heading change can be measured. */
  fsmOrientationDelta(start: Board, end: Board): number | null {
    const s = this.fsmState(start);
    const e = this.fsmState(end);
    if (!s || !e || s.key !== e.key) return null;
    const byId = (b: Board) => new Map(b.dancers.filter((d) => !d.isGhost).map((d) => [d.id, d]));
    const sm = byId(start);
    const em = byId(end);
    let sum = 0;
    let count = 0;
    for (const [id, sd] of sm) {
      const ed = em.get(id);
      if (!ed) continue;
      let d = ed.heading - sd.heading;
      d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (d > Math.PI) d -= 2 * Math.PI;
      sum += d;
      count++;
    }
    if (count === 0) return null;
    return Math.round((sum / count) / ORIENTATION_STEP);
  }

  /** One orientation step in radians (45 degrees), for callers computing deltas. */
  orientationStepRad(): number {
    return ORIENTATION_STEP;
  }

  // ---- FSM user amendment ----

  /** Try to add a user amendment marking `call` as valid from `formation`. The
   * amendment is validated (end lands in a recognised formation, a getout exists,
   * no collision) before it is accepted. Returns {ok, reason}. */
  amendTransition(formation: string, call: string): { ok: boolean; reason?: string; amendment?: FsmAmendment } {
    const board = this.syntheticBoard(formation);
    if (!board) return { ok: false, reason: `Unknown formation: ${formation}` };
    const r = this.fsmStore.amend(formation, call, board);
    if (r.ok && this.fsmTable) this.fsmTable.merge([r.amendment!]);
    return r;
  }

  isAmended(formation: string, call: string): boolean {
    return this.fsmStore.isAmended(formation, call);
  }

  getAmendments(): FsmAmendment[] {
    return this.fsmStore.all();
  }

  removeAmendment(formation: string, call: string): boolean {
    const r = this.fsmStore.remove(formation, call);
    this.fsmTable = null; // rebuild on next access
    return r;
  }

  clearAmendments(): void {
    this.fsmStore.clear();
    this.fsmTable = null; // rebuild on next access
  }

  // ---- build-time transition table ----

  /** The concrete build-time transition table: state -> edges[], with amendments
   * merged in. Built once on first access and cached; rebuilt when amendments
   * change. This is the held state machine that can be queried and exported. */
  transitionTable(): FsmTable {
    if (!this.fsmTable) {
      this.fsmTable = this.buildFsmTable();
    }
    return this.fsmTable;
  }

  /** Rebuild (or force a rebuild of) the transition table from the current
   * catalog and amendments. The state set is the union of named formations and
   * all call-variant start setups (which includes the many EMBEDDED/inline
   * formations not in the named catalog), deduped by geometry. */
  buildFsmTable(): FsmTable {
    // Build a state-key -> geometry map, deduped by geometry.
    const stateGeo = new Map<string, Matchable[]>();
    const addState = (key: string, dancers: Matchable[]) => {
      for (const existing of stateGeo.values()) {
        if (matchFormations(dancers, existing, 1.0) !== null) return existing;
      }
      stateGeo.set(key, dancers);
      return dancers;
    };
    // Named formations first (stable, human-readable keys).
    for (const f of this.library.getUniqueFormations()) addState(f.name, f.dancers);
    // Then every call-variant start setup (embedded/inline formations).
    for (const setup of this.library.allVariantSetups()) {
      addState(`@embed#${stateGeo.size}`, setup);
    }
    const states = [...stateGeo.keys()];
    const enumerate = (state: string): Omit<FsmTableEdge, 'source'>[] => {
      const geo = stateGeo.get(state);
      if (!geo) return [];
      const board = this.boardFromMatchables(geo);
      return this.legalCalls(board).map((call) => {
        const res = this.applicator.applyToBoard(board, call);
        return {
          call,
          // Use the curated `recognize` name (the same label the sequencer
          // displays) so the FSM table's end-formation edges agree with the
          // sequencer, rather than `knownFormation` which can pick an obscure
          // whole-catalog formation (e.g. T-Bone LDDR) the sequencer never shows.
          endFormation: res.legal ? this.matcher.recognize(res.board).name : null,
          orientationDelta: 0,
        };
      });
    };
    return FsmTable.build(states, enumerate, this.fsmStore.all());
  }

  // ---- transition table persistence ----

  /** Serialise the built transition table to its persisted JSON form. If the
   * table has not been built yet it is built first. */
  serializeFsmTable(): FsmTableData {
    return this.transitionTable().serialize();
  }

  /** Load a previously-serialised transition table (as an object or JSON string)
   * into this Sequencer, skipping the expensive build-time enumeration. Returns
   * false when the data is malformed or unsupported. */
  loadFsmTable(data: FsmTableData | string): boolean {
    const table = FsmTable.load(data);
    if (!table) return false;
    this.fsmTable = table;
    return true;
  }

  /** The schema version of the persisted transition-table format. */
  fsmTableSchemaVersion(): number {
    return FSM_TABLE_SCHEMA_VERSION;
  }

  /** Export the FSM as a full snapshot plus a delta ledger, for submission to a
   * master copy. States are the unique normalised formations; build-time edges
   * come from the stored transition table, and amendments are the user changes. */
  exportFsm(): FsmExport {
    return this.transitionTable().exportFsm();
  }

  /** Build a synthetic board sitting in the named formation (for amendment
   * validation). Assigns home identity (id/couple/gender) by matching the
   * formation's geometry to the home square so the getout search can resolve it. */
  private syntheticBoard(formation: string): Board | null {
    const f = this.library.getNamedFormations().find((x) => x.name === canonicalName(formation));
    if (!f) return null;
    return this.boardFromMatchables(f.dancers);
  }

  /** Build a synthetic board from arbitrary dancer geometry (named or embedded),
   * stamping home identity when the geometry is an 8-dancer home-like square.
   *
   * IDENTITY IS DATA. Home identity (id/couple) comes from matching the geometry to
   * the home square. GENDER comes from the formation's or setup's DECLARED gender
   * when the geometry is not home-like -- it is real catalog data (formations.xml
   * declares one per slot; a call's <tam> declares one per dancer), so it is used
   * rather than invented. Only a dancer with neither is marked 'phantom' (unknown),
   * which gates nothing.
   *
   * The couple is NOT declared anywhere, so away from home it stays UNKNOWN_COUPLE:
   * deriving it from the array index would leak an index into identity, and from
   * there into the matching tie-break, the couple groupings and couple-coherence. */
  private boardFromMatchables(dancers: Matchable[]): Board {
    const home = HOME_DANCERS;
    const m = dancers.length === home.length
      ? matchFormations(
          dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading })),
          home.map((h) => ({ x: h.x, y: h.y, heading: h.heading })),
        )
      : null;
    return {
      dancers: dancers.map((d, i) => {
        const id = m ? home[m.mapping[i]] : null;
        return {
          id: id ? id.id : i + 1,
          couple: id ? id.couple : UNKNOWN_COUPLE,
          gender: id ? id.gender : (d.gender ?? 'phantom'),
          x: d.x,
          y: d.y,
          heading: d.heading,
        };
      }),
    };
  }

  // ---- module collapse ----

  /** Whether a module can be collapsed into a single composed transformation for a
   * given start formation: the module must exist, its start must be a recognised
   * formation, and NONE of its constituent calls may be non-compositional. */
  moduleCollapsible(module: string, startFormation: string): boolean {
    const calls = this.library.getModule(module);
    if (!calls || calls.length === 0) return false;
    if (calls.some((c) => this.library.isNonCompositional(typeof c === 'string' ? c : c.call))) return false;
    return this.syntheticBoard(startFormation) !== null;
  }

  /** Collapse a module into a single per-dancer composed matrix for the given
   * start formation, by replaying the sequence and composing each dancer's
   * start->end matrix via mul5. Returns null when not collapsible. The composed
   * matrices are keyed by dancer id. */
  collapseModule(module: string, startFormation: string): { matrices: Map<number, Mat5>; endFormation: string | null } | null {
    if (!this.moduleCollapsible(module, startFormation)) return null;
    const calls = this.library.getModule(module)!;
    let board = this.syntheticBoard(startFormation)!;
    const startById = new Map(board.dancers.map((d) => [d.id, d]));
    for (const c of calls) {
      const res = this.applicator.applyToBoard(board, c);
      if (!res.legal) return null;
      board = res.board;
    }
    const endById = new Map(board.dancers.map((d) => [d.id, d]));
    const matrices = new Map<number, Mat5>();
    for (const [id, sd] of startById) {
      const ed = endById.get(id);
      if (!ed) continue;
      matrices.set(id, dancerMatrix(sd.x, sd.y, sd.heading, ed.x, ed.y, ed.heading));
    }
    return { matrices, endFormation: this.matcher.knownFormation(board) };
  }

  // ---- sequence animation & analysis ----

  stepBeats(board: Board, name: string): number {
    return this.analyzer.stepBeats(board, name);
  }

  /** Total beats of a flat sequence replayed from `startBoard` (default: the
   * home squared set). Pass the board the sequence actually started from - e.g.
   * one jumped to with setFormation - so playback agrees with the live board. */
  sequenceBeats(flat: (string | CallStep)[], startBoard?: Board): number {
    return this.analyzer.sequenceBeats(flat, startBoard);
  }

  /** The board at a global beat of a flat sequence replayed from `startBoard`
   * (default: the home squared set). */
  evaluateSequence(flat: (string | CallStep)[], beat: number, startBoard?: Board): { board: Board; beats: number } {
    return this.analyzer.evaluateSequence(flat, beat, startBoard);
  }

  sequenceInfo(flat: (string | CallStep)[], beat: number, startBoard?: Board): { name: string; variant: CallBundle; mapping: number[] } | null {
    return this.analyzer.sequenceInfo(flat, beat, startBoard);
  }

  phrasesForBeats(beats: number): number {
    return this.analyzer.phrasesForBeats(beats);
  }

  validateSegment(flat: (string | CallStep)[]): { totalBeats: number; phrases: number; complete64: boolean; remainder: number } {
    return this.analyzer.validateSegment(flat);
  }

  isZero(flat: string[]): boolean {
    return this.analyzer.isZero(flat);
  }

  buildTip(figures: string[][]): { calls: string[]; legal: boolean; totalBeats: number; phrases: number; complete64: boolean; reason?: string } {
    return this.analyzer.buildTip(figures);
  }

  // ---- getout / getin / fixIt ----

  getout(opts: { target?: string; maxCalls?: number; budget?: number } = {}): string[] | null {
    return this.solver.getout(this.board, opts);
  }

  getin(opts: { target?: string; maxCalls?: number; budget?: number } = {}): string[] | null {
    return this.solver.getin(this.board, opts);
  }

  fixIt(opts: { target?: string; depth?: number } = {}): string[] {
    return this.solver.fixIt(this.board, opts);
  }

  /** What the LAST getout/getin/fixIt cost, in the terms that separate the two complexity
   * terms. Only populated when `setCollectStats(true)`. See `SearchStats`. */
  searchStats(): SearchStats {
    return this.solver.searchStats();
  }

  /** Turn search-cost counting on (it is off by default: the counters are on the hottest path
   * in the engine, and only a measurement wants them). */
  setCollectStats(on: boolean): void {
    this.config.collectStats = on;
  }

  matrixGetout(): string[] | null {
    return this.solver.matrixGetout(this.board);
  }

  closenessToHome(board: Board = this.board): number {
    return this.solver.closenessToHome(board);
  }

  // ---- subsets & parallel ----

  subsetOf(board: Board, group: string): number[][] | null {
    return this.grouping.subsetOf(board, group);
  }

  parallelApplicable(board: Board, group: string, callName: string): { subsets: number[][] | null; legalOnAll: boolean; illegalSubsets: number[][] } {
    return this.grouping.parallelApplicable(board, group, callName);
  }

  // ---- ghosts & occupancy ----

  physicalDancers(board: Board): SeqDancer[] {
    return board.dancers.filter((d) => !d.isGhost);
  }

  /** The remembered direction each physical dancer last turned (left/right), keyed
   * by dancer id. Non-compositional calls may depend on this metadata. */
  lastTurnDirections(board: Board = this.board): Record<number, 'left' | 'right'> {
    const out: Record<number, 'left' | 'right'> = {};
    for (const d of board.dancers) {
      if (d.isGhost) continue;
      if (d.lastTurnDir) out[d.id] = d.lastTurnDir;
    }
    return out;
  }

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
}
