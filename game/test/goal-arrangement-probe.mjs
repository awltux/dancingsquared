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
// Usage: node game/test/goal-arrangement-probe.mjs   (engine must be built)
import { sameBoardById, boardSig } from 'dancing-squared-engine';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { applierFor } from '../src/data/corpus-node.ts';
import { arrangementKey, reachedGoal } from '../src/puzzle/arrangement.ts';
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
  const goalKey = arrangementKey(puzzle.goal);
  const twin = applier.offered(puzzle.start).find((move) => arrangementKey(move.board) === goalKey && !sameBoardById(move.board, puzzle.goal));
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

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
