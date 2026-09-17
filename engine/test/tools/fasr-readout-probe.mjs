// DOES THE FASR READOUT SAY THE RIGHT THING?
//
// The POC now shows the board's All8 FASR code next to the formation. This replicates that readout
// headlessly (the POC cannot be launched in this sandbox - the Vite/esbuild spawn is blocked) and
// checks it on boards whose code is known: one with no identity at all, the four boards a code
// admits, and home.
//
// Usage: node engine/test/tools/fasr-readout-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, alignmentOf, relationshipStateOf, boardsForAlignment, parseAlignmentId, boardForFasrCode } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

/** Exactly what `SequencerController.fasrCode` does. */
function fasrCode(board) {
  const a = alignmentOf(board, seq.knownFormation(board));
  if (!a.letter) return null;
  let rel = a.relationship;
  let note = a.relationshipReason;
  if (!rel) {
    const rs = relationshipStateOf(board, a.letter);
    if (rs.code) { rel = rs.code; note = undefined; }
    else note = rs.reason;
  }
  return { code: `[${a.arrangement ?? '?'}${a.letter}${a.sequence ?? '?'}${rel ?? '?'}]`, note };
}

const show = (label, b) => {
  if (!b) { console.log(`  ${label.padEnd(34)} (no board)`); return; }
  const r = fasrCode(b);
  console.log(`  ${label.padEnd(34)} ${r ? r.code.padEnd(9) : '(no formation letter)'.padEnd(9)} ${r?.note ?? ''}`);
};

console.log('fasr-readout: what the sequencer will print\n');

console.log('a formation stood up from the LIBRARY carries no identity, so the code is honestly partial:');
show('Normal Lines (synthetic)', seq.boardForFormation('Normal Lines'));
show('Eight Chain Thru (synthetic)', seq.boardForFormation('Eight Chain Thru'));
show('Ocean Waves (synthetic)', seq.boardForFormation('Ocean Waves'));

console.log('\nHome has no All8 letter, so it prints nothing rather than inventing one:');
show('Static Square', seq.boardForFormation('Static Square'));

console.log('\nA board BUILT from a code should read back its own code:');
for (const code of ['L1p', 'L1o', 'L2p', 'L2c']) {
  const built = boardForFasrCode(code, (l) => (l === 'L' ? seq.boardForFormation('Normal Lines') : null));
  show(`boardForFasrCode('${code}')`, built.board);
}

console.log('\nTHE POINT OF THE READOUT: all FOUR boards a code admits print the SAME code.');
console.log('  that is the discrepancy the readout exposes - the code does not pin the board.\n');
{
  const template = seq.boardForFormation('Normal Lines');
  const res = boardsForAlignment(template, parseAlignmentId('L1p'));
  const FACE = ['>', '^', '<', 'v'];
  const draw = (b) => {
    const cols = new Map();
    for (const d of b.dancers) { const k = d.x.toFixed(3); if (!cols.has(k)) cols.set(k, []); cols.get(k).push(d); }
    const lines = [...cols.entries()].sort((a, c) => Number(a[0]) - Number(c[0])).map(([, ds]) => ds.sort((a, c) => c.y - a.y));
    return [0, 1, 2, 3].map((r) => lines.map((l) => `${l[r].couple}${FACE[((Math.round(l[r].heading / (Math.PI / 2)) % 4) + 4) % 4]}`).join(' ')).join(' / ');
  };
  res.boards.forEach((b, i) => {
    const r = fasrCode(b);
    console.log(`    board ${i}: reads ${r ? r.code : '(none)'}   drawn as  ${draw(b)}`);
  });
}
