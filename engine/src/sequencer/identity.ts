// Home-square identity stamping. Identity (which couple / which dancer id) is
// fixed from the opening squared set at the start of the dance and never
// changes, regardless of where a call moves the dancers.

import { DEG } from '../core.js';
import { normAngle } from '../moves.js';
import { matchFormations, type Matchable } from './match.js';
import { isKnownCouple } from './constants.js';
import type { Board, SeqDancer } from './types.js';
import type { DancerSpec } from '../types.js';

interface HomeDancer {
  id: number;
  couple: number;
  gender: 'boy' | 'girl';
  x: number;
  y: number;
  heading: number; // radians
}

/** The home squared-set dancers (dancer id -> its home pose). */
export const HOME_DANCERS: HomeDancer[] = [
  { id: 1, couple: 3, gender: 'boy', x: 1, y: 3, heading: 270 * DEG }, // couple 3 north, facing south (center)
  { id: 2, couple: 3, gender: 'girl', x: -1, y: 3, heading: 270 * DEG },
  { id: 3, couple: 2, gender: 'boy', x: 3, y: -1, heading: 180 * DEG }, // couple 2 east, facing west (center)
  { id: 4, couple: 2, gender: 'girl', x: 3, y: 1, heading: 180 * DEG },
  { id: 5, couple: 1, gender: 'boy', x: -1, y: -3, heading: 90 * DEG }, // couple 1 south (nearest viewer), facing north
  { id: 6, couple: 1, gender: 'girl', x: 1, y: -3, heading: 90 * DEG },
  { id: 7, couple: 4, gender: 'boy', x: -3, y: 1, heading: 0 }, // couple 4 west, facing east (center)
  { id: 8, couple: 4, gender: 'girl', x: -3, y: -1, heading: 0 },
];

const HOME_MATCHABLES: Matchable[] = HOME_DANCERS.map((d) => ({
  x: d.x,
  y: d.y,
  heading: d.heading,
}));

/**
 * Stamp each dancer of a full-set call with its home-square identity (id +
 * couple) by matching the call's start formation to the home squared set up to
 * rotation/reflection. Callers then colour by `couple` (a stable property of
 * the dancer) instead of re-deriving identity from position or array index each
 * call.
 *
 * Mirrored (half-set) dancers use their full-set position for matching. When the
 * call's setup isn't an 8-dancer home square (e.g. a smaller group or a phantom
 * setup), no identity can be assigned and the dancers are returned un-stamped.
 */
export function assignHomeIdentity(dancers: DancerSpec[]): DancerSpec[] {
  if (dancers.length !== HOME_MATCHABLES.length) return dancers;
  const full = dancers.map((d): Matchable => {
    if (d.mirror) return { x: -d.x, y: -d.y, heading: normAngle(d.angleDeg * DEG + Math.PI) };
    return { x: d.x, y: d.y, heading: d.angleDeg * DEG };
  });
  const m = matchFormations(full, HOME_MATCHABLES);
  if (!m) return dancers;
  return dancers.map((d, i) => {
    const h = HOME_DANCERS[m.mapping[i]];
    return { ...d, id: h.id, couple: h.couple };
  });
}

/**
 * The key a COUPLE-TO-SPOT assignment is written against: a dancer's position, in the millimetre
 * precision the assignment is built at.
 *
 * ONE definition, deliberately. `alignment.ts` builds an assignment and this reads it back, and the
 * two have to agree to the character or every lookup silently misses and every dancer comes back
 * anonymous - a failure mode that looks exactly like "this formation has no setup", which is a real
 * and expected answer. So the producer and the consumer share this function rather than each
 * spelling out the same `toFixed(3)`.
 */
export const spotKey = (x: number, y: number): string => `${x.toFixed(3)},${y.toFixed(3)}`;

/**
 * Stamp home identity onto a board from a COUPLE-TO-SPOT assignment - the anchor a FASR code cannot
 * carry, because one code admits four boards that differ only in which couple stands where.
 *
 * WHY NOT `assignHomeIdentity`: that one MATCHES the board's geometry to the home square, so it can
 * only identify a squared set or something a rotation/reflection carries home - which is why 129 of
 * the 134 named formations come back anonymous. This one takes the assignment as DATA, so a formation
 * far from home (a two-faced line, an ocean wave) can be identified from its published setup.
 *
 * DANCER ORDER IS PRESERVED and the result is a NEW board with the SAME coordinates. Both matter and
 * neither is incidental: the POC binds avatars by array index, `applyToBoard` preserves order, and
 * `collapseModule` keys its matrices by dancer `id`. Building the answer by relabelling in place -
 * rather than returning the setup's own board, which `boardsForAlignment` emits boys-then-girls in
 * LATTICE order - is what keeps this a change of identity and nothing else.
 *
 * ALL OR NOTHING. Every physical dancer must land on a spot the assignment names, and no two may
 * claim the same home dancer. A partial result would be worse than none: half a board with couples is
 * a board whose sequence and relationship read as something they are not, and `sequenceFor` would
 * report a confident wrong answer rather than "identity missing". So any failure returns the board
 * UNCHANGED, which is the same anonymous answer the caller would have got with no assignment at all.
 */
export function identifyByAssignment(board: Board, assignment: Record<string, number>): Board {
  const out: SeqDancer[] = [];
  const used = new Set<number>();
  for (const d of board.dancers) {
    // A ghost is a geometric reference, not a dancer: it has no home couple to be, so it is carried
    // through untouched rather than being allowed to veto the assignment.
    if (d.isGhost) { out.push(d); continue; }
    const couple = assignment[spotKey(d.x, d.y)];
    if (!isKnownCouple(couple)) return board;
    // The GENDER picks which of the couple's two dancers this is. An undeclared gender ('phantom')
    // therefore cannot be resolved, and guessing between the boy and the girl would be exactly the
    // invented identity this module exists to avoid.
    const home = HOME_DANCERS.find((h) => h.couple === couple && h.gender === d.gender);
    if (!home || used.has(home.id)) return board;
    used.add(home.id);
    out.push({ ...d, id: home.id, couple: home.couple, gender: home.gender });
  }
  return { ...board, dancers: out };
}
