// WHICH BOARD THIS IS, for deciding whether the next-call list needs rebuilding.
//
// WHY THIS IS ITS OWN MODULE. The rule was four lines at the bottom of `sequencer-ui.ts` (2,959 lines), and its doc
// comment had been left sitting on the two declarations ABOVE it - `PARALLEL_PREFIX` and `isParallelPick`, both dead,
// neither referenced anywhere in the tree - so the one comment that explains the key was attached to nothing and the
// rule itself was unmeasurable: the panel builds DOM and cannot run under plain Node, so the only way to ask "is this
// key right?" was to read the source. `poc/tools/board-key-probe.mjs` drives it now.
//
// WHAT IT COSTS TO GET WRONG, both ways. Too coarse and the list is STALE: the panel offers the calls that were legal
// on a board the dancers have since left (the trap the engine records for `boardSig` - a positions-only signature on a
// facing-dependent question). Too fine and every interpolated frame costs a rebuild, which is not free: MEASURED in
// `settlePlayhead`, `refreshCallSelect` costs 686-692 ms warm and 1.6 s the first time, because `legalNext()`
// enumerates the whole catalogue and applies every call to the board. That measurement is why the key is ROUNDED
// rather than exact, and why it exists at all.
//
// POSITION AND FACING, because two boards that differ only in facings offer different calls. ROUNDED, because the
// evaluated frames are interpolations and only a materially different board should cost a rebuild. SORTED, because
// the answer must not depend on the order the dancers happen to be in - a board rebuilt by any component comes back in
// the order it was given (`reorderLike`), and a list rebuilt because the array was shuffled is the same waste the
// rounding rules out.
import type { Board } from 'dancing-squared-engine/sequencer';

/**
 * The identity of a BOARD for the next-call list: one entry per dancer, by id, with its position and facing.
 *
 * THE ID IS IN THE KEY ON PURPOSE. Two dancers swapping places is not the same question for the catalogue - which calls
 * are legal depends on WHICH dancer stands where - so a key over positions alone would call that board unchanged.
 *
 * The rounding is the key's only tolerance: 3 decimals on a position, 4 on a heading in radians, both far below what a
 * caller can see and both far above the interpolation noise of an evaluated frame. See the header for what each
 * direction costs.
 */
export function boardKey(board: Board): string {
  return board.dancers
    .map((d) => `${d.id}:${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(4)}`)
    .sort()
    .join('|');
}
