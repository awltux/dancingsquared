// THE SCORE A SOLVED DRILL SHOWS, PINNED — one line, and the denominator is the run's OWN ceiling.
//
// REPORTED: "When the player successfully completes a drill, the results pane is lost in the background. There is too much
// unnecessary info in that pane. We only need the score out of text e.g. 10/100, and bring it to the main page." So the
// text is `score/max`, and the two ways that line can lie are:
//
//   1. THE SHAPE. A card's worth of working, a unit ("pts"), stars or a time would all read as "more information" and are
//      exactly what the report removed. The first check pins the string character for character, which is the only way a
//      "contains the score" assertion could not also pass a card.
//   2. THE DENOMINATOR. A literal 100 is the report's own example, so it is the plausible wrong rule: `scoreRun` multiplies
//      `BASE_SCORE` by the level's index, and at level 5 a perfect run is 500. Section 2 measures `maxScore` against the
//      arithmetic and section 3 against the BAKED SEASON — every clean par run equals its own level's ceiling — because a
//      denominator that is not reachable is a number a player can never earn.
//
// THE NEGATIVE CONTROL is the literal 100 (section 2's `wrongCeiling`): it passes the level-1 check and fails at level 5,
// which is why the level-5 check exists and the level-1 one alone would not do.
//
// Usage: node game/test/score-line-probe.mjs   (engine must be built: `score.ts` and the bake both come from the game)
import { maxScore, parSeconds, scoreRun } from '../src/puzzle/score.ts';
import { scoreLine } from '../src/puzzle/score-line.ts';
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
const lineOf = (over = {}) => {
  const facts = factsOf(over);
  return scoreLine(scoreRun(facts), facts.level);
};

console.log('\n== 1. one line: the score, a slash, the ceiling — and nothing else ==');
{
  check(lineOf({ clockSeconds: 12 }) === '100/100', `a clean par run at L1 is exactly 100/100 (${lineOf({ clockSeconds: 12 })})`);
  // THE DENOMINATOR IS NOT NECESSARILY 100 EVEN WHEN THE NUMERATOR IS: a hinted par run at L1 keeps the ceiling and pays for
  // the hint in the numerator, so the line cannot be "the max / the max" by construction.
  const hinted = lineOf({ hintsUsed: 1 });
  check(hinted.endsWith('/100') && hinted !== '100/100', `a hinted par run reads its own score out of 100 (${hinted})`);
  // WHAT THE LINE MUST NOT CARRY. One check per removed thing, so a later edit that brought a star or a time back is named:
  // a "contains the score" test would pass every one of them.
  const shapes = [lineOf(), hinted, lineOf({ attempts: 1 }), lineOf({ level: levelSpec(5) })];
  const extras = shapes.filter((line) => /[★☆]|pts?|s\b|of|Clean|Solved|%/.test(line));
  check(extras.length === 0, `no stars, units, time, headline or percentage in any line (${extras.length} found)`, extras.join(' | '));
  check(shapes.every((line) => /^\d+\/\d+$/.test(line)), `every line is exactly score/ceiling (${shapes.join(' ')})`);
}

console.log('\n== 2. the ceiling is the score\'s own, not a literal 100 ==');
{
  check(maxScore(levelSpec(1)) === 100, `the level-1 ceiling is 100 (${maxScore(levelSpec(1))})`);
  check(maxScore(levelSpec(5)) === 500, `and the level-5 ceiling is 500 (${maxScore(levelSpec(5))})`);
  // NEGATIVE CONTROL, measured: the report's own example is "10/100", and a fixed denominator is the rule that produces it
  // at every level. It agrees with `maxScore` at L1 and disagrees at L5 — so the L5 check above is the one that rules it out.
  const wrongCeiling = () => 100;
  check(wrongCeiling(levelSpec(1)) === maxScore(levelSpec(1)), 'a literal 100 is indistinguishable at level 1');
  check(wrongCeiling(levelSpec(5)) !== maxScore(levelSpec(5)),
    'and is caught at level 5, where a perfect run is 500 (so the level-5 check is load-bearing)');
  // AND THE LINE USES THE ACTION'S CEILING, not the ceiling of some other level: a score from L5 is never shown "/100".
  const atFive = lineOf({ level: levelSpec(5) });
  check(atFive === '500/500', `a clean run at L5 reads 500/500, the same number on both sides (${atFive})`);
}

console.log('\n== 3. MEASURED over the baked season: every clean par run reaches its ceiling ==');
{
  check(SEASON_PUZZLES.length > 50, `the bake carries ${SEASON_PUZZLES.length} puzzles`);
  let reached = 0;
  const penalties = { overPar: 0, hinted: 0, retried: 0 };
  for (const puzzle of SEASON_PUZZLES) {
    const level = puzzle.level ?? levelSpec(1);
    const shortest = Math.max(1, puzzle.shortest);
    const par = parSeconds(shortest);
    /** The run a perfect player has: every call right first time, the shortest line, exactly par. */
    const perfect = { level, shortest, moves: shortest, clockSeconds: par, hintsUsed: 0, attempts: 0 };
    const line = scoreLine(scoreRun(perfect), level);
    if (line === `${maxScore(level)}/${maxScore(level)}`) reached++;
    // A PENALTY MUST MOVE THE LEFT SIDE AND NOT THE RIGHT: a line whose ceiling moved with the run would look stable while
    // every run "earned" the maximum.
    const scoreOf = (facts) => Number(scoreLine(scoreRun(facts), level).split('/')[0]);
    if (scoreOf({ ...perfect, clockSeconds: par * 1.5 }) < maxScore(level)) penalties.overPar++;
    if (scoreOf({ ...perfect, hintsUsed: 1 }) < maxScore(level)) penalties.hinted++;
    if (scoreOf({ ...perfect, attempts: 1 }) < maxScore(level)) penalties.retried++;
  }
  check(reached === SEASON_PUZZLES.length,
    `a clean par run reaches its own ceiling on all ${SEASON_PUZZLES.length} (${reached})`);
  check(penalties.overPar === SEASON_PUZZLES.length, `50 % over par drops below it on all of them (${penalties.overPar})`);
  check(penalties.hinted === SEASON_PUZZLES.length, `and so does one hint (${penalties.hinted})`);
  check(penalties.retried === SEASON_PUZZLES.length, `and one wrong answer (${penalties.retried})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
