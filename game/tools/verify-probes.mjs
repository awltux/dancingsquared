// The game's probe runner: THE LIST IS THE DIRECTORY, so registration cannot be forgotten and a
// deletion cannot leave a dangling entry (AGENTS.md 5).
//
// Modelled on `poc/tools/verify-probes.mjs` and deliberately simpler than it: there is no slow tier,
// because nothing in the game's core is corpus-scale — the whole suite runs in seconds, and a two-tier
// split with one tier is ceremony that later reads as a gate that was skipped.
//
// PROBES RUN IN THIS PROCESS, with `process.exit` and `console.log` intercepted rather than driven as
// children. That is not a stylistic choice: AGENTS.md trap 3 records that a Node child spawned with
// piped stdio fails with EPERM under the file sandbox, so a runner that captured its children's output
// could not run at all. `stdio: 'inherit'` would work but would lose the per-probe verdict.
//
// Run: node game/tools/verify-probes.mjs   (from anywhere; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', 'test');
// THE CORPUS-COPY CHECK USED TO BE HERE, AND IT IS GONE BECAUSE THE COPY IT GUARDED IS GONE.
//
// `game/src/assets/` was a byte-for-byte copy of the POC's corpus, and this runner opened with
// `tools/sync-corpus.mjs --check` so the copy could not drift. The copy existed because a comment claimed
// `import.meta.glob` cannot reach outside Vite's root — MEASURED false (`vite.corpus.ts` traces the empty glob
// that made it look true to one `../` too few), so there is now ONE corpus at `assets/` in the repository root and
// the game's loader reads it directly. There is nothing left to keep in step, so there is nothing to check.
//
// THE POOL IS NOT CHECKED HERE EITHER, AND THE REASON IS THE ONE THING THAT CHANGED ABOUT IT.
//
// `src/puzzle/calls-data.ts` was generated, and this runner used to run the generator's `--check` on it — which
// was the gate that caught a corpus rename (`134ff33` left the pool naming a title no tam declared, and the
// failure surfaced two probes later as "every one of the level's 15 titles registered with the engine (14)").
// The owner took the order over BY HAND and the generator is gone, so a staleness check has nothing to compare
// against; what is left is the pool's own validity, and that is `game/test/pool-probe.mjs` — a probe, in the
// directory, where the list cannot forget it.
const all = fs.readdirSync(DIR).filter((f) => f.endsWith('-probe.mjs')).sort();
if (all.length === 0) {
  console.error(`verify-probes: no probes found in ${DIR}`);
  process.exit(1);
}

class ProbeExit {
  constructor(code) {
    this.code = code;
  }
}

const realExit = process.exit;
const realLog = console.log;
// OUR OWN FLAGS MUST NOT REACH A PROBE. Probes are imported in-process, so they read OUR `process.argv`;
// the POC's runner was bitten by exactly this (its `--all` flag became a call name in two probes).
const realArgv = process.argv;

const results = [];
for (const file of all) {
  const lines = [];
  console.log = (...args) => lines.push(args.map(String).join(' '));
  let code = 0;
  let crashed = null;
  let judgedOnOutput = false;
  process.exit = (c) => {
    throw new ProbeExit(typeof c === 'number' ? c : 0);
  };
  process.argv = [realArgv[0], path.join(DIR, file)];
  const started = Date.now();
  try {
    await import(pathToFileURL(path.join(DIR, file)).href);
    // A probe that falls off the end has not set an exit code. That is a weaker signal than an explicit
    // exit, and the summary says which probes rely on it rather than pretending the two are the same.
    judgedOnOutput = true;
    code = lines.some((l) => /(^|\s)FAIL(\s|$)/.test(l)) ? 1 : 0;
  } catch (err) {
    if (err instanceof ProbeExit) code = err.code;
    else {
      code = 1;
      crashed = (err && err.stack) || String(err);
    }
  } finally {
    process.exit = realExit;
    console.log = realLog;
    process.argv = realArgv;
  }
  results.push({ file, code, lines, ms: Date.now() - started, crashed, judgedOnOutput });
  console.log(`${code === 0 ? 'ok  ' : 'FAIL'}  ${file.padEnd(30)} ${String(Date.now() - started).padStart(6)} ms`);
}

const bad = results.filter((r) => r.code !== 0);
for (const r of bad) {
  console.log(`\n---------------- ${r.file} ----------------`);
  for (const l of r.lines) console.log(l);
  if (r.crashed) console.log(r.crashed);
}
const onOutput = results.filter((r) => r.judgedOnOutput).map((r) => r.file);
console.log(`\n${results.length} probe(s), ${bad.length} failed`);
if (onOutput.length) {
  console.log(`${onOutput.length} of them never call process.exit, so they were judged on their own FAIL lines: ${onOutput.join(', ')}`);
}
process.exit(bad.length === 0 ? 0 : 1);
