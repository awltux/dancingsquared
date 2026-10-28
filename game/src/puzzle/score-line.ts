// THE SCORE A SOLVED DRILL ENDS ON, AS ONE LINE: the number out of the most it could have been.
//
// REPORTED: "When the player successfully completes a drill, the results pane is lost in the background. There is too much
// unnecessary info in that pane. We only need the score out of text e.g. 10/100, and bring it to the main page." The pane
// this replaces was a card — three stars, a headline, five terms and up to five badges — and every one of those numbers
// was a second reading of `RunScore`'s own factors. One line says the only thing the moment is for.
//
// THE DENOMINATOR IS THE SCORE'S OWN CEILING, NOT A FIXED 100: `scoreRun` multiplies `BASE_SCORE` by the level's index, so
// a perfect level-1 run is 100 and a perfect level-5 run is 500. A literal 100 would read "500/100" — the bug this module
// exists to make impossible, and `score-line-probe.mjs` measures the ceiling against the baked season rather than trusting
// the arithmetic here.
//
// PURE, AND GATED, because the rule a probe cannot import is not a rule (AGENTS.md §11.4.5): `ui/drill-screen.ts` paints
// whatever this returns, so the text is decided in one place and pinned there. No clock, no DOM, no storage.

import { maxScore, type RunScore } from './score.ts';
import type { LevelSpec } from './types.ts';

/**
 * The line a solved drill shows: `score/max`, in that order, with no units and no working.
 *
 * IT TAKES THE LEVEL rather than a ceiling as a number, so a caller cannot pair a run with another level's maximum — the
 * two facts that produce the line come from the same run.
 */
export function scoreLine(score: RunScore, level: LevelSpec): string {
  return `${score.score}/${maxScore(level)}`;
}
