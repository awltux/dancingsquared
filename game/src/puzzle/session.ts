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
import type { GameApplier, Move, Puzzle, Refusal } from './types.ts';

/** One move the player made, with the board it was played from, so an undo can restore exactly. */
interface Played {
  call: string;
  from: Board;
  board: Board;
}

export type Verdict = 'correct' | 'wrong' | 'illegal';

export interface SessionView {
  board: Board;
  /** The calls played so far, in order — what a submission carries. */
  moves: string[];
  /** Whether a redo is available (i.e. the player has undone something and then not played a move). */
  canRedo: boolean;
  /** Whether the goal has been reached. */
  atGoal: boolean;
  /** How far the current board is from the goal, or null when it is further than the allowance. */
  remaining: number | null;
}

export class PlaySession {
  private readonly history: Played[] = [];
  private readonly redoStack: Played[] = [];
  private readonly distanceCache = new Map<string, Map<string, number>>();
  private readonly puzzle: Puzzle;
  private readonly applier: GameApplier;
  /** How many calls beyond the shortest the player may use. DESIGN.md 9's move allowance. */
  private readonly allowance: number;

  /**
   * THE FIELDS ARE DECLARED ABOVE AND ASSIGNED HERE, rather than written as constructor PARAMETER
   * PROPERTIES (`constructor(private readonly puzzle: Puzzle)`). That shorthand is idiomatic TypeScript
   * and it is refused outright by Node's strip-only type stripping, which is how every probe loads this
   * file ("TypeScript parameter property is not supported in strip-only mode" — measured). Since the
   * alternative is a build step whose output could disagree with what is type-checked, the long form is
   * the one that keeps the source loadable AND checked.
   */
  constructor(puzzle: Puzzle, applier: GameApplier, allowance?: number) {
    this.puzzle = puzzle;
    this.applier = applier;
    this.allowance = allowance ?? puzzle.shortest + MOVE_ALLOWANCE_CUSHION;
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

  atGoal(): boolean {
    return this.applier.boardsMatch(this.board, this.puzzle.goal);
  }

  view(): SessionView {
    return {
      board: this.board,
      moves: this.moves,
      canRedo: this.canRedo,
      atGoal: this.atGoal(),
      remaining: this.remaining(),
    };
  }

  /** The calls available from the current board, with their resulting boards. */
  offered(): Move[] {
    return this.applier.offered(this.board);
  }

  // ------------------------------------------------------------------ playing

  /**
   * Play `call` from the current board.
   *
   * THE VERDICT IS THREE-VALUED, and the distinction is the teaching content (DESIGN.md 8):
   *   * `illegal` — the engine refused it, and `reason` carries the engine's own string verbatim.
   *   * `wrong`   — it applied and did not reach the goal.
   *   * `correct` — it reached the goal.
   * Note that `wrong` is NOT a failure: DESIGN.md 9 chose honest offerings and free undo, so the player
   * is allowed to walk into a dead end and the SCORE is what makes that cost something. The session
   * never refuses a legal move.
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

  private remaining(): number | null {
    return this.distanceToGoal(this.board);
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
