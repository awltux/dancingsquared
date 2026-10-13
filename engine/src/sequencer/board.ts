// Board utilities: constructing the home squared set, cloning, and the
// rotation/translation/reflection-invariant signature used for search dedup.

import { HOME_DANCERS, assignHomeIdentity } from './identity.js';
import { UNKNOWN_COUPLE } from './constants.js';
import { poseFor } from '../core.js';
import type { Board, SeqDancer } from './types.js';
import type { CallBundle } from '../types.js';

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
