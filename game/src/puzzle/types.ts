// The game's data model. Pure types only — no engine import beyond the board type, and no runtime
// value from the engine anywhere in `src/puzzle/`. THE CORE TAKES THE ENGINE AS AN ARGUMENT
// (`GameApplier` below), which is what makes a probe able to drive a whole puzzle with a stub and
// what makes the generator's determinism a property of this package rather than of how it was wired.

import type { Board } from 'dancing-squared-engine';

/** The two modes. They differ in WHO decides the puzzle: the Drill's order is authored and served, the
 * Daily is derived from the date (DESIGN.md 1). */
export type PuzzleMode = 'drill' | 'daily';

// ---------------------------------------------------------------------------- levels and pools

/**
 * A level of the ladder. `poolSize` is how many titles exist at this level and `depth` is the length
 * of the intended solution, in calls.
 *
 * `poolSize` is INDEX + 1 into the pool's ordered title list — i.e. `poolSize` is a COUNT, not an
 * index, and the two are one apart. That is deliberate: the design states the ladder in counts
 * ("L1 is 10 calls"), so a count is what this carries and the slice is the only place the off-by-one
 * can live.
 */
export interface LevelSpec {
  index: number; // 1-based; the leaderboard partition
  poolSize: number; // how many titles exist at this level
  depth: number; // how long the intended solution is, in calls
  /**
   * How many OPTIONS a step presents, including the correct one. It lives on the LEVEL rather than on the
   * generator because it is not a tuning constant — it is a property of what the pool can support:
   * MEASURED, a 3-option question needs a pool of at least 35 titles, and below that the reachable board
   * graph has no route whose played-from boards all offer three distinct endings. See `levels.ts`.
   */
  optionCount: number;
}

// ---------------------------------------------------------------------------- the engine seam

/** One call the engine says is available from a board, together with the board it produces. */
export interface Move {
  call: string;
  board: Board;
}

/** A call the engine REFUSES, carrying the engine's own reason verbatim (DESIGN.md 4.1: the reason is
 * engine-owned prose and is never re-worded by the game). */
export interface Refusal {
  call: string;
  reason: string;
}

/**
 * What the core asks of the engine. Every method is a pure function of the board it is given, so the
 * core never holds a mutable sequencer and a probe can substitute a stub.
 *
 * WHY `candidateCalls` AND `refusalOf` EXIST, AND WHY THE `unknown` OPTION CANNOT BE CONSTRUCTED
 * ANYWHERE ELSE. A Drill question's fourth choice is a call that CANNOT be made from this board, and
 * its whole value is the refusal reason. An illegal application returns the board unchanged, so that
 * choice has no ending of its own — which is exactly why it cannot be one of a step's `options` (those
 * must end somewhere, distinctly). Authoring it needs two things the core cannot derive: the set of
 * calls that exist at this level (`candidateCalls`) and the engine's verdict on one of them
 * (`refusalOf`). Both are the engine's, so both are asked for here and the result is recorded on the
 * step.
 */
export interface GameApplier {
  /** The calls that are legal from `board` at this level, each with its resulting board. */
  offered(board: Board): Move[];
  /**
   * Every call title the level registers — the menu, not the availability. `offered` is this filtered
   * by legality, and `candidateCalls` is what makes an authorable `unknown` option possible.
   */
  candidateCalls(board: Board): string[];
  /** Whether `call` can be applied from `board`, and why not when it cannot. */
  refusalOf(board: Board, call: string): Refusal | null;
  /**
   * The board `call` produces from `board`. Only called when `refusalOf` has already said it applies,
   * so an illegal call is never passed here; that split exists because a session needs the VERDICT and
   * the BOARD as separate answers (the verdict is the teaching content, the board is the state).
   */
  apply(board: Board, call: string): Board;
  /**
   * Whether two boards are the same board — the engine's `sameBoardById`, passed through rather than
   * re-derived. WHY IT RIDES ON THE APPLIER: the goal test is the engine's rule and there is exactly
   * one implementation of it (AGENTS.md 5: import the rule, never mirror it). A session that imported
   * `sameBoardById` directly from the engine would be a second import site free to drift from the
   * applier's, and it would make a stub-driven probe unable to express "these reach the same board".
   */
  boardsMatch(a: Board, b: Board): boolean;
  /** Whether the engine NAMES this board (`recognize`). An unnamed board is legal but unteachable
   * (DESIGN.md 7's quality gates), so the generator refuses it as a puzzle state. */
  nameOf(board: Board): string | null;
}

// ---------------------------------------------------------------------------- a puzzle

/** One option in a Drill step. `board` is the board this option REACHES, which is what makes the
 * three options comparable by `sameBoardById` and what makes a thumbnail possible without replaying. */
export interface PuzzleOption {
  call: string;
  board: Board;
}

/** One step of a Drill. `moves` are the legal options; `unknown` is the fourth, illegal choice, and
 * the two are separate fields for the reason `GameApplier` documents. */
export interface PuzzleStep {
  /** The board this step is offered from. */
  from: Board;
  /** Exactly three, legal, pairwise-distinct-ending options (DESIGN.md 7.3). */
  moves: PuzzleOption[];
  /** Index into `moves` of the option on the puzzle's intended path. */
  correctIndex: number;
  /** The call that cannot be made from `from`, and the engine's reason. Only step 1 carries one:
   * a dead end placed behind a call that IS legal would punish a player who has reasoned correctly so
   * far (DESIGN.md 7.3). */
  unknown?: Refusal;
  /** The board the intended path is on AFTER this step. Equals `moves[correctIndex].board`. */
  after: Board;
}

export interface Puzzle {
  mode: PuzzleMode;
  seed: number;
  level: LevelSpec;
  /** Bumped whenever the pool's contents or order change. A leaderboard entry is meaningful only
   * within one pool version, so this is part of what a puzzle IS (DESIGN.md 7). */
  poolVersion: string;
  /** The board the player starts on. */
  start: Board;
  /** The board the player must reach. Compared with `sameBoardById`, never by name (DESIGN.md 4.2). */
  goal: Board;
  /**
   * The shortest-path boards, in order: `path[0] === start` and `path[path.length - 1] === goal`, so
   * there is exactly ONE MORE board than there are steps. A step's "board after this move" is
   * `path[i + 1]`, and it is not stored twice.
   */
  path: Board[];
  /** The intended path, one step per call: `steps.length === level.depth`. */
  steps: PuzzleStep[];
  /** The intended solution's call names, for `par` and for "show me the answer". */
  solution: string[];
  /** The shortest solution length in calls that the generator KNOWS. Equals `level.depth` because the
   * search is a BFS, so this is the true shortest rather than an assertion (DESIGN.md 7's gate). */
  shortest: number;
  /** Whether the goal was reachable by more than one path of the same length. Attempted, and recorded
   * when it is impossible rather than silently dropped — an instrument's silence is itself a bug. */
  alternatePath: boolean;
  /** How many states the exploration enumerated, so the measurement is a number rather than a claim. */
  explored: number;
}

// ---------------------------------------------------------------------------- generation

export interface GeneratorConfig {
  /** The pool version stamped on every puzzle this configuration generates. */
  poolVersion: string;
  /**
   * WHICH MODE the puzzle is generated for. The Drill's questions and the Daily's challenge are the same
   * generator over the same seed and level, and this is the only field that tells the two apart — so it
   * belongs in the configuration rather than being inferred by whoever reads the puzzle later.
   */
  mode: PuzzleMode;
  /** The longest solution to look for. The caller passes the level's depth; this is the ceiling the
   * search will enumerate to, so it bounds the work rather than the answer. */
  maxDepth: number;
  /**
   * The cap on states enumerated across the WHOLE generation, not per level.
   *
   * WHY A CAP AT ALL: the state space is exponential in `depth` and the pool, and an unbounded search
   * is how a browser tab stops responding. WHICH VALUE: measured, by the ladder census. The generator
   * reports the budget it hit in its refusal reason, so a level that cannot be generated inside it is a
   * finding about the ladder rather than a silent failure.
   */
  nodeBudget: number;
}

/** A generation attempt either yields a puzzle or says why not. A REFUSAL IS A RESULT, NOT A `null`
 * WITH NO EXPLANATION — the engine's own contract for a geometry-derived call (prd.md 9.5.4) applied
 * to the generator, because "no puzzle" and "no puzzle because the pool is too small" are different
 * things to a level designer. */
export type GenerateResult = { ok: true; puzzle: Puzzle } | { ok: false; reason: string };

// ---------------------------------------------------------------------------- the schedule

/** One entry of a Drill regime: a seed, and THE LEVEL IT WAS GENERATED AT. The level travels with the
 * seed because a seed is only meaningful against one `poolSize` — the same seed at a different pool is
 * a DIFFERENT puzzle, which is what `lintSchedule` refuses (DESIGN.md 7.2). */
export interface ScheduleEntry {
  seed: number;
  levelIndex: number;
  poolVersion: string;
}

export interface ScheduleFinding {
  index: number;
  reason: string;
}

// ---------------------------------------------------------------------------- play

/** A `PlaySession`'s state, small enough to serialize and to compare field by field. */
export interface PlayState {
  /** The calls played so far, in order. */
  moves: string[];
  /** Calls undone and available to redo, most recent last. A new move truncates this. */
  redo: string[];
}
