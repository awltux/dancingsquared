// CallBrowser: the browse mode of the app. Owns the shared dancer views +
// hand connectors, the level/call/setup selects, and the
// legend. Loads a call and renders its animation each frame (driven by the
// Player's playhead). The editor reuses this as its `preview` callback.

import * as THREE from 'three';

import { el, esc } from './dom';

import { allPoses, sampleTrail, sampleTrailRange, poseFor, computeHandholds, assignHomeIdentity, boardAtBeat, formationToXml } from 'dancing-squared-engine';
import type { HoldMode, Board, CallBundle, CallStep, DancerSpec, Matchable, Pose } from 'dancing-squared-engine';
import { availableCalls, loadCall } from './data';
import type { CallInfo } from './data';
import { addUserFormation, applyLabel, detachLabel, loadUserFormations, reattachLabel, removeUserFormation, setFormationInCorpus } from './formations';
import type { UserFormation } from './formations';
import { fsmTarget } from './fsm-target';
import { modulesUsing, startsAwayFromHome } from './modules';
import { DancerView, buildHandConnectors, buildFlatMarker } from './scene';
import type { Stage } from './scene';
import { Player } from './player';
import type { BoardRead } from './sequencer-ui';

/** What the browse view needs from the rest of the app. */
export interface BrowserHost {
  /** Open the SEQUENCE view with `steps` loaded, the playhead at the first step playing `atCall`,
   * and `startFormation` naming where the corpus says the module begins when that is not home (so
   * the sequence view can say its replay is an approximation). */
  openSequence(steps: (string | CallStep)[], atCall: string, startFormation?: string): void;
  /** Name the board and say what the library can read about it. The FORMATION LIBRARY lives in the
   *  sequencer (it is built from the registered catalogue), so the browse view asks rather than
   *  building a second one. */
  readBoard(board: Board): BoardRead;
  /** Register a user-defined formation with the live library, so boards like it are named from now
   *  on - including the board the caller was just looking at, which the read cache would otherwise
   *  remember as unnamed. */
  registerFormation(name: string, dancers: Matchable[]): void;
  /** Open the CALL EDITOR on one call and one setup, switching the mode selector to it. */
  openEditor(callId: string, setupIdx: number): void;
}

/** How many "used by" entries the browse panel lists before summarising the rest. */
const USES_SHOWN = 20;

export class CallBrowser {
  private stage: Stage;
  private player: Player;
  private host: BrowserHost;

  private levelSelect = el<HTMLSelectElement>('levelSelect');
  private callSelect = el<HTMLSelectElement>('callSelect');
  private tamSelect = el<HTMLSelectElement>('tamSelect');

  private scrub = el<HTMLInputElement>('scrub');
  private beatReadout = el<HTMLSpanElement>('beatReadout');
  private partLabel = el<HTMLSpanElement>('partLabel');
  private legend = el<HTMLDivElement>('legend');
  private usesEl = el<HTMLDivElement>('browseUses');
  private endFormationEl = el<HTMLSpanElement>('browseEndFormation');
  private labelRow = el<HTMLDivElement>('browseLabelRow');
  private formationNameInput = el<HTMLInputElement>('browseFormationName');
  private createFormationBtn = el<HTMLButtonElement>('browseCreateFormation');
  private userFormationsEl = el<HTMLDivElement>('browseUserFormations');
  /** The board the panel is currently describing: what a label would be created FROM. */
  private endBoard: Board | null = null;

  private catalog: CallInfo[] = availableCalls();
  views: DancerView[] = [];
  connectors: ReturnType<typeof buildHandConnectors>;
  availableLevels: string[] = [];

  /** The dancers whose trails the current views were built from, so a trail FOCUS can be
   *  re-applied after `showCall` rebuilds them. */
  private dancers: DancerSpec[] = [];
  /** Whether the dancer views should be shown at all (the app's mode). */
  private dancersVisible = true;
  /** HOW the dancers are drawn: small flat icons from above, or the 3D wireframes - and whether they
   *  are drawn AT ALL, in either representation, because an editor measuring a track wants the track
   *  and not a body standing on it. Both are the editor's options and are scoped to it (see
   *  `EditorController.applyViewOptions`). */
  private use2d = false;
  private showDancers = true;
  /** Flat markers, one per dancer, shown in the 2D view. Parallel to `views`. */
  private markers: THREE.Group[] = [];
  /** Which dancer's track is being edited, which stretch of it, and WHICH OF THE MOVE'S TWO SHAPES
   *  is selected (`kind`). `null` = show every track in full, which is the browse view's behaviour. */
  private trailFocus: { index: number; range: { from: number; to: number } | null; kind: 'move' | 'facing' } | null = null;

  constructor(stage: Stage, player: Player, host: BrowserHost) {
    this.stage = stage;
    this.player = player;
    this.host = host;
    this.connectors = buildHandConnectors(stage.scene);
    this.availableLevels = Array.from(new Set(this.catalog.map((c) => c.level)));
    this.populateLevels();
    this.populateCalls();
    this.refreshSetups();
    this.renderUses();
    this.loadCurrent();
    this.createFormationBtn.addEventListener('click', () => this.createFormationFromEndBoard());
    this.renderUserFormations();
  }

  // ---------------------------------------------------------------- the end formation
  //
  // What formation the loaded call FINISHES in - the question a caller actually asks of a call, and
  // one the panel could not answer at all: the library was reachable only from the sequence view.
  //
  // THE ANSWER IS COMPUTED, NOT LOOKED UP, and that is deliberate. The alternative is the
  // precomputed FSM asset, whose edges carry an `endFormation` per (state, call). But the panel has
  // the call IN HAND, so its end board is one cheap read away (a `poseFor` per dancer at the last
  // beat) and it is always current - where the FSM is a BUILD ARTEFACT that can lag the assets, and
  // its `endFormation` is itself produced by the same recognition, so it cannot name anything the
  // recogniser cannot. Using the FSM here would add a staleness failure mode and buy nothing.
  //
  // The one thing the FSM would add is a cross-check, and the panel's read is worth more: it says
  // WHICH read answered (library / curated / neither), so a stale FSM would show up as a
  // disagreement in the sequence view's own FSM tab rather than as a wrong label here.

  /** Describe the loaded call's end board. */
  private renderEndFormation(call: CallBundle | null) {
    this.endBoard = null;
    this.labelRow.hidden = true;
    if (!call) {
      this.endFormationEl.textContent = '';
      return;
    }
    try {
      const board = boardAtBeat(call, call.beats);
      this.endBoard = board;
      const read = this.host.readBoard(board);
      // The call INSTANCE identity, which is what a detach is keyed by - the same
      // (callId, setupIdx) pair the editor's saved edits use.
      const callId = this.callSelect.value;
      const setupIdx = parseInt(this.tamSelect.value || '0', 10);
      const applied = applyLabel(read.name, read.userDefined, callId, setupIdx);
      const bits: string[] = [];
      if (applied.name) {
        bits.push(`<b>${esc(applied.name)}</b>${read.userDefined ? ' <i>(user-defined)</i>' : ''}`);
        if (read.curated && read.curated !== applied.name) bits.push(`labels as ${esc(read.curated)}`);
        bits.push(esc(read.notation));
        if (read.arrangement !== null) bits.push(`arrangement ${read.arrangement}`);
        // A USER-DEFINED label is the caller's own, so it gets its own controls: detach it from
        // THIS call (the label is wrong here and right elsewhere) or remove it from the corpus
        // (the label is wrong). Two different mistakes, two different actions.
        if (read.userDefined) {
          bits.push(
            `<button data-act="detach" title="Stop this formation labelling THIS call's end. The formation stays in the corpus and still labels other calls that end in it.">detach</button>`,
            `<button data-act="remove" title="Delete this formation from the corpus, for every call. The library keeps the name until the page is reloaded, but the field stops applying it at once.">remove</button>`,
          );
        }
      } else {
        // NOT NAMED. Say what IS known: the size, the gender pattern, and the notation with its
        // unknowns left as `?` rather than filled in.
        bits.push('<span style="color:#ffb454">not named</span>');
        bits.push(`${read.dancers} dancers`);
        bits.push(`genders ${read.genderPattern}`);
        if (read.notation.includes('?')) bits.push(esc(read.notation));
        // AND WHEN THE LIBRARY *DID* DETECT A USER-DEFINED LABEL, SAY SO AND WHY IT IS NOT USED.
        // Returning a bare null here made "the label is detached" and "the shape is not stored"
        // indistinguishable from "the library has never heard of this shape", which is how a
        // declined label became invisible and cost a round trip.
        if (applied.suppressed) {
          if (applied.reason === 'detached') {
            // Shown where it APPLIES, which is also where it can be undone.
            bits.push(
              `<i>detected &ldquo;${esc(applied.suppressed)}&rdquo;, detached from this call</i>` +
                `<button data-act="reattach" title="Apply that formation to this call's end again">reattach</button>`,
            );
          } else {
            bits.push(
              `<i>detected &ldquo;${esc(applied.suppressed)}&rdquo;, which is no longer in the corpus</i>` +
                `<button data-act="store" title="Put this shape back in the corpus under that name">store</button>`,
            );
          }
        }
      }
      this.endFormationEl.innerHTML = bits.join(' · ');
      this.wireEndFormationActions(applied.suppressed ?? applied.name, callId, setupIdx);
      // A formation is matched only against a board of the SAME dancer count, and the library holds
      // eight-dancer geometries only - so a half-set authoring cannot be named and labelling one
      // would not help. Offer the label only where it can do something.
      const canLabel = applied.name === null && read.dancers === 8;
      this.labelRow.hidden = !canLabel;
      if (applied.name === null && !canLabel) {
        this.endFormationEl.innerHTML +=
          ` — <i>a ${read.dancers}-dancer setup: the formation library holds eight-dancer geometries, so this end cannot be named</i>`;
      }
    } catch (err) {
      this.endFormationEl.textContent = `end formation unavailable: ${(err as Error).message}`;
    }
  }

  /** The detach / remove / reattach / store buttons live inside the field's own markup. */
  private wireEndFormationActions(name: string | null, callId: string, setupIdx: number) {
    if (!name) return;
    for (const btn of this.endFormationEl.querySelectorAll<HTMLButtonElement>('button[data-act]')) {
      const act = btn.dataset.act;
      btn.addEventListener('click', () => {
        if (act === 'detach') {
          detachLabel(name, callId, setupIdx);
          this.legend.innerHTML = `detached <b>${esc(name)}</b> from this call<br><span class="small">the formation is still in the corpus and still labels other calls</span>`;
        } else if (act === 'reattach') {
          reattachLabel(name, callId, setupIdx);
          this.legend.innerHTML = `re-attached <b>${esc(name)}</b> to this call`;
        } else if (act === 'store') {
          // The library still recognises the shape but the corpus no longer holds it: put it back
          // from the board in front of us, which is the only geometry that can be meant.
          this.storeLabel(name);
        } else if (act === 'remove') {
          removeUserFormation(name);
          this.renderUserFormations();
          this.legend.innerHTML = `removed <b>${esc(name)}</b> from the corpus<br><span class="small">gone for every call; the library keeps the name until the page is reloaded</span>`;
        }
        if (this.player.call) this.renderEndFormation(this.player.call);
      });
    }
  }

  /**
   * Name the current end board and add it to the library as a USER-DEFINED formation.
   *
   * The board is stored, not a reference to the call, so the shape can be registered again in a
   * later session without that call. Registering it with the live library is what makes it
   * recognisable immediately - including for the board on screen, whose read is already cached.
   */
  /**
   * Store the CURRENT end board's geometry under `name`, tagged user-defined, and register it.
   *
   * ONE PATH FOR BOTH WAYS IN, which is why it is a method: the Label row supplies a new name, and
   * the field's `store` button supplies a name the library still recognises but the corpus no longer
   * holds. The only difference between them is where the name comes from, and the board is the only
   * geometry that can be meant in either case.
   */
  private storeLabel(name: string) {
    const board = this.endBoard;
    if (!board) return;
    const dancers = board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
    const origin = `${this.callSelect.selectedOptions[0]?.textContent ?? ''} (from ${this.tamSelect.selectedOptions[0]?.textContent ?? 'default'})`;
    // THE IDS BESIDE THE PROSE, so the list's Edit button can open this call again: `origin` is built from the
    // two dropdowns' DISPLAY text and cannot be turned back into a catalogue entry.
    const formed: UserFormation = {
      name,
      dancers,
      created: new Date().toISOString(),
      origin,
      callId: this.callSelect.value,
      setupIdx: parseInt(this.tamSelect.value || '0', 10),

    };
    addUserFormation(formed);
    this.host.registerFormation(name, dancers);
    // LABELLING THIS CALL'S END WITH THE NAME IS ALSO A RE-ATTACH. Otherwise a formation that had
    // been detached here could be created again under the same name and still not show, which is
    // the one way this feature could eat its own work.
    reattachLabel(name, this.callSelect.value, parseInt(this.tamSelect.value || '0', 10));
    this.renderUserFormations();
    // Re-read so the field shows the new name rather than the state it was labelled from.
    if (this.player.call) this.renderEndFormation(this.player.call);
    this.legend.innerHTML = `<b>${esc(name)}</b> — user-defined formation, ${dancers.length} dancers<br><span class="small">this is a label for a shape, not a call</span>`;
  }

  /** The Label row's action: name the current end board and store it. */
  private createFormationFromEndBoard() {
    const name = this.formationNameInput.value.trim();
    if (!name) {
      this.endFormationEl.innerHTML += ' — <i>give it a name first</i>';
      return;
    }
    this.formationNameInput.value = '';
    this.storeLabel(name);
  }

  /** The user-defined formation list: what is stored, what it exports, whether it is in the corpus, and
   *  how to drop it. */
  private renderUserFormations() {
    const list = loadUserFormations();
    if (list.length === 0) {
      this.userFormationsEl.innerHTML = '';
      return;
    }
    const corpus = list.filter((f) => f.inCorpus).length;
    this.userFormationsEl.innerHTML =
      `<div class="small"><b>${list.length} user-defined formation${list.length === 1 ? '' : 's'}</b>` +
      ` <i>— stored locally and registered with the library; ${corpus} added to the corpus. A call that starts from an` +
      ` ADDED formation exports as \`formation="Name"\` instead of repeating its dancers</i></div>` +
      list
        .map(
          (f, i) =>
            `<div class="row ed-formation"><span class="part">${esc(f.name)} <i>(${f.dancers.length} dancers, from ${esc(f.origin)})</i></span>` +
            `<button data-xml="${i}" title="Copy this formation's &lt;formation&gt; block for pasting into poc/src/assets/formations.xml">xml</button>` +
            `<button data-corpus="${i}" title="${f.inCorpus ? 'This formation is in the corpus: calls that start from it are exported as a name reference. Click to take it back out' : 'Add it to the corpus: the block goes on your clipboard to paste into poc/src/assets/formations.xml, and calls that start from it are then exported as a name reference rather than an embedded copy'}">${f.inCorpus ? 'in corpus ✓' : 'add to corpus'}</button>` +
            `<button data-del="${i}" title="Forget this label">del</button>` +
            `<button data-load="${i}" title="Load this formation's call into the Browse tab: the Level, Call and Setup selectors are set to it and the call is shown. Nothing is edited.">load</button>` +
            `<button data-edit="${i}" title="Open this formation's call in the Call editor, on the setup it was made from. Switch to the editor's Edit instance tab, pick the call and setup there, and load it - the same thing as choosing them by hand, so nothing is edited until you change something.">Edit</button>` +
            `</div>`,
        )
        .join('');
    for (const btn of this.userFormationsEl.querySelectorAll<HTMLButtonElement>('button[data-xml]')) {
      btn.addEventListener('click', () => {
        const f = list[Number(btn.dataset.xml)];
        if (!f) return;
        void navigator.clipboard?.writeText(formationToXml(f.name, f.dancers));
        this.legend.innerHTML = `copied <b>${esc(f.name)}</b> as a &lt;formation&gt; block<br><span class="small">paste it into poc/src/assets/formations.xml</span>`;
      });
    }
    for (const btn of this.userFormationsEl.querySelectorAll<HTMLButtonElement>('button[data-corpus]')) {
      btn.addEventListener('click', () => {
        const f = list[Number(btn.dataset.corpus)];
        if (!f) return;
        const now = !f.inCorpus;
        setFormationInCorpus(f.name, now);
        this.renderUserFormations();
        // ADDING HANDS OVER THE BLOCK, because the flag is the caller's assertion that it is in the
        // file - the app cannot write it, so the two halves of the action have to happen together or
        // the flag would be a lie. Taking it back out does not touch the file: whether the block is
        // pasted is the caller's business, and the export is the only thing this controls.
        if (now) {
          void navigator.clipboard?.writeText(formationToXml(f.name, f.dancers));
          this.legend.innerHTML =
            `added <b>${esc(f.name)}</b> to the corpus<br><span class="small">its &lt;formation&gt; block is on your clipboard - paste it into ` +
            `poc/src/assets/formations.xml. Until it is there, a call that names it loads only in this browser; calls starting from it now export ` +
            `as <b>formation="${esc(f.name)}"</b> instead of an embedded copy.</span>`;
        } else {
          this.legend.innerHTML = `took <b>${esc(f.name)}</b> back out of the corpus<br><span class="small">calls that start from it will export their own &lt;formation&gt; block again</span>`;
        }
      });
    }
    for (const btn of this.userFormationsEl.querySelectorAll<HTMLButtonElement>('button[data-del]')) {
      btn.addEventListener('click', () => {
        const f = list[Number(btn.dataset.del)];
        if (!f) return;
        removeUserFormation(f.name);
        this.renderUserFormations();
        // The End field may have been SHOWING that formation; re-read it so the removal is visible
        // where it was made rather than only after the next call is picked.
        if (this.player.call) this.renderEndFormation(this.player.call);
        // The library keeps the name until the page is reloaded: there is no unregister, on
        // purpose (a registered shape is the load-bearing part, and removing it mid-session would
        // leave every cached read naming a formation the store no longer holds).
        this.legend.innerHTML = `forgot <b>${esc(f.name)}</b><br><span class="small">the library keeps the name until the page is reloaded</span>`;
      });
    }
    for (const btn of this.userFormationsEl.querySelectorAll<HTMLButtonElement>('button[data-load]')) {
      btn.addEventListener('click', () => {
        const f = list[Number(btn.dataset.load)];
        if (f) this.loadFormationCall(f);
      });
    }
    for (const btn of this.userFormationsEl.querySelectorAll<HTMLButtonElement>('button[data-edit]')) {
      btn.addEventListener('click', () => {
        const f = list[Number(btn.dataset.edit)];
        if (!f) return;
        const t = this.formationTarget(f);
        this.host.openEditor(t.callId, t.setupIdx);
      });
    }
  }

  /**
   * The (call, setup) a formation row acts on: the ids it was made with, or what is selected now.
   *
   * THE FALLBACK IS FOR FORMATIONS STORED BEFORE THE IDS WERE. `origin` is display text built from the two
   * dropdowns' labels and cannot be resolved back to a catalogue entry, so the call the caller is looking at now
   * is the only other thing the button could mean. Both buttons go through here so they cannot disagree.
   */
  private formationTarget(f: UserFormation): { callId: string; setupIdx: number } {
    return {
      callId: f.callId ?? this.callSelect.value,
      setupIdx: f.setupIdx ?? parseInt(this.tamSelect.value || '0', 10),

    };
  }

  /**
   * LOAD one call into the Browse tab: the Level, the Call and the Setup, then the call itself.
   *
   * Asked for as: "Add a load before the edit button, the loads the call into the Browse Call tab and sets the
   * Level, Call and Setup according to the setup for the load button."
   *
   * THE LEVEL IS SET FIRST, AND THAT IS NOT PEDANTRY: `populateCalls` only offers the calls of the level the
   * selector names, so choosing the call before the level would be choosing it from a list that does not contain
   * it. This is the same order `onLevelChange` uses, for the same reason.
   *
   * IT IS THE SAME THREE LOADS A CLICK ON THE LISTS MAKES - populate, refresh the setups, `loadCurrent` - so
   * this is not a second way to show a call, it is the way the panel already does it.
   *
   * Returns whether that call is the one now shown, so a caller with something of its own to say about WHY it
   * could not be (the FSM panel, whose own toolbar is the only thing visible over this one) can say it.
   */
  loadCatalogue(callId: string, setupIdx: number): boolean {
    const entry = this.catalog.find((c) => c.id === callId);
    if (!entry) return false;
    this.levelSelect.value = entry.level;
    this.populateCalls(callId);
    if (this.callSelect.value !== callId) return false;
    this.refreshSetups();
    const idx = String(setupIdx);
    if (Array.from(this.tamSelect.options).some((o) => o.value === idx)) this.tamSelect.value = idx;
    this.renderUses();
    this.loadCurrent();
    return true;
  }

  /** A formation row's Load button: `loadCatalogue` plus what the panel says about it. */
  private loadFormationCall(f: UserFormation) {
    const { callId, setupIdx } = this.formationTarget(f);
    const entry = this.catalog.find((c) => c.id === callId);
    if (!entry) {
      this.legend.innerHTML = `<b>${esc(callId)}</b> is not in the loaded catalogue`;
      return;
    }
    if (!this.loadCatalogue(callId, setupIdx)) {
      this.legend.innerHTML = `<b>${esc(entry.title)}</b> is not offered under <b>${esc(entry.level.toUpperCase())}</b>`;
      return;
    }
    this.legend.innerHTML =
      `loaded <b>${esc(entry.title)}</b> — <i>${esc(this.tamSelect.selectedOptions[0]?.textContent ?? 'default')}</i>` +
      `<br><span class="small">from <b>${esc(f.name)}</b>: the Level, Call and Setup selectors are now on it</span>`;
  }

  /**
   * The `(callId, setupIdx)` an FSM row names - a call TITLE plus the FORMATION its state leaves from.
   *
   * Null for a call the catalogue does not hold, which is a real answer rather than a failure: the FSM
   * applies `Face Right`, `Promenade` and the rest of the coded moves by rule, and 531 of its 1961 edges
   * name one of those. See `fsm-target.ts` for why nothing is GUESSED beyond an exact formation name.
   */
  resolveFsm(title: string, formation: string | null, level: string): { callId: string; setupIdx: number } | null {
    const t = fsmTarget(this.catalog, title, formation, level);
    return t ? { callId: t.entry.id, setupIdx: t.setupIdx } : null;
  }

  private populateLevels() {
    this.levelSelect.add(new Option('All levels', ''));
    for (const lv of this.availableLevels) this.levelSelect.add(new Option(lv.toUpperCase(), lv));
  }

  private currentLevel(): string {
    return this.levelSelect.value;
  }

  private populateCalls(keepFile?: string) {
    const level = this.currentLevel();
    const calls = level ? this.catalog.filter((c) => c.level === level) : this.catalog;
    this.callSelect.innerHTML = '';
    let lastLevel = '';
    for (const c of calls) {
      if (level === '') {
        if (c.level !== lastLevel) {
          const g = document.createElement('optgroup');
          g.label = c.level.toUpperCase();
          this.callSelect.add(g);
          lastLevel = c.level;
        }
        this.callSelect.add(new Option(c.title, c.id));
      } else {
        this.callSelect.add(new Option(c.title, c.id));
      }
    }
    if (keepFile && calls.some((c) => c.id === keepFile)) this.callSelect.value = keepFile;
  }

  private refreshSetups() {
    const c = this.catalog.find((x) => x.id === this.callSelect.value);
    this.tamSelect.innerHTML = '';
    if (c) c.setups.forEach((s, i) => this.tamSelect.add(new Option(s.label, String(i))));
  }

  /** Load the selected call into the browser (also used as the editor preview). */
  showCall(call: CallBundle | null) {
    for (const v of this.views) {
      this.stage.scene.remove(v.group);
      this.stage.scene.remove(v.trail);
      this.stage.scene.remove(v.trailHighlight);
      this.stage.scene.remove(v.facingTicks);
    }
    for (const m of this.markers) this.stage.scene.remove(m);
    this.views = [];
    this.markers = [];
    this.dancers = [];
    if (!call) {
      this.legend.innerHTML = '<i>no call</i>';
      return;
    }
    const dancers = assignHomeIdentity(call.dancers);
    this.dancers = dancers;
    this.views = dancers.map((d) => new DancerView(d, d.couple ?? 0));
    this.markers = dancers.map((d) => buildFlatMarker(d.gender, d.couple ?? 0));
    for (let i = 0; i < this.views.length; i++) {
      this.stage.scene.add(this.views[i].group);
      this.stage.scene.add(this.views[i].trail);
      this.stage.scene.add(this.views[i].trailHighlight);
      this.stage.scene.add(this.views[i].facingTicks);
      this.stage.scene.add(this.markers[i]);
      this.views[i].setTrail(sampleTrail(dancers[i], 80));
    }
    if (call.taminator) this.legend.innerHTML = `<b>${call.title}</b> — ${call.taminator}`;
    else this.legend.innerHTML = `<b>${call.title}</b><br>from ${call.from || '(default setup)'}`;
    this.player.setCall(call);
    this.updateScrub(call);
    // The end-formation field describes the call that is now loaded.
    this.renderEndFormation(call);
    // The views were just rebuilt, so the trail focus and the display mode have to be put back.
    this.applyDisplay();
  }

  /** Alias for `showCall` used as the editor's preview callback. */
  preview(call: CallBundle | null) {
    this.showCall(call);
  }

  /**
   * Re-path the call being shown WITHOUT rebuilding the views: same dancers, new geometry.
   *
   * `showCall` builds eight `DancerView`s and samples 80-point trails for each, which is right when
   * the cast changes and far too much work for a HANDLE DRAG, where the pointer moves many times a
   * second. What a drag changes is the path, so the path is all this re-does: the player's call (for
   * the poses the frame loop draws) and the trails.
   *
   * ONLY VALID WHILE THE CAST IS THE SAME. The views are bound to dancers by array position, so this
   * assumes the same count and identity as the last `showCall` - true for every editor edit, which
   * changes poses and paths and never adds or removes a dancer.
   */
  updateCall(call: CallBundle) {
    if (this.views.length !== call.dancers.length) {
      this.showCall(call);
      return;
    }
    this.player.call = call;
    this.dancers = this.dancers.length === call.dancers.length ? call.dancers : this.dancers;
    for (let i = 0; i < this.views.length; i++) this.views[i].setTrail(sampleTrail(call.dancers[i], 80));
    // A shorter call can leave the playhead past the end, so the beam is re-clamped by the player.
    this.applyDisplay();
  }

  private loadCurrent() {
    const id = this.callSelect.value;
    const tamIndex = parseInt(this.tamSelect.value, 10);
    try {
      // THE FULL SQUARE, ALWAYS. A formation is half the set it represents, so the whole set is the only reading
      // there is: the checkbox that used to sit here built a FOUR-dancer board out of a four-dancer tam, which is
      // a shape the library never names and a dance nobody asked for.
      this.showCall(loadCall(id, tamIndex, true));
    } catch (err) {
      this.showCall(null);
      this.legend.innerHTML = `<b>${id}</b><br><span style="color:#ff7a7a">failed to load: ${(err as Error).message}</span>`;
    }
  }

  onLevelChange() {
    const prev = this.callSelect.value;
    this.populateCalls(prev);
    this.refreshSetups();
    this.renderUses();
    this.loadCurrent();
  }
  onCallChange() {
    this.refreshSetups();
    this.renderUses();
    this.loadCurrent();
  }

  /**
   * The named sequences that USE the selected call, each with an "open" button.
   *
   * A call on its own says little about how it is danced - what you want next is the published
   * sequences it appears in, and a way into them. The list comes from `modulesUsing`, which reads
   * the SAME ceder corpus and saved modules the sequencer registers; the button hands the sequence
   * to the sequence view whole and parks the playhead where this call starts.
   */
  private renderUses() {
    const c = this.catalog.find((x) => x.id === this.callSelect.value);
    if (!c) {
      this.usesEl.innerHTML = '';
      return;
    }
    const uses = modulesUsing(c.title);
    if (uses.length === 0) {
      this.usesEl.innerHTML = `<i>no module uses ${esc(c.title)}</i>`;
      return;
    }
    // The ceder corpus is ~1650 modules, so a common call matches a great many. Show the first
    // handful and say how many were held back rather than flooding the panel.
    const shown = uses.slice(0, USES_SHOWN);
    this.usesEl.innerHTML =
      `<div class="small"><b>Used by ${uses.length} module${uses.length === 1 ? '' : 's'}:</b></div>` +
      shown.map((u, i) => {
        // Say where the module START is when it is not the home square. The sequence view replays
        // every module from home, so 168 of the 294 corpus modules are danced from a board they were
        // not written for - which is the whole difference between "this sequence is broken" and "this
        // sequence starts elsewhere". One word here saves that investigation.
        const away = startsAwayFromHome(u.seq);
        const where = away ? `, from ${esc(u.seq.startFormation ?? '')}` : '';
        return `<div class="row"><button data-use="${i}" title="Open the sequence view at this call">open</button>` +
          `<span class="part">${esc(u.seq.name)} <i>(call ${u.index + 1} of ${u.seq.steps.length}${u.seq.source === 'saved' ? ', saved' : ''}${where})</i></span></div>`;
      }).join('') +
      (uses.length > shown.length ? `<div class="small"><i>… and ${uses.length - shown.length} more</i></div>` : '');
    if (shown.some((u) => startsAwayFromHome(u.seq))) {
      this.usesEl.innerHTML +=
        `<div class="small"><i>"from X" marks a module the corpus wrote for a formation other than ` +
        `home. The sequence view starts those from the formation itself, in the arrangement the corpus ` +
        `means - and REFUSES the ones whose arrangement this engine cannot build, rather than replaying ` +
        `them from the wrong board.</i></div>`;
    }
    for (const btn of this.usesEl.querySelectorAll<HTMLButtonElement>('button[data-use]')) {
      btn.addEventListener('click', () => {
        const u = shown[Number(btn.dataset.use)];
        if (u) this.host.openSequence(u.seq.steps, c.title, u.seq.startFormation);
      });
    }
  }
  onSetupChange() {
    this.loadCurrent();
  }


  /**
   * Show ONE dancer's track and hide the rest, optionally highlighting the stretch that a
   * single move is responsible for. `null` restores every track in full.
   *
   * This is ONE state with ONE application rule (`applyDisplay`) rather than independent
   * toggles, because toggles is how the app-mode visibility, the view mode, the avatar switch,
   * the isolation and the highlight end up disagreeing after a `showCall` rebuild - and a trail
   * that silently reappears is exactly the kind of "draws wrong while it measures right" defect
   * this workstream exists to remove.
   */
  setTrailFocus(index: number | null, range: { from: number; to: number } | null = null, kind: 'move' | 'facing' = 'move') {
    this.trailFocus = index == null ? null : { index, range, kind };
    this.applyDisplay();
  }

  /**
   * How the dancers are drawn: `use2d` swaps the 3D wireframes for small flat icons seen from
   * above, and `showDancers: false` draws NO dancers at all - in EITHER representation, which is the
   * point of it: "hide the dancers" is a statement about the dancers, not about the wireframes, and
   * a flat icon is just as much a body standing on the move you are trying to look at.
   */
  setDisplayMode(opts: { use2d?: boolean; showDancers?: boolean }) {
    if (opts.use2d !== undefined) this.use2d = opts.use2d;
    if (opts.showDancers !== undefined) this.showDancers = opts.showDancers;
    this.applyDisplay();
  }

  /**
   * The single place the DISPLAY rules live: app mode, view (3D or flat), avatars on or off, and the
   * trail focus, together.
   *
   * ONE FUNCTION, because the four answer the same question - what is drawn - and four independent
   * toggles is how they end up disagreeing: an avatar that reappears after a `showCall` rebuild, or a
   * trail that survives into a view meant to show only icons. Every path that changes one of them
   * calls this (mode switch, focus change, display change, and the rebuild at the end of `showCall`).
   *
   * TRAILS STAY IN BOTH VIEWS. They are floor lines, they read BEST from above, and they are what the
   * editor is actually working on; the 2D view is a better place to see them, not a reason to hide
   * them.
   */
  private applyDisplay() {
    const on = this.dancersVisible;
    const flat = this.use2d;
    this.stage.setView2D(flat);
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      const focused = this.trailFocus?.index === i;
      v.group.visible = on && !flat && this.showDancers;
      const marker = this.markers[i];
      // THE SAME SWITCH IN BOTH REPRESENTATIONS. A flat icon is a dancer, so "hide the dancers" hides
      // it too - otherwise the option would mean "hide the 3D ones", which is not what it says and
      // not what it is for: the point is to get bodies off the track being measured.
      if (marker) marker.visible = on && flat && this.showDancers;
      // The focused dancer's WHOLE track is low brightness; every other track is hidden outright.
      v.trail.visible = on && (this.trailFocus == null || focused);
      const range = focused ? this.trailFocus?.range ?? null : null;
      // The highlight is a stretch of the SAME curve, sampled from the dancer's own beat
      // clock - `moveBeatRange` says which beats, this says where that is on the floor.
      v.setTrailHighlight(range && this.dancers[i] ? sampleTrailRange(this.dancers[i], range.from, range.to, 48) : null);
      v.trailHighlight.visible = v.trailHighlight.visible && on;
      // AND THE SECOND SHAPE. A move's facing is a direction, not a path, so the Facing selection
      // draws headings over the same beats instead of a line - which is what makes the two
      // selections show two different things rather than the same line twice.
      const ticks =
        focused && range && this.trailFocus?.kind === 'facing' && this.dancers[i]
          ? facingSamples(this.dancers[i], range.from, range.to, 14)
          : null;
      v.setFacingTicks(ticks);
      v.facingTicks.visible = v.facingTicks.visible && on;
    }
    this.connectors.group.visible = on && !flat && this.showDancers;
  }

  /** Show/hide the dancer views + connectors (used by mode switching). */
  setVisible(v: boolean) {
    this.dancersVisible = v;
    this.applyDisplay();
  }

  // ---------------------------------------------------------------- rendering

  private computeGrips(poses: Pose[], call: CallBundle, beat: number) {
    const targets: { left?: THREE.Vector3; right?: THREE.Vector3 }[] = poses.map(() => ({}));
    const lines: [number, number][] = [];
    const staticHold = beat <= 0 || beat >= call.beats;
    const mode: HoldMode = staticHold ? 'static' : 'active';
    const holds = computeHandholds(poses, mode);
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
    return { targets, lines };
  }

  /**
   * The progress bar: the playhead in ABSOLUTE beats, so the control's own value IS the beat.
   *
   * The bar used to be a 0-100 percentage, which made it a scrub without a scale - you could not
   * read a beat off it, type one in, or compare two calls. Beats are what the data is in and what
   * the beat box beside it takes, so the bar is beats too, and the readout carries the beat, the
   * total and the percentage.
   */
  private updateScrub(call: CallBundle) {
    const abs = this.player.absoluteBeat();
    this.scrub.max = String(call.totalBeats || 1);
    this.scrub.step = '0.25';
    this.scrub.value = String(Math.max(0, Math.min(call.totalBeats, abs)));
    const pct = call.totalBeats > 0 ? (abs / call.totalBeats) * 100 : 0;
    this.beatReadout.textContent = `beat ${abs.toFixed(2)} / ${call.totalBeats.toFixed(2)} (${Math.round(pct)}%)`;
  }

  /** Render the current frame: pose the views, draw hand holds, update readouts. */
  render(beat: number, call: CallBundle) {
    const t = beat;
    // THE FACING IS THE CALL'S OWN, and there is no control for it: `poseFor` already reads each move's
    // authored rotation curve and falls back to the travel tangent only where that move has none, so the DATA
    // picks per move and a global override could only ever disagree with it. The `Along travel` option that
    // used to sit here forced every move to follow its tangent, which is a different dance from the one the
    // file describes - so the selector is gone and the authored reading is the only one.
    const poses = allPoses(call, t, 'rotation');
    const { targets, lines } = this.computeGrips(poses, call, beat);
    const walkPhase = ((t + 1000) % 2) / 2;
    for (let i = 0; i < this.views.length; i++) {
      this.views[i].update(poses[i], targets[i], { phase: walkPhase });
      // THE FLAT ICONS ARE POSED HERE, in the frame loop, because they are drawn INSTEAD of the
      // wireframes and nothing else would move them: `DancerView.update` does the avatars, and this
      // is the same information for the other representation. Board (x, y) -> 3D (x, 0, -y), and a
      // heading of 0 faces +x, so the marker's y-rotation IS the heading.
      const marker = this.markers[i];
      if (marker && marker.visible) {
        marker.position.set(poses[i].x, 0, -poses[i].y);
        marker.rotation.y = poses[i].heading;
      }
    }
    this.connectors.set(lines, poses);

    const parts = call.parts ? call.parts.split(';') : [];
    let acc = 0;
    let idx = -1;
    for (let k = 0; k < parts.length; k++) {
      acc += parseFloat(parts[k]);
      if (t >= acc) idx = k + 1;
    }
    this.partLabel.textContent = idx >= 0 ? `part ${idx + 1}/${parts.length}` : '';
    // The beat readout belongs to `updateScrub`, which is the one place that knows the scale.
    this.updateScrub(call);
  }
}


/**
 * The POSES along a beat range - position AND heading - for the facing ticks.
 *
 * `sampleTrailRange` deliberately returns points only, because a path is points; the facing is the
 * heading, so this asks `poseFor` directly. Kept here rather than in the engine because it is a
 * drawing concern: nothing is measured off these, they are the drawing of a curve that already
 * exists.
 */
function facingSamples(dancer: DancerSpec, from: number, to: number, steps: number): { x: number; y: number; heading: number }[] {
  const n = Math.max(1, Math.round(steps));
  const out: { x: number; y: number; heading: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const p = poseFor(dancer, from + ((to - from) * i) / n);
    out.push({ x: p.x, y: p.y, heading: p.heading });
  }
  return out;
}
