// DOES THE ENGINE MODEL ARRANGEMENTS, OR ONLY FORMATIONS?
//
// The question, from a report about `ceder-7046` (which declares `startFormation: "Zero Line"` and
// gets replayed from home): a "zero line" is a specific ORDERLY arrangement - everyone still has their
// original partner and corner, and an Allemande Left is callable - so is that something the engine can
// express, or does it only know formation GEOMETRY?
//
// Two things in this engine are called "arrangement" and they are not the same thing:
//
//   `analyzeFasr` in `fasr.ts`      returns a PROSE SUMMARY: "8 dancers (4 boys, 4 girls), 4 couples".
//                                   It is a description, not a modelled arrangement.
//   `alignment.ts`                  is the real one: All8's arrangement NUMBER 0-5 per formation
//                                   LETTER, transcribed from All8's published tables, plus sequence
//                                   and relationship letters - the `[FASR]` code.
//
// This prints both, for every formation the engine can stand up, so the answer is measured.
//
// Usage: node engine/test/tools/arrangement-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, analyzeFasr, alignmentOf, arrangementFor, letterForFormation, boardForFasrCode } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const genderChar = (g) => (g === 'boy' ? 'B' : g === 'girl' ? 'G' : '?');
const pose = (b) => b.dancers.slice().sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}${genderChar(d.gender)}c${d.couple === 0 ? '-' : d.couple}(${d.x},${d.y})@${Math.round((d.heading * 180) / Math.PI)}`)
  .join(' ');

console.log('=== THE HOME SQUARE, which is the only board that carries identity ===');
const home = seq.boardForFormation('Static Square');
console.log(`  ${pose(home)}`);
console.log(`  analyzeFasr: ${JSON.stringify(analyzeFasr(home, 'Static Square'))}`);
console.log(`  alignmentOf: ${JSON.stringify(alignmentOf(home, 'Static Square'))}`);

console.log('\n=== EVERY NAMED FORMATION THE ENGINE CAN BUILD ===');
console.log('  (couple "-" means UNKNOWN_COUPLE: no partner and no corner can be reported)');
let withIdentity = 0;
let withoutIdentity = 0;
for (const name of seq.listFormations()) {
  const b = seq.boardForFormation(name);
  if (!b || b.dancers.length !== 8) continue;
  const known = b.dancers.filter((d) => d.couple !== 0).length;
  if (known === 8) withIdentity++; else withoutIdentity++;
  if (known !== 8 && name !== 'Normal Lines' && name !== 'Double Pass Thru' && name !== 'Eight Chain Thru' && name !== 'Ocean Waves' && name !== 'Columns') continue;
  const f = analyzeFasr(b, name);
  const a = alignmentOf(b, name);
  const letter = letterForFormation(name);
  console.log(`  ${name.padEnd(26)} letter=${String(letter).padEnd(5)} identity=${known}/8  seq=${f.sequence}`);
  console.log(`      ${pose(b)}`);
  console.log(`      fasr prose: ${f.arrangement}`);
  console.log(`      align code: ${a ? JSON.stringify(a) : '(none)'}`);
}
console.log(`\n  ${withIdentity} named formation(s) carry FULL identity, ${withoutIdentity} carry NONE.`);

console.log('\n=== THE REAL ARRANGEMENT MACHINERY (alignment.ts) ===');
console.log('  arrangementFor(board, letter) reads All8\'s arrangement NUMBER 0-5 off a board:');
for (const [name, letter] of [['Normal Lines', 'L'], ['Double Pass Thru', 'P'], ['Eight Chain Thru', 'B'], ['Ocean Waves', 'W']]) {
  const b = seq.boardForFormation(name);
  if (!b) continue;
  const r = arrangementFor(b, letter);
  console.log(`    [${letter}] ${name.padEnd(20)} -> arrangement ${r.number}  (${r.reason ?? 'ok'})`);
}

console.log('\n=== WHICH [L] CODE IS A "ZERO LINE"? ===');
console.log('  A zero line is a LINE formation whose FASR is the HOME one: everyone still has their');
console.log('  original partner and corner and an Allemande Left is callable - i.e. sequence IN and each');
console.log('  dancer FACING its corner. Measured directly, per candidate code:');

// The home relation of couple c to couple d, by the +0/+1/+2/+3 promenade cycle the engine uses:
//   +0 partner | +1 right-hand girl | +2 opposite girl | +3 corner
const relationClass = (from, to) => ['partner', 'right-hand', 'opposite', 'corner'][((to - from) % 4 + 4) % 4];

/** The dancer standing directly in front of `d`, or null. */
function facedBy(board, d) {
  const hx = Math.cos(d.heading);
  const hy = Math.sin(d.heading);
  let best = null;
  for (const o of board.dancers) {
    if (o.id === d.id) continue;
    const dx = o.x - d.x;
    const dy = o.y - d.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) continue;
    if ((dx * hx + dy * hy) / dist < 0.99) continue;  // must be straight ahead
    if (!best || dist < best.dist) best = { o, dist };
  }
  return best?.o ?? null;
}

for (const code of ['L1p', 'L1c', 'L1r', 'L1o', 'L2p', 'L2c', 'L2r', 'L2o', 'L3p', 'L4p', '5L1p', '5L1c']) {
  const r = boardForFasrCode(code, (l) => (l === 'L' ? seq.boardForFormation('Normal Lines') : null));
  if (!r.board) { console.log(`  ${code.padEnd(6)} REFUSED`); continue; }
  const b = r.board;
  const f = analyzeFasr(b, null);
  // Every dancer faces a dancer OF THE SAME SET, so classify what it faces.
  const classes = b.dancers.map((d) => {
    const o = facedBy(b, d);
    if (!o) return 'nothing';
    if (d.couple === 0 || o.couple === 0) return '?';
    return relationClass(d.couple, o.couple);
  });
  const tally = {};
  for (const c of classes) tally[c] = (tally[c] ?? 0) + 1;
  // Partners ADJACENT (in the same line) is the other half of "original partner and corner".
  const partnersAdjacent = b.dancers.every((d) => {
    if (d.couple === 0) return false;
    const p = b.dancers.find((o) => o.couple === d.couple && o.id !== d.id);
    return p ? Math.abs(Math.hypot(p.x - d.x, p.y - d.y) - 2) < 0.35 : false;
  });
  const zero = f.sequence === 'in' && tally.corner === 8;
  console.log(`  ${code.padEnd(6)} seq=${String(f.sequence).padEnd(7)} faces: ${JSON.stringify(tally).padEnd(30)} partners adjacent: ${partnersAdjacent}${zero ? '   <-- ZERO LINE' : ''}`);
}

console.log('\n=== boardForFasrCode, the builder behind all of the above ===');
console.log('  (the format is [arrangement]LETTER[sequence][relationship]; an omitted arrangement is 0)');
for (const code of ['L1p', 'L1c', 'L2p', 'L2c', 'L1r', 'L1o', '5L1p', '5L1c', 'P1c', 'B1p']) {
  const r = boardForFasrCode(code, (l) => {
    const n = { B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', P: 'Double Pass Thru', F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH' }[l];
    return n ? seq.boardForFormation(n) : null;
  });
  if (!r.board) { console.log(`    ${code.padEnd(6)} REFUSED - ${r.reason}`); continue; }
  const known = r.board.dancers.filter((d) => d.couple !== 0).length;
  const f = analyzeFasr(r.board, null);
  console.log(`    ${code.padEnd(6)} ok  identity=${known}/8  seq=${f.sequence}`);
  console.log(`           ${pose(r.board)}`);
}
