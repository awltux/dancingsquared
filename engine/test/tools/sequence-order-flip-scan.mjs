// THE LAST FRAME MUST NOT RE-ORDER THE DANCERS. Corpus scan for the reported flip.
//
// Reported (POC): "The Module works fine, but if I apply a Promenade to the end, this is when the
// Dancers switch position in the final static square. They finish in a non standard arrangement for
// Static Square, but flip to setup arrangement for Static Square on the last frame."
//
// THE CAUSE, and what this measures: the POC's `renderBoard` builds its pose list in `board.dancers`
// order and hands pose `i` to dancer view `i`, so the ARRAY ORDER is the renderer's binding from a
// dancer to a body on screen. `evaluateSequence` at a mid-call beat returns an INTERPOLATED board
// (which carries the order the sequence walked in) but at the total returns `step.after` - the board
// the applicator or the coded move STORES - so a component that rebuilds a board in its own order
// scrambles the whole set on the one frame where that board is what is drawn. `promenadeHome` did
// exactly that by returning `makeSquaredSet()`.
//
// For every module in the ceder corpus this compares, at EVERY step boundary and at the final frame:
//   - the `dancers` array order (by id) one instant BEFORE the boundary and AT it, and
//   - the per-id poses, so a RE-ORDER (the reported flip: same poses, different order) is told apart
//     from a real move of the dancers.
// It also compares the LIVE replay (`applyStep`, what the sequencer's own board is) to the WALK.
//
// Usage: node engine/test/tools/sequence-order-flip-scan.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};
const START = { 'static square': null, 'squared set': null, 'zero line': 'L1o', 'zero box': 'B1c' };

const order = (b) => b.dancers.map((d) => d.id).join(',');
/** Every dancer's pose by ID: the geometry, which a re-order does not change. */
const posesById = (b) => [...b.dancers].sort((a, c) => a.id - c.id)
  .map((d) => `${d.id}:${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}`).join('|');

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

let total = 0, unplayable = 0;
let lastFrame = 0, lastFramePure = 0, midStep = 0, liveVsWalk = 0;
const byCall = new Map();
const examples = [];

for (const file of walkJson(path.join(root, 'modules'))) {
  let mod;
  try { mod = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!Array.isArray(mod.steps) || !mod.steps.length) continue;
  total++;
  const label = mod.startFormation?.trim().toLowerCase();
  const code = START[label];
  const start = code === null
    ? seq.boardForFormation('Static Square')
    : boardForFasrCode(code ?? '', templateForLetter).board;
  const flat = seq.flatten(mod.steps);
  const totalBeats = seq.sequenceBeats(flat, start);
  if (totalBeats <= 0) { unplayable++; continue; }

  const rel = path.relative(root, file).replace(/\\/g, '/');
  const callAt = (i) => { const f = flat[i]; return typeof f === 'string' ? f : f.call; };

  // --- the final frame
  const pre = seq.evaluateSequence(flat, totalBeats - 1e-6, start).board;
  const end = seq.evaluateSequence(flat, totalBeats, start).board;
  if (order(pre) !== order(end)) {
    lastFrame++;
    const lastCall = callAt(flat.length - 1);
    byCall.set(lastCall, (byCall.get(lastCall) ?? 0) + 1);
    const pure = posesById(pre) === posesById(end);
    if (pure) lastFramePure++;
    if (examples.length < 12) {
      examples.push(`${rel}  last "${lastCall}"  order ${order(pre)} -> ${order(end)}${pure ? '   [same poses: pure scramble]' : '   [poses also differ]'}`);
    }
  }

  // --- every other step boundary, so a call class that re-orders is named
  for (let i = 0; i < flat.length - 1; i++) {
    const b = seq.sequenceBeats(flat.slice(0, i + 1), start);
    if (b <= 0 || b >= totalBeats) continue;
    const a1 = seq.evaluateSequence(flat, b - 1e-6, start).board;
    const a2 = seq.evaluateSequence(flat, b, start).board;
    if (order(a1) !== order(a2)) {
      midStep++;
      const c = callAt(i);
      byCall.set(`(at ${c})`, (byCall.get(`(at ${c})`) ?? 0) + 1);
      break;
    }
  }

  // --- the live replay against the walk
  seq.setBoard(start);
  for (const h of flat) seq.applyStep(h);
  const live = { dancers: seq.board.dancers.map((d) => ({ ...d })) };
  if (order(live) !== order(end)) liveVsWalk++;
}

console.log(`${total} module(s) with steps   (${unplayable} play 0 beats)`);
console.log(`  the LAST frame re-orders the dancers:                     ${lastFrame}  (${lastFramePure} of them a PURE scramble - identical poses, different array order)`);
console.log(`  a mid-sequence step boundary re-orders them:              ${midStep}`);
console.log(`  the LIVE replay ends in a different order from the WALK:  ${liveVsWalk}`);
console.log('\n  by the call at that boundary:');
for (const [c, n] of [...byCall.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${String(n).padStart(4)}  ${c}`);
if (examples.length) {
  console.log('\n  examples:');
  for (const e of examples) console.log(`    ${e}`);
}
