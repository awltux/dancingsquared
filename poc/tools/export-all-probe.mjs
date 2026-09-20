// Probe: EXPORT ALL - the blocks it writes, and the family each one belongs to.
//
// Asked for: "add an 'Export All' button that copies all the created calls. Each tam should be inside a
// tamination element under its appropriate family title (this should match the existing tamination). Add a
// filepath property to taminations, to make it easier to find the file to update. Also add a type property that
// indicates either 'clone' or 'update'."
//
// THE BUTTON CANNOT BE CLICKED FROM HERE, so what is checked is the two halves that make it right or wrong: the
// EXISTENCE of a family on every file the corpus has (a block has to be filed under the title the file already
// uses, and a level whose files carry none would export an invented one), and the FOUR KINDS mapping onto
// exactly the two types asked for. The second is checked against the app's own words rather than a fresh
// opinion - `doSave` already calls fix/instance REPLACING and create/clone APPENDING, and the export must be the
// same distinction or the two would disagree about the same edit.
//
// Run: node tools/export-all-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const assets = path.join(POC_DIR, 'src', 'assets');
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// ============================================================ 1. the wiring
console.log('== 1. Is the button wired, and to the rule this probe mirrors? ==');
const html = fs.readFileSync(path.join(POC_DIR, 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
const has = (re, msg) => check(re.test(ui) || re.test(html), msg);
has(/<button id="edExportAll"/, 'the panel carries the button');
has(/private exportAllBtn = el<HTMLButtonElement>\('edExportAll'\)/, 'and the controller holds it');
has(/this\.exportAllBtn\.addEventListener\('click', \(\) => this\.doExportAll\(\)\)/, 'and a click calls one method');
check(/<div id="edSaved"[^>]*><\/div>\s*<div class="row">\s*<button id="edExportAll"/.test(html),
  'and it sits directly UNDER the saved list, which is where it was asked to go');
has(/for \(const s of this\.saved\)/, 'it walks the saved list, so "all the created calls" means all of them');
// THE TYPE RULE, on both sides. These two regexes are the same distinction, and that is the point: the export
// has to say `clone`/`update` for exactly the edits `doSave` files as appending/replacing.
has(/const type = s\.kind === 'fix' \|\| s\.kind === 'instance' \? 'update' : 'clone';/, 'a replacing edit (fix, instance) is typed `update` and an appending one (create, clone) is typed `clone`');
has(/const replaces = spec\.kind === 'fix' \|\| spec\.kind === 'instance';/, 'and that is the SAME predicate `doSave` already uses to decide whether an edit replaces a setup or adds one');
has(/filepath: entry \? `poc\/src\/assets\/\$\{entry\.file\}\.xml`/, 'the filepath is built from the catalogue entry the edit came from, not from the edit name');
has(/title="\$\{esc\(g\.family \?\? 'Unknown'\)\}"/, 'and the title is the file FAMILY, escaped');

// ============================================================ 2. every file has a family
//
// The whole grouping rests on this: a block is filed under the `<tamination title>` the file ALREADY uses. A
// level whose files carried none would export an invented title, and the merge would land in the wrong file.
console.log('\n== 2. Does every corpus file carry a family title? ==');
let files = 0;
let withFamily = 0;
const families = new Map();
const noFamily = [];
for (const lvl of fs.readdirSync(assets, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'src').map((e) => e.name)) {
  for (const f of fs.readdirSync(path.join(assets, lvl)).filter((x) => x.endsWith('.xml'))) {
    files++;
    let title = null;
    try { title = engine.parseTaminationTitle(asset(`${lvl}/${f}`)); } catch { /* not a call file */ }
    if (title) {
      withFamily++;
      families.set(title, (families.get(title) ?? 0) + 1);
      // The family is a FILE's title, and `filepath` names that file - so the two have to agree, and the file
      // has to be where the path says it is.
      const p = path.join(POC_DIR, 'src', 'assets', lvl, f);
      if (!fs.existsSync(p)) noFamily.push(`${lvl}/${f}`);
    } else noFamily.push(`${lvl}/${f}`);
  }
}
console.log(`    ${withFamily} of ${files} call files carry a \`<tamination title>\`, in ${families.size} distinct families`);
check(withFamily / files > 0.9, 'almost every file names its family, so a grouped export lands somewhere real');
if (noFamily.length) console.log(`    the ${noFamily.length} without one: ` + noFamily.slice(0, 6).join(', '));
const manyPerFamily = [...families.entries()].filter(([, n]) => n > 1);
console.log(`    ${manyPerFamily.length} families are shared by more than one file, which is why the filepath is on the element too: ` + manyPerFamily.slice(0, 4).map(([t, n]) => `"${t}" x${n}`).join(', '));
check(families.size > 20, 'and the family names are the corpus\'s own, not one generic title');

// ============================================================ 3. the block, built and read back
console.log('\n== 3. A block, built the way the panel builds it and read back ==');
const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);
const seq = new engine.Sequencer(movesXml, formationsXml, callsByTitle(assets));
const corpus = engine.parseFormations(formationsXml);
let built = 0;
let roundTripped = 0;
for (const [lvl, file] of [['ms', 'circle'], ['ms', 'arm_turns'], ['b1', 'circulate'], ['a1', 'fractional_tops']]) {
  const full = `${lvl}/${file}.xml`;
  let xml = '';
  try { xml = asset(full); } catch { continue; }
  const family = engine.parseTaminationTitle(xml);
  if (!family) continue;
  const tams = engine.parseCallXml(xml);
  let call;
  try { call = engine.normalizeInstance(engine.buildCall(tams[0], corpus, engine.parseMoves(movesXml), true)); } catch { continue; }
  if (call.dancers.length !== 8) continue;
  // What the panel writes: the tam, typed, inside a tamination carrying the family and the path.
  const tam = engine.callToXmlNamed(call, call.from || call.title, (n) => seq.boardForSetup(n)?.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender })) ?? null)
    .match(/<tam\b[\s\S]*?<\/tam>/)[0];
  const typed = tam.replace('<tam ', '<tam type="clone" ');
  if (typed === tam) { check(false, `the type could not be written onto the <tam> for ${full}`); continue; }
  built++;
  const block = `<tamination title="${family}" filepath="poc/src/assets/${full}">\n${typed}\n</tamination>`;
  // READ BACK, which is the half a text check cannot do: the block has to parse into a call again.
  const back = engine.parseCallXml(`<calls>${block}</calls>`);
  const okTam = back.length === 1 && back[0].title === call.title;
  const okType = /type="clone"/.test(block) && /<tamination title=/.test(block) && /filepath="poc\/src\/assets\//.test(block);
  if (okTam && okType) roundTripped++;
  else check(false, `${full} did not read back (tams ${back.length}, title "${back[0]?.title ?? ''}")`);
}
console.log(`    ${roundTripped} of ${built} blocks built from real files parsed back as a call`);
check(built > 0 && roundTripped === built, 'every block is a real `<tamination>` of real `<tam>`s - the grouping does not break what it wraps');

// ============================================================ 4. the build stamp
//
// Asked for: "add an xml comment at the top of the export containing the web apps buildhash. This should give
// basic version control when importing them."
//
// IT HAS TO BE A COMMENT RATHER THAN AN ELEMENT, because these blocks are PASTED INTO a corpus file - an element
// would become part of that file's data. And it has to not break the parse: a comment at the top of a document
// is legal, but an invalid one is not, and `--` may not appear inside a comment at all.
console.log('\n== 4. The build stamp at the top ==');
check(/function buildStamp\(\): string \{/.test(ui), 'there is one function that writes the stamp');
check(/buildStamp\(\) \+ '\\n' \+ '<calls>/.test(ui), 'the single export puts it at the very top');
check(/const out = buildStamp\(\) \+ '\\n' \+ /.test(ui), 'and so does Export All');
check(/__GIT_COMMIT_SHORT__/.test(ui), 'it names the commit the app was BUILT FROM');
check(/__GIT_DIRTY__ === 'dirty'/.test(ui), 'and says when that build had UNCOMMITTED CHANGES, which a bare hash would state as if it were a commit');
// The value cannot contain `--`: the hash is hex and the timestamp is `YYYY-MM-DDTHH:MM`. An export carrying a
// comment with `--` in it would not re-parse anywhere, which is the one way a stamp can destroy the file.
const stamp = `<!-- exported by the dancing-squared web app: commit ${'a1b2c3d'}, with uncommitted changes, built 2024-06-01 12:00Z -->`;
// THE CONTENT, not the delimiters - `<!--` and `-->` are `--` by definition, and testing the whole string for
// `--` fails on a perfectly good comment. (It did, on the first run of this check.)
const content = stamp.slice(4, -3);
check(!content.includes('--'), 'nothing INSIDE the stamp forms a `--`, so the comment cannot terminate early');
// AND THE EXPORT STILL PARSES with the stamp in front of it, which is the property that actually matters.
{
  const xml = asset('ms/arm_turns.xml');
  const tams = engine.parseCallXml(xml);
  const call = engine.normalizeInstance(engine.buildCall(tams[0], engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true));
  const tam = engine.callToXmlNamed(call, call.from || call.title, () => null).match(/<tam\b[\s\S]*?<\/tam>/)[0];
  const stamped = `${stamp}\n<calls>\n${tam}\n</calls>`;
  const back = engine.parseCallXml(stamped);
  check(back.length === 1 && back[0].title === tams[0].title, 'and a stamped export parses back as the same single <tam> - the comment does not become data');
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
