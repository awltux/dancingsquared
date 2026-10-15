// The level runtimes and the generation the endpoints need, on the server.
//
// WHY THERE IS A CACHE HERE AND NOT IN `game/src/data/corpus-node.ts`. Building an applier parses
// `moves.xml`, `formations.xml` and the level's call files and constructs a sequencer over them. MEASURED
// (`api/tools/_measure-applier.mjs`, a throwaway deleted after it was read): importing the loader costs
// 357 ms (the two files), the FIRST applier costs 2026 ms because it also parses the 66 call files, each
// further level costs ~620-840 ms, and generating one puzzle on top of a warm applier costs 167-230 ms at
// level 1 and 728-1240 ms at levels 2 and 3. A server that built an applier per request would pay that on
// every request; a Lambda that keeps it for the container's life pays it once per cold start — which is
// 0.4 s + up to 3.6 s for all three levels, and therefore a reason for the deployed function's timeout to be
// well above its default rather than a reason to cache nothing.
//
// THE CACHE IS KEYED BY LEVEL INDEX AND THE POOL VERSION IS NOT IN THE KEY, which is safe only because a pool
// change is a DEPLOY: `MAIN_POOL.version` comes from `src/puzzle/pool.ts`, the process reads it at start, and
// no request can change it. The comment is here because a caller caching across a republished pool would be
// reusing a stale sequencer.

import {
  MAIN_POOL,
  generatePuzzle,
  generatorConfigFor,
  levelSpec,
  poolFor,
  type GenerateResult,
  type LevelSpec,
  type Puzzle,
} from 'dancing-squared-game';
import { applierFor } from 'dancing-squared-game/corpus-node';

type Runtime = ReturnType<typeof applierFor>;

const runtimes = new Map<number, Runtime>();

/**
 * The level at an index.
 *
 * THERE IS NO "UNKNOWN LEVEL", and that is a property of the ladder rather than a choice made here:
 * `levelSpec` is total and closed-form, so every positive integer IS a level (its pool widens by five every
 * three levels from L4 and its depth stops at 2). The endpoints therefore refuse an index by the absence of
 * its SCHEDULE (`no_schedule`), not by not being a level — and the cast below is not a lie, it is the fact
 * that `levelParam` only ever hands this function a positive integer.
 */
export function levelAt(levelIndex: number): LevelSpec {
  return levelSpec(levelIndex) as LevelSpec;
}

/**
 * The applier for a level, built once per process.
 *
 * IT NEVER RETURNS NULL FOR A VALID LEVEL, and `levelAt` is what the callers check first — a level index that
 * is not in the ladder is a client error with its own refusal, not a crash here.
 */
export function runtimeFor(level: LevelSpec): Runtime {
  const cached = runtimes.get(level.index);
  if (cached) return cached;
  const runtime = applierFor(poolFor(level, MAIN_POOL), level.poolSize);
  runtimes.set(level.index, runtime);
  return runtime;
}

/**
 * Generate the puzzle a published seed names.
 *
 * THE SERVER RUNS THE SAME GENERATOR AS THE CLIENT, over the same seed, level and pool version — which is
 * what makes the option labels in a response a CROSS-CHECK rather than an invention (DESIGN.md 11: "the
 * server re-runs the same generator"). A refusal is passed through with the generator's own reason: a
 * published seed that no longer generates is a finding about the schedule (§7.2's lint), and inventing an
 * answer here would hide it.
 */
export function puzzleFor(seed: number, level: LevelSpec): GenerateResult {
  return generatePuzzle(generatorConfigFor(MAIN_POOL.version, level, 'drill'), seed, level, runtimeFor(level).applier);
}

/**
 * The three option labels of the puzzle's FIRST step, in order.
 *
 * IT IS STEP ONE BECAUSE THAT IS WHAT THE PLAYER IS ASKED FIRST. A depth-2 drill's step 2 labels are a
 * different question, and the client derives them from the same seed anyway; what the response carries is the
 * label set a client can compare against its own generation before it draws anything.
 */
export function optionLabels(puzzle: Puzzle): string[] {
  return (puzzle.steps[0]?.moves ?? []).map((move) => move.call);
}

/** How many of a level's titles the corpus actually carries — reported, never asserted (the ladder census). */
export function registeredFor(level: LevelSpec): number {
  return runtimeFor(level).registered;
}

/**
 * Whether a move list, played from the puzzle's start board, actually reaches its goal.
 *
 * THIS IS THE DAILY'S VERIFICATION. The Drill re-derives which option was correct at each step, which needs
 * only the generated puzzle; the Daily's submission is a LINE the player built, so it has to be walked — and
 * walking it is the engine's job, through the same applier the client walked (DESIGN.md 4.4: "the client
 * sequencer is the same sequencer the server used"). A refusal carries the engine's own reason verbatim, or a
 * sentence of this function's for the two cases the engine cannot have an opinion about (a line that stops
 * short of the goal, and one that is longer than the allowance the level allows).
 *
 * IT APPLIES EACH CALL RATHER THAN TRUSTING A FINAL BOARD, because the final board is exactly what a modified
 * client would forge. A line that reaches the goal BY A DIFFERENT ROUTE than the generator's is legitimate and
 * scores the same — the goal test is `boardsMatch`, never a comparison with `puzzle.solution`.
 */
export function lineReachesGoal(level: LevelSpec, puzzle: Puzzle, calls: readonly string[]): { ok: true } | { ok: false; reason: string } {
  const applier = runtimeFor(level).applier;
  let board = puzzle.start;
  for (const call of calls) {
    const refusal = applier.refusalOf(board, call);
    if (refusal) return { ok: false, reason: `"${call}" cannot be made from that board: ${refusal.reason}` };
    board = applier.apply(board, call);
  }
  if (!applier.boardsMatch(board, puzzle.goal)) return { ok: false, reason: 'the line does not leave the set on the goal board' };
  return { ok: true };
}
