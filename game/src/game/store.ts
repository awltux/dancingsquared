// The saved game: one versioned record in local storage, and the rules for reading one back.
//
// WHY THIS IS A MODULE AND NOT A FEW `localStorage` CALLS IN THE SHELL. What is stored is the anonymous
// player's whole position in the game (DESIGN.md 13's Phase 4): the drill they were ISSUED, the level they
// are on, the hint balance and its earning progress, the Daily attempt in flight, and every completed run
// with the client-generated `runId` that Phase 5's claim is idempotent on. Each of those is a rule — what
// survives a version change, what survives a pool change, what a hand-edited record is allowed to say — and
// a rule buried in `main.ts` cannot be probed. Everything here is pure over an injected `StorageLike`, so
// `game/test/save-probe.mjs` drives it with a fake, a corrupt record and a store that throws.
//
// FOUR RULES, AND THE REASON FOR EACH:
//
//   1. A SCHEMA CHANGE DISCARDS EVERYTHING; A POOL CHANGE KEEPS THE HINTS. A record written by an older
//      build may not mean what this build means by the same field, so it is not guessed at. A record whose
//      `poolVersion` has moved is different: its seeds and its runs are meaningless against the corpus that
//      replaced it, but a hint is EARNED EFFORT rather than puzzle data, and DESIGN.md 15 Q4 says a season
//      boundary must not reset a balance — so the balance survives the pool and the rest does not.
//   2. WHAT IS READ BACK IS CLAMPED, NEVER TRUSTED. `localStorage` is a text file the player can edit (and a
//      browser extension can rewrite), so the ledger goes through `sanitiseLedger`, every number is range
//      checked, and a record that is not even the right shape is dropped. A loader that threw on a corrupt
//      byte would turn a typo into an unplayable game.
//   3. THE RUN LEDGER IS A QUEUE, DEDUPED ON `runId`. It is what Phase 5 submits, so the same id must not
//      count twice (its `POST /me/runs:bulk` is idempotent on exactly that key) and the OLDEST are dropped
//      when it is full — a best-of would keep nothing that is still unclaimed.
//   4. A STORE THAT REFUSES IS NOT A BROKEN APP. Private mode and a blocked origin both throw on write; the
//      game plays on, `saving` is false, and the screen says so. `poc/src/data.ts` already does this, and the
//      reason is the same: the storage is a convenience, and the game is the product.

import { HINT_CAP, MAX_SAVED_RUNS, SAVE_KEY } from '../puzzle/config.ts';
import type { DailyOutcome } from './daily-run.ts';
import { sanitiseLedger, type HintLedger } from '../puzzle/hints.ts';

/** The schema version written into every record. Bump it whenever a field changes meaning or shape. */
export const SAVE_VERSION = 1;

/** The subset of the Storage interface this module needs — so a probe can pass anything. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** An issued-but-unfinished drill: the clock that has run, the step reached, and the wrong tries taken. */
export interface DrillSaved {
  /**
   * The id of the run this drill will be recorded as.
   *
   * IT IS PART OF THE RUN'S IDENTITY, so it is persisted WITH the run rather than generated again on reload:
   * Phase 5's claim is idempotent on this key, and a fresh id after a resume would be a second claim of the
   * same run.
   */
  runId: string;
  /** Wall-clock stamp of the moment the drill was issued, so a reload does not hand out a fresh clock. */
  startedAtMs: number;
  /** Answers that were not correct, so a reload does not forgive them. */
  attempts: number;
  /** The step the player had reached; they answer that one again, because it was not answered. */
  index: number;
  /** The calls chosen so far, in step order. */
  options: string[];
}

/** The Daily attempt: solved, given up, or still being played. */
export interface DailySaved {
  /** The id this run will be recorded as — see `DrillSaved.runId`, and the same reason. */
  runId: string;
  day: string;
  levelIndex: number;
  moves: string[];
  hintsUsed: number;
  /** The call the last hint named, while it was still valid from the board the player stood on. */
  hintedCall: string | null;
  /** The RUN's clock, never the hint-charged total: the charge is re-derived from `hintsUsed`. */
  elapsedMs: number;
  outcome: DailyOutcome;
  /** When this was written, so a resume can add the time the page was not open. */
  savedAtMs: number;
}


/**
 * One completed run — the payload Phase 5 submits, minus everything the server re-derives.
 *
 * IT CARRIES BOTH MODES' FIELDS because the ledger is one queue: a Drill run names the issued drill and the
 * calls chosen (`options`, one per step — DESIGN.md 11 says "the chosen option", which was written when a
 * drill was one question), and a Daily run names the day and the move list it was played with.
 */
export interface RunRecord {
  runId: string;
  mode: 'drill' | 'daily';
  levelIndex: number;
  poolVersion: string;
  seed: number;
  position?: number;
  options?: string[];
  day?: string;
  moves?: string[];
  hintsUsed?: number;
  elapsedSeconds: number;
  attempts: number;
  score: number;
  /** Which weights computed `score` — see `SCORE_VERSION`. */
  scoreVersion: number;
  recordedAtMs: number;
}

/** The whole saved game. */
export interface SavedGame {
  version: number;
  poolVersion: string;
  levelIndex: number;
  /** The ISSUED-drill id (DESIGN.md 8: a drill is locked when it is issued). */
  drillPosition: number;
  /**
   * The drill positions whose success has ALREADY been counted.
   *
   * WHY THIS IS PERSISTED. DESIGN.md 11's Progress row keeps "the set of finished ones", and DESIGN.md 10
   * counts only RANKED Drill answers towards a hint. Without the set, a player could re-solve a drill they had
   * already finished — by pressing Next and coming back, or simply by reloading, which re-issues the entry —
   * and mint a hint every time. The board could not be farmed (§6 takes the player's best) but the BALANCE
   * could, and a hint is a currency.
   */
  finished: number[];
  drillRun: DrillSaved | null;
  daily: DailySaved | null;
  hints: HintLedger;
  runs: RunRecord[];
  /** The wall-clock stamp of this write, for the resume gap only. */
  savedAtMs: number;
}

/** What a load produced: the state (or null), whether writing works at all, and how many records were unusable. */
export interface LoadResult {
  state: SavedGame | null;
  /** False when the storage refused — private mode, a blocked origin. The screen says so. */
  saving: boolean;
  /** Records dropped for being the wrong shape. Reported rather than swallowed: a silent zero is a bug. */
  dropped: number;
}

/** A fresh save for a new player at `levelIndex`. */
export function emptySave(poolVersion: string, levelIndex: number, nowMs: number): SavedGame {
  return {
    version: SAVE_VERSION,
    poolVersion,
    levelIndex,
    drillPosition: 0,
    finished: [],
    drillRun: null,
    daily: null,
    hints: { hints: 0, successes: 0 },
    runs: [],
    savedAtMs: nowMs,
  };
}

/**
 * How much longer a run's clock has been running than the record says.
 *
 * THE GAP IS ADDED, NOT IGNORED, and that is the whole anti-pause rule: a reload that resumed a run at its
 * saved elapsed would be a free break in the middle of a timed puzzle, and it costs nothing to charge the
 * time the page was closed. A NEGATIVE GAP IS ZERO, because a clock that moved backwards (a system clock
 * correction) must not hand time back.
 */
export function wallGapMs(savedAtMs: number, wallNowMs: number): number {
  const gap = wallNowMs - savedAtMs;
  return Number.isFinite(gap) && gap > 0 ? gap : 0;
}

/**
 * A new id for a run, which Phase 5's claim is idempotent on.
 *
 * `crypto.randomUUID` IS NOT AVAILABLE EVERYWHERE — a non-secure origin has no `randomUUID` at all — so the
 * fallback is stamped and random. It never needs to be unguessable (it keys the player's own claim, not
 * anyone else's), but it does need to be UNIQUE, and the millisecond plus a counter is not enough on its own:
 * THE COUNTER RESTARTS AT ZERO ON EVERY RELOAD, so two runs recorded in the same millisecond either side of
 * one would collide — and `recordRun` DEDUPES on this id, so the second run would be dropped without a word.
 * MEASURED by `game/test/save-probe.mjs`, which loads this module TWICE as separate instances (what a reload
 * is for a module) with `crypto` removed: without the random part, both loads hand back the same two ids, so a
 * four-id sample holds two distinct values.
 */
let fallbackCounter = 0;
export function newRunId(nowMs: number): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  fallbackCounter += 1;
  const entropy = Math.floor(Math.random() * 0x1000000).toString(36);
  return `r${Math.floor(nowMs).toString(36)}-${fallbackCounter.toString(36)}-${entropy}`;
}

/**
 * The best score among the runs this build's weights scored.
 *
 * THE VERSION IS THE POINT: DESIGN.md 6 says the weights are proposed and will be recalibrated, so a run
 * scored with the old ones is not comparable with one scored with the new. The old runs stay in the ledger
 * (they are the player's history and Phase 5 may still claim them); they just do not win a comparison.
 */
export function bestScore(runs: readonly RunRecord[], scoreVersion: number): number | null {
  let best: number | null = null;
  for (const run of runs) {
    if (run.scoreVersion !== scoreVersion) continue;
    if (best === null || run.score > best) best = run.score;
  }
  return best;
}

/**
 * Append a completed run.
 *
 * DEDUPED ON `runId` FIRST: the same run recorded twice — a double submit, a resumed page, a bug — must not
 * be two entries, because two entries would be two claims later.
 */
export function recordRun(state: SavedGame, run: RunRecord): SavedGame {
  const kept = state.runs.filter((r) => r.runId !== run.runId);
  // THE NEWEST `MAX_SAVED_RUNS` ARE KEPT, and the array stays in record order so the claim is a queue.
  const runs = [...kept, run].slice(-MAX_SAVED_RUNS);
  return { ...state, runs };
}

/** Write the state. Returns whether it was written; NEVER throws. */
export function saveGame(storage: StorageLike, state: SavedGame): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the state, or decide there is nothing usable.
 *
 * THE ORDER OF THE CHECKS IS THE RULE: parse, then the schema version (a whole-record decision), then the
 * pool version (which keeps the hints), then the fields, each clamped or dropped on its own.
 */
export function loadGame(storage: StorageLike, currentPoolVersion: string): LoadResult {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    // A storage that refuses to be READ is treated as one that refuses to be written: the game plays on and
    // the screen does not claim anything is saved.
    return { state: null, saving: false, dropped: 0 };
  }
  if (raw === null) return { state: null, saving: true, dropped: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: null, saving: true, dropped: 0 };
  }
  if (typeof parsed !== 'object' || parsed === null) return { state: null, saving: true, dropped: 0 };
  const record = parsed as Record<string, unknown>;
  if (record['version'] !== SAVE_VERSION) return { state: null, saving: true, dropped: 0 };

  let dropped = 0;
  const runs: RunRecord[] = [];
  const rawRuns = Array.isArray(record['runs']) ? record['runs'] : [];
  for (const candidate of rawRuns) {
    const run = sanitiseRun(candidate);
    if (run) runs.push(run);
    else dropped++;
  }

  // THE POOL SPLIT. A record from another pool keeps its hints and nothing else, and it says so by the
  // shape of what it returns rather than by a flag: the caller gets a fresh progression at the same level.
  const samePool = record['poolVersion'] === currentPoolVersion;
  const levelIndex = intOr(record['levelIndex'], 1, 1);
  if (!samePool) {
    return {
      state: {
        ...emptySave(currentPoolVersion, levelIndex, intOr(record['savedAtMs'], 0, 0)),
        hints: sanitiseLedger(record['hints']),
      },
      saving: true,
      dropped: dropped + runs.length,
    };
  }

  return {
    state: {
      version: SAVE_VERSION,
      poolVersion: currentPoolVersion,
      levelIndex,
      drillPosition: intOr(record['drillPosition'], 0, 0),
      finished: intList(record['finished']),
      drillRun: sanitiseDrill(record['drillRun']),
      daily: sanitiseDaily(record['daily']),
      hints: sanitiseLedger(record['hints']),
      runs,
      savedAtMs: intOr(record['savedAtMs'], 0, 0),
    },
    saving: true,
    dropped,
  };
}

/** A finite integer at least `min`, or `fallback`. */
function intOr(value: unknown, min: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const whole = Math.floor(value);
  return whole < min ? fallback : whole;
}

/** A list of positions, clamped to whole numbers at or above zero — a hand-edited set cannot invent a level. */
function intList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) out.push(Math.floor(item));
  }
  return out;
}

/** A string array, or null when any element is not a string. */
function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

function sanitiseDrill(raw: unknown): DrillSaved | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const options = stringList(r['options']);
  const runId = r['runId'];
  if (options === null || typeof runId !== 'string' || runId.length === 0) return null;
  return {
    runId,
    startedAtMs: intOr(r['startedAtMs'], 0, 0),
    attempts: intOr(r['attempts'], 0, 0),
    index: intOr(r['index'], 0, 0),
    options,
  };
}

function sanitiseDaily(raw: unknown): DailySaved | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const moves = stringList(r['moves']);
  const outcome = r['outcome'];
  const runId = r['runId'];
  if (moves === null || typeof runId !== 'string' || runId.length === 0) return null;
  if (outcome !== 'playing' && outcome !== 'solved' && outcome !== 'given-up') return null;
  if (typeof r['day'] !== 'string' || r['day'].length === 0) return null;
  const hinted = r['hintedCall'];
  return {
    runId,
    day: r['day'],
    levelIndex: intOr(r['levelIndex'], 1, 1),
    moves,
    // A RUN CANNOT HAVE SPENT MORE HINTS THAN THE BALANCE CAN HOLD. `HINT_CAP` is the most a player can be
    // holding (DESIGN.md 10), so a record claiming more is hand-edited — and the charge is folded into the
    // elapsed time, which means an unbounded `hintsUsed` is an unbounded score for a run nobody played.
    hintsUsed: Math.min(HINT_CAP, intOr(r['hintsUsed'], 0, 0)),
    hintedCall: typeof hinted === 'string' ? hinted : null,
    elapsedMs: intOr(r['elapsedMs'], 0, 0),
    outcome,
    savedAtMs: intOr(r['savedAtMs'], 0, 0),
  };
}

/**
 * One run record, or null when it cannot be one.
 *
 * A RUN IS ALL OR NOTHING, unlike the envelope's fields: half a run is a claim that would submit wrong
 * numbers, so a single bad field drops the record and the loader counts it.
 */
function sanitiseRun(raw: unknown): RunRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const mode = r['mode'];
  if (mode !== 'drill' && mode !== 'daily') return null;
  if (typeof r['runId'] !== 'string' || r['runId'].length === 0) return null;
  if (typeof r['poolVersion'] !== 'string' || r['poolVersion'].length === 0) return null;
  if (typeof r['seed'] !== 'number' || !Number.isFinite(r['seed'])) return null;
  if (typeof r['elapsedSeconds'] !== 'number' || !Number.isFinite(r['elapsedSeconds']) || r['elapsedSeconds'] < 0) return null;
  if (typeof r['score'] !== 'number' || !Number.isFinite(r['score']) || r['score'] < 0) return null;
  if (typeof r['scoreVersion'] !== 'number' || !Number.isFinite(r['scoreVersion'])) return null;

  const run: RunRecord = {
    runId: r['runId'],
    mode,
    levelIndex: intOr(r['levelIndex'], 1, 1),
    poolVersion: r['poolVersion'],
    seed: Math.floor(r['seed']),
    elapsedSeconds: r['elapsedSeconds'],
    attempts: intOr(r['attempts'], 0, 0),
    score: r['score'],
    scoreVersion: Math.floor(r['scoreVersion']),
    recordedAtMs: intOr(r['recordedAtMs'], 0, 0),
  };
  if (mode === 'drill') {
    const options = stringList(r['options']);
    if (options === null) return null;
    run.position = intOr(r['position'], 0, 0);
    run.options = options;
  } else {
    const moves = stringList(r['moves']);
    if (moves === null || typeof r['day'] !== 'string') return null;
    run.day = r['day'];
    run.moves = moves;
    run.hintsUsed = intOr(r['hintsUsed'], 0, 0);
  }
  return run;
}
