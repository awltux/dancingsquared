// Probe: THE SAVED LIST reads `<start formation> -> <call> -> <end formation>`.
//
// Asked for: "Under the Save button is the list of created calls. Currently they are only listed by the start
// formation. But this makes it difficult to understand what they are. In this list, it should read <start
// formation name> -> <call name> -> <end formation name>."
//
// TWO OF THOSE THREE WERE NOT IN THE RECORD. An edit stores its own `name` (the setup's identity) and its XML,
// and nothing else: the call's title and the formation it finishes in are FACTS ABOUT THAT GEOMETRY, so they are
// read back off the rebuilt call rather than copied into the record where they would go stale the moment the
// path was edited again. That is what this probe checks - the shape of the line, and that all three parts can
// really be produced for real calls rather than only in principle.
//
// Run: node tools/saved-label-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const assets = corpusRoot();
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// ============================================================ 1. the line, as it is written
console.log('== 1. The line the panel builds ==');
const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
const body = (() => {
  const i = ui.indexOf('private renderSaved()');
  return i < 0 ? '' : ui.slice(i, ui.indexOf('\n  }\n', i));
})();
check(body !== '', 'the probe found `renderSaved` to read');
check(/\$\{s\.name\} → \$\{callName\} → \$\{endName \?\? '\?'\}/.test(body),
  'the row reads `<name> -> <call name> -> <end formation>`, which is the order asked for');
check(/const callName = built \? built\.title : '\?'/.test(body),
  "and the CALL name is the rebuilt call's title - the one part of the three that the edit record never held");
check(/this\.host\.nameBoard\(boardAtBeat\(built, built\.totalBeats\)\)/.test(body),
  "and the END is READ OFF the geometry, through the same recogniser the browse and sequence views name formations with");
check(/try \{ return rebuildEdit\(s\); \} catch \{ return null; \}/.test(body),
  'and a saved edit that will not rebuild leaves a row rather than taking the whole panel down with it');
check(!/\$\{kind\} · \$\{s\.name\}/.test(body),
  'the old one-part label (`kind · name`) is GONE, not merely joined by the new parts');
check(/row\.title =\s*\n?\s*`\$\{kind\} · starts from/.test(body),
  'and the KIND moved to the row title, so the three parts can be what the line says without losing it');

// ============================================================ 2. all three parts really exist
//
// The labelling is only worth anything if the recogniser can actually name the START and the END of real calls,
// so it is asked, rather than assumed from the presence of a call.
console.log('\n== 2. Can all three be produced for real calls? ==');
const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);
const seq = new engine.Sequencer(movesXml, formationsXml, callsByTitle(assets));
const rows = [];
let unnamed = 0;
for (const lvl of ['ms', 'a1', 'plus']) {
  for (const f of filesOf(lvl).filter((x) => x.endsWith('.xml'))) {
    let tams = [];
    try { tams = engine.parseCallXml(asset(`${lvl}/${f}`)); } catch { continue; }
    for (const tam of tams.slice(0, 4)) {
      let call;
      try { call = engine.normalizeInstance(engine.buildCall(tam, engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true)); } catch { continue; }
      if (call.dancers.length !== 8) continue;
      // The panel's own reads, in the panel's own order.
      const start = seq.knownFormation(engine.boardAtBeat(call, 0));
      const end = seq.knownFormation(engine.boardAtBeat(call, call.totalBeats));
      if (!start || !end) { unnamed++; continue; }
      rows.push({ file: `${lvl}/${f}`, start, title: call.title, end });
    }
  }
}
console.log(`    ${rows.length} calls named at BOTH ends, ${unnamed} where the recogniser could not`);
check(rows.length > 100, 'the sample is the corpus, not a witness');
check(rows.every((r) => r.start && r.title && r.end), 'and every one of the three parts is non-empty for every call in it');
const changes = rows.filter((r) => r.start !== r.end);
console.log(`    ${changes.length} of them (${((100 * changes.length) / rows.length).toFixed(0)}%) FINISH IN A DIFFERENT FORMATION from the one they start in`);
check(changes.length > 20, 'so the third part carries information the first one does not, which is the whole reason for it');
console.log('    a few rows as the list would read them:');
for (const r of [...rows].sort((a, b) => a.file.localeCompare(b.file)).slice(0, 6)) {
  console.log(`      ${r.start} → ${r.title} → ${r.end}`);
}
console.log('    and some where the start and end agree, which the line still states rather than leaving blank:');
for (const r of rows.filter((x) => x.start === x.end).slice(0, 3)) {
  console.log(`      ${r.start} → ${r.title} → ${r.end}`);
}

// ============================================================ 3. and the SETUP label's real source
//
// THE FIRST ATTEMPT AT THIS FIXED THE WRONG LAYER. `callMeta` was changed to prefer the formation, and it was
// MEASURED on `callMeta`'s own output - but the Setup dropdown does not read `callMeta` at all: `data.ts` walks
// the file itself (it needs the tam INDICES as well as the labels) and built the labels from `tams[i].from`
// directly. So the engine read said "1876 of 2657 changed" while the dropdown was untouched.
//
// The precedence now lives in ONE exported function (`setupLabel`) that BOTH call sites use, and this checks the
// half that was missed: that the catalog the dropdown is filled from goes through it.
console.log('\n== 3. The Setup dropdown names a setup by its FORMATION ==');
const data = fs.readFileSync(path.join(POC_DIR, 'src', 'data.ts'), 'utf8');
check(/setups: indices\.map\(\(i\) => \(\{ label: setupLabel\(tams\[i\]\.formationAttr, tams\[i\]\.from\), from: tams\[i\]\.from \}\)\)/.test(data),
  'the catalogue builds each setup label through `setupLabel`, which is the list the dropdown is filled from');
check(!/label: tams\[i\]\.from \|\| '\(default\)'/.test(data),
  'and the old `from`-first label is GONE from that line rather than left beside it');
const engineSrc = fs.readFileSync(path.join(POC_DIR, '..', 'engine', 'src', 'convert.ts'), 'utf8');
check(/export function setupLabel\(formation: string \| null, from: string\): string \{\s*\n\s*return formation \|\| from \|\| '\(default\)';/.test(engineSrc),
  'and the precedence itself is one exported function, so the catalogue and `callMeta` cannot drift apart');
check(/label: setupLabel\(t\.formationAttr, t\.from\)/.test(engineSrc),
  'which `callMeta` uses too - the two reads carry the same rule because they call the same thing');
// MEASURED at the layer the dropdown sees: the raw `<tam>` list of every file in a level.
let labeled = 0;
let sameAsFrom = 0;
let fromBlank = 0;
for (const lvl of ['ms', 'a1']) {
  for (const f of filesOf(lvl).filter((x) => x.endsWith('.xml'))) {
    let tams = [];
    try { tams = engine.parseCallXml(asset(`${lvl}/${f}`)); } catch { continue; }
    for (const t of tams) {
      labeled++;
      if (engine.setupLabel(t.formationAttr, t.from) === t.from) sameAsFrom++;
      if (!t.from.trim()) fromBlank++;
    }
  }
}
console.log(`    ${labeled} setups over three levels: ${labeled - sameAsFrom} of them read differently from their \`from\`, and ${fromBlank} have a blank \`from\``);
check(labeled - sameAsFrom > 100, 'so the dropdown really does change, measured on the tams it is built from rather than on an engine read that nothing there calls');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
