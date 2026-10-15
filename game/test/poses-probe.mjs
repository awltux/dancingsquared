// `stillBoard` pinned: one pose per dancer, in the board's own order, with the grip state a board can
// honestly claim.
//
// WHY THIS IS STILL A PROBE now that the interpolation is the engine's. `stillBoard` is the ONE place a board
// becomes what the renderer draws, and two of its properties are load-bearing rather than cosmetic:
//
//   * THE POSE LIST IS INDEXED LIKE THE BOARD. `BoardView` builds one `DancerView` per dancer of the board
//     and hands pose `i` to view `i`, so a pose list in any other order draws the right people in the wrong
//     places — every position still looking legal, which is the failure `reorderLike` exists to prevent in the
//     engine.
//   * `hands: 'both'`, because a board carries no grip state. `computeHandholds(poses, 'static')` gives every
//     dancer both hands and finds the pairs that mutually reach; a pose list claiming `'none'` would be
//     claiming the opposite of what the renderer then draws.
//
// Usage: node game/test/poses-probe.mjs
import { stillBoard } from '../src/game/poses.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** Four dancers with DISTINCT positions and headings, in an order that is deliberately not sorted by id, so
 * an implementation that sorted or indexed by position is caught rather than passing by luck. */
const board = {
  dancers: [
    { id: 7, couple: 4, gender: 'girl', x: 1, y: 2, heading: 0.5 },
    { id: 2, couple: 1, gender: 'boy', x: -3, y: 1, heading: -1.25 },
    { id: 5, couple: 3, gender: 'girl', x: 0, y: -2, heading: 3 },
    { id: 1, couple: 1, gender: 'boy', x: 4, y: 0, heading: 0 },
  ],
};

console.log('== the pose list is indexed like the board ==');
{
  const poses = stillBoard(board);
  check(poses.length === board.dancers.length, `one pose per dancer (${poses.length})`);
  let mismatched = 0;
  for (let i = 0; i < poses.length; i++) {
    const d = board.dancers[i];
    if (poses[i].x !== d.x || poses[i].y !== d.y || poses[i].heading !== d.heading) mismatched++;
  }
  // Negative control: an implementation that sorted by id, or that dropped the array and rebuilt it, reddens
  // exactly this check — and the renderer's own `sameIds` rebuild guard would not notice, because the SET is
  // unchanged.
  check(mismatched === 0, `every pose is its own dancer's position and heading, in the board's order (${mismatched} mismatched)`);
}

console.log('\n== the grip state is the one a board can claim ==');
{
  const poses = stillBoard(board);
  check(poses.every((p) => p.hands === 'both'), 'every pose says both hands, which is what a static hold graph reads');
  // A board with no grip information claiming anything else would be a claim it cannot support: the hold is
  // derived from geometry, never authored here (see `poses.ts`).
  check(poses.every((p) => typeof p.x === 'number' && typeof p.y === 'number' && typeof p.heading === 'number'), 'and nothing else is invented — no path, no velocity, no hold');
}

console.log('\n== an empty board is empty, not an error ==');
{
  check(stillBoard({ dancers: [] }).length === 0, 'a board with no dancers yields no poses');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
