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
  // Direction the dancer last turned during the most recent call that rotated
  // them. Non-compositional calls may depend on this remembered direction rather
  // than inferring it from geometry. undefined until a rotating call is applied.
  lastTurnDir?: 'left' | 'right';
  // Ghost (phantom) dancer: a non-physical reference point used to complete
  // phantom/fractional setups. Does not occupy collision space; provides
  // geometric reference for calls defined around a larger matrix.
  isGhost?: boolean;
  ghostAnchor?: number; // id of the physical dancer or virtual axis it is tethered to
}

export interface Board {
  dancers: SeqDancer[]; // 8
  /**
   * CALLERLAB's IMPLICIT ADJUSTMENT, owed to the NEXT call. `Fold` and `Cross Fold` "can create
   * formations that are very unusual at Mainstream", and CALLERLAB's own comment on Fold says
   * callers "generally use implicit adjustments to normalize the formation" — *"Double Pass Thru
   * implicitly tells dancers that they should be in the starting formation for that call (facing
   * Tandems). The Double Pass Thru is danced as if the Tandems were facing, ending normally. This
   * type of implicit adjustment is generally accepted at Mainstream, particularly following Fold or
   * Cross Fold."*
   *
   * The flag is the SCOPE: `foldRule` is its only setter, and any apply result is a freshly built
   * board, so it can only ever authorise the single call that follows a Fold/Cross Fold — which is
   * exactly the scope CALLERLAB gives the convention. It is a permission, not a behaviour: the next
   * call is still matched strictly FIRST, so nothing that works today changes.
   */
  adjustToNextSetup?: boolean;
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

/** A single call step in a sequence/module, optionally with a dancer selection.
 * When `selection` is present it names which dancers act (e.g. "Centers", "Heads",
 * "Boys", "All"); the base `call` then applies to that subset. Absent selection
 * means the call applies to the whole board. */
export interface CallStep {
  selection?: string;
  call: string;
}

/** A user-defined module: a named sequence of calls used as a fix/getout. Each
 * call may carry an optional dancer selection. */
export interface Module {
  name: string;
  calls: (string | CallStep)[];
  level?: string;
  tags?: string[];
  notes?: string;
}

/** A matched call variant plus the rigid transform (rotation/reflection + both
 * centers) that overlays its canonical setup onto the board. */
export interface VariantMatch {
  variant: import('../types.js').CallBundle;
  mapping: number[];
  error: number;
  rot: number;
  reflect: boolean;
  cSrc: { x: number; y: number };
  cTgt: { x: number; y: number };
}
