// STEP 2 PROBE: does [S] work through `boardsForAlignment` / `boardForAlignment`?
//
// This is the mechanism Step 3's setup primitive will sit on, so [S] refusing there matters. The
// harness's reachability table read `[S] Static Square 0:0/16 ... 4:0/16` before the fix: the
// enumeration compared the board's arrangement to one NUMBER, and a ring's board can carry two honest
// readings (a half turn maps 1<->2 and 3<->5), so the comparison failed and nothing was admitted.
// Membership of the candidate set is the right test.
//
// It also measures what does NOT work yet, because that is Step 3's starting point:
//   - a board built by the enumeration reads `sequence null`, and
//   - `relationshipStateOf(board, 'S')` is null for every letter Callerlab has no reference pair for,
// so a spec that names a sequence or a relationship admits nothing for [S].
//
// Usage: node engine/test/tools/squared-set-construction-probe.mjs

import { Sequencer, setParser, boardsForAlignment, boardForAlignment, arrangementFor, sequenceFor, relationshipStateOf } from '../../dist/index.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  [],
);
const home = seq.boardForFormation('Static Square');
if (!home) { console.log('FAIL: no Static Square template'); process.exit(1); }

console.log('=== boardsForAlignment by arrangement, no sequence/relationship filter ===');
const t0 = Date.now();
for (const arrangement of [0, 5, 1, 2, 3, 4]) {
  const r = boardsForAlignment(home, { letter: 'S', arrangement });
  const first = r.boards[0];
  if (!first) { console.log(`  [${arrangement}S] 0 board(s) of ${r.attempted} assignments (${r.reason})`); continue; }
  const read = arrangementFor(first, 'S');
  console.log(`  [${arrangement}S] ${String(r.boards.length).padStart(3)} board(s) of ${r.attempted} assignments; first reads ${read.number ?? 'null'} [${read.candidates.join(',')}], sequence ${sequenceFor(first).code ?? 'null'}, relationship ${relationshipStateOf(first, 'S').code ?? 'null'}`);
}
console.log(`  ${Date.now() - t0} ms for the six enumeration runs (576 assignments each)`);

console.log('\n=== boardForAlignment picks the FIRST of the set ===');
for (const arrangement of [0, 5, 1, 2]) {
  const b = boardForAlignment(home, { letter: 'S', arrangement });
  if (!b) { console.log(`  [${arrangement}S] null`); continue; }
  const read = arrangementFor(b, 'S');
  console.log(`  [${arrangement}S] couples ${b.dancers.map((d) => d.couple).join(',')} reads ${read.number ?? 'null'} [${read.candidates.join(',')}]`);
}

console.log('\n=== what a full spec does (the honest gap) ===');
for (const spec of [{ letter: 'S', arrangement: 0 }, { letter: 'S', arrangement: 0, sequence: 1 }, { letter: 'S', arrangement: 0, relationship: 'p' }]) {
  const r = boardsForAlignment(home, spec);
  console.log(`  ${JSON.stringify(spec).padEnd(48)} -> ${r.boards.length} board(s)${r.reason ? `  (${r.reason})` : ''}`);
}
