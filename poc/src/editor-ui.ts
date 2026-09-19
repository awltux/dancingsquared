// Call editor UI controller: three features.
//   1. EDIT INSTANCE — edit a taminations call instance (`<tam>`) directly: the start
//      formation and its arrangement (the gender of each spot), the end formation, and the
//      moves that carry every dancer between them.
//   2. FIX CLOSURE — correct an existing call setup so it ends at the start position of a
//      chosen POST call setup.
//   3. CREATE POSITION — synthesize a NEW position for a call from the END of a PRE call
//      setup to the START of a POST call setup, through the edit call's core setup.
//
// The engine owns every geometric decision (`normalizeInstance`, `instanceTable`,
// `setDancerStart`, `setDancerGender`, `setDancerEnd`, `setMove`, `callToXml`); this file
// owns the DOM, the current state, and NOTHING ELSE. That split is deliberate: the POC
// cannot be observed in this sandbox, so the behaviour that matters is asserted headlessly
// in `engine/test/editor.mjs` and only the wiring lives here.
import {
  alignFormationToCore,
  synthesizeSetup,
  correctEndTo,
  callToXml,
  poseFor,
  endPoses,
  rigidFit,
  normalizeInstance,
  instanceTable,
  setDancerStart,
  setDancerGender,
  setDancerEnd,
  setMove,
  addMove,
  removeMove,
  moveBeatRange,
  boardAtBeat,
  setStartFormation,
  connectStart,
  endPoseError,
} from 'dancing-squared-engine';
import type { Board, CallBundle, FormDancer, Gender, Hands, InstanceDancer, Seg } from 'dancing-squared-engine';

import {
  availableCalls,
  loadCall,
  loadEdits,
  persistEdits,
  setApplied,
  effectiveSetups,
  rebuildEdit,
} from './data';
import type { CallEdit, CallInfo } from './data';
import type { Stage, HandleSpec } from './scene';

export interface EditorUI {
  setActive(a: boolean): void;
}

/** What the editor needs from the rest of the app. */
export interface EditorHost {
  /** Show a call bundle (a still frame or a synthesized/edited instance) and let it ANIMATE. */
  preview(call: CallBundle): void;
  /** Show a call with the playhead PARKED at an absolute beat, animation off.
   *
   *  The moves editor works on one frame at a time: an animation that keeps running moves the
   *  dancers out from under the move being edited, and a re-preview happens on EVERY edit (each
   *  commit re-shows the instance), so the position has to be the caller's and has to survive being
   *  re-shown. This is that - `preview` plus a seek, in one call. */
  previewAt(call: CallBundle, absoluteBeat: number): void;
  /** Move the parked playhead without re-showing the call, for a drag. Re-showing would rebuild all
   *  eight dancer views and their trails on every pointer move. */
  setPlayhead(absoluteBeat: number): void;
  /** Re-path the shown call WITHOUT rebuilding the views: same dancers, new geometry. Used by the
   *  handle drag, where `previewAt`'s full rebuild is far too much work per pointer move. */
  updateCall(call: CallBundle): void;
  /** Show only `index`'s track, with `range` highlighted, or every track in full for null.
   *  The moves editor drives the TRAIL with these two selections: which dancer is being
   *  edited decides whose track is shown, and which move decides which stretch of it. `kind` says
   *  WHICH OF THE MOVE'S TWO SHAPES to draw over that stretch - the path, or the facings. */
  focusTrail(index: number | null, range: { from: number; to: number } | null, kind?: 'move' | 'facing'): void;
  /** The 8-dancer named formations a clone's start can be re-based onto, as start poses.
   *  Sourced from the sequencer's formation library - building a second one here would
   *  double the catalogue registration the app already pays for at startup. */
  startFormations(): { name: string; poses: FormDancer[] }[];
  /** The library's name for a board, or null. Used to NAME a generated setup after the formation it
   *  starts from, which is what every other setup's label is - see `instanceName`. */
  nameBoard(board: Board): string | null;
  /** How the dancers are drawn: flat icons from above, and/or no dancers drawn at all. */
  setDisplayMode(opts: { use2d?: boolean; showDancers?: boolean }): void;
}

// Warning threshold for a "large" closure correction.
const HEADING_WARN = 0.35; // rad (~20deg)
const POS_WARN = 2.0; // units

const HANDS: Hands[] = ['none', 'left', 'right', 'both', 'gripleft', 'gripright', 'gripboth'];
const GENDERS: Gender[] = ['boy', 'girl', 'phantom'];

/** Hands, abbreviated for a compact move tile. */
const HANDS_SHORT: Record<Hands, string> = {
  none: '—',
  left: 'L',
  right: 'R',
  both: 'B',
  gripleft: 'gL',
  gripright: 'gR',
  gripboth: 'gB',
};
const handsShort = (h: Hands): string => HANDS_SHORT[h] ?? h;

/**
 * Whether two segments carry the same LOCAL COORDINATES: the same translation curve, and the same
 * facing curve (or none on both).
 *
 * This is "the same shape, rotated to each dancer's position" made checkable, and it is the test the
 * coordinate gate turns on. Beats and hands are deliberately NOT compared - the gate is about shapes,
 * and unifying a timing or a hold across a selection is a legitimate group edit.
 */
function sameCoords(a: Seg, b: Seg): boolean {
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  const t = a.translate;
  const u = b.translate;
  if (!eq(t.cx1, u.cx1) || !eq(t.cy1, u.cy1) || !eq(t.cx2, u.cx2) || !eq(t.cy2, u.cy2) || !eq(t.x2, u.x2) || !eq(t.y2, u.y2)) return false;
  if ((a.rotate == null) !== (b.rotate == null)) return false;
  if (a.rotate && b.rotate) {
    return (
      eq(a.rotate.cx1, b.rotate.cx1) &&
      eq(a.rotate.cx2, b.rotate.cx2) &&
      eq(a.rotate.cy2, b.rotate.cy2) &&
      eq(a.rotate.x2, b.rotate.x2) &&
      eq(a.rotate.y2, b.rotate.y2)
    );
  }
  return true;
}

/** Round the way the engine's XML export does, so a value read out of the table and typed
 *  back in is the same number rather than a 15-digit float. */
const show = (n: number): string => (Math.round(n * 1e4) / 1e4).toString();
const toDeg = (rad: number): number => (rad * 180) / Math.PI;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export class EditorController implements EditorUI {
  private stage: Stage;
  private host: EditorHost;
  private active = false;

  private modeSel = el<HTMLSelectElement>('edMode');
  private callFilterInput = el<HTMLInputElement>('edCallFilter');
  private callFoundEl = el<HTMLSpanElement>('edCallFound');
  private editCallSel = el<HTMLSelectElement>('edCall');
  private editSetupSel = el<HTMLSelectElement>('edSetup');
  private postRow = el<HTMLDivElement>('edPostRow');
  private postCallSel = el<HTMLSelectElement>('edPostCall');
  private postSetupSel = el<HTMLSelectElement>('edPostSetup');
  private showTargetBtn = el<HTMLButtonElement>('edShowTarget');
  private fixPanel = el<HTMLDivElement>('edFixPanel');
  private showEndBtn = el<HTMLButtonElement>('edShowEnd');
  private fixBtn = el<HTMLButtonElement>('edFix');
  private fixInfoEl = el<HTMLSpanElement>('edFixInfo');
  private createPanel = el<HTMLDivElement>('edCreatePanel');
  private preCallSel = el<HTMLSelectElement>('edPreCall');
  private preSetupSel = el<HTMLSelectElement>('edPreSetup');
  private showStartBtn = el<HTMLButtonElement>('edShowStart');
  private nameInput = el<HTMLInputElement>('edName');
  private padInput = el<HTMLInputElement>('edPadBeats');
  private createBtn = el<HTMLButtonElement>('edCreate');
  private saveBtn = el<HTMLButtonElement>('edSave');
  private exportBtn = el<HTMLButtonElement>('edExport');
  private statusEl = el<HTMLSpanElement>('edStatus');
  private savedEl = el<HTMLDivElement>('edSaved');
  private xmlEl = el<HTMLTextAreaElement>('edXml');
  private hideDancersChk = el<HTMLInputElement>('edHideDancers');
  private view2dChk = el<HTMLInputElement>('edView2d');

  // ---- the instance editor ----
  private instPanel = el<HTMLDivElement>('edInstancePanel');
  private instResetBtn = el<HTMLButtonElement>('edInstReset');
  private cloneBtn = el<HTMLButtonElement>('edClone');
  private instExportBtn = el<HTMLButtonElement>('edInstExport');
  private instInfoEl = el<HTMLSpanElement>('edInstInfo');
  private startFormationSel = el<HTMLSelectElement>('edStartFormation');
  private connectBtn = el<HTMLButtonElement>('edConnect');
  private cloneInfoEl = el<HTMLDivElement>('edCloneInfo');
  private formationEl = el<HTMLDivElement>('edFormation');
  private scrubEl = el<HTMLInputElement>('edScrub');
  private beatReadoutEl = el<HTMLSpanElement>('edBeatReadout');
  private moveDancerSel = el<HTMLSpanElement>('edDancerPicks');
  private moveStripEl = el<HTMLDivElement>('edMoveStrip');
  private moveInfoEl = el<HTMLSpanElement>('edMoveInfo');
  private moveAddBtn = el<HTMLButtonElement>('edMoveAdd');
  private moveDelBtn = el<HTMLButtonElement>('edMoveDel');

  private catalog = availableCalls();
  private saved: CallEdit[] = loadEdits();
  /** The call filter's text. One box, every call list - see `applyCallFilter`. */
  private callQuery = '';
  /** See `haystack`. */
  private haystacks: Map<string, string> | null = null;

  // current state
  private editSetup: CallBundle | null = null;
  private postStart: FormDancer[] | null = null;
  private preEnd: FormDancer[] | null = null;
  /** The library's name for the pre call's end formation: the start formation of a CREATED setup,
   *  and therefore what that setup is called. See `loadPre`. */
  private preEndName: string | null = null;
  private generated: CallBundle | null = null;
  private generatedName = '';

  /** The instance being edited, in FULL-SET coordinates and with no mirrors. */
  private instance: CallBundle | null = null;
  private instanceEdited = false;
  /** The instance as it was loaded from the catalogue: the REFERENCE TRACK a clone re-bases
   *  away from and then reconnects to, and what `endPoseError` is measured against. */
  private source: CallBundle | null = null;
  /** Whether Save/apply should ADD this instance as a new setup ('clone') rather than replace
   *  the one it came from ('instance'). Set by the Clone button. */
  private asClone = false;
  private startFormationsLoaded = false;
  /**
   * WHICH DANCERS AN EDIT APPLIES TO, and the answer to "whose values am I looking at".
   *
   * There is no separate "focused dancer" any more: the LOWEST-numbered selected dancer IS the one the
   * tile shows and the strip lists. A caller picking a dancer to look at and a caller picking dancers
   * to change are doing the same thing, and keeping two pieces of state for it only produced a way for
   * the panel to show values that edits did not touch.
   *
   * THE LOCAL FRAME IS WHAT MAKES THE GROUP EDIT EXACT RATHER THAN APPROXIMATE. A move's translation
   * Bezier is authored in dancer-LOCAL coordinates - the origin is the dancer's spot when the move
   * begins and +X is the facing at that instant - so the SAME local control point on two dancers IS
   * the same shape, rotated and translated into each of their positions. Propagating a change needs no
   * rotation arithmetic at all: the value IS the shared description. (Only a DRAG needs the one
   * conversion, from the pointer's floor position into the dragged dancer's frame.)
   */
  private selectedDancers = new Set<number>([0]);

  /** The dancer whose values the tile shows: the lowest-numbered selected one. */
  private get moveDancer(): number {
    return this.selectedSorted()[0] ?? 0;
  }
  /** WHICH OF THE MOVE'S TWO SHAPES is selected: the translation curve or the facing curve. */
  private moveKind: 'move' | 'facing' = 'move';
  /** Which of the shown dancer's moves is selected in the strip. */
  private moveIndex = 0;
  /** The editor's OWN playhead, in absolute beats. The animation is OFF while editing an instance,
   *  so this is the only thing that moves the dancers - and it has to be remembered HERE because
   *  every edit re-shows the instance and re-showing parks the playhead at the lead-in. */
  private editBeat = 0;
  /** The `data-key` of the field being edited, so re-rendering after a commit can put the
   *  focus back where it was (a `change` on a number input fires on blur, but it also fires
   *  on every spin-button click). */
  private focusKey: string | null = null;

  constructor(stage: Stage, host: EditorHost) {
    this.stage = stage;
    this.host = host;

    for (const sel of [this.editCallSel, this.postCallSel, this.preCallSel]) this.fillCallSelect(sel, sel.value);

    this.wireEvents();
    this.wireHandleDrag();
    this.fillSetupSelect(this.editSetupSel, this.editCallSel.value);
    this.fillSetupSelect(this.postSetupSel, this.postCallSel.value);
    this.fillSetupSelect(this.preSetupSel, this.preCallSel.value);
    this.loadEditSetup();
    this.loadInstance();
    this.loadPost();
    this.loadPre();
    this.applyMode();
  }

  // ---- geometry helpers ----

  private callStart(c: CallBundle): FormDancer[] {
    return c.dancers.map((d) => {
      const p = poseFor(d, 0);
      return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
    });
  }
  private callEnd(c: CallBundle): FormDancer[] {
    return c.dancers.map((d) => {
      const p = poseFor(d, c.beats);
      return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
    });
  }
  private alignToSetup(c: CallBundle, formation: FormDancer[]): FormDancer[] {
    return alignFormationToCore(this.callStart(c), formation);
  }

  private staticCall(name: string, form: FormDancer[]): CallBundle {
    const dancers = form.map((f) => ({
      gender: (f.gender ?? 'boy') as Gender,
      x: f.x,
      y: f.y,
      angleDeg: (f.heading * 180) / Math.PI,
      path: [{ beats: 1, hands: 'both' as Hands, translate: { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 }, rotate: null }],
    }));
    // A still frame is a legitimate call bundle: it needs the same bookkeeping fields as any
    // other, including the sequencer flags this used to leave off.
    return {
      title: name,
      from: name,
      parts: '',
      taminator: '',
      dancers,
      beats: 1,
      leadin: 0,
      leadout: 0,
      totalBeats: 1,
      sequencerMode: null,
      forSequencer: true,
    };
  }

  private fillSetupSelect(sel: HTMLSelectElement, callId: string) {
    sel.innerHTML = '';
    effectiveSetups(callId).forEach((s, i) => sel.add(new Option(s.label, String(i))));
  }

  // ---- the call filter ----

  /** Lazily built lower-cased haystacks for the filter: level, title, file and every setup
   *  label. Built once, because the catalogue does not change while the app runs and this is
   *  read on every keystroke (three selects x the whole catalogue). */
  private haystack(c: CallInfo): string {
    if (!this.haystacks) {
      this.haystacks = new Map(
        this.catalog.map((x) => [x.id, `${x.level} ${x.title} ${x.file} ${x.setups.map((s) => s.from).join(' ')}`.toLowerCase()]),
      );
    }
    return this.haystacks.get(c.id) ?? '';
  }

  /**
   * Re-populate a call select from the catalogue, narrowed by the panel's filter.
   *
   * THE CURRENT SELECTION IS ALWAYS KEPT, re-inserted at the top when the filter excludes it,
   * and that is not politeness. Clearing a select's options moves its `value` onto whatever
   * survived, and no `change` event fires - so a filter typed over the top of the chosen call
   * would leave the PANEL showing one call while the editor's state still held another, with
   * nothing to reconcile them. Keeping the selection makes the filter a pure VIEW of the
   * catalogue: it can only ever change which calls you can reach, never which one you have.
   */
  private fillCallSelect(sel: HTMLSelectElement, keepId: string): number {
    const terms = this.callQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const label = (c: CallInfo) => `${c.level.toUpperCase()} · ${c.title}`;
    sel.innerHTML = '';
    const keep = this.catalog.find((c) => c.id === keepId) ?? null;
    let kept = false;
    let found = 0;
    for (const c of this.catalog) {
      if (!terms.every((t) => this.haystack(c).includes(t))) continue;
      found++;
      sel.add(new Option(label(c), c.id, false, c.id === keepId));
      if (c.id === keepId) kept = true;
    }
    if (keep && !kept) {
      const opt = new Option(`▸ ${label(keep)}`, keep.id, false, true);
      opt.title = 'kept — this is the call you have selected, and the filter excludes it';
      sel.insertBefore(opt, sel.firstChild);
    }
    if (sel.options.length === 0) {
      // Only reachable when the select held no valid id to begin with.
      const opt = new Option('no call matches', '');
      opt.disabled = true;
      sel.add(opt);
    }
    return found;
  }

  /**
   * Apply the filter to every call list in the panel.
   *
   * One box narrows all three (edit, post and pre) because they are the same list, and a
   * filter that quietly worked for one of three identical controls would be its own bug -
   * the input's tooltip says so. The terms are ANDed substrings over the level, title, file
   * and setup labels, so "ms circle" and "static square" both read the way they should.
   */
  private applyCallFilter() {
    const found = this.fillCallSelect(this.editCallSel, this.editCallSel.value);
    this.fillCallSelect(this.postCallSel, this.postCallSel.value);
    this.fillCallSelect(this.preCallSel, this.preCallSel.value);
    this.callFoundEl.textContent = this.callQuery.trim() ? `${found} of ${this.catalog.length} calls` : '';
  }

  // ---- loading ----

  private loadEditSetup() {
    const id = this.editCallSel.value;
    const tam = parseInt(this.editSetupSel.value || '0', 10);
    try {
      this.editSetup = loadCall(id, tam, true);
      this.host.preview(this.staticCall(`edit setup start — ${this.editSetup.title}`, this.callStart(this.editSetup)));
      this.refreshFixInfo();
    } catch (err) {
      this.editSetup = null;
      this.statusEl.textContent = `edit call failed: ${(err as Error).message}`;
    }
    this.renderSaved();
  }

  /**
   * Load the selected call INSTANCE into the instance editor.
   *
   * `normalizeInstance` is applied on load, so every number in the table is a FULL-SET
   * coordinate: a `<tam>` authored for half the set publishes its four dancers in half-set
   * space, and letting a caller edit those numbers would move a dancer to the mirror image
   * of the spot that was typed. The engine's test proves the normalization does not move
   * anybody (worst pose gap 2.3e-15 units).
   */
  private loadInstance() {
    const id = this.editCallSel.value;
    const tam = parseInt(this.editSetupSel.value || '0', 10);
    this.ensureStartFormations();
    try {
      // `source` is the REFERENCE TRACK: what a clone re-bases away from and reconnects to.
      this.source = normalizeInstance(loadCall(id, tam, true));
      this.instance = this.source;
      this.instanceEdited = false;
      this.asClone = false;
      this.moveIndex = 0;
      this.selectedDancers = new Set([0]);
      this.startFormationSel.value = '';
      // A NEW instance starts at its own first beat, with the animation off.
      this.editBeat = 0;
      this.showInstance(this.instance);
      this.renderInstance();
    } catch (err) {
      this.instance = null;
      this.source = null;
      this.statusEl.textContent = `edit call failed: ${(err as Error).message}`;
      this.renderScrub(null);
      this.renderInstance();
    }
  }

  private loadPost() {
    try {
      const c = loadCall(this.postCallSel.value, parseInt(this.postSetupSel.value || '0', 10), true);
      this.postStart = this.callStart(c);
      this.statusEl.textContent = `post start — ${c.title}`;
    } catch (err) {
      this.postStart = null;
      this.statusEl.textContent = `post call failed: ${(err as Error).message}`;
    }
    this.refreshFixInfo();
  }

  private loadPre() {
    try {
      const c = loadCall(this.preCallSel.value, parseInt(this.preSetupSel.value || '0', 10), true);
      this.preEnd = this.callEnd(c);
      // THE PRE CALL'S END FORMATION, by name. It is the formation a CREATED position starts from,
      // so it is what that setup should be called - and it is one gated engine call away
      // (`boardAtBeat` reads the board, the host names it), not a guess. Without it the only name
      // available to the editor was a pair of CALL names, which is exactly what a setup name must
      // not be.
      this.preEndName = this.host.nameBoard(boardAtBeat(c, c.beats));
      this.statusEl.textContent = `pre end — ${c.title}${this.preEndName ? ` → ${this.preEndName}` : ''}`;
    } catch (err) {
      this.preEnd = null;
      this.preEndName = null;
      this.statusEl.textContent = `pre call failed: ${(err as Error).message}`;
    }
  }

  // ---- closure discrepancy ----

  private fixDiscrepancy(): { posErr: number; maxHead: number } {
    const editEnd = endPoses(this.editSetup!);
    const fit = rigidFit(editEnd.map((p) => ({ x: p.x, y: p.y })), this.postStart!.map((p) => ({ x: p.x, y: p.y })));
    let maxHead = Infinity;
    const ROTS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const rot of ROTS) {
      let m = 0;
      for (let i = 0; i < Math.min(editEnd.length, this.postStart!.length); i++) {
        let d = editEnd[i].heading - this.postStart![i].heading - rot;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d <= -Math.PI) d += 2 * Math.PI;
        m = Math.max(m, Math.abs(d));
      }
      if (m < maxHead) maxHead = m;
    }
    return { posErr: fit.error, maxHead };
  }

  private refreshFixInfo() {
    if (!this.editSetup || !this.postStart) {
      this.fixInfoEl.textContent = 'pick an edit call+setup and a post call+setup';
      return;
    }
    const { posErr, maxHead } = this.fixDiscrepancy();
    this.fixInfoEl.textContent =
      `end formation ${posErr.toFixed(2)} apart from post-call start (rigid fit)` +
      (maxHead > 0.1 ? `, headings up to ${((maxHead * 180) / Math.PI).toFixed(0)}° apart` : '');
  }

  // =================================================================== instance editing

  /** What the instance editor shows for the current mode. */
  private isInstanceMode(): boolean {
    return this.modeSel.value === 'instance';
  }

  /**
   * The saved name of a generated setup: THE FORMATION ITSELF, with no call name in it.
   *
   * A setup lives INSIDE a call's `<tam>` list, so the call is already the address and repeating it
   * in the label is redundant - and it is not what the corpus does: every shipped setup is labelled
   * by its `from` alone ("Static Square", "Facing Couples"). A generated one is no different, and the
   * dropdown and the saved list now read the same way. `loadCall` resolves a setup by its (call,
   * index) pair, so nothing about uniqueness depended on the call name here.
   */
  private instanceName(call: CallBundle): string {
    return call.from || 'default';
  }

  /**
   * Show the instance with the animation OFF and the playhead where the caller left it.
   *
   * EVERY instance preview goes through here. Editing a move re-shows the instance, and re-showing
   * calls `Player.setCall`, which parks the playhead at the lead-in - so without re-applying
   * `editBeat` the dancers would jump back to the start on every keystroke, and the scrub would be
   * useless for the one thing it is for.
   */
  private showInstance(call: CallBundle) {
    this.host.previewAt(call, this.editBeat);
    this.renderScrub(call);
  }

  /** The editor's own progress bar: its value IS the beat, and the animation is off. */
  private renderScrub(call: CallBundle | null) {
    if (!call) {
      this.beatReadoutEl.textContent = '';
      return;
    }
    const total = call.totalBeats || 1;
    this.scrubEl.max = String(total);
    // A HUNDREDTH OF A BEAT. The bar was in quarter beats, which is coarse for the job it does here -
    // placing a dancer while shaping a curve needs fine adjustment, and at this step a drag across
    // the bar is finer than one step per pixel (so the movement is smooth as well as precise) and the
    // arrow keys nudge by 0.01 while Page Up/Down move by 0.1.
    this.scrubEl.step = '0.01';
    const b = Math.max(0, Math.min(total, this.editBeat));
    // Never write into the control the caller is dragging: the value is theirs while the pointer is
    // down, and a write that lands mid-gesture is the classic way a scrubber starts fighting back.
    if (document.activeElement !== this.scrubEl) this.scrubEl.value = String(b);
    const parts = call.parts ? call.parts.split(';') : [];
    let acc = 0;
    let idx = -1;
    // The call's own beat, not the absolute one: `parts` is authored against the call's clock.
    const callBeat = b - call.leadin;
    for (let k = 0; k < parts.length; k++) {
      acc += parseFloat(parts[k]);
      if (callBeat >= acc) idx = k + 1;
    }
    this.beatReadoutEl.textContent = `beat ${b.toFixed(2)} / ${total.toFixed(2)}` + (idx >= 0 ? ` · part ${idx + 1}/${parts.length}` : '');
  }

  /** The selected dancers, in index order. */
  private selectedSorted(): number[] {
    return [...this.selectedDancers].sort((a, b) => a - b);
  }

  /**
   * Whether every selected dancer's move at this index carries the SAME LOCAL COORDINATES - which is
   * what "the same shape, rotated to each position" means, and the only case where ONE set of numbers
   * describes them all.
   *
   * THE COORDINATE FIELDS ARE LOCKED WHEN THEY DIFFER, and this is the reason. Writing a number into a
   * field writes it to EVERY selected dancer, so on a selection whose curves disagree it would silently
   * collapse genuinely different shapes into one - destroying, in a keystroke, the per-dancer
   * difference the caller was looking at. Where they agree the write is a no-op in meaning (the same
   * shape stays the same shape), which is exactly when it is safe.
   *
   * The BEATS and HANDS are deliberately not gated: they are not coordinates, and unifying a timing or
   * a hold across a selection is a legitimate group edit rather than a collapse of geometry.
   */
  private coordinatesAgree(): boolean {
    const call = this.instance;
    if (!call) return true;
    const sel = this.selectedSorted();
    if (sel.length < 2) return true; // one dancer is always editable
    const first = call.dancers[sel[0]]?.path[this.moveIndex];
    if (!first) return false;
    for (const d of sel.slice(1)) {
      const seg = call.dancers[d]?.path[this.moveIndex];
      if (!seg || !sameCoords(first, seg)) return false;
    }
    return true;
  }

  /**
   * Apply a PER-DANCER change to the selected dancers' same-numbered move.
   *
   * THE CHANGE IS A FUNCTION OF THE DANCER'S OWN SEGMENT, not a finished segment. That is the whole
   * difference between "set this control point on all of them" and "copy this dancer's whole move
   * onto the others": a patch built from the focused dancer's translate would overwrite every other
   * dancer's OTHER control points with the focused one's, which is exactly the per-dancer difference
   * the caller is trying to keep.
   *
   * A selected dancer with no move at that index is SKIPPED rather than given one: the dancers of a
   * call do not always have the same number of moves, and inventing a move would change the track.
   */
  private commitMoveChange(f: (seg: Seg) => Seg, focusKey: string, light = false, coords = false) {
    // THE COORDINATE GATE, enforced HERE as well as in the fields, because the drag path reaches this
    // without going through them: a coordinate change on a selection whose curves differ would collapse
    // them into one shape, which is the whole thing `coordinatesAgree` exists to prevent.
    if (coords && !this.coordinatesAgree()) return;
    const next = this.foldMoveChange(f);
    if (!next) return;
    if (!light) {
      this.commit(next, focusKey);
      return;
    }
    // THE DRAG PATH. Re-path only - no view rebuild, no DOM rebuild - because this runs on every
    // pointer move; rebuilding eight dancer views and a hundred table inputs per move is the
    // difference between a drag and a slideshow. The playhead is re-applied because it is parked.
    this.instance = next;
    this.instanceEdited = true;
    this.host.updateCall(next);
    this.host.setPlayhead(this.editBeat);
    this.renderHandles();
  }

  /** The selected dancers' move, each changed by `f` in its OWN frame. Null when nothing applies. */
  private foldMoveChange(f: (seg: Seg) => Seg): CallBundle | null {
    const call = this.instance;
    if (!call) return null;
    let next = call;
    let changed = false;
    for (const d of this.selectedSorted()) {
      const seg = next.dancers[d]?.path[this.moveIndex];
      if (!seg) continue;
      next = setMove(next, d, this.moveIndex, f(seg));
      changed = true;
    }
    return changed ? next : null;
  }

  /**
   * The two Bezier control-point handles for the selected move's TRANSLATION curve, on the floor -
   * one pair per SELECTED dancer, which is the picture of the group edit: the same shape, drawn
   * around each dancer's own position.
   *
   * THE CURVE'S OWN FRAME IS THE DANCER'S POSE WHERE THE MOVE BEGINS. A move's translation Bezier is
   * authored in dancer-local coordinates, so a control point is placed by transforming it by the pose
   * at the move's start. The anchors are then the move's own two ends: c1's leader comes from the
   * start, c2's from the end, which is the classic handle layout and also what makes it obvious which
   * control point you are about to move.
   *
   * THE FACING CURVE GETS NO HANDLES, and that is a fact about the data rather than an omission:
   * `poseFor` reads it with `bezierAngle`, so it is a curve whose TANGENT is the heading - its
   * coordinates are a tangent space, not floor positions. A no-translation turn in `moves.xml` is
   * `x4="0" y4="2"` with the tangent running 0deg to 180deg; there is nowhere on the floor to put
   * that. The tile says so when the Facing tab is selected.
   */
  private renderHandles() {
    const call = this.instance;
    const stage = this.stage;
    if (!call || !this.active || !this.isInstanceMode() || this.moveKind !== 'move') {
      stage.setHandles(null);
      return;
    }
    // NO HANDLES WHEN THE COORDINATES DIFFER, because a handle drag is a coordinate edit and the gate
    // would refuse it. Drawing a draggable-looking dot that does nothing is worse than drawing none.
    if (!this.coordinatesAgree()) {
      stage.setHandles(null);
      return;
    }
    const handles: HandleSpec[] = [];
    for (const d of this.selectedSorted()) {
      const dancer = call.dancers[d];
      const seg = dancer?.path[this.moveIndex];
      if (!dancer || !seg) continue;
      const range = moveBeatRange(dancer, this.moveIndex);
      const p0 = poseFor(dancer, range.from);
      const p1 = poseFor(dancer, range.to);
      const world = (lx: number, ly: number) => ({
        x: p0.x + Math.cos(p0.heading) * lx - Math.sin(p0.heading) * ly,
        y: p0.y + Math.sin(p0.heading) * lx + Math.cos(p0.heading) * ly,
      });
      const t = seg.translate;
      handles.push({ id: `d${d}:c1`, anchor: { x: p0.x, y: p0.y }, point: world(t.cx1, t.cy1) });
      handles.push({ id: `d${d}:c2`, anchor: { x: p1.x, y: p1.y }, point: world(t.cx2, t.cy2) });
    }
    stage.setHandles(handles.length > 0 ? handles : null);
  }

  /** The handle being dragged, as `d<dancer>:c<1|2>`. */
  private dragHandle: string | null = null;

  /**
   * Wire the canvas for handle dragging.
   *
   * The camera is switched OFF for the duration (`controls.enabled = false`) - otherwise the orbit
   * control takes the same gesture and the board rotates while the handle is being dragged, which is
   * the single most obvious way this could feel broken.
   */
  private wireHandleDrag() {
    const canvas = this.stage.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || !this.isInstanceMode() || this.moveKind !== 'move') return;
      const id = this.stage.pickHandle(e.clientX, e.clientY);
      if (!id) return;
      this.dragHandle = id;
      // The focused dancer is DELIBERATELY not changed by grabbing a handle: the drag writes the same
      // LOCAL value to every selected dancer, so the tile's numbers read the same whichever handle was
      // taken, and moving the panel's focus mid-gesture would be motion for nothing.
      this.stage.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragHandle) return;
      const p = this.stage.floorPoint(e.clientX, e.clientY);
      if (!p) return;
      this.applyHandleDrag(this.dragHandle, p);
    });
    const endDrag = (e: PointerEvent) => {
      if (!this.dragHandle) return;
      this.dragHandle = null;
      this.stage.controls.enabled = true;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      // A FULL re-render once, at the end: the numbers in the tile and the strip's beat/hands labels
      // are only worth rebuilding when the gesture is over, and doing it per pointer move is the
      // difference between a drag and a slideshow.
      this.renderInstance();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  /** One step of a handle drag: put the control point where the pointer is, and re-path. */
  private applyHandleDrag(handle: string, board: { x: number; y: number }) {
    const call = this.instance;
    if (!call) return;
    const d = parseInt(handle.slice(1), 10);
    const isC1 = handle.endsWith('c1');
    const dancer = call.dancers[d];
    if (!dancer) return;
    const range = moveBeatRange(dancer, this.moveIndex);
    const p0 = poseFor(dancer, range.from);
    // The INVERSE of the placement in `renderHandles`: the pointer's floor point -> the LOCAL frame
    // of the move as the DRAGGED dancer performs it. This is the only rotation accounting the group
    // edit needs, and it is what makes the others land on the SAME shape rather than on the same
    // spot: every selected dancer gets this local value, each in its own frame.
    const dx = board.x - p0.x;
    const dy = board.y - p0.y;
    const h = p0.heading;
    const lx = Math.cos(h) * dx + Math.sin(h) * dy;
    const ly = -Math.sin(h) * dx + Math.cos(h) * dy;
    this.commitMoveChange((seg) => {
      const t = seg.translate;
      // ONLY THE SHAPE: the endpoint (`x2`, `y2`) and the beats and hands are untouched, which is what
      // makes this the control-point gesture rather than a way to move the track.
      return { ...seg, translate: isC1 ? { ...t, cx1: lx, cy1: ly } : { ...t, cx2: lx, cy2: ly } };
    }, `m${this.moveDancer}:${this.moveIndex}:tab:${this.moveKind}`, true, true);
  }

  /**
   * Apply an engine edit, show it, and re-draw the table.
   *
   * A FULL re-render on every commit is safe here because the listeners are on `change`
   * (blur / Enter) rather than `input`, so the field being edited has already been left;
   * `focusKey` puts the focus back for the case where the value was committed with the
   * spin buttons or Enter without leaving the field.
   */
  private commit(next: CallBundle, focusKey?: string) {
    this.instance = next;
    this.instanceEdited = true;
    this.showInstance(next);
    this.renderInstance(focusKey);
  }

  private renderInstance(focusKey?: string | null) {
    if (focusKey !== undefined) this.focusKey = focusKey;
    this.renderFormation();
    this.renderScrub(this.instance);
    this.renderDancerPicks();
    this.renderMoveStrip();
    this.renderInstanceInfo();
    this.refreshCloneInfo();
    this.syncTrailFocus();
    // The handles follow the same selection the trail does, and they are cleared by the same guard.
    this.renderHandles();
    if (this.focusKey) {
      const el2 = this.instPanel.querySelector<HTMLElement>(`[data-key="${this.focusKey}"]`);
      el2?.focus();
    }
  }

  /**
   * Point the stage at what is being edited.
   *
   * The two selections in the moves row ARE the trail instruction: "Moves of" hides every
   * other dancer's track, and "Move" highlights the stretch that move owns. Both the range
   * and the mapping from beats to floor positions come from the engine
   * (`moveBeatRange` + `sampleTrailRange`), so what is highlighted is the move the panel
   * says it is, not a plausible-looking slice. Every other mode, and every state where there
   * is nothing to edit, restores the full tracks.
   */
  private syncTrailFocus() {
    if (!this.active || !this.isInstanceMode() || !this.instance) {
      this.host.focusTrail(null, null);
      return;
    }
    const dancer = this.instance.dancers[this.moveDancer];
    const seg = dancer?.path[this.moveIndex];
    if (!dancer || !seg) {
      this.host.focusTrail(this.moveDancer, null);
      return;
    }
    // A facing selection with no facing curve to show falls back to the move, so the board can never
    // be drawing a shape the tile is not editing.
    const kind = this.moveKind === 'facing' && !seg.rotate ? 'move' : this.moveKind;
    this.host.focusTrail(this.moveDancer, moveBeatRange(dancer, this.moveIndex), kind);
  }

  private renderInstanceInfo() {
    const call = this.instance;
    if (!call) {
      this.instInfoEl.textContent = '';
      return;
    }
    const rows = instanceTable(call);
    const unknown = rows.filter((r) => r.couple === null).length;
    const n = this.selectedSorted().length;
    this.instInfoEl.textContent =
      `${call.title} · ${call.dancers.length} dancers · ${show(call.beats)} beats` +
      (n > 1 ? ` · ${n} selected (edits apply to all, each in its own frame)` : '') +
      (this.instanceEdited ? ' · edited' : '') +
      (unknown === call.dancers.length ? ' · no home identity (not a squared set)' : '');
  }

  /** The formation table: a start pose and an end pose per dancer, plus the reads. */
  private renderFormation() {
    const host = this.formationEl;
    host.innerHTML = '';
    const call = this.instance;
    if (!call) return;
    const rows = instanceTable(call);
    const table = document.createElement('table');
    table.className = 'ed-table';
    const thead = document.createElement('thead');
    const r1 = document.createElement('tr');
    r1.innerHTML =
      '<th></th><th></th><th colspan="4" class="ed-side">START</th>' +
      '<th colspan="3" class="ed-side">END (last move re-aimed)</th>' +
      '<th colspan="3" class="ed-side">READ</th>';
    const r2 = document.createElement('tr');
    r2.innerHTML =
      '<th title="Tick the dancers an edit applies to. Most calls give every dancer the same movement rotated into its own position, so one move change usually belongs on all of them.">sel</th>' +
      '<th>#</th><th>gender</th><th>x</th><th>y</th><th>head°</th><th>x</th><th>y</th><th>head°</th><th>couple</th><th>beats</th><th>moves</th>';
    thead.appendChild(r1);
    thead.appendChild(r2);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const r of rows) tbody.appendChild(this.formationRow(r));
    table.appendChild(tbody);
    host.appendChild(table);
  }

  private formationRow(r: InstanceDancer): HTMLTableRowElement {
    const tr = document.createElement('tr');
    const i = r.index;

    // THE SELECTION. A tick means "move edits apply to this dancer too", and the focused dancer is
    // always in it and cannot be removed - otherwise the tile would be showing values that edits do
    // not touch, which is the one state nobody can read.
    const selTd = document.createElement('td');
    const selBox = document.createElement('input');
    selBox.type = 'checkbox';
    selBox.checked = this.selectedDancers.has(i);
    selBox.title = `Apply move edits to dancer ${i + 1} as well (in its own rotated frame)`;
    selBox.addEventListener('change', () => {
      if (selBox.checked) {
        this.selectedDancers.add(i);
      } else if (this.selectedDancers.size > 1) {
        // The set is never allowed to empty: a panel showing a move with no dancer selected is not a
        // state anybody can read.
        this.selectedDancers.delete(i);
      }
      this.renderInstance();
    });
    selTd.appendChild(selBox);
    tr.appendChild(selTd);

    const num = document.createElement('td');
    num.textContent = String(i + 1);
    tr.appendChild(num);

    // ARRANGEMENT: which spot holds a boy and which a girl.
    const gen = document.createElement('td');
    const sel = document.createElement('select');
    sel.dataset.key = `r${i}:gender`;
    for (const g of GENDERS) sel.add(new Option(g, g, false, g === r.gender));
    sel.addEventListener('change', () => {
      const call = this.instance;
      if (call) this.commit(setDancerGender(call, i, sel.value as Gender), `r${i}:gender`);
    });
    gen.appendChild(sel);
    tr.appendChild(gen);

    // START: re-posing the start re-frames that dancer's whole path (the moves are authored
    // in dancer-local coordinates), which is what makes this an edit of the INSTANCE.
    tr.appendChild(this.numCell(`r${i}:sx`, r.start.x, 0.5, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerStart(call, i, { ...r.start, x: v }), `r${i}:sx`);
    }));
    tr.appendChild(this.numCell(`r${i}:sy`, r.start.y, 0.5, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerStart(call, i, { ...r.start, y: v }), `r${i}:sy`);
    }));
    tr.appendChild(this.numCell(`r${i}:sh`, toDeg(r.start.heading), 45, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerStart(call, i, { ...r.start, heading: toRad(v) }), `r${i}:sh`);
    }));

    // END: only this dancer's LAST move is re-aimed, and the beats are held.
    tr.appendChild(this.numCell(`r${i}:ex`, r.end.x, 0.5, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerEnd(call, i, { ...r.end, x: v }), `r${i}:ex`);
    }));
    tr.appendChild(this.numCell(`r${i}:ey`, r.end.y, 0.5, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerEnd(call, i, { ...r.end, y: v }), `r${i}:ey`);
    }));
    tr.appendChild(this.numCell(`r${i}:eh`, toDeg(r.end.heading), 45, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerEnd(call, i, { ...r.end, heading: toRad(v) }), `r${i}:eh`);
    }));

    // READS: `couple` is derived from the start formation's geometry, NOT a field of the
    // format, so it is shown rather than edited.
    tr.appendChild(this.readCell(String(r.couple ?? '—'), 'Home couple, READ from the start formation (matched on position and heading). The `<tam>` format declares only gender/x/y/angle, so this is not editable and is not exported.'));
    tr.appendChild(this.readCell(show(r.beats)));
    tr.appendChild(this.readCell(String(r.moves.length)));
    return tr;
  }

  private readCell(text: string, title?: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.className = 'ed-derived';
    td.textContent = text;
    if (title) td.title = title;
    return td;
  }

  private numCell(key: string, value: number, step: number, onCommit: (v: number) => void): HTMLTableCellElement {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = show(value);
    input.dataset.key = key;
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      // A blank or unparseable field is not an edit: redraw from the model rather than
      // writing NaN into the instance.
      if (!Number.isFinite(v)) this.renderInstance();
      else onCommit(v);
    });
    td.appendChild(input);
    return td;
  }

  // ---- moves ----

  private currentMoves(): Seg[] {
    const call = this.instance;
    if (!call) return [];
    return instanceTable(call)[this.moveDancer]?.moves ?? [];
  }

  /**
   * THE DANCER SELECTOR: one toggle per dancer.
   *
   * It replaced an "all" button, which was near-useless - very few calls have every dancer doing
   * exactly the same move, so "all" was a button you could press and then have to undo. One toggle per
   * dancer is what the job needs, and the LOWEST-numbered one selected is the one the tile shows.
   *
   * The set can never be emptied: unticking the last one is refused, because a panel showing a dancer's
   * move with no dancer selected has no sensible meaning.
   */
  private renderDancerPicks() {
    const call = this.instance;
    const host = this.moveDancerSel;
    host.innerHTML = '';
    if (!call) return;
    const sel = this.selectedDancers;
    // Once, not per chip: `instanceTable` matches the start formation against the home square, and
    // eight of those for eight tooltips is work nobody asked for.
    const rows = instanceTable(call);
    for (let i = 0; i < call.dancers.length; i++) {
      const d = call.dancers[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-pick' + (sel.has(i) ? ' on' : '') + (i === this.moveDancer ? ' focus' : '');
      b.textContent = String(i + 1);
      b.title =
        `dancer ${i + 1} (${d.gender}, couple read ${rows[i]?.couple ?? '—'}, ${d.path.length} moves)` +
        (i === this.moveDancer ? ' — the one the tile shows' : '') +
        '\nClick to add it to the selection, or to take it out (the last one cannot be removed).';
      b.addEventListener('click', () => {
        if (sel.has(i)) {
          if (sel.size === 1) return; // never empty
          sel.delete(i);
        } else {
          sel.add(i);
        }
        this.renderInstance();
      });
      host.appendChild(b);
    }
  }

  /**
   * EVERY move of the chosen track, in order, as one strip - so the whole path being edited
   * is visible at once instead of one move at a time behind a dropdown. The move being edited
   * is TRIPLE WIDTH (180px against the compact tiles' 60px, per the stylesheet) and carries
   * its numbers; the others are compact tiles, and clicking one selects it - which is also
   * what moves the track highlight, because the selection IS the trail instruction.
   */
  private renderMoveStrip() {
    const host = this.moveStripEl;
    host.innerHTML = '';
    const moves = this.currentMoves();
    if (moves.length === 0) {
      host.innerHTML = '<i class="small">this dancer has no moves — use + Move to add one</i>';
      this.moveInfoEl.textContent = '';
      return;
    }
    if (this.moveIndex >= moves.length) this.moveIndex = moves.length - 1;
    // A FACING SELECTION DOES NOT SURVIVE A MOVE THAT HAS NO FACING. Clicking through the strip
    // while editing facings should keep you in facing mode, but not on a move where there is no
    // such shape - otherwise the tile would claim a selection the board is not drawing.
    if (this.moveKind === 'facing' && moves[this.moveIndex]?.rotate == null) this.moveKind = 'move';
    for (let k = 0; k < moves.length; k++) {
      host.appendChild(k === this.moveIndex ? this.currentMoveTile(moves[k]) : this.compactMoveTile(moves[k], k));
    }
    const cur = moves[this.moveIndex];
    this.moveInfoEl.textContent = `move ${this.moveIndex + 1}/${moves.length} · ${show(cur.beats)}b · ${cur.hands}`;
  }

  /** A move you are not editing: its number, its beats and its hands, and nothing else. */
  private compactMoveTile(seg: Seg, k: number): HTMLElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'ed-move';
    tile.title = `move ${k + 1}: ${show(seg.beats)} beats, hands ${seg.hands}${seg.rotate ? ', explicit facing' : ', facing along travel'} — click to edit`;
    const n = document.createElement('b');
    n.textContent = String(k + 1);
    const b = document.createElement('span');
    b.textContent = `${show(seg.beats)}b`;
    const h = document.createElement('span');
    h.textContent = handsShort(seg.hands);
    tile.append(n, b, h);
    tile.addEventListener('click', () => this.selectMove(k));
    return tile;
  }

  private selectMove(k: number) {
    if (k === this.moveIndex) return;
    this.moveIndex = k;
    this.renderMoveStrip();
    this.syncTrailFocus();
  }

  /** The move being edited: TRIPLE width, with its beats, hands, travel and facing.
   *
   * A MOVE HAS TWO SHAPES AND THEY ARE SELECTED SEPARATELY. The translation Bezier is where the
   * dancer GOES; the rotation Bezier is how they TURN. They are different curves in different
   * spaces, they are drawn differently on the board (a highlighted path, or heading ticks), and
   * editing one while looking at the other is how a facing gets set to nonsense. So the tile carries
   * a `move | facing` selection and shows one at a time.
   *
   * FACING IS ONLY SELECTABLE WHEN IT EXISTS. `rotate` absent means "face along the travel tangent",
   * which is the taminations default and NOT a curve anyone can edit - so with the explicit box
   * unticked there is no facing shape to select, and the tab is disabled rather than opening onto
   * nothing. The explicit box itself stays reachable in the header; turning it off while Facing is
   * selected falls back to Move. */
  private currentMoveTile(seg: Seg): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'ed-move selected';
    const i = this.moveDancer;
    const k = this.moveIndex;
    const t = seg.translate;
    const head = document.createElement('div');
    head.className = 'ed-move-head';
    const name = document.createElement('b');
    name.textContent = `move ${k + 1}`;
    head.appendChild(name);

    const rchk = document.createElement('input');
    rchk.type = 'checkbox';
    rchk.checked = seg.rotate != null;
    rchk.dataset.key = `m${i}:${k}:rot`;
    rchk.title = 'Off: the dancer faces along the travel tangent (no rotation Bezier - and no facing shape to select). On: an explicit facing curve.';
    const rc = document.createElement('label');
    rc.textContent = 'explicit';
    rchk.addEventListener('change', () => {
      // Turning the facing OFF while it is selected would leave the tile showing a shape that no
      // longer exists, so the selection falls back with it.
      if (!rchk.checked && this.moveKind === 'facing') this.moveKind = 'move';
      // Turning the facing ON copies the DANCER'S OWN translation curve, which is behaviour-
      // preserving on every selected dancer (it is the curve `poseFor` already falls back to) and
      // keeps each dancer's facing curve its own rather than the focused dancer's.
      write((s) => ({ ...s, rotate: rchk.checked ? { ...s.translate } : null }), 'rot');
    });
    head.appendChild(rchk);
    head.appendChild(rc);
    tile.appendChild(head);

    // PER-DANCER PATCHES, and that is not a detail: a patch built from THIS dancer's segment
    // (`{...t, cx1: v}`) would copy this dancer's OTHER control points onto every other selected
    // dancer, which is the per-dancer difference a group edit exists to preserve. So each field
    // writes exactly its own value, into whichever dancer's segment it is handed. `coords` marks the
    // Bezier coordinate fields, which the gate above refuses on a selection whose curves differ.
    const write = (patch: (seg: Seg) => Seg, field: string, coords = false) => {
      this.commitMoveChange(patch, `m${i}:${k}:${field}`, false, coords);
    };

    // ITS OWN LINE, because the tile is 180px wide and `move 4` + `explicit` + two tabs does not
    // fit beside each other; the two-shape selection is the most important control here, so it gets
    // the space rather than being squeezed to fit.
    const tabs = document.createElement('span');
    tabs.className = 'ed-tabs';
    for (const kind of ['move', 'facing'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.key = `m${i}:${k}:tab:${kind}`;
      b.textContent = kind;
      if (this.moveKind === kind) b.className = 'on';
      b.disabled = kind === 'facing' && seg.rotate == null;
      b.title =
        kind === 'facing'
          ? seg.rotate
            ? 'The FACING shape: how the dancer turns through this move (drawn as heading ticks)'
            : 'This move has no explicit facing - tick "explicit" to give it one'
          : 'The MOVE shape: where the dancer goes (drawn along the path)';
      b.addEventListener('click', () => {
        if (this.moveKind === kind) return;
        this.moveKind = kind;
        this.renderInstance(`m${i}:${k}:tab:${kind}`);
      });
      tabs.appendChild(b);
    }
    tile.appendChild(tabs);

    const grid = document.createElement('div');
    grid.className = 'ed-grid';
    const coordsOk = this.coordinatesAgree();

    if (this.moveKind === 'facing' && seg.rotate) {
      const r = seg.rotate;
      const rKeys: [keyof typeof r, string, number][] = [
        ['cx1', 'cx3', 0.25],
        ['cx2', 'cx4', 0.25],
        ['cy2', 'cy4', 0.25],
        ['x2', 'x4', 0.25],
        ['y2', 'y4', 0.25],
      ];
      for (const [key, label, step] of rKeys) {
        // From the DANCER'S OWN rotate curve (or its translation, when it has none yet) - so the
        // same field means the same thing on every selected dancer without copying one dancer's
        // other control points onto the rest.
        grid.appendChild(
          this.field(
            `m${i}:${k}:r.${key}`,
            `r.${label}`,
            r[key],
            step,
            (v) => write((s) => ({ ...s, rotate: { ...(s.rotate ?? s.translate), [key]: v } }), `r.${key}`, true),
            !coordsOk,
          ),
        );
      }
      // NO HANDLES ON THE BOARD FOR THIS ONE, and the tile says why rather than leaving the reader to
      // wonder where they went: the facing curve is read with `bezierAngle`, so its TANGENT is the
      // heading and its coordinates live in a tangent space - there is no floor position to put a
      // handle at. The move curve is a floor path and gets both handles.
      const note = document.createElement('div');
      note.className = 'small';
      note.textContent = 'no handles on the board for the facing: its coordinates are a tangent space (its tangent IS the heading), so they have no floor position';
      grid.appendChild(note);
    } else {
      grid.appendChild(this.field(`m${i}:${k}:beats`, 'beats', seg.beats, 0.5, (v) => write((s) => ({ ...s, beats: v }), 'beats')));

      const hands = document.createElement('span');
      hands.className = 'ed-group';
      const hl = document.createElement('label');
      hl.textContent = 'hands';
      const hsel = document.createElement('select');
      hsel.dataset.key = `m${i}:${k}:hands`;
      for (const h of HANDS) hsel.add(new Option(h, h, false, h === seg.hands));
      hsel.addEventListener('change', () => write((s) => ({ ...s, hands: hsel.value as Hands }), 'hands'));
      hands.append(hl, hsel);
      grid.appendChild(hands);

      const tKeys: [keyof typeof t, string, number][] = [
        ['cx1', 'cx1', 0.25],
        ['cy1', 'cy1', 0.25],
        ['cx2', 'cx2', 0.25],
        ['cy2', 'cy2', 0.25],
        ['x2', 'x2', 0.25],
        ['y2', 'y2', 0.25],
      ];
      for (const [key, label, step] of tKeys) {
        grid.appendChild(
          this.field(
            `m${i}:${k}:t.${key}`,
            `t.${label}`,
            t[key],
            step,
            (v) => write((s) => ({ ...s, translate: { ...s.translate, [key]: v } }), `t.${key}`, true),
            !coordsOk,
          ),
        );
      }
    }

    if (!coordsOk) {
      // SAID WHERE IT APPLIES. A field that is greyed out with no explanation reads as a bug; this is
      // the one sentence that turns it into a rule, and it names the action that fixes it.
      const note = document.createElement('div');
      note.className = 'small';
      note.textContent =
        `coordinates locked: the ${this.selectedSorted().length} selected dancers do not share this move's shape, and one set of numbers cannot describe several - select one dancer to edit it`;
      grid.appendChild(note);
    }

    tile.appendChild(grid);
    return tile;
  }

  private field(key: string, label: string, value: number, step: number, onCommit: (v: number) => void, locked = false): HTMLSpanElement {
    const wrap = document.createElement('span');
    wrap.className = 'ed-group';
    const l = document.createElement('label');
    l.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = show(value);
    input.dataset.key = key;
    if (locked) {
      // LOCKED, NOT HIDDEN. The value shown is the first selected dancer's, so it stays readable - and
      // the reason it cannot be edited is what the caller needs to know, not that the field is gone.
      input.disabled = true;
      input.title = 'the selected dancers differ here, and one field cannot describe several shapes - select one dancer, or make them agree';
      wrap.classList.add('locked');
    }
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) this.renderInstance();
      else onCommit(v);
    });
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }

  // =================================================================== fix / create

  private applyMode() {
    const mode = this.modeSel.value;
    const instance = mode === 'instance';
    const create = mode === 'create';
    this.instPanel.hidden = !instance;
    this.postRow.hidden = instance;
    this.fixPanel.hidden = instance || create;
    this.createPanel.hidden = !create;
    this.setHudWide();
    this.renderSaved();
    if (instance) {
      // The instance editor has been showing a still frame while another mode was up, so hand the
      // preview back to the instance being edited - ANIMATION OFF, at the beat the caller left.
      if (this.instance) this.showInstance(this.instance);
    } else {
      this.refreshFixInfo();
      // Leaving the instance editor gives the full tracks back, and takes the Bézier handles with
      // it: they belong to a move selection that is no longer on screen.
      this.host.focusTrail(null, null);
      this.stage.setHandles(null);
    }
  }

  /** The instance table needs the width; the other modes do not. */
  private setHudWide() {
    const hud = document.getElementById('hud');
    if (hud) hud.classList.toggle('ed-instance', this.active && this.isInstanceMode());
  }

  /**
   * The editor's two view options, and their SCOPE.
   *
   * The stage is shared with the browse and sequence views, so these apply while the editor is the
   * panel on screen and are RELEASED when it is not - otherwise a caller who hid the dancers in the
   * editor would find them gone in the browse view too, with nothing on that panel to explain why.
   */
  private applyViewOptions() {
    if (!this.active) {
      this.host.setDisplayMode({ use2d: false, showDancers: true });
      return;
    }
    this.host.setDisplayMode({ use2d: this.view2dChk.checked, showDancers: !this.hideDancersChk.checked });
  }

  // ---- actions ----

  private doFix() {
    if (!this.editSetup || !this.postStart) {
      this.statusEl.textContent = 'pick an edit call+setup and a post call+setup';
      return;
    }
    const { posErr, maxHead } = this.fixDiscrepancy();
    if (posErr > POS_WARN || maxHead > HEADING_WARN) {
      const size = `heading ${((maxHead * 180) / Math.PI).toFixed(0)}°, pos ${posErr.toFixed(1)}`;
      if (!window.confirm(`Correction is large (${size}) — this may not be a simple closure misalignment. Proceed?`)) return;
    }
    const target = this.alignToSetup(this.editSetup, this.postStart);
    const fixed = correctEndTo(this.editSetup, target);
    this.generated = fixed;
    // A FIX DOES NOT CHANGE THE SETUP'S FORMATION, so it keeps that setup's own label - which is
    // already a formation name. "(fixed)" was a marker for the saved list, and the list already says
    // which kind it is (`fix · Static Square`), so the suffix carried nothing but the call name.
    this.generatedName = this.instanceName(this.editSetup);
    this.host.preview(fixed);
    this.fixInfoEl.textContent =
      `corrected: end formation now ${posErr.toFixed(2)} apart from post-call start` +
      (maxHead > 0.1 ? `, headings ${((maxHead * 180) / Math.PI).toFixed(0)}° apart` : '');
    this.statusEl.textContent = '✓ fixed closure';
  }

  private doCreate() {
    if (!this.editSetup || !this.preEnd || !this.postStart) {
      this.statusEl.textContent = 'pick an edit call+setup, a pre call+setup, and a post call+setup';
      return;
    }
    // THE NAME IS THE FORMATION THE NEW SETUP STARTS FROM - the pre call's END formation - or what
    // the caller typed. It is NEVER a pair of call names: a setup's label is a formation, and the
    // setup's own (call, index) address is what makes it unique.
    const name = this.nameInput.value.trim() || this.preEndName || 'new position';
    const beats = parseFloat(this.padInput.value) || 2;
    const start = this.alignToSetup(this.editSetup, this.preEnd);
    const end = this.alignToSetup(this.editSetup, this.postStart);
    try {
      const created = synthesizeSetup(this.editSetup, { name, start, end, padBeats: beats });
      this.generated = created;
      this.generatedName = name;
      this.host.preview(created);
      this.statusEl.textContent = `✓ created "${name}" (${created.beats} beats)`;
    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  }

  private showTarget() {
    if (!this.postStart) return;
    const name = this.postCallSel.selectedOptions[0]?.textContent ?? this.postCallSel.value;
    this.host.preview(this.staticCall(`post start — ${name}`, this.postStart));
  }
  private showEnd() {
    if (!this.editSetup) return;
    const name = this.editCallSel.selectedOptions[0]?.textContent ?? this.editCallSel.value;
    this.host.preview(this.staticCall(`edit end — ${name}`, this.callEnd(this.editSetup)));
  }
  private showStart() {
    if (!this.preEnd) return;
    const name = this.preCallSel.selectedOptions[0]?.textContent ?? this.preCallSel.value;
    this.host.preview(this.staticCall(`pre end — ${name}`, this.preEnd));
  }

  /** Throw the in-editor edits away and reload the instance from its source. NOTE what the
   *  source is: `loadCall` honours an edit already applied to the live catalogue, so a Reset
   *  after applying one reloads THAT, not the shipped tam. Unapply it to get back to shipped. */
  private doResetInstance() {
    this.loadInstance();
    this.statusEl.textContent = 'reloaded the instance';
  }

  // ---- clone onto a different start setup ----

  /** The formation list is asked for once, lazily: it comes from the sequencer's library. */
  private ensureStartFormations() {
    if (this.startFormationsLoaded) return;
    this.startFormationsLoaded = true;
    this.startFormationSel.innerHTML = '';
    this.startFormationSel.add(new Option('— keep the current start —', ''));
    for (const f of this.host.startFormations()) this.startFormationSel.add(new Option(f.name, f.name));
  }

  /** Start a NEW setup from the catalogue instance, rather than editing the existing one. */
  private doClone() {
    this.loadInstance();
    this.asClone = true;
    this.startFormationSel.value = '';
    this.refreshCloneInfo();
    this.statusEl.textContent = 'cloned — pick a Start setup, then Connect';
  }

  /** Re-base the clone's START onto the chosen formation, KEEPING every move. The track no
   *  longer ends where the call ends; `refreshCloneInfo` measures by how much, and Connect is
   *  the other half of the operation. */
  private doStartFormation() {
    const name = this.startFormationSel.value;
    if (!name) return;
    // Re-base the CURRENT instance, not the pristine source, so move edits made before the
    // start was chosen survive. The CONNECT anchor stays the source: that is the original
    // track, and it is what makes the end invariant.
    const base = this.instance ?? this.source;
    if (!base) return;
    const formation = this.host.startFormations().find((f) => f.name === name);
    if (!formation) {
      this.statusEl.textContent = `✗ unknown formation "${name}"`;
      return;
    }
    try {
      const rebased = setStartFormation(base, formation.poses);
      // The setup's LABEL is the formation's name: a tam is identified by its `from`, and this
      // is the new setup, so the name is not decoration - it is what the export and the
      // catalogue index will carry.
      this.instance = { ...rebased, from: name };
      this.asClone = true;
      this.instanceEdited = true;
      this.showInstance(this.instance);
      this.renderInstance();
      this.statusEl.textContent = `re-based the start onto "${name}" — the track no longer closes`;
    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  }

  /** Complete the re-based track: re-aim each dancer's FIRST move onto the old track. */
  private doConnect() {
    if (!this.instance || !this.source) {
      this.statusEl.textContent = 'nothing to connect';
      return;
    }
    try {
      this.instance = connectStart(this.instance, this.source);
      this.instanceEdited = true;
      this.showInstance(this.instance);
      this.renderInstance();
      this.statusEl.textContent = 'connected the first moves';
    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  }

  /**
   * How far the edited instance's END formation has drifted from the source track's.
   *
   * This is the "now invalid track" made visible: re-posing a start re-frames every move, so
   * the set stops finishing where the call finishes and the editor has to SAY so rather than
   * leave the user to notice it on the stage.
   */
  private refreshCloneInfo() {
    const inst = this.instance;
    const ref = this.source;
    if (!inst || !ref) {
      this.cloneInfoEl.textContent = '';
      return;
    }
    const err = endPoseError(inst, ref);
    const deg = (err.heading * 180) / Math.PI;
    if (err.pos < 1e-9 && err.heading < 1e-9) {
      this.cloneInfoEl.textContent = `end formation unchanged from "${ref.from || 'the source'}"${this.asClone ? ' · saving as a NEW setup' : ''}`;
      return;
    }
    // The clone workflow gets the loud wording because the drift there is a DEFECT with a
    // named fix. Re-aiming an end on purpose in an ordinary edit is not a defect, so it gets
    // the same number without the alarm.
    this.cloneInfoEl.innerHTML = this.asClone
      ? `<span style="color:#ffb454">track incomplete</span>: the ends are ${err.pos.toFixed(2)} units / ` +
        `${deg.toFixed(0)}° from "${esc(ref.from || 'the source')}" — <b>Connect</b> re-aims the first move of every dancer to close it`
      : `ends differ from the catalogue's by ${err.pos.toFixed(2)} units / ${deg.toFixed(0)}°`;
  }

  private addInstanceMove() {
    const call = this.instance;
    if (!call) return;
    // A one-beat pause: a zero-travel move is the honest default, because it changes the
    // timing of the call without inventing choreography nobody asked for.
    const seg: Seg = {
      beats: 1,
      hands: 'none',
      translate: { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 },
      rotate: null,
    };
    // ON EVERY SELECTED DANCER, like every other move edit - a group edit that propagated the
    // numbers but not the moves would leave the dancers silently out of step with each other.
    let next = call;
    for (const d of this.selectedSorted()) next = addMove(next, d, seg);
    this.moveIndex = this.currentMoves().length; // the appended move
    this.commit(next, `m${this.moveDancer}:${this.moveIndex}:beats`);
  }

  private deleteInstanceMove() {
    const call = this.instance;
    if (!call || this.currentMoves().length === 0) return;
    let next = call;
    for (const d of this.selectedSorted()) {
      // A dancer with no move at this index is skipped rather than throwing the whole delete away.
      if ((next.dancers[d]?.path.length ?? 0) > this.moveIndex) next = removeMove(next, d, this.moveIndex);
    }
    this.moveIndex = Math.max(0, this.moveIndex - 1);
    this.commit(next);
  }

  // ---- save / export ----

  private currentSpec(): CallEdit | null {
    const id = this.editCallSel.value;
    if (!id) return null;
    const setupIdx = parseInt(this.editSetupSel.value || '0', 10);
    const isInstance = this.modeSel.value === 'instance';
    const isCreate = this.modeSel.value === 'create';
    if (isInstance) {
      if (!this.instance) return null;
      return {
        // A CLONE ADDS a setup; an INSTANCE edit replaces the one it came from. That is the
        // whole difference between the two, and it is why they are separate kinds rather than
        // one kind with a flag: `loadCall` and `effectiveSetups` have to agree about which
        // appended index a label names, and two kinds make that read off the data.
        kind: this.asClone ? 'clone' : 'instance',
        callId: id,
        setupIdx,
        name: this.instanceName(this.instance),
        padBeats: 1,
        // The whole edited instance, exactly as exported: expanded, full-set, and carrying
        // the declarations the apply path registers with.
        xml: callToXml(this.instance, this.instance.from),
      };
    }
    const base: CallEdit = {
      kind: isCreate ? 'create' : 'fix',
      callId: id,
      setupIdx,
      postCallId: this.postCallSel.value,
      postSetupIdx: parseInt(this.postSetupSel.value || '0', 10),
      // Same rule as `doCreate`: a formation name, never a pair of call names. `preEndName` is the
      // pre call's END formation, which is where a created setup begins.
      name: this.generatedName || this.nameInput.value.trim() || this.preEndName || 'new position',
      padBeats: isCreate ? parseFloat(this.padInput.value) || 2 : 1,
    };
    if (base.kind === 'create') {
      base.preCallId = this.preCallSel.value;
      base.preSetupIdx = parseInt(this.preSetupSel.value || '0', 10);
    }
    return base;
  }

  private doSave() {
    const spec = this.currentSpec();
    if (!spec) return;
    // WHAT IDENTIFIES A SAVED EDIT DEPENDS ON WHAT IT DOES TO THE CALL.
    //
    // A REPLACING edit (fix / instance) is identified by the SETUP it replaces, so re-saving it
    // replaces the previous one WHATEVER IT WAS CALLED - and that matters now that names changed
    // shape: without it, an edit saved under the old "Call · Formation" label would survive
    // alongside the new "Formation" one, both applied, and `loadCall` would take the first while the
    // list showed the second.
    //
    // An APPENDING edit (create / clone) is identified by its NAME, because the name IS the new
    // setup - two clones of one call from one setup are two different setups.
    const replaces = spec.kind === 'fix' || spec.kind === 'instance';
    this.saved = this.saved.filter(
      (s) => !(s.kind === spec.kind && s.callId === spec.callId && s.setupIdx === spec.setupIdx && (replaces || s.name === spec.name)),
    );
    this.saved.push(spec);
    persistEdits(this.saved);
    this.renderSaved();
    this.statusEl.textContent = `saved "${spec.name}"`;
  }

  /** The XML an export should produce for the CURRENT mode. */
  private exportXml(): string | null {
    if (this.isInstanceMode()) {
      return this.instance ? callToXml(this.instance, this.instance.from) : null;
    }
    const call = this.generated ?? (() => {
      const spec = this.currentSpec();
      if (!spec) return null;
      return rebuildEdit(spec);
    })();
    if (!call) return null;
    return callToXml(call, this.generatedName || call.from || call.title);
  }

  private doExport() {
    try {
      const xml = this.exportXml();
      if (!xml) {
        this.statusEl.textContent = 'nothing to export yet';
        return;
      }
      this.xmlEl.value = '<calls>\n' + xml + '\n</calls>';
      void navigator.clipboard?.writeText(this.xmlEl.value);
      this.statusEl.textContent = 'exported <tam> XML (copied)';
    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  }

  private renderSaved() {
    this.savedEl.innerHTML = '';
    if (this.saved.length === 0) {
      this.savedEl.innerHTML = '<i>no saved editor results</i>';
      return;
    }
    for (const s of this.saved) {
      const row = document.createElement('div');
      row.className = 'setup' + (s.applied ? ' applied' : '');
      const label = document.createElement('b');
      const kind = s.kind === 'fix' ? 'fix' : s.kind === 'create' ? 'create' : s.kind === 'clone' ? 'clone' : 'instance';
      label.textContent = `${kind} · ${s.name}${s.applied ? ' ✔' : ''}`;
      row.appendChild(label);
      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'preview';
      loadBtn.addEventListener('click', () => {
        try {
          this.host.preview(rebuildEdit(s));
          this.statusEl.textContent = `✓ ${s.name}`;
        } catch (err) {
          this.statusEl.textContent = `✗ ${(err as Error).message}`;
        }
      });
      const applyBtn = document.createElement('button');
      applyBtn.textContent = s.applied ? 'unapply' : 'apply to live';
      applyBtn.addEventListener('click', () => {
        const wasApplied = !!s.applied;
        setApplied(s, !wasApplied);
        this.saved = loadEdits();
        this.renderSaved();
        this.statusEl.textContent = wasApplied ? `removed "${s.name}" from live catalog` : `✓ "${s.name}" applied to live catalog`;
      });
      const delBtn = document.createElement('button');
      delBtn.textContent = 'del';
      delBtn.addEventListener('click', () => {
        this.saved = this.saved.filter((x) => x !== s);
        persistEdits(this.saved);
        this.renderSaved();
      });
      row.appendChild(loadBtn);
      row.appendChild(applyBtn);
      row.appendChild(delBtn);
      this.savedEl.appendChild(row);
    }
  }

  private wireEvents() {
    this.fixBtn.addEventListener('click', () => this.doFix());
    this.createBtn.addEventListener('click', () => this.doCreate());
    this.saveBtn.addEventListener('click', () => this.doSave());
    this.exportBtn.addEventListener('click', () => this.doExport());
    this.showTargetBtn.addEventListener('click', () => this.showTarget());
    this.showEndBtn.addEventListener('click', () => this.showEnd());
    this.showStartBtn.addEventListener('click', () => this.showStart());
    this.modeSel.addEventListener('change', () => this.applyMode());
    this.hideDancersChk.addEventListener('change', () => this.applyViewOptions());
    this.view2dChk.addEventListener('change', () => this.applyViewOptions());
    // The filter narrows the LISTS only, so it never reloads a call: the selected ids are
    // preserved by `fillCallSelect`, and reloading on every keystroke would fight the user.
    this.callFilterInput.addEventListener('input', () => {
      this.callQuery = this.callFilterInput.value;
      this.applyCallFilter();
    });
    this.callFilterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.callFilterInput.value = '';
        this.callQuery = '';
        this.applyCallFilter();
      }
    });
    this.editCallSel.addEventListener('change', () => {
      this.fillSetupSelect(this.editSetupSel, this.editCallSel.value);
      this.loadEditSetup();
      this.loadInstance();
    });
    this.editSetupSel.addEventListener('change', () => {
      this.loadEditSetup();
      this.loadInstance();
    });
    this.postCallSel.addEventListener('change', () => {
      this.fillSetupSelect(this.postSetupSel, this.postCallSel.value);
      this.loadPost();
    });
    this.postSetupSel.addEventListener('change', () => this.loadPost());
    this.preCallSel.addEventListener('change', () => {
      this.fillSetupSelect(this.preSetupSel, this.preCallSel.value);
      this.loadPre();
    });
    this.preSetupSel.addEventListener('change', () => this.loadPre());

    // Instance editor.
    this.instResetBtn.addEventListener('click', () => this.doResetInstance());
    this.cloneBtn.addEventListener('click', () => this.doClone());
    this.instExportBtn.addEventListener('click', () => this.doExport());
    this.startFormationSel.addEventListener('change', () => this.doStartFormation());
    this.connectBtn.addEventListener('click', () => this.doConnect());
    // THE MANUAL SCRUB. The animation is off in this mode, so this is the only thing that moves the
    // dancers: `setPlayhead` moves the playhead WITHOUT re-showing the call, because re-showing
    // rebuilds all eight dancer views and their trails and would be done on every pointer move.
    this.scrubEl.addEventListener('input', () => {
      const b = parseFloat(this.scrubEl.value);
      if (!Number.isFinite(b)) return;
      this.editBeat = b;
      this.host.setPlayhead(b);
      this.renderScrub(this.instance);
    });
    // There is no dancer dropdown and no "all" button any more: the chips ARE the selector
    // (`renderDancerPicks`), one toggle per dancer, and the lowest-numbered selected one is the dancer
    // the tile shows.
    // There is no "Move" dropdown any more: the strip IS the picker, and `selectMove` both
    // re-draws it and re-derives the track highlight.
    this.moveAddBtn.addEventListener('click', () => this.addInstanceMove());
    this.moveDelBtn.addEventListener('click', () => this.deleteInstanceMove());
  }

  setActive(a: boolean) {
    this.active = a;
    this.setHudWide();
    // The view options are scoped to this panel: applied on the way in, released on the way out.
    this.applyViewOptions();
    if (a) {
      this.renderSaved();
      this.renderInstance();
    } else {
      // The editor is off screen: give every dancer's track back, and drop the Bézier handles so
      // the browse and sequence views cannot inherit a magenta dot from an edit that is not showing.
      this.host.focusTrail(null, null);
      this.stage.setHandles(null);
    }
  }
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Escape text that goes into innerHTML. A call's `from` label is authored DATA, so a name
 *  containing `<` must not become markup - the same rule `browser.ts` applies to module names. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}

/** Backwards-compatible factory (used by main.ts). */
export function initEditor(stage: Stage, host: EditorHost): EditorUI {
  return new EditorController(stage, host);
}
