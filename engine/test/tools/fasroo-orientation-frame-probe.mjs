// THE ORIENTATION CONSTRUCTION, part 2: read it in All8's OWN frame.
//
// Part 1 found the two candidate rules disagree and neither reproduces All8's worked `[0P1cH+]`:
//
//   - the engine compares the reference boy's CURRENT bearing to his HOME bearing about the centres
//     (161.6 deg vs 251.6 deg for `[0P1c]`), and for a LINE those two positions are not related by a
//     rotation at all, so the raw angle comes out a non-multiple of 90 (-37.9 deg for `[L1p]`) and the
//     quantisation picks arbitrarily;
//   - comparing nearest compass SIDES instead fixes the precision, and gives H for All8's canonical
//     `[L1p]`, but still says R for `[0P1c]` where All8 says H.
//
// The missing piece is the FRAME. All8 states the letters in its own drawing frame - the arrangement
// TABLE, whose facing layout is what the `[P]` orientation diagram is (rows `vv vv ^^ ^^`, couple 1 at
// the bottom, facing north, which is his home). The engine's TEMPLATE for the same formation is that
// picture rotated 90 degrees, so a board built from an All8 diagram sits in the template frame and its
// bearing-to-home is a quarter turn off. `readLayout` already computes that frame change.
//
// So the candidate rule is: read the reference boy's position IN THE FORMATION'S OWN TABLE FRAME, and
// take the 90-degree step from his home side to the side he is on.
//
// Usage: node engine/test/tools/fasroo-orientation-frame-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer,
  setParser,
  boardFromDiagram,
  boardsForAlignment,
  relationshipStateOf,
  fasrooOf,
  relabelCouples,
  readLayout,
  FORMATIONS_FOR_LETTER,
  CANONICAL_INDEX,
} from '../../dist/index.js';
import { HOME_DANCERS } from '../../dist/sequencer/identity.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateFor = (letter) => {
  for (const n of FORMATIONS_FOR_LETTER[letter] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};
const HOME_OF = new Map(HOME_DANCERS.map((d) => [d.id, d]));

/** Which compass side a home POSITION lies on - the home square is axis-aligned, so this is exact. */
const homeSide = (id) => {
  const h = HOME_OF.get(id);
  if (!h) return null;
  if (Math.abs(h.y) > Math.abs(h.x)) return h.y > 0 ? 90 : 270; // north / south
  return h.x > 0 ? 0 : 180; // east / west
};

/**
 * The candidate: the reference boy's cell in the formation's own TABLE frame, as a compass side, and
 * the clockwise 90-degree step from his home side to it.
 */
function orientationInTableFrame(board, letter, refBoyId) {
  const layout = readLayout(board, letter);
  if (!layout) return { reason: `this board does not read as [${letter}]` };
  const rows = layout.cells.length;
  const cols = layout.cells[0].length;
  let cell = null;
  layout.cells.forEach((row, r) => row.forEach((d, c) => { if (d && d.id === refBoyId) cell = [r, c]; }));
  if (!cell) return { reason: 'the reference boy is not on the board' };
  // Compass in the table's own drawing: column index increases east, row index increases south.
  const x = cell[1] - (cols - 1) / 2;
  const y = (rows - 1) / 2 - cell[0];
  const to = ((Math.round((Math.atan2(y, x) * 180 / Math.PI) / 90) * 90) % 360 + 360) % 360;
  const from = homeSide(refBoyId);
  const cw = ((to - from) % 360 + 360) % 360;
  return { cell, to, from, cw, code: { 0: 'H', 90: 'L', 180: 'O', 270: 'R' }[cw] };
}

function report(label, board, letter, formation) {
  const rel = relationshipStateOf(board, letter);
  const f = fasrooOf(board, formation);
  const rb = rel.reference?.boy ?? null;
  const o = orientationInTableFrame(board, letter, rb);
  console.log(`  ${label}`);
  console.log(`      engine      : ${f.orientation ? `${f.orientation.deg} deg / ${f.orientation.code}` : '?'}   occupation ${f.occupation ?? '?'}`);
  console.log(`      table frame : ${o.code ?? '?'}   (cell ${JSON.stringify(o.cell)}, side ${o.to}, home side ${o.from}, ${o.cw} deg clockwise)`);
  return o.code;
}

console.log('== All8\'s four [0B] orientation diagrams, decoded by hand from fasroo.htm ==');
console.log('   (the reference boy is the red sprite; up = north; the drawing has couple 1 south)');
console.log('     H : #1 boy south-west  (his home)      -> 0 deg');
console.log('     O : #1 boy north-east                  -> 180 deg');
console.log('     L : #1 boy north-west                  -> 90 deg clockwise');
console.log('     R : #1 boy south-east                  -> 90 deg counter-clockwise');
console.log('   So the rule is: the clockwise 90-degree step from his HOME side to the side he is on.\n');

console.log('== the four [0B1p] boards A CODE ADMITS (CANONICAL_INDEX.B[1].p = ' + CANONICAL_INDEX.B[1].p + ') ==');
boardsForAlignment(templateFor('B'), { letter: 'B', arrangement: 0, sequence: 1, relationship: 'p' }).boards
  .forEach((b, i) => report(`[${i}]`, b, 'B', 'Eight Chain Thru'));

console.log('\n== All8\'s worked [P] pair - BOTH must read H ==');
const corpus = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'all8-getouts.json'), 'utf8'));
const builtP = boardFromDiagram(templateFor('P'), 'P', 0, corpus.alignments.find((a) => a.id === 'P1c').diagram).board;
report('[0P1cH+] (as published)', builtP, 'P', 'Double Pass Thru');
report("[0P1cH'] (couples +1)", relabelCouples(builtP, 1), 'P', 'Double Pass Thru');

console.log('\n== the four [L1p] boards (CANONICAL_INDEX.L[1].p = ' + CANONICAL_INDEX.L[1].p + ') ==');
boardsForAlignment(templateFor('L'), { letter: 'L', arrangement: 0, sequence: 1, relationship: 'p' }).boards
  .forEach((b, i) => report(`[${i}]`, b, 'L', 'Normal Lines'));

console.log('\n== the four [W1p] and [F1p] boards, for a second look ==');
for (const [letter, formation] of [['W', 'Ocean Waves'], ['F', 'Two-Faced Lines']]) {
  console.log(`  -- [${letter}] ${formation}`);
  boardsForAlignment(templateFor(letter), { letter, arrangement: 0, sequence: 1, relationship: 'p' }).boards
    .forEach((b, i) => report(`[${i}]`, b, letter, formation));
}
