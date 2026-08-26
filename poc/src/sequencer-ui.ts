// Sequencer UI: build/validate a call sequence on the 3D board. Reuses the
// stage + DancerView from scene.ts and the Sequencer engine.

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

export function initSequencer(stage: Stage): SequencerUI {
  const levelSelect = document.getElementById('seqLevel') as HTMLSelectElement;
  const marginInput = document.getElementById('seqMargin') as HTMLInputElement;
  const callSelect = document.getElementById('seqCallSelect') as HTMLSelectElement;
  const applyBtn = document.getElementById('seqApply') as HTMLButtonElement;
  const undoBtn = document.getElementById('seqUndo') as HTMLButtonElement;
  const resetBtn = document.getElementById('seqReset') as HTMLButtonElement;
  const getoutBtn = document.getElementById('seqGetout') as HTMLButtonElement;
  const matrixGetoutBtn = document.getElementById('seqMatrixGetout') as HTMLButtonElement;
  const applyGetoutBtn = document.getElementById('seqApplyGetout') as HTMLButtonElement;
  const getinBtn = document.getElementById('seqGetin') as HTMLButtonElement;
  const fixBtn = document.getElementById('seqFixIt') as HTMLButtonElement;
  const statusEl = document.getElementById('seqStatus') as HTMLSpanElement;
  const matrixInfoEl = document.getElementById('seqMatrixInfo') as HTMLDivElement;
  const seqListEl = document.getElementById('seqSequence') as HTMLDivElement;
  const fasrEl = document.getElementById('seqFasr') as HTMLDivElement;
  const fixListEl = document.getElementById('seqFixList') as HTMLDivElement;
  const moduleNameInput = document.getElementById('seqModuleName') as HTMLInputElement;
  const saveModuleBtn = document.getElementById('seqSaveModule') as HTMLButtonElement;
  const modulesEl = document.getElementById('seqModules') as HTMLDivElement;
  const playBtn = document.getElementById('seqPlay') as HTMLButtonElement;
  const scrub = document.getElementById('seqScrub') as HTMLInputElement;
  const beatInput = document.getElementById('seqBeatInput') as HTMLInputElement;
  const copyPosBtn = document.getElementById('seqCopyPos') as HTMLButtonElement;
  const beatEl = document.getElementById('seqBeat') as HTMLSpanElement;

  const STORAGE_KEY = 'dsModules';
  const MS_PER_BEAT = 500;

  let seq = new Sequencer(movesXmlText, formationsXmlText, sequencerCallsUpTo('ms'));

  let views: DancerView[] = [];
  const connectors = buildHandConnectors(stage.scene);
  const history: string[] = [];
  let active = false;
  let playing = false;
  let playhead = 0; // beats
  let totalBeats = 0;
  let flat: string[] = [];
  let lastFrame = performance.now();
  // Key of the call whose floor trace is currently drawn; avoids rebuilding the
  // trail geometry every frame (only when the playing call changes).
  let lastTraceKey = '';

  // ---- user-defined modules ----
  const modules: Module[] = loadModules();
  function loadModules(): Module[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function persistModules() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modules));
  }
  function refreshModulesList() {
    modulesEl.innerHTML = modules.length
      ? modules.map((m) => `<b>${m.name}:</b> ${m.calls.join(' · ')}`).join('<br>')
      : '<i>(no modules saved yet)</i>';
  }
  // Restore persisted modules.
  for (const m of modules) seq.registerModule(m.name, m.calls);
  refreshModulesList();

  // ---- level selection: restricts the calls available to the sequence ----
  for (const lv of availableLevels()) levelSelect.add(new Option(lv.toUpperCase(), lv));
  levelSelect.value = 'ms';
  function applyMargin() {
    seq.setMatchMargin(parseFloat(marginInput.value) || 0);
    refreshCallSelect();
  }
  function rebuildSeq() {
    seq = new Sequencer(movesXmlText, formationsXmlText, sequencerCallsUpTo(levelSelect.value));
    for (const m of modules) seq.registerModule(m.name, m.calls);
    history.length = 0;
    playing = false;
    playhead = 0;
    totalBeats = 0;
    flat = [];
    playBtn.textContent = '▶ Play';
    for (const v of views) {
      stage.scene.remove(v.group);
      stage.scene.remove(v.trail);
    }
    views = [];
    lastTraceKey = '';
    seq.setMatchMargin(parseFloat(marginInput.value) || 0);
    statusEl.textContent = `level ${levelSelect.value.toUpperCase()} loaded`;
    refreshCallSelect();
    syncAnimation();
    render();
  }
  levelSelect.addEventListener('change', rebuildSeq);
  marginInput.addEventListener('input', applyMargin);
  // Apply the initial margin to the starting sequencer.
  seq.setMatchMargin(parseFloat(marginInput.value) || 0);

  // The call picker shows ONLY calls (and modules) that are legal from the
  // current board. Refresh it whenever the board changes.
  function refreshCallSelect() {
    const prev = callSelect.value;
    const legal = seq.legalNext().sort((a, b) => a.localeCompare(b));
    const modules = legal.filter((n) => seq.isModule(n));
    const calls = legal.filter((n) => !seq.isModule(n));
    callSelect.innerHTML = '';
    callSelect.add(new Option('— valid next call —', ''));
    const group = (label: string, names: string[]) => {
      if (!names.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const n of names) og.appendChild(new Option(n, n));
      callSelect.appendChild(og);
    };
    group('Calls', calls);
    group('Modules', modules);
    if (prev && legal.includes(prev)) callSelect.value = prev;
  }
  refreshCallSelect();
  syncAnimation();

  saveModuleBtn.addEventListener('click', () => {
    const name = moduleNameInput.value.trim();
    if (!name) {
      statusEl.textContent = 'Enter a module name first';
      return;
    }
    if (history.length === 0) {
      statusEl.textContent = 'Nothing to save — add calls first';
      return;
    }
    seq.registerModule(name, [...history]);
    modules.push({ name, calls: [...history] });
    persistModules();
    refreshModulesList();
    refreshCallSelect();
    statusEl.textContent = `Saved module "${name}"`;
    moduleNameInput.value = '';
  });

  function rebuildViews() {
    for (const v of views) {
      stage.scene.remove(v.group);
      stage.scene.remove(v.trail);
    }
    views = seq.board.dancers.map((d) => new DancerView({ gender: d.gender, x: 0, y: 0, angleDeg: 0, path: [] }, d.couple));
    for (const v of views) {
      v.group.visible = active;
      stage.scene.add(v.group);
      stage.scene.add(v.trail);
      v.trail.visible = active;
    }
    lastTraceKey = '';
  }

  function renderBoard(board: Board, walk?: WalkCycle) {
    if (views.length !== board.dancers.length) rebuildViews();

    const poses: Pose[] = board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, hands: 'both' }));
    const holds = computeHandholds(poses, 'static');

    const targets: { left?: THREE.Vector3; right?: THREE.Vector3 }[] = poses.map(() => ({}));
    const lines: [number, number][] = [];
    for (const h of holds) {
      const mx = (poses[h.i].x + poses[h.j].x) / 2;
      const my = (poses[h.i].y + poses[h.j].y) / 2;
      const hold = new THREE.Vector3(mx, 1.0, -my); // z = -y matches scene mapping
      if (h.hi === 'left') targets[h.i].left = hold.clone();
      else targets[h.i].right = hold.clone();
      if (h.hj === 'left') targets[h.j].left = hold.clone();
      else targets[h.j].right = hold.clone();
      lines.push([h.i, h.j]);
    }
    views.forEach((v, i) => v.update(poses[i], targets[i], walk));
    connectors.set(lines, poses);
    connectors.group.visible = active;
    for (const v of views) v.group.visible = active;
  }

  function render() {
    if (!active) return;
    renderBoard(seq.board);
    updateReadout();
  }

  // ---- sequence animation ----
  function syncAnimation() {
    flat = seq.flatten(history);
    totalBeats = seq.sequenceBeats(flat);
    playhead = totalBeats; // show the current (end) state
    scrub.max = String(Math.max(1, totalBeats));
    scrub.value = String(playhead);
    updateBeatLabel();
  }

  function updateBeatLabel() {
    beatEl.textContent = `${playhead.toFixed(1)} / ${totalBeats.toFixed(1)} b`;
    if (beatInput) beatInput.value = String(Math.round(playhead * 2) / 2);
  }

  function renderPlayhead() {
    if (!active) return;
    const res = seq.evaluateSequence(flat, playhead);
    // Drive the walk phase with the playhead beat (a step lands each beat);
    // whether each dancer actually steps is decided inside DancerView from its
    // own motion, so stopped dancers settle to rest.
    const walkPhase = ((playhead + 1000) % 2) / 2;
    renderBoard(res.board, { phase: walkPhase });
    if (res.beats > 0) render(); // past the end -> final state
    updateCurrentTrace();
  }

  // Draw the floor trace of the CURRENTLY-playing call only: each dancer gets a
  // trail of its path through this call's canonical motion (matched variant). It
  // is rebuilt only when the playing call changes, so it doesn't flicker while a
  // single call plays, and switches cleanly when the next call starts.
  function updateCurrentTrace() {
    if (!active || views.length === 0) return;
    const info = seq.sequenceInfo(flat, playhead);
    const key = info && views.length === info.variant.dancers.length ? `${info.name}:${info.mapping.join(',')}` : '';
    if (key === lastTraceKey) return;
    lastTraceKey = key;
    if (info) {
      views.forEach((v, i) => {
        v.setTrail(sampleTrail(info.variant.dancers[info.mapping[i]], 80));
        v.trail.visible = active;
      });
    } else {
      for (const v of views) v.trail.visible = false;
    }
  }

  function frame() {
    if (active && totalBeats > 0) {
      const now = performance.now();
      const dt = now - lastFrame;
      lastFrame = now;
      if (playing) {
        playhead += dt / MS_PER_BEAT;
        if (playhead >= totalBeats) {
          playhead = totalBeats;
          playing = false;
          playBtn.textContent = '▶ Play';
        }
      }
      // Always re-render the current playhead frame while the panel is active.
      // DancerView eases its walk stride to rest off its own measured motion,
      // so once playback ends or is paused the legs settle instead of freezing
      // (or continuing to walk) mid-stride.
      renderPlayhead();
      scrub.value = String(playhead);
      updateBeatLabel();
    }
    requestAnimationFrame(frame);
  }

  playBtn.addEventListener('click', () => {
    if (totalBeats <= 0) return;
    if (playhead >= totalBeats) playhead = 0;
    playing = !playing;
    lastFrame = performance.now();
    playBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
  });
  scrub.addEventListener('input', () => {
    playhead = parseFloat(scrub.value);
    renderPlayhead();
    updateBeatLabel();
  });

  // Set the playback beat from a typed value (pauses playback so the user can
  // inspect a specific frame).
  beatInput.addEventListener('change', () => {
    const v = parseFloat(beatInput.value);
    if (isNaN(v)) return;
    playing = false;
    playBtn.textContent = '▶ Play';
    playhead = Math.max(0, Math.min(totalBeats, v));
    scrub.value = String(playhead);
    renderPlayhead();
    updateBeatLabel();
  });

  // Copy the current dancer positions to the clipboard as JSON (for debug reports).
  copyPosBtn.addEventListener('click', () => {
    const board = seq.evaluateSequence(flat, playhead).board;
    const fasr = seq.fasr();
    const rel = fasr.relationship;
    const payload = {
      playhead,
      totalBeats,
      sequence: history,
      formation: fasr.formation,
      arrangement: fasr.arrangement,
      sequenceParity: fasr.sequence,
      dancers: board.dancers.map((d) => ({
        id: d.id,
        couple: d.couple,
        group: d.couple <= 2 ? 'heads' : 'sides',
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
      () => { statusEl.textContent = '✓ dancer positions copied (JSON)'; },
      () => { statusEl.textContent = '✗ clipboard unavailable — positions are in the console'; console.log(text); },
    );
  });

  let lastReadout = '';
  function updateReadout() {
    const fasr = seq.fasr();
    const rel = fasr.relationship[1]
      ? ` · dancer1: partner=${fasr.relationship[1].partner ?? '?'} corner=${fasr.relationship[1].corner ?? '?'}`
      : '';
    const fasrText =
      `Formation: <b>${fasr.formation ?? '?'}</b> · ${fasr.arrangement}<br>` +
      `Sequence: <b>${fasr.sequence}</b>${rel}`;
    const listText = history.length
      ? history.map((c, i) => `<span class="seq-call" data-idx="${i}">${i + 1}. ${c}</span>`).join('<br>')
      : '<i>(no calls yet)</i>';
    const key = fasrText + '\u0000' + listText;
    if (key === lastReadout) return; // avoid DOM churn when re-rendering every frame
    lastReadout = key;
    fasrEl.innerHTML = fasrText;
    seqListEl.innerHTML = listText;
  }

  function applySelected() {
    const name = callSelect.value;
    if (!name) return;
    const step = seq.apply(name);
    if (!step.legal) {
      statusEl.textContent = `✗ ${name}${step.reason ? ` — ${step.reason}` : ''}`;
      return;
    }
    // A module is just a named group of calls: record its constituent calls in
    // the sequence so the choreography is visible (and undoable) call-by-call.
    const expanded = seq.flatten([name]);
    history.push(...expanded);
    statusEl.textContent = `✓ ${name}${expanded.length > 1 ? ` (${expanded.length} calls)` : ''}`;
    render();
    refreshCallSelect();
    syncAnimation();
  }

  function undo() {
    if (history.length === 0) return;
    history.pop();
    seq.reset();
    for (const name of history) seq.apply(name);
    statusEl.textContent = '';
    render();
    refreshCallSelect();
    syncAnimation();
  }

  // Jump the board to a call's START formation: reset and replay every call
  // before the given index, leaving the clicked call un-applied, and drop the
  // calls after it so the sequence/board/playhead stay consistent.
  function seekTo(idx: number) {
    if (idx < 0 || idx >= history.length) return;
    playing = false;
    playBtn.textContent = '▶ Play';
    history.length = idx; // truncate: the clicked call is the next to apply
    seq.reset();
    for (const name of history) seq.apply(name);
    statusEl.textContent = '';
    lastTraceKey = '';
    render();
    refreshCallSelect();
    syncAnimation();
  }

  function reset() {
    history.length = 0;
    seq.reset();
    statusEl.textContent = '';
    render();
    refreshCallSelect();
    syncAnimation();
  }

  function showGetout() {
    const path = seq.getout({ target: 'Static Square', maxCalls: 5 });
    statusEl.textContent = path ? `getout: ${path.join(' > ')}` : 'no getout found (≤5 calls)';
    updateMatrixInfo();
  }

  // Show the matrix-driven diagnostics: whether a rigid self-inverse single-call
  // getout exists (O(1) matrix fast-path), and the board's matrix closeness to
  // home (higher = closer). This surfaces the matrix model's role in the search.
  function updateMatrixInfo() {
    const rigid = seq.matrixGetout();
    const closeness = seq.closenessToHome();
    const parts = [
      `closeness-to-home: <b>${closeness.toFixed(2)}</b>`,
      `matrix rigid getout: <b>${rigid ? rigid.join(' > ') : '—'}</b>`,
    ];
    matrixInfoEl.innerHTML = parts.join(' · ');
  }

  function showMatrixGetout() {
    const rigid = seq.matrixGetout();
    statusEl.textContent = rigid
      ? `matrix getout (rigid, self-inverse): ${rigid.join(' > ')}`
      : 'no rigid single-call matrix getout (falls back to search)';
    updateMatrixInfo();
  }

  function showGetin() {
    // A getin takes the set from home INTO a formation; from the current board we
    // target its recognized formation so we can see how to get back in.
    const target = seq.recognize(seq.board).name ?? 'Static Square';
    const gi = seq.getin({ target, maxCalls: 5, budget: 400 });
    statusEl.textContent = gi
      ? `getin → ${target}: ${gi.join(' > ')}`
      : `no getin found → ${target} (≤5 calls)`;
  }

  // Apply the current getout: run each call of the found path onto the board,
  // recording (and expanding) them in the sequence.
  function applyGetout() {
    const path = seq.getout({ target: 'Static Square', maxCalls: 5 });
    if (!path || path.length === 0) {
      statusEl.textContent = 'no getout found (≤5 calls)';
      return;
    }
    for (const name of path) {
      const step = seq.apply(name);
      if (!step.legal) {
        statusEl.textContent = `✗ getout failed at "${name}"`;
        return;
      }
      history.push(...seq.flatten([name]));
    }
    statusEl.textContent = `✓ applied getout: ${path.join(' > ')}`;
    render();
    refreshCallSelect();
    syncAnimation();
    updateMatrixInfo();
  }

  function showFixIt() {
    const fixes = seq.fixIt({ target: 'Static Square', depth: 3 });
    fixListEl.innerHTML = fixes.length
      ? `keep a getout: <b>${fixes.join(', ')}</b>`
      : 'no fix-it move keeps a getout alive';
  }

  applyBtn.addEventListener('click', applySelected);
  callSelect.addEventListener('change', () => (statusEl.textContent = ''));
  undoBtn.addEventListener('click', undo);
  resetBtn.addEventListener('click', reset);
  getoutBtn.addEventListener('click', showGetout);
  matrixGetoutBtn.addEventListener('click', showMatrixGetout);
  applyGetoutBtn.addEventListener('click', applyGetout);
  getinBtn.addEventListener('click', showGetin);
  fixBtn.addEventListener('click', showFixIt);
  // Click a call in the sequence list to seek the board to that call's start.
  seqListEl.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('.seq-call') as HTMLElement | null;
    if (t && t.dataset.idx != null) seekTo(Number(t.dataset.idx));
  });

  // Start the animation frame loop.
  requestAnimationFrame(frame);

  return {
    setActive(a: boolean) {
      active = a;
      playing = false;
      playBtn.textContent = '▶ Play';
      connectors.group.visible = active;
      for (const v of views) {
        v.group.visible = active;
        v.trail.visible = active;
      }
      if (active) {
        if (views.length !== seq.board.dancers.length) rebuildViews();
        syncAnimation();
        render();
        updateCurrentTrace();
      }
    },
    render,
  };
}
