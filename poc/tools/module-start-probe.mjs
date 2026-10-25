// A MODULE IS OFFERED FROM ITS OWN START BOARD: measured over the corpus's 294 replayable modules.
//
// Asked for: "A module should be matches in the same way a call is matched, by using the start formation."
//
// THE ENGINE'S HALF IS MEASURED BY IMPORT: register every corpus module with the board its label names, ask which ones
// the picker offers from the HOME square, and compare with the same list registered with no boards at all (the old
// behaviour). The right answer is not "fewer" - it is EXACTLY the modules written for home, which is a number this probe
// can derive independently from the corpus's own `startFormation`, so the screen and the label cannot agree by accident.
//
// It also proves the gate does not empty the list: a sample of the Zero Box modules is asked from the board their label
// names, where they must be offered.
//
// THE CALL SET IS THE WHOLE CORPUS, pooled highest-level-first (`callsByTitle`), which is a SUPERSET of the Mainstream
// set the app registers - so the counts below are comparable between the two registrations and are NOT the app's picker
// count. The comparison is the claim.
//
// Run: node poc/tools/module-start-probe.mjs   (from anywhere; build the engine first)
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

/** The board a corpus start label names, through the app's own bridge. */
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

const labelOf = (m) => (m.startFormation ?? '').trim().toLowerCase();
const offered = (names) => new Set(seq.legalNext());
const countOf = (set) => modules.filter((m) => set.has(m.name)).length;

console.log(`== the sample: ${modules.length} replayable corpus modules ==`);
check(modules.length > 200, `the walk found the corpus (${modules.length} modules)`);
const byLabel = { 'static square': 0, 'zero line': 0, 'zero box': 0, other: 0 };
for (const m of modules) {
  const k = labelOf(m);
  if (k in byLabel) byLabel[k]++;
  else byLabel.other++;
}
console.log(`    labels: ${byLabel['static square']} Static Square, ${byLabel['zero line']} Zero Line, ${byLabel['zero box']} Zero Box, ${byLabel.other} other/none`);
check(byLabel['static square'] + byLabel['zero line'] + byLabel['zero box'] + byLabel.other === modules.length,
  'every module has a label slot, so nothing falls outside the denominator');

console.log('\n== 1. before: every module offered from every board ==');
seq.setBoard(HOME);
for (const m of modules) seq.registerModule(m.name, m.steps);
const before = offered();
const beforeCount = countOf(before);
const wrongFromHome = modules.filter((m) => before.has(m.name) && labelOf(m) !== 'static square');
console.log(`    from home, with NO declared starts: ${beforeCount} of ${modules.length} offered, of which ${wrongFromHome.length} are written for another board`);
if (wrongFromHome.length) console.log(`    wrongly offered from home: ${wrongFromHome.map((m) => `${m.name} (${m.startFormation})`).join(', ')}`);
// THE DEFECT, STATED AS THE PROPERTY AND NOT AS A HOPE FOR A BIG NUMBER: the ungated picker offers a module from a board it
// was not written for. The size is small (2 of 294) because most modules' first step already refuses from the wrong board
// - which is exactly why this survived: it was rare enough to read as a corpus quirk when it happened.
check(wrongFromHome.length > 0,
  'the ungated picker DOES offer modules from home that were written for another board - the defect, named above');

console.log('\n== 2. after: the same modules, each registered with the board its label names ==');
for (const m of modules) seq.unregisterModule(m.name);
let built = 0;
for (const m of modules) {
  const start = boardFor(m.startFormation);
  if (start) built++;
  seq.registerModule(m.name, m.steps, start ? { start: start.dancers } : {});
}
check(built === modules.length,
  `every corpus label resolved to a board (${built} of ${modules.length}), so no module was left ungated by accident`);
seq.setBoard(HOME);
const after = offered();
const afterCount = countOf(after);
const stillWrong = modules.filter((m) => after.has(m.name) && labelOf(m) !== 'static square');
console.log(`    from home, WITH declared starts:    ${afterCount} of ${modules.length} offered, of which ${stillWrong.length} are written for another board`);

// THE CROSS-CHECK IS THE CLAIM, and it is derived from the corpus rather than from the engine's own answer: the gated list
// must be EXACTLY the home-written modules that applied before - no module lost, none added.
const homeWritten = modules.filter((m) => labelOf(m) === 'static square' && before.has(m.name)).length;
check(afterCount === homeWritten,
  `the gated list is EXACTLY the home-written modules that applied before: ${afterCount} vs ${homeWritten}`);
check(stillWrong.length === 0, 'and NOT ONE module written for another board is offered from home any more');
const lost = modules.filter((m) => before.has(m.name) && !after.has(m.name));
check(lost.length === wrongFromHome.length && lost.every((m) => labelOf(m) !== 'static square'),
  `exactly the ${lost.length} mis-offered modules were withdrawn, and nothing written for home was`);

console.log('\n== 3. and a zero-box module is still offered where it belongs ==');
const box = modules.filter((m) => labelOf(m) === 'zero box');
const boxBoard = boardFor('Zero Box');
check(!!boxBoard, 'the Zero Box label stands up as a board');
check(!!boxBoard && boxBoard.dancers.length === 8, 'and it is an eight-dancer board, so the count cannot be doing the work');
const registered = box.filter((m) => boardFor(m.startFormation));
check(registered.length === box.length, `all ${box.length} zero-box modules declare a start this app can build`);
if (boxBoard) {
  seq.setBoard(boxBoard);
  const fromBox = offered();
  const offeredHere = box.filter((m) => fromBox.has(m.name)).length;
  const offeredHereBefore = box.filter((m) => before.has(m.name)).length;
  console.log(`    from the zero box: ${offeredHere} of ${box.length} offered (ungated it was ${offeredHereBefore} from HOME)`);
  check(offeredHere > 0, 'their own board still offers them, so the gate narrows the board rather than the module');
  // THE SAME MODULES FROM HOME, for contrast: any that applied from home were applying from the wrong board.
  seq.setBoard(HOME);
  const homeAgain = countOf(offered());
  check(homeAgain === afterCount, 'and going back to home gives exactly the same list, so the gate is a function of the board alone');
}

console.log('\n== 4. the app passes the boards in, and the engine reads them ==');
const ui = readApp('src/sequencer-ui.ts');
check(/private registerCederModules\(\)[\s\S]{0,1400}?registerModule\(m\.name, m\.steps, \{ \.\.\.\(start \? \{ start \} : \{\}\), \.\.\.\(end \? \{ end \} : \{\}\) \}\)/.test(ui),
  'the ceder modules are registered WITH their start board, built from the corpus label');
check(/private restoreModules\(\)[\s\S]{0,700}?registerModule\(m\.name, m\.calls, this\.storedBoards\(m\)\)/.test(ui),
  'and a saved module is restored with the boards it recorded');
check(/private startBoardFor\(label: string \| undefined\)/.test(ui),
  'ONE builder turns a corpus label into a board, so the start a module is REGISTERED with and the start a sequence is LOADED on cannot disagree');
check((ui.match(/this\.startBoardFor\(/g) ?? []).length >= 3,
  'and it is used by the ceder registration, the document resolver and the loader alike');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nmodule-start: all checks hold');
process.exit(failures ? 1 : 0);
