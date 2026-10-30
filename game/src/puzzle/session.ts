// `PlaySession` — the player's state machine over a puzzle: add a call, undo, redo, and ask whether the
// goal has been reached.
//
// PURE OVER ITS INPUTS. The session holds no sequencer; it asks an injected `GameApplier` for the moves
// available from a board, and it asks the rule (`reachesGoal` for the board, `waypointReached` for the sequence)
// whether the run is won. That is what lets a probe drive a whole session with a stub and no corpus, and it is
// why the numbers here carry no timing or I/O.
//
// THE DAILY IS WON BY THE WAYPOINTS, NOT BY THE FINAL BOARD. The goal board alone was the rule until the Daily
// became a sequence: the puzzle's goal is the LAST waypoint, and a line that reaches that arrangement without
// standing in the ones before it has not solved it — REPORTED, after a generated Daily turned out to be two
// waypoints with the goal one call from the start, so the "challenge" was a single call and two presses of the same
// call. So `atGoal` requires both: the board is the goal's arrangement AND every waypoint was passed IN ORDER. The
// count is derived from the move stack (`playedBoards`), so an undo rewinds it and it cannot disagree with the line
// the server replays.
//
// WHAT IS DELIBERATELY NOT HERE:
//   * No SCORE. Scoring is `score.ts`'s, and the session does not know about time or hints — it records
//     what was played, which is what a submission needs.
//   * No HINT STATE. `hint()` computes a suggestion; whether the player took it is the game's business
//     (and the server's, per DESIGN.md 10's ledger), not the session's.
//
// THE HINT AIMS AT THE NEXT WAYPOINT. It used to run a reverse BFS from the goal, which both cost 79-91 s for the
// table (ONE build at the level-1 pool) and, once the sequence gated the run, could name a call that walked PAST the
// waypoint the player still had to stand in. See `hint` for the search that replaced it.
//
// THERE IS NO CALL LIMIT. REPORTED: "Is the moves allowed and timer really necessary for the gameplay? Remove the move
// limit, a player should be able to use as many moves as they want, but it will be detramental to their final score." The
// allowance (shortest + a two-call cushion) used to be here, and it existed because with free undo and honest offerings an
// unlimited budget would let a player eliminate their way down to any displayed board. What prices that is `wasteFactor`
// (§6): `shortest / max(1, moves)`, so every call past par divides the score and a fifty-move run is worth a tenth of a
// four-move one. The cap was a second, blunter mechanism for the same concern, and it removed the play rather than pricing
// it.

import type { Board } from 'dancing-squared-engine';
import { sameArrangement, waypointBoards, waypointReached } from './arrangement.ts';
import { HINT_SEARCH_DEPTH, HINT_SEARCH_NODES } from './config.ts';
import { poseKey } from './pose-key.ts';
import type { GameApplier, Move, MoveReading, Puzzle, Refusal } from './types.ts';

/** One move the player made, with the board it was played from, so an undo can restore exactly. */
interface Played {
  call: string;
  from: Board;
  board: Board;
}

/**
 * What playing one call did.
 *
 * `over` IS NOT AN ENGINE VERDICT and is kept distinct from the other three for that reason: the call is perfectly legal
 * and the engine would apply it, but the RUN is finished — it has been scored, or given up — so there is nothing left to
 * play it against. Folding it into `illegal` would show the player a legality reason that is not true, and folding it into
 * `wrong` would apply a move to a run that is over. The session itself never answers `over`: a run has NO CALL LIMIT (see
 * `play`), so the only producer is `DailyRun.play`'s finished-run guard.
 */
export type Verdict = 'correct' | 'wrong' | 'illegal' | 'over';

export interface SessionView {
  board: Board;
  /** The calls played so far, in order — what a submission carries. */
  moves: string[];
  /** Whether a redo is available (i.e. the player has undone something and then not played a move). */
  canRedo: boolean;
  /** Whether the goal has been reached. */
  atGoal: boolean;
  /** Calls played — what the UI reads back as "12 moves", and what `wasteFactor` is priced against. */
  movesUsed: number;
}

export class PlaySession {
  private readonly history: Played[] = [];
  private readonly redoStack: Played[] = [];
  /**
   * THE SEQUENCE THE RUN IS WON BY: the puzzle's route as ARRANGEMENTS, the start first and the goal last.
   *
   * DERIVED FROM `puzzle.path` RATHER THAN A SECOND FIELD, and collapsed by `waypointBoards` for the reason that
   * function gives: a call that leaves the set in the arrangement it was already in has reached no new waypoint. A
   * generated Daily never produces such a step, so its list is exactly as long as the level asked for.
   */
  private readonly waypointList: readonly Board[];
  private readonly puzzle: Puzzle;
  private readonly applier: GameApplier;

  /**
   * THE FIELDS ARE DECLARED ABOVE AND ASSIGNED HERE, rather than written as constructor PARAMETER
   * PROPERTIES (`constructor(private readonly puzzle: Puzzle)`). That shorthand is idiomatic TypeScript
   * and it is refused outright by Node's strip-only type stripping, which is how every probe loads this
   * file ("TypeScript parameter property is not supported in strip-only mode" — measured). Since the
   * alternative is a build step whose output could disagree with what is type-checked, the long form is
   * the one that keeps the source loadable AND checked.
   */
  constructor(puzzle: Puzzle, applier: GameApplier) {
    this.puzzle = puzzle;
    this.applier = applier;
    this.waypointList = waypointBoards(puzzle.path);
  }

  // ------------------------------------------------------------------ reading

  get board(): Board {
    return this.history.length ? this.history[this.history.length - 1].board : this.puzzle.start;
  }

  get moves(): string[] {
    return this.history.map((h) => h.call);
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get movesUsed(): number {
    return this.history.length;
  }

  /**
   * Whether the run is WON: the board is the goal's arrangement AND every waypoint has been passed, in order.
   *
   * THE SECOND HALF IS THE SEQUENCE, and it is what makes a Daily a route rather than a target: a line that lands on
   * the last waypoint's arrangement from somewhere else has skipped the puzzle. `waypointReached` counts the
   * arrangements `playedBoards()` has stood in, monotonically, so a player who wanders off and comes back keeps what
   * they passed — which is what free undo and a wasted-call price are for.
   *
   * A PUZZLE WHOSE ROUTE IS ONLY ITS GOAL (`keys.length <= 2`, which includes a `path` of one board or none) says
   * nothing more than "reach the goal board", so that is the whole of the rule there — the same test as before the
   * sequence existed. A generated Daily always has at least 5 waypoints, so this is the hand-built case.
   */
  atGoal(): boolean {
    if (!this.applier.reachesGoal(this.board, this.puzzle.goal)) return false;
    const waypoints = this.waypointList;
    if (waypoints.length <= 2) return true;
    return waypointReached(waypoints.slice(1), this.playedBoards()) === waypoints.length - 1;
  }

  view(): SessionView {
    return {
      board: this.board,
      moves: this.moves,
      canRedo: this.canRedo,
      atGoal: this.atGoal(),
      movesUsed: this.movesUsed,
    };
  }

  /** The calls available from the current board, with their resulting boards — the WHOLE-BOARD list. */
  offered(): Move[] {
    return this.applier.offered(this.board);
  }

  /**
   * Every board the player has stood on, in order — the start first, then each move's arrival.
   *
   * WHY IT IS A METHOD RATHER THAN THE VIEW'S `board`: a waypoint is satisfied by a BOARD THE PLAYER WAS ON, and the
   * count has to be recoverable after an UNDO. Deriving it from the history means there is no second progress record
   * to keep in step with the move stack — the stack IS the progress (`puzzle/arrangement.ts`).
   */
  playedBoards(): Board[] {
    return [this.puzzle.start, ...this.history.map((played) => played.board)];
  }

  /**
   * EVERY legal move from the current board with the reading that makes it legal: the whole board and each group.
   *
   * THE DAILY'S PICKER IS THIS LIST, and the difference from `offered` is not cosmetic: `offered` cannot express
   * "Heads Dosado" at all, and the two lists disagree in both directions (a call legal for a group and not for the
   * set, and the reverse). It is asked of the applier on every view, which is why the applier caches it by board.
   */
  readings(): MoveReading[] {
    return this.applier.readings(this.board);
  }

  // ------------------------------------------------------------------ playing

  /**
   * Play `call` from the current board.
   *
   * THE VERDICT IS THREE-VALUED HERE — `illegal`, `wrong`, `correct` — and the distinction is the teaching content
   * (DESIGN.md 8): `illegal` carries the engine's own refusal string verbatim, `wrong` applied and did not reach the goal,
   * `correct` reached it. (`over` exists in `Verdict` for a FINISHED run, which only `DailyRun.play` can answer.)
   * Note that `wrong` is NOT a failure: DESIGN.md 9 chose honest offerings and free undo, so the player
   * is allowed to walk into a dead end and the SCORE is what makes that cost something.
   *
   * AND THE SESSION NEVER REFUSES A LEGAL MOVE AT ALL, because there is no call limit (see the header): a run may be as
   * long as the player likes, and `wasteFactor` is what charges it. The old budget was checked before the call was even
   * looked at, so a spent run reported a mixture of `illegal` and `over` depending on the press; with the budget gone there
   * is nothing to order.
   */
  play(call: string): { verdict: Verdict; board: Board; reason?: string } {
    const refusal: Refusal | null = this.applier.refusalOf(this.board, call);
    if (refusal) return { verdict: 'illegal', board: this.board, reason: refusal.reason };

    const from = this.board;
    const board = this.applier.apply(from, call);
    this.history.push({ call, from, board });
    // A NEW MOVE TRUNCATES THE REDO BRANCH: the undone moves were alternatives to this one, and
    // keeping them would offer a redo that no longer follows from the current board.
    this.redoStack.length = 0;
    return { verdict: this.atGoal() ? 'correct' : 'wrong', board };
  }

  /** Undo the last move. Returns whether anything was undone. */
  undo(): boolean {
    const last = this.history.pop();
    if (!last) return false;
    this.redoStack.push(last);
    return true;
  }

  /** Redo the most recently undone move. Returns whether anything was redone. */
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.history.push(next);
    return true;
  }

  // ------------------------------------------------------------------ the hint

  /**
   * The arrangement the run must reach next, or null when the sequence is complete (or the puzzle has none).
   *
   * THE START IS WAYPOINT 1 AND IS REACHED BY STANDING ON IT, so what counts here is the waypoints after it — the same
   * `slice(1)` the Daily's progress readout uses. A complete sequence returns null rather than the goal, because a
   * player who has passed every waypoint has nowhere further to be told to go.
   */
  private nextWaypoint(): Board | null {
    const waypoints = this.waypointList;
    if (waypoints.length === 0) return null;
    const reached = waypointReached(waypoints.slice(1), this.playedBoards());
    return reached + 1 < waypoints.length ? waypoints[reached + 1] : null;
  }

  /**
   * A call that moves the set towards the arrangement `target`, or null when none was found inside the budget.
   *
   * A FORWARD BREATH-FIRST WALK THAT STOPS ON THE TARGET, and its cost is why: the common case is that the next
   * waypoint is ONE call away — that is where the generator put it — so the first pass answers from the offer list
   * that `hint` had to compute anyway, and the traversal is never entered. MEASURED at the shipped level-1 pool: one
   * `offered` is ~1.7 ms, so one pass is [the p60 of the hint's own measurement] and the fallback budget below is
   * what bounds a player who has wandered far from the route.
   *
   * THE SEARCH KEYS BOARDS BY `poseKey`, never `boardSig`: positions-only is trap 11, and MEASURED the first version of
   * this search deduped by signature — so the route's own next board, which shares its POSITIONS with a sibling and
   * differs only in FACING, was dropped as a duplicate and the search walked on until its budget ran out (4621 ms for a
   * hint that was one call away). The target test is `sameArrangement`, the same relation a waypoint uses — including
   * its tolerance — so the answer cannot be a call that satisfies the display and not the sequence.
   */
  private stepToward(target: Board, offered: readonly Move[]): string | null {
    // THE FIRST CALL IS PART OF THE ANSWER, so the frontier carries it rather than re-deriving a path at the end.
    const seen = new Set<string>();
    let frontier: { first: string; board: Board }[] = [];
    for (const move of offered) {
      const pose = poseKey(move.board);
      if (seen.has(pose)) continue;
      seen.add(pose);
      frontier.push({ first: move.call, board: move.board });
    }
    let expanded = 0;
    for (let depth = 1; depth <= HINT_SEARCH_DEPTH && frontier.length > 0; depth++) {
      const next: { first: string; board: Board }[] = [];
      for (const node of frontier) {
        if (sameArrangement(node.board, target)) return node.first;
        if (expanded++ >= HINT_SEARCH_NODES) return null;
        for (const move of this.applier.offered(node.board)) {
          const pose = poseKey(move.board);
          if (seen.has(pose)) continue;
          seen.add(pose);
          next.push({ first: node.first, board: move.board });
        }
      }
      frontier = next;
    }
    return null;
  }

  /**
   * A call that makes progress towards the NEXT WAYPOINT, chosen from what is offered NOW.
   *
   * WHY THE TARGET IS THE NEXT WAYPOINT AND NOT THE GOAL: the run is won by passing the waypoints in order, so a hint
   * aimed at the goal board can name a call that walks PAST the one the player still has to stand in — advice that
   * makes the puzzle longer. REPORTED together with the sequence rule itself.
   *
   * TIES BREAK BY THE OFFER ORDER, which the applier defines and which the generator sorts by name — so the same board
   * and the same level give the same hint on both sides of the wire, which is what lets the server check a claimed
   * hint instead of trusting it (DESIGN.md 11). A tie broken by object iteration order would make that check
   * impossible, and `stepToward` inherits the order from the list it was handed.
   *
   * NULL IS AN ANSWER in one state: nothing is offered (a dead end, where naming a call would point at a button that is not
   * there). It used to answer null for a spent allowance too — there is no allowance any more (see the header), so that
   * second case died with it. Otherwise the first offered call is the fallback, because a legal call is a better answer
   * than none.
   */
  hint(): string | null {
    const offered = this.offered();
    if (offered.length === 0) return null;
    const target = this.nextWaypoint();
    // NO TARGET LEFT: every waypoint has been passed, which is a run that has already been won — so a hint has nothing
    // to point at and the first legal call is the honest answer.
    if (target === null) return offered[0].call;
    return this.stepToward(target, offered) ?? offered[0].call;
  }
}
