// THE LAST FRAME FLIPS THE DANCERS WHEN A PROMENADE IS APPLIED TO THE END OF A MODULE.
//
// Reported (POC): "The Module works fine, but if I apply a Promenade to the end, this is when the
// Dancers switch position in the final static square. They finish in a non standard arrangement for
// Static Square, but flip to setup arrangement for Static Square on the last frame (or its applied
// after the animation finishes?)."
//
// `sequence-dancer-order-probe.mjs` already cleared 7046 WITHOUT the appended call: array order,
// per-id positions and the couple field all agree between the LIVE replay (`applyStep`) and the WALK
// (`evaluateSequence`). The frame loop draws the WALK board, and the POC's dancer views are
// POSITIONAL (`renderBoard` builds `poses` in `board.dancers` order and hands pose i to view i), so a
// board that carries the same eight dancers in a different ARRAY ORDER scrambles the set visually
// while every position in it is unchanged - and the drawn set then reads as the arrangement of
// whatever formation the re-ordering came from, which is exactly "the formation/arrangement sequence".
//
// This probe appends the promenade the POC offers and measures, at the last frames and on both paths:
//   - the array order (by id) and the pose of each ARRAY INDEX (what a positional view actually draws)
//   - the per-id positions (the geometry, which the first report already showed to be smooth)
//   - the formation the end board classifies as, and whether it is the canonical `Static Square` setup
//
// Usage: node engine/test/tools/sequence-promenade-flip-probe.mjs

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

const order = (b) => b.dancers.map((d) => d.id).join(',');
/** What a POSITIONAL view draws: array index -> the dancer standing there. */
const byIndex = (b) => b.dancers.map((d, i) => `${i}:#${d.id}@(${d.x.toFixed(2)},${d.y.toFixed(2)},${Math.round((d.heading * 180) / Math.PI)})`).join(' ');
const byId = (b) => [...b.dancers].sort((a, c) => a.id - c.id)
  .map((d) => `#${d.id}@(${d.x.toFixed(2)},${d.y.toFixed(2)},${Math.round((d.heading * 180) / Math.PI)})`).join(' ');
const sameById = (a, b) => byId(a) === byId(b);

const mod = JSON.parse(readFileSync(path.join(root, 'modules', 'zero_line', 'static_set', '7046.json'), 'utf8'));
const start = boardForFasrCode('L1o', templateForLetter).board;
const base = seq.flatten(mod.steps);
seq.setBoard(start);
for (const h of base) seq.applyStep(h);
const endBoard = { dancers: seq.board.dancers.map((d) => ({ ...d })) };
console.log(`module ${mod.name}  steps: ${mod.steps.join(' | ')}`);
console.log(`end of the module: [${seq.knownFormation(endBoard)}]  order ${order(endBoard)}`);
console.log(`  ${byId(endBoard)}`);

// Which promenade the POC's call picker would offer from that end board.
const legal = seq.legalNext();
const promenades = legal.filter((n) => /promenade/i.test(n)).sort((a, b) => a.localeCompare(b));
console.log(`\nthe call picker offers ${legal.length} calls from there, ${promenades.length} promenade-named:`);
for (const n of promenades) console.log(`  - ${n}`);

const canonical = seq.boardForFormation('Static Square');
console.log(`\ncanonical Static Square setup: order ${order(canonical)}`);
console.log(`  ${byId(canonical)}`);

for (const name of promenades) {
  const flat = seq.flatten([...mod.steps, name]);
  const total = seq.sequenceBeats(flat, start);
  const stop = seq.sequenceStop(flat, start);
  console.log(`\n===== appended "${name}"  (${total.toFixed(2)} beats${stop ? `, stops at "${stop.call}"` : ''}) =====`);

  // The WALK path, exactly what the frame loop draws, at the last frames.
  const frames = [total - 1, total - 0.25, total - 0.01, total - 1e-6, total];
  let prev = null;
  for (const t of frames) {
    const b = seq.evaluateSequence(flat, t, start).board;
    const moved = prev ? !sameById(prev, b) : false;
    console.log(`  walk t=${t.toFixed(4).padStart(8)}  [${seq.knownFormation(b)}]  order ${order(b)}${moved ? '   <- per-id geometry CHANGED' : ''}`);
    console.log(`        byIndex ${byIndex(b)}`);
    prev = b;
  }
  const walkEnd = seq.evaluateSequence(flat, total, start).board;
  const walkPre = seq.evaluateSequence(flat, total - 1e-6, start).board;

  // The LIVE path, what the sequencer's own board is after `openSequence` + append.
  seq.setBoard(start);
  let refused = 0;
  for (const h of flat) { const r = seq.applyStep(h); if (!r.legal) refused++; }
  const liveEnd = { dancers: seq.board.dancers.map((d) => ({ ...d })) };

  console.log(`  walk end : order ${order(walkEnd)}   ${byId(walkEnd)}`);
  console.log(`  live end : order ${order(liveEnd)}   ${byId(liveEnd)}${refused ? `   (${refused} refused)` : ''}`);
  console.log(`  same positions by id: ${sameById(walkEnd, liveEnd) ? 'yes' : 'NO'}`);
  console.log(`  array ORDER differs between the last two frames: ${order(walkPre) !== order(walkEnd) ? 'YES  <- positional views scramble here' : 'no'}`);
  console.log(`  array ORDER differs live vs walk: ${order(liveEnd) !== order(walkEnd) ? 'YES' : 'no'}`);
  const endMatchesCanonical = sameById(walkEnd, canonical);
  console.log(`  the end board IS the canonical Static Square setup: ${endMatchesCanonical ? 'YES' : 'no'}`);
  console.log(`  array ORDER of the end equals canonical: ${order(walkEnd) === order(canonical) ? 'YES  <- the drawn set reads as the setup arrangement' : 'no'}`);
  // Index-by-index, which is what actually moves on screen when nothing is re-ordered.
  const idxChange = walkPre.dancers
    .map((d, i) => (walkEnd.dancers[i] && (walkEnd.dancers[i].id !== d.id || walkEnd.dancers[i].x !== d.x || walkEnd.dancers[i].y !== d.y || walkEnd.dancers[i].heading !== d.heading) ? `#${d.id}->#${walkEnd.dancers[i].id}` : null))
    .filter(Boolean);
  console.log(`  views that change dancer or pose on the last frame: ${idxChange.length ? idxChange.join(' ') : 'none'}`);
}
