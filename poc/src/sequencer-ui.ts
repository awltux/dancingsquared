// Sequencer UI controller: build/validate a call sequence on the 3D board.
// Encapsulates the sequence panel's state (the board, playhead, history,
// modules) and DOM wiring behind a class, so the animation/apply/undo logic no
// longer lives in one large closure.

import * as THREE from 'three';

import { Sequencer, computeHandholds, sampleTrail, splitSelection, parseAll8Figures, formatAll8Figures, boardForFasrCode, FORMATIONS_FOR_LETTER, fasrooOf, isGroupStep, groupCalls, EXACT_TOL, setupId } from 'dancing-squared-engine';
import type { Board, CallStep, FormDancer, GroupStep, Matchable, ModuleStep, Pose, SequenceStop } from 'dancing-squared-engine';
import { stepLabel, CODED_MOVES } from 'dancing-squared-engine';
import { movesXmlText, formationsXmlText, availableLevels, sequencerCallsUpTo, availableSetups } from './data';
import type { SetupRow } from './setup-catalogue';
import { validCederModules } from './ceder-modules';
import { callKey, LETTER_TEMPLATE, MODULES_STORAGE_KEY, resolveStartFormation } from './modules';
import type { StartSpec } from './modules';
import { parseStoredModules } from './stored-modules';
import type { StoredModule } from './stored-modules';
import { loadUserFormations } from './formations';
import { corpusFormationsOfSize } from './tam-xml';
// THE NATIVE SEQUENCE DOCUMENT: the spec is `SequenceSyntax.md`, the rules are this module, and the panel only supplies
// the three live resolvers (the setup catalogue, the formation labels, the variant library).
import { idsOf, parseSequenceDoc, resolveSequence, resolveSetupRef, sequenceToJson, SEQUENCE_FORMAT, SEQUENCE_VERSION } from './sequence-json';
import type { SequenceDocJson, SequenceDancer, SequenceResolvers, SequenceStepJson, SetupRefJson, StepRefJson } from './sequence-json';
import { DancerView, buildHandConnectors, buildFlatMarker } from 'dancing-squared-stage';
import { displayCouple } from 'dancing-squared-stage';
import { compareCallTitles } from './call-order';
// THE NEXT-CALL LIST'S BOARD KEY, its own pure module: it decides whether a settle re-enumerates the catalogue
// (686-692 ms) or not, and the panel cannot be loaded by a probe (see `board-key.ts`).
import { boardKey } from './board-key';
import { el, esc } from './dom';
import { filterNames } from './call-filter';
import { rowSources, stepSource } from './step-source';
import type { CallSource } from './step-source';
import type { KeyBinding } from './keys';
import type { Stage, WalkCycle } from 'dancing-squared-stage';

export interface SequencerUI {
  setActive(active: boolean): void;
  render(): void;
  /** Load a named sequence whole and park the playhead at its first step that plays `atCall`. */
  openSequence(steps: ModuleStep[], atCall?: string, startFormation?: string): void;
  /**
   * The keyboard this panel owns, for `main.ts`'s one table. Panel-scoped by `when`, exactly as the editor's
   * are: a Space that pauses the sequence while the editor is on screen would be a shortcut for the wrong
   * panel. See `SequencerController.keyBindings`.
   */
  keyBindings(): KeyBinding[];
  /** The named formations a call of `dancers` dancers can be re-based onto, as start poses, for the
   *  editor's Start setup and End setup pickers. See the implementation for why the size matters. */
  startFormations(dancers: number): { name: string; poses: FormDancer[] }[];
  /** Everything the library can say about a board: the name it recognizes, the curated label,
   *  the FASR/OO notation, the arrangement number, and the raw gender pattern. Used by the browse
   *  panel's end-formation field, and deliberately returned as plain data so the panel formats it
   *  rather than re-deriving it. */
  readBoard(board: Board): BoardRead;
  /** Add a user-defined formation to the live library, so boards like it are named from now on. */
  registerFormation(name: string, dancers: Matchable[]): void;
}

/** One undo/redo point: the whole sequence, and the board it replays from. See `pushUndo`. */
interface HistorySnapshot {
  steps: ModuleStep[];
  startBoard?: Board;
}

/** What the library can say about a board. `name` is the permissive read (`knownFormation`), which
 *  is the one that can name a user-defined formation; `curated` is the stable display label
 *  (`recognize`, restricted to the curated list). */
export interface BoardRead {
  name: string | null;
  curated: string | null;
  /**
   * The board's FORMATION ID (`formation-id.ts`) - the one identity that always exists, because it is
   * computed from the geometry rather than looked up. Shown beside the name, and shown INSTEAD of it where
   * no namer answers, which is the case it exists for: a rule can be keyed on an id and cannot be keyed on a
   * board with no name.
   */
  id: string;
  /** The All8 formation letter, when the board's formation maps to one. */
  letter: string | null;
  /** The Callerlab arrangement number (0 normal, 5 half-sashayed), when it can be read. */
  arrangement: number | null;
  sequence: number | null;
  relationship: string | null;
  /** e.g. `[0B1p]`, `?` where a part cannot be determined. */
  notation: string;
  /** Whether `name` came from a user rather than from `formations.xml`. */
  userDefined: boolean;
  /** Dancer count - a formation is only matched against a board of the same size. */
  dancers: number;
  /** The board's genders in array order, e.g. `BgBgBgBg`. Always available, named or not. */
  genderPattern: string;
}

/**
 * ONE FIGURE IN PROGRESS: the boards it replays on, the history entry it replaces, and its lanes.
 *
 * Every field is documented where the mode is held (`SequencerController.parallel`), and the value is
 * written in ONE place (`setParallel`) - because the panel's mode edge, its primary button and its group
 * selector are three separate readings of it, and a second writer of the state is a second writer of those.
 */
interface ParallelEntry {
  start: Board;
  board: Board;
  index: number;
  groups: { selection: string; calls: string[] }[];
  active: number;
}

const MS_PER_BEAT = 500;

/**
 * Why the FASROO readout carries a `?` marker.
 *
 * FASROO is [arrangement][formation][sequence][relationship] + Orientation + Occupation, e.g. `[0L1pH+]`,
 * and it is what makes a board a SETUP rather than a class of boards: the plain FASR part admits FOUR
 * boards - the four orientations - and says nothing about which one it is.
 *
 * The marker is not decoration. This engine's Orientation CONSTRUCTION is unverified: All8 defines it by
 * superimposing the squared set, where the reference boy's home is a spot that does not exist in a line
 * or a wave, and `fasrooOf` compares bearings about the formation centre instead. The four boards do
 * separate cleanly one-per-orientation, so the structure holds, but the absolute letter - and the R/L
 * handedness, which is a convention only All8's diagrams state - must not be trusted yet.
 */
const FASROO_ORIENTATION_NOTE =
  'FASROO = FASR + Orientation + Occupation. The Orientation letter here is UNVERIFIED: the engine compares bearings about the centre, where All8 superimposes the squared set. Treat the letter as indicative.';

export class SequencerController implements SequencerUI {
  private stage: Stage;

  // DOM elements.
  private levelSelect = el<HTMLSelectElement>('seqLevel');
  /** Where the sequence is standing: the formation the replay starts from, plus the All8 code for it. */
  private boardChipEl = el<HTMLSpanElement>('seqBoardChip');
  /** The figure ("while") banner - only on screen while a figure is being built. */
  private figureBarEl = el<HTMLDivElement>('seqFigureBar');
  private figureWhatEl = el<HTMLSpanElement>('seqFigureWhat');
  private marginInput = el<HTMLInputElement>('seqMargin');
  private groupSelect = el<HTMLSelectElement>('seqGroup');
  private callSelect = el<HTMLSelectElement>('seqCallSelect');
  /** Narrows the picker's offered names. See `filterNames` in `call-filter.ts`. */
  private callFilterInput = el<HTMLInputElement>('seqCallFilter');
  private applyBtn = el<HTMLButtonElement>('seqApply');
  private undoBtn = el<HTMLButtonElement>('seqUndo');
  private redoBtn = el<HTMLButtonElement>('seqRedo');
  private resetBtn = el<HTMLButtonElement>('seqReset');
  private totalsEl = el<HTMLSpanElement>('seqTotals');
  private statusEl = el<HTMLDivElement>('seqStatus');
  // The Solve drawer: three questions, one Search, one Apply, and the results as clickable lines.
  private tabGetoutBtn = el<HTMLButtonElement>('seqTabGetout');
  private tabGetinBtn = el<HTMLButtonElement>('seqTabGetin');
  private tabFixBtn = el<HTMLButtonElement>('seqTabFix');
  private solveRunBtn = el<HTMLButtonElement>('seqSolveRun');
  private solveApplyBtn = el<HTMLButtonElement>('seqSolveApply');
  private matrixFirstInput = el<HTMLInputElement>('seqMatrixFirst');
  private solveInfoEl = el<HTMLSpanElement>('seqSolveInfo');
  // The transport: play, step, beat, scrub, speed - pinned under the timeline.
  private playBtn = el<HTMLButtonElement>('seqPlay');
  private stepBackBtn = el<HTMLButtonElement>('seqStepBack');
  private stepFwdBtn = el<HTMLButtonElement>('seqStepFwd');
  private scrub = el<HTMLInputElement>('seqScrub');
  private beatInput = el<HTMLInputElement>('seqBeatInput');
  private speedSelect = el<HTMLSelectElement>('seqSpeed');
  private copyPosBtn = el<HTMLButtonElement>('seqCopyPos');
  private beatEl = el<HTMLSpanElement>('seqBeat');
  // The Board drawer, and the Library drawer.
  private formationSelect = el<HTMLSelectElement>('seqFormation');
  private setFormationBtn = el<HTMLButtonElement>('seqSetFormation');
  private boardRotInput = el<HTMLInputElement>('seqBoardRot');
  private view2dEl = el<HTMLSelectElement>('seqView2d');
  private parallelBtn = el<HTMLButtonElement>('seqParallel');
  private parallelDoneBtn = el<HTMLButtonElement>('seqParallelDone');
  private matrixInfoEl = el<HTMLDivElement>('seqMatrixInfo');
  private seqListEl = el<HTMLDivElement>('seqSequence');
  private fasrEl = el<HTMLDivElement>('seqFasr');
  private fixListEl = el<HTMLDivElement>('seqFixList');
  private moduleNameInput = el<HTMLInputElement>('seqModuleName');
  private saveModuleBtn = el<HTMLButtonElement>('seqSaveModule');
  private modulesEl = el<HTMLDivElement>('seqModules');
  private all8Text = el<HTMLTextAreaElement>('seqAll8Text');
  private all8ImportBtn = el<HTMLButtonElement>('seqAll8Import');
  private all8ExportBtn = el<HTMLButtonElement>('seqAll8Export');
  private all8InfoEl = el<HTMLSpanElement>('seqAll8Info');
  // THE NATIVE SEQUENCE DOCUMENT (JSON): `sequence-json.ts` is the format, this is its two buttons and its box.
  private jsonText = el<HTMLTextAreaElement>('seqJsonText');
  private jsonImportBtn = el<HTMLButtonElement>('seqJsonImport');
  private jsonExportBtn = el<HTMLButtonElement>('seqJsonExport');
  private jsonInfoEl = el<HTMLSpanElement>('seqJsonInfo');
  private subsetInfoEl = el<HTMLDivElement>('seqSubsetInfo');
  /**
   * THE SUBSETS THE CALLER HAS LIT UP, by the name the engine resolves them with. A SET rather than one
   * name, because "Subsets present" lists several and the question it answers is "who are these dancers?" -
   * so pressing two entries shows the union, and pressing one twice puts it out again.
   */
  private litSubsets = new Set<string>();
  /**
   * THE SUBSET NAMES THE LINE DOES NOT OFFER, because they mean the dancers an entry above already offers:
   * "Men", "Women" and "Ladies" resolve to exactly the dancers "Boys" and "Girls" do, so three of the nine
   * links were three more ways of saying what the first two said.
   *
   * A DISPLAY FILTER, NOT A VOCABULARY CHANGE, and the difference is load-bearing: the ENGINE keeps these
   * names because CALLS name them - "Ladies Chain" is a Ladies selection - and `refreshCallSelect` offers
   * grouped calls through the same `subsetGroups`, so dropping them there would take the call with them.
   */
  private static readonly SYNONYM_SUBSETS = new Set(['Men', 'Women', 'Ladies']);
  /**
   * WHERE A ROW'S CALL COMES FROM, as a two-or-three-character badge. Asked for as: "add a small marker to
   * indicate if a call used in a sequence is a CodedMove or from the catalogue."
   *
   * THE SENTENCES ARE THE POINT AND THE BADGE IS THE SHORTHAND. `D/C` on its own would read as "both", which
   * is not the fact: the fact is WHICH is tried first and WHEN it declines. The rule that decides which of the
   * five a step gets is `step-source.ts` - this table is only what each answer is called on screen, which is
   * why it lives here and the rule does not.
   */
  private static readonly SOURCE_MARK: Record<CallSource, { mark: string; cls: string; label: string }> = {
    derived: {
      mark: 'D', cls: 'src-derived',
      label: 'Derived: the engine computes this call from a coded rule; no authored tam is consulted.',
    },
    'derived+catalogue': {
      mark: 'D/C', cls: 'src-both',
      label: 'Derived FIRST, catalogue as the fallback: the coded rule is tried first and declines to the authored tam on a board it cannot read.',
    },
    catalogue: { mark: 'C', cls: 'src-cat', label: 'Catalogue: this call is danced from an authored tam.' },
    mixed: {
      mark: '\u00b1', cls: 'src-mixed',
      label: 'Several calls with different sources, so no one badge describes the row.',
    },
    module: {
      mark: 'M', cls: 'src-module',
      label: 'A stored module: a sequence of calls, which has no single source at all.',
    },
  };
  /**
   * The DANCER IDS those names resolve to, kept because `applyView` runs on every mode and tab change and
   * has to gate the rings without re-resolving the selections - see `applySubsetMarks`.
   */
  private litIds = new Set<number>();
  /**
   * THE SETUPS THE BOARD PICKER OFFERS, in display order: one row per `sid` (see `poc/src/setup-catalogue.ts`).
   * The select's VALUE is the row's `sid`, which is also how the current board is reflected back into it.
   */
  private setupRows: SetupRow[] = [];

  // State.
  private seq: Sequencer;
  /** The panel's own box, for the `seq-figure` mode edge. */
  private hudEl = el<HTMLDivElement>('hud');
  /** The busy lock's overlay and its caption, shown over the whole HUD while `runBusy` works. See `beginBusy`. */
  private busyEl = el<HTMLDivElement>('seqBusy');
  private busyLabelEl = el<HTMLSpanElement>('seqBusyLabel');
  private views: DancerView[] = [];
  /** Flat 2D markers, one per dancer, shown when View = 2D. */
  private markers: THREE.Group[] = [];
  private connectors: ReturnType<typeof buildHandConnectors>;
  private history: ModuleStep[] = [];
  /**
   * PARALLEL-CALL MODE. Set when the caller is giving the dancers the last call did NOT move their own
   * call in the SAME time slot. Holds everything the offer needs:
   *   - `board`   the board the ACTIVE lane's next call starts on. It begins as the board the first call was
   *               applied FROM - which is the board the remainder must be resolved on, because the live
   *               board is already after the first call - and advances by one call each time the caller
   *               appends to that lane, so the picker always asks `groupCanPerform` the question that
   *               matches the call about to be picked. A NEW lane starts back on `start`.
   *   - `start`   the board the STEP starts from - the board the first call was applied FROM. It never
   *               moves, and it is the board the composed step is CHECKED on: the live board has already
   *               been replayed past the step, so applying the step there would apply it twice.
   *   - `index`   the history entry to replace, so the whole figure is ONE step rather than several.
   *   - `groups`  the lanes, in order: each is a selection and the calls that selection has been given.
   *               The first is the call the caller applied; the rest are the remainder's lanes. ONE CALL is
   *               the ordinary "while" partner; TWO OR MORE is a lane - that group dances them back to back
   *               in the same slot, which is how a 16-beat call is filled by two 4-beat ones. A lane with
   *               an empty `calls` is one the caller has just opened and not yet filled.
   *   - `active`  which lane Apply appends to.
   *
   * THREE OR MORE LANES, asked for with a five-call example (`call 1 || ( call 2 + call 3 ) || ( call 4 +
   * call 5 )`). The button used to mean "finish the step" once the lane had a call, so a caller starting a
   * THIRD group had the step silently rewritten and their next call landed as a NEW entry in the list -
   * reported as "when I add a third call to a parallel call ... it seem to be added to the call list as a
   * new call". It now opens another lane and Done is the way out.
   */
  private parallel: ParallelEntry | null = null;
  /**
   * The caller's saved modules, as the STORE holds them: the steps plus the two boards they dance between.
   * `StoredModule` rather than the engine's `Module`, because the engine is told the boards separately when a
   * module is registered (`registerModule`) and the drawer has to render what the caller actually saved.
   */
  private modules: StoredModule[] = [];
  private active = false;
  /** Display-only rotation (radians) applied about the set centre so the whole
   * board can be aligned against the reference grid (e.g. 45°). */
  private boardRot = 0;
  /**
   * True = draw 2D markers on the overlay canvas instead of 3D avatars.
   *
   * READ OFF THE CONTROL rather than hardcoded, so the sequencer cannot open drawing one thing while
   * `seqView2d` names another: the select carries the default (`2d` is the `selected` option) and NO
   * `change` event fires at startup, so a literal here would only be corrected the first time the caller
   * touched the select. It is the same opening pose as the other two views - the browse view opens 2D
   * (`browser.ts`'s `use2d = true`) and so does the editor (`edView2d` is `checked` in `index.html`).
   */
  private use2d = this.view2dEl.value === '2d';
  private playing = false;
  private playhead = 0;
  private totalBeats = 0;
  private flat: ModuleStep[] = [];
  /** The board the current sequence replays from. Undefined means the home
   * squared set; it is set to the board when a formation is jumped to with
   * "Set", so playback, trails and copy agree with the live board. */
  private startBoard: Board | undefined;
  /** The first call in the sequence that cannot be played from the board it reaches, if any. See
   * `syncAnimation` and `renderPlayhead`: without it a sequence that stops early looks complete, and
   * its last frame is the start board of the call it stopped on. */
  private stop: SequenceStop | null = null;
  /** The board the next-call list was last built for. See `settlePlayhead`. */
  private listBoardKey = '';
  /** What the picker last offered, for the composer's hint: how many of how many, and under what query. */
  private pickerCounts = { shown: 0, total: 0, query: '' };
  /** The start beat of every timeline row, computed once per rebuild and reused PER FRAME by
   *  `stepAtPlayhead` - a `sequenceBeats` call per frame would be a replay of the whole sequence 60 times a
   *  second. */
  private stepStarts: number[] = [];
  private lastActiveStep = -1;
  private lastFrame = performance.now();
  private lastTraceKey = '';
  /** The identity the dancer VIEWS were built for. See `viewKeyOf` and `renderBoard`. */
  private viewKey = '';
  private lastReadout = '';
  /**
   * UNDO/REDO AS SNAPSHOTS OF `history`, not as a stack of inverse operations.
   *
   * The history is the whole of the sequence and every edit path already rebuilds it, so a snapshot is both
   * the smallest code and the only correct answer for the operations that are NOT one step: `Apply getout`
   * used to push one entry per call and an All8 import replaces the lot, so "undo" peeled them off one at a
   * time. Each of those is now ONE undo because each takes ONE snapshot.
   */
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  /** The timeline row the keyboard acts on: `Delete` removes it. */
  private selectedStep = 0;
  /** The Solve drawer's state: which question, its results, and which result Apply acts on. */
  private solveTab: 'getout' | 'getin' | 'fix' = 'getout';
  private solveLines: { label: string; calls: string[] }[] = [];
  private solveChosen = 0;
  /**
   * THE BUSY LOCK. `busy` IS the lock: while it is on, the HUD is non-interactive (`#hud.seq-busy`),
   * `aria-busy` is set, and the working bar is up - `runBusy` is the only thing that sets or clears it.
   * `busyRunning` is true only INSIDE the wrapped work, and it is what tells a NESTED call (Import reaching
   * Clear through `reset`) apart from a SECOND CLICK inside the yield window. The whole rule is in `runBusy`.
   */
  private busy = false;
  private busyRunning = false;

  constructor(stage: Stage) {
    this.stage = stage;
    this.connectors = buildHandConnectors(stage.scene);
    // THE USER'S FORMATIONS GO IN FIRST, AND THE CALLS SECOND, because a call is BUILT when it is
    // registered: a saved call that names its start formation (`formation="Name"`, which is how a
    // created setup is exported once its formation is in the corpus) resolves against what the library
    // already has. Registering the calls first made such a call fail with "No formation ..." and the
    // library does not retry.
    this.seq = new Sequencer(movesXmlText, formationsXmlText, []);
    // AFTER the corpus is in, so the user's own shapes are added to a library that already has it
    // rather than being deduped against a half-built one.
    this.registerUserFormations();
    for (const c of sequencerCallsUpTo('ms')) this.seq.register(c.name, c.xml);
    // THE SETUP CATALOGUE BEFORE THE MODULES, because a saved module records its start board BY ID and restoring it
    // needs the catalogue that resolves an `sid`. It was built after the restore, so a stored start could not be
    // resolved at registration time and the module had to be registered ungated - a rule that applies on a level change
    // and not at startup is worse than no rule.
    this.populateFormations();
    this.loadModules();
    // RESTORE BEFORE DRAWING, so the drawer can ask the library whether each module actually registered.
    // It drew first, which made every row look live - including one the engine had refused.
    this.restoreModules();
    this.refreshModulesList();
    this.registerCederModules();

    for (const lv of availableLevels()) this.levelSelect.add(new Option(lv.toUpperCase(), lv));
    this.levelSelect.value = 'ms';
    // THE LEVEL DECIDES WHICH PERMISSION RULES ARE IN FORCE, not just which calls are registered. A rule
    // from a level above this one is not consulted: `sequencerCallsUpTo` has not registered those calls,
    // so it could not apply them anyway. See `engine/src/sequencer/permissions.ts`.
    this.seq.setActiveLevel(this.levelSelect.value);
    this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);

    this.wireEvents();
    // AFTER the catalogue is in, so the user's own shapes are added to a library that already has
    // the corpus in it rather than being deduped against a half-built one.
    this.registerUserFormations();
    this.refreshCallSelect();
    this.renderSubsetInfo();
    this.requestFrame();
  }

  /**
   * Fill the Board picker with the corpus's SETUPS, one option per `sid`.
   *
   * NOT THE LIBRARY'S NAMES. `listFormations()` is `CallLibrary.getUniqueFormations()`, keyed on geometry up to
   * congruence - one representative per SHAPE - so every setup that shares an `fid` with a listed name was hidden:
   * `Normal Lines`/`Sashayed Lines` are one shape and two arrangements, `Columns`/`Column RH GBGB` likewise, and
   * the setups carried only as a call's inline `<formation>` block were not in the name list at all. The catalogue
   * (`poc/src/setup-catalogue.ts`) reads every definition, completes the half sets, dedupes by `sid` and labels each
   * row `[shape name] setup name`; the ids and the derivation are pinned by `poc/tools/setup-picker-probe.mjs`.
   *
   * THE OPTION'S `title` CARRIES THE IDS: the three tags, the other names the same setup was authored under
   * (`Static Square`/`Squared Set`) and where the element lives. The list is ordered by shape name then setup name,
   * so `[Lines] Normal Lines` sits under `[Lines]`.
   */
  private populateFormations() {
    const prev = this.formationSelect.value;
    this.formationSelect.innerHTML = '';
    this.formationSelect.add(new Option('— current board —', ''));
    this.setupRows = availableSetups(loadUserFormations()).rows;
    for (const row of this.setupRows) {
      const option = new Option(row.display, row.sid);
      option.title =
        `${row.sid} · ${row.fid} · ${row.aid}` +
        (row.aliases.length ? ` · also: ${row.aliases.join(', ')}` : '') +
        ` · ${row.source}`;
      this.formationSelect.add(option);
    }
    this.formationSelect.value = prev && this.setupRows.some((r) => r.sid === prev) ? prev : '';
  }

  /**
   * The named formations a call of `dancers` dancers can be re-based onto, as start poses: what the
   * editor's "Start setup" and "End setup" pickers are built from.
   *
   * THE SIZE IS THE WHOLE POINT OF THE ARGUMENT. Both pickers used to be filled from the sequencer's
   * formation library, which is eight dancers only, so a FOUR-dancer call - and 212 of the catalogue's
   * 547 calls are four-dancer - was offered a list of formations every one of which is refused: by
   * `setStartFormation` for a start, and out loud by `doEndFormation` for an end. The picker could not
   * express the call's own start, which is the one thing it is for.
   *
   * ONE SOURCE, EVERY SIZE, AND IT LISTS ARRANGEMENTS. The 8-dancer case used to keep the library's
   * own `listFormations()`, on the reasoning that widening it is an engine change pinned by
   * `engine/test/shape-census.mjs` and walked by four engine harnesses. That reasoning about the ENGINE
   * is still right, and the engine's lists are still untouched - `getUniqueFormations()` is where
   * `knownFormation`, the matcher's snap scan and the FSM's state vocabulary read from, and it is NOT
   * this function. What was wrong was filling a PICKER from it. The library's key is GEOMETRY UP TO
   * CONGRUENCE, which is right for recognising a board and wrong for choosing a name, and it hid the
   * corpus's own arrangements. MEASURED on the corpus's columns - each authored as four, completed to
   * eight by the half-set rule - `Columns`, `Column RH GBGB`, `Columns LH` and `Column LH GBGB` all stand
   * on the same four spots, and they are THREE arrangements, not one: the first two are identical spot
   * for spot, `Columns LH` is the 180-degree ROTATION of them (every dancer at the antipode of the
   * other's spot, facing the other way), and `Column LH GBGB` is `Columns LH` with the genders swapped.
   * Reported as "I need to see Arrangements, not Formations".
   *
   * `corpusFormationsOfSize` keys on the POSITION, HEADING AND GENDER AT THE SAME SPOT, so it keeps all
   * three, and it filters by `dancers` - so a call is never offered a formation whose count differs from
   * its own. MEASURED over `formations.xml`: of the corpus's 211 eight-dancer names it keeps 201
   * arrangements, against 176 under the congruence key; at four dancers, 48 of 51 against 38. The 134
   * names the library knows are all represented - each is either offered or folded onto an identical
   * board under the other spelling ("Static Square" and "Squared Set" are the same board spot for spot),
   * and `engine/test/arrangement-picker.mjs` pins both halves of that.
   *
   * A size with no formations - sixteen dancers, which four calls have and `formations.xml` cannot
   * stand up - returns an empty list, and the picker then offers only "keep the current" and says so
   * rather than offering something that would be refused.
   */
  startFormations(dancers: number): { name: string; poses: FormDancer[] }[] {
    return corpusFormationsOfSize(dancers);
  }

  /**
   * Everything the library can say about a board.
   *
   * TWO READS, DELIBERATELY. `recognize` is the curated display label and refuses to guess (a board
   * merely CLOSEST to a standard name reports null), while `knownFormation` is permissive over the
   * whole library - which is the one that can name a formation the user just defined. Reporting both
   * means the panel can say "known as X, no curated label" instead of collapsing two different
   * answers into one.
   *
   * The ARRANGEMENT NUMBER needs a formation LETTER, which comes from the NAME - so an unnamed board
   * gets a `?` there and is not guessed at. The raw gender pattern is returned whatever happens,
   * because it is the one fact that needs no name at all.
   */
  readBoard(board: Board): BoardRead {
    const name = this.seq.knownFormation(board);
    const curated = this.seq.recognize(board).name;
    const f = fasrooOf(board, name);
    return {
      name,
      curated,
      // FROM `boardIdentity`, the same call the permission layer makes, so the id a caller READS here is the
      // id a rule is keyed on. A second computation would be a second answer to one question.
      id: this.seq.boardIdentity(board).id,
      letter: f.alignment.letter,
      arrangement: f.alignment.arrangement,
      sequence: f.alignment.sequence,
      relationship: f.alignment.relationship,
      notation: f.notation,
      userDefined: name !== null && this.seq.isUserFormation(name),
      dancers: board.dancers.length,
      genderPattern: board.dancers.map((d) => (d.gender === 'boy' ? 'B' : d.gender === 'girl' ? 'g' : '.')).join(''),
    };
  }

  /**
   * Put every stored user-defined formation into the CURRENT library.
   *
   * ONE PLACE, because a library that is built more than once needs it more than once: this runs
   * from the constructor and from `rebuildSeq`, and those are the only two places a Sequencer is
   * made. Registering is idempotent (the name list is a set and the geometry is deduped), so
   * running it twice is safe - which is what makes it safe to have it here rather than spread
   * across the callers.
   */
  private registerUserFormations() {
    const stored = loadUserFormations();
    for (const f of stored) this.seq.registerFormation(f.name, f.dancers);
    // A rebuilt library invalidates what the editor's clone picker was offered, and a newly
    // registered shape belongs in the formation dropdown.
    if (stored.length > 0) this.populateFormations();
  }

  /** Add a user-defined formation. It is tagged, so the panel can label it as such. */
  registerFormation(name: string, dancers: Matchable[]): void {
    this.seq.registerFormation(name, dancers);
    // A newly named shape can change what the formation dropdowns hold.
    this.populateFormations();
  }

  /**
   * Jump the board into the chosen SETUP and clear the current sequence.
   *
   * THE GEOMETRY COMES FROM THE CATALOGUE'S ELEMENT, NOT FROM THE LIBRARY: `setSetupBoard` takes the completed
   * dancers in the element's own ORDER, which is the half of the identity the FID cannot carry (`sid` = arrangement
   * AND order). A remembered value whose setup no longer exists is refused out loud rather than ignored.
   */
  private setBoardFormation() {
    const sid = this.formationSelect.value;
    if (!sid) return;
    const row = this.setupRows.find((r) => r.sid === sid);
    if (!row) {
      this.setStatus('error', `✗ unknown setup "${sid}"`);
      return;
    }
    this.seq.setSetupBoard(row.dancers, row.name);
    this.history.length = 0;
    this.playing = false;
    this.playhead = 0;
    this.totalBeats = 0;
    this.flat = [];
    this.playBtn.textContent = '▶ Play';
    this.lastTraceKey = '';
    // The sequence now begins from this setup, not from home.
    this.startBoard = this.seq.startBoard();
    this.statusEl.textContent = `board set to ${row.display}`;
    this.updateFormationSelect();
    this.render();
    this.refreshCallSelect();
    this.renderSubsetInfo();
    this.syncAnimation();
  }

  /** Apply the board-rotation override (degrees) from the control and redraw. */
  private applyBoardRot() {
    const deg = parseFloat(this.boardRotInput.value);
    this.boardRot = (isFinite(deg) ? deg : 0) * (Math.PI / 180);
    this.lastTraceKey = '';
    this.render();
    this.updateCurrentTrace();
  }

  /** Keep the Board picker reflecting the setup the board is standing in, by ID. */
  private updateFormationSelect() {
    const sid = setupId(this.seq.board);
    this.formationSelect.value = sid !== null && this.setupRows.some((r) => r.sid === sid) ? sid : '';
  }

  /** THE COMPOSER'S HINT LINE: what the picker is offering, and - while a figure is being built - which
   *  lane it is offering it to. It replaces the old "Subsets present" block, which said the same thing in
   *  three wrapped lines at the bottom of the panel. */
  private renderSubsetInfo() {
    // A FILTERED PICKER SAYS SO. A silent shorter list would leave the caller wondering which calls are in
    // the level at all, and it is also where "nothing matched" has to be visible.
    const c = this.pickerCounts;
    const filterNote = c.query
      ? (c.shown === 0
        ? `<b class="warn">nothing matches “${esc(c.query)}”</b> — clear the Filter to see all ${c.total}`
        : `${c.shown} of ${c.total} calls match “${esc(c.query)}”`)
      : '';
    if (this.parallel) {
      const un = this.unassignedLane();
      const lanes = this.parallel.groups.filter((g) => g.calls.length > 0);
      this.subsetInfoEl.innerHTML =
        `Figure: <b>${esc(stepLabel(this.parallelEntry(this.parallel)))}</b> — Add puts the picked call in ` +
        `<b>${esc(this.activeLane()?.selection ?? '')}</b>'s lane` +
        (lanes.length > 1 ? `, so <b>${lanes.length}</b> groups dance at once` : '') +
        (un ? `; <b>While…</b> opens a lane for <b>${esc(un)}</b>.` : '; every dancer has a lane.')
        + (filterNote ? ` · ${filterNote}` : '');
      return;
    }
    const groups = this.seq.subsetGroups(this.seq.board).filter((g) => !SequencerController.SYNONYM_SUBSETS.has(g));
    // A SUBSET THAT NO LONGER RESOLVES LOSES ITS LIGHT, because the panel must not go on claiming a
    // highlight for a group the board has moved out of - the name can survive a board change while the
    // dancers it meant do not.
    for (const n of [...this.litSubsets]) if (!groups.includes(n)) this.litSubsets.delete(n);
    this.subsetInfoEl.innerHTML = filterNote
      ? filterNote
      : (groups.length
        ? 'Subsets present: ' + groups.map((g) => this.subsetLink(g)).join(' · ') + '.'
        : 'No dancer subsets resolve on this board (whole-board calls only).');
  }

  /** ONE SUBSET AS A LINK, lit while it is showing. See `applySubsetMarks` for what pressing it does. */
  private subsetLink(name: string): string {
    const on = this.litSubsets.has(name);
    return (
      `<button type="button" class="subset-link${on ? ' on' : ''}" data-subset="${esc(name)}" ` +
      `title="${on ? 'Stop showing' : 'Show'} these dancers on the board">${esc(name)}</button>`
    );
  }

  /**
   * LIGHT THE DANCERS THE CHOSEN SUBSETS CLAIM, with the SAME ring the call editor draws around an edit's
   * selection (`DancerView.setSelected`: an amber circle on the floor, and NOT tied to whether the bodies
   * are drawn).
   *
   * THE SEQUENCER'S OWN VIEWS rather than the browse view's. `CallBrowser.setSelection` marks ITS dancers,
   * and in this mode those are not the ones on screen - routing the highlight through the browser would
   * set state on an invisible board and draw nothing. The sequencer already holds a `DancerView` per
   * dancer, so a lit subset is one call on each of them and the two modes stay identical by construction.
   *
   * THE IDS COME FROM THE ENGINE. `selectionIds` is the engine's own answer to "which dancers does this
   * selection claim", and an engine id is NOT an array position (`boardFromMatchables` stamps `id: i + 1`
   * for a board with no home identity), so the way back to a view is the board's own `id`.
   */
  private applySubsetMarks() {
    const board = this.seq.board;
    this.litIds = new Set<number>();
    for (const name of this.litSubsets) for (const id of this.seq.selectionIds(board, name) ?? []) this.litIds.add(id);
    board.dancers.forEach((d, i) => this.views[i]?.setSelected(this.active && this.litIds.has(d.id)));
  }

  private loadModules() {
    // THROUGH THE SHARED PARSER, which drops an entry that is not a module rather than trusting it: this runs
    // from the constructor, and `refreshModulesList` maps over the result - so a stored `{}` used to throw
    // during startup and take the whole app down.
    this.modules = parseStoredModules(localStorage.getItem(MODULES_STORAGE_KEY));
  }
  /**
   * Register the ceder-translated corpus modules that are fully replayable, WITH THE BOARD EACH ONE WAS WRITTEN FOR.
   *
   * THE START IS A GATE, NOT A LABEL: the engine only offers a module from a board that matches its declared start, so
   * this is what stops the 168 modules written for a Zero Line or Zero Box being offered from the home square (where
   * their first call or two apply and the rest refuse). A label this engine cannot stand up leaves the module ungated -
   * registered without a start, which is the behaviour it had before - rather than being dropped or gated on a board
   * that is not the one the corpus means.
   */
  private registerCederModules() {
    // THE LABELS ARE FEW AND THE MODULES ARE MANY (294 modules over three labels), and a board build is a formation
    // lookup: caching by LABEL makes this a handful of builds per level change instead of one pair per module. The cache
    // is local, so a level change rebuilds it and it cannot go stale against the library.
    const byLabel = new Map<string, Matchable[] | null>();
    const dancersFor = (label: string | undefined): Matchable[] | undefined => {
      if (!label) return undefined;
      if (!byLabel.has(label)) byLabel.set(label, this.startBoardFor(label)?.board?.dancers ?? null);
      return byLabel.get(label) ?? undefined;
    };
    for (const m of validCederModules()) {
      const start = dancersFor(m.startFormation);
      const end = dancersFor(m.endFormation);
      this.seq.registerModule(m.name, m.steps, { ...(start ? { start } : {}), ...(end ? { end } : {}) });
    }
  }
  private persistModules() {
    localStorage.setItem(MODULES_STORAGE_KEY, JSON.stringify(this.modules));
  }
  /**
   * Put every stored module into the CURRENT library, with the boards it recorded.
   *
   * A MODULE THE ENGINE REFUSES IS SKIPPED AND KEPT. `registerModule` throws when the name is already a
   * call, and this runs from the constructor and again on every level change (`rebuildSeq`), so an
   * unguarded loop would take the whole app down on startup for anyone who saved one before that rule
   * existed - which is exactly the sort of stored value `stored-modules.ts` already drops bad entries
   * for. It is NOT dropped here: the drawer still lists it, and that is the only way the caller can see
   * it and delete it. `refreshModulesList` marks it, and the delete path does not care why it is dead.
   *
   * A START THE CATALOGUE CANNOT RESOLVE LEAVES THE MODULE UNGATED, rather than unregistered: the store said where it
   * begins, this build cannot stand that board up, and a module missing from the picker is a module the caller cannot
   * use at all. The drawer's load reports the same refusal by name when the module is clicked.
   */
  private restoreModules() {
    for (const m of this.modules) {
      try {
        this.seq.registerModule(m.name, m.calls, this.storedBoards(m));
      } catch {
        // Left in `this.modules` on purpose; see above.
      }
    }
  }
  /** The boards a stored module recorded, as the engine's matcher takes them: geometry, with identity where known. */
  private storedBoards(m: StoredModule): { start?: Matchable[]; end?: Matchable[] } {
    const read = (ref: SetupRefJson | undefined, what: string): Matchable[] | undefined => {
      if (!ref) return undefined;
      const resolved = resolveSetupRef(ref, this.sequenceResolvers(), what);
      return 'reason' in resolved ? undefined : resolved.start.dancers;
    };
    const start = read(m.start, 'module start');
    const end = read(m.end, 'module end');
    return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
  }
  /**
   * The saved modules, each one CLICKABLE to load it, with a `×` to delete it.
   *
   * A module could only be reached through the picker before, which lists it among 2206 calls; the library
   * drawer is where a caller looks for their own saved sequences, so the name is the action. Loading goes
   * through `openSequence`, the same entry point the browse view uses, so a module loaded from here and one
   * loaded from a call's "used by" list behave identically - including the start-formation handling.
   *
   * THE DELETE IS OUTSIDE THE CLICKABLE SPAN rather than inside it. The span IS the load action, so a
   * `×` nested in it would have to stop the event to avoid doing both at once; as a sibling there is no
   * propagation to fight, and the two controls cannot be hit by the same click.
   */
  private refreshModulesList() {
    const row = (m: StoredModule, i: number) => {
      // NOT REGISTERED: the engine refused the name, because it is already a call. The row STAYS LISTED -
      // that is the only way the caller can see it and delete it - and it SAYS SO, because a row that
      // quietly does nothing when clicked is the same silent failure the refusal exists to end. The engine
      // is asked rather than a flag remembered, so the marker cannot disagree with the library.
      const live = this.seq.isModule(m.name);
      // ESCAPED even though both branches are literals with no quote in them: the rule is that markup
      // interpolates through `esc()`, and a future edit to a message is exactly how a quote gets in.
      const title = live
        ? 'Load this module into the sequence'
        : 'This module is NOT registered: its name is already a call, and a module takes its name over, so the engine refused it. Delete it, or save it again under a name of its own.';
      return `<span class="seq-module" data-mod="${i}" title="${esc(title)}">`
        + `<b>${esc(m.name)}</b></span>`
        // WHERE IT STARTS AND ENDS, from the module's own record. A module saved before the fields existed has no start
        // and gets no badge - it loads from home, and pretending otherwise would be a claim the store cannot support.
        + (m.start
          ? ` <span class="seq-mod-boards" title="The board this module was saved on, and the board it ends on: loading it stands the dancers up there, and the end is what says which calls may follow it.">`
            + `${esc(m.start.name ?? 'unnamed board')} → ${esc(m.end?.name ?? 'unnamed board')}</span>`
          : '')
        + `: ${esc(m.calls.map(stepLabel).join(' · '))}`
        + (live ? '' : ' <i class="seq-mod-dead">not registered — its name is already a call</i>')
        + `<button class="seq-mod-del" data-mod-del="${i}" aria-label="Delete saved module ${esc(m.name)}"`
        + ' title="Delete this saved module for good: it goes from this list, from this browser\'s storage,'
        + ' and from the call picker. The sequence on the board is NOT touched, so Save module puts it back.">×</button>';
    };
    this.modulesEl.innerHTML = this.modules.length
      ? this.modules.map(row).join('<br>')
      : '<i>(no modules saved yet — Add calls and press Save module)</i>';
  }

  private applyMargin() {
    this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);
    this.refreshCallSelect();
  }

  private rebuildSeq() {
    this.runBusy(() => {
      // THE SAME ORDER AS THE CONSTRUCTOR, and for the same reason: the formations first, then the calls -
      // a call that NAMES its start formation is built when it is registered, and a reference to a
      // formation that is not in the library yet is a failure rather than a retry.
      this.seq = new Sequencer(movesXmlText, formationsXmlText, []);
      // THROUGH `restoreModules`, so a module the engine refuses is skipped here exactly as it is at
      // startup: this loop used to call `registerModule` directly, and it runs on every LEVEL CHANGE, so a
      // saved module named after a call would throw out of the level selector.
      this.restoreModules();
      this.registerCederModules();
      // THE USER'S FORMATIONS GO BACK IN WITH EVERYTHING ELSE. This is the SAME requirement as the
      // modules one line above, and leaving it out was a real bug: the library is REPLACED here, so a
      // shape the caller labelled stopped being recognised the moment the level changed - the browse
      // panel's end-formation field went back to "not named" for the very call the label was made
      // from. Anything this library holds that the user added has to be re-added on a rebuild.
      this.registerUserFormations();
      for (const c of sequencerCallsUpTo(this.levelSelect.value)) this.seq.register(c.name, c.xml);
      // AFTER the registration, because `register` resets the sequencer and `reset` clears any extra
      // permission rules. The level is where the picker's rules come from, so it is set last.
      this.seq.setActiveLevel(this.levelSelect.value);
      this.history.length = 0;
      this.playing = false;
      this.playhead = 0;
      this.totalBeats = 0;
      this.flat = [];
      this.playBtn.textContent = '▶ Play';
      // A fresh sequencer starts at home, so the sequence begins from home again.
      this.startBoard = undefined;
      for (const v of this.views) {
        this.stage.scene.remove(v.group);
        this.stage.scene.remove(v.trail);
      }
      this.views = [];
      this.lastTraceKey = '';
      this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);
      this.statusEl.textContent = `level ${this.levelSelect.value.toUpperCase()} loaded`;
      this.populateFormations();
      this.syncAnimation();
      this.refreshCallSelect();
      this.render();
    }, 'Loading the level…');
  }

  /**
   * Rebuild the DANCER GROUP picker for the board the sequence is standing in.
   *
   * The list is the engine's own: `subsetGroups` for single groups and `combinedGroups` for
   * combinations such as `Head Boys` (the two dancers, not the four heads), `Center Girls`,
   * `Head Boys and Side Girls`. Both resolve each candidate against the board and keep only those that
   * are a proper subset of it — so `Centers`/`Leaders` combos appear where they exist and are absent
   * where they do not, rather than being offered and then refused. `All 8` is prepended as the default:
   * it is not a selection at all, it is the whole-board reading.
   *
   * THE COMBINATIONS ARE A SEPARATE optgroup, because a single group is the common case and a list
   * where `Heads` sits between `Head Boys` and `Head Girls` is harder to scan than one grouped by kind.
   *
   * THE OPTIONS ARE ONLY REBUILT WHEN THEY CHANGE, and the value is re-applied in the same step. This
   * runs on every board change, and resetting the value on each one would silently drop the caller's
   * group the moment the board moved - which is exactly when they least want to re-pick it.
   */
  private refreshGroupSelect() {
    const singles = this.seq.subsetGroups(this.seq.board);
    const combined = this.seq.combinedGroups(this.seq.board);
    const prev = this.groupSelect.value || 'All 8';
    const all = ['All 8', ...singles, ...combined];
    const same = this.groupSelect.options.length === all.length
      && all.every((g, i) => this.groupSelect.options[i]?.value === g);
    if (!same) {
      this.groupSelect.innerHTML = '';
      this.groupSelect.add(new Option('All 8', 'All 8'));
      const addAll = (label: string, names: string[]) => {
        if (!names.length) return;
        const og = document.createElement('optgroup');
        og.label = label;
        for (const n of names) og.appendChild(new Option(n, n));
        this.groupSelect.appendChild(og);
      };
      addAll('Groups', singles);
      addAll('Combinations', combined);
    }
    this.groupSelect.value = all.includes(prev) ? prev : 'All 8';
  }

  /**
   * THE ONE WRITER OF `parallel`, so the mode's state and the chrome that reads it cannot drift.
   *
   * Every edit path goes through here - entering a figure, appending to a lane, a refused append that keeps
   * the mode, re-opening a timeline row, Undo, Clear, a group change - and `applyParallelChrome` runs in the
   * same step. The alternative, and the defect this replaces, is an assignment at each site: the timeline-slot
   * click cleared the state and rebuilt only the PICKER, so the panel edge stayed lit while the group selector
   * and the primary button had already gone back to the ordinary reading.
   */
  private setParallel(p: ParallelEntry | null) {
    this.parallel = p;
    this.applyParallelChrome();
  }

  /**
   * THE FIGURE MODE'S CHROME, DERIVED IN ONE PLACE FROM `this.parallel`.
   *
   * WHY ONE PLACE. The mode is STATE; what the caller sees of it is this. Two windows used to read the state
   * separately - `renderFigureBar` painted the edge and the banner, `refreshCallSelect` painted the buttons and
   * the group list - so a clear that ran through the picker's window alone left the box on screen over an
   * `All 8` selector and an "Add to sequence" button, and `While…` then read the state that window had left
   * and could not reopen the figure. REPORTED in those words. `parallel-owner-probe.mjs` COUNTS the writers,
   * because a second writer of any one of these is invisible until it is.
   */
  private applyParallelChrome() {
    const p = this.parallel;
    // THE PANEL'S EDGE CARRIES THE MODE, the way `ed-clone` does for the editor: a caller scrolled to the
    // bottom of a long timeline should still be able to see that they are inside a figure.
    this.hudEl.classList.toggle('seq-figure', !!p);
    // THE BANNER IS SHOWN EXACTLY WHILE A FIGURE IS BEING BUILT, so clearing the mode takes it down with the
    // edge rather than leaving a stale set of lanes to read.
    this.figureBarEl.hidden = !p;
    // WHILE… IS LIVE WHENEVER THERE IS A LANE TO OPEN, which is EITHER while a figure is being built - so
    // the press adds another group to it - OR on a SELECTED STEP whose own call left dancers unclaimed, so
    // the press opens that figure's first lane. IT HAS TO BE LIVE WITH NO FIGURE OPEN, and the reading this
    // replaces (`!p`) made that impossible: "Finish figure", a timeline click and a group change all clear
    // `parallel`, so the one control that can start the other group died with the mode, the press did
    // nothing, and the caller's next call landed in the NEXT SLOT. REPORTED in exactly those words.
    // THE CONDITION IS THE HANDLER'S OWN REMAINDER (`unassignedLane`) AND NOT A SECOND COPY OF IT: the press
    // consumes this very reading, so the button and the code behind it cannot disagree - the drift between
    // them is what `41ba359` had just removed and what a re-derived condition would put back.
    this.parallelBtn.disabled = !p && !this.unassignedLane();
    // FINISH IS THE OTHER WAY ROUND: it ends a figure, so it is live exactly while one is being built.
    this.parallelDoneBtn.disabled = !p;
    const lane = this.activeLane();
    this.parallelBtn.title = p
      ? (lane && lane.calls.length === 0
        ? `${lane.selection} left — pick their call from the list and Add; Add again adds a SECOND call to the same lane.`
        : `Give the dancers no lane has claimed their own call in the SAME slot`
          + (lane ? ` — Add puts the picked call in ${lane.selection}'s lane (${lane.calls.join(' then ')}), and this button opens ANOTHER lane.` : '.'))
      : 'Give the dancers the current call did NOT move their own call in the SAME time slot. Enabled only when the last call acted on a subset, e.g. Sides promenade while the Heads step into the middle.';
    this.parallelDoneBtn.title = p
      ? `Finish ${stepLabel(this.parallelEntry(p))} and leave the figure, so the picker offers the next call again.`
      : 'Finish the parallel figure. Enabled only while one is being built.';
    // THE PRIMARY BUTTON SAYS WHAT IT DOES IN THE MODE IT IS IN: in a figure it appends to the open lane.
    // Read `this.parallel` and not the local `p`: `sequencer-hud-probe.mjs` pins this exact expression, and a
    // tidier spelling would redden it without changing a thing.
    this.applyBtn.textContent = this.parallel ? 'Add to lane' : 'Add to sequence';
    // THE GROUP SELECTOR IS THE MODE'S TOO, and inside a figure it asks a different question - see
    // `fillParallelGroupSelect`.
    if (p) this.fillParallelGroupSelect();
    else this.refreshGroupSelect();
  }

  /**
   * THE GROUP SELECTOR INSIDE A FIGURE.
   *
   * IN PARALLEL MODE THE GROUP SELECTOR ANSWERS A DIFFERENT QUESTION: WHO THE NEXT LANE GETS. The ordinary
   * meaning - who performs the next call - is already answered by the mode itself, which is why it was ignored
   * here. But the remainder is the complement of EVERYTHING claimed so far, so a lane given the whole
   * remainder leaves nobody for a third group - and `call 1 || ( call 2 + call 3 ) || ( call 4 + call 5 )` is
   * a THREE-group figure. Naming a group that sits inside the unclaimed dancers is what splits them, so the
   * selector lists exactly those.
   *
   * AND WHEN EVERY DANCER IS CLAIMED there is no next lane to open, so the list would be EMPTY. Showing the
   * ACTIVE lane instead keeps the control meaningful: its value is who Add acts on, which is exactly what the
   * label beside it says.
   */
  private fillParallelGroupSelect() {
    const choices = this.laneGroups();
    const list = choices.length ? choices : [this.activeLane()?.selection ?? ''].filter(Boolean);
    const prev = this.groupSelect.value;
    const same = this.groupSelect.options.length === list.length
      && list.every((g, i) => this.groupSelect.options[i]?.value === g);
    if (!same) {
      this.groupSelect.innerHTML = '';
      for (const g of list) this.groupSelect.appendChild(new Option(g, g));
    }
    this.groupSelect.value = list.includes(prev) ? prev : list[0] ?? '';
  }

  /** The group the caller has chosen, as it will be prefixed onto a call. Null for `All 8`. */
  private chosenGroup(): string | null {
    const g = this.groupSelect.value;
    return !g || g === 'All 8' ? null : g;
  }

  /** The call picker shows ONLY calls (and modules) legal from the current board.
   * Calls that act on a dancer subset are grouped under their selector so they
   * are visually distinct from whole-board calls. */
  private refreshCallSelect() {
    // THE MODE'S CHROME IS DERIVED FIRST, in the ONE method that owns it, so this rebuild can never
    // leave the button or the group selector describing a mode the state has left.
    this.applyParallelChrome();
    const prev = this.callSelect.value;
    const legal = this.seq.legalNext().sort(compareCallTitles);
    // IN PARALLEL MODE THE LIST ANSWERS A DIFFERENT QUESTION: not "what can the chosen group do", but
    // "what can the dancers that group LEFT BEHIND do". The remainder is resolved on the board the first
    // call started from, and the offer is narrowed by composing that selector and applying it - so a
    // call only the whole board can perform is absent rather than offered and then refused.
    const group = this.parallel ? this.activeLane()?.selection ?? null : this.chosenGroup();
    const modules = legal.filter((n) => this.seq.isModule(n));
    const calls = legal.filter((n) => !this.seq.isModule(n));
    const whole: string[] = [];
    const bySel = new Map<string, string[]>();
    for (const n of calls) {
      const s = splitSelection(n).selection;
      if (s && !['all', 'everybody', 'everyone', 'all 8', 'all 4 couples'].includes(s.toLowerCase())) {
        // WITH A GROUP CHOSEN, THE GROUP PICKER IS THE ONE SOURCE OF WHO ACTS. A call the engine only
        // offers as a fixed selection ("Heads Square Thru 4") is shown by its BARE name here, and the
        // chosen group is prefixed back on at Apply - so the list never reads "Heads ..." while the
        // group picker says Sides, which is what two competing selectors would do.
        if (group) {
          if (s.toLowerCase() === group.toLowerCase()) whole.push(splitSelection(n).call);
        } else {
          const arr = bySel.get(s) ?? [];
          arr.push(n);
          bySel.set(s, arr);
        }
      } else if (!s) {
        // A WHOLE-SET CALL IS POSSIBLE FOR A GROUP, so it is offered - but only when the GROUP can
        // actually perform it. Asking whole-board legality here was wrong in BOTH directions: measured
        // on a Static Square with `Head Boys`, it offered `Promenade`, `Promenade 1/2` and `Swing Your
        // Partner` (which the group cannot do) and could never surface a call legal for the group and
        // not whole-board. `groupCanPerform` composes the group and applies it, which is the question
        // the picker actually has.
        //
        // THIS IS ALSO WHERE THE EMPTY-PICKER BUG WAS. The guard used to read `else if (!group || s)`
        // with an inner `if (!group || !s)`, so for an unprefixed call with a group chosen BOTH were
        // false and EVERY whole-set call was dropped - the picker showed "no calls, just Modules".
        // MEASURED on a Static Square with `Head Boys`: 53 whole-set calls including `Dosado`, all
        // discarded, which is the reported "Dosado is not offered".
        // ...AND ON THE BOARD THE OFFER IS ABOUT. In parallel mode the group is the REMAINDER, which
        // only resolves on the board the first call started from - the live board has already moved the
        // dancers the call took. Composing it there would name whoever is still standing, which is the
        // opposite of the question.
        const bare = splitSelection(n).call;
        const on = this.parallel ? this.parallel.board : this.seq.board;
        // WITH NO GROUP CHOSEN THIS IS THE WHOLE-BOARD READING, and the PERMISSION layer is what decides
        // it - the engine's own question, asked on the board the offer is about. Asking only `!group`
        // offered every call `legalNext` had kept, including ones whose own reading is DENIED: MEASURED,
        // all-8 `Dosado` and all-8 `Lead Right` from a Static Square are both refused by `mayOffer` and
        // were both offered here, because `legalNext` is "offerable in SOME reading" (it keeps a call any
        // GROUP could perform, which is what keeps `Head Boys Dosado` offerable). The two readings are
        // different questions and the picker must ask the one that matches what Apply will do.
        const allowed = group
          ? this.seq.groupCanPerform(on, group, bare)
          : this.seq.mayOffer(bare, 'All 8', on).allowed;
        if (allowed) whole.push(bare);
      }
    }
    // GROUP-NAMED CODED CALLS, WHICH `legalNext` CANNOT OFFER. `Fold`, `Cross Fold`, `Trade`, `Run` and
    // `Step Forward` all refuse their BARE name by design - their precondition says a group must be named -
    // and `legalNext` is the whole-board reading, with an invariant this repo pins (`features.mjs`: every
    // listed call applies interactively). MEASURED on a Static Square: all five were absent from the list, so
    // `Boys Trade` and `Heads Step Forward` could not be sequenced from the picker AT ALL. With a GROUP chosen
    // the group IS the subject, and `groupCanPerform` is the engine's own question for it - the same question
    // the whole-set branch above asks - so they are offered here.
    if (group) {
      const on = this.parallel ? this.parallel.board : this.seq.board;
      for (const m of CODED_MOVES) {
        if (!m.applyToSelection || whole.includes(m.name)) continue;
        if (this.seq.groupCanPerform(on, group, m.name)) whole.push(m.name);
      }
    }
    // THE FILTER NARROWS WHAT IS OFFERED, AND NEVER MOVES THE SELECTION. There are 2206 calls in the
    // catalogue and the picker is the control a caller uses over and over, so the type-ahead Browse has was
    // missing exactly where it is worth most. The RULE is Browse's own (`filterNames` in `call-filter.ts`),
    // including "the selected call is always present": a filter that could empty the list would leave the
    // control naming one call while the board shows another.
    const query = this.callFilterInput.value;
    const keep = this.callSelect.value;
    const wholeShown = filterNames(whole, query, keep);
    const bySelShown = new Map([...bySel.keys()].sort().map((k) => [k, filterNames(bySel.get(k)!, query, keep)] as const));
    const modulesShown = filterNames(modules, query, keep);
    const shownTotal = wholeShown.length + [...bySelShown.values()].reduce((n, a) => n + a.length, 0) + modulesShown.length;
    const offerTotal = whole.length + [...bySel.values()].reduce((n, a) => n + a.length, 0) + modules.length;
    this.pickerCounts = { shown: shownTotal, total: offerTotal, query: query.trim() };
    this.callSelect.innerHTML = '';
    this.callSelect.add(new Option(group ? `— call for ${group} —` : '— valid next call —', ''));
    // THE BEATS EACH ENTRY WOULD COST, IN THE PICKER'S OWN LABEL: "16 - Promenade Full". Asked for after
    // using the lane, where the whole question is whether two short calls fill a long one and the number was
    // only in the status line AFTER something had been applied. It is read from the ENGINE and not estimated:
    // `stepBeats` on THE BOARD THE CALL WOULD RUN ON, for THE NAME APPLY WILL USE - the chosen group's prefix
    // included, since that is the step the sequencer charges. A MODULE is a whole sequence, so its number is
    // `sequenceBeats` of its flattened steps (the same call the scrub uses) from the live board, which is
    // where a module is applied.
    //
    // THE OPTION'S VALUE STAYS THE BARE NAME. Every reader of this list - Apply, the previous-pick restore
    // below, the parallel lane - takes `callSelect.value` as a call name, so the label is presentation only.
    const board = this.parallel ? this.parallel.board : this.seq.board;
    const addGroup = (groupLabel: string, names: string[], display: (n: string) => string) => {
      const uniq = [...new Set(names)].sort(compareCallTitles);
      if (uniq.length === 0) return;
      const og = document.createElement('optgroup');
      og.label = groupLabel;
      for (const n of uniq) og.appendChild(new Option(display(n), n));
      this.callSelect.appendChild(og);
    };
    addGroup(group ? `Whole-set or ${group}` : 'Whole-set calls', wholeShown,
      (n) => `${this.seq.stepBeats(board, group ? `${group} ${n}` : n)} - ${n}`);
    for (const [sel, names] of bySelShown) {
      addGroup(`Subset: ${sel}`, names, (n) => `${this.seq.stepBeats(board, n)} - ${n}`);
    }
    addGroup('Modules', modulesShown, (n) => `${this.seq.sequenceBeats(this.seq.flatten([n]), this.seq.board)} - ${n}`);
    // Keep the previous pick only when THIS list actually offers it - the values are bare names now,
    // so asking `legal` (which carries prefixes) would compare against a different vocabulary.
    const offered = [...this.callSelect.options].map((o) => o.value);
    if (prev && offered.includes(prev)) this.callSelect.value = prev;
    // Remember which board this list answers for, so `settlePlayhead` can skip a redundant rebuild.
    this.listBoardKey = boardKey(this.seq.board);
    this.undoBtn.title = 'Undo the last change to the sequence (Ctrl+Z)';
    this.updateFormationSelect();
    this.renderSubsetInfo();
  }

  private saveModule() {
    const name = this.moduleNameInput.value.trim();
    if (!name) {
      this.setStatus('warn', 'Enter a module name first');
      return;
    }
    if (this.history.length === 0) {
      this.setStatus('warn', 'Nothing to save — add calls first');
      return;
    }
    // THE ENGINE CAN REFUSE THE NAME, and it says why. Registering is tried BEFORE anything is stored or
    // listed, so a refusal leaves no trace: no entry in `this.modules`, nothing in localStorage, no row in
    // the drawer. The message is the engine's own, because it is the engine that knows a module resolves
    // before a call and what that would do to the call.
    try {
      this.seq.registerModule(name, [...this.history]);
    } catch (err) {
      this.setStatus('warn', `${(err as Error).message} Nothing was saved.`);
      return;
    }
    this.modules.push({
      name,
      calls: [...this.history],
      // THE MODULE RECORDS THE TWO BOARDS IT DANCES BETWEEN, in the same shape a sequence document writes them, so
      // loading it later stands the dancers up where it was written rather than at home. `this.startBoard` is the
      // board the sequence being saved was loaded on (undefined at home, which `seq.startBoard()` supplies).
      start: this.setupRefOfBoard(this.startBoard ?? this.seq.startBoard(), 'start'),
      end: this.setupRefOfBoard(this.seq.evaluateSequence(this.flat, this.totalBeats, this.startBoard).board, 'end'),
    });
    this.persistModules();
    this.refreshModulesList();
    this.refreshCallSelect();
    const saved = this.modules[this.modules.length - 1];
    this.setStatus('ok', `Saved module "${name}" from ${saved.start?.name ?? 'home'} to ${saved.end?.name ?? 'an unnamed board'}`);
    this.moduleNameInput.value = '';
  }

  /**
   * LOAD a saved module from the library drawer, standing up the board it RECORDED rather than the home square.
   *
   * THE STORED BOARD IS RESOLVED, NOT APPROXIMATED: `resolveSetupRef` is the resolver a sequence document's `start`
   * goes through, asked with the same catalogue, formation labels and variant library - so a `sid` here is the board the
   * Board drawer stands up, exactly as it is for an imported document. A start this app cannot resolve REFUSES BY NAME
   * and loads nothing: a module replayed from the wrong board dances different calls, which reads as "the module is
   * broken" (the distinction `resolveStartFormation` was introduced for).
   *
   * A MODULE SAVED BEFORE THE FIELD EXISTED carries no `start`, and goes through `openSequence` with no start formation -
   * which is the from-home replay it has always had, unchanged.
   */
  private loadModule(index: number) {
    const m = this.modules[index];
    if (!m) return;
    const start = m.start;
    if (!start) { this.openSequence(m.calls); return; }
    this.runBusy(() => {
      const read = resolveSetupRef(start, this.sequenceResolvers(), `saved module "${m.name}" start`);
      if ('reason' in read) {
        this.setStatus('error', `✗ ${read.reason}`);
        return;
      }
      this.playing = false;
      this.playBtn.textContent = '▶ Play';
      // Through the SAME board builder the Board drawer and the document's import use, so the identity rules (home
      // match, the registry overlay, `UNKNOWN_COUPLE` away from home) are the ones a picked setup gets.
      this.seq.setSetupBoard(read.start.dancers, read.start.label);
      this.startBoard = this.seq.startBoard();
      // THE VERDICT IS READ BEFORE THE LOAD, because the load moves the live board to the sequence's END and the
      // composition has to be asked from the board the module STARTS on.
      const note = this.moduleCallNote(this.startBoard ?? this.seq.startBoard(), m.name);
      this.loadSteps(m.calls, undefined, read.start.label, read.notes);
      // Appended to `loadSteps`' own report rather than replacing it, so the load's counts survive.
      this.setStatus(this.stop ? 'warn' : 'ok', `${this.statusEl.textContent}${note}`);
    }, 'Loading the saved module…');
  }

  /**
   * DELETE A SAVED MODULE FOR GOOD.
   *
   * THREE THINGS HAVE TO GO, and leaving any one of them behind is a half-deletion the caller notices
   * immediately: the entry in `this.modules`, which is what the drawer lists; the localStorage copy
   * (`persistModules`), or it is back on the next reload; and the LIVE registration
   * (`seq.unregisterModule`), without which the module stays in the call picker until something else
   * happens to rebuild the library.
   *
   * THE LIBRARY REBUILD IS DELIBERATELY NOT USED, and that is why the engine grew an unregister:
   * `rebuildSeq` also clears the history and resets the board (`history.length = 0`), so deleting one
   * saved module would throw away the sequence the caller has open. Nothing here touches the sequence.
   * That is also why the sequence is left alone rather than cleared with the module: the caller's board is
   * their work, and pressing Save module puts the module back if the delete was a mistake.
   *
   * BY INDEX, READ FROM THE ROW THAT WAS CLICKED, rather than by name: two saved modules may legitimately
   * share a name - `saveModule` does not check - and a name lookup would delete the first of them instead
   * of the one under the pointer.
   */
  private deleteModule(index: number) {
    const m = this.modules[index];
    if (!m) return;
    this.modules.splice(index, 1);
    this.persistModules();
    this.seq.unregisterModule(m.name);
    this.refreshModulesList();
    this.refreshCallSelect();
    this.setStatus('ok', `Deleted saved module "${m.name}"`);
  }

  /** The identity a set of views is bound to, in ARRAY ORDER: which dancer (id), of which gender, in
   * which couple, standing where in the array. A `DancerView` bakes its AVATAR - the boy/girl shape and
   * the couple colour - at construction and only its POSE is updated per frame, so if this changes and
   * the views are not rebuilt, the dancers drawn are the old board's dancers wearing the new board's
   * positions.
   *
   * THAT IS NOT HYPOTHETICAL, and it is what a real report turned out to be: `ceder-7046` starts on the
   * corpus's `Zero Line`, which stands up as `boardForFasrCode('L1o')` - a correct zero line whose
   * ARRAY ORDER is `BBBBgggg`, all four boys first. Drawn against views built for the home square
   * (`BgBgBgBg`), the four boys' poses are indices 0-3 and the girls' 4-7, so the set appears with BOTH
   * BOYS AT ONE END of the formation and both girls at the other, in each line, with same-gender facing
   * pairs - reported as "a very odd arrangement with Normal lines but all the girls at one end and the
   * boys at the other", and reproduced exactly from the two array orders. */
  private static viewKeyOf(board: Board): string {
    return board.dancers.map((d) => `${d.id}:${d.gender}:${d.couple ?? 0}:${d.isGhost ? 'g' : ''}`).join('|');
  }

  private rebuildViews(board: Board = this.seq.board) {
    for (const v of this.views) {
      this.stage.scene.remove(v.group);
      this.stage.scene.remove(v.trail);
      // THE RING IS A SCENE CHILD, not part of `group` - which is what lets it stay on the floor while the
      // bodies are hidden (`DancerView.setSelected` says so at the field). So it is added and removed HERE,
      // by hand, exactly as `browser.ts` does for the same view class: forgetting it is why the subset links
      // lit up and drew nothing - `setSelected(true)` was setting `visible` on an object that was never in
      // the scene.
      this.stage.scene.remove(v.selectionRing);
    }
    for (const m of this.markers) this.stage.scene.remove(m);
    // THE COLOUR IS THE SHARED RULE, and there is nothing here to decide: `displayCouple` draws the engine's home
    // couple where it has one and otherwise the PAIR the dancer sits in in this board's own order. That order is the
    // start formation element's (`sid` is the arrangement AND the order), and the engine carries it through every
    // call, so the same two dancers are the same colour for the whole sequence. It is not a second identity: this
    // value never reaches the engine board, whose `couple` stays UNKNOWN for a setup the engine cannot name.
    this.views = board.dancers.map(
      (d, i) =>
        new DancerView(
          { gender: d.gender, x: 0, y: 0, angleDeg: 0, path: [] },
          displayCouple(d, i),
          !!d.isGhost,
        ),
    );
    this.markers = board.dancers.map((d, i) => buildFlatMarker(d.gender, displayCouple(d, i)));
    for (const v of this.views) {
      v.group.visible = this.active && !this.use2d;
      this.stage.scene.add(v.group);
      this.stage.scene.add(v.trail);
      // ...AND ITS RING, which is a scene child of its own - see the removal loop above.
      this.stage.scene.add(v.selectionRing);
      v.trail.visible = this.active && !this.use2d;
    }
    for (const m of this.markers) {
      m.visible = this.active && this.use2d;
      this.stage.scene.add(m);
    }
    this.lastTraceKey = '';
    // A REBUILD MAKES FRESH VIEWS, so any lit subset is re-applied here or the rings vanish with the old
    // ones. The names are re-resolved against the board that just arrived - see `applySubsetMarks`.
    this.applySubsetMarks();
    this.viewKey = SequencerController.viewKeyOf(board);
  }

  private renderBoard(board: Board, walk?: WalkCycle) {
    // THE VIEWS FOLLOW THE BOARD'S IDENTITY, not just its dancer COUNT. A `DancerView` builds its
    // avatar once (boy/girl shape, couple colour) and only receives poses afterwards, so a board whose
    // identity or array order differs from the one the views were built for draws the wrong dancers in
    // the right places. See `viewKeyOf` for the ceder-7046 report that this was.
    //
    // THE COLOUR NEEDS NO SEPARATE COMPARISON ANY MORE. It is read off the dancers (home couple, else the index pair),
    // and `viewKeyOf` already carries the order, the genders and every `couple` - so a board that would be drawn in
    // different colours has a different key. When the colour was gated on the start setup's NAME it could change with
    // identity and order untouched, which is why a flag used to live beside the key.
    if (
      this.views.length !== board.dancers.length ||
      this.viewKey !== SequencerController.viewKeyOf(board)
    ) {
      this.rebuildViews(board);
    }

    const poses: Pose[] = board.dancers.map((d) => {
      if (this.boardRot === 0) return { x: d.x, y: d.y, heading: d.heading, hands: 'both' };
      const c = Math.cos(this.boardRot);
      const s = Math.sin(this.boardRot);
      return {
        x: d.x * c - d.y * s,
        y: d.x * s + d.y * c,
        heading: d.heading + this.boardRot,
        hands: 'both',
      };
    });
    const holds = computeHandholds(poses, 'static');

    const targets: { left?: THREE.Vector3; right?: THREE.Vector3 }[] = poses.map(() => ({}));
    const lines: [number, number][] = [];
    for (const h of holds) {
      const mx = (poses[h.i].x + poses[h.j].x) / 2;
      const my = (poses[h.i].y + poses[h.j].y) / 2;
      const hold = new THREE.Vector3(mx, 1.0, -my);
      if (h.hi === 'left') targets[h.i].left = hold.clone();
      else targets[h.i].right = hold.clone();
      if (h.hj === 'left') targets[h.j].left = hold.clone();
      else targets[h.j].right = hold.clone();
      lines.push([h.i, h.j]);
    }
    this.views.forEach((v, i) => v.update(poses[i], targets[i], walk));
    this.connectors.set(lines, poses);
    this.applyView(poses);
  }

  /** Enforce the current 3D/2D view: switch the camera, toggle avatar vs flat
   * markers, and position markers at the (display-rotated) poses. */
  private applyView(poses?: Pose[]) {
    this.stage.setView2D(this.active && this.use2d);
    this.applyViewVisibility(poses);
  }

  /**
   * WHAT EVERY VIEW SHOWS, given the mode and whether this panel is doing the showing - AND ONE COPY OF IT.
   * The tab switch and `applyView` each used to carry their own copy of these lines, which is what made the
   * subset links' ring gate want writing twice; two copies of a table is how a row drifts, and the ring row
   * was already missing from one of them.
   *
   * The flat marker's POSITION is only set when the caller has poses to give: a tab switch has none, and a
   * switch that parked every icon at the origin would flicker on its way to the render that follows.
   */
  private applyViewVisibility(poses?: Pose[]) {
    const show2d = this.active && this.use2d;
    this.connectors.group.visible = this.active && !this.use2d;
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      v.group.visible = this.active && !this.use2d;
      v.trail.visible = this.active && !this.use2d;
      // THE RING IS A MARK ON THE FLOOR, NOT A BODY. It is a scene child of its own (see `rebuildViews`), so
      // it is NOT gated on the 3D/2D switch the way the avatar and the track are - the sequencer OPENS in 2D,
      // and a highlight that only existed in 3D would look exactly like no highlight at all. It is gated on
      // `active` alone, so another tab's board cannot be left wearing this panel's rings.
      const ringId = this.seq.board.dancers[i]?.id;
      v.selectionRing.visible = this.active && ringId !== undefined && this.litIds.has(ringId);
      const m = this.markers[i];
      if (!m) continue;
      m.visible = show2d;
      if (show2d && poses?.[i]) {
        m.position.set(poses[i].x, 0, -poses[i].y);
        m.rotation.y = poses[i].heading;
      }
    }
  }

  render() {
    if (!this.active) return;
    // THE STATUS LINE'S COLOUR BELONGS TO THE MESSAGE THAT SET IT, so it is reset with the paint. A write
    // that is followed by `render()` may assign `textContent` directly; a write that is NOT - a search
    // result, a refusal that returns early - goes through `setStatus`, or it would wear the previous
    // message's colour.
    this.statusEl.className = 'seq-status';
    // THE TIMELINE IS PAINTED FROM THE SEQUENCE IN FRONT OF IT, whatever order the caller wrote the tail of
    // its edit path in: `refreshWalk` derives the flat steps, the totals and the stop, and does NOT move the
    // playhead (that is `syncAnimation`'s other half, and a repaint must not jump the scrub).
    this.refreshWalk();
    this.renderBoard(this.seq.board);
    // THE MODE'S CHROME FOLLOWS ITS STATE, in the ONE method that reads it - see `applyParallelChrome`.
    // `refreshCallSelect` routes through the same method, which is what stops a picker-only refresh
    // (the timeline-slot click) from clearing the state and leaving the box, the button and the group
    // half-done.
    this.applyParallelChrome();
    this.renderFigureBar();
    this.renderBoardChip();
    this.updateReadout();
    this.renderTimeline();
    this.renderSolve();
  }

  /** The ONE status line, in the colour that matches the news. See `render`. */
  private setStatus(kind: 'ok' | 'warn' | 'error', text: string) {
    this.statusEl.className = `seq-status ${kind}`;
    this.statusEl.textContent = text;
  }

  // ---------------------------------------------------------------- the busy lock

  /**
   * LOCK THE HUD AND PUT THE WORKING BAR UP, saying what is being worked on.
   *
   * WHY THE LOCK EXISTS. Every wrapped action is SYNCHRONOUS engine work - `legalNext` over the whole level,
   * a `getout` search, a whole-sequence replay - on the main thread, so the browser cannot paint between the
   * click and the answer. REPORTED: "clicking a sequence slot or selecting a group can take some time to
   * calculate, but there is no feedback that the system is processing the request. The HUD should lock up
   * and a processing progress bar displayed while working, so the user doesnt double click."
   *
   * THE ROOT CARRIES THE LOCK rather than the panel: the whole HUD is what the caller is looking at and what
   * must stop accepting input. `pointer-events: none` (`.seq-busy` in `style.css`) is the functional half,
   * `aria-busy` is the same claim for a screen reader, and the overlay is the visual one. `endBusy` puts all
   * three back, so nothing here depends on how the work ends.
   */
  private beginBusy(label?: string) {
    this.busy = true;
    this.busyLabelEl.textContent = label ?? 'Processing…';
    this.busyEl.hidden = false;
    this.hudEl.classList.add('seq-busy');
    this.hudEl.setAttribute('aria-busy', 'true');
  }

  private endBusy() {
    this.busy = false;
    this.busyEl.hidden = true;
    this.hudEl.classList.remove('seq-busy');
    this.hudEl.removeAttribute('aria-busy');
  }

  /**
   * RUN `work` WITH THE HUD LOCKED AND THE WORKING BAR UP.
   *
   * THE YIELD IS THE WHOLE FEATURE. `work` is synchronous, so setting the busy state and calling it in the
   * same task means the browser never paints what was just set: the caller sees the freeze and no bar, which
   * is the complaint the lock answers. The work therefore runs on the SECOND animation frame after the state
   * is set - rAF callbacks run BEFORE their own frame is painted, so the first frame paints the locked HUD and
   * the bar, and the second callback is reached only once that paint has happened. `setTimeout(…, 0)` alone
   * is NOT enough: it can be serviced before the next paint, and then nothing was gained.
   *
   * A SECOND CALL MADE WHILE THE LOCK IS UP IS DROPPED, NOT QUEUED - this is the double-click protection.
   * It is only reachable from a real event, because the main thread is blocked while `work` runs: "busy but
   * not running" therefore means the caller acted inside the yield window, and running the work twice is
   * exactly what they asked to be prevented from doing. The one exception is a call made from INSIDE `work`
   * - Import reaches Clear through `reset` - which runs immediately: the outer call already owns the
   * indicator, and re-queueing the inner one would run it after the statements that follow it. Nothing is
   * lost that way, because the nested work is part of the same calculation and the same lock.
   *
   * THE BAR IS INDETERMINATE, AND NO PROGRESS IS INVENTED. None of the wrapped operations reports a countable
   * step that is cheap to observe - `legalNext`, the searches and the replay each answer once, at the end -
   * so a moving percentage would be decoration pretending to be a measurement.
   */
  private runBusy(work: () => void, label?: string) {
    if (this.busy) {
      if (!this.busyRunning) return;
      work();
      return;
    }
    this.beginBusy(label);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.busyRunning = true;
        try {
          work();
        } finally {
          this.busyRunning = false;
          this.endBusy();
        }
      });
    });
  }

  private syncAnimation() {
    this.refreshWalk();
    this.playhead = this.totalBeats;
    this.scrub.value = String(this.playhead);
    this.updateBeatLabel();
  }

  /**
   * The WALK's own view of the sequence: the flat steps, the total beats, the scrub's range, and where the
   * sequence stops being playable.
   *
   * SPLIT OUT OF `syncAnimation` BECAUSE `render` NEEDS IT AND MUST NOT MOVE THE PLAYHEAD. Every edit path
   * ends `render(); refreshCallSelect(); syncAnimation();`, so the timeline used to be painted from the
   * PREVIOUS walk - rows for the calls but beats, totals and the stop marker from before the edit. Deriving
   * here instead makes the order irrelevant, and it is cheap: both engine calls are memoised by content, and
   * this runs on an ACTION, never in the frame loop.
   */
  private refreshWalk() {
    this.flat = this.seq.flatten(this.history);
    this.totalBeats = this.seq.sequenceBeats(this.flat, this.startBoard);
    // WHERE THE SEQUENCE STOPS BEING PLAYABLE. A call the walk cannot walk is charged 0 beats and
    // `evaluateSequence` returns the board BEFORE it, so the end of a sequence that stops early is
    // that call's start board. Without this the panel looks like it played the whole thing.
    this.stop = this.seq.sequenceStop(this.flat, this.startBoard);
    this.scrub.max = String(Math.max(1, this.totalBeats));
  }

  private updateBeatLabel() {
    const where = this.stop ? `  ·  ends before "${this.stop.call}"` : '';
    this.beatEl.textContent = `${this.playhead.toFixed(1)} / ${this.totalBeats.toFixed(1)} b${where}`;
    if (this.beatInput) this.beatInput.value = String(Math.round(this.playhead * 2) / 2);
  }

  private renderPlayhead() {
    if (!this.active) return;
    const res = this.seq.evaluateSequence(this.flat, this.playhead, this.startBoard);
    const walkPhase = ((this.playhead + 1000) % 2) / 2;
    this.renderBoard(res.board, { phase: walkPhase });
    // AT OR PAST THE END the evaluator returns the sequence's FINAL board, and `res.beats > 0` is how
    // it says so (`beats: 0` means "part way through a call").
    //
    // This used to call `render()`, which draws `this.seq.board` - the LIVE board, the result of a
    // SEPARATE replay (the `applyStep` history) - and that overrode the frame just drawn. Where the
    // two replays part, the last frame is therefore the live board: on a sequence whose final call
    // cannot be played it is the board BEFORE that call, which is exactly the start formation the
    // panel prints for the selected call. MEASURED on ceder-7046: from home, `Right and Left Grand`
    // cannot be played and the live board stops on the T-Bone its chain reaches (33.5 beats); from the
    // module's own `Zero Line` start the same call applies and both replays end on the ring (35
    // beats). Moving the live board to the evaluated one keeps the readout and the call picker in
    // agreement WITHOUT overwriting what is drawn.
    if (res.beats > 0) {
      this.seq.setBoard(res.board);
      this.updateReadout();
    }
    // THE TIMELINE FOLLOWS THE PLAYHEAD, and it costs two class names: `markTimelineCurrent` only touches the
    // DOM when the ROW changes, so playing a sequence does not rebuild the list 60 times a second.
    this.markTimelineCurrent(this.stepAtPlayhead());
    this.updateCurrentTrace();
  }

  private updateCurrentTrace() {
    if (!this.active || this.views.length === 0) return;
    const info = this.seq.sequenceInfo(this.flat, this.playhead, this.startBoard);
    const key = info && this.views.length === info.variant.dancers.length ? `${info.name}:${info.mapping.join(',')}` : '';
    if (key === this.lastTraceKey) return;
    this.lastTraceKey = key;
    if (info) {
      this.views.forEach((v, i) => {
        const pts = sampleTrail(info.variant.dancers[info.mapping[i]], 80);
        if (this.boardRot !== 0) {
          const c = Math.cos(this.boardRot);
          const s = Math.sin(this.boardRot);
          for (const p of pts) {
            const x = p.x;
            const y = p.y;
            p.x = x * c - y * s;
            p.y = x * s + y * c;
          }
        }
        v.setTrail(pts);
        v.trail.visible = this.active;
      });
    } else {
      for (const v of this.views) v.trail.visible = false;
    }
  }

  private frame() {
    if (this.active && this.totalBeats > 0) {
      const now = performance.now();
      const dt = now - this.lastFrame;
      this.lastFrame = now;
      if (this.playing) {
        // THE SEQUENCER'S OWN CLOCK, INCLUDING ITS SPEED. The browse view previews one call through the
        // shared `player`, so its Speed control is that player's; this walks the whole sequence and has its
        // own multiplier, which is why the panel can slow a sequence down without touching the browse view's
        // setting. Read per frame, so changing it takes effect mid-playback.
        const speed = parseFloat(this.speedSelect.value) || 1;
        this.playhead += (dt / MS_PER_BEAT) * speed;
        if (this.playhead >= this.totalBeats) {
          this.playhead = this.totalBeats;
          this.playing = false;
          this.playBtn.textContent = '▶ Play';
          // Playback has STOPPED on the sequence's final board: make that board live, so the
          // next-call list is the one for the end formation/arrangement rather than for wherever the
          // last edit left the sequencer.
          this.settlePlayhead();
        }
      }
      this.renderPlayhead();
      this.scrub.value = String(this.playhead);
      this.updateBeatLabel();
    }
    requestAnimationFrame(() => this.frame());
  }
  private requestFrame() {
    requestAnimationFrame(() => this.frame());
  }

  private togglePlay() {
    if (this.totalBeats <= 0) return;
    if (this.playhead >= this.totalBeats) this.playhead = 0;
    this.playing = !this.playing;
    this.lastFrame = performance.now();
    this.playBtn.textContent = this.playing ? '⏸ Pause' : '▶ Play';
    // Pausing leaves the playhead where it is, so the board under it is definite and can be made
    // live; starting does not, because the playhead is about to move.
    if (!this.playing) this.settlePlayhead();
  }

  private onScrub() {
    this.playhead = parseFloat(this.scrub.value);
    this.renderPlayhead();
    this.updateBeatLabel();
  }

  /**
   * Make the board the user is LOOKING AT live, once the playhead stops moving.
   *
   * The frame is drawn from `evaluateSequence`, but `legalNext()`, the readout and the formation
   * select all answer from the SEQUENCER'S OWN board, and the two only met at the very end of a
   * sequence (`renderPlayhead`). So everything in between - which is the whole point of opening a
   * module - left the next-call list answering from whatever board the last EDIT produced. Reported:
   * "when a module is loaded into the sequencer, the list of next calls isn't updated with those
   * calls available from the end formation/arrangement" - `openSequence` parks the playhead at the
   * clicked call, playing to the end moves the frame but not the live board, and the list stayed on
   * the parked board.
   *
   * Settled means the playhead is NOT moving: `!playing`, and a scrub or a seek has finished. The
   * refresh costs one `legalNext()` over the whole catalogue (`legalCalls` is ~99% of a
   * `transitionTable` build), so it is done once per settled position and never per frame - which is
   * why this is not in the frame loop.
   */
  private settlePlayhead() {
    if (this.playing) return;
    const board = this.seq.evaluateSequence(this.flat, this.playhead, this.startBoard).board;
    this.seq.setBoard(board);
    this.updateReadout();
    // ONE REFRESH PER SETTLE IS STILL ~0.7 s (`legalNext()` enumerates the whole catalogue and
    // applies every call to the board - measured 686-692 ms warm, 1.6 s the first time), so it is
    // skipped when the settled board is the one the list was already built from. That keeps a pause
    // on the same spot, or a scrub released where it started, free.
    if (boardKey(this.seq.board) === this.listBoardKey) return;
    this.refreshCallSelect();
  }

  private onBeatInput() {
    const v = parseFloat(this.beatInput.value);
    if (isNaN(v)) return;
    this.playing = false;
    this.playBtn.textContent = '▶ Play';
    this.playhead = Math.max(0, Math.min(this.totalBeats, v));
    this.scrub.value = String(this.playhead);
    this.renderPlayhead();
    this.updateBeatLabel();
  }

  private copyPositions() {
    // Export the board at the current playhead, replayed from the sequence's own
    // start board (home, or the formation jumped to with "Set"), so the exported
    // coordinates match what is drawn.
    const board = this.seq.evaluateSequence(this.flat, this.playhead, this.startBoard).board;
    const fasr = this.seq.fasr();
    const rel = fasr.relationship;
    const payload = {
      playhead: this.playhead,
      totalBeats: this.totalBeats,
      sequence: this.history,
      formation: fasr.formation,
      arrangement: fasr.arrangement,
      sequenceParity: fasr.sequence,
      dancers: board.dancers.map((d) => ({
        id: d.id,
        couple: d.couple,
        group: d.couple % 2 === 1 ? 'heads' : 'sides',
        gender: d.gender,
        x: d.x,
        y: d.y,
        heading: d.heading,
        headingDeg: Number((d.heading * 180 / Math.PI).toFixed(2)),
        partner: rel[d.id]?.partner ?? null,
        corner: rel[d.id]?.corner ?? null,
      })),
    };
    const text = JSON.stringify(payload, null, 2);
    navigator.clipboard.writeText(text).then(
      () => { this.setStatus('ok', '✓ dancer positions copied (JSON)'); },
      () => { this.setStatus('error', '✗ clipboard unavailable — positions are in the console'); console.log(text); },
    );
  }

  private updateReadout() {
    const fasr = this.seq.fasr();
    const rel = fasr.relationship[1]
      ? ` · dancer1: partner=${fasr.relationship[1].partner ?? '?'} corner=${fasr.relationship[1].corner ?? '?'}`
      : '';
    // THE ALL8 FASROO CODE, when the board IS a setup all8 has a name for. A plain FASR code names a
    // CLASS of four boards - the four orientations - so it cannot say where the dancers actually are;
    // FASROO adds Orientation and Occupation, so it does. This is the instrument the FASR work needs:
    // it turns "the board looks odd" into "[0L1pH+] vs the [0L1pL'] all8 draws".
    const board = this.seq.evaluateSequence(this.flat, this.playhead, this.startBoard).board;
    const code = this.fasrooCode(board);
    // THE SETUP the board is standing in, by ID: the Board picker selects on this value, so showing it here is how
    // "which setup is this" is answered when the board was reached by dancing rather than by the picker.
    const setup = setupId(board);
    const codeText = code
      ? `<br>FASROO: <b>${code.code}</b>${code.note ? ` <i>(${code.note})</i>` : ''}` +
        `<span class="small" title="${FASROO_ORIENTATION_NOTE}"> ·?</span>`
      : '';
    const fasrText =
      `Formation: <b>${esc(fasr.formation ?? '?')}</b> · ${fasr.arrangement}${setup ? ` · Setup <b>${esc(setup)}</b>` : ''}<br>` +
      `Sequence: <b>${fasr.sequence}</b>${rel}${codeText}`;
    // THE SEQUENCE ITSELF IS NO LONGER PART OF THIS BLOCK. It has its own zone (`renderTimeline`), which is
    // the point of the redesign: the FASR reading is state, the sequence is the document.
    if (fasrText === this.lastReadout) return;
    this.lastReadout = fasrText;
    this.fasrEl.innerHTML = fasrText;
  }

  /**
   * THE TIMELINE: the one surface this panel exists to build.
   *
   * A row per history entry - an ordinal, the step's own label (which already states WHO acts, so a second
   * "who" chip would only restate it), the beats it costs, a bar whose width is its share of the LONGEST
   * step, and a `×` that removes it. The row under the playhead is marked `aria-current="step"` and tinted,
   * and the first step that cannot be played is flagged from the walk's own `stop` - the engine already
   * knows where a sequence stops being playable, and the panel used to say so only in a sentence beside the
   * transport.
   */
  private renderTimeline() {
    const n = this.history.length;
    this.totalsEl.textContent = n
      ? `${n} step${n === 1 ? '' : 's'} · ${this.totalBeats.toFixed(1)} b`
      : '';
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;
    this.resetBtn.disabled = n === 0 && !this.startBoard;
    if (n === 0) {
      this.stepStarts = [];
      this.lastActiveStep = -1;
      this.seqListEl.innerHTML =
        '<div class="seq-empty">No calls yet — pick a <b>Who</b>, a <b>Call</b> and press '
        + '<b>Add to sequence</b>. <b>While…</b> adds a second group dancing at the same time.</div>';
      return;
    }
    // THE START BEAT OF EVERY STEP, computed once: it is what the row's own beats are a difference of, what
    // the playhead's row is found from (per FRAME - so it must not be a `sequenceBeats` call), and what the
    // bars are scaled by.
    const starts = this.history.map((_, i) => this.beatAtStep(i));
    this.stepStarts = starts;
    const perStep = this.history.map((_, i) => Math.max(0, (i + 1 < starts.length ? starts[i + 1] : this.totalBeats) - starts[i]));
    // The longest step sets the scale, so the bars compare steps with each other rather than with the whole
    // sequence - a 16-beat promenade beside two 4-beat trades has to LOOK three times as long.
    const scale = Math.max(1, ...perStep);
    const active = this.stepAtPlayhead();
    this.lastActiveStep = active;
    const badFlat = this.stop ? this.stop.index : -1;
    const badAt = badFlat < 0 ? -1 : this.historyRowOfFlat(badFlat);
    // THE MARKER SAYS WHAT ANIMATED THE ROW, so the sources come from the engine's own replay walk rather than
    // from the call's name (see `step-source.ts`: since `apply-source.ts` a coded call can be danced from its
    // authored tam). One call per row rebuild, and it is the walk the animation already used.
    const rowSource = rowSources(this.history, (s) => this.seq.flatten([s]).length, this.seq.stepSources(this.flat, this.startBoard));
    const rows = this.history.map((step, i) => {
      const cls = [
        'seq-row',
        i === active ? 'on' : '',
        i === badAt ? 'bad' : '',
      ].filter(Boolean).join(' ');
      const bar = Math.max(2, Math.round((perStep[i] / scale) * 100));
      // A FIGURE ROW SAYS SO, because it is the one row whose click does something beyond seeking: it
      // re-opens the figure for editing (`resumeFigure`). The tooltip is the sentence; the marker is what
      // makes it visible in a list of plain rows.
      const figure = isGroupStep(step);
      const title = i === badAt && this.stop
        ? `Cannot be played: ${this.stop.reason}`
        : figure
          ? 'Click to re-open this figure and add calls to its free beats'
          : 'Click to move the playhead to this step';
      return `<div class="${cls}" role="listitem" tabindex="0" data-idx="${i}"${i === active ? ' aria-current="step"' : ''} title="${esc(title)}">`
        + `<span class="seq-idx">${i + 1}</span>`
        + (figure ? '<span class="seq-fig-mark" aria-label="figure">⇄</span>' : '')
        + this.sourceMark(step, rowSource[i])
        + `<span class="seq-name">${esc(stepLabel(step))}</span>`
        + `<span class="seq-beats">${perStep[i] > 0 ? `${perStep[i].toFixed(1)} b` : '—'}</span>`
        + `<span class="seq-bar-track"><span class="seq-bar-fill" style="width:${bar}%"></span></span>`
        + `<button class="seq-del" data-del="${i}" title="Remove this step" aria-label="Remove step ${i + 1}">×</button>`
        + '</div>';
    });
    this.seqListEl.innerHTML = rows.join('');
    if (this.selectedStep >= n) this.selectedStep = n - 1;
  }

  /**
   * THE MARKER ON A TIMELINE ROW: where this step's call comes from.
   *
   * A `mixed` "while" NAMES ITS LANES, because the row is several calls at once and "mixed" alone is not an
   * answer to the question the marker asks. Everything else is one call, and its badge is the whole answer.
   */
  private sourceMark(step: ModuleStep, walked: 'derived' | 'catalogue' | 'mixed' | null): string {
    const { source, calls } = stepSource(step, (n) => this.seq.isModule(n), walked);
    const meta = SequencerController.SOURCE_MARK[source];
    const detail = source === 'mixed'
      ? ` ${calls.map((c) => `${c.call} (${SequencerController.SOURCE_MARK[c.source].mark})`).join(', ')}`
      : '';
    const label = meta.label + detail;
    return `<span class="seq-src ${meta.cls}" title="${esc(label)}" aria-label="${esc(label)}">${esc(meta.mark)}</span>`;
  }

  /**
   * Move the playhead's mark in the timeline. Called from `renderPlayhead`, which runs EVERY FRAME, so it
   * touches two class names and nothing else - rebuilding the rows per frame would rebuild the DOM 60 times
   * a second while the sequence plays.
   */
  private markTimelineCurrent(active: number) {
    if (active === this.lastActiveStep) return;
    this.lastActiveStep = active;
    const rows = this.seqListEl.querySelectorAll<HTMLElement>('.seq-row');
    rows.forEach((row) => {
      const on = Number(row.dataset.idx) === active;
      row.classList.toggle('on', on);
      if (on) row.setAttribute('aria-current', 'step');
      else row.removeAttribute('aria-current');
    });
  }

  /**
   * Which history row the flat index `k` belongs to. `SequenceStop.index` counts FLAT steps (a module is
   * several of them), so it cannot index `history` directly - the same conversion `beatAtStep` makes, run
   * the other way.
   */
  private historyRowOfFlat(k: number): number {
    let flat = 0;
    for (let i = 0; i < this.history.length; i++) {
      flat += this.seq.flatten([this.history[i]]).length;
      if (k < flat) return i;
    }
    return this.history.length - 1;
  }

  /** The history row the playhead is inside, or -1 when the sequence is empty. Reads the start beats the
   *  timeline already computed, because this runs once per frame. */
  private stepAtPlayhead(): number {
    if (this.history.length === 0) return -1;
    const starts = this.stepStarts;
    if (starts.length !== this.history.length) return this.history.length - 1;
    let row = 0;
    for (let i = 0; i < starts.length; i++) if (this.playhead >= starts[i] - EXACT_TOL) row = i;
    return row;
  }

  /** THE FIGURE BANNER: which lanes exist, which one is open, and the one way out that is not Apply. */
  private renderFigureBar() {
    const p = this.parallel;
    // THE BANNER'S VISIBILITY IS PART OF THE MODE'S CHROME and is set by `applyParallelChrome`; what is
    // left here is its CONTENT, which only a figure has.
    if (!p) return;
    const lanes = p.groups
      .map((g) => (g.calls.length ? `${g.selection} (${g.calls.join(' + ')})` : `${g.selection} (open)`));
    const un = this.unassignedLane();
    // EACH LANE'S FILL, because "how much of the slot is still free" is the question this banner is asked.
    // The step's cost is the LONGEST lane, so the free beats are only meaningful per lane - which is where
    // they now sit, next to the lane they belong to, instead of only in the status line after an Add.
    const fill = this.laneFill(p);
    const lanesText = lanes.map((l, i) => {
      const f = fill[i];
      if (!f || f.calls === 0) return esc(l);
      return `${esc(l)} <span class="seq-fig-fill">${f.beats.toFixed(1)}/${f.total.toFixed(1)} b`
        + (f.free > 0 ? ` · ${f.free.toFixed(1)} free` : '') + '</span>';
    }).join(' <b>||</b> ');
    this.figureWhatEl.innerHTML = lanesText
      + (un ? ` · <b>${esc(un)}</b> still unclaimed` : ' · every dancer has a lane');
  }

  /**
   * HOW FULL EACH LANE OF THE FIGURE IN PROGRESS IS, per lane: `beats` it dances, `free` beats of the slot it
   * leaves standing, and the step's own cost (`total`, the longest lane).
   *
   * The same arithmetic the status line reports after an Add, so the banner and the status can never disagree;
   * the beats come from the ENGINE, per call, on the board that call starts on (`ApplyResult.lanes`), not from
   * an estimate. A lane with no calls yet reports 0 and no free figure - it has not started.
   */
  private laneFill(p: { start: Board; groups: { selection: string; calls: string[] }[] }): { calls: number; beats: number; free: number; total: number }[] {
    const step = this.parallelStep(p);
    const applied = this.seq.applyToBoard(p.start, step);
    const total = applied.legal ? this.seq.sequenceBeats([step], p.start) : 0;
    return p.groups.map((g) => {
      const run = applied.lanes?.find((l) => l.selection === g.selection);
      const beats = g.calls.reduce(
        (n, c, k) => n + this.seq.stepBeats(k === 0 ? p.start : run?.boards[k] ?? p.start, `${g.selection} ${c}`),
        0,
      );
      return { calls: g.calls.length, beats, free: Math.max(0, total - beats), total };
    });
  }

  /** WHERE THE SEQUENCE IS STANDING: the formation the replay starts from, and its All8 setup code. */
  private renderBoardChip() {
    const from = this.startBoard ?? this.seq.startBoard();
    const name = this.seq.recognize(from)?.name ?? 'Static Square';
    const code = this.fasrooCode(from);
    // THE ID IS ALWAYS THERE, so it is shown whatever the name says: it is the one answer to "which board is
    // this" that does not depend on a namer, and it is what a permission rule on an unnamed board is keyed by.
    const id = this.seq.boardIdentity(from).id;
    this.boardChipEl.innerHTML =
      `<b>${esc(name)}</b>${code ? ` · ${esc(code.code)}` : ''} · ${esc(id)}`;
  }

  /**
   * The board's All8 **FASROO** code — `[0L1pH+]` — or null when it is not a setup with a formation
   * letter.
   *
   * WHY FASROO AND NOT FASR. A plain FASR code names a CLASS of boards, not a board:
   * `boardsForAlignment` returns FOUR distinct boards for every code — identical in every dancer's
   * position, heading and gender, differing ONLY in which couple number stands on which spot. FASR
   * tells a caller where the board is so they can choose the next call; it does not place the dancers.
   * FASROO adds Orientation (H/R/O/L, how the reference boy is rotated from his home) and Occupation
   * (`+` Head / `'` Side), and all8's word for the three together is a SETUP.
   *
   * `fasrooOf` does the whole reading, including finding the reference pair — it uses
   * `relationshipStateOf`, which already applies all8's stated reference pair for `[L]`, `[B]`, `[F]`
   * and `[W]`, the only four Callerlab defines one for. Formation letters outside those four cannot be
   * read this far, and the `note` says why rather than leaving a bare `?`.
   *
   * The `?` marker in the readout is separate and is about the ORIENTATION CONSTRUCTION being
   * unverified — see `FASROO_ORIENTATION_NOTE`.
   */
  private fasrooCode(board: Board): { code: string; note?: string } | null {
    const f = fasrooOf(board, this.seq.knownFormation(board));
    if (!f.alignment.letter) return null;
    return { code: f.notation, note: f.reason };
  }

  /** Put the LIVE board back at the END of the sequence: rewind to the board the sequence began
   * from and replay the history into it.
   *
   * Needed before APPENDING a call, because `seekTo` moves the live board to the formation at the
   * start of whichever call was clicked. Applying a call extends the sequence, which is an edit at
   * its END, not at the playhead - so without this, appending after a seek would build a sequence
   * that does not replay to the board it was built from. */
  private replayHistory() {
    this.rewindToStart();
    for (const name of this.history) this.seq.applyStep(name);
  }

  private applySelected() {
    this.runBusy(() => {
      // PARALLEL MODE ROUTES HERE FIRST: the picker is then offering the REMAINDER's calls, so Apply
      // composes the pair instead of applying a second sequential call.
      if (this.parallel) { this.applyParallel(); return; }
      const picked = this.callSelect.value;
      if (!picked) return;
      // THE CHOSEN GROUP IS PREFIXED HERE, and this is the one place it is applied. The picker offers
      // BARE call names whenever a group is selected (see `refreshCallSelect`), so the group is added
      // once, at the point of use - and what goes into `history` is the composed name, which is what
      // `replayHistory` re-applies and what the sequence/All8 views show.
      const group = this.chosenGroup();
      const name = group ? `${group} ${picked}` : picked;
      this.replayHistory();
      // THE BOARD THE STEP STARTS FROM, captured before the apply mutates it. A parallel call's remainder
      // must be resolved HERE rather than on the live board, which after the apply already shows the
      // dancers the call moved - see `parallel`.
      const from = this.seq.startBoard();
      // AND THE PICKER'S PERMISSION LAYER IS DECIDED BEFORE THE CALL IS DANCED, not only before it is
      // listed. Apply is reachable without the list: the name can be left selected from another board, a
      // group can be changed under it, or a module can restore a figure - so a call the layer refuses is
      // refused here too, with the engine's own reason. MEASURED: all-8 `Lead Right` from a Static Square
      // applies and tiles the square four ways (`[#5 #6] [#7 #8] [#1 #2] [#3 #4]`), which is eight dancers
      // dancing a one-couple call; the refusal reason names `Heads Lead Right` / `Sides Lead Right`.
      //
      // THE READING ASKED ABOUT IS THE ONE `name` CARRIES. A call the catalogue publishes with its own
      // designator ("Heads Lead Left", which the picker offers by NAME) is applied with no group chosen,
      // and asking the whole-board question for it would refuse a legitimate designated call the moment a
      // rule exists for that call's all-8 reading. The composed name's own selection comes first, and only
      // an unprefixed name is the whole-board reading.
      const perm = this.seq.mayOffer(splitSelection(name).call, splitSelection(name).selection ?? group ?? 'All 8', from);
      if (!perm.allowed) {
        this.setStatus('error', `✗ ${name} — ${perm.reason ?? 'not offered from this board'}`);
        return;
      }
      const step = this.seq.apply(name);
      if (!step.legal) {
        this.setStatus('error', `✗ ${name}${step.reason ? ` — ${step.reason}` : ''}`);
        return;
      }
      this.pushUndo();
      const expanded = this.seq.flatten([name]);
      // A MODULE IS ONE STEP. `flatten` is what the ENGINE dances - it turns a module into its calls so the walk, the
      // timing and the export see calls - but the HISTORY is the caller's own list of steps, and a module is one of
      // them. Pushing its calls made a seven-call module seven rows, so it could only be undone, reordered or deleted
      // one call at a time, which is the one thing a call variant cannot do. The panel already reads a row as "one or
      // more flat steps" (`beatAtStep`, `historyRowOfFlat`, `rowSources`), so the row keeps the module's own duration
      // and its own source marker while staying ONE row.
      if (expanded.length > 1) this.history.push(name);
      else this.history.push(...expanded);
      // PARALLEL MODE CANNOT SURVIVE A NEW CALL: its remainder and its history index both belong to the
      // step that has just been superseded.
      this.setParallel(null);
      // WHO ACTED, FROM EITHER SOURCE. The GROUP SELECTOR is only one of the two ways a call can name a
      // subset: a call the catalogue publishes with its own designator ("Sides Forward and Back", which
      // the picker offers as a NAME) carries its selection in the call itself, and `chosenGroup()` is null
      // for it. Taking the group from the selector alone measured `remaining` as null for every such call,
      // so the button stayed dead on exactly the calls the report is about. The composed name's own
      // selection is the fallback, and it is the same string the applicator split off.
      const who = group ?? splitSelection(name).selection ?? null;
      // A whole-set call leaves nobody, so the button stays off; a subset call leaves the rest of the
      // board, which is exactly when a "while" partner can be offered. Only a PLAIN single step can take
      // one - a call that flattened into several is several sequential steps, not one slot.
      const remaining = who ? this.seq.remainingSelection(from, who) : null;
      if (remaining && expanded.length === 1 && typeof expanded[0] === 'string') {
        this.setParallel({
          start: from,
          board: from,
          index: this.history.length - 1,
          // THE FIRST LANE HOLDS THE CALL JUST APPLIED and the second is the remainder's, OPENED AND EMPTY:
          // one group is not a figure, so the composed step is only sent once a lane has a call in it.
          groups: [
            { selection: who!, calls: [splitSelection(name).call || picked] },
            { selection: remaining, calls: [] },
          ],
          active: 1,
        });
        this.statusEl.textContent = `✓ ${name} · ${remaining} left — press While… to give them their own call in the same slot (or Add again later to put several in one lane)`;
      } else {
        this.statusEl.textContent = `✓ ${name}${expanded.length > 1 ? ` (${expanded.length} calls)` : ''}`;
        // WHETHER IT IS ONE CALL, said out loud. A module that cannot compose still plays - the walk flattens it - so
        // this is information rather than a refusal, and it is the one place the caller learns their module is its
        // calls rather than a single call.
        if (expanded.length > 1) this.statusEl.textContent += this.moduleCallNote(from, name);
      }
      this.render();
      this.refreshCallSelect();
      this.syncAnimation();
    }, 'Adding the call…');
  }

  /**
   * WHETHER A MODULE PLAYS AS ONE CALL, as a sentence for the status line - and WHY NOT when it does not.
   *
   * `Sequencer.moduleCall` composes the module's whole step list into one bundle, which is what the timeline row is
   * standing in for. When it refuses, the reason names the step, so a caller can act on it; when it succeeds, the end
   * board's name is the useful half, because that is what the next call has to start from.
   */
  private moduleCallNote(board: Board, name: string): string {
    const read = this.seq.moduleCall(board, name);
    return read.legal
      ? ` · plays as one call to ${read.bundle.module?.endFormation ?? 'an unnamed board'}`
      : ` · plays as its calls, not one call: ${read.reason}`;
  }

  /** The lane the picker is offering calls to and Apply appends to. */
  private activeLane() {
    const p = this.parallel;
    return p ? p.groups[p.active] : null;
  }

  /**
   * The composed step as it stands: a `GroupStep` once a SECOND lane has a call, and the plain composed
   * name while there is only one - which is exactly what `applySelected` put in the history, so a refused
   * append can restore the entry it replaced without knowing how it was built.
   *
   * A lane with no calls yet is DROPPED rather than sent to the engine: it is a group the caller has opened
   * and not filled, and the step it would compose is not a figure. `parallelStep` is what Apply sends.
   */
  private parallelEntry(p: { groups: { selection: string; calls: string[] }[] }): ModuleStep {
    const lanes = p.groups.filter((g) => g.calls.length > 0);
    if (lanes.length === 0) return '';
    if (lanes.length === 1) return `${lanes[0].selection} ${lanes[0].calls[0]}`;
    return this.parallelStep(p);
  }

  /** The composed `GroupStep`, one lane per group: a single call uses the plain `{selection, call}` form,
   *  several use the lane form - which is the shape the sequence list labels with `||` and `+`. */
  private parallelStep(p: { groups: { selection: string; calls: string[] }[] }): GroupStep {
    return {
      groups: p.groups
        .filter((g) => g.calls.length > 0)
        .map((g) => (g.calls.length > 1
          ? { selection: g.selection, calls: [...g.calls] }
          : { selection: g.selection, call: g.calls[0] })),
    };
  }

  /**
   * THE FIGURE `While…` ACTS ON, WHICH OUTLIVES THE MODE: the open one, or the one the SELECTED step still
   * describes.
   *
   * WHY THE SELECTED STEP COUNTS. `Finish figure`, a timeline click and a group change all clear
   * `this.parallel`, and while the button's enable condition was `!p` it died with the mode - so a caller
   * who had just finished `Heads Promenade 3/4 to Home`, clicked the row it left behind and pressed
   * `While…` to give the sides their own call in the same slot got nothing at all, and the call they then
   * added became a SECOND ENTRY in the next slot. REPORTED in those words, and the second half of it is
   * what makes the button's condition a REMAINDER rather than a flag: there is a figure to open precisely
   * when the selected step's own call left dancers unclaimed.
   *
   * THE CANDIDATE IS THE ENTRY `applySelected` BUILDS when a subset call is applied: lane 0 already holds
   * the call the step has, the remainder's lane is OPEN AND EMPTY, and it is the active one - so the press
   * re-opens the figure that step belonged to rather than inventing one. Nothing is written to the history
   * here; `index` names the row the mode would replace, exactly as `resumeFigure` does for a figure row.
   *
   * THE BOARD IS `this.seq.startBoard()`, the live board, which `activateStep`'s seek has just left at the
   * step being opened - the same reading `resumeFigure` takes, and the same one `applySelected` took when
   * this figure was first entered. ONLY A PLAIN SINGLE CALL QUALIFIES: a figure row is re-opened from its
   * own lanes by `resumeFigure`, and a step that names no selection (or names everybody) leaves no
   * remainder, so neither gets a candidate.
   */
  private figureForWhile(): ParallelEntry | null {
    if (this.parallel) return this.parallel;
    const step = this.history[this.selectedStep];
    if (!step || isGroupStep(step)) return null;
    const spec = typeof step === 'string' ? splitSelection(step) : { selection: step.selection, call: step.call };
    if (!spec.selection) return null;
    const start = this.seq.startBoard();
    const remaining = this.seq.remainingSelection(start, spec.selection);
    if (!remaining) return null;
    return {
      start,
      board: start,
      index: this.selectedStep,
      groups: [
        { selection: spec.selection, calls: [spec.call] },
        { selection: remaining, calls: [] },
      ],
      active: 1,
    };
  }

  /**
   * The dancers that still have no call in the figure, as IDS, on the board the step starts from.
   *
   * BY IDS, NOT BY SELECTOR, and that distinction is a bug the browser found rather than a style choice. The
   * complement of the union is named `All Except A and B`, and once the union already covers everybody that
   * selector resolves to NOBODY - `All Except Heads and All Except Heads` (the union of the two lanes of an
   * ordinary pair) is a perfectly well-formed selector for an empty set. So the emptiness has to be measured
   * here, where the ids are, and not inferred from the selector being non-null.
   *
   * THE FIGURE IS HANDED IN rather than read from `this.parallel`, because `unassignedLane` and `laneGroups`
   * already hold it and `figureForWhile` rebuilds a candidate when no figure is open - reading the state
   * again here would build that candidate twice for one answer.
   */
  private unclaimedIds(p: ParallelEntry | null): number[] {
    if (!p) return [];
    const claimed = new Set<number>();
    for (const g of p.groups.filter((g) => g.calls.length > 0)) {
      for (const id of this.seq.selectionIds(p.start, g.selection) ?? []) claimed.add(id);
    }
    return p.start.dancers.filter((d) => !d.isGhost && !claimed.has(d.id)).map((d) => d.id);
  }

  /**
   * The selector naming the dancers no lane has claimed, or null once every dancer has one.
   *
   * ONE SELECTOR FOR THE UNION, because the selection grammar already subtracts a union: `All Except A and
   * B` resolves to the dancers in neither, MEASURED on a squared set (`All Except Heads and Sides` ->
   * nobody, which is what subtracting all eight means). So no new syntax is needed to name what is left
   * after two or three lanes.
   *
   * IT READS `figureForWhile`, SO IT ANSWERS WHILE NO FIGURE IS OPEN TOO - which is what makes it usable as
   * the enable condition of the button that opens one. See that method for the reported defect.
   */
  private unassignedLane(): string | null {
    const p = this.figureForWhile();
    if (!p || this.unclaimedIds(p).length === 0) return null;
    const claimed = p.groups.filter((g) => g.calls.length > 0).map((g) => g.selection);
    return claimed.length ? `All Except ${claimed.join(' and ')}` : null;
  }

  /**
   * The groups the NEXT lane can be given, resolved on the board the step starts from: all of the dancers no
   * lane has claimed, first, then every named group that sits strictly INSIDE them.
   *
   * THE NARROWING IS THE WHOLE POINT, and it is what makes a third group reachable: the remainder is the
   * complement of everything claimed so far, so a lane that takes all of it leaves nobody behind. MEASURED in
   * the browser - `Heads Promenade Full` leaves `All Except Heads` (the four sides), and the choices for the
   * next lane are that and the groups inside it (`Side Boys`, `Side Girls`, `Side Men`, `Side Women`, `Side
   * Beaus`, `Side Belles`), so `Sides Trade` can be given to two of them instead of all four.
   */
  private laneGroups(): string[] {
    const p = this.parallel;
    if (!p) return [];
    const left = this.unassignedLane();
    if (!left) return [];
    const leftIds = new Set(this.unclaimedIds(p));
    if (leftIds.size === 0) return [];
    const out = [left];
    for (const g of [...this.seq.subsetGroups(p.start), ...this.seq.combinedGroups(p.start)]) {
      if (g === left || out.includes(g)) continue;
      const ids = this.seq.selectionIds(p.start, g);
      if (!ids || ids.length === 0 || ids.length >= leftIds.size) continue;
      if (ids.every((id) => leftIds.has(id))) out.push(g);
    }
    return out;
  }

  /**
   * Leave parallel mode, restoring the ordinary picker.
   *
   * ONE EXIT PATH, because the mode changes what the CALL LIST answers: leaving it without rebuilding
   * the list would leave the remainder's calls on screen under the chosen group's heading.
   */
  private exitParallel(message?: string) {
    if (!this.parallel) return;
    this.setParallel(null);
    this.statusEl.textContent = message ?? '';
    this.refreshCallSelect();
  }

  /**
   * FINISH THE FIGURE, which is a button of its own rather than a second meaning for "+ Parallel call".
   *
   * The two readings of that one button were the defect: with a lane already started it FINISHED the step,
   * so a caller reaching for a third parallel group had the figure end under them and their next call land
   * as a new entry in the list. Reported as "when I add a third call to a parallel call it doesnt seem to
   * animate and it seem to be added to the call list as a new call".
   */
  private finishParallel() {
    const p = this.parallel;
    if (!p) return;
    const left = this.unassignedLane();
    const step = this.parallelEntry(p);
    const lanes = p.groups.filter((g) => g.calls.length > 0).length;
    this.exitParallel(
      `${stepLabel(step)} is finished — ${lanes > 1 ? `${lanes} parallel groups; ` : ''}`
      + (left ? `${left} keep the lane they have` : 'every dancer has a call'),
    );
    this.render();
    this.syncAnimation();
  }

  /**
   * Give the dancers the last call did NOT move their OWN call, in the SAME time slot, as one step.
   *
   * THE GROUPS RUN SIMULTANEOUSLY, NOT IN SEQUENCE - the step becomes a `GroupStep`, which the engine
   * applies from one board and charges the LONGEST group's beats. That is the whole point: a caller
   * saying "sides promenade while the heads step into the middle" is ONE figure, not two in a row.
   *
   * AND A GROUP MAY TAKE SEVERAL CALLS, which is the lane: APPLY APPENDS while the mode is on,
   * so a 16-beat call for the heads can be filled by "Sides Trade then Pass Thru". Each Apply rebuilds the
   * step from the lanes so far plus the call just picked, and applies it - so a lane that the engine refuses
   * never lands in the history, and the status line says which call refused.
   *
   * The call is taken from the picker, which is offering only what the ACTIVE LANE can do FROM THE BOARD ITS
   * NEXT CALL STARTS ON (`refreshCallSelect` narrows it by `groupCanPerform` against `parallel.board`, which
   * advances by one call per append), so the lane cannot be built from calls the group cannot perform in
   * order.
   */
  private applyParallel() {
    const p = this.parallel;
    if (!p) return;
    const lane = this.activeLane();
    if (!lane) return;
    const second = this.callSelect.value;
    if (!second) {
      this.setStatus('warn', `pick ${lane.selection}'s own call first`);
      return;
    }
    // THE PICKED CALL JOINS THE ACTIVE LANE, and every other lane is carried through untouched - so a third
    // group is a third lane rather than a new entry in the list.
    const calls = [...lane.calls, second];
    const groups = p.groups.map((g, i) => (i === p.active ? { ...g, calls } : g));
    const step = this.parallelStep({ groups });
    // THE STEP IS CHECKED ON THE BOARD IT STARTS FROM, ONCE. `replayHistory` has already put the live board
    // at the END of the sequence - which, once this entry is in the list, is the board the step PRODUCED - so
    // applying the step there applies it TWICE. That was harmless for the ordinary pair and stopped being so
    // as soon as a lane could be built up: MEASURED in the browser, `Heads Promenade Full while All Except
    // Heads Trade` applied, and adding `Touch a Quarter` to the lane was then refused with
    // `"Heads Promenade Full" in a "while" step: Promenade Full ...` - the heads' own call, failing from a
    // board the heads had already left. A pure check against `p.start` cannot do that, and it does not move
    // the live board either (the replay is what places it).
    const applied = this.seq.applyToBoard(p.start, step);
    if (!applied.legal) {
      // A refused append must not leave a half-built step in the list: RESTORE THE STEP AS IT WAS (which is
      // the single call when nothing has been appended yet), and KEEP THE MODE ON so the caller can pick a
      // different call instead of starting the lane again.
      const back = [...this.history];
      back[p.index] = this.parallelEntry(p);
      this.history = back;
      this.replayHistory();
      this.setParallel(p);
      this.statusEl.textContent = `✗ ${stepLabel(step)}${applied.reason ? ` — ${applied.reason}` : ''}`;
      this.render();
      this.refreshCallSelect();
      this.syncAnimation();
      return;
    }
    // REPLACE this figure's entry rather than appending: it is ONE step, so Undo removes the whole thing
    // and the sequence list shows one numbered row. The snapshot is taken HERE, after the legality check and
    // before the write, so a refused append is not an undoable non-event.
    this.pushUndo();
    const withStep = [...this.history];
    withStep[p.index] = step;
    this.history = withStep;
    this.replayHistory();
    // THE BOARD THE LANE'S NEXT CALL STARTS ON. Read from the apply rather than re-applying: `lanes` carries
    // the boards the applicator itself passed through (`ApplyResult.lanes`), which is the same board the
    // engine will charge the next call its beats against.
    const laneRun = applied.lanes?.find((l) => l.selection === lane.selection);
    const nextBoard = laneRun?.boards[laneRun.boards.length - 1] ?? p.board;
    this.setParallel({ ...p, groups, board: nextBoard });
    // THE BALANCE IS THE POINT OF THE FEATURE: two 4-beat calls against a 16-beat partner is only useful if
    // the caller can see it. Beats are read from the engine, per group, on the boards those groups start on,
    // and the step's own cost is the LONGEST lane - so the shortfall is exactly the beats this lane spends
    // standing. It is stated against the STEP rather than against one named partner, which is what makes it
    // true for a figure with three or more lanes.
    const laneBeats = calls.reduce((sum, c, i) => {
      const on = i === 0 ? p.board : laneRun?.boards[i] ?? p.board;
      return sum + this.seq.stepBeats(on, `${lane.selection} ${c}`);
    }, 0);
    const total = this.seq.sequenceBeats([step], p.start);
    // `render()` follows, which is what resets the status class - see `render`.
    this.statusEl.textContent =
      `✓ ${stepLabel(step)} — one step; Undo removes it`
      + ` · ${lane.selection} lane: ${calls.join(' then ')} = ${laneBeats} of ${total} beats`
      + (laneBeats < total
        ? ` — they stand for the other ${total - laneBeats}; Add again to fill it, or While… for another group`
        : ' — the times match');
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
  }

  /** Re-establish the board the current sequence BEGAN from, so replaying the
   * history reproduces the live sequence. Falls back to the home square. */
  private rewindToStart() {
    if (this.startBoard) this.seq.setBoard(this.startBoard);
    else this.seq.reset();
  }

  /**
   * TAKE AN UNDO SNAPSHOT, BEFORE the change. One snapshot per USER ACTION, which is what makes an applied
   * getout or an All8 import one Undo rather than one per call. `redoStack` is cleared because a new change
   * makes the undone future unreachable.
   *
   * A SNAPSHOT HOLDS THE START BOARD AS WELL AS THE CALLS, because `Clear` resets both: undoing a Clear that
   * restored only the calls would replay them from the home square and quietly rewrite the whole figure.
   * The entries are copied but never deep-copied - a step is never mutated in place, every edit path
   * replaces the array or an element - so the array itself is the snapshot.
   */
  private pushUndo() {
    this.undoStack.push({ steps: [...this.history], startBoard: this.startBoard });
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Put a snapshot back on screen: board, trace, list, picker. */
  private setHistory(snap: HistorySnapshot, message: string, kind: 'ok' | 'warn' | 'error' = 'ok') {
    this.history = [...snap.steps];
    this.startBoard = snap.startBoard;
    this.setParallel(null);
    this.replayHistory();
    this.setStatus(kind, message);
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
  }

  private undo() {
    this.runBusy(() => {
      if (this.undoStack.length === 0) {
        this.setStatus('warn', 'nothing to undo');
        return;
      }
      this.redoStack.push({ steps: [...this.history], startBoard: this.startBoard });
      this.setHistory(this.undoStack.pop()!, 'undone');
    }, 'Undoing…');
  }

  private redo() {
    this.runBusy(() => {
      if (this.redoStack.length === 0) {
        this.setStatus('warn', 'nothing to redo');
        return;
      }
      this.undoStack.push({ steps: [...this.history], startBoard: this.startBoard });
      this.setHistory(this.redoStack.pop()!, 'redone');
    }, 'Redoing…');
  }

  /**
   * REMOVE ONE STEP FROM THE SEQUENCE, from its own row in the timeline.
   *
   * The sequence is replayed from the start, so a step that later ones depended on can leave them unable to
   * play - and that is REPORTED rather than silently dropped: the rest is kept, the first row that no longer
   * plays is flagged from the walk's own `stop`, and the status line names it. Deleting the tail of a
   * sequence is therefore always safe, and deleting from the middle tells the caller exactly what it cost.
   */
  private deleteStep(idx: number) {
    this.runBusy(() => {
      if (idx < 0 || idx >= this.history.length) return;
      const label = stepLabel(this.history[idx]);
      this.pushUndo();
      const next = [...this.history];
      next.splice(idx, 1);
      this.setHistory({ steps: next, startBoard: this.startBoard }, `removed ${label}`);
      // `syncAnimation` (inside `setHistory`) has just re-derived `stop` for the shorter sequence.
      if (this.stop) {
        this.setStatus('warn', `removed ${label} — the sequence now stops before "${this.stop.call}": ${this.stop.reason}`);
      }
    }, 'Removing the step…');
  }

  /** Move the playhead by `d` beats, clamped to the sequence. The keyboard and the ⏪/⏩ buttons share it. */
  private nudgePlayhead(d: number) {
    if (this.totalBeats <= 0) return;
    this.playing = false;
    this.playBtn.textContent = '▶ Play';
    this.playhead = Math.max(0, Math.min(this.totalBeats, this.playhead + d));
    this.scrub.value = String(this.playhead);
    this.lastTraceKey = '';
    this.renderPlayhead();
    this.updateBeatLabel();
    this.settlePlayhead();
  }

  /** Load a named sequence whole and park the playhead at the first step that plays `atCall`.
   *
   * This is the browse view's "open" button. The sequence is loaded ENTIRELY - the call keeps its
   * context before and after it, which is the point of opening it rather than jumping to a board -
   * and then `seekTo` moves the playhead to where that call starts, so the animation is already at
   * the right place to press Play. */
  openSequence(steps: ModuleStep[], atCall?: string, startFormation?: string) {
    this.runBusy(() => {
      this.playing = false;
      this.playBtn.textContent = '▶ Play';

      // START WHERE THE MODULE SAYS IT STARTS, and REFUSE rather than substitute.
      //
      // The corpus records each module's start formation, and it is not a decoration: `ceder-7046` is
      // written for a `Zero Line`, and replayed from home its fourth call lands on a `T-Bone RDRD` from
      // which `Right and Left Grand` refuses - which reads as "the calls are broken" when the board is
      // what is wrong.
      //
      // A formation NAME is not enough, because the label names a formation AND an ARRANGEMENT.
      // `boardForFormation('Normal Lines')` classifies as `[L0]` and still is not a zero line: it
      // carries no identity and its couples are authored 1,4,3,2. So the start is built from a FASR
      // CODE (`L1o` = sequence in, facing couples 1-4 and 2-3) on the letter's template.
      //
      // A label that does not resolve is a FAILURE, not an approximation: nothing is loaded and the
      // reason is announced, because a silently wrong board is worse than no board.
      const declared = startFormation?.trim();
      const start = this.startBoardFor(declared);
      const startBoard = start?.board ?? null;
      if (declared && !startBoard) {
        this.history = [];
        this.startBoard = undefined;
        this.rewindToStart();
        this.lastTraceKey = '';
        this.refreshCallSelect();
        this.syncAnimation();
        this.setStatus('error', start?.spec
          ? `cannot load: starts from a "${declared}", which resolves to ${start.spec.code} - but the engine could not build that board.`
          : `cannot load: starts from a "${declared}", and this engine cannot put the dancers into that formation in the RIGHT arrangement. Replaying it from home would dance different calls, so it is refused rather than approximated.`);
        return;
      }
      this.startBoard = startBoard ?? undefined;
      const startLabel = start?.spec?.code ?? start?.spec?.formation ?? '';
      this.loadSteps(steps, atCall, startLabel);
    }, 'Loading the sequence…');
  }

  /**
   * Put `steps` on the board from `this.startBoard`, as ONE load: everything a load has to do, in the order a load
   * must do it.
   *
   * SHARED, because All8's import, the sequence document's import, the browse view's open and a saved module all need the
   * same act with a different syntax in front of it. One body means a refused step, the undo reset, the settle and the
   * report cannot differ between the four.
   *
   * CALLED INSIDE `runBusy`, with `this.startBoard` already set by the caller (the caller is the one that knows
   * whether its start came from a FASR code, a catalogue row or exact poses). `notes` is for what the CALLER's resolver
   * tolerated - a stored board whose ids disagree, say - so it lands in the one report line rather than a second write
   * that would overwrite the load's own.
   */
  private loadSteps(steps: ModuleStep[], atCall: string | undefined, startLabel: string, notes: string[] = []) {
    // A LOAD IS A NEW DOCUMENT: the undo history belongs to the sequence being replaced, so both stacks are
    // dropped rather than left to undo an edit into a sequence the caller has navigated away from.
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    // THE STEPS AS THE DOCUMENT WROTE THEM, so a module stays ONE row here too: `flatten` below is what the walk and the
    // beats use, and it is asked for explicitly rather than by rewriting the caller's list.
    this.history = [...steps];
    this.rewindToStart();
    let refused = 0;
    for (const name of this.seq.flatten(this.history)) {
      const r = this.seq.applyStep(name);
      if (!r.legal) refused++;
    }
    this.lastTraceKey = '';
    this.refreshCallSelect();
    this.syncAnimation();
    // The sequence is parked at its END (`syncAnimation`), so settle there: the loaded module's final
    // formation is what the next-call list should answer from. `seekTo` below re-settles if the
    // browse view asked to park on a particular call instead.
    this.settlePlayhead();
    const idx = atCall === undefined ? -1 : this.history.findIndex((s) => callKey(s) === callKey(atCall));
    if (idx >= 0) this.seekTo(idx);
    this.setStatus(this.stop ? 'warn' : 'ok', [
      `loaded ${this.history.length} call(s)`,
      startLabel ? `from ${startLabel}` : '',
      refused ? `${refused} refused` : '',
      // The walk's own verdict, which is the one that decides where the ANIMATION ends. Named
      // because a count does not tell the user that the last frame is the board before that call.
      this.stop ? `stops at "${this.stop.call}" - ${this.stop.reason}` : '',
      ...notes,
    ].filter(Boolean).join(', '));
  }

  /** Move the playhead to the START of history step `idx`.
   *
   * SEEK, DO NOT EDIT. This used to do `this.history.length = idx`, which DELETED the clicked
   * call and every call after it - selecting a call in the list was a destructive edit. A click
   * in the sequence list is navigation, so nothing here touches `history`.
   *
   * The board at any beat is already "as if they had danced from the beginning", because the
   * animation is evaluated from the sequence's own `startBoard` by `evaluateSequence`; seeking is
   * therefore just a parse of where that call begins. The LIVE board is moved too, so the
   * formation readout and the call picker agree with what is drawn - which means `applySelected`
   * has to put the board back at the end before it appends (see there). */
  /**
   * RE-OPEN A FIGURE FROM ITS OWN TIMELINE ROW, so its FREE BEATS can still be filled.
   *
   * Asked for as: "when I click on a parallel slot in the sequencer, reload the parallel system so I can add
   * more calls to the free beats in the slot." A figure is ONE history step (`GroupStep`), and every way out of
   * the mode - `Finish figure`, a new call, Undo, a group change - clears `parallel`; after that the row was
   * only a seek, and the lane it built could never be extended. Clicking it now rebuilds the mode from the
   * STEP ITSELF:
   *
   *   - the start board is the one `seekTo` has just put the live board on (the playhead at the step's first
   *     beat evaluates to the board BEFORE it), so the step is re-applied there purely - the live board is not
   *     touched, exactly as `applyParallel` does it;
   *   - the lanes are the step's own groups, so the banner and the picker describe the figure that is really in
   *     the list, not a rebuilt guess;
   *   - the ACTIVE lane is the one with the MOST FREE BEATS, which is what was clicked for. A figure whose
   *     lanes all finish together leaves the LAST lane active, which is the one a further call would extend.
   *
   * Returns false for a row that is not a figure, so the caller can leave the mode alone (or clear it).
   */
  private resumeFigure(idx: number): boolean {
    const step = this.history[idx];
    if (!step || !isGroupStep(step)) return false;
    const groups = step.groups.map((g) => ({ selection: g.selection, calls: groupCalls(g) }));
    if (groups.length === 0) return false;
    const start = this.seq.startBoard();
    const applied = this.seq.applyToBoard(start, step);
    if (!applied.legal) {
      this.setStatus('error', `${stepLabel(step)} cannot be re-opened — ${applied.reason ?? 'it does not apply from its own start board'}`);
      return false;
    }
    const fill = this.laneFill({ start, groups });
    let active = groups.length - 1;
    let bestFree = -1;
    fill.forEach((f, i) => { if (f.free > bestFree) { bestFree = f.free; active = i; } });
    const lane = groups[active];
    const run = applied.lanes?.find((l) => l.selection === lane.selection);
    this.setParallel({
      start,
      board: run?.boards[run.boards.length - 1] ?? start,
      index: idx,
      groups,
      active,
    });
    // PAINT BEFORE THE MESSAGE: `render` resets the status line's colour, so the message goes last or it
    // would wear the default one.
    this.render();
    this.refreshCallSelect();
    this.setStatus('ok', bestFree > 0
      ? `editing ${stepLabel(step)} — ${lane.selection} lane: ${lane.calls.join(' then ')} = `
        + `${fill[active].beats.toFixed(1)} of ${fill[active].total.toFixed(1)} beats, `
        + `${bestFree.toFixed(1)} free. Add fills it, While… opens another lane, Finish figure ends it.`
      : `editing ${stepLabel(step)} — every lane is full (${fill[active].total.toFixed(1)} beats). `
        + `Add LENGTHENS ${lane.selection}'s lane, While… opens another lane, Finish figure ends it.`);
    return true;
  }

  private seekTo(idx: number) {
    if (idx < 0 || idx >= this.history.length) return;
    this.playing = false;
    this.playBtn.textContent = '▶ Play';
    this.playhead = this.beatAtStep(idx);
    this.scrub.value = String(this.playhead);
    this.statusEl.textContent = '';
    this.lastTraceKey = '';
    this.renderPlayhead();
    this.updateBeatLabel();
    // The seek is finished, so the board under the playhead is definite: one settle puts the live
    // board, the readout and the call picker on it - the same call the frame loop and the scrub
    // release make, rather than a second copy of it here.
    this.settlePlayhead();
  }

  /** The beat at which history step `idx` begins: the total beats of the steps before it.
   *
   * Counted through `flatten` per step because a MODULE expands to several flat steps, so a
   * history index is not a flat index. `sequenceBeats` needs the prefix, and the prefix is what
   * "everything up to this call" means in beats. */
  private beatAtStep(idx: number): number {
    let flatCount = 0;
    for (let i = 0; i < idx; i++) flatCount += this.seq.flatten([this.history[i]]).length;
    if (flatCount === 0) return 0;
    return this.seq.sequenceBeats(this.flat.slice(0, flatCount), this.startBoard);
  }

  private reset() {
    this.runBusy(() => {
      if (this.history.length > 0) this.pushUndo();
      this.history.length = 0;
      this.setParallel(null);
      // Reset returns the set to the home square, so the sequence starts from home
      // again (any formation jumped to with "Set" is forgotten).
      this.startBoard = undefined;
      this.seq.reset();
      this.statusEl.textContent = '';
      this.render();
      this.refreshCallSelect();
      this.syncAnimation();
    }, 'Clearing the sequence…');
  }

  // ---------------------------------------------------------------- All8 format

  /** Import All8 call-format text (engine/src/sequencer/all8-format.ts).
   *
   * An All8 PAGE is a BLOCK of figures - indentation shares the leading calls - so the parse
   * returns several complete sequences, not one. They are alternatives to choose between, not a
   * medley, so the FIRST is loaded and the count of the others is reported rather than silently
   * concatenating them.
   *
   * A `[FASR]` setup code is reported but NOT applied: the engine has no FASR-code -> board
   * derivation yet (PLAN.md Phase 7), so the figure is danced from whatever board is up. The status
   * names the setup the page wanted so the caller can "Set" it first. */
  private importAll8() {
    this.runBusy(() => {
      const text = this.all8Text.value;
      if (!text.trim()) {
        this.all8InfoEl.textContent = 'nothing to import';
        return;
      }
      const { figures, skipped } = parseAll8Figures(text);
      if (figures.length === 0) {
        this.all8InfoEl.textContent = `✗ no All8 figure found (${skipped.length} non-figure line(s) skipped)`;
        return;
      }
      const fig = figures[0];
      const unknown = [...new Set(fig.calls.filter((c) => c.names.length === 0).map((c) => c.token))];
      if (unknown.length > 0) {
        this.all8InfoEl.textContent = `✗ unreadable token(s): ${unknown.join(', ')}`;
        return;
      }

      this.reset();
      // Apply the [FASR] setup code, so a published figure is danced from the board its page assumes.
      // The code alone is enough - no diagram - because the FASR state fixes the formation, the
      // arrangement and the relationships, and the engine's own template supplies the metric and
      // facings (engine alignment.ts boardForFasrCode). Two of All8's 29 published alignments cannot
      // be derived this way and FAIL LOUDLY rather than being silently ignored: [P] (Beginning Double
      // Pass Thru), where no relationship letter is justified at all.
      let setupNote = '';
      if (fig.setup) {
        const built = boardForFasrCode(fig.setup, (letter) => {
          for (const name of FORMATIONS_FOR_LETTER[letter] ?? []) {
            const b = this.seq.boardForFormation(name);
            if (b) return b;
          }
          return null;
        });
        if (built.board) {
          this.seq.setBoard(built.board);
          this.startBoard = built.board;
          setupNote = `setup [${fig.setup}] applied`;
        } else {
          setupNote = `setup [${fig.setup}] NOT applied — ${built.reason}`;
        }
      }
      const names = fig.calls.flatMap((c) => c.names);
      let applied = 0;
      let stopped = '';
      for (const name of names) {
        const step = this.seq.apply(name);
        if (!step.legal) {
          stopped = ` at "${name}"${step.reason ? ` — ${step.reason}` : ''}`;
          break;
        }
        this.history.push(...this.seq.flatten([name]));
        applied++;
      }
      const parts = [`${applied}/${names.length} calls`];
      if (stopped) parts.unshift(`✗ stopped${stopped}`);
      if (setupNote) parts.push(setupNote);
      if (figures.length > 1) parts.push(`${figures.length} figures in the text, loaded figure 1`);
      this.all8InfoEl.textContent = parts.join(' · ');
      this.render();
      this.refreshCallSelect();
      this.syncAnimation();
    }, 'Importing the figure…');
  }

  /** Export the current sequence as a single All8 call-format line. A call with no All8
   * abbreviation comes out in `[square brackets]` rather than being dropped, so the output never
   * claims to be more complete than it is. */
  private exportAll8() {
    if (this.history.length === 0) {
      this.all8InfoEl.textContent = 'nothing to export';
      return;
    }
    const names = this.history.map(stepLabel);
    const text = formatAll8Figures([names]);
    this.all8Text.value = text;
    const unmapped = (text.match(/\[[^\]]+\]/g) ?? []).length;
    this.all8InfoEl.textContent = `${names.length} calls exported`
      + (unmapped > 0 ? ` · ${unmapped} with no All8 abbreviation (in brackets)` : '');
  }

  // ---------------------------------------------------------------- the sequence document

  /**
   * The board a CORPUS START LABEL names, and the spec it resolved through - or null when the label is empty or one this
   * app has never heard of.
   *
   * ONE BUILDER FOR EVERY CALLER, because the label bridge is a rule and not an implementation detail: the browse view's
   * open, the sequence document's formation resolver, and the start board a ceder module is REGISTERED with all have to
   * agree, or the picker offers a module from a board the loader would not stand up.
   *
   * `{ board: null, spec }` is the third answer and it is not the same as `null`: the label IS one of the corpus's, and
   * this engine cannot build the arrangement it means - a failure worth naming rather than falling back from.
   */
  private startBoardFor(label: string | undefined): { board: Board | null; spec: StartSpec } | null {
    const declared = label?.trim();
    if (!declared) return null;
    const spec = resolveStartFormation(declared);
    if (!spec) return null;
    const board = spec.formation
      ? this.seq.boardForSetup(spec.formation)
      : boardForFasrCode(spec.code ?? '', (l) => {
          const name = LETTER_TEMPLATE[l];
          return name ? this.seq.boardForFormation(name) : null;
        }).board;
    return { board: board ?? null, spec };
  }

  /**
   * THE THREE QUESTIONS `sequence-json.ts` CANNOT ANSWER ALONE, answered from the live app.
   *
   * The catalogue is the Board drawer's own setup list (`setupRows`, keyed by `sid`), so a document's `sid` resolves to
   * exactly the board that picker would stand up; the labels are the corpus bridge (`resolveStartFormation`) and then
   * the engine's own formation library; and a `vid` is the registered variant whose stored tag it is
   * (`Sequencer.variantByVid`). None of the three is re-implemented here.
   */
  private sequenceResolvers(): SequenceResolvers {
    const asDancers = (dancers: readonly FormDancer[]): SequenceDancer[] =>
      dancers.map((d) => ({ gender: d.gender ?? 'phantom', x: d.x, y: d.y, heading: d.heading }));
    return {
      setup: (sid) => {
        const row = this.setupRows.find((r) => r.sid === sid);
        return row ? { sid: row.sid, fid: row.fid, aid: row.aid, display: row.display, dancers: asDancers(row.dancers) } : null;
      },
      formation: (name) => {
        // THE CORPUS LABELS FIRST, through the one builder the loader uses; then the engine's own names, which is what a
        // hand-written document most often carries (`Static Square`, `Eight Chain Thru`).
        const bridged = this.startBoardFor(name);
        const board = bridged
          ? bridged.board
          : this.seq.boardForSetup(name) ?? this.seq.boardForFormation(name);
        return board ? { dancers: asDancers(board.dancers), label: name } : null;
      },
      variant: (vid) => {
        const found = this.seq.variantByVid(vid);
        return found ? { title: found.title } : null;
      },
    };
  }

  /**
   * A board as a document writes it: the ids, a readable caption, and the exact poses only where no catalogue row
   * carries the id.
   *
   * ONE CONVERSION FOR EVERY BOARD THE APP WRITES DOWN - the sequence document's `start`/`end` and a saved module's
   * `start`/`end` - because a module that recorded its board differently from a document would be a second format, and
   * the two are the same data. The poses are the unambiguous form and are repeated only when they are the ONLY form: a
   * catalogue `sid` already says everything they say, and repeating them would make every export needlessly large.
   */
  private setupRefOfBoard(board: Board, fallback: string): SetupRefJson {
    const ids = idsOf(board);
    const row = ids.sid ? this.setupRows.find((r) => r.sid === ids.sid) : undefined;
    const ref: SetupRefJson = {};
    if (ids.sid) ref.sid = ids.sid;
    if (ids.aid) ref.aid = ids.aid;
    if (ids.fid) ref.fid = ids.fid;
    ref.name = row?.display ?? this.seq.knownFormation(board) ?? fallback;
    if (!row) ref.dancers = board.dancers.filter((d) => !d.isGhost).map((d) => ({ gender: d.gender, x: d.x, y: d.y, heading: d.heading }));
    return ref;
  }

  /**
   * EXPORT the sequence as a native document: the start board (ids plus the caption), every step with the call-variant
   * id the walk matched, and the end board.
   *
   * THE IDS ARE THE POINT. A name can be respelled and a title retitled; `sid`/`aid`/`fid` name the definition and the
   * order, and `vid` names the authoring (level, title, start definition), so a re-import resolves the same boards and
   * the same calls without matching by name at all. A step the walk could not match carries no `vid` - the document says
   * what is unknown rather than inventing it - and is counted in the report.
   */
  private exportSequence() {
    if (this.history.length === 0) {
      this.jsonInfoEl.textContent = 'nothing to export — add calls first';
      return;
    }
    const steps: SequenceStepJson[] = [];
    let stamped = 0;
    let unmatched = 0;
    for (const [i, step] of this.history.entries()) {
      if (isGroupStep(step)) {
        steps.push({ groups: step.groups.map((g) => ({ selection: g.selection, calls: groupCalls(g) })) });
        continue;
      }
      // A MODULE STEP IS A NAME, NOT A VARIANT: its own `vid` would be the first of its calls, which is a different
      // thing and would import as that call alone. The module name is the step, and it resolves against the library.
      if (typeof step === 'string' && this.seq.isModule(step)) {
        steps.push(step);
        continue;
      }
      const info = this.seq.sequenceInfo(this.flat, this.beatAtStep(i), this.startBoard);
      const vid = info?.variant.vid ?? null;
      if (vid) stamped++;
      else unmatched++;
      if (typeof step === 'string') {
        steps.push(vid ? { call: step, vid } : step);
        continue;
      }
      const ref: StepRefJson = { call: step.call };
      if (step.selection !== undefined) ref.selection = step.selection;
      if (vid) ref.vid = vid;
      steps.push(ref);
    }
    const startBoard = this.startBoard ?? this.seq.startBoard();
    const endBoard = this.seq.evaluateSequence(this.flat, this.totalBeats, this.startBoard).board;
    const doc: SequenceDocJson = {
      format: SEQUENCE_FORMAT,
      version: SEQUENCE_VERSION,
      name: this.moduleNameInput.value.trim() || 'untitled sequence',
      start: this.setupRefOfBoard(startBoard, 'start'),
      steps,
    };
    const end = this.setupRefOfBoard(endBoard, 'end');
    if (end.sid || end.dancers) doc.end = end;
    const text = sequenceToJson(doc);
    this.jsonText.value = text;
    const report = `exported ${steps.length} step(s)`
      + (stamped ? ` · ${stamped} with a call-variant id` : '')
      + (unmatched ? ` · ${unmatched} with none (the walk matched no variant)` : '');
    this.jsonInfoEl.textContent = report;
    navigator.clipboard.writeText(text).then(
      () => { this.jsonInfoEl.textContent = `${report} · copied`; },
      () => { this.jsonInfoEl.textContent = `${report} · clipboard unavailable`; },
    );
  }

  /**
   * IMPORT a native sequence document: resolve it, stand its start board up, then load the steps by the one shared
   * path.
   *
   * A REFUSAL IS THE WHOLE DOCUMENT OR NONE OF IT: the parse, the start and every step are resolved BEFORE the board is
   * touched, so a document with one bad step leaves the sequence on screen exactly as it was, with the step's index and
   * the reason in the status line. What the resolver tolerated (a `vid` this level does not hold, a name that disagrees
   * with an id) is said afterwards rather than swallowed.
   */
  private importSequence() {
    this.runBusy(() => {
      const text = this.jsonText.value;
      if (!text.trim()) {
        this.jsonInfoEl.textContent = 'nothing to import';
        return;
      }
      const parsed = parseSequenceDoc(text);
      if (!parsed.ok) {
        this.setStatus('error', `✗ ${parsed.reason}`);
        return;
      }
      const resolved = resolveSequence(parsed.doc, this.sequenceResolvers());
      if (!resolved.ok) {
        this.setStatus('error', `✗ ${resolved.reason}`);
        return;
      }
      this.playing = false;
      this.playBtn.textContent = '▶ Play';
      // THE START BOARD, through the same call the Board drawer uses, so the identity rules (home match, the registry
      // overlay, `UNKNOWN_COUPLE` away from home) are the ones a picked setup gets - not a second board builder.
      this.seq.setSetupBoard(resolved.sequence.start.dancers, resolved.sequence.start.label);
      this.startBoard = this.seq.startBoard();
      this.loadSteps(resolved.sequence.steps, undefined, resolved.sequence.start.label);
      // THE DECLARED END IS A CHECK. The replay is the board; a document whose `end` disagrees is reporting a mistake
      // (or a corpus revision), which is worth saying and is not a reason to refuse the sequence.
      const declared = parsed.doc.end;
      if (declared?.sid) {
        const endBoard = this.seq.evaluateSequence(this.flat, this.totalBeats, this.startBoard).board;
        const actual = idsOf(endBoard).sid;
        if (actual !== declared.sid) {
          this.jsonInfoEl.textContent = `end check: the document says ${declared.sid}, the sequence ends on ${actual ?? 'an unnamed board'}`;
        } else {
          this.jsonInfoEl.textContent = `end check: ends on ${actual}, as the document says`;
        }
      } else {
        this.jsonInfoEl.textContent = `${resolved.sequence.steps.length} step(s) loaded`;
      }
      if (resolved.sequence.notes.length) {
        this.jsonInfoEl.textContent += ` · ${resolved.sequence.notes.join(' · ')}`;
      }
    }, 'Importing the sequence…');
  }

  /**
   * THE SOLVE DRAWER: three questions, one Search, one Apply.
   *
   * It replaces five buttons that wrote into three different blocks - `Getout` and `Getin` and
   * `Matrix getout` each put a SENTENCE in the one status line (so the answer to Add lived beside
   * "Copy positions"), `Fix it` wrote into a block of its own, and `Apply getout` silently appended a whole
   * path one call at a time. The questions are now a tab, the answers are LINES you can click, and Apply
   * acts on the line you chose. Nothing about the searches themselves changed: the same
   * `getout`/`getin`/`fixIt`/`matrixGetout` calls, the same targets and bounds.
   */
  private runSolve() {
    this.runBusy(() => {
      this.solveChosen = 0;
      if (this.solveTab === 'getout') {
        // THE RIGID PATH IS THE SAME QUESTION, not a separate button: a one-call self-inverse getout is the
        // best possible answer to "how do I get home from here", so when the caller asks for it first it is
        // offered as the first line.
        const lines: { label: string; calls: string[] }[] = [];
        if (this.matrixFirstInput.checked) {
          const rigid = this.seq.matrixGetout();
          if (rigid && rigid.length) lines.push({ label: `${rigid.join(' > ')} — rigid, self-inverse (one call)`, calls: rigid });
        }
        const path = this.seq.getout({ target: 'Static Square', maxCalls: 5 });
        if (path && path.length) lines.push({ label: path.join(' > '), calls: path });
        this.solveLines = lines;
        this.solveInfoEl.textContent = lines.length
          ? `${lines.length} answer${lines.length === 1 ? '' : 's'}`
          : 'no getout found (≤5 calls)';
        this.updateMatrixInfo();
      } else if (this.solveTab === 'getin') {
        const target = this.seq.recognize(this.seq.board).name ?? 'Static Square';
        const gi = this.seq.getin({ target, maxCalls: 5, budget: 400 });
        this.solveLines = gi && gi.length ? [{ label: gi.join(' > '), calls: gi }] : [];
        this.solveInfoEl.textContent = gi && gi.length
          ? `→ ${target}`
          : `no getin found → ${target} (≤5 calls)`;
      } else {
        // FIX IT answers with single CALLS rather than a path, so each line is one call to add.
        const fixes = this.seq.fixIt({ target: 'Static Square', depth: 3 });
        this.solveLines = fixes.map((name) => ({ label: name, calls: [name] }));
        this.solveInfoEl.textContent = fixes.length
          ? `${fixes.length} call${fixes.length === 1 ? '' : 's'} keep a getout alive`
          : 'no fix-it move keeps a getout alive';
      }
      this.renderSolve();
    }, 'Searching…');
  }

  private renderSolve() {
    this.tabGetoutBtn.className = this.solveTab === 'getout' ? 'on' : '';
    this.tabGetinBtn.className = this.solveTab === 'getin' ? 'on' : '';
    this.tabFixBtn.className = this.solveTab === 'fix' ? 'on' : '';
    this.solveApplyBtn.disabled = this.solveLines.length === 0;
    if (this.solveLines.length === 0) {
      this.fixListEl.innerHTML = '';
      return;
    }
    if (this.solveChosen >= this.solveLines.length) this.solveChosen = 0;
    this.fixListEl.innerHTML = this.solveLines
      .map((l, i) => `<button type="button" class="seq-line${i === this.solveChosen ? ' on' : ''}" `
        + `data-solve="${i}" role="option" aria-selected="${i === this.solveChosen}">`
        + `${esc(l.label)} <span class="seq-line-note">· ${l.calls.length} call${l.calls.length === 1 ? '' : 's'}</span>`
        + '</button>')
      .join('');
  }

  private setSolveTab(tab: 'getout' | 'getin' | 'fix') {
    this.solveTab = tab;
    this.solveLines = [];
    this.solveChosen = 0;
    this.solveInfoEl.textContent = '';
    this.renderSolve();
  }

  /**
   * APPLY THE CHOSEN LINE, AS ONE STEP AND ONE UNDO.
   *
   * The old `Apply getout` pushed one history entry per call, so undoing a five-call getout took five
   * presses; it is one snapshot here. Every call is still applied through `seq.apply` in order and a
   * refusal still stops with the failing call named - the difference is only what the panel reports and how
   * much of it one Undo takes back.
   */
  private applySolve() {
    this.runBusy(() => {
      const line = this.solveLines[this.solveChosen];
      if (!line) return;
      // THE REDO STACK IS CAPTURED FIRST, because `pushUndo` clears it and a REFUSED apply changes nothing -
      // so a caller who had undone something would otherwise lose that future to a refusal.
      const redoBefore = [...this.redoStack];
      this.pushUndo();
      this.replayHistory();
      const added: ModuleStep[] = [];
      for (const name of line.calls) {
        const step = this.seq.apply(name);
        if (!step.legal) {
          // A HALF-APPLIED PATH IS NOT LEFT IN THE SEQUENCE: the snapshot is restored, so a refusal is a
          // refusal rather than a partly-built line the caller has to unpick.
          this.undoStack.pop();
          this.redoStack = redoBefore;
          this.replayHistory();
          this.setStatus('error', `✗ ${name} refused — ${step.reason ?? 'cannot be danced from here'}`);
          this.render();
          this.refreshCallSelect();
          this.syncAnimation();
          return;
        }
        added.push(...this.seq.flatten([name]));
      }
      this.history.push(...added);
      this.setParallel(null);
      this.setStatus('ok', `✓ applied ${line.label} — one step; Undo removes it`);
      this.render();
      this.refreshCallSelect();
      this.syncAnimation();
    }, 'Applying the answer…');
  }

  private updateMatrixInfo() {
    const rigid = this.seq.matrixGetout();
    const closeness = this.seq.closenessToHome();
    this.matrixInfoEl.innerHTML =
      `closeness-to-home: <b>${closeness.toFixed(2)}</b> · ` +
      `matrix rigid getout: <b>${rigid ? rigid.join(' > ') : '—'}</b>`;
  }

  private wireEvents() {
    this.applyBtn.addEventListener('click', () => this.applySelected());
    // THE PARALLEL BUTTON DOES NOT APPLY ANYTHING ON ITS OWN. It puts the picker into the mode where the
    // list offers the calls for whoever has no lane; Apply then composes the step - and APPENDS to the ACTIVE
    // lane, so a long call can be filled by several short ones.
    // THE BUTTON OPENS ANOTHER LANE, AND NEVER FINISHES THE FIGURE - `Done` does that. It used to mean both,
    // and the second meaning is the reported defect: a caller reaching for a THIRD parallel group had the
    // step end under them, and the call they then applied landed as a new entry in the list.
    this.parallelBtn.addEventListener('click', () => this.runBusy(() => {
      // RE-OPEN THE FIGURE THE SELECTED STEP STILL DESCRIBES, when `Finish figure`, a timeline click or a
      // group change has closed it. This is the reported press: `Heads Promenade 3/4 to Home` in the list,
      // "Finish figure", the row clicked, and then "I want to add a new call for the sides so I press While
      // button, but it doesn't seem to do anything." The button's enable condition is derived from this same
      // figure, so the press and the condition cannot disagree about whether there is one to open.
      if (!this.parallel) {
        const reopened = this.figureForWhile();
        if (reopened) {
          // READ THE REMAINDER BEFORE THE MODE OWNS IT, from the same `unassignedLane` the button's own
          // enable condition reads - one computation, so the message cannot name a different group.
          const left = this.unassignedLane() ?? '';
          this.setParallel(reopened);
          // THE PICKER ANSWERS A DIFFERENT QUESTION INSIDE A FIGURE - the remainder's calls - so it is
          // rebuilt with the mode, exactly as `resumeFigure` does for a figure row.
          this.refreshCallSelect();
          this.setStatus('ok', `${left} left — pick their call, then Add`
            + ' · While… again narrows their lane to a smaller group, and Finish figure ends the figure');
          this.callSelect.focus();
          return;
        }
      }
      const p = this.parallel;
      if (!p) {
        // NO FIGURE TO RE-OPEN AND NO REMAINDER TO GIVE ONE: `figureForWhile` is the button's own enable
        // condition, so a press that gets here is one whose selected step took everybody. Say which, rather
        // than appearing to do nothing - which is how a no-op read in the report that this button "doesn't
        // seem to do anything".
        this.setStatus('warn',
          'nothing to pair: the last step must be a SINGLE call that leaves some dancers standing. '
          + 'Add a subset call (e.g. Heads Promenade Full) first.');
        return;
      }
      const lane = this.activeLane()!;
      // WHO THE NEXT LANE GETS comes from the group selector, which in parallel mode lists the groups that
      // resolve inside the unclaimed dancers. Leaving it on the whole remainder is the ordinary two-group
      // figure; narrowing it is what SPLITS the dancers, and therefore what builds a THIRD group.
      const choices = this.laneGroups();
      const picked = this.chosenGroup();
      const chosen = picked && choices.includes(picked) ? picked : null;
      if (lane.calls.length === 0) {
        // THE LANE ALREADY OPEN IS EMPTY, so this press has one useful thing left to do: NARROW it. That is
        // the whole of splitting a group - the remainder's lane starts as everyone no lane has claimed, and
        // the caller says "actually, this lane is only the Side Boys", which leaves the Side Girls for
        // another. A press that narrows nothing says what is missing instead of opening a second empty lane.
        if (chosen && chosen !== lane.selection) {
          const groups = p.groups.map((g, i) => (i === p.active ? { ...g, selection: chosen } : g));
          this.setParallel({ ...p, groups, board: p.start });
          this.setStatus('ok', `${chosen} left — pick their call, then Add`
            + ' · While… then opens a lane for whoever is still unclaimed, and Finish figure ends it');
          this.callSelect.value = '';
          this.refreshCallSelect();
          this.callSelect.focus();
          return;
        }
        this.setStatus('warn', `${lane.selection} still have no call — pick theirs in the list and press Add`
          + ` · Add again adds a SECOND call to the same lane, and Finish figure ends the figure`);
        this.callSelect.focus();
        return;
      }
      const left = this.unassignedLane();
      if (!left) {
        // EVERY DANCER IS IN A LANE: the honest answer is that the figure is complete, not a silent no-op.
        this.setStatus('warn', `every dancer has a call in ${stepLabel(this.parallelEntry(p))}`
          + ' — Add adds another call to a lane, and Finish figure ends the figure');
        return;
      }
      // ANOTHER LANE, FOR THE DANCERS NO LANE HAS CLAIMED, and it starts back on the board the STEP starts
      // from - a lane begins at beat 0, however long the others are. The group is the one chosen above, or the
      // whole remainder when the caller left the selector alone.
      const forLane = chosen ?? choices[0] ?? left;
      const groups = [...p.groups, { selection: forLane, calls: [] }];
      this.setParallel({ ...p, groups, active: groups.length - 1, board: p.start });
      this.setStatus('ok', `${forLane} left — pick their call, then Add`
        + ' · Add again adds a second call to their lane, and Finish figure ends the figure');
      // THE FIRST CALL IS CLEARED OUT OF THE PICKER, so "pick their call" is literally true. The list keeps the
      // previous selection when it is still offered (`refreshCallSelect`), and in parallel mode the previous
      // selection is the call that was just applied - which is very often still legal for the remainder.
      // MEASURED on `Sides Step Forward`: press Parallel, press Apply without touching the picker, and the pair
      // composed itself as "Sides Step Forward while All Except Sides Step Forward" - refused by the engine (two
      // dependent groups), leaving the first call alone in the history and a 2-beat scrub, which reads as "the
      // parallel call only lasts as long as the Step Forward". A refusal the caller caused by not touching a
      // control is the kind this panel refuses elsewhere.
      this.callSelect.value = '';
      this.refreshCallSelect();
      this.callSelect.focus();
    }, 'Opening another lane…'));
    this.parallelDoneBtn.addEventListener('click', () => this.finishParallel());
    this.callSelect.addEventListener('change', () => (this.statusEl.textContent = ''));
    // Changing the GROUP re-reads the call list for that group - the picker offers the calls that group
    // can actually do, so the two selectors cannot disagree about who acts.
    this.groupSelect.addEventListener('change', () => this.runBusy(() => {
      this.statusEl.textContent = '';
      // A DIFFERENT GROUP IS A DIFFERENT STEP, so any pending parallel pairing is void: its remainder was
      // computed for the group that has just been replaced. Leaving it would compose a step whose groups
      // silently overlap, which the engine refuses - a loud failure, but one the caller did not cause.
      this.setParallel(null);
      this.refreshCallSelect();
    }, 'Reading the calls for this group…'));
    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    this.resetBtn.addEventListener('click', () => this.reset());
    // THE SOLVE DRAWER: one Search per question, one Apply on the chosen answer.
    this.tabGetoutBtn.addEventListener('click', () => this.setSolveTab('getout'));
    this.tabGetinBtn.addEventListener('click', () => this.setSolveTab('getin'));
    this.tabFixBtn.addEventListener('click', () => this.setSolveTab('fix'));
    this.solveRunBtn.addEventListener('click', () => this.runSolve());
    this.solveApplyBtn.addEventListener('click', () => this.applySolve());
    this.fixListEl.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('.seq-line') as HTMLElement | null;
      if (t?.dataset.solve != null) {
        this.solveChosen = Number(t.dataset.solve);
        this.renderSolve();
      }
    });
    this.saveModuleBtn.addEventListener('click', () => this.saveModule());
    this.all8ImportBtn.addEventListener('click', () => this.importAll8());
    this.all8ExportBtn.addEventListener('click', () => this.exportAll8());
    this.jsonImportBtn.addEventListener('click', () => this.importSequence());
    this.jsonExportBtn.addEventListener('click', () => this.exportSequence());
    this.setFormationBtn.addEventListener('click', () => this.setBoardFormation());
    this.boardRotInput.addEventListener('change', () => this.applyBoardRot());
    this.view2dEl.addEventListener('change', () => {
      this.use2d = this.view2dEl.value === '2d';
      this.lastTraceKey = '';
      if (this.active) {
        this.render();
        this.updateCurrentTrace();
      }
      // Nothing to do when the sequencer is off screen: the select is not reachable from another
      // panel, and setting the camera here would override whoever IS on screen (see `setActive`).
    });
    this.levelSelect.addEventListener('change', () => this.rebuildSeq());
    this.marginInput.addEventListener('input', () => this.applyMargin());
    // THE SUBSET LINKS. DELEGATED, because the line is re-rendered on every board change and per-link
    // listeners would have to be re-attached each time (and leaked whenever that was forgotten). A second
    // press takes the subset back out, which is the whole interaction: press to see who they are, press
    // again to stop seeing it.
    this.subsetInfoEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-subset]');
      const name = btn?.dataset.subset;
      if (!name) return;
      if (this.litSubsets.has(name)) this.litSubsets.delete(name);
      else this.litSubsets.add(name);
      this.applySubsetMarks();
      this.renderSubsetInfo();
    });
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.stepBackBtn.addEventListener('click', () => this.nudgePlayhead(-1));
    this.stepFwdBtn.addEventListener('click', () => this.nudgePlayhead(1));
    this.scrub.addEventListener('input', () => this.onScrub());
    // `input` fires continuously while dragging, and each settle costs a catalogue scan, so the
    // live board (and with it the next-call list) is only re-derived when the drag RELEASES.
    this.scrub.addEventListener('change', () => this.settlePlayhead());
    this.beatInput.addEventListener('change', () => this.onBeatInput());
    this.copyPosBtn.addEventListener('click', () => this.copyPositions());
    // THE FILTER IS A VIEW, so it rebuilds the picker and nothing else - no board change, no apply.
    this.callFilterInput.addEventListener('input', () => this.refreshCallSelect());
    // A module in the library drawer is a LOAD, and it goes through the same `openSequence` the browse view
    // uses - so there is one definition of what loading a stored sequence means.
    this.modulesEl.addEventListener('click', (e) => {
      const del = (e.target as HTMLElement).closest('.seq-mod-del') as HTMLElement | null;
      if (del?.dataset.modDel != null) { this.deleteModule(Number(del.dataset.modDel)); return; }
      const t = (e.target as HTMLElement).closest('.seq-module') as HTMLElement | null;
      if (t?.dataset.mod == null) return;
      // BY INDEX, and the loading (the stored start board included) lives in `loadModule`.
      this.loadModule(Number(t.dataset.mod));
    });
    // The timeline: a click on a ROW seeks and, for a FIGURE, re-opens it; a click on its `×` removes the
    // step; the row is a tab stop with Enter/Space/Delete on it - a sequencer's two most common actions after
    // Add, plus the one the figure rows need.
    this.seqListEl.addEventListener('click', (e) => {
      const del = (e.target as HTMLElement).closest('.seq-del') as HTMLElement | null;
      if (del?.dataset.del != null) { this.deleteStep(Number(del.dataset.del)); return; }
      const row = (e.target as HTMLElement).closest('.seq-row') as HTMLElement | null;
      if (row?.dataset.idx != null) this.activateStep(Number(row.dataset.idx));
    });
    this.seqListEl.addEventListener('keydown', (e) => {
      const row = (e.target as HTMLElement).closest('.seq-row') as HTMLElement | null;
      if (row?.dataset.idx == null) return;
      const idx = Number(row.dataset.idx);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.activateStep(idx); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteStep(idx); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // THE ARROW KEYS WALK THE SEQUENCE, which is what a focused list should do - and they are also the
        // transport's keys, so the row's own handler takes them first and moves the focus with the playhead.
        // Walking is NAVIGATION, not activation: a figure is not re-opened just because the focus passed it.
        e.preventDefault();
        const next = Math.max(0, Math.min(this.history.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
        this.selectedStep = next;
        this.seekTo(next);
        if (this.parallel) { this.setParallel(null); this.refreshCallSelect(); }
        const el2 = this.seqListEl.querySelector(`.seq-row[data-idx="${next}"]`) as HTMLElement | null;
        el2?.focus();
      }
    });
  }

  /**
   * ACTIVATE A TIMELINE ROW: seek to it and, if it is a FIGURE, re-open the figure so its free beats can be
   * filled (see `resumeFigure`). Any other row is just a seek, and the mode is cleared - it belongs to the row
   * it was opened from, and leaving it on while a different row is under the playhead would have the picker
   * offering one step's remainder while the caller looks at another.
   */
  private activateStep(idx: number) {
    this.runBusy(() => {
      this.selectedStep = idx;
      this.seekTo(idx);
      if (!this.resumeFigure(idx) && this.parallel) {
        this.setParallel(null);
        this.refreshCallSelect();
      }
    }, 'Opening the step…');
  }

  /**
   * THE SEQUENCER'S KEYBOARD, for `main.ts`'s one table.
   *
   * Panel-scoped through `when`, exactly as the editor's are: Space must not pause a sequence while the
   * editor is on screen. Every binding is the action the button beside it performs, so there is one
   * implementation per action - `nudgePlayhead`, `togglePlay`, `undo`, `redo`, `deleteStep`, `applySelected`.
   *
   * ENTER IS ADD, and it is the one binding that can surprise: the guards in `keys.ts` keep every one of
   * these out of a field being typed into, and `select` counts as a field there, so a picker that has the
   * focus keeps its own Enter.
   */
  keyBindings(): KeyBinding[] {
    const live = () => this.active;
    return [
      { id: 'seq-play', key: ' ', run: () => this.togglePlay(), when: live },
      { id: 'seq-beat-back', key: 'ArrowLeft', run: () => this.nudgePlayhead(-1), when: live },
      { id: 'seq-beat-fwd', key: 'ArrowRight', run: () => this.nudgePlayhead(1), when: live },
      {
        id: 'seq-step-back',
        key: 'ArrowLeft',
        shift: true,
        run: () => this.stepBy(-1),
        when: live,
      },
      {
        id: 'seq-step-fwd',
        key: 'ArrowRight',
        shift: true,
        run: () => this.stepBy(1),
        when: live,
      },
      { id: 'seq-undo', key: 'z', mod: true, run: () => this.undo(), when: live },
      { id: 'seq-redo', key: 'z', mod: true, shift: true, run: () => this.redo(), when: live },
      { id: 'seq-add', key: 'Enter', run: () => this.applySelected(), when: live },
      {
        id: 'seq-delete',
        key: 'Delete',
        run: () => this.deleteStep(this.selectedStep),
        when: live,
      },
      {
        id: 'seq-escape',
        key: 'Escape',
        // Escape leaves the figure being built - the same thing the banner's own button does one level up.
        run: () => { if (this.parallel) this.finishParallel(); },
        when: live,
        whileTyping: true,
      },
    ];
  }

  /** Move the playhead to the START of the step `d` steps away, which is what Shift+Arrow means in a
   *  sequencer: a beat at a time with the arrows, a step at a time with Shift. */
  private stepBy(d: number) {
    if (this.history.length === 0) return;
    const current = this.stepAtPlayhead();
    const next = Math.max(0, Math.min(this.history.length - 1, current + d));
    this.selectedStep = next;
    this.seekTo(next);
  }

  setActive(a: boolean) {
    this.active = a;
    this.playing = false;
    this.playBtn.textContent = '▶ Play';
    // THE ACTIVE PANEL OWNS THE CAMERA. The camera is one object shared by every view, and this used
    // to set it to 3D whenever the SEQUENCER was not the active panel - which silently overrode the
    // editor's own 2D view on every mode switch. So the sequencer now only sets it while it is the
    // one on screen, and `main.ts` calls the browse view first so the editor's choice is in place
    // before this runs.
    if (a) this.stage.setView2D(this.use2d);
    // ONE COPY OF WHAT A VIEW SHOWS - see `applyViewVisibility`, which this used to duplicate.
    this.applyViewVisibility();
    if (this.active) {
      if (this.views.length !== this.seq.board.dancers.length) this.rebuildViews();
      this.syncAnimation();
      this.render();
      this.updateCurrentTrace();
    }
  }
}


/** A step's human-readable label now comes from the ENGINE (`stepLabel`), which owns the step union
 * and therefore the only correct reading of it. The local copy this replaced knew only
 * `string | CallStep`, so it would have printed `[object Object]` for a grouped "while" step. */

// THE NEXT-CALL LIST'S BOARD KEY IS `board-key.ts`, and this is where its doc comment used to sit: on TWO DEAD
// DECLARATIONS (`PARALLEL_PREFIX`, `isParallelPick`), which nothing in the tree referenced - so the comment explained a
// function it was not attached to, and the function itself could only be asked about by reading this file. Both
// declarations are gone, the comment is on the function, and `poc/tools/board-key-probe.mjs` measures it.

/** Backwards-compatible factory (used by main.ts). */
export function initSequencer(stage: Stage): SequencerUI {
  return new SequencerController(stage);
}
