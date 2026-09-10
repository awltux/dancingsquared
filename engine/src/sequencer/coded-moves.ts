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

import { applyMoveToBoard, applyFaceInOutToBoard, FaceLeft, FaceRight, FaceHalf } from '../moves.js';
import { promenadeApplies, promenadeHome, promenadeProblem, PROMENADE_ALIASES, PROMENADE_BEATS } from './promenade.js';
import { runRule, tradeRule } from './trade-run.js';
import type { Board } from './types.js';

/** Timeline length of a coded pivot, in beats. */
export const CODED_MOVE_BEATS = 1;

/** Timeline length of the derived Run / Trade, in beats — the value the authored `Run` and
 * `Trade` tams carry, so the timeline does not shift when the derived call replaces them. */
export const RUN_TRADE_BEATS = 4;

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
  {
    aliases: ['Trade'],
    beats: RUN_TRADE_BEATS,
    precondition: () => 'Trade names a group to trade ("Boys Trade", "Centers Trade"); it has no whole-set reading',
    applyToSelection: tradeRule,
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

