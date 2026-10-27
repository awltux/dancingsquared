// THE PUZZLE'S WAYPOINTS, AS FORMATIONS — the list a puzzle is made of.
//
// A PUZZLE IS A SEQUENCE OF WAYPOINTS, and a waypoint is a FORMATION: a congruence class of arrangements, compared with
// the engine's congruence test at this game's tolerance (`sameArrangement` in `puzzle/arrangement.ts`), not a pose and
// not a call. The smallest puzzle is two of them — the start and the end.
//
// THE ROUTE IS NOT THAT LIST. `puzzle.path` is one board per CALL, and a call that leaves the set in the
// arrangement it was already in has not reached a waypoint. MEASURED over the 24 level-1 Daily seeds
// `daily-waypoints-probe.mjs` generates: 16 of 24 routes repeat a formation in CONSECUTIVE stages, so the same 16
// routes have fewer waypoints than boards — and in that sample every repeat is a consecutive one.
//
// THE EQUIVALENCE IS THE ENGINE'S, WHICH QUOTIENTS MORE THAN ROTATION. MEASURED here: the relation is invariant under a
// quarter turn AND under a translation of the whole set — the same set standing elsewhere on the floor is the same
// formation, which is what "the setup" means to a dancer. It is NOT invariant under moving one dancer FAR (`nudge` at
// 0.5 units, well past the tolerance), which is what makes a different formation different — and it IS invariant under
// moving one dancer a few hundredths, which is the drift two call paths produce and the defect this relation closes
// (REPORTED: "The game offered 'Circle Right 1/2 Home' … 'does not leave the set on the goal board.' but to me it looks
// as if it does end on 'squared set'").
//
// WHAT THIS PINS, and the control each check has:
//   1. the smallest puzzle is two waypoints;
//   2. a quarter-turned and a translated copy of a board are the SAME waypoint, a far-nudged one is not, and a
//      sub-tolerance nudge IS — so the comparison is congruence at a stated tolerance, not position equality and not a
//      quantised key;
//   3. consecutive equal formations collapse, and the board KEPT is the first of the run;
//   4. a RETURN to an earlier formation is a NEW waypoint — a set-membership dedupe would delete it, and the
//      player would no longer have to stand in that arrangement a second time (`waypointReached`);
//   5. the list is never adjacent-equal afterwards, and the check that says so is demonstrably able to fail;
//   6. reaching the GOAL is the same relation as standing on a waypoint, including the tolerance's two sides.
//
// Usage: node game/test/waypoint-probe.mjs   (engine must be built: arrangement.ts imports the engine's congruence test)
import { makeSquaredSet } from 'dancing-squared-engine';
import { ARRANGEMENT_TOL, reachedGoal, sameArrangement, waypointBoards } from '../src/puzzle/arrangement.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// FOUR ARRANGEMENTS TO COMBINE. `A` is the squared set; `turn` and `shift` are the SAME formation seen other ways
// (the relation quotients both); `nudge` moves ONE dancer — far for a different formation, close for drift.
const A = makeSquaredSet();
const turn = (board) => ({
  dancers: board.dancers.map((d) => ({ ...d, x: -d.y, y: d.x, heading: d.heading + Math.PI / 2 })),
});
const shift = (board, dx) => ({ dancers: board.dancers.map((d) => ({ ...d, x: d.x + dx })) });
const nudge = (board, by) => ({ dancers: board.dancers.map((d, i) => (i === 0 ? { ...d, x: d.x + by } : d)) });
const A2 = turn(A);
const A3 = shift(A, 1);
const B = nudge(A, 0.5);
const C = nudge(A, 1.5);

console.log('== 1. the smallest puzzle is two waypoints ==');
{
  const list = waypointBoards([A, B]);
  check(list.length === 2, `start and end, nothing between (${list.length})`);
  check(list[0] === A && list[1] === B, 'and the boards are the route’s own, in order');
}

console.log('\n== 2. a waypoint is a FORMATION, not a pose ==');
{
  check(sameArrangement(A2, A), 'a quarter-turned copy of a board IS the same arrangement');
  check(sameArrangement(A3, A), 'and so is the same set standing a unit to the right (a translation is not a formation)');
  const list = waypointBoards([A, A2, A3, B]);
  check(list.length === 2, `so a route through all three of them reaches ONE waypoint (${list.length}; a position comparison would say 4)`);
  check(list[0] === A, 'and the board kept is the first of the run');
  check(!sameArrangement(B, A), 'NEGATIVE CONTROL: one dancer moved 0.5 is a DIFFERENT formation, so the relation is not constant');
  check(!sameArrangement(C, B), 'and two nudges are different from each other, so the relation is not all one value');
  // AND THE TOLERANCE'S OTHER SIDE, which is why this is not a key: a nudge inside `ARRANGEMENT_TOL` is the SAME
  // arrangement. That is the drift two call paths produce, and it is the reported defect.
  check(sameArrangement(nudge(A, 0.03), A), `one dancer 0.03 off (inside ${ARRANGEMENT_TOL}) is the SAME arrangement`);
  check(!sameArrangement(nudge(A, 0.3), A), 'NEGATIVE CONTROL: one dancer 0.3 off is a different one');
}

console.log('\n== 3. consecutive equal formations collapse ==');
{
  const list = waypointBoards([A, A3, B, nudge(A, 0.5), C]);
  check(list.length === 3, `five boards, three waypoints (${list.length})`);
  check(list[0] === A && list[1] === B && list[2] === C, 'the boards come back as the route’s own objects, in order');
  check(list[1] === B, 'and each waypoint is the FIRST board of its run');
  check(!list.some((board, i) => i > 0 && sameArrangement(board, list[i - 1])), 'no two adjacent waypoints share a formation');
}

console.log('\n== 4. a RETURN to an earlier formation is a NEW waypoint ==');
{
  const list = waypointBoards([A, B, shift(A, 0)]);
  check(list.length === 3, `A → B → A is three waypoints, not two (${list.length})`);
  check(sameArrangement(list[2], A), 'and the third is the formation the route returns to');
  // THE CONTROL: set membership is the rule this refuses. It would give two, and the player would never have to
  // stand in A again — which is exactly what `waypointReached` exists to ask for.
  const bySet = [A, B, A].filter((board, i, all) => all.findIndex((other) => sameArrangement(other, board)) === i).length;
  check(bySet === 2 && list.length !== bySet, `NEGATIVE CONTROL: collapsing by SET membership would say ${bySet}, so this is a different rule`);
}

console.log('\n== 5. the invariants hold over a family of routes, and the check can fail ==');
{
  const routes = [
    [A, B],
    [A, A, A, B],
    [A, B, B, B, C],
    [A, B, A, B],
    [A, A2, B, shift(B, 2), A3],
  ];
  for (const route of routes) {
    const list = waypointBoards(route);
    const ok = list.length <= route.length
      && list[0] === route[0]
      && list[list.length - 1] === route[route.length - 1]
      && !list.some((board, i) => i > 0 && sameArrangement(board, list[i - 1]));
    check(ok, `${route.length} board(s) → ${list.length} waypoint(s), first and last preserved, none adjacent-equal`);
  }
  // THE CONTROL: an UNCOLLAPSED list of the same formation twice must fail the adjacent-equal test every route
  // above passed, or that test would be satisfied by any list at all.
  const raw = [A, A2];
  check(raw.some((board, i) => i > 0 && sameArrangement(board, raw[i - 1])),
    'NEGATIVE CONTROL: the same formation twice, uncollapsed, IS adjacent-equal — so the test above is a distinction');
}

console.log('\n== 6. REACHING the goal is the same relation as standing on a waypoint ==');
{
  // REPORTED: "Each Waypoint might have multiple solutions. A waypoint has been passed when the dancers are in the setup
  // described by the waypoint, regardless of what calls were used to get there. I have managed to get the dancers in
  // the position of the waypoint, but the game has refused it as a solution. I can only assume it is also expecting a
  // specific move." The assumption was right, and the bug was that the two halves of the game disagreed: a waypoint
  // tick asked the arrangement key, while the GOAL asked identity (`sameBoardById`). MEASURED over 40 generated level-1
  // Dailies (all one step): 9 of them offer a call whose board is congruent to the goal but not identical to it, so
  // nearly a quarter of the puzzles had a solution the game refused.
  check(reachedGoal(A2, A), 'a quarter-turned board HAS reached a goal congruent to it');
  check(reachedGoal(A3, A), 'and so has the same set standing a unit to the right');
  check(reachedGoal(A, A), 'and a board has reached itself');
  check(!reachedGoal(B, A), 'NEGATIVE CONTROL: one dancer moved 0.5 has NOT — this is congruence at a tolerance, not any board');
  // THE TOLERANCE'S OTHER SIDE, and the reported case: drift inside `ARRANGEMENT_TOL` IS the goal. Before this, the
  // quantised key refused a board 0.0364 units and 0.0195 rad off, which is what the player saw as "it does end on
  // squared set" (MEASURED over the 108 baked drills: 10 such distractors, all keyed apart).
  check(reachedGoal(nudge(A, 0.03), A), `one dancer 0.03 off HAS reached it (inside ${ARRANGEMENT_TOL}), which is the reported refusal closed`);
  // AND THE FACINGS ARE STILL PART OF THE SETUP, which is what keeps this from being a positions-only comparison:
  // turning the whole set half a turn leaves every dancer where they stand and is a different formation to the engine
  // (`cells.ts`: a positions-only key conflates a squared set with `Static Facing Out`, four formations on one key).
  const facingOut = { dancers: A.dancers.map((d) => ({ ...d, heading: d.heading + Math.PI })) };
  check(!sameArrangement(facingOut, A), 'the same positions facing the other way is a different arrangement');
  check(!reachedGoal(facingOut, A), 'NEGATIVE CONTROL: so it has NOT reached the goal, even though every dancer is in the same place');
  // ONE FUNCTION, so the goal rule and the waypoint rule cannot drift.
  check(reachedGoal(A3, A) === sameArrangement(A3, A), 'and `reachedGoal` is exactly `sameArrangement`, not a second rule beside it');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
