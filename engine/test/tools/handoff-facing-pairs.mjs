// TWO QUESTIONS, MEASURED.
//
// (1) HOW A 2-DANCER SETUP IS TILED ONTO EIGHT DANCERS. Forced onto the 2-dancer variants alone (the
//     larger authorings removed), so the parallel path is the only one available and every step is
//     visible.
//
// (2) WHERE THE FACING PAIRS COME FROM - the couple FIELD, or the GEOMETRY AND HEADINGS?
//     This is settled by a control: a board whose dancers' `couple` labels DISAGREE with where they
//     stand. If the tiling follows the labels it will group by label; if it follows the headings it
//     will group the dancers that actually face each other. The two answers cannot both happen.
//
// Usage: node engine/test/tools/handoff-facing-pairs.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { matchFormations } from '../../dist/sequencer/match.js';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const TITLE = 'Single Circle Left Full';   // 2-dancer authorings only: Facing Dancers Far / Facing Dancers

const raw = read('assets/ms/circle.xml');
const all = (raw.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) || [])
  .filter((b) => new RegExp(`title="${TITLE}"`).test(b));
console.log(`tams in ms/circle.xml carrying title="${TITLE}": ${all.length}`);
if (all.length === 0) throw new Error(`no tam for ${TITLE} - check the title spelling`);
const mkSeq = (xmls) =>
  new Sequencer(read('assets/moves.xml'), read('assets/formations.xml'),
    [{ name: TITLE, xml: `<calls>\n${xmls.join('\n')}\n</calls>` }]);

console.log('==================================================================');
console.log('(1) THE 2-DANCER TILING ON EIGHT DANCERS');
console.log('==================================================================');
const seq = mkSeq(all);
const board = seq.boardForFormation('Normal Lines');
const phys = board.dancers.filter((d) => !d.isGhost);
const variants = seq.library.matchableVariants(TITLE);
console.log(`\nboard: ${board.dancers.map((d) => `#${d.id}(${d.x},${d.y})h${(d.heading * 180 / Math.PI).toFixed(0)}${d.gender}/c${d.couple}`).join(' ')}`);
console.log(`\nauthored setups:`);
for (const [i, v] of variants.entries()) {
  const setup = v.dancers.map((d) => seq.library.variantMatchable(d));
  console.log(`  [${i}] "${v.formation}" k=${v.dancers.length}`);
  console.log(`        setup: ${setup.map((d) => `(${d.x},${d.y})h${(d.heading * 180 / Math.PI).toFixed(0)}${d.gender ? '/' + d.gender : ''}c${d.couple}`).join('  ')}`);
}

// Let matchFormations show it, pair by pair, for the pair the engine ends up choosing.
const chosenPair = [phys[0], phys[7]];
console.log(`\nA sample candidate pair: #${chosenPair[0].id}(${chosenPair[0].x},${chosenPair[0].y})h0  #${chosenPair[1].id}(${chosenPair[1].x},${chosenPair[1].y})h180`);
for (const [i, v] of variants.entries()) {
  const tgt = v.dancers.map((d) => seq.library.variantMatchable(d));
  const m = matchFormations(
    chosenPair.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender, couple: d.couple })),
    tgt, 1.5, false,
  );
  console.log(`  vs setup [${i}] "${v.formation}": ${m ? `error=${m.error.toFixed(4)} rot=${(m.rot * 180 / Math.PI).toFixed(0)}deg reflect=${m.reflect}` : 'no match'}`);
}

console.log(`\nthe tiling the engine produces (2-dancer setups only):`);
for (const [i, v] of variants.entries()) {
  const setup = v.dancers.map((d) => seq.library.variantMatchable(d));
  const full = seq.applicator.partition(setup, phys, 1.5);
  const part = full ?? seq.applicator.partitionPartial(setup, phys, 1.5);
  console.log(`  [${i}] "${v.formation}": ${full ? `FULL err=${full.error.toFixed(4)}` : 'no full tiling'} ${part ? `groups: ${part.groups.map((g) => g.map((d) => '#' + d.id).join('+')).join('  ')}` : ''}`);
}
const res = seq.applyToBoard(board, TITLE);
console.log(`  applyToBoard -> ${res.parallel ? `"${res.parallel.variant.formation}" groups: ${res.parallel.groups.map((g) => g.map((d) => '#' + d.id).join('+')).join('  ')}` : 'whole-board'}`);
console.log(`  GROUP ORDERING IS THE BEFORE-BOARD ORDER VIA variantStarts, not sorted by anything.`);

console.log('\n==================================================================');
console.log('(2) THE CONTROL: COUPLE LABELS THAT CONTRADICT WHERE DANCERS STAND');
console.log('==================================================================');
// The control board is the SAME geometry, with the couple labels rotated: label each dancer with the
// home couple of the dancer one position along the board. Geometry and headings are untouched, so a
// geometry/heading reading must return the SAME pairs while a label reading must return different ones.
const labelBoard = {
  dancers: board.dancers.map((d, i) => ({ ...d, couple: [3, 3, 2, 2, 1, 1, 4, 4][i] })),
};
console.log(`labels rewritten to: ${labelBoard.dancers.map((d) => `#${d.id}c${d.couple}`).join(' ')}`);
console.log(`geometry unchanged : ${labelBoard.dancers.map((d) => `#${d.id}(${d.x},${d.y})h${(d.heading * 180 / Math.PI).toFixed(0)}`).join(' ')}`);

const plain = variants.find((v) => v.formation === 'Facing Dancers') ?? variants[0];
const setupPlain = plain.dancers.map((d) => seq.library.variantMatchable(d));
for (const [label, b] of [['original labels', board], ['contradictory labels', labelBoard]]) {
  const ph = b.dancers.filter((d) => !d.isGhost);
  const part = seq.applicator.partition(setupPlain, ph, 1.5) ?? seq.applicator.partitionPartial(setupPlain, ph, 1.5);
  console.log(`  ${label.padEnd(20)} -> ${part ? part.groups.map((g) => g.map((d) => `#${d.id}c${d.couple}`).join('+')).join('  ') : 'no tiling'}`);
}

// And show that a 2-dancer setup carries NO couple at all, so the couple rule cannot apply to it.
console.log(`\n== the couple field on the SETUP itself ==`);
for (const [i, v] of variants.entries()) {
  const tgt = v.dancers.map((d) => seq.library.variantMatchable(d));
  console.log(`  [${i}] "${v.formation}" setup couples: ${tgt.map((d) => d.couple ?? '(absent)').join(', ')}  (assignHomeIdentity only stamps an 8-dancer setup)`);
}

console.log('\n==================================================================');
console.log('(3) WHEN THE BOARD MOVES, THE PAIRING MOVES WITH IT');
console.log('==================================================================');
// A board whose geometry is STILL four facing pairs, but paired ACROSS the line instead of along it:
// #1 faces #5, #2 faces #6, and so on. The starting partnerships (1,8) (2,7) (3,6) (4,5) are still
// present as geometry, but the dancers that now face each other are the cross pairs.
const crossed = {
  dancers: [
    { id: 1, couple: 0, gender: 'boy', x: -2, y: 3, heading: 0 },
    { id: 2, couple: 0, gender: 'boy', x: -2, y: 1, heading: 0 },
    { id: 3, couple: 0, gender: 'girl', x: -2, y: -1, heading: 0 },
    { id: 4, couple: 0, gender: 'girl', x: -2, y: -3, heading: 0 },
    { id: 5, couple: 0, gender: 'girl', x: 2, y: 3, heading: Math.PI },
    { id: 6, couple: 0, gender: 'girl', x: 2, y: 1, heading: Math.PI },
    { id: 7, couple: 0, gender: 'boy', x: 2, y: -1, heading: Math.PI },
    { id: 8, couple: 0, gender: 'boy', x: 2, y: -3, heading: Math.PI },
  ],
};
console.log(`geometry: still four facing pairs across the line - #1 faces #5, #2 faces #6, #3 faces #7, #4 faces #8`);
console.log(`          (partner pairs of the STARTING formation were #1+#8 #2+#7 #3+#6 #4+#5)`);
for (const [label, b] of [['Normal Lines (as built)', board], ['crossed board', crossed]]) {
  const ph = b.dancers.filter((d) => !d.isGhost);
  const part = seq.applicator.partition(setupPlain, ph, 1.5) ?? seq.applicator.partitionPartial(setupPlain, ph, 1.5);
  console.log(`  ${label.padEnd(24)} -> ${part ? part.groups.map((g) => g.map((d) => `#${d.id}`).join('+')).join('  ') : 'no tiling'}`);
}
console.log(`  the tiling is recomputed from the board it is GIVEN - it carries no memory of the start.`);

console.log(`\n== is there a WHOLE-BOARD (k=8) authoring for this title? ==`);
const sizes = variants.map((v) => v.dancers.length);
console.log(`  k values present: ${sizes.join(', ')}`);
console.log(`  => k == n is ${sizes.includes(8) ? 'AVAILABLE' : 'NOT available, so the whole-board reading is impossible for this call'}`);
const res8 = seq.applyToBoard(board, TITLE);
console.log(`  applyToBoard legal=${res8.legal} via ${res8.parallel ? `parallel tiling "${res8.parallel.variant.formation}" (${res8.parallel.variant.dancers.length}-dancer)` : 'the whole-board reading'}`);
