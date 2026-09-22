// The probe suite: RUNS every `*-probe.mjs` in this directory and reports which ones are red.
//
// WHY THIS EXISTS. Twenty-odd probes were written for the POC's own behaviour - the call editor, the FSM tab,
// the sequencer, the browse view - and NOTHING RAN ANY OF THEM. `poc/package.json` wires only `verify.cjs`, the
// root `verify` runs that, and no script mentions `poc/tools` at all. Two of them were red at HEAD for weeks
// (one pinned `selectMove(k: number)`, whose signature had since gained a parameter, and one read the body of a
// method the three loads had moved out of), and the only reason anybody knows is that an audit went looking.
// A probe nobody runs is a probe that is already stale; it just has not been noticed yet.
//
// THE LIST IS THE DIRECTORY. A probe is discovered by name, so adding one cannot forget to register it, and
// deleting one cannot leave a dangling entry. `_*.mjs` scratch files are not probes and are not picked up.
//
// EACH PROBE RUNS IN THIS PROCESS, with `process.exit` intercepted. That is not a stylistic choice: the probes
// are self-contained node scripts that end in `process.exit(failures ? 1 : 0)`, and driving them as CHILDREN
// needs a piped spawn, which the development sandbox refuses (`spawn EPERM`). Intercepting the exit runs the
// same file, top to bottom, with the same result, and needs nothing from the platform.
//
// Output is held back and shown only for a probe that fails, so a green run is one line per probe.
//
// Run: node poc/tools/verify-probes.mjs   (from anywhere; a probe that needs the engine wants it built first)
//      node poc/tools/verify-probes.mjs --all   (includes the SLOW tier below)
//
// TWO TIERS, the same shape `engine/test/verify-suite.mjs` uses and for the same reason: one probe costs more
// than the other twenty-six together, and a suite nobody can afford to run is a suite nobody runs - which is
// the staleness this file was written to fix. MEASURED before the split: 27 probes, 582 s, of which
// `call-formations-probe.mjs` is 461 s. So `verify` runs the twenty-six (~121 s) and the banner says what is
// being skipped rather than leaving the reader to diff the lists.
//
// WHY THAT PROBE IS SLOW, recorded here because it is the thing to fix if the split ever chafes:
// `walkCall` compares every sampled board against ALL 134 catalogue formations by their 28 pairwise
// distances, so one sample costs ~3750 comparisons - and it is called for every call in the corpus at a
// 0.5-beat step, then again at 0.0625 beats for the held population and a 40-file control. Nothing about it
// is wrong; it is a naive nearest-neighbour scan over a large sample.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The probes too expensive for the default tier, each with the reason the banner prints. */
const SLOW = {
  'call-formations-probe.mjs': 'scans every call at 0.5 beats and again at 0.0625, against all 134 formations per sample',
};

const ALL = process.argv.includes('--all');
const DIR = path.dirname(fileURLToPath(import.meta.url));
const all = fs.readdirSync(DIR).filter((f) => f.endsWith('-probe.mjs')).sort();
const files = ALL ? all : all.filter((f) => !(f in SLOW));
if (all.length === 0) {
  console.log('no probes found in ' + DIR);
  process.exit(1);
}
if (!ALL && files.length < all.length) {
  console.log(`verify-probes: FAST tier - ${files.length} of ${all.length} probes. Run with --all before a release;`);
  console.log('  the ones below are NOT checked by this run (each is a probe that still has to pass when asked):');
  for (const f of all) if (f in SLOW) console.log(`    ${f.padEnd(32)} ${SLOW[f]}`);
}

/** Thrown in place of an exit, so the run can continue to the next probe. */
class ProbeExit {
  constructor(code) { this.code = code; }
}

const realExit = process.exit;
const realLog = console.log;
// AND OUR OWN FLAGS MUST NOT REACH A PROBE. Probes are imported in-process, so they read OUR
// `process.argv` - and several take a call name from `argv[2]`. Under `--all` they were therefore asked
// for a call titled `--all`: `clone-refusal-probe.mjs` and `facing-chain-probe.mjs` both FAILED on
// exactly that, so `--all` - the mode that is supposed to check MORE - was checking those two less than
// the fast tier did. Each probe now sees the argv it would see run on its own.
const realArgv = process.argv;
const results = [];
for (const file of files) {
  const lines = [];
  console.log = (...args) => lines.push(args.map(String).join(' '));
  let code = 0;
  let crashed = null;
  let judgedOnOutput = false;
  process.exit = (c) => { throw new ProbeExit(typeof c === 'number' ? c : 0); };
  process.argv = [realArgv[0], path.join(DIR, file)];
  const started = Date.now();
  try {
    await import(pathToFileURL(path.join(DIR, file)).href);
    // A probe that falls off the end has not set an exit code. Most of these probes only exit when they FAIL,
    // so that is not itself a fault - but it IS a weaker signal, and the runner says which probes rely on it
    // rather than pretending the two are the same. `map-tips.mjs` is the case that taught this repo that a
    // counter with no exit code is decoration, so a probe with no exit code and no FAIL line is still only
    // as good as its own output.
    judgedOnOutput = true;
    code = lines.some((l) => /(^|\s)FAIL(\s|$)/.test(l)) ? 1 : 0;
  } catch (err) {
    if (err instanceof ProbeExit) code = err.code;
    else { code = 1; crashed = (err && err.stack) || String(err); }
  } finally {
    process.exit = realExit;
    console.log = realLog;
    process.argv = realArgv;
  }
  results.push({ file, code, lines, ms: Date.now() - started, crashed, judgedOnOutput });
  console.log(`${code === 0 ? 'ok  ' : 'FAIL'}  ${file.padEnd(32)} ${String(Date.now() - started).padStart(6)} ms`);
}

const bad = results.filter((r) => r.code !== 0);
for (const r of bad) {
  console.log(`\n---------------- ${r.file} ----------------`);
  for (const l of r.lines) console.log(l);
  if (r.crashed) console.log(r.crashed);
}
const onOutput = results.filter((r) => r.judgedOnOutput).map((r) => r.file);
console.log(`\n${results.length} probe(s), ${bad.length} failed`);
if (!ALL) {
  // THE HEADLINE SAYS WHAT WAS SKIPPED, not just how many passed: a green "26 of 26" that silently omits the
  // most expensive probe is the same class of silence as a generated asset with no gate.
  const skipped = all.filter((f) => f in SLOW);
  if (skipped.length) console.log(`SKIPPED (slow tier - run with --all to include): ${skipped.join(', ')}`);
}
if (onOutput.length) {
  console.log(`${onOutput.length} of them never call process.exit, so they were judged on their own FAIL lines: ${onOutput.join(', ')}`);
}
process.exit(bad.length === 0 ? 0 : 1);
