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
// A RECORD READ BACK FROM STORAGE IS CLAMPED FIRST, and the reader is named: `sanitiseLedger` below is what
// Phase 4's save calls, because `localStorage` is text the player can edit and an older build of this app
// wrote it. The TRANSITIONS stay total and unguarded — a `successes` of 15 grants one hint and resets, a
// negative balance spends nothing — so the defensive branch lives in the loader rather than being repeated
// in every rule that reads a ledger.

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

/** The result of a SERVER refusal: the ledger it implies, and whether the balance moved because of it. */
export interface RefusalResult {
  ledger: HintLedger;
  /** True when the refusal was an answer about the balance and the balance it reported was smaller. */
  corrected: boolean;
}

/**
 * Spend one hint.
 *
 * A SPEND WITH NO BALANCE IS NOT AN ERROR — it is a click on a button the screen should have disabled — so
 * it reports `spent: false` rather than throwing, and the run is not charged: the caller READS the balance
 * first (`save-state.ts` exposes it as a plain getter), asks the run for a hint, and commits the spend only
 * once the run has named something. Charging first and refunding on a run that had nothing to name would be
 * a refund path, and a spend with nothing behind it is the case this answer exists for.
 */
export function spendHint(ledger: HintLedger): SpendResult {
  if (ledger.hints <= 0) return { ledger: { ...ledger }, spent: false };
  return { ledger: { hints: ledger.hints - 1, successes: ledger.successes }, spent: true };
}

/**
 * The ledger after the SERVER REFUSED a spend, and whether that answer corrected it.
 *
 * THE SERVER'S ANSWER IS THE BALANCE — including when the answer is "you have none". `POST /me/hints` is the spend
 * (A23), so `no_hints` is not a guess about the balance, it IS the balance: the server looked it up and it was empty.
 * This app's copy is a preview of the same ledger, and the two can disagree in the direction that strands the player:
 * MEASURED (the dev server's log) a spend answered **200 after 88 295 ms** while the client's 8 s window had already
 * given up, so the debit landed and the app never adopted it — the footer went on claiming a hint, and every press
 * after it was refused for the balance the player no longer held. REPORTED as "I earned a hint, but the hint button
 * doesn't seem to do anything".
 *
 * WHY ONLY `no_hints`. Every other refusal is about something else — no attempt row for the challenge, an unreadable
 * balance, a challenge already three hints deep, a board with nothing to name — and the player still holds the hint in
 * those cases, so zeroing the ledger there would destroy a hint instead of reporting on it. It is also why the caller
 * reads `corrected`: a refusal that says nothing about the balance is not a balance event.
 *
 * `successes` IS LEFT ALONE, because the server's refusal does not report it: it is the progress towards the next hint,
 * it is only ever a display value here (the server credits the grant), and inventing a value for it would be a second
 * kind of guess.
 */
export function refusedSpend(ledger: HintLedger, code: string): RefusalResult {
  if (code !== 'no_hints' || ledger.hints === 0) return { ledger: { ...ledger }, corrected: false };
  return { ledger: { hints: 0, successes: ledger.successes }, corrected: true };
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

/**
 * A ledger read back from storage, clamped into range — or a fresh one when the record is not a ledger.
 *
 * WHY THIS EXISTS NOW AND DID NOT BEFORE. The module header has always said the transitions below assume a
 * sane record and that "a ledger read back from storage or the server (Phase 4/5) is validated where it is
 * read". Phase 4 IS that reader: `localStorage` is a text file the player can edit, a browser extension can
 * rewrite, and an older build of this app wrote. Without the clamp a hand-edited `hints: 99` would let the
 * Daily's hint button mint minutes, and a `successes: 40` would grant a hint on the next drill.
 *
 * IT CLAMPS RATHER THAN REJECTING, and the difference matters: a record with one bad field still carries a
 * real balance and a real earning count, so throwing all of it away would punish the player for a corrupt
 * byte. A record that is not an object at all has nothing to keep and becomes the empty ledger.
 */
export function sanitiseLedger(raw: unknown): HintLedger {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_LEDGER };
  const record = raw as { hints?: unknown; successes?: unknown };
  const clamp = (value: unknown, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.min(max, Math.max(0, Math.floor(value)));
  };
  // `successes` is clamped to one BELOW the step, because `HINT_SUCCESS_STEP` of them would already have
  // been a grant: a stored count at the threshold is a grant that never paid out, and paying it out on the
  // next success would be a hint the player did not earn twice.
  return { hints: clamp(record.hints, HINT_CAP), successes: clamp(record.successes, HINT_SUCCESS_STEP - 1) };
}
