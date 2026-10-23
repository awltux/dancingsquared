// WHAT IS THE REFERENCE PAIR FOR [P] (Beginning Double Pass Thru)?
//
// The plan's open item: `fasrooOf` refused [P] because `REFERENCE_PAIR_RULES` had no entry for it, and
// All8's own worked Orientation/Occupation case is a [P] board ([0P1cH+] / [0P1cH']). Before the
// Orientation construction could be checked, [P] needed a reference pair. This is the measurement the
// decision rests on.
//
// All8 STATES THE RULE, on https://www.all8.com/sd/calling/16com_p.htm ("Special note about Double
// Pass Thru Formation"):
//
//   "To determine relationship, by convention we need one girl and one boy in each quadrant of the
//    setup. ... Since [0P] Double Pass Thru formation does not have a single boy and a single girl in
//    each quadrant, for purposes of evaluating relationship, we mentally have the Centers Pass Thru
//    then evaluate relationship in the resulting [0B] Eight Chain Thru Formation."
//
// THE FOUR CHECKS, each independent of the others:
//
//   A. the raw [P] boards' own adjacent-pair reading: unanimous on the two "All Paired" states, mixed
//      on the two "Outsides Paired" ones - so a fixed pair cannot be the whole answer.
//   B. the mental Centers Pass Thru, done two ways - as the catalogue call and as the shipped pure
//      geometry - which must agree dancer for dancer.
//   C. All8's OWN conversion lines, published beside each get-out diagram, which state where the
//      mental pass thru lands: P1c -> B1c, P2r -> B2r, P3p -> B3r, P4p -> B4c.
//   D. what the decision UNBLOCKS: `fasrooOf` on All8's own worked pair, which is the check the plan
//      could not run at all before. Occupation comes out exactly right; Orientation does not.
//
// Usage: node engine/test/tools/p-reference-pair-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer,
  setParser,
  parseAlignmentId,
  boardFromDiagram,
  arrangementFor,
  sequenceFor,
  relationshipStateOf,
  adjacentPairs,
  centresPassThru,
  relabelCouples,
  fasrooOf,
  FORMATIONS_FOR_LETTER,
} from '../../dist/index.js';
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
  for (const n of FORMATIONS_FOR_LETTER[letter] ?? []) {
    const b = seq.boardForFormation(n);
    if (b) return b;
  }
  return null;
};

const FACE_CH = { 0: '>', 1.5707963267948966: '^', 3.141592653589793: '<', 4.71238898038469: 'v' };
const face = (h) => FACE_CH[h] ?? `h${(h * 180 / Math.PI).toFixed(0)}`;
const pose = (b) => [...b.dancers]
  .sort((a, c) => (c.y - a.y) || (a.x - c.x))
  .map((d) => `c${d.couple}${d.gender[0]}(${d.x.toFixed(0)},${d.y.toFixed(0)})${face(d.heading)}`)
  .join(' ');
const sameBoard = (a, b) => a && b && a.dancers.every((d) => {
  const o = b.dancers.find((x) => x.id === d.id);
  return o && Math.abs(o.x - d.x) < 1e-6 && Math.abs(o.y - d.y) < 1e-6 && Math.abs(o.heading - d.heading) < 1e-9;
});

// ------------------------------------------------------------------ the corpus [P] diagrams

const corpus = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'all8-getouts.json'), 'utf8'));
const pTemplate = templateFor('P');
const pAlignments = corpus.alignments.filter((a) => parseAlignmentId(a.id)?.letter === 'P');

/** All8's own conversion lines, transcribed from the four get-out pages. */
const CONVERSION = { P1c: 'B1c', P2r: 'B2r', P3p: 'B3r', P4p: 'B4c' };

console.log('== A. the [P] board\'s own adjacent-pair reading ==');
const built = [];
for (const a of pAlignments) {
  const spec = parseAlignmentId(a.id);
  const r = boardFromDiagram(pTemplate, 'P', spec.arrangement, a.diagram);
  if (!r.board) { console.log(`  [${a.id}] could not build: ${r.reason}`); continue; }
  const pairs = adjacentPairs(r.board, 'P');
  const letters = new Set(pairs.pairs?.map((p) => p.letter));
  const own = letters.size === 1 && !letters.has(null) ? [...letters][0] : null;
  built.push({ id: a.id, spec, board: r.board, own });
  console.log(`  [${a.id}] published '${spec.relationship}'  own pairs ${own ? `'${own}' (unanimous)` : `mixed (${pairs.pairs?.map((p) => p.letter).join('')})`}`);
}

console.log('\n== B + C. the mental Centers Pass Thru: the shipped geometry, the catalogue call, and All8\'s conversion line ==');
let bOk = 0, geomMatchesCall = 0, conversionOk = 0;
for (const { id, spec, board } of built) {
  const geom = centresPassThru(board);
  const call = seq.applyToBoard(board, 'Centers Pass Thru');
  const callSeq = call.legal ? sequenceFor(call.board).code : null;
  const callLetter = call.legal ? relationshipStateOf(call.board, 'B').code : null;
  const same = sameBoard(geom.board, call.legal ? call.board : null);
  if (same) geomMatchesCall++;
  const want = CONVERSION[id];
  const conv = callLetter && callSeq !== null && `B${callSeq}${callLetter}` === want;
  if (conv) conversionOk++;
  console.log(`  [${id}]`);
  console.log(`      catalogue call : ${call.legal ? `[${seq.knownFormation(call.board)}] B${callSeq}${callLetter}` : `REFUSED (${call.reason})`}`);
  console.log(`      shipped geometry: ${geom.board ? `[${seq.knownFormation(geom.board)}] ${relationshipStateOf(geom.board, 'B').code}` : `no (${geom.reason})`}   identical board: ${same ? 'YES' : 'NO'}`);
  console.log(`      All8 conversion: expects [${want}]  ${conv ? 'ok' : 'DISAGREES'}`);
}
console.log(`\n  the shipped geometry is the catalogue call dancer for dancer: ${geomMatchesCall} of ${built.length}`);
console.log(`  All8's own conversion lines reproduced: ${conversionOk} of ${built.length}`);

console.log('\n== the rule this supports ==');
console.log('   relationshipStateOf([P]) reads the board\'s own pairs when they AGREE (the "All Paired"');
console.log('   states), and otherwise reduces through the mental Centers Pass Thru into [0B].');
let ruleOk = 0;
for (const { id, spec, board, own } of built) {
  let got = own, how = 'own pairs (unanimous)';
  if (got === null) {
    const geom = centresPassThru(board);
    got = geom.board ? relationshipStateOf(geom.board, 'B').code : null;
    how = 'mental Centers Pass Thru -> [0B]';
  }
  const ok = got === spec.relationship;
  if (ok) ruleOk++;
  console.log(`  [${id}] published '${spec.relationship}' -> '${got}' via ${how}  ${ok ? 'ok' : 'DISAGREES'}`);
}
console.log(`\n  the rule reproduces ${ruleOk} of ${built.length} published [P] letters`);
console.log('  NOTE the reduction is not applied unconditionally: it would give P3p -> \'r\' and P4p -> \'c\',');
console.log('  contradicting the published \'p\' for both. Only the mixed states need it.');

console.log('\n== D. what the decision unblocks: fasrooOf on All8\'s own worked pair ==');
console.log('   All8 draws [0P1cH+] and [0P1cH\'] as the SAME board with the couples shifted, differing');
console.log('   only in Occupation - and says BOTH are oriented H. `fasrooOf` refused [P] outright before.');
const p1c = built.find((b) => b.id === 'P1c')?.board;
for (const [label, board] of [
  ['[0P1cH+] (the published board)', p1c],
  ['[0P1cH\'] (same board, couples +1)', p1c ? relabelCouples(p1c, 1) : null],
]) {
  if (!board) continue;
  const f = fasrooOf(board, 'Double Pass Thru');
  console.log(`   ${label}`);
  console.log(`      ${f.notation}   occupation ${f.occupation ?? '?'}   orientation ${f.orientation ? `${f.orientation.deg} deg / ${f.orientation.code}` : '?'}   referenceBoy ${f.referenceBoy ?? '-'}`);
}
console.log('   OCCUPATION is exactly what All8 draws for both (+ and \'), which validates the reference pair.');
console.log('   ORIENTATION reads R where All8 says H - so the construction is DISPROVED, not merely');
console.log('   unverified, on the authority\'s own example. That is the next piece of work.');
