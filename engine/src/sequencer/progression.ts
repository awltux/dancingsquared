// CALLERLAB's TEMPORARY COUPLE NUMBER, read where identity is USED rather than written onto the board.
//
// > "The figure portion of singing calls almost always causes each Woman to progress to a new Man.
// >  Once this has happened, she temporarily takes on the Head/Side identity and home position of
// >  that Man." — CALLERLAB, Ways of Naming Dancers
//
// The engine never applies this, so after a `Trade By` the `couple` field still names the pair the
// dancers started in. MEASURED on `figm` #31 and #83, whose chain ends
// `... Pass Thru | Trade By | Swing Your Partner | Promenade`: the board is a proper Eight Chain Thru
// whose PHYSICAL couples are `(#1B,#6G)`, `(#2G,#5B)`, `(#3B,#4G)`, `(#7B,#8G)` — every one a man and
// a woman standing side by side two apart — while the identity field pairs `#1` with `#2` and `#5`
// with `#6`, putting those two "couples" SIX apart across the set. Promenade then anchored couple 1
// at north and couple 2 at east, read the ring as out of sequence, and refused; reading the convention
// there took the figure census 101 -> 103.
//
// It is ALSO what stops the derived `Sweep a Quarter` tiling a `Normal Lines` board: `boxGroups`
// partitions into facing-couple boxes with COUPLE COHERENCE (a stored couple's two dancers must land
// in the same box), and a stale pairing splits them across boxes so no tiling exists — measured on
// `figm` #17/#120, whose physical couples are `(#2,#5)`, `(#7,#8)`, `(#4,#3)`, `(#1,#6)` while the
// stored ones are `(1,2) (3,4) (5,6) (7,8)`.
//
// WHY HERE AND NOT ON THE BOARD. The rule was implemented and reverted twice before (PLAN.md,
// Phase 19): applied after every call it cost two figures (98 -> 96), because `couple` ALSO carries
// the Heads/Sides identity that a later `Heads ...` call targets. Reading it at the point of use has
// no such blast radius — it changes one call's precondition reading and nothing else — so the
// convention is applied where it is needed instead of globally.

import { isKnownCouple } from './constants.js';
import type { SeqDancer } from './types.js';

/** How far apart the two dancers of a PHYSICAL couple stand, and the tolerance on that. */
const PAIR_WIDTH = 2.0;
const PAIR_WIDTH_TOL = 0.35;

/** The couple band ("standing together") a stored pair must be INSIDE for the stored identity to be
 * taken at face value. The engine's healthy pre-promenade states measure exactly 2.00, while the
 * states a broken body produces measure 0.00, 4.00 or 6.00. */
const COUPLE_BAND_MAX = 3.0;

/**
 * Returns `id -> couple number` only when the board is unambiguously a set of physical couples
 * (every dancer paired with exactly one opposite-gender dancer of the same heading, two apart)
 * **and at least one STORED couple is standing OUTSIDE the engine's own couple band** — the signal
 * that a woman has progressed past her old partner. Anything else returns null and the caller keeps
 * the stored identity.
 *
 * THE SECOND CONDITION IS LOAD-BEARING, and it took two tries to get right. A first version applied
 * the regrouping whenever ANY stored couple's two dancers were not exactly two apart, and it broke
 * figure #12, whose couples stand THREE apart (a normal, healthy spacing) — the new grouping then
 * invented a ring-order problem the stored couples did not have. The band that decides it is the
 * engine's OWN notion of "standing together" (1.0..3.0): every healthy pre-promenade state measures
 * exactly 2.00, while the states a broken body produces measure 0.00, 4.00 or 6.00. So the trigger is
 * a stored couple OUTSIDE that band, i.e. a partner who is genuinely somewhere else.
 *
 * The band also keeps two alignment gates honest. `[B2r]` and `[B2p]` are alignment START boards
 * whose stored couples DO form a ring (couples 1..4 one per side) but in the wrong order, and whose
 * dancers pair cross-couple when read physically — regrouping by the physical pairs found only two
 * distinct anchors, skipped the ring-order check, and made a promenade legal from a ring that cannot
 * bring anyone home (`getout-convention.mjs` §3b caught it). In those boards every stored couple's
 * two dancers still stand exactly two apart, so the trigger does not fire and the stored reading
 * stands. In the `figm` #31/#83 case two stored couples are SIX apart.
 */
export function progressedCoupleNumbers(phys: SeqDancer[]): Map<number, number> | null {
  // 1. Is any stored couple standing OUTSIDE the engine's own couple band?
  const byStored = new Map<number, SeqDancer[]>();
  for (const d of phys) {
    if (!isKnownCouple(d.couple)) return null;
    byStored.set(d.couple, [...(byStored.get(d.couple) ?? []), d]);
  }
  let progressed = false;
  for (const [, pair] of byStored) {
    if (pair.length !== 2) continue;
    if (Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) > COUPLE_BAND_MAX) progressed = true;
  }
  if (!progressed) return null;

  // 2. Re-read the pairing from the floor.
  const out = new Map<number, number>();
  const used = new Set<number>();
  for (const d of phys) {
    if (used.has(d.id)) continue;
    let mate: SeqDancer | null = null;
    for (const o of phys) {
      if (o.id === d.id || used.has(o.id)) continue;
      if (d.gender === 'phantom' || o.gender === 'phantom' || o.gender === d.gender) continue;
      if (Math.abs(Math.hypot(o.x - d.x, o.y - d.y) - PAIR_WIDTH) > PAIR_WIDTH_TOL) continue;
      if (Math.abs(Math.atan2(Math.sin(o.heading - d.heading), Math.cos(o.heading - d.heading))) > 0.2) continue;
      mate = o;
      break;
    }
    if (!mate) return null;
    // The pair takes the MAN's couple, which is what "she takes on his identity" means.
    const man = d.gender === 'boy' ? d : mate;
    const number = man.couple;
    if (!isKnownCouple(number)) return null;
    used.add(d.id);
    used.add(mate.id);
    out.set(d.id, number);
    out.set(mate.id, number);
  }
  return used.size === phys.length && used.size > 0 ? out : null;
}
