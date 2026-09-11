// The verify suite: ONE list of harnesses, two tiers.
//
//   node test/verify-suite.mjs light   - the fast subset, for general testing
//   node test/verify-suite.mjs all     - every harness, the pre-commit gate
//
// WHY TWO TIERS. The full suite is ~9 minutes and the time is very lopsided: measured on this
// machine, the four corpus-scale harnesses (alignment-boards 128s, behaviour-audit 102s, selection
// 60s, getout-convention 52s) plus four more (all8-format 44s, getout-behaviour 44s,
// getout-conformance 39s, promenade 33s) are 91% of it, while the remaining ELEVEN harnesses finish
// in about 49 seconds together. Running all nine minutes to check that a small edit did not break
// basic loading is the wrong trade, so `light` runs those eleven and `all` runs everything.
//
// WHY ONE LIST. The tiers are a FIELD on each entry rather than two lists, because two lists is how
// a harness gets added to one and forgotten in the other — the repo has been bitten by exactly that
// shape of drift (a second copy of a table) more than once. To add a harness, add one entry here;
// there is nowhere else to update. `why` records the reason a harness is not in `light`, so the
// banner can say what is being skipped rather than leaving the reader to diff the lists.
//
// STDOUT IS INHERITED, deliberately: under the file sandbox a Node child spawned with piped stdio
// fails with EPERM, so the runner must not capture its children's output. `stdio: 'inherit'` keeps
// each harness's report visible exactly as the old `&&` chain did, and `spawnSync` still returns the
// exit code.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const SUITE = [
  { h: 'gender-audit', light: true },
  { h: 'catalogue', light: true },
  { h: 'verify', light: true },
  { h: 'sequencer', light: true },
  { h: 'mainstream', light: true },
  { h: 'matrix', light: true },
  { h: 'matrix-getout', light: true },
  { h: 'editor', light: true },
  { h: 'features', light: true },
  { h: 'bind-audit', light: true },
  { h: 'alignment', light: true },
  { h: 'all8-formation-map', light: true },
  { h: 'promenade', light: false, why: 'corpus-scale sweep' },
  { h: 'getout-conformance', light: false, why: 'decodes all 553 published lines' },
  { h: 'all8-format', light: false, why: 'imports all 188 figures and derives all 29 alignments' },
  { h: 'getout-behaviour', light: false, why: 'runs the 412-line corpus' },
  { h: 'getout-convention', light: false, why: 'searches get-outs over the corpus alignments' },
  { h: 'selection', light: false, why: 'builds boards across formations and calls' },
  { h: 'behaviour-audit', light: false, why: '143 assertions, many over every formation' },
  { h: 'alignment-boards', light: false, why: 'the heaviest: arrangement tables over the corpus' },
  // NOT a tier above: a TARGET. `all8-figures` states the finish line ("every one of All8's 188
  // published Mainstream figures is recognised") and is red until the remaining edge cases are
  // fixed, so it is excluded from BOTH tiers - a permanently-failing entry in the pre-commit gate
  // trains everyone to ignore the gate. Run it on its own to see how far off the finish line is.
  { h: 'all8-figures', future: true, why: 'the target suite: red until every published figure is recognised' },
];

const mode = process.argv[2] === 'light' ? 'light' : process.argv[2] === 'figures' ? 'figures' : 'all';
const run = SUITE.filter((e) => (mode === 'figures' ? e.future : mode === 'all' ? !e.future : e.light));
const skipped = SUITE.filter((e) => !run.includes(e));

const MODE_LABEL = { light: 'LIGHT (fast subset)', all: 'FULL (pre-commit gate)', figures: 'TARGET (not a gate)' };
console.log(`verify-suite: ${MODE_LABEL[mode]} - ${run.length} of ${SUITE.length} harnesses`);
if (mode === 'light') {
  console.log('  SKIPPING the corpus-scale harnesses. This tier is for quick iteration; run the full');
  console.log('  suite (`npm run verify`) before committing, because everything below is NOT checked:');
  for (const e of skipped) console.log(`    ${e.h.padEnd(20)} ${e.why}`);
}

const results = [];
let failed = null;
for (const { h } of run) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(here, `${h}.mjs`)], { stdio: 'inherit' });
  const seconds = (Date.now() - started) / 1000;
  results.push({ h, seconds });
  if (r.status !== 0 && failed === null) failed = { h, status: r.status };
}

const total = results.reduce((s, r) => s + r.seconds, 0);
console.log(`\nverify-suite: ${run.length} harness(es) in ${total.toFixed(1)}s`);
for (const r of [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 5)) {
  console.log(`  slowest: ${r.h.padEnd(20)} ${r.seconds.toFixed(1)}s`);
}
if (failed) {
  console.log(`\nverify-suite: FAILED at ${failed.h} (exit ${failed.status})`);
  process.exit(failed.status ?? 1);
}
console.log('verify-suite: all green.');
