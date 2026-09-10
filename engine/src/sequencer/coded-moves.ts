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

import { applyMoveToBoard, applyFaceInOutToBoard, FaceLeft, FaceRight, FaceHalf } from '../moves.js';
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
  /** Whole-board transform at completion. */
  apply(board: Board): Board;
}

const DEFS: { aliases: string[]; fn: (b: Board) => Board; beats?: number }[] = [
  { aliases: ['Face Right', 'Turn Right', 'Right Face'], fn: (b) => applyMoveToBoard(b, FaceRight) },
  { aliases: ['Face Left', 'Turn Left', 'Left Face'], fn: (b) => applyMoveToBoard(b, FaceLeft) },
  { aliases: ['Face Half', 'U-Turn Back', 'Face Back'], fn: (b) => applyMoveToBoard(b, FaceHalf) },
  { aliases: ['Face In', 'Turn In'], fn: (b) => applyFaceInOutToBoard(b, true) },
  { aliases: ['Face Out', 'Turn Out'], fn: (b) => applyFaceInOutToBoard(b, false) },
];

export const CODED_MOVES: CodedMove[] = DEFS.map((d) => ({
  name: d.aliases[0],
  aliases: d.aliases,
  beats: d.beats ?? CODED_MOVE_BEATS,
  apply: d.fn,
}));

/** Canonical display names of the coded moves, in registration order. A coded
 * move is always legal (a pivot applies from any board). */
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
