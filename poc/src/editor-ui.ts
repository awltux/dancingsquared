// Call editor UI controller: two features.
//   1. FIX CLOSURE — correct an existing call setup so it ends at the start
//      position of a chosen POST call setup.
//   2. CREATE POSITION — synthesize a NEW position for a call from the END of a
//      PRE call setup to the START of a POST call setup, through the edit call's
//      core setup.
// Encapsulates the editor's state + DOM wiring behind a class.

import {
  alignFormationToCore,
  synthesizeSetup,
  correctEndTo,
  callToXml,
  poseFor,
  endPoses,
  rigidFit,
} from 'dancing-squared-engine';
import type { CallBundle, FormDancer, Gender, Hands } from 'dancing-squared-engine';

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

export class EditorController implements EditorUI {
  private stage: Stage;
  private preview: (call: CallBundle) => void;

  private modeSel = el<HTMLSelectElement>('edMode');
  private editCallSel = el<HTMLSelectElement>('edCall');
  private editSetupSel = el<HTMLSelectElement>('edSetup');
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

  private catalog = availableCalls();
  private saved: CallEdit[] = loadEdits();

  // current state
  private editSetup: CallBundle | null = null;
  private postStart: FormDancer[] | null = null;
  private preEnd: FormDancer[] | null = null;
  private generated: CallBundle | null = null;
  private generatedName = '';

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
    return { title: name, from: name, parts: '', taminator: '', dancers, beats: 1, leadin: 0, leadout: 0, totalBeats: 1 };
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
      (maxHead > 0.1 ? `, headings up to ${(maxHead * 180 / Math.PI).toFixed(0)}° apart` : '');
  }

  private applyMode() {
    const create = this.modeSel.value === 'create';
    this.fixPanel.hidden = create;
    this.createPanel.hidden = !create;
    this.renderSaved();
    this.refreshFixInfo();
  }

  // ---- actions ----

  private doFix() {
    if (!this.editSetup || !this.postStart) {
      this.statusEl.textContent = 'pick an edit call+setup and a post call+setup';
      return;
    }
    const { posErr, maxHead } = this.fixDiscrepancy();
    if (posErr > POS_WARN || maxHead > HEADING_WARN) {
      const size = `heading ${(maxHead * 180 / Math.PI).toFixed(0)}°, pos ${posErr.toFixed(1)}`;
      if (!window.confirm(`Correction is large (${size}) — this may not be a simple closure misalignment. Proceed?`)) return;
    }
    const target = this.alignToSetup(this.editSetup, this.postStart);
    const fixed = correctEndTo(this.editSetup, target);
    this.generated = fixed;
    this.generatedName = `${this.editSetup.title} (fixed)`;
    this.preview(fixed);
    this.fixInfoEl.textContent =
      `corrected: end formation now ${posErr.toFixed(2)} apart from post-call start` +
      (maxHead > 0.1 ? `, headings ${(maxHead * 180 / Math.PI).toFixed(0)}° apart` : '');
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

  // ---- save / export ----

  private currentSpec(): CallEdit | null {
    const id = this.editCallSel.value;
    if (!id) return null;
    const isCreate = this.modeSel.value === 'create';
    const base: CallEdit = {
      kind: isCreate ? 'create' : 'fix',
      callId: id,
      setupIdx: parseInt(this.editSetupSel.value || '0', 10),
      postCallId: this.postCallSel.value,
      postSetupIdx: parseInt(this.postSetupSel.value || '0', 10),
      name: this.generatedName || this.nameInput.value.trim() || `${id} → ${this.postCallSel.value}`,
      padBeats: isCreate ? (parseFloat(this.padInput.value) || 2) : 1,
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

  private doExport() {
    try {
      const call = this.generated ?? (() => {
        const spec = this.currentSpec();
        if (!spec) return null;
        return rebuildEdit(spec);
      })();
      if (!call) {
        this.statusEl.textContent = 'nothing to export yet';
        return;
      }
      const xml = callToXml(call, this.generatedName || call.from || call.title);
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
      label.textContent = `${s.kind === 'fix' ? 'fix' : 'create'} · ${s.name}${s.applied ? ' ✔' : ''}`;
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
    });
    this.editSetupSel.addEventListener('change', () => this.loadEditSetup());
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
  }

  setActive(a: boolean) {
    if (a) this.renderSaved();
  }
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Backwards-compatible factory (used by main.ts). */
export function initEditor(stage: Stage, preview: (call: CallBundle) => void): EditorUI {
  return new EditorController(stage, preview);
}
