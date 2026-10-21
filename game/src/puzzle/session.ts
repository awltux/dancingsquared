// `PlaySession` — the player's state machine over a puzzle: add a call, undo, redo, and ask whether the
// goal has been reached.
//
// PURE OVER ITS INPUTS. The session holds no sequencer; it asks an injected `GameApplier` for the moves
// available from a board, and it asks the engine's rule (`sameBoardById`) whether a board is the goal.
// That is what lets a probe drive a whole session with a stub and no corpus, and it is why the numbers
// here carry no timing or I/O.
//
// WHAT IS DELIBERATELY NOT HERE:
//   * No SCORE. Scoring is `score.ts`'s, and the session does not know about time or hints — it records
//     what was played, which is what a submission needs.
//   * No HINT STATE. `hint()` computes a suggestion; whether the player took it is the game's business
//     (and the server's, per DESIGN.md 10's ledger), not the session's.
//
// THE DISTANCE MAP IS BFS FROM THE GOAL, per board, memoised. DESIGN.md 7 describes the generator's
// forward BFS as the source of the distance map, and for the INTENDED PATH it is — but the player may
// stand on a board the generator never visited, and a hint has to be right from THERE. A reverse BFS
// from the goal answers for any board, and it is bounded by the allowance: anything further away than
// the allowance cannot be on a winning line anyway, so the search stops rather than exploring a
// corridor of states nobody can use.

import { boardSig, type Board } from 'dancing-squared-engine';
import { MOVE_ALLOWANCE_CUSHION, NODE_BUDGET } from './config.ts';
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
 * `over` IS NOT AN ENGINE VERDICT and is kept distinct from the other three for that reason: the call is
 * perfectly legal, the engine would apply it, and the RUN refuses it because the move allowance is spent
 * (DESIGN.md 9). Folding it into `illegal` would show the player a legality reason that is not true, and
 * folding it into `wrong` would apply a move the budget does not allow.
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
  /** Calls played, and the calls this puzzle allows — what the UI shows as "3 of 4 used". */
  movesUsed: number;
  allowance: number;
  /** How many calls are still available before the cap; never negative. */
  movesLeft: number;
}

export class PlaySession {
  private readonly history: Played[] = [];
  private readonly redoStack: Played[] = [];
  /**
   * The reverse-BFS tables, keyed by the goal's signature — INJECTABLE, and that is a measured correction.
   *
   * THE TABLE IS THE EXPENSIVE PART OF A HINT: it walks the goal's backward cone with `applier.offered` at every
   * board. MEASURED at the shipped level-1 pool (57 titles), ONE build is **79-91 s**, and the cache used to live
   * only on this object — so the server, which builds a session per hint spend, rebuilt it for EVERY hint and
   * `api/test/hint-event-probe.mjs` took 770 s. The session is per-line; the table is per PUZZLE, and a caller
   * that serves more than one line from the same puzzle has to be able to share it.
   */
  private readonly distanceCache: Map<string, Map<string, number>>;
  private readonly puzzle: Puzzle;
  private readonly applier: GameApplier;
  /** How many calls beyond the shortest the player may use. DESIGN.md 9's move allowance. */
  private readonly budget: number;

  /**
   * THE FIELDS ARE DECLARED ABOVE AND ASSIGNED HERE, rather than written as constructor PARAMETER
   * PROPERTIES (`constructor(private readonly puzzle: Puzzle)`). That shorthand is idiomatic TypeScript
   * and it is refused outright by Node's strip-only type stripping, which is how every probe loads this
   * file ("TypeScript parameter property is not supported in strip-only mode" — measured). Since the
   * alternative is a build step whose output could disagree with what is type-checked, the long form is
   * the one that keeps the source loadable AND checked.
   */
  constructor(puzzle: Puzzle, applier: GameApplier, allowance?: number, distanceCache?: Map<string, Map<string, number>>) {
    this.puzzle = puzzle;
    this.applier = applier;
    this.budget = allowance ?? puzzle.shortest + MOVE_ALLOWANCE_CUSHION;
    // THE DEFAULT IS A PRIVATE TABLE, which is what a single line wants; a server passes one it keeps per puzzle.
    this.distanceCache = distanceCache ?? new Map();
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

  /** The most calls this run may play. The field is `budget` so the getter can own the public name. */
  get allowance(): number {
    return this.budget;
  }

  get movesUsed(): number {
    return this.history.length;
  }

  get movesLeft(): number {
    return Math.max(0, this.budget - this.history.length);
  }

  atGoal(): boolean {
    return this.applier.boardsMatch(this.board, this.puzzle.goal);
  }

  view(): SessionView {
    return {
      board: this.board,
      moves: this.moves,
      canRedo: this.canRedo,
      atGoal: this.atGoal(),
      movesUsed: this.movesUsed,
      allowance: this.budget,
      movesLeft: this.movesLeft,
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
   * THE VERDICT IS FOUR-VALUED, and the distinction is the teaching content (DESIGN.md 8):
   *   * `illegal` — the engine refused it, and `reason` carries the engine's own string verbatim.
   *   * `wrong`   — it applied and did not reach the goal.
   *   * `correct` — it reached the goal.
   *   * `over`    — the allowance is spent, so this run may not play another call at all.
   * Note that `wrong` is NOT a failure: DESIGN.md 9 chose honest offerings and free undo, so the player
   * is allowed to walk into a dead end and the SCORE is what makes that cost something. The session
   * never refuses a legal move except for the budget.
   *
   * THE BUDGET IS CHECKED BEFORE THE CALL IS EVEN LOOKED AT, and that is a decision rather than an
   * ordering accident: with the check second, a spent run would report a mixture of `illegal`, `wrong` and
   * `over` depending on which call the player happened to press, so the same state would sometimes explain
   * itself and sometimes not. What the player needs to hear at the cap is the one actionable sentence,
   * whether or not the call was also legal.
   */
  play(call: string): { verdict: Verdict; board: Board; reason?: string } {
    if (this.movesLeft === 0) {
      return {
        verdict: 'over',
        board: this.board,
        reason: `the allowance of ${this.budget} call(s) is used up — undo one to free a call`,
      };
    }
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

  // ------------------------------------------------------------------ distance and the hint

  /**
   * The distance from `board` to the goal, or null when it is further than the allowance.
   *
   * WHY A REVERSE BFS RATHER THAN THE GENERATOR'S MAP. `boardSig` is positions-only, so the
   * generator's map cannot distinguish two facing-different boards that share a signature — and the
   * engine's own goal test does. A distance looked up from a signature map could therefore report a
   * board as "one away" when its FACING is wrong. This search keys on the signature too (it must, or it
   * would not terminate on a continuous state space), but it stops at the allowance and it is only ever
   * a HINT, never the correctness test — `atGoal` is the engine's rule.
   */
  distanceToGoal(board: Board = this.board): number | null {
    const goalSig = boardSig(this.puzzle.goal);
    let table = this.distanceCache.get(goalSig);
    if (!table) {
      table = new Map<string, number>([[goalSig, 0]]);
      let frontier: Board[] = [this.puzzle.goal];
      let budget = NODE_BUDGET;
      for (let d = 1; d <= this.allowance && frontier.length && budget > 0; d++) {
        const next: Board[] = [];
        for (const b of frontier) {
          for (const move of this.applier.offered(b)) {
            if (budget-- <= 0) break;
            const sig = boardSig(move.board);
            if (table.has(sig)) continue;
            table.set(sig, d);
            next.push(move.board);
          }
          if (budget <= 0) break;
        }
        frontier = next;
      }
      this.distanceCache.set(goalSig, table);
    }
    const d = table.get(boardSig(board));
    return d === undefined ? null : d;
  }

  /**
   * A call that makes progress, chosen from what is offered NOW: the offered move whose ending is one
   * step closer to the goal.
   *
   * TIES BREAK BY THE OFFER ORDER, which the applier defines and which the generator sorts by name —
   * so the same board and the same level give the same hint on both sides of the wire, which is what
   * lets the server check a claimed hint instead of trusting it (DESIGN.md 11). A tie broken by object
   * iteration order would make that check impossible.
   */
  hint(): string | null {
    const here = this.distanceToGoal();
    const offered = this.offered();
    if (offered.length === 0) return null;
    if (here === null) return offered[0].call;
    for (const move of offered) {
      if (this.distanceToGoal(move.board) === here - 1) return move.call;
    }
    return offered[0].call;
  }
}
