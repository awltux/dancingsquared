// The attempt row: WHEN THE SERVER SAW A CHALLENGE START (DESIGN.md 11.1, A21).
//
// WHY A ROW AT ALL, AND WHY NOTHING EVER MOVES IT. A run's time has to be the server's own measurement, and for the
// Daily there is nothing else to measure from: the challenge is published ahead of time and the client derives the
// board from a seed that is a public function of the date, so the first moment the server learns that THIS player
// started is their read of it. The row is therefore created by `GET /puzzle` and never rewritten. MEASURED, and it
// is the difference between a clock and a suggestion: a stamp a re-read could refresh would let a player play
// slowly, re-read, submit, and claim a window of a second — which is exactly the cheat A21 exists to remove
// (§11.1's measured 6.7x for the Drill's version of it). The cost is stated rather than hidden: a second attempt at
// the same day's Daily is measured from the first look at it, so a retry cannot buy a fresh clock.
//
// THE DRILL HAS NO ROW, and does not need one: its `Progress` item already holds `issuedAtMs`, written by the
// server when it issued the drill and cleared when the drill is finished. One row per mechanism, so there is
// exactly one place to read "when did this start" from.
import type { StoredItem } from './ports.ts';

/** The server's own start stamp for one player's attempt at one challenge. */
export interface Attempt {
  readonly startedAtMs: number;
}

/**
 * A stored row as an attempt, or null when it is not one this build can read.
 *
 * NULL MEANS "UNREADABLE", NOT "ABSENT": the caller distinguishes them, because "this player never started" is a
 * refusal about the run and "this row is corrupt" is an operator finding — the same split the schedule and the
 * progress rows make.
 */
export function asAttempt(stored: StoredItem): Attempt | null {
  const value = stored.value as { startedAtMs?: unknown };
  if (typeof value.startedAtMs !== 'number' || !Number.isFinite(value.startedAtMs)) return null;
  return { startedAtMs: value.startedAtMs };
}

/** The stored form, field by field, so an extra property cannot ride along into the table. */
export function asAttemptItem(attempt: Attempt): Record<string, unknown> {
  return { startedAtMs: attempt.startedAtMs };
}

/**
 * What a read should record: a new attempt when there is none, and the EXISTING one when there is.
 *
 * `write` IS THE WHOLE RULE. Returning the existing attempt with `write: false` is what makes a second read free
 * AND what makes it unable to move the clock; a handler that wrote `nowMs` unconditionally would look identical
 * until someone re-read the challenge before submitting.
 */
export function startAttempt(existing: Attempt | null, nowMs: number): { attempt: Attempt; write: boolean } {
  return existing ? { attempt: existing, write: false } : { attempt: { startedAtMs: nowMs }, write: true };
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
