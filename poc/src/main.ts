// Bootstrap: wire the pure engine + Three.js scene + player + HUD. Owns the
// top-level mode switching and transport controls, delegating the browse UI and
// the playhead state machine to CallBrowser and Player.

import { createStage } from './scene';
import { loadCatalog } from './data';
import { loadUserFormations } from './formations';
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

// THE SEQUENCER COMES FIRST, and it has to: the browse panel's end-formation field asks the
// formation library what a board is, and `CallBrowser`'s constructor loads a call - so the host it
// is handed must already exist when it is built. `openSequence` was only ever called on a click,
// which is why this order survived until the end-formation field needed a read at construction.
const seqUi = initSequencer(stage);

// User-defined formations live in local storage; register them with the library up front so a
// shape the caller labelled in an earlier session is recognised on the first read, not the first
// reload after this one.
for (const f of loadUserFormations()) seqUi.registerFormation(f.name, f.dancers);

const player = new Player({ speed: speedMul });
// The browse view can hand a named sequence to the sequence view. `applyMode` is declared below,
// which is fine: this is a closure, so it is read when the button is CLICKED.
const browser = new CallBrowser(stage, player, {
  openSequence: (steps, atCall, startFormation) => {
    modeSelect.value = 'sequence';
    applyMode();
    seqUi.openSequence(steps, atCall, startFormation);
  },
  readBoard: (board) => seqUi.readBoard(board),
  registerFormation: (name, dancers) => seqUi.registerFormation(name, dancers),
});
// The editor drives the stage through the browse view: `preview` shows a bundle, and
// `focusTrail` is how the moves editor isolates one dancer's track and highlights the
// selected move's stretch of it. `startFormations` is the clone's Start setup picker, and it
// comes from the sequencer because the formation library lives there - it is built from the
// registered catalogue, and building a second one here would double that cost.
const editorUi = initEditor(stage, {
  preview: (c) => browser.showCall(c),
  focusTrail: (index, range) => browser.setTrailFocus(index, range),
  startFormations: () => seqUi.startFormations(),
});

const playBtn = el<HTMLButtonElement>('play');
const pauseBtn = el<HTMLButtonElement>('pause');
const stepBackBtn = el<HTMLButtonElement>('stepBack');
const stepFwdBtn = el<HTMLButtonElement>('stepFwd');
const speedSelect = el<HTMLSelectElement>('speed');
const scrub = el<HTMLInputElement>('scrub');
const beatInput = el<HTMLInputElement>('beatInput');
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
// The position bar is in BEATS, not percent (`CallBrowser.updateScrub` sets its max from the
// loaded call), so its own value is the number the beat box beside it takes. Dragging PAUSES the
// call and places the dancers where the call's own paths put them at that beat - which is what
// makes the bar a way to move them around the board by hand rather than only a video scrubber.
scrub.addEventListener('input', () => {
  player.seekAbsolute(parseFloat(scrub.value));
  reflectPlayState();
});
beatInput.addEventListener('change', () => {
  const v = parseFloat(beatInput.value);
  if (Number.isFinite(v)) player.seekAbsolute(v);
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
  if (player.call) {
    browser.render(beat, player.call);
    // Keep the beat box on the playhead, but NEVER while it is being typed into - writing into the
    // field the user is in the middle of is the classic way a synced readout becomes unusable.
    if (document.activeElement !== beatInput) beatInput.value = String(Math.round(player.absoluteBeat() * 100) / 100);
  }

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
