// THE GOAL IS AN ARRANGEMENT, NOT ONE EXACT BOARD — the reported refusal, pinned end to end.
//
// REPORTED: "Each Waypoint might have multiple solutions. A waypoint has been passed when the dancers are in the setup
// described by the waypoint, regardless of what calls were used to get there. I have managed to get the dancers in the
// position of the waypoint, but the game has refused it as a solution. I can only assume it is also expecting a
// specific move."
//
// THE ASSUMPTION WAS RIGHT. The waypoint tick asked `arrangementKey`'s equivalence (the engine's eight rotations and
// the reflection) while the goal asked identity (`sameBoardById`), so a call that left the set in the goal's
// arrangement rotated or reflected was answered "legal, but the set is not on the goal board yet" — and only the one
// call that landed the identical board counted. MEASURED over 40 generated level-1 Dailies: 9 of them offer such a
// call from the start.
//
// THIS PROBE DRIVES THE REAL THING rather than restating the rule: it finds a Daily whose first move can reach the
// goal's arrangement without landing its exact board, plays that call through `PlaySession`, and asserts the run is
// SOLVED. The controls are the two rules either side of it — identity (which refused it) and positions-only (which
// would accept a board that is facing the wrong way).
//
// THE THIRD HALF, added when the same test proved too SHARP at its own seam. The key it used is a BUCKET (positions and
// headings rounded to `CELL_ROUND`), so two boards the engine's own matcher would call congruent can key apart — and a
// drill offered such a board as a distractor and graded it wrong. REPORTED: "The game offered 'Circle Right 1/2 Home'
// from 'Circle' to 'Square Set' and reports '… does not leave the set on the goal board.' but to me it looks as if it
// does end on 'squared set'." MEASURED then, over the 108 baked drills: 10 distractors were the goal's formation within
// 0.06 units and 0.06 rad (the reported one at 0.0364 / 0.0195), all keyed apart. So sections 3 and 4 below pin the
// TOLERANCE: its two sides by number, and a census over the baked season that no distractor is the goal any more.
//
// Usage: node game/test/goal-arrangement-probe.mjs   (engine must be built)
import { sameBoardById, boardSig, congruenceOf } from 'dancing-squared-engine';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { applierFor } from '../src/data/corpus-node.ts';
import { ARRANGEMENT_TOL, reachedGoal, sameArrangement, waypointBoards } from '../src/puzzle/arrangement.ts';
import { waypointPair } from '../src/puzzle/waypoint-pair.ts';
import { SEASON_PUZZLES } from '../src/game/season-data.ts';
import { PlaySession } from '../src/puzzle/session.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = levelSpec(1);
const { applier } = applierFor(poolFor(LEVEL, MAIN_POOL), LEVEL.poolSize);
const CONFIG = generatorConfigFor(MAIN_POOL.version, LEVEL);

/** A session on `puzzle`, which is all a Daily run is: a puzzle plus the move stack. */
const sessionOf = (puzzle) => new PlaySession(puzzle, applier, puzzle.shortest + 2);

console.log('== 1. a generated Daily that offers a SECOND solution the identity rule refused ==');
let found = null;
let searched = 0;
for (let seed = 1; seed <= 60 && !found; seed++) {
  const generated = generatePuzzle(CONFIG, seed, LEVEL, applier);
  if (!generated.ok) continue;
  searched++;
  const puzzle = generated.puzzle;
  const twin = applier.offered(puzzle.start).find((move) => reachedGoal(move.board, puzzle.goal) && !sameBoardById(move.board, puzzle.goal));
  if (twin) found = { seed, puzzle, twin };
}
check(found !== null, `found one in ${searched} seed(s): a call that reaches the goal's ARRANGEMENT but not its exact board`);
if (found) {
  const { seed, puzzle, twin } = found;
  // THE PREMISE, stated as its own check: the identity rule disagrees with the arrangement rule on this board, so the
  // two answers below are a distinction rather than the same test twice.
  check(!sameBoardById(twin.board, puzzle.goal) && reachedGoal(twin.board, puzzle.goal), `seed ${seed}: "${twin.call}" is congruent to the goal and is not the goal's board`);
  const session = sessionOf(puzzle);
  const verdict = session.play(twin.call);
  check(verdict.verdict === 'correct', `playing it SOLVES the run (${verdict.verdict}) — the reported behaviour was "the set is not on the goal board yet"`);
  check(session.atGoal() === true, 'and `atGoal()` says the same, because the view and the verdict read one rule');
  // NEGATIVE CONTROL: a different arrangement is still not the goal, so the rule has not become "any legal call wins".
  const wrong = applier.offered(puzzle.start).find((move) => !reachedGoal(move.board, puzzle.goal));
  const second = sessionOf(puzzle).play(wrong.call);
  check(second.verdict === 'wrong', `NEGATIVE CONTROL: "${wrong.call}" leaves the set elsewhere and is still refused (${second.verdict})`);
}

console.log('\n== 2. positions alone are NOT the goal: the facings are part of the setup ==');
{
  // THE BOARD THE RULE MUST STILL REFUSE. `cells.ts` measures why a positions-only key is wrong: a squared set,
  // `Static Facing Out` and both `Static MiniWaves` share one positions key and are four different formations.
  const generated = generatePuzzle(CONFIG, 1, LEVEL, applier);
  check(generated.ok, 'a level-1 puzzle generates for this control');
  if (generated.ok) {
    const goal = generated.puzzle.goal;
    const facingOut = { dancers: goal.dancers.map((d) => ({ ...d, heading: d.heading + Math.PI })) };
    check(boardSig(facingOut) === boardSig(goal), 'a half-turned copy of the goal keeps every dancer in the same place');
    check(!reachedGoal(facingOut, goal), 'NEGATIVE CONTROL: and has NOT reached it, so the rule is not positions-only');
  }
}

console.log('\n== 3. the TOLERANCE has two sides, and both are pinned by number ==');
{
  // (a) THE REPORTED SHAPE IS ABSORBED. The drill reported was seed 23, offering `Circle Right 1/2 Home` with a board
  // 0.0364 units and 0.0195 rad from the goal — 0.0461 in the engine's combined metric. THAT OPTION IS NO LONGER IN THE
  // SEASON, because the fix is what removes it (section 4 is the census), so the magnitudes are reproduced here from a
  // real goal board: the drift a second call path produces, not a board that is somewhere else.
  const goal = SEASON_PUZZLES[0].goal;
  const drifted = { dancers: goal.dancers.map((d, i) => (i === 0 ? { ...d, x: d.x + 0.0364, heading: d.heading + 0.0195 } : d)) };
  const drift = congruenceOf(drifted, goal);
  check(drift <= ARRANGEMENT_TOL, `a drift of the reported size is ${drift.toFixed(4)} from the goal, inside the ${ARRANGEMENT_TOL} tolerance`);
  check(sameArrangement(drifted, goal), '  so it IS the goal arrangement — this is the reported refusal, closed');
  check(!sameBoardById(drifted, goal), '  and it is still not the goal\'s exact board, so the tolerance is doing the work and not identity');
  // (b) A REAL DISPLACEMENT IS STILL REFUSED, so the tolerance did not become "any board".
  const nudged = { dancers: goal.dancers.map((d, i) => (i === 0 ? { ...d, x: d.x + 0.3 } : d)) };
  check(!sameArrangement(nudged, goal), `NEGATIVE CONTROL: one dancer 0.3 off is refused (${congruenceOf(nudged, goal).toFixed(3)})`);
  // (c) AND A FACING FLIP IS STILL REFUSED, which is section 2's subject restated against the tolerance.
  const flipped = { dancers: goal.dancers.map((d) => ({ ...d, heading: d.heading + Math.PI })) };
  check(!sameArrangement(flipped, goal), `NEGATIVE CONTROL: a half-turned copy is refused (${congruenceOf(flipped, goal).toFixed(3)})`);
}

console.log('\n== 4. the CENSUS: no drill in the baked season offers the goal as a distractor ==');
{
  // THE INSTRUMENT THAT WOULD HAVE CAUGHT THE REPORT, and the denominator is printed because a census that measured
  // nothing would otherwise pass. It failed with 10 before the tolerance (8 within 0.06 units/0.06 rad plus 2 at 0.069)
  // and is the reason `ARRANGEMENT_TOL` is not merely a comment.
  let puzzles = 0;
  let options = 0;
  const offenders = [];
  for (const puzzle of SEASON_PUZZLES) {
    puzzles++;
    puzzle.steps.forEach((step, si) => {
      step.moves.forEach((move, mi) => {
        options++;
        if (mi === step.correctIndex) return;
        if (reachedGoal(move.board, puzzle.goal)) offenders.push(`seed ${puzzle.seed} step ${si + 1} "${move.call}"`);
      });
    });
  }
  check(puzzles > 0 && options > 0, `the census walked ${puzzles} puzzle(s) and ${options} option(s)`);
  for (const line of offenders.slice(0, 10)) console.log(`  OFFER ${line}`);
  check(offenders.length === 0, `no distractor is the goal's arrangement (${offenders.length} offender(s))`);
}

console.log('\n== 5. the waypoint list is the ROUTE, and its last board is the LANDING, in its own orientation ==');
{
  // REPORTED: "The game offers a drill of 'Circle Right 1/2' starting from 'Circle' to 'Circle' … but the target setup is
  // displayed in its default orientation. Because of this it doesnt look like the final setup." The generator ALREADY
  // applies every call and carries the boards (`path`), so nothing needs re-running; what could lose the orientation was
  // the waypoint COLLAPSE, which kept the first board of a run and so could hide the landing — measured at 2 of 108
  // before this rule.
  let puzzles = 0;
  let suppressed = 0;
  let targetNotLanding = 0;
  let noOpStages = 0;
  for (const puzzle of SEASON_PUZZLES) {
    puzzles++;
    const waypoints = waypointBoards(puzzle.path);
    if (waypoints.length !== puzzle.path.length) suppressed++;
    if (!sameBoardById(waypoints[waypoints.length - 1], puzzle.goal)) targetNotLanding++;
    for (let i = 0; i < puzzle.path.length - 1; i++) if (sameArrangement(puzzle.path[i], puzzle.path[i + 1])) noOpStages++;
    // THE TARGET THE PAIR ACTUALLY DRAWS at the end of the route: the right-hand slot of the last pair.
    const shown = waypointPair(waypoints.length, waypoints.length - 1, null, null);
    if (!sameBoardById(waypoints[shown.rightIndex], puzzle.goal)) targetNotLanding++;
  }
  check(puzzles > 0, `the walk covered the whole bake (${puzzles} puzzle(s))`);
  check(noOpStages === 0, `no stage stays in the arrangement it left (${noOpStages} in the bake)`);
  check(suppressed === 0, `so no stage is suppressed by the collapse (${suppressed} suppressed)`);
  check(targetNotLanding === 0, `and the pair's last right-hand board IS the landing board, by identity (${targetNotLanding} wrong)`);

  // NEGATIVE CONTROL, on a hand-built path: a run of two boards in ONE arrangement keeps the FIRST board for the waypoint
  // it collapses, but the LAST waypoint must be the route's own last board. A `waypointBoards` that kept the first of the
  // run fails exactly this.
  const base = SEASON_PUZZLES[0].path[0];
  const drift = { dancers: base.dancers.map((d, i) => (i === 0 ? { ...d, x: d.x + 0.03 } : d)) };
  const list = waypointBoards([base, drift]);
  check(list.length === 1, `two boards in one arrangement are one waypoint (${list.length})`);
  check(list[0] === drift, 'NEGATIVE CONTROL: and the waypoint is the LAST board, because that is the one the route ends on — a keep-first collapse fails here');
  // AND A RETURN IS STILL THREE WAYPOINTS, each shown in its own orientation. The middle board is the base turned by
  // 22.5 degrees, which is NOT one of the eight symmetries, so it is a different arrangement — a TRANSLATION would be the
  // same one and would prove nothing.
  const half = Math.PI / 8;
  const turned = {
    dancers: base.dancers.map((d) => ({
      ...d,
      x: Math.cos(half) * d.x - Math.sin(half) * d.y,
      y: Math.sin(half) * d.x + Math.cos(half) * d.y,
      heading: d.heading + half,
    })),
  };
  const twoStages = waypointBoards([base, turned, base]);
  check(twoStages.length === 3, `A -> B -> A is three waypoints (${twoStages.length})`);
  check(twoStages[2] === base, 'and the third is the board the route returns to, so the landing is what is drawn');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
