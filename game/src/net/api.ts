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
import { newRunId } from '../game/store.ts';
import { accessTokenOf, type SessionStore } from './session.ts';
import { cognitoConfigFrom, type CognitoConfig } from './cognito.ts';
// A TYPE-ONLY IMPORT, so there is no runtime cycle: `auth.ts` calls this module's `apiCall`, and this module needs
// only the NAME of the mode it discovers.
import type { AuthMode } from './auth.ts';
// THE PUZZLE'S OWN SHAPE CHECK, imported rather than restated: `GET /drill/current` and `GET /puzzle` carry a
// generated puzzle now (DESIGN.md §9), and `parsePuzzle` is the one rule for whether one arrived.
import { parsePuzzle, parseReadings } from '../puzzle/parse.ts';
import { HINT_CAP, HINT_SUCCESS_STEP } from '../puzzle/config.ts';
import type { HintLedger } from '../puzzle/hints.ts';
import type { MoveReading, Puzzle } from '../puzzle/types.ts';

/** A refusal as the API writes it: a code for a program and a sentence for a person. */
interface ApiFailure {
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
  /**
   * The PUBLISHED SET this drill was issued from — the Drill board's identity (DESIGN.md §15 Q17(vii)).
   *
   * `null` WHEN THE SERVER DID NOT SEND ONE, and the client must not invent it: the board panel asks the server
   * for a board by period, so a client that guessed a period would show a board nobody is on. Play does not need
   * it at all, which is why it is tolerated as missing rather than making the whole drill unusable.
   */
  readonly scheduleVersion: string | null;
  readonly issuedAtMs: number;
  /**
   * THE PUZZLE ITSELF — every board, every option and the answer key — and it is REQUIRED.
   *
   * It was optional for exactly one commit, while the client could still generate from the seed. That fallback is
   * gone (the fixture season is baked, `game/src/game/season-data.ts`), so a drill without boards is a payload this
   * app cannot draw at all: absent and malformed are now the same refusal, which is simpler than a branch nothing
   * can reach.
   */
  readonly puzzle: Puzzle;
  readonly resumed: boolean;
  /**
   * THIS ISSUE IS A REATTEMPT of a position the player already closed, not the next one in the order.
   *
   * THE CLIENT READS IT FOR ONE DECISION: whether the drill on screen is the level's progress or a revisit of a
   * skipped one — which is what decides if "Next drill" means "resume the order" or "back to the block". The server
   * owns the rule (`drill-regime.ts`'s `replayDrill`); a client that defaulted it to `true` would show a revisit for
   * every ordinary drill, so it is read as exactly `true` and nothing else.
   */
  readonly replay: boolean;
}

/**
 * THE PLAYER'S OWN CUMULATIVE DRILL BOARD, as a drill read reports it.
 *
 * IT IS THE HEADER'S RUNNING TOTAL: the server's ranked score for this level and set, which is the same number the
 * post-run note prints and the board page ranks. The device's own sum of solved drills is the OFFLINE FALLBACK only —
 * it includes demo and practice runs the server never saw, so showing it beside the server's number was the confusion
 * REPORTED as "The scoring system seems a little confused".
 *
 * `null` IS "THIS READ CANNOT SAY" — a server too old to send it, a demo with no player, or an unreadable row — and the
 * shell then falls back to the device total. It is not zero: a zero is a real answer (no ranked runs on this set).
 */
export interface DrillBoardTotal {
  readonly score: number;
  readonly runs: number;
}

/** The board total a drill answer carried, or null when the answer did not carry a usable one. */
function asDrillBoard(raw: unknown): DrillBoardTotal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0) return null;
  if (typeof value.runs !== 'number' || !Number.isFinite(value.runs) || value.runs < 0) return null;
  return { score: value.score, runs: value.runs };
}

/**
 * The hint balance a profile answer carried, or null when it carried none this app can read.
 *
 * IT IS CHECKED AGAINST THE RULES THE BALANCE LIVES INSIDE (`HINT_CAP` held, one below `HINT_SUCCESS_STEP` counted),
 * because a number outside them is not a balance this screen can draw: a `hints: 99` would light a button the server
 * refuses, and a `successes: 40` would print progress that has already paid out. A server that sends one is answered as
 * "no news" rather than clamped, since clamping would show the player a balance the server never stated.
 */
function asHintLedger(raw: unknown): HintLedger | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const ok = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
  if (!ok(value['hints'], HINT_CAP) || !ok(value['successes'], HINT_SUCCESS_STEP - 1)) return null;
  return { hints: value['hints'], successes: value['successes'] };
}

/**
 * Where the player is in the regime: WHICH positions are done, which were PASSED, and how many the level holds.
 *
 * IT WAS A PAIR OF COUNTS, and the sets replaced them because the level grid draws one cell per position and a
 * count can only fill the first N cells — which assumes progress is a prefix, and `drill-regime.ts` records that a
 * hand-edited row or a republished schedule can produce a gap. The header's count is `.finished.length`.
 */
export interface RegimeState {
  readonly finished: readonly number[];
  readonly passed: readonly number[];
  readonly length: number;
}

/** An array of numbers a server sent, read defensively: a build that does not send one is a build with no cells. */
function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => typeof n === 'number') : [];
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
  /**
   * The user pool this build talks to (`VITE_COGNITO_REGION` + `VITE_COGNITO_CLIENT_ID`), or undefined for the local API.
   *
   * A CONFIGURED POOL IS A PROVIDER, not merely an endpoint: `net/auth.ts` sends its six account operations to the pool when
   * this is set, and to this API's `/auth/*` routes when it is not. Present here for the same reason `modeOverride` is — a
   * probe hands one over instead of trying to set the environment.
   */
  readonly cognito?: CognitoConfig;
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
function apiBase(): string {
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
  const cognito = cognitoConfigFrom(import.meta.env ?? {});
  return {
    base: apiBase(),
    fetch: globalThis.fetch.bind(globalThis),
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
    ...(typeof mode === 'string' && mode !== '' ? { modeOverride: mode } : {}),
    ...(cognito ? { cognito } : {}),
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
  options: { readonly anonymous?: boolean; readonly timeoutMs?: number } = {},
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
      // THE CALLER MAY WIDEN THE WINDOW, and one does: creating a Daily costs seconds on the server (see
      // `DAILY_TIMEOUT_MS`), which the default handshake-sized timeout cannot cover. Narrowing is never allowed —
      // a per-call override is for a request that is legitimately slower than the rest, not for impatience.
      signal: AbortSignal.timeout(options.timeoutMs === undefined ? deps.timeoutMs : Math.max(options.timeoutMs, deps.timeoutMs)),
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
  // THE PUZZLE IS PART OF THE DRILL'S SHAPE, not an optional extra: the client generates nothing, so a payload
  // without boards is one it cannot draw. Malformed and missing are the same refusal (see `puzzle/parse.ts` on why a
  // half-parsed puzzle is worse than none).
  const puzzle = parsePuzzle(value.puzzle);
  if (puzzle === null) return null;
  return {
    id: value.id,
    index: value.index,
    levelIndex: value.levelIndex,
    seed: value.seed,
    poolVersion: typeof value.poolVersion === 'string' ? value.poolVersion : '',
    // TOLERATED AS MISSING: it is the BOARD's identity and not the puzzle's, so a server that does not send it makes
    // the board panel say it cannot show one rather than making the drill unplayable.
    scheduleVersion: typeof value.scheduleVersion === 'string' ? value.scheduleVersion : null,
    issuedAtMs: typeof value.issuedAtMs === 'number' ? value.issuedAtMs : Date.now(),
    puzzle,
    resumed: value.resumed === true,
    replay: value.replay === true,
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
export async function issueDrill(level: number, deps: ApiDeps = browserDeps()): Promise<ApiResult<{ drill: IssuedDrill; regime: RegimeState; demo: boolean; board: DrillBoardTotal | null }>> {
  const answer = await apiCall<{ drill?: unknown; regime?: { finished?: unknown; length?: unknown }; demo?: unknown; board?: unknown }>(deps, '/drill/current', {
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
  // The three fields the grid and the header read, each read defensively: a build that sends none of them is a
  // build with no cells rather than a reason to refuse the answer.
  const regime = (answer.value.regime ?? {}) as { finished?: unknown; passed?: unknown; length?: unknown };
  return {
    ok: true,
    value: {
      drill,
      // THE SERVER'S OWN WORD, defaulted to `false` rather than inferred: an older server that does not send the
      // flag is one this build cannot claim makes a run unranked, and the standing rule's other facts still apply.
      demo: answer.value.demo === true,
      // NULL WHEN THE ANSWER DID NOT CARRY ONE, which is the offline fallback's cue rather than an error: the drill
      // is playable without the board, and the header has a device total to show instead.
      board: asDrillBoard(answer.value.board),
      regime: {
        finished: numberList(regime.finished),
        passed: numberList(regime.passed),
        length: typeof regime.length === 'number' ? regime.length : 0,
      },
    },
  };
}

/**
 * `POST /drill/replay` — reattempt a position the player already closed without passing.
 *
 * THE ANSWER IS THE SAME SHAPE AS `issueDrill`'s, and that is deliberate rather than convenient: the drill on screen
 * is the same kind of thing either way — the position in flight, its boards and the regime around it — so the shell
 * shows one with the same code path and cannot come to render a reattempt differently from a first attempt.
 *
 * THE SERVER REFUSES THREE CASES WITH THEIR OWN CODES (`not_finished`, `already_passed`, `no_entry`), and the client
 * passes them through rather than pre-checking: the grid's own rule says which cells are offerable, but a decision
 * made from a regime the client holds is exactly the sort of second implementation this module refuses to keep. The
 * message is shown verbatim, which is why the reasons are sentences.
 */
export async function replayDrill(index: number, deps: ApiDeps = browserDeps()): Promise<ApiResult<{ drill: IssuedDrill; regime: RegimeState; board: DrillBoardTotal | null }>> {
  const answer = await apiCall<{ drill?: unknown; regime?: { finished?: unknown; passed?: unknown; length?: unknown }; board?: unknown }>(deps, '/drill/replay', {
    method: 'POST',
    body: { index },
  });
  if (!answer.ok) return answer;
  const drill = asIssuedDrill(answer.value.drill);
  if (!drill) return { ok: false, failure: { code: 'bad_response', message: 'the server did not send a drill this app can draw' } };
  const regime = answer.value.regime ?? {};
  return {
    ok: true,
    value: {
      drill,
      board: asDrillBoard(answer.value.board),
      regime: {
        finished: numberList(regime.finished),
        passed: numberList(regime.passed),
        length: typeof regime.length === 'number' ? regime.length : 0,
      },
    },
  };
}

/** A finished drill, read to WATCH back: its position, the level it belongs to, and the boards the level published. */
interface DrillToWatch {
  readonly index: number;
  readonly levelIndex: number;
  readonly seed: number;
  readonly poolVersion: string;
  /** Whether the player PASSED it — a skipped drill is watchable too, and the panel says which it was. */
  readonly passed: boolean;
  readonly puzzle: Puzzle;
}

/**
 * `GET /drill/replay?index=` — a closed position, READ rather than reopened.
 *
 * IT IS NOT `replayDrill` ABOVE, and the two answer different questions: that one reopens a skip or a reveal so the
 * player can earn the pass, and it refuses a position that was already passed ("nothing for a reattempt to earn"). A
 * completed cell still has something to show — the calls that solved it — so this endpoint writes nothing and returns
 * the published boards, which is what "allow completed levels to be replayed, not re-solved" asked for.
 *
 * THE SERVER'S REFUSALS ARE PASSED THROUGH (`not_finished`, `no_entry`, `bad_index`): the block's own rule decides
 * which cells are offerable, and a client-side copy of it would be the second implementation this module refuses.
 */
export async function fetchDrillReplay(index: number, deps: ApiDeps = browserDeps()): Promise<ApiResult<DrillToWatch>> {
  const answer = await apiCall<{ replay?: Record<string, unknown> }>(deps, `/drill/replay?index=${index}`, { method: 'GET' });
  if (!answer.ok) return answer;
  const replay = answer.value.replay;
  if (!replay) return { ok: false, failure: { code: 'bad_response', message: 'the server did not send a drill to watch back' } };
  const puzzle = parsePuzzle(replay['puzzle']);
  if (!puzzle) return { ok: false, failure: { code: 'bad_response', message: 'the drill to watch back came without boards this app can draw' } };
  if (typeof replay['index'] !== 'number' || typeof replay['levelIndex'] !== 'number' || typeof replay['seed'] !== 'number' || typeof replay['poolVersion'] !== 'string') {
    return { ok: false, failure: { code: 'bad_response', message: 'the drill to watch back is missing its position, level, seed or pool version' } };
  }
  return {
    ok: true,
    value: {
      index: replay['index'],
      levelIndex: replay['levelIndex'],
      seed: replay['seed'],
      poolVersion: replay['poolVersion'],
      passed: replay['passed'] === true,
      puzzle,
    },
  };
}

/** The published Daily challenge: a seed, the level it was validated at, whether this build can play it, and —
 * now that the client generates nothing — the puzzle that seed names. */
interface DailyChallenge {
  readonly day: string;
  readonly levelIndex: number;
  readonly seed: number;
  readonly poolVersion: string;
  readonly publishedAtMs: number | null;
  /** False when the row was published against a pool this build does not serve (DESIGN.md 7.2). */
  readonly playable: boolean;
  /** The puzzle, or null on a challenge this build cannot play (`playable: false`) or one that is malformed. */
  readonly puzzle: Puzzle | null;
  /**
   * The start board's grouped move list, when the server sent one.
   *
   * IT IS AN OPTIMISATION, NOT A CONTRACT: the client can compute the same list for the same board, so a missing or
   * malformed one costs the first render an `applicableMoves` run rather than breaking the challenge — which is why it
   * is parsed leniently and defaulted to null.
   */
  readonly readings: MoveReading[] | null;
  /**
   * WHETHER THE PUZZLE IS READY, or the server is still creating it — the flag the poll loop reads.
   *
   * THE SERVER ANSWERS `202 Accepted { ready: false }` while it generates, because generating a Daily costs 9.4-15.1 s
   * (DESIGN.md §7.1) and holding one request open for it stalled every other request behind it on a single-threaded
   * server. `puzzle` is null in that answer, and ALSO null for a challenge this build cannot play, which is why the two
   * are told apart by this flag rather than by the puzzle's absence.
   */
  readonly ready: boolean;
}

/**
/**
 * HOW LONG ONE DAILY REQUEST MAY TAKE — the shared window, deliberately. The earlier 30 s was a mistake.
 *
 * THE HISTORY IS THE SHAPE OF THE REPORT. The read used to GENERATE the challenge inside the request (9.4-15.1 s,
 * DESIGN.md §7.1), so the shared 8 s window expired before the work finished and that looked like a hang; the answer was
 * 30 s. Then the read stopped generating (202 plus a deferred generation), and the 30 s had no work left to cover — it
 * only made an UNREACHABLE server take thirty seconds to say so, which is the second report: "If there is not daily then
 * return with an error, rather than hanging." ONE POLL is now short, and a slow poll is simply retried, so nothing is
 * lost by the shorter window.
 */export const DAILY_TIMEOUT_MS = 8_000;

/**
 * `GET /puzzle?mode=daily&level&date` — the challenge for a level and a UTC day.
 *
 * THE ANSWER CARRIES THE PUZZLE, because the client no longer generates (§9's reversal): the server derives the
 * boards from the published seed and hands them over, so everyone at a level is asked the same question by
 * construction rather than by agreeing about a number. What the call still buys beyond the boards is that the seed
 * is the PUBLISHED, validated one — a day nobody published is a refusal (`no_published_daily`) instead of a question
 * nobody checked.
 */
export async function dailyChallenge(level: number, day: string, deps: ApiDeps = browserDeps()): Promise<ApiResult<DailyChallenge>> {
  const answer = await apiCall<{ daily?: unknown }>(
    deps,
    '/puzzle',
    { method: 'GET', query: { mode: 'daily', level: String(level), date: day } },
    { timeoutMs: DAILY_TIMEOUT_MS },
  );
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
      // A SERVER THAT DOES NOT SEND THE FLAG IS ASSUMED READY, which is what every build before this one meant by
      // sending a puzzle: `ready` is `true` unless the answer says otherwise.
      ready: value.ready !== false,
      puzzle: value.puzzle === undefined || value.puzzle === null ? null : parsePuzzle(value.puzzle),
      readings: value.readings === undefined || value.readings === null ? null : parseReadings(value.readings),
    },
  };
}

/**
 * TODAY'S CHALLENGE, AS A BACKGROUND POLL WITH CALLBACKS — and NOT a promise the shell waits on.
 *
 * REPORTED TWICE, and the second report is this shape's reason: *"The call to fetchDaily never returns and the UI hangs
 * on the promise … This fetchDaily should trigger a background job on the server that generates the challenge and then
 * the ui polls it intermittently."* That was exactly right about the first version. It awaited a loop, so the shell held
 * a pending promise (and a spinning button) for the WHOLE poll budget — up to a minute of "busy" for a wait whose length
 * nobody controls. The server side was already right: the read answers `202 { ready: false }` and defers the generation,
 * so the FIRST request is the trigger.
 *
 * SO THERE IS NO LONGER A LONG-LIVED PROMISE. `pollDaily` asks once, hands the answer to `onAnswer`, and RESCHEDULES
 * itself with a timer while the answer says "not ready". The caller does not await anything, the app is free between
 * ticks, and `stop()` cancels it (a level change, a mode change, a second press).
 *
 * IT STOPS ON THE FIRST ANSWER THAT IS NOT "NOT READY", and that includes a REFUSAL: a day nobody published, a pool this
 * build cannot play and an unreachable server are all final, and retrying them would spin for ever.
 *
 * THE BUDGET IS GENTLE BECAUSE THE WAIT IS FREE: `attempts × intervalMs` is how long the app keeps checking, not how long
 * a player is held. When it runs out the last answer is handed over with `gaveUp: true`, so the panel can say the server
 * did not finish rather than pretending nothing happened.
 */
interface DailyPollHandlers {
  /** A fresh answer: ready with boards, or a refusal, or another "not ready". */
  readonly onAnswer: (answer: ApiResult<DailyChallenge>, state: { readonly attempt: number; readonly gaveUp: boolean }) => void;
}

export function pollDaily(
  level: number,
  day: string,
  deps: ApiDeps,
  handlers: DailyPollHandlers,
  options: { readonly attempts?: number; readonly intervalMs?: number } = {},
): { stop: () => void } {
  const attempts = options.attempts ?? 60;
  const intervalMs = options.intervalMs ?? 800;
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    attempt++;
    const answer = await dailyChallenge(level, day, deps);
    if (stopped) return;
    // A READY ANSWER OR A REFUSAL ENDS THE POLL. `ready` is the server's own flag, so "not ready" is never inferred
    // from a missing puzzle — that is also what an unplayable challenge looks like.
    const finished = !answer.ok || answer.value.ready;
    if (finished) {
      handlers.onAnswer(answer, { attempt, gaveUp: false });
      return;
    }
    if (attempt >= attempts) {
      handlers.onAnswer(answer, { attempt, gaveUp: true });
      return;
    }
    handlers.onAnswer(answer, { attempt, gaveUp: false });
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };

  void tick();
  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
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
interface RunOutcome {
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
interface PressAnswer {
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
interface RevealAnswer {
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

/**
 * HOW LONG A HINT SPEND MAY TAKE — the one request this app waits on for a minute, and the window is the server's
 * work rather than the app's patience.
 *
 * THE WINDOW WAS SIZED BY A 79-91 s BUILD, and that build is gone. `POST /me/hints` names the call from the RECORDED
 * line (A23), which used to run `PlaySession.distanceToGoal` — a reverse BFS from the goal with `applicableMoves` at
 * every board — and MEASURED at the shipped level-1 pool that table took 79-91 s, while the shared 8 s window expired
 * on a spend the SERVER WENT ON TO COMMIT: MEASURED in the dev server's own log, one `POST /me/hints` answered **200
 * after 88 295 ms** while the browser had given up at 8 s — so the balance moved, this app never adopted it, and every
 * later press was a fast `409 no_hints` under a footer that still claimed a hint. That is the report "I earned a
 * hint, but the hint button doesn't seem to do anything".
 *
 * THE HINT FOLLOWS THE NEXT WAYPOINT NOW (a forward search that stops on the target, MEASURED 0-650 ms on a route and
 * ~1.0 s for the first press off it), so this window is a safety margin rather than the expected cost.
 *
 * THE ANSWER IS TO WAIT, NOT TO RETRY. The spend is a WRITE: a retry of a request that already landed spends a
 * second hint, so a short window is not a cheaper failure here, it is a wrong answer plus a lost balance. Twice the
 * old build leaves room for a slower machine and for the cold start that owns the same minutes.
 */
export const HINT_TIMEOUT_MS = 180_000;

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
  const answer = await apiCall<Record<string, unknown>>(deps, '/me/hints', { method: 'POST', body: { levelIndex, date } }, { timeoutMs: HINT_TIMEOUT_MS });
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
export async function advanceDrill(drillId: string, deps: ApiDeps = browserDeps()): Promise<ApiResult<{ regime: RegimeState }>> {
  const answer = await apiCall<{ regime?: { finished?: unknown; length?: unknown } }>(deps, '/drill/advance', {
    method: 'POST',
    body: { drillId },
  });
  if (!answer.ok) return answer;
  // The three fields the grid and the header read, each read defensively: a build that sends none of them is a
  // build with no cells rather than a reason to refuse the answer.
  const regime = (answer.value.regime ?? {}) as { finished?: unknown; passed?: unknown; length?: unknown };
  return {
    ok: true,
    value: {
      regime: {
        finished: numberList(regime.finished),
        passed: numberList(regime.passed),
        length: typeof regime.length === 'number' ? regime.length : 0,
      },
    },
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
interface BoardEntry {
  readonly playerId: string;
  /**
   * THE NAME A PERSON READS, or null when this player has not claimed one.
   *
   * REPORTED: "the user needs a login alias that can be displayed in the leaderboard. Dont expose the email address
   * anywhere on the UI." The server resolves it (`api/src/handlers/leaderboard.ts`), so this module never sees an
   * address and has nothing to leak; `null` is a real answer — a player with no name — and is drawn as such rather than
   * falling back to `playerId`, which is what the row used to print.
   */
  readonly alias: string | null;
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
    // A MISSING `alias` IS READ AS NULL RATHER THAN AS A BAD RESPONSE: an older server answers without the field, and
    // "this player has no name" is exactly what that means. A non-string that is not null/absent IS refused, because that
    // is a payload this build cannot read.
    if (entry.alias !== undefined && entry.alias !== null && typeof entry.alias !== 'string') {
      return { ok: false, failure: { code: 'bad_response', message: 'the board holds a name this app cannot read' } };
    }
    entries.push({ playerId: entry.playerId, alias: typeof entry.alias === 'string' ? entry.alias : null, score: entry.score, runs: entry.runs });
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

/**
 * `POST /me/runs:bulk` IS NOT CALLED BY THIS CLIENT ANY MORE. The device's run ledger was removed — the server is the one
 * point of truth for a score — so there is nothing on this side to import as history. The endpoint stays served (and
 * probed in `api/test/history-probe.mjs`) for a client that keeps a ledger of its own.
 */

/**
 * `GET /me/profile` — the alias this player has claimed, or `null`, their own ranked Drill and Daily boards, and the
 * hint balance.
 *
 * `null` IS THE ORDINARY FIRST-RUN ANSWER, not a failure: a player who has never claimed a name is asked for one, which
 * is why it is a value here rather than a `404` to read at the call site. A body this module cannot read IS refused —
 * the rule the rest of the file keeps.
 *
 * THE BOARDS AND THE BALANCE ARE THE HEADER'S NUMBERS, and they ride this read because the profile is the one
 * player-bound request every signed-in boot makes: the header is right on every page after a reload, not only after a
 * play page has issued a drill. Each is tolerated as absent (`null`), like a drill answer's board — a server older than
 * the field is no news. THE BALANCE IS SERVER-ONLY NOW (REPORTED: "When logged out, the hints bank still shows my hints,
 * it should be empty. The hint bank should be stored on the server, not locally"), so a page that has not asked the
 * server holds no hint to show.
 */
export async function fetchProfile(deps: ApiDeps = browserDeps()): Promise<ApiResult<{ alias: string | null; drillBoard: DrillBoardTotal | null; dailyBoard: DrillBoardTotal | null; hints: HintLedger | null }>> {
  const answer = await apiCall<{ alias?: unknown; drillBoard?: unknown; dailyBoard?: unknown; hints?: unknown }>(deps, '/me/profile', { method: 'GET' });
  if (!answer.ok) return answer;
  if (answer.value.alias !== undefined && answer.value.alias !== null && typeof answer.value.alias !== 'string') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server did not send a name this app can read' } };
  }
  return {
    ok: true,
    value: {
      alias: typeof answer.value.alias === 'string' ? answer.value.alias : null,
      drillBoard: asDrillBoard(answer.value.drillBoard),
      dailyBoard: asDrillBoard(answer.value.dailyBoard),
      hints: asHintLedger(answer.value.hints),
    },
  };
}

/**
 * `POST /me/alias` — claim a public name, or change the one held.
 *
 * THE SERVER RUNS THE RULE (it imports `sanitizeAlias` from this game's own barrel), so a refusal comes back as a code
 * AND a sentence: `alias_taken` is the one the app could not have predicted, because only the server knows who holds
 * what. The app sanitises first so it can answer without a request — the same rule, checked twice on purpose, with the
 * server as the authority.
 */
export async function claimAlias(alias: string, deps: ApiDeps = browserDeps()): Promise<ApiResult<{ alias: string }>> {
  const answer = await apiCall<{ alias?: unknown }>(deps, '/me/alias', { method: 'POST', body: { alias } });
  if (!answer.ok) return answer;
  if (typeof answer.value.alias !== 'string' || answer.value.alias === '') {
    return { ok: false, failure: { code: 'bad_response', message: 'the server accepted a name without saying which' } };
  }
  return { ok: true, value: { alias: answer.value.alias } };
}
