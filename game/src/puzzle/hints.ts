// The hint ledger: hints are EARNED on the drill line and SPENT on the Daily (DESIGN.md 10).
//
// WHY THIS IS A PURE RECORD AND NOT A COUNTER ON THE RUN. The balance outlives every run: it is earned by
// finishing Drill puzzles and spent on a Daily, and DESIGN.md 11 stores it on the ACCOUNT (one row per
// player, not per level) so an anonymous player's balance is claimed with the rest of the ledger on login.
// A record plus two pure transitions is therefore the shape that both the client's in-memory copy and the
// server's table can share, and it is what makes "the server grants on the tenth success and never on a
// client's word" (DESIGN.md 14) a rule a probe can drive with no network at all.
//
// THREE RULES, AND EACH IS A SENTENCE IN DESIGN.md 10:
//
//   1. ONE HINT PER `HINT_SUCCESS_STEP` SUCCESSES, TO A MAXIMUM OF `HINT_CAP` HELD.
//   2. THE CAP IS ON THE BALANCE, NOT ON THE EARNING — "at 3 held, further successes accumulate nothing".
//      So a full ledger IGNORES successes rather than counting them behind the cap and paying them out
//      later, which would make the cap meaningless the moment it was reached.
//   3. SPENDING IS NOT EARNING. Spending a hint does not touch the progress towards the next one, because
//      the progress is measured in whatever the player did on the drill line.
//
// EVERY TRANSITION RETURNS A NEW RECORD and leaves its input alone. That is not decoration: the app holds
// one ledger, and a function that mutated it would make "what the balance was BEFORE this answer" — which
// the UI needs to announce a grant exactly once — unanswerable.
//
// WHAT THIS MODULE DOES NOT DO. It does not clamp a record it is given: a ledger read back from storage or
// from the server (Phase 4/5) is validated where it is read, and the transitions below are total for any
// sane record — a `successes` of 15 grants one hint and resets, and a negative balance simply spends
// nothing. Adding a defensive branch here would be a branch nothing tests.

import { HINT_CAP, HINT_SUCCESS_STEP } from './config.ts';

/** A player's balance and their progress towards the next hint. Both are integers the app owns. */
export interface HintLedger {
  /** How many hints are held. Never above `HINT_CAP` once a transition has touched it. */
  hints: number;
  /** Successes since the last grant, `0..HINT_SUCCESS_STEP - 1`. */
  successes: number;
}

/** A new player's ledger. */
export const EMPTY_LEDGER: HintLedger = { hints: 0, successes: 0 };

/** `recordSuccess` also reports whether this success GRANTED a hint, so a grant can be announced once. */
export interface GrantResult {
  ledger: HintLedger;
  /** True on the success that completes the count — and only on that one. */
  granted: boolean;
}

/**
 * Record one successful Drill puzzle.
 *
 * "SUCCESSFUL" IS A CORRECT ANSWER, FIRST TRY OR AFTER REPLAYS (DESIGN.md 10), so the caller records a
 * COMPLETED drill and not a correct step: the Drill prices a wrong answer through `attemptFactor`, and a
 * tip must not be forfeited by learning what a call looks like. The count is the drill's, and the caller is
 * the one that knows a puzzle is finished.
 */
export function recordSuccess(ledger: HintLedger): GrantResult {
  if (ledger.hints >= HINT_CAP) return { ledger: { ...ledger }, granted: false };
  const successes = ledger.successes + 1;
  if (successes >= HINT_SUCCESS_STEP) return { ledger: { hints: ledger.hints + 1, successes: 0 }, granted: true };
  return { ledger: { hints: ledger.hints, successes }, granted: false };
}

/** The result of trying to spend: `spent` is false when there was nothing to spend. */
export interface SpendResult {
  ledger: HintLedger;
  spent: boolean;
}

/**
 * Spend one hint.
 *
 * A SPEND WITH NO BALANCE IS NOT AN ERROR — it is a click on a button the screen should have disabled — so
 * it reports `spent: false` rather than throwing, and the run is not charged (the caller spends first and
 * takes the hint only if the ledger said yes).
 */
export function spendHint(ledger: HintLedger): SpendResult {
  if (ledger.hints <= 0) return { ledger: { ...ledger }, spent: false };
  return { ledger: { hints: ledger.hints - 1, successes: ledger.successes }, spent: true };
}

/**
 * What the player has earned towards the next hint, for the "7 of 10" the design asks to be visible
 * (DESIGN.md 10: "silent progress, announced grant").
 *
 * `full` IS PART OF THE ANSWER and not a separate question: at the cap the progress stops advancing, so a
 * screen that showed "7 of 10" while ignoring further successes would be showing a number that has stopped
 * meaning anything. The caller shows the balance and this together.
 */
export function earningProgress(ledger: HintLedger): { successes: number; needed: number; full: boolean } {
  return { successes: ledger.successes, needed: HINT_SUCCESS_STEP, full: ledger.hints >= HINT_CAP };
}
