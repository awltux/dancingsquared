// Bootstrap: wire the pure engine + Three.js scene + player + HUD. Owns the
// top-level mode switching and transport controls, delegating the browse UI and
// the playhead state machine to CallBrowser and Player.

import { createStage } from './scene';
import { loadCatalog } from './data';
import { Player } from './player';
import { CallBrowser } from './browser';
import { initSequencer } from './sequencer-ui';
import { initEditor } from './editor-ui';
import { renderFsmHtml, mergeFsmTables } from './fsm-view';
import { el } from './dom';

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
//
// STORED USER FORMATIONS ARE REGISTERED BY THE PANEL THAT OWNS THE LIBRARY, not here: the library is
// built in TWO places (the constructor and `rebuildSeq`), and registering from a caller meant the
// second build - a level change - silently dropped every label the caller had made.
const seqUi = initSequencer(stage);

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
  // The browse list's Edit button. `editorUi` is declared BELOW this, which is fine for the same reason
  // `applyMode` is: this closure only runs on a click, long after both exist.
  openEditor: (callId, setupIdx) => {
    modeSelect.value = 'editor';
    applyMode();
    editorUi.openCall(callId, setupIdx);
  },
});
// The editor drives the stage through the browse view: `preview` shows a bundle, and
// `focusTrail` is how the moves editor isolates one dancer's track and highlights the
// selected move's stretch of it. `startFormations` is the clone's Start setup picker, and it
// comes from the sequencer because the formation library lives there - it is built from the
// registered catalogue, and building a second one here would double that cost.
const editorUi = initEditor(stage, {
  preview: (c) => browser.showCall(c),
  // The editor's moves mode parks the playhead: `setCall` inside `showCall` would otherwise put it
  // back at the lead-in on every edit, so the beat is re-applied after the call is shown.
  previewAt: (c, b) => {
    browser.showCall(c);
    player.seekAbsolute(b);
  },
  setPlayhead: (b) => player.seekAbsolute(b),
  // A handle drag re-paths the call many times a second, so it must NOT go through `showCall`'s
  // view rebuild - same dancers, new geometry.
  updateCall: (c) => browser.updateCall(c),
  focusTrail: (index, range, kind) => browser.setTrailFocus(index, range, kind),
  startFormations: () => seqUi.startFormations(),
  // Naming a generated setup means naming the FORMATION it starts from; the library is the only
  // thing that can do that, and it lives in the sequencer.
  nameBoard: (board) => seqUi.readBoard(board).name,
  // The editor's view options (2D icons, hidden dancers). The browse view owns the drawing, so this
  // is the same path the trail focus takes.
  setDisplayMode: (opts) => browser.setDisplayMode(opts),
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

// ---------------------------------------------------------------- mode switch

const fsmPanel = el<HTMLDivElement>('fsmPanel');
const fsmFrame = el<HTMLIFrameElement>('fsmFrame');
const fsmTitle = el<HTMLSpanElement>('fsmTitle');
const fsmLevel = el<HTMLSelectElement>('fsmLevel');

// THE ASSETS ARE PER LEVEL, AND ONE IS PICKED BY NAME. This used to take `Object.values(fsmAssets)[0]` - the
// first key the bundler happened to emit - which is not a choice anybody made, and which silently draws the
// wrong level the moment a second asset is built. The dropdown lists what exists, and nothing pretends to be
// there that is not.
//
// ALL LEVELS IS THE UNION, and it is an ITEM rather than a checkbox because it answers the same question the
// other options do: which tree is on screen. MS IS THE DEFAULT - the level whose asset is built and the one
// the get-out work is done at - so the panel opens on the tree rather than on the union, which with a single
// asset built would silently be the same picture under a name that claims more.
const FSM_ALL = '';
const fsmByLevel = new Map<string, (typeof fsmAssets)[string]>();
for (const blob of Object.values(fsmAssets)) {
  if (blob?.level) fsmByLevel.set(blob.level, blob);
}
fsmLevel.add(new Option('All levels', FSM_ALL));
for (const lv of [...fsmByLevel.keys()].sort()) fsmLevel.add(new Option(lv.toUpperCase(), lv));
if (fsmByLevel.has('ms')) fsmLevel.value = 'ms';
else if (fsmByLevel.size > 0) fsmLevel.value = [...fsmByLevel.keys()].sort()[0];
let fsmActive = false;
/** The mode the app was in before this one. See `applyMode` and the editor's parked playhead. */
let lastMode = '';

function showFsm() {
  fsmActive = true;
  fsmPanel.hidden = false;
  renderFsm();
}

/** Draw the selected level's precomputed FSM - or the union of all of them - or say there are none. */
function renderFsm() {
  const level = fsmLevel.value;
  const chosen = level === FSM_ALL ? [...fsmByLevel.values()] : [fsmByLevel.get(level)].filter((b) => !!b);
  if (chosen.length === 0) {
    fsmTitle.textContent = `no precomputed FSM for ${level.toUpperCase() || '(none)'} — run poc/scripts/build-fsm-asset.mjs`;
    fsmFrame.srcdoc = '<p>No FSM asset found for that level.</p>';
    return;
  }
  const table = chosen.length === 1 ? chosen[0].table : mergeFsmTables(chosen.map((b) => b.table));
  const states = table.states?.length ?? 0;
  const edgeCount = Object.values(table.edges ?? {}).reduce((n, l) => n + l.length, 0);
  fsmFrame.srcdoc = renderFsmHtml(table, `FSM · ${level || 'all levels'}`, level);
  fsmTitle.textContent =
    level === FSM_ALL
      ? `ALL · ${states} states, ${edgeCount} edges over ${chosen.length} level${chosen.length === 1 ? '' : 's'}, precomputed`
      : `${level.toUpperCase()} · ${states} states, precomputed`;
}
fsmLevel.addEventListener('change', renderFsm);

/**
 * A ROW IN THE FSM TAB CAN HAND ITS CALL BACK TO THE APP. The FSM view is a self-contained document in an
 * iframe and holds precomputed table data, so it does not know what a catalogue entry is; its Load and Edit
 * icons ask instead of acting, and this is the answer.
 *
 * ONLY THE FSM FRAME IS HEARD. A `srcdoc` frame inherits this page's origin, so any frame the page hosts
 * could post the same message; the source check is what makes it the FSM's rather than anybody's.
 *
 * A CALL THE CATALOGUE DOES NOT HOLD IS REPORTED WHERE IT IS VISIBLE. The browse legend is behind this tab,
 * so "Face Half" - a coded move the FSM applies by rule, 133 of its 1961 edges - would otherwise look like a
 * button that does nothing.
 */
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== fsmFrame.contentWindow) return;
  const d = ev.data as { type?: string; action?: string; call?: string; formation?: string | null; level?: string } | null;
  if (!d || d.type !== 'fsm-open' || typeof d.call !== 'string') return;
  openFsmCall(d.action === 'edit' ? 'edit' : 'load', d.call, d.formation ?? null, d.level || fsmLevel.value);
});

/** Open the call an FSM row names: `load` into the Browse tab, `edit` into the Call editor. */
function openFsmCall(action: 'load' | 'edit', call: string, formation: string | null, level: string) {
  const target = browser.resolveFsm(call, formation, level);
  if (!target) {
    fsmTitle.textContent = `${call}: not a ${level.toUpperCase() || 'catalogue'} call — the FSM applies it by rule, not from a <tam>`;
    return;
  }
  // The mode first, then the call: the panel that shows it has to be the visible one when it does.
  if (action === 'edit') {
    modeSelect.value = 'editor';
    applyMode();
    editorUi.openCall(target.callId, target.setupIdx);
  } else {
    modeSelect.value = 'browse';
    applyMode();
    browser.loadCatalogue(target.callId, target.setupIdx);
  }
}

function applyMode() {
  const mode = modeSelect.value;
  // LEAVING THE EDITOR GIVES THE ANIMATION BACK. The editor's moves mode parks the playhead with the
  // animation OFF (only a manual scrub moves the dancers there), and nothing else in the app expects
  // to inherit that: the browse and sequence views behave exactly as they always did. Tracked by the
  // PREVIOUS mode rather than by "not editor", so a deliberate pause elsewhere is left alone.
  if (lastMode === 'editor' && mode !== 'editor') {
    player.setPlaying(true);
    // ...AND THE BOARD GOES BACK TO THE BROWSE VIEW'S OWN CALL. The editor borrowed it for its preview, so
    // returning to the Browse tab with the editor's call still on the board would leave this panel's dropdown
    // naming one call while the board shows another.
    if (mode === 'browse') browser.reload();
  }
  lastMode = mode;
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
  // ORDER IS LOAD-BEARING, because the camera is ONE object shared by every panel and the last
  // caller wins. The browse view draws the dancers (and owns the 2D/3D question for the browse and
  // editor modes), then the editor's own view options are applied or released, and the sequencer
  // goes LAST so that when IT is the active panel its 2D select decides - it only touches the camera
  // while it is active, which is what stops it overriding the editor's choice.
  editorUi.setActive(ed && !fsm);
  seqUi.setActive(seq && !fsm);
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
    stage.updateControls();
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


