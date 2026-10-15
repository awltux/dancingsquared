// The API's probe runner: THE LIST IS THE DIRECTORY, so registration cannot be forgotten and a deletion
// cannot leave a dangling entry (AGENTS.md 5).
//
// Modelled on `game/tools/verify-probes.mjs`, which is itself modelled on the POC's, and deliberately the
// simple one: there is no slow tier, because nothing here is corpus-scale — the probe builds at most two
// levels' appliers and the whole suite is seconds.
//
// PROBES RUN IN THIS PROCESS, with `process.exit` and `console.log` intercepted rather than driven as
// children. That is not a stylistic choice: AGENTS.md trap 3 records that a Node child spawned with piped
// stdio fails with EPERM under the file sandbox, so a runner that captured its children's output could not
// run at all.
//
// `--require-ddb` MAKES THE DYNAMODB HALF MANDATORY: the store probe reports a skip when nothing answers on its
// endpoint, and this turns that skip into a failure for the run that is supposed to have a real store (the
// local DynamoDB Local check and, later, a deployment smoke test). Without it the skip is reported loudly and
// the suite still passes, because a fresh clone has no DynamoDB.
//
// Run: node api/tools/verify-probes.mjs [--require-ddb]   (from anywhere; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv.includes('--require-ddb')) process.env['DSQ_REQUIRE_DDB'] = '1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', 'test');
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
// OUR OWN FLAGS MUST NOT REACH A PROBE. Probes are imported in-process, so they read OUR `process.argv`.
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
    // A probe that falls off the end has not set an exit code. That is a weaker signal than an explicit exit,
    // and the summary says which probes rely on it rather than pretending the two are the same.
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
