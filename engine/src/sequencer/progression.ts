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

/** The band a FACING pair stands in, and how far off the facing a partner may be. MEASURED on
 * ceder-7046's end ring (an ALAMO ring): each pair faces at 2.3 units with a side-offset of 0.01-0.05
 * - boys outside at radius 3.45, girls inside at 2.93. The band clears that with room to spare and
 * still refuses a body that has fallen apart: the `Right and Left Grand` board ceder-10530 leaves has
 * its dancers 5.8 apart, which is not a pair at all. */
const FACING_MIN = 1.4;
const FACING_MAX = 3.6;
const FACING_ALONG = 1.4;
const FACING_PERP = 1.5;

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

  // 2. Re-read the pairing from the floor. SIDE BY SIDE first - the measured rule: the two partners
  //    are level with each other, one couple width apart, facing the same way (a squared set, a
  //    formed promenade position, an Eight Chain Thru). THEN FACING, and only under the guard below.
  //
  //    THE FACING PASS IS A MISSING READING, not a loosening. An ALAMO ring puts each pair in front
  //    of each other two apart, which is ceder-7046's end ring, and the side-by-side rule cannot see
  //    it: it finds no mate, returns null, and the STORED labels stand - and a stored pair on that
  //    board is two dancers 180 degrees apart with the SAME heading (the FASR `o` reading), so the
  //    "couple centre" this function exists to compute is the MIDDLE OF THE SET. MEASURED on that
  //    board: the stored centres sit at radius 1.13 and the floor pairs' at radius 3.00, and BOTH
  //    readings run 1 -> 2 -> 3 -> 4 counter-clockwise, so this pass changes the ROTATION the call
  //    reads (a fraction's own turn, via `ringRotation`) and not any board's legality.
  const beside = pairFromFloor(phys, 'beside');
  if (beside) return beside;

  // THE GUARD ON THE FACING PASS: EVERY stored pair must be outside the couple band, i.e. the board's
  // own labels pair every dancer with somebody standing on the far side of the set. That is the `o`
  // reading rather than a pairing, and it is the case this pass exists for.
  //
  // IT IS LOAD-BEARING, and it was MEASURED: without it the facing pass also fires on `figm130`, whose
  // board is two squeezed LINES (floor pairs 1.5 apart, midpoints at the four CORNERS) carrying one
  // stored pair that IS inside the band, 2.50 apart. Pairs read off a line are line adjacency and not
  // couples, so reading them as a ring made the sequence test fire on a body that is not a ring and
  // refused its `Promenade`: figures **116 -> 115**. The guard is the measurement that separates the
  // two cases - the Alamo ring has all four stored pairs ~6.4 apart, figm130 has one at 2.50.
  //
  // Trying the two arrangements in turn rather than accepting both in one pass is deliberate too: a
  // board with some pairs side by side and some facing is a body that is not a ring, and it keeps the
  // answer it had (null, so the stored reading stands) instead of getting a new one.
  const everyStoredPairIsSplit = [...byStored.values()].every((pair) => pair.length === 2
    && Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) > COUPLE_BAND_MAX);
  return everyStoredPairIsSplit ? pairFromFloor(phys, 'facing') : null;
}

/**
 * The pairing read off the floor in one ARRANGEMENT, as `id -> couple number`, or null when it does
 * not account for every dancer.
 *
 * `'beside'` is the rule this function had: opposite gender, `PAIR_WIDTH` +/- `PAIR_WIDTH_TOL` apart,
 * and facing the same way. `'facing'` is the Alamo-ring arrangement: opposite gender, 1.4..3.6 apart,
 * and the partner IN FRONT of the dancer who is looking at it.
 *
 * Either way the pair takes the MAN's couple, which is what "she takes on his identity" means. The
 * man is the one whose `couple` names the pair's home; the two are never given two different numbers.
 */
function pairFromFloor(phys: SeqDancer[], arrangement: 'beside' | 'facing'): Map<number, number> | null {
  const out = new Map<number, number>();
  const used = new Set<number>();
  for (const d of phys) {
    if (used.has(d.id)) continue;
    let mate: SeqDancer | null = null;
    for (const o of phys) {
      if (o.id === d.id || used.has(o.id)) continue;
      if (d.gender === 'phantom' || o.gender === 'phantom' || d.gender === o.gender) continue;
      const vx = o.x - d.x;
      const vy = o.y - d.y;
      if (arrangement === 'beside') {
        if (Math.abs(Math.hypot(vx, vy) - PAIR_WIDTH) > PAIR_WIDTH_TOL) continue;
        if (Math.abs(Math.atan2(Math.sin(o.heading - d.heading), Math.cos(o.heading - d.heading))) > 0.2) continue;
      } else {
        const dist = Math.hypot(vx, vy);
        if (dist < FACING_MIN || dist > FACING_MAX) continue;
        const along = vx * Math.cos(d.heading) + vy * Math.sin(d.heading);
        const perp = Math.abs(-vx * Math.sin(d.heading) + vy * Math.cos(d.heading));
        if (along < FACING_ALONG || perp > FACING_PERP) continue;
      }
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
