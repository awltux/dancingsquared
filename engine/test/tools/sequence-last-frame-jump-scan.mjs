// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// HOW MANY MODULES END WITH A FLIP? The final frame is drawn from the board the LAST CALL STORES
// (`evaluateSequence` at the total returns `step.after`), while every frame before it is the call's
// interpolated path. If those two differ, the dancers move on the last frame while the rest of the
// sequence looked right - the reported "the last frame flips the dancers around".
//
// PLAN records a residual of exactly this shape ("the final-frame jump", 7 (board, call) pairs, every
// one a circle call) pinned in `anim-convergence.mjs`. This scans the whole ceder corpus to size it,
// and names the call and the module for each case, so the owner is known rather than guessed.
//
// Usage: node engine/test/tools/sequence-last-frame-jump-scan.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
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
const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};
const START = { 'static square': null, 'squared set': null, 'zero line': 'L1o', 'zero box': 'B1c' };
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

let total = 0, unplayable = 0, flipped = 0, worst = 0;
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
  const before = seq.evaluateSequence(flat, totalBeats - 1e-6, start).board;
  const after = seq.evaluateSequence(flat, totalBeats, start).board;
  let maxDist = 0, maxTurn = 0;
  for (const d of after.dancers) {
    const b = before.dancers.find((x) => x.id === d.id);
    if (!b) { maxDist = Infinity; break; }
    maxDist = Math.max(maxDist, Math.hypot(b.x - d.x, b.y - d.y));
    maxTurn = Math.max(maxTurn, Math.abs(norm(b.heading - d.heading)));
  }
  if (maxDist > 0.05) {
    flipped++;
    worst = Math.max(worst, maxDist);
    const last = flat[flat.length - 1];
    const call = typeof last === 'string' ? last : last.call;
    byCall.set(call, (byCall.get(call) ?? 0) + 1);
    if (examples.length < 10) examples.push(`${path.relative(root, file).replace(/\\/g, '/')}  last "${call}"  worst ${maxDist.toFixed(2)} units, ${((maxTurn * 180) / Math.PI).toFixed(0)} deg`);
  }
}
console.log(`${total} module(s) with steps`);
console.log(`  the walk plays 0 beats (nothing to animate): ${unplayable}`);
console.log(`  modules whose LAST frame moves a dancer > 0.05 units: ${flipped}  (${(100 * flipped / total).toFixed(0)}%), worst ${worst === Infinity ? 'inf' : worst.toFixed(2)} units`);
console.log('\n  by the last call:');
for (const [c, n] of [...byCall.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${String(n).padStart(4)}  ${c}`);
console.log('\n  examples:');
for (const e of examples) console.log(`    ${e}`);
