// TIER: none — one-shot diagnostic; nothing runs it. Recorded: engine/test/tools/README.md.
// WHAT DOES `L1o` ACTUALLY STAND UP? ceder-7046's start.
//
// Reported: "When I apply ceder-7046 module, it starts with a very odd arrangement with Normal lines
// but all the girls at one end and the boys at the other."
//
// `L1o` is the code the app uses for the corpus label `Zero Line`, and every one of the four boards it
// admits is on the same lattice with the same facings - they differ by which COUPLE stands where, which
// is also a difference in which SPOT holds a boy and which a girl. `CANONICAL_INDEX.L[1].o = 0` picks
// one of them, and All8 publishes NO diagram for an `o` code (its drawings are L1p/L2p/L3c/L4r and the
// 5L variants), so that pick is a recorded choice rather than a measurement. This prints all four
// candidates with genders, couples and facings so the odd one can be named.
//
// Usage: node engine/test/tools/zero-line-boards-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, boardsForAlignment, parseAlignmentId, FORMATIONS_FOR_LETTER, FORMATIONS_FOR_LETTER as FFL } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

void FFL;
setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
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

/** The line as a caller reads it: positions left to right, each as gender/couple. */
const read = (b) => {
  const ys = [...new Set(b.dancers.map((d) => +d.y.toFixed(3)))].sort((a, c) => c - a);
  const lines = [];
  for (const y of ys) {
    const row = b.dancers.filter((d) => Math.abs(d.y - y) < 1e-6).sort((a, c) => a.x - c.x);
    lines.push(row.map((d) => `${d.gender === 'boy' ? 'B' : 'g'}${d.couple}`).join(' '));
  }
  return lines.join('   /   ');
};
/** The gender reading a caller would describe: alternating, or all one end? */
const genderShape = (b) => {
  const ys = [...new Set(b.dancers.map((d) => +d.y.toFixed(3)))].sort((a, c) => c - a);
  return ys.map((y) => b.dancers.filter((d) => Math.abs(d.y - y) < 1e-6).sort((a, c) => a.x - c.x)
    .map((d) => (d.gender === 'boy' ? 'B' : 'g')).join('')).join(' / ');
};

const template = templateForLetter('L');
const spec = parseAlignmentId('L1o');
const all = boardsForAlignment(template, spec);
console.log(`[L1o] admits ${all.boards.length} board(s)`);
all.boards.forEach((b, i) => {
  console.log(`  candidate ${i}: ${genderShape(b).padEnd(14)}  ${read(b)}`);
});
const chosen = boardForFasrCode('L1o', templateForLetter);
console.log(`\nboardForFasrCode('L1o') chose: ${genderShape(chosen.board)}   ${read(chosen.board)}`);

console.log('\nthe other L codes, for contrast (All8 publishes diagrams for p/c/r):');
for (const code of ['L1p', 'L2p', 'L3c', 'L4r', '1L1p', 'L1o']) {
  const r = boardForFasrCode(code, templateForLetter);
  if (!r.board) { console.log(`  ${code.padEnd(6)} refused: ${r.reason}`); continue; }
  console.log(`  ${code.padEnd(6)} ${genderShape(r.board).padEnd(14)}  ${read(r.board)}`);
}

console.log('\nthe engine templates the letters are built from:');
for (const name of ['Normal Lines', 'Normal Lines Compact']) {
  const b = seq.boardForFormation(name);
  console.log(`  ${name.padEnd(20)} ${genderShape(b).padEnd(14)}  ${read(b)}`);
}
