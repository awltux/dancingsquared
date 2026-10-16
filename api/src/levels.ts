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
  poolIsComplete,
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
 * The generated puzzle a published seed names, CACHED because a press regenerates it.
 *
 * IT IS THE CACHE THAT MAKES `POST /drill/answer` A CLICK RATHER THAN A PAUSE. Generating costs 167-230 ms at level
 * 1 and 728-1240 ms at levels 2 and 3 on a warm applier (the measurement at the top of this file); `POST /runs`
 * pays that once per run, which is a boundary, while a press happens on every wrong button and paying a fifth of a
 * second for one would be felt. MEASURED (`api/tools/_measure-press.mjs`, a throwaway deleted after it was read):
 * 50 calls with a DIFFERENT seed each cost **158.6 ms** each, while 50 calls with the seed a press re-asks for cost
 * **0.0 ms** each — below the timer's resolution, because the work is a `Map` lookup.
 *
 * THE RETURNED PUZZLE IS SHARED BETWEEN CALLERS. Every reader today only reads (`optionLabels`, the per-step
 * correct option, `lineReachesGoal`'s walk), so this is safe — but a caller that mutated a puzzle would change
 * what every later request is scored against, which is why the contract is stated here rather than discovered.
 *
 * THE POOL VERSION IS NOT IN THE KEY, for the reason the runtime cache gives above: a pool change is a deploy.
 * THE BOUND IS BLUNT ON PURPOSE: the working set is one season's entries at the levels being played, and a clear
 * costs one regeneration rather than leaving an unbounded map in a long-lived container.
 */
const puzzles = new Map<string, GenerateResult>();
const MAX_CACHED_PUZZLES = 64;

export function puzzleFor(seed: number, level: LevelSpec): GenerateResult {
  const key = `${level.index}:${seed}`;
  const cached = puzzles.get(key);
  if (cached) return cached;
  const generated = generatePuzzle(generatorConfigFor(MAIN_POOL.version, level, 'drill'), seed, level, runtimeFor(level).applier);
  if (puzzles.size >= MAX_CACHED_PUZZLES) puzzles.clear();
  puzzles.set(key, generated);
  return generated;
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

/**
 * Every level the corpus can actually fill, lowest first.
 *
 * THE LADDER IS TOTAL AND THE POOL IS NOT, which is the whole of this function: `levelSpec` answers for any
 * positive integer (its pool widens by five every three levels from L4) while the corpus carries a fixed number
 * of titles. MEASURED: that is levels 1..33, and level 34 asks for 65 titles where the corpus carries 62. The
 * loop stops at the first level the corpus cannot fill and terminates by construction, because `poolSize` grows
 * monotonically — so "how far does the game go" is a measurement, not a constant.
 *
 * IT LIVES HERE BECAUSE TWO JOBS NEED IT: the Daily's boundary job publishes a challenge per level, and the
 * schedule publisher authors a season per level, and both must refuse a level nobody can play rather than
 * publish something unservable.
 */
export function publishableLevels(): number[] {
  const levels: number[] = [];
  for (let index = 1; ; index++) {
    const level = levelAt(index);
    if (!poolIsComplete(level, MAIN_POOL)) break;
    levels.push(index);
  }
  return levels;
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
