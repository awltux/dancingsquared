// WHAT ONE CLICK ON A READING MEANS, as a pure rule.
//
// WHY THIS IS ITS OWN MODULE, and the reason is a defect rather than a preference. The rule used to live in
// `ui/daily-screen.ts`, which bare Node cannot load (the class uses parameter properties, so the type-stripping
// loader refuses it), so the only instrument that could observe it was a browser. The version that shipped armed on
// EVERY click and never called `play`, so a single call had no path at all and the Daily could not be played past its
// first move — MEASURED in a real browser against the built app, while the code comment and `DESIGN.md` §9.2 both
// still said "a click with nothing armed plays the reading". `parallel-step-probe.mjs` was green throughout, because
// it measures the COMPOSER (`parallelLabel`), not the rule that decides what a click does. A rule with no gate is a
// rule nobody measured (AGENTS.md §4.3, §5).
//
// THE GESTURE IS THE MODE. A plain click PLAYS the reading — the common case, one press, and the run is scored on the
// clock (`puzzle/score.ts`), so an extra press on every move costs the player real time. A Shift-click ARMS the reading
// as the first half of a two-group step.
//
//   armed      gesture                        outcome
//   none       plain                          play the reading
//   none       shift                          arm it
//   A          plain on A                     disarm
//   A          plain on B, different group    parallel: `A || B`
//   A          plain on B, same group         arm B (a SEQUENCE, not a pair — see below)
//   A          shift on B                     arm B (the gesture always arms)
//
// THE REJECTED ALTERNATIVES, each of which is a row above that would go red. A "combine" mode toggle costs the extra
// press on every move, which is the cost `b4d1d43` itself reasoned against. Arming on a plain click is what shipped,
// and it cannot both wait for a partner and play the move: after the first click the move is made, so the second click
// would be a SECOND move, which is exactly the sequence `parallelLabel` refuses to sell as one step.
//
// THE COST THAT REMAINS: composing needs a Shift key, so the two-group step is desktop-only. The screen's hint line
// says so, and `DESIGN.md` §9.2 records it as the price of one press for the common case.
import type { MoveReading } from './types.ts';
import { parallelLabel, readingSpelling } from './readings.ts';

/** What a click resolves to. The screen renders these; it does not decide between them. */
export type PickDecision =
  /** Play one reading, spelled the way the line carries it (`Heads Circle Left`, or the bare call for the whole board). */
  | { readonly kind: 'play'; readonly call: string }
  /** Hold `reading` as the first half of a two-group step, replacing any half already armed. */
  | { kind: 'arm'; readonly reading: MoveReading }
  /** Drop the half-made step. Nothing was ever played, so nothing is undone. */
  | { readonly kind: 'disarm' }
  /** Both groups as ONE step, in the engine's own `A || B` label form. */
  | { readonly kind: 'parallel'; readonly label: string };

/**
 * Whether `reading` is the armed one.
 *
 * ONE COMPARISON, used by the rule below AND by the screen that labels the button, so the "1st of two" badge cannot
 * disagree with what a second click will do. The comparison is the SPELLING rather than object identity: that is what
 * the line, the save and the server's replay all carry (`readingSpelling`), so "the same reading" means the same move
 * even if a re-render produced a fresh object for it.
 */
export function isArmed(armed: MoveReading | null, reading: MoveReading): boolean {
  return armed !== null && readingSpelling(armed) === readingSpelling(reading);
}

/**
 * Decide what the click on `reading` means, given what is already armed.
 *
 * `arming` is "the Shift key was held", not "a step is in progress": the armed state is `armed`, and a gesture that
 * always arms is the one thing a player can rely on when a half-made step is sitting there.
 */
export function decidePick(armed: MoveReading | null, reading: MoveReading, arming: boolean): PickDecision {
  if (arming) return { kind: 'arm', reading };
  if (armed === null) return { kind: 'play', call: readingSpelling(reading) };
  if (isArmed(armed, reading)) return { kind: 'disarm' };
  const label = parallelLabel(armed, reading);
  // THE SAME GROUP TWICE IS A SEQUENCE, NOT A PAIR (`parallelLabel` returns null): MEASURED, applying the two in either
  // order disagrees half the time, so the click re-arms rather than composing something the dancers did not do. It
  // re-arms rather than doing nothing, so the click is never silently ignored.
  if (label === null) return { kind: 'arm', reading };
  return { kind: 'parallel', label };
}
