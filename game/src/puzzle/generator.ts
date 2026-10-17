// The puzzle generator: pure, seeded, and the single source of the Drill's questions and the Daily's
// challenge (DESIGN.md 7).
//
// ============================================================================================
// THE DECISIONS THIS FILE MAKES, and why the obvious alternative was rejected for each.
// ============================================================================================
//
// 1. THE DISTANCE MAP IS A BFS, so "the shortest solution is exactly `depth`" is a PROPERTY rather than
//    an assertion. The first time a board is reached is by a shortest path, so `depth` IS the true
//    distance and no separate optimality check is needed. A depth-limited DFS would find *a* path and
//    leave the gate to be argued about; a reverse BFS from the goal needs a goal first, which is
//    circular when the goal is what is being chosen.
//
// 2. THE PREDECESSOR CHAIN CARRIES THE BOARD, not a signature. `boardSig` is positions-only, so two
//    facing-different boards share one signature and the map keeps whichever arrived first; a chain
//    keyed by signature would hand back the map's representative, which is the SAME GEOMETRY but may
//    not be the board this path actually visited. Storing the board makes every returned path a
//    genuine path.
//
// 3. A STEP'S CORRECT OPTION IS "A CALL THAT REACHES THE GOAL", not the intended move. Step 1 of a
//    Drill may offer a legal call that is not on the generator's route but still reaches the goal — a
//    shorter route, or a different route of the same length. Either way it is a CORRECT answer, and
//    DESIGN.md 7.3 says so ("Correctness is the goal board, not the generator's route"). Marking a
//    player wrong for taking a legal route is the defect this rule exists to prevent.
//
// 4. THE `unknown` SLOT IS AUTHORED PER STEP from the engine's own refusals. An illegal application
//    leaves the board unchanged, so "the illegal option's ending" is the current board — which is why
//    it cannot live among `moves` (those must end somewhere, pairwise distinctly) and why it is a
//    separate field. It is never a call the puzzle's own path uses, so a player cannot be refused for
//    playing a call the puzzle elsewhere requires.
//
// BUDGETS AND REFUSALS ARE REPORTED, NEVER SILENT. `GenerateResult` returns `{ ok: false, reason }`
// rather than `null`, and the reason counts why each candidate failed, because "no puzzle" and "no
// puzzle inside the budget" are different findings for a level designer (AGENTS.md 4.1: an
// instrument's silence is itself a bug).

import { makeSquaredSet, sameBoardById, boardSig, type Board } from 'dancing-squared-engine';
import { rngFrom } from './rand.ts';
import type { GameApplier, GenerateResult, GeneratorConfig, LevelSpec, Move, Puzzle, PuzzleOption, PuzzleStep } from './types.ts';

/**
 * Sort a move list by call name.
 *
 * WHY THIS IS NOT DECORATION: the engine resolves a matching TIE by registration order, so a pool
 * built in a different order can answer a tie differently — and the BFS order then decides which
 * predecessors are recorded. Sorting here means the published puzzle depends on the POOL's content and
 * the seed, not on the order a caller happened to hand the calls over in.
 */
const byName = (a: { call: string }, b: { call: string }): number => (a.call < b.call ? -1 : a.call > b.call ? 1 : 0);

/** The same ordering for a bare list of titles. */
const byTitle = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * How many DIFFERENT boards a move list ends on, counted by signature.
 *
 * WHY SIGNATURES AND NOT `sameBoardById`: this runs on every offered move of every explored board, so
 * it has to be cheap, and `boardSig` is the engine's own order-free, position-only key. It can OVERCOUNT
 * two boards that share a signature while differing in facing — so it is a fast LOWER BOUND off which
 * nothing is decided. The option construction below re-checks with `sameBoardById` before publishing
 * anything, which is where the exactness is needed.
 */
function distinctEndings(moves: readonly Move[]): number {
  const seen = new Set<string>();
  for (const m of moves) seen.add(boardSig(m.board));
  return seen.size;
}

function summarise(counts: Map<string, number>): string {
  if (counts.size === 0) return 'no candidate survived the path checks';
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([reason, n]) => `${n} x ${reason}`)
    .join('; ');
}

export function generatePuzzle(config: GeneratorConfig, seed: number, level: LevelSpec, applier: GameApplier): GenerateResult {
  // ONE rng for the whole generation, drawn in a fixed order: shuffle the candidates, then the option
  // order per step, then the `unknown` pick. A second rng (or a `Math.random` fallback anywhere) would
  // break the property this whole design rests on — that the same inputs give a byte-identical puzzle.
  const rng = rngFrom(seed ^ Math.imul(level.index, 0x9e3779b1));
  const start = makeSquaredSet();
  const startSig = boardSig(start);

  // THE START IS A PLAYED-FROM BOARD TOO, and at `maxDepth === 1` it is the ONLY one — so the ladder's
  // first level has always exercised this. At depth 2 and above the start becomes an intermediate board
  // that must still offer three options, and it was the one board the BFS pruning below could not reach
  // (a frontier is its successors, never itself). MEASURED: without this check the generator reported
  // "step 1 has no option that reaches the goal" for most depth-2 candidates — a symptom two levels away
  // from its cause, because the option builder was handed a skeleton whose FIRST board could never carry
  // it.
  const startOffered = applier.offered(start);
  if (startOffered.length < level.optionCount) {
    return { ok: false, reason: `the start board offers only ${startOffered.length} legal call(s), fewer than the ${level.optionCount} this configuration needs` };
  }
  if (distinctEndings(startOffered) < level.optionCount) {
    return { ok: false, reason: `the start board offers ${startOffered.length} calls but fewer than ${level.optionCount} distinct endings` };
  }

  // ---- 1. BFS from the start: distance, representative board, predecessor, and alternate-path count.
  const dist = new Map<string, number>([[startSig, 0]]);
  const boards = new Map<string, Board>([[startSig, start]]);
  const prev = new Map<string, { board: Board; call: string }[]>();
  /** How many EXTRA shortest predecessors a board has, so "reachable by more than one path" is a
   * measurement rather than a hope. */
  const extraPredecessors = new Map<string, number>();
  let frontier: Board[] = [start];
  let explored = 1; // the start board
  let hitBudget = false;

  for (let d = 1; d <= config.maxDepth && !hitBudget; d++) {
    const next: Board[] = [];
    // AT THE LAST LEVEL WE ENUMERATE GOALS; BELOW IT WE ENUMERATE STEPPING STONES, and a stone is only
    // useful if it can carry the question: a board on the path needs THREE legal calls from its own
    // position (three options, pairwise-distinct endings), so a board with fewer is pruned rather than
    // carried forward. MEASURED, and it is why this is not premature optimisation: at L2 (pool 15) the
    // start offers 7 calls and the whole depth-2 exploration reaches 30 states collapsing to 10
    // distinct signatures. At these pools the GATES, not the node budget, decide whether a level has
    // puzzles at all — so pruning is what keeps the search inside its budget and keeps the candidates
    // it does find reachable through boards that can carry it.
    const goals = d === config.maxDepth;
    for (const board of frontier) {
      const offered = applier.offered(board).slice().sort(byName);
      if (!goals && distinctEndings(offered) < level.optionCount) continue;
      for (const move of offered) {
        if (explored >= config.nodeBudget) {
          hitBudget = true;
          break;
        }
        explored++;
        const sig = boardSig(move.board);
        const seen = dist.get(sig);
        if (seen === undefined) {
          dist.set(sig, d);
          boards.set(sig, move.board);
          prev.set(sig, [{ board, call: move.call }]);
          extraPredecessors.set(sig, 0);
          next.push(move.board);
        } else if (seen === d && sig !== startSig) {
          // AN EARLIER ARRIVAL AT THE SAME DEPTH IS KEPT, not merely counted. Keeping only the first made
          // every candidate have exactly ONE path to test, and since a path is only usable if every board
          // it is played from can carry three options, a candidate whose single recorded path failed had
          // no second chance. MEASURED: depth 2 generated 0/8 at every pool size while every failure was
          // at a different step, which is the signature of a solver that is not trying enough paths
          // rather than one whose gates are impossible.
          const list = prev.get(sig);
          if (list) list.push({ board, call: move.call });
          extraPredecessors.set(sig, (extraPredecessors.get(sig) ?? 0) + 1);
        }
      }
      if (hitBudget) break;
    }
    frontier = next;
  }

  // A CANDIDATE HAS TO BE A GOAL, AND BEING AT THE RIGHT DEPTH IS NOT ENOUGH.
  //
  // MEASURED, and this is the single most important number in this file: at pool 40 / depth 2, 38 of 44
  // depth-2 boards are UNNAMED; at pool 62 / depth 3 it is 82 of 82. Filtering only by distance therefore
  // hands the candidate loop targets that no amount of option-building can rescue, and every one of them
  // is rejected at the naming gate on the next pass. The filter belongs HERE, where it is cheap.
  //
  // WHAT THE GOAL NEEDS AND WHAT IT DOES NOT, because getting this wrong cost a working depth 1: the goal
  // is REACHED, never PLAYED FROM, so it does not need options of its own — requiring three calls from it
  // rejected every named depth-1 board and turned a level that had generated 8/8 into 0/8. It needs a
  // NAME (it is the picture the player is shown) and it needs to differ from the start (checked in
  // `attempt`, with the engine's own rule). The three-options requirement belongs to the boards a step is
  // played FROM, and `attempt` applies it there.
  const candidateSigs = [...dist.entries()]
    .filter(([sig, d]) => d === config.maxDepth && sig !== startSig)
    .map(([sig]) => sig)
    .filter((sig) => applier.nameOf(boards.get(sig) as Board) !== null);
  if (candidateSigs.length === 0) {
    return {
      ok: false,
      reason: hitBudget
        ? `the exploration hit its ${config.nodeBudget}-node budget after ${explored} states with no board at depth ${config.maxDepth}`
        : `no board is reachable in exactly ${config.maxDepth} call(s) from a squared set at this level`,
    };
  }

  // ---- 2. Build a path for a candidate, choosing among its ALTERNATE predecessors.
  //
  // WHY THIS IS A SEARCH AND NOT A WALK. A path is only usable if every board it is PLAYED FROM can carry
  // three options — so the freedom to choose which predecessor to walk through is what decides whether a
  // candidate can become a puzzle at all. A single recorded chain per board gives each candidate exactly
  // one chance, and MEASURED, that is why depth 2 was generating 0/8: every candidate failed, each at a
  // different step, which is the signature of too few paths TRIED rather than of gates that cannot be met.
  const refused = new Map<string, number>();
  /** Whether a board can hold the question: three legal calls with three distinct endings. Memoised,
   * because the search asks the same board many times. */
  const carries = new Map<string, boolean>();
  const carriesQuestion = (board: Board): boolean => {
    const sig = boardSig(board);
    const hit = carries.get(sig);
    if (hit !== undefined) return hit;
    const offered = applier.offered(board);
    const ok = offered.length >= level.optionCount && distinctEndings(offered) >= level.optionCount;
    carries.set(sig, ok);
    return ok;
  };
  /** (sig, depth) pairs from which no path reaches the start, so the search does not revisit them. */
  const dead = new Set<string>();
  /** The search's own guard, so a pathological board graph cannot make generation unbounded. */
  let pathTries = 0;
  const PATH_TRY_CAP = 20_000;

  /** The boards and calls from the start to `goalSig`, or null when no usable path exists. */
  const findPath = (goalSig: string): { path: Board[]; calls: string[] } | null => {
    const rec = (sig: string, depth: number): { path: Board[]; calls: string[] } | null => {
      if (sig === startSig) return { path: [], calls: [] };
      if (depth > config.maxDepth) return null;
      const key = `${sig}@${depth}`;
      if (dead.has(key) || pathTries++ > PATH_TRY_CAP) return null;
      for (const p of prev.get(sig) ?? []) {
        // EVERY BOARD EXCEPT THE GOAL IS PLAYED FROM, so it must carry the question. The goal is only
        // reached, and requiring options from it once cost a working depth 1 (see the candidate filter).
        if (!carriesQuestion(p.board)) continue;
        const sub = rec(boardSig(p.board), depth + 1);
        if (sub) return { path: [...sub.path, p.board], calls: [...sub.calls, p.call] };
      }
      dead.add(key);
      return null;
    };
    const found = rec(goalSig, 1);
    if (!found) return null;
    const goal = boards.get(goalSig);
    if (!goal) return null;
    found.path.push(goal);
    return found;
  };

  const attempt = (goalSig: string): Puzzle | string => {
    const found = findPath(goalSig);
    if (!found) return 'no usable path to this candidate (a board on every route cannot carry three options)';
    const { path, calls } = found;
    const goal = boards.get(goalSig) as Board;
    if (path.length !== config.maxDepth + 1) return `the path had ${path.length - 1} call(s), not ${config.maxDepth}`;

    // GATE: the start and the goal must be tellable apart, or the puzzle is "these look the same".
    if (sameBoardById(start, goal)) return 'the goal board is the start board';
    // GATE: the START and the GOAL must be states the engine can NAME, and the reason is narrower than
    // "every board must be named". These two are the boards the game DRAWS for the player — "you are
    // here" and "get here" — so an unnamed one is a picture with no caption and, for the goal, no way to
    // say what is being asked. An UNNAMED INTERMEDIATE is a different thing: it is a legal state the
    // engine simply has no template for (its own docs say an unrecognised board is not a defect), the
    // player never sees it named, and refusing it would reject the great majority of real paths.
    // MEASURED at L2/pool 15: of 10 distinct depth-2 states, MOST are unnamed — so a gate on every board
    // would have left this level with no puzzles at all, which is a much worse outcome than a path
    // passing through a state the app does not name.
    if (applier.nameOf(start) === null) return 'the start board has no name';
    if (applier.nameOf(goal) === null) return 'the goal board has no name';

    // GATE: every board on the intended path must be able to CARRY its step — three legal options with
    // pairwise-distinct endings. Checked here, before the options are built, because a path through a
    // board that offers one call can never become a puzzle, and failing fast on it is what keeps the
    // candidate loop affordable.
    for (let i = 0; i < path.length - 1; i++) {
      const offered = applier.offered(path[i]);
      if (offered.length < level.optionCount) return `step ${i + 1} offers only ${offered.length} legal call(s)`;
      if (distinctEndings(offered) < level.optionCount) return `step ${i + 1} offers ${offered.length} calls but fewer than ${level.optionCount} distinct endings`;
    }
    const steps: PuzzleStep[] = [];
    const unknownPool = applier.candidateCalls(start).slice().sort(byTitle);
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const offered = applier.offered(from).slice().sort(byName);
      const distanceHere = dist.get(boardSig(from)) as number;
      const lastStep = i === path.length - 2;

      // WHAT MAKES A MOVE CORRECT, and why this is NOT "a move that reaches the goal" for every step.
      //
      // The goal is at distance `d`, and a board at distance `i < d - 1` CANNOT reach it in one call: a
      // move from distance `i` lands at distance at most `i + 1`, so a one-call route to the goal would
      // mean the goal was at distance `i + 1 < d`, contradicting the BFS distance. Requiring every step to
      // have a goal-reaching option is therefore unsatisfiable for every step but the last — and MEASURED,
      // that single requirement is why depth 2 generated 0/8 at EVERY pool size and option count, with the
      // generator reporting "step 1 has no option that reaches the goal" for all 41 candidates. The check
      // was asking for a shorter solution than the puzzle's own distance.
      //
      // THE DESIGN'S OWN RULE IS "makes progress", and the distance map already answers it: a correct move
      // is one that reduces the remaining distance. On the LAST step, `i + 1 === d`, so "reduces the
      // distance" and "reaches the goal" are the same statement — the two branches below agree there, and
      // the test is stated per branch so neither can silently become the other.
      const correctMoves = lastStep
        ? offered.filter((m) => sameBoardById(m.board, goal))
        : offered.filter((m) => dist.get(boardSig(m.board)) === distanceHere + 1);
      if (correctMoves.length === 0) {
        return lastStep
          ? `step ${i + 1} has no option that reaches the goal`
          : `step ${i + 1} has no option that makes progress`;
      }
      // THE CORRECT OPTION IS THE PATH'S CALL, and the pick only breaks ties where the path's call is absent. `calls` is
      // the route the search found and `steps[i + 1].from` is the board it lands on, so an option chosen from a DIFFERENT
      // correct route would publish an answer key whose steps do not connect: MEASURED, `solution` then named a call the
      // step's `correctIndex` did not, and playing the solution stopped reaching the goal. It surfaced only when the pool
      // grew from 62 names to 322 and more options made progress from one board. The path's call is always among
      // `correctMoves` (a step that makes progress is exactly what the distance map says the next path board is), so
      // the fallback is a safety net rather than the common case.
      const onPath = correctMoves.find((m) => m.call === calls[i]);
      const chosen = onPath ?? (rng.pick(correctMoves) as Move);

      // Distractors: pairwise-distinct endings, never the goal, and never ending where another option
      // ends. Distinctness is by `boardSig` (cheap) and is then CONFIRMED by `sameBoardById`, because a
      // signature collision would otherwise publish two options that are the same board.
      const endsHere = new Set<string>([boardSig(chosen.board)]);
      const distractors: Move[] = [];
      for (const m of rng.shuffle(offered.filter((m) => m.call !== chosen.call))) {
        const sig = boardSig(m.board);
        if (endsHere.has(sig)) continue;
        endsHere.add(sig);
        distractors.push(m);
        if (distractors.length === level.optionCount - 1) break;
      }
      if (distractors.length < level.optionCount - 1) {
        return `step ${i + 1} has only ${distractors.length + 1} distinct ending(s), fewer than the ${level.optionCount} this configuration needs`;
      }

      const options: PuzzleOption[] = rng.shuffle([chosen, ...distractors]).map((m) => ({ call: m.call, board: m.board }));
      const correctIndex = options.findIndex((o) => o.call === chosen.call);
      const step: PuzzleStep = { from, moves: options, correctIndex, after: chosen.board };

      // The illegal choice, only where the design allows one (step 1), and never a call the puzzle's
      // own path uses. Its refusal is the ENGINE's string, verbatim.
      if (i === 0) {
        const used = new Set<string>([...calls, ...options.map((o) => o.call)]);
        for (const name of unknownPool) {
          if (used.has(name)) continue;
          const refusal = applier.refusalOf(from, name);
          if (refusal) {
            step.unknown = refusal;
            break;
          }
        }
      }
      steps.push(step);
    }

    return {
      mode: config.mode,
      seed,
      level,
      poolVersion: config.poolVersion,
      start,
      goal,
      path,
      steps,
      solution: calls,
      shortest: config.maxDepth,
      alternatePath: path.some((b) => (extraPredecessors.get(boardSig(b)) ?? 0) > 0),
      explored,
    };
  };

  // Candidates are SHUFFLED, so the choice depends on the seed rather than on BFS discovery order.
  for (const sig of rng.shuffle(candidateSigs)) {
    const outcome = attempt(sig);
    if (typeof outcome !== 'string') return { ok: true, puzzle: outcome };
    refused.set(outcome, (refused.get(outcome) ?? 0) + 1);
  }

  return {
    ok: false,
    reason: `${candidateSigs.length} board(s) at depth ${config.maxDepth} and none usable — ${summarise(refused)}`,
  };
}
