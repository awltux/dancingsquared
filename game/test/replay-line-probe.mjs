// A LINE'S CALL BOUNDARIES, pinned: the rule a replay's scrub stands on.
//
// WHY THIS IS A GATE. The transport (a scrub over the calls of a recorded line plus one play/pause button) needs to
// answer two questions on every frame — "which call is the playhead inside" and "where does call k begin" — and both are
// arithmetic that a screen would otherwise own. AGENTS.md §8 trap 27 is the cost of leaving that kind of rule in a
// screen: it is unmeasured, and its own prose will not catch it. So the rule is `puzzle/replay-line.ts` and this probe
// measures it on a line the GENERATOR produced, from motions the APPLIER produced.
//
// THE TWO FACTS THAT MAKE THE MODULE POSSIBLE, both measured here rather than assumed:
//   1. per-call beats ADD UP to the whole line's beats (the applier exposes only a total, so the boundaries are built
//      by walking the line one call at a time) — MEASURED over 8 generated level-1 Dailies at 8 of 8, re-checked here;
//   2. seeking to a boundary shows the board the line is on at that call — the property the scrub's click relies on.
//
// Usage: node game/test/replay-line-probe.mjs   (engine must be built)

import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { dailySpec, levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { callAt, replayLine, startsAt, totalBeats } from '../src/puzzle/replay-line.ts';
import { applierFor } from '../src/data/corpus-node.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = levelSpec(1);
const spec = dailySpec(LEVEL);
const { applier } = applierFor(poolFor(LEVEL, MAIN_POOL), LEVEL.poolSize);

const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec, 'daily'), 2026_10_15, spec, applier);
check(built.ok, `the probe's seed generates${built.ok ? '' : `: ${built.reason}`}`);
const puzzle = built.puzzle;
const calls = puzzle.solution;

/** The line as the shell builds it: one motion per call, from the board the previous call left. */
function measure() {
  const perCall = [];
  const boards = [puzzle.start];
  let board = puzzle.start;
  for (const call of calls) {
    perCall.push(applier.motion([call], board).beats);
    board = applier.apply(board, call);
    boards.push(board);
  }
  return { perCall, boards, whole: applier.motion(calls, puzzle.start) };
}
const { perCall, boards, whole } = measure();
const line = replayLine(calls, perCall);

console.log('== 1. the boundaries are the engine\'s own beats ==');
{
  check(perCall.every((beats) => beats > 0), `every call is charged at least one beat (${perCall.join(', ')})`);
  // THE FACT THE WHOLE DESIGN RESTS ON: a total-only API can be split, because the parts add up.
  check(perCall.reduce((sum, beats) => sum + beats, 0) === whole.beats,
    `the per-call beats add up to the line's own total (${perCall.join(' + ')} = ${whole.beats})`);
  check(totalBeats(line) === whole.beats, `and the line's total is that number (${totalBeats(line)})`);
}

console.log('\n== 2. a boundary belongs to the NEXT call ==');
{
  let forward = true;
  for (let k = 1; k < line.ends.length; k++) if (line.ends[k] < line.ends[k - 1]) forward = false;
  check(forward, `the boundaries never go backwards (${line.ends.join(', ')})`);
  check(callAt(line, 0) === 0, 'beat 0 is inside the first call');
  let boundaries = 0;
  for (let k = 0; k < calls.length; k++) if (callAt(line, line.ends[k]) === k + 1) boundaries++;
  check(boundaries === calls.length, `each boundary is the START of the next call (${boundaries} of ${calls.length})`);
  check(callAt(line, totalBeats(line)) === calls.length, 'the line\'s end is past the last call, not inside it');
  check(callAt(line, totalBeats(line) + 10) === calls.length, 'and a beat past the end stays there, so a stale tile cannot index a call that is over');
  check(callAt(line, -5) === 0, 'and a negative beat clamps to the start rather than throwing');
  // THE NEGATIVE CONTROL: the plausible wrong rule is the same scan with `<=`, which is right everywhere except ON a
  // boundary — and a screenshot cannot see the difference. It fails exactly the check above, not the others.
  const wrong = (beat) => {
    const at = Math.max(0, beat);
    for (let k = 0; k < line.ends.length; k++) if (at <= line.ends[k]) return k;
    return calls.length;
  };
  check(wrong(line.ends[0]) === 0 && callAt(line, line.ends[0]) === 1,
    `NEGATIVE CONTROL: the \`<=\` rule reports call 0 at beat ${line.ends[0]} where the rule reports call 1`);
  // THE TWO RULES AGREE ON EVERY WHOLE BEAT, which is why only a boundary check catches the wrong one: the beats are
  // FRACTIONAL (4.6, 10.1, …), so an integer sweep walks past each boundary without landing on it.
  const whole = Math.floor(totalBeats(line));
  let agree = 0;
  for (let beat = 0; beat <= whole; beat++) if (wrong(beat) === callAt(line, beat)) agree++;
  check(agree === whole + 1, `and the two agree on all ${whole + 1} whole beats in the line, so an integer sweep cannot tell them apart`);
}

console.log('\n== 3. the scrub\'s stop for call k shows the board after k calls ==');
{
  /** How far apart two boards are, in units — with a heading difference wrapped to [-π, π], which is what it means. */
  const apart = (a, b) => {
    const wrap = (angle) => Math.abs((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    let worst = 0;
    for (let d = 0; d < a.dancers.length; d++) {
      worst = Math.max(worst, Math.abs(a.dancers[d].x - b.dancers[d].x), Math.abs(a.dancers[d].y - b.dancers[d].y), wrap(a.dancers[d].heading - b.dancers[d].heading));
    }
    return worst;
  };
  // A TOLERANCE, AND IT IS THE POINT RATHER THAN A CONCESSION: the boundary beat is a SUM OF FLOATS, so sampling at it
  // lands a hair into the next call — MEASURED worst 4.2e-4 units on a board about eight units across (0.005%), which
  // is a picture the player cannot tell from the boundary and is exactly what the scrub shows. The check below the
  // sweep is the control that says this tolerance is not hiding the error: one beat earlier is a different picture.
  const TOLERANCE = 1e-3;
  let sought = 0;
  let worstDelta = 0;
  for (let k = 0; k <= calls.length; k++) {
    const delta = apart(whole.at(startsAt(line, k)), boards[k]);
    worstDelta = Math.max(worstDelta, delta);
    if (delta <= TOLERANCE) sought++;
  }
  check(sought === calls.length + 1, `every stop of the scrub is the right board, to within ${TOLERANCE} unit (${sought} of ${calls.length + 1}, worst ${worstDelta.toExponential(1)})`);
  check(apart(whole.at(startsAt(line, 1) - 1), boards[1]) > 0.1,
    `NEGATIVE CONTROL: a beat earlier is a DIFFERENT picture (${apart(whole.at(startsAt(line, 1) - 1), boards[1]).toFixed(2)} units), so the tolerance is not hiding a wrong stop`);
  check(startsAt(line, 0) === 0, 'the first stop is the start of the line');
  check(startsAt(line, calls.length) === totalBeats(line), 'and the last stop is its end');
  check(startsAt(line, calls.length + 3) === totalBeats(line) && startsAt(line, -2) === 0,
    'a stop past either end clamps, so a malformed index cannot take the replay off its own timeline');
  check(startsAt(line, 1) === line.ends[0], `stop 1 begins where call 0 finished (${startsAt(line, 1)})`);
}

console.log('\n== 4. an empty line is a line, not an error ==');
{
  const empty = replayLine([], []);
  check(totalBeats(empty) === 0 && callAt(empty, 0) === 0 && startsAt(empty, 0) === 0, 'an empty line has no beats and no calls, and the scrub reads sensibly');
  const mismatched = (() => {
    try {
      replayLine(['Dosado'], []);
      return 'no error';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  })();
  check(typeof mismatched === 'string' && mismatched.includes('one beat count per call'),
    `a line whose beats do not match its calls is refused rather than truncated (${mismatched})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
