// TIER: none — one-shot diagnostic; nothing runs it. Recorded: engine/test/tools/README.md.
// Is `Right and Left Thru` from `3 and 1 lines #1` a REAL combination?
//
// The walk-through survey flagged it as the worst single case (closest pair 0.00, destination sound),
// and its permutation - four dancers that do not move and two pairs that swap - looked like a call
// being applied to a board it does not fit. The way to tell the difference between "the engine
// mis-applies it" and "real choreography does this and the engine animates it badly" is to ask the
// corpora: does ANY sequence actually reach that formation and then call it?
//
// Two local witnesses are checked - the ceder module corpus (the same source the POC offers) and
// All8's 188 published figures - by walking each sequence and recording the formation standing before
// EVERY `Right and Left Thru`.
//
// Usage: node engine/test/tools/rlt-context-probe.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, splitSelection } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { ALL8_FIGURE_START, figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const label = (s) => (typeof s === 'string' ? s : s.call);
const baseOf = (s) => splitSelection(label(s)).call;
const CALL = 'Right and Left Thru';

// ---- the geometry of the formation in question, so it is on the record
const geo = seq.boardForFormation('3 and 1 lines #1');
console.log('=== formation "3 and 1 lines #1" ===');
if (geo) {
  console.log('  ' + geo.dancers.slice().sort((a, b) => a.id - b.id)
    .map((d) => `#${d.id}(${d.x},${d.y})@${Math.round((d.heading * 180) / Math.PI)}`).join(' '));
  console.log(`  engine names it: ${seq.knownFormation(geo)}`);
  const r = seq.applyToBoard(geo, CALL);
  console.log(`  ${CALL} from it: ${r.legal ? `legal -> [${seq.knownFormation(r.board)}]` : `REFUSED (${r.reason})`}`);
} else {
  console.log('  no such formation');
}

// ---- walk a sequence, recording the formation before every Right and Left Thru
const tally = new Map();
const examples = new Map();
const walk = (steps, name) => {
  let board = seq.boardForFormation(ALL8_FIGURE_START);
  if (!board) return;
  for (const s of steps) {
    const before = seq.knownFormation(board) ?? '(unnamed)';
    if (baseOf(s) === CALL) {
      tally.set(before, (tally.get(before) ?? 0) + 1);
      if (!examples.has(before)) examples.set(before, []);
      examples.get(before).push(name);
    }
    const r = seq.applyToBoard(board, s);
    if (!r.legal) break;
    board = r.board;
  }
};

// All8's published figures
const data = loadAll8Figures();
for (const f of data.figures) walk(figureEngineCalls(f), f.id);
const figCount = tally.size;

// The ceder module corpus
let modules = 0;
const walkDir = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { walkDir(p); continue; }
    if (!p.endsWith('.json')) continue;
    let v;
    try { v = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (!v || !Array.isArray(v.steps) || v.success !== true) continue;
    if (v.steps.includes('ALLEMANDE_LEFT')) continue;
    modules++;
    walk(v.steps, `ceder-${v.id}`);
  }
};
walkDir(path.join(root, 'modules'));

console.log(`\n=== formations "${CALL}" is called FROM ===`);
console.log(`  over ${data.figures.length} All8 figures and ${modules} replayable ceder modules\n`);
for (const [fm, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  const ex = (examples.get(fm) ?? []).slice(0, 4).join(', ');
  const flag = /3 and 1/i.test(fm) ? '   <-- a 3-and-1 lines board' : '';
  console.log(`  ${String(n).padStart(3)}  ${fm}${flag}`);
  console.log(`       e.g. ${ex}`);
}
console.log(`\n  ${figCount} distinct formation(s) seen before a ${CALL}.`);
