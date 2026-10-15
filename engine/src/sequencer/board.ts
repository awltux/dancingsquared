// Board utilities: constructing the home squared set, cloning, and the
// rotation/translation/reflection-invariant signature used for search dedup.

import { HOME_DANCERS, assignHomeIdentity } from './identity.js';
import { SAME_BOARD_TOL, UNKNOWN_COUPLE } from './constants.js';
import { poseFor } from '../core.js';
import type { Board, SeqDancer } from './types.js';
import type { CallBundle } from '../types.js';

/** The wrapped difference between two headings, in `(-pi, pi]`. Headings are
 * radians on a circle, so `|a - b|` alone reports an almost-full turn for two
 * dancers who face the same way, and a comparison written with it would refuse a
 * correct arrival. */
const headingDelta = (a: number, b: number): number => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
};

/**
 * Whether two boards are THE SAME BOARD — every dancer in the same place and
 * facing the same way, matched by IDENTITY rather than by array position.
 *
 * WHY THIS EXISTS, and why neither of the two helpers beside it answers the
 * question. `boardSig` is the rotation/reflection-invariant signature used for
 * SEARCH DEDUP: it is positions-only (deliberately — see its own comment) and it
 * is order-free, so it answers "are these two shapes congruent" and NOT "did the
 * set arrive". `reorderLike` fixes an ORDER, not an equality: it says nothing
 * about whether the geometry matches. A goal test built on `boardSig` would
 * therefore accept a board whose dancers all face the wrong way, and one built on
 * a per-index comparison would fail a board that is correct but arrayed in the
 * order a different code path produced. This is the third question, and the
 * engine had no answer for it.
 *
 * IDENTITY IS THE KEY AND NEVER THE INDEX (AGENTS.md §4.3, `identity.ts`). Both
 * sides must carry the same id set; a dancer present on one side and missing on
 * the other is NOT a match, which is the direction that matters — a board
 * synthesized from geometry alone carries `id: 0` for every dancer
 * (`boardAtBeat`'s documented answer for "there is no identity to read"), and
 * treating those as "all the same dancer" would make two unrelated boards
 * compare equal.
 *
 * AND A BOARD WITH NO IDENTITY IS NOT COMPARED AT ALL — it is refused,
 * INCLUDING AGAINST ITSELF. The first version of this function refused a
 * duplicate id only when the two boards differed, which made a `boardAtBeat`
 * board unequal to its own copy: the answer depended on which board was `a` and
 * which was `b`, and a rule whose answer depends on argument order is a rule
 * nobody can reason about. The refusal is now total and checked up front. That
 * is the correct direction for the engine's standing rule ("refuse when identity
 * is unknown rather than inventing a grouping"): an identity-less board has no
 * per-dancer identity to compare, so the only honest answer is "not the same
 * board" — and the caller that needs an answer must carry identity, which every
 * board the game builds does (`makeSquaredSet` numbers its dancers 1..8).
 *
 * WHAT IS NOT COMPARED, and why. `couple`, `gender`, `lastTurnDir` and
 * `isGhost` are the inputs the generator itself declared; asking them again would
 * make the test reject a correct arrival whose remembered turn direction differs
 * (a `Posture` detail no geometry depends on). `adjustToNextSetup` is a
 * PERMISSION owed to the next call, not part of the set's state. Ghost dancers
 * ARE compared, like any other dancer: a phantom is part of the formation the
 * engine matched, so two boards that differ in where a phantom stands are not the
 * same board.
 *
 * The tolerance is `SAME_BOARD_TOL`, whose comment records why an exact-arrival
 * test still needs one and what the measured gap to the smallest rejectable
 * difference is.
 */
export function sameBoardById(a: Board, b: Board, tol: number = SAME_BOARD_TOL): boolean {
  if (a.dancers.length !== b.dancers.length) return false;
  const byId = new Map<number, SeqDancer>();
  for (const d of b.dancers) {
    if (byId.has(d.id)) return false; // a duplicate id is not an identity
    byId.set(d.id, d);
  }
  // THE ID-UNIQUENESS REFUSAL APPLIES TO `a` TOO, so it is total rather than one-sided.
  if (new Set(a.dancers.map((d) => d.id)).size !== a.dancers.length) return false;
  for (const d of a.dancers) {
    const o = byId.get(d.id);
    if (!o) return false;
    if (Math.hypot(d.x - o.x, d.y - o.y) > tol) return false;
    if (headingDelta(d.heading, o.heading) > tol) return false;
  }
  return true;
}

export function makeSquaredSet(): Board {
  return {
    dancers: HOME_DANCERS.map((d): SeqDancer => ({ id: d.id, couple: d.couple, gender: d.gender, x: d.x, y: d.y, heading: d.heading })),
  };
}

/**
 * The BOARD a call's dancers stand on at `beat`, for READING rather than for dancing.
 *
 * It exists because the browse view holds a call BUNDLE - one authored `<tam>` - and not a board,
 * while every read the engine offers (recognize / knownFormation / fasrooOf) takes a board. The
 * end of a call is what a caller wants named, so this is how "what formation does this finish in"
 * gets asked at all.
 *
 * IDENTITY COMES FROM THE START, geometry from `beat`. Identity is fixed at the opening square and
 * never changes (`assignHomeIdentity` reads it off the START formation), so the end board's dancer
 * ids are the start's - and when the start is not a home-like set there is NO identity to read,
 * which is reported as `id: 0` / `couple: UNKNOWN_COUPLE` rather than invented from the array index
 * (`boardFromMatchables`' documented defect) or guessed at the end, which would name the wrong
 * dancer. Anything that needs a couple must check for the unknown value; the recognisers do not,
 * because formation matching is a geometry question.
 *
 * This board is NOT for the search: it carries no ghost/history bookkeeping and is not meant to be
 * applied to.
 */
export function boardAtBeat(call: CallBundle, beat: number): Board {
  const stamped = assignHomeIdentity(call.dancers);
  return {
    dancers: stamped.map((d): SeqDancer => {
      const p = poseFor(d, beat);
      return {
        id: d.id ?? 0,
        couple: d.couple ?? UNKNOWN_COUPLE,
        gender: d.gender,
        x: p.x,
        y: p.y,
        heading: p.heading,
      };
    }),
  };
}

export function cloneBoard(b: Board): Board {
  return { dancers: b.dancers.map((d) => ({ ...d })) };
}

/**
 * A REBUILT board, in the dancer-array ORDER of the board it replaces.
 *
 * The array order is not decorative: `SequencerUI.renderBoard` builds its pose list in `dancers`
 * order and hands pose `i` to dancer view `i`, so the array order is the renderer's binding from a
 * dancer to a body on screen. Every other path in the engine already carries the incoming order
 * through - `applyToBoard` re-bases with `board.dancers.map(...)` and the sequence walk interpolates
 * from the previous step's board - which is why a rebuild that returns a board in its OWN order
 * scrambles the set on exactly the frame it lands on, while every position in it stays put.
 *
 * MEASURED, and the reason this exists: the derived `promenadeHome` (since deleted - the Promenade
 * family is hand-authored now) returned `makeSquaredSet()`, so a `Promenade`
 * appended to `ceder-7046` ended on the canonical board whose order is 1..8 while the frames before it
 * are in the module's own 1,3,7,5,6,8,4,2 order. Reported as "if I apply a Promenade to the end the
 * Dancers switch position in the final static square ... they flip to setup arrangement for Static
 * Square on the last frame". The rule is general and outlives that call: any component that hands back
 * a rebuilt board must carry the order it was given.
 *
 * Only the order is taken from `order`: every position, heading, couple and gender comes from
 * `rebuilt`, so a coded move's geometry and identity are unchanged. A dancer missing from either side
 * leaves `rebuilt` exactly as it is, because a partial re-order is a worse answer than none.
 */
export function reorderLike(order: Board, rebuilt: Board): Board {
  if (order.dancers.length !== rebuilt.dancers.length) return rebuilt;
  const byId = new Map(rebuilt.dancers.map((d) => [d.id, d]));
  if (order.dancers.some((d) => !byId.has(d.id))) return rebuilt;
  return { dancers: order.dancers.map((d) => byId.get(d.id)!) };
}

// Rotation/translation/reflection-invariant signature for BFS dedup: the sorted
// pairwise-distance multiset.
//
// POSITIONS ONLY, deliberately: two boards that differ only in where the dancers
// FACE share a signature. That is what makes a pure pivot collapse to the state it
// came from (which is why the search never needs the coded pivots as edges), and it
// is why anything whose answer depends on facing - `finishToHome` in the solver,
// the reachability memo - must key on the full pose instead of on this.
//
// DO NOT ADD FACING HERE. It looks like an omission - pairwise distances cannot see
// a heading - and "fixing" it collapses the pivot-collapse property above and
// silently changes what the search dedups. The compensating side is real and gated:
// solver.ts keys `finishToHome` on `id,x,y,heading` for exactly this reason.
// This function used to carry a dead `heading` field into its local projection,
// which made it read as though facing were part of the signature; it is gone,
// because a field that is carried and never read is how the next reader concludes
// the opposite of the invariant.
export function boardSig(b: Board): string {
  const ds = b.dancers.map((d) => ({ x: d.x, y: d.y }));
  const dists: number[] = [];
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) dists.push(Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  dists.sort((a, c) => a - c);
  return dists.map((d) => d.toFixed(2)).join('|');
}
