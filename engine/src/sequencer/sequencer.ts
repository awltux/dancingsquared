// Sequencer facade: wires the collaborators (CallLibrary, FormationMatcher,
// CallApplicator, LegalityChecker, SequenceAnalyzer, HomeSolver, Grouping) and
// owns the current board + shared config. Each public method delegates to the
// collaborator that owns that responsibility, so the heavy logic lives in small,
// focused classes instead of one god-class.

import { SequencerConfig, emptySearchStats, type SearchStats } from './config.js';
import { CallLibrary } from './library.js';
import { FormationMatcher } from './matcher.js';
import { CallApplicator, type ApplyResult } from './applicator.js';
import { LegalityChecker } from './legality.js';
import { SequenceAnalyzer, type SequenceStop } from './sequence.js';
import { HomeSolver } from './solver.js';
import { Grouping } from './grouping.js';
import { splitSelection } from './selection.js';
import { FsmStore, type FsmAmendment } from './fsm-store.js';
import { type FsmExport } from './fsm-export.js';
import {
  FsmTable,
  type FsmTableEdge,
  type FsmTableData,
  type FsmEndKind,
  type FsmReading,
  type FsmStateInfo,
  FSM_TABLE_SCHEMA_VERSION,
} from './fsm-table.js';
import { makeSquaredSet, cloneBoard } from './board.js';
import { bodyGap, worstBodyGap, BODY_OVERLAP_EPS, type BodyPair } from './bodies.js';
import {
  evaluatePermissions,
  PERMISSION_RULES,
  type PermissionLevel,
  type PermissionRequest,
  type PermissionResult,
  type PermissionRule,
} from './permissions.js';
import { HOME_DANCERS } from './identity.js';
import { identifyByAssignment } from './identity.js';
import { matchFormations } from './match.js';
import { mul5, dancerMatrix, type Mat5 } from '../matrix.js';
import { DEFAULT_MATCH_MAX } from './constants.js';
import { applyMoveToBoard, applyFaceInOutToBoard, FaceLeft, FaceRight, FaceHalf } from '../moves.js';
import { CODED_MOVE_NAMES, applyCodedMove, applyCodedToSelection, codedMoveApplies, findCodedMove } from './coded-moves.js';
import { analyzeFasr } from './fasr.js';
import { normalisedState, ORIENTATION_STEP } from './fsm.js';
import { STANDARD_FORMATIONS, UNKNOWN_COUPLE, canonicalName } from './constants.js';
import { boardForFasrCode, setupForFormation, FORMATION_LETTER, FORMATIONS_FOR_LETTER } from './alignment.js';
import type { Matchable } from './match.js';
import type { Board, CallStep, Fasr, Module, ModuleStep, RecognizedFormation, SeqDancer, SeqStep, VariantMatch } from './types.js';
import { isGroupStep, stepCall, stepLabel } from './types.js';
import type { CallBundle } from '../types.js';

export { assignHomeIdentity } from './identity.js';

export class Sequencer {
  board: Board;

  private readonly config = new SequencerConfig();
  private readonly library: CallLibrary;
  /** Calls the SEQUENCER could not hand to the library at all (unparseable XML). The library's own
   * per-tam failures are separate; `registrationFailures()` merges the two. */
  private readonly registrationErrors: { call: string; reason: string }[] = [];
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
    // The analyzer resolves a SCOPED step against its own subset (see `matchingVariantInfo`), and the
    // Grouping that answers it is built from the applicator - hence the injection rather than a
    // direct reference, the same shape as `setSelectionResolver` above.
    this.analyzer.setSelectionResolver((board, selection) => this.grouping.resolveSelection(board, selection));
    this.solver = new HomeSolver(this.library, this.matcher, this.applicator, this.legality, this.config);
    this.fsmStore = new FsmStore(this.applicator, this.matcher, this.solver);
    this.board = makeSquaredSet();
    for (const c of calls) {
      try {
        this.register(c.name, c.xml);
      } catch (e) {
        // A call whose XML cannot even be PARSED is still skipped rather than crashing the
        // Sequencer, but it is no longer skipped SILENTLY: the reason is recorded so the loss can
        // be seen and asserted. See `CallLibrary.registrationFailures`.
        this.registrationErrors.push({ call: c.name, reason: e instanceof Error ? e.message : String(e) });
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
    const sel = splitSelection(name);
    // A MULTIPLE OF A CATALOGUE CALL: "Circulate 2" IS the same call applied twice.
    //
    // All8's own key (abbrlist.htm, read in round 19) defines the notation exactly that way -
    // "Cir2  {designated} Circulate 2 spots (Circulate Twice)" - and CALLERLAB's Circulate Family says
    // "Fractions are proper and occasionally used with calls in the Circulate family". Circulate is
    // authored as TAMS in this catalogue (Box/Centers/Ends/All 8/Split Circulate), not as a rule, so
    // "twice" cannot be composed from geometry - but it CAN be composed from the engine's own reading
    // of the base call, which is what this does, and it is the only reading that keeps the two in step.
    //
    // Guarded exactly like the applicator's scoped path: only when the FULL name is NOT itself a
    // registered call (so `Eight Chain 2`, `Square Thru 2`, `Circulate 1 1/2` and every other real
    // title keep their own authoring) and the base IS one. The selection is carried through both
    // applications, which is what makes `Girls Circulate 2` work: the girls move two positions.
    const multiple = /^(.+) 2$/.exec(sel.call);
    if (multiple && !this.library.hasCall(sel.call) && this.library.hasCall(multiple[1])) {
      const step: string | CallStep = sel.selection ? { selection: sel.selection, call: multiple[1] } : multiple[1];
      let cur = board;
      for (let i = 0; i < 2; i++) {
        const r = this.applicator.applyStep(cur, step);
        if (!r.legal) {
          return { board, legal: false, reason: r.reason ?? `${sel.call} needs two applications of ${multiple[1]}, and the ${i === 0 ? 'first' : 'second'} does not apply` };
        }
        cur = r.board;
      }
      return { board: cur, legal: true };
    }
    // A BOXED call is handled first and on its own, because it is not a whole-board transform and not
    // a selection either: it acts on each box of a named 4-dancer setup, so its `precondition` and
    // `apply` are per BOX and the whole-board reading below must not run. See `CodedMove.boxedBy`.
    const boxed = findCodedMove(sel.call);
    if (boxed?.boxedBy) {
      // A named group is the SUBJECT: `Centers Sweep 1/4` sweeps the box the centres form, and the
      // rest of the board is not part of a box at all. So the tiling runs over the DESIGNATED dancers
      // and the non-designated ones simply do not move - which is also why no "the selection must be
      // whole boxes" test is needed here.
      const ids = sel.selection ? this.grouping.resolveSelection(board, sel.selection) : null;
      const picked = ids ? new Set(ids) : null;
      const subject: Board = picked ? { dancers: board.dancers.filter((d) => picked.has(d.id)) } : board;
      const groups = this.applicator.boxGroups(subject, DEFAULT_MATCH_MAX + this.config.matchMargin);
      if (!groups) {
        return {
          board,
          legal: false,
          reason: `${boxed.name} needs ${picked ? 'the named group' : 'the board'} to divide into facing-couple boxes, and it does not`,
        };
      }
      const moved = new Map<number, typeof board.dancers[number]>();
      for (const g of groups) {
        const box: Board = { dancers: g.map((d) => ({ ...d })) };
        const problem = boxed.precondition?.(box) ?? null;
        if (problem) return { board, legal: false, reason: problem };
        for (const d of boxed.apply(box).dancers) moved.set(d.id, d);
      }
      if (moved.size === 0) {
        return { board, legal: false, reason: `${boxed.name} has no box to act on` };
      }
      const swept: Board = { dancers: board.dancers.map((d) => moved.get(d.id) ?? d) };
      // A BOXED call must leave a BOARD. Neighbouring boxes can overlap once each rotates about its
      // own centre, and this is the only place that can see it - see `sweepCollision`.
      if (boxed.collisionCheck) {
        const problem = boxed.collisionCheck(swept);
        if (problem) return { board, legal: false, reason: problem };
      }
      return { board: swept, legal: true };
    }
    const whole = applyCodedMove(board, name);
    if (whole) {
      // A move that does not apply may DECLINE and let the catalogue try, which is how a call being
      // ported in pieces avoids refusing boards the catalogue still handles correctly (see
      // `CodedMove.catalogueFallback`). Without the flag a refusal is final, as it was before.
      if (!whole.legal && findCodedMove(splitSelection(name).call)?.catalogueFallback) return null;
      return whole;
    }
    // A coded move with a dancer selection, e.g. "Girls U-Turn Back": the selected
    // dancers pivot and everyone else stays put. This has to be handled HERE rather
    // than in the applicator's selection path, because coded moves are per-dancer
    // transforms applied straight from geometry - the applicator matches catalog
    // setups, and the coded table lives in this class. Left to the applicator it
    // fails with "not legal for selected dancers" even though the pivot is trivially
    // well defined for any subset, which is how every "Girls U-Turn Back" line in the
    // published get-out corpus was stopping.
    const sel2 = splitSelection(name);
    if (!sel2.selection) return null;
    const base = findCodedMove(sel2.call);
    if (!base) return null;
    const ids = this.grouping.resolveSelection(board, sel2.selection);
    if (!ids || ids.length === 0) return null;
    // A move that moves NON-designated dancers as well (a Run's walker, a Trade's intervening
    // dancers) has to compute the whole board itself — the whole-board-transform-then-filter
    // trick below would discard the walker's motion and leave two dancers on one spot.
    //
    // THE READING IS `applyCodedToSelection` RATHER THAN WRITTEN OUT HERE, because the applicator's
    // "while" path needs exactly the same three cases for a group whose call is coded, and two copies of
    // "what a coded call means for a named group" would be a way for `Heads Step Forward` to work as a
    // step and not as a group. See there for the three readings.
    return applyCodedToSelection(board, sel2.call, ids);
  }

  // ---- registration & modules ----

  register(name: string, xml: string): void {
    this.library.register(name, xml);
  }

  /** Every call variant the catalogue failed to build, as `{ call, reason }`.
   *
   * The shipped catalogue is NOT clean: some tams name formations that `formations.xml` does not
   * ship (upstream does not ship them either), so this list is non-empty by design. It exists so
   * that the loss is VISIBLE - before, one bad `from=` attribute erased an entire call inside a
   * bare `catch`, and the only symptom was `Unknown call: Ferris Wheel` much later. `verify.mjs`
   * pins the known set, so a NEW loss fails the build. */
  registrationFailures(): { call: string; reason: string }[] {
    return [...this.library.registrationFailures(), ...this.registrationErrors];
  }

  registerModule(name: string, calls: ModuleStep[]): void {
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

  flatten(sequence: ModuleStep[]): ModuleStep[] {
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

  /**
   * How the engine treats a call whose motion walks two dancers' bodies through each other.
   *
   * `'report'` (the default) detects it and records `bodyCollision` on the apply result without
   * refusing; `'guard'` also refuses the offending tiling; `'off'` skips the check. See
   * `SequencerConfig.bodyCollisionMode` for why `'report'` is the default rather than `'guard'`.
   */
  setBodyCollisionMode(mode: 'report' | 'guard' | 'off'): void {
    this.config.bodyCollisionMode = mode;
  }

  // ---- board state ----

  reset(): void {
    this.board = makeSquaredSet();
    this.matcher.clearCaches();
    this.solver.clearCaches();
    // A level registration rebuilds the call set, so rules added for the old one must not survive it.
    this.permissionRules = [];
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

  /** Apply a call step (string, {selection, call}, or a grouped "while" step) to the current board. */
  applyStep(step: ModuleStep): SeqStep {
    const coded = typeof step === 'string' ? this.tryCodedMove(this.board, step) : null;
    const res = coded ?? this.applicator.applyStep(this.board, step);
    this.board = res.board;
    this.matcher.clearCaches();
    this.solver.clearCaches();
    return { call: stepLabel(step), legal: res.legal, reason: res.reason, board: res.board, formation: this.recognize(res.board) };
  }

  applyToBoard(board: Board, callName: ModuleStep): { board: Board; legal: boolean; reason?: string } {
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

  /**
   * The board to SET DANCERS UP on for a named formation: the arrangement-0, both-in-sequence FASR
   * board when the formation has an All8 letter AND that code builds the SAME formation, otherwise the
   * named template.
   *
   * WHY A NAME IS NOT ENOUGH. `boardForFormation` is geometry plus the formation's declared genders and
   * nothing else, which for most of the offered formations means NO home couple at all - so there is
   * nothing for the dancers to be in sequence WITH, and a caller setting up from a name gets anonymous
   * dancers whose colours are then derived from their array position. MEASURED by
   * `engine/test/tools/setup-path-probe.mjs`: 129 of the 134 offered formations are anonymous by name,
   * `boardForFormation('Normal Lines')` is identity 0/8, and `boardForFasrCode('L1')` - arrangement 0
   * (All8's "normal"), sequence 1 (both in sequence) - is identity 8/8 on the same geometry.
   *
   * THE REGISTRY IS TRIED FIRST, and that is the difference a MEASUREMENT made. This used to derive the
   * setup from the formation's letter alone (`<letter>1`), which is arrangement 0 and sequence 1 but
   * names NO RELATIONSHIP - and a code with no relationship cannot pin the board, because one code's
   * enumeration admits four boards that differ only in which couple stands where. `canonicalBoard`
   * therefore found no index for the spec and fell back to `boards[0]`, the first board the ENUMERATION
   * happened to produce. MEASURED by `test/tools/canonical-identity-probe.mjs`: of the registry's ten
   * keys that path agreed with All8's board on THREE, and `Normal Lines` came back reading `0L1p` where
   * the zero line is `0L1o` - so the app was standing a module up on a line that is not the one its
   * label names. That is the reported symptom ("the sequencer seems to use a very unusual setup for some
   * of the initial formations"), and it was live.
   *
   * `setupForFormation` carries the part a code cannot: the couple-to-spot ANCHOR, measured against
   * All8's own published diagrams. Its assignment is applied to the anonymous board by
   * `identifyByAssignment`, which OVERWRITES identity and nothing else - the positions, headings, dancer
   * ORDER and declared genders all stay the template's, because the POC binds avatars by array index.
   *
   * THE OLD DERIVATION STAYS AS THE FALLBACK, deliberately: the registry covers ten names and the app
   * offers 134, and five formations (`Double Pass Thru`, `O Eight Chain Thru`, `O In`, `O Out`,
   * `O Trade By`) get a correct identity from the letter path that the registry has no entry for. So
   * this is additive for them rather than a swap - nothing that has identity today loses it.
   *
   * "WHEN POSSIBLE" IS THE SAME-FORMATION TEST, and it is what keeps the fallback from changing an
   * answer: the code for a letter builds the letter's FIRST template, so `Normal Lines Compact` would
   * come back as plain `Normal Lines`. The name wins there, because a caller who asked for the compact
   * line and got the wide one has been silently overruled rather than helped. The registry has no such
   * problem - it takes the NAME's geometry as the template - which is why three compact variants that
   * were ANONYMOUS on the fallback are identified now.
   *
   * `setFormation` is deliberately left as it is: it is the plain geometry/template path the harnesses
   * use to build anonymous boards ON PURPOSE (the Formation-tab tests), and this is the setup path.
   */
  boardForSetup(name: string): Board | null {
    const anon = this.boardForFormation(name);
    if (!anon) return null;
    const identified = this.setupIdentifiedBoard(name, anon);
    if (identified) return identified;
    const wanted = canonicalName(name) ?? name;
    const letter = Object.entries(FORMATION_LETTER)
      .find(([n]) => (canonicalName(n) ?? n) === wanted)?.[1];
    if (letter) {
      const built = boardForFasrCode(`${letter}1`, (l) => {
        for (const n of FORMATIONS_FOR_LETTER[l] ?? []) {
          const b = this.boardForFormation(n);
          if (b) return b;
        }
        return null;
      }).board;
      if (built && (canonicalName(this.knownFormation(built) ?? '') ?? '') === wanted) return built;
    }
    return anon;
  }

  /** Set the current board to the SETUP board for `name` (`boardForSetup`): the identified,
   * arrangement-0, in-sequence board when there is one. Returns false if the formation is unknown. */
  setSetup(name: string): boolean {
    const b = this.boardForSetup(name);
    if (!b) return false;
    this.board = b;
    this.matcher.clearCaches();
    this.solver.clearCaches();
    return true;
  }

  /**
   * `board` wearing the canonical identity of `name`, or null when the engine has no authority-backed
   * setup for that name - the ONE place the rule "the registry first, applied on top of the board the
   * caller already has" is written.
   *
   * It takes the BOARD rather than a name alone because the two callers hold different boards: the
   * setup path holds the named template, and the FSM holds the state's own geometry, which it must
   * enumerate from unchanged. `identifyByAssignment` is all-or-nothing against the assignment's spot
   * keys, so a board that is not the one the registry was measured on comes back untouched instead of
   * half-identified - which is what lets the FSM pass its own board safely.
   */
  private setupIdentifiedBoard(name: string, board: Board): Board | null {
    const setup = setupForFormation(name, (n) => this.boardForFormation(n));
    return setup ? identifyByAssignment(board, setup.assignment) : null;
  }

  /**
   * The board the FSM enumerates a NAMED state from: the named template carrying its canonical identity
   * where the registry covers it, and the anonymous template otherwise.
   *
   * THIS EXISTS FOR THE HARNESSES. `buildFsmTable.enumerate` works from the state's own geometry, which
   * it already holds, so it does not need this - but a harness that has to reproduce the table's
   * applications by name (`reading-census.mjs` does, to cross-check every reading) would otherwise
   * re-derive the rule and drift from it. That they agree is itself checked, because the readings of
   * the two boards would differ.
   */
  stateBoard(name: string): Board | null {
    const anon = this.boardForFormation(name);
    if (!anon) return null;
    return this.setupIdentifiedBoard(name, anon) ?? anon;
  }

  // ---- matcher introspection (passthroughs) ----

  findMatchingVariant(board: Board, callName: string, maxError: number): VariantMatch | null {
    return this.matcher.findMatchingVariant(board, callName, maxError);
  }

  knownFormation(board: Board): string | null {
    return this.matcher.knownFormation(board);
  }

  /**
   * Add a USER-DEFINED named formation, so boards like it can be named from now on.
   *
   * THE CACHES HAVE TO GO. `bestFormationMatch` memoizes a board's best formation by exact
   * geometry signature, so a board that was read BEFORE this call is remembered as "no formation"
   * and would keep answering that way for the rest of the session - the label would appear on the
   * next board and not on the one the user was looking at. Clearing here is the whole reason this
   * is a Sequencer method rather than a direct library poke.
   */
  registerFormation(name: string, dancers: Matchable[]): void {
    this.library.registerFormation(name, dancers);
    this.matcher.clearCaches();
    this.solver.clearCaches();
  }

  /** The user-defined formation names. */
  listUserFormations(): string[] {
    return this.library.listUserFormations();
  }

  /** Whether a formation name came from a user rather than from `formations.xml`. */
  isUserFormation(name: string): boolean {
    return this.library.isUserFormation(name);
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

  /**
   * Whether `group` can actually perform `call` from `board` — the group prefixed onto the bare call
   * and applied.
   *
   * WHY THIS EXISTS. A picker with a group chosen needs to know what THAT GROUP can do, and whole-board
   * legality does not answer it: measured on a `Static Square` with `Head Boys`, whole-board legality
   * listed `Promenade`, `Promenade 1/2` and `Swing Your Partner` as available, and the group cannot do
   * any of the three. Offering a call and then refusing it is the picker disagreeing with itself.
   *
   * The reverse can also happen — a call legal for the group and not whole-board — so a group list built
   * by filtering `legalNext` cannot be right in either direction. This asks the question the picker
   * actually has.
   */
  groupCanPerform(board: Board, group: string, call: string): boolean {
    const spec = splitSelection(call);
    // A call that already names its own dancers is not the group's to perform ("Heads Square Thru 4").
    if (spec.selection && spec.call) return false;
    // PERMISSION FIRST, because asking the applicator is the more expensive question and the answer
    // cannot change it. A call the picker may not offer is not offered whatever it would do.
    if (!this.mayOffer(call, group, board).allowed) return false;
    return this.applicator.applyToBoard(board, `${group} ${spec.call || call}`).legal;
  }

  // ---- permissions (what the PICKER may offer) ----

  /** Extra rules layered on the built-in set. Cleared by `reset`. */
  private permissionRules: PermissionRule[] = [];
  /** The level the picker is working at. Rules above it are not consulted. */
  private activeLevel: PermissionLevel = 'ms';

  /**
   * The level whose programme the picker is offering. A rule from a level ABOVE this one is not
   * consulted: the app has not registered those calls, so it could not apply them anyway, and honouring
   * it would let an unloaded programme forbid a call the loaded one allows.
   */
  setActiveLevel(level: PermissionLevel): void {
    this.activeLevel = level;
  }

  /** Replace the extra rules. The built-ins in `PERMISSION_RULES` are always consulted too. */
  setPermissionRules(rules: readonly PermissionRule[]): void {
    this.permissionRules = [...rules];
  }

  /**
   * Whether the picker may OFFER `call` for `group` here. Picker-only: this does not gate `apply`, so a
   * caller who names the call directly still gets it.
   *
   * The group is normalised so the picker's own vocabulary works: its whole-board entry is `All 8`, and
   * `null`/absent means the same thing.
   *
   * `board` is what a FORMATION-SCOPED rule is checked against. It defaults to the current board, which
   * is what the picker is offering from.
   */
  mayOffer(call: string, group?: string | null, board?: Board): PermissionResult {
    const b = board ?? this.board;
    const req: PermissionRequest = {
      call: splitSelection(call).call,
      group: group && group !== 'All 8' ? group : 'All 8',
      // The RECOGNISED name, not the caller's label for the board: a rule that says "Static Square"
      // has to match the geometry, and a board built from a formation is named the same way by
      // `recognize` wherever it came from.
      board: b ? this.recognize(b).name : null,
      level: this.activeLevel,
    };
    return evaluatePermissions([...PERMISSION_RULES, ...this.permissionRules], req);
  }

  /** The reason the picker is not offering `call` for `group`, or null when it is. For a status line. */
  permissionReason(call: string, group?: string | null): string | null {
    const r = this.mayOffer(call, group);
    return r.allowed ? null : r.reason ?? `not offered at ${this.activeLevel.toUpperCase()}`;
  }

  /**
   * The calls legal from the current board that the picker may still offer in SOME reading.
   *
   * THIS LIST IS PRE-GROUP, which is what the permission filter has to respect. It is not "what to show
   * when nothing is chosen" - the picker takes it and then narrows by the chosen group with
   * `groupCanPerform`. So dropping a call merely because the WHOLE-BOARD reading is forbidden removes it
   * from every group too: measured, that emptied `Head Boys Dosado` out of the picker, which is the very
   * symptom `group-calls.mjs` pins. `Dosado` IS offered for `Head Boys`.
   *
   * A call is kept when its own reading is permitted, or when any group the board offers could perform
   * it. The group probe runs only for calls the whole-board rule refused, so the common case still costs
   * one cheap permission check.
   */
  legalNext(): string[] {
    const base = this.legality.legalCalls(this.board);
    // A coded move is listed only when it actually applies: the pivots always do,
    // but a whole-set resolve such as Promenade has preconditions.
    //
    // A GROUP-NAMED CODED CALL IS NOT LISTED HERE, AND CANNOT BE. `Fold`, `Cross Fold`, `Trade`, `Run` and
    // `Step Forward` all refuse the BARE name by design (their `precondition` says a group must be named), and
    // this list is the whole-board reading: `features.mjs` pins the invariant that matters - "every listed call
    // applies interactively" - and adding them here made exactly that fail (measured: 20 listed, 6 invalid).
    // They are reached with a GROUP, so the group-aware list is the app's (see `refreshCallSelect`, which
    // prefixes the chosen group) and the engine's own group question is `groupCanPerform`.
    const derived = CODED_MOVE_NAMES.filter((n) => {
      if (base.includes(n)) return false;
      const move = findCodedMove(n);
      return !move || codedMoveApplies(move, this.board);
    });
    const groups = this.subsetGroups(this.board);
    return base.concat(derived).filter((n) => {
      const spec = splitSelection(n);
      const call = spec.call || n;
      // Its own reading - the authored selection, or the whole board.
      if (this.mayOffer(call, spec.selection ?? 'All 8').allowed) return true;
      // Refused for that reading: still offerable if some group can do it.
      return groups.some((g) => this.groupCanPerform(this.board, g, call));
    });
  }

  /**
   * The dancer ids a selection resolves to on `board`, or null when it does not resolve.
   *
   * Exposed because a `GroupStep` is defined in terms of selections, and a caller (and a gate) has to
   * be able to ask WHICH dancers a group claims - to check the groups are disjoint, to know who is
   * left standing, and to compare a grouped result against each group's own solo result. Without this
   * the only way to know was to apply something and infer it from who moved, which is exactly the
   * inference this repository keeps getting wrong.
   */
  selectionIds(board: Board, selection: string): number[] | null {
    return this.grouping.resolveSelection(board, selection);
  }

  /**
   * The selector naming the dancers `selection` does NOT cover, or null when it covers everyone.
   *
   * WHY THIS IS DERIVED AND NOT LOOKED UP. The complement of a named group is often not itself a named
   * group: `Heads` leaves `Sides`, which is in the vocabulary, but `Head Boys` leaves SIX dancers in no
   * rectangular arrangement and there is no word for them. MEASURED, `All Except Head Boys` resolves to
   * exactly those six, and `All Except Heads` to exactly `Sides` - so the existing negator grammar
   * already names any complement, and this needs no new syntax.
   *
   * THE COMPLEMENT IS COMPUTED FROM THE IDS, not from the selector text, so it cannot disagree with
   * what the selection actually claims - the failure mode `selectionIds`'s own comment warns about.
   *
   * Null means the selection covered every dancer, which is the case where a "while" partner has nobody
   * left to act on.
   */
  remainingSelection(board: Board, selection: string): string | null {
    const ids = this.grouping.resolveSelection(board, selection);
    if (!ids || ids.length === 0) return null;
    const claimed = new Set(ids);
    const rest = board.dancers.filter((d) => !d.isGhost && !claimed.has(d.id));
    if (rest.length === 0) return null;
    return `All Except ${selection}`;
  }

  /**
   * The COMBINED selectors that resolve to a proper subset on `board` — the same rule
   * `subsetGroups` applies, over combinations rather than single groups.
   *
   * WHY A FIXED OFFERED LIST RATHER THAN EVERY POSSIBLE COMBINATION. The grammar is general (any tokens
   * intersect, any term unions, a negator subtracts — see `parseGroupExpression`), so the space is
   * thousands of strings and most are nonsense ("Girls and Trailer Boys"). What a caller actually says
   * is a short, well-known list, so this offers that and filters it by the board: a combination whose
   * parts do not resolve where the dancers are standing is simply absent, exactly as `subsetGroups`
   * omits `Centers` on a squared set.
   *
   * The order is the caller's own: the four named dancers a caller reaches for first, then the
   * position/role pairs that depend on the formation, then the unions.
   */
  combinedGroups(board: Board): string[] {
    const names: string[] = [];
    // THE FOUR THE CALLER NAMES. "Head Boys" is two dancers, not the four heads.
    for (const side of ['Head', 'Side']) {
      for (const role of ['Boys', 'Girls', 'Men', 'Women', 'Beaus', 'Belles']) names.push(`${side} ${role}`);
    }
    // POSITION AND ROLE, which exist only in the formations that have them.
    for (const pos of ['Center', 'End', 'Leader', 'Trailer', 'Very Center']) {
      for (const role of ['Boys', 'Girls']) names.push(`${pos} ${role}`);
    }
    // UNIONS - the reference's `DoubleSelector`, e.g. the two diagonal pairs.
    names.push(
      'Head Boys and Side Girls',
      'Head Girls and Side Boys',
      'Head Boys and Head Girls',
      'Side Boys and Side Girls',
    );
    return this.keepProperSubsets(board, names);
  }

  /** Keep the selectors that resolve to a non-empty group smaller than the whole board. */
  private keepProperSubsets(board: Board, names: string[]): string[] {
    const n = board.dancers.filter((d) => !d.isGhost).length;
    return names.filter((s) => {
      const ids = this.grouping.resolveSelection(board, s);
      return !!ids && ids.length > 0 && ids.length < n;
    });
  }

  /** The acting-group selector strings that resolve to a proper (non-empty,
   * not-everyone) subset on `board`. */
  subsetGroups(board: Board): string[] {
    const names = [
      'Heads', 'Sides', 'Boys', 'Girls', 'Men', 'Women', 'Ladies', 'Centers',
      'Ends', 'Couples', 'Leaders', 'Trailers', 'Beaus', 'Belles',
      'Couple #1', 'Couple #2', 'Couple #3', 'Couple #4',
    ];
    return this.keepProperSubsets(board, names);
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
    // Formation NAME -> the state key that ended up holding its geometry. The dedupe below keeps
    // only the FIRST name of each geometry, so a name can be a recognised formation without being a
    // state; an edge labelled with it would dangle and be dropped by every consumer.
    const keyOf = new Map<string, string>();
    /**
     * State key -> what authored it, for the states whose key is NOT their identity (the embedded
     * ones). A named state needs nothing here. See `FsmStateInfo`.
     */
    const embeddedInfo = new Map<string, FsmStateInfo>();
    const addState = (key: string, dancers: Matchable[], info?: FsmStateInfo) => {
      for (const [existingKey, existing] of stateGeo) {
        if (matchFormations(dancers, existing, 1.0) !== null) { keyOf.set(key, existingKey); return existing; }
      }
      stateGeo.set(key, dancers);
      keyOf.set(key, key);
      // ONLY ON A NEW STATE, and only when there is something to record. A setup that folds into a
      // state already registered (a named formation, or an earlier embedded setup with the same
      // geometry) adds no state, so it has no node to label - the surviving node keeps the identity
      // of whatever created IT.
      if (info) embeddedInfo.set(key, info);
      return dancers;
    };
    // THE NAMED HALF IS LEVEL-SCOPED, and that is the whole of Stage 0b. `getUniqueFormations()` is
    // all of `formations.xml` - the right vocabulary for NAMING a board, and the wrong one for a STATE
    // SET, because a programme only lets a caller stand where its own calls begin. MEASURED: the flat
    // list hands the Mainstream FSM 129 named geometries where ms tams reference 42 names (41
    // geometries), and 100 of its named formations are referenced by no ms tam at all.
    //
    // The scope is the CALL SET, so the engine needs no level concept: the level IS the calls
    // registered, which is exactly how `poc/src/data.ts` models it (`sequencerCallsUpTo`).
    //
    // The alternative - "a formation is introduced at the lowest level whose calls can REACH it" - was
    // MEASURED AND REFUSED. Seeding the closure with the 42 geometries ms declares and applying the
    // 273 ms calls (3063 legal applications, 16 s) reaches **78 of the 131 declared named geometries,
    // 34 of them named only ABOVE Mainstream**: `Static MiniWaves RH` via `Boys Run`, `T-Bone DRDR` via
    // `All 8 Circulate`, `T-Bone RDRD` via `Face Left`, `3/4 Lines RH` via `Boys Run`. So "reachable"
    // admits 34 formations no Mainstream call is authored from, and destroys the very gate it was
    // proposed to keep. Reachability is still worth knowing - those 36 geometries (78 reached minus
    // the 42 declared) are exactly the transients Stage 3's modules must ABSORB so they never become
    // states - but it is not the declaration. `test/tools/level-census.mjs` keeps the measurement.
    //
    // WITH THE SCOPE APPLIED THE NAMED HALF ADDS NO GEOMETRY AT ALL: every referenced name is also a
    // registered start setup, so the states are precisely the start setups of the calls registered and
    // the named half only supplies human-readable KEYS. That is the clean statement of the rule.
    for (const f of this.library.referencedFormations()) addState(f.name, f.dancers);
    // Then every call-variant start setup (embedded/inline formations).
    //
    // THE SOURCE CALL TRAVELS WITH EACH ONE. An embedded node's key is `@embed#N` where N is a COUNT of
    // the states registered so far, so it points at nothing a reader can look up; recording the `<tam>`
    // that authored the setup is what makes the node traceable back to a call. See `FsmStateInfo`.
    for (const { dancers, title, from } of this.library.allVariantSetupsWithSource()) {
      addState(`@embed#${stateGeo.size}`, dancers, { embedded: true, title, from });
    }
    const states = [...stateGeo.keys()];
    /**
     * The calls the table enumerates from a board, each with the result the enumeration must judge.
     *
     * The vocabulary is the catalogue's own plus the geometry-derived calls that carry a
     * PRECONDITION. The precondition rule is `searchLegalCalls`'s (legality.ts), for the same
     * reason: a coded PIVOT (`Face Left`, `U-Turn Back`, ...) is legal from every board and lands on
     * the formation it started in, so it would add one invisible self-loop per state (eight calls x
     * every state) and can never be a step of a get-out. A coded RESOLVE is the opposite —
     * `Promenade` is exactly the edge a get-out FSM exists to show and the catalogue cannot supply
     * it — so leaving these out left the table unable to represent the thing it is for.
     *
     * Each result comes from the SAME application that admitted it: the applicator for a catalogue
     * call, the coded rule for a coded one. Not the sequencer's coded-first dispatch — 61 edges
     * (`Boys Trade`, `Girls Run`, `Centers Run` ...) are calls that exist in BOTH vocabularies, and
     * the coded selection path lands them somewhere `knownFormation` cannot name where the
     * catalogue's authored tam lands in a state. That divergence is real and worth its own
     * investigation, but a table whose edge ends are unknown is not the place to discover it.
     */
    const enumerable = (board: Board): { call: string; res: ApplyResult }[] => {
      const out: { call: string; res: ApplyResult }[] = this.legalCalls(board).map((call) => ({ call, res: this.applicator.applyToBoard(board, call) }));
      const have = new Set(out.map((x) => x.call));
      for (const n of CODED_MOVE_NAMES) {
        if (have.has(n)) continue;
        const r = applyCodedMove(board, n);
        // A CODED MOVE HAS NO `parallel`, AND THAT IS THE ANSWER RATHER THAN A GAP. `coded-moves.ts` has
        // no partition path at all - a coded pivot or resolve (Face Left, Promenade, ...) is a transform
        // of the whole board, so its reading is `whole` by construction, which is what `readingOf` below
        // reports for a result with no `parallel`.
        if (r?.legal) out.push({ call: n, res: r });
      }
      return out;
    };
    /**
     * The READING of an application: how much of the board it actually moved.
     *
     * THE EXPRESSION IS `reading-census.mjs`'S, deliberately and to the character, because that harness
     * has been computing the readings from the same `ApplyResult` since before the FSM recorded them and
     * `test/reading-census.mjs` now cross-checks the two. Two independent computations that must agree is
     * the point; a second, subtly different formula here would make the cross-check meaningless.
     *
     * `cover >= 8` is how a FULL TILING is told from a PARTIAL one: every dancer is inside some copy of
     * the variant (`groups x variantSize` covers the whole board), as against the partial fallback that
     * moves the boxes that matched and leaves the rest standing.
     */
    const readingOf = (res: ApplyResult): FsmReading => {
      if (!res.parallel) return 'whole';
      const cover = res.parallel.groups.length * res.parallel.variant.dancers.length;
      return cover >= 8 ? 'full-tiling' : 'partial';
    };
    /**
     * An edge's end is one of the table's states, or an EXPLICIT `null`.
     *
     * `legalCalls` admits a call whenever it APPLIES, so a legal application can end on a board the
     * namer refuses (a tied best match, a dancer outside the effective allowance). `recognize` is the
     * narrower, curated recogniser and returns null for many more boards. Two ways a curated name can
     * fail to be a state, and both fall back: it can be null (the board is real but not one of the
     * curated STANDARD_FORMATIONS), or it can name a formation the geometry DEDUPE above folded into
     * another key.
     *
     * WHY THE END IS NOT CLOSED OVER AS A NEW STATE, with the measurement that settled it. The plan
     * was a closure pass: add each unnamed end as a state and enumerate it in turn. MEASURED, that
     * DIVERGES - the geometry of an eight-dancer board is continuous, and the successors of the
     * off-grid setups never close. Taken faithfully to this function's own `addState` dedupe
     * (`matchFormations(dancers, existing, 1.0)`), starting from this table's 155 states:
     *
     *     level 1 alone   1840 NEW geometries   (whole 585, full-tiling 743, partial 512)
     *     closure         3005 states after enumerating 400, still growing
     *
     * A cap would only hide it, and a table of thousands of unnamed `#N` nodes is not a state machine
     * a caller can read. So the END IS RECORDED, NOT INVENTED: `endFormation: null` says the call
     * applies and leaves a board this engine cannot name. That is the honest reading, it keeps the
     * state set at the formations the engine actually knows, and it is exactly what
     * `reading-census.mjs` measured as missing -- those applications used to be dropped from the list
     * altogether, so the FSM recorded NOTHING rather than recording "unnamed".
     *
     * The consumer side used to tolerate it by SKIPPING: `FsmTableEdge.endFormation` is `string | null`
     * and `poc/src/fsm-view.ts` dropped every null end when it built the graph. Schema 2 records WHY the
     * end is null (`FsmEndKind`), which is what lets the view draw the transient rather than hide it and
     * what tells Stage 3 which transients a level bump would close (`out-of-scope`) from those no level
     * will (`novel`).
     *
     * AN END IS RESOLVED BY GEOMETRY WHEN THE NAME FAILS, and without that the new `endKind` field would
     * have been WRONG ON MOST OF ITS EDGES. MEASURED over the 42 named ms states: of the 924 edges the
     * name lookup could not resolve, **496 land on a state's own geometry** - 464 of them on an
     * `@embed#N` state, a node with no name, and 32 on a named state whose namer answer was refused. A
     * table whose nodes are geometries was answering "no target" for edges that end ON a node, because
     * the only way it looked for one was by NAME.
     *
     * THE GEOMETRY MATCH IS UNAMBIGUOUS BY CONSTRUCTION, which is why it is a safe fallback rather than a
     * second, competing naming rule. `addState` FOLDS a candidate into an existing state at exactly this
     * tolerance (`matchFormations(dancers, existing, 1.0)`), so the surviving state geometries are
     * pairwise more than 1.0 apart and a board can match at most one of them. The NAME still wins wherever
     * there is one: it is the readable answer and the one the namer is curated for, and the scan is the
     * fallback for the case the name path structurally CANNOT express - an unnamed node.
     */
    const stateGeometries = [...stateGeo.entries()];
    const enumerate = (state: string): Omit<FsmTableEdge, 'source'>[] => {
      const geo = stateGeo.get(state);
      if (!geo) return [];
      // A NAMED STATE IS ENUMERATED FROM ITS CANONICAL BOARD, which is the same setup path the app
      // uses - ONE rule deliberately, because the alternative is the divergence class this repo keeps
      // paying for: the Set dropdown standing a caller on a zero line while the FSM enumerated the same
      // formation anonymously, so the two disagreed about which calls are legal from it.
      //
      // MEASURED by `test/tools/canonical-identity-probe.mjs`, and it is the reason this is not a small
      // change: identity is what the couple-dependent vocabulary READS, so an anonymous board REFUSES
      // calls that are legal from the real formation. `Normal Lines` gains 56 legal calls (347 -> 403),
      // `Normal Lines Compact` 48, `Eight Chain Thru` 50, `Ocean Waves` 27, `Two-Faced Lines` 9 - all
      // gains, no losses, and every one of them a `Heads ...`/`Sides ...`/`Beaus`/`Belles`/`Couples`
      // call that cannot be evaluated at all without couples. Enumerating the anonymous board was
      // answering "this call is not legal here" for calls the engine simply could not read.
      //
      // ONLY A NAMED STATE THE REGISTRY COVERS IS AFFECTED. `@embed#N` has no name to look up and the
      // other 38 named states have no authority-backed setup, so they stay anonymous - which is also
      // what keeps this from being a vocabulary-wide change: it is four states.
      //
      // The identity is applied ON TOP of the state's OWN board, so the geometry, headings, declared
      // genders and dancer order the enumeration was already using are untouched. If the assignment's
      // spots do not match this geometry, `identifyByAssignment` returns the board UNCHANGED rather
      // than half-identified, so a disagreement degrades to today's behaviour, not to a wrong board.
      const anon = this.boardFromMatchables(geo);
      const board = this.setupIdentifiedBoard(state, anon) ?? anon;
      return enumerable(board).map(({ call, res }) => {
        const reading = readingOf(res);
        if (!res.legal) {
          // Unreachable through `enumerable`, which admits only applications that apply - kept as an
          // explicit classification rather than an undefended `null`, so a future caller of this shape
          // cannot silently lose the distinction.
          return { call, endFormation: null, reading, endKind: 'novel' as const, orientationDelta: 0 };
        }
        const curated = this.matcher.recognize(res.board).name;
        // `named` is what the CORPUS can call the board, `end` is a state of THIS table. Keeping them
        // apart is the whole of `endKind`: a board the corpus names but this table does not model is
        // 'out-of-scope' (the level scope removed it), and one the corpus cannot name either is 'novel'.
        const named = curated !== null && keyOf.has(curated) ? curated : this.matcher.knownFormation(res.board);
        let end: string | null = named === null ? null : keyOf.get(named) ?? null;
        if (end === null) {
          // A `SeqDancer` carries x, y and heading, which is what `matchFormations` reads - it is the
          // same shape `boardFromMatchables` feeds the matcher.
          const dancers = res.board.dancers as unknown as Matchable[];
          for (const [key, g] of stateGeometries) {
            if (matchFormations(dancers, g, 1.0) !== null) { end = key; break; }
          }
        }
        const endKind: FsmEndKind = end !== null ? 'state' : named !== null ? 'out-of-scope' : 'novel';
        return { call, endFormation: end, reading, endKind, orientationDelta: 0 };
      });
    };
    return FsmTable.build(states, enumerate, this.fsmStore.all(), embeddedInfo);
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
   * formation, and NONE of its constituent calls may be non-compositional.
   *
   * A GROUPED ("while") step contributes EVERY group's call to that check. It needs no other rule:
   * each dancer follows exactly one call per step, so the per-dancer composition below is already the
   * right shape for it - which is what keeps the matrix transform working across the new form. */
  moduleCollapsible(module: string, startFormation: string): boolean {
    const calls = this.library.getModule(module);
    if (!calls || calls.length === 0) return false;
    const named = calls.flatMap((c) => (isGroupStep(c) ? c.groups.map((g) => g.call) : [stepCall(c) ?? '']));
    if (named.some((n) => this.library.isNonCompositional(n))) return false;
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
      const res = typeof c === 'string' ? this.applicator.applyToBoard(board, c) : this.applicator.applyStep(board, c);
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
  sequenceBeats(flat: ModuleStep[], startBoard?: Board): number {
    return this.analyzer.sequenceBeats(flat, startBoard);
  }

  /** The board at a global beat of a flat sequence replayed from `startBoard`
   * (default: the home squared set). */
  evaluateSequence(flat: ModuleStep[], beat: number, startBoard?: Board): { board: Board; beats: number } {
    return this.analyzer.evaluateSequence(flat, beat, startBoard);
  }

  /** Where a flat sequence stops being playable, or null when it plays all the way. A caller that
   * draws a sequence should say so rather than let the last frame silently render the board before
   * the call that could not be played - see `SequenceAnalyzer.sequenceStop`. */
  sequenceStop(flat: ModuleStep[], startBoard?: Board): SequenceStop | null {
    return this.analyzer.sequenceStop(flat, startBoard);
  }

  sequenceInfo(flat: ModuleStep[], beat: number, startBoard?: Board): { name: string; variant: CallBundle; mapping: number[] } | null {
    return this.analyzer.sequenceInfo(flat, beat, startBoard);
  }

  phrasesForBeats(beats: number): number {
    return this.analyzer.phrasesForBeats(beats);
  }

  validateSegment(flat: ModuleStep[]): { totalBeats: number; phrases: number; complete64: boolean; remainder: number } {
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

  /**
   * Pairs of dancers whose BODIES overlap on this board.
   *
   * WAS A CENTRE-DISTANCE TEST and that was the wrong measure — the repository recorded the 1.0-versus-
   * 1e-3 disagreement between this and `BODY_COLLISION_MIN` without noticing that neither could be
   * right, because a dancer is not round. `bodies.ts` owns the argument; the short version is that
   * partners stand 2.0 apart facing the SAME way (clear) while two dancers 0.5 apart FACING EACH OTHER
   * overlap, and no threshold on centre distance separates those two cases.
   *
   * `eps` is retained as the slack callers can pass; the body model supplies the actual extents. The
   * default is `BODY_OVERLAP_EPS`, which is the tolerance the model itself uses, so the default reading
   * matches `bodyOverlap`.
   */
  collisions(board: Board, eps = BODY_OVERLAP_EPS): { id1: number; id2: number }[] {
    const ds = board.dancers.filter((d) => !d.isGhost);
    const out: { id1: number; id2: number }[] = [];
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        // Deliberately the SAME predicate as `bodyOverlap`, not a second copy of the geometry.
        if (bodyGap(ds[i], ds[j]) < -eps) out.push({ id1: ds[i].id, id2: ds[j].id });
      }
    }
    return out;
  }

  /**
   * The closest body pair on a board, or null when there is nothing to compare. The REPORTING form of
   * `collisions`: a caller that wants the worst offender and how bad it is, not a boolean.
   */
  closestBodies(board: Board): BodyPair | null {
    return worstBodyGap(board);
  }

  /**
   * Body collisions anywhere in a whole sequence's ANIMATION, which is the question the per-board
   * `collisions` cannot answer.
   *
   * WHY THIS EXISTS. `collisions` inspects ONE board — in practice an endpoint — and an endpoint is
   * exactly where a call that walks two dancers through each other is LEAST likely to look wrong. The
   * squared-set `Dosado` is the worked example: its endpoint is a clean 2.000, while mid-motion two
   * bodies reach -0.390 of penetration. Nothing in the engine looked between the endpoints.
   *
   * Samples on a fixed beat grid (the `STEP = 0.5` convention `sequence-anim-collision-scan.mjs` uses,
   * so the tool and the guard agree by construction) and returns the worst pair found, or null when the
   * walk is clear throughout.
   */
  bodyCollisionsAt(flat: ModuleStep[], startBoard?: Board, step = 0.5): BodyPair | null {
    const start = startBoard ?? this.board;
    const beats = this.sequenceBeats(flat, start);
    if (beats <= 0) return null;
    let worst: BodyPair | null = null;
    for (let b = 0; b <= beats + 1e-9; b += step) {
      const board = this.evaluateSequence(flat, Math.min(b, beats), start).board;
      const found = worstBodyGap(board);
      if (found && (!worst || found.gap < worst.gap)) worst = found;
    }
    return worst;
  }
}
