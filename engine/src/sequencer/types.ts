// Sequencer data structures.

import type { Gender } from '../types.js';

/** A dancer in the sequencer's board, carrying identity. */
export interface SeqDancer {
  id: number; // 1..8 identity
  couple: number; // 1..4 (home couple)
  gender: Gender;
  x: number;
  y: number;
  heading: number; // radians
}

export interface Board {
  dancers: SeqDancer[]; // 8
}

export interface RecognizedFormation {
  name: string | null; // matched named formation, or null if unrecognized
  error: number; // total offset of the best match
  symmetric: boolean;
}

export interface SeqStep {
  call: string;
  legal: boolean;
  reason?: string;
  board: Board;
  formation: RecognizedFormation;
}

/** Per-dancer FASR relationship info (by dancer id). */
export interface FasrRelations {
  partner: number | null;
  corner: number | null;
}

export interface Fasr {
  formation: string | null;
  arrangement: string; // e.g. "8 dancers, 4 couples" + gender note
  sequence: 'in' | 'out' | 'unknown'; // in/out of sequence parity
  relationship: Record<number, FasrRelations>;
}

/** A user-defined module: a named sequence of calls used as a fix/getout. */
export interface Module {
  name: string;
  calls: string[];
  level?: string;
  tags?: string[];
  notes?: string;
}
