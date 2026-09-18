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
import type { CallEdit } from './data';
import type { Stage } from './scene';

export interface EditorUI {
  setActive(a: boolean): void;
}

// Warning threshold for a "large" closure correction.
const HEADING_WARN = 0.35; // rad (~20deg)
const POS_WARN = 2.0; // units

const HANDS: Hands[] = ['none', 'left', 'right', 'both', 'gripleft', 'gripright', 'gripboth'];
const GENDERS: Gender[] = ['boy', 'girl', 'phantom'];

/** Round the way the engine's XML export does, so a value read out of the table and typed
 *  back in is the same number rather than a 15-digit float. */
const show = (n: number): string => (Math.round(n * 1e4) / 1e4).toString();
const toDeg = (rad: number): number => (rad * 180) / Math.PI;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export class EditorController implements EditorUI {
  private stage: Stage;
  private preview: (call: CallBundle) => void;
  private active = false;

  private modeSel = el<HTMLSelectElement>('edMode');
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
  private movePickSel = el<HTMLSelectElement>('edMovePick');
  private moveAddBtn = el<HTMLButtonElement>('edMoveAdd');
  private moveDelBtn = el<HTMLButtonElement>('edMoveDel');
  private moveFieldsEl = el<HTMLDivElement>('edMoveFields');

  private catalog = availableCalls();
  private saved: CallEdit[] = loadEdits();

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

  constructor(stage: Stage, preview: (call: CallBundle) => void) {
    this.stage = stage;
    this.preview = preview;

    for (const c of this.catalog) {
      const label = `${c.level.toUpperCase()} · ${c.title}`;
      this.editCallSel.add(new Option(label, c.id));
      this.postCallSel.add(new Option(label, c.id));
      this.preCallSel.add(new Option(label, c.id));
    }

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

  // ---- loading ----

  private loadEditSetup() {
    const id = this.editCallSel.value;
    const tam = parseInt(this.editSetupSel.value || '0', 10);
    try {
      this.editSetup = loadCall(id, tam, true);
      this.preview(this.staticCall(`edit setup start — ${this.editSetup.title}`, this.callStart(this.editSetup)));
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
      this.preview(this.instance);
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
    this.preview(next);
    this.renderInstance(focusKey);
  }

  private renderInstance(focusKey?: string | null) {
    if (focusKey !== undefined) this.focusKey = focusKey;
    this.renderFormation();
    this.renderMoveSelectors();
    this.renderMoveFields();
    this.renderInstanceInfo();
    if (this.focusKey) {
      const el2 = this.instPanel.querySelector<HTMLElement>(`[data-key="${this.focusKey}"]`);
      el2?.focus();
    }
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
    const moves = dancers[this.moveDancer]?.moves ?? [];
    if (this.moveIndex >= moves.length) this.moveIndex = Math.max(0, moves.length - 1);
    this.movePickSel.innerHTML = '';
    moves.forEach((s, k) => {
      this.movePickSel.add(new Option(`move ${k + 1} · ${show(s.beats)}b · ${s.hands}`, String(k), false, k === this.moveIndex));
    });
    this.moveDelBtn.disabled = moves.length === 0;
  }

  /** The selected move's numbers. `rotate` absent means "face along the travel tangent",
   *  which is the taminations default, so the toggle is behaviour-preserving when it is
   *  switched on: `rotate = translate` gives the same heading `poseFor` falls back to. */
  private renderMoveFields() {
    const host = this.moveFieldsEl;
    host.innerHTML = '';
    const moves = this.currentMoves();
    const seg = moves[this.moveIndex];
    if (!seg) {
      host.innerHTML = '<i class="small">this dancer has no moves</i>';
      return;
    }
    const i = this.moveDancer;
    const k = this.moveIndex;
    // The focus key must be the EDITED FIELD's own `data-key`, or the re-render after a
    // commit has nothing to find and the focus is lost on every spin-button click.
    const write = (patch: Partial<Seg>, field: string) => {
      const call = this.instance;
      if (!call) return;
      this.commit(setMove(call, i, k, { ...seg, ...patch }), `m${i}:${k}:${field}`);
    };

    host.appendChild(this.field(`m${i}:${k}:beats`, 'beats', seg.beats, 0.5, (v) => write({ beats: v }, 'beats')));

    const hands = document.createElement('span');
    hands.className = 'ed-group';
    const hl = document.createElement('label');
    hl.textContent = 'hands';
    const hsel = document.createElement('select');
    hsel.dataset.key = `m${i}:${k}:hands`;
    for (const h of HANDS) hsel.add(new Option(h, h, false, h === seg.hands));
    hsel.addEventListener('change', () => write({ hands: hsel.value as Hands }, 'hands'));
    hands.appendChild(hl);
    hands.appendChild(hsel);
    host.appendChild(hands);

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
      host.appendChild(this.field(`m${i}:${k}:t.${key}`, `t.${label}`, t[key], step, (v) => write({ translate: { ...t, [key]: v } }, `t.${key}`)));
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
    rot.appendChild(rl);
    rot.appendChild(rchk);
    rot.appendChild(rc);
    host.appendChild(rot);

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
        host.appendChild(this.field(`m${i}:${k}:r.${key}`, `r.${label}`, r[key], step, (v) => write({ rotate: { ...r, [key]: v } }, `r.${key}`)));
      }
    }
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
      if (this.instance) this.preview(this.instance);
    } else {
      this.refreshFixInfo();
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
    this.preview(fixed);
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
      this.preview(created);
      this.statusEl.textContent = `✓ created "${name}" (${created.beats} beats)`;
    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  }

  private showTarget() {
    if (!this.postStart) return;
    const name = this.postCallSel.selectedOptions[0]?.textContent ?? this.postCallSel.value;
    this.preview(this.staticCall(`post start — ${name}`, this.postStart));
  }
  private showEnd() {
    if (!this.editSetup) return;
    const name = this.editCallSel.selectedOptions[0]?.textContent ?? this.editCallSel.value;
    this.preview(this.staticCall(`edit end — ${name}`, this.callEnd(this.editSetup)));
  }
  private showStart() {
    if (!this.preEnd) return;
    const name = this.preCallSel.selectedOptions[0]?.textContent ?? this.preCallSel.value;
    this.preview(this.staticCall(`pre end — ${name}`, this.preEnd));
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
          this.preview(rebuildEdit(s));
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
    this.movePickSel.addEventListener('change', () => {
      this.moveIndex = parseInt(this.movePickSel.value, 10) || 0;
      this.renderMoveFields();
    });
    this.moveAddBtn.addEventListener('click', () => this.addInstanceMove());
    this.moveDelBtn.addEventListener('click', () => this.deleteInstanceMove());
  }

  setActive(a: boolean) {
    this.active = a;
    this.setHudWide();
    if (a) {
      this.renderSaved();
      this.renderInstance();
    }
  }
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Backwards-compatible factory (used by main.ts). */
export function initEditor(stage: Stage, preview: (call: CallBundle) => void): EditorUI {
  return new EditorController(stage, preview);
}
