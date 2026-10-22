// EVERY BOARD THE GAME DRAWS HAS FOUR COLOURS — the shared rule, and the one line that uses it.
//
// REPORTED: "Can the game boards display the dancer couple colours, even if the formations aren't in the start
// formations list." The engine knows a dancer's HOME COUPLE only for the formations it can identify, and MEASURED at
// level 1 that is 6 of the 44 start boards — the other 38 come back with `couple: 0` on every dancer, and
// `coupleColor(0)` is one grey for all eight. So the boards a player was seeing were grey, and a grey set is eight
// dancers nobody can tell apart.
//
// THE RULE IS `displayCouple` (`packages/stage`, shared with the POC): a dancer with a real home couple is drawn in it,
// and one without is drawn in the colour of the PAIR it sits in in the board's own order. This probe measures the rule
// over the game's own boards AND checks that the game's render module actually calls it — the renderer itself imports
// `three` and cannot be loaded here, so the source check is the only way to gate the call site (the POC's own
// `display-couple-probe.mjs` gates its two call sites the same way).
//
// Usage: node game/test/board-colours-probe.mjs   (engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// BY PATH, not through the package barrel: the barrel spells its exports `./x.js` for the bundlers, which bare node
// cannot resolve against the source tree. The POC's own display-couple probe loads this module the same way.
import { displayCouple } from '../../packages/stage/display-couple.ts';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { applierFor } from '../src/data/corpus-node.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
const colours = (board) => board.dancers.map((d, i) => displayCouple(d, i, true));
const pairing = (board) => board.dancers.map((_, i) => (Math.floor(i / 2) % 4) + 1);

const LEVEL = levelSpec(1);
const spec = { ...LEVEL, mode: 'drill' };
const { applier } = applierFor(poolFor(LEVEL, MAIN_POOL), LEVEL.poolSize);
const starts = applier.startBoards();

console.log('== 1. the cause, measured: most boards have no home couple at all ==');
{
  const without = starts.filter((b) => b.dancers.every((d) => !(typeof d.couple === 'number' && d.couple > 0)));
  check(starts.length === 44, `the level offers ${starts.length} start boards`);
  check(without.length === 38, `and ${without.length} of them carry NO home couple on any dancer — the grey boards reported`);
  // NEGATIVE CONTROL: the expression the game used, `d.couple ?? 0`, gives one colour for those boards. If it did not,
  // there would have been nothing to report.
  const old = without[0].dancers.map((d) => d.couple ?? 0);
  check(new Set(old).size === 1 && old[0] === 0, `NEGATIVE CONTROL: the old expression (\`d.couple ?? 0\`) gives one grey for all eight (${JSON.stringify([...new Set(old)])})`);
}

console.log('\n== 2. the rule: four colours per board, two dancers each, none grey ==');
{
  const boards = [...starts];
  // Plus boards the generator publishes, because a drill's GOAL is drawn too — and a mid-puzzle board may be a
  // formation the start census never offered.
  for (let seed = 1; seed <= 6; seed++) {
    const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec, 'drill'), seed, spec, applier);
    if (built.ok) boards.push(built.puzzle.goal, built.puzzle.start);
  }
  let grey = 0;
  let wrongShape = 0;
  for (const board of boards) {
    const cs = colours(board);
    if (cs.some((c) => c <= 0)) grey++;
    const tally = new Map();
    for (const c of cs) tally.set(c, (tally.get(c) ?? 0) + 1);
    if (cs.length !== 8 || tally.size !== 4 || [...tally.values()].some((n) => n !== 2)) wrongShape++;
  }
  check(grey === 0, `no dancer on any of the ${boards.length} board(s) is drawn grey (${grey} board(s) with a 0)`);
  check(wrongShape === 0, `and every one of them is four colours with two dancers each (${wrongShape} board(s) without)`);
}

console.log('\n== 3. a couple the engine KNOWS wins over the pair number ==');
{
  const home = starts.find((b) => applier.nameOf(b) === 'Static Square');
  check(!!home, 'the census contains a squared set, whose dancers carry real home couples');
  if (home) {
    const cs = colours(home);
    check(cs.every((c) => c > 0), 'its dancers are coloured');
    check(cs.join(',') !== pairing(home).join(','),
      `NEGATIVE CONTROL: its colours are the ENGINE'S couples, not the array pairing (${cs.join(',')} against ${pairing(home).join(',')})`);
    check(home.dancers.every((d, i) => d.couple === cs[i]),
      'and each one is exactly the couple the board carries — the fallback is only for an unknown one');
  }
}

console.log('\n== 4. the game calls the rule, and not the old expression ==');
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, '..', 'src', 'render', 'stage-view.ts'), 'utf8');
  check(/displayCouple\(d, i, true\)/.test(source),
    'the board view derives each dancer’s colour through `displayCouple(d, i, true)`');
  check(!/d\.couple \?\? 0/.test(source),
    'and the grey-avatar expression (`d.couple ?? 0`) is gone from it — the line this change replaced');
  check(/knownCouple\)/.test(source) && /const knownCouple = typeof d\.couple === 'number' && d\.couple > 0/.test(source),
    'while the couple NUMBER label is drawn only for a couple the engine actually knows (a derived pair asserts no head or side)');
  check(/buildFlatMarker\(d\.gender, couple\)/.test(source),
    'and the flat marker takes the same value, so the 2D and 3D views agree about who is a pair');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
