// THE RESULT CARD: WHAT A FINISHED RUN IS WORTH, SAID AS STARS RATHER THAN AS A SENTENCE.
//
// WHY. REPORTED: "I think its time to make the UI more gamified, attractive and captivating." The moment a drill is solved
// is the game's one moment of reward, and it read as a line of prose — `Solved in 4.2 s, 2 attempts — 300 points` in the
// verdict slot, in the same voice as a refusal. A scored moment needs a shape a player recognises instantly (stars), the
// number that earns the next rank, and the terms that produced it (DESIGN.md §6 already computes them), so this module
// turns `RunScore` into a card. PURE: no DOM, no clock, no storage — the shell paints it.
//
// THE STARS ARE DERIVED FROM THE SCORE'S OWN FACTORS, NOT FROM THE POINTS. `scoreRun` returns `timeFactor`,
// `wasteFactor` and `attemptFactor`, each EXACTLY 1 at or under the thing it measures (a ratio of expected to actual), so:
//
//   3 stars  CLEAN AND AT PAR: no hint, no wrong answer, the shortest line, and no slower than par.
//   2 stars  ONE OF THOSE TWO: at par with a wasted call or a retry, or clean but over par.
//   1 star   SOLVED, which is always worth a star and never nothing (the score has `MIN_RUN_SCORE` for the same reason).
//
// A HINT CANNOT EARN THE TOP RANK, AND IT USUALLY COSTS TWO. A hint is charged as a minute of the player's own time
// (DESIGN.md §10), so on a level-1 drill — par 15 s — a hinted run is 75 s and loses the "at par" half as well: MEASURED
// by `result-card-probe.mjs`, a hinted par run is ONE star, not two. That is the score's own arithmetic and this card does
// not soften it; what it does say is that solving with help still pays (`MIN_RUN_SCORE`) and still earns a star, because a
// rank of zero would make the hint a punishment for using the feature the game offers.
//
// WHY NOT A POINT THRESHOLD. A star level keyed on "300 points" would drift the moment a level's base score or a weight
// changed (both are config, and `DESIGN.md §6` says the formula is the authority); the factors are dimensionless ratios,
// so the ranks keep their meaning when the numbers do not.

import type { RunFacts, RunScore } from './score.ts';

/** One line of the card's working: what was measured, and how it reads. */
export interface ResultTerm {
  label: string;
  value: string;
}

/** A badge is a fact about the run that a player can be proud of, in three words or fewer. */
export type ResultBadge = 'no-hints' | 'shortest-line' | 'first-try' | 'at-par' | 'new-best';

export interface ResultCard {
  /** 1–3. A finished run is never zero stars: being solved is the first one. */
  stars: 1 | 2 | 3;
  /** The card's own word: `Clean run`, `Solved`. */
  headline: string;
  /** The working, in the order a player reads it: score first, then the terms behind it. */
  terms: ResultTerm[];
  badges: ResultBadge[];
}

/** How a badge reads. The shell prints these, so the words live with the rule that earns them. */
export const BADGE_TEXT: Record<ResultBadge, string> = {
  'no-hints': 'no hints',
  'shortest-line': 'shortest line',
  'first-try': 'first try',
  'at-par': 'at par',
  'new-best': 'new best',
};

/** Seconds as a player reads them: one decimal under ten, whole above, so the card does not jitter between runs. */
function seconds(value: number): string {
  return value < 10 ? `${value.toFixed(1)} s` : `${Math.round(value)} s`;
}

/**
 * The card for a finished run.
 *
 * `facts` is needed for `hintsUsed`, `attempts` and `moves` — the three facts the score does not carry as factors — and
 * `newBest` is the shell's answer, because "best" is about the device's history rather than about this run.
 */
export function resultCard(facts: RunFacts, score: RunScore, newBest = false): ResultCard {
  const atPar = score.timeFactor === 1;
  const shortestLine = facts.moves <= Math.max(1, facts.shortest);
  const clean = facts.hintsUsed === 0 && facts.attempts === 0 && shortestLine;
  const stars: 1 | 2 | 3 = clean && atPar ? 3 : atPar || clean ? 2 : 1;

  const badges: ResultBadge[] = [];
  if (newBest) badges.push('new-best');
  if (facts.hintsUsed === 0) badges.push('no-hints');
  if (shortestLine) badges.push('shortest-line');
  if (facts.attempts === 0) badges.push('first-try');
  if (atPar) badges.push('at-par');

  const terms: ResultTerm[] = [
    { label: 'Score', value: `${score.score}` },
    { label: 'Time', value: `${seconds(score.elapsedSeconds)} of ${seconds(score.parSeconds)} par` },
    { label: 'Calls', value: `${facts.moves} of ${Math.max(1, facts.shortest)} shortest` },
    { label: 'Hints', value: facts.hintsUsed === 0 ? 'none' : `${facts.hintsUsed}` },
    { label: 'Wrong answers', value: `${facts.attempts}` },
  ];

  return { stars, headline: stars === 3 ? 'Clean run' : 'Solved', terms, badges };
}
