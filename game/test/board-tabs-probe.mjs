// THE NOW|TARGET SWITCHER IN BOTH VIEWS, pinned.
//
// REPORTED: "The Now|Target widget is only on the mobile version, but It would be just as useful in the PC view. Make sure the
// Now|Target widget is shown in both views." The rule is `ui/board-tabs.ts`'s, and there are two halves to hold: WHICH SIDE a
// press picks, and WHEN THE PAIR COMES BACK. The second only exists on a wide viewport, and it is the half that a screen would
// get wrong silently — a solo view with no way back to the pair is a player who has lost half the puzzle.
//
// THE NEGATIVE CONTROL is the rule that shipped: `boardFocus = pressed`, always. It passes every narrow-layout check below and
// fails exactly the one that says pressing the pressed tab returns the pair.
//
// Usage: node game/test/board-tabs-probe.mjs   (pure: no DOM, no storage, no engine)
import { focusForLayout, nextBoardFocus } from '../src/ui/board-tabs.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('== 1. a NARROW layout: one board at a time, and no off state ==');
{
  // `pairAvailable` false is the single-board layout — the phone sheet, where the two boards cannot both be drawn.
  check(nextBoardFocus('left', 'right', false) === 'right', 'pressing Target shows the target board');
  check(nextBoardFocus('right', 'left', false) === 'left', 'and pressing Now shows the player\'s own');
  // THE HALF THAT MUST NOT EXIST ON A PHONE: pressing the pressed tab has nowhere to go, because there is no pair to show.
  check(nextBoardFocus('right', 'right', false) === 'right',
    'pressing the pressed tab again keeps it (a single-board layout has no pair state)');
  check(nextBoardFocus(null, 'left', false) === 'left', 'and a press from the pair state picks the side');
  // NEGATIVE CONTROL, MEASURED: the rule that shipped — `focus = pressed` — agrees with all four checks above, so a probe that
  // stopped here could not tell the two apart. Section 2 is where they disagree.
  const shipped = (pressed) => pressed;
  check(shipped('right') === nextBoardFocus('right', 'right', false), 'CONTROL: the old rule is identical on a narrow viewport');
}

console.log('\n== 2. a WIDE layout: the same switch, plus a way back to the pair ==');
{
  // `pairAvailable` true is the pair, drawn side by side (REPORTED: "just as useful in the PC view").
  check(nextBoardFocus(null, 'left', true) === 'left', 'a press from the pair focuses that board');
  check(nextBoardFocus('left', 'right', true) === 'right', 'and the other tab switches sides');
  check(nextBoardFocus('right', 'right', true) === null, 'pressing the pressed tab returns the PAIR');
  check(nextBoardFocus('left', 'left', true) === null, 'which is true of either side, not just the target');
  check(nextBoardFocus(null, 'left', true) !== null && nextBoardFocus(null, 'left', true) !== undefined,
    'and the pair state is `null` rather than a third side');
  // THE NEGATIVE CONTROL FOR THIS SECTION: the shipped rule has no way back, which is the defect a player would notice only
  // after pressing a tab on a desktop.
  const shipped = (pressed) => pressed;
  check(shipped('right') !== nextBoardFocus('right', 'right', true),
    'CONTROL: the old rule never returns the pair, and only this check says so');
}

console.log('\n== 3. what each layout can actually DRAW ==');
{
  check(focusForLayout(null, true) === null, 'a wide layout draws the pair when the state is the pair');
  check(focusForLayout('right', true) === 'right', 'and the focused board otherwise');
  // A SINGLE-BOARD LAYOUT MUST SHOW A BOARD: the pair state is not drawable there, so it becomes Now — the player's own board,
  // which is also where the narrow layout starts.
  check(focusForLayout(null, false) === 'left', 'a narrow layout turns the pair state into Now rather than a blank floor');
  check(focusForLayout('right', false) === 'right', 'and keeps a focused side as it is');
  // A RESIZE IS THE PATH THIS GUARDS: leaving a wide viewport on the pair and narrowing it lands on a board, not on nothing.
  const afterResize = focusForLayout(nextBoardFocus('left', 'left', true), false);
  check(afterResize === 'left', `CONTROL: a wide viewport left on the pair narrows onto Now (${afterResize})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
