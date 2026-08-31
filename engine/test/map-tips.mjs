// Tip-to-FSM mapper: walk realistic square-dance tips over the Sequencer and the
// FSM transition table, reporting any call step whose (formation -> next) edge is
// not defined in the table. The goal is to find calls/formations that occur in
// real choreography but are missing from the FSM, so they can be added to
// poc/src/assets/discovered/.
//
// Run: `npm run build` then `node test/map-tips.mjs` from engine/.

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer } from '../dist/index.js';

setParser(DOMParser);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const movesXml = read('poc/src/assets/moves.xml');
const formationsXml = read('poc/src/assets/formations.xml');

// Load the full catalog so every call used in a tip is registered. Calls are
// keyed by their <tam> TITLE (e.g. "Circle Left"), not the file basename, so
// tips can use the human call names.
const catalog = [];
const tamBlocks = (xml) => xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
const attr = (b, n) => (b.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] ?? '';
const isHidden = (b) => /display="(no|none)"/.test(b.slice(0, b.indexOf('>') + 1));
for (const level of ['ms', 'b1', 'b2', 'a1', 'a2', 'plus', 'c1', 'c2']) {
  const dir = path.join(root, `poc/src/assets/${level}`);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.xml')); } catch { continue; }
  for (const f of files) {
    const xml = read(`poc/src/assets/${level}/${f}`);
    const byTitle = new Map();
    for (const b of tamBlocks(xml)) {
      if (isHidden(b)) continue;
      const t = attr(b, 'title') || '?';
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push(b);
    }
    for (const [title, blocks] of byTitle) {
      catalog.push({ name: title, xml: `<calls>\n${blocks.join('\n')}\n</calls>` });
    }
  }
}
console.log(`registered ${catalog.length} call titles`);

const seq = new Sequencer(movesXml, formationsXml, catalog.map((c) => ({ name: c.name, xml: c.xml })));
const table = seq.transitionTable();
console.log(`FSM: ${table.stateCount()} states, ${table.edgeCount()} edges`);

// Curated realistic tips. These are standard mainstream sequences (from the
// repo's curriculum + common choreography) that start and end in the squared set.
const TIPS = [
  ['Circle Left', 'Allemande Left', 'Right and Left Grand', 'Weave the Ring'],
  ['Heads Promenade 1/2', 'Sides Face, Grand Square', 'Circle Left'],
  ['Star Thru', 'Slide Thru', 'Right and Left Thru', 'Flutterwheel', 'Slide Thru'],
  ['Heads Pass Thru', 'Separate Around 1 to a Line', 'Star Thru', 'Bend the Line'],
  ['Heads Pass Thru', 'Part Trade', 'Square Thru 4', 'Right and Left Thru'],
  ['Swing Thru', 'Boys Run', 'Bend the Line', 'Trade By'],
  ['Pass the Ocean', 'Swing Thru', 'Boys Run', 'Ferris Wheel', 'Centers In'],
  ['Dosado', 'Swing Your Partner', 'Allemande Left', 'Promenade'],
  ['Right and Left Grand', 'Allemande Left', 'Swing Your Corner', 'Swing Your Partner'],
];

// Walk each tip, applying calls and checking FSM edges at each step.
let tipOk = 0, tipBad = 0;
const missingEdges = []; // { tipIdx, call, fromState, toState }
for (let t = 0; t < TIPS.length; t++) {
  seq.reset();
  const startState = seq.fsmState(seq.board)?.key ?? '?';
  let ok = true;
  const steps = [];
  for (const call of TIPS[t]) {
    const from = seq.fsmState(seq.board)?.key ?? '?';
    const res = seq.apply(call);
    if (!res.legal) { steps.push(`${call} [ILLEGAL]`); ok = false; continue; }
    const to = seq.fsmState(seq.board)?.key ?? '?';
    const hasEdge = table.edgesFor(from).some((e) => e.call === call);
    steps.push(`${call} (${from}->${to})${hasEdge ? '' : ' [NO EDGE]'}`);
    if (!hasEdge) missingEdges.push({ tipIdx: t, call, fromState: from, toState: to });
  }
  const endsHome = seq.isAt('Static Square');
  const label = `${ok && endsHome ? 'OK  ' : 'BAD '} tip${t}: ${steps.join(' | ')}${endsHome ? '' : ' [NOT HOME]'}`;
  console.log(label);
  if (ok && endsHome) tipOk++; else tipBad++;
  console.log(`  start=${startState}`);
}

console.log(`\nTips fully mapped: ${tipOk}, with issues: ${tipBad}`);
console.log(`Missing/undefined edges found: ${missingEdges.length}`);
const uniqueMissing = new Map();
for (const m of missingEdges) {
  const k = `${m.fromState} -> ${m.call} (to ${m.toState})`;
  if (!uniqueMissing.has(k)) uniqueMissing.set(k, 0);
  uniqueMissing.set(k, uniqueMissing.get(k) + 1);
}
for (const [k, n] of uniqueMissing) console.log(`  MISSING ${n}x: ${k}`);
