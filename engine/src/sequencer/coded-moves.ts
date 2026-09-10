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
import type { Board } from './types.js';

/** Timeline length of a coded pivot, in beats. */
export const CODED_MOVE_BEATS = 1;

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
}

const DEFS: { aliases: string[]; fn: (b: Board) => Board; beats?: number; precondition?: (b: Board) => string | null }[] = [
  { aliases: ['Face Right', 'Turn Right', 'Right Face'], fn: (b) => applyMoveToBoard(b, FaceRight) },
  { aliases: ['Face Left', 'Turn Left', 'Left Face'], fn: (b) => applyMoveToBoard(b, FaceLeft) },
  { aliases: ['Face Half', 'U-Turn Back', 'Face Back'], fn: (b) => applyMoveToBoard(b, FaceHalf) },
  { aliases: ['Face In', 'Turn In'], fn: (b) => applyFaceInOutToBoard(b, true) },
  { aliases: ['Face Out', 'Turn Out'], fn: (b) => applyFaceInOutToBoard(b, false) },
  // Promenade: the standard finish. Unlike the pivots above it is NOT always
  // legal, so it carries its precondition and reports the reason it fails.
  { aliases: PROMENADE_ALIASES, beats: PROMENADE_BEATS, precondition: promenadeProblem, fn: (b) => promenadeHome(b).board },
];

export const CODED_MOVES: CodedMove[] = DEFS.map((d) => ({
  name: d.aliases[0],
  aliases: d.aliases,
  beats: d.beats ?? CODED_MOVE_BEATS,
  ...(d.precondition ? { precondition: d.precondition } : {}),
  apply: d.fn,
}));

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

