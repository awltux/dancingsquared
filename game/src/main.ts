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
// never arrived must not silently rank the run. THE SERVER IS THE ONLY SCORER (see the header scores' state below): a
// revealed run is submitted with its reveal count and the server decides its standing; there is no local ledger to apply
// the rule to any more.
import { utcDay } from './puzzle/daily.ts';
import { sanitizeAlias } from './puzzle/alias.ts';
import { reachedGoal } from './puzzle/arrangement.ts';
import { levelSpec, LEVEL_SIZE } from './puzzle/levels.ts';
// WHICH BOARD A RUN IS ON, as a pure rule: the period used to be decided here, over shell state and the clock, so no
// probe could ask it which board a drill lands on (`puzzle/board-period.ts`).
import { boardPeriodOf } from './puzzle/board-period.ts';
import { blockCells, blockPercent, blockSummary } from './puzzle/block.ts';
import { MAIN_POOL } from './puzzle/pool.ts';
import { scoreRun, type RunScore } from './puzzle/score.ts';
import { scoreLine } from './puzzle/score-line.ts';
import { adoptedBoard, boardEntryOf, type BoardTotal } from './game/stats.ts';
import { frameDelta, shouldAnimate } from './ui/frame-clock.ts';
import { earningProgress, refusedSpend, type HintLedger } from './puzzle/hints.ts';
import { HINT_CAP } from './puzzle/config.ts';
import type { GameApplier, LevelSpec, Puzzle, SequenceMotion } from './puzzle/types.ts';
import { createLevelRuntime } from './data/corpus.ts';
import { DrillController } from './game/drill.ts';
import { DailyRun } from './game/daily-run.ts';
import { drillClockOrigin, Stopwatch } from './game/clock.ts';
import { PseudonymDeck } from './puzzle/pseudonym.ts';
import { newRunId, wallGapMs, type DrillSaved, type StorageLike } from './game/store.ts';
import { advanceDrill, apiConfigured, browserDeps, claimAlias as claimAliasAt, dailyChallenge, fetchDrillReplay, fetchLeaderboard, fetchProfile, issueDrill, pollDaily, recordDailyMove, recordDrillAnswer, rememberAuthMode, replayDrill as requestReplay, spendHint, submitRun, type ApiResult, type HintSpend, type IssuedDrill, type RegimeState } from './net/api.ts';
import { changePassword, confirmAccount, currentPlayer, discoverAuth, refreshIfExpired, signIn, signOut, signUp, type AuthMode, type SignedIn } from './net/auth.ts';
import { mayWrite, signInOffered, standingOf, type Standing } from './net/standing.ts';
import { SaveState } from './game/save-state.ts';
import { LOCAL_SCHEDULE, scheduleEntryFor, scheduleLength } from './game/schedule-fixture.ts';
import { seasonPuzzleFor } from './game/season.ts';
import { GameStage, type StagePair, type ViewMode } from './render/stage-view.ts';
import { applyTheme } from './ui/theme.ts';
import { layoutFor, type Layout } from './ui/layout.ts';
import { pairLeftBoard, waypointPair, type WaypointPair } from './puzzle/waypoint-pair.ts';
import { boardCaption } from './puzzle/caption.ts';
import { replayLine, callAt, type ReplayLine } from './puzzle/replay-line.ts';
import { ReplayList } from './ui/replay-list.ts';
import { DrillScreen } from './ui/drill-screen.ts';
import { LevelScreen } from './ui/level-screen.ts';
import { DailyScreen } from './ui/daily-screen.ts';
import { AccountScreen } from './ui/account-screen.ts';
import { LeaderboardScreen } from './ui/leaderboard-screen.ts';
import { LANDING_HOLD_MS, Replay, drillAnswerHoldMs } from './ui/playhead.ts';
import { el } from './ui/dom.ts';
import { bannerView, type BannerFacts } from './ui/banner.ts';
import { backLabel, backTarget, hashFor, pageFor, pageHeadingId, pageOwnsBootOverlay, pageShowsBoard, pageTitle, showsStandings, type Page, type Route } from './ui/pages.ts';
import type { Board } from 'dancing-squared-engine';

type AppMode = 'drill' | 'daily';
/** What finishing the replay now running means: advance the step, or just settle where it landed. */
type ReplayOutcome = 'advance' | 'settle';

const PLAYHEAD = new Replay();
/**
 * THE PLAY MODE — what the next drill-shaped request is about, and which half of the board a run belongs to.
 *
 * IT IS NOT THE PAGE. A page is a place in the app (`ui/pages.ts`); a mode is which of the two games is being played, and
 * only three pages play one. Help is not a mode, so visiting it must not re-issue the Daily and restart a clock — which is
 * why `applyPage` sets this for the two play pages and leaves it alone everywhere else.
 */
let mode: AppMode = 'drill';
/**
 * WHERE THE PLAYER IS, as the router understands it — the authority for every visibility decision in this file.
 *
 * `mode` is derived from this rather than held alongside it, so "which panel is showing" has ONE answer and it is the one
 * in the URL (`ui/pages.ts`). The Drill's block and its question used to be two views of one tab, selected by a
 * `drillView` flag this file no longer carries: they are two PAGES (`#/levels` and `#/drill`), and a flag that says which
 * half of one tab is showing has no meaning when the location says it.
 */
let page: Page = 'landing';
let viewMode: ViewMode = '2d';

/**
 * WHICH BOARD the board page is showing. It is the board's OWN filter rather than the last play mode, because the board is
 * a read: a player who has never opened a drill can still read the Daily board, and a player who just played the Daily
 * does not want the Drill board without asking for it.
 */
let boardMode: AppMode = 'drill';

/** The hash this app last applied, so a URL it already wrote does not re-enter `applyPage` through `hashchange`. */
let appliedHash: string | null = null;

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
 * THE HEADER'S TWO SCORES, as the server last reported them — or null when it has not.
 *
 * THE SERVER IS THE ONE POINT OF TRUTH FOR A SCORE. REPORTED: "I would like to move away from the offline score. You can
 * play without logging in, but you need access to the server and so the score should be stored on the server. A single
 * point of truth." The device's own ledger is gone, so there is nothing to fall back to: a signed-out or practice run is
 * unscored, and the header says so (0 / no Daily score) rather than showing a different quantity.
 *
 * THEY ARE SEEDED BY EVERY DRILL READ, every submission, and the profile read (`/me/profile` carries both boards), so a
 * reload on any page has them. Cleared on sign-out: they belong to the account.
 */
let serverDrillBoard: BoardTotal | null = null;
let serverDailyBoard: BoardTotal | null = null;

/**
 * THE HINT BALANCE, as the server last stated it — or null when the app has not been told.
 *
 * IT IS THE SERVER'S AND IT IS NOT PERSISTED. REPORTED: "When logged out, the hints bank still shows my hints, it
 * should be empty. The hint bank should be stored on the server, not locally." The balance used to be a field of the
 * saved record, so a signed-out page drew the last player's copy and a reload resurrected a number the server had
 * already spent. It is now shell memory: seeded by `/me/profile` (every signed-in boot), by a submission's answer, and
 * by a spend or its refusal; CLEARED on sign-out and on "start over", so a signed-out page holds nothing to show.
 *
 * NULL MEANS "NOT TOLD", and the screen draws the empty balance rather than claiming one: a demo cannot spend a hint
 * (the spend is a server write, A20), so zero is the honest number there.
 */
let serverHints: HintLedger | null = null;

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
 * Whether the visible `Next drill` is really the DEMO's way on — a press goes to the profile page rather than advancing a
 * season this caller cannot advance (`offerNext`).
 */
let nextOffersSignIn = false;

/**
 * THE PRESSES POSTED SO FAR, as one chain, so the submission can wait for them (DESIGN.md 11.1, A22).
 *
 * `attempts` is counted from what POST /drill/answer RECORDED, so a run submitted before its presses arrived is
 * refused `no_press_log` — a refusal this app would have caused itself rather than a cheat it caught. Chaining
 * rather than Promise.all keeps the recorded order the order the player pressed in, and the chain never rejects
 * (`recordDrillAnswer` answers with an ApiResult), so one failed press does not stop the rest from being sent.
 */
let pressLog: Promise<unknown> = Promise.resolve();

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
/**
 * THE PLAYER'S PUBLIC NAME, from `GET /me/profile` — the only thing the UI may call them by.
 *
 * REPORTED: "the user needs a login alias that can be displayed in the leaderboard. Dont expose the email address
 * anywhere on the UI." So this is a THIRD piece of session state beside `player` (the tokens and the subject, which the
 * protocol needs) and it is the one the screen draws: the badge's name, the landing sentence and the profile page. It is
 * null both when nobody is signed in and when a signed-in player has not claimed a name, which is why `player` is still
 * how those two cases are told apart.
 */
let playerAlias: string | null = null;
let demoRun = false;

/** The Daily's run, the UTC day and the level it was issued for. */
let daily: DailyRun | null = null;
let dailyDay = '';
let dailyLevelIndex = 0;
/**
 * The run id the Daily's result has ALREADY been submitted for.
 *
 * IT REPLACES THE LOCAL RECORD'S IDEMPOTENCE. `paintDaily` runs on every event, and a solved outcome is painted more than
 * once; the ledger's `recordDailyRun` used to answer `0` on a second paint and gate the submit. With the ledger gone, this
 * is the once-only key — a different run id is a different run.
 */
let dailySubmittedFor = '';

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
 * WHICH LINE'S CALLS THE PANEL IS SHOWING, as a key (`which:call>call>…`), or null while nothing is listed. The list is
 * rebuilt only when that key changes, because `paintDaily` runs on every event and the list is DOM.
 *
 * IT IS NOT `replay` ABOVE: `replay` is the TRANSIENT motion of one press, which clears itself when it lands. The list is
 * a record — the same calls, as text — and it stays until the player leaves the puzzle.
 */
let shownCalls: string | null = null;
/**
 * THE LINE BEING PLAYED, as the boundaries the highlight needs, or null when nothing is playing.
 *
 * It is set when Play starts a line and cleared when the motion lands or is abandoned, so the frame loop can ask
 * callAt which call is active — the playhead knows the BEAT, and puzzle/replay-line.ts knows which call that beat is
 * in.
 */
let playingLine: ReplayLine | null = null;
/** Which line the panel is showing: the player's own, or the generator's shortest. */
let reviewWhich: 'mine' | 'shortest' = 'mine';

/**
 * THE DRILL BEING WATCHED, when a completed cell was opened from the block: its position and its level. Non-null means
 * the drill panel is in WATCHING state — there is no question to answer and nothing may be submitted — and the footer
 * lists the calls that solved it.
 */
let watchingDrill: { index: number; levelIndex: number; passed: boolean } | null = null;

/**
 * WHICH TWO WAYPOINTS THE STAGE IS SHOWING, when the player has paged away from the front, or `null` to follow the
 * player. `puzzle/waypoint-pair.ts` owns what the pair means; this is only the shell's memory of where the player
 * left it.
 *
 * IT RESETS ON EVERY PLAY ACTION — a move, an undo, a redo, an answer, a new puzzle, a mode switch — because paging
 * is a look at the route and the next move means the player is done looking. Without that the boards would keep
 * showing a preview while the panel offered calls from a board the player could no longer see.
 */
let waypointCursor: number | null = null;

/**
 * THE FRONT THE LIVE PAIR IS HOLDING, or null to follow the player — the other half of the window's state.
 *
 * A SUCCESS SETS IT, to the front that was on screen BEFORE the call, so reaching a waypoint does not move the pair: the
 * player watches the call land into the board they were aiming at, instead of the right-hand board being replaced by the
 * next one mid-animation. REPORTED: "the right hand immediately auto-skips to the next board … Moving to the next
 * waypoint should be left to the player by pressing the navigation buttons." The arrow clears it, and so does an undo or
 * a new puzzle — those are the player saying where they want the window. `waypointPair`'s own header carries the rule.
 */
let waypointHold: number | null = null;

/**
 * WHETHER THE DRILL MOVES ON BY ITSELF once a correct guess has been watched — the `Auto-progress` toggle's state.
 *
 * REPORTED: "add an auto-progress stateful button to the drills tab. This will automatically progress to the Next Drill
 * after the current 2 second pause following a correct guess."
 *
 * IT IS A PREFERENCE, NOT A RULE OF THE GAME, so it is the SHELL's and it is held for the session rather than written
 * into the saved record: `SaveState` carries what a run earned, and every field in it is a schema the loader must
 * migrate (`save-state.ts`), which a view preference does not earn. So it resets on reload, and the button says which
 * state it is in so that is visible rather than surprising.
 */
let autoProgress = false;

/** Write the toggle's state onto it — `aria-pressed` AND the label, so the state is not colour-only. */
function paintAutoProgress(): void {
  els.autoProgress.setAttribute('aria-pressed', autoProgress ? 'true' : 'false');
  els.autoProgress.textContent = `Auto-progress: ${autoProgress ? 'on' : 'off'}`;
}


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
/**
 * The DEVICE's reading at which the drill on screen started, and the calls it has advanced with, both persisted.
 *
 * IT IS A DEVICE READING AND NOT THE SERVER'S STAMP (`clock.ts`'s `drillClockOrigin`): the elapsed it becomes is
 * subtracted from another reading of the same clock, and subtracting the server's stamp from `Date.now()` is what
 * refused a run from a second device — "the run claims 50.4s and the drill was issued 13.3 seconds ago", 37 s of
 * clock offset rather than play.
 */
let drillStartedAtMs = 0;
let drillOptions: string[] = [];

let lastFrameMs = 0;

/**
 * THE SHELL'S SHAPE FOR THE CURRENT VIEWPORT — the one answer `ui/layout.ts` gives, used by the board framing and (as
 * custom properties) by the stylesheet. A default is set here so the first paint has a shape before `main()` measures
 * the window; the desktop default is the one the game has always had.
 */
let layout: Layout = layoutFor(1440, 900);

/**
 * WHICH BOARD THE SINGLE-BOARD VIEW IS SHOWING. A wide viewport shows both and never reads this (`ui/layout.ts` answers
 * `boards: 'pair'` there); a narrow one shows one, starts on the player's own board, and the tabs over the floor choose.
 * THE GHOST LAYER IS WHAT MAKES THE CHOICE CHEAP: the board that is not drawn still has its dancers on the floor, so
 * switching emphasis costs one tap and no memory (`render/ghost-pair.ts`).
 */
let boardFocus: 'left' | 'right' = 'left';

const els = {
  stageCanvas: el<HTMLCanvasElement>('stage'),
  labelHere: el('labelHere'),
  labelGoal: el('labelGoal'),
  boardTabs: el('boardTabs'),
  boardYou: el<HTMLButtonElement>('boardYou'),
  boardTarget: el<HTMLButtonElement>('boardTarget'),
  waypointPrev: el<HTMLButtonElement>('waypointPrev'),
  waypointNext: el<HTMLButtonElement>('waypointNext'),
  bannerBack: el<HTMLButtonElement>('bannerBack'),
  bannerPips: el('bannerPips'),
  // THE HINT BADGE IS A BUTTON NOW (REPORTED: "Daily: Remove the Hint button and move the event handler to the hint bank
  // badge in the header"), so it is typed as one: the shell writes its `disabled` state and its accessible name.
  bannerHints: el<HTMLButtonElement>('bannerHints'),
  bannerScores: el('bannerScores'),
  bannerLevel: el('bannerLevel'),
  bannerAccount: el<HTMLButtonElement>('bannerAccount'),
  bannerDrill: el('bannerDrill'),
  bannerDaily: el('bannerDaily'),
  notice: el('notice'),
  landing: el('landing'),
  setupPage: el('setup'),
  helpPage: el('help'),
  profilePage: el('profile'),
  levelsPanel: el('levels'),
  drillPanel: el('drill'),
  dailyPanel: el('daily'),
  boardPanel: el('board'),
  // THE HEADINGS ARE NAMED ONE BY ONE RATHER THAN LOOKED UP FROM `pageHeadingId`, because that lookup is a computed id
  // (`el()` takes a literal) and `shell-controls-probe.mjs` is what proves every id this file asks for exists.
  headings: {
    landing: el('landingHeading'),
    setup: el('setupHeading'),
    help: el('helpHeading'),
    profile: el('profileHeading'),
    levels: el('levelsHeading'),
    drill: el('drillHeading'),
    daily: el('dailyHeading'),
    board: el('boardHeading'),
  } satisfies Record<Page, HTMLElement>,
  goProfile: el<HTMLButtonElement>('goProfile'),
  profileBoard: el<HTMLButtonElement>('profileBoard'),
  goHelp: el<HTMLButtonElement>('goHelp'),
  goLevels: el<HTMLButtonElement>('goLevels'),
  goDaily: el<HTMLButtonElement>('goDaily'),
  goSetup: el<HTMLButtonElement>('goSetup'),
  goBoard: el<HTMLButtonElement>('goBoard'),
  landingStatus: el('landingStatus'),
  boardModeDrill: el<HTMLButtonElement>('boardModeDrill'),
  boardModeDaily: el<HTMLButtonElement>('boardModeDaily'),
  balance: el('balance'),
  ledger: el('ledger'),
  undo: el<HTMLButtonElement>('undo'),
  redo: el<HTMLButtonElement>('redo'),
  replayMine: el<HTMLButtonElement>('replayMine'),
  replayShortest: el<HTMLButtonElement>('replayShortest'),
  view: el<HTMLButtonElement>('view'),
  next: el<HTMLButtonElement>('next'),
  autoProgress: el<HTMLButtonElement>('autoProgress'),
  practice: el<HTMLButtonElement>('practice'),
  startOver: el<HTMLButtonElement>('startOver'),
  loading: el('loading'),
};

const drillScreen = new DrillScreen(answer);
// A CELL PRESS IS A NAVIGATION: the drill is a page, so the press writes its URL and `applyPage` opens it through
// `openDrillPage` → `levelPlay`. That is what makes the browser's back button leave the drill for the block, and a reload
// of `#/drill/3` reopen the same position instead of forgetting it.
const levelScreen = new LevelScreen((index) => navigate({ page: 'drill', drillIndex: index }), levelNextLevel);
// A PARALLEL STEP IS ONE LINE ELEMENT (`Sides Trade || Heads Dosado`), which the applier reads back with the engine's
// own `parseStep`, so `playDailyCall` is the whole path: the session applies it, the line records the label and the
// server replays it. Nothing distinct to record, and nothing to keep in step with the single-call path.
const dailyScreen = new DailyScreen({ play: playDailyCall, parallel: playDailyCall });
// THE LIST IS THE SHELL'S TO FILL: the screen holds only the DOM, and `main.ts` decides which line is listed and
// call k", and `main.ts` decides, because it owns the one playhead and the review's line.
const replayList = new ReplayList();
// THE PSEUDONYM DECK: one per page, because "Next" must not deal the same name twice in a session.
const pseudonyms = new PseudonymDeck();
const accountScreen = new AccountScreen({
  signIn: (email, password) => void doSignIn(email, password),
  signUp: (email, password) => void doSignUp(email, password),
  confirm: (email, code) => void doConfirm(email, code),
  signOut: () => void doSignOut(),
  changePassword: (current, next) => void doChangePassword(current, next),
  claimAlias: (alias) => void doClaimAlias(alias),
  nextAlias: () => void doNextAlias(),
});
// THE THREE BOARDS ARE ONE SCREEN EACH, over their own elements: the page's in-panel list on a sheet, and the two
// full-screen standings in `#sideBoard`. The screens are handed their elements rather than resolving ids themselves,
// because the same read is drawn by more than one of them (`ui/leaderboard-screen.ts` says why).
const boardScreen = new LeaderboardScreen(
  { caption: el('boardCaption'), status: el('boardStatus'), list: el('boardList'), load: el<HTMLButtonElement>('boardToggle') },
  { load: () => refreshBoards() },
);
const sideDrillScreen = new LeaderboardScreen({ caption: el('sideDrillCaption'), status: el('sideDrillStatus'), list: el('sideDrillList') });
const sideDailyScreen = new LeaderboardScreen({ caption: el('sideDailyCaption'), status: el('sideDailyStatus'), list: el('sideDailyList') });
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

/**
 * THE WAYPOINTS THE STAGE IS SHOWING, as boards, captions and a progress index — or null when there is nothing to
 * show (no drill on screen, no Daily). ONE READER FOR BOTH MODES, because the pair means the same thing in each: the
 * left board is the setup the player is on, the right one the waypoint to reach.
 *
 * THE ENGINE'S NAMES ARE CAPTIONS, NEVER TESTS (DESIGN.md 15 Q10). They are rotation-invariant and cannot tell two
 * waypoints apart, which is why the numbered caption carries the position and the name is an aside.
 */
interface WaypointInfo {
  /** The puzzle's waypoints, start first and goal last (`puzzle/arrangement.ts`). */
  boards: readonly Board[];
  /** One caption per waypoint: the engine's name where it has one, empty where it has not. */
  labels: readonly string[];
  /** How many waypoints the player has reached, in order — what `waypointPair` clamps the front to. */
  progress: number;
  /** The player's own board, which is the left board while the pair is live. */
  here: Board;
}

function waypointInfo(): WaypointInfo | null {
  // THE CAPTION, AND THE CORPUS IS THE AUTHORITY FOR IT: the curated recogniser first (the vocabulary a dancer would
  // use), then the wider corpus name for an arrangement it does not standardise, and no name at all for a board the
  // corpus has no template for — which the caption then spells as its position.
  const name = (b: Board): string => applier?.nameOf(b) ?? applier?.formationOf(b) ?? '';
  if (mode === 'daily' && daily) {
    const view = daily.view(performance.now());
    return {
      boards: view.waypoints.map((waypoint) => waypoint.board),
      labels: view.waypoints.map((waypoint) => waypoint.label),
      progress: view.progress,
      here: view.board,
    };
  }
  if (controller) {
    const view = controller.view();
    return {
      boards: view.waypoints,
      labels: view.waypoints.map(name),
      progress: view.progress,
      here: view.from,
    };
  }
  return null;
}

/** The pair the stage draws: the two boards and the state each border reports. */
function currentPair(): { stage: StagePair; pair: WaypointPair; info: WaypointInfo } | null {
  const info = waypointInfo();
  if (!info) return null;
  const pair = waypointPair(info.boards.length, info.progress, waypointCursor, waypointHold);
  return {
    stage: {
      // THE LEFT SLOT IS THE WAYPOINT, NOT THE PLAYER'S OWN POSE — the rule is `pairLeftBoard`'s, because it is the one
      // answer both modes need and it used to differ between them. REPORTED: "Drill and Daily: After attempting an incorrect
      // call and the two-second pause, reset the board to the 'Now' setup. Currently it seem to leave the end of the
      // incorrect call in place." The landing is what the motion and its hold show; the resting pair is the two waypoints,
      // so the picture and the "<n>: <name>" captions agree.
      left: pairLeftBoard(pair, info.boards, info.here),
      right: info.boards[pair.rightIndex] ?? info.here,
      leftIndex: pair.leftIndex,
      rightIndex: pair.rightIndex,
      leftState: pair.left,
      rightState: pair.right,
    },
    pair,
    info,
  };
}

/**
 * THE BOARD SWITCHER, and the one place the stage is told which board to draw.
 *
 * IT IS THE `boards` ANSWER THAT DECIDES: a wide viewport shows the pair and this hides the tabs, because a control that
 * changes nothing is worse than no control. A narrow one shows a single board, the tabs become the way between the two,
 * and `stage.setFocus` does the drawing (`render/stage-view.ts`). Both boards' captions exist either way; the one that is
 * not on the floor is hidden in `paintWaypoints`.
 */
function paintBoardTabs(): void {
  const single = layout.boards === 'single';
  els.boardTabs.hidden = !single;
  els.boardYou.setAttribute('aria-pressed', String(boardFocus === 'left'));
  els.boardTarget.setAttribute('aria-pressed', String(boardFocus === 'right'));
  stage.setFocus(single ? boardFocus : null);
}

/**
 * Switch which board the single-board view shows — and SCRUB TO THE SOLVING PAIR FIRST.
 *
 * REPORTED: "The [Now, Target] widget currently applies to the currently displayed board which might not be the one to be
 * solved, but I want them to first scrub to the last completed (green) board the subsequent uncompleted board. The
 * 'Now|Target' buttons will flip between the point where the player is supposed to be solving." So a press is not a
 * switch over whatever preview the zones left on screen: it puts the window back on `solvingPair` (last completed, next to
 * solve) and THEN picks a side of it.
 *
 * THE HOLD GOES WITH THE CURSOR, and that is the half a press would otherwise miss: after a success the window is held on
 * the waypoint just reached so the right-hand board does not auto-skip, which leaves BOTH boards solved — a pair the widget
 * would happily flip between while neither is the board to solve next (`waypoint-pair.ts` records the report).
 */
function setBoardFocus(focus: 'left' | 'right'): void {
  const scrubbed = waypointCursor !== null || waypointHold !== null;
  if (scrubbed) {
    waypointCursor = null;
    waypointHold = null;
  }
  if (boardFocus === focus && !scrubbed) return;
  boardFocus = focus;
  paintBoardTabs();
  paintWaypoints();
  draw();
}

/**
 * The captions over the boards and the paging buttons — from the SAME pair the stage draws, so the words
 * and the pictures cannot disagree about which waypoint is which.
 */
function paintWaypoints(): void {
  const current = currentPair();
  if (!current) {
    els.labelHere.textContent = 'Setup';
    // NO HOVER WHEN THERE IS NO BOARD, or the previous puzzle's id would sit over a panel showing nothing.
    els.labelHere.removeAttribute('title');
    els.labelGoal.textContent = 'Next waypoint';
    els.labelGoal.removeAttribute('title');
    // NOTHING IS ON THE FLOOR, SO NOTHING NAMES IT. Both captions are centred in the single-board layout and a page with no
    // puzzle never reaches the branch below that hides one of them — REPORTED as a caption reading "NextWwaypoint" on a menu
    // page at 500 px, which is the two labels drawn on top of each other. The text stays in the DOM (it is what the next
    // paint replaces) and the labels are hidden until there is a board to name.
    els.labelHere.hidden = true;
    els.labelGoal.hidden = true;
    els.waypointPrev.hidden = true;
    els.waypointNext.hidden = true;
    return;
  }
  const { pair, info, stage } = current;
  // THE WORDS ARE THE WAYPOINT'S AND THE HOVER IS THE DRAWN BOARD'S — the two come apart on the live pair, whose left
  // panel is the player's own board. `puzzle/caption.ts` states the rule and why the name cannot answer for it.
  const here = boardCaption({
    index: pair.leftIndex,
    label: info.labels[pair.leftIndex] ?? '',
    board: stage.left,
  });
  const next = boardCaption({
    index: pair.rightIndex,
    label: info.labels[pair.rightIndex] ?? '',
    board: stage.right,
  });
  els.labelHere.textContent = here.text;
  els.labelHere.title = here.hover;
  els.labelGoal.textContent = next.text;
  els.labelGoal.title = next.hover;
  // ONE BOARD MEANS ONE CAPTION. The board that is not on the floor still has its caption in the DOM (the tabs name it),
  // so hiding it here is what stops a label floating over a board nobody can see. The ghost layer is what keeps the
  // comparison, not the caption.
  const single = layout.boards === 'single';
  els.labelHere.hidden = single && boardFocus !== 'left';
  els.labelGoal.hidden = single && boardFocus !== 'right';
  // A START-AND-END PUZZLE HAS ONE PAIR AND NOWHERE TO PAGE, so the zones are HIDDEN rather than shown disabled: the
  // smallest puzzle is two waypoints, and two inert quarters of the canvas would take taps that do nothing.
  const paged = info.boards.length > 2;
  els.waypointPrev.hidden = !paged;
  els.waypointNext.hidden = !paged;
  els.waypointPrev.disabled = !pair.canPrev;
  els.waypointNext.disabled = !pair.canNext;
}

/**
 * Page the pair along the waypoints, and return to the live pair when the front is reached.
 *
 * THE FRONT IS NOT A CURSOR VALUE: it is wherever the window is sitting (`waypointPair`'s `hold`, or the player's own
 * position when there is none), so paging back to it has to clear the cursor rather than store an index that a later move
 * would leave stale.
 *
 * THE FORWARD ZONE IS THE WAY ON FROM A HELD SUCCESS. A success leaves the pair where it was, so with a hold in force
 * the forward tap moves the window on by one and KEEPS THE LEFT BOARD LIVE — the player's own board on the left, the next
 * waypoint on the right — which is exactly what a player pressing it expects. Once it has caught up with where the
 * player actually is, the hold is dropped and the pair follows again.
 *
 * BOTH FRONTS ARE ASKED OF `waypointPair`, never recomputed here: a second copy of the clamp is a second rule, and the
 * clamp is exactly the part that is easy to get one out (AGENTS.md §5, "import the rule; never mirror it").
 */
function pageWaypoints(delta: number): void {
  const info = waypointInfo();
  if (!info) return;
  const maxLeft = Math.max(info.boards.length - 2, 0);
  const liveFront = waypointPair(info.boards.length, info.progress, null, waypointHold).leftIndex;
  if (waypointCursor === null && delta > 0 && waypointHold !== null) {
    const next = Math.min(liveFront + 1, maxLeft);
    const followed = waypointPair(info.boards.length, info.progress, null, null).leftIndex;
    waypointHold = next >= followed ? null : next;
    paintWaypoints();
    draw();
    return;
  }
  const pair = waypointPair(info.boards.length, info.progress, waypointCursor, waypointHold);
  const next = Math.min(Math.max(pair.leftIndex + delta, 0), maxLeft);
  waypointCursor = next === liveFront ? null : next;
  paintWaypoints();
  draw();
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
  // THE BALANCE IS THE SERVER'S, AND UNTIL IT SAYS, IT IS NOTHING. REPORTED: "When logged out, the hints bank still
  // shows my hints, it should be empty. The hint bank should be stored on the server, not locally." `serverHints` is
  // cleared on sign-out, so a signed-out page has none to draw; and a signed-in page that has not been told yet says so
  // rather than showing a zero that pretends to be a measured fact.
  const balance: HintLedger = serverHints ?? { hints: 0, successes: 0 };
  const p = earningProgress(balance);
  const held = p.full
    ? `Hints: ${balance.hints} of ${HINT_CAP} — full, so successes stop counting`
    : `Hints: ${balance.hints} of ${HINT_CAP} · ${p.successes} of ${p.needed} to the next`;
  // THE CLAUSE IS ABOUT WHOSE NUMBER IT IS. A demo can neither earn nor spend (A20: the spend is a server write), so a
  // signed-out page shows nothing; an unranked run on a signed-in page shows the account's balance and says the run
  // cannot spend it.
  const words = serverHints === null
    ? 'Hints: none on this page — the balance is the server’s, and it arrives with your account'
    : currentStanding() === 'unranked' ? `${held} — the server’s balance, which this run cannot spend` : held;
  // THE PIPS MOVED TO THE BANNER (REPORTED: "All pages have a thin banner containing current hints icons"), so this line is
  // the sentence only: the meter is on screen above every page, and a second one in the footer was the duplicate the report
  // was asking to be rid of. The footer keeps what the meter cannot say — how many successes the next hint needs.
  els.balance.textContent = words;
}

// ---------------------------------------------------------------------------------------------- the account

/**
 * Draw the profile page's identity row, and repaint the lines that claim what is kept.
 *
 * THE FOUR GO TOGETHER BECAUSE ONE FACT DECIDES ALL FOUR. Signing in does not merely change a button: it changes whether the
 * run on screen is ranked, so the ledger's sentence and the balance's clause are stale the moment the session changes, and
 * repainting them here is what keeps one story on screen instead of four.
 *
 * THE PASSWORD FORM READS THE SAME ADVERTISED LIST as the sign-in form, one route further: `POST /auth/password` is offered
 * only if `/health` named it, which is how the `cognito` half of this build (whose hosted flow owns passwords) ends up with no
 * form instead of a form that answers 404.
 */
function paintAccount(): void {
  accountScreen.show({
    standing: currentStanding(),
    mode: authMode,
    player,
    alias: playerAlias,
    offersForm: signInOffered({ mode: authMode, signin: signinRoutes, pinned: apiDeps.modeOverride !== undefined }),
    offersPassword: signinRoutes.includes('POST /auth/password'),
  });
  paintLanding();
  paintLedger();
  paintBalance();
  // A PLAYER WITH NO NAME IS OFFERED ONE, and the offer is dealt once per page rather than on every repaint: the screen
  // refuses to overwrite anything typed (`suggest`), so this is a first-paint fill and the Next button is how a player asks
  // for a different one.
  if (player !== null && playerAlias === null) {
    if (suggestedAlias === null) suggestedAlias = pseudonyms.next();
    accountScreen.suggest(suggestedAlias);
  }
}

/**
 * The landing page's session sentence.
 *
 * THE BUTTON NO LONGER NAMES THE SESSION, and that is the correction the badge made: it used to read "Register or sign in"
 * when nobody was and "Your account" when somebody was, which meant the menu was the second place that had to know the
 * session. It is "Profile" in the markup now, the badge in the banner is the account control in every state, and this
 * function is left with the one thing a menu should say — what an account changes, in the same voice as the ledger.
 * `offline` has nothing to sign in TO, and saying so is more honest than offering a form with nowhere to go.
 */
function paintLanding(): void {
  const standing = currentStanding();
  if (player) {
    els.landingStatus.textContent = playerAlias === null
      ? 'Signed in. Your runs are recorded on the server — claim a name on your profile to appear on the leaderboard.'
      : `Signed in as ${playerAlias}. Your runs are recorded on the server.`;
    return;
  }
  if (standing === 'offline') {
    els.landingStatus.textContent = 'No server is configured, so there is no account to sign in to and nothing is scored: you can play the practice drills, and they are not recorded anywhere.';
    return;
  }
  els.landingStatus.textContent = standing === 'ranked'
    ? 'No account needed on this server — it names the player for you. Signing in still keeps your progress.'
    : 'Playing without an account: everything works, and nothing on screen is scored or kept until you sign in.';
}

/**
 * The banner's cells: the hint meter, the account badge and the two scores.
 *
 * THE WORDS ARE `ui/banner.ts`'S, and this function only hands them over: which sentence a standing gets is a rule (and
 * one a probe can drive), while writing a handful of `textContent`s is not. The facts are read from the three places that
 * own them — the saved game for the balance and the runs, the session for the email, `standingOf` for whether a run counts
 * — so the banner cannot become a fourth copy of any of them.
 *
 * IT REPAINTS WITH THE LEDGER, because both are sentences about the same record: a run that has just been saved changes
 * the best score, the drill count and the balance at once, and repainting one without the other is how the two come to
 * disagree on screen.
 */
function paintBanner(): void {
  const view = bannerView(bannerFacts());
  // THE METER'S NUMBER IS AN ACCESSIBLE NAME: the badge shows three BARS and no text, so the `aria-label` is the only place
  // "Hints 2 of 3" exists. AND IT IS A BUTTON NOW (`ui/banner.ts`'s `hintsButton`): on the Daily the same name says what the
  // press does ("Take a hint (2 of 3 held)") and the element is enabled; everywhere else it is the meter it has always been,
  // disabled, so a tap on the row cannot spend a hint from a page that has no run to spend it on.
  //
  // THE BARS' STATE IS WRITTEN, NOT THEIR GLYPHS: `hintFills` says which slots are held and these `data-on` attributes
  // carry it to `style.css`, which is the one place that decides what a held slot looks like. A caller that rebuilt the
  // markup would be a second implementation of the meter's shape.
  const slots = els.bannerPips.children;
  for (let slot = 0; slot < slots.length; slot++) {
    slots[slot]?.setAttribute('data-on', String(view.hintFills[slot] === true));
  }
  // THE BUSY STATE OWNS THE BADGE WHILE A SPEND IS IN FLIGHT: `setHintBusy` writes the sentence that says what is happening,
  // and a repaint arriving mid-wait (a poll, a frame) must not overwrite it with the count. `setHintBusy(false)` repaints, so
  // the view's answer is what the badge returns to.
  const busy = els.bannerHints.dataset['busy'] === 'true';
  els.bannerHints.disabled = busy ? true : view.hintsButton.disabled;
  if (!busy) els.bannerHints.setAttribute('aria-label', view.hintsButton.label);
  // THE SCORES ARE LEVEL AND A GLYPH PER GAME (`ui/banner.ts` decides the values; the two icons are markup). The sentence
  // "Level 1: drill best 280, Daily no score" is the cell's accessible name, because the row prints `L1`, `280` and `—`.
  els.bannerLevel.textContent = view.levelText;
  els.bannerDrill.textContent = view.drillScore;
  els.bannerDaily.textContent = view.dailyScore;
  els.bannerScores.setAttribute('aria-label', view.scoresLabel);
  // THE GLYPH IS THE BADGE NOW (a circle with a person in it — the markup holds it and the icon is `aria-hidden`), so this
  // writes NO text: the two properties are the accessible name and the tooltip, and both are the sentence the paragraph this
  // button replaced used to state. `accountText` is still what a caller would draw if the badge ever showed a word.
  els.bannerAccount.title = view.accountTitle;
  els.bannerAccount.setAttribute('aria-label', view.accountTitle);
  els.bannerAccount.dataset['kind'] = view.accountKind;
}

/** The facts the banner is a function of, each read from the thing that owns it. */
function bannerFacts(): BannerFacts {
  const view = levelView();
  return {
    hintsHeld: serverHints?.hints ?? 0,
    playerAlias,
    signedIn: player !== null,
    standing: currentStanding(),
    drillLevel: view.levelIndex,
    // HOW FAR THROUGH THE LEVEL, from the block's own summary — the same numbers its "N of M done" line prints.
    drillPercent: view.percent,
    // THE TWO SCORES ARE THE SERVER'S, and only the server's: `serverDrillBoard`/`serverDailyBoard` are set from
    // `/drill/current`, `/me/profile`, a submission's answer or the board page, and never from anything the device counted.
    // A signed-out or practice player has no score — ZERO for the Drill (a real "nothing earned") and NO SCORE for the
    // Daily — rather than a device total that could disagree with the board (REPORTED twice).
    drillTotal: serverDrillBoard?.score ?? 0,
    dailyScore: serverDailyBoard?.score ?? null,
    hintAvailable: dailyHintAvailable(),
  };
}

/**
 * Whether the hint badge would spend a hint right now — THE ONE PREDICATE, because two callers must agree about it.
 *
 * REPORTED: "Daily: Remove the Hint button and move the event handler to the hint bank badge in the header." The badge is on
 * every page, so it has to be inert everywhere the spend cannot happen, and there are four such states: another page is on
 * screen (the balance is spent on the Daily alone, DESIGN.md 10), the run is over (there is nothing left to hint), a move is
 * still being danced (`PLAYHEAD.isRunning`, where a hint would name a call from the board the player is leaving), and a
 * spend is already in flight (`hintInFlight`, which is also what stops a second press charging a second hint for one intent).
 *
 * `bannerView` decides what that state SAYS (`hintsButton`); this decides what it IS. The two are not one function because
 * the view is a pure function of facts a probe drives, and this reads the shell's `page`, `daily`, the playhead and
 * `hintInFlight`.
 */
function dailyHintAvailable(): boolean {
  return page === 'daily' && daily !== null && !hintInFlight && !PLAYHEAD.isRunning
    && daily.view(performance.now()).outcome === 'playing';
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
  // THE NAME BEFORE THE FIRST PAINT, because every screen that names the player is drawn from it and one round trip is
  // cheaper than a repaint the player can see. A signed-out boot skips it entirely.
  await loadAlias();
  paintAccount();
  // AND ONLY NOW IS THE FIRST QUESTION ASKED, with an identity the server will accept — by the page the URL names, which
  // is the landing page unless the player came back to a bookmarked one.
  bootPage();
}

/**
 * The generated name on offer, or null before one has been dealt.
 *
 * THE DECK LIVES FOR THE LIFE OF THE PAGE (`pseudonyms`) so Next never deals the same name twice, and this is the name the
 * account screen shows when the player has not claimed one — REPORTED: "If the player hasnt provided a name, generate a
 * pseudonym ... The player can use a next button to generate a new one." It is an OFFER: claiming it is still the player's
 * press of Save, and the server's `alias_taken` refusal is the only uniqueness check there is.
 */
let suggestedAlias: string | null = null;

/** Deal another suggestion into the field. Claims nothing. */
function doNextAlias(): void {
  suggestedAlias = pseudonyms.next();
  accountScreen.suggest(suggestedAlias, true);
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
  await loadAlias();
  accountChanged();
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
    // THE ADDRESS IS NOT PRINTED BACK: REPORTED as "Dont expose the email address anywhere on the UI." The player typed
    // it a moment ago and knows which one, and an address in a sentence on a shared device is the exposure.
    accountScreen.say('Account created — confirm it with the code from your email to finish.', 'info');
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
  // AND THE NAME GOES WITH THE SESSION: it is the name of a player who is no longer signed in, and leaving it in the
  // banner would have the app claiming to be somebody it can no longer prove it is.
  playerAlias = null;
  // AND SO DO THE SCORES: they are somebody else's facts now, and there is no device sum to fall back to.
  serverDrillBoard = null;
  serverDailyBoard = null;
  // AND THE HINT BALANCE, WHICH IS THE REPORTED DEFECT THIS FIXES: "When logged out, the hints bank still shows my
  // hints, it should be empty." It was a field of the saved record, so signing out left it behind; the record holds no
  // balance any more and this is the memory that must go with the session.
  serverHints = null;
  // THE PASSWORD FIELDS GO WITH THE SESSION: a typed-but-unsent password must not be left in a form the next person at this
  // device can read, and the form itself is hidden by the next paint.
  accountScreen.clearPassword();
  accountScreen.sayPassword('');
  accountChanged();
  if (!answer.ok) accountScreen.say(`Signed out on this device — the server could not be told: ${answer.failure.message}`, 'bad');
}

/**
 * Read the player's public name — the only thing the UI is allowed to call them by.
 *
 * A READ, NOT A CLAIM, and it is awaited at boot and after a sign-in because every screen that names the player is painted
 * from it. A refused or unreadable read leaves `null`: the app then says "claim a name" rather than inventing one, and the
 * board still works, because the server resolves the names it shows.
 */
async function loadAlias(): Promise<void> {
  if (player === null) {
    playerAlias = null;
    // NO SESSION, NO BALANCE TO SHOW: the same rule as sign-out, reached by the boot that finds the session already
    // expired (`refreshIfExpired` clears it), so a page never inherits the previous player's hints through this path.
    serverHints = null;
    return;
  }
  const answer = await fetchProfile(apiDeps);
  playerAlias = answer.ok ? answer.value.alias : null;
  // THE HEADER'S SCORES ARE THIS PLAYER'S FACTS, and the profile is the one player-bound read every signed-in boot
  // makes — so adopting them here keeps the header right on EVERY page after a reload, not only after a play page has
  // issued a drill. A board the answer does not carry is "no news", not "no score": `adoptedBoard` keeps what the app
  // already knows rather than replacing it with nothing.
  if (answer.ok) {
    serverDrillBoard = adoptedBoard(serverDrillBoard, answer.value.drillBoard, false);
    serverDailyBoard = adoptedBoard(serverDailyBoard, answer.value.dailyBoard, false);
    // THE BALANCE RIDES THE SAME READ (REPORTED: "The hint bank should be stored on the server, not locally"), and an
    // answer without it is NO NEWS: the balance the app already holds stays rather than being replaced by a zero that
    // would claim the player has spent everything.
    if (answer.value.hints !== null) serverHints = answer.value.hints;
  }
}

/**
 * Claim or change the public name.
 *
 * THE RULE IS CHECKED HERE FIRST so a name the game will not take is refused without spending a request — the app imports
 * the same `sanitizeAlias` the server enforces (`puzzle/alias.ts`), so the two cannot disagree about what is legal. The
 * one refusal only the server can give is `alias_taken`, which is why the answer is still what decides.
 */
async function doClaimAlias(raw: string): Promise<void> {
  const verdict = sanitizeAlias(raw);
  if (!verdict.ok) {
    accountScreen.sayAlias(verdict.message, 'bad');
    return;
  }
  accountScreen.setAliasBusy(true);
  const answer = await claimAliasAt(verdict.alias, apiDeps);
  accountScreen.setAliasBusy(false);
  if (!answer.ok) {
    // A SERVER THAT DOES NOT SERVE THE ROUTE IS OLDER THAN THIS BUILD, and saying so is worth the extra branch: REPORTED
    // as "Could not save that name — nothing serves /me/alias", which is the server's own 404 passing straight through.
    // The cause was a `dev:api` process started before this endpoint existed, and nothing in that sentence told the player
    // (or whoever runs the server) that a restart is the fix rather than the name.
    accountScreen.sayAlias(
      answer.failure.code === 'not_found'
        ? 'This game server is older than the app: it does not serve the name endpoint. Restart it, then try again.'
        : `Could not save that name — ${answer.failure.message}`,
      'bad',
    );
    return;
  }
  playerAlias = answer.value.alias;
  accountScreen.sayAlias(`Your name on the leaderboard is ${playerAlias}.`, 'ok');
  // THE BANNER AND THE MENU NAME THE PLAYER, so they are repainted from the one fact that just changed.
  paintAccount();
  paintBanner();
}

/**
 * Change the signed-in player's password.
 *
 * THE SERVER CHECKS THE CURRENT PASSWORD and revokes every other session (`api/src/auth/emulator.ts` says why), so this
 * function reports two facts rather than one: whether the change landed, and that the other sessions are gone. It does NOT
 * sign this device out — the access token in hand is still good until it expires, and signing the player out of the tab they
 * just used would be a surprise dressed as security.
 *
 * THE FIELDS ARE CLEARED ONLY ON SUCCESS. A refusal ("the current password is wrong") with an emptied form would make the
 * player retype the new password to discover the same refusal again; a success with a filled form leaves a password on screen.
 */
async function doChangePassword(current: string, next: string): Promise<void> {
  if (!player) return;
  accountScreen.setBusy(true);
  const answer = await changePassword(player.email, current, next, apiDeps);
  accountScreen.setBusy(false);
  if (!answer.ok) {
    accountScreen.sayPassword(`Could not change the password — ${answer.failure.message}`, 'bad');
    return;
  }
  accountScreen.clearPassword();
  accountScreen.sayPassword(
    answer.value.revoked === 0
      ? 'Password changed.'
      : `Password changed — ${answer.value.revoked} other session${answer.value.revoked === 1 ? '' : 's'} signed out.`,
    'ok',
  );
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
  // ONLY A PLAY PAGE RE-ISSUES: the same request is answered differently for a different identity, so a drill on screen
  // is stale the moment the session changes — but a player signing in on the account page has nothing on screen to
  // re-ask, and issuing anyway would put a run in flight nobody asked for. The page they go to next issues its own.
  if (page === 'levels' || page === 'drill') issueCurrentDrill('current');
  else if (page === 'daily') issueDaily();
}

// ------------------------------------------------------------------------------------------------ the board

/**
 * The period ONE board is for — a THIN SHELL around `puzzle/board-period.ts`, which owns the rule.
 *
 * THIS FUNCTION'S ONLY JOB IS NAMING ITS TWO INPUTS, and the split is the point: the rule ("a Daily board is the UTC
 * day, a Drill board is the set the SERVER issued, and null is an answer") is a pure function a probe can drive, and
 * everything that fed it here is shell state — the mode asked for, `serverIssued()`, `practiceRun`, and the clock. The
 * rule used to live in this file whole, and the drill half consulted `seasonOf(Date.now())`, which ranked runs on a board
 * their drill did not come from (`puzzle/board-period.ts`'s header has the measurement).
 *
 * `utcDay(new Date())` IS the daily half's own answer: the day IS the challenge, so the client computing it cannot
 * disagree with the server. The drill half reads the ISSUED drill's schedule version and nothing else.
 *
 * IT TAKES THE MODE, because the full-screen standings ask for BOTH at once (`loadDockBoards`); the board page passes its
 * own `boardMode` (`boardPeriod`), which is not the last mode played — the board is a read, and a player who has never
 * opened a drill must still be able to read the Daily board.
 */
function periodFor(mode: AppMode): string | null {
  const issued = serverIssued() ? serverDrill : null;
  return boardPeriodOf(mode, utcDay(new Date()), issued?.scheduleVersion ?? null);
}

/** The period for the board the PAGE is set to. */
function boardPeriod(): string | null {
  return periodFor(boardMode);
}

/** Choose which board the page shows, and re-read it. Two buttons rather than the last mode played — see `periodFor`. */
function switchBoardMode(next: AppMode): void {
  boardMode = next;
  els.boardModeDrill.setAttribute('aria-pressed', String(next === 'drill'));
  els.boardModeDaily.setAttribute('aria-pressed', String(next === 'daily'));
  refreshBoards();
}

// THE TWO SENTENCES A BOARD CAN FAIL WITH, in one place: the page's list and the full-screen standings are the same read,
// so a refusal must not be worded twice.
const NO_SERVER_BOARD = 'There is no server configured, so there is no board to show — and with no server nothing is scored, so this device has no runs of its own to list.';
const NO_SET_BOARD = 'There is no published set to show a board for — the Drill board holds one season, and this device has no server-issued drill on it.';

/**
 * Read one board and draw it on `screen` — the page's list or one of the full-screen standings.
 *
 * IT IS ON DEMAND, because a board is a request: a page is the press that asks for it (or, in full screen, the page's own
 * presence), and the board page's button reloads it. A build with no server gets the sentence rather than a spinner that
 * can never finish, and a refusal is shown in the server's own words.
 */
async function loadBoardInto(screen: LeaderboardScreen, mode: AppMode, levelIndex: number, period: string | null): Promise<void> {
  screen.clear();
  if (!apiConfigured()) {
    screen.say(NO_SERVER_BOARD);
    return;
  }
  if (period === null) {
    screen.say(NO_SET_BOARD);
    return;
  }
  screen.setBusy(true);
  const answer = await fetchLeaderboard(mode, levelIndex, period);
  screen.setBusy(false);
  if (!answer.ok) {
    screen.say(`The board could not be read: ${answer.failure.message}`, 'bad');
    return;
  }
  // `you` IS THE ID THIS APP BELIEVES IT IS, or null when it is nobody: the board is public (A20 serves reads to a
  // signed-out caller), so "which of these is me" is answered by the session rather than by hiding the list.
  screen.show(answer.value, player?.playerId ?? null);
  // THE HEADER AND THIS BOARD MUST BE ONE NUMBER. A leaderboard page that carries the caller's own row IS their row on
  // the board it names, so it is adopted for the header when this is the player's OWN level — another level's total is a
  // different fact. This is also the DAILY's source: the header's Daily cell has no other read. REPORTED: "On the landing
  // page, the score on the leaderboard for Drills (1818) is different to the drill score shown in the header (726)."
  if (levelIndex === (level?.index ?? save.levelIndex)) {
    const mine = boardEntryOf(answer.value.entries, player?.playerId ?? null);
    if (mine !== null) {
      if (mode === 'drill') serverDrillBoard = adoptedBoard(serverDrillBoard, mine, false);
      else serverDailyBoard = adoptedBoard(serverDailyBoard, mine, false);
      paintBanner();
    }
  }
}

/** The board page's single in-panel list — the SHEET's read (`refreshBoards`). */
async function loadPageBoard(): Promise<void> {
  await loadBoardInto(boardScreen, boardMode, level?.index ?? save.levelIndex, boardPeriod());
}

/**
 * THE FULL-SCREEN STANDINGS: both boards, in the area the dance board would have used.
 *
 * REPORTED: "When the Dance board is not being used, the area should be replaced by the leader boards." BOTH, because the
 * space is there and a page with no question should show the standings rather than one of them chosen by a control the
 * player has not touched. THE DRILL HALF BELONGS TO THE SET THE ISSUED DRILL CAME FROM, so its level is the drill's own,
 * the same pairing `periodFor` reads; a device with no issued drill has no set and its card says so.
 */
async function loadDockBoards(): Promise<void> {
  const levelIndex = level?.index ?? save.levelIndex;
  await Promise.all([
    loadBoardInto(sideDrillScreen, 'drill', serverDrill?.levelIndex ?? levelIndex, periodFor('drill')),
    loadBoardInto(sideDailyScreen, 'daily', levelIndex, periodFor('daily')),
  ]);
}

/**
 * Read the board(s) the LAYOUT shows — the one rule, called from every place that changes the answer.
 *
 * FULL SCREEN, PAGE WITHOUT A BOARD: both, in the side area (`showsStandings`). A SHEET: the board page's single
 * in-panel list, and nothing on the other pages. A GAME PAGE: nothing — the board on screen is the question.
 */
function refreshBoards(): void {
  if (showsStandings(page, layout.panelSide)) void loadDockBoards();
  else if (page === 'board') void loadPageBoard();
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
    ? 'Press again — the drill and Daily in flight here will be forgotten'
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
  // WHETHER A SERVER WAS IN PLAY, taken BEFORE the two fields below are cleared: with one, the block's cells come from
  // the server's Progress row and this reset cannot move them; without one the cleared save IS the progress, so there is
  // nothing left to explain.
  const serverWasInPlay = serverRegime !== null || serverDrill !== null;
  controller = null;
  daily = null;
  serverDrill = null;
  serverRegime = null;
  // THE SCORES ARE NOT THIS DEVICE'S TO KEEP, and the fresh issue that follows re-seeds them: clearing here is what
  // stops a reset showing a number for a record it has just deleted while the read is in flight.
  serverDrillBoard = null;
  serverDailyBoard = null;
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
  dailyMoveLog = Promise.resolve();
  paintLedger();
  paintBalance();
  // WHAT THE BUTTON CANNOT DO, SAID WHERE THE PLAYER IS LOOKING, because the alternative is concluding it is broken.
  // With a server configured the block is drawn from `serverRegime` — the server's Progress row — so the
  // `GET /drill/current` below answers exactly as before and the cells fill straight back in. REPORTED as "Start over
  // on this device button doesnt seem to delete the drill progress." THAT IS THE DESIGN: the drills and the Daily are
  // generated and PUBLISHED on the server from one shared schedule (`scheduleKey(level)` holds the seeds, `drillKey`
  // and `boardKey` the published puzzles), so every player is served the same ones and a score is comparable, while a
  // player's own row records only how far they have got. A client cannot reset that, and it would not help if it
  // could: a fresh regime is a new anonymous player looking at the SAME schedule. The reset that regenerates them is
  // server-side — an operator's action, not a button in the app.
  if (serverWasInPlay) {
    drillScreen.say(
      "Forgotten on this device: the drill and Daily that were in flight. Your drill progress, scores and hints are the server's and stay — the drills and the Daily are generated there, the same ones for every player, so only a reset on the server changes them.",
      'info',
    );
  }
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
    startedAtMs: drillStartedAtMs,
    // THE ISSUANCE THIS CLOCK BELONGS TO, so a reload only continues a clock for the same one (`clock.ts`).
    issuedAtMs: serverDrill?.issuedAtMs ?? 0,
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

/** What the server holds for this player, or that nothing is. */
function paintLedger(): void {
  // THE BANNER IS A SENTENCE ABOUT THE SAME FACT (its scores and the hint meter), so it is repainted here rather than left
  // to whichever caller remembers — including on the `saving: false` path below.
  paintBanner();
  if (!save.saving) {
    els.ledger.textContent = 'Saving is off — this browser blocks local storage, so the drill you are on will not be kept.';
    return;
  }
  // THE SCORES ARE THE SERVER'S. There is no device ledger to count any more, so this line reports the account's ranked
  // boards when the app knows them and says so when it does not — it never falls back to a sum of local runs.
  const parts: string[] = [];
  if (serverDrillBoard !== null) {
    const runs = serverDrillBoard.runs === 1 ? '1 run' : `${serverDrillBoard.runs} runs`;
    parts.push(`Drill ${serverDrillBoard.score} over ${runs}`);
  }
  if (serverDailyBoard !== null) parts.push(`Daily ${serverDailyBoard.score}`);
  const scores = parts.length === 0
    ? 'No score on the server yet.'
    : `On the server: ${parts.join(' · ')}.`;
  // THE STANDING IS SAID WHERE IT IS DECIDED, and the practice case is its own sentence: a practice drill is not scored at
  // all now, so "kept here" would be the wrong reassurance.
  const clause = currentStanding() === 'unranked'
    ? practiceRun
      ? ' This is a practice drill — it is not scored.'
      : ' Not ranked: the server is not recording this run.'
    : '';
  els.ledger.textContent = `${scores}${clause}`;
}

// ---------------------------------------------------------------------------------------------- the pages

/**
 * Put the app on the page a route names, whatever it was on before.
 *
 * ONE FUNCTION, ONE ORDER, and every step is there for a reason:
 *   1. TEAR DOWN the run the player is leaving — a half-finished slide, a watched drill, a review line, an armed reset.
 *      It is done FIRST, like the mode switch it replaces, so nothing below can be painted from the old puzzle.
 *   2. SET `page` and, for the two play pages only, the mode. THE MODE IS NOT THE PAGE: visiting Help must not re-issue
 *      the Daily and restart the clock a player has already spent, so a page that plays nothing leaves `mode` alone.
 *   3. PAINT the page (exactly one section), the chrome (title and back button) and the footer's page-dependent controls.
 *   4. ENTER the page — issue the drill, open the daily, load the board — because which page you are on is what decides
 *      what is in flight. This is the step that used to be `applyMode`'s tail.
 *
 * A URL NEVER ADVANCES THE SEASON: every path here ISSUES the drill the player is already on or reopens a closed cell,
 * and `drillIndex` can only ever name a position (`openDrillPage`).
 */
function applyPage(route: Route, focus: boolean): void {
  const next = route.page;
  waypointCursor = null;
  waypointHold = null;
  // A HALF-FINISHED SLIDE BELONGS TO THE PUZZLE THE PLAYER JUST LEFT, so it is stopped rather than carried across —
  // and the pair is FORGOTTEN, so the next page's boards are painted rather than slid to from this one's.
  stage.forgetPair();
  PLAYHEAD.cancel();
  replay = null;
  // A REVIEW OR A WATCHED DRILL BELONGS TO THE PUZZLE THE PLAYER JUST LEFT, like the walk it samples: its line is that
  // puzzle's, so it goes with the motion rather than being carried into the next page's footer.
  shownCalls = null;
  playingLine = null;
  watchingDrill = null;
  replayList.hide();
  // A PAGE CHANGE DISARMS "START OVER": it is the clearest sign the player has moved on, and a control still armed
  // minutes later would fire on one stray press.
  startOverArmed = false;
  paintStartOver();
  // NOTHING IN THE FOOTER BELONGS TO EVERY PAGE, so every page-dependent control is withdrawn here and revealed by the
  // paint of the page that owns it. MEASURED in a browser: without this the Daily's Undo and Redo stayed on screen behind the
  // board, because the footer had been painted by a page the player had left (the Hint and Give up buttons it also named have
  // since left the footer altogether — REPORTED: "move the event handler to the hint bank badge in the header" and "Remove the
  // Give Up button, this is the same as using the back button").
  hideFooterControls();

  page = next;
  if (next === 'levels' || next === 'drill') mode = 'drill';
  if (next === 'daily') mode = 'daily';

  paintPages();
  paintChrome();
  paintView();
  // A REDIRECT CARRIES ITS SENTENCE. `replacePage` applies another page immediately (through `hashchange`), and that
  // application clears the notice as its first act — so the sentence a deep link's refusal has to say is handed over here
  // rather than written before the redirect and wiped by it.
  const carried = pendingNotice;
  pendingNotice = null;
  if (carried) notice(carried.text, carried.kind);
  else notice('');
  if (focus) els.headings[next].focus();

  switch (next) {
    case 'levels':
      issueCurrentDrill('current');
      break;
    case 'drill':
      openDrillPage(route.drillIndex);
      break;
    case 'daily':
      issueDaily();
      break;
    case 'board':
      // THE DRILL BOARD NAMES A PUBLISHED SET, AND A DEVICE THAT HAS NOT BEEN GIVEN A DRILL DOES NOT KNOW IT: the version
      // comes from the server's answer (`puzzle/board-period.ts` — null is an answer, and a date computed here is the
      // measured defect that module exists for). So the page opens on the DAILY's board, whose period is the UTC day the
      // client can compute, and says why — an empty board presented as the standings would be worse than either.
      //
      // THAT FALLBACK IS THE SHEET'S, because the sheet shows ONE list. A full-screen page shows BOTH standings, so it has
      // nothing to choose between and must not say "this is the Daily board" with the Drill card beside it — its Drill
      // card says it has no set yet, which is the true fact.
      if (!showsStandings(next, layout.panelSide) && boardMode === 'drill' && boardPeriod() === null) {
        boardMode = 'daily';
        notice('The Drill board holds the season the server issued, and this device has not been given a drill yet — this is the Daily board.');
      }
      els.boardModeDrill.setAttribute('aria-pressed', String(boardMode === 'drill'));
      els.boardModeDaily.setAttribute('aria-pressed', String(boardMode === 'daily'));
      break;
    default:
      // NOT A PLAY PAGE, so the footer's text is repainted from the record it is about (a balance and a ledger do not
      // change by navigating, but they are the only two lines left on this page and a stale one is worse than none).
      paintLedger();
      paintBalance();
      break;
  }
  // THE BOARDS FOLLOW THE PAGE, through the one rule in `refreshBoards`: the full-screen standings on a page with no dance
  // board, the board page's in-panel list on a sheet, and nothing on a play page. It runs after the switch so the board
  // page's mode fallback above is already decided.
  refreshBoards();
}

/**
 * Go to a page, THROUGH THE URL.
 *
 * `location.hash` IS THE NAVIGATION, and that is the point of the router: the browser's own back button, a reload, a
 * bookmark and this app's back button then all reach the same page by the same route, and there is no second state to
 * keep in step. The one case that does not fire `hashchange` is a press for the page already showing, so that case
 * applies the route directly — a second press on "How to play" must not do nothing.
 */
function navigate(route: Route): void {
  const hash = hashFor(route);
  if (location.hash === hash) {
    applyPage(route, true);
    return;
  }
  location.hash = hash;
}

/** A URL that named nothing is REPLACED rather than pushed, so the bogus one does not sit in the back history. */
function replacePage(route: Route, said?: { text: string; kind: 'ok' | 'bad' | 'info' }): void {
  if (said) pendingNotice = said;
  const hash = hashFor(route);
  if (location.hash === hash) {
    applyPage(route, true);
    return;
  }
  location.replace(`#${hash.slice(1)}`);
}

/**
 * Keep the address bar on the drill that is actually on screen.
 *
 * `history.replaceState` AND NOT `location.hash`, because a hash write IS a navigation (`hashchange` → `applyPage` →
 * `openDrillPage`) and this must not re-enter the router: the drill is already issued and showing, and re-applying the page
 * would issue it a second time. A REPLACE rather than a push, because a drill is not a place to go back to — "back" from a
 * drill is the block, which is the banner's job.
 *
 * WHY IT IS NEEDED AT ALL: "Next drill" advances the position without changing the page, so without this the URL kept
 * naming the drill the player had just finished — and a reload, a bookmark or a shared link then replayed the wrong one.
 */
function syncDrillUrl(): void {
  if (page !== 'drill') return;
  const route: Route = { page: 'drill', drillIndex: position };
  const hash = hashFor(route);
  if (location.hash === hash) return;
  history.replaceState(null, '', hash);
}

/**
 * Land on the page the URL names.
 *
 * A RELOAD LANDS WHERE THE PLAYER WAS, which is the whole reason the location is in the URL: `#/daily` opened from a
 * bookmark is the same page as `#/daily` reached by a press, and a bare URL is the menu. NO FOCUS IS MOVED HERE: the
 * player has not pressed anything, and stealing focus on load makes a screen reader announce a page title that the reader
 * is already announcing.
 */
function bootPage(): void {
  applyPage(pageFor(location.hash), false);
  // THE BOOT OVERLAY IS THE BOOT'S, AND ONLY THE PAGES THAT ISSUE MAY KEEP IT. It is shown by `bootAccount` while the
  // identity is discovered, and the page's own issue hides it when the issue lands. A page that plays nothing — the menu,
  // help, the account, the board — issues nothing, so nothing would ever hide it: MEASURED in a browser as the menu sitting
  // behind an opaque "Asking the server how it identifies players…" overlay. It is hidden after the page is applied rather
  // than before, because the issue inside `applyPage` owns the overlay while it runs.
  //
  // THE DAILY IS NOT ONE OF THEM, and that is the reported stall: REPORTED "If the app reloads when you are viewing
  // '#/daily' uri the app stalls displaying 'Asking the server how it identifies players...'. I doesnt refresh. I have to
  // remove the URI to make the app respond again." The Daily's path never touches the overlay on purpose (a Daily takes
  // seconds, and covering the app for that is the freeze `startServerDaily` refuses to cause) — so on a reload the overlay
  // was left up for ever, hiding the panel's own pending line and every refusal behind it. `pageOwnsBootOverlay` is the
  // table that says which pages issue, so this cannot drift from the pages themselves.
  if (!pageOwnsBootOverlay(page)) els.loading.hidden = true;
}
/** One sentence in the shared notice, or none. The kind is what colour it takes, as everywhere else in the shell. */
function notice(text: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
  els.notice.hidden = text === '';
  els.notice.textContent = text;
  if (text === '') els.notice.removeAttribute('data-kind');
  else els.notice.dataset['kind'] = kind;
}

/** A sentence for the page a redirect is ABOUT to show — see `applyPage`. */
let pendingNotice: { text: string; kind: 'ok' | 'bad' | 'info' } | null = null;

/**
 * Withdraw every control that belongs to a particular page or run.
 *
 * THE FOOTER IS SHARED AND ITS CONTROLS ARE NOT: `#balance` and `#ledger` are true on every page, and everything else is
 * about a run or a question. One function that puts them all away is what makes "nothing is left over from the last page"
 * a property rather than a list of habits — the Daily's Undo came to sit under the board without it.
 *
 * UNDO AND REDO ARE NOT IN THE FOOTER ANY MORE (REPORTED: "Move the undo/Redo buttons to the top of the HUD, make them much
 * smaller"), but they are still a RUN's controls, so they are still withdrawn here: `paintDaily` is what shows them again, and
 * a page change must not leave them standing over another run's panel.
 */
function hideFooterControls(): void {
  els.undo.hidden = true;
  els.redo.hidden = true;
  els.next.hidden = true;
  nextOffersSignIn = false;
  // THE PRACTICE OFFER IS ABOUT THE DRILL ON SCREEN, so a page change withdraws it: what the server refused was that
  // drill, and an offer left standing would invite a practice run for a failure the player has moved past.
  els.practice.hidden = true;
  els.replayMine.hidden = true;
  els.replayShortest.hidden = true;
}

/** Exactly one page section is on screen. The panel visibility is the SHELL's, not a screen's, so a screen cannot hide one. */
function paintPages(): void {
  els.landing.hidden = page !== 'landing';
  els.setupPage.hidden = page !== 'setup';
  els.helpPage.hidden = page !== 'help';
  els.profilePage.hidden = page !== 'profile';
  els.levelsPanel.hidden = page !== 'levels';
  els.drillPanel.hidden = page !== 'drill';
  els.dailyPanel.hidden = page !== 'daily';
  els.boardPanel.hidden = page !== 'board';
  // AND THE BOARD IS SHOWN ONLY WHERE IT IS PART OF THE GAME. REPORTED: "hide the dancing board when displaying a page,
  // only expose it when they are part of the game e.g. Daily Target and Drill play pages." The decision is
  // `pageShowsBoard`'s (a table, so a page cannot be added without one), and the FLAG IS ON THE DOCUMENT because the
  // whole layout answers to it: the stylesheet gives the panel the window, and the stage stops being drawn.
  document.documentElement.dataset['stage'] = pageShowsBoard(page) ? 'board' : 'page';
  // THE STAGE IS HIDDEN RATHER THAN EMPTIED, so the canvas keeps its size and the camera does not have to re-frame when a
  // game page comes back; the frame loop skips it while it is away (`renderFrame`).
  els.stageCanvas.hidden = !pageShowsBoard(page);
}

/**
 * The banner and the document title, all a function of the page alone.
 *
 * THE TITLE IS THE PAGE'S: a two-page-deep app whose tab always says "Dancing Squared" is an app whose browser history is
 * unreadable, and the installed window has no other title.
 *
 * THE WAY BACK IS ONE SQUARE ICON IN THE FIRST CELL, and REPORTED twice to get there: first "The Back button feels
 * inappropriate for the top banner. A secondary banner could have a breadcrumb (minimalist) and the back button" — a
 * second row holding a "‹ Back" label and the crumbs, built — and then "Change the back button to just an square back
 * arrow and move it up to the top left of the header. Delete the breadcrumb. This makes more screen real estate." The
 * second row is gone; the glyph is `aria-hidden` in `index.html` and the DESTINATION is the button's accessible name and
 * its hover title, so the icon carries no meaning by itself (WCAG 1.1.1, and the label-in-name rule is satisfied because
 * "Back" is the first word of "Back to the menu").
 *
 * The back button is still A PLACE — the page's parent, from `backTarget`, never the last history step.
 */
function paintChrome(): void {
  document.title = page === 'landing' ? pageTitle('landing') : `${pageTitle(page)} · Dancing Squared`;
  const target = backTarget(page);
  els.bannerBack.hidden = target === null;
  // THE BADGE SAYS WHERE IT GOES, and on its own page it says so is where you are: a button that navigates to the page it
  // is on is a control that does nothing, so `aria-current` is what tells a screen reader which case it is.
  if (page === 'profile') els.bannerAccount.setAttribute('aria-current', 'page');
  else els.bannerAccount.removeAttribute('aria-current');
  if (target === null) {
    els.bannerBack.removeAttribute('aria-label');
    els.bannerBack.removeAttribute('title');
    return;
  }
  const label = backLabel(page);
  els.bannerBack.setAttribute('aria-label', label);
  els.bannerBack.title = label;
}

/**
 * The Drill page, which a URL may name a POSITION of.
 *
 * THREE ANSWERS, and each one is a rule:
 *   * `#/drill` with no position means "the drill I am on". A drill in flight is simply shown — nothing is asked for; with
 *     nothing in flight it is the block, and the sentence says so.
 *   * a position this season has not got is refused ONLY WHERE THE LENGTH IS THE DEVICE'S OWN FACT, which is the offline
 *     schedule. With a server the length is the PUBLISHED one and is not known until the answer arrives, so an out-of-range
 *     position is left to the server's own refusal (`POST /drill/replay` answers `no_entry`) rather than to a guess from a
 *     fixture that happens to be a tenth as long — the guess would refuse a drill that exists.
 *   * a position IS OPENED BY `levelPlay`, the same function a pressed cell runs, so a deep link and a press cannot disagree
 *     about what a closed cell means: the issued drill, a replay of a passed one, or a reattempt of a closed one.
 *
 * AND NOTHING HERE ADVANCES THE SEASON: `levelPlay` opens what the URL named, or refuses; the one issue it can cause is
 * `current`, which is a read of the position the player is already on.
 */
function openDrillPage(index: number | null): void {
  if (index === null) {
    if (controller && !controller.atEnd) {
      paintView();
      return;
    }
    replacePage({ page: 'levels', drillIndex: null }, {
      text: 'There is no drill in flight on this device, so the block is where you are.',
      kind: 'info',
    });
    return;
  }
  // THE DEVICE'S OWN SEASON IS THE ONLY LENGTH KNOWN BEFORE ASKING. `apiConfigured()` is the same switch every other
  // offline decision reads, so this is not a second opinion about where the drills come from.
  if (!apiConfigured()) {
    const view = levelView();
    if (index < 0 || index >= view.length) {
      replacePage({ page: 'levels', drillIndex: null }, {
        text: `This level has ${view.length} drill${view.length === 1 ? '' : 's'}, so drill ${index + 1} is not one of them.`,
        kind: 'bad',
      });
      return;
    }
  }
  // THE POSITION IS READ, NOT ASSUMED: with no drill in flight the one the player is on is issued, which is what makes a
  // deep link to the CURRENT position open it instead of an empty panel. That is `current` — a read of where the player
  // already is, never an advance.
  if (!controller) issueCurrentDrill('current');
  // WHAT A CLOSED CELL MEANS IS `levelPlay`'S RULE and not a second copy of it here. Its refusals land in the drill panel's
  // verdict slot, which on this page is ON SCREEN — which is why a refused deep link no longer has to guess where to put a
  // word.
  levelPlay(index);
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
  // A REAL DRILL REPLACES WHATEVER WAS BEING WATCHED: this function is every path that puts a different drill on screen,
  // so the watching state and the listed calls — the previous position's — go with it.
  watchingDrill = null;
  shownCalls = null;
  playingLine = null;
  replayList.hide();
  waypointCursor = null;
  waypointHold = null;
  stage.forgetPair();
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
  // THE CLOCK'S ORIGIN IS THIS DEVICE'S READING, AND THE RULE IS `clock.ts`'S (`drillClockOrigin`), because the version
  // here that used the SERVER's stamp refused a run from a second device: REPORTED "The server would not record this
  // run: the run claims 50.4s and the drill was issued 13.3 seconds ago" — the two clocks subtracted from each other,
  // so 37 s of clock offset was claimed as play. A saved origin is carried only while its `issuedAtMs` still names THIS
  // issuance, which is what keeps the older 421 s refusal fixed in the other direction (a re-issued position starts
  // its clock again). The step and attempts below are restored from the save either way: they are progress, not a clock.
  const originMs = drillClockOrigin(issued.issuedAtMs ?? 0, carrying, Date.now());
  drillStartedAtMs = originMs;
  drillRunId = carrying ? carrying.runId : newRunId(Date.now());
  drillClock = new Stopwatch();
  // THE ELAPSED IS WALL TIME because the origin is: the run began when the entry was SHOWN, so the minute the page
  // spent closed is a minute of the run (and a reload is therefore not a pause).
  drillClock.resume(performance.now(), Math.max(0, Date.now() - originMs));
  PLAYHEAD.cancel();
  replay = null;
  drillScreen.clearVerdict();
  drillScreen.render(controller);
  // THE DRILL'S FOOTER CONTROLS ARE `paintView`'S NOW: they belong to the drill view, and whether that view is showing is
  // the shell's state rather than this function's.
  els.next.hidden = true;
  nextOffersSignIn = false;
  paintWaypoints();
  paintBalance();
  persist();
  draw();
  // THE VIEW AND THE BLOCK ARE BOTH REPAINTED WITH EVERY DRILL: issuing is what moves the regime (the answer carries
  // the two sets and the issued index), and it is also when the footer's drill controls become meaningful — which is
  // `paintView`'s decision, taken here rather than left to whichever call ran last.
  paintView();
  renderLevel();
  syncDrillUrl();
}

/**
 * Paint what the current PAGE implies for the footer and for a watched drill.
 *
 * THE PAGE IS THE ONLY INPUT. `paintPages` has already put exactly one section on screen, so "is the drill showing" is
 * `page === 'drill'` — a fact in the URL rather than a second piece of shell state that a screen's repaint could leave
 * disagreeing with it. That is the defect this replaces: `applyMode` and `paintView` each claimed the panel, and whichever
 * ran last won.
 */
function paintView(): void {
  const drillShowing = page === 'drill';
  // A WATCHED DRILL HAS NO QUESTION, so the panel says what it is instead of drawing one: the screen removes the options
  // (a disabled button under a replay still reads as the question) and the answering handlers are inert.
  if (watchingDrill && drillShowing) {
    const watched = watchingDrill;
    drillScreen.renderWatching(
      watched.passed
        ? `Drill ${watched.index + 1} — solved. Watching it back; this does not count.`
        : `Drill ${watched.index + 1} — closed without a pass. Watching the calls that solve it.`,
    );
  }
  // THE FOOTER'S DRILL CONTROLS BELONG TO THE DRILL PAGE, and this is the one place that decides it: on the block there is
  // no question, and a control that looks live and does nothing is worse than one that is absent (`drill-screen.ts` records
  // the same rule for a failed issue). They are re-derived here rather than left as whichever screen painted last.
  //
  // ONE `Play` BUTTON, BOTH MODES: it plays whatever `panelLine()` says the panel is showing. A solved or watched drill
  // therefore gets the same button the solved Daily has — REPORTED as "I inadvertantly dropped the play button from the
  // Drill. Can it reuse the call list and Play button used in the solved Todays Daily?" — and "The shortest line" stays
  // the Daily's own second source, so it is hidden on the block and in the drill view.
  if (!drillShowing) return;
  const line = panelLine();
  els.replayMine.hidden = line === null;
  els.replayShortest.hidden = true;
  if (line) {
    const key = `drill:${line.calls.join('>')}`;
    if (shownCalls !== key) {
      shownCalls = key;
      replayList.show(line.calls, line.heading);
    }
  } else {
    shownCalls = null;
    replayList.hide();
  }
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
  /** How far through the published block, as a whole percentage — `blockPercent`, the header's own number. */
  percent: number | null;
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
      percent: blockPercent(summary),
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
  return {
    levelIndex: 1,
    length,
    finished,
    passed,
    next,
    complete: length > 0 && summary.done >= summary.published,
    percent: blockPercent(summary),
  };
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
    // TWO KINDS OF CLOSED CELL, TWO QUESTIONS. A PASSED position is WATCHED — its calls read back as a list — and a
    // finished-but-unpassed one is REATTEMPTED, which reopens it so the pass can be earned. REPORTED as "Allow completed
    // levels to be replayed, not re-solved": before this, a passed cell went to the reattempt and the server answered
    // `already_passed`, so a completed level could not be opened at all.
    if (levelView().passed.includes(index)) {
      void openDrillReplay(index);
      return;
    }
    // THE VIEW IS SWITCHED BY WHICHEVER PATH SHOWS A DRILL, not here: a refused reattempt must leave the player on the
    // block with the server's sentence, and switching first would leave them looking at the panel of the previous drill.
    if (apiConfigured()) void startReplayDrill(index);
    else startDrill(index);
    return;
  }
  if (!controller) return;
  paintView();
}

/** The calls a drill's solve consisted of: one option per step, the correct one. */
function correctCalls(puzzle: Puzzle): string[] {
  return puzzle.steps.map((step) => step.moves[step.correctIndex].call);
}

/**
 * Open a COMPLETED position to watch, from the block.
 *
 * THE SERVER'S READ WHEN THERE IS A SERVER (`fetchDrillReplay`), because the order and the boards are the server's, and
 * the device's own baked fixture otherwise — which is the same puzzle the local ledger's pass was earned on. Nothing is
 * written either way: a rewatch is not an attempt, and the row that says "position N was passed" is what makes it
 * watchable.
 */
async function openDrillReplay(index: number): Promise<void> {
  const passed = levelView().passed.includes(index);
  if (!apiConfigured()) {
    const entry = scheduleEntryFor(index);
    const puzzle = seasonPuzzleFor(index);
    showDrillReplay({ index, levelIndex: entry.levelIndex, puzzle, passed });
    return;
  }
  els.loading.hidden = false;
  els.loading.textContent = `Fetching drill ${index + 1} to watch back…`;
  const answer = await fetchDrillReplay(index);
  els.loading.hidden = true;
  if (!answer.ok) {
    drillScreen.say(`That drill cannot be watched back: ${answer.failure.message}`, 'bad');
    return;
  }
  showDrillReplay({ index, levelIndex: answer.value.levelIndex, puzzle: answer.value.puzzle, passed: answer.value.passed });
}

/**
 * Show a completed position in the drill panel, with its calls listed.
 *
 * NO RUN IS STARTED: `showDrill` opens a clock and a run id, and a replay is neither — it must not be scored, timed or
 * submitted. The CONTROLLER is built anyway, because the waypoint pair, the route and the captions come from it (`drill`
 * owns them); what makes it inert is the screen's watching state and the guards on every answering handler.
 */
function showDrillReplay(info: { index: number; levelIndex: number; puzzle: Puzzle; passed: boolean }): void {
  const spec = levelSpec(info.levelIndex);
  if (!spec) return;
  watchingDrill = { index: info.index, levelIndex: info.levelIndex, passed: info.passed };
  position = info.index;
  practiceRun = false;
  serverRecordedRun = false;
  useLevel(spec);
  controller = new DrillController(info.puzzle, {});
  drillScreen.clearVerdict();
  drillScreen.say(
    info.passed
      ? `Drill ${info.index + 1} again — the calls that solved it. Watching back, not counting.`
      : `Drill ${info.index + 1} was closed without a pass. These are the calls that solve it.`,
    'info',
  );
  paintView();
  paintWaypoints();
  // THE LIST AND THE ONE `Play` BUTTON ARE `paintView`'S, because that function is what decides which footer controls the
  // drill view offers — so the calls appear the same way a solved drill's do, and `Play` plays them through the same
  // motion. It is called above, and this function only has to hand the panel its puzzle.
  syncDrillUrl();
  draw();
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
  // THE SAME ADOPTION AS `startServerDrill`: a reattempt is served by the same response, so the header's score is the
  // account's whether this read issued the order's next drill or reopened an old one. A reattempt is never a demo.
  serverDrillBoard = adoptedBoard(serverDrillBoard, answer.value.board, false);
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
  paintBanner();
}

/**
 * The block is full and the player took the way on. RE-ISSUING IS THE PROMOTION: the server's ladder reads the full
 * block and answers with the next level's first drill — so this asks, and does not move the player itself.
 */
function levelNextLevel(): void {
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
  // THE ACCOUNT'S RANKED BOARD IS THE HEADER'S SCORE from here on (`bannerFacts`). A DEMO FORGETS IT — a signed-out
  // caller's board is not this player's, and a demo is unscored by design — while a server that sends no board at all
  // leaves the known one alone: "no news" is not "no score".
  serverDrillBoard = adoptedBoard(serverDrillBoard, answer.value.board, answer.value.demo);
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
  // THE BANNER'S TOTAL CHANGED WITH THIS ANSWER, and `showDrill` repaints only the balance — so the header is repainted
  // here rather than left to whichever caller happens to run next.
  paintBanner();
  // AND A PAGE WITH THE FULL-SCREEN STANDINGS READS THE DRILL CARD'S SET FROM THIS ISSUE: without this the Drill card
  // would keep saying it has no published set until the next navigation, because it was read before the issue landed.
  // On a play page `refreshBoards` does nothing, so this costs the drill page no request.
  refreshBoards();
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
  // A WATCHED DRILL ANSWERS NOTHING: there is no run behind it — no clock, no run id, nothing to submit — so a press must
  // not be recorded or scored. The screen has removed the options as well; this is the guard behind that.
  if (!controller || !applier || PLAYHEAD.isRunning || watchingDrill) return;
  waypointCursor = null;
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
    // THE HOLD IS `ui/playhead.ts`'S RULE (`drillAnswerHoldMs`), and a WRONG answer holds too: the board the wrong call
    // leaves is the thing the player has to look at, which is the report that added it. The one answer that does NOT hold is
    // a correct one before the last step — the next question is asked from that landing, so holding would put its options on
    // screen beside a board that is still frozen.
    startReplay(applier.motion([result.call], result.replayFrom as Board), 'advance', drillAnswerHoldMs('correct', controller?.atEnd === true));
  } else {
    // A WRONG ANSWER STATES WHERE IT WENT, not just that it was wrong. The ending board is on screen by the
    // time this is read, so the sentence and the picture say the same thing.
    //
    // THE SENTENCE DEPENDS ON WHICH STEP IS ASKED, and the old one was FALSE at every step but the last: a two-step
    // drill's first answer never leaves the set on the goal board — not even when it is RIGHT — so telling a player it
    // "does not leave the set on the goal board" describes a rule the question is not using. REPORTED as "it is also
    // expecting a specific move", which is what that sentence reads like. `finalStep` is the machine's own answer to
    // which question is being asked, and it is the same field the screen's prompt switches on.
    drillScreen.say(
      controller.view().finalStep
        ? `${result.call} is legal, but it does not leave the set on the goal board.`
        : `${result.call} is legal, but the set is no closer to the goal — one more call from there does not reach it.`,
      'bad',
    );
    startReplay(applier.motion([result.call], result.replayFrom as Board), 'settle', drillAnswerHoldMs('wrong', controller?.atEnd === true));
  }
  persist();
}

// THE "SHOW ME THE ANSWER" CONTROL IS GONE. REPORTED: "remove the option to see the answer to a drill, there are only three
// answers, players will get there eventually." It was the one control that made a run countable-but-worthless (Q16/A28: a
// revealed run is recorded and never ranked), and with three options a guess is a cheaper route to the same knowledge.
//
// WHAT STAYS, DELIBERATELY: `DrillController.review()` and the `revealed` set it records (`game/drill.ts`), the reveal
// endpoint (`POST /drill/reveal`), and the submission's `revealed` list — because the RULE they enforce is what stops an
// answer from being laundered into a hint, and `api/test/runs-probe.mjs` proves the server still refuses a revealed run.
// Only the button is withdrawn; the protocol is the server's and is unchanged.

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

/** The step is over: redraw, and score the run if the last step has just been answered. */
function settleDrill(): void {
  if (!controller) return;
  drillScreen.render(controller);
  paintWaypoints();
}

/**
 * The one control a solved drill ends on, and what it will do.
 *
 * TWO JOBS, ONE BUTTON, because both answers to "what next" belong in the same place: a ranked run advances the season, and a
 * DEMO run — a signed-out player on a token-mode server — cannot, because every write for that caller is a `401` (A20). The
 * demo case used to hide the button entirely, which is what "I was missing the next drill button" was: the rule was stated in
 * the verdict's sentence and nowhere the player could act on it. The label says which of the two this press is.
 */
function offerNext(demo: boolean): void {
  nextOffersSignIn = demo;
  els.next.hidden = false;
  els.next.textContent = demo ? 'Sign in for the next drill' : 'Next drill';
}

/**
 * The last answer was correct: stop the clock, and score the run IF THE SERVER WILL RECORD IT.
 *
 * A DRILL'S `moves` IS ITS SHORTEST, because the mode is one call per step and prices wrong ANSWERS through
 * `attemptFactor` (DESIGN.md 6) — it has no notion of a wasted move, which is the Daily's `wasteFactor`.
 *
 * THE SCORE IS THE SERVER'S, ALONE. A run is scored only when it can be submitted — the server issued the drill and this
 * caller may write. Everything else is PRACTICE: the fixture season with no API, a drill the server refused, a signed-out
 * demo. It is played, answered and listed, but it is NOT scored, NOT recorded and NOT totalled; the verdict says so. The
 * device has no ledger to fall back to (see the header scores' state).
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
  const time = `Solved in ${score.elapsedSeconds.toFixed(1)} s, ${tries}`;
  // A DEMO IS AS FAR AS A SIGNED-OUT PLAYER GOES (DESIGN.md §15 Q22). The drill on screen came from the SERVER, and
  // the server holds no Progress row for this caller — so there is nothing to advance and the next `/drill/current`
  // would serve the same entry again. The rule is `mayWrite` — the same predicate the submission is guarded by
  // (`net/standing.ts`, pinned in `game/test/standing-probe.mjs`).
  const demoOnly = serverIssued() && !mayWrite(currentStanding());
  const revealed = controller.revealed.length > 0;
  // THE ONE SCORED PATH: an issued drill this caller may submit. A signature rather than a second `if` at the submission.
  const submitted = apiConfigured() && serverIssued() && mayWrite(currentStanding());
  if (demoOnly) {
    drillScreen.say(`${time}. That is as far as a signed-out drill goes — the season is the server's, so sign in to be issued the next one.`, 'info');
  } else if (revealed) {
    drillScreen.say(`${time}, and not ranked: you were shown the answer, so it earns no hint and does not reach the board.`, 'info');
  } else if (!submitted) {
    // PRACTICE, AND SAID WHERE THE SCORE WOULD HAVE BEEN. The fixture drill is the offline mode's only play now that the
    // device's score is gone, and a practice drill earns nothing — no score line, because a score it did not bank is a lie.
    drillScreen.say(`${time}. This is a practice drill — it is not scored.`, 'info');
    // THE PRACTICE BLOCK KEEPS ITS OWN PROGRESS — a practice FACT, never a score — so the fixture's cells advance offline.
    // On a configured server the block is drawn from the server's regime, so there is nothing to mark.
    if (!apiConfigured()) save.markFinished(position, { revealed });
  } else {
    drillScreen.showScore(scoreLine(score, controller.puzzleRef.level));
  }
  // THE DRILL IS OVER, so "Next drill" is the way on from here, and Q21 is why it no longer sends an advance the server
  // has already done. A solved drill always offers a way on, labelled for what it will actually do.
  offerNext(demoOnly);
  // ONLY A SUBMITTABLE RUN IS SENT. A demo is a `401` the server counts (A20, A25); a practice drill is not the season's.
  // A revealed run IS submitted, because the server is what decides its standing, and it answers with the board unchanged.
  if (submitted) void submitSolvedRun(score, clockSeconds);
  drillScreen.render(controller);
  paintWaypoints();
  paintBalance();
  persist();
  // AND THE CALLS APPEAR NOW, as a list, exactly as they do on a solved Daily. A drill has one line — the correct
  // option at each step — so the source buttons stay hidden.
  paintView();
}

/**
 * Hand the solved run to the server and ADOPT what it decides.
 *
 * WHAT IS CLAIMED AND WHAT IS DECIDED: the calls played are the transcript, and the server re-derives which option
 * was correct at each step and clamps the score to what it can recompute (§6, §11). The balance it answers with
 * replaces the local one, and the score it answers with is the number the board will hold — so the LINE shows the
 * server's number rather than this app's preview, and a success adds no words to it.
 */
async function submitSolvedRun(score: RunScore, clockSeconds: number): Promise<void> {
  if (!controller || !serverDrill) return;
  // THE PRESSES AND THE REVEALS FIRST. The run is scored on the tries the server recorded and RANKED on whether it
  // saw the reveal, so this waits for the last of each rather than racing them — the ordering this endpoint's
  // contract requires (DESIGN.md 11.1, A22 and A28). The claim below is what covers a POST that never arrived.
  await pressLog;
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
    // ONE CALL PER STEP, in the order they were answered — the run's transcript, which is what the server replays.
    calls: [...drillOptions],
    score: score.score,
  });

  if (!answer.ok) {
    // NO SCORE WITHOUT A RECORD. REPORTED: "If there is a failure updating the server, dont show the score, just show
    // the error." The score line on screen is this app's preview, and with no recorded run behind it that number is a
    // result the player does not have — so it is REPLACED by the refusal (`say` writes the verdict slot's whole text,
    // where the old `amend` kept the line and appended a footnote). There is no local ledger to fall back to either.
    drillScreen.say(`The server would not record this run: ${answer.failure.message}`, 'bad');
    paintBalance();
    persist();
    return;
  }
  serverHints = { hints: answer.value.hints.hints, successes: answer.value.hints.successes };
  // THE SERVER'S BOARD IS THE HEADER'S SCORE, so the header is repainted with it below.
  serverDrillBoard = adoptedBoard(serverDrillBoard, answer.value.board, false);
  // THE SERVER HOLDS THIS RUN, WHICH IS WHAT "Next drill" MAY RELY ON (DESIGN.md §15 Q21): the accepted submission
  // finished the drill on the server's own Progress row, so what the app needs next is the next drill, which is a
  // read. A DUPLICATE COUNTS — the row is the server's either way — and a refused or unreachable submission does not,
  // which is why this is set on the one path where the server said yes, and nowhere else.
  serverRecordedRun = true;
  // THE SCORE LINE, AND NOTHING ELSE. REPORTED: "When the score is displayed for a successful drill, there is no need
  // for the text informing that the server was updated successfully." So a successful submission does not add a
  // sentence — it replaces the preview with the number the server itself recomputed (and possibly clamped), which is
  // the line the board will hold. AN UNRANKED RUN GETS NO LINE AT ALL: a revealed run is submitted and answers
  // `ranked: false`, and its verdict already says it does not reach the board, so a score here would contradict it.
  if (answer.value.run.ranked) {
    drillScreen.showScore(scoreLine(answer.value.run, controller.puzzleRef.level));
  }
  paintBalance();
  // THE HEADER SHOWS THE BOARD THAT ANSWER CARRIED.
  paintBanner();
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
/** An issued Daily is kept: re-issue it and its clock restarts, which is free thinking time for a button press. */
function keepDaily(): void {
  // EVERYTHING ELSE ON SCREEN IS RE-APPLIED, because it belongs to this mode — a defect the browser showed twice:
  // a stale "You are here" name left over from the Drill, and a header still reading "The Drill — drill 1 of 12"
  // above the Daily's own panel.
  if (!daily) return;
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
function showDaily(puzzle: Puzzle, day: string): void {
  if (!applier || !level) return;
  // THE DRILL'S DEMO FLAG DOES NOT CARRY OVER. `demo` is the server's word about an ISSUED DRILL
  // (`GET /drill/current`), and the Daily's answer carries no such flag — so leaving the last drill's value set
  // would mark a typed-in player's Daily unranked because of a board they left behind. The Daily's standing comes
  // from the mode and the session alone, which is the same rule that decides it before any drill has been issued.
  demoRun = false;
  els.loading.hidden = true;

  dailyDay = day;
  dailyLevelIndex = level.index;
  // A SAVED ATTEMPT FOR TODAY IS PICKED UP. The puzzle is the same one the record was written against — the
  // server's for a published challenge, the derived one offline — and what the record adds is the line, the hints
  // and the clock, with the wall time the page was away charged to it. A record that no longer describes this
  // puzzle (a pool or corpus change) comes back null and is simply not carried.
  const stored = save.daily;
  const carried = stored && stored.day === day && stored.levelIndex === level.index
    ? DailyRun.resume(puzzle, applier, performance.now(), stored, { gapMs: wallGapMs(stored.savedAtMs, Date.now()) })
    : null;
  waypointCursor = null;
  waypointHold = null;
  stage.forgetPair();
  // A DIFFERENT CHALLENGE IS A DIFFERENT LIST, so the player's search and subset belong to the last one: a query typed
  // for yesterday's puzzle would open today's already narrowed, which reads as a puzzle with almost no calls. Said here
  // rather than inferred in the screen, because only the shell knows the challenge changed (`keepDaily` — a mode switch
  // — must NOT reset, and does not call this).
  dailyScreen.resetFilters();
  daily = carried ?? new DailyRun(puzzle, applier, performance.now());
  // A DIFFERENT CHALLENGE IS A DIFFERENT LINE, so the listed calls and the playhead that was showing them both go:
  // paintDaily rebuilds them from the new run, and paintDaily is called below.
  shownCalls = null;
  playingLine = null;
  replayList.hide();
  PLAYHEAD.cancel();
  dailyRunId = carried && stored ? stored.runId : newRunId(Date.now());
  dailyScreen.say(
    carried
      ? 'Picked up where you left off — the time the page was away is on the clock.'
      // THE SECOND CLAUSE WAS "the allowance is not", and the allowance is gone: REPORTED: "Remove the move limit, a player
      // should be able to use as many moves as they want, but it will be detramental to their final score." So the sentence
      // says what is true — undo is free, and the calls a player uses are priced by `wasteFactor` — rather than naming a cap
      // the run no longer has.
      : 'Pass each waypoint in order, ending on the goal board. Undo is free; extra calls cost part of your score.',
    'info',
  );
  // THE SHARED CHROME IS PAINTED ONLY WHERE THE DAILY IS THE PAGE ON SCREEN. The header, the board captions, the board
  // itself and the footer buttons all belong to whichever page is showing, and this answer can land while the player
  // has gone back to the menu — which is now the ORDINARY case, because the fetch does not hold the app. Without this
  // guard a challenge that finished creating in the background would replace another page's header and footer with the
  // Daily's, under a board the player is in the middle of reading. The state above is set either way; `keepDaily()`
  // paints all of it on the next switch into the page.
  if (page === 'daily') {
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
  waypointCursor = null;
  waypointHold = null;
  daily = null;
  els.loading.hidden = true;
  dailyScreen.say("The Daily Challenge needs the game server: a challenge is published for a level and a day, and this build has no API configured.", 'info');
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
 * Show that today's challenge is being CREATED.
 *
 * THE PAGE IS THE INDICATOR NOW, and that is what pages changed: it used to be the mode TAB's spinner, because a tab was
 * on screen whatever else was; the Daily is a page, so its button takes the player to it and the sentence that says
 * "creating today's challenge" is on the page they are looking at. `aria-busy` is still set on the section, so a screen
 * reader is TOLD as well as shown — the rule that state must never be carried by motion alone still holds.
 */
function setDailyBusy(busy: boolean): void {
  els.dailyPanel.toggleAttribute('aria-busy', busy);
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
  // THE SENTENCE GOES ON THE DAILY'S PAGE, which is where the press has taken the player. A poll can only start from that
  // page (`issueDaily` is called by `applyPage`), so this is never written about a page nobody is looking at — and the
  // guard stays because the alternative is a background answer painting another page's prompt.
  if (page === 'daily') dailyScreen.pending("Creating today's challenge — this takes a few seconds the first time.");
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
    // EVERY TERMINAL STATE LIFTS THE BOOT OVERLAY, whatever raised it. On a reload at `#/daily` the boot's own overlay is
    // up (`bootPage` no longer leaves it there, but a page switched to while a drill was issuing can still have it), and a
    // refusal or a give-up hides nothing else — which is the reported freeze: "the app stalls displaying 'Asking the server
    // how it identifies players...'". Belt and braces for the one element whose failure mode is an opaque full-screen panel.
    els.loading.hidden = true;
  };
  if (!answer.ok) {
    finish();
    daily = null;
    // THE DAY AND THE LEVEL ARE NAMED, because the commonest cause of this refusal on a second device is a day the server
    // has not published — and a sentence that names what was asked for is what turns the next report into a measurement.
    dailyScreen.say(`No Daily from the server (asked for ${day}, level ${levelIndex}): ${answer.failure.message}`, 'bad');
    if (page === 'daily') {
      dailyScreen.pending(`Today's Daily is unavailable (asked for ${day}): ${answer.failure.message}`);
    }
    return;
  }
  if (!answer.value.playable) {
    // A CHALLENGE FROM ANOTHER POOL IS NOT A CHALLENGE THIS BUILD CAN PLAY (§7.2), and saying so is better than
    // generating a board the server would refuse to score.
    finish();
    daily = null;
    dailyScreen.say(`Today's Daily was published against pool ${answer.value.poolVersion}, and this build serves ${MAIN_POOL.version}.`, 'bad');
    if (page === 'daily') {
      dailyScreen.pending(`Today's Daily is unavailable — it was published against pool ${answer.value.poolVersion}.`);
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
    if (page === 'daily') {
      dailyScreen.pending(`Today's Daily is not ready — ${why}.`);
    }
    return;
  }
  // READY: the boards first, then the panel — the applier's cache is seeded before the first view so the picker draws
  // without paying `applicableMoves` for the board the server had already computed.
  finish();
  if (answer.value.readings) applier?.seedReadings(answer.value.puzzle.start, answer.value.readings);
  showDaily(answer.value.puzzle, day);
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
    // THERE IS NO LOCAL RECORD TO STAND ON: the Daily is the server's challenge and its score is the server's, so a
    // refused or unreachable submission is a run that was not recorded. The sentence says so rather than implying a
    // device copy that no longer exists.
    dailyScreen.say(`The server would not record this Daily: ${answer.failure.message}`, 'bad');
    return;
  }
  serverHints = { hints: answer.value.hints.hints, successes: answer.value.hints.successes };
  // THE DAILY BOARD IS THE HEADER'S DAILY SCORE, so the header and the sentence below it are one number.
  serverDailyBoard = adoptedBoard(serverDailyBoard, answer.value.board, false);
  dailyScreen.say(
    `Recorded — the server scores it ${answer.value.run.score} points. Best on this board: ${answer.value.board.score}.`,
    'ok',
  );
  paintBalance();
  paintBanner();
  persist();
}

/**
 * Issue today's challenge from wherever the app is configured to get it.
 *
 * THE LEVEL IS ESTABLISHED FIRST, AND THAT IS THE REPORTED STALL'S OTHER HALF. `level`/`applier` are built by `useLevel`,
 * which only the DRILL's issue calls — so a reload straight onto `#/daily` reached `startServerDaily` with neither, which
 * returns immediately (its guard is `if (!applier || !level) return`): no request, no pending line, nothing. On a page
 * SWITCH the level was already there from the drill, which is why "the same url resolves on the PC" (REPORTED: "If the app
 * reloads when you are viewing '#/daily' uri the app stalls displaying 'Asking the server how it identifies players...'").
 * The level a device that has issued nothing yet knows is the one its own record last believed (`save.levelIndex`, the same
 * value the level block falls back to), and the server's answer carries the level it actually served.
 */
function issueDaily(): void {
  if (!level) {
    const known = levelSpec(save.levelIndex);
    if (known) useLevel(known);
  }
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
  // THE WINDOW AS IT STANDS, BEFORE the cursor is cleared and the call is played: a success holds the pair HERE, so the
  // boards the player is watching do not move out from under the animation. It is the LIVE front (the hold in force, or
  // the player's own position when there is none), not a paged preview — resuming from where a preview was left is what
  // the cursor reset above is for.
  const before = waypointInfo();
  const shownFront = before ? waypointPair(before.boards.length, before.progress, null, waypointHold).leftIndex : null;
  waypointCursor = null;
  const from = daily.board;
  // THE COUNT BEFORE THE MOVE, so "did this pass a waypoint" is a DELTA rather than a state: a board that is already
  // two waypoints in could otherwise be announced as a third. `view()` is the paint's own call and the applier caches
  // readings by board pose, so this is not a second computation of the offering list.
  const passedBefore = daily.view(performance.now()).progress;
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
  // ONE READ AFTER THE MOVE, because two things need the same answer: whether the waypoint count ROSE, and — in the
  // branch below — which sentence to say.
  const view = daily.view(performance.now());
  const advanced = view.progress > passedBefore;
  if (result.verdict === 'wrong') {
    // THREE SENTENCES, because a legal non-winning move can be three things and the player needs to know which: it
    // PASSED a waypoint (the only one that is good news), it landed on the goal's own setup without the ones before it,
    // or it did neither. The middle case is the rule the whole sequence exists for; the first is the case a
    // two-sentence version got WRONG ON A PAGE — a call that advanced the strip to "waypoint 2 of 5" was announced as
    // "the set is not on the goal board yet", which is true and useless.
    // THE SAME RELATION THE WIN TEST USES (reachedGoal), so the sentence and the verdict cannot disagree about
    // whether the set is on the goal's arrangement - including the tolerance, which the key's equality did not have.
    const onGoal = reachedGoal(result.board, daily.goal);
    dailyScreen.say(
      advanced && !onGoal
        ? `${call} — that is waypoint ${view.progress + 1} of ${view.waypoints.length}.`
        : onGoal
          ? `${call} — that is the goal's setup, but the waypoints are passed in order, so the run is not finished.`
          : `${call} is legal, but the set is not on the goal board yet.`,
      'info',
    );
  } else dailyScreen.say(`${call} — every waypoint passed, and that is the goal board.`, 'ok');
  // A SUCCESS HOLDS THE WINDOW WHERE THE PLAYER WAS WATCHING IT. Only a verdict that PASSED a waypoint would move the
  // strip, and moving the pair for it is exactly the auto-skip that was reported — so the forward zone does that instead, and
  // the stage stays on the two boards the animation is landing between.
  if (advanced && shownFront !== null) waypointHold = shownFront;
  logDailyMove('add', call);
  persist();
  // EVERY DAILY VERDICT HOLDS ITS LANDING, THE SAME TWO SECONDS THE DRILL'S DO. REPORTED: "Drill and Daily: After attempting
  // an incorrect call and the two-second pause, reset the board to the 'Now' setup." The Daily's replay had no hold at all, so
  // the landing blinked past and the pair was repainted in the same frame — which is the half of that report that was real.
  // The hold is what makes the reset read as a reset: the motion lands, the landing is held for `LANDING_HOLD_MS`, and then
  // the pair comes back (which is now the two waypoints — `pairLeftBoard`).
  startReplay(applier.motion([call], from), result.verdict === 'correct' ? 'advance' : 'settle', LANDING_HOLD_MS);
}

function undoDaily(): void {
  if (!daily || PLAYHEAD.isRunning) return;
  if (!daily.undo()) return;
  waypointCursor = null;
  waypointHold = null;
  logDailyMove('undo');
  dailyScreen.say('Undone — and the clock kept running, and any hint is still spent.', 'info');
  paintDaily();
  persist();
  draw();
}

function redoDaily(): void {
  if (!daily || PLAYHEAD.isRunning) return;
  if (!daily.redo()) return;
  waypointCursor = null;
  waypointHold = null;
  logDailyMove('redo');
  dailyScreen.say('Redone.', 'info');
  paintDaily();
  persist();
  draw();
}

/**
 * The hint badge's pending state, and the flag that stops a second press spending a second hint.
 *
 * A HINT SPEND CAN TAKE A MINUTE AND A HALF, and the press has to say so. MEASURED (the dev server's own log): one
 * `POST /me/hints` answered **200 after 88 295 ms** — the first hint in a process builds the hint's distance table,
 * which `HINT_TIMEOUT_MS` in `net/api.ts` carries the measurement for — while the app's shared 8 s handshake window
 * had already given up on it. The spend landed and this app never saw it, so the presses after it were fast
 * `409 no_hints` answers under a footer that still claimed a hint: the report "I earned a hint, but the hint button
 * doesn't seem to do anything".
 *
 * THE PRESS NOW GETS THREE THINGS, each one a way for that report to be impossible: a window that covers the work
 * (`HINT_TIMEOUT_MS`), the same busy affordance the Daily tab carries while a challenge is being created (a spinner,
 * `aria-busy`, and an accessible name that says what is happening — a ring alone is invisible in a still screenshot
 * and to a reduced-motion preference), and this guard, because a second press during the wait would charge a second
 * hint for one intent.
 *
 * IT IS THE BADGE THAT CARRIES ALL THREE NOW (REPORTED: "move the event handler to the hint bank badge in the header"),
 * and the meter goes out of its way while the ring is there: a 24 px badge showing three bars AND a spinner is neither.
 * `style.css`'s `#bannerHints[data-busy="true"]` is what hides one and shows the other.
 */
let hintInFlight = false;

function setHintBusy(busy: boolean): void {
  if (busy) {
    els.bannerHints.dataset['busy'] = 'true';
    els.bannerHints.setAttribute('aria-busy', 'true');
    els.bannerHints.setAttribute('aria-label', 'Hint — waiting for the server to name a call…');
    // AND IT CANNOT BE PRESSED AGAIN, which is what the ring is saying.
    els.bannerHints.disabled = true;
  } else {
    delete els.bannerHints.dataset['busy'];
    els.bannerHints.removeAttribute('aria-busy');
    // THE NAME AND THE ENABLED STATE GO BACK TO THE VIEW'S, not to nothing: a badge left nameless by the wait would be a
    // meter a screen reader cannot read. `paintBanner` is the one function that knows what they should be.
    paintBanner();
  }
}

/** One server spend, with the button marked busy for exactly as long as the answer takes. */
async function spendOnServer(levelIndex: number): Promise<ApiResult<HintSpend>> {
  hintInFlight = true;
  setHintBusy(true);
  try {
    return await spendHint(levelIndex, dailyDay);
  } finally {
    hintInFlight = false;
    setHintBusy(false);
  }
}

/**
 * Say something in the DAILY's status area, and only while the Daily is what is on screen.
 *
 * THE ANSWER CAN OUTLIVE THE SCREEN: a spend that takes a minute and a half can land after the player has gone back
 * to the drills, and writing the Daily's status and boards over the drill's is the failure `showDaily` guards
 * against for the same reason. The bookkeeping still happens; only the paint is conditional.
 */
function sayInDaily(message: string, tone: 'ok' | 'bad' | 'info'): void {
  if (page === 'daily') dailyScreen.say(message, tone);
}

/**
 * Take a hint: the SERVER is asked, and only a granted spend charges the run.
 *
 * THE BALANCE AND THE NAME ARE BOTH THE SERVER'S (DESIGN.md 11.1, A23): `POST /me/hints` debits the balance, records the
 * event, and names the call from the line it RECORDED — which is the board the player is actually on, where this app's
 * own look-up runs from the position it believes it is on. A refusal — no balance, a challenge nobody read, the bound,
 * nothing to name — is shown and NOTHING is spent, because a hint the server did not record would be a run it refuses
 * (`unrecorded_hints`) and a player who lost the run rather than the hint.
 *
 * A DEMO CANNOT TAKE ONE AT ALL, and that is the correction the removed local balance made: REPORTED "When logged out,
 * the hints bank still shows my hints, it should be empty." A demo has no balance to spend (the spend is a server write,
 * A20), so the press is answered with that sentence rather than with a local debit that the server would never see.
 */
async function takeHint(): Promise<void> {
  // THE PREDICATE IS THE BADGE'S OWN (`dailyHintAvailable`), so the control's enabled state and the handler that spends
  // cannot disagree: a press that arrives from a stale paint is a no-op rather than a spend from a page with no run.
  if (!dailyHintAvailable() || !daily) return;
  const balance: HintLedger = serverHints ?? { hints: 0, successes: 0 };
  if (balance.hints <= 0) {
    // TWO DIFFERENT EMPTIES, SAID DIFFERENTLY: no account has no balance to spend, and an account at zero has spent
    // what it earned. A single sentence for both would tell a signed-out player to earn a hint they cannot hold.
    sayInDaily(serverHints === null
      ? 'Hints are the server’s, and this page has none to spend: sign in to use one.'
      : 'You have no hints — one is earned every ten solved drills.', 'bad');
    return;
  }
  const levelIndex = daily.view(performance.now()).level.index;
  const answer = await spendOnServer(levelIndex);
  if (!answer.ok) {
    // A REFUSAL THAT IS ABOUT THE BALANCE IS THE BALANCE (`refusedSpend`). Without this the footer went on claiming
    // a hint the server had already spent — MEASURED, after a spend that answered at 88 s and was given up on at
    // 8 s: the debit landed, this app never adopted it, and every later press was refused while the footer said "1
    // of 3". The correction is shown rather than silent, because a balance that moves by itself is its own puzzle.
    const refusal = refusedSpend(balance, answer.failure.code);
    if (refusal.corrected) {
      serverHints = refusal.ledger;
      paintBalance();
      sayInDaily(
        `The server holds no hints for you, so nothing was spent — and the balance on this page has been corrected (0 of ${HINT_CAP} held). ${answer.failure.message}`,
        'bad',
      );
      return;
    }
    sayInDaily(`The server would not record a hint: ${answer.failure.message}`, 'bad');
    return;
  }
  // THE SERVER'S BALANCE IS THE ONE SHOWN, for the same reason its score is adopted after a run: two ledgers is one too
  // many, and this app has none of its own any more.
  serverHints = { hints: answer.value.hints.hints, successes: answer.value.hints.successes };
  // AND SO IS ITS NAME (A23's naming): the server looked the call up from the line it RECORDED, which is the board
  // the player is actually on, where this app's own look-up runs from the position it believes it is on.
  const hint = daily.takeHint(answer.value.call);
  if (!hint.spent || !hint.call) {
    // The server charged the hint but there is nothing to name, so the run is NOT charged locally: a hint that cannot
    // say anything is not a hint (DESIGN.md 10).
    sayInDaily('There is nothing to hint from here.', 'bad');
    return;
  }
  sayInDaily(`Hint: ${hint.call}. A minute has been added to the clock, and it is not refunded.`, 'info');
  // THE FOOTER IS SHARED CHROME AND THE PANEL IS THE DAILY'S: the balance is painted either way, and the Daily's
  // panel is only repainted where the Daily is what the player is looking at.
  paintBalance();
  if (page === 'daily') paintDaily();
  persist();
}

/**
 * THE PANEL'S LINE FOR THE MODE ON SCREEN, or null when there is nothing to list and nothing to play.
 *
 * ONE PLACE DECIDES WHAT IS PLAYABLE, which is why both modes' buttons land here: the Daily's line is the player's own
 * (or the generator's shortest, chosen by `reviewWhich`), and a drill's is the correct option at each step — a drill has
 * one right answer per step, so the answer key IS the solve. A completed drill opened from the block uses the same call,
 * because the puzzle the controller holds IS that position's.
 */
function panelLine(): { calls: readonly string[]; start: Puzzle['start']; heading: string } | null {
  if (mode === 'daily') {
    if (!daily) return null;
    const { mine, shortest } = daily.review();
    const calls = reviewWhich === 'mine' ? mine : shortest;
    if (calls.length === 0) return null;
    return { calls, start: daily.start, heading: reviewWhich === 'mine' ? 'The calls you played' : 'The shortest line — the generator\'s route' };
  }
  if (!controller || (!watchingDrill && !controller.atEnd)) return null;
  const puzzle = controller.puzzleRef;
  const calls = correctCalls(puzzle);
  return { calls, start: puzzle.start, heading: `Drill ${position + 1} — the ${calls.length} call${calls.length === 1 ? '' : 's'} that solved it` };
}

/**
 * `Play`: put the panel's line on the stage, from its start, and mark the call being played as it goes.
 *
 * THE MOTION IS THE ONE EVERY MOVE USES (`startReplay`), so it stops on its landing board and cannot outlive the panel.
 * The boundaries are measured one call at a time from the board the previous call left, because the applier reports a
 * line's beats as a total only — MEASURED, the parts add up to the whole in 8 of 8 generated level-1 Dailies
 * (`game/test/replay-line-probe.mjs` re-measures it).
 */
function playLine(): void {
  if (!applier) return;
  const line = panelLine();
  if (!line) return;
  const callBeats: number[] = [];
  let board = line.start;
  for (const call of line.calls) {
    callBeats.push(applier.motion([call], board).beats);
    board = applier.apply(board, call);
  }
  playingLine = replayLine(line.calls, callBeats);
  // THE LINE IS THE THING THE PLAYER ASKED TO WATCH, so its ending is the content: it is held on its last frame for
  // `LANDING_HOLD_MS` instead of snapping back to the opening formation. REPORTED: "Put as 2 second delay/pause after
  // playing the sequence for Drills and Todays Daily before resetting to the first formation/arrangement."
  startReplay(applier.motion(line.calls, line.start), 'settle', LANDING_HOLD_MS);
}

/**
 * The Daily's two sources: `mine` is the calls the player actually made, `shortest` the generator's own route.
 *
 * THE EMPTY CASE IS THE ONLY ONE THAT ANSWERS WITHOUT PLAYING, because a given-up run may have no line of its own: it
 * says so rather than starting a motion that would have nothing to show.
 */
function startReview(which: 'mine' | 'shortest'): void {
  if (!daily) return;
  reviewWhich = which;
  const { mine } = daily.review();
  if (which === 'mine' && mine.length === 0) {
    dailyScreen.say('There is no line of your own to replay yet.', 'bad');
    return;
  }
  paintDaily();
  playLine();
}

/**
 * THE PANEL'S `Play`, in both modes — and the mode is the only thing the press has to ask.
 *
 * ONE BUTTON, TWO MODES (`DESIGN.md` 9): the Drill has exactly one line on its panel, so the press plays it; the Daily
 * has two, so the press first says WHICH line is on the panel and then plays it. The buttons were both wired to
 * `startReview`, which begins `if (!daily) return` — so in the DRILL the press did nothing at all. REPORTED: "the
 * animation of a completed Drill #1 not working. After opening the Today's Daily and returning to the Drill, the
 * completed drills animation did work" — and that is the same fact seen from the other side: `daily` is only cleared
 * by a new challenge, so after a visit `startReview` got past its guard and played `panelLine()`, which in drill mode
 * is the drill's own line. The guard was doing the mode's job by accident.
 */
function playPanel(which: 'mine' | 'shortest'): void {
  if (mode === 'daily') startReview(which);
  else playLine();
}
/** The engine's refusal prose, tidied for a sentence. The string itself is never reworded. */
function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// --------------------------------------------------------------------------------------------- the drawing

function paintDaily(): void {
  if (!daily) return;
  // THE BOARD PAIR AND ITS CAPTIONS ARE PART OF THE DAILY'S PAINT, because the waypoint the player is on is what
  // this paint is about: a move that changed it has to move the boards, the borders and the words together.
  paintWaypoints();
  const view = daily.view(performance.now());
  // THE RESULT LINE SAYS WHETHER THIS RUN IS SCORED: a signed-out Daily is a demo, and its number is not stored. The rule
  // is `mayWrite`, the same predicate the submission uses.
  const writable = apiConfigured() && mayWrite(currentStanding());
  dailyScreen.show(view, writable);
  // THE SOLVED RUN IS SUBMITTED FROM HERE, ONCE PER RUN. This paint runs on every event; `dailySubmittedFor` is the
  // once-only key that the removed local record used to provide (`recordDailyRun` answered 0 on a second paint).
  if (view.outcome === 'solved' && view.result && writable && dailySubmittedFor !== dailyRunId) {
    dailySubmittedFor = dailyRunId;
    void submitSolvedDaily(daily);
  }
  // THE PLAY BUTTONS APPEAR WHEN THE RUN IS OVER (DESIGN.md 9: "on solving, or on giving up, the player can replay
  // their own line and the generator's shortest line"), and so does the LIST of the calls the chosen line is made of.
  // `reviewWhich` is the shell's memory of which of the two is on screen; the list is rebuilt only when the line itself
  // changes, because this paint runs on every event.
  const over = view.outcome !== 'playing';
  // THE DAILY'S OWN CONTROLS, GUARDED BY THE PAGE AND NOT ONLY BY THE RUN: a poll answer or a resumed clock can repaint
  // this while the player is somewhere else, and a `Undo` left on screen under a help page would be a control for a run
  // nobody can see. The drill's page paints its own footer in `paintView`, so the two cannot fight over the same button.
  //
  // THE HINT AND "GIVE UP" LEFT THIS FOOTER. REPORTED: "Daily: Remove the Hint button and move the event handler to the hint
  // bank badge in the header" (the badge is `els.bannerHints`, enabled by `dailyHintAvailable`) "and Remove the Give Up
  // button, this is the same as using the back button." Giving up is therefore the way back: the run stays in flight and
  // `DailyRun.giveUp` survives for the saved record a resume can still carry (`game/test/daily-run-probe.mjs` §5 drives it),
  // but nothing on screen ends a run that the player is still allowed to finish.
  //
  // AND UNDO/REDO LEFT IT TOO, for the Daily's own top row (`#dailyTop`, beside the clock) — REPORTED: "Move the undo/Redo
  // buttons to the top of the HUD, make them much smaller as they take up a lot of screen real estate." Same rule, same
  // guards: they are shown by a PLAYING run on the Daily and by nothing else.
  const onDaily = page === 'daily';
  els.replayMine.hidden = !over || !onDaily;
  els.replayShortest.hidden = !over || !onDaily;
  els.undo.hidden = over || !onDaily;
  els.redo.hidden = over || !onDaily;
  // AND A SMALL ICON BUTTON NEEDS ITS STATE DRAWN, because there is no label to say "Undo" in words: with nothing to undo the
  // press used to do nothing at all, which at 40 px reads as broken. `canUndo`/`canRedo` are the view's own facts — the move
  // stack and the redo branch — so the button cannot claim a history the run has not got.
  els.undo.disabled = !view.canUndo;
  els.redo.disabled = !view.canRedo;
  // THE LIST IS THE SAME PANEL IN BOTH MODES (`panelLine`), so it is shown and hidden by the same rule here and in
  // `paintView`. A given-up run with no moves of its own has nothing to list, and says so only when `Play` is pressed.
  const line = over ? panelLine() : null;
  if (line) {
    const key = `${reviewWhich}:${line.calls.join('>')}`;
    if (shownCalls !== key) {
      shownCalls = key;
      replayList.show(line.calls, line.heading);
    }
  } else {
    shownCalls = null;
    replayList.hide();
  }
  paintBalance();
  // AND THE BANNER, because the hint badge is the Daily's hint button now and the two things it asks about are exactly this
  // paint's subject: whether the run is still playing, and whether a motion is in flight. A Daily that solves itself out of
  // a badge that still says "Take a hint" would be the "control that does nothing" this file refuses.
  paintBanner();
}

function draw(): void {
  const current = currentPair();
  if (!current) return;
  if (replay) {
    // A REPLAY IS DRAWN FROM THE ENGINE'S OWN WALK, sampled at the playhead's beat — and a FINISHED one
    // keeps its landing board on screen, because that is the whole teaching content of a wrong answer:
    // where the call you chose actually leaves the set. The right-hand waypoint stays still, and the borders
    // describe the pair rather than the motion.
    stage.drawMotion(replay, current.stage, PLAYHEAD.beat);
    return;
  }
  stage.drawPair(current.stage);
}

/**
 * Start a replay of `motion`, what landing it means, and how long its last frame is held.
 *
 * THE HOLD IS A PARAMETER because the two kinds of motion end differently: a VERDICT animation hands the picture
 * straight back to the pair, while a LINE played from the panel's `Play` stops on its landing board for
 * `LANDING_HOLD_MS` so the player can see that it finished (`ui/playhead.ts` carries the rule and the report).
 */
function startReplay(motion: SequenceMotion, outcome: ReplayOutcome, holdMs = 0): void {
  replay = motion;
  replayOutcome = outcome;
  setBusy(true);
  PLAYHEAD.start(motion.beats, holdMs);
}

/**
 * THE PICTURE GOES BACK TO THE PANEL'S PAIR, which is where a replay begins and ends: `replay` is what `draw` samples
 * instead of the pair, so clearing it is what returns the boards — and `draw` has to be told, because the frame that
 * clears it has already painted the held landing frame.
 *
 * AND THIS IS WHERE `Auto-progress` FIRES, because it is the moment the two-second pause has run out: the motion is
 * over, the picture is back, and the press that would have been the player's is made for them. The guard is the
 * OFFER — `els.next` is hidden exactly when the advance would be refused (a demo run, A20, or a watched drill), so the
 * toggle cannot send a request the button beside it would not have sent.
 */
function endReplay(): void {
  replay = null;
  replayOutcome = 'settle';
  draw();
  if (autoProgress && mode === 'drill' && !watchingDrill && controller?.atEnd && !els.next.hidden && !nextOffersSignIn) {
    issueCurrentDrill('advance');
  }
}

function setBusy(busy: boolean): void {
  drillScreen.setBusy(busy);
  dailyScreen.setBusy(busy);
  // THE BANNER IS BUSY TOO, because the hint badge lives in it and `dailyHintAvailable` refuses a spend while a motion is
  // being danced: without this repaint the badge would stay enabled through the replay and answer a press with nothing.
  paintBanner();
}

function toggleView(): void {
  viewMode = viewMode === '2d' ? '3d' : '2d';
  stage.setMode(viewMode);
  els.view.textContent = viewMode === '2d' ? 'Switch to 3D' : 'Switch to 2D';
  draw();
}

/**
 * THE ONE PLACE THAT ASKS FOR THE NEXT FRAME, and the one place that refuses to while the page is hidden.
 *
 * A HIDDEN TAB GETS NO FRAME REQUESTS. A browser throttles `requestAnimationFrame` to nothing in a background tab anyway, so
 * continuing to ask is pure battery — and an installed app on a phone is exactly where that shows. `shouldAnimate` is
 * `ui/frame-clock.ts`'s rule; `frameRequested` is the guard that stops the visibility listener from scheduling a SECOND loop
 * alongside the running one, which would double every animation step.
 */
function schedule(): void {
  if (frameRequested || !shouldAnimate(document.visibilityState)) return;
  frameRequested = true;
  requestAnimationFrame(frame);
}
let frameRequested = false;

function frame(nowMs: number): void {
  frameRequested = false;
  // THE CLAMP AND THE FIRST-FRAME STEP COME FROM ui/frame-clock.ts, where frame-clock-probe.mjs can reach them: a tab
  // hidden for minutes would otherwise hand the playhead the whole gap and a 320 ms slide would complete in one jump.
  const dt = frameDelta(nowMs, lastFrameMs);
  lastFrameMs = nowMs;
  // THE PLAYHEAD'S PHASE, NOT ITS `isRunning`: a LINE drawn to its end HOLDS that frame for two seconds
  // (`LANDING_HOLD_MS`), and the loop has to keep painting it. `isRunning` stays false through the hold on purpose, so
  // a button pressed while the last board is still up is answered rather than refused.
  if (PLAYHEAD.phase !== 'idle') {
    const { landed, done } = PLAYHEAD.advance(dt);
    draw();
    // THE CALL BEING PLAYED IS MARKED WHILE THE LINE PLAYS, from the same playhead beat the picture is sampled at — so
    // the list and the stage cannot disagree about where in the line we are. `puzzle/replay-line.ts` turns a beat into a
    // call, and `ReplayList` writes nothing while the answer is unchanged.
    if (playingLine) replayList.highlight(callAt(playingLine, PLAYHEAD.beat));
    if (landed) {
      // THE MARK GOES WHEN THE LINE LANDS: the list is a record, not a progress bar, and a call left lit would say the
      // replay is still somewhere it is not.
      if (playingLine) {
        replayList.highlight(null);
        playingLine = null;
      }
      setBusy(false);
      // THE MOTION IS KEPT, AND THAT IS THE WHOLE OF THE REPORTED SNAPBACK. Dropping it here made the next `draw` paint
      // the PANEL's pair — whose left board is the board the run STARTED from — so a line played to its ending jumped
      // straight back to the opening formation ("Put as 2 second delay/pause after playing the sequence … before
      // resetting to the first formation"). It is held on its last frame until `done`.
      const outcome = replayOutcome;
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
      // THE PICTURE STAYS ON THE LANDING UNTIL `done`, WHICH IS AFTER THE HOLD — for a played line, for a finished drill's
      // last answer, and (since the report that added it) for a WRONG DRILL ANSWER, whose board is the thing to study. The
      // only verdict that reaches the branch here with `done` already true is an answer that asked for no hold: a correct
      // one before the last step, where the next question's options belong beside this landing rather than two seconds after
      // it. See `drillAnswerHoldMs` in `ui/playhead.ts` for the three cases and why each one is what it is.
      if (done) endReplay();
    } else if (done) endReplay();
  } else if (mode === 'daily' && daily) {
    // THE CLOCK IS DRAWN FROM THE FRAME LOOP because it runs whether or not anything is moving, and only the
    // readout is touched — `writeClock` compares the string first, so this is not 60 DOM writes a second.
    dailyScreen.writeClock(daily.view(performance.now()));
  }

  // THE CAMERA AND THE DRAW RUN EVERY FRAME, NOT ONLY DURING A REPLAY. Two different jobs: `updateControls`
  // glides the orbit/pan damping, and `render` is what actually PAINTS — the stage owns no animation loop, so
  // a frame that poses views and never renders shows a blank canvas. That is exactly what the first version of
  // this loop did: it rendered nothing while idle, so the boards were black until an option was clicked.
  //
  // AND NEITHER RUNS ON A PAGE WITH NO BOARD. REPORTED: "hide the dancing board when displaying a page, only expose it when
  // they are part of the game". A hidden canvas still costs a WebGL frame at 60 Hz for a picture nobody can see, and the
  // slide/pulse ticks it would advance belong to a drill that is not on screen — so the loop keeps its schedule and skips
  // the paint, which is also what makes coming back to a game page cheap (the canvas and camera are untouched).
  if (els.stageCanvas.hidden) {
    schedule();
    return;
  }
  stage.updateControls();
  // A SLIDE IS ADVANCED FROM THE SAME LOOP THAT PAINTS THE FRAME, before the render: `tick` only writes the slot
  // positions, and the stage owns no clock of its own.
  stage.tick(nowMs);
  stage.render();
  schedule();
}

function main(): void {
  // THE THEME GOES ON BEFORE ANYTHING IS PAINTED: `ui/theme.ts` is the one table the stylesheet, the stage and this
  // shell read, and it is injected rather than duplicated in CSS. That included the legend's `--wp-*` swatches, which
  // used to be copied here from `OUTLINE_COLOR` — the copy was correct and was still a second definition.
  applyTheme();
  stage.setMode(viewMode);
  els.view.textContent = 'Switch to 3D';
  paintAutoProgress();
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
  paintAccount();

  // THE NAVIGATION. Every destination is a hash, so these handlers only ever WRITE A URL: `hashchange` is what applies
  // the page. That is what makes the browser's own back button, a reload and a bookmark the same mechanism as a press
  // here, rather than three behaviours to keep in step.
  els.goProfile.addEventListener('click', () => navigate({ page: 'profile', drillIndex: null }));
  els.goHelp.addEventListener('click', () => navigate({ page: 'help', drillIndex: null }));
  els.goLevels.addEventListener('click', () => navigate({ page: 'levels', drillIndex: null }));
  els.goDaily.addEventListener('click', () => navigate({ page: 'daily', drillIndex: null }));
  els.goSetup.addEventListener('click', () => navigate({ page: 'setup', drillIndex: null }));
  els.goBoard.addEventListener('click', () => navigate({ page: 'board', drillIndex: null }));
  // THE PROFILE'S LEADERBOARD SECTION IS A DOOR TO THE BOARD PAGE, not a second copy of it: a board is one page with its own
  // mode filter, and printing a top-N list inside the profile would be a second reader of the same endpoint.
  els.profileBoard.addEventListener('click', () => navigate({ page: 'board', drillIndex: null }));
  // THE BACK BUTTON IS A PLACE, not a history step (`backTarget`), so a player who wandered Help → Profile → back gets
  // the menu rather than Profile. A page with no parent hides the button (`paintChrome`).
  els.bannerBack.addEventListener('click', () => {
    const target = backTarget(page);
    if (target !== null) navigate({ page: target, drillIndex: null });
  });
  // THE ACCOUNT BADGE IS A LINK TO THE ACCOUNT PAGE IN EVERY STATE, including the empty one — which is the report that added
  // it. On the account page it re-applies the page, because a press that does nothing is worse than one that lands.
  els.bannerAccount.addEventListener('click', () => navigate({ page: 'profile', drillIndex: null }));
  window.addEventListener('hashchange', () => applyPage(pageFor(location.hash), true));
  els.boardModeDrill.addEventListener('click', () => switchBoardMode('drill'));
  els.boardModeDaily.addEventListener('click', () => switchBoardMode('daily'));
  els.next.addEventListener('click', () => {
    // THE DEMO'S WAY ON IS THE PROFILE PAGE (`offerNext`), because there is no advance to send.
    if (nextOffersSignIn) navigate({ page: 'profile', drillIndex: null });
    else issueCurrentDrill('advance');
  });
  // THE SAME PRESS THE PLAYER WOULD MAKE (`els.next`), taken automatically once a solved drill's landing has been
  // held — plus a repaint, because `issueCurrentDrill` re-derives the footer and must not leave a stale label.
  els.autoProgress.addEventListener('click', () => {
    autoProgress = !autoProgress;
    paintAutoProgress();
  });
  els.undo.addEventListener('click', undoDaily);
  els.redo.addEventListener('click', redoDaily);
  els.waypointPrev.addEventListener('click', () => pageWaypoints(-1));
  els.waypointNext.addEventListener('click', () => pageWaypoints(1));
  els.boardYou.addEventListener('click', () => setBoardFocus('left'));
  els.boardTarget.addEventListener('click', () => setBoardFocus('right'));
  // THE HINT BADGE IS THE DAILY'S HINT BUTTON (REPORTED: "Daily: Remove the Hint button and move the event handler to the hint
  // bank badge in the header"). One handler, and `dailyHintAvailable` is what makes it inert everywhere else.
  els.bannerHints.addEventListener('click', () => void takeHint());
  els.replayMine.addEventListener('click', () => playPanel('mine'));
  els.replayShortest.addEventListener('click', () => playPanel('shortest'));
  els.view.addEventListener('click', toggleView);
  els.practice.addEventListener('click', startPractice);
  els.startOver.addEventListener('click', startOver);

  // FRAME THE BOARDS IN THE SPACE THE PANEL LEAVES, not under it — and IN THE SHAPE THE VIEWPORT GIVES US.
  //
  // MEASURED FROM THE ELEMENTS rather than hard-coded, because the panel is content-sized: a fixed number here would be
  // correct until a call name wrapped to two lines and then quietly wrong. THE SIDE COMES FROM `ui/layout.ts`, because
  // the formula this replaces (`left: rect.right + 8`) can only describe a panel pinned to the left edge, which is the
  // desktop-only assumption the phone layout removes: on a phone the panel is a sheet across the bottom and the boards
  // must be framed in the height above it.
  const panel = document.getElementById('panel');
  const canvasEl = document.getElementById('stage') as HTMLCanvasElement | null;
  /**
   * HOW MUCH OF THE CANVAS'S TOP IS COVERED BY THE SWITCHER AND THE BOARD NAME, in CSS pixels.
   *
   * REPORTED: "Make sure the board doesnt overlap the board name above it." Those two are `position: absolute` over the
   * canvas (`#boardTabs` and the `#labelHere`/`#labelGoal` captions), and the insets used to describe the PANEL only — so
   * the frame was centred in the whole canvas and a board's dancers could be drawn under its own name. Measured from the
   * elements for the same reason as the panel: the caption's height follows the type scale and the formation name.
   *
   * 16 px AND NOT 8, MEASURED IN A BROWSER at 500 x 757 in the 3D view: with 8 the floor's projected top edge landed
   * within a couple of pixels of the caption's last line and still read as touching it — a perspective floor's far corner
   * projects higher than its centre plane, and a dancer standing on it higher still, so the clearance has to be more than
   * the 8 px the panel's own edge needs.
   */
  const overlayTop = (canvas: DOMRect): number => {
    const bottoms = [els.boardTabs, els.labelHere, els.labelGoal]
      .filter((element) => !element.hidden)
      .map((element) => element.getBoundingClientRect().bottom);
    return bottoms.length === 0 ? 0 : Math.max(0, Math.max(...bottoms) - canvas.top + 16);
  };
  const applyInsets = (): void => {
    // THE BOARDS USE THE WHOLE CANVAS, AND THE PAGING ZONES SIT OVER ITS EDGES. REPORTED: "make the waypoint navigation
    // buttons invisible and take up quarter of the canvas edges ... This gives more canvas area for the board to use", and
    // "this removes the need for the extra margin you just added." So the view insets are the panel's side and the
    // captions' height only — no horizontal gutter is reserved for the paging controls, because they are transparent
    // quarters of the canvas (`.wp-nav` in `style.css`) rather than arrows beside the boards. NOTHING PUBLISHES THE
    // BOARD'S FRAME TO CSS either: a zone spans the canvas from top to bottom, so it needs no measured origin.
    const rect = panel?.getBoundingClientRect();
    const canvas = canvasEl?.getBoundingClientRect();
    if (!rect || !canvas) {
      stage.setViewInsets({});
    } else if (layout.panelSide === 'bottom') {
      stage.setViewInsets({ top: overlayTop(canvas), bottom: Math.max(0, canvas.bottom - rect.top + 8) });
    } else {
      stage.setViewInsets({ top: overlayTop(canvas), left: Math.max(0, rect.right - canvas.left + 8) });
    }
    draw();
  };
  /**
   * THE SHELL'S SHAPE, from the one rule that decides it. The numbers go onto the document as custom properties so the
   * stylesheet positions the panel from the SAME answer the stage insets itself by — the alternative is a media query
   * and a script that disagree by one pixel and a board half under the panel.
   */
  const applyLayout = (): void => {
    const side = layout.panelSide;
    layout = layoutFor(window.innerWidth, window.innerHeight);
    document.documentElement.style.setProperty('--panel-size', `${layout.panelSize}px`);
    document.documentElement.dataset.panel = layout.panelSide;
    document.documentElement.dataset.mode = layout.mode;
    // THE BOARD SWITCHER FOLLOWS THE LAYOUT, so a resize across the breakpoint adds or removes it with the framing.
    paintBoardTabs();
    paintWaypoints();
    // AND THE BANNER DOES TOO: whether it is drawn at all depends on the layout (`paintChrome`), so a resize across the
    // breakpoint has to re-ask.
    paintChrome();
    // CROSSING THE BREAKPOINT MOVES WHERE THE BOARDS ARE DRAWN, so the read moves with it: widening onto a page with no
    // dance board fills the full-screen standings, and narrowing to the sheet leaves the board page's own list. The side
    // is compared rather than reloading on every resize frame.
    if (side !== layout.panelSide) refreshBoards();
    applyInsets();
  };
  applyLayout();
  if (panel && typeof ResizeObserver !== 'undefined') new ResizeObserver(applyInsets).observe(panel);

  window.addEventListener('resize', () => {
    applyLayout();
    stage.resize();
    draw();
  });

  // THE LOOP STOPS WHEN THE PAGE IS HIDDEN AND STARTS AGAIN WHEN IT IS NOT (AGENTS.md §4.4's battery note, and a phone in a
  // pocket is where it shows). THE FIRST FRAME AFTER A RESUME IS A FIRST FRAME: `lastFrameMs = 0` makes `frameDelta` charge the
  // nominal step rather than the hidden gap — the clamp would catch it anyway, but "we have no previous frame" is the honest
  // description of a tab that has just come back.
  document.addEventListener('visibilitychange', () => {
    if (!shouldAnimate(document.visibilityState)) return;
    lastFrameMs = 0;
    schedule();
  });

  // THE FRAME LOOP STARTS FIRST, because the stage owns no loop of its own and a paused one is a black canvas.
  // THE FIRST PAGE THEN WAITS FOR THE IDENTITY: with a server, `bootAccount` learns the mode and applies the URL's
  // page, which is what issues the first drill with an identity the browser is allowed to send; offline there is nothing
  // to learn and the page is applied here.
  // THE INSTALLABLE APP: THE SERVICE WORKER IS REGISTERED IN A BUILT BUNDLE ONLY. In development it would sit between
  // Vite's module graph and the page, caching the very URLs the dev server rewrites — import.meta.env.PROD is the guard
  // rather than a check for a hostname. Registration is BEST-EFFORT: a browser that refuses (a file:// build, a private
  // window with storage blocked) loses nothing, because the game is offline-capable without it and says so in index.html.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    });
  }

  schedule();
  // AND THE BOOT VEIL IS LIFTED HERE, after the theme, after `applyLayout` has set the type scale and the panel's side, and
  // after two animation frames — so the first frame the player can see is the themed, laid-out shell rather than the bare
  // markup at the default scale. REPORTED: "the glyphs apearing in the wrong scale and without a cohesive background."
  // It is lifted HERE rather than at the end of the async boot on purpose: if a request later fails, the player sees the
  // app and its refusal rather than a splash screen that never ends.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.dataset['ready'] = '1';
  }));
  if (apiConfigured()) void bootAccount();
  else bootPage();
}

main();
