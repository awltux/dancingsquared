// FASR analysis: Formation, Arrangement, Sequence, Relationship.
//
//  - Formation:  the recognized setup name (passed in from recognition).
//  - Arrangement: gender/role distribution.
//  - Sequence:    in/out of sequence (the cyclic order of the 4 home couples
//                 around the set).
//  - Relationship: partner + corner for each dancer.

import type { Board, Fasr } from './types.js';
import { makeSquaredSet } from './board.js';
import { isKnownCouple } from './constants.js';

// REMOVED in Phase 5: `angDiff`, which existed only for the bearing-based corner search. The
// corner is now derived from home couple identity, so no angle arithmetic is needed for it.
// `angleOf` below is still used, for ordering the couples by their CURRENT position (sequence).

export function analyzeFasr(board: Board, formationName: string | null): Fasr {
  const dancers = board.dancers;

  // ---- Arrangement ----
  const boys = dancers.filter((d) => d.gender === 'boy').length;
  const girls = dancers.filter((d) => d.gender === 'girl').length;
  const couples = new Set(dancers.filter((d) => isKnownCouple(d.couple)).map((d) => d.couple)).size;
  const arrangement = `${dancers.length} dancers (${boys} boys, ${girls} girls), ${couples} couple${couples === 1 ? '' : 's'}`;

  // ---- Relationship ----
  const center = { x: dancers.reduce((s, d) => s + d.x, 0) / dancers.length, y: dancers.reduce((s, d) => s + d.y, 0) / dancers.length };
  const angleOf = (d: { x: number; y: number }) => Math.atan2(d.y - center.y, d.x - center.x);

  const relationship: Fasr['relationship'] = {};
  for (const d of dancers) {
    // A partner is a dancer in the same REAL home couple; UNKNOWN_COUPLE is not
    // a couple, so a geometry-only board reports no partner relationship.
    const partner = isKnownCouple(d.couple)
      ? dancers.find((o) => o.couple === d.couple && o.id !== d.id) ?? null
      : null;
    // Corner: the opposite-gender dancer of the PREVIOUS couple in the promenade cycle - the one
    // on this dancer's left. Derived from HOME COUPLE IDENTITY, never from a bearing.
    //
    // MEASURED on the home square, all eight dancers: the opposite-gender dancer geometrically on
    // a dancer's left is ALWAYS the one at ring offset +3 (own couple + 3, cyclically), for boys
    // and girls alike. This used to be computed from a fixed angular offset - "+45 degrees for a
    // boy, -45 for a girl" - which lands on the partner first and, with the partner excluded, falls
    // through to the dancer at offset +1: the RIGHT-hand girl. That gave the wrong dancer for all
    // four boys (0/4) and happened to be right for all four girls, which is exactly why it survived
    // - half the dancers agreed.
    //
    // The identity rule is right for all eight, it needs no angle, and it agrees with
    // `alignment.ts`'s `relationshipCode`, whose own note records the same cycle:
    //
    //   +0 p partner | +1 r right-hand girl | +2 o opposite girl | +3 c corner
    //
    // `fasrKey` is built from this, and it backs `isZero` and the solver's `Static Square` check,
    // so a wrong corner was not merely a reporting blemish. A dancer whose home couple is UNKNOWN
    // reports NO corner, exactly as the partner rule below does and for the same reason: identity
    // is data, and a relation between two dancers who have no known identity is not a fact we have
    // (square-dancing.md §8.2). That is a deliberate change on geometry-only boards, where the old
    // code produced a bearing-based guess.
    const cornerCouple = isKnownCouple(d.couple) ? ((d.couple - 1 + 3) % 4) + 1 : null;
    const corner = cornerCouple === null
      ? null
      : dancers.find((o) => o.couple === cornerCouple && o.gender !== d.gender) ?? null;
    relationship[d.id] = { partner: partner ? partner.id : null, corner: corner ? corner.id : null };
  }

  // ---- Sequence ----
  // Order the 4 home couples by angular position around the set. In sequence =
  // the couple numbers go 1,2,3,4 cyclically (counterclockwise); out of
  // sequence = the reverse.
  let sequence: Fasr['sequence'] = 'unknown';
  const coupleAngles = new Map<number, number>();
  for (const d of dancers) {
    if (d.gender === 'boy' && isKnownCouple(d.couple)) coupleAngles.set(d.couple, angleOf(d));
  }
  if (coupleAngles.size === 4) {
    const order = [...coupleAngles.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
    // Check cyclic 1,2,3,4 (in) or 1,4,3,2 (out).
    const inSeq = order.some((_, i) => [order[i], order[(i + 1) % 4], order[(i + 2) % 4], order[(i + 3) % 4]].join() === '1,2,3,4');
    const outSeq = order.some((_, i) => [order[i], order[(i + 1) % 4], order[(i + 2) % 4], order[(i + 3) % 4]].join() === '1,4,3,2');
    sequence = inSeq ? 'in' : outSeq ? 'out' : 'unknown';
  }

  return { formation: formationName, arrangement, sequence, relationship };
}

/** A canonical key of a board's FASR (sequence + relationships). */
export function fasrKey(board: Board): string {
  const f = analyzeFasr(board, null);
  return `${f.sequence}|${JSON.stringify(f.relationship)}`;
}

/** The FASR key of the fresh home squared set. */
export function homeFasrKey(): string {
  return fasrKey(makeSquaredSet());
}
