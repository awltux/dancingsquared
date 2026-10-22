// The game's data model. THE CORE TAKES THE ENGINE AS AN ARGUMENT — the `GameApplier` seam below is the
// whole of its engine surface, and that is what lets a probe drive a whole puzzle with a stub and what
// makes the generator's determinism a property of this package rather than of how it was wired.
//
// WHAT THAT SEAM DOES AND DOES NOT COVER, stated because a comment claiming "no engine value anywhere in
// `src/puzzle/`" used to sit here and was simply untrue: the PURE RULES the engine owns are imported
// directly (`sameBoardById`, `boardSig`, `makeSquaredSet`), because a probe imports the same functions and
// re-deriving them would be the second implementation AGENTS.md 5 forbids. What the seam covers is
// everything MUTABLE or ENVIRONMENTAL — the sequencer, legality, naming, refusals — so that no probe and no
// screen needs one, and so the whole core stays loadable by bare Node.

import type { Board, SequenceStop } from 'dancing-squared-engine';

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

/**
 * One call together with the READING that performs it: the whole board (`selection: null`) or a named subset
 * (`selection` naming the group, "Heads" …).
 *
 * WHY THE READING IS PART OF THE IDENTITY rather than a label on a call: the same title can be legal for the set and
 * illegal for a group, or the other way round — MEASURED, `Dosado` is refused whole-board at Mainstream and legal
 * for `Head Boys` — so "the call" and "the call by these dancers" are two different moves that happen to share a
 * name. The Daily's picker offers both, and what it plays is the group's own spelling (`"Heads Dosado"`), which is
 * what the engine and the server both read.
 */
export interface MoveReading {
  call: string;
  selection: string | null;
  board: Board;
}

/** A call the engine REFUSES, carrying the engine's own reason verbatim (DESIGN.md 4.1: the reason is
 * engine-owned prose and is never re-worded by the game). */
export interface Refusal {
  call: string;
  reason: string;
}

/**
 * A list of calls as a MOVING board: what the engine's own walk makes of it, sampled by beat.
 *
 * WHY THIS IS AN APPLIER METHOD AND NOT A MODULE. Drawing a call means walking the authored path — the
 * engine's `evaluateSequence`, driven per animation frame exactly as the POC drives it (DESIGN.md 4.3) — and
 * that needs the sequencer, which is the one thing the pure core does not hold. So the motion is asked of
 * the same seam that answers legality and naming, and both sides of the wire sample the same walk.
 *
 * THE ENDPOINT IS THE POINT. `at(beats)` is the board the engine reaches by walking the whole list, and that
 * board is what every verdict is computed against — so a replay that lands anywhere else would show one
 * board and score another. `game/test/motion-probe.mjs` pins the equality rather than trusting it.
 */
export interface SequenceMotion {
  /** How many beats the walk charges for the whole list. Zero when it cannot be walked at all. */
  beats: number;
  /**
   * Where the walk stops, in the ENGINE's own shape (index, call, reason, board), or null when the whole
   * list walks. The reason is engine-owned prose and is shown verbatim — for the Drill's illegal option
   * this is the point of the option rather than an error path (DESIGN.md 4.3).
   */
  stop: SequenceStop | null;
  /**
   * The board at `beat`, clamped into `[0, beats]`. At `0` it is the board the list starts from; at `beats`
   * it is the board the whole list ends on, exactly.
   */
  at(beat: number): Board;
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
   * EVERY reading of every legal call from `board` — the whole board and each subset that can perform it.
   *
   * WHY IT IS SEPARATE FROM `offered`. `offered` is the WHOLE-BOARD list: the Drill's options, the hint's menu, the
   * generator's gates. The Daily's picker is the one screen that has to say "Heads Lead Right" as well as "Lead
   * Right", and the group-aware list cannot be derived from `offered` in either direction (a call legal for a group
   * and not for the set, or the reverse). MEASURED at 322 titles: 1754 ms on a squared set (140 whole-board + 718
   * group readings), and 22 ms one call in — which is why the applier caches it by board and why `offered` was not
   * turned into it.
   */
  readings(board: Board): MoveReading[];
  /**
   * Put a list the SERVER already computed for `board` into the cache, so the first render does not pay for it.
   *
   * WHY THE SEAM HAS A WRITE AS WELL AS A READ: `readings` is 0.3 s at a level-5 pool and ~1.7 s at the top of the
   * ladder on a squared set, and the serving layer has the applier warm when it generates the puzzle — so it ships the
   * start board's list (`api/src/levels.ts`'s `startReadings`). This is where that list enters the same cache the read
   * uses, keyed by the same pose, so an optimisation cannot become a second source of truth.
   *
   * A KEY THAT DOES NOT MATCH IS A MISS, never a wrong answer: the key is the board's own pose, so a seeded list can
   * only be found by the board it describes.
   */
  seedReadings(board: Board, readings: readonly MoveReading[]): void;
  /**
   * Every call title the level registers — the menu, not the availability. `offered` is this filtered
   * by legality, and `candidateCalls` is what makes an authorable `unknown` option possible.
   */
  candidateCalls(board: Board): string[];
  /**
   * The boards a puzzle may START from: one per formation this level's own calls declare, one per picture.
   *
   * WHY THE POOL DECIDES, RATHER THAN A CONSTANT. Every corpus `<tam>` declares the formation its call is
   * used from, and a pool of 57 titles declares 67 of them — so a generator that always opens on a squared
   * set asks every one of its questions from the same half-dozen boards and throws that variety away.
   * MEASURED at level 1 over the first 100 seeds: one start board produced **5 distinct goal boards and 77
   * distinct puzzles**, which is the "every drill looks the same" report stated as a number.
   *
   * WHAT IS **NOT** DERIVED HERE. Whether a board can CARRY a question (three legal calls with distinct
   * endings), and whether the engine will NAME it, are the generator's gates on the boards a step is played
   * from and on the pictures the player is shown — so this returns the raw set and the generator applies
   * them. A filter here would be a second implementation of the level's rules, in the module that does not
   * own them.
   *
   * EVERY BOARD IS EIGHT DANCERS WITH IDENTITY. The engine builds each from `boardForSetup`, which stamps
   * the couple-to-spot assignment where the registry covers the formation and otherwise numbers the dancers
   * by array index — so a start can always be compared with a goal by `sameBoardById`, which is the one goal
   * test the game has (AGENTS.md §4.3: identity is data, never an index).
   *
   * THE ORDER IS STABLE AND NOT SEEDED: sorted by the formation's authored name. The generator shuffles it,
   * so the seeded choice stays in the pure core where a probe can reproduce it.
   */
  startBoards(): readonly Board[];
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
  /**
   * The CORPUS formation this board is, or null when it is no arrangement `formations.xml` defines.
   *
   * THE VALIDITY QUESTION, where `nameOf` is the caption question. `recognize` is curated to twenty-odd standard names
   * so that a board congruent to several does not get a confident wrong label; this asks the wider question the corpus
   * can answer — "is this arrangement one of ours" — against every formation in `formations.xml`, with the same matcher
   * and the same threshold. MEASURED at level 1: thirteen of the 44 start formations have no one-call outcome the
   * curated recogniser can name, and gating the generator on the NAME refused all thirteen.
   */
  formationOf(board: Board): string | null;
  /**
   * The engine's own motion for `calls` played from `board`.
   *
   * ONE CALL AND A WHOLE LINE ARE THE SAME CALL (DESIGN.md 4.3): the Drill passes a one-call list for each
   * option and the Daily passes the player's line, so the two modes share this path instead of each having
   * its own way of drawing a dance.
   */
  motion(calls: readonly string[], from: Board): SequenceMotion;
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
  /**
   * WHERE THE ILLEGAL CHOICE SITS AMONG THE BUTTONS: a position in `0..moves.length`, inclusive.
   *
   * WHY THIS IS DATA AND NOT A SCREEN'S CHOICE. The illegal button must not be recognisable before it is pressed — it
   * is a call the engine refuses, and a player who can see which one it is has been handed the answer to a question
   * they were meant to reason about — so it goes among the legal ones. WHICH position is the puzzle's, like everything
   * else about it: the screen rebuilds its buttons on every render, so a position computed there would be recomputed
   * each time, and a random one would move under the player's finger between two renders of the same question. Seeded
   * by the generator it is stable for the puzzle and varies across puzzles.
   *
   * ABSENT MEANS BOTH "no illegal choice" and "a payload from a build that did not carry this"; the screen treats the
   * absent case as the LAST button, which is where every build before this one drew it.
   */
  unknownIndex?: number;
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
  /** How many states the exploration enumerated, ACROSS THE WHOLE GENERATION — including the attempts at
   * starts that were refused — so the measurement is a number rather than a claim about the cost of one
   * start. */
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

// WHAT A SESSION LOOKS LIKE WHEN IT IS STOPPED lives in `DailySaved` (`game/store.ts`), not here: the record
// a reload reads carries the moves AND the clock AND the hints, so a shape holding only the move stack was a
// second answer to the same question. It was declared in Phase 1 and read by nobody; deleted in Phase 4.5.
