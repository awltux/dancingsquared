// `DailyRun` — one attempt at one Daily Challenge: the move stack, the clock, the hints and the outcome.
//
// WHAT IT ADDS TO `PlaySession`. The session is the move stack, the offering list and the goal test, and it
// knows nothing about time, hints or scoring (its own header says so). A Daily run is those three things
// around it, and they are all rules rather than presentation:
//
//   * THE CLOCK STOPS ONCE, when the goal is reached or the player gives up (DESIGN.md 9: the run is the
//     unit, not the move).
//   * A HINT IS CHARGED ONCE and never refunded — not by an undo, and not by ignoring the advice
//     (DESIGN.md 10). The charge is derived from `hintsUsed` rather than stamped on the clock, so this
//     object cannot forget to add it.
//   * THE HINT'S MARKER IS VALID FROM THE BOARD IT WAS TAKEN ON. One call, named from the player's own
//     position (DESIGN.md 10), and the moment they move it is no longer a call they are standing in front
//     of — so the marker clears on the next move that lands while the charge and the count stay. Leaving it
//     lit would point at a call the offering list may not contain.
//   * SCORING IS `score.ts`'s, called ONCE, at the moment the outcome is decided, so the result card and
//     anything the server later recomputes are the same arithmetic.
//
// TIME IS INJECTED, exactly as the clock's own header says: every method that needs to know the time takes
// the frame's `nowMs`. Nothing here reads a date, so a run can be replayed in a probe second for second.

import type { Board } from 'dancing-squared-engine';
import { elapsedSeconds, scoreRun, type RunScore } from '../puzzle/score.ts';
import { PlaySession, type Verdict } from '../puzzle/session.ts';
import type { GameApplier, LevelSpec, Move, MoveReading, Puzzle } from '../puzzle/types.ts';
import { Stopwatch } from './clock.ts';
import type { DailySaved } from './store.ts';

/** How a run stands. `playing` is the only state in which a call may be added. */
export type DailyOutcome = 'playing' | 'solved' | 'given-up';

export interface DailyView {
  level: LevelSpec;
  /** The board the player is standing on, and the board they must reach. */
  board: Board;
  goal: Board;
  /**
   * The goal's formation name, for DISPLAY ONLY (DESIGN.md 4.2: naming a board is a teaching aid and never
   * the correctness test). Null when the engine does not name it, which the Daily's own gates make rare.
   */
  goalName: string | null;
  /**
   * EVERY legal move from `board` right now, with the reading that makes it legal — the offering list
   * (DESIGN.md 9, "what is legal now"), grouped by the dancers who can perform it.
   *
   * IT IS THE READINGS AND NOT `offered`: the Daily's picker offers "Heads Lead Right" as well as "Lead Right",
   * which the whole-board list cannot express, and the two are different moves. Dead ends are legitimate and are
   * NOT filtered out of this list's consequences — a call that leaves the player with nothing is the puzzle.
   *
   * IT STAYS POPULATED WHEN THE ALLOWANCE IS SPENT, and the screen disables the buttons with the reason.
   * Emptying the list instead would leave the player looking at a puzzle with no moves and no explanation
   * of why, which is the shape of a broken page rather than of a spent budget.
   */
  readings: MoveReading[];
  /** The calls played, in order, and whether either direction of the stack is available. */
  moves: string[];
  canUndo: boolean;
  canRedo: boolean;
  atGoal: boolean;
  /** Calls played and the calls allowed: "moves allowed: 3 of 4 used" (DESIGN.md 15, Q9). */
  movesUsed: number;
  allowance: number;
  movesLeft: number;
  /** The clock plus the hint charge, in seconds. */
  elapsedSeconds: number;
  /** Hints taken this run — part of the run's transcript, not a display detail (DESIGN.md 10). */
  hintsUsed: number;
  /** The call the last hint named, while it is still a call the player is standing in front of. */
  hintedCall: string | null;
  outcome: DailyOutcome;
  /** Present only once the run is over AND solved: a given-up run has a time and no score. */
  result: RunScore | null;
}

export class DailyRun {
  private readonly session: PlaySession;
  private readonly puzzle: Puzzle;
  private readonly applier: GameApplier;
  private readonly clock = new Stopwatch();
  private hintsUsed = 0;
  private hintedCall: string | null = null;
  private outcome: DailyOutcome = 'playing';
  private result: RunScore | null = null;

  /**
   * THE ALLOWANCE IS LAST, matching `PlaySession`'s own optional one: a caller that does not care about the
   * cushion passes three arguments and gets the shipped one. The clock starts HERE rather than on the first
   * move, because DESIGN.md 9's run begins when the board is shown — a player who stares at the puzzle for a
   * minute has spent that minute.
   */
  constructor(puzzle: Puzzle, applier: GameApplier, nowMs: number, allowance?: number) {
    this.puzzle = puzzle;
    this.applier = applier;
    this.session = new PlaySession(puzzle, applier, allowance);
    this.clock.start(nowMs);
  }

  /**
   * A run picked up from a saved record — the inverse of `save`, and the only way to build one that is not
   * starting now.
   *
   * THE CLOCK IS RE-BASED, NOT RESTARTED, and the GAP IS CHARGED: `gapMs` is the wall time the page was not
   * open (`store.wallGapMs`), and adding it is what stops a reload from being a pause button in the middle
   * of a timed puzzle. A run whose clock had already STOPPED (solved, or given up) gets no gap, because a
   * stopped clock was not counting while the page was away.
   *
   * A RECORD IS REJECTED, NOT REPAIRED, when the line no longer applies: the moves are replayed through the
   * same `play` the player's clicks go through, and a move the engine now refuses means this record does not
   * describe this puzzle — null, and the caller issues a fresh challenge. THAT IS THE ONE CASE A POOL OR
   * CORPUS CHANGE PRODUCES, and it is why the check is here rather than trusted from the store: only the
   * engine can say whether a call still applies.
   */
  static resume(
    puzzle: Puzzle,
    applier: GameApplier,
    nowMs: number,
    saved: DailySaved,
    opts: { gapMs?: number; allowance?: number } = {},
  ): DailyRun | null {
    const run = new DailyRun(puzzle, applier, nowMs, opts.allowance);
    const elapsedMs = saved.outcome === 'playing' ? saved.elapsedMs + Math.max(0, opts.gapMs ?? 0) : saved.elapsedMs;
    run.clock.resume(nowMs, elapsedMs);
    run.hintsUsed = Math.max(0, saved.hintsUsed);
    run.hintedCall = saved.hintedCall;
    for (const call of saved.moves) {
      const result = run.play(call, nowMs);
      if (result.verdict === 'illegal' || result.verdict === 'over') return null;
    }
    // A FINISHED RUN IS REPRODUCED FROM ITS OWN TERMS: the moves above re-reach the goal (which calls
    // `finish` at the frozen elapsed) or the record is inconsistent with itself and is refused.
    if (saved.outcome === 'solved' && run.outcome !== 'solved') return null;
    if (saved.outcome === 'given-up') run.giveUp(nowMs);
    return run;
  }

  /**
   * The run as a record, for the save.
   *
   * `elapsedMs` IS THE CLOCK, never the hint-charged total (`view().elapsedSeconds` adds the charge): the
   * charge is derived from `hintsUsed` wherever it is needed, and storing both would be two numbers that
   * could disagree after a retune of the penalty.
   *
   * THE DAY IS PASSED IN because a run does not know which day it is playing — the challenge's identity is
   * `(day, level)` and the app is what holds the calendar (`utcDay`), so the run records the day it is told
   * rather than asking a clock of its own (AGENTS.md 4.3: no ambient time in a computation).
   */
  save(day: string, runId: string, nowMs: number, wallNowMs: number): DailySaved {
    return {
      runId,
      day,
      levelIndex: this.puzzle.level.index,
      moves: this.session.moves,
      hintsUsed: this.hintsUsed,
      hintedCall: this.hintedCall,
      elapsedMs: Math.round(this.clock.elapsedSeconds(nowMs) * 1000),
      outcome: this.outcome,
      savedAtMs: Math.round(wallNowMs),
    };
  }
  /** The board the player is standing on. */
  get board(): Board {
    return this.session.board;
  }

  /** The board the challenge was issued on, which is what a review of a whole line starts from. */
  get start(): Board {
    return this.puzzle.start;
  }

  /**
   * Add a call.
   *
   * THE RUN REFUSES A CALL ONCE IT IS OVER, and it says so with the same `over` verdict the allowance uses:
   * from the player's point of view both mean "this run will not take another call", and the reason string
   * is what distinguishes them. The offering list is hidden by then, so this is a guard against a stale
   * click rather than a path a player walks.
   */
  play(call: string, nowMs: number): { verdict: Verdict; board: Board; reason?: string } {
    if (this.outcome !== 'playing') {
      return { verdict: 'over', board: this.board, reason: 'this run is over — it has already been scored' };
    }
    const result = this.session.play(call);
    // THE MARKER CLEARS ON A MOVE THAT LANDED, whatever its verdict: the hint named a call from the board
    // the player was standing on, and a move that applied has taken them off it. The verdict is the test
    // rather than the board, because `illegal` and `over` both return the player's own board unchanged.
    if (result.verdict === 'correct' || result.verdict === 'wrong') this.hintedCall = null;
    if (result.verdict === 'correct') this.finish(nowMs);
    return result;
  }

  /** Undo the last call. Free and unpunished (DESIGN.md 9) — and it does NOT refund a hint. */
  undo(): boolean {
    if (this.outcome !== 'playing') return false;
    return this.session.undo();
  }

  /** Redo the most recently undone call. */
  redo(): boolean {
    if (this.outcome !== 'playing') return false;
    return this.session.redo();
  }

  /**
   * Take a hint: name one call that makes progress from where the player is, and charge for it.
   *
   * THE BALANCE IS NOT THIS OBJECT'S BUSINESS. Whether the player HAS a hint to spend is the earning
   * ledger's (`puzzle/hints.ts`), and the app asks it first — so this method is the SPENDING side only, and
   * a probe can drive it with no ledger at all.
   *
   * `named` IS THE SERVER'S CALL, when there is a server (A23's naming): it looked the call up from the RECORDED
   * line, which is the board the player is actually on, where this object's own look-up runs from the position it
   * believes it is on — and a move still in flight is a difference. Passing it in is what makes ONE name for one
   * fact; omitting it keeps the offline path exactly as it was, which is the local look-up below.
   *
   * `spent: false` WITH A NULL CALL means there is nothing to hint from here (no call is offered), which is
   * reported rather than thrown: the screen's hint button is disabled in that state, so reaching it is a
   * stale click, not a bug.
   */
  takeHint(named: string | null = null): { call: string | null; spent: boolean } {
    if (this.outcome !== 'playing') return { call: null, spent: false };
    const call = named ?? this.session.hint();
    if (call === null) return { call: null, spent: false };
    this.hintsUsed++;
    this.hintedCall = call;
    return { call, spent: true };
  }

  /** Give up: freeze the clock and the time, with no score (DESIGN.md 9's review still applies). */
  giveUp(nowMs: number): void {
    if (this.outcome !== 'playing') return;
    this.clock.stop(nowMs);
    this.outcome = 'given-up';
  }

  /** The two lines a review can dance: the player's own, and the generator's shortest. */
  review(): { mine: string[]; shortest: string[] } {
    return { mine: this.session.moves, shortest: [...this.puzzle.solution] };
  }

  /**
   * The run as a SUBMISSION carries it, in the shape the server's `POST /runs` takes.
   *
   * WHY THE CLOCK IS SENT RATHER THAN THE TIME THE PLAYER IS JUDGED ON. `view().elapsedSeconds` is the clock PLUS
   * the hint charge, and the server adds that charge itself from `hintsUsed` (DESIGN.md 6, 10: one term, one place
   * to tune) — so sending the charged total would charge every hint twice. The subtraction here is the exact
   * inverse of `elapsedSeconds(clock, hints)` in `puzzle/score.ts`, and `daily-run-probe.mjs` pins the round trip
   * rather than trusting it: a run with three hints and a hundred seconds of thinking is worth what a run with no
   * hints and 280 seconds is, and the server recomputes it from these two numbers.
   *
   * `moves` IS THE TRANSCRIPT the server walks through the engine to verify the goal (DESIGN.md 11), and it is the
   * player's OWN line — a different route to the same board is legitimate and scores the same.
   */
  submissionFacts(nowMs: number): { clockSeconds: number; calls: string[]; hintsUsed: number; score: number } {
    const clockSeconds = this.clock.elapsedSeconds(nowMs);
    return {
      clockSeconds,
      calls: [...this.session.moves],
      hintsUsed: this.hintsUsed,
      score: this.result ? this.result.score : 0,
    };
  }

  view(nowMs: number): DailyView {
    const clockSeconds = this.clock.elapsedSeconds(nowMs);
    const session = this.session.view();
    return {
      level: this.puzzle.level,
      board: this.board,
      goal: this.puzzle.goal,
      goalName: this.applier.nameOf(this.puzzle.goal),
      readings: this.outcome === 'playing' ? this.session.readings() : [],
      moves: session.moves,
      canUndo: this.outcome === 'playing' && session.movesUsed > 0,
      canRedo: this.outcome === 'playing' && session.canRedo,
      atGoal: session.atGoal,
      movesUsed: session.movesUsed,
      allowance: session.allowance,
      movesLeft: session.movesLeft,
      elapsedSeconds: elapsedSeconds(clockSeconds, this.hintsUsed),
      hintsUsed: this.hintsUsed,
      hintedCall: this.hintedCall,
      outcome: this.outcome,
      result: this.result,
    };
  }

  /**
   * Finish a solved run: stop the clock and score it, ONCE.
   *
   * `attempts: 0` IS THE DESIGN, NOT AN OMISSION. DESIGN.md 6 makes `attemptFactor` Drill-only: a Daily
   * move that does not reach the goal is already priced by `wasteFactor`, and charging it twice would make
   * the Daily's first wrong turn cost more than the Drill's.
   */
  private finish(nowMs: number): void {
    if (this.outcome !== 'playing') return;
    this.clock.stop(nowMs);
    this.outcome = 'solved';
    this.result = scoreRun({
      level: this.puzzle.level,
      shortest: this.puzzle.shortest,
      moves: this.session.movesUsed,
      clockSeconds: this.clock.elapsedSeconds(nowMs),
      hintsUsed: this.hintsUsed,
      attempts: 0,
    });
  }
}
