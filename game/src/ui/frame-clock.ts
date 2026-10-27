// THE FRAME CLOCK: HOW MUCH TIME A FRAME IS ALLOWED TO HAVE TAKEN, AND WHEN THERE IS NO POINT DRAWING AT ALL.
//
// WHY. A game loop that runs off `requestAnimationFrame` is told how long the gap was since the last frame, and that gap is
// not always a frame: MEASURED on a phone in a pocket, the gap across a tab switch is minutes, and `ui/playhead.ts` charges
// the gap to the line being played. Without a bound, coming back to a hidden tab would advance a 320 ms board slide by
// several minutes in one step — the animation would not "resume", it would complete and the picture would jump. The clamp was
// already in `main.ts` as `Math.min(100, …)` inside the frame function; this module is that rule EXTRACTED, because a
// constant inside an animation callback is a rule no probe can reach (AGENTS.md §4.3) and the pause below needs the same
// arithmetic.
//
// THE TWO ANSWERS:
//   * `frameDelta(nowMs, lastMs)` — the time to charge this frame, clamped to `MAX_FRAME_DELTA_MS` and never negative. A
//     clock that goes backwards (a system time correction, a resumed laptop) must not un-draw an animation, so a negative
//     gap is zero rather than a negative dt.
//   * `shouldAnimate(visibilityState)` — whether to keep scheduling frames. A hidden tab gets NO frame requests, which is
//     the point: a browser throttles `requestAnimationFrame` to nothing in a background tab anyway, so continuing to ask is
//     pure battery, and an installed app on a phone is where that shows.
//
// WHAT IT IS NOT: a scheduler, a clock, or a `document.hidden` reader. It takes the state, so `main.ts` owns the listener and
// this module owns the arithmetic.

/** The longest gap a frame is charged. A stall longer than this is a stall, not a frame. */
export const MAX_FRAME_DELTA_MS = 100;

/** The gap charged for the very first frame, when there is no previous one to measure against. */
export const FIRST_FRAME_DELTA_MS = 16;

/**
 * The time to charge `nowMs` against `lastMs`, in milliseconds.
 *
 * A `lastMs` of 0 (or a non-finite one) means "this is the first frame", which answers the nominal 60 Hz step rather than
 * the whole uptime of the page — that is the difference between an animation that starts at its beginning and one that
 * starts already finished.
 */
export function frameDelta(nowMs: number, lastMs: number): number {
  if (!Number.isFinite(lastMs) || lastMs <= 0) return FIRST_FRAME_DELTA_MS;
  if (!Number.isFinite(nowMs)) return FIRST_FRAME_DELTA_MS;
  const gap = nowMs - lastMs;
  if (gap <= 0) return 0;
  return Math.min(MAX_FRAME_DELTA_MS, gap);
}

/** Whether frames are worth asking for. Only the visible state animates; a hidden tab is told to stop asking. */
export function shouldAnimate(visibilityState: string): boolean {
  return visibilityState === 'visible';
}
