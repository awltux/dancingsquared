// THE SCORE, pinned: par is derived, a hint is exactly one added minute, and no run can score more by
// taking longer, wandering further or answering wrong more often.
//
// WHY THIS IS A GATE AND NOT A NOTE. The same arithmetic decides the number the player is shown and the
// maximum the server will accept for the same run (DESIGN.md 6), and every weight in it is a CHOSEN number
// with no playtest data behind it — so the SHAPE is the only thing that can be checked, and the shape is
// what these checks are about. Each names the plausible wrong rule it rules out.
//
// THE ONE CHECK WORTH READING FIRST is section 2: DESIGN.md 6 says a hint is "one added term, not a
// multiplier", and that is an EQUALITY rather than an inequality — a run with one hint and no thinking time
// must score exactly what a run with no hint and one minute of thinking time scores.
//
// Usage: node game/test/score-probe.mjs   (no engine, no corpus — this module is pure arithmetic)
import { elapsedSeconds, parSeconds, scoreRun } from '../src/puzzle/score.ts';
import { ATTEMPT_PENALTY, BASE_SCORE, HINT_PENALTY_SECONDS, MIN_RUN_SCORE, SECONDS_PER_CALL } from '../src/puzzle/config.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const level = (index) => ({ index, poolSize: 10 + index, depth: 2, optionCount: 2 });
/** A run that is perfect unless a field says otherwise: on par, no wasted calls, no hints, no retries. */
const perfect = (over = {}) => ({
  level: level(1),
  shortest: 2,
  moves: 2,
  clockSeconds: parSeconds(2),
  hintsUsed: 0,
  attempts: 0,
  ...over,
});
const score = (over) => scoreRun(perfect(over)).score;

console.log('== 1. par is DERIVED from the shortest solution, never hand-set ==');
{
  check(parSeconds(1) === SECONDS_PER_CALL, `one call is ${SECONDS_PER_CALL} seconds (${parSeconds(1)})`);
  check(parSeconds(3) === 3 * SECONDS_PER_CALL, `and three calls are three times that (${parSeconds(3)})`);
  check(parSeconds(0) === 0, 'and the degenerate zero is zero rather than a special case');
  // Negative control: a hand-set par (the same number whatever the puzzle) fails the second check and
  // nothing else. DESIGN.md 6 is explicit that par is derived, because a hand-set one drifts from the
  // generator's own answer the moment the ladder changes.
}

console.log('\n== 2. a hint is ONE ADDED MINUTE, not a multiplier ==');
{
  check(elapsedSeconds(0, 0) === 0, 'no clock and no hint is zero seconds');
  check(elapsedSeconds(0, 1) === HINT_PENALTY_SECONDS, `one hint on a zero clock is exactly ${HINT_PENALTY_SECONDS} seconds`);
  check(elapsedSeconds(30, 2) === 30 + 2 * HINT_PENALTY_SECONDS, 'and the charges add to whatever the clock says');
  check(HINT_PENALTY_SECONDS === 60, 'and the shipped penalty is a minute, which is what the design promises a player');
  // THE EQUALITY, and the reason it is an equality rather than a band: "a hint costs a minute of your own
  // time" is a claim a player can check by thinking for a minute instead.
  check(
    score({ hintsUsed: 1, clockSeconds: 0 }) === score({ hintsUsed: 0, clockSeconds: HINT_PENALTY_SECONDS }),
    `one hint with no thinking time scores exactly what a minute of thinking scores (${score({ hintsUsed: 1, clockSeconds: 0 })} vs ${score({ hintsUsed: 0, clockSeconds: 60 })})`,
  );
  // Negative control, MEASURED: making the hint a multiplier (`elapsed × (1 + hints)`) reddens the three
  // checks in this section — the two direct elapsed readings and the equality — and nothing outside it.
}

console.log('\n== 3. no run scores better by being slower, longer or wrong more often ==');
{
  const sweep = (field, values, over = {}) => values.map((v) => score({ ...over, [field]: v }));
  const nonIncreasing = (label, values) => {
    let ok = true;
    for (let i = 1; i < values.length; i++) if (values[i] > values[i - 1]) ok = false;
    check(ok, `${label} never increases the score (${values.join(' ')})`);
  };
  // Negative control, MEASURED: a factor written as `actual / expected` instead of `expected / actual` —
  // the inversion that looks harmless and rewards dawdling — reddens four checks: the time sweep, the move
  // sweep, "worth less than a clean run", and the reported waste factor. The ATTEMPT sweep is unaffected,
  // because that factor is written directly rather than through `ratio`.
  nonIncreasing('waiting longer (0..600 s)', sweep('clockSeconds', [0, 15, 30, 60, 120, 300, 600]));
  nonIncreasing('playing more calls (2..6)', sweep('moves', [2, 3, 4, 5, 6]));
  nonIncreasing('answering wrong more often (0..5)', sweep('attempts', [0, 1, 2, 3, 4, 5]));
  check(score({ moves: 2 }) === score({ moves: 1 }), 'and MOVING FEWER CALLS THAN THE SHORTEST cannot pay: the waste factor is capped at 1, not unbounded');
  check(score({ clockSeconds: 0 }) === score({ clockSeconds: parSeconds(2) }), 'nor does solving faster than par pay more');
}

console.log('\n== 4. a perfect run is worth the base, and a solved run is never worth nothing ==');
{
  // MEASURED: the maximum at level 5 is BASE_SCORE × 5, because all three factors are exactly 1 there.
  check(score({ level: level(5) }) === BASE_SCORE * 5, `a perfect run at L5 is ${BASE_SCORE * 5} (${score({ level: level(5) })})`);
  check(score({ level: level(5) }) > score({ level: level(4) }), 'and a harder level is worth more than an easier one');
  const awful = scoreRun({ level: level(1), shortest: 1, moves: 4, clockSeconds: 480, hintsUsed: 3, attempts: 6 });
  check(Number.isInteger(awful.score), `the score is an integer (${awful.score})`);
  check(awful.score >= MIN_RUN_SCORE, `and never below the floor ${MIN_RUN_SCORE}, however badly it went (${awful.score})`);
  // Negative control, MEASURED: removing the floor reddens exactly this check — the raw value for that run
  // rounds to 0, and 0 is the score of NOT having solved the puzzle.
  check(awful.score < score({}), 'while still being worth less than a clean run');
  check(awful.attemptFactor === 1 / (1 + ATTEMPT_PENALTY * 6), `the attempt factor is the stated penalty shape (${awful.attemptFactor})`);
}

console.log('\n== 5. the terms are reported, so a caller can read the working ==');
{
  const r = scoreRun(perfect({ clockSeconds: 30, moves: 3, attempts: 1 }));
  const expected = Math.max(MIN_RUN_SCORE, Math.round(BASE_SCORE * 1 * r.timeFactor * r.wasteFactor * r.attemptFactor));
  check(r.score === expected, 'the score IS the product of the reported factors, rounded, floored');
  check(r.parSeconds === parSeconds(2), 'and the par it was judged against is reported');
  check(r.timeFactor === parSeconds(2) / 30, `a 30-second run against a ${parSeconds(2)}-second par is ${r.timeFactor.toFixed(4)}`);
  check(r.wasteFactor === 2 / 3, `three calls against a two-call shortest is ${r.wasteFactor.toFixed(4)}`);
  check(Number.isFinite(r.score) && Number.isFinite(r.timeFactor), 'and nothing here can be NaN');
  // A zero-length puzzle cannot divide by zero: `shortest` is at least 1 for any real level, and the
  // helpers guard the degenerate case rather than relying on that.
  const degenerate = scoreRun({ level: level(1), shortest: 0, moves: 0, clockSeconds: 0, hintsUsed: 0, attempts: 0 });
  check(Number.isFinite(degenerate.score) && degenerate.score === BASE_SCORE, `a degenerate zero-call puzzle still scores finitely (${degenerate.score})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
