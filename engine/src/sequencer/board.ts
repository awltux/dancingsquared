// Board utilities: constructing the home squared set, cloning, and the
// rotation/translation/reflection-invariant signature used for search dedup.

import { HOME_DANCERS } from './identity.js';
import type { Board, SeqDancer } from './types.js';

export function makeSquaredSet(): Board {
  return {
    dancers: HOME_DANCERS.map((d): SeqDancer => ({ id: d.id, couple: d.couple, gender: d.gender, x: d.x, y: d.y, heading: d.heading })),
  };
}

export function cloneBoard(b: Board): Board {
  return { dancers: b.dancers.map((d) => ({ ...d })) };
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
