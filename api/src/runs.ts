// A completed run: what the client may send, what the server refuses, and what it writes. Pure over the rows.
//
// WHY THIS IS ITS OWN MODULE, AND WHAT IT IS NOT. DESIGN.md 6 says "the server clamps every submission to the
// maximum score the server can itself recompute from (seed, level, elapsed, moves, attempts, hintsUsed)", and
// DESIGN.md 11 says the Drill's claim is re-derived rather than trusted. Both are decisions about plain data,
// so they live here — no store, no HTTP, no clock — and the handler that owns the writes (`handlers/runs.ts`)
// reads this module's answers.
//
// THE RUN'S OWN ROW IS THE IDEMPOTENCE KEY. A run is created with `expectedRev: null` inside the transaction
// that writes its effects, so a retried submission cannot land twice: the condition fails, nothing is written,
// and the handler answers from the row that is already there. That is `recordRun`'s dedupe on the client
// (`game/src/game/store.ts`) arriving at the same place from the other side.
import { HINT_CAP, scoreRun, type LevelSpec, type Puzzle, type RunScore } from 'dancing-squared-game';
import type { HintLedger } from 'dancing-squared-game';
import type { StoredItem } from './ports.ts';

/** What the client sends to `POST /runs`. Everything is `unknown` until `parseRunSubmission` has looked at it. */
export interface RunSubmission {
  readonly runId: string;
  readonly mode: 'drill' | 'daily';
  readonly levelIndex: number;
  /** The Drill's issued-drill id. Absent for the Daily. */
  readonly drillId: string | null;
  /** The Daily's UTC day, named as the design names the query parameter. Absent for the Drill. */
  readonly date: string | null;
  /** TIME ON THE CLOCK ONLY. The hint charge is added by `scoreRun`, never by the client. */
  readonly clockSeconds: number;
  readonly hintsUsed: number;
  /** Wrong answers taken. The Drill's own cost (§6); zero for the Daily, which is not scored on attempts. */
  readonly attempts: number;
  /** The Drill: one call per step, the answer the player committed. The Daily: the whole line. */
  readonly calls: readonly string[];
  /** The client's claimed score, clamped. Absent or non-numeric means "whatever you compute". */
  readonly claimedScore: number | null;
}

/** A refusal as the handlers report it: a code for a program and a sentence for a person. */
export interface RunRefusal {
  readonly code: string;
  readonly message: string;
}

/**
 * The longest a run's clock may claim, before anything else is considered.
 *
 * A DAY, WHICH IS THE DAILY'S OWN PERIOD AND A SANITY BOUND RATHER THAN A RULE: the Drill has a tighter one
 * (the wall time since it was issued, which the Progress row knows), and the Daily's start is not a fact the
 * server holds in this slice. A claim beyond this is not a slow player; it is a broken or dishonest one.
 */
export const MAX_CLOCK_SECONDS = 24 * 60 * 60;

/** The slack allowed on the Drill's clock bound, for the difference between the client's clock and the server's. */
export const CLOCK_SKEW_SECONDS = 5;

const MAX_RUN_ID_LENGTH = 128;

/** Parse and validate a submission, or say why not. NOTHING here reads the store. */
export function parseRunSubmission(body: unknown): { ok: true; submission: RunSubmission } | { ok: false; refusal: RunRefusal } {
  const bad = (code: string, message: string) => ({ ok: false as const, refusal: { code, message } });
  if (typeof body !== 'object' || body === null) return bad('bad_body', 'a run submission must be a JSON object');
  const raw = body as Record<string, unknown>;

  const runId = raw['runId'];
  if (typeof runId !== 'string' || runId.length === 0 || runId.length > MAX_RUN_ID_LENGTH) {
    return bad('bad_run_id', `runId must be a string of 1 to ${MAX_RUN_ID_LENGTH} characters`);
  }
  const mode = raw['mode'];
  if (mode !== 'drill' && mode !== 'daily') return bad('bad_mode', 'mode must be "drill" or "daily"');

  const levelIndex = raw['levelIndex'];
  if (typeof levelIndex !== 'number' || !Number.isInteger(levelIndex) || levelIndex < 1) {
    return bad('bad_level', 'levelIndex must be a positive integer');
  }
  const clockSeconds = raw['elapsedSeconds'];
  if (typeof clockSeconds !== 'number' || !Number.isFinite(clockSeconds) || clockSeconds < 0 || clockSeconds > MAX_CLOCK_SECONDS) {
    return bad('bad_elapsed', `elapsedSeconds must be between 0 and ${MAX_CLOCK_SECONDS}`);
  }
  const hintsUsed = raw['hintsUsed'] ?? 0;
  // A RUN CANNOT HAVE USED MORE HINTS THAN A PLAYER CAN HOLD. Four is not a slow player, it is a broken or
  // dishonest client, and the score it would produce is a lie about the run rather than a worse score.
  if (typeof hintsUsed !== 'number' || !Number.isInteger(hintsUsed) || hintsUsed < 0 || hintsUsed > HINT_CAP) {
    return bad('bad_hints_used', `hintsUsed must be an integer between 0 and ${HINT_CAP}`);
  }
  const attempts = raw['attempts'] ?? 0;
  if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0) {
    return bad('bad_attempts', 'attempts must be a non-negative integer');
  }
  const calls = raw['calls'];
  if (!Array.isArray(calls) || calls.some((call) => typeof call !== 'string')) {
    return bad('bad_calls', 'calls must be an array of call titles');
  }
  const drillId = raw['drillId'];
  const date = raw['date'];
  if (mode === 'drill' && (typeof drillId !== 'string' || drillId.length === 0)) return bad('bad_drill_id', 'a Drill run must name the drillId it answers');
  if (mode === 'daily' && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return bad('bad_date', 'a Daily run must name its date as YYYY-MM-DD');
  }
  const claimed = raw['score'];
  return {
    ok: true,
    submission: {
      runId,
      mode,
      levelIndex,
      drillId: typeof drillId === 'string' ? drillId : null,
      date: typeof date === 'string' ? date : null,
      clockSeconds,
      hintsUsed,
      attempts,
      calls: calls as string[],
      claimedScore: typeof claimed === 'number' && Number.isFinite(claimed) ? claimed : null,
    },
  };
}

/** The verified facts a run is scored from — every one of them re-derived, none of them the client's word. */
export interface VerifiedRun {
  readonly shortest: number;
  /** Calls played. For the Drill this is the puzzle's own shortest (one answer per step, nothing to waste). */
  readonly moves: number;
  readonly clockSeconds: number;
  readonly hintsUsed: number;
  readonly attempts: number;
}

/**
 * Score the run, with the client's claim CLAMPED — DESIGN.md 6: "the server clamps every submission to the
 * maximum score the server can itself recompute".
 *
 * THE CLAMP IS DOWNWARD ONLY AND THE CLAMPED FLAG IS REPORTED. A claim above the maximum is either a broken
 * client or a dishonest one; either way the board gets the number the server computed, and the response says
 * so rather than leaving a discrepancy nobody can explain. A claim BELOW the computed score is honoured, which
 * costs the claimant and is nobody else's business.
 */
export function scoreWithClaim(facts: VerifiedRun, level: LevelSpec, claim: number | null): RunScore & { clamped: boolean } {
  const computed = scoreRun({
    level,
    shortest: facts.shortest,
    moves: facts.moves,
    clockSeconds: facts.clockSeconds,
    hintsUsed: facts.hintsUsed,
    attempts: facts.attempts,
  });
  if (claim === null || claim >= computed.score) return { ...computed, clamped: claim !== null && claim > computed.score };
  return { ...computed, score: Math.round(claim), clamped: false };
}

/** How many hints a debit may take: never more than the balance, and never below zero (DESIGN.md 10). */
export function debitHints(ledger: HintLedger, hintsUsed: number): HintLedger {
  const spendable = Math.min(hintsUsed, ledger.hints);
  return spendable === 0 ? ledger : { ...ledger, hints: ledger.hints - spendable };
}

/**
 * A stored row as a hint balance, or null.
 *
 * A MISSING ROW IS A FRESH BALANCE, and that is the only "absent means default" in this API: every player
 * starts with nothing held and nothing earned, so there is nothing to distinguish an old player from a new one.
 * A row that is PRESENT and unreadable is null, and the caller refuses — the same contract as the schedule and
 * the progress rows.
 */
export function asHints(stored: StoredItem | null): HintLedger | null {
  if (!stored) return { hints: 0, successes: 0 };
  const value = stored.value as { hints?: unknown; successes?: unknown };
  if (typeof value.hints !== 'number' || typeof value.successes !== 'number') return null;
  if (!Number.isInteger(value.hints) || !Number.isInteger(value.successes)) return null;
  return { hints: value.hints, successes: value.successes };
}

/** What a stored run needs: the submission, the SERVER's answer about the puzzle, and the score. */
export interface RunRecordParts {
  readonly submission: RunSubmission;
  /** The seed the puzzle was regenerated from — the server's fact, never the client's. */
  readonly seed: number;
  /**
   * THE SERVER'S OWN MEASUREMENT of how long the run took, which is what the score was computed from (A21).
   *
   * IT IS NOT `submission.clockSeconds`, AND THAT IS THE WHOLE OF THIS STAGE: the client's number is an audit
   * input (`claimedSeconds`), and a record that stored only the claim would leave an operator unable to tell a
   * slow run from a lying client.
   */
  readonly measuredSeconds: number;
  /** What the client claimed, beside what was measured. */
  readonly claimedSeconds: number;
  /**
   * The wrong tries the SERVER recorded, which is what `attemptFactor` is priced on (A22).
   *
   * LIKE measuredSeconds, THIS IS NOT THE SUBMISSION'S FIELD: the claim is claimedAttempts, kept beside it so
   * an operator can see the two disagree.
   */
  readonly measuredAttempts: number;
  /** What the client claimed its wrong-try count was. */
  readonly claimedAttempts: number;
  /**
   * The hints the SERVER recorded as spent, which is what the 60-second charge is computed from (A23).
   *
   * LIKE measuredAttempts, THIS IS NOT THE SUBMISSION'S FIELD: the claim is claimedHints, kept beside it.
   */
  readonly measuredHints: number;
  /** What the client claimed it spent on hints. */
  readonly claimedHints: number;
  readonly score: number;
  readonly scoreVersion: number;
  readonly nowMs: number;
}

/**
 * The stored form of a run.
 *
 * `calls` IS THE TRANSCRIPT the score and the hint count are auditable from (§6, §10). `clockSeconds` is the
 * SERVER's measurement of the run's time — the number the score was computed from — stored rather than the
 * hint-charged `elapsedSeconds`, because the charge is arithmetic over two fields and storing the sum would make
 * it un-recomputable when `HINT_PENALTY_SECONDS` is retuned. `claimedSeconds` is what the client said, kept
 * beside it so the two can be compared after the fact (A25's audit) and so a clamp has a number to be explained
 * with.
 */
export function asRunItem(parts: RunRecordParts): Record<string, unknown> {
  const { submission } = parts;
  return {
    runId: submission.runId,
    mode: submission.mode,
    levelIndex: submission.levelIndex,
    seed: parts.seed,
    drillId: submission.drillId,
    date: submission.date,
    clockSeconds: parts.measuredSeconds,
    claimedSeconds: parts.claimedSeconds,
    hintsUsed: parts.measuredHints,
    attempts: parts.measuredAttempts,
    claimedAttempts: parts.claimedAttempts,
    claimedHints: parts.claimedHints,
    calls: submission.calls,
    score: parts.score,
    scoreVersion: parts.scoreVersion,
    recordedAtMs: parts.nowMs,
  };
}

/** A board's accumulated value, or null when the row is absent or unreadable. */
export interface BoardValue {
  readonly score: number;
  readonly runs: number;
}

/**
 * Fold this run into a board.
 *
 * TWO RULES, ONE FUNCTION, BECAUSE THE MODE DECIDES THE ARITHMETIC. The Daily's board is a day's challenge, so
 * it holds the player's BEST (a replay cannot beat what a better run already earned). The Drill's is the
 * CUMULATIVE score over the season (§6), and the caller only reaches this when the drill was newly finished —
 * which is what stops a replay of a favourite from adding anything (§6: "replaying an easy drill repeatedly
 * would out-score one clean run" is exactly what the cumulative rule would otherwise allow).
 */
export function foldBoard(mode: 'drill' | 'daily', current: BoardValue, score: number): BoardValue {
  if (mode === 'daily') return { score: Math.max(current.score, score), runs: current.runs + 1 };
  return { score: current.score + score, runs: current.runs + 1 };
}

/** A stored board row, or an empty board. An unreadable one is null so the caller can refuse. */
export function asBoard(stored: StoredItem | null): BoardValue | null {
  if (!stored) return { score: 0, runs: 0 };
  const value = stored.value as { score?: unknown; runs?: unknown };
  if (typeof value.score !== 'number' || typeof value.runs !== 'number') return null;
  return { score: value.score, runs: value.runs };
}

/**
 * A board row as the LEADERBOARD reads it: the folded value plus the player it belongs to.
 *
 * WHY THE ROW CARRIES ITS PLAYER. The player is the row's SORT KEY (`player#<id>`), and the store hands a caller
 * the value rather than the key — so a board row that did not name its player would be a rank with nobody on it.
 * Writing it is also what makes the row readable in the console, which is the same reason the adapter flattens an
 * item.
 */
export interface BoardRow extends BoardValue {
  readonly playerId: string;
}

/** One board row, or null when it is not a record this build can rank. */
export function asBoardRow(stored: StoredItem): BoardRow | null {
  const board = asBoard(stored);
  if (!board) return null;
  const playerId = stored.value['playerId'];
  if (typeof playerId !== 'string' || playerId === '') return null;
  return { ...board, playerId };
}


