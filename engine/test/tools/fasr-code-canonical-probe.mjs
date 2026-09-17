// STEP 3b PROBE: does `boardForFasrCode` now stand up ALL8'S OWN BOARD?
//
// `boardForFasrCode` is the function the POC calls to load a coded start (a module's `Zero Line`, and
// any All8 figure's `[FASR]` setup). It used to build through `boardForAlignment`, i.e. `boards[0]` -
// the first board the enumeration happens to produce - which is All8's board for `L1o` by luck (the
// zero-line property holds on indices 0 and 2 of its four) and NOT for `B1c`, the `Zero Box` the next
// module needs.
//
// This measures the function itself against All8's 29 published diagrams, and then measures the two
// things the app depends on: that `L1o` still carries the property its comment claims, and that `B1c`
// now stands up All8's own board rather than an arbitrary rotation of it.
//
// Usage: node engine/test/tools/fasr-code-canonical-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer, setParser, boardForFasrCode, boardFromDiagram, parseAlignmentId,
  FORMATIONS_FOR_LETTER, setupForFormation, rotationBetweenBoards, sequenceFor,
  arrangementFor, CANONICAL_INDEX,
} from '../../dist/index.js';
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
const templateFor = (letter) => (FORMATIONS_FOR_LETTER[letter] ?? []).map((n) => seq.boardForFormation(n)).find(Boolean);
let failures = 0;
const fail = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const ok = (m) => console.log(`  ok    ${m}`);

const corpus = JSON.parse(readFileSync(path.join(root, 'engine', 'test', 'fixtures', 'all8-getouts.json'), 'utf8'));

console.log('=== 1. boardForFasrCode vs All8\'s own diagram, for every published alignment ===');
let checked = 0, agrees = 0, refused = 0;
for (const a of corpus.alignments) {
  const spec = parseAlignmentId(a.id);
  if (!spec) continue;
  const template = templateFor(spec.letter);
  if (!template) continue;
  const fromDiagram = boardFromDiagram(template, spec.letter, spec.arrangement, a.diagram);
  if (!fromDiagram.board) continue;
  const built = boardForFasrCode(a.id, templateFor);
  if (!built.board) { refused++; continue; }
  checked++;
  const rot = rotationBetweenBoards(built.board, fromDiagram.board);
  if (rot === 0) agrees++;
  else fail(`${a.id}: boardForFasrCode is +${rot} from All8's own board`);
}
console.log(`  ${agrees} of ${checked} agree with All8's diagram; ${refused} refused (the documented [P] pair)`);
if (checked && agrees === checked) ok('boardForFasrCode now stands up All8\'s OWN board, not boards[0]');

console.log('\n=== 2. the app\'s two labels, through the function the app calls ===');
{
  // What the app loads for `Zero Line` - the claim in sequencer-ui.ts is facing pairs 1-4 and 2-3.
  const zeroLine = boardForFasrCode('L1o', templateFor);
  const pairsOf = (b) => {
    const ahead = (d) => {
      const hx = Math.cos(d.heading), hy = Math.sin(d.heading);
      let best = null;
      for (const o of b.dancers) {
        if (o.id === d.id) continue;
        const dx = o.x - d.x, dy = o.y - d.y, dist = Math.hypot(dx, dy);
        if (dist < 0.5 || (dx * hx + dy * hy) / dist < 0.99) continue;
        if (!best || dist < best.dist) best = { o, dist };
      }
      return best?.o ?? null;
    };
    const s = new Set();
    for (const d of b.dancers) { const o = ahead(d); if (o) s.add([d.couple, o.couple].sort((x, y) => x - y).join('-')); }
    return [...s].sort().join(' ');
  };
  console.log(`  Zero Line (L1o): identity ${zeroLine.board.dancers.filter((d) => d.couple !== 0).length}/8, sequence ${sequenceFor(zeroLine.board).code}, facing pairs ${pairsOf(zeroLine.board)}`);
  if (pairsOf(zeroLine.board) === '1-4 2-3' && sequenceFor(zeroLine.board).code === 1) ok('Zero Line keeps the property the app\'s comment claims');
  else fail('Zero Line no longer carries the app\'s claimed property');

  // `Zero Box` (B1c), the next module - the one whose index was NOT 0.
  const zeroBox = boardForFasrCode('B1c', templateFor);
  if (!zeroBox.board) fail('Zero Box (B1c) did not build');
  else {
    const setup = setupForFormation('Eight Chain Thru', (n) => seq.boardForFormation(n));
    const sameAsSetup = rotationBetweenBoards(zeroBox.board, setup.board) === 0;
    console.log(`  Zero Box (B1c): identity ${zeroBox.board.dancers.filter((d) => d.couple !== 0).length}/8, arrangement ${arrangementFor(zeroBox.board, 'B').number}, sequence ${sequenceFor(zeroBox.board).code}`);
    console.log(`    is it the SETUP registry's board for the same formation? ${sameAsSetup}`);
    if (sameAsSetup) ok('Zero Box now agrees with the setup registry (the measured choice)');
    else fail('Zero Box disagrees with the setup registry');
  }
}

console.log('\n=== 3. the codes whose index is NOT 0, which is where this change bites ===');
const nonZero = [];
for (const [letter, bySeq] of Object.entries(CANONICAL_INDEX)) {
  for (const [seqNo, byRel] of Object.entries(bySeq)) {
    for (const [rel, index] of Object.entries(byRel)) {
      if (index !== 0) nonZero.push(`${letter}${seqNo}${rel}->${index}`);
    }
  }
}
console.log(`  the canonical index differs from boards[0] for: ${nonZero.join(' ')}`);
console.log('  (these are the codes whose built board CHANGED; every other code builds what it built before)');

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
