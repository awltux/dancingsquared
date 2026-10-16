// The game's ONE outbound path, and it is OPT-IN.
//
// WHY THE BASE URL IS THE SWITCH. AGENTS.md 6 promises the game works offline, and the deployment story is
// "`VITE_API_BASE` unset is today's behaviour". So this module never reaches for the network unless a base is
// configured, and every function returns a TYPED RESULT rather than throwing: a refusal from the server is
// content the player has to be told (its `message` is shown as it was written), and an unreachable server is a
// state the app has to survive rather than a crash.
//
// THE IDENTITY IS A SESSION OR A DEVICE. A signed-in player's access token rides in the `Authorization` header —
// the header a deployment's Cognito authorizer reads, and the one the emulator verifies — and a signed-out one is
// an anonymous device id, minted once and kept in `localStorage` (DESIGN.md §8: "an anonymous player therefore
// gets an issued drill keyed to a device id"). WHICH of the two a request should use is not decided here: it is
// read out of the stored session (`session.ts`), so "the app is signed in" and "there is a token to send" are one
// fact rather than two that can disagree.
//
// IT TAKES ITS DEPENDENCIES AS AN ARGUMENT (`deps`), which is what lets a probe drive every refusal with a fake
// fetch and a fake storage — no browser, no server, and no way for a probe to mistake an untested path for a
// working one.
import { newRunId, type RunRecord } from '../game/store.ts';
import { accessTokenOf, type SessionStore } from './session.ts';
// A TYPE-ONLY IMPORT, so there is no runtime cycle: `auth.ts` calls this module's `apiCall`, and this module needs
// only the NAME of the mode it discovers.
import type { AuthMode } from './auth.ts';

/** A refusal as the API writes it: a code for a program and a sentence for a person. */
export interface ApiFailure {
  readonly code: string;
  readonly message: string;
}

/** Every call answers with one of these; nothing here throws for a server's answer. */
export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: ApiFailure };

/** The issued drill, as `GET /drill/current` returns it. */
export interface IssuedDrill {
  readonly id: string;
  readonly index: number;
  readonly levelIndex: number;
  readonly seed: number;
  readonly poolVersion: string;
  readonly issuedAtMs: number;
  /** A cross-check the client may compare with its own generation; null when the server did not send one. */
  readonly optionLabels: readonly string[] | null;
  readonly resumed: boolean;
}

/** Where the player is in the regime. */
export interface RegimeCounts {
  readonly finished: number;
  readonly length: number;
}

/** The key the device id lives under. Same namespace as the saved game, and never a secret. */
const DEVICE_KEY = 'dsq.game.device';

export interface ApiDeps extends SessionStore {
  readonly base: string;
  readonly fetch: typeof globalThis.fetch;
  /**
   * A build-time pin of the identity mode (`VITE_AUTH_MODE`), or undefined to discover it from `/health`.
   *
   * IT IS ON THE DEPENDENCIES RATHER THAN READ FROM `import.meta.env` WHERE IT IS USED, for the reason every other
   * setting here is: a probe cannot set `import.meta.env`, so an override read at the point of use is an override
   * no test can reach. `browserDeps` is the only place the real value is read.
   */
  readonly modeOverride?: string;
  readonly timeoutMs: number;
}

/**
 * The configured base URL, with any trailing slash removed so a path can be appended without doubling one.
 *
 * `import.meta.env` IS VITE'S, so this is a build-time constant: a build with `VITE_API_BASE` set talks to that
 * server and a build without it is exactly the offline game it has always been.
 */
export function normaliseBase(configured: string | undefined): string {
  return (configured ?? '').replace(/\/+$/, '');
}

/** The base URL as configured. */
export function apiBase(): string {
  const configured = import.meta.env?.VITE_API_BASE;
  return normaliseBase(typeof configured === 'string' ? configured : undefined);
}

/** Whether an API is configured at all — the ONE switch every caller asks before reaching for the network. */
export function apiConfigured(): boolean {
  return apiBase() !== '';
}

/**
 * The real dependencies, from the browser.
 *
 * IT IS EXPORTED FOR THE SHELL, which needs the same dependencies `auth.ts` takes: the sign-in surface reads and
 * writes the session through them. Every other caller uses the default argument below, so this stays the ONE place
 * `import.meta.env` and `window.localStorage` are read (the reason it was built here rather than at each call site).
 */
export function browserDeps(): ApiDeps {
  const mode = import.meta.env?.VITE_AUTH_MODE;
  return {
    base: apiBase(),
    fetch: globalThis.fetch.bind(globalThis),
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
    ...(typeof mode === 'string' && mode !== '' ? { modeOverride: mode } : {}),
    // LONG ENOUGH FOR A COLD SERVER, SHORT ENOUGH THAT A DEAD ONE IS NOT A HUNG TAB: the api's first request
    // builds a level's applier, which is MEASURED at 2.0 s for the first level and ~0.8 s for each further one
    // (`api/src/levels.ts`), so a timeout under a few seconds would fail on a cold start that is working.
    timeoutMs: 8000,
  };
}

/**
 * The player's anonymous id, minted on first use and kept.
 *
 * IT IS NOT A SECRET AND IT IS NOT AN ACCOUNT: it exists so the server can key a regime to a device, and it is
 * replaced by a token's `sub` the moment there is one. `newRunId` is reused rather than inventing a second id
 * generator — it is already the app's entropy source, with a fallback for browsers without `crypto.randomUUID`.
 */
export function deviceId(deps: ApiDeps): string {
  const existing = deps.getItem(DEVICE_KEY);
  if (existing) return existing;
  const minted = newRunId(Date.now());
  deps.setItem(DEVICE_KEY, minted);
  return minted;
}

/**
 * THE MODE `/health` ANSWERED, remembered here because the dependencies are built per call.
 *
 * `browserDeps()` runs afresh for every defaulted call, and `deps.modeOverride` carries only a build-time PIN — so
 * without this the identity decision below would have to be re-discovered (or guessed) per request. One anonymous
 * read settles it for the page's lifetime, which is what §11.2 means by "the mode is discovered, not compiled in":
 * the pin is the exception, the answer is the rule.
 */
let discoveredMode: AuthMode | null = null;

/** Record what `/health` said. Called once by the shell after `discoverAuth`, and by nothing else. */
export function rememberAuthMode(mode: AuthMode | null): void {
  discoveredMode = mode;
}

/** The mode in force: the build-time pin if it names a real one, otherwise what the server answered. */
function identityMode(deps: ApiDeps): AuthMode | null {
  if (deps.modeOverride === 'dev' || deps.modeOverride === 'emulate' || deps.modeOverride === 'cognito') return deps.modeOverride;
  return discoveredMode;
}

/**
 * The headers that say who is asking: the session's token if there is one, the device id in `dev`, and NOTHING else.
 *
 * THE DEVICE HEADER IS SENT ONLY WHERE THE SERVER ADVERTISES IT, and sending it anywhere else is not the smaller
 * mistake it looks like. A custom header makes a request non-simple, so the browser sends a CORS PREFLIGHT first, and
 * a token mode's `access-control-allow-headers` deliberately omits `x-dev-player` (`api/src/dev-server.ts`, pinned as
 * a NEGATIVE CONTROL in `api/test/auth-probe.mjs`) — the point of the omission being that a browser cannot even
 * attempt to name a player by header in a mode where a header is not an identity. MEASURED in a real browser at
 * `http://localhost:8089` against `DSQ_AUTH=emulate`: with this header unconditional, a signed-out player's demo
 * drill came back as `TypeError — the server could not be reached`, which is the ONE read §11.2 promises them. An
 * ABSENT identity header is also the honest request: it says "this call claims to be nobody", and the server answers
 * the demo (A20). A mode this build could not learn is therefore NO header and not a device id.
 */
function identityHeaders(deps: ApiDeps): Record<string, string> {
  const token = accessTokenOf(deps);
  if (token) return { authorization: `Bearer ${token}` };
  if (identityMode(deps) === 'dev') return { 'x-dev-player': deviceId(deps) };
  return {};
}

/** A non-2xx answer, as the API writes it — or a sentence of this module's when the body is not one. */
async function failureFrom(response: Response): Promise<ApiFailure> {
  const fallback = { code: `http_${response.status}`, message: `the server answered ${response.status}` };
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const code = body?.error?.code;
    const message = body?.error?.message;
    if (typeof code !== 'string' || typeof message !== 'string') return fallback;
    return { code, message };
  } catch {
    // A PROXY'S HTML ERROR PAGE IS NOT THIS API'S ERROR SHAPE, and a refusal nobody can parse is still a refusal:
    // reporting the status is honest, and inventing a code from the body would be a fabrication.
    return fallback;
  }
}

/**
 * One call: build the URL, send it, and turn every outcome into an `ApiResult`.
 *
 * IT IS EXPORTED FOR `auth.ts`, WHICH IS THE ONLY OTHER MODULE THAT TALKS TO THIS API, and it is exported rather
 * than re-implemented because a second copy of "what a refusal looks like" is how two callers come to answer
 * differently for the same failure. It is not part of the app's surface: everything else goes through the named
 * functions below, each of which checks the shape it needs.
 *
 * `anonymous` IS FOR THE CALLS THAT TAKE NO IDENTITY AT ALL — `/health`, which is the mode discovery, and the five
 * `/auth/*` endpoints, which carry the credentials THEY need in the body. MEASURED, and it is how this option came
 * to exist: without it every signup also sent `x-dev-player: <device id>`, which the emulator ignores, which a
 * token mode does not even advertise in CORS, and which mints a stable browser identifier onto a request that has
 * no use for one. An absent identity header is also the honest request: it says "this call claims to be nobody".
 */
export async function apiCall<T>(
  deps: ApiDeps,
  path: string,
  init: { method: string; query?: Record<string, string>; body?: unknown },
  options: { readonly anonymous?: boolean } = {},
): Promise<ApiResult<T>> {
  if (deps.base === '') {
    // THE GUARD EVERY CALLER ALREADY CHECKED, kept because a caller that forgot would otherwise fire a relative
    // URL at the dev server that is hosting the page — which reads as a mysterious 404 rather than "no API".
    return { ok: false, failure: { code: 'no_api', message: 'no API base is configured' } };
  }
  const query = new URLSearchParams(init.query ?? {}).toString();
  const url = `${deps.base}${path}${query ? `?${query}` : ''}`;
  try {
    const response = await deps.fetch(url, {
      method: init.method,
      headers: {
        ...(options.anonymous === true ? {} : identityHeaders(deps)),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    if (!response.ok) return { ok: false, failure: await failureFrom(response) };
    return { ok: true, value: (await response.json()) as T };
  } catch (error) {
    // EVERY THROW IS ONE ANSWER: the browser's network failure, a DNS failure and this request's own timeout all
    // mean the same thing to the player, and none of them is a bug in this app.
    return { ok: false, failure: { code: 'unreachable', message: `the server could not be reached (${error instanceof Error ? error.name : 'error'})` } };
  }
}

/** A drill the server sent, or null when the shape is not one — the caller must not generate from a bad seed. */
function asIssuedDrill(raw: unknown): IssuedDrill | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || typeof value.index !== 'number' || typeof value.levelIndex !== 'number' || typeof value.seed !== 'number') return null;
  return {
    id: value.id,
    index: value.index,
    levelIndex: value.levelIndex,
    seed: value.seed,
    poolVersion: typeof value.poolVersion === 'string' ? value.poolVersion : '',
    issuedAtMs: typeof value.issuedAtMs === 'number' ? value.issuedAtMs : Date.now(),
    // OPTIONAL, AND TOLERATED AS MISSING: the labels are the server's cross-check of the client's generation,
    // not something the client needs — so a server that stops sending them is a smaller contract, not a crash.
    optionLabels: Array.isArray(value.optionLabels) ? (value.optionLabels as string[]) : null,
    resumed: value.resumed === true,
  };
}

/**
 * `GET /drill/current?level=<n>` — the drill this player is on, issued or resumed by the SERVER.
 *
 * A MALFORMED DRILL IS REFUSED RATHER THAN GENERATED FROM. This is the one shape check in this module that earns
 * its place: a missing `seed` would become `undefined` and the generator would draw a puzzle from it, which is a
 * wrong question presented as a right one.
 *
 * `demo` IS READ BECAUSE THE SERVER KNOWS SOMETHING THE CLIENT CANNOT. A signed-out caller is served the level's
 * first entry with no Progress row written and this flag set (DESIGN.md §11.2), and it is the server's own word
 * that the run about to be played cannot be ranked — so the app marks it unranked from the answer rather than
 * inferring it from a session it may be wrong about (`net/standing.ts`). It was answered and dropped until the
 * sign-in surface existed, which is the shape of gap §11.2's "the app has no sign-in surface" describes.
 */
export async function issueDrill(level: number, deps: ApiDeps = browserDeps()): Promise<ApiResult<{ drill: IssuedDrill; regime: RegimeCounts; demo: boolean }>> {
  const answer = await apiCall<{ drill?: unknown; regime?: { finished?: unknown; length?: unknown }; demo?: unknown }>(deps, '/drill/current', {
    method: 'GET',
    query: { level: String(level) },
  });
  if (!answer.ok) return answer;
  // A COMPLETE REGIME IS A RESULT, NOT A FAILURE: `drill: null` is the server saying the season is finished, and
  // the caller shows that rather than treating it as an error.
  if (answer.value.drill === null) {
    return { ok: false, failure: { code: 'regime_complete', message: 'every drill in this level’s season has been finished' } };
  }
  const drill = asIssuedDrill(answer.value.drill);
  if (!drill) return { ok: false, failure: { code: 'bad_response', message: 'the server did not send a drill this app can generate from' } };
  const regime = answer.value.regime ?? {};
  return {
    ok: true,
    value: {
      drill,
      // THE SERVER'S OWN WORD, defaulted to `false` rather than inferred: an older server that does not send the
      // flag is one this build cannot claim makes a run unranked, and the standing rule's other facts still apply.
      demo: answer.value.demo === true,
      regime: {
        finished: typeof regime.finished === 'number' ? regime.finished : 0,
        length: typeof regime.length === 'number' ? regime.length : 0,
      },
    },
  };
}

/** The published Daily challenge: a seed, the level it was validated at, and whether this build can play it. */
export interface DailyChallenge {
  readonly day: string;
  readonly levelIndex: number;
  readonly seed: number;
  readonly poolVersion: string;
  readonly publishedAtMs: number | null;
  /** False when the row was published against a pool this build does not serve (DESIGN.md 7.2). */
  readonly playable: boolean;
}

/**
 * `GET /puzzle?mode=daily&level&date` — the challenge for a level and a UTC day.
 *
 * IT DOES NOT GENERATE, and neither does the server: a puzzle is derivable from `(seed, level, poolVersion)`, so
 * the client draws the board from the seed with the same generator the server will use to verify the run (§9).
 * What this call buys is that the seed is the PUBLISHED, validated one rather than a locally derived guess — so a
 * day nobody published is a refusal (`no_published_daily`) instead of a question nobody checked.
 */
export async function dailyChallenge(level: number, day: string, deps: ApiDeps = browserDeps()): Promise<ApiResult<DailyChallenge>> {
  const answer = await apiCall<{ daily?: unknown }>(deps, '/puzzle', {
    method: 'GET',
    query: { mode: 'daily', level: String(level), date: day },
  });
  if (!answer.ok) return answer;
  const raw = answer.value.daily;
  if (typeof raw !== 'object' || raw === null) return { ok: false, failure: { code: 'bad_response', message: 'the server did not send a published challenge' } };
  const value = raw as Record<string, unknown>;
  // THE SEED IS THE ONE FIELD THAT MUST BE THERE, for the same reason the drill's is: `undefined` would generate a
  // different puzzle and present it as today's challenge.
  if (typeof value.seed !== 'number' || typeof value.levelIndex !== 'number' || typeof value.day !== 'string') {
    return { ok: false, failure: { code: 'bad_response', message: 'the published challenge has no seed this app can generate from' } };
  }
  return {
    ok: true,
    value: {
      day: value.day,
      levelIndex: value.levelIndex,
      seed: value.seed,
      poolVersion: typeof value.poolVersion === 'string' ? value.poolVersion : '',
      publishedAtMs: typeof value.publishedAtMs === 'number' ? value.publishedAtMs : null,
      playable: value.playable !== false,
    },
  };
}

/** A completed run, as `POST /runs` takes it. `calls` is the transcript: one call per step for the Drill. */
export interface RunSubmission {
  readonly runId: string;
  readonly mode: 'drill' | 'daily';
  readonly levelIndex: number;
  readonly drillId?: string;
  readonly date?: string;
  /** TIME ON THE CLOCK ONLY: the hint charge is the SERVER's arithmetic, not the client's (§6, §10). */
  readonly elapsedSeconds: number;
  readonly hintsUsed: number;
  readonly attempts: number;
  /**
   * How many steps' answers were SHOWN to the player (DESIGN.md §15 Q16, A28).
   *
   * REQUIRED RATHER THAN OPTIONAL, which is the point: this is the field that decides whether the run the app is
   * about to submit counts, and a caller that forgot it would submit a revealed run as a ranked one. The server
   * takes the union of this and its own record (`POST /drill/reveal`), so the honest direction is to declare.
   */
  readonly reveals: number;
  readonly calls: readonly string[];
  /** The client's own score, which the server CLAMPS to what it can recompute. */
  readonly score: number;
}

/** What the server decided about a run — the numbers the player is actually scored and credited on. */
export interface RunOutcome {
  readonly run: {
    readonly runId: string;
    readonly score: number;
    readonly elapsedSeconds: number;
    readonly clamped: boolean;
    readonly duplicate: boolean;
    /**
     * Whether the run counted, which is the SERVER's answer and not something the app can infer.
     *
     * `granted: false` below is the ordinary case — nine successes in ten grant nothing — so without this a revealed
     * run and an unremarkable one would look identical to the app, and the app has to TELL the player which it was.
     */
    readonly ranked: boolean;
  };
  readonly hints: { readonly hints: number; readonly successes: number; readonly granted: boolean };
  readonly board: { readonly period: string; readonly score: number; readonly runs: number };
  readonly progress: { readonly finished: number } | null;
}

/**
 * `POST /runs` — hand over a completed run.
 *
 * THE SERVER MAY REFUSE IT (a stale drill, a line that does not reach the goal, a run it cannot regenerate), and
 * the refusal is returned as a typed failure with the server's own sentence — the caller decides whether to keep a
 * local record instead, which is what the offline path does by definition.
 */
export async function submitRun(submission: RunSubmission, deps: ApiDeps = browserDeps()): Promise<ApiResult<RunOutcome>> {
  const answer = await apiCall<Record<string, unknown>>(deps, '/runs', { method: 'POST', body: submission });
  if (!answer.ok) return answer;

  const run = answer.value.run as Record<string, unknown> | undefined;
  const hints = answer.value.hints as Record<string, unknown> | undefined;
  const board = answer.value.board as Record<string, unknown> | undefined;
  // THE SCORE AND THE BALANCE ARE WHAT MUST BE THERE. A response without them is not a run this app can show or
  // credit against, so it is refused rather than half-adopted — the caller keeps its own record instead.
  if (typeof run?.score !== 'number' || typeof hints?.hints !== 'number' || typeof hints?.successes !== 'number') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not answer with a score and a balance' } };
  }
  const progress = answer.value.progress as { finished?: unknown } | null | undefined;
  return {
    ok: true,
    value: {
      run: {
        runId: typeof run.runId === 'string' ? run.runId : submission.runId,
        score: run.score,
        elapsedSeconds: typeof run.elapsedSeconds === 'number' ? run.elapsedSeconds : submission.elapsedSeconds,
        clamped: run.clamped === true,
        duplicate: run.duplicate === true,
        // AN OLDER SERVER THAT DOES NOT SEND THE FLAG IS TAKEN AT ITS WORD ON NOTHING: the app only uses this to say
        // "not ranked", so a missing flag must not make an unranked run read as ranked. `!== false` is the reading
        // that keeps a reply this build does not understand from printing a claim the server never made.
        ranked: run.ranked !== false,
      },
      hints: { hints: hints.hints, successes: hints.successes, granted: hints.granted === true },
      board: {
        period: typeof board?.period === 'string' ? board.period : '',
        score: typeof board?.score === 'number' ? board.score : 0,
        runs: typeof board?.runs === 'number' ? board.runs : 0,
      },
      progress: progress && typeof progress.finished === 'number' ? { finished: progress.finished } : null,
    },
  };
}

/** What the server made of one press: its own verdict, and the wrong tries it has recorded so far. */
export interface PressAnswer {
  readonly verdict: 'correct' | 'wrong';
  readonly attempts: number;
  readonly presses: number;
}

/**
 * `POST /drill/answer` — record one press, as it happens (DESIGN.md §11.1, A22).
 *
 * THE SERVER DECIDES THE VERDICT, from the puzzle it issued, and the client is told what it decided so the two can
 * disagree out loud. What the press carries is only which step and which call — never whether it was right, and
 * never when, because `attempts` is a SCORE FACTOR and a count the server did not witness is not a count.
 *
 * IT IS NOT FIRE-AND-FORGET, AND THE CALLER MUST NOT TREAT IT AS SUCH: a submission that arrives before its presses
 * were recorded is refused `no_press_log`, so the app keeps this promise and waits for it before submitting. The
 * function itself never rejects — every outcome is an `ApiResult`, like the rest of this module.
 */
export async function recordDrillAnswer(
  drillId: string,
  step: number,
  call: string,
  deps: ApiDeps = browserDeps(),
): Promise<ApiResult<PressAnswer>> {
  const answer = await apiCall<Record<string, unknown>>(deps, '/drill/answer', { method: 'POST', body: { drillId, step, call } });
  if (!answer.ok) return answer;
  const verdict = answer.value.verdict;
  if (verdict !== 'correct' && verdict !== 'wrong') {
    // A VERDICT THIS BUILD DOES NOT KNOW IS NOT A VERDICT: the caller shows feedback from it, so guessing would
    // put a word on screen the server never said.
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not answer with a verdict for that press' } };
  }
  return {
    ok: true,
    value: {
      verdict,
      attempts: typeof answer.value.attempts === 'number' ? answer.value.attempts : 0,
      presses: typeof answer.value.presses === 'number' ? answer.value.presses : 0,
    },
  };
}

/** What the server made of one reveal: the call it named for that step, and whether it was news to it. */
export interface RevealAnswer {
  /** The call the server looked up for the step. Never empty: the endpoint refuses a step the drill does not have. */
  readonly call: string;
  /** False when this step had already been recorded, which is the ordinary case for a second press. */
  readonly recorded: boolean;
}

/**
 * `POST /drill/reveal` — record that one step's answer was shown (DESIGN.md §15 Q16, §11.1 A28).
 *
 * THE EVENT IS THE FIX, NOT A FIELD ON THE SUBMISSION: "show me the answer" used to leave no trace the server could
 * see, so pressing it and then pressing the call it named earned a normal success, and ten of those minted a hint.
 * The server records this against the issued drill with its own arrival time, deduplicated by step — a second press
 * of the same button shows the same call.
 *
 * THE CALLER DOES NOT NEED THE ANSWER, and that is a fact about the two namers rather than an oversight: the app
 * already knows which call it replayed (it drew it from the same puzzle the server re-derives from the same seed), so
 * this is the server's own record of the fact and not a second source of the name — the difference from `spendHint`,
 * whose name the app CANNOT look up because it runs from a line only the server holds. What reads the answer is
 * `game/test/api-client-probe.mjs`, which pins the shape and the body.
 */
export async function recordDrillReveal(drillId: string, step: number, deps: ApiDeps = browserDeps()): Promise<ApiResult<RevealAnswer>> {
  const answer = await apiCall<Record<string, unknown>>(deps, '/drill/reveal', { method: 'POST', body: { drillId, step } });
  if (!answer.ok) return answer;
  const named = answer.value.call;
  if (typeof named !== 'string' || named === '') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not name the call it showed' } };
  }
  return { ok: true, value: { call: named, recorded: answer.value.recorded === true } };
}

/** What the server did about a hint: the balance it now holds, how many this challenge has spent, and the CALL. */
export interface HintSpend {
  readonly hints: { readonly hints: number; readonly successes: number };
  readonly spent: number;
  /** The call the SERVER named from the recorded line. Never null: a spend that cannot name a call is refused. */
  readonly call: string;
}

/**
 * `POST /me/hints` — spend one hint on a published challenge, as an EVENT (DESIGN.md §11.1, A23).
 *
 * THE BALANCE IS THE SERVER'S AND THE SPEND IS ITS RECORD: the run is charged 60 seconds per recorded spend, so a
 * hint the server did not record is a run it will refuse (`unrecorded_hints`) — which is why the app asks BEFORE
 * taking the hint locally and does not take it at all if this answers with a refusal.
 */
export async function spendHint(levelIndex: number, date: string, deps: ApiDeps = browserDeps()): Promise<ApiResult<HintSpend>> {
  const answer = await apiCall<Record<string, unknown>>(deps, '/me/hints', { method: 'POST', body: { levelIndex, date } });
  if (!answer.ok) return answer;
  const hints = answer.value.hints as Record<string, unknown> | undefined;
  if (typeof hints?.hints !== 'number' || typeof hints.successes !== 'number') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not answer with a hint balance' } };
  }
  // THE NAME IS THE SERVER'S (A23's naming): it looked the call up from the RECORDED line, which is the board the
  // player is actually on — the client's own look-up runs from the position it believes it is on, which can lag by a
  // move that has not landed. A body that does not name a call is refused rather than filled in here, because a
  // second name is exactly the divergence the shared look-up removes.
  const named = answer.value.call;
  if (typeof named !== 'string' || named === '') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server spent a hint without naming a call' } };
  }
  return {
    ok: true,
    value: {
      hints: { hints: hints.hints, successes: hints.successes },
      spent: typeof answer.value.spent === 'number' ? answer.value.spent : 0,
      call: named,
    },
  };
}

/** `POST /drill/advance` — mark the issued drill finished, so the next request returns the next entry. */
export async function advanceDrill(drillId: string, deps: ApiDeps = browserDeps()): Promise<ApiResult<{ regime: RegimeCounts }>> {
  const answer = await apiCall<{ regime?: { finished?: unknown; length?: unknown } }>(deps, '/drill/advance', {
    method: 'POST',
    body: { drillId },
  });
  if (!answer.ok) return answer;
  const regime = answer.value.regime ?? {};
  return {
    ok: true,
    value: {
      regime: {
        finished: typeof regime.finished === 'number' ? regime.finished : 0,
        length: typeof regime.length === 'number' ? regime.length : 0,
      },
    },
  };
}

/** One run as `POST /me/runs:bulk` takes it: the device's own record, and nothing the server could re-derive (A26). */
export interface LedgerEntry {
  readonly runId: string;
  readonly mode: 'drill' | 'daily';
  readonly levelIndex: number;
  readonly score: number;
  readonly elapsedSeconds: number;
  readonly hintsUsed: number;
  readonly calls: readonly string[];
  readonly date: string | null;
}

/**
 * One local run record as the import endpoint takes it.
 *
 * THE TWO MODES CARRY THE TRANSCRIPT UNDER DIFFERENT LOCAL NAMES AND THE WIRE HAS ONE. `store.ts`'s `RunRecord`
 * keeps a Drill's calls in `options` (one per step) and a Daily's in `moves`, because those are what the two modes
 * mean by them; the imported row has a single `calls` list (`api/src/history.ts`). The mapping is here rather than
 * in the shell because it is a rule about two shapes agreeing — which is exactly the kind of rule a probe can check
 * and `main.ts` cannot (AGENTS.md §1).
 *
 * IT CANNOT FAIL, and that is a property of the ledger rather than optimism: `sanitiseRun` drops a record whose
 * required fields are not real numbers, so every record in `save.runs` maps. A transcript that is somehow absent
 * becomes an empty list, which the endpoint tolerates and stores as history with no line — the run is still worth
 * keeping, and the alternative (refusing the whole import) would lose the runs around it.
 */
export function ledgerEntryOf(run: RunRecord): LedgerEntry {
  return {
    runId: run.runId,
    mode: run.mode,
    levelIndex: run.levelIndex,
    score: run.score,
    elapsedSeconds: run.elapsedSeconds,
    // A DRILL SPENDS NO HINTS OF ITS OWN (§10: a hint is earned on the drill line and spent on the Daily's), so the
    // spend is the Daily's field and everything else writes the zero the endpoint requires.
    hintsUsed: run.hintsUsed ?? 0,
    calls: run.mode === 'drill' ? (run.options ?? []) : (run.moves ?? []),
    date: run.day ?? null,
  };
}

/**
 * `POST /daily/move` — record one move of today's Daily (DESIGN.md §11.1, A22's Daily half).
 *
 * WHY THE CLIENT SENDS A MOVE AND NOT ITS LINE. §6 prices the line — `wasteFactor` measures the calls used against
 * the shortest — so a client that reported its own line could play a wasteful one and submit the short one. The
 * server derives the line by replaying these moves through the SAME session this app drives, so what is sent is
 * what the player did, never what it amounted to.
 *
 * AN UNDO OR A REDO CARRIES NO CALL AT ALL, rather than a null: it names nothing, and a field that is always null
 * is a field a reader has to interpret (`session.ts`'s own log makes the same distinction). The server ignores a
 * call on those two either way — this is about the request saying what it means.
 *
 * IT IS NOT FIRE-AND-FORGET, and the caller must not treat it as such: `POST /runs` cross-checks the submission's
 * line against the RECORDED one and refuses a mismatch, so the app waits for this chain before submitting (the
 * Drill's press log has exactly this contract, for exactly this reason).
 */
export async function recordDailyMove(
  levelIndex: number,
  date: string,
  move: 'add' | 'undo' | 'redo',
  call: string | null = null,
  deps: ApiDeps = browserDeps(),
): Promise<ApiResult<{ recorded: number }>> {
  const body = move === 'add' ? { levelIndex, date, move, call } : { levelIndex, date, move };
  const answer = await apiCall<{ recorded?: unknown }>(deps, '/daily/move', { method: 'POST', body });
  if (!answer.ok) return answer;
  // THE COUNT IS THE ANSWER, so a body without it is refused rather than reported as a zero — the same rule this
  // module keeps for a score, a balance and a verdict: "recorded nothing" and "did not say" must not read the same.
  if (typeof answer.value.recorded !== 'number') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not say how many moves it recorded' } };
  }
  return { ok: true, value: { recorded: answer.value.recorded } };
}

/** One rank on a board: who, their score, and how many runs earned it. */
export interface BoardEntry {
  readonly playerId: string;
  readonly score: number;
  readonly runs: number;
}

/** A board as `GET /leaderboard` answers it. */
export interface BoardView {
  readonly mode: 'drill' | 'daily';
  readonly levelIndex: number;
  readonly period: string;
  readonly entries: readonly BoardEntry[];
  /** How many rows the SERVER examined. It is not the entry count when the page or the cap is smaller. */
  readonly examined: number;
  /** True when the read hit the server's cap, so this board is a PARTIAL ranking rather than the whole one. */
  readonly truncated: boolean;
}

/**
 * `GET /leaderboard?mode&level&period` — one board (DESIGN.md §6, §11).
 *
 * THE PERIOD IS THE CALLER'S TO NAME, and it means two different things per mode: the Daily's board is one UTC day,
 * the Drill's is a SEASON (the UTC calendar month). So the caller passes the period it is asking about rather than
 * this module deriving one — a client that guessed would show a board nobody was on and call it empty.
 *
 * `truncated` IS NOT DECORATION. The server ranks the partition it could read and its sort key is the PLAYER, so a
 * board larger than the server's cap is a PARTIAL order — the screen must say so rather than present a cut-off list
 * as the standings (the endpoint's own note in DESIGN.md §11 records why the cap exists).
 */
export async function fetchLeaderboard(
  mode: 'drill' | 'daily',
  levelIndex: number,
  period: string,
  deps: ApiDeps = browserDeps(),
): Promise<ApiResult<BoardView>> {
  const answer = await apiCall<{ board?: unknown }>(deps, '/leaderboard', {
    method: 'GET',
    query: { mode, level: String(levelIndex), period },
  });
  if (!answer.ok) return answer;
  const raw = answer.value.board;
  if (typeof raw !== 'object' || raw === null) return { ok: false, failure: { code: 'bad_response', message: 'the server did not send a board' } };
  const board = raw as Record<string, unknown>;
  // THE ENTRIES ARE THE ANSWER, so a board without a list is refused rather than shown as empty — the same rule this
  // module keeps for a drill's seed, a run's score and an import's counts.
  if (!Array.isArray(board.entries) || typeof board.examined !== 'number') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not send a board this app can show' } };
  }
  const entries: BoardEntry[] = [];
  for (const item of board.entries) {
    const entry = item as Record<string, unknown>;
    if (typeof entry.playerId !== 'string' || typeof entry.score !== 'number' || typeof entry.runs !== 'number') {
      return { ok: false, failure: { code: 'bad_response', message: 'the board holds a rank this app cannot read' } };
    }
    entries.push({ playerId: entry.playerId, score: entry.score, runs: entry.runs });
  }
  return {
    ok: true,
    value: {
      mode: board.mode === 'daily' ? 'daily' : 'drill',
      levelIndex: typeof board.levelIndex === 'number' ? board.levelIndex : levelIndex,
      period: typeof board.period === 'string' ? board.period : period,
      entries,
      examined: board.examined,
      truncated: board.truncated === true,
    },
  };
}

/** What the server made of an import. */
export interface LedgerImport {
  readonly imported: number;
  readonly skipped: number;
  readonly total: number;
}

/**
 * `POST /me/runs:bulk` — hand this device's ledger over as UNRANKED HISTORY (DESIGN.md §11.1, A26).
 *
 * AN EMPTY LEDGER IS NOT SENT AT ALL. The endpoint REFUSES one (`bad_ledger`, "the ledger is empty, so there is
 * nothing to import"), and A25's refusal tally is applied at the route table — so a client that posted an empty body
 * on every first sign-in would put the COMMONEST case into the operator's signal that someone is probing the API. The
 * refusal is returned as a typed answer rather than thrown, so the caller can tell it from a real one and stay quiet.
 *
 * THE WHOLE LEDGER IS SENT EVERY TIME, and the server is what makes that safe: an imported row is written once and
 * never updated, so a second import skips what it already holds (`api/src/history.ts`, `POST /me/runs:bulk` is
 * create-only). There is deliberately no "already imported" flag on this side — a flag would be one more thing that
 * can disagree with the server, and the ledger is bounded at `MAX_SAVED_RUNS` (50) against the endpoint's
 * `MAX_IMPORTED_RUNS` (200), so one call always carries it whole.
 *
 * `imported` AND `skipped` ARE THE POINT OF THE ANSWER: they are how a first sign-in is told from a retry, which a
 * client that only knew "200" could not do.
 */
export async function importLedger(runs: readonly RunRecord[], deps: ApiDeps = browserDeps()): Promise<ApiResult<LedgerImport>> {
  if (runs.length === 0) {
    return { ok: false, failure: { code: 'nothing_to_import', message: 'there is nothing on this device to import' } };
  }
  const answer = await apiCall<{ imported?: unknown; skipped?: unknown; total?: unknown }>(deps, '/me/runs:bulk', {
    method: 'POST',
    body: { runs: runs.map(ledgerEntryOf) },
  });
  if (!answer.ok) return answer;
  const { imported, skipped, total } = answer.value;
  // THE COUNTS ARE THE WHOLE ANSWER, so a body without them is refused rather than read as a zero — the same rule
  // the rest of this module keeps for a score, a balance and a verdict: "nothing was imported" and "the server did
  // not say" must never read the same.
  if (typeof imported !== 'number' || typeof skipped !== 'number' || typeof total !== 'number') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not say what it imported' } };
  }
  return { ok: true, value: { imported, skipped, total } };
}
