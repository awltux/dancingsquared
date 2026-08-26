// Sequencer UI controller: build/validate a call sequence on the 3D board.
// Encapsulates the sequence panel's state (the board, playhead, history,
// modules) and DOM wiring behind a class, so the animation/apply/undo logic no
// longer lives in one large closure.

import * as THREE from 'three';

import { Sequencer, computeHandholds, sampleTrail } from 'dancing-squared-engine';
import type { Board, Module, Pose } from 'dancing-squared-engine';
import { movesXmlText, formationsXmlText, availableLevels, sequencerCallsUpTo } from './data';
import { DancerView, buildHandConnectors } from './scene';
import type { Stage, WalkCycle } from './scene';

export interface SequencerUI {
  setActive(active: boolean): void;
  render(): void;
}

const STORAGE_KEY = 'dsModules';
const MS_PER_BEAT = 500;

export class SequencerController implements SequencerUI {
  private stage: Stage;

  // DOM elements.
  private levelSelect = el<HTMLSelectElement>('seqLevel');
  private marginInput = el<HTMLInputElement>('seqMargin');
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
  private matrixInfoEl = el<HTMLDivElement>('seqMatrixInfo');
  private seqListEl = el<HTMLDivElement>('seqSequence');
  private fasrEl = el<HTMLDivElement>('seqFasr');
  private fixListEl = el<HTMLDivElement>('seqFixList');
  private moduleNameInput = el<HTMLInputElement>('seqModuleName');
  private saveModuleBtn = el<HTMLButtonElement>('seqSaveModule');
  private modulesEl = el<HTMLDivElement>('seqModules');
  private playBtn = el<HTMLButtonElement>('seqPlay');
  private scrub = el<HTMLInputElement>('seqScrub');
  private beatInput = el<HTMLInputElement>('seqBeatInput');
  private copyPosBtn = el<HTMLButtonElement>('seqCopyPos');
  private beatEl = el<HTMLSpanElement>('seqBeat');

  // State.
  private seq: Sequencer;
  private views: DancerView[] = [];
  private connectors: ReturnType<typeof buildHandConnectors>;
  private history: string[] = [];
  private modules: Module[] = [];
  private active = false;
  private playing = false;
  private playhead = 0;
  private totalBeats = 0;
  private flat: string[] = [];
  private lastFrame = performance.now();
  private lastTraceKey = '';
  private lastReadout = '';

  constructor(stage: Stage) {
    this.stage = stage;
    this.connectors = buildHandConnectors(stage.scene);
    this.seq = new Sequencer(movesXmlText, formationsXmlText, sequencerCallsUpTo('ms'));
    this.loadModules();
    this.refreshModulesList();
    this.restoreModules();

    for (const lv of availableLevels()) this.levelSelect.add(new Option(lv.toUpperCase(), lv));
    this.levelSelect.value = 'ms';
    this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);

    this.wireEvents();
    this.refreshCallSelect();
    this.requestFrame();
  }

  private loadModules() {
    try {
      this.modules = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Module[];
    } catch {
      this.modules = [];
    }
  }
  private persistModules() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.modules));
  }
  private restoreModules() {
    for (const m of this.modules) this.seq.registerModule(m.name, m.calls);
  }
  private refreshModulesList() {
    this.modulesEl.innerHTML = this.modules.length
      ? this.modules.map((m) => `<b>${m.name}:</b> ${m.calls.join(' · ')}`).join('<br>')
      : '<i>(no modules saved yet)</i>';
  }

  private applyMargin() {
    this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);
    this.refreshCallSelect();
  }

  private rebuildSeq() {
    this.seq = new Sequencer(movesXmlText, formationsXmlText, sequencerCallsUpTo(this.levelSelect.value));
    for (const m of this.modules) this.seq.registerModule(m.name, m.calls);
    this.history.length = 0;
    this.playing = false;
    this.playhead = 0;
    this.totalBeats = 0;
    this.flat = [];
    this.playBtn.textContent = '▶ Play';
    for (const v of this.views) {
      this.stage.scene.remove(v.group);
      this.stage.scene.remove(v.trail);
    }
    this.views = [];
    this.lastTraceKey = '';
    this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);
    this.statusEl.textContent = `level ${this.levelSelect.value.toUpperCase()} loaded`;
    this.syncAnimation();
    this.refreshCallSelect();
    this.render();
  }

  /** The call picker shows ONLY calls (and modules) legal from the current board. */
  private refreshCallSelect() {
    const prev = this.callSelect.value;
    const legal = this.seq.legalNext().sort((a, b) => a.localeCompare(b));
    const modules = legal.filter((n) => this.seq.isModule(n));
    const calls = legal.filter((n) => !this.seq.isModule(n));
    this.callSelect.innerHTML = '';
    this.callSelect.add(new Option('— valid next call —', ''));
    const group = (label: string, names: string[]) => {
      if (!names.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const n of names) og.appendChild(new Option(n, n));
      this.callSelect.appendChild(og);
    };
    group('Calls', calls);
    group('Modules', modules);
    if (prev && legal.includes(prev)) this.callSelect.value = prev;
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

  private rebuildViews() {
    for (const v of this.views) {
      this.stage.scene.remove(v.group);
      this.stage.scene.remove(v.trail);
    }
    this.views = this.seq.board.dancers.map((d) => new DancerView({ gender: d.gender, x: 0, y: 0, angleDeg: 0, path: [] }, d.couple));
    for (const v of this.views) {
      v.group.visible = this.active;
      this.stage.scene.add(v.group);
      this.stage.scene.add(v.trail);
      v.trail.visible = this.active;
    }
    this.lastTraceKey = '';
  }

  private renderBoard(board: Board, walk?: WalkCycle) {
    if (this.views.length !== board.dancers.length) this.rebuildViews();

    const poses: Pose[] = board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, hands: 'both' }));
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
    this.connectors.group.visible = this.active;
    for (const v of this.views) v.group.visible = this.active;
  }

  render() {
    if (!this.active) return;
    this.renderBoard(this.seq.board);
    this.updateReadout();
  }

  private syncAnimation() {
    this.flat = this.seq.flatten(this.history);
    this.totalBeats = this.seq.sequenceBeats(this.flat);
    this.playhead = this.totalBeats;
    this.scrub.max = String(Math.max(1, this.totalBeats));
    this.scrub.value = String(this.playhead);
    this.updateBeatLabel();
  }

  private updateBeatLabel() {
    this.beatEl.textContent = `${this.playhead.toFixed(1)} / ${this.totalBeats.toFixed(1)} b`;
    if (this.beatInput) this.beatInput.value = String(Math.round(this.playhead * 2) / 2);
  }

  private renderPlayhead() {
    if (!this.active) return;
    const res = this.seq.evaluateSequence(this.flat, this.playhead);
    const walkPhase = ((this.playhead + 1000) % 2) / 2;
    this.renderBoard(res.board, { phase: walkPhase });
    if (res.beats > 0) this.render();
    this.updateCurrentTrace();
  }

  private updateCurrentTrace() {
    if (!this.active || this.views.length === 0) return;
    const info = this.seq.sequenceInfo(this.flat, this.playhead);
    const key = info && this.views.length === info.variant.dancers.length ? `${info.name}:${info.mapping.join(',')}` : '';
    if (key === this.lastTraceKey) return;
    this.lastTraceKey = key;
    if (info) {
      this.views.forEach((v, i) => {
        v.setTrail(sampleTrail(info.variant.dancers[info.mapping[i]], 80));
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
  }

  private onScrub() {
    this.playhead = parseFloat(this.scrub.value);
    this.renderPlayhead();
    this.updateBeatLabel();
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
    const board = this.seq.evaluateSequence(this.flat, this.playhead).board;
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
    const fasrText =
      `Formation: <b>${fasr.formation ?? '?'}</b> · ${fasr.arrangement}<br>` +
      `Sequence: <b>${fasr.sequence}</b>${rel}`;
    const listText = this.history.length
      ? this.history.map((c, i) => `<span class="seq-call" data-idx="${i}">${i + 1}. ${c}</span>`).join('<br>')
      : '<i>(no calls yet)</i>';
    const key = fasrText + '\u0000' + listText;
    if (key === this.lastReadout) return;
    this.lastReadout = key;
    this.fasrEl.innerHTML = fasrText;
    this.seqListEl.innerHTML = listText;
  }

  private applySelected() {
    const name = this.callSelect.value;
    if (!name) return;
    const step = this.seq.apply(name);
    if (!step.legal) {
      this.statusEl.textContent = `✗ ${name}${step.reason ? ` — ${step.reason}` : ''}`;
      return;
    }
    const expanded = this.seq.flatten([name]);
    this.history.push(...expanded);
    this.statusEl.textContent = `✓ ${name}${expanded.length > 1 ? ` (${expanded.length} calls)` : ''}`;
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
  }

  private undo() {
    if (this.history.length === 0) return;
    this.history.pop();
    this.seq.reset();
    for (const name of this.history) this.seq.apply(name);
    this.statusEl.textContent = '';
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
  }

  private seekTo(idx: number) {
    if (idx < 0 || idx >= this.history.length) return;
    this.playing = false;
    this.playBtn.textContent = '▶ Play';
    this.history.length = idx;
    this.seq.reset();
    for (const name of this.history) this.seq.apply(name);
    this.statusEl.textContent = '';
    this.lastTraceKey = '';
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
  }

  private reset() {
    this.history.length = 0;
    this.seq.reset();
    this.statusEl.textContent = '';
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
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
    this.callSelect.addEventListener('change', () => (this.statusEl.textContent = ''));
    this.undoBtn.addEventListener('click', () => this.undo());
    this.resetBtn.addEventListener('click', () => this.reset());
    this.getoutBtn.addEventListener('click', () => this.showGetout());
    this.matrixGetoutBtn.addEventListener('click', () => this.showMatrixGetout());
    this.applyGetoutBtn.addEventListener('click', () => this.applyGetout());
    this.getinBtn.addEventListener('click', () => this.showGetin());
    this.fixBtn.addEventListener('click', () => this.showFixIt());
    this.saveModuleBtn.addEventListener('click', () => this.saveModule());
    this.levelSelect.addEventListener('change', () => this.rebuildSeq());
    this.marginInput.addEventListener('input', () => this.applyMargin());
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.scrub.addEventListener('input', () => this.onScrub());
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
    this.connectors.group.visible = this.active;
    for (const v of this.views) {
      v.group.visible = this.active;
      v.trail.visible = this.active;
    }
    if (this.active) {
      if (this.views.length !== this.seq.board.dancers.length) this.rebuildViews();
      this.syncAnimation();
      this.render();
      this.updateCurrentTrace();
    }
  }
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Backwards-compatible factory (used by main.ts). */
export function initSequencer(stage: Stage): SequencerUI {
  return new SequencerController(stage);
}
