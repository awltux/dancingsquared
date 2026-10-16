// The attempt item: ONE player, ONE challenge, and the three things the server recorded about it.
//
// WHY ONE MODULE OWNS THE WHOLE ITEM. The Daily's clock stamp (A21), the Drill's presses (A22) and the hints spent
// (A23) all live under the same key — `attempts#<playerId>` / `daily#<level>#<date>` or `drill#<id>` — and three
// writers that each knew only their own field would DROP the others on every append: MEASURED in this stage's own
// first draft, where the press append wrote `{ presses }` over a row that also held a hint. So the shape is read
// and written in one place, and a mutator changes one field of what it read.
//
// AND WHY NOTHING EVER MOVES THE STAMP. A run's time has to be the server's own measurement, and for the Daily
// there is nothing else to measure from: the challenge is published ahead of time and the client derives the board
// from a seed that is a public function of the date, so the first moment the server learns that THIS player started
// is their read of it. The row is created by `GET /puzzle` and the stamp is never rewritten. MEASURED, and it is
// the difference between a clock and a suggestion: a stamp a re-read could refresh would let a player play slowly,
// re-read, submit, and claim a window of a second (§11.1's measured 6.7x for the Drill's version of that).
//
// THE DRILL HAS A ROW TOO, and it is not a clock: its start is the Progress row's `issuedAtMs`, and what the row
// holds is the presses and the hints.
import type { StoredItem } from './ports.ts';
import { asDailyMoveItems, asDailyMoves, type DailyMove } from './daily-line.ts';

/** One press: which step, which call, and when the SERVER saw it. */
export interface Press {
  readonly step: number;
  readonly call: string;
  readonly atMs: number;
}

/**
 * One hint, as the server spent it: which hint of the challenge it was, the call it named, and when.
 *
 * `call` IS THE SERVER'S NOW (A23's naming). §10's look-up runs over the board the player is standing on, and for
 * the Daily that board IS the recorded line — `levels.ts`'s `nameHintFor` replays it through `PlaySession.hint()`,
 * the same function the screen calls, so there is ONE name for one fact. It is never empty in a row this build
 * writes: a spend that cannot name a call is REFUSED instead (`nothing_to_name`), because a hint that cannot say
 * anything is not a hint. A row written before the naming moved may still hold `''`, which `asHints` reads.
 */
export interface HintEvent {
  readonly step: number;
  readonly call: string;
  readonly atMs: number;
}

/** The attempt item, with every field that may be absent filled in: a row is present-and-complete or absent. */
export interface Attempt {
  /** The Daily's start stamp (A21). Absent for a Drill, whose start is the Progress row's issue date. */
  readonly startedAtMs: number | null;
  readonly presses: readonly Press[];
  /**
   * The Daily's recorded moves (A22's Daily half). Empty for a Drill, which has one answer per step instead.
   *
   * THE LINE IS NOT STORED, only the moves that built it: a second copy of the player's line is a second thing that
   * can disagree with the log, and the line is a pure replay of this list through the same session the client drove
   * (`levels.ts`'s `replayDailyMoves`).
   */
  readonly moves: readonly DailyMove[];
  readonly hints: readonly HintEvent[];
  /** When the player GAVE UP on a Daily (A25's accounting). Null while the attempt is live or unfinished. */
  readonly abandonedAtMs: number | null;
}

function asPresses(raw: unknown): Press[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const presses: Press[] = [];
  for (const item of raw) {
    const press = item as { step?: unknown; call?: unknown; atMs?: unknown };
    if (typeof press.step !== 'number' || !Number.isInteger(press.step) || press.step < 0) return null;
    if (typeof press.call !== 'string' || press.call === '') return null;
    if (typeof press.atMs !== 'number' || !Number.isFinite(press.atMs)) return null;
    presses.push({ step: press.step, call: press.call, atMs: press.atMs });
  }
  return presses;
}

function asHints(raw: unknown): HintEvent[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const hints: HintEvent[] = [];
  for (const item of raw) {
    const hint = item as { step?: unknown; call?: unknown; atMs?: unknown };
    if (typeof hint.step !== 'number' || !Number.isInteger(hint.step) || hint.step < 0) return null;
    // AN EMPTY CALL IS ALLOWED HERE, unlike a press: see `HintEvent`. Anything that is not a string is not a call.
    if (typeof hint.call !== 'string') return null;
    if (typeof hint.atMs !== 'number' || !Number.isFinite(hint.atMs)) return null;
    hints.push({ step: hint.step, call: hint.call, atMs: hint.atMs });
  }
  return hints;
}

/**
 * A stored row as an attempt, or null when it is not one this build can read.
 *
 * NULL MEANS "UNREADABLE", NOT "ABSENT": the callers distinguish them, because "this player never started" is a
 * refusal about the run and "this row is corrupt" is an operator finding — the same split the schedule and the
 * progress rows make. An absent FIELD is a fresh list, so a Daily row written before hints existed still reads.
 */
export function asAttempt(stored: StoredItem): Attempt | null {
  const value = stored.value as { startedAtMs?: unknown; presses?: unknown; moves?: unknown; hints?: unknown };
  const stamp = value.startedAtMs;
  if (stamp !== undefined && (typeof stamp !== 'number' || !Number.isFinite(stamp))) return null;
  const presses = asPresses(value.presses);
  if (!presses) return null;
  const moves = asDailyMoves(value.moves);
  if (!moves) return null;
  const hints = asHints(value.hints);
  if (!hints) return null;
  const abandoned = (stored.value as { abandonedAtMs?: unknown }).abandonedAtMs;
  if (abandoned !== undefined && abandoned !== null && (typeof abandoned !== 'number' || !Number.isFinite(abandoned))) return null;
  return {
    startedAtMs: typeof stamp === 'number' ? stamp : null,
    presses,
    moves,
    hints,
    abandonedAtMs: typeof abandoned === 'number' ? abandoned : null,
  };
}

/**
 * The stored form, field by field, so an extra property cannot ride along into the table.
 *
 * ABSENT MEANS ABSENT: a Drill row writes no `startedAtMs` rather than a null, because a null stamp is a field a
 * reader would have to interpret and an absent one is the fact.
 */
export function asAttemptItem(attempt: Attempt): Record<string, unknown> {
  return {
    ...(attempt.startedAtMs === null ? {} : { startedAtMs: attempt.startedAtMs }),
    presses: attempt.presses.map((press) => ({ step: press.step, call: press.call, atMs: press.atMs })),
    moves: asDailyMoveItems(attempt.moves),
    hints: attempt.hints.map((hint) => ({ step: hint.step, call: hint.call, atMs: hint.atMs })),
    ...(attempt.abandonedAtMs === null ? {} : { abandonedAtMs: attempt.abandonedAtMs }),
  };
}

/**
 * What a read should record: a new attempt when there is none, and the EXISTING one when there is.
 *
 * `write` IS THE WHOLE RULE. Returning the existing attempt with `write: false` is what makes a second read free
 * AND what makes it unable to move the clock; a handler that wrote `nowMs` unconditionally would look identical
 * until someone re-read the challenge before submitting.
 */
export function startAttempt(existing: Attempt | null, nowMs: number): { attempt: Attempt; write: boolean } {
  return existing
    ? { attempt: existing, write: false }
    : { attempt: { startedAtMs: nowMs, presses: [], moves: [], hints: [], abandonedAtMs: null }, write: true };
}

/**
 * How long the server has measured, in seconds, floored at zero.
 *
 * FLOORED RATHER THAN ABSOLUTE, because a clock that moved backwards between the stamp and the submission (an NTP
 * step, a system that woke from sleep with a bad time) must not produce a negative elapsed and a factor above 1.
 * The score's own clamp would catch the number, but a negative time in the audit row is a thing an operator would
 * have to explain.
 */
export function elapsedSince(startedAtMs: number, nowMs: number): number {
  return Math.max(0, (nowMs - startedAtMs) / 1000);
}
