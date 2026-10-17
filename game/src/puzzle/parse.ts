// Reading a PUZZLE FROM THE WIRE: the shape check the client needs now that the server generates.
//
// ============================================================================================
// WHY THIS EXISTS, AND WHY IT IS IN `puzzle/` RATHER THAN IN `net/`.
// ============================================================================================
//
// Until the client stopped generating, a puzzle in the client was what `generatePuzzle` had just built, so nothing
// could arrive malformed: there was no wire to cross. `GET /drill/current` and `GET /puzzle` now carry one
// (DESIGN.md §9/§11), and the app draws what it is handed, so the difference between "a puzzle" and "some JSON
// that happens to have a `steps` key" has to be checked SOMEWHERE — and the somewhere is here, because this file
// owns nothing but the shape. `net/api.ts` decides what a refusal means; this decides whether there is anything
// to refuse.
//
// A HALF-PARSED PUZZLE IS WORSE THAN NO PUZZLE, which is the rule the whole file follows. Every field is either
// there and of the right shape or the whole parse returns null: a board with seven dancers, a `correctIndex` of 5
// into three options, or a step whose `after` is missing would each produce a screen that looks playable and a
// verdict that cannot be why the player lost. The caller's refusal is then one sentence ("the server did not send
// a puzzle this app can draw") instead of a crash in the middle of a drill.
//
// IT DOES NOT RE-VALIDATE THE GAME'S RULES, and the line is deliberate: this file does not check that three options
// have pairwise-distinct endings, that `shortest` equals `steps.length`, or that the goal is reachable. Those are
// the generator's and the API's properties, measured where they are produced (`game/test/puzzle-core-probe.mjs`,
// `api/test/drill-probe.mjs`); re-checking them here would be a second implementation of a rule the client does not
// own, and the client's job is to draw what the server scored. What it does check is that the boards are boards —
// because `sameBoardById` over a malformed board is a wrong verdict, not a wrong display.

import type { Board } from 'dancing-squared-engine';
import type { LevelSpec, MoveReading, Puzzle, PuzzleMode, PuzzleOption, PuzzleStep } from './types.ts';

/** One dancer, named through the board it sits on rather than imported: the engine's `SeqDancer` is a member of
 * `Board`, and reaching for it separately would be a second import site for one shape. */
type SeqDancer = Board['dancers'][number];

/** Whether `value` is a plain object, which every shape below starts from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * One dancer, or null.
 *
 * THE IDENTITY FIELDS ARE REQUIRED, not defaulted: `couple` and `gender` are what `sameBoardById` and the poses
 * read, and an invented couple would make a board that compares equal to a different one. The optional fields are
 * the engine's own three (`lastTurnDir`, `isGhost`, `ghostAnchor`) and are kept only when they are well-typed —
 * `undefined` and `absent` mean the same thing to every reader, and JSON delivers `absent`.
 */
function asDancer(value: unknown): SeqDancer | null {
  if (!isRecord(value)) return null;
  const { id, couple, gender, x, y, heading } = value;
  if (!isFiniteNumber(id) || !isFiniteNumber(couple) || !isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(heading)) return null;
  if (gender !== 'boy' && gender !== 'girl' && gender !== 'phantom') return null;
  const dancer: SeqDancer = { id, couple, gender, x, y, heading };
  if (value.lastTurnDir === 'left' || value.lastTurnDir === 'right') dancer.lastTurnDir = value.lastTurnDir;
  if (typeof value.isGhost === 'boolean') dancer.isGhost = value.isGhost;
  if (isFiniteNumber(value.ghostAnchor)) dancer.ghostAnchor = value.ghostAnchor;
  return dancer;
}

/**
 * One board, or null.
 *
 * THE COUNT IS EXACTLY EIGHT, which is the engine's own invariant (`Board.dancers` is documented as `8`, ghosts
 * included). MEASURED while this was "at least one": a truncated payload — a board cut to seven dancers — parsed
 * happily, and it is the one malformation that looks fine on screen and wrong in a verdict, because a missing dancer
 * is also a missing row of `sameBoardById`'s comparison. A fixture that needs a smaller board is a probe's business,
 * not the wire's.
 */
function asBoard(value: unknown): Board | null {
  if (!isRecord(value) || !Array.isArray(value.dancers) || value.dancers.length !== 8) return null;
  const dancers: SeqDancer[] = [];
  for (const raw of value.dancers) {
    const dancer = asDancer(raw);
    if (!dancer) return null;
    dancers.push(dancer);
  }
  const board: Board = { dancers };
  if (typeof value.adjustToNextSetup === 'boolean') board.adjustToNextSetup = value.adjustToNextSetup;
  return board;
}

function asLevel(value: unknown): LevelSpec | null {
  if (!isRecord(value)) return null;
  const { index, poolSize, depth, optionCount } = value;
  if (!isFiniteNumber(index) || !isFiniteNumber(poolSize) || !isFiniteNumber(depth) || !isFiniteNumber(optionCount)) return null;
  return { index, poolSize, depth, optionCount };
}

function asOption(value: unknown): PuzzleOption | null {
  if (!isRecord(value) || typeof value.call !== 'string' || value.call === '') return null;
  const board = asBoard(value.board);
  return board ? { call: value.call, board } : null;
}

function asStep(value: unknown): PuzzleStep | null {
  if (!isRecord(value)) return null;
  const from = asBoard(value.from);
  if (!from || !Array.isArray(value.moves) || value.moves.length === 0) return null;
  const moves: PuzzleOption[] = [];
  for (const raw of value.moves) {
    const option = asOption(raw);
    if (!option) return null;
    moves.push(option);
  }
  const correctIndex = value.correctIndex;
  // THE INDEX IS BOUNDED BY THE LIST IT INDEXES, which is the one arithmetic check this file makes: an option index
  // out of range is the difference between "the third button is right" and "no button is".
  if (!isFiniteNumber(correctIndex) || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= moves.length) return null;
  const after = asBoard(value.after);
  if (!after) return null;
  const step: PuzzleStep = { from, moves, correctIndex, after };
  // THE ILLEGAL CHOICE, when there is one, carries the engine's own refusal prose. A malformed one is DROPPED rather
  // than refused: it is a teaching extra whose absence costs a line of copy, not a question the player cannot answer.
  if (isRecord(value.unknown) && typeof value.unknown.call === 'string' && typeof value.unknown.reason === 'string') {
    step.unknown = { call: value.unknown.call, reason: value.unknown.reason };
  }
  return step;
}

/**
 * A board's grouped move list from a wire value, or null.
 *
 * IT IS THE SERVER'S OPTIMISATION, so a malformed one is DROPPED rather than refused: the client can compute the same
 * list for the same board, and losing it costs the first render a `applicableMoves` run. That is the opposite of
 * `parsePuzzle`'s rule, and the difference is what each one is for — a puzzle cannot be invented, a cache can be
 * thrown away.
 */
export function parseReadings(value: unknown): MoveReading[] | null {
  if (!Array.isArray(value)) return null;
  const out: MoveReading[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.call !== 'string' || raw.call === '') return null;
    if (raw.selection !== null && typeof raw.selection !== 'string') return null;
    const board = asBoard(raw.board);
    if (!board) return null;
    out.push({ call: raw.call, selection: raw.selection === null ? null : (raw.selection as string), board });
  }
  return out;
}

/**
 * A `Puzzle` from a wire value, or null.
 *
 * `mode` IS READ AND CHECKED because the app branches on it in one place (which panel draws the wrong-option copy) —
 * a missing or unknown mode would leave the puzzle unattributed rather than mislabelled, so it is required.
 */
export function parsePuzzle(value: unknown): Puzzle | null {
  if (!isRecord(value)) return null;
  if (value.mode !== 'drill' && value.mode !== 'daily') return null;
  const mode: PuzzleMode = value.mode;
  const level = asLevel(value.level);
  if (!level) return null;
  const start = asBoard(value.start);
  const goal = asBoard(value.goal);
  if (!start || !goal) return null;
  if (!Array.isArray(value.path) || !Array.isArray(value.steps) || !Array.isArray(value.solution)) return null;
  if (!isFiniteNumber(value.seed) || typeof value.poolVersion !== 'string' || !isFiniteNumber(value.shortest)) return null;
  const path: Board[] = [];
  for (const raw of value.path) {
    const board = asBoard(raw);
    if (!board) return null;
    path.push(board);
  }
  const steps: PuzzleStep[] = [];
  for (const raw of value.steps) {
    const step = asStep(raw);
    if (!step) return null;
    steps.push(step);
  }
  if (!value.solution.every((call): call is string => typeof call === 'string')) return null;
  return {
    mode,
    seed: value.seed,
    level,
    poolVersion: value.poolVersion,
    start,
    goal,
    path,
    steps,
    solution: [...value.solution],
    shortest: value.shortest,
    alternatePath: value.alternatePath === true,
    explored: isFiniteNumber(value.explored) ? value.explored : 0,
  };
}
