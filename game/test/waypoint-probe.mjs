// THE PUZZLE'S WAYPOINTS, AS FORMATIONS — the list a puzzle is made of.
//
// A PUZZLE IS A SEQUENCE OF WAYPOINTS, and a waypoint is a FORMATION: a congruence class of arrangements
// (`arrangementKey`), not a pose and not a call. The smallest puzzle is two of them — the start and the end.
//
// THE ROUTE IS NOT THAT LIST. `puzzle.path` is one board per CALL, and a call that leaves the set in the
// arrangement it was already in has not reached a waypoint. MEASURED over the 24 level-1 Daily seeds
// `daily-waypoints-probe.mjs` generates: 16 of 24 routes repeat a formation in CONSECUTIVE stages, so the same 16
// routes have fewer waypoints than boards — and in that sample every repeat is a consecutive one.
//
// THE EQUIVALENCE IS THE ENGINE'S, WHICH QUOTIENTS MORE THAN ROTATION. MEASURED here: `geometryKey` is invariant
// under a quarter turn AND under a translation of the whole set — the same set standing elsewhere on the floor is
// the same formation, which is what "the setup" means to a dancer. It is NOT invariant under moving one dancer
// (`nudge`), which is what makes a different formation different.
//
// WHAT THIS PINS, and the control each check has:
//   1. the smallest puzzle is two waypoints;
//   2. a quarter-turned and a translated copy of a board are the SAME waypoint, while a nudged one is not — so the
//      comparison is the engine's congruence, not position equality;
//   3. consecutive equal formations collapse, and the board KEPT is the first of the run;
//   4. a RETURN to an earlier formation is a NEW waypoint — a set-membership dedupe would delete it, and the
//      player would no longer have to stand in that arrangement a second time (`waypointReached`);
//   5. the list is never adjacent-equal afterwards, and the check that says so is demonstrably able to fail.
//
// Usage: node game/test/waypoint-probe.mjs   (engine must be built: arrangement.ts imports geometryKey)
import { makeSquaredSet } from 'dancing-squared-engine';
import { arrangementKey, reachedGoal, waypointBoards } from '../src/puzzle/arrangement.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
const keysOf = (boards) => boards.map(arrangementKey);

// FOUR ARRANGEMENTS TO COMBINE. `A` is the squared set; `turn` and `shift` are the SAME formation seen other ways
// (the engine's key quotients both); `nudge` moves ONE dancer, which is a different formation.
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
  check(arrangementKey(A2) === arrangementKey(A), 'a quarter-turned copy of a board shares its arrangement key');
  check(arrangementKey(A3) === arrangementKey(A), 'and so does the same set standing a unit to the right');
  const list = waypointBoards([A, A2, A3, B]);
  check(list.length === 2, `so a route through all three of them reaches ONE waypoint (${list.length}; a position comparison would say 4)`);
  check(list[0] === A, 'and the board kept is the first of the run');
  check(arrangementKey(B) !== arrangementKey(A), 'NEGATIVE CONTROL: one dancer moved is a DIFFERENT formation, so the key is not constant');
  check(arrangementKey(C) !== arrangementKey(B), 'and two nudges are different from each other, so the keys are not all one value');
}

console.log('\n== 3. consecutive equal formations collapse ==');
{
  const list = waypointBoards([A, A3, B, nudge(A, 0.5), C]);
  check(list.length === 3, `five boards, three waypoints (${list.length})`);
  check(list[0] === A && list[1] === B && list[2] === C, 'the boards come back as the route’s own objects, in order');
  check(list[1] === B, 'and each waypoint is the FIRST board of its run');
  check(!keysOf(list).some((k, i) => i > 0 && k === keysOf(list)[i - 1]), 'no two adjacent waypoints share a formation');
}

console.log('\n== 4. a RETURN to an earlier formation is a NEW waypoint ==');
{
  const list = waypointBoards([A, B, shift(A, 0)]);
  check(list.length === 3, `A → B → A is three waypoints, not two (${list.length})`);
  check(arrangementKey(list[2]) === arrangementKey(A), 'and the third is the formation the route returns to');
  // THE CONTROL: set membership is the rule this refuses. It would give two, and the player would never have to
  // stand in A again — which is exactly what `waypointReached` exists to ask for.
  const bySet = [...new Set(keysOf([A, B, A]))].length;
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
    const keys = keysOf(list);
    const ok = list.length <= route.length
      && list[0] === route[0]
      && list[list.length - 1] === route[route.length - 1]
      && !keys.some((k, i) => i > 0 && k === keys[i - 1]);
    check(ok, `${route.length} board(s) → ${list.length} waypoint(s), first and last preserved, none adjacent-equal`);
  }
  // THE CONTROL: an UNCOLLAPSED list of the same formation twice must fail the adjacent-equal test every route
  // above passed, or that test would be satisfied by any list at all.
  const raw = [A, A2];
  check(keysOf(raw).some((k, i) => i > 0 && k === keysOf(raw)[i - 1]),
    'NEGATIVE CONTROL: the same formation twice, uncollapsed, IS adjacent-equal — so the test above is a distinction');
}

console.log('\n== 6. REACHING the goal is the same equivalence as standing on a waypoint ==');
{
  // REPORTED: "Each Waypoint might have multiple solutions. A waypoint has been passed when the dancers are in the setup
  // described by the waypoint, regardless of what calls were used to get there. I have managed to get the dancers in
  // the position of the waypoint, but the game has refused it as a solution. I can only assume it is also expecting a
  // specific move." The assumption was right, and the bug was that the two halves of the game disagreed: a waypoint
  // tick asked `arrangementKey`, while the GOAL asked identity (`sameBoardById`). MEASURED over 40 generated level-1
  // Dailies (all one step): 9 of them offer a call whose board is congruent to the goal but not identical to it, so
  // nearly a quarter of the puzzles had a solution the game refused.
  check(reachedGoal(A2, A), 'a quarter-turned board HAS reached a goal congruent to it');
  check(reachedGoal(A3, A), 'and so has the same set standing a unit to the right');
  check(reachedGoal(A, A), 'and a board has reached itself');
  check(!reachedGoal(B, A), 'NEGATIVE CONTROL: one dancer moved has NOT — the rule is congruence, not a tolerance');
  // AND THE FACINGS ARE STILL PART OF THE SETUP, which is what keeps this from being a positions-only comparison:
  // turning the whole set half a turn leaves every dancer where they stand and is a different formation to the engine
  // (`cells.ts`: a positions-only key conflates a squared set with `Static Facing Out`, four formations on one key).
  const facingOut = { dancers: A.dancers.map((d) => ({ ...d, heading: d.heading + Math.PI })) };
  check(arrangementKey(facingOut) !== arrangementKey(A), 'the same positions facing the other way is a different key');
  check(!reachedGoal(facingOut, A), 'NEGATIVE CONTROL: so it has NOT reached the goal, even though every dancer is in the same place');
  // ONE FUNCTION, so the goal rule and the waypoint rule cannot drift: the two answers above are the key comparison.
  check(reachedGoal(A2, A) === (arrangementKey(A2) === arrangementKey(A)), 'and `reachedGoal` is exactly the key comparison, not a second rule beside it');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
