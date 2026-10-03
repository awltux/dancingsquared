// Sequencer UI controller: build/validate a call sequence on the 3D board.
// Encapsulates the sequence panel's state (the board, playhead, history,
// modules) and DOM wiring behind a class, so the animation/apply/undo logic no
// longer lives in one large closure.

import * as THREE from 'three';

import { Sequencer, computeHandholds, sampleTrail, splitSelection, parseAll8Figures, formatAll8Figures, boardForFasrCode, FORMATIONS_FOR_LETTER, fasrooOf } from 'dancing-squared-engine';
import type { Board, CallStep, FormDancer, Matchable, Module, ModuleStep, Pose, SequenceStop } from 'dancing-squared-engine';
import { stepLabel, CODED_MOVES } from 'dancing-squared-engine';
import { movesXmlText, formationsXmlText, availableLevels, sequencerCallsUpTo } from './data';
import { validCederModules } from './ceder-modules';
import { callKey, LETTER_TEMPLATE, MODULES_STORAGE_KEY, resolveStartFormation } from './modules';
import { parseStoredModules } from './stored-modules';
import { loadUserFormations } from './formations';
import { corpusFormationsOfSize } from './tam-xml';
import { DancerView, buildHandConnectors, buildFlatMarker } from './scene';
import { el, esc } from './dom';
import type { Stage, WalkCycle } from './scene';

export interface SequencerUI {
  setActive(active: boolean): void;
  render(): void;
  /** Load a named sequence whole and park the playhead at its first step that plays `atCall`. */
  openSequence(steps: ModuleStep[], atCall?: string, startFormation?: string): void;
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

/** What the library can say about a board. `name` is the permissive read (`knownFormation`), which
 *  is the one that can name a user-defined formation; `curated` is the stable display label
 *  (`recognize`, restricted to the curated list). */
export interface BoardRead {
  name: string | null;
  curated: string | null;
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
  private marginInput = el<HTMLInputElement>('seqMargin');
  private groupSelect = el<HTMLSelectElement>('seqGroup');
  private callSelect = el<HTMLSelectElement>('seqCallSelect');
  private applyBtn = el<HTMLButtonElement>('seqApply');
  private undoBtn = el<HTMLButtonElement>('seqUndo');
  private resetBtn = el<HTMLButtonElement>('seqReset');
  private getoutBtn = el<HTMLButtonElement>('seqGetout');
  private matrixGetoutBtn = el<HTMLButtonElement>('seqMatrixGetout');
  private applyGetoutBtn = el<HTMLButtonElement>('seqApplyGetout');
  private getinBtn = el<HTMLButtonElement>('seqGetin');
  private fixBtn = el<HTMLButtonElement>('seqFixIt');
  private statusEl = el<HTMLSpanElement>('seqStatus');
  // Off until a subset call leaves somebody: `refreshCallSelect` is the only place that turns it on, and
  // it runs before the first paint.
  private parallelBtn = el<HTMLButtonElement>('seqParallel');
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
  private playBtn = el<HTMLButtonElement>('seqPlay');
  private scrub = el<HTMLInputElement>('seqScrub');
  private beatInput = el<HTMLInputElement>('seqBeatInput');
  private copyPosBtn = el<HTMLButtonElement>('seqCopyPos');
  private beatEl = el<HTMLSpanElement>('seqBeat');
  private formationSelect = el<HTMLSelectElement>('seqFormation');
  private setFormationBtn = el<HTMLButtonElement>('seqSetFormation');
  private boardRotInput = el<HTMLInputElement>('seqBoardRot');
  private view2dEl = el<HTMLSelectElement>('seqView2d');
  private subsetInfoEl = el<HTMLDivElement>('seqSubsetInfo');
  private formationNames: string[] = [];

  // State.
  private seq: Sequencer;
  private views: DancerView[] = [];
  /** Flat 2D markers, one per dancer, shown when View = 2D. */
  private markers: THREE.Group[] = [];
  private connectors: ReturnType<typeof buildHandConnectors>;
  private history: ModuleStep[] = [];
  /**
   * PARALLEL-CALL MODE. Set when the caller is giving the dancers the last call did NOT move their own
   * call in the SAME time slot. Holds everything the offer needs:
   *   - `board`   the board the LANE'S NEXT CALL starts on. It begins as the board the first call was
   *               applied FROM - which is the board the remainder must be resolved on, because the live
   *               board is already after the first call - and advances by one call each time the caller
   *               appends to the lane, so the picker always asks `groupCanPerform` the question that
   *               matches the call about to be picked.
   *   - `start`   the board the STEP starts from - the board the first call was applied FROM. It never
   *               moves, and it is the board the composed step is CHECKED on: the live board has already
   *               been replayed past the step, so applying the step there would apply it twice.
   *   - `index`   the history entry to replace, so the pair becomes ONE step rather than two.
   *   - `first`   the first group, kept so the composed step can be rebuilt.
   *   - `remaining` the selector for the dancers the first call left behind.
   *   - `calls`   the calls the remainder has been given SO FAR, in order. One call is the ordinary
   *               "while" partner; two or more is a LANE - the remainder dances them back to back in the
   *               same slot, which is how a 16-beat call is filled by two 4-beat ones. Apply APPENDS while
   *               the mode is on, and clicking the button again finishes the step.
   */
  private parallel: {
    start: Board;
    board: Board;
    index: number;
    first: { selection: string; call: string };
    remaining: string;
    calls: { selection: string; call: string }[];
  } | null = null;
  private modules: Module[] = [];
  private active = false;
  /** Display-only rotation (radians) applied about the set centre so the whole
   * board can be aligned against the reference grid (e.g. 45°). */
  private boardRot = 0;
  /** True = draw 2D markers on the overlay canvas instead of 3D avatars. */
  private use2d = false;
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
  private lastFrame = performance.now();
  private lastTraceKey = '';
  /** The identity the dancer VIEWS were built for. See `viewKeyOf` and `renderBoard`. */
  private viewKey = '';
  private lastReadout = '';

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
    this.loadModules();
    this.refreshModulesList();
    this.restoreModules();
    this.registerCederModules();

    for (const lv of availableLevels()) this.levelSelect.add(new Option(lv.toUpperCase(), lv));
    this.levelSelect.value = 'ms';
    // THE LEVEL DECIDES WHICH PERMISSION RULES ARE IN FORCE, not just which calls are registered. A rule
    // from a level above this one is not consulted: `sequencerCallsUpTo` has not registered those calls,
    // so it could not apply them anyway. See `engine/src/sequencer/permissions.ts`.
    this.seq.setActiveLevel(this.levelSelect.value);
    this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);

    this.wireEvents();
    this.populateFormations();
    // AFTER the catalogue is in, so the user's own shapes are added to a library that already has
    // the corpus in it rather than being deduped against a half-built one.
    this.registerUserFormations();
    this.refreshCallSelect();
    this.renderSubsetInfo();
    this.requestFrame();
  }

  /** Fill the formation dropdown with every named formation the sequencer knows. */
  private populateFormations() {
    const prev = this.formationSelect.value;
    this.formationSelect.innerHTML = '';
    this.formationSelect.add(new Option('— current board —', ''));
    this.formationNames = this.seq.listFormations();
    for (const f of this.formationNames) this.formationSelect.add(new Option(f, f));
    if (prev && this.formationNames.includes(prev)) this.formationSelect.value = prev;
    else this.formationSelect.value = '';
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

  /** Jump the board into the chosen formation and clear the current sequence. */
  private setBoardFormation() {
    const name = this.formationSelect.value;
    if (!name) return;
    if (!this.seq.setSetup(name)) {
      this.statusEl.textContent = `✗ unknown formation "${name}"`;
      return;
    }
    this.history.length = 0;
    this.playing = false;
    this.playhead = 0;
    this.totalBeats = 0;
    this.flat = [];
    this.playBtn.textContent = '▶ Play';
    this.lastTraceKey = '';
    // The sequence now begins from this formation, not from home.
    this.startBoard = this.seq.startBoard();
    this.statusEl.textContent = `board set to ${this.seq.recognize(this.seq.board)?.name ?? name}`;
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

  /** Keep the formation dropdown reflecting the board's current recognised state. */
  private updateFormationSelect() {
    const name = this.seq.recognize(this.seq.board)?.name;
    this.formationSelect.value = name && this.formationNames.includes(name) ? name : '';
  }

  /** Show which dancer subsets resolve on the current board. */
  private renderSubsetInfo() {
    // IN PARALLEL MODE THE PANEL SAYS WHO IS STILL WAITING FOR A CALL, because that is the question the
    // picker is answering - the "subsets present" list is about the group selector, which the pair's
    // second call does not go through.
    if (this.parallel) {
      this.subsetInfoEl.innerHTML =
        `Parallel call: <b>${esc(this.parallel.first.selection)} ${esc(this.parallel.first.call)}</b> is dancing · ` +
        `<b>${esc(this.parallel.remaining)}</b> have no call yet — the list below offers theirs, and Apply joins them in the SAME slot.`;
      return;
    }
    const groups = this.seq.subsetGroups(this.seq.board);
    this.subsetInfoEl.innerHTML = groups.length
      ? `Subsets present: <b>${groups.join(' · ')}</b> — their calls are grouped under each selector below.`
      : 'No dancer subsets resolve on this board (whole-board calls only).';
  }

  private loadModules() {
    // THROUGH THE SHARED PARSER, which drops an entry that is not a module rather than trusting it: this runs
    // from the constructor, and `refreshModulesList` maps over the result - so a stored `{}` used to throw
    // during startup and take the whole app down.
    this.modules = parseStoredModules(localStorage.getItem(MODULES_STORAGE_KEY));
  }
  /** Register the ceder-translated corpus modules that are fully replayable. */
  private registerCederModules() {
    for (const m of validCederModules()) this.seq.registerModule(m.name, m.steps);
  }
  private persistModules() {
    localStorage.setItem(MODULES_STORAGE_KEY, JSON.stringify(this.modules));
  }
  private restoreModules() {
    for (const m of this.modules) this.seq.registerModule(m.name, m.calls);
  }
  private refreshModulesList() {
    this.modulesEl.innerHTML = this.modules.length
      ? this.modules.map((m) => `<b>${esc(m.name)}:</b> ${esc(m.calls.map(stepLabel).join(' · '))}`).join('<br>')
      : '<i>(no modules saved yet)</i>';
  }

  private applyMargin() {
    this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);
    this.refreshCallSelect();
  }

  private rebuildSeq() {
    // THE SAME ORDER AS THE CONSTRUCTOR, and for the same reason: the formations first, then the calls -
    // a call that NAMES its start formation is built when it is registered, and a reference to a
    // formation that is not in the library yet is a failure rather than a retry.
    this.seq = new Sequencer(movesXmlText, formationsXmlText, []);
    for (const m of this.modules) this.seq.registerModule(m.name, m.calls);
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

  /** The group the caller has chosen, as it will be prefixed onto a call. Null for `All 8`. */
  private chosenGroup(): string | null {
    const g = this.groupSelect.value;
    return !g || g === 'All 8' ? null : g;
  }

  /** The call picker shows ONLY calls (and modules) legal from the current board.
   * Calls that act on a dancer subset are grouped under their selector so they
   * are visually distinct from whole-board calls. */
  private refreshCallSelect() {
    this.refreshGroupSelect();
    const prev = this.callSelect.value;
    const legal = this.seq.legalNext().sort((a, b) => a.localeCompare(b));
    // IN PARALLEL MODE THE LIST ANSWERS A DIFFERENT QUESTION: not "what can the chosen group do", but
    // "what can the dancers that group LEFT BEHIND do". The remainder is resolved on the board the first
    // call started from, and the offer is narrowed by composing that selector and applying it - so a
    // call only the whole board can perform is absent rather than offered and then refused.
    const group = this.parallel ? this.parallel.remaining : this.chosenGroup();
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
        if (!group || this.seq.groupCanPerform(on, group, bare)) whole.push(bare);
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
    this.callSelect.innerHTML = '';
    this.callSelect.add(new Option(group ? `— call for ${group} —` : '— valid next call —', ''));
    const addGroup = (label: string, names: string[]) => {
      if (!names.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const n of [...new Set(names)].sort((a, b) => a.localeCompare(b))) og.appendChild(new Option(n, n));
      this.callSelect.appendChild(og);
    };
    addGroup(group ? `Whole-set or ${group}` : 'Whole-set calls', whole);
    for (const sel of [...bySel.keys()].sort()) addGroup(`Subset: ${sel}`, bySel.get(sel)!);
    addGroup('Modules', modules);
    // Keep the previous pick only when THIS list actually offers it - the values are bare names now,
    // so asking `legal` (which carries prefixes) would compare against a different vocabulary.
    const offered = [...this.callSelect.options].map((o) => o.value);
    if (prev && offered.includes(prev)) this.callSelect.value = prev;
    // Remember which board this list answers for, so `settlePlayhead` can skip a redundant rebuild.
    this.listBoardKey = boardKey(this.seq.board);
    // The parallel button is only live when a subset call has left dancers with no call of their own.
    this.parallelBtn.disabled = !this.parallel;
    const lane = this.parallel?.calls ?? [];
    this.parallelBtn.title = this.parallel
      ? `${this.parallel.remaining} dance in the SAME slot as ${this.parallel.first.selection} ${this.parallel.first.call}`
        + (lane.length
          ? ` — their lane is ${lane.map((c) => c.call).join(' then ')}, so Apply ADDS another call to it and pressing this finishes the step.`
          : ' — pick a call from the list and Apply; Apply again adds a second call to the same lane, which is how one long call is filled by two short ones.')
      : 'Give the dancers the current call did NOT move their own call in the SAME time slot. Enabled only when the last call acted on a subset, e.g. Sides promenade while the Heads step into the middle.';
    this.updateFormationSelect();
    this.renderSubsetInfo();
  }

  private saveModule() {
    const name = this.moduleNameInput.value.trim();
    if (!name) {
      this.statusEl.textContent = 'Enter a module name first';
      return;
    }
    if (this.history.length === 0) {
      this.statusEl.textContent = 'Nothing to save — add calls first';
      return;
    }
    this.seq.registerModule(name, [...this.history]);
    this.modules.push({ name, calls: [...this.history] });
    this.persistModules();
    this.refreshModulesList();
    this.refreshCallSelect();
    this.statusEl.textContent = `Saved module "${name}"`;
    this.moduleNameInput.value = '';
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
    }
    for (const m of this.markers) this.stage.scene.remove(m);
    // DISPLAY-ONLY couple colour. A synthesised (Set) formation has no real home
    // identity: the engine deliberately reports UNKNOWN_COUPLE (0) for it so that
    // matching and grouping cannot read a placeholder. For DRAWING only, fall
    // back to a stable colour derived from the board order so dancers stay
    // visually distinguishable - this value never reaches the engine board.
    const displayCouple = (d: { couple: number }, i: number): number =>
      d.couple > 0 ? d.couple : (Math.floor(i / 2) % 4) + 1;
    this.views = board.dancers.map((d, i) =>
      new DancerView({ gender: d.gender, x: 0, y: 0, angleDeg: 0, path: [] }, displayCouple(d, i), !!d.isGhost),
    );
    this.markers = board.dancers.map((d, i) => buildFlatMarker(d.gender, displayCouple(d, i)));
    for (const v of this.views) {
      v.group.visible = this.active && !this.use2d;
      this.stage.scene.add(v.group);
      this.stage.scene.add(v.trail);
      v.trail.visible = this.active && !this.use2d;
    }
    for (const m of this.markers) {
      m.visible = this.active && this.use2d;
      this.stage.scene.add(m);
    }
    this.lastTraceKey = '';
    this.viewKey = SequencerController.viewKeyOf(board);
  }

  private renderBoard(board: Board, walk?: WalkCycle) {
    // THE VIEWS FOLLOW THE BOARD'S IDENTITY, not just its dancer COUNT. A `DancerView` builds its
    // avatar once (boy/girl shape, couple colour) and only receives poses afterwards, so a board whose
    // identity or array order differs from the one the views were built for draws the wrong dancers in
    // the right places. See `viewKeyOf` for the ceder-7046 report that this was.
    if (this.views.length !== board.dancers.length || this.viewKey !== SequencerController.viewKeyOf(board)) {
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
    const show2d = this.active && this.use2d;
    this.stage.setView2D(show2d);
    this.connectors.group.visible = this.active && !this.use2d;
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      v.group.visible = this.active && !this.use2d;
      v.trail.visible = this.active && !this.use2d;
      const m = this.markers[i];
      if (m) {
        m.visible = show2d;
        if (show2d && poses && poses[i]) {
          const p = poses[i];
          m.position.set(p.x, 0, -p.y);
          m.rotation.y = p.heading;
        }
      }
    }
  }

  render() {
    if (!this.active) return;
    this.renderBoard(this.seq.board);
    this.updateReadout();
  }

  private syncAnimation() {
    this.flat = this.seq.flatten(this.history);
    this.totalBeats = this.seq.sequenceBeats(this.flat, this.startBoard);
    // WHERE THE SEQUENCE STOPS BEING PLAYABLE. A call the walk cannot walk is charged 0 beats and
    // `evaluateSequence` returns the board BEFORE it, so the end of a sequence that stops early is
    // that call's start board. Without this the panel looks like it played the whole thing.
    this.stop = this.seq.sequenceStop(this.flat, this.startBoard);
    this.playhead = this.totalBeats;
    this.scrub.max = String(Math.max(1, this.totalBeats));
    this.scrub.value = String(this.playhead);
    this.updateBeatLabel();
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
        this.playhead += dt / MS_PER_BEAT;
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
      () => { this.statusEl.textContent = '✓ dancer positions copied (JSON)'; },
      () => { this.statusEl.textContent = '✗ clipboard unavailable — positions are in the console'; console.log(text); },
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
    const codeText = code
      ? `<br>FASROO: <b>${code.code}</b>${code.note ? ` <i>(${code.note})</i>` : ''}` +
        `<span class="small" title="${FASROO_ORIENTATION_NOTE}"> ·?</span>`
      : '';
    const fasrText =
      `Formation: <b>${esc(fasr.formation ?? '?')}</b> · ${fasr.arrangement}<br>` +
      `Sequence: <b>${fasr.sequence}</b>${rel}${codeText}`;
    const listText = this.history.length
      ? this.history.map((c, i) => `<span class="seq-call" data-idx="${i}">${i + 1}. ${esc(stepLabel(c))}</span>`).join('<br>')
      : '<i>(no calls yet)</i>';
    const key = fasrText + '\u0000' + listText;
    if (key === this.lastReadout) return;
    this.lastReadout = key;
    this.fasrEl.innerHTML = fasrText;
    this.seqListEl.innerHTML = listText;
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
    const step = this.seq.apply(name);
    if (!step.legal) {
      this.statusEl.textContent = `✗ ${name}${step.reason ? ` — ${step.reason}` : ''}`;
      return;
    }
    const expanded = this.seq.flatten([name]);
    this.history.push(...expanded);
    // PARALLEL MODE CANNOT SURVIVE A NEW CALL: its remainder and its history index both belong to the
    // step that has just been superseded.
    this.parallel = null;
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
      this.parallel = {
        start: from,
        board: from,
        index: this.history.length - 1,
        first: { selection: who!, call: splitSelection(name).call || picked },
        remaining,
        calls: [],
      };
      this.statusEl.textContent = `✓ ${name} · ${remaining} left — "+ Parallel call" gives them their own call in the same slot, and Apply again fills that slot with more than one`;
    } else {
      this.statusEl.textContent = `✓ ${name}${expanded.length > 1 ? ` (${expanded.length} calls)` : ''}`;
    }
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
  }

  /**
   * Leave parallel mode, restoring the ordinary picker.
   *
   * ONE EXIT PATH, because the mode changes what the CALL LIST answers: leaving it without rebuilding
   * the list would leave the remainder's calls on screen under the chosen group's heading.
   */
  private exitParallel(message?: string) {
    if (!this.parallel) return;
    this.parallel = null;
    this.statusEl.textContent = message ?? '';
    this.refreshCallSelect();
  }

  /**
   * Give the dancers the last call did NOT move their OWN call, in the SAME time slot, as one step.
   *
   * THE TWO GROUPS RUN SIMULTANEOUSLY, NOT IN SEQUENCE - the step becomes a `GroupStep`, which the engine
   * applies from one board and charges the LONGEST group's beats. That is the whole point: a caller
   * saying "sides promenade while the heads step into the middle" is ONE figure, not two in a row.
   *
   * AND THE REMAINDER'S GROUP MAY TAKE SEVERAL CALLS, which is the lane: APPLY APPENDS while the mode is on,
   * so a 16-beat call for the heads can be filled by "Sides Trade then Pass Thru". Each Apply rebuilds the
   * step from the lane so far plus the call just picked, and applies it - so a lane that the engine refuses
   * never lands in the history, and the status line says which call refused.
   *
   * The call is taken from the picker, which is offering only what the REMAINDER can do FROM THE BOARD ITS
   * NEXT CALL STARTS ON (`refreshCallSelect` narrows it by `groupCanPerform` against `parallel.board`, which
   * advances by one call per append), so the lane cannot be built from calls the group cannot perform in
   * order.
   */
  private applyParallel() {
    const p = this.parallel;
    if (!p) return;
    const second = this.callSelect.value;
    if (!second) {
      this.statusEl.textContent = `pick ${p.remaining}'s own call first`;
      return;
    }
    const lane = [...p.calls, { selection: p.remaining, call: second }];
    const step: ModuleStep = { groups: [p.first, { selection: p.remaining, calls: lane.map((c) => c.call) }] };
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
      // A refused append must not leave a half-built step in the list: RESTORE THE LANE AS IT WAS (which is
      // the single call when nothing has been appended yet), and KEEP THE MODE ON so the caller can pick a
      // different call instead of starting the lane again.
      const back = [...this.history];
      back[p.index] = p.calls.length > 0
        ? { groups: [p.first, { selection: p.remaining, calls: p.calls.map((c) => c.call) }] }
        : `${p.first.selection} ${p.first.call}`;
      this.history = back;
      this.replayHistory();
      this.parallel = p;
      this.statusEl.textContent = `✗ ${stepLabel(step)}${applied.reason ? ` — ${applied.reason}` : ''}`;
      this.render();
      this.refreshCallSelect();
      this.syncAnimation();
      return;
    }
    // REPLACE the first call's entry rather than appending: the pair is ONE step, so Undo removes both
    // and the sequence list shows one numbered row.
    const withStep = [...this.history];
    withStep[p.index] = step;
    this.history = withStep;
    this.replayHistory();
    // THE BOARD THE LANE'S NEXT CALL STARTS ON. Read from the apply rather than re-applying: `lanes` carries
    // the boards the applicator itself passed through (`ApplyResult.lanes`), which is the same board the
    // engine will charge the next call its beats against.
    const laneRun = applied.lanes?.find((l) => l.selection === p.remaining);
    const nextBoard = laneRun?.boards[laneRun.boards.length - 1] ?? p.board;
    this.parallel = { ...p, board: nextBoard, calls: lane };
    // THE BALANCE IS THE POINT OF THE FEATURE: two 4-beat calls against a 16-beat partner is only useful if
    // the caller can see it. Beats are read from the engine, per group, on the boards those groups start on.
    const firstBeats = this.seq.stepBeats(p.board, `${p.first.selection} ${p.first.call}`);
    const laneBeats = lane.reduce((sum, c, i) => {
      const on = i === 0 ? p.board : laneRun?.boards[i] ?? p.board;
      return sum + this.seq.stepBeats(on, `${c.selection} ${c.call}`);
    }, 0);
    const filled = Math.min(laneBeats, firstBeats);
    this.statusEl.textContent =
      `✓ ${stepLabel(step)} — one step; Undo removes both`
      + ` · ${p.remaining} lane: ${lane.map((c) => c.call).join(' then ')} = ${laneBeats} of ${firstBeats} beats`
      + (laneBeats < firstBeats
        ? ` — ${firstBeats - laneBeats} beats standing; Apply again to fill it, or press "+ Parallel call" to finish`
        : laneBeats > firstBeats
          ? ` — the lane is ${laneBeats - firstBeats} beats LONGER, so ${p.first.call} stands for that long`
          : (filled ? ' — the times match' : ''));
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

  private undo() {
    if (this.history.length === 0) return;
    this.history.pop();
    // THE PENDING PAIRING IS VOID: its history index was the entry just removed.
    this.parallel = null;
    this.replayHistory();
    this.statusEl.textContent = '';
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
  }

  /** Load a named sequence whole and park the playhead at the first step that plays `atCall`.
   *
   * This is the browse view's "open" button. The sequence is loaded ENTIRELY - the call keeps its
   * context before and after it, which is the point of opening it rather than jumping to a board -
   * and then `seekTo` moves the playhead to where that call starts, so the animation is already at
   * the right place to press Play. */
  openSequence(steps: ModuleStep[], atCall?: string, startFormation?: string) {
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
    const spec = resolveStartFormation(declared);
    const startBoard = !spec
      ? null
      : spec.formation
        ? this.seq.boardForSetup(spec.formation)
        : boardForFasrCode(spec.code ?? '', (l) => {
            const name = LETTER_TEMPLATE[l];
            return name ? this.seq.boardForFormation(name) : null;
          }).board;
    if (declared && !startBoard) {
      this.history = [];
      this.startBoard = undefined;
      this.rewindToStart();
      this.lastTraceKey = '';
      this.refreshCallSelect();
      this.syncAnimation();
      this.statusEl.textContent = spec
        ? `cannot load: starts from a "${declared}", which resolves to ${spec.code} - but the engine could not build that board.`
        : `cannot load: starts from a "${declared}", and this engine cannot put the dancers into that formation in the RIGHT arrangement. Replaying it from home would dance different calls, so it is refused rather than approximated.`;
      return;
    }
    this.startBoard = startBoard ?? undefined;
    const startLabel = spec?.code ?? spec?.formation ?? '';

    this.history = this.seq.flatten(steps);
    this.rewindToStart();
    let refused = 0;
    for (const name of this.history) {
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
    this.statusEl.textContent = [
      `loaded ${this.history.length} call(s)`,
      startLabel ? `from ${startLabel}` : '',
      refused ? `${refused} refused` : '',
      // The walk's own verdict, which is the one that decides where the ANIMATION ends. Named
      // because a count does not tell the user that the last frame is the board before that call.
      this.stop ? `stops at "${this.stop.call}" - ${this.stop.reason}` : '',
    ].filter(Boolean).join(', ');
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
    this.history.length = 0;
    this.parallel = null;
    // Reset returns the set to the home square, so the sequence starts from home
    // again (any formation jumped to with "Set" is forgotten).
    this.startBoard = undefined;
    this.seq.reset();
    this.statusEl.textContent = '';
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
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

  private showGetout() {
    const path = this.seq.getout({ target: 'Static Square', maxCalls: 5 });
    this.statusEl.textContent = path ? `getout: ${path.join(' > ')}` : 'no getout found (≤5 calls)';
    this.updateMatrixInfo();
  }

  private updateMatrixInfo() {
    const rigid = this.seq.matrixGetout();
    const closeness = this.seq.closenessToHome();
    this.matrixInfoEl.innerHTML =
      `closeness-to-home: <b>${closeness.toFixed(2)}</b> · ` +
      `matrix rigid getout: <b>${rigid ? rigid.join(' > ') : '—'}</b>`;
  }

  private showMatrixGetout() {
    const rigid = this.seq.matrixGetout();
    this.statusEl.textContent = rigid
      ? `matrix getout (rigid, self-inverse): ${rigid.join(' > ')}`
      : 'no rigid single-call matrix getout (falls back to search)';
    this.updateMatrixInfo();
  }

  private showGetin() {
    const target = this.seq.recognize(this.seq.board).name ?? 'Static Square';
    const gi = this.seq.getin({ target, maxCalls: 5, budget: 400 });
    this.statusEl.textContent = gi
      ? `getin → ${target}: ${gi.join(' > ')}`
      : `no getin found → ${target} (≤5 calls)`;
  }

  private applyGetout() {
    const path = this.seq.getout({ target: 'Static Square', maxCalls: 5 });
    if (!path || path.length === 0) {
      this.statusEl.textContent = 'no getout found (≤5 calls)';
      return;
    }
    for (const name of path) {
      const step = this.seq.apply(name);
      if (!step.legal) {
        this.statusEl.textContent = `✗ getout failed at "${name}"`;
        return;
      }
      this.history.push(...this.seq.flatten([name]));
    }
    this.statusEl.textContent = `✓ applied getout: ${path.join(' > ')}`;
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
    this.updateMatrixInfo();
  }

  private showFixIt() {
    const fixes = this.seq.fixIt({ target: 'Static Square', depth: 3 });
    this.fixListEl.innerHTML = fixes.length
      ? `keep a getout: <b>${fixes.join(', ')}</b>`
      : 'no fix-it move keeps a getout alive';
  }

  private wireEvents() {
    this.applyBtn.addEventListener('click', () => this.applySelected());
    // THE PARALLEL BUTTON DOES NOT APPLY ANYTHING ON ITS OWN. It puts the picker into the mode where the
    // list offers the REMAINDER's calls; Apply then composes the pair - and APPENDS to the remainder's LANE
    // once the pair exists, so a long call can be filled by several short ones. THE BUTTON IS THEREFORE ALSO
    // THE WAY OUT: with nothing applied yet it seeds the picker, and with a lane already started it FINISHES
    // the step and leaves the mode.
    this.parallelBtn.addEventListener('click', () => {
      if (!this.parallel) {
        // THE BUTTON IS DISABLED WHEN THERE IS NO REMAINDER, so reaching here means the last step could
        // not take a partner. Say which, rather than appearing to do nothing - which is how a no-op read
        // in the report that this button "doesn't seem to do anything".
        this.statusEl.textContent =
          'nothing to pair: the last step must be a SINGLE call that leaves some dancers standing. '
          + 'Apply a subset call (e.g. Heads Promenade Full) first.';
        return;
      }
      if (this.parallel.calls.length > 0) {
        const done = this.history[this.parallel.index];
        this.exitParallel(`${done ? stepLabel(done) : 'the step'} is finished — ${this.parallel.remaining} keep the lane it has`);
        this.render();
        this.syncAnimation();
        return;
      }
      this.statusEl.textContent = `${this.parallel.remaining} left — pick their call, then Apply`
        + ' · Apply again to add a call to the same lane, and press this button again to finish';
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
    });
    this.callSelect.addEventListener('change', () => (this.statusEl.textContent = ''));
    // Changing the GROUP re-reads the call list for that group - the picker offers the calls that group
    // can actually do, so the two selectors cannot disagree about who acts.
    this.groupSelect.addEventListener('change', () => {
      this.statusEl.textContent = '';
      // A DIFFERENT GROUP IS A DIFFERENT STEP, so any pending parallel pairing is void: its remainder was
      // computed for the group that has just been replaced. Leaving it would compose a step whose groups
      // silently overlap, which the engine refuses - a loud failure, but one the caller did not cause.
      this.parallel = null;
      this.refreshCallSelect();
    });
    this.undoBtn.addEventListener('click', () => this.undo());
    this.resetBtn.addEventListener('click', () => this.reset());
    this.getoutBtn.addEventListener('click', () => this.showGetout());
    this.matrixGetoutBtn.addEventListener('click', () => this.showMatrixGetout());
    this.applyGetoutBtn.addEventListener('click', () => this.applyGetout());
    this.getinBtn.addEventListener('click', () => this.showGetin());
    this.fixBtn.addEventListener('click', () => this.showFixIt());
    this.saveModuleBtn.addEventListener('click', () => this.saveModule());
    this.all8ImportBtn.addEventListener('click', () => this.importAll8());
    this.all8ExportBtn.addEventListener('click', () => this.exportAll8());
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
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.scrub.addEventListener('input', () => this.onScrub());
    // `input` fires continuously while dragging, and each settle costs a catalogue scan, so the
    // live board (and with it the next-call list) is only re-derived when the drag RELEASES.
    this.scrub.addEventListener('change', () => this.settlePlayhead());
    this.beatInput.addEventListener('change', () => this.onBeatInput());
    this.copyPosBtn.addEventListener('click', () => this.copyPositions());
    this.seqListEl.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('.seq-call') as HTMLElement | null;
      if (t && t.dataset.idx != null) this.seekTo(Number(t.dataset.idx));
    });
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
    this.connectors.group.visible = this.active && !this.use2d;
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      v.group.visible = this.active && !this.use2d;
      v.trail.visible = this.active && !this.use2d;
      if (this.markers[i]) this.markers[i].visible = this.active && this.use2d;
    }
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

/**
 * Which board this is, for deciding whether the next-call list needs rebuilding.
 *
 * Position AND facing, because two boards that differ only in facings offer different calls, and a
 * position-only signature is exactly the trap the engine records for `boardSig`. Rounded, because the
 * evaluated frames are interpolations and only a materially different board should cost a rebuild.
 */
const PARALLEL_PREFIX = '↔ ';
const isParallelPick = (v: string): boolean => v.startsWith(PARALLEL_PREFIX);

function boardKey(board: Board): string {
  return board.dancers
    .map((d) => `${d.id}:${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(4)}`)
    .sort()
    .join('|');
}

/** Backwards-compatible factory (used by main.ts). */
export function initSequencer(stage: Stage): SequencerUI {
  return new SequencerController(stage);
}
