// WHO IS WHOSE PARTNER, RIGHT NOW.
//
// THE ENGINE HAS TWO NOTIONS OF "COUPLE" AND ONLY EVER HAD ONE OF THEM. `SeqDancer.couple` is the
// dancer's HOME couple: assigned once by `assignHomeIdentity` from the START formation and never
// re-derived. That is the right anchor for everything that asks a question about IDENTITY — FASR's
// Sequence field orders "the 4 home couples by angular position" (`fasr.ts`), the corner is derived
// from home-couple arithmetic, Promenade reads its anchors from home couple numbers, and the
// matcher's `identityScore` tie-break is what keeps "Heads X" on the couples that STARTED as heads.
//
// What the board did NOT carry is the other one: who a dancer's PARTNER is once the square has moved.
// Callers that wanted the current partner used `d.couple` as a proxy, and that proxy is stale the
// moment partners change. The repository already records the failure twice —
// `fold.ts` documents that "`couple` is the dancer's HOME couple, not the current partner, so after
// `1/2 Tag | Scoot Back` a boy at one end of a wave has his home partner at the other end, SIX away",
// and `selection.mjs` PINS the resulting defect on All8's six `[B]` boards, which share one geometry
// and differ only in couple pairing.
//
// THIS MODULE DERIVES THE SECOND NOTION from the board it is given, on demand:
//
//   * a COUPLE is a boy and a girl standing adjacent — twice `COUPLE_WIDTH` apart and facing the same
//     way, which is the same test `boardHasCoupleGenderPairs` already used for "the board is a set of
//     man-and-woman couples";
//   * the couple's NUMBER is the BOY's. A boy keeps his own number; a girl adopts the number of the
//     boy she is currently beside. That is the caller's own vocabulary ("couple 1" names the pair
//     containing dancer 1) and it needs no new field on the dancer.
//
// Home identity is NOT modified and NOT replaced: it stays on `couple` for the identity consumers
// above. A dancer that pairs with nobody keeps its home couple rather than being given an invented
// number.

import type { Board, SeqDancer } from './types.js';
import { isKnownCouple } from './constants.js';

/** How far apart the two dancers of a couple stand. The standard separation the engine's formations use. */
export const COUPLE_WIDTH = 2.0;

/**
 * How far apart a FACING couple may stand. The corpus authors the `Facing Dancers` family at several
 * distances — Close 2, Compact 3, 4, Far 6 — so a facing couple is a RANGE and not one width. This is
 * the far end of it; the near end is the side-by-side width, since a couple closer than that is the
 * `Facing Dancers Close` reading rather than two dancers who are nearly touching for some other
 * reason.
 */
export const FACING_COUPLE_MAX = 6.0;

/**
 * How far off-axis a FACING couple may be, as a FRACTION of their separation.
 *
 * A facing couple is front-on: the offset from one to the other is all `forward` in that dancer's
 * own frame and no `lateral`. This is a fraction rather than a distance so the test scales with the
 * separation, because the corpus authors the same unit at 2, 3, 4 and 6 — an absolute tolerance that
 * admits the 6 would be far too loose at the 2.
 */
export const LATERAL_FRACTION_SLOP = 0.1;

/** How far from `COUPLE_WIDTH` a pair may stand and still be standing as a couple. */
export const COUPLE_WIDTH_TOL = 0.35;

/**
 * How far the two dancers' headings may differ and still be a couple. A couple faces the SAME way;
 * this is generous enough for the small drift a danced sequence accumulates and far too tight to
 * admit two dancers facing each other (a facing pair is `pi` apart).
 */
export const COUPLE_FACING_TOL = 0.2;

/** A boy and a girl standing as a couple. */
export interface CouplePair {
  boy: SeqDancer;
  girl: SeqDancer;
}

/**
 * The offset from `from` to `to` in FROM's own frame: `forward` along its heading, `lateral` across
 * it. The same decomposition `trade-run.ts` uses to decide whether a dancer is beside another.
 */
function inFrame(from: SeqDancer, to: SeqDancer): { forward: number; lateral: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const c = Math.cos(from.heading);
  const s = Math.sin(from.heading);
  return { forward: dx * c + dy * s, lateral: -dx * s + dy * c };
}

/**
 * The boy-girl couples standing on this board.
 *
 * TWO KINDS OF COUPLE, because the corpus defines two partial boards and they are not the same shape:
 *
 *   `Facing Couples*`  a couple standing SIDE BY SIDE (co-facing, `COUPLE_WIDTH` apart) which is
 *                      itself facing another such couple. The couple is the side-by-side pair; the
 *                      "facing" in the name is between the TWO couples, not within one.
 *   `Facing Dancers*`  a SINGLE couple facing each other — authored at several distances (Close 2,
 *                      Compact 3, 4, Far 6), so a facing couple is a range and not one width.
 *
 * SIDE-BY-SIDE IS TRIED FIRST and the two are disjoint, because it is the reading that cannot
 * over-pair: in a wave nobody stands beside anyone, whereas a boy and a girl FACING each other at
 * wave width are everywhere (measured at 2.0 — Ocean Waves 4 such pairs, Eight Chain Thru 6, Trade By
 * 6, Double Pass Thru 2). Pairing on facing alone calls every wave neighbour a couple.
 *
 * THE FACING TEST IS FRONT-ON, and that is what separates a facing couple from a wave. In a facing
 * couple each dancer is STRAIGHT IN FRONT of the other: the offset is all `forward` and no `lateral`
 * in that dancer's own frame. A wave's boy-girl pair at 2.0 is an ADJACENT-COLUMN pair, so it has a
 * large lateral component and is rejected. (Measured without this: an `Ocean Waves` board returned
 * four pairs and a hand-built wave returned four more.)
 *
 * Greedy and deterministic: boys in ascending id, each taking the nearest eligible girl. A dancer
 * with no eligible partner is left unpaired and keeps its home couple — this NEVER invents one.
 * `isGhost` dancers are excluded: a ghost is a geometric reference, not a dancer.
 *
 * THE SIDE-BY-SIDE PASS ALSO ADMITS A CO-FACING TANDEM, because it tests only distance and heading: two
 * dancers 2.0 apart facing the SAME way, one directly BEHIND the other, satisfy both. MEASURED over the
 * 187 boards reached from a squared set: 680 pairs stand side by side, 30 face each other, and 38 are
 * tandems spread over 12 boards — and 0 of those 38 renumber a girl off her home couple, so for the
 * couple NUMBER this function feeds the admission is inert. Left as it is ON PURPOSE: a tandem really is
 * "who is your partner", and only the ROLE readings need left/right — see `Grouping.beauBelle`, where a
 * pair standing front-to-back projects to 0 and the designation is undefined rather than guessed.
 */
export function findCouplePairs(board: Board): CouplePair[] {
  const phys = board.dancers.filter((d) => !d.isGhost);
  const boys = [...phys.filter((d) => d.gender === 'boy')].sort((a, b) => a.id - b.id);
  const girls = phys.filter((d) => d.gender === 'girl');
  const takenGirl = new Set<number>();
  const takenBoy = new Set<number>();
  const pairs: CouplePair[] = [];

  const tryPair = (wantsFacing: boolean): void => {
    for (const boy of boys) {
      if (takenBoy.has(boy.id)) continue;
      let best: SeqDancer | null = null;
      let bestD = Infinity;
      for (const girl of girls) {
        if (takenGirl.has(girl.id)) continue;
        const dist = Math.hypot(girl.x - boy.x, girl.y - boy.y);
        const dh = Math.abs(
          Math.atan2(Math.sin(girl.heading - boy.heading), Math.cos(girl.heading - boy.heading)),
        );
        if (wantsFacing) {
          // A facing couple: the two look AT each other, across the authored range, and are FRONT-ON
          // to within a small fraction of the separation. `LATERAL_FRACTION_SLOP` is a fraction so
          // the test scales with the distance: the corpus authors the same unit at 2, 3, 4 and 6, and
          // an absolute tolerance that admits the 6 would be far too loose at the 2.
          if (dist < COUPLE_WIDTH - COUPLE_WIDTH_TOL || dist > FACING_COUPLE_MAX) continue;
          if (Math.abs(dh - Math.PI) > COUPLE_FACING_TOL) continue;
          const { forward, lateral } = inFrame(boy, girl);
          if (forward <= 0) continue;
          if (Math.abs(lateral) > dist * LATERAL_FRACTION_SLOP) continue;
        } else {
          if (Math.abs(dist - COUPLE_WIDTH) > COUPLE_WIDTH_TOL) continue;
          if (dh > COUPLE_FACING_TOL) continue;
        }
        if (dist < bestD) { bestD = dist; best = girl; }
      }
      if (!best) continue;
      takenBoy.add(boy.id);
      takenGirl.add(best.id);
      pairs.push({ boy, girl: best });
    }
  };

  tryPair(false);
  tryPair(true);
  // Ascending boy id, so the order does not depend on the board's array order.
  return pairs.sort((a, b) => a.boy.id - b.boy.id);
}

/**
 * Each dancer's CURRENT couple number, keyed by dancer id.
 *
 * A paired boy keeps his own (home) number; a paired girl takes her partner's. Every other dancer —
 * unpaired, or ghost — keeps its home couple, so a board that pairs with nobody resolves to exactly
 * the home reading and callers can use this unconditionally.
 *
 * WHEN THE SQUARE COMES HOME the pairs are the starting ones again, so this reproduces the home
 * numbers — which is what makes it usable as the tip-end signal as well as the current reading.
 */
export function currentCoupleNumbers(board: Board): Map<number, number> {
  const out = new Map<number, number>();
  for (const d of board.dancers) out.set(d.id, d.couple);
  for (const { boy, girl } of findCouplePairs(board)) {
    // The boy's number is his own if he has one; an identity-less board has UNKNOWN_COUPLE, and the
    // pair still numbers by the boy rather than by anything invented.
    if (isKnownCouple(boy.couple)) out.set(girl.id, boy.couple);
  }
  return out;
}

/** One dancer's current couple number. See `currentCoupleNumbers`. */
export function currentCoupleOf(board: Board, dancerId: number): number {
  return currentCoupleNumbers(board).get(dancerId) ?? 0;
}

/**
 * Whether two dancers are currently partners: a pair on this board, in either order.
 *
 * This replaces "same home couple" at the call sites that mean the CURRENT partner — `Run`'s "run
 * around your partner when both sides are open" preference, and the Swing precondition. Comparing
 * home couples there is the defect `fold.ts` records.
 */
export function areCurrentPartners(board: Board, a: number, b: number): boolean {
  return findCouplePairs(board).some(
    ({ boy, girl }) =>
      (boy.id === a && girl.id === b) || (boy.id === b && girl.id === a),
  );
}

/**
 * A dancer's CURRENT head/side standing.
 *
 * HEAD/SIDE IS AN IDENTITY AND TRAVELS WITH THE DANCER, so the model is deliberately asymmetric: a
 * BOY keeps the head/side standing he was given at the start (home couples 1 and 3 are the head
 * couples), and a GIRL takes hers from the boy she is currently beside. A girl with no current
 * partner, and every dancer on a board with no pairing at all, falls back to the home numbers — so
 * this is the home reading whenever the square is home.
 *
 * NULL means the dancer has no known identity to read it from (`UNKNOWN_COUPLE`): this is DATA, and a
 * board synthesised from geometry alone does not carry it.
 */
export function currentHeadSide(board: Board, dancerId: number): 'head' | 'side' | null {
  const numbers = currentCoupleNumbers(board);
  const n = numbers.get(dancerId);
  if (!isKnownCouple(n)) return null;
  // Home couples 1 and 3 are the head couples (see `HOME_DANCERS`); 2 and 4 are the sides.
  return n === 1 || n === 3 ? 'head' : 'side';
}
