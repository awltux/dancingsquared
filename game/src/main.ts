// The game's bootstrap: load the corpus, build a level's runtime, generate the first drill, and own the ONE
// animation frame loop.
//
// THE LOOP LIVES HERE AND NOWHERE ELSE. `UI/playhead.ts` measures time and `render/stage-view.ts` draws, but
// neither starts a frame callback — a second rAF somewhere is how two clocks end up disagreeing about which
// frame it is. So this file advances the playhead, decides what to draw, and reports a finished motion once.
import { generatePuzzle } from './puzzle/generator.ts';
import { generatorConfigFor } from './puzzle/config.ts';
import { levelSpec } from './puzzle/levels.ts';
import { MAIN_POOL } from './puzzle/pool.ts';
import { createLevelRuntime } from './data/corpus.ts';
import { DrillController } from './game/drill.ts';
import { scheduleEntryFor, scheduleLength } from './game/schedule-fixture.ts';
import { DrillStage, type ViewMode } from './render/stage-view.ts';
import { DrillScreen } from './ui/drill-screen.ts';
import { Replay } from './ui/playhead.ts';
import type { Board } from 'dancing-squared-engine';

const PLAYHEAD = new Replay();
const stageRef: { stage: DrillStage | null } = { stage: null };
let screen: DrillScreen;
let controller: DrillController | null = null;
let position = 0;
/** Whether the replay now running finishes a CORRECT answer, so the loop knows to advance. */
let advances: boolean = false;
let lastFrameMs = 0;
let mode: ViewMode = '2d';

function startDrill(next: number): void {
  position = ((next % scheduleLength()) + scheduleLength()) % scheduleLength();
  const entry = scheduleEntryFor(position);
  const level = levelSpec(entry.levelIndex);
  if (!level) throw new Error(`the fixture names level ${entry.levelIndex}, which is not a level`);

  screen.setLoading(true, `Generating drill ${position + 1} of ${scheduleLength()}…`);
  const { applier, registered } = createLevelRuntime(level, MAIN_POOL);
  const result = generatePuzzle(generatorConfigFor(MAIN_POOL.version, level), entry.seed, level, applier);
  screen.setLoading(false);

  if (!result.ok) {
    // A REFUSAL IS A RESULT: the generator says why, and the screen shows it rather than an empty board.
    // The fixture's seeds are gated, so reaching this branch means the corpus or the generator moved.
    screen.say(`This drill cannot be generated: ${result.reason}`, 'bad');
    screen.render();
    return;
  }
  if (registered < level.poolSize) {
    // NOT FATAL, AND NOT SILENT: a title in the level that the corpus does not carry is a data question the
    // ladder census reports, and saying so here is what stops it being discovered as a mysterious difficulty.
    console.warn(`level ${level.index} asks for ${level.poolSize} calls and the corpus carries ${registered}`);
  }

  controller = new DrillController(result.puzzle);
  PLAYHEAD.cancel();
  advances = false;
  screen.show(controller, position);
  draw();
}

/** What the left board should show right now. */
function draw(): void {
  const stage = stageRef.stage;
  if (!stage || !controller) return;
  const goal: Board = controller.puzzleRef.goal;
  const pair = screen.replayPair();
  if (pair && PLAYHEAD.isRunning) {
    stage.drawReplay(pair.from, pair.to, goal, PLAYHEAD.fraction);
    return;
  }
  if (pair) {
    // A FINISHED REPLAY KEEPS ITS LANDING BOARD ON SCREEN, because that is the whole teaching content of a
    // wrong answer: where the call you chose actually leaves the set. `fraction 1` is exactly the ending
    // board — `tween.ts` clamps it there so the picture and the verdict cannot disagree.
    stage.drawReplay(pair.from, pair.to, goal, 1);
    return;
  }
  const view = controller.view();
  stage.draw(view.from, view.goal);
}

function choose(choice: number | 'unknown'): void {
  if (!controller || PLAYHEAD.isRunning) return;
  let result;
  try {
    result = controller.answer(choice);
  } catch (error) {
    // AN OUT-OF-RANGE INDEX IS A UI BUG, and the controller throws rather than calling it a wrong answer.
    // Surfacing it as a message beats a silent no-op on a button that looked live.
    screen.say(error instanceof Error ? error.message : String(error), 'bad');
    return;
  }

  if (result.kind === 'illegal') {
    // NO MOTION: an illegal application leaves the board unchanged, so there is nothing to animate — which
    // is exactly why the illegal choice is a separate field on the step rather than one of the options.
    screen.say(`That cannot be called from here. ${result.reason ?? ''}`.trim(), 'bad');
    screen.render();
    return;
  }

  const from = result.replayFrom as Board;
  const to = result.ending as Board;
  advances = result.kind === 'correct';
  screen.beginReplay(from, to);
  screen.setBusy(true);
  if (result.kind === 'correct') {
    screen.say(`${result.call} — correct.`, 'ok');
    PLAYHEAD.start({ label: result.call, done: () => undefined }, 700);
  } else {
    // A WRONG ANSWER STATES WHERE IT WENT, not just that it was wrong. The ending board is on screen by the
    // time this is read, so the sentence and the picture say the same thing.
    screen.say(`${result.call} is legal, but it does not leave the set on the goal board.`, 'bad');
    PLAYHEAD.start({ label: result.call, done: () => undefined }, 700);
  }
}

/** The answer, on request — DESIGN.md §8's review. */
function review(): void {
  if (!controller || PLAYHEAD.isRunning || controller.atEnd) return;
  const option = controller.review();
  const from = controller.view().from;
  advances = true;
  screen.beginReplay(from, option.board);
  screen.setBusy(true);
  screen.say(`The answer is ${option.call}.`, 'info');
  PLAYHEAD.start({ label: option.call, done: () => undefined }, 700);
}

function toggleView(): void {
  mode = mode === '2d' ? '3d' : '2d';
  stageRef.stage?.setMode(mode);
  screen.setViewButton(mode === '2d' ? '3d' : '2d');
  draw();
}

function frame(nowMs: number): void {
  const dt = lastFrameMs === 0 ? 16 : Math.min(100, nowMs - lastFrameMs);
  lastFrameMs = nowMs;
  if (PLAYHEAD.isRunning) {
    const finished = PLAYHEAD.advance(dt);
    draw();
    if (finished) {
      screen.setBusy(false);
      if (advances && controller) {
        // A CORRECT ANSWER SETTLES ON ITS LANDING BOARD AND THEN THE STEP ADVANCES, so the player sees
        // where the call left the set — which is the state the NEXT question is asked from. `render()` is
        // what redraws the buttons for that new step.
        advances = false;
        screen.endReplay();
        screen.render();
        draw();
      } else if (controller) {
        // A WRONG ANSWER KEEPS its message and its landing board on screen. `render()` is deliberately not
        // called here, because it clears the verdict line — the sentence explaining where the call went is
        // the whole teaching content of a wrong answer.
        screen.endReplay();
      }
    }
  }

  // THE CAMERA AND THE DRAW RUN EVERY FRAME, NOT ONLY DURING A REPLAY. Two different jobs:
  // `updateControls` glides the orbit/pan damping, and `render` is what actually PAINTS — the stage owns no
  // animation loop, so a frame that poses views and never renders shows a blank canvas. That is exactly what
  // the first version of this loop did: it rendered nothing while idle, so the boards were black until an
  // option was clicked and a screenshot of the first screen came back empty.
  stageRef.stage?.updateControls();
  stageRef.stage?.render();
  requestAnimationFrame(frame);
}

function main(): void {
  screen = new DrillScreen(choose, review, () => startDrill(position + 1), toggleView);
  const stage = new DrillStage(screen.canvas);
  stageRef.stage = stage;
  stage.setMode(mode);
  screen.setViewButton('3d');
  screen.setLoading(false);

  // FRAME THE BOARDS IN THE SPACE THE PANEL LEAVES, not under it. MEASURED FROM THE ELEMENT rather than
  // hard-coded, because the panel is content-sized: a fixed number here would be correct until a call name
  // wrapped to two lines and then quietly wrong. The ResizeObserver is the POC's arrangement, and it is what
  // keeps the two in step when the panel changes height without the window changing size at all.
  const panel = document.getElementById('panel');
  const applyInsets = (): void => {
    const rect = panel?.getBoundingClientRect();
    stage.setViewInsets({ left: rect ? rect.right + 8 : 0 });
    draw();
  };
  applyInsets();
  if (panel && typeof ResizeObserver !== 'undefined') new ResizeObserver(applyInsets).observe(panel);

  window.addEventListener('resize', () => {
    stage.resize();
    draw();
  });
  startDrill(0);
  requestAnimationFrame(frame);
}

main();
