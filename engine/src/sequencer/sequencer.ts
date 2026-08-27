// Sequencer facade: wires the collaborators (CallLibrary, FormationMatcher,
// CallApplicator, LegalityChecker, SequenceAnalyzer, HomeSolver, Grouping) and
// owns the current board + shared config. Each public method delegates to the
// collaborator that owns that responsibility, so the heavy logic lives in small,
// focused classes instead of one god-class.

import { SequencerConfig } from './config.js';
import { CallLibrary } from './library.js';
import { FormationMatcher } from './matcher.js';
import { CallApplicator } from './applicator.js';
import { LegalityChecker } from './legality.js';
import { SequenceAnalyzer } from './sequence.js';
import { HomeSolver } from './solver.js';
import { Grouping } from './grouping.js';
import { makeSquaredSet, cloneBoard } from './board.js';
import { analyzeFasr } from './fasr.js';
import { normalisedState, ORIENTATION_STEP } from './fsm.js';
import { STANDARD_FORMATIONS } from './constants.js';
import type { Matchable } from './match.js';
import type { Board, Fasr, Module, RecognizedFormation, SeqDancer, SeqStep, VariantMatch } from './types.js';
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

  constructor(movesXml: string, formationsXml: string, calls: { name: string; xml: string }[] = []) {
    this.library = new CallLibrary(movesXml, formationsXml);
    this.matcher = new FormationMatcher(this.library, this.config);
    this.applicator = new CallApplicator(this.library, this.matcher, this.config);
    this.legality = new LegalityChecker(this.library, this.matcher, this.applicator, this.config);
    this.analyzer = new SequenceAnalyzer(this.library, this.matcher, this.applicator, this.config);
    this.solver = new HomeSolver(this.library, this.matcher, this.applicator, this.legality, this.config);
    this.grouping = new Grouping(this.applicator);
    this.board = makeSquaredSet();
    for (const c of calls) {
      try {
        this.register(c.name, c.xml);
      } catch {
        // Skip a call whose data fails to build; it just won't be applicable.
      }
    }
  }

  // ---- registration & modules ----

  register(name: string, xml: string): void {
    this.library.register(name, xml);
  }

  registerModule(name: string, calls: string[]): void {
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

  flatten(sequence: string[]): string[] {
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

  // ---- board state ----

  reset(): void {
    this.board = makeSquaredSet();
    this.matcher.clearCaches();
    this.solver.clearCaches();
  }

  startBoard(): Board {
    return cloneBoard(this.board);
  }

  apply(callName: string): SeqStep {
    const res = this.applicator.applyToBoard(this.board, callName);
    this.board = res.board;
    this.matcher.clearCaches();
    this.solver.clearCaches();
    return { call: callName, legal: res.legal, reason: res.reason, board: res.board, formation: this.recognize(res.board) };
  }

  applyToBoard(board: Board, callName: string): { board: Board; legal: boolean; reason?: string } {
    return this.applicator.applyToBoard(board, callName);
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

  getUniqueFormations(): { name: string; dancers: Matchable[] }[] {
    return this.library.getUniqueFormations();
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
    return this.legality.legalCalls(this.board);
  }

  parallelLegalCalls(board: Board): { name: string; board: Board }[] {
    return this.legality.parallelLegalCalls(board);
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

  // ---- sequence animation & analysis ----

  stepBeats(board: Board, name: string): number {
    return this.analyzer.stepBeats(board, name);
  }

  sequenceBeats(flat: string[]): number {
    return this.analyzer.sequenceBeats(flat);
  }

  evaluateSequence(flat: string[], beat: number): { board: Board; beats: number } {
    return this.analyzer.evaluateSequence(flat, beat);
  }

  sequenceInfo(flat: string[], beat: number): { name: string; variant: CallBundle; mapping: number[] } | null {
    return this.analyzer.sequenceInfo(flat, beat);
  }

  phrasesForBeats(beats: number): number {
    return this.analyzer.phrasesForBeats(beats);
  }

  validateSegment(flat: string[]): { totalBeats: number; phrases: number; complete64: boolean; remainder: number } {
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
