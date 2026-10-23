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
import { arrangementKey, waypointBoards, waypointReached } from '../puzzle/arrangement.ts';
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
  /**
   * WHERE THE ILLEGAL CHOICE GOES among the buttons, `0..options.length` inclusive — the puzzle's own position, so the
   * order does not move between two renders of one question.
   *
   * ABSENT WHEN THERE IS NO ILLEGAL CHOICE, and the screen then appends nothing. It falls back to the last position
   * when a payload predates the field, which is where every earlier build drew it.
   */
  unknownIndex?: number;
  /** Whether the puzzle is solved. */
  atEnd: boolean;
  /**
   * Whether the step being ASKED is the last one — the step whose answer must leave the set on the goal board, and the
   * only step where "does not leave the set on the goal board" is a true sentence about a wrong answer.
   *
   * IT IS NOT `stepCount === 1`. A two-step drill's final step asks the same question a one-step drill asks, and this
   * field is what the screen's prompt and the wrong-answer sentence switch on, so the two sentences cannot disagree
   * about which step the player is looking at. False once the puzzle is solved (`atEnd` is the state then).
   */
  finalStep: boolean;
  /**
   * THE WAYPOINTS: the puzzle's route as FORMATIONS, start first and goal last (`puzzle/arrangement.ts`), so the
   * stage can show two adjacent ones instead of a start and a goal. The boards are the route's own.
   */
  waypoints: readonly Board[];
  /**
   * How many waypoints, IN ORDER, the answers so far have reached — 0 is the start alone.
   *
   * IT IS NOT `stepIndex`, AND THE TWO CAN DIFFER: a call that leaves the set in the arrangement it was already in
   * advances the step and not the waypoint. MEASURED over 24 generated routes, 16 have at least one such stage.
   */
  progress: number;
  /**
   * How many answers this puzzle has taken that were NOT correct — the Drill's `attempts`, which is the one
   * factor of the score that only this mode has (DESIGN.md 6). Counted here because it is a rule of the
   * machine rather than of a screen.
   */
  attempts: number;
}

export class DrillController {
  private readonly puzzle: Puzzle;
  private readonly waypointList: readonly Board[];
  /**
   * The waypoint the player is on AFTER each step, indexed by step (`0` is the start, `steps.length` is the end).
   *
   * PRECOMPUTED, because `view()` is asked once per animation frame by the shell's `draw()`: a `geometryKey` over
   * every waypoint and every route board per frame would be work the picture cannot need, and it would be repeated
   * for a value that only changes when the step does.
   */
  private readonly progressAtStep: readonly number[];
  private index = 0;
  private attemptsCount = 0;
  /**
   * The steps whose answer this player has been SHOWN (DESIGN.md §15 Q16, §11.1 A28).
   *
   * COUNTED HERE BECAUSE IT IS A RULE OF THE MACHINE, not of a screen — the same argument `attempts` is counted
   * under. A revealed drill counts for nothing (the server refuses the hint credit and the board entry, and the local
   * ledger below mirrors it), so the fact has to survive a reload and reach the submission, and a screen that owned
   * it would lose it on the first repaint. A SET rather than a count, because the rule is "which steps were shown"
   * and the same step revealed twice is the same help: `review()` deduplicates, which is also what keeps the
   * controller's count equal to the server's (its own event is deduplicated per step for the same reason).
   */
  private readonly revealedSteps = new Set<number>();

  /**
   * `opts` resumes a drill the player was ISSUED before this page was open (DESIGN.md 8: a drill is locked
   * when it is issued, so a reload continues that drill rather than drawing a new one).
   *
   * WHY THE STEP, THE ATTEMPTS AND THE REVEALS COME BACK. Restarting the steps would make a player who had already
   * answered step 1 of 2 pay for it twice, and zeroing the attempts would forgive wrong tries the score is
   * priced on (`attemptFactor`) — so a reload, which is not the player's fault, would be a way to improve a
   * score. The reveals come back for the same reason in the other direction: a reload that forgot them would turn
   * a run that counts for nothing into a ranked one, which is a way to LAUNDER a shown answer through the refresh
   * key.
   *
   * A RECORD OUT OF RANGE IS CLAMPED rather than trusted: `index` is bounded by the puzzle's own step count
   * and both counts are floored at zero, so a hand-edited save cannot put the machine in a state no player
   * could reach. A revealed step outside the puzzle is dropped for the same reason — there is no such step to
   * have been shown. The clock is the shell's business and is re-based there, and neither of these is it.
   */
  constructor(puzzle: Puzzle, opts: { index?: number; attempts?: number; revealed?: readonly number[] } = {}) {
    if (puzzle.steps.length === 0) throw new Error('a puzzle with no steps cannot be played');
    this.puzzle = puzzle;
    this.index = Math.min(Math.max(0, Math.floor(opts.index ?? 0)), puzzle.steps.length);
    this.attemptsCount = Math.max(0, Math.floor(opts.attempts ?? 0));
    for (const step of opts.revealed ?? []) {
      if (Number.isInteger(step) && step >= 0 && step < puzzle.steps.length) this.revealedSteps.add(step);
    }
    // THE WAYPOINTS COME FROM THE ROUTE, and the progress table from the same route: a waypoint is a FORMATION, so
    // a stage that does not change the formation does not gain one. The drill only accepts the correct option, so
    // the boards the player has stood on after `i` steps are exactly `path.slice(0, i + 1)`.
    this.waypointList = waypointBoards(puzzle.path);
    const waypointKeys = this.waypointList.map(arrangementKey);
    const routeKeys = puzzle.path.map(arrangementKey);
    const progressAtStep: number[] = [];
    for (let i = 0; i <= puzzle.steps.length; i++) {
      progressAtStep.push(waypointReached(waypointKeys.slice(1), routeKeys.slice(0, i + 1)));
    }
    this.progressAtStep = progressAtStep;
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
      ...(step.unknownIndex !== undefined ? { unknownIndex: step.unknownIndex } : {}),
      atEnd,
      finalStep: this.index === this.puzzle.steps.length - 1,
      waypoints: this.waypointList,
      progress: this.progressAtStep[Math.min(this.index, this.progressAtStep.length - 1)],
      attempts: this.attemptsCount,
    };
  }

  /** The answers that were not correct. The Drill's own score factor (DESIGN.md 6). */
  get attempts(): number {
    return this.attemptsCount;
  }

  /**
   * The steps whose answer has been SHOWN, ascending — the fact that decides whether this run counts at all.
   *
   * ASCENDING RATHER THAN INSERTION-ORDER, so the saved record is stable and a reload cannot rewrite it into a
   * different byte order for the same drill. The caller tests it for emptiness and sends its length.
   */
  get revealed(): readonly number[] {
    return [...this.revealedSteps].sort((a, b) => a - b);
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
   *
   * AND IT RECORDS THAT THE STEP WAS SHOWN, which is this method's other half now (DESIGN.md §15 Q16, §11.1 A28):
   * the button that calls this used to leave no trace the server could see, so pressing it and then pressing the
   * call it named earned a normal success — and ten of those mints a hint. The step is the one being decided
   * (`this.index`), because a correct answer is the only thing that advances the machine.
   */
  review(): PuzzleOption {
    if (!this.atEnd) this.revealedSteps.add(this.index);
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
