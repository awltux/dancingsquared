// DIAGNOSE the Promenade animation after MS `ceder-10530`.
//
// The report: the module ends in a formation the engine cannot NAME, but `Promenade` is still legal
// from it, and playing it walks the dancers through each other into the Static Square.
//
// `Promenade` is a CODED move, so its frames come from `evaluateCodedAt`, which interpolates each
// dancer in a straight line from where it is to where the move puts it - the same shape as the
// removed `blendToAppliedEnd`, and for a whole-set wheel the same failure: everyone cuts across the
// middle. This measures that rather than assuming it.
//
// Usage: node engine/test/tools/promenade-anim-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const pose = (b) => b.dancers.slice().sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}(${d.x.toFixed(2)},${d.y.toFixed(2)})@${Math.round((d.heading * 180) / Math.PI)}`)
  .join(' ');

/** Closest two dancers on a board. */
const closest = (b) => {
  const ds = b.dancers;
  let m = Infinity;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) m = Math.min(m, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  }
  return m;
};

const MODULE = [
  'Heads Pass the Ocean',
  'Extend',
  'Centers Trade',
  'Swing Thru',
  'All 8 Circulate',
  'Right and Left Grand',
];
const square = seq.boardForFormation('Static Square');

console.log('=== the module, applied from a Static Square ===');
seq.setBoard(square);
for (const c of MODULE) {
  const r = seq.applyStep(c);
  console.log(`  ${r.legal ? 'ok  ' : 'FAIL'} ${c}${r.legal ? `  -> [${seq.knownFormation(seq.board)}]` : `  ${r.reason ?? ''}`}`);
}
const beforeProm = seq.board;
console.log(`\n  board before Promenade: [${seq.knownFormation(beforeProm)}]`);
console.log(`  ${pose(beforeProm)}`);
console.log(`  closest pair: ${closest(beforeProm).toFixed(3)}`);

// Is Promenade legal there, and what does it produce?
const prom = seq.applyToBoard(beforeProm, 'Promenade');
console.log(`\n=== Promenade from that board ===`);
console.log(prom.legal ? `  legal -> [${seq.knownFormation(prom.board)}]  closest pair ${closest(prom.board).toFixed(3)}` : `  REFUSED: ${prom.reason}`);

// THE ANIMATION over the Promenade's own beats.
const flat = [...MODULE, 'Promenade'];
const prefixBeats = seq.sequenceBeats(MODULE, square);
const total = seq.sequenceBeats(flat, square);
console.log(`\n=== the Promenade's frames (beats ${prefixBeats.toFixed(1)} .. ${total.toFixed(1)}) ===`);
let worst = Infinity;
let worstBeat = 0;
for (let b = prefixBeats; b <= total + 1e-9; b += (total - prefixBeats) / 40) {
  const at = seq.evaluateSequence(flat, b, square).board;
  const c = closest(at);
  if (c < worst) { worst = c; worstBeat = b; }
}
console.log(`  closest two dancers at any point: ${worst.toFixed(3)} at beat ${worstBeat.toFixed(1)}`);
console.log(`  at that beat: ${pose(seq.evaluateSequence(flat, worstBeat, square).board)}`);
console.log(`  end of the Promenade: [${seq.knownFormation(seq.evaluateSequence(flat, total, square).board)}] closest pair ${closest(seq.evaluateSequence(flat, total, square).board).toFixed(3)}`);

// For comparison, the same call from the SQUARED SET it is authored for.
console.log('\n=== Promenade straight from a Static Square, for comparison ===');
const t2 = seq.sequenceBeats(['Promenade'], square);
let worst2 = Infinity;
for (let b = 0; b <= t2 + 1e-9; b += t2 / 40) {
  const c = closest(seq.evaluateSequence(['Promenade'], b, square).board);
  if (c < worst2) worst2 = c;
}
console.log(`  closest pair at any point: ${worst2.toFixed(3)} over ${t2.toFixed(1)} beats`);
