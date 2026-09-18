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
} from 'dancing-squared-engine';
import type { CallBundle, FormDancer, Gender, Hands, InstanceDancer, Seg } from 'dancing-squared-engine';

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
import type { Stage } from './scene';

export interface EditorUI {
  setActive(a: boolean): void;
}

/** What the editor needs from the rest of the app. */
export interface EditorHost {
  /** Show a call bundle (a still frame or a synthesized/edited instance). */
  preview(call: CallBundle): void;
  /** Show only `index`'s track, with `range` highlighted, or every track in full for null.
   *  The moves editor drives the TRAIL with these two selections: which dancer is being
   *  edited decides whose track is shown, and which move decides which stretch of it. */
  focusTrail(index: number | null, range: { from: number; to: number } | null): void;
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

  // ---- the instance editor ----
  private instPanel = el<HTMLDivElement>('edInstancePanel');
  private instResetBtn = el<HTMLButtonElement>('edInstReset');
  private instExportBtn = el<HTMLButtonElement>('edInstExport');
  private instInfoEl = el<HTMLSpanElement>('edInstInfo');
  private formationEl = el<HTMLDivElement>('edFormation');
  private moveDancerSel = el<HTMLSelectElement>('edMoveDancer');
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
  private generated: CallBundle | null = null;
  private generatedName = '';

  /** The instance being edited, in FULL-SET coordinates and with no mirrors. */
  private instance: CallBundle | null = null;
  private instanceEdited = false;
  private moveDancer = 0;
  private moveIndex = 0;
  /** The `data-key` of the field being edited, so re-rendering after a commit can put the
   *  focus back where it was (a `change` on a number input fires on blur, but it also fires
   *  on every spin-button click). */
  private focusKey: string | null = null;

  constructor(stage: Stage, host: EditorHost) {
    this.stage = stage;
    this.host = host;

    for (const sel of [this.editCallSel, this.postCallSel, this.preCallSel]) this.fillCallSelect(sel, sel.value);

    this.wireEvents();
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
    try {
      this.instance = normalizeInstance(loadCall(id, tam, true));
      this.instanceEdited = false;
      this.moveDancer = 0;
      this.moveIndex = 0;
      this.host.preview(this.instance);
      this.renderInstance();
    } catch (err) {
      this.instance = null;
      this.statusEl.textContent = `edit call failed: ${(err as Error).message}`;
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
      this.statusEl.textContent = `pre end — ${c.title}`;
    } catch (err) {
      this.preEnd = null;
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

  /** The saved name of an instance edit. Deterministic from the instance, because
   *  `setApplied` matches a saved edit on its name as well as its call/setup. */
  private instanceName(call: CallBundle): string {
    return `${call.title} · ${call.from || 'default'}`;
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
    this.host.preview(next);
    this.renderInstance(focusKey);
  }

  private renderInstance(focusKey?: string | null) {
    if (focusKey !== undefined) this.focusKey = focusKey;
    this.renderFormation();
    this.renderMoveSelectors();
    this.renderMoveStrip();
    this.renderInstanceInfo();
    this.syncTrailFocus();
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
    this.host.focusTrail(this.moveDancer, moveBeatRange(dancer, this.moveIndex));
  }

  private renderInstanceInfo() {
    const call = this.instance;
    if (!call) {
      this.instInfoEl.textContent = '';
      return;
    }
    const rows = instanceTable(call);
    const unknown = rows.filter((r) => r.couple === null).length;
    this.instInfoEl.textContent =
      `${call.title} · ${call.dancers.length} dancers · ${show(call.beats)} beats` +
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
      '<th></th><th colspan="4" class="ed-side">START</th>' +
      '<th colspan="3" class="ed-side">END (last move re-aimed)</th>' +
      '<th colspan="3" class="ed-side">READ</th>';
    const r2 = document.createElement('tr');
    r2.innerHTML = '<th>#</th><th>gender</th><th>x</th><th>y</th><th>head°</th><th>x</th><th>y</th><th>head°</th><th>couple</th><th>beats</th><th>moves</th>';
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

  private renderMoveSelectors() {
    const call = this.instance;
    const dancers = call ? instanceTable(call) : [];
    if (this.moveDancer >= dancers.length) this.moveDancer = 0;
    this.moveDancerSel.innerHTML = '';
    for (const d of dancers) {
      this.moveDancerSel.add(new Option(`#${d.index + 1} ${d.gender} (${d.moves.length})`, String(d.index), false, d.index === this.moveDancer));
    }
    this.moveDelBtn.disabled = (dancers[this.moveDancer]?.moves.length ?? 0) === 0;
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
   * `rotate` absent means "face along the travel tangent", which is the taminations default,
   * so the toggle is behaviour-preserving when it is switched on: `rotate = translate` gives
   * the heading `poseFor` already falls back to. */
  private currentMoveTile(seg: Seg): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'ed-move selected';
    const i = this.moveDancer;
    const k = this.moveIndex;
    const head = document.createElement('div');
    head.className = 'ed-move-head';
    const name = document.createElement('b');
    name.textContent = `move ${k + 1}`;
    head.appendChild(name);
    tile.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'ed-grid';

    // The focus key must be the EDITED FIELD's own `data-key`, or the re-render after a
    // commit has nothing to find and the focus is lost on every spin-button click.
    const write = (patch: Partial<Seg>, field: string) => {
      const call = this.instance;
      if (!call) return;
      this.commit(setMove(call, i, k, { ...seg, ...patch }), `m${i}:${k}:${field}`);
    };

    grid.appendChild(this.field(`m${i}:${k}:beats`, 'beats', seg.beats, 0.5, (v) => write({ beats: v }, 'beats')));

    const hands = document.createElement('span');
    hands.className = 'ed-group';
    const hl = document.createElement('label');
    hl.textContent = 'hands';
    const hsel = document.createElement('select');
    hsel.dataset.key = `m${i}:${k}:hands`;
    for (const h of HANDS) hsel.add(new Option(h, h, false, h === seg.hands));
    hsel.addEventListener('change', () => write({ hands: hsel.value as Hands }, 'hands'));
    hands.append(hl, hsel);
    grid.appendChild(hands);

    const t = seg.translate;
    const tKeys: [keyof typeof t, string, number][] = [
      ['cx1', 'cx1', 0.25],
      ['cy1', 'cy1', 0.25],
      ['cx2', 'cx2', 0.25],
      ['cy2', 'cy2', 0.25],
      ['x2', 'x2', 0.25],
      ['y2', 'y2', 0.25],
    ];
    for (const [key, label, step] of tKeys) {
      grid.appendChild(this.field(`m${i}:${k}:t.${key}`, `t.${label}`, t[key], step, (v) => write({ translate: { ...t, [key]: v } }, `t.${key}`)));
    }

    const rot = document.createElement('span');
    rot.className = 'ed-group';
    const rl = document.createElement('label');
    rl.textContent = 'facing';
    const rchk = document.createElement('input');
    rchk.type = 'checkbox';
    rchk.checked = seg.rotate != null;
    rchk.dataset.key = `m${i}:${k}:rot`;
    rchk.title = 'Off: the dancer faces along the travel tangent (no rotation Bezier). On: an explicit facing curve.';
    const rc = document.createElement('label');
    rc.textContent = 'explicit';
    rchk.addEventListener('change', () => write({ rotate: rchk.checked ? { ...t } : null }, 'rot'));
    rot.append(rl, rchk, rc);
    grid.appendChild(rot);

    if (seg.rotate) {
      const r = seg.rotate;
      const rKeys: [keyof typeof r, string, number][] = [
        ['cx1', 'cx3', 0.25],
        ['cx2', 'cx4', 0.25],
        ['cy2', 'cy4', 0.25],
        ['x2', 'x4', 0.25],
        ['y2', 'y4', 0.25],
      ];
      for (const [key, label, step] of rKeys) {
        grid.appendChild(this.field(`m${i}:${k}:r.${key}`, `r.${label}`, r[key], step, (v) => write({ rotate: { ...r, [key]: v } }, `r.${key}`)));
      }
    }

    tile.appendChild(grid);
    return tile;
  }

  private field(key: string, label: string, value: number, step: number, onCommit: (v: number) => void): HTMLSpanElement {
    const wrap = document.createElement('span');
    wrap.className = 'ed-group';
    const l = document.createElement('label');
    l.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = show(value);
    input.dataset.key = key;
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
      // The instance editor has been showing a still frame while another mode was up, so
      // hand the preview back to the instance being edited.
      if (this.instance) this.host.preview(this.instance);
    } else {
      this.refreshFixInfo();
      // Leaving the instance editor gives the full tracks back.
      this.host.focusTrail(null, null);
    }
  }

  /** The instance table needs the width; the other modes do not. */
  private setHudWide() {
    const hud = document.getElementById('hud');
    if (hud) hud.classList.toggle('ed-instance', this.active && this.isInstanceMode());
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
    this.generatedName = `${this.editSetup.title} (fixed)`;
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
    const name = this.nameInput.value.trim() || `${this.preCallSel.value} → ${this.postCallSel.value}`;
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

  private addInstanceMove() {
    const call = this.instance;
    if (!call) return;
    // A one-beat pause: a zero-travel move is the honest default, because it changes the
    // timing of the call without inventing choreography nobody asked for.
    const next = addMove(call, this.moveDancer, {
      beats: 1,
      hands: 'none',
      translate: { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 },
      rotate: null,
    });
    this.moveIndex = this.currentMoves().length; // the appended move
    this.commit(next, `m${this.moveDancer}:${this.moveIndex}:beats`);
  }

  private deleteInstanceMove() {
    const call = this.instance;
    if (!call || this.currentMoves().length === 0) return;
    const next = removeMove(call, this.moveDancer, this.moveIndex);
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
        kind: 'instance',
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
      name: this.generatedName || this.nameInput.value.trim() || `${id} → ${this.postCallSel.value}`,
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
    this.saved = this.saved.filter((s) => !(s.kind === spec.kind && s.callId === spec.callId && s.setupIdx === spec.setupIdx && s.name === spec.name));
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
      const kind = s.kind === 'fix' ? 'fix' : s.kind === 'create' ? 'create' : 'instance';
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
    this.instExportBtn.addEventListener('click', () => this.doExport());
    this.moveDancerSel.addEventListener('change', () => {
      this.moveDancer = parseInt(this.moveDancerSel.value, 10) || 0;
      this.moveIndex = 0;
      this.renderInstance();
    });
    // There is no "Move" dropdown any more: the strip IS the picker, and `selectMove` both
    // re-draws it and re-derives the track highlight.
    this.moveAddBtn.addEventListener('click', () => this.addInstanceMove());
    this.moveDelBtn.addEventListener('click', () => this.deleteInstanceMove());
  }

  setActive(a: boolean) {
    this.active = a;
    this.setHudWide();
    if (a) {
      this.renderSaved();
      this.renderInstance();
    } else {
      // The editor is off screen: give every dancer's track back.
      this.host.focusTrail(null, null);
    }
  }
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Backwards-compatible factory (used by main.ts). */
export function initEditor(stage: Stage, host: EditorHost): EditorUI {
  return new EditorController(stage, host);
}
