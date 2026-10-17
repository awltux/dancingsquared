// THE WIRE'S PUZZLE, as the client reads it: `parsePuzzle` over a REAL generated puzzle that has been through JSON.
//
// WHY THIS IS A GATE. `GET /drill/current` and `GET /puzzle` carry a generated puzzle now (DESIGN.md §9), so the
// boards the client draws and the boards the server scores arrive as JSON — and JSON is not neutral: it drops
// `undefined`, so every optional field on a dancer is gone by the time the client holds the board, and
// `sameBoardById` is what decides whether a drill was answered correctly. The api's own probe asserts the payload
// is byte-identical to the object it generated (`api/test/drill-probe.mjs`); it CANNOT assert that the engine still
// regards the round-tripped boards as the same boards, because the engine is not one of the api's dependencies.
// That half is here, where the engine is.
//
// THE FOUR THINGS MEASURED:
//   1. a real puzzle survives stringify/parse/`parsePuzzle` and every board still compares equal by the engine's
//      own rule — start, goal, every path board, every option's board and every step's `after`;
//   2. the ANSWER KEY still works after the round trip: playing the solution from the start reaches the goal, and
//      each step's correct option still ends where `after` says it does;
//   3. a malformed puzzle is REFUSED, one field at a time, each with the check that catches it;
//   4. the shape check does NOT re-validate the game's rules — a puzzle whose `shortest` disagrees with its steps
//      still parses, because those rules are the generator's and the API's, measured where they are produced. That
//      is pinned as a deliberate boundary rather than left to be "fixed" by a later reader.
//
// Usage: node game/test/puzzle-wire-probe.mjs   (the engine must be built)
import { sameBoardById } from 'dancing-squared-engine';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { parsePuzzle, parseReadings } from '../src/puzzle/parse.ts';
import { applierFor } from '../src/data/corpus-node.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = levelSpec(1);
const { applier } = applierFor(poolFor(LEVEL, MAIN_POOL), LEVEL.poolSize);
const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, LEVEL), 7919, LEVEL, applier);
if (!built.ok) {
  console.log(`  FAIL the probe's own seed does not generate: ${built.reason}`);
  process.exit(1);
}
const original = built.puzzle;
/** The puzzle as the CLIENT receives it: through the wire and back. */
const wire = JSON.parse(JSON.stringify(original));
const parsed = parsePuzzle(wire);

console.log('== 1. a real puzzle survives the wire and the shape check ==');
{
  check(parsed !== null, `the round-tripped puzzle parses (${parsed ? parsed.mode : 'null'})`);
  check(parsed.seed === original.seed && parsed.poolVersion === original.poolVersion && parsed.level.index === original.level.index, `with its seed, pool version and level (${parsed?.seed}, ${parsed?.poolVersion}, level ${parsed?.level?.index})`);
  check(parsed.steps.length === original.steps.length && parsed.solution.length === original.solution.length, `and ${parsed.steps.length} step(s), ${parsed.solution.length} call(s) of solution`);

  // EVERY BOARD COMPARES EQUAL BY THE ENGINE'S OWN RULE. This is the check the api cannot make: `sameBoardById` is
  // the verdict function, and a board that survives JSON but not this would mark a correct answer wrong.
  const pairs = [['start', parsed.start, original.start], ['goal', parsed.goal, original.goal]];
  parsed.path.forEach((board, i) => pairs.push([`path[${i}]`, board, original.path[i]]));
  parsed.steps.forEach((step, i) => {
    pairs.push([`steps[${i}].from`, step.from, original.steps[i].from]);
    pairs.push([`steps[${i}].after`, step.after, original.steps[i].after]);
    step.moves.forEach((move, j) => pairs.push([`steps[${i}].moves[${j}]`, move.board, original.steps[i].moves[j].board]));
  });
  const unequal = pairs.filter(([, a, b]) => !sameBoardById(a, b));
  check(unequal.length === 0, `${pairs.length} board pair(s) compare equal through \`sameBoardById\`${unequal.length ? ` — ${unequal.map(([name]) => name).join(', ')} did not` : ''}`);
  // NEGATIVE CONTROL, MEASURED: the comparison is not vacuous — the start and the goal are NOT the same board, so a
  // parser that returned one board for everything would fail the check above rather than pass it.
  check(!sameBoardById(parsed.start, parsed.goal), 'NEGATIVE CONTROL: the start and the goal are different boards, so the equality above is a comparison and not a constant');
}

console.log('\n== 2. the answer key still works after the wire ==');
{
  let board = parsed.start;
  for (const call of parsed.solution) {
    const refusal = applier.refusalOf(board, call);
    if (refusal) {
      check(false, `the solution's call "${call}" is refused after the round trip: ${refusal.reason}`);
      break;
    }
    board = applier.apply(board, call);
  }
  check(applier.boardsMatch(board, parsed.goal), 'playing the parsed solution from the parsed start reaches the parsed goal');
  const stepKey = parsed.steps.every((step) => sameBoardById(step.moves[step.correctIndex].board, step.after));
  check(stepKey, 'and every step\'s correct option still ends on its own `after` board, which is what a press is scored on');
  // THE ILLEGAL OPTION'S PROSE IS THE ENGINE'S, so it has to survive the wire too: a drill's fourth choice is shown
  // WITH the refusal, and a lost reason would be a button with no explanation.
  const withUnknown = parsed.steps.find((step) => step.unknown);
  check(withUnknown === undefined || (typeof withUnknown.unknown.reason === 'string' && withUnknown.unknown.reason.length > 0), `the illegal option's refusal survives, when the puzzle carries one (${withUnknown ? withUnknown.unknown.call : 'none at level 1'})`);
}

console.log('\n== 3. a malformed puzzle is refused, one field at a time ==');
{
  // EACH VARIANT IS THE PLAUSIBLE BAD PAYLOAD for one field, and the check names which rule catches it. A parser that
  // defaulted any of these would produce a screen that looks playable and a verdict nobody can explain.
  const clone = () => JSON.parse(JSON.stringify(wire));
  const cases = [
    ['a missing start board', (p) => delete p.start],
    ['a board with seven dancers', (p) => p.goal.dancers.pop()],
    ['a dancer whose x is a string', (p) => (p.start.dancers[0].x = '1')],
    ['a dancer with no gender', (p) => delete p.start.dancers[0].gender],
    ['a step with no options', (p) => (p.steps[0].moves = [])],
    ['a step with no after board', (p) => delete p.steps[0].after],
    ['a correct index past the options', (p) => (p.steps[0].correctIndex = 99)],
    ['a fractional correct index', (p) => (p.steps[0].correctIndex = 0.5)],
    ['a non-string solution call', (p) => (p.solution = [7])],
    ['an unknown mode', (p) => (p.mode = 'challenge')],
    ['no level at all', (p) => delete p.level],
    ['a level with no option count', (p) => delete p.level.optionCount],
  ];
  for (const [why, breakIt] of cases) {
    const broken = clone();
    breakIt(broken);
    check(parsePuzzle(broken) === null, `${why} is refused`);
  }
  // NEGATIVE CONTROL: THE UNBROKEN CLONE PARSES. Without it, a `parsePuzzle` that always returned null would pass
  // every check above — which is the failure mode of a shape check written against the wrong shape.
  check(parsePuzzle(clone()) !== null, 'NEGATIVE CONTROL: an unbroken clone still parses, so the refusals above are caused by the field that was broken');
}

console.log('\n== 4. the START BOARD\'S GROUPED LIST survives the wire too ==');
{
  // THE SERVER SHIPS THIS LIST so the picker can draw without an `applicableMoves` run (api/src/levels.ts's
  // `startReadings`), and the client parses it with the same board rule the puzzle gets. A lost or mangled entry would
  // be a picker that offers a move it cannot play.
  const list = applier.readings(parsed.start);
  const wiredList = JSON.parse(JSON.stringify(list));
  const parsedList = parseReadings(wiredList);
  check(parsedList !== null && parsedList.length === list.length, `the ${list.length} reading(s) of the start board parse back (${parsedList ? parsedList.length : 'null'})`);
  const spelling = (r) => (r.selection === null ? r.call : `${r.selection} ${r.call}`);
  const lost = (parsedList ?? []).filter((r) => applier.refusalOf(parsed.start, spelling(r)) !== null);
  check(lost.length === 0, `and every parsed reading is still legal as its own spelling${lost.length ? ` — ${lost.map(spelling).join(', ')}` : ''}`);
  // NEGATIVE CONTROLS: the parser refuses a list it cannot trust (a reading with no board, one whose board is not
  // eight dancers), and it does NOT need a group to exist (the whole-board reading is `selection: null`).
  check(parseReadings([{ call: 'X', selection: null }]) === null, 'a reading with no board is refused');
  check(parseReadings([{ call: 'X', selection: null, board: { dancers: [] } }]) === null, 'and so is one whose board has no dancers');
  check(parseReadings('none') === null, 'while something that is not a list at all is refused rather than thrown on');
  check(parseReadings([{ call: 'X', selection: null, board: parsed.start }]) !== null, 'NEGATIVE CONTROL: a well-formed reading does parse, so the refusals above are about the field that was broken');
}

console.log('\n== 5. the shape check does NOT re-validate the game\'s rules ==');
{
  // A DELIBERATE BOUNDARY, pinned so it is not "fixed" by accident. `parse.ts` asks "is this a puzzle shape", not
  // "is this a good puzzle": `shortest` disagreeing with the step count, or a step whose options share an ending,
  // are the GENERATOR's and the API's properties, measured where they are produced. A client that re-checked them
  // would be a second implementation of a rule it does not own, and the one that disagreed with the server would be
  // the client's.
  const loose = JSON.parse(JSON.stringify(wire));
  loose.shortest = 99;
  check(parsePuzzle(loose) !== null, `a puzzle claiming \`shortest: 99\` still parses (${parsePuzzle(loose)?.shortest}) — the claim is not this module's to check`);
  const duplicated = JSON.parse(JSON.stringify(wire));
  duplicated.steps[0].moves[1].call = duplicated.steps[0].moves[0].call;
  duplicated.steps[0].moves[1].board = JSON.parse(JSON.stringify(duplicated.steps[0].moves[0].board));
  check(parsePuzzle(duplicated) !== null, 'and so does one whose two options are the same call ending on the same board — a defect the generator\'s probe catches, not this one');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
