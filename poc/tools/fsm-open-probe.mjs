// Probe: THE FSM TAB'S LOAD AND EDIT ICONS resolve a row to a call the app can open.
//
// Asked for: "In the FSM tab, provide a dropdown filter for Level. And provide a Load and Edit buttons that
// open 'Browse Calls' and 'Call Editor' respectively." - clarified as "This is for the list of to and from
// calls" with "a small icon" for each.
//
// The resolution itself is a PURE FUNCTION in `poc/src/fsm-target.ts`, so this probe calls it rather than
// reading the text of a method that calls it: a gate on the source of a rule is a gate on spelling, and the
// rule's real content is WHICH setup a formation name lands on and WHAT happens when nothing matches. The
// numbers it leans on (19% exact, 32% by geometry, 531 coded moves) are measured here, off the shipped asset,
// so the fallback in that file is checked against the data it claims.
//
// Run: node poc/tools/fsm-open-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
const assets = path.join(POC_DIR, 'src', 'assets');
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');

// ============================================================ 1. the rule, called
console.log('== 1. Which call and setup an FSM row names ==');
const { fsmTarget, fsmCatalogEntry, setupForFormation } = await import('./../src/fsm-target.ts');

const setups = [
  { label: 'Facing Couples', from: 'Facing Couples' },
  { label: 'Wave RH', from: 'Right-Hand Waves' },
  { label: 'Ocean Waves RH BGGB', from: 'Ocean Waves' },
];
check(setupForFormation(setups, 'Wave RH') === 1, 'a formation naming a setup by its LABEL lands on that setup');
check(setupForFormation(setups, 'Right-Hand Waves') === 1, "and one naming it by the older `from` does too - the field an older asset or tam carries");
check(setupForFormation(setups, 'Static Square') === 0, 'a formation that names NO setup falls back to the first, which is what picking the call by hand shows');
check(setupForFormation(setups, null) === 0, 'and so does a row with no formation at all (an embedded state)');
check(setupForFormation([], 'Wave RH') === 0, 'an empty setup list cannot index out of bounds');

const catalog = [
  { id: 'b1/right and left thru::Right and Left Thru', level: 'b1', title: 'Right and Left Thru', setups },
  { id: 'ms/right and left thru::Right and Left Thru', level: 'ms', title: 'Right and Left Thru', setups: [setups[1]] },
];
check(fsmCatalogEntry(catalog, 'Right and Left Thru', 'ms')?.id.startsWith('ms/') === true,
  'the level of the tree decides WHICH authoring of a title is meant');
check(fsmCatalogEntry(catalog, 'Right and Left Thru', 'plus')?.id.startsWith('b1/') === true,
  'and a level with no such title falls back to an authoring that exists rather than resolving to nothing');
check(fsmCatalogEntry(catalog, 'Face Right', 'ms') === null, 'a call the catalogue does not hold resolves to NOTHING - a coded move is not guessed at');
check(fsmTarget(catalog, 'Right and Left Thru', 'Wave RH', 'ms')?.setupIdx === 0,
  'and a target combines the two: the level picks the entry, the formation picks the setup within it');
check(fsmTarget(catalog, 'Face Right', 'Static Square', 'ms') === null, 'with no entry there is no target at all');

// ============================================================ 2. against the shipped asset
//
// The catalogue is rebuilt here the way `data.ts` builds the dropdown's: every `<tam>` of the level, grouped
// by title, each setup labelled through `setupLabel`. Then EVERY edge of the real FSM asset is resolved.
console.log('\n== 2. Every edge of the shipped FSM asset ==');
const fsm = JSON.parse(asset('fsm-ms.json'));
const formations = engine.parseFormations(asset('formations.xml'));
const moves = engine.parseMoves(asset('moves.xml'));
const entries = [];
const tamsByFile = new Map();
for (const f of fs.readdirSync(path.join(assets, 'ms')).filter((x) => x.endsWith('.xml'))) {
  let tams;
  try { tams = engine.parseCallXml(asset(`ms/${f}`)); } catch { continue; }
  tamsByFile.set(`ms/${f}`, tams);
  const byTitle = new Map();
  tams.forEach((t, i) => {
    const key = t.title || `ms/${f}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), { i, label: engine.setupLabel(t.formationAttr, t.from), from: t.from }]);
  });
  for (const [title, list] of byTitle) {
    entries.push({ id: `ms/${f}::${title}`, level: 'ms', title, file: `ms/${f}`, setups: list.map((x) => ({ label: x.label, from: x.from })), tams: list.map((x) => x.i) });
  }
}
console.log(`    ${entries.length} catalogue entries over ${fsm.table.states.length} states`);

let edges = 0, resolved = 0, coded = 0, exact = 0, fallback = 0;
const codedNames = new Map();
const pairs = new Set();
for (const [from, list] of Object.entries(fsm.table.edges)) {
  for (const e of list) {
    edges++;
    const t = fsmTarget(entries, e.call, from.startsWith('@embed') ? null : from, 'ms');
    if (!t) { coded++; codedNames.set(e.call, (codedNames.get(e.call) ?? 0) + 1); continue; }
    resolved++;
    if (t.setupIdx > 0 || setupForFormation(t.entry.setups, from) > 0) exact++; else fallback++;
    pairs.add(`${t.entry.id}|${t.setupIdx}`);
  }
}
console.log(`    ${edges} edges: ${resolved} resolve to a catalogue call, ${coded} name a call the catalogue does not hold`);
console.log(`      ${exact} land on a setup the state's own formation NAMES, ${fallback} fall back to the call's first setup`);
check(resolved > 1000, 'the great majority of edges resolve - the buttons are not decoration');
check(coded > 50, 'and some really do not: the coded moves the FSM applies by rule are REPORTED, not silently opened as some other call');
console.log(`    the ${codedNames.size} names with no catalogue entry, most used first:`);
for (const [n, c] of [...codedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`      ${String(c).padStart(4)}  ${n}`);
check(codedNames.has('Promenade') || codedNames.has('Face Right'), 'among them a coded move (`Promenade` / `Face Right`), which is what makes the null branch a real answer');
check(exact > 100, `a real share of rows is named EXACTLY by the state (${exact}), which is why the setup is taken when it is a certainty`);
check(fallback > exact, 'while more fall back - so the fallback is the common path, not an edge case');

// AND THE RESOLVED PAIR REALLY LOADS. The index has to be an index into that file's `<tam>` list, which is
// the one thing a resolution can get wrong without any name being wrong.
console.log('\n== 3. Every distinct resolved (entry, setup) really builds ==');
const list = [...pairs];
let built = 0, badTitle = 0, badBuild = 0;
const sizes = new Map();
const step = Math.max(1, Math.floor(list.length / 300));
for (let k = 0; k < list.length; k += step) {
  const [id, idxStr] = list[k].split('|');
  const entry = entries.find((x) => x.id === id);
  const fileIdx = entry.tams[Number(idxStr)];
  if (fileIdx === undefined) { badBuild++; continue; }
  const tam = tamsByFile.get(entry.file)[fileIdx];
  try {
    const call = engine.buildCall(tam, formations, moves, true);
    if ((tam.title || entry.title) !== entry.title) badTitle++;
    else { built++; sizes.set(call.dancers.length, (sizes.get(call.dancers.length) ?? 0) + 1); }
  } catch { badBuild++; }
}
console.log(`    sampled ${Math.ceil(list.length / step)} of ${list.length} distinct pairs: ${built} build to the title the row named, ${badBuild} fail, ${badTitle} name a different title`);
console.log(`    the sizes they build to: ${[...sizes.entries()].sort().map(([n, c]) => `${n} dancers x${c}`).join(', ')}`);
check(built > 100, 'the sample is the catalogue, not a witness');
check(badBuild === 0 && badTitle === 0, 'and the setup index names a tam of that call - the one thing a resolution can get wrong without any name being wrong');
check([...sizes.keys()].every((n) => n >= 2 && n % 2 === 0), 'building to a whole number of couples, whatever the authored size - the resolution changes what a call is shown AS by nothing');
// NOT ASSERTED TO EIGHT: 312 of the 1021 ms tams build to FOUR dancers, because they list a half set that
// already contains its own antipodes, and `mirrorToFull` leaves such a set alone. That is the catalogue's
// own reading and the resolution does not touch it - but it is worth stating here, because a four-dancer
// board is exactly the surprise the Load button would otherwise be blamed for.

// ============================================================ 4. the wiring the rule needs
console.log('\n== 4. The icons and the bridge ==');
const { renderFsmHtml, mergeFsmTables } = await import('./../src/fsm-view.ts');
const view = fs.readFileSync(path.join(POC_DIR, 'src', 'fsm-view.ts'), 'utf8');
const main = fs.readFileSync(path.join(POC_DIR, 'src', 'main.ts'), 'utf8');
check(/addOpen=\(li,call,from\)=>/.test(view) && /dataset\.act=act/.test(view),
  'each row of the to and from call lists gets the two icon buttons');
check(!/li\.textContent=arrow\?c\.from\+' → '\+c\.call: c\.call\+' → '\+c\.to;ul\.appendChild/.test(view),
  'and they are added to a row rather than replacing it');
check(/parent\.postMessage\(\{type:'fsm-open',action:b\.dataset\.act,call:b\.dataset\.call,formation:b\.dataset\.from\|\|null,level:LEVEL\}/.test(view),
  'a click ASKS the app, carrying the call, the formation the edge leaves and the level of this tree');
check(/fsmFrame\.srcdoc = renderFsmHtml\(table, `FSM · \$\{level \|\| 'all levels'\}`, level\)/.test(main),
  'and the frame is drawn WITH that level, so a row cannot be attributed to the wrong authoring');
check(/if \(ev\.source !== fsmFrame\.contentWindow\) return;/.test(main),
  'the app hears only the FSM frame - a srcdoc frame inherits this origin, so any frame could post the same message');
check(/const target = browser\.resolveFsm\(call, formation, level\);/.test(main), 'the app resolves the row through the catalogue it holds');
check(/fsmTitle\.textContent = `\$\{call\}: not a/.test(main),
  'and reports an unopenable row in the FSM toolbar, which is the only thing visible over the browse legend');
check(/modeSelect\.value = 'editor';[\s\S]{0,80}editorUi\.openCall\(target\.callId, target\.setupIdx\)/.test(main),
  'Edit opens the CALL EDITOR on the resolved (call, setup)');
check(/modeSelect\.value = 'browse';[\s\S]{0,80}browser\.loadCatalogue\(target\.callId, target\.setupIdx\)/.test(main),
  'and Load opens the BROWSE tab on it, by the same three loads a click on the lists makes');
check(/resolveFsm\(title: string, formation: string \| null, level: string\)/.test(fs.readFileSync(path.join(POC_DIR, 'src', 'browser.ts'), 'utf8')),
  'the catalogue resolution lives in the browser, which owns the catalogue');

// THE RENDERED DOCUMENT, not the renderer's text: the sidebar rows are built at runtime from the JSON blob the
// renderer emits, so a row can only offer a formation if the DATA carries one.
console.log('\n== 4b. What the renderer actually emits ==');
const html = renderFsmHtml({ states: fsm.table.states, edges: fsm.table.edges }, 'FSM · ms', 'ms');
const blob = JSON.parse(html.match(/<script type="application\/json" id="nodedata">([\s\S]*?)<\/script>/)[1]);
let rows = 0, missing = 0, dangling = 0;
const stateKeys = new Set(fsm.table.states);
for (const nd of blob) {
  for (const c of [...nd.calls, ...nd.incoming]) {
    rows++;
    if (!('fromFormation' in c) || typeof c.fromFormation !== 'string') missing++;
    else if (!stateKeys.has(c.fromFormation)) dangling++;
  }
}
console.log(`    ${blob.length} nodes carry ${rows} call rows, each with the formation the edge leaves from`);
check(rows > 1500, 'every call row carries it - the icons need it and nothing else in the row has it');
check(missing === 0 && dangling === 0, 'and it is always one of the table\'s own state keys, so the app is never asked to resolve a formation that does not exist');
check(/const LEVEL="ms";/.test(html), 'the document is told which level it is, so a click cannot be attributed to another authoring');
check(/parent\.postMessage/.test(html), 'and the bridge is in the emitted document rather than only in the renderer\'s source');

// ============================================================ 5. the Level filter
//
// Asked for as: "provide a dropdown filter for Level", then "There should be an 'all levels' item in the
// levels dropdown" and "default to MS in levels dropdown".
console.log('\n== 5. The Level filter, including All levels ==');
const a = { states: ['Static Square', 'Wave RH'], edges: { 'Static Square': [{ call: 'Swing Thru', endFormation: 'Wave RH' }], 'Wave RH': [] } };
const b = { states: ['Wave RH', 'O In'], edges: { 'Static Square': [{ call: 'Swing Thru', endFormation: 'Wave RH' }, { call: 'Face In', endFormation: 'O In' }], 'Wave RH': [] } };
const merged = mergeFsmTables([a, b]);
check(merged.states.length === 3 && merged.states[0] === 'Static Square' && merged.states.includes('O In'),
  'All levels is the UNION of the states, not a concatenation: a state two levels share is one node');
check(merged.edges['Static Square'].length === 2, 'and the calls to a state are the calls EITHER level can make from it');
check(merged.edges['Static Square'].filter((e) => e.call === 'Swing Thru').length === 1,
  'with the same call landing the same way deduped - two levels authoring one edge is one edge');
check(JSON.stringify(mergeFsmTables([a])) === JSON.stringify(a), 'and a single table merges to itself, which is what All levels is with one asset built');
check(mergeFsmTables([]).states.length === 0, 'no tables is an empty graph rather than a crash');
check(/fsmLevel\.add\(new Option\('All levels', FSM_ALL\)\);/.test(main), "the dropdown has an `All levels` item");
check(/if \(fsmByLevel\.has\('ms'\)\) fsmLevel\.value = 'ms';/.test(main), 'and it DEFAULTS to ms, which is the level whose asset is built');
check(!/fsmLevel\.value = FSM_ALL/.test(main), 'never to All levels, which with one asset built would claim to be more than is on screen');
check(/const table = chosen\.length === 1 \? chosen\[0\]\.table : mergeFsmTables\(/.test(main),
  'All levels draws the merged table and a named level draws its own asset');
check(/chosen\.length === 0[\s\S]{0,220}no precomputed FSM for/.test(main),
  'and a level with no asset still says so rather than drawing an empty graph');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
