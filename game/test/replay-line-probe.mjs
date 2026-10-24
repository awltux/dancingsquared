// A LINE'S CALL BOUNDARIES, pinned: the rule the panel's HIGHLIGHT stands on.
//
// WHY THIS IS A GATE. While a recorded line plays, the panel highlights the call being played, so every frame asks
// "which call is the playhead inside" — arithmetic a screen would otherwise own. AGENTS.md §8 trap 27 is the cost of
// leaving that kind of rule in a screen: it is unmeasured, and its own prose will not catch it. So the rule is
// `puzzle/replay-line.ts` and this probe measures it on a line the GENERATOR produced, from motions the APPLIER
// produced.
//
// THE FACT THAT MAKES THE MODULE POSSIBLE, measured here rather than assumed: the applier exposes only a TOTAL beat
// count for a list, so the boundaries are built by walking the line one call at a time — which only means anything if
// the per-call beats ADD UP to the whole line's. MEASURED over 8 generated level-1 Dailies at 8 of 8, re-checked here.
//
// Usage: node game/test/replay-line-probe.mjs   (engine must be built)
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { dailySpec, levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { callAt, replayLine } from '../src/puzzle/replay-line.ts';
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
const perCall = [];
let board = puzzle.start;
for (const call of calls) {
  perCall.push(applier.motion([call], board).beats);
  board = applier.apply(board, call);
}
const whole = applier.motion(calls, puzzle.start);
const line = replayLine(calls, perCall);
const total = line.ends[line.ends.length - 1];

console.log('== 1. the boundaries are the engine\'s own beats ==');
{
  check(perCall.every((beats) => beats > 0), `every call is charged at least one beat (${perCall.join(', ')})`);
  // THE FACT THE WHOLE DESIGN RESTS ON: a total-only API can be split, because the parts add up.
  check(perCall.reduce((sum, beats) => sum + beats, 0) === whole.beats,
    `the per-call beats add up to the line's own total (${perCall.join(' + ')} = ${whole.beats})`);
  check(total === whole.beats, `and the line's last boundary is that number (${total})`);
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
  check(callAt(line, total) === calls.length, 'the line\'s end is past the last call, not inside it');
  check(callAt(line, total + 10) === calls.length, 'and a beat past the end stays there, so a stale frame cannot highlight a call that is over');
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
  const wholeBeats = Math.floor(total);
  let agree = 0;
  for (let beat = 0; beat <= wholeBeats; beat++) if (wrong(beat) === callAt(line, beat)) agree++;
  check(agree === wholeBeats + 1, `and the two agree on all ${wholeBeats + 1} whole beats in the line, so an integer sweep cannot tell them apart`);
}

console.log('\n== 3. every call is reachable, in order, and none is skipped ==');
{
  // THE PROPERTY THE HIGHLIGHT NEEDS: as the playhead walks the line, `callAt` visits every call exactly once and never
  // goes back. A mapping that reported two calls for one beat, or skipped one, would light the list wrongly for the whole
  // of a call — the failure mode a screenshot of the first frame cannot show.
  const seen = [];
  for (let beat = 0; beat < total; beat += 0.25) {
    const at = callAt(line, beat);
    if (seen[seen.length - 1] !== at) seen.push(at);
  }
  check(seen.length === calls.length && seen.every((value, index) => value === index),
    `walking the line in quarter-beats visits every call once, in order (${seen.join(', ')})`);
  check(callAt(line, line.ends[calls.length - 1] - 0.01) === calls.length - 1, 'and the last call is highlighted until its own beat is spent');
}

console.log('\n== 4. an empty line is a line, not an error ==');
{
  const empty = replayLine([], []);
  check(callAt(empty, 0) === 0 && callAt(empty, 5) === 0, 'an empty line has no beats and the highlight reads sensibly');
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
