// The run's score: DESIGN.md 6's formula, and the ONLY place it is computed.
//
// WHY ONE PURE FUNCTION AND NOT A FACTOR ON THE FLY. The same arithmetic decides the number the player is
// shown and the maximum the server will accept for the same run (DESIGN.md 6: "the server clamps every
// submission to the maximum score the server can itself recompute"). Two implementations would be two
// answers to "what was that run worth", and the one the player saw is the one they will complain about — so
// the server imports this module rather than restating the formula.
//
// WHAT IS AND IS NOT ARITHMETIC. Every TERM is measured from the run (elapsed seconds, moves played,
// answers taken); every WEIGHT is a CHOSEN number in `config.ts`. Nothing here reads a clock: `clockSeconds`
// is handed in, so a run scores the same whether it is finished, replayed or recomputed a year later.
//
//   score = base(level) × timeFactor × wasteFactor × attemptFactor     (attempts: the Drill only)
//   elapsed = time-on-the-clock + HINT_PENALTY_SECONDS × hintsUsed
//
// EACH FACTOR IS A RATIO OF WHAT THE RUN SHOULD HAVE COST TO WHAT IT DID COST, which is what keeps the
// three composable without a fourth weight: at or under par the time factor is exactly 1, at the shortest
// solution the waste factor is exactly 1, and with no failed attempts the attempt factor is exactly 1. So a
// clean, par run scores `BASE_SCORE × level` and every other run scores a fraction of it (DESIGN.md 6).

import { ATTEMPT_PENALTY, BASE_SCORE, HINT_PENALTY_SECONDS, MIN_RUN_SCORE, SECONDS_PER_CALL } from './config.ts';
import type { LevelSpec } from './types.ts';

/** What a run cost, as measurement rather than judgement. */
export interface RunFacts {
  level: LevelSpec;
  /** The shortest solution the generator knows — the `par` denominator, never a hand-set number. */
  shortest: number;
  /** Calls played. A wasted move is one beyond `shortest`; there is no allowance to be inside (DESIGN.md 9). */
  moves: number;
  /** Time on the clock only. The hint charge is added HERE, from `hintsUsed`, and nowhere else. */
  clockSeconds: number;
  /** Hints taken, charged once each and never refunded (DESIGN.md 10). */
  hintsUsed: number;
  /** Answers that were not correct. Zero for the Daily, which is not scored on attempts. */
  attempts: number;
}

/** The score and the terms that produced it, so a caller can read the working as well as the total. */
export interface RunScore {
  score: number;
  /** The clock plus the hint charge — the number the player's time is judged on. */
  elapsedSeconds: number;
  /** `shortest × SECONDS_PER_CALL`, the time the run was expected to take. */
  parSeconds: number;
  timeFactor: number;
  wasteFactor: number;
  attemptFactor: number;
}

/** The seconds a run of `shortest` calls is expected to take. Derived, never hand-set (DESIGN.md 6). */
export function parSeconds(shortest: number): number {
  return shortest * SECONDS_PER_CALL;
}

/**
 * Time on the clock plus the hint charge.
 *
 * `HINT_PENALTY_SECONDS × hintsUsed` IS ADDED AND NOT MULTIPLIED INTO ANY FACTOR, which is the rule
 * DESIGN.md 6 and 10 both state and which `score-probe` pins by equality: a run with one hint and no
 * thinking time scores exactly what a run with no hint and a minute of thinking scores. A hint is a minute
 * of the player's own time, and that is the whole of its cost.
 *
 * A NEGATIVE OR FRACTIONAL `hintsUsed` is not defended against: it comes from the run's own transcript,
 * which is an integer the app increments once per hint, and a guard here would be a branch nobody tests.
 */
export function elapsedSeconds(clockSeconds: number, hintsUsed: number): number {
  return clockSeconds + HINT_PENALTY_SECONDS * hintsUsed;
}

/** A ratio that is 1 at or under par and falls away above it — the shape all three factors share. */
function ratio(expected: number, actual: number): number {
  if (actual <= expected) return 1;
  return expected / actual;
}

/**
 * THE MOST A RUN AT THIS LEVEL CAN SCORE — `BASE_SCORE × level.index`, which is what a clean, par, first-try run gets
 * because all three factors are exactly 1 there.
 *
 * IT EXISTS AS A FUNCTION because the player is shown the score OUT OF this number (`puzzle/score-line.ts`: "10/100"),
 * and a screen that divided by a literal 100 would read "500/100" at level 5. MEASURED by `score-probe.mjs` section 4
 * (a perfect L5 run is `BASE_SCORE × 5`) and again over the baked season by `score-line-probe.mjs`: every clean par
 * run equals its own level's ceiling, so the denominator is reachable rather than a decoration.
 */
export function maxScore(level: LevelSpec): number {
  return BASE_SCORE * level.index;
}

/**
 * Score a finished run.
 *
 * THE FACTORS ARE MULTIPLIED, so a run that is slow AND wasteful AND retried scores the product and can
 * approach zero — and `MIN_RUN_SCORE` is what keeps "solved" from collapsing into "not solved" (see the
 * constant's own comment). The result is rounded to an integer because a leaderboard stores a number, and
 * it is never NaN: `ratio` returns 1 rather than dividing by zero when `actual` is 0, and `expected` is at
 * least 1 for any real level because `shortest` is at least 1.
 */
export function scoreRun(facts: RunFacts): RunScore {
  const elapsed = elapsedSeconds(facts.clockSeconds, facts.hintsUsed);
  const par = parSeconds(facts.shortest);
  const timeFactor = ratio(par, elapsed);
  const wasteFactor = ratio(Math.max(1, facts.shortest), Math.max(1, facts.moves));
  const attemptFactor = 1 / (1 + ATTEMPT_PENALTY * facts.attempts);
  const raw = maxScore(facts.level) * timeFactor * wasteFactor * attemptFactor;
  return {
    score: Math.max(MIN_RUN_SCORE, Math.round(raw)),
    elapsedSeconds: elapsed,
    parSeconds: par,
    timeFactor,
    wasteFactor,
    attemptFactor,
  };
}
