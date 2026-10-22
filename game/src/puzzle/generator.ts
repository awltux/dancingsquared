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
// 5. THE START IS ONE OF THE LEVEL'S OWN FORMATIONS, and the seed chooses which. The generator used to
//    open every question on a squared set, while a level's pool declares dozens of formations — a pool
//    of 57 titles at level 1 declares 67. MEASURED over the first 100 level-1 seeds, that constant start
//    produced **1 start board, 5 distinct goal boards and 77 distinct puzzles**: every drill was the same
//    square with a different pair of buttons, which is the reported "all drills look identical" as a
//    number. The same seeds over the level's own formations give **15-17 starts, 37 goals and the same 77
//    puzzles**. The start boards themselves come from the applier (`startBoards`), because which formations
//    a level's calls declare is engine knowledge; WHICH of them a particular puzzle opens on is a seeded
//    choice, so it belongs here where a probe can reproduce it.
//
//    AND THE VARIETY IS NOT COSMETIC. A squared set offers 40 of level 1's 57 titles; `Bend the Line`,
//    `California Twirl`, `Cast Off Three Quarters`, `Double Pass Thru`, `Box Circulate` and `Boys Trade`
//    are never offered from one, because they need a line, a wave, a column or a diamond. So asking every
//    question from home leaves a third of the level's own vocabulary unteachable — the start set is what
//    makes the pool's later titles into questions at all.
//
// BUDGETS AND REFUSALS ARE REPORTED, NEVER SILENT. `GenerateResult` returns `{ ok: false, reason }`
// rather than `null`, and the reason counts why each candidate failed, because "no puzzle" and "no
// puzzle inside the budget" are different findings for a level designer (AGENTS.md 4.1: an
// instrument's silence is itself a bug).

import { sameBoardById, boardSig, type Board } from 'dancing-squared-engine';
import { arrangementKey, reachedGoal } from './arrangement.ts';
import { poseKey } from './pose-key.ts';
import { rngFrom, type Rng } from './rand.ts';
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

/**
 * Why `start` cannot open a puzzle at this level, or `null` when it can.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO CHECKS. Every candidate start has to be tested before the search
 * can be ordered (a start that cannot carry the question is not a candidate), and the SAME sentences are
 * what the refusal report is built from — so the rule exists once, and the filter and the report cannot
 * disagree about why a formation was skipped. It is also the only place these three statements are made,
 * so the attempt below does not repeat them: a start that reaches the search has already passed.
 *
 * THE THREE RULES, with the alternative each rules out:
 *  - THE START MUST BE NAMED. It is one of the two pictures the player is shown ("you are here"), so an
 *    unnamed board is a picture with no caption. This is also why `recognize` and not `knownFormation`
 *    is the namer: the two disagree on purpose (AGENTS.md trap 10), and the one the screen uses is the
 *    one that must answer here.
 *  - IT MUST OFFER `optionCount` LEGAL CALLS, or the question cannot be asked from it at all.
 *  - THOSE CALLS MUST END SOMEWHERE DIFFERENT, or the step offers two buttons that do the same thing.
 */
function startRefusal(start: Board, level: LevelSpec, applier: GameApplier): string | null {
  // THE START DOES NOT HAVE TO BE NAMED, and it did. The rule was "the start and the goal are the two pictures the
  // player is shown, so an unnamed one is a picture with no caption" — but the start is shown with the player
  // STANDING ON IT, so its caption is "Setup, k of n" and the name is an aside. MEASURED what the rule cost: at level
  // 1, 24 of the 44 declared formations have no recogniser name, so the level could only ever open on 20 of them —
  // and the same naming gate is what leaves the 100-drill block opening on 12.
  //
  // THE GOAL KEEPS ITS NAME (`build` refuses an unnamed one): it is the picture the player must RECOGNISE, and the
  // caption over it is the only text that can say what they are aiming at.
  const offered = applier.offered(start);
  if (offered.length < level.optionCount) {
    return `the start offers only ${offered.length} legal call(s), fewer than the ${level.optionCount} this configuration needs`;
  }
  if (distinctEndings(offered) < level.optionCount) {
    return `the start offers ${offered.length} calls but fewer than ${level.optionCount} distinct endings`;
  }
  return null;
}

function summarise(counts: Map<string, number>): string {
  if (counts.size === 0) return 'no candidate survived the path checks';
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([reason, n]) => `${n} x ${reason}`)
    .join('; ');
}

/**
 * The start census for one applier at one option count — WHICH of `startBoards()` can open a puzzle —
 * memoised, because it is a pure function of the applier's registration and costs one `offered` per
 * declared formation.
 *
 * WHY A MEMO AND NOT JUST A BIGGER `offered` CACHE. MEASURED at level 3 (pool 65, 47 declared formations,
 * 21 of them named): the census is ~45 `offered` calls, and a level's block is 100 drills generated from
 * ONE applier — so a generator that re-asked it per puzzle paid it 100 times. MEASURED over the first 100
 * seeds of each level, mean generation time: level 1 **70 -> 41 ms**, level 3 (depth 2) **670 -> 468 ms**,
 * level 6 (depth 2) **732 -> 488 ms**. The alternative — growing `offered`'s bound until the census is
 * cache-resident — is a blunt constant changed for one caller, and this is one array of 21 boards.
 *
 * KEYED BY THE APPLIER INSTANCE, which is what makes the memo honest: the registered titles cannot change
 * for an applier's life, so the census cannot either — and an applier that goes away takes its entry with
 * it. The option count is the second key because it is the level, and two levels may share one applier in
 * a probe.
 *
 * IT IS A MEMO AND NOT A RULE: it returns the same answer the first call computed, so a probe that builds
 * a fresh applier measures the same thing the server does.
 */
const startCensus = new WeakMap<GameApplier, Map<number, { candidates: Board[]; refused: Map<string, number> }>>();

function censusFor(applier: GameApplier, level: LevelSpec): { candidates: Board[]; refused: Map<string, number> } {
  let perOptionCount = startCensus.get(applier);
  if (!perOptionCount) {
    perOptionCount = new Map();
    startCensus.set(applier, perOptionCount);
  }
  const cached = perOptionCount.get(level.optionCount);
  if (cached) return cached;
  const candidates: Board[] = [];
  const refused = new Map<string, number>();
  for (const board of applier.startBoards()) {
    const refusal = startRefusal(board, level, applier);
    if (refusal) refused.set(refusal, (refused.get(refusal) ?? 0) + 1);
    else candidates.push(board);
  }
  const census = { candidates, refused };
  perOptionCount.set(level.optionCount, census);
  return census;
}

export function generatePuzzle(config: GeneratorConfig, seed: number, level: LevelSpec, applier: GameApplier): GenerateResult {
  // ONE BASE MIX FOR EVERY DRAW THIS GENERATION MAKES, so the whole puzzle is a function of `(seed, level)`
  // and nothing else. A `Math.random` fallback anywhere, or a second independent stream, would break the
  // property the design rests on — that the same inputs give a byte-identical puzzle.
  const base = seed ^ Math.imul(level.index, 0x9e3779b1);

  // ---- 0. WHICH STARTS ARE ON THE TABLE.
  //
  // THE CHOICE IS WHICH START, NOT WHETHER THERE IS ONE, which is why this is a filtered candidate list and
  // not a fallback chain: a formation that cannot carry the question is not a weaker candidate, it is not a
  // candidate, and the report says so by name count rather than by silently trying it.
  const census = censusFor(applier, level);
  const candidates = census.candidates;
  // COPIED, because the attempt failures below are added to this same tally and the census's own map is
  // memoised — writing to it would make one seed's report depend on which seeds ran before it.
  const refused = new Map(census.refused);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: `none of the level's ${applier.startBoards().length} declared formation(s) can open a puzzle — ${summarise(refused)}`,
    };
  }

  // THE ORDER THE STARTS ARE TRIED IN IS THE SEEDED DECISION, and it is one draw rather than one per
  // attempt: the shuffle is what makes a level's whole supply of starts reachable, and drawing it once
  // keeps the attempt below free to own its own stream.
  const order = rngFrom(base).shuffle(candidates);

  // THE BUDGET IS PER GENERATION, NOT PER START — otherwise a level with twenty formations would have
  // twenty times the budget and a pathological board graph could run for twenty times as long. It is
  // shared state, which is exactly why it is declared here and not inside `attempt`.
  let explored = 0;
  let hitBudget = false;

  /**
   * A puzzle whose start is `start`, or the sentence saying why this start gave none.
   *
   * THE RNG IS THE ATTEMPT'S OWN, derived from the seed and the attempt's ORDINAL. A single stream shared
   * across attempts would make every start's questions depend on how much of it earlier, failed starts
   * consumed — so a start that newly becomes viable would rewrite the puzzles of the starts after it, and
   * the pool edit that caused it would be invisible. Deriving it per attempt keeps each start's draws its
   * own; the ordinal is what makes them different from each other.
   */
  const attempt = (start: Board, rng: Rng): Puzzle | string => {
    const startSig = boardSig(start);

    // ---- 1. BFS from the start: distance, representative board, predecessor, and alternate-path count.
    const dist = new Map<string, number>([[startSig, 0]]);
    const boards = new Map<string, Board>([[startSig, start]]);
    const prev = new Map<string, { board: Board; call: string }[]>();
    /**
     * EVERY BOARD ARRIVED AT THE LAST DEPTH, as a BOARD and the edge that reached it.
     *
     * THE CANDIDATE GOALS ARE BOARDS, NOT SIGNATURES, and the difference was a reported defect rather than a
     * theoretical one: "the drills seem to contain many duplicates". `boardSig` is POSITIONS-ONLY (AGENTS.md §8 trap
     * 11), so a goal that differs from another only in FACING is one signature — MEASURED at level 1, the named goal
     * boards reachable in one call from a start are 1..17 per start and collapse to 1..6 by signature, and 500 seeds
     * produced 33 distinct (start, goal) pictures with the commonest repeated 34 times. A player sees the picture, so
     * the picture is the identity.
     *
     * IT COSTS NOTHING HERE AND ALMOST NOTHING DEEPER: the frontier is expanded once per signature (which is what
     * keeps the search affordable), and this records what each expansion actually ARRIVED at, so a deeper level gains
     * the same variety for the memory of one list.
     */
    const arrivals: { board: Board; fromSig: string; call: string }[] = [];
    /**
     * THE DISTANCE TO EACH PICTURE, which is not the distance to each signature.
     *
     * `dist` is keyed by `boardSig`, so a board whose POSITIONS match one already reached at a nearer depth is
     * treated as that near — and it was being dropped as a candidate even when it is a different picture a call
     * away. MEASURED at level 1 after the arrival recording landed but before this map: 500 seeds gave 59 distinct
     * (start, goal) pictures and `Static Square` reached 4 of its 15 named one-call goals, because the other 11
     * return the square's own positions with different facings. With this map the candidate filter asks the
     * question it means: is THIS PICTURE exactly `maxDepth` calls away.
     */
    const poseDist = new Map<string, number>([[poseKey(start), 0]]);
    /** How many EXTRA shortest predecessors a board has, so "reachable by more than one path" is a
     * measurement rather than a hope. */
    const extraPredecessors = new Map<string, number>();
    let frontier: Board[] = [start];
    explored++; // the start board

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
          // THE ARRIVAL IS RECORDED BEFORE THE SIGNATURE BOOKKEEPING, because a board at the right depth is a goal
          // candidate whether or not its signature is new: that is exactly the case the signature was hiding.
          const picture = poseKey(move.board);
          if (!poseDist.has(picture)) poseDist.set(picture, d);
          if (goals && poseDist.get(picture) === d) {
            arrivals.push({ board: move.board, fromSig: boardSig(board), call: move.call });
          }
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
    // `build`, with the engine's own rule). The three-options requirement belongs to the boards a step is
    // played FROM, and `build` applies it there.
    //
    // THE LIST IS DEDUPED BY POSE, not by signature — the same board reached by two calls is one candidate, and two
    // boards that differ only in facing are two. See `arrivals`.
    // A CANDIDATE GOAL MUST BE A FORMATION THE CORPUS DEFINES, which is a wider set than the formations the curated
    // recogniser names. MEASURED at level 1: thirteen of the 44 start formations offer no one-call board that
    // `recognize` can name, so gating on the NAME refused those starts outright — and a formation is valid because the
    // corpus defines it (`formations.xml` or a tam's own setup), not because it is one of the twenty-odd standard
    // names a caption prefers. `formationOf` answers the validity question against the whole corpus with the same
    // matcher and threshold; the caption falls back to the same name.
    const candidates: { board: Board; fromSig: string; call: string }[] = [];
    const candidatePoses = new Set<string>([poseKey(start)]);
    for (const arrival of arrivals) {
      if (sameBoardById(arrival.board, start)) continue;
      if (applier.formationOf(arrival.board) === null) continue;
      const key = poseKey(arrival.board);
      if (candidatePoses.has(key)) continue;
      candidatePoses.add(key);
      candidates.push(arrival);
    }
    if (candidates.length === 0) {
      const from = applier.nameOf(start) ?? applier.formationOf(start) ?? 'this start';
      return hitBudget
        ? `the exploration hit its ${config.nodeBudget}-node budget after ${explored} states with no board at depth ${config.maxDepth} from ${from}`
        : `no NAMED board is reachable in exactly ${config.maxDepth} call(s) from ${from} at this level`;
    }

    // ---- 2. Build a path for a candidate, choosing among its ALTERNATE predecessors.
    //
    // WHY THIS IS A SEARCH AND NOT A WALK. A path is only usable if every board it is PLAYED FROM can carry
    // three options — so the freedom to choose which predecessor to walk through is what decides whether a
    // candidate can become a puzzle at all. A single recorded chain per board gives each candidate exactly
    // one chance, and MEASURED, that is why depth 2 was generating 0/8: every candidate failed, each at a
    // different step, which is the signature of too few paths TRIED rather than of gates that cannot be met.
    const pathRefused = new Map<string, number>();
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

    const build = (goal: Board, path: Board[], calls: string[]): Puzzle | string => {
      if (path.length !== config.maxDepth + 1) return `the path had ${path.length - 1} call(s), not ${config.maxDepth}`;

      // GATE: the start and the goal must be tellable apart, or the puzzle is "these look the same".
      if (sameBoardById(start, goal)) return 'the goal board is the start board';
      // AND TELLABLE APART AS AN ARRANGEMENT, which is the same rule at the grain a player reads. `arrangementKey`
      // is the engine's congruence — positions and headings, quotiented by the eight rotations and both reflections —
      // so a ROTATED copy of the start arrives here as the same formation. MEASURED, this is exactly what widening the
      // candidates to boards exposed: 2 of 24 Daily routes ended in their own start's arrangement. A goal may differ
      // from another goal by facing and still be a different picture; a goal that is the START's formation is the
      // puzzle telling the player the answer is where they already are.
      if (arrangementKey(goal) === arrangementKey(start)) return "the goal board is the start board's arrangement, seen another way";
      // GATE: the GOAL must be a FORMATION THE CORPUS DEFINES, which is `formationOf`'s question and not the curated
      // recogniser's. The old rule was "the goal must be NAMEABLE by `recognize`", justified by the caption; but the
      // corpus's own answer to "is this arrangement one of ours" is wider than the twenty-odd standard names a caption
      // prefers, and MEASURED it is what refused thirteen of level 1's 44 start formations. An INTERMEDIATE board needs
      // no name at all: it is a legal state the engine has no template for, the player never sees it captioned, and
      // gating every board would leave the level with no puzzles.
      if (applier.formationOf(goal) === null) return 'the goal board is no formation the corpus defines';

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
      // SORTED FIRST because the result must not depend on the order a caller handed the titles over in, then SHUFFLED
      // so the illegal choice is drawn from the whole refused pool rather than from its alphabetical front (see the
      // comment where it is used).
      const unknownPool = rng.shuffle(applier.candidateCalls(start).slice().sort(byTitle));
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
          ? offered.filter((m) => reachedGoal(m.board, goal))
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

        // Distractors: pairwise-distinct endings, NEVER THE GOAL (by the goal's own rule, `reachedGoal` — a rotated or
        // reflected goal board is the goal, so a positions signature is not enough to exclude it), and never ending
        // where another option ends. Distinctness is by `boardSig` (cheap) and is then CONFIRMED by `sameBoardById`,
        // because a signature collision would otherwise publish two options that are the same board.
        const endsHere = new Set<string>([boardSig(chosen.board)]);
        const distractors: Move[] = [];
        for (const m of rng.shuffle(offered.filter((m) => m.call !== chosen.call))) {
          if (reachedGoal(m.board, goal)) continue;
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

        // THE ILLEGAL CHOICE, only where the design allows one (step 1), and never a call the puzzle's own path uses. Its
        // refusal is the ENGINE's string, verbatim.
        //
        // THE POOL IS SHUFFLED, because taking the alphabetically-first refused title MEASURED as one call every time:
        // over 100 level-1 seeds the illegal button was `Adjust to an Alamo` in all of them, which is a button a player
        // learns to ignore — and the lesson it exists to teach ("that cannot be called from here") is lost with it.
        // `byTitle` first so the draw cannot depend on the order a caller handed the titles over in, then the attempt's
        // own rng. The scan is cheap: most of a level's titles are refused from any one board, so it stops almost
        // immediately.
        //
        // AND ITS POSITION IS PART OF THE QUESTION (`unknownIndex`): appended last it was a giveaway before it was
        // pressed. The screen draws the buttons in this order and marks none of them.
        if (i === 0) {
          const used = new Set<string>([...calls, ...options.map((o) => o.call)]);
          for (const name of unknownPool) {
            if (used.has(name)) continue;
            const refusal = applier.refusalOf(from, name);
            if (refusal) {
              step.unknown = refusal;
              step.unknownIndex = rng.int(options.length + 1);
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

    // Candidates are SHUFFLED, so the choice depends on the seed rather than on BFS discovery order. THE PATH IS
    // FOUND PER CANDIDATE — the candidate is a BOARD, and the chain to it is its predecessor's chain plus the call
    // that arrived, so the last edge is the one the exploration actually took rather than one re-derived from a
    // signature.
    for (const candidate of rng.shuffle(candidates)) {
      const sub = findPath(candidate.fromSig);
      if (!sub) {
        pathRefused.set('no usable path to this candidate (a board on every route cannot carry three options)', 0);
        continue;
      }
      const outcome = build(candidate.board, [...sub.path, candidate.board], [...sub.calls, candidate.call]);
      if (typeof outcome !== 'string') return outcome;
      pathRefused.set(outcome, (pathRefused.get(outcome) ?? 0) + 1);
      if (hitBudget) break;
    }

    return `${candidates.length} board(s) at depth ${config.maxDepth} and none usable — ${summarise(pathRefused)}`;
  };

  for (let i = 0; i < order.length; i++) {
    // THE ATTEMPT'S OWN STREAM — see the comment on `attempt` — mixed from the base and the ORDINAL.
    const outcome = attempt(order[i], rngFrom(base ^ Math.imul(i + 1, 0x85ebca6b)));
    if (typeof outcome !== 'string') return { ok: true, puzzle: outcome };
    refused.set(outcome, (refused.get(outcome) ?? 0) + 1);
    if (hitBudget) break;
  }

  return {
    ok: false,
    reason: `${candidates.length} start formation(s) can carry the question and none gave a puzzle — ${summarise(refused)}`,
  };
}
