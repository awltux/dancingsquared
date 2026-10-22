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
//   * a COUPLE is a boy and a girl standing as one, in any of the three arrangements the corpus
//     authors - side by side facing the same way, facing each other front-on, or ACROSS their facing
//     side by side (a wave's own pair). `findCouplePairs` states all three and why the third was
//     missing;
//   * the couple's NUMBER is the BOY's. A boy keeps his own number; a girl adopts the number of the
//     boy she is currently beside. That is the caller's own vocabulary ("couple 1" names the pair
//     containing dancer 1) and it needs no new field on the dancer.
//
// Home identity is NOT modified and NOT replaced: it stays on `couple` for the identity consumers
// above. A dancer that pairs with nobody keeps its home couple rather than being given an invented
// number.

import type { Board, SeqDancer } from './types.js';
import { isKnownCouple } from './constants.js';
import { normAngle } from '../moves.js';

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
 * THREE KINDS OF COUPLE, because the corpus defines three arrangements and they are not the same
 * shape:
 *
 *   side by side   a couple standing SIDE BY SIDE facing the SAME way (a squared set, an Eight Chain
 *                  Thru, a formed promenade position), `COUPLE_WIDTH` apart. `Facing Couples*` names
 *                  a couple of this shape: the "facing" is between the TWO couples, not within one.
 *   facing         a SINGLE couple facing each other, front-on. `Facing Dancers*` is authored at
 *                  several distances (Close 2, Compact 3, 4, Far 6), so a facing couple is a RANGE.
 *   wave           a couple standing ACROSS its own facing: opposite gender, one couple width apart,
 *                  facing OPPOSITE ways, with the line between them perpendicular to that facing.
 *                  This is what a wave is made of - each adjacent boy-girl pair in the wave - and the
 *                  vocabulary it follows is the corpus's own: "Couples / Waves - dancers that are
 *                  couples (facing the same direction), or dancers in waves or mini-waves (facing
 *                  opposite directions)" (`taminations-flutter/assets/info/designators.md`).
 *
 * WHY THE WAVE PASS EXISTS. Its absence was not neutral: with no pair recognised, every dancer kept
 * its HOME couple, so on a wave `Couple #1` named the home pair - two dancers who can be SIX units
 * apart on opposite sides of the set - which is exactly the failure `trade-run.ts` documents as its
 * reason for calling `areCurrentPartners` ("a boy in a wave ended up with his partner six units away
 * at the other end"). MEASURED over the 270 boards the catalogue reaches from a squared set: 53
 * recognised NO couple and 27 answered `Couple #1` with two dancers more than 2.5 apart.
 *
 * SIDE BY SIDE, THEN FACING, THEN WAVE, and the order is LOAD-BEARING rather than tidy: a board whose
 * pairs are already side by side or facing is fully consumed by the first two passes, so a squared
 * set, an Eight Chain Thru, a Trade By and a Double Pass Thru take NOTHING from the wave pass and
 * their couple numbers and call legality cannot move. The passes are also disjoint by geometry, and
 * deliberately so: pairing a wave's neighbours on "facing" ALONE is what the earlier rule refused -
 * a boy and a girl facing each other at wave width are everywhere - so the wave pass is narrowed to
 * `forward ~ 0`, which no front-on facing pair can satisfy, and to the couple-width band, which
 * rejects the cross-wave pair four units away.
 *
 * Greedy and deterministic: boys in ascending id, each taking the nearest eligible girl. A dancer
 * with no eligible partner is left unpaired and keeps its home couple — this NEVER invents one.
 * `isGhost` dancers are excluded: a ghost is a geometric reference, not a dancer.
 *
 * THE SIDE-BY-SIDE PASS ALSO ADMITS A CO-FACING TANDEM, because it tests only distance and heading: two
 * dancers 2.0 apart facing the SAME way, one directly BEHIND the other, satisfy both. MEASURED over the
 * boards reached from a squared set: 680 pairs stand side by side, 30 face each other, and 38 are
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

  const tryPair = (mode: 'side' | 'facing' | 'wave'): void => {
    for (const boy of boys) {
      if (takenBoy.has(boy.id)) continue;
      let best: SeqDancer | null = null;
      let bestD = Infinity;
      for (const girl of girls) {
        if (takenGirl.has(girl.id)) continue;
        const dist = Math.hypot(girl.x - boy.x, girl.y - boy.y);
        const dh = Math.abs(normAngle(girl.heading - boy.heading));
        if (mode === 'facing') {
          // A facing couple: the two look AT each other, across the authored range, and are FRONT-ON
          // to within a small fraction of the separation. `LATERAL_FRACTION_SLOP` is a fraction so
          // the test scales with the distance: the corpus authors the same unit at 2, 3, 4 and 6, and
          // an absolute tolerance that admits the 6 would be far too loose at the 2.
          if (dist < COUPLE_WIDTH - COUPLE_WIDTH_TOL || dist > FACING_COUPLE_MAX) continue;
          if (Math.abs(dh - Math.PI) > COUPLE_FACING_TOL) continue;
          const { forward, lateral } = inFrame(boy, girl);
          if (forward <= 0) continue;
          if (Math.abs(lateral) > dist * LATERAL_FRACTION_SLOP) continue;
        } else if (mode === 'wave') {
          // THE WAVE, and it is the MIRROR IMAGE of the facing pass: facing OPPOSITE at one couple
          // width, but standing ACROSS that facing rather than in front of it. `forward ~ 0` is what
          // separates the two - the facing pass needs `forward > 0` - and they cannot both claim a
          // pair, because the facing pass allows at most a tenth of the separation laterally while a
          // wave pair's lateral offset IS the separation.
          if (Math.abs(dist - COUPLE_WIDTH) > COUPLE_WIDTH_TOL) continue;
          if (Math.abs(dh - Math.PI) > COUPLE_FACING_TOL) continue;
          const { forward } = inFrame(boy, girl);
          if (Math.abs(forward) > dist * LATERAL_FRACTION_SLOP) continue;
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

  // ORDER IS LOAD-BEARING. A board whose pairs are already side by side or facing is consumed by the
  // first two passes, so a squared set, an Eight Chain Thru, a Trade By and a Double Pass Thru take
  // nothing from the wave pass and their couple numbers and call legality cannot move.
  tryPair('side');
  tryPair('facing');
  tryPair('wave');
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
 * This replaces "same home couple" at the call site that means the CURRENT partner — `Run`'s "run
 * around your partner when both sides are open" preference. Comparing home couples there is the
 * defect `fold.ts` records.
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
