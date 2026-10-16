// The game's ONE outbound path, and it is OPT-IN.
//
// WHY THE BASE URL IS THE SWITCH. AGENTS.md 6 promises the game works offline, and the deployment story is
// "`VITE_API_BASE` unset is today's behaviour". So this module never reaches for the network unless a base is
// configured, and every function returns a TYPED RESULT rather than throwing: a refusal from the server is
// content the player has to be told (its `message` is shown as it was written), and an unreachable server is a
// state the app has to survive rather than a crash.
//
// THE IDENTITY IS AN ANONYMOUS DEVICE ID (DESIGN.md 8: "an anonymous player therefore gets an issued drill keyed
// to a device id"), minted once and kept in `localStorage`. A signed-in player's token, when there is one, takes
// precedence and rides in the `Authorization` header — which is the header API Gateway's Cognito authorizer will
// read in a deployment, where `x-dev-player` is the local dev server's own spelling of the same thing.
//
// IT TAKES ITS DEPENDENCIES AS AN ARGUMENT (`deps`), which is what lets a probe drive every refusal with a fake
// fetch and a fake storage — no browser, no server, and no way for a probe to mistake an untested path for a
// working one.
import { newRunId } from '../game/store.ts';

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
/** The key a signed-in player's token lives under, when there is one. */
const TOKEN_KEY = 'dsq.game.token';

export interface ApiDeps {
  readonly base: string;
  readonly fetch: typeof globalThis.fetch;
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
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

/** The real dependencies, from the browser. */
function browserDeps(): ApiDeps {
  return {
    base: apiBase(),
    fetch: globalThis.fetch.bind(globalThis),
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
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

/** The headers that say who is asking: a token if there is one, the device id otherwise. */
function identityHeaders(deps: ApiDeps): Record<string, string> {
  const token = deps.getItem(TOKEN_KEY);
  if (token) return { authorization: `Bearer ${token}` };
  return { 'x-dev-player': deviceId(deps) };
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

/** One call: build the URL, send it, and turn every outcome into an `ApiResult`. */
async function call<T>(deps: ApiDeps, path: string, init: { method: string; query?: Record<string, string>; body?: unknown }): Promise<ApiResult<T>> {
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
        ...identityHeaders(deps),
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
 */
export async function issueDrill(level: number, deps: ApiDeps = browserDeps()): Promise<ApiResult<{ drill: IssuedDrill; regime: RegimeCounts }>> {
  const answer = await call<{ drill?: unknown; regime?: { finished?: unknown; length?: unknown } }>(deps, '/drill/current', {
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
  const answer = await call<{ daily?: unknown }>(deps, '/puzzle', {
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
  readonly calls: readonly string[];
  /** The client's own score, which the server CLAMPS to what it can recompute. */
  readonly score: number;
}

/** What the server decided about a run — the numbers the player is actually scored and credited on. */
export interface RunOutcome {
  readonly run: { readonly runId: string; readonly score: number; readonly elapsedSeconds: number; readonly clamped: boolean; readonly duplicate: boolean };
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
  const answer = await call<Record<string, unknown>>(deps, '/runs', { method: 'POST', body: submission });
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

/** `POST /drill/advance` — mark the issued drill finished, so the next request returns the next entry. */
export async function advanceDrill(drillId: string, deps: ApiDeps = browserDeps()): Promise<ApiResult<{ regime: RegimeCounts }>> {
  const answer = await call<{ regime?: { finished?: unknown; length?: unknown } }>(deps, '/drill/advance', {
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
