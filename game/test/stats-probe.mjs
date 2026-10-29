// THE HEADER'S SCORES, PINNED: what a server answer does to the board the app already knows, and which row on a board
// page is the caller's.
//
// THE DEVICE'S TOTALS ARE GONE. This probe used to pin `statsFor` — the streak, the drill count, the best score and the
// mean time, all summed from `store.ts`'s `RunRecord[]`. REPORTED: "I would like to move away from the offline score.
// You can play without logging in, but you need access to the server and so the score should be stored on the server. A
// single point of truth." So the ledger, the streak and the device fallbacks are removed with it: a demo or practice
// run is unscored by design, not by a device sum that can disagree with the board. What is left in `stats.ts` is TWO
// PURE RULES, and this probe drives both.
//
//   1. AN ANSWER CAN CARRY THE BOARD OR NOT, AND THE TWO ARE NOT THE SAME (section 1). The reported defect was the
//      revert: leaving a play page, the header replaced the account's total with the device's, because a read that did
//      not carry the board assigned null. The control below is the rule that shipped, and it fails exactly this check.
//   2. A BOARD PAGE CARRIES ONE ROW PER PLAYER (section 2), so the caller's own row is a legitimate last-resort source
//      for the same number — and the control shows that reading the TOP row would print somebody else's total.
//
// Usage: node game/test/stats-probe.mjs   (pure arithmetic over values; no engine, no DOM, no clock, no network)
import { adoptedBoard, boardEntryOf } from '../src/game/stats.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const board = (score, runs = 1) => ({ score, runs });
const row = (playerId, score, runs = 1) => ({ playerId, score, runs });

console.log('\n== 1. an answer with no board does not erase the one the header knows ==');
{
  // REPORTED: "When I pass a drill, the score in the header is updated. But as soon as I leave that screen the score
  // reverts back to a number I don't recognise." Leaving re-issues a drill; a read from a build that does not carry the
  // board used to assign null, and the header showed the device's own sum instead of the account's.
  const known = board(134);
  const adopted = adoptedBoard(known, board(1307), false);
  check(adopted?.score === 1307, `a board that arrives is adopted (${adopted?.score})`);
  const zero = adoptedBoard(known, board(0, 0), false);
  check(zero?.score === 0 && zero.runs === 0, 'and a ZERO replaces it, because zero is a real answer');
  check(adoptedBoard(known, null, true) === null, 'a demo with no board forgets it: a signed-out caller has no score');
  const kept = adoptedBoard(known, null, false);
  check(kept?.score === 134, `while an answer with NO board that is not a demo keeps the known one — the reported revert (${kept?.score})`);
  check(adoptedBoard(null, null, false) === null, 'and with nothing known there is nothing to keep');

  // NEGATIVE CONTROL, MEASURED: the rule that shipped — `board ?? null` — answers null for the non-demo case, which is
  // the revert. Only the "keeps the known one" check above reddens for it; the adopt and zero checks pass under it.
  const shipped = (known_, next) => next ?? null;
  check(shipped(known, null) === null && adoptedBoard(known, null, false) !== null,
    'CONTROL: "a missing board is no board" reverts the header; keeping the last known one does not');
  // THE DEMO CLAUSE IS NOT THE SAME AS THE NON-DEMO ONE, measured against each other: the same answer (no board) takes
  // the total away for a demo and keeps it otherwise, so the flag is what decides rather than the absence.
  check(adoptedBoard(known, null, true) === null && adoptedBoard(known, null, false) === known,
    'the demo flag is what decides, not the absence');
}

console.log('\n== 2. the header can take the caller\'s own row from a board page ==');
{
  // REPORTED: "On the landing page, the score on the leaderboard for Drills (1818) is different to the drill score shown
  // in the header (726)." A board page names one player per row, so the caller's row IS their board total.
  const entries = [row('emu:1', 1818, 9), row('emu:2', 726, 4)];
  const own = boardEntryOf(entries, 'emu:2');
  check(own?.score === 726 && own.runs === 4, `the caller's own row is found by id, not by position (${own?.score} over ${own?.runs})`);
  check(boardEntryOf(entries, 'emu:9') === null, 'and a caller with no row gets nothing rather than the top score');
  check(boardEntryOf(entries, null) === null, 'and a signed-out caller (no id) claims no row');
  check(boardEntryOf([], 'emu:1') === null, 'an empty board has no row to take');
  // THE RUN COUNT COMES FROM THE SAME ROW: taking the score from one place and counting another row's runs would report
  // a total with a denominator from somebody else's board.
  check(boardEntryOf([row('emu:2', 0, 0), row('emu:2', 500, 2)], 'emu:2')?.score === 0,
    'the FIRST row with the id wins, so a duplicated id does not silently change the total');

  // NEGATIVE CONTROL, MEASURED: "the top row is the score" answers 1818 for emu:2 — another player's total beside a
  // board whose first row is somebody else. Only the first check above reddens for it.
  const topRow = (list) => list[0] ?? null;
  check(topRow(entries)?.score === 1818 && boardEntryOf(entries, 'emu:2')?.score === 726,
    'CONTROL: reading the top row would give another player\'s total');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
