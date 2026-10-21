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
// "SHOW ME THE ANSWER" ANSWERS NOTHING — AND THE RUN IT FINISHES COUNTS FOR NOTHING. It names the call and dances
// it, and the player still presses it, so a review cannot complete a puzzle; what the revealed press then earns is
// the whole of DESIGN.md §15 Q16, and it is SETTLED: no hint credit and no board entry, because a hint is a currency
// and "press the button, then press the call you were told" would mint it for free. The fact has to reach the SERVER
// (the balance is the server's, DESIGN.md 10), so the controller records which steps were shown and `review()` posts
// each one as an event — `POST /drill/reveal` — with the run declaring the same count as a claim, because a POST that
// never arrived must not silently rank the run. The offline ledger applies the same rule locally
// (`save.countSuccess`), so the two cannot disagree about a drill that was shown.
import { utcDay } from './puzzle/daily.ts';
import { levelSpec, LEVEL_SIZE } from './puzzle/levels.ts';
import { blockCells, blockSummary } from './puzzle/block.ts';
import { MAIN_POOL } from './puzzle/pool.ts';
import { scoreRun, type RunScore } from './puzzle/score.ts';
import { earningProgress } from './puzzle/hints.ts';
import { SCORE_VERSION } from './puzzle/config.ts';
import type { GameApplier, LevelSpec, Puzzle, SequenceMotion } from './puzzle/types.ts';
import { createLevelRuntime } from './data/corpus.ts';
import { DrillController } from './game/drill.ts';
import { DailyRun } from './game/daily-run.ts';
import { Stopwatch } from './game/clock.ts';
import { newRunId, wallGapMs, type DrillSaved, type StorageLike } from './game/store.ts';
import { advanceDrill, apiConfigured, browserDeps, dailyChallenge, fetchLeaderboard, importLedger, issueDrill, pollDaily, recordDailyMove, recordDrillAnswer, recordDrillReveal, rememberAuthMode, replayDrill as requestReplay, spendHint, submitRun, type IssuedDrill, type RegimeState } from './net/api.ts';
import { confirmAccount, currentPlayer, discoverAuth, refreshIfExpired, signIn, signOut, signUp, type AuthMode, type SignedIn } from './net/auth.ts';
import { mayWrite, signInOffered, standingOf, type Standing } from './net/standing.ts';
import { SaveState } from './game/save-state.ts';
import { LOCAL_SCHEDULE, scheduleEntryFor, scheduleLength } from './game/schedule-fixture.ts';
import { seasonPuzzleFor } from './game/season.ts';
import { GameStage, type ViewMode } from './render/stage-view.ts';
import { DrillScreen } from './ui/drill-screen.ts';
import { LevelScreen } from './ui/level-screen.ts';
import { DailyScreen } from './ui/daily-screen.ts';
import { AccountScreen } from './ui/account-screen.ts';
import { LeaderboardScreen } from './ui/leaderboard-screen.ts';
import { Replay } from './ui/playhead.ts';
import { el } from './ui/dom.ts';
import type { Board } from 'dancing-squared-engine';

type AppMode = 'drill' | 'daily';
/** What finishing the replay now running means: advance the step, or just settle where it landed. */
type ReplayOutcome = 'advance' | 'settle';

const PLAYHEAD = new Replay();
let mode: AppMode = 'drill';
/**
 * WHICH OF THE DRILL TAB'S TWO VIEWS IS SHOWING — the level's block, or the drill itself.
 *
 * THE DRILL TAB HAS TWO VIEWS AND STILL TWO MODES, which is why this is not a third `AppMode`: a mode is something a
 * player plays, and the level is where the mode is entered from. The grid is the HOME (a player lands on it, including
 * after a reload, so the block is visible whenever progress is interesting) and the drill is entered from one cell.
 */
let drillView: 'level' | 'drill' = 'level';
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
 * Whether the drill on screen has a run the SERVER accepted, which decides what "Next drill" may ask for.
 *
 * A RECORDED RUN FINISHES ITS DRILL SERVER-SIDE, so the advance the shell used to send afterwards was a request to
 * skip an already-skipped drill — a `409` the server is right to answer and the app rendered as a dead panel
 * (DESIGN.md §15 Q21, and `issueCurrentDrill` carries the measurement and the reasoning). It is set by an accepted
 * submission and cleared wherever the drill on screen stops being this page's run: `showDrill`, and the reset that
 * clears the device.
 */
let serverRecordedRun = false;

/**
 * THE PRESSES POSTED SO FAR, as one chain, so the submission can wait for them (DESIGN.md 11.1, A22).
 *
 * `attempts` is counted from what POST /drill/answer RECORDED, so a run submitted before its presses arrived is
 * refused `no_press_log` — a refusal this app would have caused itself rather than a cheat it caught. Chaining
 * rather than Promise.all keeps the recorded order the order the player pressed in, and the chain never rejects
 * (`recordDrillAnswer` answers with an ApiResult), so one failed press does not stop the rest from being sent.
 */
let pressLog: Promise<unknown> = Promise.resolve();

/**
 * The reveals this drill has posted, in the same chain shape as the presses and for the same reason.
 *
 * A SEPARATE CHAIN RATHER THAN ONE LOG, because the two are different facts with different contracts: the presses are
 * what the RUN IS SCORED ON (`attempts`, A22), and the reveals are what decides WHETHER it counts at all (A28). The
 * submission waits for both before it is sent, so the server's record is complete when the run arrives — but neither
 * chain rejects (`recordDrillReveal` answers with an ApiResult), so one failure cannot stop the rest from being sent.
 */
let revealLog: Promise<unknown> = Promise.resolve();
/** Where the server says the player is in the regime, for the header and the report of a finished season. */
let serverRegime: RegimeState | null = null;

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

/**
 * Whether the drill on screen is this DEVICE'S OWN FIXTURE rather than one the server issued (DESIGN.md §15 Q20).
 *
 * IT IS SET BY THE FIXTURE PATH, NOT BY THE BUTTON, so no route to a fixture drill can leave the standing saying the
 * run is the server's — and it is cleared by a server drill that worked. `standingOf` is what turns it into what the
 * player sees (the unranked clause on the ledger and the balance).
 */
let practiceRun = false;

/**
 * THE DAILY'S MOVES POSTED SO FAR, as one chain, so a submission can wait for them (DESIGN.md 11.1, A22).
 *
 * THE SAME CONTRACT THE DRILL'S PRESSES HAVE, and for the same reason: the server scores the RECORDED line and
 * cross-checks the submission against it, so a run submitted before its moves arrived would be refused
 * `line_mismatch` — a refusal this app would have caused itself rather than a cheat it caught. A chain rather than
 * `Promise.all` keeps the recorded order the order the player moved in, which is the order the line is replayed in.
 */
let dailyMoveLog: Promise<unknown> = Promise.resolve();

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
  levelPanel: el('level'),
  toLevel: el<HTMLButtonElement>('toLevel'),
  dailyPanel: el('daily'),
  balance: el('balance'),
  ledger: el('ledger'),
  hint: el<HTMLButtonElement>('hint'),
  review: el<HTMLButtonElement>('review'),
  skip: el<HTMLButtonElement>('skip'),
  undo: el<HTMLButtonElement>('undo'),
  redo: el<HTMLButtonElement>('redo'),
  giveUp: el<HTMLButtonElement>('giveUp'),
  replayMine: el<HTMLButtonElement>('replayMine'),
  replayShortest: el<HTMLButtonElement>('replayShortest'),
  view: el<HTMLButtonElement>('view'),
  next: el<HTMLButtonElement>('next'),
  practice: el<HTMLButtonElement>('practice'),
  startOver: el<HTMLButtonElement>('startOver'),
  loading: el('loading'),
};

const drillScreen = new DrillScreen(answer);
const levelScreen = new LevelScreen(levelPlay, levelNextLevel);
// A PARALLEL STEP IS ONE LINE ELEMENT (`Sides Trade || Heads Dosado`), which the applier reads back with the engine's
// own `parseStep`, so `playDailyCall` is the whole path: the session applies it, the line records the label and the
// server replays it. Nothing distinct to record, and nothing to keep in step with the single-call path.
const dailyScreen = new DailyScreen({ play: playDailyCall, parallel: playDailyCall });
const accountScreen = new AccountScreen({
  signIn: (email, password) => void doSignIn(email, password),
  signUp: (email, password) => void doSignUp(email, password),
  confirm: (email, code) => void doConfirm(email, code),
  signOut: () => void doSignOut(),
});
const boardScreen = new LeaderboardScreen({ load: () => void loadBoard() });
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
  return standingOf({ configured: apiConfigured(), mode: authMode, signedIn: player !== null, demo: demoRun, practice: practiceRun });
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
  // A SPENT-OUT BALANCE DOES NOT DISABLE IT, and that is a correction rather than an oversight. It used to be
  // `disabled = hints <= 0 || !playing`, which meant `takeHint`'s own sentence - "You have no hints - one is earned
  // every ten solved drills" - could NEVER RUN, because a disabled button does not fire a click. REPORTED: "Nothing
  // happens when I select the Hint button." A control that is visibly there and silently does nothing is the failure
  // mode this file already refuses twice (Q20's practice offer, Q21's advance): the balance being zero is a fact the
  // player needs TOLD, and the one place that can tell them is the press.
  els.hint.disabled = !playing;
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

// ------------------------------------------------------------------------------------------------ the board

/**
 * The period the board on screen is for, from the mode and the DRILL IN PLAY — or null when there is none.
 *
 * THE TWO BOARDS MEAN DIFFERENT THINGS BY "PERIOD" (§6), and the SERVER takes it from the caller. A Daily board is
 * ONE UTC DAY — the same `utcDay` the challenge is seeded from, which the client can compute because the day IS
 * the challenge. A DRILL board is NOT a calendar month any more (§15 Q17(vii)): it is the PUBLISHED SET the runs
 * land on, and the only place the client can learn which set that is, is the drill the server issued — so it comes
 * from the answer rather than from `seasonOf(Date.now())`, which is what this used to be. That mattered: a drill
 * finished just after a month boundary, or after the publisher replaced a set, used to be ranked on a board its
 * drill did not come from, and a set that was EXTENDED moved the denominator under scores already on it.
 *
 * NULL IS AN ANSWER. With no server drill in play there is no set to name — an offline practice drill is not on any
 * board — and asking for the current month would show an empty board that looks like a real one.
 */
function boardPeriod(): string | null {
  if (mode === 'daily') return utcDay(new Date());
  const issued = serverIssued() ? serverDrill : null;
  return issued?.scheduleVersion ?? null;
}

/**
 * Load the board for the mode the app is in, and show it.
 *
 * IT IS ON DEMAND, because a board is a request and this panel is opened by a press. A build with no server gets the
 * sentence rather than a spinner that can never finish, and a refusal is shown in the server's own words.
 */
async function loadBoard(): Promise<void> {
  boardScreen.open();
  if (!apiConfigured()) {
    boardScreen.say('There is no server configured, so there is no board to show — this device keeps your own runs only.');
    return;
  }
  const period = boardPeriod();
  if (period === null) {
    boardScreen.say('There is no published set to show a board for — the Drill board holds one season, and this device has no server-issued drill on it.');
    return;
  }
  boardScreen.setBusy(true);
  const answer = await fetchLeaderboard(mode, level?.index ?? save.levelIndex, period);
  boardScreen.setBusy(false);
  if (!answer.ok) {
    boardScreen.say(`The board could not be read: ${answer.failure.message}`, 'bad');
    return;
  }
  // `you` IS THE ID THIS APP BELIEVES IT IS, or null when it is nobody: the board is public (A20 serves reads to a
  // signed-out caller), so "which of these is me" is answered by the session rather than by hiding the list.
  boardScreen.show(answer.value, player?.playerId ?? null);
}

// -------------------------------------------------------------------------------------------- start over

/**
 * Whether the "start over" control has been pressed once and is waiting for the press that means it.
 *
 * IT IS SHELL STATE BECAUSE IT IS TRANSIENT and belongs to no mode: the button is in the shared footer, and the arm
 * is dropped by anything that shows the player has moved on (`applyMode`), so a control left armed cannot fire on a
 * stray press minutes later.
 */
let startOverArmed = false;

/** The label says what the NEXT press does, which is the whole of this control's honesty. */
function paintStartOver(): void {
  els.startOver.textContent = startOverArmed
    ? 'Press again — this device’s runs and hints will be forgotten'
    : 'Start over on this device';
}

/**
 * Forget this device's game (DESIGN.md §15 Q18), on the SECOND press.
 *
 * TWO PRESSES RATHER THAN A NATIVE DIALOG: the armed state is a rule this shell owns and whose text says what will
 * go, where a `confirm()` is a browser API no probe can see — and the smallest possible rule in `main.ts` is the
 * right instinct, because `main.ts` and `ui/` are the layer no probe loads (AGENTS.md §1).
 *
 * WHAT IT DOES NOT TOUCH, because a reset that overreaches is worse than none: the SERVER's rows are not this
 * device's to forget. A signed-in player's progress, board entries and balance are the server's (DESIGN.md §11), so
 * this forgets the DEVICE's copy — and since the next `GET /drill/current` answers from that player's own Progress
 * row, the board that comes back after a reset may be the same drill. The session is `net/session.ts`'s item and
 * has its own control ("Sign out"), and the device id is not the player's data (see `clearGame`).
 *
 * THE RUN IN FLIGHT GOES WITH THE RECORD, so the shell's own state is discarded before the next board is issued:
 * a controller, a Daily or a press chain that outlived the record it belonged to would write its next move against
 * a game the player has just thrown away.
 */
function startOver(): void {
  if (!startOverArmed) {
    startOverArmed = true;
    paintStartOver();
    return;
  }
  startOverArmed = false;
  paintStartOver();
  if (!save.clear()) {
    // THE DEVICE REFUSED, and that is shown rather than swallowed: `paintLedger` already says storage is off, and
    // this sentence says what the button therefore could not do.
    drillScreen.say('This browser blocks local storage, so there is nothing here to forget.', 'bad');
    return;
  }
  controller = null;
  daily = null;
  serverDrill = null;
  serverRegime = null;
  // AND THE DEVICE REMEMBERS NOTHING, so it certainly does not remember a run the server accepted (DESIGN.md §15
  // Q21): `showDrill` clears this on the way to the fresh drill, but the reset must not depend on that landing —
  // `startServerDrill` returns without showing anything when the server refuses, and a flag left set would make the
  // next solve's "Next drill" a read of a drill the server still holds in flight.
  serverRecordedRun = false;
  position = 0;
  drillRunId = '';
  dailyRunId = '';
  drillOptions = [];
  pressLog = Promise.resolve();
  revealLog = Promise.resolve();
  dailyMoveLog = Promise.resolve();
  paintLedger();
  paintBalance();
  issueCurrentDrill('current');
}

// -------------------------------------------------------------------------------------------- the saved game

/**
 * The browser's storage, or a stand-in that refuses.
 *
 * THE PROPERTY ACCESS IS THE THING THAT THROWS, not the read: a blocked origin raises on `window.localStorage`
 * itself, so a `try` around the first `getItem` would never see it. A stand-in that throws on EVERY call — including
 * `removeItem`, which "start over on this device" needs — is what makes `loadGame` report `saving: false`, the
 * footer say what is true, and a reset refuse rather than claim a board it did not clear.
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
    removeItem: () => {
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
    // THE REVEALS ARE PART OF THE DRILL'S PROGRESS, like the step and the wrong tries: a page that forgot them would
    // come back with a run that counts, which is a refresh that launders a shown answer (DESIGN.md §15 Q16, A28).
    revealed: [...controller.revealed],
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
  // AN UNRANKED LEDGER IS A FUNNEL, NOT A SCOREBOARD (DESIGN.md §11.2): the runs are real and kept, and they are not
  // ranked — which is the fact the old line left implicit until the server refused the submission.
  //
  // AND THE REASON IS SAID, because there are now TWO of them and ONE sentence was wrong for the other. MEASURED in a
  // browser while this change was being checked: a SIGNED-IN player taking the practice offer read "unranked: the
  // server is recording nothing for a signed-out player", which is not what happened — the server was never asked. So
  // the demo case keeps a sentence that is true of it whether or not there is a session, and the practice case says
  // the practice reason instead.
  const clause =
    currentStanding() === 'unranked'
      ? practiceRun
        ? ' — unranked: a practice drill, so it is kept here and never submitted'
        : ' — unranked: the server is not recording this run'
      : '';
  els.ledger.textContent = `${kept}${clause}`;
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
  // A MODE SWITCH DISARMS "START OVER": it is the clearest sign the player has moved on, and a control still armed
  // minutes later would fire on one stray press.
  startOverArmed = false;
  paintStartOver();
  // A MODE SWITCH RETURNS TO THE LEVEL. The block is the Drill tab's home, so entering the mode shows where the
  // player is and the drill is entered from a cell — including after a reload, which is the whole point of a
  // progress screen. The drill is still ISSUED below, because which drill is next is the SERVER's fact and the grid
  // takes it as an input rather than deriving it (`levelView`).
  if (mode === 'drill') drillView = 'level';
  paintView();
  els.dailyPanel.hidden = mode !== 'daily';
  els.modeDrill.setAttribute('aria-pressed', String(mode === 'drill'));
  els.modeDaily.setAttribute('aria-pressed', String(mode === 'daily'));
  els.review.hidden = true;
  els.skip.hidden = true;
  els.next.hidden = true;
  // THE PRACTICE OFFER IS ABOUT THE DRILL ON SCREEN, so a mode switch withdraws it: what the server refused was that
  // drill, and an offer left standing would invite a practice run for a failure the player has moved past.
  els.practice.hidden = true;
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
function showDrill(issued: { seed: number; levelIndex: number; index: number; length: number; issuedAtMs?: number; demo?: boolean; puzzle: Puzzle }): void {
  const spec = levelSpec(issued.levelIndex);
  if (!spec) throw new Error(`level ${issued.levelIndex} is not a level`);
  // A DRILL ON SCREEN HAS NO RECORDED RUN UNTIL THIS PAGE SUBMITS ONE, so this is where the flag is normally cleared
  // (DESIGN.md §15 Q21): every path that puts a different drill on screen comes through here — an issue, a resume, a
  // mode switch, the practice offer — and a stale "the server already has this one" would make the next solve's
  // "Next drill" a read of a drill the server still holds in flight, which is the same dead panel from the other
  // side. `startOver` clears it too, because that path can end without a drill being shown at all.
  serverRecordedRun = false;
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
  // THE PUZZLE ARRIVES WITH THE DRILL, FROM ONE OF TWO GENERATORS THAT RAN BEFORE THIS FUNCTION.
  //
  // This is the reversal DESIGN.md §9 records: a puzzle used to be derived HERE from a seed, and the seed was the
  // contract. Now the serving layer generates for the online path and `game/tools/bake-season.mjs` generates for the
  // fixture season, so nothing in this file generates at all — which is what makes "everyone at this index was asked
  // the same question" a fact about the payload rather than an agreement about a number, and what
  // `game/test/client-generation-probe.mjs` pins by walking this module's import graph.
  const puzzle = issued.puzzle;
  controller = null;
  els.loading.hidden = true;

  // A SAVED DRILL AT THIS POSITION IS CONTINUED, not re-drawn: DESIGN.md 8 locks a drill when it is issued,
  // so the same seed comes back with the step the player had reached and the wrong tries already taken, and
  // the clock carries the time the page was closed. A record for a DIFFERENT position is left alone — that is
  // a drill the player has moved past, and its position is what says so.
  const carrying: DrillSaved | null = save.drillRun && save.position === position ? save.drillRun : null;
  controller = new DrillController(
    puzzle,
    carrying ? { index: carrying.index, attempts: carrying.attempts, revealed: carrying.revealed } : {},
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
  // REVIEW AND SKIP ARE `paintView`'s NOW: they belong to the drill view, and whether that view is showing is the
  // shell's state rather than this function's. `skipOffered` (DESIGN.md §15 Q5) is still the rule for WHETHER a skip
  // is offered — it is a write against a server-issued drill, and it is not offered for a demo or a practice drill.
  els.next.hidden = true;
  captions(puzzle.start, puzzle.goal);
  paintBalance();
  persist();
  draw();
  // THE VIEW AND THE BLOCK ARE BOTH REPAINTED WITH EVERY DRILL: issuing is what moves the regime (the answer carries
  // the two sets and the issued index), and it is also when the footer's drill controls become meaningful — which is
  // `paintView`'s decision, taken here rather than left to whichever call ran last.
  paintView();
  renderLevel();
}

/**
 * Show whichever view the Drill tab is on.
 *
 * THE PANEL VISIBILITY IS THE SHELL'S, not a screen's — the same rule `applyMode` already applies to the two modes,
 * one level down: a screen that hid itself could not be shown by the boot.
 */
function paintView(): void {
  const levelShowing = mode === 'drill' && drillView === 'level';
  const drillShowing = mode === 'drill' && drillView === 'drill';
  els.levelPanel.hidden = !levelShowing;
  els.drillPanel.hidden = !drillShowing;
  // THE FOOTER'S DRILL CONTROLS BELONG TO THE DRILL VIEW, and this is the one place that decides it: on the block
  // there is no question to reveal or skip, and a control that looks live and does nothing is worse than one that is
  // absent (`drill-screen.ts` records the same rule for a failed issue). They are re-derived here rather than left as
  // whichever screen painted last, which is how "Show me the answer" came to sit under a progress grid.
  els.review.hidden = !drillShowing;
  els.skip.hidden = !drillShowing || !skipOffered();
}

/**
 * What the block should say, from the SERVER's regime when there is one and this device's ledger otherwise.
 *
 * THE SERVER'S ANSWER IS THE AUTHORITY for the length and for both sets — they are one read from `GET /drill/current`
 * — and `next` is the index it ISSUED rather than a rule recomputed here: "the first unfinished position" is
 * `nextIndex` (`api/src/drill-regime.ts`) and a copy in the browser would be a second implementation of the decision
 * that says which drill a player is on.
 *
 * OFFLINE, THE LEVEL IS ALWAYS 1, because promotion is the SERVER's rule (its ladder row) and an offline player never
 * moves on. The fixture's positions for level 1 are its first entries, which is what the device ledger records; the
 * FIXTURE WRAPS, so a position already in the ledger can be the one on screen, and the block says so rather than
 * hiding the only cell there is to play.
 */
function levelView(): {
  levelIndex: number;
  length: number;
  finished: readonly number[];
  passed: readonly number[];
  next: number | null;
  complete: boolean;
} {
  if (serverRegime) {
    const length = serverRegime.length;
    const finished = serverRegime.finished;
    const passed = serverRegime.passed;
    const next = serverDrill?.index ?? null;
    const cells = blockCells({ length, finished, passed, next });
    const summary = blockSummary(cells);
    return {
      levelIndex: serverDrill?.levelIndex ?? (save.levelIndex || 1),
      length,
      finished,
      passed,
      next,
      complete: length > 0 && summary.done >= summary.published,
    };
  }
  const atLevelOne = LOCAL_SCHEDULE.filter((entry) => entry.levelIndex === 1).length;
  const length = Math.min(LEVEL_SIZE, atLevelOne);
  const wrapped = save.position < length ? save.position : null;
  const finished = save.finishedPositions.filter((p) => p < length && p !== wrapped);
  const passed = save.passedPositions.filter((p) => p < length && p !== wrapped);
  const next = wrapped;
  const cells = blockCells({ length, finished, passed, next });
  const summary = blockSummary(cells);
  return { levelIndex: 1, length, finished, passed, next, complete: length > 0 && summary.done >= summary.published };
}

/** Paint the block. Called whenever the regime moves: a boot, an advance, a level change. */
function renderLevel(): void {
  levelScreen.render(levelView());
}

/**
 * A cell in the block was pressed, and WHICH cell is what decides what happens.
 *
 * TWO KINDS OF PRESS, and they used to be one. The `next` cell shows the drill the server already issued — a reveal of
 * something in flight, which is why that branch is synchronous and asks nothing. A `done-not-passed` cell is a
 * REATTEMPT: the position is closed, so nothing is in flight for it and the drill has to be ASKED FOR
 * (`POST /drill/replay`), which makes that branch asynchronous. The server decides whether it is allowed
 * (`replayDrill` in `drill-regime.ts`), so a stale grid is answered with the server's own refusal rather than a
 * client that thought it knew better.
 *
 * OFFLINE THERE IS NO SERVER TO ASK: the fixture's entry at that position is baked beside the seeds, so the same press
 * is the same `startDrill` call the next cell makes, one index over. The local ledger already `markSkipped` that
 * position, and `countSuccess` still credits a later solve with the PASS even though it cannot credit a hint — which is
 * exactly the split a reattempt needs (see `save-state.ts`'s `spend`).
 */
function levelPlay(index: number): void {
  if (index !== levelView().next) {
    // THE VIEW IS SWITCHED BY WHICHEVER PATH SHOWS A DRILL, not here: a refused reattempt must leave the player on the
    // block with the server's sentence, and switching first would leave them looking at the panel of the previous drill.
    if (apiConfigured()) void startReplayDrill(index);
    else {
      drillView = 'drill';
      startDrill(index);
    }
    return;
  }
  if (!controller) return;
  drillView = 'drill';
  paintView();
}

/**
 * Ask the server for a position the player already closed, and show it.
 *
 * A REFUSAL LEAVES THE PLAYER WHERE THEY WERE, because there is nothing to show: the three causes (`not_finished`,
 * `already_passed`, `no_entry`) all mean "that cell is not what you think it is any more", and the sentence the server
 * wrote is the honest thing to say. `els.loading` is cleared on the way out so a refused press cannot leave the app
 * saying that it is still asking.
 */
async function startReplayDrill(index: number): Promise<void> {
  els.loading.hidden = false;
  els.loading.textContent = `Asking the server for drill ${index + 1} again…`;
  const answer = await requestReplay(index);
  if (!answer.ok) {
    els.loading.hidden = true;
    drillScreen.say(`That drill cannot be replayed: ${answer.failure.message}`, 'bad');
    return;
  }
  serverDrill = answer.value.drill;
  serverRegime = answer.value.regime;
  drillView = 'drill';
  showDrill({
    seed: serverDrill.seed,
    levelIndex: serverDrill.levelIndex,
    index: serverDrill.index,
    length: serverRegime.length,
    issuedAtMs: serverDrill.issuedAtMs,
    demo: false,
    puzzle: serverDrill.puzzle,
  });
  drillScreen.say(`Drill ${index + 1} again — it was closed without being passed, so solving it now earns the pass.`, 'info');
}

/**
 * The block is full and the player took the way on. RE-ISSUING IS THE PROMOTION: the server's ladder reads the full
 * block and answers with the next level's first drill — so this asks, and does not move the player itself.
 */
function levelNextLevel(): void {
  drillView = 'level';
  paintView();
  issueCurrentDrill('current');
}

/** The OFFLINE path: the local fixture's entry at a position, with the puzzle baked beside it. */
function startDrill(next: number): void {
  const length = scheduleLength();
  const at = ((next % length) + length) % length;
  els.loading.hidden = false;
  els.loading.textContent = `Generating drill ${at + 1} of ${length}…`;
  const entry = scheduleEntryFor(at);
  // A FIXTURE DRILL WITH AN API CONFIGURED IS PRACTICE, and the flag is set HERE rather than by the button that
  // offers it, so no path can show a fixture drill without saying it is one (DESIGN.md §15 Q20). With no API
  // configured the whole game is offline and the standing is already `offline`, so the flag is moot.
  practiceRun = apiConfigured();
  showDrill({ seed: entry.seed, levelIndex: entry.levelIndex, index: at, length, puzzle: seasonPuzzleFor(at) });
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

  if (next === 'advance' && serverIssued() && serverDrill) {
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
    // AND THEN THE HONEST OFFER (DESIGN.md §15 Q20). The fixture's order is NOT the season's, so serving it quietly
    // would ask a different question from everyone else's and record it as if it counted; what is offered instead is
    // the local drill, named as practice, and taken only by a press. The button is revealed here and hidden again by
    // a server drill that worked.
    els.practice.hidden = false;
    return;
  }
  practiceRun = false;
  els.practice.hidden = true;
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
    // THE BOARDS THE SERVER WILL SCORE. Sent through rather than re-derived, so a disagreement between the two
    // generators is impossible rather than merely unlikely.
    puzzle: serverDrill.puzzle,
  });
}

/**
 * Issue the drill from wherever the app is configured to get it.
 *
 * "ADVANCE" IS A REQUEST THE SHELL MUST NOT MAKE WHEN THE ROOM ALREADY KNOWS THE ANSWER IS DONE (DESIGN.md §15 Q21).
 * A recorded run finishes its drill SERVER-side — `POST /runs` writes the Progress row — so asking for an advance
 * afterwards asks the server to skip a drill that is already skipped. MEASURED IN A BROWSER: the server answers
 * `409 stale_drill`, and the shell rendered that as a refusal with `controller = null`, so a player who had just
 * solved a drill was left with an empty panel and no way on but a reload (which worked, because the regime HAD
 * advanced).
 *
 * AND THE ENDPOINT IS RIGHT TO REFUSE, which is why this is the fix rather than a change to the API: a repeated
 * advance is refused on purpose — the plausible wrong rule ("finish the first unfinished entry") finishes an entry
 * nobody saw, pinned with its own negative control in `api/test/drill-probe.mjs` §3. Two more reasons point the same
 * way: every refusal carrying an identity is COUNTED against the player (A25, `api/src/abuse.ts`), so an ordinary
 * completed drill would add a `stale_drill` to the operator's probing signal; and what the app actually wants after a
 * solved drill is the NEXT DRILL, which is a read.
 *
 * `serverRecordedRun` IS THE WHOLE RULE, and it is shell state like `startOverArmed`: set when a submission is
 * accepted (including a duplicate — the server holds the run either way) and cleared whenever a different drill is
 * shown. A run the server did NOT record still needs the advance, and that is the right request for the two cases
 * where the player is signed in but the run stayed local — an outage and a refusal — because §11 records an advance
 * as a skip, so a season with a hole in it is visible rather than silent. A DEMO IS A THIRD CASE AND THIS DOES NOT
 * SETTLE IT: a signed-out player has no Progress row to advance, so the advance is a `401` and the button is just as
 * dead (DESIGN.md §15 Q22, measured in the same browser session).
 */
function issueCurrentDrill(next: 'current' | 'advance'): void {
  const ask: 'current' | 'advance' = next === 'advance' && serverRecordedRun ? 'current' : next;
  if (apiConfigured()) void startServerDrill(ask);
  else if (ask === 'advance') startDrill(position + 1);
  else startDrill(position);
}

/**
 * Take the practice offer: play the local fixture, and say what that means (DESIGN.md §15 Q20).
 *
 * THE SENTENCE COMES AFTER THE DRILL IS SHOWN, because `showDrill` clears the verdict line on its way in — a player
 * who pressed a button labelled "this one will not count" is owed the reason in the same place the ordinary verdicts
 * appear, and the LEDGER's own unranked clause (`paintLedger`, driven by `standingOf`) is the standing fact beside
 * it. The offer is hidden again: it is a choice, not a mode, and leaving it on screen would read as a setting.
 *
 * THE RUN IS STILL KEPT ON THIS DEVICE, and that is deliberate rather than an oversight: the local ledger is what
 * A26 later imports as UNRANKED HISTORY, which is exactly what a practice run is — a run the server never issued,
 * which buys no standing (§11.1). What it is NOT is a submission: the drill on screen is the fixture, so
 * `serverIssued()` is false, `finishDrill` has nothing to submit and credits the local rule instead. (This comment
 * used to say `serverDrill` is null on this path, which is true only when the offer is taken before any server drill
 * was ever issued — once a season is complete the variable still holds the last one, and that stale fact is Q23.)
 */
function startPractice(): void {
  els.practice.hidden = true;
  startDrill(position);
  drillScreen.say('Practice drill — this device’s own fixture, not the season’s, so it will not count.', 'info');
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
  // accumulates locally, because the local run record keeps it. THE DRILL ASKED FOR THE PREVIOUS LINE, through the
  // fact rather than the variable, so a fixture drill on a server-configured page cannot post against a stale id (Q23).
  const issued = serverIssued() ? serverDrill : null;
  if (issued && mayWrite(currentStanding())) {
    const drillId = issued.id;
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
 * The answer, on request — DESIGN.md §8's review, and A28's event.
 *
 * IT ADVANCES NOTHING AND SCORES NOTHING: the review names the call and dances it, and the player still has to press
 * it, so the step is not answered here — which is why this is a plain `settle` and not a third outcome.
 *
 * THE RUN IT FINISHES COUNTS FOR NOTHING, and that is why this posts an EVENT (DESIGN.md §15 Q16, A28). The server
 * cannot see a screen: "show me the answer" used to leave no trace at all, so pressing the button and then pressing
 * the call it named earned a success like any other — ten of which mint a hint. `controller.review()` records WHICH
 * step was shown (and the record survives a reload, so a refresh cannot launder it), and this posts it against the
 * issued drill so the server has its own record rather than only the submission's claim. It is a WRITE and so the
 * same rule as a press applies: a demo does not send one, because the server refuses every write for a caller it
 * served without a Progress row (A20) and A25's tally would count the honest player as someone probing.
 *
 * THE SENTENCE IS UNCHANGED AND THE BUTTON'S LABEL IS NOT: the label now says the drill will not count (index.html),
 * because a player is owed that BEFORE they press it rather than in the verdict afterwards — the same reason the
 * practice offer is labelled Q20's way.
 */
function review(): void {
  if (!controller || !applier || PLAYHEAD.isRunning || controller.atEnd) return;
  const stepIndex = controller.view().stepIndex;
  const option = controller.review();
  const issued = serverIssued() ? serverDrill : null;
  if (issued && mayWrite(currentStanding())) {
    const drillId = issued.id;
    revealLog = revealLog.then(() => recordDrillReveal(drillId, stepIndex));
  }
  drillScreen.say(`The answer is ${option.call}.`, 'info');
  startReplay(applier.motion([option.call], controller.view().from), 'settle');
}

/**
 * Whether the drill on screen is one the SERVER issued — as opposed to this device's own fixture (DESIGN.md §15 Q23).
 *
 * `serverDrill` ALONE IS NOT THAT FACT, and a browser check measured the difference on the practice path: taking
 * Q20's offer calls `startDrill`, which paints the fixture drill while `serverDrill` still holds the last
 * SERVER-ISSUED one, so a test of `serverDrill !== null` reported "the server issued this" for a drill the server had
 * never seen. `practiceRun` is the flag that path sets (`startDrill` sets it, `startServerDrill` clears it), so the
 * two together are the fact — and every caller that means "the server's drill" asks this rather than the variable, so
 * one stale fact cannot reappear at the next call site.
 */
function serverIssued(): boolean {
  return serverDrill !== null && !practiceRun;
}

/**
 * Whether the drill on screen may be SKIPPED — spent without being solved (DESIGN.md §15 Q5).
 *
 * TWO WAYS A DRILL IS LEFT BEHIND, and this is the one place that knows both. A SERVER-ISSUED drill is advanced, which
 * is a WRITE (A20) and so needs `mayWrite` — the same predicate the submission, the press and the reveal are guarded
 * by, and the reason a DEMO is offered nothing (Q22: there is no Progress row to advance, so the request is a `401`).
 * An OFFLINE drill is left behind by the local position alone, so the control is honest there too — and it is the
 * only way out of one there, since "Next drill" appears only after a solve. A PRACTICE drill is NEITHER: it is the
 * app's own fixture, so there is no server entry to close, and the control that returns the player to the season is
 * "Next drill" (which is why Q23's fix had to reach this too — before it, a practice drill was refused the control
 * for the right answer and the wrong reason).
 */
function skipOffered(): boolean {
  // A REATTEMPT IS NOT SKIPPABLE, and the reason is that the control could do nothing: the position is already
  // `finished`, so `POST /drill/advance` would close a drill that is already closed and the block would not move. A
  // control whose only outcome is "nothing happened" is worse than no control — the same rule Q20's practice offer and
  // Q21's advance are written to. MEASURED IN A BROWSER (this one was): a skipped drill was reattempted, and "Skip this
  // drill" was still offered beside it.
  if (serverIssued() && serverDrill?.replay === true) return false;
  if (serverIssued()) return mayWrite(currentStanding());
  return !apiConfigured();
}

/**
 * Skip the drill on screen — the mark-and-continue DESIGN.md §15 Q5 recommends.
 *
 * WHAT IT IS FOR: the regime is an ORDER (decision 10), so one puzzle a player cannot solve blocks every drill behind
 * it. The recommendation is a skip that EARNS NOTHING, and THE SERVER ALREADY IMPLEMENTS IT: `POST /drill/advance`
 * marks the current drill finished, scores nothing, credits no hint and is recorded as an abandonment (A25) so a
 * skipped season is visible to an operator rather than a silent gap. What was missing was the control.
 *
 * IT CANNOT BE A SHORTCUT TO TIPS (§10), which is what makes it safe to offer: the advance mints nothing, and the
 * local ledger spends the position without crediting it (`save.markSkipped`) so a later local solve of that drill
 * cannot earn either — the same finality the server applies, where the closed drill refuses a submission `stale_drill`.
 *
 * THE SENTENCE IS SAID AFTER `issueCurrentDrill`, and the order is the whole of Q20's practice offer's lesson:
 * `showDrill` clears the verdict line on its way in, and OFFLINE the next drill is generated and painted synchronously,
 * so a sentence said before the call would be wiped in the same tick and never seen. On the SERVER path the round trip
 * is what the player reads it during and the new question then replaces it — which is why the label, not the sentence,
 * is where the cost is stated. A skip the server REFUSES is announced by `startServerDrill` in its own words, and that
 * one is not cleared at all, because no drill is shown.
 */
function skipDrill(): void {
  if (!controller || PLAYHEAD.isRunning || controller.atEnd) return;
  if (!skipOffered()) return;
  save.markSkipped(position);
  els.skip.hidden = true;
  issueCurrentDrill('advance');
  drillScreen.say('Skipped — no score for it, and no hint.', 'info');
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
  // A DEMO IS AS FAR AS A SIGNED-OUT PLAYER GOES (DESIGN.md §15 Q22). The drill on screen came from the SERVER, and
  // the server holds no Progress row for this caller — so there is nothing to advance and the next `/drill/current`
  // would serve the same entry again. MEASURED: the "Next drill" this used to reveal sent `POST /drill/advance` (a
  // write, A20) and got a `401`, leaving the panel with no drill and the player with a sentence about an endpoint.
  // A control whose only outcome is a refusal is worse than no control, so it is not offered here and the verdict
  // says what WOULD move the season on, in the place the player is already reading. The rule is `mayWrite` — the same
  // predicate the submission, the press and the reveal are guarded by (`net/standing.ts`, pinned in
  // `game/test/standing-probe.mjs`) — consulted at the one call site that was missing it.
  const demoOnly = serverIssued() && !mayWrite(currentStanding());
  const scored = `Solved in ${score.elapsedSeconds.toFixed(1)} s, ${tries} — ${score.score} points`;
  // THE VERDICT SAYS WHAT THE RUN IS WORTH, and a shown answer changes that to nothing (DESIGN.md §15 Q16, A28): the
  // score is still shown — the player solved it and the clock ran — and the sentence says which standing it bought,
  // which is none. The reason is stated in the same line rather than in the ledger's unranked clause alone, because
  // this is the moment the player finds out what their press cost. THE DEMO IS CHECKED FIRST because it outranks the
  // reveal: a signed-out run was never going to count, so "you were shown the answer" would name the smaller reason.
  if (demoOnly) {
    drillScreen.say(`${scored}. That is as far as a signed-out drill goes — the season is the server's, so sign in to be issued the next one.`, 'info');
  } else if (controller.revealed.length > 0) {
    drillScreen.say(`${scored}, and not ranked: you were shown the answer, so it earns no hint.`, 'info');
  } else {
    drillScreen.say(`${scored}.`, 'ok');
  }
  els.review.hidden = true;
  // THE DRILL IS OVER, so there is nothing left to skip: "Next drill" is the way on from here, and Q21 is why it no
  // longer sends an advance the server has already done.
  els.skip.hidden = true;
  els.next.hidden = demoOnly;
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
  // AND A REVEALED RUN IS NOT CREDITED BY EITHER RULE (DESIGN.md §15 Q16, A28): `creditLocally` applies it for the
  // offline and outage paths, and the server applies it for the submitted path, so the three agree.
  if (apiConfigured() && serverIssued() && mayWrite(currentStanding())) void submitSolvedRun(score, clockSeconds);
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
  const issued = serverIssued() ? serverDrill : null;
  return issued ? issued.seed : scheduleEntryFor(position).seed;
}

/**
 * Credit a solved drill LOCALLY: the offline rule, and the fallback when the server cannot be told.
 *
 * The guard is the same one `SaveState` has always owned — a position already counted earns nothing — because the
 * BALANCE is what a hint is and the BOARD cannot be farmed either way (§6).
 *
 * A REVEALED DRILL EARNS NOTHING HERE EITHER (DESIGN.md §15 Q16, A28), and it is the same parameter rather than a
 * second `if` at the call site: the server applies this rule, so an offline ledger that did not would be the one
 * place where "press the button, then press the call you were told" still mints a hint — and it would do it in the
 * mode with no server to catch it.
 */
function creditLocally(): void {
  const revealed = controller !== null && controller.revealed.length > 0;
  const success = save.countSuccess(position, { revealed });
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
  // THE PRESSES AND THE REVEALS FIRST. The run is scored on the tries the server recorded and RANKED on whether it
  // saw the reveal, so this waits for the last of each rather than racing them — the ordering this endpoint's
  // contract requires (DESIGN.md 11.1, A22 and A28). The claim below is what covers a POST that never arrived.
  await pressLog;
  await revealLog;
  const revealed = controller.revealed.length;
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
    // AND THE REVEALS ARE DECLARED RATHER THAN INFERRED (A28). This is the one claim that points the SAFE way — it
    // can only cost the claimant — so the server takes it without a refusal, which is also what makes it the belt to
    // the reveal POST's braces: an event lost to a dropped connection would otherwise rank a run whose answer the
    // player read. Claiming MORE than was shown is possible and costs the claimant a ranking, which is their business.
    reveals: revealed,
    // ONE CALL PER STEP, in the order they were answered — the same transcript the offline ledger keeps.
    calls: [...drillOptions],
    score: score.score,
  });

  if (!answer.ok) {
    // AN OUTAGE IS NOT THE PLAYER'S LOSS: the local rule still counts the success, and the refusal is shown so the
    // gap is visible rather than hidden (`/me/runs:bulk` is what claims a local ledger later). A REVEALED RUN IS THE
    // EXCEPTION TO "THE LOCAL RULE COUNTS IT", and not an exception here — `creditLocally` applies A28 itself, so
    // the outage path and the offline path agree about what a shown answer is worth.
    creditLocally();
    drillScreen.say(`The server would not record this run: ${answer.failure.message}`, 'bad');
    paintBalance();
    persist();
    return;
  }
  save.adoptHints({ hints: answer.value.hints.hints, successes: answer.value.hints.successes });
  // THE SERVER HOLDS THIS RUN, WHICH IS WHAT "Next drill" MAY RELY ON (DESIGN.md §15 Q21): the accepted submission
  // finished the drill on the server's own Progress row, so what the app needs next is the next drill, which is a
  // read. A DUPLICATE COUNTS — the row is the server's either way — and a refused or unreachable submission does not,
  // which is why this is set on the one path where the server said yes, and nowhere else.
  serverRecordedRun = true;
  const clamped = answer.value.run.clamped ? ' Your own score was higher, so the server clamped it.' : '';
  // THE SERVER SAYS WHETHER IT COUNTED, and the app repeats that rather than assuming: `granted: false` is the
  // ordinary case, so without `ranked` a revealed run would read exactly like one that simply did not earn a hint.
  const standing = answer.value.run.ranked
    ? ` Board: ${answer.value.board.score} over ${answer.value.board.runs} run(s).`
    : ' Not ranked: you were shown the answer, so it earns no hint and does not reach the board.';
  drillScreen.say(`Recorded — the server scores it ${answer.value.run.score} points.${standing}${clamped}`, answer.value.run.ranked ? 'ok' : 'info');
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
 * Show today's challenge from a puzzle, however it was obtained.
 *
 * ONE PATH FOR TWO SOURCES, like `showDrill`: the server's published puzzle and the offline one both arrive as a
 * `Puzzle` here, and what differs is where it came from — `dailyEntry`'s seed generated locally (offline) or the
 * boards `GET /puzzle` carried (DESIGN.md §9). The client no longer derives the board from the seed on the server's
 * path, because `GET /puzzle` answers with the boards themselves.
 */
function showDaily(puzzle: Puzzle, day: string, seed: number): void {
  if (!applier || !level) return;
  // THE DRILL'S DEMO FLAG DOES NOT CARRY OVER. `demo` is the server's word about an ISSUED DRILL
  // (`GET /drill/current`), and the Daily's answer carries no such flag — so leaving the last drill's value set
  // would mark a typed-in player's Daily unranked because of a board they left behind. The Daily's standing comes
  // from the mode and the session alone, which is the same rule that decides it before any drill has been issued.
  demoRun = false;
  els.loading.hidden = true;

  dailyDay = day;
  dailyLevelIndex = level.index;
  dailyRunSeed = seed;
  // A SAVED ATTEMPT FOR TODAY IS PICKED UP. The puzzle is the same one the record was written against — the
  // server's for a published challenge, the derived one offline — and what the record adds is the line, the hints
  // and the clock, with the wall time the page was away charged to it. A record that no longer describes this
  // puzzle (a pool or corpus change) comes back null and is simply not carried.
  const stored = save.daily;
  const carried = stored && stored.day === day && stored.levelIndex === level.index
    ? DailyRun.resume(puzzle, applier, performance.now(), stored, { gapMs: wallGapMs(stored.savedAtMs, Date.now()) })
    : null;
  daily = carried ?? new DailyRun(puzzle, applier, performance.now());
  dailyRunId = carried && stored ? stored.runId : newRunId(Date.now());
  dailyScreen.say(
    carried
      ? 'Picked up where you left off — the time the page was away is on the clock.'
      : 'Add calls until the set is on the goal board. Undo is free; the allowance is not.',
    'info',
  );
  // THE SHARED CHROME IS PAINTED ONLY WHERE THE DAILY IS THE MODE ON SCREEN. The header, the board captions, the board
  // itself and the footer buttons all belong to whichever panel is showing, and this answer can land while the player
  // has gone back to the drills — which is now the ORDINARY case, because the fetch does not hold the app. Without this
  // guard a challenge that finished creating in the background would replace the drill's header and footer with the
  // Daily's, under a board the player is in the middle of reading. The state above is set either way; `keepDaily()`
  // paints all of it on the next switch into the mode.
  if (mode === 'daily') {
    els.regime.textContent = dailyRegime();
    captions(daily.board, daily.view(performance.now()).goal);
    paintDaily();
    draw();
  }
  persist();
}

/**
 * THE OFFLINE PATH IS GONE, deliberately, and the panel says why rather than the app inventing a challenge.
 *
 * The Daily's whole premise is a challenge PUBLISHED for a level and a UTC day (§9): the boundary job validates one,
 * everybody at the level gets the same one, and the server scores against it. None of that exists without a server,
 * and the previous behaviour — deriving a seed from the date on the device — was a stand-in from before the client
 * stopped generating puzzles at all. Keeping it would mean the one place the app still ran `generatePuzzle`, so it
 * is removed and the mode is honest about needing the API (`apiConfigured()` is the switch, and the boot banner
 * already names the mode).
 */
function startDaily(): void {
  daily = null;
  els.loading.hidden = true;
  dailyScreen.say("The Daily Challenge needs the game server: a challenge is published for a level and a day, and this build has no API configured.", 'info');
  els.regime.textContent = "Today's Daily — needs the game server";
}

/**
 * THE DAILY POLL IN FLIGHT — which day and level it is for, and the handle that cancels it.
 *
 * WHY THIS IS SHELL STATE AND NOT A SCREEN'S. Creating a challenge costs the server seconds (MEASURED 9.4-15.1 s at the
 * shipped level-1 pool, DESIGN.md §7.1), and the tab buttons stay live throughout: a player who presses "Today's Daily",
 * goes back to the drills and presses it again used to start a SECOND generation of the same challenge — two requests,
 * each making the server do the same ten seconds of work, and whichever answered last decided what the panel showed. One
 * poll per (day, level), cancelled when it stops being the one to show.
 *
 * IT IS A HANDLE AND NOT A PROMISE, which is the correction the second report asked for: *"The call to fetchDaily never
 * returns and the UI hangs on the promise."* Nothing awaits the poll, so the button's pending state lasts exactly as long
 * as the poll does and the app is free between ticks.
 */
let dailyPoll: { day: string; levelIndex: number; stop: () => void } | null = null;

/**
 * Show that today's challenge is being CREATED, on the control the player pressed.
 *
 * THE BUTTON IS THE INDICATOR because it is the thing that was pressed and it stays on screen in BOTH modes — so a
 * player who carried on with the drills can still see that the Daily is coming. The animation is CSS on `[data-busy]`
 * (`style.css`), the accessible name says what is happening, and `aria-busy` is set so a screen reader is told rather
 * than shown: the state is carried by three signals and not by a spinner alone, which is this app's rule for anything
 * a colour-vision difference or a still screenshot would otherwise hide.
 */
function setDailyBusy(busy: boolean): void {
  if (busy) {
    els.modeDaily.dataset['busy'] = 'true';
    els.modeDaily.setAttribute('aria-busy', 'true');
    els.modeDaily.setAttribute('aria-label', "Today's Daily — creating today's challenge…");
  } else {
    delete els.modeDaily.dataset['busy'];
    els.modeDaily.removeAttribute('aria-busy');
    els.modeDaily.removeAttribute('aria-label');
  }
}

/** Cancel the poll, if there is one. Called when it finishes, when the level changes, and on a fresh issue. */
function stopDailyPoll(): void {
  dailyPoll?.stop();
  dailyPoll = null;
}

/**
 * The SERVER path: today's PUBLISHED challenge (§9, §11) — TRIGGER, THEN POLL, and never wait.
 *
 * THE FIRST REQUEST IS THE TRIGGER. `GET /puzzle` never generates inside the request (`api/handlers/puzzle.ts`): on a
 * miss it starts the generation for after its response and answers `202 { ready: false }`. So this function asks once
 * and returns; `pollDaily` reschedules itself on a timer while the answer says "not ready". Nothing here awaits a
 * minute-long loop, and `fetchDaily` — the shape the report pointed at — no longer exists.
 *
 * NOTHING HERE TOUCHES `els.loading`, AND THAT IS THE FIX FOR "seems to hang the app". That element is a FULL-SCREEN
 * OPAQUE OVERLAY (`position: absolute; inset: 0`, style.css) — right for a drill issue that takes a fraction of a
 * second, and catastrophic for a Daily that takes seconds: MEASURED IN A BROWSER with the read delayed to 6 s, the whole
 * app was a black page with one centred sentence, so the press looked like a freeze and the tabs could not be reached.
 *
 * THE PLAYER IS NOT BLOCKED EITHER WAY: they can switch back to the Drill and keep going, and `showDaily` leaves the
 * DRILL's chrome alone when the Daily is not the mode on screen.
 */
function startServerDaily(): void {
  if (!applier || !level) return;
  const day = utcDay(new Date());
  if (dailyIsCurrent(day)) {
    keepDaily();
    return;
  }
  const levelIndex = level.index;
  if (dailyPoll && dailyPoll.day === day && dailyPoll.levelIndex === levelIndex) return; // already polling this one
  stopDailyPoll();
  setDailyBusy(true);
  // A PENDING PANEL ONLY WHERE A PANEL IS ON SCREEN. In the Drill mode the player is looking at a board and must not
  // have it replaced by a message about the other tab; the button's spinner is the whole indicator there.
  if (mode === 'daily') dailyScreen.pending("Creating today's challenge — this takes a few seconds the first time.");
  const handle = pollDaily(levelIndex, day, browserDeps(), {
    onAnswer: (answer, state) => onDailyAnswer(answer, state, day, levelIndex),
  });
  dailyPoll = { day, levelIndex, stop: handle.stop };
}

/**
 * One poll answer: the challenge, a refusal, "still not ready", or the poll running out of attempts.
 *
 * THE ORDER IS THE RULE. A level change cancels first (the answer belongs to a regime the player has left); then a ready
 * answer is shown; then a refusal is reported; then a give-up; and only then is the wait continued, which is why the
 * panel's message can count the attempts without the spinner ever lying about being finished.
 */
function onDailyAnswer(
  answer: Awaited<ReturnType<typeof dailyChallenge>>,
  state: { readonly attempt: number; readonly gaveUp: boolean },
  day: string,
  levelIndex: number,
): void {
  if (level?.index !== levelIndex) {
    stopDailyPoll();
    setDailyBusy(false);
    return;
  }
  const finish = (): void => {
    stopDailyPoll();
    setDailyBusy(false);
  };
  if (!answer.ok) {
    finish();
    daily = null;
    dailyScreen.say(`No Daily from the server: ${answer.failure.message}`, 'bad');
    if (mode === 'daily') {
      dailyScreen.pending(`Today's Daily is unavailable — ${answer.failure.message}`);
      els.regime.textContent = "Today's Daily — unavailable";
    }
    return;
  }
  if (!answer.value.playable) {
    // A CHALLENGE FROM ANOTHER POOL IS NOT A CHALLENGE THIS BUILD CAN PLAY (§7.2), and saying so is better than
    // generating a board the server would refuse to score.
    finish();
    daily = null;
    dailyScreen.say(`Today's Daily was published against pool ${answer.value.poolVersion}, and this build serves ${MAIN_POOL.version}.`, 'bad');
    if (mode === 'daily') {
      dailyScreen.pending(`Today's Daily is unavailable — it was published against pool ${answer.value.poolVersion}.`);
      els.regime.textContent = "Today's Daily — unavailable";
    }
    return;
  }
  // A PLAYABLE CHALLENGE WITH NO PUZZLE IS A REFUSAL, not a seed to generate from: the server's own read says this build
  // may play it, so a missing puzzle is a payload this app cannot use, and drawing one locally would be the client
  // inventing the question it is about to be scored on (DESIGN.md §9).
  if (!answer.value.puzzle) {
    finish();
    daily = null;
    const why = state.gaveUp
      ? 'the server is still creating it after a couple of minutes — try again in a moment'
      : 'the server sent no boards for it';
    dailyScreen.say(`No Daily yet: ${answer.value.ready ? 'the answer carried no puzzle' : why}.`, 'info');
    if (mode === 'daily') {
      dailyScreen.pending(`Today's Daily is not ready — ${why}.`);
      els.regime.textContent = "Today's Daily — not ready yet";
    }
    return;
  }
  // READY: the boards first, then the panel — the applier's cache is seeded before the first view so the picker draws
  // without paying `applicableMoves` for the board the server had already computed.
  finish();
  if (answer.value.readings) applier?.seedReadings(answer.value.puzzle.start, answer.value.readings);
  showDaily(answer.value.puzzle, day, answer.value.seed);
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
  // THE MOVES FIRST, for the reason the Drill waits for its presses: the server scores the RECORDED line and refuses a
  // submission that disagrees with it (`line_mismatch`), so this waits rather than racing them.
  await dailyMoveLog;
  const facts = run.submissionFacts(performance.now());
  const answer = await submitRun({
    runId: dailyRunId,
    mode: 'daily',
    levelIndex: run.view(performance.now()).level.index,
    date: dailyDay,
    elapsedSeconds: facts.clockSeconds,
    hintsUsed: facts.hintsUsed,
    attempts: 0,
    // THE DAILY HAS NO REVEAL, so this is always zero and the server ignores the field for it (A28). It is sent
    // rather than omitted because the shape is one shape: a mode that needed a second submission type to say "not
    // applicable" would be two contracts to keep in step, which is what this module exists to avoid.
    reveals: 0,
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

/**
 * Record one move of the Daily's line, where the server is the one keeping it.
 *
 * A DEMO SENDS NOTHING: a signed-out player's Daily is unranked and never submitted, so its moves would be writes
 * the server refuses (A20) and refusals A25 counts. The local run keeps its own move stack either way, which is what
 * the review replays and what a later sign-in imports.
 *
 * ONLY A MOVE THAT LANDED IS SENT. An illegal call never entered the line and an over-budget one was refused by the
 * session, so recording either would spend a log entry on a move the replay will not reproduce — the two sides'
 * logs would then differ in length for no reason.
 */
function logDailyMove(move: 'add' | 'undo' | 'redo', call: string | null = null): void {
  if (!apiConfigured() || !mayWrite(currentStanding())) return;
  if (dailyDay === '') return;
  const levelIndex = dailyLevelIndex;
  const date = dailyDay;
  dailyMoveLog = dailyMoveLog.then(() => recordDailyMove(levelIndex, date, move, call));
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
  logDailyMove('add', call);
  persist();
  startReplay(applier.motion([call], from), result.verdict === 'correct' ? 'advance' : 'settle');
}

function undoDaily(): void {
  if (!daily || PLAYHEAD.isRunning) return;
  if (!daily.undo()) return;
  logDailyMove('undo');
  dailyScreen.say('Undone — and the clock kept running, and any hint is still spent.', 'info');
  paintDaily();
  persist();
  draw();
}

function redoDaily(): void {
  if (!daily || PLAYHEAD.isRunning) return;
  if (!daily.redo()) return;
  logDailyMove('redo');
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
  let serverNamed: string | null = null;
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
    // AND SO IS ITS NAME (A23's naming): the server looked the call up from the line it RECORDED, which is the board
    // the player is actually on, where this app's own look-up runs from the position it believes it is on.
    serverNamed = answer.value.call;
  }
  const hint = daily.takeHint(serverNamed);
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
  els.toLevel.addEventListener('click', () => {
    drillView = 'level';
    paintView();
    renderLevel();
  });
  els.modeDaily.addEventListener('click', () => setMode('daily'));
  els.next.addEventListener('click', () => issueCurrentDrill('advance'));
  els.review.addEventListener('click', review);
  els.skip.addEventListener('click', skipDrill);
  els.undo.addEventListener('click', undoDaily);
  els.redo.addEventListener('click', redoDaily);
  els.hint.addEventListener('click', () => void takeHint());
  els.giveUp.addEventListener('click', giveUpDaily);
  els.replayMine.addEventListener('click', () => replayLine('mine'));
  els.replayShortest.addEventListener('click', () => replayLine('shortest'));
  els.view.addEventListener('click', toggleView);
  els.practice.addEventListener('click', startPractice);
  els.startOver.addEventListener('click', startOver);

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
