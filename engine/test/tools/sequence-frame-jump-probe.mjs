// ceder-7046, FRAME BY FRAME: where does a dancer move further in one frame than the frame's normal
// motion? The POC advances the playhead by dt/MS_PER_BEAT and draws `evaluateSequence` at each step, so
// a discontinuity the final instant does not show can still be visible one frame earlier.
//
// Usage: node engine/test/tools/sequence-frame-jump-probe.mjs [moduleFile]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};
const rel = process.argv[2] ?? 'modules/zero_line/static_set/7046.json';
const mod = JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
const start = boardForFasrCode('L1o', templateForLetter).board;
const flat = seq.flatten(mod.steps);
const total = seq.sequenceBeats(flat, start);

// which call is playing at a beat, and the beats each call occupies
const bounds = [];
let acc = 0;
for (const s of flat) {
  const b = seq.sequenceBeats([s], undefined) ; void b;
  const nb = seq.sequenceBeats(flat.slice(0, bounds.length + 1), start) - acc;
  bounds.push({ call: typeof s === 'string' ? s : s.call, from: acc, to: acc + nb });
  acc += nb;
}
const callAt = (beat) => bounds.find((b) => beat >= b.from && beat < b.to)?.call ?? '(none)';

const N = 1200;
const samples = [];
for (let i = 0; i <= N; i++) samples.push(seq.evaluateSequence(flat, (total * i) / N, start).board);
let worst = { d: 0 };
const jumps = [];
for (let i = 1; i < samples.length; i++) {
  for (const d of samples[i].dancers) {
    const p = samples[i - 1].dancers.find((x) => x.id === d.id);
    const dist = p ? Math.hypot(p.x - d.x, p.y - d.y) : Infinity;
    if (dist > worst.d) worst = { d: dist, i, id: d.id, beat: (total * i) / N };
  }
}
// a frame's TYPICAL motion, for scale
const motions = [];
for (let i = 1; i < samples.length; i++) {
  let m = 0;
  for (const d of samples[i].dancers) {
    const p = samples[i - 1].dancers.find((x) => x.id === d.id);
    if (p) m = Math.max(m, Math.hypot(p.x - d.x, p.y - d.y));
  }
  motions.push(m);
}
motions.sort((a, b) => a - b);
const median = motions[Math.floor(motions.length / 2)];
console.log(`${rel}  steps: ${mod.steps.join(' | ')}`);
console.log(`total ${total} beats, sampled ${N} frames; median per-frame max move ${median.toFixed(4)} units`);
console.log(`WORST per-frame move: ${worst.d.toFixed(3)} units by #${worst.id} at beat ${worst.beat.toFixed(2)} (${callAt(worst.beat)})  = ${(worst.d / Math.max(median, 1e-9)).toFixed(0)}x the median frame`);
// the top 6 distinct jumps, with the call they fall in
const seen = new Set();
for (let i = 1; i < samples.length; i++) {
  let m = 0, who = 0;
  for (const d of samples[i].dancers) {
    const p = samples[i - 1].dancers.find((x) => x.id === d.id);
    const dist = p ? Math.hypot(p.x - d.x, p.y - d.y) : 0;
    if (dist > m) { m = dist; who = d.id; }
  }
  const beat = (total * i) / N;
  const key = callAt(beat);
  if (m > 0.25 && !seen.has(key)) {
    seen.add(key);
    jumps.push(`  beat ${beat.toFixed(2)}  ${key.padEnd(26)} #${who} moved ${m.toFixed(3)} units in one frame`);
  }
}
console.log('calls with a >0.25-unit single-frame move:');
for (const j of jumps) console.log(j);
console.log('\nthe last 4 frames:');
for (let i = samples.length - 4; i < samples.length; i++) {
  const b = samples[i];
  console.log(`  beat ${((total * i) / N).toFixed(3)}  ${[...b.dancers].sort((x, y) => x.id - y.id).map((d) => `#${d.id}(${d.x.toFixed(1)},${d.y.toFixed(1)})`).join(' ')}`);
}
