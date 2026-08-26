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
// pairwise-distance multiset + each dancer's radius/heading-binned profile.
export function boardSig(b: Board): string {
  const ds = b.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading }));
  const dists: number[] = [];
  for (let i = 0; i < ds.length; i++)
    for (let j = i + 1; j < ds.length; j++) dists.push(Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  dists.sort((a, c) => a - c);
  return dists.map((d) => d.toFixed(2)).join('|');
}
