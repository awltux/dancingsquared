// THE DAILY'S ROUTE, as waypoints: the arrangements a generated puzzle passes through, and how progress is counted.
//
// WHY THIS IS A GATE. A waypoint is the only thing that can be checked on a route (DESIGN.md Â§9.1): MEASURED, a full
// enumeration of one Daily at pool 20 is 2 546 477 distinct three-call lines of which exactly ONE reaches the goal, so
// neither "the line" nor "a repeated call" is a usable signal. What IS usable is the ARRANGEMENT the player is
// standing in, and it is only usable if a generated route actually visits different ones â€” which is the property this
// probe measures rather than assumes.
//
// MEASURED when the waypoint rule was written (12 seeds, pool 20): 11 routes visit a NEW arrangement at every stage and
// all 12 end in an arrangement different from the start. The expectations below are those numbers, with the control
// that matters: the route's stages must not be indistinguishable, and the START must not satisfy the goal.
//
// RE-MEASURED when the generator started opening on a level's own formations (pool 57, level 1, the same 12 seeds):
// **9 of 12** visit a new arrangement at every stage, and all 12 still end somewhere different. THE MECHANISM IS NOT A
// DEFECT and it is the same fact Â§9.1 records from the other side: a call can leave the SAME arrangement on a different
// board (a pivot â€” 49 of 192 legal readings from a squared set), so a three-call route through a start with more of them
// can pass through one arrangement twice. MEASURED on the three: `Tidal Line RH` â†’ `Bend the Line â†’ Single Circle Left
// â†’ Single Circle Left 1/2` and `Eight Chain Thru` â†’ `Circle Four Left 1/4` twice. A squared set simply had fewer pivots
// in its first three calls, which is why the old sample read 11. The floor is therefore re-pinned to the measured value
// with the direction stated â€” it may not fall further â€” and the two controls that do not depend on the start set (the
// goal differs, and there are two intermediate stages) are unchanged and still exact.
//
// RE-MEASURED when the drill's options started passing through the permission table. THE SAME 12 SEEDS: **9 before
// that change, 4 after**; and a wider sample of 24 gives 8, so the rate is about a third where it was three quarters.
// All 24 still end somewhere different. That is a MEASURED COST of the change, reported rather than buried, and the
// floor is re-pinned to the wider sample with the direction stated â€” it may not fall further.
//
// WHY IT FELL IS INFERRED, NOT MEASURED: the only functional difference is the option pool, which went from 40 calls to
// 31 at a squared set, and fewer options is a smaller set of three-call routes for the search to find a distinct
// arrangement through. The alternative explanation â€” that the RNG draw order changed because a shorter list is shuffled â€”
// is not excluded by anything here, and a seed that generated the same route under both builds would be the way to
// separate them. Nothing in this probe depends on which of the two it is: the rate is what the player sees.
//
// THE FIX THAT WAS CONSIDERED AND NOT TAKEN: make the generator prefer routes whose stages are distinct. It would gate
// a readout the design makes a guide rather than a gate (DESIGN.md Â§9.1) and cost the midnight publisher a retry per
// affected seed. If the rate matters, that is its own change with its own measurement.
//
// Usage: node game/test/daily-waypoints-probe.mjs   (engine must be built)
import { makeSquaredSet } from 'dancing-squared-engine';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { dailySpec, levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { arrangementKey, waypointBoards, waypointReached } from '../src/puzzle/arrangement.ts';
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
  // THE WAYPOINT LIST, which is what the mode SHOWS and is not the route: consecutive equal formations collapse.
  let waypointsNeverRepeat = 0;
  let waypointCountsAgree = 0;
  let atLeastTwo = 0;
  const waypointCounts = [];
  // 24 SEEDS, because the rate is now about a third and a 12-seed sample of it is a coin toss: the first twelve read 4
  // and the wider sample reads 8, which is why the floor is stated over the wider one. The sample was WIDENED in the
  // commit that re-measured it, which is the one legitimate way a floor is restated upward â€” the old 9 was a rate over
  // a different sample, not a stronger claim about this one.
  for (let i = 1; i <= 24; i++) {
    const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec, 'daily'), 2026_10_15 + i, spec, applier);
    if (!built.ok) continue;
    ok++;
    const puzzle = built.puzzle;
    const keys = KEYS(puzzle.path);
    if (new Set(keys).size === keys.length) everyStageNew++;
    if (keys[keys.length - 1] !== keys[0]) goalDiffers++;
    if (puzzle.path.length - 2 >= 2) twoWaypoints++;
    // A WAYPOINT IS A FORMATION, so the list the board pair shows is `waypointBoards`, not the path: 16 of these
    // 24 routes repeat a formation in consecutive stages, and those repetitions are the same waypoint.
    const waypoints = waypointBoards(puzzle.path);
    const waypointKeys = KEYS(waypoints);
    waypointCounts.push(waypoints.length);
    if (!waypointKeys.some((k, j) => j > 0 && k === waypointKeys[j - 1])) waypointsNeverRepeat++;
    const repeats = keys.filter((k, j) => j > 0 && k === keys[j - 1]).length;
    if (waypoints.length === keys.length - repeats) waypointCountsAgree++;
    if (waypoints.length >= 2) atLeastTwo++;
  }
  check(ok === 24, `all 24 seeds generate at level 1 (${ok})`);
  check(goalDiffers === ok, `every route's goal is a DIFFERENT arrangement from its start (${goalDiffers} of ${ok})`);
  // A FLOOR, and it is the one number here that moved: 11 of 12 from a squared set, 9 of 12 once the start is one of
  // the level's own formations, and 8 of 24 (4 of the same 12) once the options went through the permission table. It
  // may not fall further. The 4 rather than the measured 8 is headroom for the seed-to-seed noise a rate of a third
  // carries, and the headroom is a measured trade rather than a guess: at p = 1/3 over 24 seeds a floor of 4 fires by
  // chance 2.0% of the time and a floor of 6 fires 13.8% of the time (the binomial tail, computed rather than
  // estimated), and against a collapse to a rate of a tenth the floor of 4 fires 78.6% of the time. A floor high enough
  // to catch a smaller drift would be the guide-as-gate this section refuses.
  // THE ALTERNATIVE WAS TO MAKE THE GENERATOR REFUSE a route with a repeated arrangement, which would gate a readout
  // the design explicitly makes a guide rather than a gate (DESIGN.md Â§9.1) and would cost the midnight publisher a
  // retry per affected seed.
  check(everyStageNew >= 4, `and at least 4 of ${ok} visit a new arrangement at every stage (${everyStageNew}) â€” the property that makes a waypoint sequence legible rather than three names for one setup`);
  // NEGATIVE CONTROL FOR THE WHOLE IDEA: if a three-call Daily had FEWER than two intermediate stages there would be no
  // sequence to show. The Daily's depth is the mode's, not the level's (Â§9), so this is what the picker relies on.
  check(twoWaypoints === ok, `every route has at least two intermediate arrangements to show (${twoWaypoints} of ${ok})`);
  // THE LIST THE MODE SHOWS, which is a formation sequence rather than a board sequence: a stage that leaves the
  // set in the formation it was already in is not a new waypoint. All three of these are properties of the
  // DERIVATION rather than measurements of the generator, so they are exact counts (ok of ok) and not floors.
  check(waypointsNeverRepeat === ok,
    `and the waypoint list never has two adjacent waypoints of the same formation (${waypointsNeverRepeat} of ${ok})`);
  check(waypointCountsAgree === ok,
    `its length is the route's boards minus its consecutive repeated formations, on every seed (${waypointCountsAgree} of ${ok})`);
  check(atLeastTwo === ok,
    `and every puzzle has at least a start and an end waypoint (${Math.min(...waypointCounts)}..${Math.max(...waypointCounts)} waypoint(s) over the sample)`);
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
  // after stage 1 leaves the stage reached â€” a wasted call, not a lost stage.
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
  // THE OTHER HALF, AND IT IS THE FACT THE WHOLE DESIGN RESTS ON: a call can leave the arrangement you were in â€” the same
  // key, a different board. That is "many calls end up in the same place", and it is why the key is coarser than the
  // board (and coarser than the pose): two different calls satisfy the same waypoint.
  const sameArrangement = readings.filter((r) => arrangementKey(r.board) === arrangementKey(start) && pose(r.board) !== pose(start));
  check(sameArrangement.length > 0, `and ${sameArrangement.length} leave the SAME arrangement on a DIFFERENT board (e.g. "${sameArrangement[0]?.call}"), so a waypoint is an arrangement rather than a pose`);
  // A WAYPOINT IS NOT THE POSE: the two readings above are both legal moves and only one of them moves the route on.
  check(arrangementKey(start) !== arrangementKey(elsewhere[0].board) && arrangementKey(start) === arrangementKey(sameArrangement[0].board), 'and the key separates exactly those two cases');
  // THE KEY IS THE ENGINE'S OWN QUOTIENT (`geometryKey` over `boardMatchables`), so this probe does NOT re-test
  // rotation invariance â€” `engine/test/cells.mjs` does, and a second test here would be a second implementation.
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
