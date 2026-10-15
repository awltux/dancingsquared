// Every tunable number the pure core reads, in ONE module.
//
// WHY THEY ARE ALL HERE. DESIGN.md 6 asks for exactly this ("all weights live in one checked-in config
// module so retuning the game is one edit, not a hunt"), and the reason is broader than scoring: a
// number buried in a screen is a number nobody can find when the ladder stalls or generation gets slow.
//
// WHAT IS MEASURED AND WHAT IS CHOSEN. Each value below carries which it is. A chosen value is a
// decision to revisit with playtest data; presenting one of those as measured would be the fabrication
// AGENTS.md 4.1 forbids, so they are labelled.

import { MAX_DEPTH } from './levels.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * How many OPTIONS a step presents, including the correct one. A step needs this many distinct endings, so
 * a board that offers fewer cannot carry a question with this many buttons.
 *
 * MEASURED, and it is the number that decides whether multi-call puzzles exist at all. With it set to 3
 * (the design's "three options"), the generator finds **no usable path** at depth 2 for any pool size up
 * to the corpus's 62 titles: every route from the squared set passes through a board offering fewer than
 * three distinct endings. At depth 3, no board is reachable in exactly three calls. With it set to 2 the
 * search has something to work with, at the cost of one fewer button per step.
 *
 * LEFT AT 3 BY DEFAULT, because 3 is the design's requirement and a published ladder should not quietly
 * be a weaker game than the design asks for. The ladder census prints both, so the trade — three options
 * and depth 1 only, versus two options and depth 2 — is a decision taken from numbers.
 */
export const OPTION_COUNT = 3;

/**
 * The states a single `generatePuzzle` call may enumerate.
 *
 * CHOSEN, and then bounded by measurement: the ladder census prints the explored count and the wall time
 * per level, so this number is revisited from data rather than from taste. It exists because the state
 * space is exponential in `depth` and the pool, and an unbounded search is how a browser tab stops
 * responding — the generator runs on the CLIENT for the Daily (DESIGN.md 4.4), so the budget has to fit a
 * browser rather than a server.
 */
export const NODE_BUDGET = 50_000;

/** The generator's default configuration. `maxDepth` is the ladder's ceiling, so a level's own depth
 * is passed to `generatePuzzle` by the caller that knows the level. */
export const DEFAULT_GENERATOR: GeneratorConfig = {
  poolVersion: 'unknown',
  maxDepth: MAX_DEPTH,
  nodeBudget: NODE_BUDGET,
};

/**
 * The Daily's move allowance: the shortest solution plus this many calls.
 *
 * CHOSEN, not measured, and it is the number DESIGN.md 9 calls "a stated, calibrated number". The
 * allowance exists because with free undo and honest offerings an unlimited budget would let a player
 * eliminate their way to any displayed board, so the allowance plus the waste factor is what makes
 * that lose. Whether the cushion is 2 or 3 is a playtest question, not an arithmetic one.
 */
export const MOVE_ALLOWANCE_CUSHION = 2;

/**
 * The hint penalty, in seconds, folded into the elapsed time (DESIGN.md 10).
 *
 * CHOSEN, not measured. It is deliberately legible — a minute is a thing a player can feel — and
 * deliberately dominant at low levels, where `par` is one call.
 */
export const HINT_PENALTY_SECONDS = 60;

/** The most hints a player may hold at once (DESIGN.md 10). */
export const HINT_CAP = 3;
