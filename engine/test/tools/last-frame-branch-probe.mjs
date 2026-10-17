// WHICH BRANCH DID EACH SIDE TAKE? The animator and the applicator disagree on 83 of the 86
// last-frame jumps, and the snap is not the owner (`snap-source-probe.mjs`). `evaluateCallAt` picks
// its branch from `findMatchingVariant` alone; `applyToBoardInner` picks it from the same match PLUS a
// parallel reading and, in 'probabilistic' mode, an error-weighted choice between them. This prints,
// for the last call of each witness module:
//   - whether the animator finds a WHOLE-board match (it animates the authored path if so),
//   - whether the apply reports a PARALLEL grouping (it stored the per-group result if so),
//   - whether the two boards then agree, and by how much.
//
// Usage: node engine/test/tools/last-frame-branch-probe.mjs [module ...]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { DEFAULT_MATCH_MAX } from '../../dist/sequencer/constants.js';
import { findCodedMove } from '../../dist/sequencer/coded-moves.js';
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
const START = { 'static square': null, 'squared set': null, 'zero line': 'L1o', 'zero box': 'B1c' };

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const files = args.length ? args.map((a) => path.join(root, a)) : walkJson(path.join(root, 'modules'));
const worst = [];
let wholeAnim = 0, parallelStored = 0, both = 0, neither = 0, offenders = 0;

for (const file of files) {
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
  const pre = seq.evaluateSequence(flat, beats - 1e-6, start).board;
  const end = seq.evaluateSequence(flat, beats, start).board;
  const byId = new Map(end.dancers.map((d) => [d.id, d]));
  let gap = 0;
  for (const d of pre.dancers) { const e = byId.get(d.id); if (e) gap = Math.max(gap, Math.hypot(e.x - d.x, e.y - d.y)); }
  if (gap <= 0.05) continue;
  offenders++;

  // The board the last call runs on, and the call itself.
  seq.setBoard(start);
  let before = start;
  for (let i = 0; i < flat.length - 1; i++) before = seq.applyStep(flat[i]).board ?? before;
  const last = flat[flat.length - 1];
  const call = typeof last === 'string' ? last : last.call;
  const coded = findCodedMove(call);
  const tol = DEFAULT_MATCH_MAX;
  const whole = coded ? null : seq.findMatchingVariant(before, call, tol);
  const res = seq.applyToBoard(before, call);
  const parallel = !!res.parallel;
  if (whole) wholeAnim++;
  if (parallel) parallelStored++;
  if (whole && parallel) both++;
  if (!whole && !parallel && !coded) neither++;

  const rel = path.relative(root, file).replace(/\\/g, '/');
  worst.push({ rel, call, gap, whole: !!whole, parallel, coded: !!coded, legal: res.legal });
}

worst.sort((a, b) => b.gap - a.gap);
console.log(`${files.length} module(s); last-frame jump > 0.05 in ${offenders}`);
console.log(`  animator animates the WHOLE-board authored path: ${wholeAnim}`);
console.log(`  the apply stored a PARALLEL per-group result:    ${parallelStored}`);
console.log(`  BOTH (the disagreement this probe is for):       ${both}`);
console.log(`  neither (coded, or a plain refusal):             ${neither}`);
console.log('\n  worst 14:');
for (const w of worst.slice(0, 14)) {
  console.log(`    ${w.gap.toFixed(2)}  ${w.coded ? 'CODED   ' : w.whole ? 'whole   ' : 'no-match'} ${w.parallel ? 'PARALLEL-stored' : 'no-parallel    '}  "${w.call}"  ${w.rel}`);
}
