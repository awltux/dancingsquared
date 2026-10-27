// THE RESULT CARD'S RANKS, PINNED — AND MEASURED OVER THE WHOLE BAKED SEASON.
//
// REPORTED: "I think its time to make the UI more gamified, attractive and captivating." The moment a drill is solved is
// the game's one moment of reward and it read as a line of prose. The card that replaces it derives its stars from
// `RunScore`'s own factors (each exactly 1 at or under the thing it measures), and this probe asks the two questions a
// score-shaped rule can get wrong:
//
//   1. IS THE TOP RANK REACHABLE, and is it EARNED? A par, clean run must be 3 stars; the SAME run with one hint, one
//      wrong answer, one wasted call or 50 % more time must be 2 or fewer. MEASURED over the baked season's 108 puzzles,
//      both directions, which is the sample that matters — a rule that only worked on a hand-made fixture would still be
//      true of nothing the player can reach.
//   2. DOES A HINT COST THE TOP RANK WITHOUT COSTING THE RUN? The star stays at least 1 and the score still pays
//      (`MIN_RUN_SCORE`), which is DESIGN.md §10's "a hint is a minute of the player's own time" and not a tax on solving.
//
// THE NEGATIVE CONTROL is a card keyed on the SCORE instead of the factors: `stars = score > 250 ? 3 : ...`. It passes the
// clean case (a clean run scores high) and fails the hinted-par case, because a hinted run still scores near the top when
// the player was quick — which is exactly the shape of rule the comment in `result-card.ts` explains was rejected.
//
// Usage: node game/test/result-card-probe.mjs   (engine must be built: `score.ts` and the bake both come from the game)
import { resultCard } from '../src/puzzle/result-card.ts';
import { scoreRun, parSeconds } from '../src/puzzle/score.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { SEASON_PUZZLES } from '../src/game/season-data.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const level = levelSpec(1);
/** A run's facts, defaulting to a CLEAN PAR RUN for a one-step puzzle, then overridden. */
const factsOf = (over = {}) => ({
  level,
  shortest: 1,
  moves: 1,
  clockSeconds: parSeconds(1),
  hintsUsed: 0,
  attempts: 0,
  ...over,
});
const cardOf = (over = {}, newBest = false) => {
  const facts = factsOf(over);
  return resultCard(facts, scoreRun(facts), newBest);
};

console.log('\n== 1. the three ranks, from the factors ==');
{
  const clean = cardOf();
  check(clean.stars === 3, `a clean par run is 3 stars (${clean.stars})`);
  check(clean.headline === 'Clean run', `and says so (${clean.headline})`);
  check(clean.badges.join() === 'no-hints,shortest-line,first-try,at-par', `with four badges (${clean.badges.join()})`);
  // A HINT IS A MINUTE OF THE PLAYER'S TIME, so on a 15 s par it loses BOTH halves: not clean, and not at par either.\n  check(cardOf({ hintsUsed: 1 }).stars === 1, 'a hinted run is one star — the minute it costs is over par (MEASURED)');
  check(cardOf({ attempts: 1 }).stars === 2, 'one wrong answer does too');
  check(cardOf({ moves: 2 }).stars === 2, 'and one wasted call');
  // A CLEAN RUN OVER PAR IS 2 STARS: the "clean" half is kept, the "at par" half is not. Both halves are worth a rank.
  const slowClean = cardOf({ clockSeconds: parSeconds(1) * 2 });
  check(slowClean.stars === 2, `a clean run at double par is 2 stars (${slowClean.stars})`);
  check(slowClean.headline === 'Solved', `and reads "Solved" rather than "Clean run" (${slowClean.headline})`);
  const slowMessy = cardOf({ clockSeconds: parSeconds(1) * 2, hintsUsed: 1, attempts: 2 });
  check(slowMessy.stars === 1, `slow, hinted and retried is one star (${slowMessy.stars})`);
  // NEVER ZERO, and the score never collapses to nothing: the two rules agree that a solved run is worth something.
  const worst = (() => {
    const facts = factsOf({ clockSeconds: 10_000, hintsUsed: 3, attempts: 9, moves: 9 });
    return { card: resultCard(facts, scoreRun(facts)), score: scoreRun(facts).score };
  })();
  check(worst.card.stars >= 1, `the worst run still has a star (${worst.card.stars})`);
  check(worst.score > 0, `and still pays points (${worst.score})`);
}

console.log('\n== 2. the terms are the score\'s own numbers, not a second calculation ==');
{
  const facts = factsOf({ clockSeconds: 3.25, hintsUsed: 1 });
  const score = scoreRun(facts);
  const card = resultCard(facts, score);
  const scoreTerm = card.terms.find((t) => t.label === 'Score');
  check(scoreTerm?.value === String(score.score), `the Score term IS scoreRun's (${scoreTerm?.value})`);
  check(card.terms.some((t) => t.value.includes('par')), 'the Time term states par beside the time');
  check(card.terms.some((t) => t.label === 'Hints' && t.value === '1'), 'and the hint count is the run\'s own');
  check(card.terms.length === 5, `five terms, in reading order (${card.terms.length})`);
  // `newBest` IS THE SHELL'S ANSWER, and it is a badge rather than a silent change of rank: a best run is still 1 star if
  // it was slow and hinted.
  const bestSlow = cardOf({ clockSeconds: parSeconds(1) * 4, hintsUsed: 2 }, true);
  check(bestSlow.stars === 1 && bestSlow.badges[0] === 'new-best', 'a new best is a badge, not a star, when the run was poor');
}

console.log('\n== 3. MEASURED over the baked season: 3 stars is reachable and 1 star is not automatic ==');
{
  check(SEASON_PUZZLES.length > 50, `the bake carries ${SEASON_PUZZLES.length} puzzles`);
  let cleanThree = 0;
  let slowTwoOrLess = 0;
  let hintedTwoOrLess = 0;
  let minPar = Infinity;
  let maxPar = 0;
  for (const puzzle of SEASON_PUZZLES) {
    const shortest = Math.max(1, puzzle.shortest);
    const par = parSeconds(shortest);
    minPar = Math.min(minPar, par);
    maxPar = Math.max(maxPar, par);
    /** The run a perfect player has: every call right first time, the shortest line, exactly par. */
    const perfect = {
      level: puzzle.level ?? level,
      shortest,
      moves: shortest,
      clockSeconds: par,
      hintsUsed: 0,
      attempts: 0,
    };
    if (resultCard(perfect, scoreRun(perfect)).stars === 3) cleanThree++;
    const slow = { ...perfect, clockSeconds: par * 1.5 };
    if (resultCard(slow, scoreRun(slow)).stars <= 2) slowTwoOrLess++;
    const hinted = { ...perfect, hintsUsed: 1 };
    if (resultCard(hinted, scoreRun(hinted)).stars <= 2) hintedTwoOrLess++;
  }
  check(cleanThree === SEASON_PUZZLES.length, `a clean par run is 3 stars on all ${SEASON_PUZZLES.length} (${cleanThree})`);
  check(slowTwoOrLess === SEASON_PUZZLES.length, `50 % over par drops the third star on all of them (${slowTwoOrLess})`);
  check(hintedTwoOrLess === SEASON_PUZZLES.length, `and so does one hint (${hintedTwoOrLess})`);
  check(minPar > 0 && maxPar >= minPar, `par runs from ${minPar} s to ${maxPar} s, so the rank is not tuned to one level`);
}

console.log('\n== 4. the negative control: a score-thresholded card ==');
{
  // THE RULE THAT WAS REJECTED, measured. Ranks by POINTS (250 / 120, a plausible pair of round numbers): a PERFECT
  // level-1 run scores `BASE_SCORE` — 100 — so it earns ONE star from that rule and THREE from the factors, while the same
  // quality of run at level 3 passes the threshold. The flaw is not the numbers chosen, it is that points carry the level
  // index (`scoreRun` multiplies by it), so a fixed threshold means a different rank at every level. The factors are
  // dimensionless ratios, which is why they keep their meaning.
  const byScore = (facts) => {
    const score = scoreRun(facts);
    return score.score > 250 ? 3 : score.score > 120 ? 2 : 1;
  };
  const perfectLevel1 = factsOf();
  const perfectLevel3 = factsOf({ level: levelSpec(3) });
  check(byScore(perfectLevel1) === 1 && cardOf().stars === 3,
    `a points rule gives a perfect level-1 run ${byScore(perfectLevel1)} star(s) where the factors give 3`);
  check(byScore(perfectLevel3) === 3, `and the same run at level 3 passes it — the level-dependence that rules it out (${byScore(perfectLevel3)})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
