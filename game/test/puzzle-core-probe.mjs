// THE GENERATED PUZZLE, pinned: is it solvable at the depth it claims, are its options legal and
// distinct, is its optional illegal choice the ENGINE's refusal, and is generation reproducible?
//
// These are the properties the whole game rests on. The DRILL draws the options, the DAILY checks a
// solution against the goal, and the SERVER validates a submission by REGENERATING the puzzle — so a
// generator that is merely "usually right" is not usable, and each check below names the wrong rule it
// rules out (AGENTS.md 5: every check needs a negative control, and the comment says which check catches
// which alternative).
//
// Usage: node game/test/puzzle-core-probe.mjs   (engine must be built)
import { sameBoardById } from 'dancing-squared-engine';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { firstLevels, levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { boardSig } from 'dancing-squared-engine';
import { applierFor } from './lib/corpus.mjs';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** The level the checks run at, and the pool it needs. Level 3 is chosen deliberately: pool 15, depth 2,
 * 2 options — a level that GENERATES (MEASURED 5/5) and whose depth is above 1, so the multi-step rules
 * are exercised rather than skipped. */
const LEVEL = levelSpec(3);
const POOL = poolFor(LEVEL, MAIN_POOL);
const { applier, registered } = applierFor(POOL, LEVEL.poolSize);
const CONFIG = { poolVersion: MAIN_POOL.version, maxDepth: LEVEL.depth, nodeBudget: 50_000 };
const SEED = 20260714;

console.log(`== the level under test: pool ${POOL.length} titles, ${registered} registered, depth ${LEVEL.depth} ==`);
check(registered === LEVEL.poolSize, `every one of the level's ${LEVEL.poolSize} titles registered with the engine (${registered})`);

const first = generatePuzzle(CONFIG, SEED, LEVEL, applier);
check(first.ok, `a puzzle generates at L${LEVEL.index} from seed ${SEED}`);
if (!first.ok) {
  console.log(`\n  reason: ${first.reason}`);
  console.log(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
const p = first.puzzle;

console.log('\n== 1. the puzzle is what it claims to be ==');
{
  check(p.steps.length === LEVEL.depth, `it has ${p.steps.length} step(s), the level's depth (${LEVEL.depth})`);
  check(p.path.length === p.steps.length + 1, `its path has one more board than it has steps (${p.path.length} boards, ${p.steps.length} steps)`);
  check(sameBoardById(p.path[0], p.start), 'path[0] IS the start board');
  check(sameBoardById(p.path[p.path.length - 1], p.goal), 'the last board on the path IS the goal');
  check(!sameBoardById(p.start, p.goal), 'and the goal is NOT the start — otherwise the puzzle is "these look the same"');
  check(p.shortest === LEVEL.depth, `it reports its shortest solution as ${p.shortest}`);
  check(p.solution.length === p.steps.length, `the solution names one call per step (${p.solution.length})`);
  for (let i = 0; i < p.steps.length; i++) check(p.solution[i] === p.steps[i].moves[p.steps[i].correctIndex].call, `step ${i + 1}'s correctIndex names the call the solution plays`);
}

console.log('\n== 2. THE OPTIONS ARE LEGAL FROM THE BOARD THEY ARE OFFERED ON ==');
{
  // The rule that would otherwise be assumed, and the one the DESIGN calls the whole UX: a button that
  // does not work when pressed. Measured by asking the engine, not by inspecting the puzzle's own arrays.
  let illegal = 0;
  let notDistinct = 0;
  for (let i = 0; i < p.steps.length; i++) {
    const step = p.steps[i];
    check(step.moves.length === LEVEL.optionCount, `step ${i + 1} offers exactly ${LEVEL.optionCount} option(s)`);
    check(sameBoardById(step.from, p.path[i]), `step ${i + 1} is offered from the board the path says it is`);
    const really = applier.offered(step.from);
    for (const o of step.moves) {
      if (!really.some((m) => m.call === o.call)) illegal++;
    }
    // Distinctness is checked with the ENGINE's rule, which is facing-aware — a signature comparison would
    // pass two options whose dancers face differently.
    for (let a = 0; a < step.moves.length; a++) {
      for (let b = a + 1; b < step.moves.length; b++) {
        if (sameBoardById(step.moves[a].board, step.moves[b].board)) notDistinct++;
      }
    }
  }
  check(illegal === 0, `every offered call is legal from the board it is offered on (${illegal} illegal)`);
  check(notDistinct === 0, `no two options in a step end on the same board (${notDistinct} collision(s))`);
  check(new Set(p.steps.map((s) => s.moves.length)).size === 1, 'every step offers the same number of options, so the question does not change shape mid-puzzle');
}

console.log('\n== 3. THE CORRECT OPTION IS CORRECT, and the wrong ones are not ==');
{
  for (let i = 0; i < p.steps.length; i++) {
    const step = p.steps[i];
    const correct = step.moves[step.correctIndex];
    const last = i === p.steps.length - 1;
    // On the LAST step the correct option must reach the goal; earlier, it must make progress. Both are
    // stated because conflating them is the defect this probe exists to catch: the first version of the
    // generator demanded a goal-reaching option at EVERY step, which is unsatisfiable for a board at
    // distance `i < d - 1` and made depth 2 generate nothing at all.
    if (last) check(sameBoardById(correct.board, p.goal), `step ${i + 1} (the last): the correct option reaches the goal board`);
    else check(!sameBoardById(correct.board, step.from), `step ${i + 1}: the correct option MOVES — a no-op cannot be progress`);
    // A WRONG OPTION MUST NOT REACH THE GOAL. This is the rule DESIGN.md 7.3 states, and the generator is
    // supposed to enforce it by reclassifying such an option as correct. If it ever fails here, the game is
    // telling a player who found a legal route that they were wrong.
    for (let j = 0; j < step.moves.length; j++) {
      if (j === step.correctIndex) continue;
      check(!sameBoardById(step.moves[j].board, p.goal), `step ${i + 1}: wrong option "${step.moves[j].call}" does NOT reach the goal`);
    }
  }
}

console.log('\n== 4. the illegal choice carries the ENGINE\'s reason, verbatim ==');
{
  const step = p.steps[0];
  check(step.unknown !== undefined, 'step 1 carries an illegal choice (the design allows one only at the start)');
  if (step.unknown) {
    const from = step.from;
    const engineSays = applier.refusalOf(from, step.unknown.call);
    check(engineSays !== null, `the engine really does refuse "${step.unknown.call}" from that board`);
    check(engineSays !== null && engineSays.reason === step.unknown.reason, 'and the reason recorded on the puzzle is the engine\'s own string, not a rewording');
    check(step.unknown.reason.length > 10, `the reason is a sentence rather than a code (${step.unknown.reason.length} chars)`);
    // A call the puzzle's own solution uses must never be the illegal one, or the game would refuse a
    // player for playing a call the puzzle elsewhere requires.
    check(!p.solution.includes(step.unknown.call), 'the illegal choice is not a call the solution plays');
    check(!step.moves.some((o) => o.call === step.unknown.call), 'nor one of this step\'s own options');
  }
}

console.log('\n== 5. GENERATION IS REPRODUCIBLE, byte for byte ==');
{
  // The property the server's verification-by-regeneration rests on (DESIGN.md 7). Compared as JSON with
  // a stable stringifier, so "identical" means identical fields in identical order — not merely equal
  // after a tolerance.
  const again = generatePuzzle(CONFIG, SEED, LEVEL, applier);
  check(again.ok, 'the same seed generates again');
  if (again.ok) {
    const a = JSON.stringify(p, Object.keys(p).sort());
    const b = JSON.stringify(again.puzzle, Object.keys(again.puzzle).sort());
    check(a === b, `the puzzle is byte-identical on a repeat call (${a.length} chars)`);
    // A DIFFERENT seed must give a different puzzle, or the seed isn't doing any work and every level
    // would be one memorized answer.
    const other = generatePuzzle(CONFIG, SEED + 1, LEVEL, applier);
    check(other.ok, 'a neighbouring seed also generates');
    if (other.ok) {
      const c = JSON.stringify(other.puzzle, Object.keys(other.puzzle).sort());
      check(c !== a, 'and it differs from this one — so the seed, not the level, decides the puzzle');
    }
  }
}

console.log('\n== 6. the ladder the game ships generates at every level ==');
{
  // A ladder level that cannot produce a puzzle is not a level, and the failure is invisible until a
  // player reaches it. This walks the whole published ladder with one seed each — the full census, with
  // timings, is `game/tools/measure-ladder.mjs`.
  const levels = firstLevels(30);
  let generated = 0;
  const failed = [];
  for (const spec of levels) {
    const pool = poolFor(spec, MAIN_POOL);
    const { applier: a } = applierFor(pool, spec.poolSize);
    const r = generatePuzzle({ poolVersion: MAIN_POOL.version, maxDepth: spec.depth, nodeBudget: 50_000 }, 7919, spec, a);
    if (r.ok) generated++;
    else failed.push(`L${spec.index} (pool ${spec.poolSize}): ${r.reason}`);
  }
  check(generated === levels.length, `all ${levels.length} published level(s) generate (${generated} did)`);
  for (const f of failed.slice(0, 4)) console.log(`       ${f}`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
