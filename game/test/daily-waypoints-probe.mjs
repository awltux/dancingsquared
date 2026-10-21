// THE DAILY'S ROUTE, as waypoints: the arrangements a generated puzzle passes through, and how progress is counted.
//
// WHY THIS IS A GATE. A waypoint is the only thing that can be checked on a route (DESIGN.md §9.1): MEASURED, a full
// enumeration of one Daily at pool 20 is 2 546 477 distinct three-call lines of which exactly ONE reaches the goal, so
// neither "the line" nor "a repeated call" is a usable signal. What IS usable is the ARRANGEMENT the player is
// standing in, and it is only usable if a generated route actually visits different ones — which is the property this
// probe measures rather than assumes.
//
// MEASURED when the waypoint rule was written (12 seeds, pool 20): 11 routes visit a NEW arrangement at every stage and
// all 12 end in an arrangement different from the start. The expectations below are those numbers, with the control
// that matters: the route's stages must not be indistinguishable, and the START must not satisfy the goal.
//
// RE-MEASURED when the generator started opening on a level's own formations (pool 57, level 1, the same 12 seeds):
// **9 of 12** visit a new arrangement at every stage, and all 12 still end somewhere different. THE MECHANISM IS NOT A
// DEFECT and it is the same fact §9.1 records from the other side: a call can leave the SAME arrangement on a different
// board (a pivot — 49 of 192 legal readings from a squared set), so a three-call route through a start with more of them
// can pass through one arrangement twice. MEASURED on the three: `Tidal Line RH` → `Bend the Line → Single Circle Left
// → Single Circle Left 1/2` and `Eight Chain Thru` → `Circle Four Left 1/4` twice. A squared set simply had fewer pivots
// in its first three calls, which is why the old sample read 11. The floor is therefore re-pinned to the measured value
// with the direction stated — it may not fall further — and the two controls that do not depend on the start set (the
// goal differs, and there are two intermediate stages) are unchanged and still exact.
//
// Usage: node game/test/daily-waypoints-probe.mjs   (engine must be built)
import { makeSquaredSet } from 'dancing-squared-engine';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { dailySpec, levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { arrangementKey, waypointReached } from '../src/puzzle/arrangement.ts';
import { applierFor } from '../src/data/corpus-node.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = levelSpec(1);
const spec = dailySpec(LEVEL);
const { applier } = applierFor(poolFor(LEVEL, MAIN_POOL), LEVEL.poolSize);

const KEYS = (boards) => boards.map(arrangementKey);

console.log('== 1. a generated route visits arrangements, and it visits DIFFERENT ones ==');
{
  let ok = 0;
  let everyStageNew = 0;
  let goalDiffers = 0;
  let twoWaypoints = 0;
  for (let i = 1; i <= 12; i++) {
    const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec, 'daily'), 2026_10_15 + i, spec, applier);
    if (!built.ok) continue;
    ok++;
    const puzzle = built.puzzle;
    const keys = KEYS(puzzle.path);
    if (new Set(keys).size === keys.length) everyStageNew++;
    if (keys[keys.length - 1] !== keys[0]) goalDiffers++;
    if (puzzle.path.length - 2 >= 2) twoWaypoints++;
  }
  check(ok === 12, `all 12 seeds generate at level 1 (${ok})`);
  check(goalDiffers === ok, `every route's goal is a DIFFERENT arrangement from its start (${goalDiffers} of ${ok})`);
  // A FLOOR, and it is the one number here that moved: 11 of 12 from a squared set, 9 of 12 once the start is one of
  // the level's own formations (see the header for the mechanism — a pivot can make a stage repeat). It may not fall
  // further. The alternative was to make the generator REFUSE a route with a repeated arrangement, which would gate a
  // readout the design explicitly makes a guide rather than a gate (DESIGN.md §9.1) and would cost the midnight
  // publisher a retry per affected seed.
  check(everyStageNew >= 9, `and at least 9 of ${ok} visit a new arrangement at every stage (${everyStageNew}) — the property that makes a waypoint sequence legible rather than three names for one setup`);
  // NEGATIVE CONTROL FOR THE WHOLE IDEA: if a three-call Daily had FEWER than two intermediate stages there would be no
  // sequence to show. The Daily's depth is the mode's, not the level's (§9), so this is what the picker relies on.
  check(twoWaypoints === ok, `every route has at least two intermediate arrangements to show (${twoWaypoints} of ${ok})`);
}

console.log('\n== 2. progress is counted over the ARRANGEMENTS stood on, in order ==');
{
  const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec, 'daily'), 2026_10_16, spec, applier);
  check(built.ok, `the probe's own seed generates${built.ok ? '' : `: ${built.reason}`}`);
  const puzzle = built.puzzle;
  const waypoints = puzzle.path.slice(1, -1);
  const waypointKeys = [...KEYS(waypoints)];
  const start = arrangementKey(puzzle.start);
  const goal = arrangementKey(puzzle.goal);

  check(waypointReached(waypointKeys, [start]) === 0, 'standing on the start board satisfies no waypoint (the start is not a waypoint)');
  // THE INTENDED ROUTE, stage by stage: the count rises with each path board.
  const walked = KEYS(puzzle.path);
  check(waypointReached(waypointKeys, walked) === waypointKeys.length, `and walking the generator's own ${puzzle.path.length - 1}-call route satisfies all ${waypointKeys.length} (${waypointReached(waypointKeys, walked)})`);
  check(waypointReached(waypointKeys, walked.slice(0, 2)) === 1, 'while the first move alone satisfies one, which is what the screen ticks');
  // A LINE THAT SKIPS A WAYPOINT SATISFIES NONE: the goal is a different arrangement from every waypoint on this route
  // by construction, so reaching it without the stages is "no progress", which is exactly what a route is for.
  check(waypointReached(waypointKeys, [start, goal]) === 0, 'and a jump straight to the goal satisfies none, because the goal is not a waypoint');
  // REVISITING AN EARLIER STAGE DOES NOT UNMAKE PROGRESS: the count is monotone over the line, so returning to the start
  // after stage 1 leaves the stage reached — a wasted call, not a lost stage.
  check(waypointReached(waypointKeys, [start, walked[1], start]) === 1, 'and returning to an earlier arrangement after a stage keeps the stage');
}

console.log('\n== 3. the key is the ARRANGEMENT, not the board object ==');
{
  const start = makeSquaredSet();
  check(arrangementKey(start) === arrangementKey(makeSquaredSet()), 'two independently built squared sets share a key');
  const pose = (b) => b.dancers.map((d) => `${d.id}:${d.x},${d.y},${d.heading}`).join('|');
  const readings = applier.readings(start);
  const elsewhere = readings.filter((r) => arrangementKey(r.board) !== arrangementKey(start));
  check(elsewhere.length > 0, `${elsewhere.length} reading(s) leave a DIFFERENT arrangement (e.g. "${elsewhere[0]?.call}"), which is why a stage can be told from the start`);
  // THE OTHER HALF, AND IT IS THE FACT THE WHOLE DESIGN RESTS ON: a call can leave the arrangement you were in — the same
  // key, a different board. That is "many calls end up in the same place", and it is why the key is coarser than the
  // board (and coarser than the pose): two different calls satisfy the same waypoint.
  const sameArrangement = readings.filter((r) => arrangementKey(r.board) === arrangementKey(start) && pose(r.board) !== pose(start));
  check(sameArrangement.length > 0, `and ${sameArrangement.length} leave the SAME arrangement on a DIFFERENT board (e.g. "${sameArrangement[0]?.call}"), so a waypoint is an arrangement rather than a pose`);
  // A WAYPOINT IS NOT THE POSE: the two readings above are both legal moves and only one of them moves the route on.
  check(arrangementKey(start) !== arrangementKey(elsewhere[0].board) && arrangementKey(start) === arrangementKey(sameArrangement[0].board), 'and the key separates exactly those two cases');
  // THE KEY IS THE ENGINE'S OWN QUOTIENT (`geometryKey` over `boardMatchables`), so this probe does NOT re-test
  // rotation invariance — `engine/test/cells.mjs` does, and a second test here would be a second implementation.
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
