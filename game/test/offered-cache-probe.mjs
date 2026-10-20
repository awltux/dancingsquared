// THE `offered` LIST, CACHED — and the thing a cache can get wrong: serving one board's list for another.
//
// WHY THIS PROBE EXISTS. `applier.offered(board)` is one `applyToBoard` per registered title (MEASURED at the
// shipped level-1 pool: 75-118 ms a board) and the generator asks it for every frontier board, so the applier now
// caches it by `poseKey` — the same key and the same trap the reading cache beside it records. A cache is a
// correctness risk before it is a speed feature: `boardSig` is POSITIONS ONLY (AGENTS.md §8 trap 11), so a key
// built from it would return the previous board's list for a board that differs only in FACING.
//
// WHAT IS CHECKED, per board: a repeat call returns the same list, and the list is EXACTLY what an independent
// recomputation over `candidateCalls()` + `refusalOf()` says. The second check is the one that would fail if two
// boards ever shared a key, because the other board's list is, by construction, a different set of calls.
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

console.log(`== the offered list at level 1's pool (${pool.length} titles) ==`);

// THE START AND ONE BOARD PER FIRST MOVE, which is exactly the working set a one-ply search touches.
const start = makeSquaredSet();
const boards = [start, ...applier.offered(start).slice(0, 6).map((m) => m.board)];
check(boards.length >= 2, `a sample of ${boards.length} board(s) to ask about`);

for (let i = 0; i < boards.length; i++) {
  const board = boards[i];
  const first = applier.offered(board).map((m) => m.call);
  const second = applier.offered(board).map((m) => m.call);
  check(same(first, second), `board ${i}: a repeated ask returns the same ${first.length} call(s)`);
  // THE INDEPENDENT RECOMPUTATION: every candidate whose application the ENGINE does not refuse.
  const recomputed = applier.candidateCalls().filter((c) => applier.refusalOf(board, c) === null);
  check(same(first, recomputed),
    `board ${i}: and it equals a fresh recomputation over all ${applier.candidateCalls().length} candidates`);
}

// NEGATIVE CONTROL: the comparison above must be able to fail, or it is a statement about `same` rather than about
// the cache. A list with one entry removed stands in for "the wrong board's list", which is exactly the failure a
// too-coarse key produces.
{
  const board = boards[0];
  const list = applier.offered(board).map((m) => m.call);
  const wrong = list.slice(1);
  check(list.length > 1 && !same(wrong, list), 'NEGATIVE CONTROL: a truncated list is caught by the same comparison');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
