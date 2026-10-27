// A MODULE COMPOSED INTO ONE CALL: measured over the corpus's 294 replayable modules.
//
// The engine half is measured BY IMPORT: every module is registered, composed from the board its corpus label names, and
// each composition is judged against the REPLAY — the composed end board has to be the board `evaluateSequence` lands on,
// dancer for dancer, and its beat count has to be what the flattened steps cost. That is the claim `engine/test/
// module-call.mjs` makes on two fixture chains; this makes it on the whole corpus, which is the version that can go stale.
//
// THE DENOMINATOR IS THE POINT. A composition rate without one is a number nobody can compare, and the refusals are part
// of the feature: a module that cannot compose is still playable call by call, so what matters is HOW MANY and WHY, by
// reason, so a caller reading the status line can act on it.
//
// Run: node poc/tools/module-call-probe.mjs   (from anywhere; build the engine first)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.join(POC_DIR, '..');
const engine = await import(pathToFileURL(path.join(REPO, 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);
const { callsByTitle } = await import(pathToFileURL(path.join(REPO, 'engine', 'test', 'lib', 'engine-calls.mjs')).href);
// THE LABEL BRIDGE IS THE APP'S OWN, imported rather than restated: it imports nothing, so node can load it directly.
const { LETTER_TEMPLATE, resolveStartFormation } = await import('./../src/start-formation.ts');

const read = (p) => readFileSync(path.join(corpusRoot(), p), 'utf8').replace(/\r\n/g, '\n');
const readApp = (p) => readFileSync(path.join(POC_DIR, p), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** Every `modules/**\/*.json`, the way `ceder-modules.ts` globs them. */
function corpusModules() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!e.endsWith('.json')) continue;
      out.push(JSON.parse(readFileSync(p, 'utf8')));
    }
  };
  walk(path.join(REPO, 'modules'));
  return out;
}

/** THE SAME FILTER `validCederModules` APPLIES, so the sample is the one the app registers. */
const modules = corpusModules().filter((m) => m && Array.isArray(m.steps) && m.success === true && !m.steps.includes('ALLEMANDE_LEFT'))
  .map((m) => ({ name: m.name || `ceder-${m.id}`, steps: m.steps, startFormation: m.startFormation }));

const seq = new engine.Sequencer(read('moves.xml'), read('formations.xml'), callsByTitle(corpusRoot()));
const HOME = seq.startBoard();

/** The board a corpus start label names, through the app's own bridge. The module's OWN start is what it is composed from. */
const boardFor = (label) => {
  const spec = resolveStartFormation(label);
  if (!spec) return null;
  const board = spec.formation
    ? seq.boardForSetup(spec.formation)
    : engine.boardForFasrCode(spec.code ?? '', (l) => {
        const template = LETTER_TEMPLATE[l];
        return template ? seq.boardForFormation(template) : null;
      }).board;
  return board ?? null;
};

/**
 * THE REFUSAL, AS A KIND rather than a sentence: the reason names the step it happened at, so a histogram keyed on the
 * whole string would have 294 buckets of one. The clause after the colon is what a caller can act on.
 */
function reasonKind(reason) {
  if (/coded move/.test(reason)) return 'a coded move has no authored track';
  if (/"while"/.test(reason)) return 'a "while" figure has no single track';
  if (/mirrors its track/.test(reason)) return 'a reflected placement cannot be written';
  if (/no whole-board authoring/.test(reason)) return 'a step only tiles: no single whole-board authoring';
  if (/does not reproduce the replay/.test(reason)) return 'the composed track did not reproduce the replay';
  if (/does not apply from the board/.test(reason)) return 'a step does not apply from its start board';
  if (/ends on a board the engine does not name/.test(reason)) return 'the module ends on an unnamed board';
  if (/no start to declare/.test(reason)) return 'the start board is unnamed';
  return 'other: ' + reason;
}


console.log(`== the sample: ${modules.length} replayable corpus modules ==`);
check(modules.length > 200, `the walk found the corpus (${modules.length} modules)`);

console.log('\n== 1. how many compose into ONE call, from the board their label names ==');
const kinds = new Map();
const examples = new Map();
let composed = 0;
let worstEnd = 0;
let worstBeats = 0;
let residueGap = 0;
let worstEndName = '';
// THE DENOMINATOR THAT MATTERS FOR "does not apply": a module the APP cannot replay past step k cannot be composed either,
// so the refusal must coincide with the replay's own stop rather than being this composer's stricter rule.
let doesNotApply = 0;
let stopsToo = 0;
let mismatch = [];
const unlabelled = modules.filter((m) => !boardFor(m.startFormation));
check(unlabelled.length === 0, `every module names a start board this app can build (${unlabelled.length} could not)`);
for (const m of modules) {
  const board = boardFor(m.startFormation) ?? HOME;
  // Registered WITHOUT its declared start: `moduleCall` reads the module's steps, and the start board is supplied here as
  // the board to compose FROM. Registering the start too would only re-assert what commit `87ce42f5` already gates on.
  seq.registerModule(m.name, m.steps);
  const r = seq.moduleCall(board, m.name);
  if (!r.legal) {
    const kind = reasonKind(r.reason);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    if (!examples.has(kind)) examples.set(kind, `${m.name}: ${r.reason}`);
    if (kind === 'a step does not apply from its start board') {
      doesNotApply++;
      // THE SAME BOARD, THE SAME STEPS, THE ENGINE'S OWN WALK: if the app can replay this module from this board then the
      // composition's refusal is this module's rule being stricter than the app, which would be a defect.
      if (seq.sequenceStop(seq.flatten(m.steps), board) !== null) stopsToo++;
      else mismatch.push(m.name);
    }
    continue;
  }
  composed++;
  // THE END BOARD IS THE REPLAY'S, dancer for dancer.
  const walked = seq.evaluateSequence(seq.flatten(m.steps), r.bundle.beats, board).board;
  let worst = 0;
  for (const [i, d] of r.bundle.dancers.entries()) {
    const p = engine.poseFor(d, r.bundle.beats);
    const w = walked.dancers[i];
    worst = Math.max(worst, Math.hypot(p.x - w.x, p.y - w.y), Math.abs(engine.normAngle(p.heading - w.heading)));
  }
  if (worst > worstEnd) { worstEnd = worst; worstEndName = m.name; }
  residueGap = Math.max(residueGap, Math.abs(worst - r.residue));
  worstBeats = Math.max(worstBeats, Math.abs(r.bundle.beats - seq.sequenceBeats(seq.flatten(m.steps), board)));
}
console.log(`    composed: ${composed} of ${modules.length}`);
const refused = modules.length - composed;
console.log(`    refused:  ${refused} of ${modules.length}`);
for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1])) {
  console.log(`      ${String(n).padStart(3)}  ${kind}`);
  console.log(`           e.g. ${examples.get(kind)}`);
}
check(composed > 0, `some modules DO compose into one call (${composed} of ${modules.length})`);
check(composed + [...kinds.values()].reduce((a, b) => a + b, 0) === modules.length,
  'and every module is either composed or counted under a reason, so nothing fell through the sweep');
check(refused > 0,
  `and the refusals are real rather than a sweep that never asked (${refused} refused) - a module that cannot compose still plays call by call`);
// THE DENOMINATOR FOR "a step does not apply", and the one place this probe disagrees with the walk it also uses.
// `replayWalk` records a SCOPED step as walkable when a VARIANT matched its subset, even when the apply REFUSED it
// (`sequence.ts`: `walkable: info !== null`) - so `sequenceStop` reports no stop while nothing actually happened. The
// composer refuses at the apply, which is the stricter and safer reading, so the count below is expected to be non-zero
// and the modules are named rather than hidden.
console.log(`    of the ${doesNotApply} refused because a step does not apply: ${stopsToo} stop in the app's own replay, ${mismatch.length} do not`);
if (mismatch.length) {
  console.log(`      the app's walk passes but its APPLY refuses (a scoped step whose variant matched): ${mismatch.join(', ')}`);
}
check(stopsToo + mismatch.length === doesNotApply, 'every "does not apply" refusal is accounted for against the app\'s own replay');

console.log('\n== 2. every composition lands on the REPLAY board, and costs what the steps cost ==');
console.log(`    worst dancer between a composed end and its replay: ${worstEnd.toExponential(2)} (${worstEndName})`);
console.log(`    worst beat difference: ${worstBeats}`);
// THE BOUND IS THE ENGINE'S OWN: a composed track cannot reproduce the per-call SNAP the applicator applies, so the
// residue is real and has to be bounded rather than expected to vanish. 0.02 is the tolerance `anim-convergence` already
// allows between its last drawn frame and the board it is drawn against, and every composed module is refused beyond it.
check(worstEnd <= 0.02, `every one of the ${composed} composed modules lands on its replay board within the engine's 0.02 bound`);
check(residueGap < 1e-12, 'and the residue each one reports is the one measured here, so the bound is judged on its own numbers');
check(worstBeats <= 1e-9, 'and every composed call costs exactly what its flattened steps cost, so no later beat moves');

console.log('\n== 3. the panel inserts a module as ONE row, and says whether it is one call ==');
const ui = readApp('src/sequencer-ui.ts');
check(/if \(expanded\.length > 1\) this\.history\.push\(name\);\n\s*else this\.history\.push\(\.\.\.expanded\);/.test(ui),
  'adding a module pushes ONE history entry rather than one per call');
check(/this\.history = \[\.\.\.steps\];/.test(ui) && /for \(const name of this\.seq\.flatten\(this\.history\)\)/.test(ui),
  'and a loaded sequence keeps the document\'s steps as rows, flattening only to count refusals');
check(/private moduleCallNote\(board: Board, name: string\)/.test(ui) && (ui.match(/this\.moduleCallNote\(/g) ?? []).length === 2,
  'the status line asks whether the module is one call, on Add AND on load, through one helper');
check(/this\.seq\.moduleCall\(board, name\)/.test(ui), 'and that helper is the engine\'s answer rather than a second rule');
// THE THREE READERS THAT MAKE ONE ROW LEGAL, already in the panel: a row is "one or more flat steps".
for (const fn of ['beatAtStep', 'historyRowOfFlat', 'rowSources']) {
  check(new RegExp(fn).test(ui), `\`${fn}\` is what still maps a history row to its flat steps, so one row is not a new model`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nmodule-call: all checks hold');
process.exit(failures ? 1 : 0);
