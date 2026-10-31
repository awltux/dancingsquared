// WHAT THE STARTUP BAR SAYS, AND HOW FAR ALONG IT IS - the numbers and the words, apart from the DOM.
//
// REPORTED as: "The startup progress bar seems to miss monitoring progress at the start and the end of the startup
// phase. There are long pauses while it is obviously doing something, but there is no feedback through the progress
// bar." MEASURED on a warm dev server, in ms since the navigation's time origin (`bootMark`, one run, this machine):
//
//     main@3238          the module graph, before ANY app code runs          3.2 s   no feedback at all
//     download-run@3309  first corpus file                                   80 ms
//     download-end@4292  the 509 XML files                                  1.0 s   per-file ticks (already)
//     parse-end@5197     the catalogue walk                                 0.9 s   ONE tick at the end
//     seq-begin@5197     the sequencer, one synchronous call                3.1 s   bar pinned at 100%, "Initialising"
//     browse@8623, editor@8660, finish@8663                                 0.2 s
//
// So there are three silent stretches and only one of them was a percentage: the parse walk reported nothing until it
// finished, everything after the download reported nothing at all, and the bar reached 100% before half the work was
// done. This module owns the split, so the mapping is testable without a DOM (`poc/tools/boot-progress-probe.mjs`), and
// `main.ts` only paints what it returns.
//
// THE BAR CANNOT MOVE BY ITSELF THROUGH A SYNCHRONOUS STEP. Every step after the download is one blocking call on the
// main thread, so a percentage written before it and a percentage written after it are the same picture - the browser
// cannot paint in between. The answer is the INDETERMINATE state (`setIndeterminate` in `main.ts`, the CSS animation in
// `style.css`): an animation on the compositor keeps moving while the thread is busy, so the bar says "working" for as
// long as the step takes, and the STEP's own name is painted first so the caller knows WHICH part is slow.

/** The two phases whose length the loader can measure, and therefore report as a fraction. */
export type BootPhase = 'download' | 'parse';

/**
 * The share of the bar each measured phase owns, in percent.
 *
 * NOT EQUAL SHARES, because the two do not take equal time: downloading 5 MB of XML and walking it are each about a
 * second here. The remainder - the build steps below - owns 85 to 100 and is the largest stretch of all, which is why
 * it is stepped by NAME rather than by percentage.
 */
const SPAN: Record<BootPhase, readonly [number, number]> = {
  download: [0, 60],
  parse: [60, 85],
};

/** One blocking step after the catalogue is in: what is being built, and where the bar stands while it runs. */
export interface BootStep {
  /** Painted on its own, before the work starts - the whole point, because the work then blocks the paint. */
  readonly text: string;
  readonly percent: number;
}

/**
 * THE STEPS, IN THE ORDER `main.ts` RUNS THEM, each with the bar's position while it runs.
 *
 * THE PERCENTAGES ARE START POSITIONS and they ascend into `finishLoading`'s 100, so the bar never moves backwards and
 * never claims to be finished before the last panel is built. The names are the caller's words for the work, because
 * "Initialising" is what the report was about: one word for 3.1 seconds of sequencer is no better than no feedback.
 */
export const BUILD_STEPS: readonly BootStep[] = [
  { text: 'Building the sequencer…', percent: 85 },
  { text: 'Filling the call list…', percent: 92 },
  { text: 'Building the editor…', percent: 97 },
  { text: 'Restoring your last session…', percent: 99 },
];

/** A fraction clamped to 0..1: a loader that miscounts must not make the bar overflow or run backwards. */
function clamp(frac: number): number {
  return Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
}

/** Where the bar stands for a measured phase's fraction. The two spans join at 60, so the bar is monotone across them. */
export function bootPercent(phase: BootPhase, frac: number): number {
  const [from, to] = SPAN[phase];
  return from + (to - from) * clamp(frac);
}

/** What the bar says for a measured phase, with the percentage in it - a bar that moved with no number would be a guess. */
export function bootLabel(phase: BootPhase, frac: number): string {
  const n = Math.round(clamp(frac) * 100);
  return phase === 'download' ? `Downloading data ${n}%` : `Reading the call files ${n}%`;
}
