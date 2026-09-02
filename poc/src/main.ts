// Bootstrap: wire the pure engine + Three.js scene + player + HUD. Owns the
// top-level mode switching and transport controls, delegating the browse UI and
// the playhead state machine to CallBrowser and Player.

import { createStage } from './scene';
import { loadCatalog } from './data';
import { Player } from './player';
import { CallBrowser } from './browser';
import { initSequencer } from './sequencer-ui';
import { initEditor } from './editor-ui';
import { renderFsmHtml } from './fsm-view';

// Precomputed FSM table asset(s) written by `node poc/scripts/build-fsm-asset.mjs`.
const fsmAssets = import.meta.glob<{
  level?: string;
  table: { states: string[]; edges: Record<string, { call: string; endFormation: string | null }[]> };
}>('./assets/fsm-*.json', { eager: true, import: 'default' });

// ---------------------------------------------------------------- loading bar

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

const modeSelect = el<HTMLSelectElement>('modeSelect');
const browseControls = el<HTMLDivElement>('browseControls');
const seqPanel = el<HTMLDivElement>('seqPanel');
const editorPanel = el<HTMLDivElement>('editorPanel');

const player = new Player({ speed: speedMul });
const browser = new CallBrowser(stage, player);
const seqUi = initSequencer(stage);
const editorUi = initEditor(stage, (c) => browser.showCall(c));

const playBtn = el<HTMLButtonElement>('play');
const pauseBtn = el<HTMLButtonElement>('pause');
const stepBackBtn = el<HTMLButtonElement>('stepBack');
const stepFwdBtn = el<HTMLButtonElement>('stepFwd');
const speedSelect = el<HTMLSelectElement>('speed');
const scrub = el<HTMLInputElement>('scrub');
const levelSelect = el<HTMLSelectElement>('levelSelect');
const callSelect = el<HTMLSelectElement>('callSelect');
const tamSelect = el<HTMLSelectElement>('tamSelect');
const mirrorCheck = el<HTMLInputElement>('mirror');

const STEP = 0.25; // beats per step
let lastTime = performance.now();

function speedMul(): number {
  return parseFloat(speedSelect.value);
}

// ---------------------------------------------------------------- build footer

function initBuildFooter(): void {
  const el2 = document.getElementById('buildFooter');
  if (!el2) return;
  const short = __GIT_COMMIT_SHORT__;
  const date = __GIT_COMMIT_DATE__ ? ` · ${new Date(__GIT_COMMIT_DATE__).toISOString().slice(0, 16).replace('T', ' ')}Z` : '';
  const dirty = __GIT_DIRTY__ === 'dirty' ? ' · uncommitted changes' : '';
  const built = __BUILD_TIME__ ? ` · built ${new Date(__BUILD_TIME__).toISOString().slice(0, 16).replace('T', ' ')}Z` : '';
  el2.textContent = `build ${short}${dirty}${date}${built}`;
  el2.title = `git commit ${__GIT_COMMIT__ || 'unknown'}${dirty ? ' (working tree not clean)' : ''}${date ? `\ncommitted ${__GIT_COMMIT_DATE__}` : ''}`;
}
initBuildFooter();

// ---------------------------------------------------------------- loading overlay

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

// ---------------------------------------------------------------- transport

function reflectPlayState() {
  playBtn.style.opacity = player.playing ? '1' : '0.55';
  pauseBtn.style.opacity = player.playing ? '0.55' : '1';
}

playBtn.addEventListener('click', () => {
  player.play();
  reflectPlayState();
});
pauseBtn.addEventListener('click', () => {
  player.pause();
  reflectPlayState();
});
stepBackBtn.addEventListener('click', () => {
  player.step(-STEP);
  reflectPlayState();
});
stepFwdBtn.addEventListener('click', () => {
  player.step(STEP);
  reflectPlayState();
});
scrub.addEventListener('input', () => {
  player.scrub(parseFloat(scrub.value) / 100);
  reflectPlayState();
});
reflectPlayState();

// ---------------------------------------------------------------- browse wiring

levelSelect.addEventListener('change', () => browser.onLevelChange());
callSelect.addEventListener('change', () => browser.onCallChange());
tamSelect.addEventListener('change', () => browser.onSetupChange());
mirrorCheck.addEventListener('change', () => browser.onMirrorChange());

// ---------------------------------------------------------------- mode switch

const fsmPanel = el<HTMLDivElement>('fsmPanel');
const fsmFrame = el<HTMLIFrameElement>('fsmFrame');
const fsmTitle = el<HTMLSpanElement>('fsmTitle');
let fsmActive = false;

function showFsm() {
  fsmActive = true;
  fsmPanel.hidden = false;
  const blob = Object.values(fsmAssets)[0];
  if (blob && blob.table) {
    fsmFrame.srcdoc = renderFsmHtml({ states: blob.table.states, edges: blob.table.edges }, `FSM · ${blob.level ?? 'ms'}`);
    fsmTitle.textContent = `FSM (${blob.table.states?.length ?? 0} states, precomputed)`;
  } else {
    fsmTitle.textContent = 'No precomputed FSM asset — run poc/scripts/build-fsm-asset.mjs';
    fsmFrame.srcdoc = '<p>No FSM asset found.</p>';
  }
}

function applyMode() {
  const mode = modeSelect.value;
  const browse = mode === 'browse';
  const seq = mode === 'sequence';
  const ed = mode === 'editor';
  const fsm = mode === 'fsm';
  browseControls.hidden = !browse;
  seqPanel.hidden = !seq;
  editorPanel.hidden = !ed;
  fsmPanel.hidden = !fsm;
  fsmActive = fsm;
  const showDancers = (browse || ed) && !fsm;
  browser.setVisible(showDancers);
  seqUi.setActive(seq && !fsm);
  editorUi.setActive(ed && !fsm);
  if (fsm) showFsm();
}
modeSelect.addEventListener('change', applyMode);
applyMode();

// ---------------------------------------------------------------- frame loop

function tick(now: number) {
  const dt = Math.min(now - lastTime, 120); // clamp large frame gaps
  lastTime = now;
  const beat = player.advance(dt);
  if (player.call) browser.render(beat, player.call);

  if (!fsmActive) {
    stage.controls.update();
    stage.renderer.render(stage.scene, stage.camera);
  }
  requestAnimationFrame(tick);
}

function onResize() {
  stage.resize();
}
window.addEventListener('resize', onResize);
requestAnimationFrame(tick);
finishLoading();

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
