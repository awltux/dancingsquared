// THE WAYPOINT PAIR RULE — which two boards the stage shows, and what each border reports.
//
// A puzzle is a sequence of waypoints (a waypoint is a formation; `waypoint-probe.mjs` owns that half). The stage
// shows two adjacent ones, and the border of each says where the player stands relative to it:
//
//   solved  a formation the player has reached, in order
//   next    the one waypoint that can be reached from where they are now
//   locked  beyond that — it cannot be solved yet, because waypoints are reached in sequence
//
// THIS IS A READOUT AND NOT A GATE (DESIGN.md §9.1): no call is refused and the goal board still decides
// correctness. What the sequence decides is which waypoint may read as solved.
//
// THE OTHER RULE HERE IS `live` VERSUS PREVIEW. At the front the left board is the player's OWN board, because the
// Daily lets them leave the generated route and "where am I" must never be hidden behind a waypoint they are not
// on. Paging away turns the pair into a preview of the route, and then both boards are the route's.
//
// EVERY CHECK HAS A NEGATIVE CONTROL, and they are the ones the rules are one edit away from: a state rule that
// treats the reached waypoint as "next" (off by one), and a pair that lets the window walk past either end.
//
// Usage: node game/test/waypoint-pair-probe.mjs
import { stageState, waypointPair } from '../src/puzzle/waypoint-pair.ts';
import { justSolved } from '../src/render/celebrate.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
const states = (pair) => `${pair.left}/${pair.right}`;

console.log('== 1. the three states, in sequence ==');
{
  check(stageState(0, 0) === 'solved', 'the first waypoint is solved when the player starts on it');
  check(stageState(1, 0) === 'next', 'the one after it is next');
  check(stageState(2, 0) === 'locked', 'and the one after that cannot be solved yet');
  check(stageState(1, 1) === 'solved', 'reaching waypoint 2 makes it solved rather than next');
  check(stageState(2, 1) === 'next', 'and moves "next" along with it');
  check(stageState(0, 2) === 'solved', 'a waypoint behind the player stays solved');
  // THE NEGATIVE CONTROL: the rule you write if you forget the player is STANDING on it — "a waypoint is behind me,
  // or it is ahead of me" — calls the current one "next", which is what a border drawn from the wrong comparison
  // reports. It disagrees with `stageState` exactly at the boundary this section is about.
  const strictlyBehind = (index, progress) => (index < progress ? 'solved' : index === progress ? 'next' : 'locked');
  check(strictlyBehind(1, 1) === 'next' && stageState(1, 1) === 'solved',
    'NEGATIVE CONTROL: a strictly-behind rule calls the current waypoint "next", so the boundary is what is measured');
}

console.log('\n== 2. the front follows the player, and the pair never runs off either end ==');
{
  // FOUR WAYPOINTS: the start, two between, and the end.
  const p0 = waypointPair(4, 0, null);
  check(p0.live && p0.leftIndex === 0 && p0.rightIndex === 1, `at the start the pair is waypoints 1 and 2 (${p0.leftIndex + 1}, ${p0.rightIndex + 1})`);
  check(states(p0) === 'solved/next', `left where the player is, right the next waypoint (${states(p0)})`);
  check(!p0.canPrev && p0.canNext, 'the left button is spent at the start, the right one is not');

  const p1 = waypointPair(4, 1, null);
  check(p1.leftIndex === 1 && p1.rightIndex === 2, 'reaching waypoint 2 slides the pair on by one');
  const p3 = waypointPair(4, 3, null);
  check(p3.leftIndex === 2 && p3.rightIndex === 3, `at the END the pair rests on the last two (${p3.leftIndex + 1}, ${p3.rightIndex + 1})`);
  check(states(p3) === 'solved/solved', `and both are solved (${states(p3)})`);
  check(!p3.canNext, 'with nothing further to page to');

  // A PROGRESS JUMP: two waypoints gained at once (a stage that collapses away in `waypointBoards`) must not skip
  // the clamp.
  const jump = waypointPair(4, 2, null);
  check(jump.leftIndex === 2 && jump.rightIndex === 3, 'a jump of two still leaves a right-hand board to show');
}

console.log('\n== 3. paging is a preview of the route, and it clamps ==');
{
  const preview = waypointPair(4, 1, 2);
  check(!preview.live, 'a paged pair is a preview, not the live one');
  check(states(preview) === 'next/locked', `the waypoint after the player is next and the one beyond is locked (${states(preview)})`);
  check(preview.canPrev && !preview.canNext, 'both ends report themselves');

  const back = waypointPair(4, 2, 0);
  check(states(back) === 'solved/solved', `paging back to the start shows two solved waypoints (${states(back)})`);

  check(waypointPair(4, 1, -5).leftIndex === 0, 'a cursor below the first waypoint clamps to it');
  check(waypointPair(4, 1, 99).leftIndex === 2, 'and one past the last pair clamps to the last pair');
  const previewAtFront = waypointPair(4, 1, 1);
  check(!previewAtFront.live && previewAtFront.leftIndex === 1 && states(previewAtFront) === 'solved/next',
    'paging to the front waypoint is still a preview, and it reads the same as the live pair');
}

console.log('\n== 4. the smallest puzzle: two waypoints, one pair, no paging ==');
{
  const p = waypointPair(2, 0, null);
  check(p.leftIndex === 0 && p.rightIndex === 1, 'the start and the end');
  check(states(p) === 'solved/next', 'solved where the player is, next the one they must reach');
  check(!p.canPrev && !p.canNext, 'and there is nowhere to page, because there are only two');
  const done = waypointPair(2, 1, null);
  check(states(done) === 'solved/solved', `solving it turns the pair green (${states(done)})`);
}

console.log('\n== 5. a SUCCESS holds the window, and the arrow is the way on ==');
{
  // REPORTED: "when the player selects the correct call, the animation correctly plays in the left hand, but the right
  // hand immediately auto-skips to the next board … Moving to the next waypoint should be left to the player by pressing
  // the navigation buttons." THE HOLD IS THE FRONT THE PLAYER WAS LOOKING AT: progress 1 (waypoint 2 reached) with the
  // window held at 0 leaves the pair on waypoints 1 and 2, and the right-hand board — the one they were aiming at — is
  // now solved.
  const held = waypointPair(4, 1, null, 0);
  check(held.live, 'a held pair is still the LIVE pair: the left board is the player\'s own');
  check(held.leftIndex === 0 && held.rightIndex === 1, `and it sits where the player was watching (${held.leftIndex + 1}, ${held.rightIndex + 1})`);
  check(states(held) === 'solved/solved', `with the waypoint they just reached now solved (${states(held)})`);
  // THE NEGATIVE CONTROL: the same state WITHOUT the hold is the auto-skip — the pair jumps to (2, 3), which is what a
  // test for "it moved on" would call correct, and is exactly what was reported.
  const skipped = waypointPair(4, 1, null);
  check(skipped.leftIndex === 1 && skipped.rightIndex === 2,
    `NEGATIVE CONTROL: without the hold the pair advances on a success (${skipped.leftIndex + 1}, ${skipped.rightIndex + 1})`);
  // THE ARROW ADVANCES IT: holding one further on keeps the left board live, shows the next waypoint on the right, and the
  // pair catches the player up as it goes. (`progress` is the INDEX of the last waypoint reached, so at 1 the pair (1, 2)
  // reads "you are on waypoint 2, waypoint 3 is next" — the following pair again.)
  const nextStep = waypointPair(4, 1, null, 1);
  check(nextStep.live && nextStep.leftIndex === 1 && nextStep.rightIndex === 2, `one page on shows the next window (${nextStep.leftIndex + 1}, ${nextStep.rightIndex + 1})`);
  check(states(nextStep) === 'solved/next', `with the waypoint after it reading next again (${states(nextStep)})`);
  // PAGING STILL WINS OVER THE HOLD: a cursor is the player's own look at the route, and then both boards are the route's.
  const pagedOver = waypointPair(4, 1, 2, 0);
  check(!pagedOver.live && pagedOver.leftIndex === 2, `a paged pair ignores the hold (${pagedOver.leftIndex + 1})`);
  check(waypointPair(4, 1, null, 99).leftIndex === 2, 'and a hold past the last pair clamps to it');
  // THE CELEBRATION STILL FIRES, which is why the hold is safe: with the indices unchanged a held success is the shape
  // `justSolved` already had for the goal — the right border turning solved in place.
  const before = waypointPair(4, 0, null);
  check(justSolved(before, waypointPair(4, 1, null, 0)) === 'right',
    'and the reached waypoint still flashes its border, the way the goal case does');
}

console.log('\n== 6. bad input is clamped, never trusted ==');
{
  const negativeProgress = waypointPair(4, -3, null);
  check(states(negativeProgress) === 'solved/next', `a negative progress reads as the start (${states(negativeProgress)})`);
  const hugeProgress = waypointPair(4, 99, null);
  check(states(hugeProgress) === 'solved/solved', `a progress past the end rests on the last pair (${states(hugeProgress)})`);
  // ONE WAYPOINT CANNOT HAPPEN — a puzzle has a start and an end — so this is the defensive case, and the rule is
  // that it shows ONE board rather than indexing past what exists.
  const single = waypointPair(1, 0, null);
  check(single.leftIndex === 0 && single.rightIndex === 0 && !single.canPrev && !single.canNext,
    'a one-waypoint list shows that waypoint in both slots rather than throwing');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
