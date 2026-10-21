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
  PlaySession,
  dailySpec,
  generatePuzzle,
  generatorConfigFor,
  levelSpec,
  poolFor,
  poolIsComplete,
  type GenerateResult,
  type LevelSpec,
  type Puzzle,
  type PuzzleMode,
} from 'dancing-squared-game';
import { applierFor } from 'dancing-squared-game/corpus-node';
import type { ItemStore } from './ports.ts';
import { publishedDailyKey } from './keys.ts';
import type { DailyMove } from './daily-line.ts';

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
 * THE RETURNED PUZZLE IS SHARED BETWEEN CALLERS. Every reader today only reads (the per-step correct option,
 * `lineReachesGoal`'s walk, and — now that the client generates nothing — the `GET /drill/current` and
 * `GET /puzzle` bodies), so this is safe, but a caller that mutated one would change what every later request is
 * scored against. **A HANDLER MUST NOT MUTATE IT**: the served body holds a reference to this object, and a
 * projection that edited it in place would rewrite the answer key the press log and the run scoring read back.
 *
 * THE MODE IS A REQUIRED ARGUMENT AND PART OF THE KEY. It has no default, and that is the point: a Daily and a
 * Drill may share a seed and a level and are still two labels on the same boards, and `mode` is stamped on the
 * puzzle (MEASURED, it was `drill` on every Daily before `generatorConfigFor` took the argument, and
 * `game/test/config-probe.mjs` pins it). MEASURED while this became a required argument: five call sites were
 * quietly generating DAILY puzzles through the drill's config, because the default hid which one they meant — and
 * a default here is a call site that does not say what it is generating, which is the class of defect that made
 * the parameter necessary.
 *
 * THE POOL VERSION IS NOT IN THE KEY, for the reason the runtime cache gives above: a pool change is a deploy.
 * THE BOUND IS BLUNT ON PURPOSE: the working set is one season's entries at the levels being played, and a clear
 * costs one regeneration rather than leaving an unbounded map in a long-lived container.
 */
const puzzles = new Map<string, GenerateResult>();
const MAX_CACHED_PUZZLES = 64;

export function puzzleFor(seed: number, level: LevelSpec, mode: PuzzleMode): GenerateResult {
  const key = puzzleKey(seed, level, mode);
  const cached = puzzles.get(key);
  if (cached) return cached;
  // THE DAILY IS ASKED IN ITS OWN DEPTH, applied at this boundary: `DAILY_DEPTH` calls at every level, where the
  // Drill's depth is the level's (DESIGN.md §9, and `game/src/puzzle/levels.ts` on why the two differ).
  const spec = mode === 'daily' ? dailySpec(level) : level;
  const generated = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec, mode), seed, spec, runtimeFor(level).applier);
  if (puzzles.size >= MAX_CACHED_PUZZLES) puzzles.clear();
  puzzles.set(key, generated);
  return generated;
}

/** The cache key for one puzzle: the mode, the level and the seed, as `puzzleFor` documents. */
function puzzleKey(seed: number, level: LevelSpec, mode: PuzzleMode): string {
  return `${mode}:${level.index}:${seed}`;
}

/**
 * The puzzle ONLY IF IT IS ALREADY IN THE CACHE, or null — the half of `puzzleFor` a READ may ask without paying for a
 * generation.
 *
 * WHY THIS EXISTS. Generating a Daily costs 9.4-15.1 s (MEASURED, DESIGN.md §7.1), and `GET /puzzle` used to generate
 * INSIDE the request: one read held the connection open for that long, and on a single-threaded server every other
 * request queued behind it — reported as "the Today's Daily button … the app still hangs". The read now answers
 * `202 Accepted { ready: false }` and the client POLLS, so the work is started once and observed, never waited on
 * inside one request.
 */
export function cachedPuzzle(seed: number, level: LevelSpec, mode: PuzzleMode): GenerateResult | null {
  return puzzles.get(puzzleKey(seed, level, mode)) ?? null;
}

/**
 * START the generation for a puzzle, without waiting for it, so a `202` can be answered first.
 *
 * THE DEFERRAL IS THE POINT. `puzzleFor` is synchronous CPU work, so a caller that awaited it would block the very
 * response it is trying to send. `setTimeout(0)` puts it after the current turn, which is after the handler has
 * returned and the HTTP layer has flushed — so the client gets its `202` before the work begins.
 *
 * IT IS NOT A QUEUE, and that is deliberate rather than a shortcut: two reads that arrive while nothing is cached both
 * schedule a generation, and the second one is a cache HIT by the time it runs (the first has finished), so at most one
 * generation's worth of work happens. A real queue would have to track in-flight keys and would not make the CPU work
 * any cheaper. What it does NOT do is keep the server responsive DURING the generation — that is a worker thread or a
 * separate process, and is the next step if this still bites (recorded in the commit that added this).
 */
export function preparePuzzle(seed: number, level: LevelSpec, mode: PuzzleMode): void {
  if (cachedPuzzle(seed, level, mode)) return;
  setTimeout(() => {
    puzzleFor(seed, level, mode);
  }, 0);
}

/**
 * The start board's grouped move list, for a client that would otherwise have to compute it before it can draw a
 * picker.
 *
 * WHY THE SERVER SHIPS IT. `Sequencer.applicableMoves` is `legalCalls x subsetGroups` applicator runs — MEASURED,
 * 1754 ms at 322 titles on a squared set and 22 ms one call in — and a level's pool is up to 320 titles, so the very
 * first render of a Daily is the expensive one. The server has the applier warm (it generated the puzzle with it) and
 * the list is a pure function of the start board, so it costs this response nothing it was not already paying.
 *
 * IT IS AN OPTIMISATION, NOT A CONTRACT: the client can compute the same list for the same board and does so for
 * every board it reaches after this one. A client that does not receive it is slower for one render, not broken —
 * which is why the field is tolerated as missing on the wire.
 */
export function startReadings(puzzle: Puzzle, level: LevelSpec): { call: string; selection: string | null; board: Puzzle['start'] }[] {
  return runtimeFor(level).applier.readings(puzzle.start);
}

/**
 * THE OPTION LABELS USED TO BE HERE, and they are gone with the reason they existed: `optionLabels(puzzle)` returned
 * the first step's three calls so a client could cross-check its own generation, and MEASURED no client ever read the
 * field. It is replaced by the puzzle itself, because the client no longer generates (`startReadings` above is the
 * other half of that: what it needs before its first render, rather than a number to check).
 */

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

/**
 * The Daily's line, derived from the moves the server recorded (DESIGN.md §11.1, A22's Daily half).
 *
 * IT DRIVES THE SAME SESSION THE CLIENT DROVE, which is the point rather than a convenience. `PlaySession` is what
 * DEFINES add/undo/redo — a new call truncates the redo branch, an undo pushes onto it, an illegal or over-budget
 * call is dropped instead of recorded — so a server-side reimplementation of that would be exactly the second
 * implementation DESIGN.md §4.4 forbids ("the client sequencer is the same sequencer the server used"). What this
 * returns IS the client's own history, which is why the two sides cannot disagree about what the player played.
 *
 * THE ALLOWANCE IS THE SESSION'S. A log that tried to play more calls than the puzzle allows derives a SHORTER line
 * rather than an error, because the budget is enforced as the moves are replayed — exactly as it was in the browser.
 * That is why the submission no longer needs an allowance check of its own: it had one, and it is now unreachable.
 *
 * THE COST IS ONE SESSION PER SUBMISSION, not per move: `POST /daily/move` records a move without generating
 * anything (the client already knows its own line), and the puzzle is generated once here, where `verifyDaily`
 * needs it anyway. A move endpoint that generated the puzzle would pay the generator on every click.
 */
export function replayDailyMoves(level: LevelSpec, puzzle: Puzzle, moves: readonly DailyMove[]): string[] {
  return sessionWith(level, puzzle, moves).moves;
}

/**
 * The call a hint names, from the board the RECORDED line leaves the player on (DESIGN.md §10, A23's naming).
 *
 * THE LOOK-UP IS `PlaySession.hint()` — THE SAME FUNCTION THE APP CALLS — and that is the point rather than a
 * convenience. §10's rule is "name one call that makes progress from where the player is", and a second
 * implementation here would be a server naming one call while the screen showed another. What the SERVER adds is the
 * BOARD: it replays the recorded line, so the hint is named from the position the server watched the player reach,
 * where the client names from the position IT believes it is on — which can lag by a move that has not landed.
 *
 * NULL IS AN ANSWER: a board with nothing offered is a state a player can be in (a dead end), and "no call" is the
 * honest name rather than an invented one.
 */
/**
 * THE DISTANCE TABLES THE HINT BUILDS, SHARED BY EVERY HINT ON THIS PROCESS.
 *
 * THE SESSION OWNS ITS TABLE, AND THAT WAS THE DEFECT: `PlaySession.distanceCache` is per object, while the table
 * is a property of the PUZZLE (its goal and the allowance). The server builds a session per hint spend
 * (`sessionWith` replays the recorded moves to find the board), so it rebuilt the reverse BFS for every hint.
 * MEASURED at the shipped level-1 pool: ONE build is 79-91 s, so a hint cost a minute and a half, every time, and
 * `api/test/hint-event-probe.mjs` measured 770 s for its eight-odd spends.
 *
 * THE KEY IS THE GOAL'S SIGNATURE, INSIDE THE SESSION (the session already keys its cache that way), so one map
 * serves every puzzle this process names a hint for. The bound is blunt and small for the reason `puzzleFor`'s
 * gives: a hint answers about the puzzle a player is on, and a clear costs one rebuild rather than an unbounded
 * map in a long-lived container.
 */
const hintDistanceTables = new Map<string, Map<string, number>>();
const MAX_CACHED_HINT_TABLES = 16;

function sharedHintTables(): Map<string, Map<string, number>> {
  if (hintDistanceTables.size >= MAX_CACHED_HINT_TABLES) hintDistanceTables.clear();
  return hintDistanceTables;
}

export function nameHintFor(level: LevelSpec, puzzle: Puzzle, moves: readonly DailyMove[]): string | null {
  return sessionWith(level, puzzle, moves, sharedHintTables()).hint();
}

/**
 * The published challenge's puzzle, or a refusal — the read a handler needs before it can name or walk a line.
 *
 * IT IS THE SAME ROW `verifyDaily` READS, with the same three refusals (`no_published_daily`, `unreadable_daily`,
 * `stale_pool`); that function keeps its own copy because its MESSAGES are pinned by `runs-probe.mjs` and it needs
 * the seed for the audit row rather than the puzzle. This one is for the readers that need the puzzle and nothing
 * else, which is what the hint's look-up is.
 */
export async function publishedPuzzle(
  store: ItemStore,
  levelIndex: number,
  day: string,
): Promise<{ ok: true; seed: number; puzzle: Puzzle } | { ok: false; status: number; code: string; message: string }> {
  const stored = await store.get(publishedDailyKey(levelIndex, day));
  if (!stored) {
    return { ok: false, status: 404, code: 'no_published_daily', message: `level ${levelIndex} has no published challenge for ${day}` };
  }
  const value = stored.value as { seed?: unknown; poolVersion?: unknown };
  if (typeof value.seed !== 'number' || typeof value.poolVersion !== 'string') {
    return { ok: false, status: 503, code: 'unreadable_daily', message: `the published challenge for ${day} is not a record this build can read` };
  }
  if (value.poolVersion !== MAIN_POOL.version) {
    return { ok: false, status: 409, code: 'stale_pool', message: `the challenge was published against pool ${value.poolVersion}, and this build serves ${MAIN_POOL.version}` };
  }
  const generated = puzzleFor(value.seed, levelAt(levelIndex), 'daily');
  if (!generated.ok) {
    return { ok: false, status: 503, code: 'unplayable_daily', message: `the published challenge does not generate: ${generated.reason}` };
  }
  return { ok: true, seed: value.seed, puzzle: generated.puzzle };
}

/**
 * A session on `puzzle`, with `moves` replayed into it.
 *
 * THE REPLAY LOOP LIVES HERE ONCE, so the reader that needs the LINE and the reader that needs the BOARD the line
 * leaves cannot drift apart — which is the drift `nameHintFor` exists to remove.
 */
function sessionWith(level: LevelSpec, puzzle: Puzzle, moves: readonly DailyMove[], distanceCache?: Map<string, Map<string, number>>): PlaySession {
  const session = new PlaySession(puzzle, runtimeFor(level).applier, undefined, distanceCache);
  for (const move of moves) {
    if (move.kind === 'add') session.play(move.call);
    else if (move.kind === 'undo') session.undo();
    else session.redo();
  }
  return session;
}
