// WHO OWNS THE LAST-FRAME JUMP? Classify every corpus offender by the interpolation BRANCH that
// produced the frame before it, before touching any of them.
//
// `evaluateSequence` draws a mid-call frame from one of three places and the final frame from
// `step.after`, so a jump on the last frame is a branch that does not converge on the board the call
// APPLIED:
//   - coded single-segment: `interpolateSegment(board, move.apply(board), t)` - lands on the applied
//     board at t = 1 BY CONSTRUCTION, so it should own nothing;
//   - coded with PARTS (`legs`): each part is interpolated, and the last part is supposed to BE the
//     move's own end board - if it is not, the last frame is the one that shows it;
//   - catalogue whole-board: `evaluateVariantAt(..., rebase = true)`;
//   - catalogue parallel/subset: `evaluateParallelAt`, which already applies a residual correction
//     `pose(t) = authored(t) + (appliedEnd - authoredEnd) * t`.
//
// Usage: node engine/test/tools/sequence-convergence-owner-probe.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { findCodedMove } from '../../dist/sequencer/coded-moves.js';
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

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

const THRESH = 0.05;
const classes = new Map();
const byCall = new Map();
const examples = [];
let total = 0, offenders = 0;

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
  const beats = seq.sequenceBeats(flat, start);
  if (beats <= 0) continue;

  const pre = seq.evaluateSequence(flat, beats - 1e-6, start).board;
  const end = seq.evaluateSequence(flat, beats, start).board;
  const byId = new Map(end.dancers.map((d) => [d.id, d]));
  let worst = 0;
  for (const d of pre.dancers) {
    const e = byId.get(d.id);
    if (e) worst = Math.max(worst, Math.hypot(e.x - d.x, e.y - d.y));
  }
  if (worst <= THRESH) continue;
  offenders++;

  const last = flat[flat.length - 1];
  const call = typeof last === 'string' ? last : last.call;
  const coded = findCodedMove(call);
  const legs = coded?.legs ? 'coded-legs' : coded ? 'coded-single' : 'catalogue';
  classes.set(legs, (classes.get(legs) ?? 0) + 1);
  const key = `${legs}  ${call}`;
  const rec = byCall.get(key) ?? { n: 0, worst: 0 };
  rec.n++;
  rec.worst = Math.max(rec.worst, worst);
  byCall.set(key, rec);
  if (examples.length < 14) {
    examples.push(`${path.relative(root, file).replace(/\\/g, '/')}  ${legs}  last "${call}"  worst ${worst.toFixed(2)}`);
  }
  // For a coded move, is the ANIMATED end the board the move APPLIED? That is the legs-path question.
  if (coded && coded.legs) {
    seq.setBoard(start);
    let before = null;
    for (let i = 0; i < flat.length - 1; i++) before = seq.applyStep(flat[i]).board ?? before;
    const b = before ?? start;
    const parts = coded.legs(b);
    const applied = coded.apply(b);
    if (parts && parts.length) {
      const tail = parts[parts.length - 1];
      const tailBy = new Map(tail.dancers.map((d) => [d.id, d]));
      let gap = 0;
      for (const d of applied.dancers) {
        const t = tailBy.get(d.id);
        if (t) gap = Math.max(gap, Math.hypot(t.x - d.x, t.y - d.y));
      }
      const rec2 = byCall.get(`${legs}  ${call}`) ?? { n: 0, worst: 0 };
      rec2.legsGap = Math.max(rec2.legsGap ?? 0, gap);
      byCall.set(`${legs}  ${call}`, rec2);
    }
  }
}

console.log(`${total} module(s); last frame moves a dancer > ${THRESH} units: ${offenders}`);
console.log('\n  by BRANCH:');
for (const [k, n] of [...classes.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
console.log('\n  by branch + last call (worst per-dancer move):');
for (const [k, r] of [...byCall.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
  console.log(`    ${String(r.n).padStart(4)}  ${k.padEnd(42)} worst ${r.worst.toFixed(2)}${r.legsGap !== undefined ? `   legs-tail vs applied: ${r.legsGap.toFixed(2)}` : ''}`);
}
console.log('\n  examples:');
for (const e of examples) console.log(`    ${e}`);
