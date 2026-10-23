// DOES THE CONVERGENCE RESIDUAL COLLIDE ANYONE? Corpus-wide, before/after.
//
// `evaluateSequence` now corrects every branch by the residual
// `pose(t) = authored(t) + (appliedEnd - authoredEnd) * t`, so a call whose authored path used to end
// 6.32 units away from the board it produced is now DRAGGED there proportionally over the call. That
// is a real change to the path, so the question the correction has to answer is not "does the last
// frame land right" but "does the walk still look like a dance".
//
// The `walkthrough-survey.mjs` sweep answers this for one call from each named formation; this answers
// it for the REAL module corpus, which is where the largest residuals are. For every module: sample
// the animation every half beat, record the closest pair of dancers at any instant and the largest
// single-sample move of any dancer. Both numbers are compared against the pre-fix build:
//   - the closest pair must not get WORSE (a collision is two dancers inside 1.0);
//   - the largest single-sample move must not get worse (the correction is linear in t, so it adds a
//     constant velocity to the authored path - a big residual shows up as a fast glide).
//
// Usage: node engine/test/tools/sequence-anim-collision-scan.mjs

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

const closest = (b) => {
  const ds = b.dancers;
  let m = Infinity;
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) m = Math.min(m, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  return m;
};

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

const STEP = 0.5;
let modules = 0, sampled = 0;
let worstPair = Infinity, worstPairAt = '', mostMove = 0, mostMoveAt = '';
const crowded = [];   // modules where two dancers come inside 1.0

for (const file of walkJson(path.join(root, 'modules'))) {
  let mod;
  try { mod = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!Array.isArray(mod.steps) || !mod.steps.length) continue;
  const label = mod.startFormation?.trim().toLowerCase();
  const code = START[label];
  const start = code === null
    ? seq.boardForFormation('Static Square')
    : boardForFasrCode(code ?? '', templateForLetter).board;
  const flat = seq.flatten(mod.steps);
  const beats = seq.sequenceBeats(flat, start);
  if (beats <= 0) continue;
  modules++;

  let prev = null;
  let modWorst = Infinity;
  for (let b = 0; b <= beats + 1e-9; b += STEP) {
    const board = seq.evaluateSequence(flat, Math.min(b, beats), start).board;
    sampled++;
    const c = closest(board);
    if (c < modWorst) modWorst = c;
    if (c < worstPair) { worstPair = c; worstPairAt = `${path.relative(root, file).replace(/\\/g, '/')} @${b.toFixed(1)}/${beats.toFixed(1)}b`; }
    if (prev) {
      const byId = new Map(board.dancers.map((d) => [d.id, d]));
      for (const d of prev.dancers) {
        const e = byId.get(d.id);
        if (!e) continue;
        const m = Math.hypot(e.x - d.x, e.y - d.y);
        if (m > mostMove) { mostMove = m; mostMoveAt = `${path.relative(root, file).replace(/\\/g, '/')} @${b.toFixed(1)}b`; }
      }
    }
    prev = board;
  }
  if (modWorst < 1.0) crowded.push({ file: path.relative(root, file).replace(/\\/g, '/'), gap: modWorst });
}

console.log(`${modules} module(s) with beats; ${sampled} animation samples (every ${STEP} beat)`);
console.log(`  closest pair of dancers at any instant: ${worstPair.toFixed(3)}   (${worstPairAt})`);
console.log(`  largest single-sample move of a dancer: ${mostMove.toFixed(3)} units   (${mostMoveAt})`);
console.log(`  modules where two dancers come inside 1.0: ${crowded.length}`);
for (const c of crowded.sort((a, b) => a.gap - b.gap)) console.log(`      ${c.gap.toFixed(3)}  ${c.file}`);
