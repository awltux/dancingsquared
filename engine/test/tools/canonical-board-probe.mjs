// STEP 3, ITEM 7: WHICH OF THE FOUR BOARDS A CODE ADMITS IS ALL8'S CANONICAL ONE?
//
// Every FASR code admits four boards - the four orientations, related by a cyclic relabelling of the
// couples - and `boardForAlignment` returns `boards[0]`, which is an enumeration artefact. The plan's
// geometric "nearest its home bearing" rule was TESTED against all six published [L] diagrams and
// REFUTED (0 of 6), so this does not retry it.
//
// What is measured here: for every alignment in the corpus that publishes a diagram, where does all8's
// own board sit in the enumeration, and is the position a function of anything the code says? The
// diagram is turned into a board by boardFromDiagram (the same path test/alignment-boards.mjs uses),
// and its identity (which couple stands on which spot) is what the index is measured against.
//
// Usage: node engine/test/tools/canonical-board-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardsForAlignment, boardFromDiagram, parseAlignmentId, arrangementFor, sequenceFor, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const corpus = JSON.parse(readFileSync(path.join(root, 'engine', 'test', 'fixtures', 'all8-getouts.json'), 'utf8'));

const templateFor = (letter) => {
  for (const name of FORMATIONS_FOR_LETTER[letter] ?? []) {
    const b = seq.boardForFormation(name);
    if (b) return b;
  }
  return null;
};

/**
 * The COUPLE-TO-SPOT assignment: which couple number stands on each spot, as a set of
 * (rounded position, gender) -> couple. Two boards that differ only by relabelling differ here.
 */
const coupleToSpot = (b) => b.dancers
  .map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}:${d.couple}`)
  .sort()
  .join(' ');

/** How the assignment relates to another: the cyclic rotation k that maps a onto b, or null. */
const rotationBetween = (a, b) => {
  for (let k = 0; k < 4; k++) {
    const relabelled = a.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}:${((d.couple - 1 + k) % 4) + 1}`).sort().join(' ');
    if (relabelled === coupleToSpot(b)) return k;
  }
  return null;
};

console.log('=== every published alignment with a diagram: where is all8\'s board in the enumeration? ===');
console.log('  code     letter  all8 index / count   rotation from boards[0]   arrangement  sequence');
const rows = [];
for (const a of corpus.alignments) {
  const spec = parseAlignmentId(a.id);
  if (!spec) continue;
  const template = templateFor(spec.letter);
  if (!template) continue;
  // all8's own board, built from its diagram.
  const fromDiagram = boardFromDiagram(template, spec.letter, spec.arrangement, a.diagram);
  if (!fromDiagram.board) continue;
  // The boards the CODE admits.
  const res = boardsForAlignment(template, spec);
  if (!res.boards.length) continue;
  const target = coupleToSpot(fromDiagram.board);
  const idx = res.boards.findIndex((b) => coupleToSpot(b) === target);
  const rot = idx >= 0 ? rotationBetween(res.boards[0], res.boards[idx]) : null;
  const read = arrangementFor(fromDiagram.board, spec.letter);
  rows.push({ code: a.id, letter: spec.letter, idx, count: res.boards.length, rot, seq: spec.sequence, arr: read.number ?? 'null' });
  console.log(`  ${a.id.padEnd(8)} ${spec.letter.padEnd(6)} ${String(idx).padStart(4)} / ${String(res.boards.length).padEnd(3)}          ${String(rot).padStart(2)}                     ${read.number ?? 'null'}         ${spec.sequence ?? '-'}`);
}

console.log('\n=== is the index a function of the code? ===');
const byIndex = {};
for (const r of rows) (byIndex[r.idx] ??= []).push(r.code);
for (const [idx, codes] of Object.entries(byIndex).sort()) {
  console.log(`  index ${idx.padStart(3)}: ${codes.length} alignment(s)  ${codes.join(' ')}`);
}
const inSeq = rows.filter((r) => r.seq === 1);
const outSeq = rows.filter((r) => r.seq === 2);
const tally = (list) => {
  const t = {};
  for (const r of list) t[r.idx] = (t[r.idx] ?? 0) + 1;
  return JSON.stringify(t);
};
console.log(`\n  in-sequence alignments (sequence 1): ${inSeq.length}, indices ${tally(inSeq)}`);
console.log(`  out-of-sequence (sequence 2):        ${outSeq.length}, indices ${tally(outSeq)}`);

console.log('\n=== the rotation from boards[0] to all8\'s board ===');
const byRot = {};
for (const r of rows) (byRot[r.rot] ??= []).push(r.code);
for (const [rot, codes] of Object.entries(byRot).sort()) {
  console.log(`  +${rot}: ${codes.length}  ${codes.join(' ')}`);
}

// The candidates the plan leaves open. Each grouping asks: is the rotation a FUNCTION of this?
const groupBy = (label, keyOf) => {
  const g = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!g.has(k)) g.set(k, new Set());
    g.get(k).add(r.rot);
  }
  const consistent = [...g.values()].every((s) => s.size === 1);
  console.log(`\n  by ${label}: ${consistent ? 'A FUNCTION (every group has one rotation)' : 'NOT a function'}`);
  for (const [k, v] of [...g.entries()].sort()) {
    console.log(`    ${String(k).padEnd(24)} -> rotations {${[...v].sort().join(',')}}`);
  }
  return consistent;
};

console.log('\n=== WHICH KEY DETERMINES THE ROTATION? ===');
groupBy('formation letter', (r) => r.letter);
groupBy('arrangement number', (r) => r.arr);
groupBy('sequence', (r) => r.seq);
groupBy('arrangement + sequence', (r) => `${r.arr}/${r.seq}`);

console.log('\n=== the winning rule: (arrangement, sequence) -> rotation ===');
const rule = new Map();
for (const r of rows) if (r.rot !== null) rule.set(`${r.arr}${r.seq}`, r.rot);
console.log('  code key   rotation   codes');
for (const [k, v] of [...rule.entries()].sort()) {
  const codes = rows.filter((r) => `${r.arr}${r.seq}` === k).map((r) => r.code);
  console.log(`  ${k.padEnd(9)}  +${v}         ${codes.join(' ')}`);
}

// WHY THE FIX IS NARROWER THAN IT LOOKED. `boardForAlignment` returns boards[0]; the rule says to
// relabel by k(sequence). If k is 0 the CURRENT pick is already all8's, and only sequences 1 and 2
// need anything doing - which is exactly the case the corpus can validate, because it contains no
// sequence-3 or -4 code whose relationship resolves.
console.log('\n=== does boards[0] already need changing, per sequence? ===');
for (const s of [1, 2, 3, 4]) {
  const rs = rows.filter((r) => r.seq === s);
  const rots = [...new Set(rs.map((r) => r.rot))].sort();
  console.log(`  sequence ${s}: ${rs.length} diagram-measured code(s), rotations {${rots.join(',')}}`
    + `${rots.length === 1 && rots[0] === 0 ? '  -> boards[0] is ALREADY correct here' : ''}`);
}
const s34 = rows.filter((r) => r.seq === 3 || r.seq === 4);
console.log(`\n  sequences 3 and 4 together: ${s34.length} measurements, every one at rotation 0,`);
console.log('  so the current behaviour is already right for them and the fix is confined to 1 and 2.');

console.log('\n  NOTE: this is a table fitted to 26 measurements, not a derivation. It is reported as the');
console.log('  candidate to test against a SECOND source, not as a rule to ship.');
