// THE NEXT-CALL LIST'S BOARD KEY: is the list stale, or is it still the board on the floor?
//
// WHY THIS IS A GATE. The key decides whether `settlePlayhead` rebuilds the call list, and both mistakes are silent:
// a key too COARSE offers the calls that were legal on a board the dancers have left (the engine's own `boardSig` trap
// - a positions-only signature on a facing-dependent question), and a key too FINE pays a rebuild on every interpolated
// frame, MEASURED in `settlePlayhead` at 686-692 ms warm because `legalNext()` enumerates the whole catalogue. The rule
// was four lines at the bottom of `sequencer-ui.ts`, under a doc comment that had been left on two dead declarations,
// and the panel cannot run under plain Node - so nothing could ask it anything. It is `poc/src/board-key.ts` now.
//
// THE NEGATIVE CONTROLS are the two plausible wrong keys, each measured to fail exactly one check:
//   * a POSITIONS-ONLY key passes every check here except `a facing is part of the question` - which is why the trap
//     is worth pinning: it is right about most boards and wrong about the ones that matter.
//   * an UNSORTED key passes everything except `the dancer order is not part of the answer`, and its cost is a rebuild
//     per shuffle rather than a stale list.
//
// Usage: node poc/tools/board-key-probe.mjs   (from anywhere; no corpus, no engine build - the rule reads no engine
// value, only the `Board` type)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardKey } from '../src/board-key.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** A minimal board: `boardKey` reads `dancers[].{id,x,y,heading}` and nothing else. */
const board = (dancers) => ({ dancers });

const B = board([
  { id: 'd1', x: 0, y: 3, heading: Math.PI / 2 },
  { id: 'd2', x: 3, y: 0, heading: 0 },
  { id: 'd3', x: 0, y: -3, heading: -Math.PI / 2 },
  { id: 'd4', x: -3, y: 0, heading: Math.PI },
]);
const clone = (b) => board(b.dancers.map((d) => ({ ...d })));
const moved = (b, id, patch) => board(b.dancers.map((d) => (d.id === id ? { ...d, ...patch } : { ...d })));

console.log('== 1. the same board is the same key ==');
{
  check(boardKey(B) === boardKey(clone(B)), 'a copy of the board gives the same key, so an unevaluated re-render does not rebuild the list');
  check(typeof boardKey(B) === 'string' && boardKey(B).length > 0, `the key is a string (${boardKey(B).slice(0, 42)}...)`);
}

console.log('\n== 2. what must change the key ==');
{
  const facing = moved(B, 'd1', { heading: Math.PI / 2 + (1 * Math.PI) / 180 });
  check(boardKey(facing) !== boardKey(B),
    'a ONE-DEGREE facing change makes a new key - two boards that differ only in facings offer different calls');
  const position = moved(B, 'd2', { x: 3.002 });
  check(boardKey(position) !== boardKey(B), 'and so does a 0.002-unit move, which is above the key\'s rounding');
  // THE ID IS IN THE KEY: two dancers swapping places is a different question for the catalogue, even though the SET of
  // occupied spots is identical. A key over positions alone would call this board unchanged.
  const swapped = board(B.dancers.map((d) => (d.id === 'd1' ? { ...d, x: 3, y: 0 } : d.id === 'd2' ? { ...d, x: 0, y: 3 } : d)));
  check(boardKey(swapped) !== boardKey(B), 'and a swap of two dancers\' SPOTS does, because which dancer stands where is part of the question');
}

console.log('\n== 3. what must NOT change the key ==');
{
  // THE ROUNDING: an interpolated frame differs in the last decimals and must not buy a 700 ms rebuild.
  const noise = moved(B, 'd1', { x: 0.0004, y: 3 - 0.0004, heading: Math.PI / 2 + 1e-6 });
  check(boardKey(noise) === boardKey(B), 'a 0.0004-unit move (an interpolation, not an edit) keeps the key, so a scrub released where it started is free');
  // THE ORDER: a board rebuilt by any component comes back in the order it was given, and a shuffle is not a move.
  const shuffled = board([...B.dancers].reverse());
  check(boardKey(shuffled) === boardKey(B), 'and the dancer ORDER is not part of the answer, so a re-ordered array does not rebuild the list either');
}

console.log('\n== 4. the negative controls: the two plausible wrong keys ==');
{
  const positionOnly = (b) => b.dancers.map((d) => `${d.id}:${d.x.toFixed(3)},${d.y.toFixed(3)}`).sort().join('|');
  const unsorted = (b) => b.dancers.map((d) => `${d.id}:${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(4)}`).join('|');
  const facing = moved(B, 'd1', { heading: Math.PI / 2 + (1 * Math.PI) / 180 });
  const shuffled = board([...B.dancers].reverse());
  check(positionOnly(facing) === positionOnly(B) && boardKey(facing) !== boardKey(B),
    'CONTROL: a positions-only key calls a one-degree facing change the SAME board - the `boardSig` trap - and this is the only check that catches it');
  check(unsorted(shuffled) !== unsorted(B) && boardKey(shuffled) === boardKey(B),
    'CONTROL: an unsorted key calls a re-ordered array a NEW board, so it rebuilds the list for nothing');
  // AND THE ROUNDING IS NOT THE COARSE KEY IN DISGUISE: it keeps a 0.0004 move and the positions-only key would too, so
  // that check alone cannot tell them apart - which is why the facing check above is the one that rules the coarse key
  // out, and this one records the pair rather than resting on one of them.
  check(positionOnly(B) !== boardKey(B), 'and the two keys are not the same string for the same board, so each control measures its own rule');
}

console.log('\n== 5. the panel asks THIS function, and the dead declarations are gone ==');
{
  // THE PANEL CANNOT BE LOADED (DOM, `three`), so the wiring is a SOURCE check and is labelled as one.
  const src = fs.readFileSync(path.join(here, '..', 'src', 'sequencer-ui.ts'), 'utf8');
  check(/import \{ boardKey \} from '\.\/board-key'/.test(src), 'the panel imports the rule rather than keeping the four lines');
  check(/this\.listBoardKey = boardKey\(this\.seq\.board\);/.test(src),
    'the list RECORDS the board it was built from (`refreshCallSelect`)');
  check(/if \(boardKey\(this\.seq\.board\) === this\.listBoardKey\) return;/.test(src),
    'and `settlePlayhead` compares before rebuilding, which is what makes the 700 ms refresh cost one board change rather than one settle');
  // THE DECLARATIONS THE DOC COMMENT WAS SITTING ON. Both were unreferenced anywhere in the tree, and deleting them is
  // what let the comment go back onto the function it describes. An absence is what has to be gated, because nothing
  // else can notice a dead constant coming back - and the check reads the CODE, not the file: the comment that records
  // the deletion names them, so a plain text search would fail on the record of the fix.
  const codeOnly = src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  check(!/PARALLEL_PREFIX|isParallelPick/.test(codeOnly),
    'and the two dead declarations that had the key\'s doc comment are gone (`PARALLEL_PREFIX`, `isParallelPick`), which the code - not the file - is asked about');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
