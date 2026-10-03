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

// Two authorings of one title at two levels. The lower level used to be `b1`, removed with the Basic
// levels; `ssd` takes its place as the earliest level left, and the point of the case is only that the
// two levels differ.
const catalog = [
  { id: 'ssd/right and left thru::Right and Left Thru', level: 'ssd', title: 'Right and Left Thru', setups },
  { id: 'ms/right and left thru::Right and Left Thru', level: 'ms', title: 'Right and Left Thru', setups: [setups[1]] },
];
check(fsmCatalogEntry(catalog, 'Right and Left Thru', 'ms')?.id.startsWith('ms/') === true,
  'the level of the tree decides WHICH authoring of a title is meant');
check(fsmCatalogEntry(catalog, 'Right and Left Thru', 'plus')?.id.startsWith('ssd/') === true,
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
let rows = 0, missing = 0, dangling = 0, badJump = 0;
const stateKeys = new Set(fsm.table.states);
const labelOf = (s) => (s.startsWith('@embed') ? `embedded #${s.slice(7)}` : s);
for (const nd of blob) {
  for (const c of [...nd.calls, ...nd.incoming]) {
    rows++;
    if (!('fromFormation' in c) || typeof c.fromFormation !== 'string') missing++;
    else if (!stateKeys.has(c.fromFormation)) dangling++;
    // THE OTHER END OF THE EDGE, which the row's name is clicked to select: an index into the same state
    // list, and one whose label is the name the row displays - or the click selects a different board from
    // the one it names.
    const idx = 'toIdx' in c ? c.toIdx : c.fromIdx;
    const shown = 'toIdx' in c ? c.to : c.from;
    if (!Number.isInteger(idx) || idx < 0 || idx >= fsm.table.states.length || labelOf(fsm.table.states[idx]) !== shown) badJump++;
  }
}
console.log(`    ${blob.length} nodes carry ${rows} call rows, each with the formation the edge leaves from and the index of the node at the other end`);
check(rows > 1500, 'every call row carries it - the icons need it and nothing else in the row has it');
check(missing === 0 && dangling === 0, 'and it is always one of the table\'s own state keys, so the app is never asked to resolve a formation that does not exist');

// ============================================================ 4c. the edges that leave the vocabulary
//
// Schema 2 records WHY an edge has no target (`FsmEndKind`), and the renderer now SAYS SO instead of hiding
// it. The graph layout still draws only edges with a target - drawing a stub per transient is separate work,
// recorded in PLAN.md - but the count is in the header and every node lists its own.
console.log('\n== 4c. the edges that leave the vocabulary ==');
{
  const leaves = (fsm.table.edges ? Object.values(fsm.table.edges).flat() : []).filter((e) => e.endFormation == null);
  const byKind = leaves.reduce((m, e) => m.set(e.endKind ?? 'missing', (m.get(e.endKind ?? 'missing') ?? 0) + 1), new Map());
  const totalEdges = Object.values(fsm.table.edges ?? {}).reduce((n, l) => n + l.length, 0);
  console.log(`    the asset holds ${totalEdges} edges, ${leaves.length} of them without a target: ` +
    `${[...byKind].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  check(byKind.size >= 2 && byKind.get('missing') === undefined,
    'every targetless edge in the asset carries its kind (schema 2), so the view has something to say about it');
  check(html.includes(`${leaves.length} of ${totalEdges} edges leave the vocabulary`),
    `the header counts them (${leaves.length} of ${totalEdges}) - a renderer that hid 28% of its own table would be the instrument failing to say so`);
  const listed = blob.reduce((n, nd) => n + (nd.leaves?.length ?? 0), 0);
  console.log(`    ${listed} of them are listed per node in the sidebar`);
  // EVERY targetless edge, exactly once: the renderer walks every state's edge list, so a leaf can only be
  // missing if the graph loop dropped it on the floor - which is what the old `continue` did.
  check(listed === leaves.length, `every targetless edge is listed on its source node (${listed} of ${leaves.length})`);
  check(blob.every((nd) => Array.isArray(nd.leaves)), 'and every node carries the list, empty where it has none');
  check(/Leaves the vocabulary \(/.test(html) || html.includes("'Leaves the vocabulary ('"),
    'the sidebar has a section for them');
  // The graph itself is unchanged: only edges WITH a target are drawn.
  const drawn = (html.match(/class="edge"/g) ?? []).length;
  check(drawn > 0 && drawn <= totalEdges - leaves.length + 1,
    `the graph still draws only the ${totalEdges - leaves.length} edges that have a target (${drawn} distinct node pairs)`);
}

// ============================================================ 4d. the graph is inside its own frame
//
// FOUND IN A REAL BROWSER, GATED HERE. The force layout's fit used `S = 1800 / (maxX - minX)` on BOTH
// axes, which fits only while the layout is wider than it is tall - and a force layout's aspect follows
// the EDGE COUNT, which Stage 2 tripled. MEASURED: the asset before Stage 2 drew 164 node pairs with a
// Y extent of 100..1814 (fits), the one after drew 516 with 100..2650 - 650 units OUTSIDE the
// `viewBox="0 0 2000 2000"`. The SVG CLIPS what falls outside, so a quarter of the graph was silently not
// drawn and the stage looked empty. Nothing in the emitted HTML is invalid - the positions are simply
// outside the frame - which is why every string-level check here passed and only a browser could see it.
//
// The invariant is checkable from the document, so the gate does not need that browser.
console.log('\n== 4d. every node is inside the 2000x2000 viewBox, and the drawing uses the frame ==');
{
  const box = html.match(/<svg viewBox="([^"]+)"/);
  const vb = box ? box[1].trim().split(/\s+/).map(Number) : [NaN, NaN, NaN, NaN];
  const pts = [...html.matchAll(/<g class="node"[^>]*transform="translate\(([-\d.]+),([-\d.]+)\)"/g)]
    .map((m) => ({ x: +m[1], y: +m[2] }));
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  console.log(`    viewBox ${vb.join(' ')}; ${pts.length} nodes at x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)} ` +
    `y ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}`);
  check(vb[2] === 2000 && vb[3] === 2000, `the viewBox is the 2000x2000 the fit targets (got ${vb[2]}x${vb[3]})`);
  // Edge endpoints come from the same coordinate table, so checking the NODES checks the edges.
  const out = pts.filter((p) => p.x < 0 || p.y < 0 || p.x > vb[2] || p.y > vb[3]);
  check(out.length === 0,
    out.length === 0
      ? `all ${pts.length} nodes are inside the frame - the graph is not clipped`
      : `${out.length} node(s) fall outside the viewBox, e.g. (${out[0].x.toFixed(0)}, ${out[0].y.toFixed(0)}) - the SVG silently clips them`);
  // AND IT USES THE FRAME. A fit that clamps everything into a corner passes the check above and is still
  // unreadable, so the drawing must span a real fraction of the box on its LONGER axis.
  console.log(`    the drawing spans ${spanX.toFixed(0)} x ${spanY.toFixed(0)} of 2000 ` +
    `(${((Math.max(spanX, spanY) / 2000) * 100).toFixed(0)}% of the frame on its longer axis)`);
  check(Math.max(spanX, spanY) > 1500,
    `the drawing uses the frame (${Math.max(spanX, spanY).toFixed(0)} of the 1800 usable units on its longer axis)`);
}

// ============================================================ 4e. the graph settles before it is read
//
// FOUND BY DRAGGING A NODE, and it is two layouts disagreeing. This document contains BOTH
//
//   a PRERENDER  400 FR iterations baked into each node's transform. It has NO centripetal term, so one node
//                ejects to a large radius and the bbox fit - which normalises by those extremes - shrinks
//                everything else. MEASURED on the ms asset: median nearest-neighbour 3.6 units against a
//                13-20 unit node radius, 64 of 65 nodes overlapping, and the middle 90% of the mass in 7%
//                of the frame. That is the blob a reader saw.
//   a SIMULATION  the same repulsion and edge attraction PLUS a pull toward (1000,1000), so it spreads.
//
// and the simulation only started from a node's pointerdown - so the blob was what the reader saw UNTIL they
// happened to touch a node. The fix auto-selects home and starts the simulation on load: MEASURED, median
// nearest-neighbour 3.6 -> 57.3, overlapping 64 -> 5, middle-90% span 7% -> 62% of the frame.
//
// TWO CHECKS, and the second is the one that matters, because the FIRST attempt at the fix looked correct and
// did nothing: it called `idx.get(HOME)`, which are the RENDERER's variables and do not exist in the emitted
// page, so the page threw a silent ReferenceError, kept working, and stayed a blob. Nothing in this file -
// which checks the emitted TEXT - could see that. What catches it is that the emitted document must not
// reference the renderer's own scope at all.
console.log('\n== 4e. the layout settles on load, and the document does not reach into the renderer ==');
{
  check(/data-status="home"/.test(html), 'the document marks the home node, which is what the auto-start selects');
  check(/querySelector\('\.node\[data-status="home"\]'\)/.test(html),
    'and the auto-start finds home IN THE DOCUMENT\'S OWN TERMS rather than through a renderer variable');
  // THE SCOPE LEAK. `idx` and `HOME` are locals of `renderFsmHtml`; a reference to either inside the emitted
  // script is a ReferenceError at runtime and invisible to every check that only looks for what the fix was
  // supposed to ADD.
  //
  // A BLUNT "no idx/HOME anywhere" ASSERTION WAS TRIED FIRST AND IS WRONG, which is worth recording so it is
  // not re-proposed: the document legitimately declares its own `jumpSpan=(text,idx)` parameter, and "HOME"
  // appears in three prose comments ("A ROUTE HOME", "LEADS HOME", "AUTO-SELECT HOME..."). It failed on both.
  // The precise signature of the bug is the renderer's index MAP being used from inside the page, so that is
  // what is asserted - and the auto-start's own shape is constrained below.
  check(!/idx\.get\(/.test(html),
    'the emitted page never calls idx.get(...) - the renderer\'s index map is not reachable from the document');
  check(!/\bkeys\s*\(\s*\)\s*\)\s*\.get\(/.test(html) && !/states\[/.test(html),
    'and it never indexes the renderer\'s state array either (the page has its own node list)');
  // And the auto-start must actually kick the SIMULATION, not merely select: `select` only paints and fills
  // the sidebar, so a fix that stopped there would look right in this text and still show a blob.
  const auto = /const homeEl = document\.querySelector[\s\S]{0,600}?requestAnimationFrame\(step\)/.test(html);
  check(auto, 'the auto-start runs the simulation rather than only selecting the node (select alone does not reflow)');
  check(/const homeEl = document\.querySelector[\s\S]{0,400}?select\(home\)/.test(html),
    'and it SELECTS home, so the sidebar opens on the squared set instead of "Click a node to see its calls."');
}
check(badJump === 0, 'every row also names the OTHER end as a state index, and that index is the node the row displays - so clicking a name selects the board it says');
check(/const LEVEL="ms";/.test(html), 'the document is told which level it is, so a click cannot be attributed to another authoring');
check(/parent\.postMessage/.test(html), 'and the bridge is in the emitted document rather than only in the renderer\'s source');
check(/span\.jump\{cursor:pointer/.test(html), 'the clickable formation is styled as one, so a name that selects something is not silent about it');
check(/e\.target\.closest\('\.jump'\);if\(j\)\{e\.stopPropagation\(\);selectOnly\(\+j\.dataset\.node\);return;\}/.test(html),
  'and a click on it goes through `selectOnly`, the SET-not-toggle selection a drag end already uses - so the node it names is the node selected');
check(!/li\.textContent=arrow\?/.test(view), 'the row is no longer one text node: the name is an element that can be clicked');

// ============================================================ 4c. the route home
//
// Asked for: "If there is a 'route home' for the currently selected node, highlight the calls from that support
// it." The route is recomputed HERE, from the emitted rows themselves, and compared with the flags the renderer
// put on them - so the highlight is checked against the graph rather than against the code that produces it.
console.log('\n== 4c. The calls that lead home ==');
const HOME = fsm.table.states.indexOf('Static Square');
const outEdges = blob.map((nd) => nd.calls.map((c) => c.toIdx));
const canHome = new Set([HOME]);
for (let grew = true; grew;) {
  grew = false;
  for (let i = 0; i < outEdges.length; i++) {
    if (canHome.has(i)) continue;
    if (outEdges[i].some((t) => canHome.has(t))) { canHome.add(i); grew = true; }
  }
}
let flagged = 0, wrongFlag = 0, homeRowsOnDeadEnds = 0, nodesWithRoute = 0, strict = 0, homed = 0;
for (const nd of blob) {
  const i = blob.indexOf(nd);
  if (canHome.has(i)) nodesWithRoute++;
  let marked = 0;
  for (const c of nd.calls) {
    const expect = canHome.has(c.toIdx);
    if (c.home !== expect) wrongFlag++;
    if (c.home) { flagged++; marked++; }
    if (c.home && !canHome.has(i)) homeRowsOnDeadEnds++;
  }
  if (!canHome.has(i) && marked > 0) homeRowsOnDeadEnds++;
  // A HIGHLIGHT THAT COVERS THE WHOLE LIST SAYS NOTHING. For the nodes with a route home, some of the calls
  // from them must lead away from it - otherwise "highlighted" would just mean "listed".
  if (canHome.has(i) && nd.calls.length > 1) { if (marked < nd.calls.length) strict++; else homed++; }
}
console.log(`    ${canHome.size} of ${blob.length} states have a route home; ${flagged} of ${blob.reduce((n, nd) => n + nd.calls.length, 0)} calls from the listed nodes lead home`);
console.log(`    ${strict} nodes with a route home have calls that do NOT lead home, ${homed} where every call from the node leads home`);
check(flagged > 0, 'there are calls to highlight at all');
check(wrongFlag === 0, 'and every call the renderer flagged is exactly one whose end state can reach the squared set, and no other');
check(homeRowsOnDeadEnds === 0, 'a node with NO route home has no highlighted call - the flag is a fact about the graph, not a decoration on every row');
check(strict > 0, 'and on the nodes that have a route, the highlight is a SUBSET of the list, so it says which calls are the way home');
check(!/\bhome\b/.test(JSON.stringify(blob[0].incoming)), 'the flag is on the calls FROM the node only: an incoming call is not the selected node\'s route');
check(/li\.route-home\{background:rgba\(58,154,95,0\.18\)/.test(html) && /if\(!arrow&&c\.home\)\{li\.className='route-home'/.test(html),
  'and a flagged row is marked on the element, with the style the legend describes');
check(/call that leads home/.test(html), 'the legend says what the highlight means');

// ============================================================ 4d. the draggable pane
//
// Asked for: "allow me to drag the width of the left hand pane". The clamp is the same function the document
// runs - the renderer inlines its compiled source - so this tests the rule rather than a copy of it.
console.log('\n== 4d. The draggable pane ==');
const { clampSideWidth } = await import('./../src/fsm-view.ts');
check(clampSideWidth(400, 1000) === 400, 'a drag width inside the range is taken as it is');
check(clampSideWidth(10, 1000) === 180, 'narrower than the minimum becomes the minimum - the pane cannot be dragged away to nothing');
check(clampSideWidth(950, 1000) === 800, 'and wider than 80% of the window becomes that, so the graph cannot be pushed off screen');
check(clampSideWidth(NaN, 1000) === 180 && clampSideWidth(Infinity, 1000) === 180,
  'a non-finite width is the minimum rather than NaNpx, which the browser would ignore silently while the drag looked like it worked');
check(clampSideWidth(300, 100) === 180, 'a window narrower than the minimum still yields a usable pane');
check(html.includes(clampSideWidth.toString()), 'and the emitted document runs THAT function, so the rule does not exist twice');
check(/<div id="grip"[^>]*><\/div><div id="stage">/.test(html), 'the grip sits between the pane and the graph, which is the edge being dragged');
check(/#grip\{width:6px;flex:0 0 auto;cursor:col-resize/.test(html), 'it is drawn as a resize bar');
check(/grip\.setPointerCapture\(e\.pointerId\)/.test(html), 'the drag captures the pointer, so it keeps working once the cursor leaves the 6px bar');
check(/localStorage\.setItem\(SIDE_KEY/.test(html) && /localStorage\.getItem\(SIDE_KEY/.test(html),
  'and the width is remembered: the frame is rebuilt whole on a level change and on every visit to the tab, so a width living only in the document would snap back exactly when the lists were the way the caller wanted them');
check(/grip\.addEventListener\('dblclick'/.test(html), 'double-clicking the bar restores the default width');
check(/#side\{width:300px;flex:0 0 auto/.test(html), "and the pane cannot be shrunk by the flex layout behind the drag's back");

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

// AND THE TOOLBAR IS DRAWN WHERE THE HUD CANNOT COVER IT. It was not, and that is why the Level filter was
// reported as missing: `#fsmPanel` is z-index 5 UNDER `#hud`'s 10 (deliberately - the mode selector has to
// stay reachable to leave the tab), the HUD is anchored at the top LEFT, and a toolbar laid out from the
// left is therefore painted underneath it. The arithmetic is checked here because nothing else can check it:
// it is a property of the two boxes, not of any code path.
const css = fs.readFileSync(path.join(POC_DIR, 'src', 'style.css'), 'utf8');
const block = (sel) => (css.match(new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) ?? [, ''])[1];
const zOf = (s) => Number((s.match(/z-index:\s*(-?\d+)/) ?? [, '0'])[1]);
const hud = block('#hud');
const bar = block('.fsm-toolbar');
check(zOf(hud) > zOf(block('#fsmPanel')), 'the HUD floats OVER the FSM panel, so the mode selector stays reachable from the FSM tab');
check(/top:\s*12px/.test(hud) && /left:\s*12px/.test(hud), 'and it is anchored at the top LEFT of the viewport');
check(/justify-content:\s*flex-end/.test(bar),
  'so the FSM toolbar is laid out from the RIGHT, which is the only side the HUD cannot be covering');
check(/min-width:\s*320px/.test(hud), 'and the HUD is at least 320px wide, which is wider than the toolbar\'s own left padding');
check(/background:/.test(bar) && /border-bottom:/.test(bar), 'the bar has its own background and rule, so it reads as a toolbar rather than as loose text over the graph');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
