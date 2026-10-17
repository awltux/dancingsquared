// IS THE LAST-FRAME JUMP THE SNAP? Turn the snap OFF and see whether the jump survives.
//
// `setSnapMaxError(0)` disables `snapBoard` outright (`matcher.ts`: `if (snapMaxError <= 0) return
// board`), so this isolates it: if the jump is the difference between the snapped stored board and the
// unsnapped authored path, it must disappear with the snap off. If it survives, the mismatch is
// produced somewhere else in the apply path and the SNAP is not the owner.
//
// Usage: node engine/test/tools/snap-source-probe.mjs [module ...]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'assets');
const makeSeq = () => new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateForLetter = (seq) => (l) => {
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
const files = args.length
  ? args.map((a) => path.join(root, a))
  : walkJson(path.join(root, 'modules'));

const jump = (seq, mod) => {
  const label = mod.startFormation?.trim().toLowerCase();
  const code = START[label];
  const start = code === null
    ? seq.boardForFormation('Static Square')
    : boardForFasrCode(code ?? '', templateForLetter(seq)).board;
  const flat = seq.flatten(mod.steps);
  const beats = seq.sequenceBeats(flat, start);
  if (beats <= 0) return null;
  const pre = seq.evaluateSequence(flat, beats - 1e-6, start).board;
  const end = seq.evaluateSequence(flat, beats, start).board;
  const byId = new Map(end.dancers.map((d) => [d.id, d]));
  let worst = 0;
  for (const d of pre.dancers) {
    const e = byId.get(d.id);
    if (e) worst = Math.max(worst, Math.hypot(e.x - d.x, e.y - d.y));
  }
  const last = flat[flat.length - 1];
  return { worst, call: typeof last === 'string' ? last : last.call, beats };
};

const on = makeSeq();
const off = makeSeq();
off.setSnapMaxError(0);

let n = 0, stillOn = 0, stillOff = 0, fixedByOff = 0, worseOff = 0;
for (const file of files) {
  let mod;
  try { mod = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!Array.isArray(mod.steps) || !mod.steps.length) continue;
  const a = jump(on, mod);
  const b = jump(off, mod);
  if (!a || a.worst > 0.05) n++;
  if (a && a.worst > 0.05) {
    stillOn++;
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (b.worst <= 0.05) { fixedByOff++; if (fixedByOff <= 8) console.log(`  SNAP IS THE OWNER  ${rel}  last "${a.call}"  ${a.worst.toFixed(2)} -> ${b.worst.toFixed(2)} with the snap off`); }
    else { stillOff++; if (stillOff <= 12) console.log(`  survives the snap: ${rel}  last "${a.call}"  ${a.worst.toFixed(2)} -> ${b.worst.toFixed(2)}`); }
    if (b.worst > a.worst + 0.01) worseOff++;
  }
}
console.log(`\n${files.length} module(s) checked; last-frame jump > 0.05 with the snap ON: ${stillOn}`);
console.log(`  ... FIXED by turning the snap off: ${fixedByOff}`);
console.log(`  ... still jumping with the snap OFF: ${stillOff}   (bigger off: ${worseOff})`);
