// Body-relative "coded" calls: Face / Turn / In / Out. Like Face Left and Face
// Right in Taminations, these are the same per-dancer transform regardless of
// formation, so they are applied straight from the geometry rather than matched
// to a catalog <tam>.
//
// This is the SINGLE source of truth for them. The Sequencer applies them to the
// live board, and the SequenceAnalyzer replays and animates them, so a sequence
// containing a coded move has real beats and animates instead of silently
// contributing nothing.
//
// A coded move occupies CODED_MOVE_BEATS on the timeline and animates as a smooth
// rotation from each dancer's current facing to the new one (positions do not
// change: these are pivots and re-facings).
//
// A GEOMETRY-DERIVED call may also carry a PRECONDITION (`applies`): `Promenade`
// is legal only from a set the dancers can wheel home from, and it is not a pivot
// (it moves everybody). It is registered here because it needs exactly what this
// registry provides — one definition shared by the Sequencer and the analyser, with
// a beat count — and its rule lives in promenade.ts.

import { applyMoveToBoard, applyFaceInOutToBoard, FaceLeft, FaceRight, FaceHalf, normAngle } from '../moves.js';
import { promenadeApplies, promenadeHome, promenadeProblem, PROMENADE_ALIASES, PROMENADE_BEATS } from './promenade.js';
import { runRule, tradeRule } from './trade-run.js';
import type { Board } from './types.js';

/** Timeline length of a coded pivot, in beats. */
export const CODED_MOVE_BEATS = 1;

/** Timeline length of the derived Run / Trade, in beats — the value the authored `Run` and
 * `Trade` tams carry, so the timeline does not shift when the derived call replaces them. */
export const RUN_TRADE_BEATS = 4;

/** Timeline length of `Roll`, in beats — the reference's `QuarterLeft`/`QuarterRight` carry
 * `beats: 1.5` (`moves.dart:56-58`), and `Roll` is exactly that move chosen per dancer. */
export const ROLL_BEATS = 1.5;

/**
 * `Roll`: each dancer turns a quarter in the direction they were ALREADY turning, and a dancer
 * who was not turning does not move at all.
 *
 * This is the reference's rule verbatim (`taminations-flutter/lib/sequencer/calls/plus/roll.dart`):
 *
 *     final roll = ctx.roll(d);
 *     final move = {Rolling.LEFT: QuarterLeft, Rolling.RIGHT: QuarterRight, Rolling.NONE: Stand}[roll]!;
 *
 * which is also why the call's own help text says "The sequencer calculates Roll based on the
 * turning motion at the end of the previous call", and why `performCall` refuses when it does not
 * follow another call: without a previous turn there is no direction to continue.
 *
 * OUR SOURCE FOR THE DIRECTION is `SeqDancer.lastTurnDir`, the remembered turn direction the
 * engine records as it applies a call. Two honest limitations, both recorded rather than hidden:
 *
 *  - the reference reads the tangent at the END of the previous call's path (`bezier.dart`
 *    `rolling()`, which special-cases a 180-degree turn to the halfway tangent). We record the
 *    NET heading delta, which is a coarser quantity: for a call where dancers curve one way and
 *    finish facing another, the two can disagree. A net 180 degrees is the same number for left
 *    and right, so that case keeps the previous direction instead of inventing one;
 *  - `lastTurnDir` is only meaningful for the most recent turning call, which is the same
 *    scope the reference gives `ctx.roll`.
 *
 * It REFUSES when no dancer has a remembered direction, which is the reference's own refusal
 * ("and Roll" must follow another call) expressed over the board rather than over a call stack.
 */
function rollRule(board: Board): Board {
  return {
    dancers: board.dancers.map((d) => {
      if (d.isGhost || !d.lastTurnDir) return d;
      // A quarter turn in the remembered direction, with the position unchanged. `turn` is
      // "+ = left / CCW" (moves.ts), so left adds and right subtracts.
      const turn = d.lastTurnDir === 'left' ? Math.PI / 2 : -Math.PI / 2;
      return { ...d, heading: normAngle(d.heading + turn) };
    }),
  };
}

/** Why `Roll` cannot apply: nothing remembers a direction, so there is nothing to continue. */
function rollProblem(board: Board): string | null {
  const physical = board.dancers.filter((d) => !d.isGhost);
  if (physical.length === 0) return 'Roll needs dancers to roll';
  if (!physical.some((d) => d.lastTurnDir)) {
    return 'Roll continues the direction the dancers were already turning, and nothing has turned them yet';
  }
  return null;
}

export interface CodedMove {
  /** Canonical display name (the first alias). */
  name: string;
  /** Every authored alias that resolves to this move. */
  aliases: string[];
  /** Timeline length of the pivot, in beats. */
  beats: number;
  /** Whether the move applies to this board. Absent means always: a pure pivot
   * applies from any board, whereas a whole-set resolve has preconditions. Returns
   * null when it applies, otherwise the reason it does not. */
  precondition?: (board: Board) => string | null;
  /** Whole-board transform at completion. Only called when it applies. */
  apply(board: Board): Board;
  /** Transform for a DESIGNATED SUBSET, for a call whose non-designated dancers must also
   * move. `Run` and `Trade` are the cases: a Run's walker steps into the vacated place, and a
   * Trade's intervening dancers must be kept in place while the traders pass. The generic
   * "apply the whole-board transform, then keep only the designated dancers' results" that
   * `Sequencer.tryCodedMove` uses for the pivots cannot express either — it would throw away
   * the walker's motion and leave two dancers on one spot.
   *
   * A move that defines this is still refused for the BARE name (a `precondition` that
   * rejects it), because `Trade` and `Run` have no whole-set reading: they always name a
   * subset ("Boys Trade", "Centers Run"). */
  applyToSelection?(board: Board, selectedIds: number[]): { board: Board } | { reason: string };
}

const DEFS: {
  aliases: string[];
  fn?: (b: Board) => Board;
  beats?: number;
  precondition?: (b: Board) => string | null;
  applyToSelection?: (b: Board, ids: number[]) => { board: Board } | { reason: string };
}[] = [
  { aliases: ['Face Right', 'Turn Right', 'Right Face'], fn: (b) => applyMoveToBoard(b, FaceRight) },
  { aliases: ['Face Left', 'Turn Left', 'Left Face'], fn: (b) => applyMoveToBoard(b, FaceLeft) },
  { aliases: ['Face Half', 'U-Turn Back', 'Face Back'], fn: (b) => applyMoveToBoard(b, FaceHalf) },
  { aliases: ['Face In', 'Turn In'], fn: (b) => applyFaceInOutToBoard(b, true) },
  { aliases: ['Face Out', 'Turn Out'], fn: (b) => applyFaceInOutToBoard(b, false) },
  // Promenade: the standard finish. Unlike the pivots above it is NOT always
  // legal, so it carries its precondition and reports the reason it fails.
  { aliases: PROMENADE_ALIASES, beats: PROMENADE_BEATS, precondition: promenadeProblem, fn: (b) => promenadeHome(b).board },
  // Run and Trade: derived because Taminations implements them in code and marks every
  // authored `Run` tam (32) and bare `Trade` not-for-sequencer — see trade-run.ts for the rule
  // and for the measurement that settled the facing half of it. Both REFUSE without a
  // designation, which is correct rather than a placeholder: "Trade" and "Run" on their own
  // name no subset, so there is nothing to apply them to.
  {
    aliases: ['Run'],
    beats: RUN_TRADE_BEATS,
    precondition: () => 'Run names a group to run ("Boys Run", "Centers Run"); it has no whole-set reading',
    applyToSelection: runRule,
  },
  // DIRECTION-SPECIFIED RUNS. All8 writes them `G-RunL` / `B-RunR` and the corpus uses them
  // (Run Left 4 lines, Run Right 3, both previously reported as "not legal for selected dancers").
  // They are the SAME derived Run with the side constrained, not a second choreography: runRule
  // already computes which side the dancer to be run around is on, so a direction selects one of
  // those sets and refuses when it is empty. That is the same footing as the separation fixes -
  // the constraint comes from geometry already in hand - which is why this is authored here
  // rather than inferred like a facing would have to be.
  {
    aliases: ['Run Left'],
    beats: RUN_TRADE_BEATS,
    precondition: () => 'Run Left names a group to run ("Girls Run Left"); it has no whole-set reading',
    applyToSelection: (b, ids) => runRule(b, ids, 'left'),
  },
  {
    aliases: ['Run Right'],
    beats: RUN_TRADE_BEATS,
    precondition: () => 'Run Right names a group to run ("Boys Run Right"); it has no whole-set reading',
    applyToSelection: (b, ids) => runRule(b, ids, 'right'),
  },
  {
    aliases: ['Trade'],
    beats: RUN_TRADE_BEATS,
    precondition: () => 'Trade names a group to trade ("Boys Trade", "Centers Trade"); it has no whole-set reading',
    applyToSelection: tradeRule,
  },
  // Roll: derived because the engine has NO `Roll` of any kind - no title, no tam, not even in the
  // call index - while All8 writes it as a modifier on the preceding call (`--SqTh3 --PtTrd --&Roll`,
  // 30 published lines, the single largest token in the corpus). The reference implements it in
  // code for the same reason. It is registered under the bare name because All8's `&Roll` composes
  // with whatever came before rather than naming a group.
  {
    aliases: ['Roll'],
    beats: ROLL_BEATS,
    precondition: rollProblem,
    fn: rollRule,
  },
];

export const CODED_MOVES: CodedMove[] = DEFS.map((d) => ({
  name: d.aliases[0],
  aliases: d.aliases,
  beats: d.beats ?? CODED_MOVE_BEATS,
  ...(d.precondition ? { precondition: d.precondition } : {}),
  ...(d.fn ? { apply: d.fn } : {}),
  ...(d.applyToSelection ? { applyToSelection: d.applyToSelection } : {}),
})) as CodedMove[];

/** Canonical display names of the coded moves, in registration order. */
export const CODED_MOVE_NAMES: string[] = CODED_MOVES.map((m) => m.name);

const byAlias = new Map<string, CodedMove>();
for (const m of CODED_MOVES) {
  for (const a of m.aliases) byAlias.set(a.trim().toLowerCase(), m);
}

/** The coded move a call name refers to (by any alias), or undefined when the
 * name is not a coded move. */
export function findCodedMove(name: string): CodedMove | undefined {
  return byAlias.get(name.trim().toLowerCase());
}

/** Whether a coded move applies to `board` (always true for a pure pivot). */
export function codedMoveApplies(move: CodedMove, board: Board): boolean {
  return move.precondition ? move.precondition(board) === null : true;
}

/**
 * Apply the coded move named `name` to `board`: its result when it applies, the
 * board unchanged plus the reason when it does not, and null when `name` is not a
 * coded move at all (so the catalogue must handle it).
 *
 * The Sequencer (which layers dancer-selection handling on top) and the getout/fixIt
 * search both go through this, so a call cannot be legal in one and unknown in the
 * other - which is what makes a geometry-derived resolve usable as a search edge.
 */
export function applyCodedMove(board: Board, name: string): { board: Board; legal: boolean; reason?: string } | null {
  const move = findCodedMove(name);
  if (!move) return null;
  const problem = move.precondition?.(board) ?? null;
  return problem ? { board, legal: false, reason: problem } : { board: move.apply(board), legal: true };
}

