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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('-probe.mjs')).sort();
if (files.length === 0) {
  console.log('no probes found in ' + DIR);
  process.exit(1);
}

/** Thrown in place of an exit, so the run can continue to the next probe. */
class ProbeExit {
  constructor(code) { this.code = code; }
}

const realExit = process.exit;
const realLog = console.log;
const results = [];
for (const file of files) {
  const lines = [];
  console.log = (...args) => lines.push(args.map(String).join(' '));
  let code = 0;
  let crashed = null;
  let judgedOnOutput = false;
  process.exit = (c) => { throw new ProbeExit(typeof c === 'number' ? c : 0); };
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
if (onOutput.length) {
  console.log(`${onOutput.length} of them never call process.exit, so they were judged on their own FAIL lines: ${onOutput.join(', ')}`);
}
process.exit(bad.length === 0 ? 0 : 1);
