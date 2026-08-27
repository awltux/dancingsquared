// Grouping: named-subset queries (heads/sides/boys/girls/centers/ends) and the
// parallel-applicability helper. Depends on the CallApplicator to test whether a
// subset can dance a call.

import { CallApplicator } from './applicator.js';
import type { Board, SeqDancer } from './types.js';

export class Grouping {
  constructor(private readonly applicator: CallApplicator) {}

  /** Partition the physical dancers of a board into disjoint subsets by a named
   * grouping rule. Returns null when the grouping cannot be applied cleanly. */
  subsetOf(board: Board, group: string): number[][] | null {
    const ds = board.dancers.filter((d) => !d.isGhost);
    const byId = new Map(ds.map((d) => [d.id, d]));
    const sortIds = (arr: SeqDancer[]): number[] => arr.map((d) => d.id).sort((a, b) => a - b);
    const couples = (coupleNos: number[]): number[][] =>
      coupleNos.map((c) => sortIds(ds.filter((d) => d.couple === c))).filter((s) => s.length > 0);

    switch (group) {
      case 'heads': return couples([1, 3]);
      case 'sides': return couples([2, 4]);
      case 'boys': return [sortIds(ds.filter((d) => d.gender === 'boy'))];
      case 'girls': return [sortIds(ds.filter((d) => d.gender === 'girl'))];
      case 'couples': return couples([1, 2, 3, 4]);
      case 'centers': case 'ends': {
        const sides = this.splitLine(board);
        if (!sides) return null;
        const centers = [sides[0][1], sides[1][0]];
        const ends = [sides[0][0], sides[1][1]];
        return group === 'centers' ? [sortIds(centers.map((id) => byId.get(id)!))] : [sortIds(ends.map((id) => byId.get(id)!))];
      }
      case 'beaus': case 'belles': return this.beauBelle(ds, group);
      case 'leaders': case 'trailers': return this.leadersTrailers(ds, group);
      default: return null;
    }
  }

  /** Positional role within each couple: the dancer on the LEFT relative to the
   * couple's shared facing is the beau; the dancer on the RIGHT is the belle.
   * Couples are found by home couple (id grouping). Recomputed from current
   * position/facing, independent of gender. */
  private beauBelle(
    ds: SeqDancer[],
    role: 'beaus' | 'belles',
  ): number[][] | null {
    const coupleNos = [...new Set(ds.map((d) => d.couple))];
    const out: number[] = [];
    for (const c of coupleNos) {
      const pair = ds.filter((d) => d.couple === c);
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      // Left direction in the dancer's frame: rotate heading 90deg CW.
      const h = a.heading;
      const leftX = Math.sin(h);
      const leftY = -Math.cos(h);
      // Which of a,b lies to the left of the other.
      const va = { x: a.x - b.x, y: a.y - b.y };
      const cross = va.x * leftY - va.y * leftX;
      const beau = cross >= 0 ? a : b;
      const belle = beau === a ? b : a;
      out.push(role === 'beaus' ? beau.id : belle.id);
    }
    return out.length ? [[...out].sort((a, b) => a - b)] : null;
  }

  /** Positional role in a tandem (front/back pair sharing a travel axis): the
   * dancer in front (leading) is the leader; the one behind is the trailer.
   * Determined by which dancer is ahead along the shared heading. */
  private leadersTrailers(
    ds: SeqDancer[],
    role: 'leaders' | 'trailers',
  ): number[][] | null {
    // Group by approximate heading axis so front/back pairs are within a tandem.
    const dir = (h: number) => {
      let d = ((h * 180) / Math.PI) % 360;
      if (d < 0) d += 360;
      return d < 180 ? 0 : 180; // facing along +x (0) or -x (180) after normalization
    };
    const buckets = new Map<number, SeqDancer[]>();
    for (const d of ds) {
      const axis = dir(d.heading);
      if (!buckets.has(axis)) buckets.set(axis, []);
      buckets.get(axis)!.push(d);
    }
    const out: number[] = [];
    for (const [, arr] of buckets) {
      if (arr.length < 2) continue;
      const sorted = [...arr].sort((x, y) => x.x - y.x);
      for (let i = 0; i < sorted.length - 1; i++) {
        const front = role === 'leaders' ? sorted[i] : sorted[i + 1];
        out.push(front.id);
      }
    }
    return out.length ? [[...out].sort((a, b) => a - b)] : null;
  }

  /** Parallel-action: apply a call to each disjoint subset of a named group
   * concurrently (by checking each subset in isolation). */
  parallelApplicable(board: Board, group: string, callName: string): { subsets: number[][] | null; legalOnAll: boolean; illegalSubsets: number[][] } {
    const subsets = this.subsetOf(board, group);
    if (!subsets) return { subsets: null, legalOnAll: false, illegalSubsets: [] };
    const illegalSubsets: number[][] = [];
    for (const sub of subsets) {
      const subBoard = this.boardFromSubset(board, sub);
      const r = this.applicator.applySearch(subBoard, callName);
      if (!r.legal) illegalSubsets.push(sub);
    }
    return { subsets, legalOnAll: illegalSubsets.length === 0, illegalSubsets };
  }

  /** Build a standalone board from a subset of dancer ids (ghosts excluded). */
  private boardFromSubset(board: Board, ids: number[]): Board {
    const byId = new Map(board.dancers.map((d) => [d.id, d]));
    const ds = ids.map((id) => byId.get(id)).filter((d): d is SeqDancer => !!d);
    let cx = 0, cy = 0;
    for (const d of ds) { cx += d.x; cy += d.y; }
    cx /= ds.length; cy /= ds.length;
    return { dancers: ds.map((d) => ({ ...d, x: d.x - cx, y: d.y - cy })) };
  }

  /** Split an 8-dancer board into two 4-dancer lines/waves (for centers/ends). */
  private splitLine(board: Board): [number[], number[]] | null {
    const ds = board.dancers.filter((d) => !d.isGhost);
    if (ds.length !== 8) return null;
    const byX = this.bucketLines(ds, (d) => d.x);
    if (byX && byX[0].length === 4 && byX[1].length === 4) {
      const sort = (ids: number[]) => [...ids].sort((a, b) => (byIdOf(ds, a)?.y ?? 0) - (byIdOf(ds, b)?.y ?? 0));
      return [sort(byX[0]), sort(byX[1])];
    }
    const byY = this.bucketLines(ds, (d) => d.y);
    if (byY && byY[0].length === 4 && byY[1].length === 4) {
      const sort = (ids: number[]) => [...ids].sort((a, b) => (byIdOf(ds, a)?.x ?? 0) - (byIdOf(ds, b)?.x ?? 0));
      return [sort(byY[0]), sort(byY[1])];
    }
    return null;
  }

  private bucketLines(ds: SeqDancer[], key: (d: SeqDancer) => number): [number[], number[]] | null {
    const buckets = new Map<number, number[]>();
    const eps = 0.2;
    for (const d of ds) {
      let placed = false;
      for (const [k, arr] of buckets) {
        if (Math.abs(k - key(d)) < eps) { arr.push(d.id); placed = true; break; }
      }
      if (!placed) buckets.set(key(d), [d.id]);
    }
    if (buckets.size !== 2) return null;
    const [a, b] = [...buckets.values()];
    return [a, b];
  }
}

function byIdOf(ds: SeqDancer[], id: number): SeqDancer | undefined {
  return ds.find((d) => d.id === id);
}
