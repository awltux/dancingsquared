// The Drill's state machine: which step the player is on, what the buttons are, and what each answer
// means. PURE — no DOM, no three, and no engine VALUE read from outside: the goal test arrives through
// `sameBoardById` from the engine, which is the engine's own rule and the only implementation of it
// (AGENTS.md §5: import the rule, never mirror it). A probe drives a whole drill with a hand-built puzzle,
// so the verdict rules are testable without a browser.
//
// THE THREE VERDICTS ARE THE TEACHING CONTENT (DESIGN.md §8), and they differ in kind:
//   * `illegal` — the engine refused the call. The reason is the ENGINE's string, verbatim (§4.1), and the
//     board does not move: an illegal application returns its input board unchanged, which is exactly why
//     the illegal choice is a separate field on the step rather than a member of `moves` (§7.3).
//   * `wrong`   — the call applied and did not reach the goal. The player sees where it actually goes.
//     NOT A FAILURE: DESIGN.md §9 chose honest offerings and free undo, so a legal move is never refused;
//     what makes a wrong turn cost something is the SCORE (§6), which is Phase 3's.
//   * `correct` — the move that makes progress. On the last step that means it reaches the goal.
//
// A WRONG OR ILLEGAL ANSWER DOES NOT ADVANCE, and that is the point of the mode: the player is asked to
// commit and the puzzle does not move on until they are right. `atEnd` becomes true only once the LAST step
// has been answered correctly.

import { sameBoardById, type Board } from 'dancing-squared-engine';
import type { Puzzle, PuzzleOption, PuzzleStep } from '../puzzle/types.ts';

export type AnswerKind = 'correct' | 'wrong' | 'illegal';
/** The illegal choice is answered by this token, because it has no index into `moves`. */
export type Answer = number | 'unknown';

export interface AnswerResult {
  kind: AnswerKind;
  /** The engine's own reason. Present only for `illegal`. */
  reason?: string;
  /** The board the chosen option ends on, so the view can replay to it. Absent for `illegal`. */
  ending?: Board;
  /**
   * The board the option was played FROM. Carried beside `ending` so a replay needs nothing but this
   * result: the view can ask the applier for the motion of the ONE call that was played, without asking the
   * machine which step is current — which matters, because after a CORRECT answer the machine has already
   * advanced past it.
   */
  replayFrom?: Board;
  /** The call that was played, for a caption. */
  call: string;
}

/** What the UI draws — a snapshot, so a render cannot observe a half-updated machine. */
export interface DrillView {
  stepIndex: number;
  stepCount: number;
  /** The board the player is deciding FROM: this step's path board. */
  from: Board;
  /** The board the puzzle must reach. */
  goal: Board;
  /** The options in the order the puzzle shuffled them. */
  options: readonly PuzzleOption[];
  /** How many options a step presents, taken from the LEVEL — never assumed to be 3: P1 measured that a
   * three-option question needs a pool of at least 35 titles, so levels 1..15 ship two. */
  optionCount: number;
  /** The illegal choice, when the generator authored one (step 1 only, and only where a refusal exists). */
  unknown?: { call: string; reason: string };
  /** Whether the puzzle is solved. */
  atEnd: boolean;
  /**
   * How many answers this puzzle has taken that were NOT correct — the Drill's `attempts`, which is the one
   * factor of the score that only this mode has (DESIGN.md 6). Counted here because it is a rule of the
   * machine rather than of a screen.
   */
  attempts: number;
}

export class DrillController {
  private readonly puzzle: Puzzle;
  private index = 0;
  private attemptsCount = 0;

  /**
   * `opts` resumes a drill the player was ISSUED before this page was open (DESIGN.md 8: a drill is locked
   * when it is issued, so a reload continues that drill rather than drawing a new one).
   *
   * WHY THE STEP AND THE ATTEMPTS COME BACK. Restarting the steps would make a player who had already
   * answered step 1 of 2 pay for it twice, and zeroing the attempts would forgive wrong tries the score is
   * priced on (`attemptFactor`) — so a reload, which is not the player's fault, would be a way to improve a
   * score. The clock is the shell's business and is re-based there, for the same reason.
   *
   * A RECORD OUT OF RANGE IS CLAMPED rather than trusted: `index` is bounded by the puzzle's own step count
   * and both counts are floored at zero, so a hand-edited save cannot put the machine in a state no player
   * could reach.
   */
  constructor(puzzle: Puzzle, opts: { index?: number; attempts?: number } = {}) {
    if (puzzle.steps.length === 0) throw new Error('a puzzle with no steps cannot be played');
    this.puzzle = puzzle;
    this.index = Math.min(Math.max(0, Math.floor(opts.index ?? 0)), puzzle.steps.length);
    this.attemptsCount = Math.max(0, Math.floor(opts.attempts ?? 0));
  }

  /**
   * The step being decided.
   *
   * THROWS AT THE END RATHER THAN CLAMPING. Once the last step is answered the machine is finished, and
   * `view()` is what a caller reads to draw that state; a `step` that quietly returned the last step again
   * would let a UI re-ask a question the player has already answered.
   */
  get step(): PuzzleStep {
    if (this.atEnd) throw new Error('the puzzle is solved; there is no current step');
    return this.puzzle.steps[this.index];
  }

  get atEnd(): boolean {
    return this.index >= this.puzzle.steps.length;
  }

  /**
   * The snapshot the UI draws. IT DOES NOT TOUCH `this.step`, so it is safe to call at the end — which is
   * the one moment a caller most wants to draw, and where a `step`-reading version would throw.
   */
  view(): DrillView {
    const atEnd = this.atEnd;
    const step = this.puzzle.steps[Math.min(this.index, this.puzzle.steps.length - 1)];
    return {
      stepIndex: this.index,
      stepCount: this.puzzle.steps.length,
      from: atEnd ? this.puzzle.goal : step.from,
      goal: this.puzzle.goal,
      options: step.moves,
      optionCount: this.puzzle.level.optionCount,
      ...(step.unknown ? { unknown: step.unknown } : {}),
      atEnd,
      attempts: this.attemptsCount,
    };
  }

  /** The answers that were not correct. The Drill's own score factor (DESIGN.md 6). */
  get attempts(): number {
    return this.attemptsCount;
  }

  /**
   * Answer the current step. `'unknown'` is the illegal button; a number indexes `moves`.
   *
   * AN OUT-OF-RANGE INDEX IS A BUG IN THE UI, NOT A WRONG ANSWER, so it throws rather than reporting
   * `wrong`: silently scoring a rendering mistake as a player mistake would tell the player they chose
   * something they were never shown.
   *
   * EVERY ANSWER THAT IS NOT CORRECT COUNTED AS AN ATTEMPT, and the ILLEGAL one counts too: the player
   * committed to it, and DESIGN.md 6's `attemptFactor` prices "a wrong option" as a discrete event. What it
   * does not price is a click the UI should have prevented, which is why an out-of-range index throws above.
   */
  answer(choice: Answer): AnswerResult {
    const step = this.step;
    if (choice === 'unknown') {
      const unknown = step.unknown;
      if (!unknown) throw new Error('this step has no illegal option to answer with');
      this.attemptsCount++;
      return { kind: 'illegal', reason: unknown.reason, call: unknown.call };
    }
    if (!Number.isInteger(choice) || choice < 0 || choice >= step.moves.length) {
      throw new Error(`option ${choice} is outside this step's ${step.moves.length} option(s)`);
    }
    const option = step.moves[choice];
    // THE BOARD AND THE CALL ARE READ BEFORE THE INDEX MOVES. Incrementing first and then reading
    // `this.step.moves[...]` reads the NEXT step's option, so the result would name a call the player did
    // not play — and on the final step it would read past the end.
    if (choice === step.correctIndex) {
      this.index++;
      return { kind: 'correct', ending: option.board, replayFrom: step.from, call: option.call };
    }
    this.attemptsCount++;
    return { kind: 'wrong', ending: option.board, replayFrom: step.from, call: option.call };
  }

  /**
   * The call the puzzle wants at the current step — "show me the answer" (DESIGN.md §8's review).
   *
   * THE OPTION RATHER THAN THE NAME, because the UI needs to REPLAY it: the ending board rides on the
   * option, which is what makes a review possible without re-running the engine.
   */
  review(): PuzzleOption {
    return this.step.moves[this.step.correctIndex];
  }

  /** The intended solution from here on, for a whole-line review. */
  remainingSolution(): string[] {
    return this.puzzle.solution.slice(this.index);
  }

  /**
   * Whether `board` is the goal, by the ENGINE's rule.
   *
   * WHY IT IS EXPOSED: this machine decides `correct` from the step's `correctIndex`, which the GENERATOR
   * computed, while the engine decides "same board" from geometry and facing. A probe checks the two agree
   * on every step, so a puzzle whose answer button did not actually reach the goal is caught here rather
   * than by a player. It is the same `sameBoardById` the engine owns, so this is not a second opinion.
   */
  isGoal(board: Board): boolean {
    return sameBoardById(board, this.puzzle.goal);
  }

  /** The puzzle being played, for a caller that needs the goal board or the level. */
  get puzzleRef(): Puzzle {
    return this.puzzle;
  }
}
