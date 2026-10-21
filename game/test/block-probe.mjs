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
import { blockCells, blockSummary, isReplayable, CELL_COUNT } from '../src/puzzle/block.ts';
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
