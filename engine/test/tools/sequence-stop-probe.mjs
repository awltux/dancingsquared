// WHAT `sequenceStop` REPORTS, on the two configurations that differ.
//
// From home, `ceder-7046`'s `Right and Left Grand` cannot be played and the animation ends on the
// board before it (33.5 beats). From the module's own `Zero Line` start the same call plays and the
// animation ends on the ring (35 beats). This prints the stop for each, plus a primitive witness
// built from calls the harness already uses.
//
// Usage: node engine/test/tools/sequence-stop-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
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

const mod = JSON.parse(readFileSync(path.join(root, 'modules', 'zero_line', 'static_set', '7046.json'), 'utf8'));
const flat = seq.flatten(mod.steps);

for (const [label, start] of [
  ['home', undefined],
  ["the module's own Zero Line (L1o)", boardForFasrCode('L1o', templateForLetter).board],
]) {
  const beats = seq.sequenceBeats(flat, start);
  const stop = seq.sequenceStop(flat, start);
  const end = seq.evaluateSequence(flat, beats, start).board;
  console.log(`\nstart = ${label}`);
  console.log(`  sequenceBeats = ${beats}`);
  console.log(`  sequenceStop  = ${stop ? `index ${stop.index} "${stop.call}" - ${stop.reason.slice(0, 70)}...` : 'null (it plays all the way)'}`);
  console.log(`  board the animation ends on: [${seq.knownFormation(end)}]`);
  if (stop) console.log(`  and that is the board BEFORE "${stop.call}": ${stop.board === end ? 'same object' : 'same board (by content)'}`);
}

console.log('\n=== a primitive witness: a call that cannot be danced from its board ===');
const home = seq.boardForFormation('Static Square');
const two = ['Circle Left', 'Swing Thru'];
const beats = seq.sequenceBeats(two, home);
const stop = seq.sequenceStop(two, home);
console.log(`  ["Circle Left", "Swing Thru"] from home: beats ${beats}, stop ${stop ? `index ${stop.index} "${stop.call}" (${stop.reason})` : 'none'}`);
console.log(`  evaluateSequence at ${beats} -> [${seq.knownFormation(seq.evaluateSequence(two, beats, home).board)}]`);
