// Bootstrap: wire the pure engine + Three.js scene + playhead + HUD.

import * as THREE from 'three';

import { allPoses, sampleTrail, computeHandholds, assignHomeIdentity } from 'dancing-squared-engine';
import type { HeadingMode, HoldMode, CallBundle, Pose } from 'dancing-squared-engine';
import { availableCalls, loadCall, loadCatalog } from './data';
import { createStage, DancerView, buildHandConnectors, assignCouples } from './scene';
import { initSequencer } from './sequencer-ui';
import { initEditor } from './editor-ui';

// ---------------------------------------------------------------- loading bar

// Drive the loading bar from real download/parse progress. Download fills the
// first ~70%, parsing the remaining ~30%.
function updateLoading(phase: 'download' | 'parse', frac: number): void {
  const fill = document.getElementById('loadingFill');
  const label = document.getElementById('loadingLabel');
  const pct = phase === 'download' ? frac * 0.7 : 0.7 + frac * 0.3;
  if (fill) fill.style.width = `${Math.round(Math.min(1, Math.max(0, pct)) * 100)}%`;
  if (label) label.textContent = phase === 'download' ? `Downloading data ${Math.round(frac * 100)}%` : 'Initialising';
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = createStage(canvas);

// Load the catalog over the network first; the UI initialisers below need it.
await loadCatalog(updateLoading);

const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
const browseControls = document.getElementById('browseControls') as HTMLDivElement;
const seqPanel = document.getElementById('seqPanel') as HTMLDivElement;
const editorPanel = document.getElementById('editorPanel') as HTMLDivElement;
const seqUi = initSequencer(stage);
const editorUi = initEditor(stage, showCall);

const levelSelect = document.getElementById('levelSelect') as HTMLSelectElement;
const callSelect = document.getElementById('callSelect') as HTMLSelectElement;
const tamSelect = document.getElementById('tamSelect') as HTMLSelectElement;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
const stepBackBtn = document.getElementById('stepBack') as HTMLButtonElement;
const stepFwdBtn = document.getElementById('stepFwd') as HTMLButtonElement;
const speedSelect = document.getElementById('speed') as HTMLSelectElement;
const facingSelect = document.getElementById('facing') as HTMLSelectElement;
const mirrorCheck = document.getElementById('mirror') as HTMLInputElement;
const scrub = document.getElementById('scrub') as HTMLInputElement;
const beatReadout = document.getElementById('beatReadout') as HTMLSpanElement;
const partLabel = document.getElementById('partLabel') as HTMLSpanElement;
const legend = document.getElementById('legend') as HTMLDivElement;

const catalog = availableCalls();

// ---------------------------------------------------------------- build footer

// Show which git commit this build came from, so a reload can be checked against
// the latest version. Populated from build-time constants injected by Vite.
function initBuildFooter(): void {
  const el = document.getElementById('buildFooter');
  if (!el) return;
  const short = __GIT_COMMIT_SHORT__;
  const date = __GIT_COMMIT_DATE__ ? ` · ${new Date(__GIT_COMMIT_DATE__).toISOString().slice(0, 16).replace('T', ' ')}Z` : '';
  const dirty = __GIT_DIRTY__ === 'dirty' ? ' · uncommitted changes' : '';
  const built = __BUILD_TIME__ ? ` · built ${new Date(__BUILD_TIME__).toISOString().slice(0, 16).replace('T', ' ')}Z` : '';
  el.textContent = `build ${short}${dirty}${date}${built}`;
  el.title = `git commit ${__GIT_COMMIT__ || 'unknown'}${dirty ? ' (working tree not clean)' : ''}${date ? `\ncommitted ${__GIT_COMMIT_DATE__}` : ''}`;
}
initBuildFooter();

// ---------------------------------------------------------------- loading overlay

// Complete the loading overlay once the app has initialised: snap the progress
// bar to full and fade the overlay out. Yields to the event loop first so the
// browser can paint the final bar state before it disappears.
function finishLoading(): void {
  const overlay = document.getElementById('loadingOverlay');
  const fill = document.getElementById('loadingFill');
  const label = document.getElementById('loadingLabel');
  if (fill) fill.style.width = '100%';
  if (label) label.textContent = 'Ready';
  requestAnimationFrame(() => {
    overlay?.classList.add('hidden');
  });
}

// ---------------------------------------------------------------- state

let call: CallBundle | null = null;
let views: DancerView[] = [];
const connectors = buildHandConnectors(stage.scene);

let beat = 0; // absolute call beat (may be negative during lead-in)
let playing = true;
let lastTime = performance.now();
const BASE_MS_PER_BEAT = 500;
// Playhead phases: pause on the start formation, play through the call, then
// pause on the end formation (so start/end hand holds are visible).
const HOLD_MS = 2000;
let phase: 'start' | 'play' | 'end' = 'start';
let phaseTime = 0;

function speedMul(): number {
  return parseFloat(speedSelect.value);
}

// ---------------------------------------------------------------- UI setup

const availableLevels = Array.from(new Set(catalog.map((c) => c.level)));

// Level selector filters the call list. '' = all levels.
levelSelect.add(new Option('All levels', ''));
for (const lv of availableLevels) levelSelect.add(new Option(lv.toUpperCase(), lv));

function currentLevel(): string {
  return levelSelect.value;
}

// (Re)populate the call selector with calls from the selected level (grouped
// by level when "All levels" is chosen).
function populateCalls(keepFile?: string) {
  const level = currentLevel();
  const calls = level ? catalog.filter((c) => c.level === level) : catalog;
  callSelect.innerHTML = '';
  let lastLevel = '';
  for (const c of calls) {
    if (level === '') {
      if (c.level !== lastLevel) {
        const g = document.createElement('optgroup');
        g.label = c.level.toUpperCase();
        callSelect.add(g);
        lastLevel = c.level;
      }
      callSelect.add(new Option(c.title, c.id));
    } else {
      callSelect.add(new Option(c.title, c.id));
    }
  }
  if (keepFile && calls.some((c) => c.id === keepFile)) callSelect.value = keepFile;
}

function refreshSetups() {
  const c = catalog.find((x) => x.id === callSelect.value);
  tamSelect.innerHTML = '';
  if (c) {
    c.setups.forEach((s, i) => tamSelect.add(new Option(s.label, String(i))));
  }
}

// Build the viewer around an arbitrary call (used by the browse loader and the
// call editor's preview).
function showCall(c: CallBundle | null) {
  call = c;
  for (const v of views) {
    stage.scene.remove(v.group);
    stage.scene.remove(v.trail);
  }
  views = [];
  if (!call) {
    legend.innerHTML = '<i>no call</i>';
    return;
  }
  const dancers = assignHomeIdentity(call.dancers);
  views = dancers.map((d) => new DancerView(d, d.couple ?? 0));
  for (let i = 0; i < views.length; i++) {
    stage.scene.add(views[i].group);
    stage.scene.add(views[i].trail);
    views[i].setTrail(sampleTrail(dancers[i], 80));
  }
  if (call.taminator) legend.innerHTML = `<b>${call.title}</b> — ${call.taminator}`;
  else legend.innerHTML = `<b>${call.title}</b><br>from ${call.from || '(default setup)'}`;

  beat = -call.leadin;
  phase = 'start';
  phaseTime = 0;
  updateScrub();
}

function loadCurrent() {
  const id = callSelect.value;
  const tamIndex = parseInt(tamSelect.value, 10);
  try {
    showCall(loadCall(id, tamIndex, mirrorCheck.checked));
  } catch (err) {
    showCall(null);
    legend.innerHTML = `<b>${id}</b><br><span style="color:#ff7a7a">failed to load: ${(err as Error).message}</span>`;
  }
}

// Level change: repopulate calls (keep current call if it's still in the list),
// then reload setups + animation.
levelSelect.addEventListener('change', () => {
  const prev = callSelect.value;
  populateCalls(prev);
  refreshSetups();
  loadCurrent();
});

callSelect.addEventListener('change', () => {
  refreshSetups();
  loadCurrent();
});
tamSelect.addEventListener('change', loadCurrent);
mirrorCheck.addEventListener('change', loadCurrent);

populateCalls();
refreshSetups();
loadCurrent();

const STEP = 0.25; // beats per step
function setPlaying(v: boolean) {
  playing = v;
  lastTime = performance.now();
}
function reflectPlayState() {
  playBtn.style.opacity = playing ? '1' : '0.55';
  pauseBtn.style.opacity = playing ? '0.55' : '1';
}

playBtn.addEventListener('click', () => {
  if (!call) return;
  if (phase === 'end') {
    // Restart from the beginning when replaying after the end hold.
    beat = -call.leadin;
    phase = 'start';
    phaseTime = 0;
  }
  setPlaying(true);
  reflectPlayState();
});

pauseBtn.addEventListener('click', () => {
  setPlaying(false);
  reflectPlayState();
});

stepBackBtn.addEventListener('click', () => {
  if (!call) return;
  setPlaying(false);
  reflectPlayState();
  beat = Math.max(-call.leadin, beat - STEP);
  phase = 'play';
  updateScrub();
});

stepFwdBtn.addEventListener('click', () => {
  if (!call) return;
  setPlaying(false);
  reflectPlayState();
  beat = Math.min(call.totalBeats, beat + STEP);
  phase = 'play';
  updateScrub();
});

scrub.addEventListener('input', () => {
  if (!call) return;
  // Dragging the timeline pauses so you can inspect a specific frame.
  setPlaying(false);
  reflectPlayState();
  const f = parseFloat(scrub.value) / 100;
  beat = -call.leadin + f * call.totalBeats;
  phase = 'play';
  updateScrub();
});

reflectPlayState();

// ---------------------------------------------------------------- mode switch
function applyMode() {
  const mode = modeSelect.value;
  const browse = mode === 'browse';
  const seq = mode === 'sequence';
  const ed = mode === 'editor';
  browseControls.hidden = !browse;
  seqPanel.hidden = !seq;
  editorPanel.hidden = !ed;
  // Browse + editor share the main dancer views (editor previews synthesized
  // calls here); the sequencer renders its own board avatars.
  const showDancers = browse || ed;
  for (const v of views) v.group.visible = showDancers;
  connectors.group.visible = showDancers;
  seqUi.setActive(seq);
  editorUi.setActive(ed);
}
modeSelect.addEventListener('change', applyMode);
applyMode();

// ---------------------------------------------------------------- hand holds

// Derive hand holds geometrically from the data (positions + facing + hands).
// A line of dancers holding hands, a couple joined, and a firm grip for a
// wheel/arm-turn are all captured. See handholds.ts.
function computeGrips(poses: Pose[]) {
  const targets: { left?: THREE.Vector3; right?: THREE.Vector3 }[] = poses.map(() => ({}));
  const lines: [number, number][] = [];
  // Use static (formation) holds as soon as the dancers are stationary: during
  // the lead-in (beat <= 0) and lead-out (beat >= call.beats, all movements
  // done). During the move itself only actively-holding dancers (e.g. a wheel
  // grip) connect. This is beat-based so the end line forms the moment the
  // dancers stop, with no delay waiting for the end-hold phase.
  const staticHold = call && (beat <= 0 || beat >= call.beats);
  const mode: HoldMode = staticHold ? 'static' : 'active';
  const holds = computeHandholds(poses, mode);
  for (const h of holds) {
    // Aim each holding hand at the pair's midpoint (the hold point / pivot).
    // This keeps arms calm and pointing through the hold as the pair moves.
    const mx = (poses[h.i].x + poses[h.j].x) / 2;
    const my = (poses[h.i].y + poses[h.j].y) / 2;
    const hold = new THREE.Vector3(mx, 1.0, -my); // z = -y matches position mapping
    if (h.hi === 'left') targets[h.i].left = hold.clone();
    else targets[h.i].right = hold.clone();
    if (h.hj === 'left') targets[h.j].left = hold.clone();
    else targets[h.j].right = hold.clone();
    lines.push([h.i, h.j]);
  }
  return { targets, lines };
}

// ---------------------------------------------------------------- frame loop

function updateScrub() {
  if (!call) return;
  const f = (beat + call.leadin) / call.totalBeats;
  scrub.value = String(f * 100);
}

function tick(now: number) {
  const dt = Math.min(now - lastTime, 120); // clamp large frame gaps
  lastTime = now;
  if (playing && call) {
    const total = call.totalBeats;
    if (phase === 'start') {
      // Pause on the starting formation so its hand holds are visible.
      beat = -call.leadin;
      phaseTime += dt;
      if (phaseTime >= HOLD_MS) {
        phase = 'play';
        phaseTime = 0;
      }
    } else if (phase === 'end') {
      // Pause on the ending formation so its hand holds are visible.
      beat = total;
      phaseTime += dt;
      if (phaseTime >= HOLD_MS) {
        phase = 'start';
        phaseTime = 0;
        beat = -call.leadin;
      }
    } else {
      beat += (dt / BASE_MS_PER_BEAT) * speedMul();
      if (beat >= total) {
        phase = 'end';
        phaseTime = 0;
      }
    }
  }

  if (call) {
    const t = beat;
    const facingMode = facingSelect.value as HeadingMode;
    const poses = allPoses(call, t, facingMode);
    const { targets, lines } = computeGrips(poses);
    // Drive the walk phase with the beat (a step lands each beat). Whether each
    // dancer actually steps is decided inside DancerView from its own motion,
    // so a dancer that has stopped moving settles to rest.
    const walkPhase = ((t + 1000) % 2) / 2;
    for (let i = 0; i < views.length; i++) {
      views[i].update(poses[i], targets[i], { phase: walkPhase });
    }
    connectors.set(lines, poses);

    // Part indicator (splits by ';').
    const parts = call.parts ? call.parts.split(';') : [];
    let acc = 0;
    let idx = -1;
    for (let k = 0; k < parts.length; k++) {
      acc += parseFloat(parts[k]);
      if (t >= acc) idx = k + 1;
    }
    partLabel.textContent = idx >= 0 ? `part ${idx + 1}/${parts.length}` : '';
    beatReadout.textContent = `${(t + call.leadin).toFixed(2)} / ${call.totalBeats.toFixed(2)} b`;
    updateScrub();
  }

  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(tick);
}

function onResize() {
  stage.resize();
}
window.addEventListener('resize', onResize);
requestAnimationFrame(tick);
finishLoading();
