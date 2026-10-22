// THE START BOARD IS ONE OF THE LEVEL'S OWN FORMATIONS, and the seed chooses which — pinned, with the
// negative control that makes the revert visible.
//
// WHY THIS IS A PROBE AND NOT A COMMENT IN THE GENERATOR. The report that started this work was
// "all drills seem identical", and it was TRUE and unmeasurable: the generator opened every question on a
// squared set, so a level whose pool declares 67 formations asked all of them from one board. MEASURED over
// the first 100 level-1 seeds, that constant start gave **5 distinct goal boards and 5 distinct starts**;
// the set below gives **37 goals and 17 starts** at the same level, with the same 77 distinct puzzles and the
// same 100/100 generation rate. A level's variety is a property of the game, so it needs a gate — and the
// gate has to fail when the start goes back to being constant, which is what §2's control does.
//
// THE START SET IS NOT A FREE CHOICE. `GameApplier.startBoards` derives it from the formations the level's
// own tams declare, and the generator applies the same three gates to every candidate that it applies to
// any board a step is played from (`nameOf`, enough legal calls, distinct endings). So this probe checks the
// CENSUS and the SHAPE of the choice, not a hand-picked list: there is no list here to fall behind.
//
// Usage: node game/test/start-formations-probe.mjs   (engine must be built)
import { makeSquaredSet, sameBoardById } from 'dancing-squared-engine';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { GENERATOR_VERSION, generatorConfigFor } from '../src/puzzle/config.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { applierFor } from '../src/data/corpus-node.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** Level 1: the teaching level, and the level the report was about — one call, two options. */
const LEVEL = levelSpec(1);
const { applier, registered } = applierFor(poolFor(LEVEL, MAIN_POOL), LEVEL.poolSize);
const CONFIG = generatorConfigFor(MAIN_POOL.version, LEVEL);
const squared = makeSquaredSet();

/** A stub applier whose start set is a constant — the code this change replaced, as a value. */
const constantStart = (board) => ({ ...applier, startBoards: () => [board] });

/** `count` seed/puzzle pairs, or null for a refusal. */
function sample(seedFrom, count, a = applier, config = CONFIG, level = LEVEL) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = generatePuzzle(config, seedFrom + i, level, a);
    out.push(r.ok ? r.puzzle : null);
  }
  return out;
}

console.log(`== the level under test: pool ${LEVEL.poolSize} titles, ${registered} registered, depth ${LEVEL.depth}, ${LEVEL.optionCount} options ==`);
check(registered === LEVEL.poolSize, `every one of the level's ${LEVEL.poolSize} titles registered with the engine (${registered})`);

console.log('\n== 1. the census: what the applier offers as a start ==');
const boards = applier.startBoards();
const named = boards.filter((b) => applier.nameOf(b) !== null);
{
  check(boards.length > 0, `the level's calls declare at least one buildable formation (${boards.length})`);
  check(named.length >= 10, `at least ten of them are formations the engine NAMES, so the player gets a caption (${named.length} of ${boards.length})`);
  // THE HOME FORMATION IS STILL A START. The pool declares it from 19 titles today, and that is the one
  // membership this probe asserts by name: a level that stopped being able to open from a squared set would
  // have lost the start the ladder teaches first, and nothing else here would notice.
  check(named.some((b) => applier.nameOf(b) === 'Static Square'), 'a squared set is among them, so the ladder still opens from home');
  // THE IDENTITY EVERY GOAL TEST DEPENDS ON: `sameBoardById` refuses a board whose ids are not unique, and
  // `boardsMatch` is the ONE goal test the game has — so a start that failed this could never be told apart
  // from its own goal.
  const badIdentity = named.filter((b) => b.dancers.length !== 8 || new Set(b.dancers.map((d) => d.id)).size !== 8);
  check(badIdentity.length === 0, `every named start is eight dancers with eight distinct identities (${badIdentity.length} without)`);
  // TWO STARTS THAT ARE THE SAME BOARD ARE ONE START — the dedupe, measured rather than trusted.
  const poses = new Set(named.map((b) => b.dancers.map((d) => `${d.id},${d.x},${d.y},${d.heading}`).join(';')));
  check(poses.size === named.length, `no two named starts are the same board (${poses.size} distinct poses of ${named.length})`);
  const names = [...new Set(named.map((b) => applier.nameOf(b)))].sort();
  console.log(`       ${names.length} distinct formation(s): ${names.join(', ')}`);
}

console.log('\n== 2. the generator opens on them — and a constant start is the negative control ==');
{
  // THE MEASURED PROPERTY, as a FLOOR rather than an equality: the number of reachable starts moves with the
  // pool, and a floor still fails the one thing that matters — a generator that stops varying. Today's
  // reading over these 40 seeds is printed beside it.
  const SAMPLE = 40;
  const puzzles = sample(1, SAMPLE);
  check(puzzles.every((p) => p !== null), `all ${SAMPLE} sampled seeds generate (${puzzles.filter(Boolean).length} did)`);
  const generated = puzzles.filter(Boolean);
  /** How many DIFFERENT boards a list of boards holds, by full pose (not `boardSig`, which is
   * rotation/reflection-invariant and so counts an LH and an RH tidal line as one). */
  const poseOf = (b) => b.dancers.map((d) => `${d.id},${d.x},${d.y},${d.heading}`).join(';');
  const distinctBoards = (bs) => new Set(bs.map(poseOf)).size;
  const variedStarts = distinctBoards(generated.map((p) => p.start));
  const variedGoals = distinctBoards(generated.map((p) => p.goal));
  check(variedStarts >= 5, `those seeds open on at least five different boards (${variedStarts}, over ${generated.length} puzzles)`);
  check(variedGoals >= 5, `and reach at least five different goals (${variedGoals})`);
  // THE QUESTION IS THE PAIR OF PICTURES, and this is the reported defect as a floor: "the drills seem to contain many
  // duplicates". The candidate key was `boardSig` — POSITIONS ONLY — so goals that differed only in facing were one
  // candidate; MEASURED, the 100-drill block asked 27 distinct questions before the change and 49 after, and the
  // whole level-1 space (2000 seeds) is 89. A floor of 20 over these 40 seeds is above what the old key could reach
  // and well below the 28 measured today.
  const pictures = new Set(generated.map((p) => `${poseOf(p.start)}//${poseOf(p.goal)}`));
  check(pictures.size >= 20,
    `so they ask at least twenty different QUESTIONS — a (start, goal) pair of pictures — over ${generated.length} seeds (${pictures.size})`);
  // NEGATIVE CONTROL: the same seeds against the constant start the generator used to hardcode. This is the
  // check a revert turns red — the other checks in this section stay green with one start, because a
  // constant start still generates a legal puzzle for every seed.
  const constant = sample(1, SAMPLE, constantStart(squared));
  check(constant.every((p) => p !== null), 'the constant-start control also generates, so the comparison is like for like');
  const constantStarts = distinctBoards(constant.filter(Boolean).map((p) => p.start));
  check(constantStarts === 1, `with a constant start the same seeds open on exactly one board (${constantStarts}) — which is the defect this change removed`);
  check(variedStarts > constantStarts, 'so the shipped generator varies the start where the control cannot');

  // THE SAME SEED MUST GIVE THE SAME START. The server verifies a submission by regenerating the puzzle, so a
  // start that depended on anything but `(seed, level)` would score a run against a board the player never saw.
  const a = generatePuzzle(CONFIG, 424242, LEVEL, applier);
  const b = generatePuzzle(CONFIG, 424242, LEVEL, applier);
  check(a.ok && b.ok && sameBoardById(a.puzzle.start, b.puzzle.start), 'the same seed regenerates the same start board');
  // AND A NEIGHBOURING SEED MUST BE ABLE TO DIFFER — otherwise the seed does no work and the level is one
  // memorized answer.
  const other = generatePuzzle(CONFIG, 424243, LEVEL, applier);
  check(other.ok && !sameBoardById(other.puzzle.start, a.puzzle.start), 'a neighbouring seed opens on a different board');

  // THE GENERATOR MAY NOT INVENT A START: whatever it opens on has to be one of the census's boards — and the
  // census is now EVERY buildable formation, not only the named ones. The naming gate was the rule that made the
  // drills repeat: MEASURED at this level, 24 of the 44 declared formations have no recogniser name, so the block
  // could only ever open on 20 of them, and the caption rule bought nothing a generic "Setup, k of n" cannot say.
  const strangers = generated.filter((p) => !boards.some((b) => sameBoardById(b, p.start)));
  check(strangers.length === 0, `every generated start is one of the ${boards.length} declared boards (${strangers.length} stranger(s))`);
  // AND THE UNNAMED ONES ARE REACHABLE, which is the change itself rather than its side effect: a probe that only
  // widened the stranger check would pass on a generator that still refused every unnamed start.
  const unnamedStarts = generated.filter((p) => applier.nameOf(p.start) === null);
  check(unnamedStarts.length > 0,
    `some of those seeds open on a formation the engine does not NAME (${unnamedStarts.length} of ${generated.length}), which the old census refused`);

  // THE MODE IS NOT A GATE ON THE START. The Daily asks the same generator at depth 3, and a Daily and a Drill
  // that disagreed about WHICH formation a seed opens on would be two rules for one question. Measured at the
  // Drill's depth so this costs one cheap generation rather than a 9-second depth-3 search.
  const asDaily = generatePuzzle({ ...CONFIG, mode: 'daily' }, 424242, LEVEL, applier);
  check(asDaily.ok && sameBoardById(asDaily.puzzle.start, a.puzzle.start), 'the Daily opens on the same board as the Drill for one seed — the start is not a per-mode rule');
}

console.log('\n== 3. a start that cannot carry the question is REFUSED, and said out loud ==');
{
  // The rule is one implementation (`startRefusal`) used both to filter and to report, so this measures the
  // report as well as the filter: a formation that offers fewer calls than the question needs must not throw,
  // must not generate a one-button puzzle, and must appear in the reason by count.
  const oneCall = { ...applier, startBoards: () => [{ dancers: squared.dancers }], offered: () => [] };
  const r = generatePuzzle(CONFIG, 7919, LEVEL, oneCall);
  check(!r.ok, 'a start set with no answers refuses rather than generating');
  if (!r.ok) {
    check(r.reason.includes('can open a puzzle'), `the refusal names the subject ("can open a puzzle"): ${r.reason.slice(0, 120)}`);
    check(r.reason.includes(`${LEVEL.optionCount}`), `and it names the option count the start failed to meet (${LEVEL.optionCount})`);
  }
}

console.log('\n== 4. the puzzle still holds its own gates, from a start that is NOT home ==');
{
  // A non-square start is the new case, so the properties are re-measured on one rather than assumed to carry
  // over: the goal differs from the start, it is named, the recorded solution walks the applier from start to
  // goal, and the first step's options are legal from the board it is offered on.
  const offHome = sample(1, 40).filter(Boolean).filter((p) => !sameBoardById(p.start, squared));
  check(offHome.length > 0, `the sample contains a puzzle that does not open from home (${offHome.length})`);
  const p = offHome[0];
  if (p) {
    // THE START'S NAME IS A CAPTION, NOT A GATE. It may be null now, and the caption over the boards says
    // "Setup, k of n" either way — so this reports which kind of start it is rather than requiring one.
    const name = applier.nameOf(p.start);
    check(name === null || typeof name === 'string', `that start is ${name ?? 'UNNAMED (the caption is its position)'}`);
    check(applier.nameOf(p.goal) !== null, `and its goal is named (${applier.nameOf(p.goal)})`);
    check(!sameBoardById(p.start, p.goal), 'the goal is not the start board');
    check(p.steps.length === LEVEL.depth, `it has ${p.steps.length} step(s), the level's depth (${LEVEL.depth})`);
    let board = p.start;
    let walked = true;
    for (const call of p.solution) {
      if (applier.refusalOf(board, call)) {
        walked = false;
        break;
      }
      board = applier.apply(board, call);
    }
    check(walked && sameBoardById(board, p.goal), 'the recorded solution walks from the start to the goal through the engine');
    const first = p.steps[0];
    check(sameBoardById(first.from, p.start), "step 1 is offered from the puzzle's own start");
    const offered = applier.offered(first.from).map((m) => m.call);
    check(first.moves.every((o) => offered.includes(o.call)), 'every option of step 1 is a call the engine really offers from it');
  }
}

console.log(`\n  (generator version ${GENERATOR_VERSION} — a start-board change invalidates every stored drill)`);
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
