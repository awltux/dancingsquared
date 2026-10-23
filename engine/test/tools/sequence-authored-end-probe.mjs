// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// WHAT IS THE AUTHORED-vs-APPLIED ERROR FIELD? The last-frame jump is `appliedEnd - authoredEnd` per
// dancer, so its STRUCTURE names the cause:
//   - every dancer's delta EQUAL          -> a translation (the rebase lands the variant elsewhere)
//   - |delta| equal, directions rotating  -> a rotation about the set centre (a ring/circle call)
//   - neither                             -> a per-dancer placement difference (slot geometry)
//
// Run against the PRE-fix build, where `evaluateSequence(flat, total - 1e-6)` IS the authored end.
// Usage: node engine/test/tools/sequence-authored-end-probe.mjs

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

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

/** Classify a delta field. */
function shape(deltas) {
  const n = deltas.length;
  if (!n) return 'empty';
  const mean = deltas.reduce((s, d) => ({ x: s.x + d.x / n, y: s.y + d.y / n }), { x: 0, y: 0 });
  const magn = deltas.map((d) => Math.hypot(d.x, d.y));
  const maxM = Math.max(...magn), minM = Math.min(...magn);
  const spread = deltas.reduce((m, d) => Math.max(m, Math.hypot(d.x - mean.x, d.y - mean.y)), 0);
  if (maxM < 1e-6) return 'NONE (the authored end IS the applied end)';
  if (spread < 0.02) return `TRANSLATION (${maxM.toFixed(2)})`;
  if (maxM - minM < 0.02) return `ROTATION about the centre (radius ${((maxM + minM) / 2).toFixed(2)} units)`;
  return `PER-DANCER field (|d| ${minM.toFixed(2)}..${maxM.toFixed(2)}, spread ${spread.toFixed(2)})`;
}

const args = process.argv.slice(2);
const only = args.length ? args : null;
const tally = new Map();
const examples = [];
let offenders = 0;

for (const file of walkJson(path.join(root, 'modules'))) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (only && !only.some((o) => rel.includes(o))) continue;
  let mod;
  try { mod = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!Array.isArray(mod.steps) || !mod.steps.length) continue;
  const label = mod.startFormation?.trim().toLowerCase();
  const code = START[label];
  const start = code === null
    ? seq.boardForFormation('Static Square')
    : boardForFasrCode(code ?? '', templateForLetter).board;
  const flat = seq.flatten(mod.steps);
  const total = seq.sequenceBeats(flat, start);
  if (total <= 0) continue;
  const authored = seq.evaluateSequence(flat, total - 1e-6, start).board;
  const applied = seq.evaluateSequence(flat, total, start).board;
  const byId = new Map(applied.dancers.map((d) => [d.id, d]));
  const deltas = [];
  let worst = 0;
  for (const d of authored.dancers) {
    const e = byId.get(d.id);
    if (!e) continue;
    deltas.push({ id: d.id, x: e.x - d.x, y: e.y - d.y });
    worst = Math.max(worst, Math.hypot(e.x - d.x, e.y - d.y));
  }
  if (worst <= 0.05) continue;
  offenders++;
  const s = shape(deltas);
  const cls = s.split(' (')[0].split(' about')[0];
  tally.set(cls, (tally.get(cls) ?? 0) + 1);
  const last = flat[flat.length - 1];
  const call = typeof last === 'string' ? last : last.call;
  if (examples.length < 24) {
    examples.push(`${rel}  last "${call}"  worst ${worst.toFixed(2)}  ${s}`);
  }
  if (only) {
    console.log(`\n=== ${rel}  last "${call}"  worst ${worst.toFixed(2)}  ${s}`);
    for (const d of deltas) console.log(`    #${d.id}  delta (${d.x.toFixed(2)}, ${d.y.toFixed(2)})  |${Math.hypot(d.x, d.y).toFixed(2)}|`);
  }
}

console.log(`\n${offenders} module(s) with a last-frame jump > 0.05 (pre-fix build)`);
console.log('\n  the ERROR FIELD, by shape:');
for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
console.log('\n  examples:');
for (const e of examples) console.log(`    ${e}`);
