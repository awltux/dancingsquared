// CallBrowser: the browse mode of the app. Owns the shared dancer views +
// hand connectors, the level/call/setup selects and mirror checkbox, and the
// legend. Loads a call and renders its animation each frame (driven by the
// Player's playhead). The editor reuses this as its `preview` callback.

import * as THREE from 'three';

import { allPoses, sampleTrail, sampleTrailRange, computeHandholds, assignHomeIdentity, boardAtBeat, formationToXml } from 'dancing-squared-engine';
import type { HeadingMode, HoldMode, Board, CallBundle, CallStep, DancerSpec, Matchable, Pose } from 'dancing-squared-engine';
import { availableCalls, loadCall } from './data';
import type { CallInfo } from './data';
import { addUserFormation, loadUserFormations, removeUserFormation } from './formations';
import type { UserFormation } from './formations';
import { modulesUsing, startsAwayFromHome } from './modules';
import { DancerView, buildHandConnectors } from './scene';
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
  private mirrorCheck = el<HTMLInputElement>('mirror');
  private facingSelect = el<HTMLSelectElement>('facing');
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
  /** Which dancer's track is being edited, and which stretch of it. `null` = show every
   *  track in full, which is the browse view's behaviour. */
  private trailFocus: { index: number; range: { from: number; to: number } | null } | null = null;

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
      const bits: string[] = [];
      if (read.name) {
        bits.push(`<b>${esc(read.name)}</b>${read.userDefined ? ' <i>(user-defined)</i>' : ''}`);
        if (read.curated && read.curated !== read.name) bits.push(`labels as ${esc(read.curated)}`);
        bits.push(esc(read.notation));
        if (read.arrangement !== null) bits.push(`arrangement ${read.arrangement}`);
      } else {
        // NOT NAMED. Say what IS known: the size, the gender pattern, and the notation with its
        // unknowns left as `?` rather than filled in.
        bits.push('<span style="color:#ffb454">not named</span>');
        bits.push(`${read.dancers} dancers`);
        bits.push(`genders ${read.genderPattern}`);
        if (read.notation.includes('?')) bits.push(esc(read.notation));
      }
      this.endFormationEl.innerHTML = bits.join(' · ');
      // A formation is matched only against a board of the SAME dancer count, and the library holds
      // eight-dancer geometries only - so a half-set authoring cannot be named and labelling one
      // would not help. Offer the label only where it can do something.
      const canLabel = read.name === null && read.dancers === 8;
      this.labelRow.hidden = !canLabel;
      if (read.name === null && !canLabel) {
        this.endFormationEl.innerHTML +=
          ` — <i>a ${read.dancers}-dancer setup: the formation library holds eight-dancer geometries, so this end cannot be named</i>`;
      }
    } catch (err) {
      this.endFormationEl.textContent = `end formation unavailable: ${(err as Error).message}`;
    }
  }

  /**
   * Name the current end board and add it to the library as a USER-DEFINED formation.
   *
   * The board is stored, not a reference to the call, so the shape can be registered again in a
   * later session without that call. Registering it with the live library is what makes it
   * recognisable immediately - including for the board on screen, whose read is already cached.
   */
  private createFormationFromEndBoard() {
    const board = this.endBoard;
    if (!board) return;
    const name = this.formationNameInput.value.trim();
    if (!name) {
      this.endFormationEl.innerHTML += ' — <i>give it a name first</i>';
      return;
    }
    const dancers = board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
    const origin = `${this.callSelect.selectedOptions[0]?.textContent ?? ''} (from ${this.tamSelect.selectedOptions[0]?.textContent ?? 'default'})`;
    const formed: UserFormation = { name, dancers, created: new Date().toISOString(), origin };
    addUserFormation(formed);
    this.host.registerFormation(name, dancers);
    this.formationNameInput.value = '';
    this.renderUserFormations();
    // Re-read so the field shows the new name rather than the state it was labelled from.
    if (this.player.call) this.renderEndFormation(this.player.call);
    this.legend.innerHTML = `<b>${esc(name)}</b> — user-defined formation, ${dancers.length} dancers<br><span class="small">this is a label for a shape, not a call</span>`;
  }

  /** The user-defined formation list: what is stored, what it exports, and how to drop it. */
  private renderUserFormations() {
    const list = loadUserFormations();
    if (list.length === 0) {
      this.userFormationsEl.innerHTML = '';
      return;
    }
    this.userFormationsEl.innerHTML =
      `<div class="small"><b>${list.length} user-defined formation${list.length === 1 ? '' : 's'}</b>` +
      ` <i>— stored locally and registered with the library; export the block to add it to the corpus</i></div>` +
      list
        .map(
          (f, i) =>
            `<div class="row"><button data-xml="${i}" title="Copy this formation's &lt;formation&gt; block for pasting into poc/src/assets/formations.xml">xml</button>` +
            `<button data-del="${i}" title="Forget this label">del</button>` +
            `<span class="part">${esc(f.name)} <i>(${f.dancers.length} dancers, from ${esc(f.origin)})</i></span></div>`,
        )
        .join('');
    for (const btn of this.userFormationsEl.querySelectorAll<HTMLButtonElement>('button[data-xml]')) {
      btn.addEventListener('click', () => {
        const f = list[Number(btn.dataset.xml)];
        if (!f) return;
        const xml = formationToXml(f.name, f.dancers);
        void navigator.clipboard?.writeText(xml);
        this.legend.innerHTML = `copied <b>${esc(f.name)}</b> as a &lt;formation&gt; block<br><span class="small">paste it into poc/src/assets/formations.xml</span>`;
      });
    }
    for (const btn of this.userFormationsEl.querySelectorAll<HTMLButtonElement>('button[data-del]')) {
      btn.addEventListener('click', () => {
        const f = list[Number(btn.dataset.del)];
        if (!f) return;
        removeUserFormation(f.name);
        this.renderUserFormations();
        // The library keeps the name until the page is reloaded: there is no unregister, on
        // purpose (a registered shape is the load-bearing part, and removing it mid-session would
        // leave every cached read naming a formation the store no longer holds).
        this.legend.innerHTML = `forgot <b>${esc(f.name)}</b><br><span class="small">the library keeps the name until the page is reloaded</span>`;
      });
    }
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
    }
    this.views = [];
    this.dancers = [];
    if (!call) {
      this.legend.innerHTML = '<i>no call</i>';
      return;
    }
    const dancers = assignHomeIdentity(call.dancers);
    this.dancers = dancers;
    this.views = dancers.map((d) => new DancerView(d, d.couple ?? 0));
    for (let i = 0; i < this.views.length; i++) {
      this.stage.scene.add(this.views[i].group);
      this.stage.scene.add(this.views[i].trail);
      this.stage.scene.add(this.views[i].trailHighlight);
      this.views[i].setTrail(sampleTrail(dancers[i], 80));
    }
    if (call.taminator) this.legend.innerHTML = `<b>${call.title}</b> — ${call.taminator}`;
    else this.legend.innerHTML = `<b>${call.title}</b><br>from ${call.from || '(default setup)'}`;
    this.player.setCall(call);
    this.updateScrub(call);
    // The end-formation field describes the call that is now loaded.
    this.renderEndFormation(call);
    // The views were just rebuilt, so any trail focus has to be put back.
    this.applyTrailState();
  }

  /** Alias for `showCall` used as the editor's preview callback. */
  preview(call: CallBundle | null) {
    this.showCall(call);
  }

  private loadCurrent() {
    const id = this.callSelect.value;
    const tamIndex = parseInt(this.tamSelect.value, 10);
    try {
      this.showCall(loadCall(id, tamIndex, this.mirrorCheck.checked));
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
  onMirrorChange() {
    this.loadCurrent();
  }

  /**
   * Show ONE dancer's track and hide the rest, optionally highlighting the stretch that a
   * single move is responsible for. `null` restores every track in full.
   *
   * This is ONE state with ONE application rule (`applyTrailState`) rather than two
   * independent toggles, because two toggles is how the app-mode visibility, the isolation
   * and the highlight end up disagreeing after a `showCall` rebuild - and a trail that
   * silently reappears is exactly the kind of "draws wrong while it measures right" defect
   * this workstream exists to remove.
   */
  setTrailFocus(index: number | null, range: { from: number; to: number } | null = null) {
    this.trailFocus = index == null ? null : { index, range };
    this.applyTrailState();
  }

  /** The single place the trail visibility rule lives: app mode AND focus, together. */
  private applyTrailState() {
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      const focused = this.trailFocus?.index === i;
      v.group.visible = this.dancersVisible;
      v.trail.visible = this.dancersVisible && (this.trailFocus == null || focused);
      const range = focused ? this.trailFocus?.range ?? null : null;
      // The highlight is a stretch of the SAME curve, sampled from the dancer's own beat
      // clock - `moveBeatRange` says which beats, this says where that is on the floor.
      v.setTrailHighlight(range && this.dancers[i] ? sampleTrailRange(this.dancers[i], range.from, range.to, 48) : null);
      v.trailHighlight.visible = v.trailHighlight.visible && this.dancersVisible;
    }
    this.connectors.group.visible = this.dancersVisible;
  }

  /** Show/hide the dancer views + connectors (used by mode switching). */
  setVisible(v: boolean) {
    this.dancersVisible = v;
    this.applyTrailState();
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
    const facingMode = this.facingSelect.value as HeadingMode;
    const poses = allPoses(call, t, facingMode);
    const { targets, lines } = this.computeGrips(poses, call, beat);
    const walkPhase = ((t + 1000) % 2) / 2;
    for (let i = 0; i < this.views.length; i++) {
      this.views[i].update(poses[i], targets[i], { phase: walkPhase });
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

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Escape text that goes into innerHTML. Module names are DATA (the ceder corpus and whatever the
 * caller typed when saving), so a name containing `<` must not become markup. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}
