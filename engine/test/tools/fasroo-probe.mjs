// DOES FASROO SAY THE RIGHT THING FOR A BOARD WE ALREADY KNOW?
//
// `fasrooOf` reads All8's full setup description: FASR plus Orientation (H/R/O/L) and Occupation
// (+/'), which is what turns a FASR code - a CLASS of four boards - into an absolute SETUP.
//
// ORIENTATION IS IN 90-DEGREE STEPS. An earlier version quantised in 45-degree steps on the reasoning
// that a board can end half-rotated; that was wrong and has been removed, because Orientation is
// relative to HOME. A board that genuinely ends half-rotated is described by its FORMATION.
//
// The one part that cannot be derived from the code is which of R and L is which: they are conventions
// about which way "right" is, and All8's diagrams are the only statement of them. Everything else is
// checkable, and this checks it on boards whose answer is known by construction.
//
// Usage: node engine/test/tools/fasroo-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, fasrooOf, boardForFasrCode, boardsForAlignment, parseAlignmentId } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const show = (label, board, formation) => {
  const f = fasrooOf(board, formation ?? seq.knownFormation(board));
  const o = f.orientation;
  console.log(
    `  ${label.padEnd(30)} ${f.notation.padEnd(11)} orientation=${o ? `${o.deg}deg ${o.code ?? '?'}` : '-'}` +
    `  occupation=${f.occupation ?? '-'}  refBoy=${f.referenceBoy ?? '-'}${f.reason ? `\n      (${f.reason})` : ''}`,
  );
};

console.log('fasroo-probe: FASR + Orientation + Occupation\n');

console.log('HOME. The reference boy is at home, and is a Head, so the reading should be H and +:');
show('Static Square', seq.boardForFormation('Static Square'));

console.log('\nA board built from a code: Occupation is the reference boy\'s own couple (odd = Head):');
for (const code of ['L1p', 'L1o', 'L2p']) {
  const built = boardForFasrCode(code, (l) => (l === 'L' ? seq.boardForFormation('Normal Lines') : null));
  if (built.board) show(`boardForFasrCode(${code})`, built.board, 'Normal Lines');
}

console.log('\nTHE SAME CODE, ALL FOUR BOARDS. A FASR code names a class; FASROO should tell them apart');
console.log('by Occupation and Orientation even though the FASR part is identical:\n');
{
  const template = seq.boardForFormation('Normal Lines');
  const res = boardsForAlignment(template, parseAlignmentId('L1p'));
  res.boards.forEach((b, i) => show(`L1p board ${i}`, b, 'Normal Lines'));
}

console.log('\nA formation with no All8 letter, and one with no reference pair, must say WHY:');
show('Static Square (as a letterless setup)', seq.boardForFormation('Static Square'), null);
show('Double Pass Thru', seq.boardForFormation('Double Pass Thru'));
