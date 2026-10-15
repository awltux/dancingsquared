// THE GAME'S GENERATOR CONFIGURATION, pinned: it has ONE home, and it reads the LEVEL's depth.
//
// WHY THIS IS A PROBE AND NOT A NOTE. Both defects it guards are invisible at runtime. A call site that
// builds its own configuration still generates a correct-looking puzzle — with whatever budget that copy
// says — so retuning the real one moves the GAME and leaves the GATE measuring the old number, which is
// the one failure a budget is gated for (AGENTS.md 4.1: measure the thing, not a copy of it). MEASURED
// before this probe existed: `main.ts` and three probes each carried their own literal budget, and the
// generator's own default configuration was exported and read by nobody.
//
// Usage: node game/test/config-probe.mjs   (engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_BUDGET, generatorConfigFor } from '../src/puzzle/config.ts';
import { MAX_DEPTH, firstLevels, levelSpec } from '../src/puzzle/levels.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = path.join(HERE, '..');

console.log('== 1. the configuration reads the LEVEL, not the ladder ceiling ==');
{
  // Negative control: `maxDepth: MAX_DEPTH` -- which is exactly what the deleted `DEFAULT_GENERATOR`
  // built -- fails the L1 assertion below and nothing else in this package would notice. The defect is
  // real rather than theoretical: L1's depth is 1, so a configuration carrying the ceiling searches two
  // calls deep and can hand a level-1 drill a two-call puzzle.
  const L1 = levelSpec(1);
  const cfg = generatorConfigFor('pool-under-test', L1);
  check(cfg.poolVersion === 'pool-under-test', 'the pool version it is given is the one it stamps');
  check(cfg.maxDepth === L1.depth, `L${L1.index}'s configuration searches its own depth ${L1.depth} (got ${cfg.maxDepth}, ceiling is ${MAX_DEPTH})`);
  check(cfg.nodeBudget === NODE_BUDGET, `and it carries the shipped budget ${NODE_BUDGET} (got ${cfg.nodeBudget})`);

  let wrongDepth = 0;
  const levels = firstLevels(30);
  for (const spec of levels) if (generatorConfigFor('pool-under-test', spec).maxDepth !== spec.depth) wrongDepth++;
  check(wrongDepth === 0, `every one of the ${levels.length} published level(s) gets its own depth (${wrongDepth} did not)`);

  // Negative control: a module-level shared configuration object -- the shape the deleted `DEFAULT_GENERATOR`
  // had -- fails this, and no check below or elsewhere in the package looks at object identity.
  check(generatorConfigFor('a', L1) !== generatorConfigFor('a', L1), 'each call builds a fresh object, so no caller can edit another caller\'s configuration');
}

console.log('\n== 1b. the mode travels with the configuration ==');
{
  // THE GENERATOR USED TO STAMP `mode: 'drill'` ON EVERY PUZZLE, measured: a Daily challenge came back
  // labelled as a Drill, which is the field Phase 5 will read to decide which board a run belongs on. The
  // default is the Drill because every caller but one is the Drill.
  const L1 = levelSpec(1);
  check(generatorConfigFor('pool-under-test', L1).mode === 'drill', `the default wants a Drill (got ${generatorConfigFor('pool-under-test', L1).mode})`);
  check(generatorConfigFor('pool-under-test', L1, 'daily').mode === 'daily', 'and a caller that says "daily" gets a Daily');
  // Negative control: a factory with one hard-coded mode fails exactly one of the two checks above, and
  // nothing else in this package reads `GeneratorConfig.mode`.
}

console.log('\n== 2. no source in this package hands the generator a budget of its own ==');
{
  // WHY A SOURCE SCAN RATHER THAN A BEHAVIOURAL CHECK: the thing being pinned is the ABSENCE of a second
  // literal, and a probe that generated a puzzle cannot see one -- it would pass against either copy. This
  // is the same shape as `tools/sync-corpus.mjs --check`: a rule about the tree, checked by reading it.
  //
  // Negative control: re-inlining the budget at any call site under `src/`, `test/` or `tools/` fails HERE
  // and nowhere else. The pattern requires a DIGIT, so the field's type annotation and this probe's own
  // prose do not match it.
  const NUMERIC_BUDGET = /\bnodeBudget\s*:\s*[0-9]/;
  const SKIP_DIRS = new Set(['assets', 'node_modules', 'dist', '.vite']);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (/\.(ts|mjs|js|cjs)$/.test(entry.name)) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  for (const sub of ['src', 'test', 'tools']) walk(path.join(PACKAGE, sub));

  const offenders = files.filter((f) => NUMERIC_BUDGET.test(fs.readFileSync(f, 'utf8')));
  check(files.length > 0, `the scan found source to read (${files.length} file(s))`);
  check(
    offenders.length === 0,
    `no source under src/, test/ or tools/ writes a numeric budget literal of its own (${offenders.length} file(s) do)`,
  );
  for (const f of offenders.slice(0, 4)) console.log(`       ${path.relative(PACKAGE, f)}`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
