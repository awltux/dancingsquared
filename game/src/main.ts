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
import { scoreRun, type RunScore } from './puzzle/score.ts';
import { earningProgress } from './puzzle/hints.ts';
import { SCORE_VERSION } from './puzzle/config.ts';
import type { GameApplier, LevelSpec, SequenceMotion } from './puzzle/types.ts';
import { createLevelRuntime } from './data/corpus.ts';
import { DrillController } from './game/drill.ts';
import { DailyRun } from './game/daily-run.ts';
import { Stopwatch } from './game/clock.ts';
import { newRunId, wallGapMs, type DrillSaved, type StorageLike } from './game/store.ts';
import { advanceDrill, apiConfigured, browserDeps, dailyChallenge, importLedger, issueDrill, recordDrillAnswer, rememberAuthMode, spendHint, submitRun, type IssuedDrill, type RegimeCounts } from './net/api.ts';
import { confirmAccount, currentPlayer, discoverAuth, refreshIfExpired, signIn, signOut, signUp, type AuthMode, type SignedIn } from './net/auth.ts';
import { mayWrite, signInOffered, standingOf, type Standing } from './net/standing.ts';
import { SaveState } from './game/save-state.ts';
import { scheduleEntryFor, scheduleLength } from './game/schedule-fixture.ts';
import { GameStage, type ViewMode } from './render/stage-view.ts';
import { DrillScreen } from './ui/drill-screen.ts';
import { DailyScreen } from './ui/daily-screen.ts';
import { AccountScreen } from './ui/account-screen.ts';
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

/**
 * THE PRESSES POSTED SO FAR, as one chain, so the submission can wait for them (DESIGN.md 11.1, A22).
 *
 * ttempts is counted from what POST /drill/answer RECORDED, so a run submitted before its presses arrived is
 * refused 
o_press_log — a refusal this app would have caused itself rather than a cheat it caught. Chaining
 * rather than Promise.all keeps the recorded order the order the player pressed in, and the chain never rejects
 * (ecordDrillAnswer answers with an ApiResult), so one failed press does not stop the rest from being sent.
 */
let pressLog: Promise<unknown> = Promise.resolve();
/** Where the server says the player is in the regime, for the header and the report of a finished season. */
let serverRegime: RegimeCounts | null = null;

/**
 * WHO THE SERVER THINKS IS ASKING, as far as this app can tell (DESIGN.md §11.2).
 *
 * `authMode` IS DISCOVERED RATHER THAN COMPILED IN and `signinRoutes` comes from the same `/health` answer, so the
 * form is offered only where the server serves one. `player` is the session THIS DEVICE HOLDS — what the app can
 * read, not what the server will honour — and `standingOf` is the one place those are reconciled into what a run is
 * worth. `demoRun` is the server's own word about the drill on screen, which outranks both.
 */
let authMode: AuthMode | null = null;
let signinRoutes: readonly string[] = [];
let player: SignedIn | null = null;
let demoRun = false;

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
const accountScreen = new AccountScreen({
  signIn: (email, password) => void doSignIn(email, password),
  signUp: (email, password) => void doSignUp(email, password),
  confirm: (email, code) => void doConfirm(email, code),
  signOut: () => void doSignOut(),
});
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

/**
 * What the server will do with the run on screen, from the four facts the app holds.
 *
 * THE RULE IS IN `net/standing.ts` AND NOT HERE, because the shell is the layer no probe can load (AGENTS.md §1):
 * this function only gathers. `demoRun` is the server's own answer about the drill it issued, and it is passed in
 * rather than left to be inferred, because a client that decided for itself would rank a run the server has already
 * called a demo.
 */
function currentStanding(): Standing {
  return standingOf({ configured: apiConfigured(), mode: authMode, signedIn: player !== null, demo: demoRun });
}

/** The hint balance and the progress towards the next one (DESIGN.md 10: silent progress, announced grant). */
function paintBalance(): void {
  const p = earningProgress(save.hints);
  const held = p.full
    ? `Hints: ${save.hints.hints} of 3 — full, so successes stop counting`
    : `Hints: ${save.hints.hints} of 3 · ${p.successes} of ${p.needed} to the next`;
  // THE UNRANKED CLAUSE IS ON THE BALANCE BECAUSE THE BALANCE IS WHAT A DEMO CANNOT CHANGE (DESIGN.md §11.2): a
  // signed-out spend is answered `401`, so what is on screen is this device's own copy rather than the server's —
  // and saying so is the difference between a player who knows nothing is kept and one who finds out later.
  els.balance.textContent = currentStanding() === 'unranked' ? `${held} — this device's own balance, not the server's` : held;
  // THE HINT BUTTON BELONGS TO THE DAILY, because that is the mode it is spent on (DESIGN.md 10), and it is
  // hidden rather than merely disabled once the run is over — there is nothing left to be hinted.
  const playing = daily !== null && daily.view(performance.now()).outcome === 'playing';
  els.hint.hidden = mode !== 'daily' || !playing;
  els.hint.disabled = save.hints.hints <= 0 || !playing;
}

// ---------------------------------------------------------------------------------------------- the account

/**
 * Draw the account row, and repaint the two lines that claim what is kept.
 *
 * THE THREE GO TOGETHER BECAUSE ONE FACT DECIDES ALL THREE. Signing in does not merely change a button: it changes
 * whether the run on screen is ranked, so the ledger's sentence and the balance's clause are stale the moment the
 * session changes and repainting them here is what keeps one story on screen instead of three.
 */
function paintAccount(): void {
  accountScreen.show({
    standing: currentStanding(),
    mode: authMode,
    player,
    offersForm: signInOffered({ mode: authMode, signin: signinRoutes, pinned: apiDeps.modeOverride !== undefined }),
  });
  paintLedger();
  paintBalance();
}

/**
 * The session this device holds, or null — and null rather than a throw on a blocked origin.
 *
 * IT IS GUARDED BECAUSE IT READS `localStorage`: `SaveState.open` degrades the same way for the saved game, and a
 * page that would not start because it could not read a token is a worse answer than an anonymous one. It is NOT
 * evidence that the server will honour the token: that is what the refresh below and `standingOf` are for.
 */
function heldSession(): SignedIn | null {
  try {
    return currentPlayer(apiDeps);
  } catch {
    return null;
  }
}

/**
 * Settle the identity situation at boot: refresh a session that is due, learn the mode, then START the app.
 *
 * THIS RUNS BEFORE THE FIRST REQUEST IS SENT, and that ordering is a measured requirement rather than a
 * preference. `/health` is what says whether a signed-out caller is a DEVICE (`dev`, whose header the server
 * advertises in CORS) or a DEMO (a token mode, whose header it deliberately does not) — so a drill issued before
 * the answer would carry an identity the browser is not allowed to send, and would come back `TypeError — the
 * server could not be reached`. MEASURED in a browser against `DSQ_AUTH=emulate`. An anonymous first request is the
 * other wrong answer: under `dev` it is a demo, so the player's first run would not be kept. The app waits for the
 * one round trip instead, under the corpus's own loading line.
 *
 * THE REFRESH IS ASKED FOR RATHER THAN ASSUMED, and it is `refreshIfExpired` that decides — it compares the clock
 * first, so a reload does not spend a single-use refresh token every time (MEASURED as a fetch count in
 * `game/test/auth-client-probe.mjs`, which is why the rule lives there and not here). A session the server refuses
 * is OVER and is cleared by `auth.ts` rather than retried, so the app cannot sit on a dead token saying "signed in".
 */
async function bootAccount(): Promise<void> {
  els.loading.hidden = false;
  els.loading.textContent = 'Asking the server how it identifies players…';
  try {
    const refreshed = await refreshIfExpired(apiDeps);
    if (refreshed.kind === 'signed_out' || refreshed.kind === 'no_session') player = null;
  } catch {
    // A BLOCKED ORIGIN CANNOT BE READ, LET ALONE REFRESHED, AND THAT IS NOT A REASON TO STOP THE BOOT: the app goes
    // anonymous, exactly as `SaveState.open` opens a fresh game when storage cannot be read.
    player = null;
  }
  const discovered = await discoverAuth(apiDeps);
  if (discovered.ok) {
    authMode = discovered.value.mode;
    signinRoutes = discovered.value.signin;
  }
  // THE ANSWER GOES TO THE REQUEST LAYER, which is where the identity header is chosen — it is the one place that
  // knows whether this browser may send a device id at all, and it is a mode the shell has just learned.
  rememberAuthMode(authMode);
  paintAccount();
  // AND ONLY NOW IS THE FIRST QUESTION ASKED, with an identity the server will accept.
  applyMode('drill');
}

/** Sign in, and re-read everything the session decides. The refusals are the server's own sentences (§11.2). */
async function doSignIn(email: string, password: string): Promise<void> {
  accountScreen.setBusy(true);
  const answer = await signIn(email, password, apiDeps);
  accountScreen.setBusy(false);
  if (!answer.ok) {
    accountScreen.say(`Could not sign in — ${answer.failure.message}`, 'bad');
    return;
  }
  player = answer.value;
  accountChanged();
  // AND THE LEDGER GOES WITH IT. A26 keeps a device's runs as HISTORY, and this is the only moment the app can hand
  // them over: before the session there is no identity to import into, and the local ledger is what the offline game
  // counted instead (DESIGN.md §11's funnel — "a player with a score to lose is a player who signs up").
  void importDeviceLedger();
}

/**
 * Hand this device's ledger over as history (DESIGN.md §11.1, A26).
 *
 * THE WHOLE LEDGER GOES, AND THE SERVER MAKES THAT SAFE: an imported row is written once and never updated, so a
 * second sign-in re-sends it and the server skips what it already holds. That is why this app keeps no "already
 * imported" flag — a flag is one more thing that can disagree with the server, and the counts in the answer already
 * tell a first sign-in from a retry.
 *
 * AN EMPTY LEDGER IS THE ORDINARY CASE AND NOT AN ERROR, which is why `nothing_to_import` is reported to nobody: the
 * endpoint refuses an empty body, and A25's refusal tally is applied at the route table, so a request that could
 * only be refused would also make a new player look like someone probing the API.
 *
 * IT IS SAID IN THE ACCOUNT ROW, and after `accountChanged` for the same reason a failed sign-out is: the repaint is
 * what the session change implies, and this sentence is the extra fact about what happened to the runs.
 */
async function importDeviceLedger(): Promise<void> {
  const answer = await importLedger(save.runs);
  if (!answer.ok) {
    if (answer.failure.code !== 'nothing_to_import') {
      accountScreen.say(`Signed in as ${player?.email ?? ''} — but this device's runs were not imported: ${answer.failure.message}`, 'bad');
    }
    return;
  }
  const held = answer.value.skipped === 1 ? '1 run' : `${answer.value.skipped} runs`;
  accountScreen.say(
    answer.value.imported > 0
      ? `Signed in as ${player?.email ?? ''} — ${answer.value.imported} run${answer.value.imported === 1 ? '' : 's'} from this device imported as history: kept, and not ranked.`
      : `Signed in as ${player?.email ?? ''} — the server already held all ${answer.value.total} of this device's runs (${held} skipped).`,
    'ok',
  );
}

/**
 * Create an account, and reveal the confirm step when the server did not confirm it outright.
 *
 * `confirmCode` IS THE EMULATOR's, returned because there is no mail sender locally (`api/src/auth/emulator.ts`);
 * a real provider answers without one, which is why the code is OFFERED here and never required by the flow.
 */
async function doSignUp(email: string, password: string): Promise<void> {
  accountScreen.setBusy(true);
  const answer = await signUp(email, password, apiDeps);
  accountScreen.setBusy(false);
  if (!answer.ok) {
    accountScreen.say(`Could not create the account — ${answer.failure.message}`, 'bad');
    return;
  }
  if (!answer.value.confirmed) {
    accountScreen.askForCode(answer.value.confirmCode);
    accountScreen.say(`Account created — confirm ${answer.value.email} to finish.`, 'info');
    return;
  }
  accountScreen.say('Account created — sign in to be counted.', 'ok');
}

/** Hand back the confirmation code. Signing in is a separate step, because an account and a session are two facts. */
async function doConfirm(email: string, code: string): Promise<void> {
  accountScreen.setBusy(true);
  const answer = await confirmAccount(email, code, apiDeps);
  accountScreen.setBusy(false);
  if (!answer.ok) {
    accountScreen.say(`Could not confirm — ${answer.failure.message}`, 'bad');
    return;
  }
  accountScreen.say('Confirmed — sign in to be counted.', 'ok');
}

/**
 * Sign out, LOCALLY FIRST.
 *
 * A REFUSED SIGN-OUT MEANS "THE SERVER WAS NOT TOLD", NOT "YOU ARE STILL SIGNED IN" (`net/auth.ts`): the stored
 * tokens are gone either way, so the app's state changes and the sentence says which half happened. The status line
 * is written AFTER `accountChanged` for that reason — the repaint is what the state change implies, and this
 * sentence is the extra fact about it.
 */
async function doSignOut(): Promise<void> {
  accountScreen.setBusy(true);
  const answer = await signOut(apiDeps);
  accountScreen.setBusy(false);
  player = null;
  accountChanged();
  if (!answer.ok) accountScreen.say(`Signed out on this device — the server could not be told: ${answer.failure.message}`, 'bad');
}

/**
 * The session changed, so everything that depends on it is re-read.
 *
 * THE PUZZLE IS RE-ISSUED, and that is not a nicety: the SAME request is answered differently for a different
 * identity — a signed-out caller gets a demo with no Progress row, a signed-in one gets the drill their own row
 * holds — so keeping the board on screen would leave a run belonging to nobody. A run in flight is therefore
 * dropped, which is the honest outcome rather than a loss: it could not have been ranked either way.
 */
function accountChanged(): void {
  paintAccount();
  if (mode === 'drill') issueCurrentDrill('current');
  else issueDaily();
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

/**
 * THE API DEPENDENCIES, built once and shared.
 *
 * `browserDeps` is the one place `import.meta.env` and `window.localStorage` are read (`net/api.ts`), and the
 * account surface MUST write the session through the same ones the requests read it with — two sets of dependencies
 * would be two answers to "is this player signed in", which is the disagreement `session.ts` exists to prevent.
 * `modeOverride` is read off it rather than from `import.meta.env` here, for the same reason: a dependency is a
 * value a probe can hand over, and an env var read at the point of use is one no probe can reach.
 */
const apiDeps = browserDeps();

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
  if (!save.saving) {
    els.ledger.textContent = 'Saving is off — this browser blocks local storage, so progress will not be kept.';
    return;
  }
  const kept =
    count === 0
      ? 'Saved on this device: nothing yet'
      : `Saved on this device: ${count} run${count === 1 ? '' : 's'}${best === null ? '' : ` · best ${best}`}`;
  // A SIGNED-OUT LEDGER IS A FUNNEL, NOT A SCOREBOARD (DESIGN.md §11.2): the runs are real and kept, and they are
  // not ranked — which is the fact the old line left implicit until the server refused the submission.
  els.ledger.textContent = currentStanding() === 'unranked' ? `${kept} — unranked: the server is recording nothing for a signed-out player` : kept;
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
  else issueDaily();
}

// ----------------------------------------------------------------------------------------------- the drill

/**
 * Show a drill: generate it from a seed and start the run.
 *
 * ONE PATH FOR TWO SOURCES. The seed comes either from the local fixture (offline) or from the server (which owns
 * the order, §8), and everything after the seed is identical — the generator the client runs, the resume of a
 * half-played drill, the clock, the header and the save. Splitting that in two would be two ways to show a drill.
 */
function showDrill(issued: { seed: number; levelIndex: number; index: number; length: number; issuedAtMs?: number; demo?: boolean }): void {
  const spec = levelSpec(issued.levelIndex);
  if (!spec) throw new Error(`level ${issued.levelIndex} is not a level`);
  position = issued.index;
  // THE SERVER'S OWN WORD ABOUT THIS RUN, taken before anything can paint: `currentStanding` reads it to decide
  // whether the run may be submitted at all, and it is set on every issued drill (false for the offline path, where
  // there is no server to have said anything).
  demoRun = issued.demo === true;
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
  // WHEN THE DRILL WAS ISSUED IS THE SERVER'S FACT WHEN THERE IS A SERVER, and this line is a fix rather than a
  // detail. MEASURED IN A BROWSER, and it cost a refused run: the local save remembered a drill from 421 s earlier
  // while the server had re-issued the same position 19.8 s before (its store had been restarted), so the run
  // claimed 421.7 s and the server answered `impossible_elapsed` — correctly, because a claim longer than the drill
  // has existed is a lie about the run. The local `startedAtMs` is the OFFLINE origin, and the step and attempts
  // below are still restored from the save either way (they are the player's progress, not a clock).
  const originMs = issued.issuedAtMs ?? (carrying ? carrying.startedAtMs : Date.now());
  drillIssuedAtMs = originMs;
  drillRunId = carrying ? carrying.runId : newRunId(Date.now());
  drillClock = new Stopwatch();
  // THE ELAPSED IS WALL TIME because the issue stamp is: the run began when the entry was SHOWN, so the minute the
  // page spent closed is a minute of the run (and a reload is therefore not a pause).
  drillClock.resume(performance.now(), Math.max(0, Date.now() - originMs));
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
  showDrill({
    seed: serverDrill.seed,
    levelIndex: serverDrill.levelIndex,
    index: serverDrill.index,
    length: serverRegime.length,
    // THE SERVER'S ISSUE TIME, which is what the run's clock is measured against (§8: a drill is locked when it is
    // issued, and the server is the one that issued it).
    issuedAtMs: serverDrill.issuedAtMs,
    // AND WHETHER IT IS A DEMO. A signed-out caller is served the level's first entry with no Progress row written
    // and this flag set (§11.2), which is the server saying the run cannot be ranked — read from the answer rather
    // than inferred from the session the app happens to hold.
    demo: answer.value.demo,
  });
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
  // THE STEP IS READ BEFORE THE ANSWER, because a correct answer ADVANCES the machine — reading it afterwards would
  // file the press against the next question, which is a wrong count the server would then score on (A22).
  const stepIndex = controller.view().stepIndex;
  try {
    result = controller.answer(choice);
  } catch (error) {
    // AN OUT-OF-RANGE INDEX IS A UI BUG, and the controller throws rather than calling it a wrong answer.
    // Surfacing it as a message beats a silent no-op on a button that looked live.
    drillScreen.say(error instanceof Error ? error.message : String(error), 'bad');
    return;
  }

  // EVERY PRESS GOES TO THE SERVER, AS IT HAPPENS, and the chain is kept so the submission can wait for it: the
  // count that scores is the one the server recorded (DESIGN.md 11.1, A22), so a run whose presses had not arrived
  // would be refused `no_press_log` — a refusal this app would have caused itself. The chain is a promise chain
  // rather than `Promise.all` so the log's order is the order the player pressed.
  //
  // AND A PRESS IS A WRITE, so a demo does not send one: `POST /drill/answer` requires an identity (A20), and the
  // presses of a run that will never be submitted could only ever be refusals on A25's tally. The transcript still
  // accumulates locally, because the local run record keeps it.
  if (serverDrill && mayWrite(currentStanding())) {
    const drillId = serverDrill.id;
    const call = result.call;
    pressLog = pressLog.then(() => recordDrillAnswer(drillId, stepIndex, call));
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
  const clockSeconds = drillClock.elapsedSeconds(performance.now());
  const score = scoreRun({
    level: controller.puzzleRef.level,
    shortest: controller.puzzleRef.shortest,
    moves: controller.puzzleRef.shortest,
    clockSeconds,
    hintsUsed: 0,
    attempts: controller.attempts,
  });
  const tries = controller.attempts === 0 ? 'first try' : `${controller.attempts} wrong ${controller.attempts === 1 ? 'try' : 'tries'}`;
  drillScreen.say(`Solved in ${score.elapsedSeconds.toFixed(1)} s, ${tries} — ${score.score} points.`, 'ok');
  els.review.hidden = true;
  els.next.hidden = false;
  // A COMPLETED DRILL IS ONE SUCCESS — ONCE, and WHO COUNTS IT DEPENDS ON WHETHER THERE IS A SERVER. Offline the
  // local rule below runs, exactly as it has since Phase 4; with an API configured the SERVER credits it from its
  // own record of finished drills (DESIGN.md 11) and this app adopts the balance it answers with — so a modified
  // client cannot mint a hint (DESIGN.md 10). A submission that FAILS falls back to the local rule, because an
  // outage must not cost the player a success the device can still remember.
  // A DEMO RUN IS NOT SENT AT ALL, which is the second half of "the server records nothing for a signed-out
  // player" (A20): the server answers `demo: true` for a caller it served without a Progress row and refuses every
  // write with a `401`, so posting it buys nothing — and it would be COUNTED, because A25's refusal tally is applied
  // at the route table, so an honest signed-out player would look to the operator like someone probing the API. The
  // local rule credits the success instead, exactly as it does when the server cannot be reached.
  if (apiConfigured() && serverDrill && mayWrite(currentStanding())) void submitSolvedRun(score, clockSeconds);
  else creditLocally();
  drillScreen.render(controller);
  captions(controller.view().from, controller.puzzleRef.goal);
  paintBalance();
  // ONE RUN, RECORDED ONCE, keyed on the id issued with the drill — so a repaint after the solve appends
  // nothing. The seed comes from the issued drill (the server's, or the fixture's) and is the one the puzzle was
  // built on.
  recordDrillRun(issuedSeed(), score.elapsedSeconds, score.score);
  persist();
}

/** The seed the drill on screen was generated from — the server's, or the fixture's at this position. */
function issuedSeed(): number {
  return serverDrill ? serverDrill.seed : scheduleEntryFor(position).seed;
}

/**
 * Credit a solved drill LOCALLY: the offline rule, and the fallback when the server cannot be told.
 *
 * The guard is the same one `SaveState` has always owned — a position already counted earns nothing — because the
 * BALANCE is what a hint is and the BOARD cannot be farmed either way (§6).
 */
function creditLocally(): void {
  const success = save.countSuccess(position);
  if (success.granted) drillScreen.say(`Solved — and that earned a hint (${save.hints.hints} of 3 held).`, 'ok');
}

/**
 * Hand the solved run to the server and ADOPT what it decides.
 *
 * WHAT IS CLAIMED AND WHAT IS DECIDED: the calls played are the transcript, and the server re-derives which option
 * was correct at each step and clamps the score to what it can recompute (§6, §11). The balance it answers with
 * replaces the local one, and the score it answers with is the number the board will hold — so the line the player
 * reads last is the authoritative one rather than this app's preview of it.
 */
async function submitSolvedRun(score: RunScore, clockSeconds: number): Promise<void> {
  if (!controller || !serverDrill) return;
  // THE PRESSES FIRST. The run is scored on the tries the server recorded, so this waits for the last of them to
  // land rather than racing it — the one ordering this endpoint's contract requires (DESIGN.md 11.1, A22).
  await pressLog;
  const answer = await submitRun({
    runId: drillRunId,
    mode: 'drill',
    levelIndex: controller.puzzleRef.level.index,
    drillId: serverDrill.id,
    // TIME ON THE CLOCK ONLY: the hint charge is the server's arithmetic (§6), and the Drill spent none.
    elapsedSeconds: clockSeconds,
    hintsUsed: 0,
    // STILL SENT, AND STILL ONLY A CLAIM: the server counts the tries it recorded and keeps this number beside them
    // (A22), so a modified client that reports zero is not believed and an honest one whose count differs is visible
    // rather than wrong.
    attempts: controller.attempts,
    // ONE CALL PER STEP, in the order they were answered — the same transcript the offline ledger keeps.
    calls: [...drillOptions],
    score: score.score,
  });

  if (!answer.ok) {
    // AN OUTAGE IS NOT THE PLAYER'S LOSS: the local rule still counts the success, and the refusal is shown so the
    // gap is visible rather than hidden (`/me/runs:bulk` is what claims a local ledger later).
    creditLocally();
    drillScreen.say(`The server would not record this run: ${answer.failure.message}`, 'bad');
    paintBalance();
    persist();
    return;
  }
  save.adoptHints({ hints: answer.value.hints.hints, successes: answer.value.hints.successes });
  const clamped = answer.value.run.clamped ? ' Your own score was higher, so the server clamped it.' : '';
  drillScreen.say(
    `Recorded — the server scores it ${answer.value.run.score} points.` +
      ` Board: ${answer.value.board.score} over ${answer.value.board.runs} run(s).${clamped}`,
    'ok',
  );
  paintBalance();
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

/** An issued Daily is kept: re-issue it and its clock restarts, which is free thinking time for a button press. */
function keepDaily(): void {
  // EVERYTHING ELSE ON SCREEN IS RE-APPLIED, because it belongs to this mode — a defect the browser showed twice:
  // a stale "You are here" name left over from the Drill, and a header still reading "The Drill — drill 1 of 12"
  // above the Daily's own panel.
  if (!daily) return;
  els.regime.textContent = dailyRegime();
  captions(daily.board, daily.view(performance.now()).goal);
  paintDaily();
  draw();
}

/** Whether the Daily already in flight is today's, at this level. */
function dailyIsCurrent(day: string): boolean {
  return daily !== null && dailyDay === day && dailyLevelIndex === level?.index;
}

/**
 * Show today's challenge from a seed, however it was obtained.
 *
 * ONE PATH FOR TWO SOURCES, like `showDrill`: the client derives the puzzle either way, and what differs is where
 * the seed came from — the local `dailyEntry` (offline) or the published artefact (the server, §9).
 */
function showDaily(seed: number, day: string): void {
  if (!applier || !level) return;
  // THE DRILL'S DEMO FLAG DOES NOT CARRY OVER. `demo` is the server's word about an ISSUED DRILL
  // (`GET /drill/current`), and the Daily's answer carries no such flag — so leaving the last drill's value set
  // would mark a typed-in player's Daily unranked because of a board they left behind. The Daily's standing comes
  // from the mode and the session alone, which is the same rule that decides it before any drill has been issued.
  demoRun = false;
  els.loading.hidden = false;
  els.loading.textContent = "Generating today's Daily…";
  const result = generatePuzzle(generatorConfigFor(MAIN_POOL.version, level, 'daily'), seed, level, applier);
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
  dailyRunSeed = seed;
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

/** The OFFLINE path: the challenge derived from the day and the level (§9). */
function startDaily(): void {
  if (!applier || !level) return;
  const day = utcDay(new Date());
  if (dailyIsCurrent(day)) {
    keepDaily();
    return;
  }
  showDaily(dailyEntry(level, MAIN_POOL.version, day).seed, day);
}

/**
 * The SERVER path: today's PUBLISHED challenge (§9, §11).
 *
 * THE SEED IS READ, NOT DERIVED, and the client would compute the same number — the point is that it is the number
 * the boundary job validated and published for everyone at this level, so a day nobody published is a refusal
 * ("no published challenge") rather than a question nobody checked. The generator still runs HERE: §9 has the
 * client draw the board from the published seed.
 */
async function startServerDaily(): Promise<void> {
  if (!applier || !level) return;
  const day = utcDay(new Date());
  if (dailyIsCurrent(day)) {
    keepDaily();
    return;
  }
  els.loading.hidden = false;
  els.loading.textContent = "Asking the server for today's Daily…";
  const answer = await dailyChallenge(level.index, day);
  if (!answer.ok) {
    els.loading.hidden = true;
    daily = null;
    dailyScreen.say(`No Daily from the server: ${answer.failure.message}`, 'bad');
    els.regime.textContent = "Today's Daily — unavailable";
    return;
  }
  if (!answer.value.playable) {
    // A CHALLENGE FROM ANOTHER POOL IS NOT A CHALLENGE THIS BUILD CAN PLAY (§7.2), and saying so is better than
    // generating a board the server would refuse to score.
    els.loading.hidden = true;
    daily = null;
    dailyScreen.say(`Today's Daily was published against pool ${answer.value.poolVersion}, and this build serves ${MAIN_POOL.version}.`, 'bad');
    els.regime.textContent = "Today's Daily — unavailable";
    return;
  }
  showDaily(answer.value.seed, day);
}

/**
 * Hand a solved Daily to the server, and adopt what it decides.
 *
 * THE HINT DEBIT IS THE REASON THIS EXISTS. Offline, a hint is debited the moment it is taken (`takeHint`), because
 * the device is the only record. With a server, the balance is ITS (DESIGN.md 10, 11), and the debit it applies is
 * the `hintsUsed` in the transcript — so the server's answer is what the app adopts, and a modified client that
 * reported zero hints would still have spent one on the device it lied from. What remains OUTSIDE the server's
 * knowledge is a Daily that is never submitted at all: an abandoned run owes a hint nobody debits (DESIGN.md §15
 * Q19 records that, with the fix it needs).
 */
async function submitSolvedDaily(run: DailyRun): Promise<void> {
  const facts = run.submissionFacts(performance.now());
  const answer = await submitRun({
    runId: dailyRunId,
    mode: 'daily',
    levelIndex: run.view(performance.now()).level.index,
    date: dailyDay,
    elapsedSeconds: facts.clockSeconds,
    hintsUsed: facts.hintsUsed,
    attempts: 0,
    calls: facts.calls,
    score: facts.score,
  });
  if (!answer.ok) {
    // THE LOCAL RECORD STANDS (it was written above), and the refusal is shown rather than swallowed: the run is
    // real either way, and `POST /me/runs:bulk` is what will claim a ledger the server never heard.
    dailyScreen.say(`The server would not record this Daily: ${answer.failure.message}`, 'bad');
    return;
  }
  save.adoptHints({ hints: answer.value.hints.hints, successes: answer.value.hints.successes });
  dailyScreen.say(
    `Recorded — the server scores it ${answer.value.run.score} points. Best on this board: ${answer.value.board.score}.`,
    'ok',
  );
  paintBalance();
  persist();
}

/** Issue today's challenge from wherever the app is configured to get it. */
function issueDaily(): void {
  if (apiConfigured()) void startServerDaily();
  else startDaily();
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

/**
 * Take a hint: the LEDGER is asked first, and only a granted spend charges the run.
 *
 * WITH A SERVER, THE SPEND IS THE SERVER'S (DESIGN.md 11.1, A23): the balance moves there and the run is charged the
 * 60 seconds from what was RECORDED, so this asks for the spend before taking it locally. A refusal — no balance,
 * a challenge nobody read, the bound — is shown and NOTHING is spent, because a hint the server did not record
 * would be a run it refuses (`unrecorded_hints`) and a player who lost the run rather than the hint.
 *
 * THE CALL IT NAMES IS STILL THIS APP'S. §10's look-up runs over the board the player is standing on, and for the
 * Daily that board is the recorded line — `POST /daily/move` is still to come, so the naming stays local and the
 * SPEND is what the server owns (DESIGN.md §11.1's known limit 2 records why the information is not the secret).
 */
async function takeHint(): Promise<void> {
  if (!daily || PLAYHEAD.isRunning) return;
  if (save.hints.hints <= 0) {
    dailyScreen.say('You have no hints — one is earned every ten solved drills.', 'bad');
    return;
  }
  // A HINT IS A WRITE TOO (A20), so a demo spends the DEVICE's balance and never asks: `POST /me/hints` would answer
  // `401`, and the balance on screen is already the device's own (see the clause `paintBalance` adds). The hint is
  // still a hint — DESIGN.md §10's rule is that a hint names a call and costs a minute, and both of those are this
  // app's arithmetic once the server is not the ledger.
  const serverSpend = apiConfigured() && mayWrite(currentStanding());
  if (serverSpend) {
    const levelIndex = daily.view(performance.now()).level.index;
    const answer = await spendHint(levelIndex, dailyDay);
    if (!answer.ok) {
      dailyScreen.say(`The server would not record a hint: ${answer.failure.message}`, 'bad');
      return;
    }
    // THE SERVER'S BALANCE IS THE ONE SHOWN, for the same reason its score is adopted after a run: two ledgers is
    // one too many, and this app's copy is the preview.
    save.adoptHints({ hints: answer.value.hints.hints, successes: answer.value.hints.successes });
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
  // ONLY WHERE THE SERVER DID NOT ALREADY CHARGE IT: with a recorded spend the balance moved there and adopting it
  // is the whole of the bookkeeping — debiting this device as well would charge one hint twice.
  if (!serverSpend) save.spendHint();
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
  // paint that the frame loop calls, and only a NEW entry is written to storage. THE SAME EDGE SUBMITS IT when an
  // API is configured, so the two records cannot disagree about which run was the first.
  if (view.outcome === 'solved' && view.result) {
    if (recordDailyRun(dailyRunSeed, view.result.elapsedSeconds, view.result.score) > 0) {
      persist();
      // THE SAME GUARD THE DRILL's SOLVE USES: a signed-out Daily is a demo, and `POST /runs` would be a `401` that
      // buys nothing and is counted (A20, A25). The local record above is the whole record for that player until
      // they sign in and import it (A26).
      if (apiConfigured() && mayWrite(currentStanding())) void submitSolvedDaily(daily);
    }
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
  // THE SESSION IS READ BEFORE THE FIRST ISSUE, SYNCHRONOUSLY, so the first request already carries the identity this
  // device holds and the first paint already says the right standing. Discovery and any refresh are a round trip each
  // and cannot be waited for here; they only REPAINT (see `bootAccount`), because re-issuing the drill after them
  // would throw away a half-played one to learn something that does not change which drill it is.
  player = heldSession();
  paintLedger();

  els.modeDrill.addEventListener('click', () => setMode('drill'));
  els.modeDaily.addEventListener('click', () => setMode('daily'));
  els.next.addEventListener('click', () => issueCurrentDrill('advance'));
  els.review.addEventListener('click', review);
  els.undo.addEventListener('click', undoDaily);
  els.redo.addEventListener('click', redoDaily);
  els.hint.addEventListener('click', () => void takeHint());
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

  // THE FRAME LOOP STARTS FIRST, because the stage owns no loop of its own and a paused one is a black canvas.
  // THE FIRST DRILL THEN WAITS FOR THE IDENTITY: with a server, `bootAccount` learns the mode and applies it, which
  // is what issues the drill with an identity the browser is allowed to send; offline there is nothing to learn and
  // the fixture's drill is issued here.
  requestAnimationFrame(frame);
  if (apiConfigured()) void bootAccount();
  else applyMode('drill');
}

main();
