// The press log: what the player actually pressed, recorded by the server as it happened (DESIGN.md 11.1, A22).
//
// WHY A RECORD AND NOT A FIELD. `attempts` is a SCORE FACTOR (`attemptFactor`), and it was the client's word: a
// submission could report zero wrong tries after any number of them, and the review that produced §11.1 measured
// what that is worth (a hidden hint was 21 -> 100 in the same family of defects). A count the server did not
// witness is not a count. So every press is posted as it happens, the server decides which of them were wrong
// from the puzzle IT regenerated, and `attempts` is that number.
//
// THE VERDICT IS THE SERVER'S, THE PICTURE IS THE CLIENT'S. A press carries a step and a call, nothing else: not
// whether it was right (the server re-derives it), and not when it happened (the server stamps it). What the
// server does NOT reproduce is the engine's prose for an illegal call — `illegal` is a teaching distinction the
// client already has from the engine it ran (DESIGN.md §8), and the server's interest in that press is only that
// it was not the correct option.
//
// THE LOG IS BOUNDED. An item has a size limit and a client can press for ever, so `MAX_PRESSES` refuses the
// press that would exceed it rather than silently dropping it: a dropped press would change `attempts` after the
// fact, which is exactly the sort of quiet disagreement A25 exists to make visible.
import type { StoredItem } from './ports.ts';

/** One press: which step, which call, and when the SERVER saw it. */
export interface Press {
  readonly step: number;
  readonly call: string;
  readonly atMs: number;
}

/** The cap on one drill's presses. Far above honest play (a step has two or three options) and far below an item. */
export const MAX_PRESSES = 200;

/** The longest call name this API will record — the corpus's longest is well inside it, and a body is not a novel. */
export const MAX_CALL_LENGTH = 120;

/** A stored row as a press log, or null when it is not one this build can read. */
export function asPresses(stored: StoredItem): Press[] | null {
  const value = stored.value as { presses?: unknown };
  if (!Array.isArray(value.presses)) return null;
  const presses: Press[] = [];
  for (const raw of value.presses) {
    const press = raw as { step?: unknown; call?: unknown; atMs?: unknown };
    if (typeof press.step !== 'number' || !Number.isInteger(press.step) || press.step < 0) return null;
    if (typeof press.call !== 'string' || press.call === '') return null;
    if (typeof press.atMs !== 'number' || !Number.isFinite(press.atMs)) return null;
    presses.push({ step: press.step, call: press.call, atMs: press.atMs });
  }
  return presses;
}

/** The stored form, field by field, so an extra property cannot ride along into the table. */
export function asPressLogItem(presses: readonly Press[]): Record<string, unknown> {
  return { presses: presses.map((press) => ({ step: press.step, call: press.call, atMs: press.atMs })) };
}

/**
 * How many of these presses were NOT the correct option at their step.
 *
 * A STEP OUTSIDE THE PUZZLE IS COUNTED AS WRONG RATHER THAN THROWN OUT, and the choice is deliberate: the client
 * is told `bad_step` when it posts one, so a row holding one is either corruption or a hand-written item, and in
 * both cases the safe reading is "this was not a correct answer". Counting it keeps the arithmetic total, where
 * skipping it would let a row of garbage score better than a row of wrong tries.
 */
export function wrongPresses(presses: readonly Press[], correctCalls: readonly string[]): number {
  let wrong = 0;
  for (const press of presses) {
    if (correctCalls[press.step] !== press.call) wrong++;
  }
  return wrong;
}

/**
 * Whether the recorded presses EXPLAIN the transcript the submission carries.
 *
 * THE RULE IS ONE DIRECTION ONLY: every call in the submitted transcript must appear as a press at that step, so a
 * run cannot claim progress the server never saw. It is deliberately not the converse — a press that is not in the
 * transcript is a WRONG try, which is what `wrongPresses` counts, and requiring equality would refuse an honest
 * run that had been replayed after a reload.
 */
export function explains(presses: readonly Press[], calls: readonly string[]): boolean {
  return calls.every((call, step) => presses.some((press) => press.step === step && press.call === call));
}
