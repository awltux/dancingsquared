// The game's shell: the ONE animation frame loop, the mode switch, and the run each mode is playing.
//
// THE LOOP LIVES HERE AND NOWHERE ELSE. `ui/playhead.ts` measures time, `game/clock.ts` measures the run, and
// `render/stage-view.ts` draws — but none of them starts a frame callback. A second rAF somewhere is how two
// clocks end up disagreeing about which frame it is, so this file advances the playhead, decides what to draw,
// and reports a finished motion once.
//
// THE SHELL OWNS WHAT BOTH MODES SHARE, and that is the whole reason it exists: one stage, one playhead, one
// hint ledger, the mode switch, the footer's shared buttons and the board captions. Each mode's own panel
// belongs to its screen. The alternative — a screen that owned the footer and a second screen that copied it
// — would have put the hint balance in two places, and the balance is earned in one mode and spent in the
// other (DESIGN.md 10).
//
// TIME IS READ ONCE, HERE, and handed down: `performance.now()` for durations, so a run's elapsed time and
// the playhead's beats share one origin and cannot drift apart, and `Date.now()` only to ask what UTC day it
// is — a question about the calendar rather than a duration.
//
// "SHOW ME THE ANSWER" ANSWERS NOTHING. It names the call and dances it, and the player still presses it —
// so a review cannot complete a puzzle, and the success it earns when the player does press the revealed call
// is the same success any correct answer earns (DESIGN.md 10 counts "a correct answer, first try or after
// replays"). Whether a REVEALED answer should count as a ranked success is a fairness question this phase
// does not settle: it needs the ledger to know the puzzle was revealed, and the ledger is the server's from
// Phase 5 (DESIGN.md 11). DESIGN.md 15 carries it as an open question rather than a silent assumption.
import { generatePuzzle } from './puzzle/generator.ts';
import { generatorConfigFor } from './puzzle/config.ts';
import { dailyEntry, utcDay } from './puzzle/daily.ts';
import { levelSpec } from './puzzle/levels.ts';
import { MAIN_POOL } from './puzzle/pool.ts';
import { scoreRun } from './puzzle/score.ts';
import { earningProgress } from './puzzle/hints.ts';
import { SCORE_VERSION } from './puzzle/config.ts';
import type { GameApplier, LevelSpec, SequenceMotion } from './puzzle/types.ts';
import { createLevelRuntime } from './data/corpus.ts';
import { DrillController } from './game/drill.ts';
import { DailyRun } from './game/daily-run.ts';
import { Stopwatch } from './game/clock.ts';
import { newRunId, wallGapMs, type DrillSaved, type StorageLike } from './game/store.ts';
import { advanceDrill, apiConfigured, issueDrill, type IssuedDrill, type RegimeCounts } from './net/api.ts';
import { SaveState } from './game/save-state.ts';
import { scheduleEntryFor, scheduleLength } from './game/schedule-fixture.ts';
import { GameStage, type ViewMode } from './render/stage-view.ts';
import { DrillScreen } from './ui/drill-screen.ts';
import { DailyScreen } from './ui/daily-screen.ts';
import { Replay } from './ui/playhead.ts';
import { el } from './ui/dom.ts';
import type { Board } from 'dancing-squared-engine';

type AppMode = 'drill' | 'daily';
/** What finishing the replay now running means: advance the step, or just settle where it landed. */
type ReplayOutcome = 'advance' | 'settle';

const PLAYHEAD = new Replay();
let mode: AppMode = 'drill';
let viewMode: ViewMode = '2d';

/** The level's engine seam. One per level, rebuilt when the level changes, shared by both modes. */
let applier: GameApplier | null = null;
let level: LevelSpec | null = null;

/** The Drill's run: the machine, its clock, and the position it is on (the fixture's, or the server's). */
let controller: DrillController | null = null;
let drillClock = new Stopwatch();
let position = 0;

/**
 * The drill the SERVER issued, or null in offline mode.
 *
 * IT IS KEPT BECAUSE `advance` NAMES IT: the server moves a player on by being told which drill is finished, not
 * by a local counter, so the issued id is the handle for the next step.
 */
let serverDrill: IssuedDrill | null = null;
/** Where the server says the player is in the regime, for the header and the report of a finished season. */
let serverRegime: RegimeCounts | null = null;

/** The Daily's run, the UTC day and the level it was issued for. */
let daily: DailyRun | null = null;
let dailyDay = '';
let dailyLevelIndex = 0;
/** The seed today's challenge was issued from, for the run record (a run names the puzzle it played). */
let dailyRunSeed = 0;

/** The motion the drawing loop should sample, or null when nothing is replaying. */
let replay: SequenceMotion | null = null;
let replayOutcome: ReplayOutcome = 'settle';

/**
 * THE SAVED GAME — the record, the balance, the run ledger and the finished set, behind `SaveState`
 * (`game/save-state.ts`), which owns the rules over them. It is opened in `main()` before anything is issued;
 * the shell only ever reads it or calls one of its transitions, and `persist()` below is the one writer.
 *
 * THE DEFINITE-ASSIGNMENT `!` IS THE PRICE OF THAT ORDER. Every reader here is a handler or a paint that only
 * runs once the page is live, and the page is live only after `main()` has opened it — so the only way to read
 * an unopened state is to call a handler before boot, which no code path does. The alternative, a lazy
 * `openSave()` called from each reader, would put a storage question in every one of them.
 */
let save!: SaveState;

/** The id of the run in flight, generated once so recording it twice is idempotent (`recordRun` dedupes). */
let drillRunId = '';
let dailyRunId = '';
/** The wall clock the issued drill was handed out at, and the calls it has advanced with, both persisted. */
let drillIssuedAtMs = 0;
let drillOptions: string[] = [];

let lastFrameMs = 0;

const els = {
  labelHere: el('labelHere'),
  labelGoal: el('labelGoal'),
  regime: el('regime'),
  modeDrill: el<HTMLButtonElement>('modeDrill'),
  modeDaily: el<HTMLButtonElement>('modeDaily'),
  drillPanel: el('drill'),
  dailyPanel: el('daily'),
  balance: el('balance'),
  ledger: el('ledger'),
  hint: el<HTMLButtonElement>('hint'),
  review: el<HTMLButtonElement>('review'),
  undo: el<HTMLButtonElement>('undo'),
  redo: el<HTMLButtonElement>('redo'),
  giveUp: el<HTMLButtonElement>('giveUp'),
  replayMine: el<HTMLButtonElement>('replayMine'),
  replayShortest: el<HTMLButtonElement>('replayShortest'),
  view: el<HTMLButtonElement>('view'),
  next: el<HTMLButtonElement>('next'),
  loading: el('loading'),
};

const drillScreen = new DrillScreen(answer);
const dailyScreen = new DailyScreen({ play: playDailyCall });
const stage = new GameStage(el<HTMLCanvasElement>('stage'));

// ---------------------------------------------------------------------------------------------- the rails

/**
 * Build the level's runtime, once per level, and remember it.
 *
 * THE SLICE IS THE LEVEL, so both modes share one `Sequencer` built from the level's own titles: the Daily
 * and the Drill must agree about legality, and two runtimes would be two answer sets.
 */
function useLevel(next: LevelSpec): void {
  if (level?.index === next.index && applier) return;
  const runtime = createLevelRuntime(next, MAIN_POOL);
  level = next;
  applier = runtime.applier;
  // A NEW LEVEL IS A NEW REGIME: the Daily is issued per level (DESIGN.md 9), so the run goes with it.
  daily = null;
  if (runtime.registered < next.poolSize) {
    // NOT FATAL, AND NOT SILENT: a title in the level that the corpus does not carry is a data question the
    // ladder census reports, and saying so here is what stops it being discovered as a mysterious difficulty.
    console.warn(`level ${next.index} asks for ${next.poolSize} calls and the corpus carries ${runtime.registered}`);
  }
}

/** The board captions, from the engine's own names (DESIGN.md 15 Q10 — display only, never a correctness test). */
function captions(here: Board, goal: Board): void {
  const name = (b: Board): string => applier?.nameOf(b) ?? '';
  const hereName = name(here);
  const goalName = name(goal);
  els.labelHere.textContent = hereName ? `You are here — ${hereName}` : 'You are here';
  els.labelGoal.textContent = goalName ? `Get here — ${goalName}` : 'Get here';
}

/** The hint balance and the progress towards the next one (DESIGN.md 10: silent progress, announced grant). */
function paintBalance(): void {
  const p = earningProgress(save.hints);
  els.balance.textContent = p.full
    ? `Hints: ${save.hints.hints} of 3 — full, so successes stop counting`
    : `Hints: ${save.hints.hints} of 3 · ${p.successes} of ${p.needed} to the next`;
  // THE HINT BUTTON BELONGS TO THE DAILY, because that is the mode it is spent on (DESIGN.md 10), and it is
  // hidden rather than merely disabled once the run is over — there is nothing left to be hinted.
  const playing = daily !== null && daily.view(performance.now()).outcome === 'playing';
  els.hint.hidden = mode !== 'daily' || !playing;
  els.hint.disabled = save.hints.hints <= 0 || !playing;
}

// -------------------------------------------------------------------------------------------- the saved game

/**
 * The browser's storage, or a stand-in that refuses.
 *
 * THE PROPERTY ACCESS IS THE THING THAT THROWS, not the read: a blocked origin raises on `window.localStorage`
 * itself, so a `try` around the first `getItem` would never see it. A stand-in that throws on both calls is
 * what makes `loadGame` report `saving: false` and the footer say what is true.
 */
function browserStorage(): StorageLike {
  try {
    const store = window.localStorage;
    if (store) return store;
  } catch {
    /* a blocked origin throws here rather than on the first call */
  }
  return {
    getItem: () => {
      throw new Error('local storage is not available');
    },
    setItem: () => {
      throw new Error('local storage is not available');
    },
  };
}

const storage = browserStorage();

/** The issued drill as a record, or null when there is nothing in flight to resume. */
function drillSavedState(): DrillSaved | null {
  if (!controller || controller.atEnd) return null;
  return {
    runId: drillRunId,
    startedAtMs: drillIssuedAtMs,
    attempts: controller.attempts,
    index: controller.view().stepIndex,
    options: [...drillOptions],
  };
}

/**
 * Hand the live state to the saved game and write it. THE SHELL'S ONLY WRITE, and it builds no record itself.
 *
 * IT IS CALLED AFTER EVERY MUTATION rather than on a timer: a mutation is the only thing that changes what is
 * stored, the record is a couple of kilobytes, and a periodic save would be a second schedule to reason about
 * (and would still lose the last move). What is NOT saved on a timer is the CLOCK — a resume charges the wall
 * gap from `savedAtMs`, so the elapsed does not have to be written every second to stay honest.
 *
 * `null` FOR THE DAILY MEANS "KEEP WHAT IS STORED", which is what makes a drill mutation harmless to an
 * un-resumed attempt; the rule and its measurement live in `save-state.ts` rule 3.
 */
function persist(): void {
  save.persist({
    levelIndex: level?.index ?? save.levelIndex,
    position,
    drill: drillSavedState(),
    daily: daily && dailyDay ? daily.save(dailyDay, dailyRunId, performance.now(), Date.now()) : null,
    wallNowMs: Date.now(),
  });
  paintLedger();
}

/** What is kept on this device, or that nothing is. */
function paintLedger(): void {
  const count = save.runs.length;
  const best = save.best;
  els.ledger.textContent = save.saving
    ? count === 0
      ? 'Saved on this device: nothing yet'
      : `Saved on this device: ${count} run${count === 1 ? '' : 's'}${best === null ? '' : ` · best ${best}`}`
    : 'Saving is off — this browser blocks local storage, so progress will not be kept.';
}

/**
 * Record a completed Drill run, ONCE.
 *
 * `runId` IS GENERATED WHEN THE DRILL IS ISSUED rather than here, so a second call for the same run is
 * deduped by `recordRun` instead of appending a duplicate — the same idempotence Phase 5's claim has, and the
 * reason a screen that repaints after a solve cannot double-count.
 */
function recordDrillRun(seed: number, elapsedSeconds: number, score: number): number {
  return save.addRun({
    runId: drillRunId,
    mode: 'drill',
    levelIndex: level?.index ?? 1,
    poolVersion: MAIN_POOL.version,
    seed,
    position,
    options: [...drillOptions],
    elapsedSeconds,
    attempts: controller?.attempts ?? 0,
    score,
    scoreVersion: SCORE_VERSION,
    recordedAtMs: Date.now(),
  });
}

/** Record a completed Daily run. Only a SOLVED one: a run nobody finished is not a run to submit (§11). */
function recordDailyRun(seed: number, elapsedSeconds: number, score: number): number {
  if (!daily) return 0;
  return save.addRun({
    runId: dailyRunId,
    mode: 'daily',
    levelIndex: dailyLevelIndex,
    poolVersion: MAIN_POOL.version,
    seed,
    day: dailyDay,
    moves: daily.view(performance.now()).moves,
    hintsUsed: daily.view(performance.now()).hintsUsed,
    elapsedSeconds,
    attempts: 0,
    score,
    scoreVersion: SCORE_VERSION,
    recordedAtMs: Date.now(),
  });
}

/**
 * Switch to a mode from a CLICK on the mode switch.
 *
 * CLICKING THE MODE YOU ARE ALREADY IN DOES NOTHING. Without this the Drill button re-issues the current
 * drill and throws away the player's progress, which is not what a tab that already looks selected should do
 * — and the Daily keeps its clock while the Drill restarts, which is two behaviours for one control.
 * (A stuck player has "Show me the answer"; a restart is not a feature this control implies.)
 *
 * IT IS A WRAPPER AROUND `applyMode` AND NOT A GUARD INSIDE IT, which is a defect the browser found within
 * minutes of the guard being written: `main` opens with `mode === 'drill'` already, so a guarded `setMode`
 * returned immediately and started NOTHING — an empty page whose only live control was the 3D switch. The
 * opening call needs the unguarded version, and the click needs the guard, so the two are two functions.
 */
function setMode(next: AppMode): void {
  if (next === mode) return;
  applyMode(next);
}

/** Put the app in `next`, whatever it was in before. */
function applyMode(next: AppMode): void {
  mode = next;
  PLAYHEAD.cancel();
  replay = null;
  els.drillPanel.hidden = mode !== 'drill';
  els.dailyPanel.hidden = mode !== 'daily';
  els.modeDrill.setAttribute('aria-pressed', String(mode === 'drill'));
  els.modeDaily.setAttribute('aria-pressed', String(mode === 'daily'));
  els.review.hidden = true;
  els.next.hidden = true;
  els.undo.hidden = mode !== 'daily';
  els.redo.hidden = mode !== 'daily';
  els.giveUp.hidden = mode !== 'daily';
  els.replayMine.hidden = true;
  els.replayShortest.hidden = true;
  if (mode === 'drill') issueCurrentDrill('current');
  else startDaily();
}

// ----------------------------------------------------------------------------------------------- the drill

/**
 * Show a drill: generate it from a seed and start the run.
 *
 * ONE PATH FOR TWO SOURCES. The seed comes either from the local fixture (offline) or from the server (which owns
 * the order, §8), and everything after the seed is identical — the generator the client runs, the resume of a
 * half-played drill, the clock, the header and the save. Splitting that in two would be two ways to show a drill.
 */
function showDrill(issued: { seed: number; levelIndex: number; index: number; length: number }): void {
  const spec = levelSpec(issued.levelIndex);
  if (!spec) throw new Error(`level ${issued.levelIndex} is not a level`);
  position = issued.index;
  useLevel(spec);
  if (save.resumed && save.levelIndex !== spec.index) {
    // THE SOURCE OF THE SEED IS THE REGIME, and the save's level is a record of what the app last believed. A
    // disagreement means the regime moved under the player, which is a data question to report rather than to
    // hide (AGENTS.md 4.1) — and the regime wins, because the entry IS the question.
    console.warn(`the save has level ${save.levelIndex} and drill ${position + 1} is level ${spec.index}; the regime wins`);
  }
  const result = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec), issued.seed, spec, applier as GameApplier);
  els.loading.hidden = true;

  if (!result.ok) {
    // A REFUSAL IS A RESULT: the generator says why, and the screen shows it rather than an empty board.
    controller = null;
    drillScreen.say(`This drill cannot be generated: ${result.reason}`, 'bad');
    drillScreen.render(controller);
    return;
  }

  // A SAVED DRILL AT THIS POSITION IS CONTINUED, not re-drawn: DESIGN.md 8 locks a drill when it is issued,
  // so the same seed comes back with the step the player had reached and the wrong tries already taken, and
  // the clock carries the time the page was closed. A record for a DIFFERENT position is left alone — that is
  // a drill the player has moved past, and its position is what says so.
  const carrying: DrillSaved | null = save.drillRun && save.position === position ? save.drillRun : null;
  controller = new DrillController(
    result.puzzle,
    carrying ? { index: carrying.index, attempts: carrying.attempts } : {},
  );
  drillOptions = carrying ? [...carrying.options] : [];
  drillIssuedAtMs = carrying ? carrying.startedAtMs : Date.now();
  drillRunId = carrying ? carrying.runId : newRunId(Date.now());
  drillClock = new Stopwatch();
  if (carrying) {
    // THE ELAPSED IS WALL TIME because the issue stamp is: the run began when the entry was SHOWN, so the
    // minute the page spent closed is a minute of the run (and a reload is therefore not a pause).
    drillClock.resume(performance.now(), Math.max(0, Date.now() - carrying.startedAtMs));
  } else {
    drillClock.start(performance.now());
  }
  PLAYHEAD.cancel();
  replay = null;
  els.regime.textContent = `The Drill — drill ${position + 1} of ${issued.length}, level ${spec.index}`;
  drillScreen.clearVerdict();
  drillScreen.render(controller);
  els.review.hidden = false;
  els.next.hidden = true;
  captions(result.puzzle.start, result.puzzle.goal);
  paintBalance();
  persist();
  draw();
}

/** The OFFLINE path: the local fixture's entry at a position. */
function startDrill(next: number): void {
  const length = scheduleLength();
  const at = ((next % length) + length) % length;
  els.loading.hidden = false;
  els.loading.textContent = `Generating drill ${at + 1} of ${length}…`;
  const entry = scheduleEntryFor(at);
  showDrill({ seed: entry.seed, levelIndex: entry.levelIndex, index: at, length });
}

/**
 * The SERVER path: the drill this player is on, issued or resumed by the server (DESIGN.md 8).
 *
 * THE SERVER OWNS THE ORDER, so `advance` is what moves the player on — not a local position counter — and the
 * header's count is the server's regime rather than the fixture's length. The local save still records the run and
 * the local balance, because the SERVER's ledger becomes authoritative only when a completed run is submitted
 * (`POST /runs`, the next step): until then this is the same app with a server-issued question.
 */
async function startServerDrill(next: 'current' | 'advance'): Promise<void> {
  els.loading.hidden = false;
  els.loading.textContent = next === 'advance' ? 'Asking the server for your next drill…' : 'Asking the server for your drill…';

  if (next === 'advance' && serverDrill) {
    const advanced = await advanceDrill(serverDrill.id);
    if (!advanced.ok) {
      els.loading.hidden = true;
      controller = null;
      drillScreen.say(`The server would not advance this drill: ${advanced.failure.message}`, 'bad');
      drillScreen.render(controller);
      return;
    }
  }
  // A LEVEL IS ASKED FOR, NOT DECIDED: the player's level comes from the save (1 until there is a ladder to move
  // up), and the answer's level is adopted when it differs — a schedule that moved is a fact, not a mistake.
  const answer = await issueDrill(save.levelIndex || 1);
  if (!answer.ok) {
    els.loading.hidden = true;
    controller = null;
    drillScreen.say(`No drill from the server: ${answer.failure.message}`, 'bad');
    drillScreen.render(controller);
    return;
  }
  serverDrill = answer.value.drill;
  serverRegime = answer.value.regime;
  showDrill({ seed: serverDrill.seed, levelIndex: serverDrill.levelIndex, index: serverDrill.index, length: serverRegime.length });
}

/** Issue the drill from wherever the app is configured to get it. */
function issueCurrentDrill(next: 'current' | 'advance'): void {
  if (apiConfigured()) void startServerDrill(next);
  else if (next === 'advance') startDrill(position + 1);
  else startDrill(position);
}

/** Answer the current step. */
function answer(choice: number | 'unknown'): void {
  if (!controller || !applier || PLAYHEAD.isRunning) return;
  let result;
  try {
    result = controller.answer(choice);
  } catch (error) {
    // AN OUT-OF-RANGE INDEX IS A UI BUG, and the controller throws rather than calling it a wrong answer.
    // Surfacing it as a message beats a silent no-op on a button that looked live.
    drillScreen.say(error instanceof Error ? error.message : String(error), 'bad');
    return;
  }

  if (result.kind === 'illegal') {
    // NO MOTION: an illegal application leaves the board unchanged, so there is nothing to animate — which
    // is exactly why the illegal choice is a separate field on the step rather than one of the options.
    drillScreen.say(`That cannot be called from here. ${result.reason ?? ''}`.trim(), 'bad');
    settleDrill();
    // THE ATTEMPT IS PERSISTED EVEN THOUGH THE BOARD DID NOT MOVE: a refused call is one of the wrong tries
    // the score is priced on, and a reload must not forgive it.
    persist();
    return;
  }

  // THE MOTION IS THE ENGINE'S OWN WALK OF THIS ONE CALL, and its length is the walk's beats rather than a
  // duration chosen here: a Swing takes longer to dance than a Touch a Quarter, and a fixed 700 ms made every
  // call the same length.
  if (result.kind === 'correct') {
    // THE CALLED PATH IS THE RUN'S TRANSCRIPT: one entry per step the player advanced, which is what the
    // Drill's submission carries (§11: the server re-derives which option was correct, so this is the claim).
    drillOptions.push(result.call);
    drillScreen.say(`${result.call} — correct.`, 'ok');
    startReplay(applier.motion([result.call], result.replayFrom as Board), 'advance');
  } else {
    // A WRONG ANSWER STATES WHERE IT WENT, not just that it was wrong. The ending board is on screen by the
    // time this is read, so the sentence and the picture say the same thing.
    drillScreen.say(`${result.call} is legal, but it does not leave the set on the goal board.`, 'bad');
    startReplay(applier.motion([result.call], result.replayFrom as Board), 'settle');
  }
  persist();
}

/**
 * The answer, on request — DESIGN.md §8's review.
 *
 * IT ADVANCES NOTHING AND SCORES NOTHING: the review names the call and dances it, and the player still has
 * to press it, so the step is not answered here — which is why this is a plain `settle` and not a third
 * outcome. That the revealed call then counts as a normal correct answer when the player does press it is a
 * fairness question this phase does not settle; DESIGN.md 15 records it, and the server owns hint-earning
 * from Phase 5 (DESIGN.md 10: the ledger is not the client's to award).
 */
function review(): void {
  if (!controller || !applier || PLAYHEAD.isRunning || controller.atEnd) return;
  const option = controller.review();
  drillScreen.say(`The answer is ${option.call}.`, 'info');
  startReplay(applier.motion([option.call], controller.view().from), 'settle');
}

/** The step is over: redraw, and score the run if the last step has just been answered. */
function settleDrill(): void {
  if (!controller) return;
  drillScreen.render(controller);
  captions(controller.view().from, controller.puzzleRef.goal);
}

/**
 * The last answer was correct: stop the clock, score the run, and record ONE drill success.
 *
 * A DRILL'S `moves` IS ITS SHORTEST, because the mode is one call per step and prices wrong ANSWERS through
 * `attemptFactor` (DESIGN.md 6) — it has no notion of a wasted move, which is the Daily's `wasteFactor`.
 */
function finishDrill(): void {
  if (!controller) return;
  drillClock.stop(performance.now());
  const score = scoreRun({
    level: controller.puzzleRef.level,
    shortest: controller.puzzleRef.shortest,
    moves: controller.puzzleRef.shortest,
    clockSeconds: drillClock.elapsedSeconds(performance.now()),
    hintsUsed: 0,
    attempts: controller.attempts,
  });
  const tries = controller.attempts === 0 ? 'first try' : `${controller.attempts} wrong ${controller.attempts === 1 ? 'try' : 'tries'}`;
  drillScreen.say(`Solved in ${score.elapsedSeconds.toFixed(1)} s, ${tries} — ${score.score} points.`, 'ok');
  els.review.hidden = true;
  els.next.hidden = false;
  // A COMPLETED DRILL IS ONE SUCCESS — ONCE. A success is a correct answer whether first try or after
  // replays (DESIGN.md 10), but re-solving a drill the player has ALREADY finished is not a ranked answer:
  // DESIGN.md 11's Progress keeps "the set of finished ones", and without that set a reload (which re-issues
  // the entry) or a Next-and-return would mint a hint every time. The BALANCE is the thing worth protecting
  // here — the board cannot be farmed either way, because it takes the player's best (§6).
  const success = save.countSuccess(position);
  if (success.granted) drillScreen.say(`Solved — and that earned a hint (${save.hints.hints} of 3 held).`, 'ok');
  drillScreen.render(controller);
  captions(controller.view().from, controller.puzzleRef.goal);
  paintBalance();
  // ONE RUN, RECORDED ONCE, keyed on the id issued with the drill — so a repaint after the solve appends
  // nothing. `scheduleEntryFor` is where the seed comes from, and it is the same one the puzzle was built on.
  recordDrillRun(scheduleEntryFor(position).seed, score.elapsedSeconds, score.score);
  persist();
}

// ----------------------------------------------------------------------------------------------- the daily

/**
 * Issue today's challenge at the player's level.
 *
 * THE DAY IS UTC AND THE SEED BINDS THE LEVEL (`puzzle/daily.ts`), so every player at this level is asked the
 * same question today — which is why a level change re-issues. A Daily already in progress is KEPT, so
 * switching to the Drill and back does not restart its clock (a reload still would, and persisting it is
 * Phase 4's).
 */
/** The Daily's header line, from the run's own day and level — so the kept path and the issue path agree. */
function dailyRegime(): string {
  return daily && dailyDay ? `Today's Daily — ${dailyDay} (UTC), level ${dailyLevelIndex}` : "Today's Daily";
}

function startDaily(): void {
  if (!applier || !level) return;
  const day = utcDay(new Date());
  if (daily && dailyDay === day && dailyLevelIndex === level.index) {
    // AN ISSUED DAILY IS NOT RE-ISSUED, so its clock keeps running across a mode switch: re-issuing would
    // hand out free thinking time for pressing a button. Everything else on screen IS re-applied, because it
    // belongs to this mode — a defect the browser showed twice: a stale "You are here" name left over from
    // the Drill, and a header still reading "The Drill — drill 1 of 12" above the Daily's own panel.
    els.regime.textContent = dailyRegime();
    captions(daily.board, daily.view(performance.now()).goal);
    paintDaily();
    draw();
    return;
  }

  els.loading.hidden = false;
  els.loading.textContent = "Generating today's Daily…";
  const entry = dailyEntry(level, MAIN_POOL.version, day);
  const result = generatePuzzle(generatorConfigFor(entry.poolVersion, level, 'daily'), entry.seed, level, applier);
  els.loading.hidden = true;

  if (!result.ok) {
    // NO FALLBACK, deliberately (DESIGN.md 9): another seed would be a different challenge from everyone
    // else's, which is the one thing the mode promises. The reason shown is the generator's own.
    daily = null;
    dailyScreen.say(`Today's Daily could not be generated: ${result.reason}`, 'bad');
    els.regime.textContent = "Today's Daily — unavailable";
    return;
  }

  dailyDay = day;
  dailyLevelIndex = level.index;
  dailyRunSeed = entry.seed;
  // A SAVED ATTEMPT FOR TODAY IS PICKED UP. The challenge is a pure function of (day, level), so the puzzle
  // regenerated here IS the one that was being played; what the record adds is the line, the hints and the
  // clock — with the wall time the page was away charged to it. A record that no longer describes this
  // puzzle (a pool or corpus change) comes back null and is simply not carried.
  const stored = save.daily;
  const carried = stored && stored.day === day && stored.levelIndex === level.index
    ? DailyRun.resume(result.puzzle, applier, performance.now(), stored, { gapMs: wallGapMs(stored.savedAtMs, Date.now()) })
    : null;
  daily = carried ?? new DailyRun(result.puzzle, applier, performance.now());
  dailyRunId = carried && stored ? stored.runId : newRunId(Date.now());
  els.regime.textContent = dailyRegime();
  dailyScreen.say(
    carried
      ? 'Picked up where you left off — the time the page was away is on the clock.'
      : 'Add calls until the set is on the goal board. Undo is free; the allowance is not.',
    'info',
  );
  captions(daily.board, daily.view(performance.now()).goal);
  paintDaily();
  persist();
  draw();
}

function playDailyCall(call: string): void {
  if (!daily || !applier || PLAYHEAD.isRunning) return;
  const from = daily.board;
  const result = daily.play(call, performance.now());
  if (result.verdict === 'illegal' || result.verdict === 'over') {
    // THE ENGINE'S REASON IS SHOWN VERBATIM (DESIGN.md 4.1) and the budget's is the run's own prose, so only
    // the run's is tidied into a sentence — capitalising an engine string would be rewording it.
    dailyScreen.say(
      result.verdict === 'over' ? cap(result.reason ?? '') : `That cannot be called from here. ${result.reason ?? ''}`.trim(),
      'bad',
    );
    paintDaily();
    return;
  }
  if (result.verdict === 'wrong') dailyScreen.say(`${call} is legal, but the set is not on the goal board yet.`, 'info');
  else dailyScreen.say(`${call} — that is the goal board.`, 'ok');
  persist();
  startReplay(applier.motion([call], from), result.verdict === 'correct' ? 'advance' : 'settle');
}

function undoDaily(): void {
  if (!daily || PLAYHEAD.isRunning) return;
  if (!daily.undo()) return;
  dailyScreen.say('Undone — and the clock kept running, and any hint is still spent.', 'info');
  paintDaily();
  persist();
  draw();
}

function redoDaily(): void {
  if (!daily || PLAYHEAD.isRunning) return;
  if (!daily.redo()) return;
  dailyScreen.say('Redone.', 'info');
  paintDaily();
  persist();
  draw();
}

/** Take a hint: the ledger is asked first, and only a granted spend charges the run. */
function takeHint(): void {
  if (!daily || PLAYHEAD.isRunning) return;
  if (save.hints.hints <= 0) {
    dailyScreen.say('You have no hints — one is earned every ten solved drills.', 'bad');
    return;
  }
  const hint = daily.takeHint();
  if (!hint.spent || !hint.call) {
    // The balance allows a spend but there is nothing to name, so the run is NOT charged: a hint that cannot
    // say anything is not a hint (DESIGN.md 10).
    dailyScreen.say('There is nothing to hint from here.', 'bad');
    return;
  }
  // THE BALANCE WAS CHECKED BEFORE THE RUN WAS TOUCHED, and nothing between that read and this charge can
  // change it (a synchronous straight line), so the spend cannot find an empty ledger here.
  save.spendHint();
  dailyScreen.say(`Hint: ${hint.call}. A minute has been added to the clock, and it is not refunded.`, 'info');
  paintDaily();
  persist();
}

function giveUpDaily(): void {
  if (!daily || PLAYHEAD.isRunning) return;
  daily.giveUp(performance.now());
  dailyScreen.say('Given up. Both lines are available to replay.', 'bad');
  paintDaily();
  persist();
}

/** Replay a whole line through the engine's walk, from the board the challenge was issued on. */
function replayLine(which: 'mine' | 'shortest'): void {
  if (!daily || !applier || PLAYHEAD.isRunning) return;
  const { mine, shortest } = daily.review();
  const calls = which === 'mine' ? mine : shortest;
  if (calls.length === 0) {
    dailyScreen.say('There is no line to replay yet.', 'bad');
    return;
  }
  dailyScreen.say(`Replaying ${which === 'mine' ? 'your' : 'the shortest'} line: ${calls.join(' → ')}.`, 'info');
  startReplay(applier.motion(calls, daily.start), 'settle');
}

/** The engine's refusal prose, tidied for a sentence. The string itself is never reworded. */
function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// --------------------------------------------------------------------------------------------- the drawing

function paintDaily(): void {
  if (!daily) return;
  const view = daily.view(performance.now());
  dailyScreen.show(view);
  // A SOLVED RUN IS RECORDED FROM HERE, and recording is idempotent on `dailyRunId` — so this can live in a
  // paint that the frame loop calls, and only a NEW entry is written to storage.
  if (view.outcome === 'solved' && view.result) {
    if (recordDailyRun(dailyRunSeed, view.result.elapsedSeconds, view.result.score) > 0) persist();
  }
  // THE REVIEW BUTTONS APPEAR WHEN THE RUN IS OVER (DESIGN.md 9: "on solving, or on giving up, the player can
  // replay their own line and the generator's shortest line").
  const over = view.outcome !== 'playing';
  els.replayMine.hidden = !over;
  els.replayShortest.hidden = !over;
  els.giveUp.hidden = over;
  els.undo.hidden = over;
  els.redo.hidden = over;
  paintBalance();
}

function goalBoard(): Board | null {
  if (mode === 'daily') return daily ? daily.view(performance.now()).goal : null;
  return controller ? controller.puzzleRef.goal : null;
}

function draw(): void {
  const stageNow = stage;
  if (replay) {
    const goal = goalBoard();
    if (goal) {
      // A REPLAY IS DRAWN FROM THE ENGINE'S OWN WALK, sampled at the playhead's beat — and a FINISHED one
      // keeps its landing board on screen, because that is the whole teaching content of a wrong answer:
      // where the call you chose actually leaves the set.
      stageNow.drawMotion(replay, goal, PLAYHEAD.beat);
      return;
    }
  }
  if (mode === 'daily' && daily) stageNow.drawStill(daily.board, daily.view(performance.now()).goal);
  else if (controller) {
    const view = controller.view();
    stageNow.drawStill(view.from, view.goal);
  }
}

/** Start a replay of `motion`, and what finishing it means. */
function startReplay(motion: SequenceMotion, outcome: ReplayOutcome): void {
  replay = motion;
  replayOutcome = outcome;
  setBusy(true);
  PLAYHEAD.start(motion.beats);
}

function setBusy(busy: boolean): void {
  drillScreen.setBusy(busy);
  dailyScreen.setBusy(busy);
}

function toggleView(): void {
  viewMode = viewMode === '2d' ? '3d' : '2d';
  stage.setMode(viewMode);
  els.view.textContent = viewMode === '2d' ? 'Switch to 3D' : 'Switch to 2D';
  draw();
}

function frame(nowMs: number): void {
  const dt = lastFrameMs === 0 ? 16 : Math.min(100, nowMs - lastFrameMs);
  lastFrameMs = nowMs;
  if (PLAYHEAD.isRunning) {
    const finished = PLAYHEAD.advance(dt);
    draw();
    if (finished) {
      setBusy(false);
      const outcome = replayOutcome;
      replay = null;
      replayOutcome = 'settle';
      if (mode === 'drill') {
        // A CORRECT ANSWER SETTLES ON ITS LANDING BOARD AND THEN THE STEP ADVANCES, so the player sees where
        // the call left the set — which is the state the NEXT question is asked from. A WRONG answer keeps its
        // message and its landing board, which is why it only redraws. A REVIEWED answer advances the step and
        // is scored for nothing.
        if (outcome === 'advance') {
          if (controller?.atEnd) finishDrill();
          else settleDrill();
        } else settleDrill();
      } else if (mode === 'daily') {
        paintDaily();
      }
      draw();
    }
  } else if (mode === 'daily' && daily) {
    // THE CLOCK IS DRAWN FROM THE FRAME LOOP because it runs whether or not anything is moving, and only the
    // readout is touched — `writeClock` compares the string first, so this is not 60 DOM writes a second.
    dailyScreen.writeClock(daily.view(performance.now()));
  }

  // THE CAMERA AND THE DRAW RUN EVERY FRAME, NOT ONLY DURING A REPLAY. Two different jobs: `updateControls`
  // glides the orbit/pan damping, and `render` is what actually PAINTS — the stage owns no animation loop, so
  // a frame that poses views and never renders shows a blank canvas. That is exactly what the first version of
  // this loop did: it rendered nothing while idle, so the boards were black until an option was clicked.
  stage.updateControls();
  stage.render();
  requestAnimationFrame(frame);
}

function main(): void {
  stage.setMode(viewMode);
  els.view.textContent = 'Switch to 3D';
  els.loading.hidden = true;

  // THE SAVED GAME IS READ BEFORE ANYTHING IS ISSUED, so the first drill is the one the player was on and
  // the balance is the one they earned. What a record means is `store.ts`'s decision: an absent one, an older
  // schema or unreadable text yields no state and a fresh game, a moved pool keeps the hints and drops the
  // rest, and every field is clamped. A record the loader had to DROP is reported rather than swallowed,
  // because a loader's silence about bad data is itself a bug (AGENTS.md 4.1).
  const opened = SaveState.open(storage, MAIN_POOL.version);
  save = opened.state;
  position = save.position;
  if (opened.dropped > 0) console.warn(`${opened.dropped} saved record(s) were unusable and were discarded`);
  paintLedger();

  els.modeDrill.addEventListener('click', () => setMode('drill'));
  els.modeDaily.addEventListener('click', () => setMode('daily'));
  els.next.addEventListener('click', () => issueCurrentDrill('advance'));
  els.review.addEventListener('click', review);
  els.undo.addEventListener('click', undoDaily);
  els.redo.addEventListener('click', redoDaily);
  els.hint.addEventListener('click', takeHint);
  els.giveUp.addEventListener('click', giveUpDaily);
  els.replayMine.addEventListener('click', () => replayLine('mine'));
  els.replayShortest.addEventListener('click', () => replayLine('shortest'));
  els.view.addEventListener('click', toggleView);

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

  applyMode('drill');
  requestAnimationFrame(frame);
}

main();
