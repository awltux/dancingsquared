// THE VERIFY SUITE RUNNER: it runs the registry, it does not hold it.
//
// THE LIST IS `engine/test/suite.mjs`. It used to live in this file, which made it unreachable as data: importing
// this module to read the list would have RUN the suite. `engine/test/harness-registry.mjs` needs the list as
// data (it checks that every harness under `engine/test/` is either registered or says on line 1 that it is a
// one-shot diagnostic), so the list moved to `suite.mjs` and this file imports it. ONE list, one home — that is
// still the rule; the home moved. To add a harness, add one entry in `suite.mjs`; there is nowhere else to update.
//
//   node test/verify-suite.mjs light   - the fast subset, for general testing
//   node test/verify-suite.mjs all     - every harness, the pre-commit gate
//
// WHY TWO TIERS. The full suite is ~9 minutes and the time is very lopsided: measured on this
// machine, the four corpus-scale harnesses (alignment-boards 128s, behaviour-audit 102s, selection
// 60s, getout-convention 52s) plus three more (all8-format 44s, getout-behaviour 44s,
// getout-conformance 39s) are 91% of it, while the remaining harnesses finish
// in about 49 seconds together. Running all nine minutes to check that a small edit did not break
// basic loading is the wrong trade, so `light` runs the cheap ones and `all` runs everything.
//
// `promenade` USED TO BE IN THIS LIST and is gone with its subject: it gated the geometry-derived
// `Promenade` family, which is no longer derived (see `coded-moves.ts`). Six of its checks could only
// fail, because they called the call by name.
//
// STDOUT IS INHERITED, deliberately: under the file sandbox a Node child spawned with piped stdio
// fails with EPERM, so the runner must not capture its children's output. `stdio: 'inherit'` keeps
// each harness's report visible exactly as the old `&&` chain did, and `spawnSync` still returns the
// exit code.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';
import { SUITE } from './suite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

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

// THE CORPUS REVISION THESE NUMBERS BELONG TO, printed before anything is run. A red gate is undecidable
// without it: the verdict moves with `assets`, and a run on a mid-edit corpus cannot tell a
// regression from corpus churn (TODO.md P1.5). GIT PRINTS THE ANSWER ITSELF, with `stdio: 'inherit'`, because
// a PIPED child fails with EPERM under the file sandbox - the same reason every harness below is spawned
// that way (AGENTS.md trap 3), and why this reads no output of its own. An empty file list means the corpus
// is the committed tree; a list means these numbers belong to an uncommitted state.
const repoRoot = path.resolve(here, '..', '..');
// THE PATHSPEC IS DERIVED, not spelled: `git status` takes a path relative to the repo root and the corpus is
// not always two `..` from here (it is `corpusRoot()` and nothing else — `engine/test/corpus-location.mjs`
// enforces that). A hand-written `assets` here would be the one spelling the rest of the tree no longer keeps.
const corpusPathspec = path.relative(repoRoot, corpusRoot());
console.log('verify-suite: corpus revision (git prints it; a file list means assets is DIRTY, so the');
console.log('  numbers below belong to that uncommitted state and must not be compared with a committed run):');
spawnSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], { stdio: 'inherit' });
spawnSync('git', ['-C', repoRoot, 'status', '--porcelain', '--', corpusPathspec], { stdio: 'inherit' });

const results = [];
let failed = null;
for (const e of run) {
  const started = Date.now();
  // `sub` is for a harness that lives in `test/` but not directly in it - currently only the
  // determinism audit, which is an analysis tool in `test/tools/` that Phase 10's done-when promotes
  // into this suite. Keeping the entry HERE preserves the file's own rule that a harness is added in
  // exactly one place; the alternative (a second copy of the tool under `test/`) is the duplication
  // this suite was written to avoid.
  const file = path.join(here, ...(e.sub ? [e.sub] : []), `${e.h}.mjs`);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  const seconds = (Date.now() - started) / 1000;
  results.push({ h: e.h, seconds });
  // WHICH HARNESS THOSE CHECK LINES BELONG TO. Every harness is spawned with `stdio: 'inherit'` (trap 3), so
  // the suite cannot capture one's output and the log is a single undivided stream: without this line a run
  // names only the FIRST failing harness, and every later red has to be attributed by reading its message.
  // That is the difference between a measurement and a log, so it is printed as each harness settles.
  console.log(`\nverify-suite: ${r.status === 0 ? 'ok    ' : 'FAILED'} ${e.h} (${seconds.toFixed(1)}s)`);
  if (r.status !== 0 && failed === null) failed = { h: e.h, status: r.status };
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
