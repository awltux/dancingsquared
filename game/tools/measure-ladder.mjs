// The ladder census: WHAT THE PUBLISHED LEVELS ACTUALLY COST, measured rather than claimed.
//
//   node game/tools/measure-ladder.mjs [levels] [seeds] [budget]
//
// This is a GENERATOR, not a check — it prints numbers and always exits 0. The design's §5 says not to
// invent the ladder's ceiling and §7.1 says not to ship an unmeasured budget; this is the instrument both
// of those refer to. The numbers it prints are the ones quoted in `game/src/puzzle/levels.ts`, and
// re-running it after a corpus or generator change is how those comments stay true.
//
// WHAT IT MEASURES, per level: how many seeds generate, the worst wall time, the largest exploration, the
// pool size actually registered with the engine (which can be smaller than the level asks for), and how
// often the puzzle carries an alternate path — which is the one gate that is a SHOULD rather than a MUST,
// so it is reported instead of enforced.
//
// THE BUDGET ARGUMENT DEFAULTS TO THE SHIPPED ONE (`NODE_BUDGET`), and this tool is the one caller that
// may override it: its answer is the budget the ladder should ship, so it has to be able to try one the
// game does not.
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { NODE_BUDGET, generatorConfigFor } from '../src/puzzle/config.ts';
import { firstLevels } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor, poolIsComplete } from '../src/puzzle/pool.ts';
import { applierFor } from '../src/data/corpus-node.ts';

const levels = Number(process.argv[2] ?? 30);
const seeds = Number(process.argv[3] ?? 5);
const budget = Number(process.argv[4] ?? NODE_BUDGET);

console.log(`ladder census: ${levels} level(s) x ${seeds} seed(s), budget ${budget}, pool ${MAIN_POOL.order.length} titles`);
console.log('lvl  pool depth opts  ok/seed  worst ms  explored  unknown  alt  pool-short');
let worstOverall = 0;
for (const spec of firstLevels(levels)) {
  const pool = poolFor(spec, MAIN_POOL);
  const { applier, registered } = applierFor(pool, spec.poolSize);
  let ok = 0;
  let worst = 0;
  let explored = 0;
  let unknowns = 0;
  let alts = 0;
  let why = '';
  // The level's own configuration, with the SWEPT budget on top: this tool exists to try budgets the game
  // does not ship, so it is the one caller that overrides the shipped one.
  const config = { ...generatorConfigFor(pool.version ?? MAIN_POOL.version, spec), nodeBudget: budget };
  for (let s = 1; s <= seeds; s++) {
    const t = Date.now();
    const r = generatePuzzle(config, s * 7919, spec, applier);
    const ms = Date.now() - t;
    if (r.ok) {
      ok++;
      worst = Math.max(worst, ms);
      explored = Math.max(explored, r.puzzle.explored);
      if (r.puzzle.steps.some((st) => st.unknown)) unknowns++;
      if (r.puzzle.alternatePath) alts++;
    } else if (!why) {
      why = r.reason;
    }
  }
  worstOverall = Math.max(worstOverall, worst);
  console.log(
    `${String(spec.index).padStart(3)} ${String(spec.poolSize).padStart(5)} ${String(spec.depth).padStart(5)} ${String(spec.optionCount).padStart(4)}  ${String(ok).padStart(4)}/${seeds}  ${String(worst).padStart(8)}  ${String(explored).padStart(8)}  ${String(unknowns).padStart(7)}  ${String(alts).padStart(3)}  ${poolIsComplete(spec, MAIN_POOL) ? '' : 'POOL-SHORT'}${registered < spec.poolSize ? ' (registered ' + registered + ')' : ''}`,
  );
  if (ok < seeds && why) console.log(`      why: ${why.slice(0, 110)}`);
}
console.log(`\nworst level ${worstOverall} ms — the number the client's generation budget has to cover (DESIGN.md 7.1)`);
