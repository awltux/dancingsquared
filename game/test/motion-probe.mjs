// THE ENGINE'S MOTION, pinned: a replay is the dance the call authors, it lands on the board every verdict
// was computed against, and it costs less than a frame.
//
// WHY THIS REPLACED A TWEEN PROBE. Until Phase 3 a replay interpolated in a straight line between two boards,
// and `tween-probe.mjs` pinned that line's endpoints, its identity matching and its short-arc heading. All
// three of those properties are now the ENGINE'S (`evaluateSequence` walks the authored path), so the
// properties worth pinning changed shape:
//
//   * THE ENDPOINT IS STILL THE LOAD-BEARING ONE. A replay is the picture that accompanies a verdict, so if
//     its last frame is not the board the verdict was computed against, the game shows one board and scores
//     another. Check 3 pins it against the board a real `PlaySession` reaches by playing the same calls, using
//     the engine's own `sameBoardById`.
//   * THE PATH IS NOW CHECKED, not merely un-pinned: check 7 measures how far a mid-call frame departs from
//     the straight line between the endpoints. A chord implementation scores exactly ZERO there, which is what
//     makes that check the one that proves the authored path is in use.
//   * THE COST IS CHECKED because this runs per animation frame on the client (DESIGN.md 4.3). The number is
//     printed rather than assumed.
//
// Usage: node game/test/motion-probe.mjs   (engine must be built)
import { sameBoardById } from 'dancing-squared-engine';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { PlaySession } from '../src/puzzle/session.ts';
import { LOCAL_SCHEDULE } from '../src/game/schedule-fixture.ts';
import { applierFor } from './lib/corpus.mjs';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** The engine tolerance is 1e-6, so "the same board" is asked through the engine rather than by field
 * equality — a regenerated or walked board is a different object graph. */
const same = (a, b) => sameBoardById(a, b);
const ids = (board) => board.dancers.map((d) => d.id).join(',');
const mid = (a, b) => a.dancers.map((d) => ({ id: d.id, x: d.x + (b.dancers.find((e) => e.id === d.id).x - d.x) / 2, y: d.y + (b.dancers.find((e) => e.id === d.id).y - d.y) / 2 }));

/** One real puzzle from the committed fixture: seed 1 at level 2 (depth 2, pool 15). */
const entry = LOCAL_SCHEDULE.find((e) => e.seed === 1 && e.levelIndex === 2);
const LEVEL = levelSpec(entry.levelIndex);
const { applier, registered } = applierFor(poolFor(LEVEL, MAIN_POOL), LEVEL.poolSize);
const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, LEVEL), entry.seed, LEVEL, applier);
if (!built.ok) {
  console.log(`the fixture entry does not generate: ${built.reason}`);
  process.exit(1);
}
const puzzle = built.puzzle;
console.log(`== the puzzle under test: L${LEVEL.index}, pool ${registered}, ${puzzle.steps.length} step(s), solution ${puzzle.solution.join(' -> ')} ==`);

console.log('\n== 1. a legal line walks, and it takes beats to do it ==');
const walk = applier.motion(puzzle.solution, puzzle.start);
{
  check(walk.beats > 0, `the intended solution is charged some beats (${walk.beats})`);
  check(walk.stop === null, 'and the walk reaches the end of the list rather than stopping part way');
}

console.log('\n== 2. beat 0 is the board the player is standing on ==');
{
  check(same(walk.at(0), puzzle.start), 'the first frame is the start board');
  // Clamping, both ways: a negative beat is the start and a beat past the end is the landing board, so a
  // clock glitch cannot extrapolate a dancer off the floor.
  check(same(walk.at(-5), puzzle.start), 'a negative beat clamps to the start');
  check(same(walk.at(walk.beats + 100), walk.at(walk.beats)), 'and a beat past the end clamps to the landing board');
}

console.log('\n== 3. the LAST FRAME is the board the verdict was computed against ==');
{
  // THE PROPERTY THE WHOLE MODE RESTS ON. `PlaySession` reaches its board by APPLYING each call; the motion
  // reaches its by WALKING them. If those two disagree, the player is shown one board and scored against
  // another — and the failure is invisible, because both boards look like a square of dancers.
  const session = new PlaySession(puzzle, applier);
  for (const call of puzzle.solution) session.play(call);
  check(same(session.board, puzzle.goal), 'the session reaches the puzzle goal by playing the solution');
  check(same(walk.at(walk.beats), session.board), 'and the walk lands on exactly that board');
  check(same(walk.at(walk.beats), puzzle.goal), 'which is the goal the puzzle published');
}

console.log('\n== 4. every frame is indexable by the board the renderer is bound to ==');
{
  // The renderer builds one `DancerView` per dancer and hands pose `i` to view `i`, and a frame whose id list
  // differs from the previous frame's makes it rebuild every avatar. The engine carries identity through
  // (`reorderLike`), so this pins that the walk does not re-order the set on its way.
  const want = ids(puzzle.start);
  let reordered = 0;
  let frames = 0;
  for (let b = 0; b <= walk.beats; b += 0.5) {
    frames++;
    if (ids(walk.at(b)) !== want) reordered++;
  }
  check(reordered === 0, `all ${frames} sampled frame(s) array the dancers as the start board does (${reordered} did not)`);
  check(walk.at(walk.beats / 2).dancers.length === puzzle.start.dancers.length, 'and every frame has the same dancer count');
}

console.log('\n== 5. a single call lands on the option board the Drill stored ==');
{
  // The Drill's replay is a one-call motion, and the board it must end on is the one the option and the
  // verdict carry (`PuzzleStep.moves[i].board`). This is the same equality as check 3, one call at a time.
  const step = puzzle.steps[0];
  let mismatched = 0;
  let minBeats = Infinity;
  for (const option of step.moves) {
    const one = applier.motion([option.call], step.from);
    minBeats = Math.min(minBeats, one.beats);
    if (one.beats <= 0 || !same(one.at(one.beats), option.board)) mismatched++;
  }
  check(mismatched === 0, `every one of the ${step.moves.length} option(s) lands on its own stored ending board (${mismatched} did not)`);
  check(minBeats > 0, `and each is charged beats to dance (shortest ${minBeats})`);
}

console.log('\n== 6. a call the engine refuses stops at beat 0, with the engine\'s own reason ==');
{
  // The Drill's illegal option. There is no motion to show — an illegal application leaves the board alone —
  // and DESIGN.md 4.3 asks for the point it stopped at plus the engine's reason, verbatim.
  const step = puzzle.steps[0];
  const refusal = applier.refusalOf(step.from, step.unknown.call);
  const refused = applier.motion([step.unknown.call], step.from);
  check(refused.beats === 0, `a refused call is charged no beats (${refused.beats})`);
  check(refused.stop !== null && refused.stop.index === 0, 'and the walk reports that it stopped at the first step');
  check(refused.stop.call === step.unknown.call, `and names the call that stopped it (${refused.stop?.call})`);
  check(refusal !== null && refused.stop.reason === refusal.reason, 'and carries the engine\'s reason verbatim, the same string a refusal path gives');
  check(same(refused.at(0), step.from), 'and the picture is the board the player is standing on');
}

console.log('\n== 7. the path is the ENGINE\'S, not a straight line between the boards ==');
{
  // MEASURED: how far the engine's frame at half a call departs from the chord between the endpoints, over
  // every option of the first step. NEGATIVE CONTROL, MEASURED with a chord implementation in `motion.at`
  // (position AND heading interpolated, so the endpoints and the identity order still check out): this is the
  // ONLY check that reddens, and it reports a deviation of exactly 0.000.
  const step = puzzle.steps[0];
  let worst = 0;
  let worstCall = '';
  for (const option of step.moves) {
    const one = applier.motion([option.call], step.from);
    if (one.beats <= 0) continue;
    const frame = one.at(one.beats / 2);
    const chord = mid(step.from, option.board);
    for (const d of frame.dancers) {
      const c = chord.find((p) => p.id === d.id);
      const dev = Math.hypot(d.x - c.x, d.y - c.y);
      if (dev > worst) {
        worst = dev;
        worstCall = option.call;
      }
    }
  }
  check(worst > 0.05, `the engine's mid-call frame leaves the chord by at least 0.05 board units (worst ${worst.toFixed(3)} on "${worstCall}")`);
  console.log(`       a chord between the same two boards would score 0.000 here`);
}

console.log('\n== 8. sampling a frame is cheap enough for the frame loop ==');
{
  // THE BUDGET THAT MATTERS IS THE CLIENT'S (DESIGN.md 7.1 applies the same argument to generation): this runs
  // per animation frame. 16 ms is one frame at 60 fps, which is a generous bound for one `at()` call.
  const samples = 400;
  let worstMs = 0;
  for (let i = 0; i < samples; i++) {
    const beat = (i / samples) * walk.beats;
    const t = process.hrtime.bigint();
    walk.at(beat);
    worstMs = Math.max(worstMs, Number(process.hrtime.bigint() - t) / 1e6);
  }
  console.log(`       worst single frame over ${samples} samples: ${worstMs.toFixed(3)} ms`);
  check(worstMs < 16, `a sampled frame stays inside one 60 fps frame (worst ${worstMs.toFixed(3)} ms)`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
