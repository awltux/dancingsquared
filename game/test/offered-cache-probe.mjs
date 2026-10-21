// THE `offered` LIST, CACHED — and the thing a cache can get wrong: serving one board's list for another.
//
// WHY THIS PROBE EXISTS. `applier.offered(board)` is one `applyToBoard` per registered title (MEASURED at the
// shipped level-1 pool: 75-118 ms a board) and the generator asks it for every frontier board, so the applier now
// caches it by `poseKey` — the same key and the same trap the reading cache beside it records. A cache is a
// correctness risk before it is a speed feature: `boardSig` is POSITIONS ONLY (AGENTS.md §8 trap 11), so a key
// built from it would return the previous board's list for a board that differs only in FACING.
//
// WHAT IS CHECKED, per board: a repeat call returns the same list, and every call in the list is one the engine does
// not refuse at THAT board — which is what a stale, another-board's list fails. The list is no longer "every call the
// engine does not refuse": since the permission table was wired in, `offered` also drops what `mayOffer` refuses
// (MEASURED at a squared set: 40 -> 31), so this walks the geometry and the exact set of the filtered list is
// `permission-probe.mjs`'s subject. Stating the subset here rather than an equality is deliberate: two probes
// asserting the same equality would have to agree about the table's answer, which is a second implementation of it.
//
// Usage: node game/test/offered-cache-probe.mjs   (engine must be built)
import { makeSquaredSet } from 'dancing-squared-engine';
import { applierFor } from '../src/data/corpus-node.ts';
import { poolFor } from '../src/puzzle/pool.ts';
import { levelSpec } from '../src/puzzle/levels.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const pool = poolFor(levelSpec(1));
const { applier } = applierFor(pool, pool.length);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const offeredAt = (board) => applier.offered(board).map((m) => m.call);

console.log(`== the offered list at level 1's pool (${pool.length} titles) ==`);

// THE START AND ONE BOARD PER FIRST MOVE, which is exactly the working set a one-ply search touches.
const start = makeSquaredSet();
const boards = [start, ...applier.offered(start).slice(0, 6).map((m) => m.board)];
check(boards.length >= 2, `a sample of ${boards.length} board(s) to ask about`);

for (let i = 0; i < boards.length; i++) {
  const board = boards[i];
  const first = offeredAt(board);
  const second = offeredAt(board);
  check(same(first, second), `board ${i}: a repeated ask returns the same ${first.length} call(s)`);
  const refusedHere = first.filter((c) => applier.refusalOf(board, c) !== null);
  check(refusedHere.length === 0,
    `board ${i}: and every one of its ${first.length} calls is one this board does not refuse` +
      (refusedHere.length ? ` (refused: ${refusedHere.join(', ')})` : ''));
}

// NEGATIVE CONTROL: the check above must be able to fail, or it is a statement about `same` rather than about the
// cache. A NEIGHBOUR'S list stands in for "the wrong board's list", which is exactly what a too-coarse key serves;
// it must contain at least one call the first board refuses, or the sample cannot tell the two apart and the check
// above would pass for a cache that never looked at the board.
{
  const other = offeredAt(boards[1]);
  const wrongHere = other.filter((c) => applier.refusalOf(boards[0], c) !== null);
  check(wrongHere.length > 0,
    `NEGATIVE CONTROL: board 1's list holds ${wrongHere.length} call(s) board 0 refuses, so serving it would be caught`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
