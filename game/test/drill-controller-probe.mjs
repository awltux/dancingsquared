// The Drill's verdicts, pinned: which answer advances the puzzle, which does not, and what the illegal
// choice carries.
//
// THIS PROBE DRIVES A HAND-BUILT PUZZLE, NOT A GENERATED ONE, and that is deliberate. A generated puzzle
// would make the test depend on the generator, the pool and the corpus — three things whose change would
// show up here as a mysterious verdict failure. The rules under test are about ANSWERING, so the fixture is
// the smallest thing that can be answered: three boards, one step, one illegal call.
//
// WHAT EACH CHECK RULES OUT is named in its comment, and the two load-bearing ones are the answers that must
// NOT advance (`wrong` and `illegal`), because a controller that incremented on any click would still look
// right in a screenshot — the buttons would disable and a verdict would appear.
//
// Usage: node game/test/drill-controller-probe.mjs   (engine must be built)
import { DrillController } from '../src/game/drill.ts';
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** A one-dancer board. The controller never inspects geometry — `sameBoardById` compares id, x, y and
 * heading — so one dancer with a distinct x is enough to make every board distinguishable. */
const board = (x) => ({
  dancers: [{ id: 1, couple: 1, gender: 'boy', x, y: 0, heading: 0 }],
});

const level = { index: 1, poolSize: 10, depth: 1, optionCount: 2 };
const START = board(0);
const WRONG_END = board(1);
const GOAL = board(2);

const step = {
  from: START,
  moves: [
    { call: 'Wrong Way', board: WRONG_END },
    { call: 'Right Way', board: GOAL },
  ],
  correctIndex: 1,
  unknown: { call: 'Cannot Be Called', reason: 'No setup in this call matches the current formation.' },
  after: GOAL,
};

const puzzle = {
  mode: 'drill',
  seed: 1,
  level,
  poolVersion: 'test',
  start: START,
  goal: GOAL,
  path: [START, GOAL],
  steps: [step],
  solution: ['Right Way'],
  shortest: 1,
  alternatePath: false,
  explored: 1,
};

console.log('== the shape of a step the UI draws ==');
{
  const drill = new DrillController(puzzle);
  const view = drill.view();
  check(view.options.length === 2, `the view offers ${view.options.length} option(s)`);
  check(view.optionCount === level.optionCount, 'and reports the LEVEL\'s option count, not the number of options this step happened to get');
  check(view.unknown !== undefined, 'the illegal choice is present on the view');
  check(view.unknown && view.unknown.call === 'Cannot Be Called', 'and it names the refused call');
  check(view.stepIndex === 0 && view.stepCount === 1, `the view reports step ${view.stepIndex + 1} of ${view.stepCount}`);
  check(!view.atEnd, 'and that the puzzle is not yet solved');
  check(drill.isGoal(GOAL), 'the controller agrees the goal board IS the goal (the engine\'s own rule)');
  check(!drill.isGoal(WRONG_END), 'and that the wrong ending is not');
}

console.log('== a WRONG answer must NOT advance ==');
{
  const drill = new DrillController(puzzle);
  const result = drill.answer(0);
  check(result.kind === 'wrong', `option 0 is a wrong answer (got "${result.kind}")`);
  check(!drill.atEnd, 'and the puzzle is still unsolved');
  // THE CHECK THAT MATTERS: a controller that advanced on any click would show "wrong" and move on, which
  // looks like progress and teaches nothing.
  check(drill.view().stepIndex === 0, 'and the step index has NOT moved — a wrong answer does not skip the question');
  check(result.ending === WRONG_END, 'the result carries the board the wrong call reaches, so the view can replay to it');
  check(result.replayFrom === START, 'and the board it was played from, so the replay needs nothing but this result');
  check(result.call === 'Wrong Way', 'and the call that was played');
}

console.log('== the ILLEGAL answer must NOT advance, and must carry the ENGINE\'s reason ==');
{
  const drill = new DrillController(puzzle);
  const result = drill.answer('unknown');
  check(result.kind === 'illegal', `the illegal choice answers "illegal" (got "${result.kind}")`);
  check(result.reason === step.unknown.reason, 'the reason is the step\'s own string, character for character — the engine\'s prose is never reworded');
  check(result.call === 'Cannot Be Called', 'and it names the refused call');
  // AN ILLEGAL ANSWER HAS NO ENDING. An illegal application leaves the board unchanged, so a result carrying
  // an `ending` here would be inventing a board the engine never produced.
  check(result.ending === undefined, 'and it carries NO ending board, because an illegal apply leaves the board unchanged');
  check(drill.view().stepIndex === 0, 'and the step index has not moved');
}

console.log('== the CORRECT answer advances, and the last one solves ==');
{
  const drill = new DrillController(puzzle);
  const result = drill.answer(1);
  check(result.kind === 'correct', `option 1 is correct (got "${result.kind}")`);
  check(result.ending === GOAL, 'and it reports the goal board as the ending');
  check(drill.atEnd, 'the puzzle is now solved');
  const view = drill.view();
  check(view.atEnd, 'and the view says so');
  // THE VIEW MUST STILL BE READABLE AT THE END. The first version read `this.step` inside `view()`, which
  // throws once the index has passed the last step — so the one moment a caller most wants to draw was the
  // one moment it could not.
  check(view.from === GOAL, 'and it shows the goal board as "you are here", so the last frame is not the previous step');
  check(view.options.length === 2, 'and still offers the step\'s options for a review');
}

console.log('== the review names the answer, and an out-of-range click is a bug ==');
{
  const drill = new DrillController(puzzle);
  check(drill.review().call === 'Right Way', 'the review returns the correct option');
  check(drill.remainingSolution().length === 1 && drill.remainingSolution()[0] === 'Right Way', 'and the remaining solution is the one call');

  let threw = false;
  try {
    drill.answer(7);
  } catch {
    threw = true;
  }
  // AN OUT-OF-RANGE INDEX IS A UI BUG, NOT A WRONG ANSWER. Reporting it as `wrong` would tell the player they
  // chose something they were never shown, which is worse than a crash in a teaching tool.
  check(threw, 'asking for option 7 throws rather than reporting a wrong answer');
  check(drill.view().stepIndex === 0, 'and the machine is untouched by the throw');
}

console.log('== the ATTEMPT count prices every answer that was not correct ==');
{
  // THE DRILL'S ONE SCORE FACTOR, and it is a rule of the machine rather than of a screen (DESIGN.md 6: a
  // wrong option is a discrete event). It is also what the earning rule must NOT count: a drill is one
  // success however many tries it took (DESIGN.md 10), which is why this counts answers and not puzzles.
  const drill = new DrillController(puzzle);
  check(drill.attempts === 0, 'a fresh puzzle has taken no attempts');
  check(drill.view().attempts === 0, 'and the view says so');
  drill.answer(0);
  check(drill.attempts === 1, `a wrong answer is one attempt (${drill.attempts})`);
  drill.answer('unknown');
  // THE ILLEGAL ANSWER COUNTS TOO: the player committed to it. Excluding it would let a player price a guess
  // at nothing by always pressing the option that cannot be called.
  check(drill.attempts === 2, `and an illegal one counts as well (${drill.attempts})`);
  drill.answer(1);
  check(drill.attempts === 2, 'while the correct answer is not an attempt of its own');
  check(drill.atEnd && drill.view().attempts === 2, 'so a solved puzzle reports the two wrong answers it took');
  // NEGATIVE CONTROLS, BOTH MEASURED: counting EVERY answer once (the increment moved to the top of
  // `answer`) reddens exactly the two checks here that say a correct answer is not an attempt; counting only
  // `wrong` — the illegal branch's increment removed — reddens THREE, because the two later checks then read
  // a total that is one short as well. The discriminating check for the illegal case is the first of them.
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
