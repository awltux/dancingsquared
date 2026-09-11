// Sequencer UI controller: build/validate a call sequence on the 3D board.
// Encapsulates the sequence panel's state (the board, playhead, history,
// modules) and DOM wiring behind a class, so the animation/apply/undo logic no
// longer lives in one large closure.

import * as THREE from 'three';

import { Sequencer, computeHandholds, sampleTrail, splitSelection, parseAll8Figures, formatAll8Figures } from 'dancing-squared-engine';
import type { Board, CallStep, Module, Pose } from 'dancing-squared-engine';
import { movesXmlText, formationsXmlText, availableLevels, sequencerCallsUpTo } from './data';
import { validCederModules } from './ceder-modules';
import { DancerView, buildHandConnectors, buildFlatMarker } from './scene';
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
  private history: (string | CallStep)[] = [];
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
  private flat: (string | CallStep)[] = [];
  /** The board the current sequence replays from. Undefined means the home
   * squared set; it is set to the board when a formation is jumped to with
   * "Set", so playback, trails and copy agree with the live board. */
  private startBoard: Board | undefined;
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
    this.registerCederModules();

    for (const lv of availableLevels()) this.levelSelect.add(new Option(lv.toUpperCase(), lv));
    this.levelSelect.value = 'ms';
    this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);

    this.wireEvents();
    this.populateFormations();
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

  /** Jump the board into the chosen formation and clear the current sequence. */
  private setBoardFormation() {
    const name = this.formationSelect.value;
    if (!name) return;
    if (!this.seq.setFormation(name)) {
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
    const groups = this.seq.subsetGroups(this.seq.board);
    this.subsetInfoEl.innerHTML = groups.length
      ? `Subsets present: <b>${groups.join(' · ')}</b> — their calls are grouped under each selector below.`
      : 'No dancer subsets resolve on this board (whole-board calls only).';
  }

  private loadModules() {
    try {
      this.modules = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Module[];
    } catch {
      this.modules = [];
    }
  }
  /** Register the ceder-translated corpus modules that are fully replayable. */
  private registerCederModules() {
    for (const m of validCederModules()) this.seq.registerModule(m.name, m.steps);
  }
  private persistModules() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.modules));
  }
  private restoreModules() {
    for (const m of this.modules) this.seq.registerModule(m.name, m.calls);
  }
  private refreshModulesList() {
    this.modulesEl.innerHTML = this.modules.length
      ? this.modules.map((m) => `<b>${m.name}:</b> ${m.calls.map(stepLabel).join(' · ')}`).join('<br>')
      : '<i>(no modules saved yet)</i>';
  }

  private applyMargin() {
    this.seq.setMatchMargin(parseFloat(this.marginInput.value) || 0);
    this.refreshCallSelect();
  }

  private rebuildSeq() {
    this.seq = new Sequencer(movesXmlText, formationsXmlText, sequencerCallsUpTo(this.levelSelect.value));
    for (const m of this.modules) this.seq.registerModule(m.name, m.calls);
    this.registerCederModules();
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

  /** The call picker shows ONLY calls (and modules) legal from the current board.
   * Calls that act on a dancer subset are grouped under their selector so they
   * are visually distinct from whole-board calls. */
  private refreshCallSelect() {
    const prev = this.callSelect.value;
    const legal = this.seq.legalNext().sort((a, b) => a.localeCompare(b));
    const modules = legal.filter((n) => this.seq.isModule(n));
    const calls = legal.filter((n) => !this.seq.isModule(n));
    const whole: string[] = [];
    const bySel = new Map<string, string[]>();
    for (const n of calls) {
      const s = splitSelection(n).selection;
      if (s && !['all', 'everybody', 'everyone', 'all 8', 'all 4 couples'].includes(s.toLowerCase())) {
        const arr = bySel.get(s) ?? [];
        arr.push(n);
        bySel.set(s, arr);
      } else {
        whole.push(n);
      }
    }
    this.callSelect.innerHTML = '';
    this.callSelect.add(new Option('— valid next call —', ''));
    const group = (label: string, names: string[]) => {
      if (!names.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const n of names) og.appendChild(new Option(n, n));
      this.callSelect.appendChild(og);
    };
    group('Whole-set calls', whole);
    for (const sel of [...bySel.keys()].sort()) group(`Subset: ${sel}`, bySel.get(sel)!);
    group('Modules', modules);
    if (prev && legal.includes(prev)) this.callSelect.value = prev;
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

  private rebuildViews() {
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
    this.views = this.seq.board.dancers.map((d, i) =>
      new DancerView({ gender: d.gender, x: 0, y: 0, angleDeg: 0, path: [] }, displayCouple(d, i), !!d.isGhost),
    );
    this.markers = this.seq.board.dancers.map((d, i) => buildFlatMarker(d.gender, displayCouple(d, i)));
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
  }

  private renderBoard(board: Board, walk?: WalkCycle) {
    if (this.views.length !== board.dancers.length) this.rebuildViews();

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
    const res = this.seq.evaluateSequence(this.flat, this.playhead, this.startBoard);
    const walkPhase = ((this.playhead + 1000) % 2) / 2;
    this.renderBoard(res.board, { phase: walkPhase });
    if (res.beats > 0) this.render();
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
    const fasrText =
      `Formation: <b>${fasr.formation ?? '?'}</b> · ${fasr.arrangement}<br>` +
      `Sequence: <b>${fasr.sequence}</b>${rel}`;
    const listText = this.history.length
      ? this.history.map((c, i) => `<span class="seq-call" data-idx="${i}">${i + 1}. ${stepLabel(c)}</span>`).join('<br>')
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

  /** Re-establish the board the current sequence BEGAN from, so replaying the
   * history reproduces the live sequence. Falls back to the home square. */
  private rewindToStart() {
    if (this.startBoard) this.seq.setBoard(this.startBoard);
    else this.seq.reset();
  }

  private undo() {
    if (this.history.length === 0) return;
    this.history.pop();
    this.rewindToStart();
    for (const name of this.history) this.seq.applyStep(name);
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
    this.rewindToStart();
    for (const name of this.history) this.seq.applyStep(name);
    this.statusEl.textContent = '';
    this.lastTraceKey = '';
    this.render();
    this.refreshCallSelect();
    this.syncAnimation();
  }

  private reset() {
    this.history.length = 0;
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
    if (fig.setup) parts.push(`setup [${fig.setup}] not applied — Set the formation first`);
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
    const names = this.history.map((c) => (typeof c === 'string' ? c : c.call));
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
    this.callSelect.addEventListener('change', () => (this.statusEl.textContent = ''));
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
      } else {
        this.stage.setView2D(false);
      }
    });
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
    // Keep the camera/view consistent with the current mode.
    this.stage.setView2D(a && this.use2d);
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

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** A step's human-readable call name (a CallStep's `.call`; otherwise the string). */
function stepLabel(step: string | CallStep): string {
  return typeof step === 'string' ? step : step.call;
}

/** Backwards-compatible factory (used by main.ts). */
export function initSequencer(stage: Stage): SequencerUI {
  return new SequencerController(stage);
}
