// Bootstrap: wire the pure engine + Three.js scene + player + HUD. Owns the
// top-level mode switching and transport controls, delegating the browse UI and
// the playhead state machine to CallBrowser and Player.

import { createStage } from 'dancing-squared-stage';
// The floor's two grid modes, so the switch below cannot name a state the stage does not know.
import type { GridMode } from 'dancing-squared-stage';
// The one keyboard table. See `keys.ts` for the policy it applies to every binding.
import { installKeys } from './keys';
import { loadCatalog } from './data';
import { Player } from './player';
import { CallBrowser } from './browser';
import { initSequencer } from './sequencer-ui';
import { initEditor } from './editor-ui';
import { initHudChrome } from './hud-chrome';
import { renderFsmHtml, mergeFsmTables, type FsmEdgeData } from './fsm-view';
import { el } from './dom';
import { rememberLastSession } from './remember';
import { BUILD_STEPS, bootLabel, bootPercent, type BootStep, type BootPhase } from './boot-progress';

// Precomputed FSM table asset(s) written by `node scripts/build-fsm-asset.mjs`.
//
// The edge type is `FsmEdgeData` rather than a local copy: schema 2 added `reading` and `endKind`, and a
// second, narrower declaration here would silently strip them before the renderer ever saw them - the
// view would compile and quietly lose the new facts.
// `@corpus` is the repository's one corpus (`assets/` at the root, named in `vite.corpus.ts`).
const fsmAssets = import.meta.glob<{
  level?: string;
  table: { states: string[]; edges: Record<string, FsmEdgeData[]> };
}>('@corpus/fsm-*.json', { eager: true, import: 'default' });

// ---------------------------------------------------------------- loading bar

const loadingFill = document.getElementById('loadingFill');
const loadingSweep = document.getElementById('loadingSweep');
const loadingLabel = document.getElementById('loadingLabel');

/**
 * PAINT THE BAR: a percentage and a sentence, or `null` for "no fraction - but work is happening".
 *
 * The SWEEP is not decoration. Everything after the download is a single synchronous call, so a width written before it
 * is still the width on screen when it returns - the browser has no frame to paint in between. A `transform` animation
 * runs on the compositor, so it keeps moving while the main thread is blocked, and the bar then says "still working" for
 * exactly as long as the step takes. `style.css` owns that animation; this owns when it is on, and the FILL always keeps
 * the last real percentage even while the sweep is running.
 */
function paintLoading(percent: number | null, text: string): void {
  if (loadingSweep) loadingSweep.hidden = percent !== null;
  if (loadingFill && percent !== null) loadingFill.style.width = `${Math.round(percent)}%`;
  if (loadingLabel) loadingLabel.textContent = text;
}

/** The loader's own reports, mapped by `boot-progress.ts` so the phases and the wording stay one rule. */
function updateLoading(phase: BootPhase, frac: number): void {
  paintLoading(bootPercent(phase, frac), bootLabel(phase, frac));
}

/**
 * RUN ONE BLOCKING BUILD STEP WITH THE BAR SAYING SO.
 *
 * The step's name and position are painted FIRST, the sweep is turned on, and a frame is awaited - so the sentence and
 * the motion are on screen before the work starts. The width then holds the step's own position while the work blocks
 * the thread, and `style.css`'s animation carries the motion. Without the await the paint would be batched with
 * everything the step does and the caller would still be looking at the previous label.
 */
async function buildStep<T>(step: BootStep, run: () => T): Promise<T> {
  paintLoading(step.percent, step.text);
  if (loadingSweep) loadingSweep.hidden = false;
  await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  return run();
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = createStage(canvas);

/**
 * THE PANEL IS AN OVERLAY, SO THE CANVAS IS NOT THE VISIBLE BOARD.
 *
 * The HUD floats on top of the stage rather than sitting beside it, so a 10-unit floor centred on the canvas is
 * centred UNDER the panel - and on a wide window the caller sees the board pushed to the right of it. Reported
 * from use: "the board seems to be centralised to the screen, but it hasn't taken into account that the left
 * hand dialog changes the visible board to the right hand side." The stage frames the floor in the box that is
 * left over, and this is the measurement it frames around.
 *
 * MEASURED RATHER THAN ASSUMED, and re-measured: `#hud` is content-sized (`min-width: 320px`, `max-width:
 * 420px`, and 780px in the instance editor), so its width is a fact about the current mode and not a constant
 * this file could hold. The observer is what keeps the two in step when the mode changes the panel's shape
 * without the window changing size at all.
 */
const hudEl = document.getElementById('hud');
/** Breathing room between the panel's edge and the floor's - the board should not touch the panel. */
const PANEL_GAP = 8;
function applyViewInsets(): void {
  const rect = hudEl?.getBoundingClientRect();
  stage.setViewInsets({ left: rect ? rect.right + PANEL_GAP : 0 });
}
applyViewInsets();
if (hudEl && typeof ResizeObserver !== 'undefined') new ResizeObserver(applyViewInsets).observe(hudEl);

// THE PANEL'S TEXT SIZE AND ITS GRAB HANDLE, BEFORE ANYTHING ELSE IS BUILT. Both are applied to `#hud`
// itself, so they can be set once here rather than against each mode's panel - and the observer above is
// already watching the element, so a resize re-frames the floor with no further wiring.
initHudChrome();

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
const seqUi = await buildStep(BUILD_STEPS[0], () => initSequencer(stage));

const player = new Player({ speed: speedMul });
// The browse view can hand a named sequence to the sequence view. `applyMode` is declared below,
// which is fine: this is a closure, so it is read when the button is CLICKED.
const browser = await buildStep(BUILD_STEPS[1], () => new CallBrowser(stage, player, {
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
}));
// The editor drives the stage through the browse view: `preview` shows a bundle, and
// `focusTrail` is how the moves editor isolates one dancer's track and highlights the
// selected move's stretch of it. `startFormations` is the clone's Start setup picker, and it
// comes from the sequencer because the formation library lives there - it is built from the
// registered catalogue, and building a second one here would double that cost.
const editorUi = await buildStep(BUILD_STEPS[2], () => initEditor(stage, {
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
  // WHICH DANCERS ARE SELECTED, and which of their paths disagree. ONE call for both, because they are two
  // halves of one statement about the board and the board must not be able to show them for two selections.
  selectionMarks: (selected, mismatched) => browser.setSelection(selected, mismatched),
  startFormations: (dancers) => seqUi.startFormations(dancers),
  // Naming a generated setup means naming the FORMATION it starts from; the library is the only
  // thing that can do that, and it lives in the sequencer.
  nameBoard: (board) => seqUi.readBoard(board).name,
  // The editor's view options (2D icons, hidden dancers). The browse view owns the drawing, so this
  // is the same path the trail focus takes.
  setDisplayMode: (opts) => browser.setDisplayMode(opts),
}));

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
  // 100 IS SET HERE AND NOWHERE ELSE, once every panel above this line has been built - the bar claimed to be finished
  // while a third of the startup was still to come, which is the other half of the report.
  paintLoading(100, 'Ready');
  requestAnimationFrame(() => {
    document.getElementById('loadingOverlay')?.classList.add('hidden');
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
    fsmTitle.textContent = `no precomputed FSM for ${level.toUpperCase() || '(none)'} — run scripts/build-fsm-asset.mjs`;
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
  // THE PANEL'S OWN BOX CARRIES THE SEQUENCER'S LAYOUT, and the figure mode's edge. `#hud.seq` is what makes
  // the panel a NON-scrolling flex column so the timeline is the only thing that scrolls - see `style.css`.
  // It mirrors the editor's `ed-instance`/`ed-clone` classes, which `EditorController` sets on the same
  // element from the same reasoning.
  hudEl?.classList.toggle('seq', seq);
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

// THE FLOOR GRID. The grid itself is drawn on EVERY board in every tab; the SWITCH lives with the editor's
// Reset and Revert buttons, which is where the board's own state is driven from.
//
// A STATE-DRIVEN BUTTON RATHER THAN A LIST, because there are two references and no "off": the label IS the
// state ("Grid: Square" / "Grid: Radial") and pressing it flips to the other one. `value` carries that state
// - it is what `remember.ts` stores and restores - and `data-state` is written from it on every apply, so
// the words on the button, the grid on the floor and the editor's magnet cannot disagree.
//
// ONE SETTER, TWO CONSUMERS: the stage draws the grid and the editor's CTRL-drag magnet pulls a dragged
// point onto it. A second reader of this button - one of them asking the DOM at drag time - would be a
// second answer to "which grid is on the floor", and the two would eventually disagree about where a
// snapped coordinate lands.
const gridModeBtn = el<HTMLButtonElement>('gridMode');
/** The label for each state, so the words live in one place and the button can never name the wrong one. */
const GRID_LABEL: { [k in GridMode]: string } = { square: 'Square', radial: 'Radial' };
/** The state a raw string names. Anything the markup cannot represent falls back to the square grid, which
 *  is what the board drew before there was a choice - the same best-effort rule the session restore follows. */
function gridModeOf(raw: string | undefined): GridMode {
  return raw === 'radial' ? 'radial' : 'square';
}
function applyGridMode(mode: GridMode): void {
  gridModeBtn.dataset.state = mode;
  gridModeBtn.value = mode;
  gridModeBtn.textContent = `Grid: ${GRID_LABEL[mode]}`;
  stage.setGridMode(mode);
  editorUi.setGridMode(mode);
}
/**
 * FLIP THE GRID, whoever asked - the button or the W key.
 *
 * IT FLIPS THE `value` AND ANNOUNCES IT rather than applying here: the `change` handler below is the ONE
 * place the state is applied, so a press, a keystroke and a session restore take exactly the same path - and
 * `remember.ts`, which saves on `change`, stores the new state without a second line here.
 */
function toggleGridMode(): void {
  gridModeBtn.value = gridModeOf(gridModeBtn.value) === 'square' ? 'radial' : 'square';
  gridModeBtn.dispatchEvent(new Event('change', { bubbles: true }));
}
gridModeBtn.addEventListener('click', toggleGridMode);

// THE ONE APPLY PATH: a press and the W key arrive here through the event above, and the session restore
// below arrives here as the `change` `remember.ts` dispatches after writing `value`.
gridModeBtn.addEventListener('change', () => applyGridMode(gridModeOf(gridModeBtn.value)));
// Before the session restore below, so a remembered radial grid arrives through this same setter.
applyGridMode(gridModeOf(gridModeBtn.value));

// ------------------------------------------------------------------ the keyboard
//
// ONE TABLE, ONE LISTENER, AND EVERY SHORTCUT IS A LINE. See `keys.ts` for why this is a table rather than a
// `keydown` handler per feature, and for the four decisions it makes once for all of them: an unmentioned
// modifier must not be held, a field being typed into keeps its keys, a held key does not auto-repeat, and a
// binding says for itself when it is live (`when`).
//
// IT IS READ FROM TOP TO BOTTOM AND THE FIRST MATCH WINS, so the order is part of the meaning - which is
// exactly why the whole table is here, where it can be read, instead of scattered across the modules that
// happen to own the features. A panel supplies its own bindings through its own interface
// (`editorUi.keyBindings()`), because only it knows what "live" means for them.
//
// `installKeys` runs once here, but the table is read on every keystroke, so a binding added later is live
// without touching either this call or the listener.
installKeys([
  // THE FLOOR GRID, on every board in every tab - which is why it is a document-level binding and not a
  // property of the button, which lives in one panel. THE `W` FOR "WHOLE AND HALF LINES", not `G`: `G` and `B`
  // now cycle the editor's own girls and boys selects (see `editorUi.keyBindings`), which are the two keys that
  // pair with the button labels sitting on them.
  {
    id: 'grid-mode',
    key: 'w',
    run: toggleGridMode,
  },
  // ...and everything the panels own. THE SEQUENCER'S ARE PANEL-SCOPED TOO (`when: () => this.active`), so
  // Space plays the sequence only while the sequencer is the panel on screen.
  ...editorUi.keyBindings(),
  ...seqUi.keyBindings(),
]);

// PICK UP WHERE YOU LEFT OFF. AFTER `applyMode` above, because a restore is a CHANGE and every listener
// it fires lives in a panel constructor that has now run - restoring `edCall` LOADS the call it names, so
// the editor has to exist, not merely be built. The restore order is a dependency order; see the module.
const resumed = await buildStep(BUILD_STEPS[3], () => rememberLastSession());
if (resumed.length) console.log('[dsq] resumed: ' + resumed.join(', '));

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
    // THROUGH THE STAGE, which draws from whichever camera is on screen. This used to reach for
    // `stage.camera` directly, which is the 3D one: it happened to be right because the POC's 2D view is a
    // separate mode that also keeps that camera, but the choice belongs to the module that owns both
    // cameras and the flat view's invariant (`packages/stage/scene.ts`, `Stage.render`).
    stage.render();
  }
  requestAnimationFrame(tick);
}

function onResize() {
  stage.resize();
  // The panel's inset is capped against the canvas WIDTH, so a window resize can change which part of it
  // applies even when the panel itself has not moved.
  applyViewInsets();
}
window.addEventListener('resize', onResize);
requestAnimationFrame(tick);
finishLoading();


