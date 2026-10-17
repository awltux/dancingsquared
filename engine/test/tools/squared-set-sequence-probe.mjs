// WHY does the (arrangement, sequence, relationship) filter return nothing for [S]?
// Usage: node engine/test/tools/squared-set-sequence-probe.mjs

import { Sequencer, setParser, boardsForAlignment, arrangementFor, sequenceFor, relationshipStateOf, fasrooOf } from '../../dist/index.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  [],
);
const home = seq.boardForFormation('Static Square');

console.log('=== the home TEMPLATE ===');
console.log(`  sequenceFor(home) -> ${JSON.stringify(sequenceFor(home))}`);

const r = boardsForAlignment(home, { letter: 'S', arrangement: 0 });
console.log(`\n=== arrangement 0: ${r.boards.length} board(s) ===`);
for (const b of r.boards.slice(0, 3)) {
  const s = sequenceFor(b);
  const rel = relationshipStateOf(b, 'S');
  console.log(`  couples ${b.dancers.map((d) => d.couple).join(',')}`);
  console.log(`    sequence ${s.code ?? 'null'} (${s.reason ?? `boys ${s.boys?.join('')} girls ${s.girls?.join('')}`})`);
  console.log(`    relationship ${rel.code ?? 'null'} (${rel.reason ?? ''})`);
}

console.log('\n=== what does the home BOARD read as a setup? ===');
console.log(`  fasrooOf(home, 'Static Square') = ${fasrooOf(home, 'Static Square').notation}`);
