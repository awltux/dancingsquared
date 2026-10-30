// THE LEVEL BLOCK: one cell per drill, and the FIVE states a cell can be in.
//
// WHY THIS IS A GATE. The grid is the level screen's only decision — done, done-and-passed, next, published, never
// published — and a rule that lives in a screen cannot be imported by a probe (AGENTS.md §8 trap 27: the Daily's
// click logic lived in `daily-screen.ts`, was unmeasurable, and shipped broken while every probe was green). The
// rule is `puzzle/block.ts` and this is the probe.
//
// EVERY CHECK BELOW HAS A NEGATIVE CONTROL, and the ones that matter are named where they are:
//   * a block that returns `length` cells instead of `CELL_COUNT` — caught by section 1 whenever `length` < 100,
//     which is the ordinary case today (the fixture publishes 4);
//   * a block that lets a stale `next` paint a FINISHED cell — caught by section 4;
//   * a block that trusts `passed` over `finished` — caught by section 6;
//   * a grid that LOCKS a skipped drill — caught by section 7, which is the rule that made this a defect report.
//
// Usage: node game/test/block-probe.mjs
import { blockCells, blockPercent, blockSummary, isReplayable, isWatchable, CELL_COUNT } from '../src/puzzle/block.ts';
import { LEVEL_SIZE } from '../src/puzzle/levels.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
const states = (cells) => cells.map((c) => c.state);
const at = (cells, i) => cells[i]?.state;

console.log(`== 1. the block is ${CELL_COUNT} cells, numbered from 0 ==`);
check(CELL_COUNT === LEVEL_SIZE, `the block is LEVEL_SIZE drills (${CELL_COUNT} vs ${LEVEL_SIZE})`);
{
  const cells = blockCells({ length: 4, finished: [], passed: [], next: 0 });
  check(cells.length === CELL_COUNT, `${CELL_COUNT} cells for a 4-drill level, not 4 (${cells.length})`);
  check(cells.every((c, i) => c.index === i), 'each cell knows its own index, in row-major order');
}

console.log('\n== 2. a cell past the published length is UNPUBLISHED, not locked ==');
{
  const cells = blockCells({ length: 4, finished: [], passed: [], next: 0 });
  check(at(cells, 0) === 'next', 'the first drill is next');
  check(at(cells, 3) === 'published', `the fourth is published and unfinished (${at(cells, 3)})`);
  check(at(cells, 4) === 'unpublished', `the fifth has no drill at all (${at(cells, 4)})`);
  check(states(cells).filter((s) => s === 'unpublished').length === CELL_COUNT - 4,
    `and the rest are unpublished (${states(cells).filter((s) => s === 'unpublished').length})`);
}

console.log('\n== 3. PASSED and FINISHED draw differently, which is the grid’s reason to exist ==');
{
  const cells = blockCells({ length: 6, finished: [0, 1, 2], passed: [0, 2], next: 3 });
  check(at(cells, 0) === 'done-passed', `a solved drill is done and passed (${at(cells, 0)})`);
  check(at(cells, 1) === 'done-not-passed', `a skipped drill is done and NOT passed (${at(cells, 1)})`);
  check(at(cells, 2) === 'done-passed', 'and a revealed-then-solved one is decided by the PASS set, not by order');
  check(at(cells, 3) === 'next' && at(cells, 4) === 'published', 'the first unfinished drill is next; later ones are not');
}

console.log('\n== 4. a FINISHED cell wins over a stale `next` — the negative control for precedence ==');
{
  // The server can hand out an index the row already calls finished (a republished schedule, a hand-edited row). A
  // grid that checked `next` first would paint a done cell as the one to play, and the player would be sent back.
  const cells = blockCells({ length: 5, finished: [1], passed: [], next: 1 });
  check(at(cells, 1) === 'done-not-passed', `a finished cell is not repainted as next (${at(cells, 1)})`);
  check(states(cells).filter((s) => s === 'next').length === 0, 'and no cell claims to be next');
  // NEGATIVE CONTROL for the precedence itself: the same input judged by "next first" yields 1 next and 0 done.
  const wrong = (i) => (i === 1 ? 'next' : i < 5 ? 'published' : 'unpublished');
  check(wrong(1) === 'next', 'NEGATIVE CONTROL: a next-first rule repaints it, so this check is not vacuous');
}

console.log('\n== 5. a GAP is visible: finished [0,2] with a next of 1 ==');
{
  const cells = blockCells({ length: 5, finished: [0, 2], passed: [0], next: 1 });
  check(at(cells, 0) === 'done-passed' && at(cells, 1) === 'next' && at(cells, 2) === 'done-not-passed',
    `the gap does not shift the cells (${[0, 1, 2].map((i) => at(cells, i)).join(', ')})`);
  check(at(cells, 3) === 'published' && at(cells, 4) === 'published',
    'and the unfinished cells after the gap are published, not next');
  const summary = blockSummary(cells);
  check(summary.done === 2 && summary.passed === 1 && summary.published === 5 && summary.total === CELL_COUNT,
    `the summary counts its own denominator (${summary.done} done, ${summary.passed} passed, ${summary.published} published of ${summary.total})`);
}

console.log('\n== 5b. the header\'s percentage is that summary\'s fraction, FLOORED ==');
{
  // REPORTED: "The level is displayed in the header e.g. 'L1' Add a percentage value after the level to show how much of the
  // level has been completed e.g. L1: 40%". `blockPercent` is the rule; the header only formats it.
  check(blockPercent({ done: 0, published: 100 }) === 0, `nothing done is 0% (${blockPercent({ done: 0, published: 100 })})`);
  check(blockPercent({ done: 40, published: 100 }) === 40, `40 of 100 is 40% (${blockPercent({ done: 40, published: 100 })})`);
  check(blockPercent({ done: 100, published: 100 }) === 100, `a finished block is 100% (${blockPercent({ done: 100, published: 100 })})`);
  check(blockPercent({ done: 1, published: 3 }) === 33, `a third is 33%, never 34 (${blockPercent({ done: 1, published: 3 })})`);
  // THE FLOOR IS THE RULE: a percentage is read as "how far through am I", so it must not say 100 while a cell is open.
  check(blockPercent({ done: 199, published: 200 }) === 99,
    `199 of 200 is 99, not the 100 a round would claim (${blockPercent({ done: 199, published: 200 })})`);
  // NEGATIVE CONTROL: the plausible wrong rule — `Math.round` — answers 100 for that case, which is a header claiming a level
  // is finished one drill early. Only the check above reddens for it.
  check(Math.round((100 * 199) / 200) === 100 && blockPercent({ done: 199, published: 200 }) !== 100,
    'CONTROL: rounding would say 100 with a drill still open');
  // NOTHING PUBLISHED IS NO PERCENTAGE, not zero: an empty block is a fact about the set, not about progress.
  check(blockPercent({ done: 0, published: 0 }) === null, 'an empty block has no percentage at all');
  // A COUNT PAST THE DENOMINATOR IS CLAMPED rather than printed as 140%.
  check(blockPercent({ done: 140, published: 100 }) === 100, `a count past the block is clamped (${blockPercent({ done: 140, published: 100 })})`);
}

console.log('\n== 6. `passed` is trusted ONLY where `finished` agrees — the screen is not more credulous than the parser ==');
{
  const cells = blockCells({ length: 5, finished: [0], passed: [0, 3], next: 1 });
  check(at(cells, 0) === 'done-passed', 'a pass on a finished position is honoured');
  check(at(cells, 3) === 'published', `a pass on an UNFINISHED position is ignored (${at(cells, 3)})`);
  // NEGATIVE CONTROL: trusting the pass set alone would paint cell 3 as done-and-passed.
  check(blockCells({ length: 5, finished: [], passed: [3], next: 0 })[3].state === 'published',
    'NEGATIVE CONTROL: a pass with no finish leaves the cell published');
}

console.log('\n== 7. A SKIPPED CELL IS A CONTROL: which states offer a reattempt ==');
{
  // THE REPORTED DEFECT, as a rule: "the player has to be able to reattempt drills that are skipped, currently they are
  // locked off". The grid still paints five states; what changed is that one of them is now pressable, and this is the
  // rule that decides it — so the screen cannot drift from it and the probe is where the decision lives.
  const cells = blockCells({ length: 6, finished: [0, 1, 2], passed: [0, 2], next: 3 });
  check(isReplayable(at(cells, 1)), `a skipped cell (done, not passed) offers a reattempt (${at(cells, 1)})`);
  // EVERY OTHER STATE IS EXCLUDED, each for its own reason (see `isReplayable`'s comment), and these are the negative
  // controls: a rule written as "anything done" would pass the first check and fail this one at position 0.
  check(!isReplayable(at(cells, 0)), `a PASSED cell does not — there is nothing left to earn (${at(cells, 0)})`);
  check(!isReplayable(at(cells, 3)), `nor does the next cell, which is already in flight (${at(cells, 3)})`);
  check(!isReplayable(at(cells, 4)), `nor an unfinished one the server has not handed out (${at(cells, 4)})`);
  // A CELL PAST THE PUBLISHED LENGTH, taken from its own block because the one above is six drills long and therefore
  // has no `unpublished` cell to point at.
  const short = blockCells({ length: 4, finished: [0], passed: [], next: 1 });
  check(at(short, 5) === 'unpublished' && !isReplayable(at(short, 5)), `nor an unpublished one, which has no drill at all (${at(short, 5)})`);
  // NEGATIVE CONTROL for the whole rule: "anything done" is the plausible wrong reading, and it is wrong on exactly two
  // of the five states. Stated as a count so a rule that widened would be visible as a number rather than a sentence.
  const everyState = ['done-passed', 'done-not-passed', 'next', 'published', 'unpublished'];
  check(everyState.filter(isReplayable).length === 1, `exactly one of the five states is replayable (${everyState.filter(isReplayable).length})`);
  check(everyState.filter((s) => s.startsWith('done')).filter(isReplayable).length === 1,
    'NEGATIVE CONTROL: "anything done" would be 2 of 2, so the pass set is doing the work');

  // AND THE CONTROL A COMPLETED CELL GETS: WATCHING, which is a READ and therefore not the same question.
  // REPORTED as "Allow completed levels to be replayed, not re-solved" — the passed cell used to be a plain label, so a
  // completed drill could not be opened at all.
  check(isWatchable(at(cells, 0)), `a PASSED cell offers a WATCH (${at(cells, 0)})`);
  check(!isWatchable(at(cells, 1)), `while a skipped one does not — it is offered the reattempt instead (${at(cells, 1)})`);
  check(everyState.filter(isWatchable).length === 1, `exactly one of the five states is watchable (${everyState.filter(isWatchable).length})`);
  // THE TWO RULES ARE DISJOINT, which is why both can make a cell pressable without a cell being both: a state that
  // satisfied both would be offered an attempt AND a rewatch, and the two endpoints answer different questions.
  check(everyState.every((state) => !(isReplayable(state) && isWatchable(state))), 'NEGATIVE CONTROL: no state is both reattemptable and watchable');
}

console.log('\n== 8. degenerate input cannot make a cell that is not a drill ==');
{
  check(blockCells({ length: 0, finished: [], passed: [], next: null }).every((c) => c.state === 'unpublished'),
    'a level with nothing published is all unpublished');
  check(blockCells({ length: 250, finished: [], passed: [], next: null }).length === CELL_COUNT,
    `a length beyond the block is clamped to ${CELL_COUNT} cells`);
  check(blockCells({ length: 5, finished: [99], passed: [99], next: null })[99].state === 'unpublished',
    'a finished index past the block cannot become a playable cell');
  check(blockCells({ length: 5, finished: [], passed: [], next: null }).every((c) => c.state !== 'next'),
    'no next index means no cell claims to be next');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
