// The level's 10x10 block, as DATA: one cell per drill, and nothing about how it is drawn.
//
// WHY THIS IS A MODULE AND NOT A SCREEN. The rule "which cell is done, which is next, which was never published"
// is the only thing the level screen decides, and a rule that lives inside a screen cannot be imported by a probe
// — the failure AGENTS.md §8 trap 27 records, where `daily-screen.ts`'s click logic was unmeasurable and shipped
// broken while every probe was green. So the states are computed here, with `block-probe.mjs` as the gate, and the
// screen is left with paint.
//
// THE CELL COUNT IS `LEVEL_SIZE` AND IS NOT THE SAME AS `length`. A level's block is 10x10 (DESIGN.md §15 Q17(v)),
// while `length` is how many drills have been PUBLISHED — 4 in the local fixture, 100 from the publisher. The cells
// past `length` are `unpublished`, which is a different fact from "locked" and is why the grid says so rather than
// hiding them: a block that silently shrank to its supply would look like a smaller level.
import { LEVEL_SIZE } from './levels.ts';

/** How many cells a level's block has — 10x10. */
export const CELL_COUNT = LEVEL_SIZE;

/**
 * What one cell is.
 *
 * `done-passed` IS NOT `done-not-passed`, and that is the whole reason the progress row grew a second set: a skip
 * and a revealed solve close a position without teaching it, and a grid that drew both as "done" would tell a
 * player they had learned a drill they moved past.
 *
 * `published` IS THE CELLS THAT ARE UNFINISHED AND NOT NEXT, and it is reachable rather than theoretical: progress
 * is a prefix in practice, but `drill-regime.ts` records that a hand-edited row or a republished schedule can
 * leave a gap, and a gap means an unfinished cell that the server did not hand out. It is deliberately NOT drawn
 * as playable — the progress map (DESIGN.md §8) gives the player one drill at a time.
 */
export type CellState = 'done-passed' | 'done-not-passed' | 'next' | 'published' | 'unpublished';

export interface BlockInput {
  /** How many drills the level has published. Fewer than `CELL_COUNT` is the ordinary case today. */
  readonly length: number;
  /** The positions the progress row calls finished. */
  readonly finished: readonly number[];
  /** The positions it calls PASSED — a subset of `finished`, enforced defensively below. */
  readonly passed: readonly number[];
  /**
   * The position the server says is next, or null.
   *
   * IT IS AN INPUT RATHER THAN A RULE HERE, deliberately: "the first unfinished position" is the SERVER's
   * `nextIndex` (`api/src/drill-regime.ts`), and a copy of it in the browser would be a second implementation of the
   * rule that decides which drill a player is on. The server already answers it — the drill it issues is the next
   * one — so the caller passes that index and this module never derives it.
   */
  readonly next: number | null;
}

export interface Cell {
  readonly index: number;
  readonly state: CellState;
}

/**
 * The block's cells, index 0 first (row-major: ten cells per row, the picker's reading order).
 *
 * THE PRECEDENCE IS THE RULE, and each step is a fact that overrides the ones after it:
 *   1. past `length`            -> `unpublished`, because no drill exists to play whatever progress says;
 *   2. in `finished`            -> `done-*`, because a stale `next` must not paint a finished cell as the one to play;
 *   3. equal to `next`          -> `next`;
 *   4. otherwise                -> `published` (unfinished, not handed out: a gap).
 * A `passed` index that is not also `finished` is IGNORED rather than trusted: the server's row parser refuses
 * that contradiction (`progress-row.ts`), and a screen is the wrong place to be more credulous than the parser.
 */
export function blockCells(input: BlockInput): Cell[] {
  const published = Math.max(0, Math.min(Math.floor(input.length), CELL_COUNT));
  const finished = new Set(input.finished.filter((i) => Number.isInteger(i) && i >= 0 && i < CELL_COUNT));
  const passed = new Set(input.passed.filter((i) => finished.has(i)));
  const next = input.next !== null && Number.isInteger(input.next) && input.next >= 0 ? input.next : null;

  const cells: Cell[] = [];
  for (let index = 0; index < CELL_COUNT; index++) {
    let state: CellState;
    if (index >= published) state = 'unpublished';
    else if (finished.has(index)) state = passed.has(index) ? 'done-passed' : 'done-not-passed';
    else if (index === next) state = 'next';
    else state = 'published';
    cells.push({ index, state });
  }
  return cells;
}

/** How the header phrases the block: how many of the published cells are done, and how many were passed. */
export function blockSummary(cells: readonly Cell[]): { done: number; passed: number; published: number; total: number } {
  let done = 0;
  let passed = 0;
  let published = 0;
  for (const cell of cells) {
    if (cell.state !== 'unpublished') published++;
    if (cell.state === 'done-passed') { done++; passed++; }
    else if (cell.state === 'done-not-passed') done++;
  }
  return { done, passed, published, total: cells.length };
}
