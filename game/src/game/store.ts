// The saved game: one versioned record in local storage, and the rules for reading one back.
//
// WHY THIS IS A MODULE AND NOT A FEW `localStorage` CALLS IN THE SHELL. What is stored is the RUN IN FLIGHT and the
// level it is on — the drill that was ISSUED, the step reached, the tries taken, the Daily's own attempt, and the clock
// each of them has run. Every one of those is a rule (what survives a version change, what survives a pool change, what
// a hand-edited record is allowed to say), and a rule buried in `main.ts` cannot be probed. Everything here is pure over
// an injected `StorageLike`, so `game/test/save-probe.mjs` drives it with a fake, a corrupt record and a store that
// throws.
//
// TEMPORARY DATA ONLY, AND THAT IS THE RULE THIS FILE NOW OWNS. REPORTED: "temporary data only on the client." and
// "There seems to be a lot of data on the client that can be used to cheat the scoring system. This should be removed."
// So the record holds NOTHING the server ranks: no score (rule 3), no hint balance (`hints` is gone — REPORTED "The hint
// bank should be stored on the server, not locally", and a signed-out page went on drawing the last player's balance),
// and no finished/passed sets (they mirrored the server's Progress row, and they are the shell's in-memory grid state
// now, `save-state.ts`). What is left is what a resume needs, and a resume is a convenience the server re-measures: the
// score comes from its clock and its press log, never from this file.
//
// FOUR RULES, AND THE REASON FOR EACH:
//
//   1. A SCHEMA CHANGE DISCARDS EVERYTHING; A POOL CHANGE KEEPS THE LEVEL AND NOTHING ELSE. A record written by an
//      older build may not mean what this build means by the same field, so it is not guessed at. A record whose
//      `poolVersion` has moved is different: its seeds are meaningless against the corpus that replaced it, so the run
//      in flight goes and only the level (which is not puzzle data) survives.
//   2. WHAT IS READ BACK IS CLAMPED, NEVER TRUSTED. `localStorage` is a text file the player can edit (and a
//      browser extension can rewrite), so every number is range checked and a record that is not even the right shape
//      is dropped. A loader that threw on a corrupt byte would turn a typo into an unplayable game.
//   3. THERE IS NO LOCAL SCORE AND NO LOCAL BALANCE. The run ledger (`runs`) and the hint balance (`hints`) were
//      removed: the server is the one point of truth for both (REPORTED: header 726 beside a leaderboard 1818, and the
//      logged-out hint bank showing a signed-in player's hints). AN OLDER RECORD'S `runs` AND `hints` FIELDS ARE
//      IGNORED, not migrated: those records were already claimed or already lost, and a score or a hint must never be
//      resurrected from this file.
//   4. A STORE THAT REFUSES IS NOT A BROKEN APP. Private mode and a blocked origin both throw on write; the
//      game plays on, `saving` is false, and the screen says so. `poc/src/data.ts` already does this, and the
//      reason is the same: the storage is a convenience, and the game is the product.

import { HINT_CAP, SAVE_KEY } from '../puzzle/config.ts';
import type { DailyOutcome } from './daily-run.ts';

/** The schema version written into every record. Bump it whenever a field changes meaning or shape. */
export const SAVE_VERSION = 1;

/**
 * The subset of the Storage interface this module needs — so a probe can pass anything.
 *
 * `removeItem` IS HERE FOR ONE CONTROL: "start over on this device" (DESIGN.md §15 Q18) is the only thing in this
 * app that deletes rather than overwrites, and a reset is the one operation that cannot be expressed as a write.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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
  /**
   * The DEVICE's `Date.now()` at the moment this drill's clock started — not the server's issue stamp.
   *
   * IT MUST BE A DEVICE READING, because the elapsed it becomes is subtracted from another device reading. REPORTED
   * from a second device: "the run claims 50.4s and the drill was issued 13.3 seconds ago", where 50.4 − 13.3 ≈ the
   * device's clock offset from the server's; the two clocks were being subtracted from each other. `clock.ts`'s
   * `drillClockOrigin` is the rule, and it only carries this origin forward while the SERVER's stamp is unchanged.
   */
  startedAtMs: number;
  /**
   * The SERVER's issue stamp this clock belongs to, or 0 for the offline fixture.
   *
   * IT IS WHAT MAKES A CARRY SAFE. The stamp is the server's own and it moves when the server re-issues a position
   * (a restarted store, a replay), so a stored origin whose stamp no longer matches is a clock for a different
   * issuance and must not be continued — which is the 421 s refusal DESIGN.md §15 records, in the other direction.
   * ABSENT IN AN OLDER RECORD, which reads as 0 and therefore only carries offline drills.
   */
  issuedAtMs?: number;
  /** Answers that were not correct, so a reload does not forgive them. */
  attempts: number;
  /** The step the player had reached; they answer that one again, because it was not answered. */
  index: number;
  /** The calls chosen so far, in step order. */
  options: string[];
  /**
   * The steps whose answer was SHOWN to the player (DESIGN.md §15 Q16, A28).
   *
   * IT IS PERSISTED FOR THE SAME REASON `attempts` IS, in the other direction: a run that counts for nothing must
   * not become a ranked one because the page was reloaded, which would make a refresh a way to launder a shown
   * answer into a hint. The server keeps its own record of the reveal (`POST /drill/reveal`), so this is the
   * OFFLINE ledger's copy and the fallback when a submission fails.
   */
  revealed: number[];
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


/** The whole saved game. */
export interface SavedGame {
  version: number;
  poolVersion: string;
  levelIndex: number;
  /** The ISSUED-drill id (DESIGN.md 8: a drill is locked when it is issued). */
  drillPosition: number;
  drillRun: DrillSaved | null;
  daily: DailySaved | null;
  /** The wall-clock stamp of this write, for the resume gap only. */
  savedAtMs: number;
}

/** What a load produced: the state (or null), whether writing works at all, and how many records were unusable. */
interface LoadResult {
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
    drillRun: null,
    daily: null,
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
 * Forget this device's game, and say whether the storage let it go (DESIGN.md §15 Q18).
 *
 * THIS IS THE WHOLE OF "START OVER ON THIS DEVICE", because the one record holds the regime, the HINT BALANCE and
 * every run — so removing it IS the reset rather than a part of one. A reset that kept the balance would not be a
 * reset at all, which is the design's own wording for the tradeoff it left to be decided.
 *
 * IT RETURNS FALSE WHEN THE STORAGE REFUSES, and the caller must show that rather than a fresh board the player has
 * not got: a blocked origin throws on `removeItem` exactly as it does on `setItem`, and a reset the device did not
 * perform is the one kind of silence this app must not produce (AGENTS.md §4.1).
 *
 * IT CLEARS ONE KEY AND ONLY ONE, and the two it leaves are deliberate. The signed-in SESSION is `net/session.ts`'s
 * item and signing out is its own control with its own sentence; the DEVICE ID (`net/api.ts`) is not the player's
 * data — it is what lets an anonymous regime be resumed — and clearing it would change who the server believes is
 * asking without forgetting anything about the player.
 */
export function clearGame(storage: StorageLike): boolean {
  try {
    storage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the state, or decide there is nothing usable.
 *
 * THE ORDER OF THE CHECKS IS THE RULE: parse, then the schema version (a whole-record decision), then the
 * pool version (which keeps the level and drops the run), then the fields, each clamped or dropped on its own.
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

  // THE REMOVED FIELDS ARE IGNORED, NOT MIGRATED. A record written before this build carries `runs`, `hints`, `finished`
  // and `passed`; the first two were the server's numbers and the last two are the shell's in-memory grid state now (see
  // rules 3 in the header and `save-state.ts`). They are not counted as `dropped`: a removed feature is not corruption,
  // and the fields are simply not read.
  const dropped = 0;

  // THE POOL SPLIT. A record from another pool keeps the LEVEL and nothing else — its seeds are meaningless against the
  // corpus that replaced it — and it says so by the shape of what it returns rather than by a flag.
  const samePool = record['poolVersion'] === currentPoolVersion;
  const levelIndex = intOr(record['levelIndex'], 1, 1);
  if (!samePool) {
    return {
      state: emptySave(currentPoolVersion, levelIndex, intOr(record['savedAtMs'], 0, 0)),
      saving: true,
      dropped,
    };
  }

  return {
    state: {
      version: SAVE_VERSION,
      poolVersion: currentPoolVersion,
      levelIndex,
      drillPosition: intOr(record['drillPosition'], 0, 0),
      drillRun: sanitiseDrill(record['drillRun']),
      daily: sanitiseDaily(record['daily']),
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

/** A list of whole numbers at or above zero — a hand-edited number cannot invent a step that was revealed. */
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
    // AN ABSENT STAMP READS AS 0 (the offline fixture's), which is what an older record wrote nothing for: it carries
    // an offline drill and starts a fresh clock for a server one, which is the safe direction.
    issuedAtMs: intOr(r['issuedAtMs'], 0, 0),
    attempts: intOr(r['attempts'], 0, 0),
    index: intOr(r['index'], 0, 0),
    options,
    // AN ABSENT FIELD IS AN EMPTY LIST, which is the reading a record written before reveals existed needs: those
    // runs were never shown an answer, so "none" is the truth about them rather than a missing fact.
    revealed: intList(r['revealed']),
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
