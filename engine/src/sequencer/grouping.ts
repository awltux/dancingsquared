// Grouping: named-subset queries (heads/sides/boys/girls/centers/ends) and the
// parallel-applicability helper. Depends on the CallApplicator to test whether a
// subset can dance a call.

import { CallApplicator } from './applicator.js';
import { isKnownCouple } from './constants.js';
import { currentCoupleNumbers } from './couples.js';
import { normAngle } from '../moves.js';
import type { Board, SeqDancer } from './types.js';
import { normalizeSelection, selectionGroup, parseGroupExpression, type GroupExpression } from './selection.js';

export class Grouping {
  constructor(private readonly applicator: CallApplicator) {}

  /** Partition the physical dancers of a board into disjoint subsets by a named
   * grouping rule. Returns null when the grouping cannot be applied cleanly —
   * including when it resolves to no dancers at all (e.g. "Boys" on a board whose
   * real genders are unknown), so callers get one consistent "cannot apply"
   * signal instead of a mix of null, [] and [[]]. */
  subsetOf(board: Board, group: string): number[][] | null {
    const result = this.subsetOfRaw(board, group);
    if (result === null) return null;
    const nonEmpty = result.filter((g) => g.length > 0);
    return nonEmpty.length ? nonEmpty : null;
  }

  private subsetOfRaw(board: Board, group: string): number[][] | null {
    const ds = board.dancers.filter((d) => !d.isGhost);
    const byId = new Map(ds.map((d) => [d.id, d]));
    const sortIds = (arr: SeqDancer[]): number[] => arr.map((d) => d.id).sort((a, b) => a - b);
    // THE HOME-COUPLE groups, keyed on `SeqDancer.couple`. That field is the IDENTITY anchor and is the
    // right answer for `heads`/`sides`, which name who a dancer IS rather than who they are standing
    // with: a head couple stays "the heads" wherever it has moved to. `couples.ts` keeps the two
    // notions apart on purpose - see `coupleGroups` for the other one.
    const homeCouples = (coupleNos: number[]): number[][] =>
      coupleNos.map((c) => sortIds(ds.filter((d) => d.couple === c))).filter((s) => s.length > 0);

    switch (group) {
      case 'heads': return homeCouples([1, 3]);
      case 'sides': return homeCouples([2, 4]);
      case 'boys': case 'men': return [sortIds(ds.filter((d) => d.gender === 'boy'))];
      case 'girls': case 'women': case 'ladies': return [sortIds(ds.filter((d) => d.gender === 'girl'))];
      case 'all': case 'everybody': case 'everyone': return [sortIds(ds)];
      // NOT `homeCouples`: "Couples" asks who is standing as a couple NOW, which is a different
      // question with a different answer the moment partners change. See `coupleGroups`.
      case 'couples': return this.coupleGroups(board, [1, 2, 3, 4]);
      // Centers/Ends of two 4-dancer lines (or columns): the middle two and the
      // outer two of *each* line, giving 4 dancers per group. Callerlab "Centers
      // Pass Thru" from Facing Lines moves all four inner dancers; the previous
      // 2-dancer reading here was really "very centers" and moved one dancer from
      // each line — including an end, because the pick was a bare index into a
      // y-sorted line rather than a position predicate.
      case 'centers': case 'ends': {
        const sides = this.splitLine(board);
        if (!sides) return null;
        const [a, b] = sides;
        const picked = group === 'centers' ? [a[1], a[2], b[1], b[2]] : [a[0], a[3], b[0], b[3]];
        return [sortIds(picked.map((id) => byId.get(id)!))];
      }
      // Very centers: the two dancers in the middle of the whole set. Preserved
      // as-is (one inner dancer from each line) so this fix does not silently
      // change the "Very Centers ..." assets; see square-dancing.md §9.
      case 'verycenters': {
        const sides = this.splitLine(board);
        if (!sides) return null;
        return [sortIds([sides[0][1], sides[1][0]].map((id) => byId.get(id)!))];
      }
      case 'beaus': case 'belles': return this.beauBelle(ds, group);
      case 'leaders': case 'trailers': return this.leadersTrailers(ds, group);
      default: return null;
    }
  }

  /** Resolve a dancer-selection string to the set of acting dancer ids on a board.
   * Supports the simple groups via subsetOf, the parametric selectors
   * (specific couples, "same 4", head/side position, N boys/girls with a partner
   * on a given side), and COMBINATIONS of them. Returns null when unrecognized or unresolvable. */
  resolveSelection(board: Board, selection: string): number[] | null {
    // A COMBINATION FIRST: tokens intersected within a side, sides unioned, negated sides subtracted.
    // See `parseGroupExpression` for the grammar and why it is the reference's.
    const expr = parseGroupExpression(selection);
    if (expr) return this.resolveExpression(board, expr);
    const ds = board.dancers.filter((d) => !d.isGhost);
    const sortIds = (arr: SeqDancer[]): number[] => arr.map((d) => d.id).sort((a, b) => a - b);
    const n = normalizeSelection(selection);
    const group = selectionGroup(n);

    // COUPLE #N COMES FIRST, BEFORE the generic group branch below. `selectionGroup` maps every one of
    // these spellings to the `couples` key, so that branch answers them with ALL FOUR couples rather
    // than the one that was asked for - and the two parametric branches that used to sit further down
    // this method were UNREACHABLE for exactly that reason. MEASURED on a squared set after
    // `Square Thru 2`, both ways: keyed on the stored field instead, `Couple #1` answered `#5+#6` (the
    // HOME pair, who after the call face each other across the set); with this block absent,
    // `Couple #1` answered all eight dancers.
    const coupleIds = (numbers: number[]): number[] | null => {
      const ids = this.coupleGroups(board, numbers).flat().sort((a, b) => a - b);
      // NULL RATHER THAN `[]` WHEN THE COUPLES ASKED FOR ARE NOT ON THE BOARD: an empty answer means
      // "unresolvable here", and `subsetOf` promises callers ONE signal for that rather than a mix of
      // null, [] and [[]].
      return ids.length ? ids : null;
    };
    const coupleMatch = /^couple #(\d+)$/.exec(n) || /^those in couple #(\d+) spot$/.exec(n);
    if (coupleMatch) return coupleIds([+coupleMatch[1]]);
    const couplePair = /^couple #(\d+) and #(\d+)$/.exec(n);
    if (couplePair) return coupleIds([+couplePair[1], +couplePair[2]]);

    if (group && group !== 'same4' && group !== 'headposition' && group !== 'sideposition' &&
        group !== 'verycenters' && group !== 'outside6' && group !== 'boys-girl-right' &&
        group !== 'gender-count') {
      const subs = this.subsetOf(board, group);
      if (!subs) return null;
      return [...new Set(subs.flat())].sort((a, b) => a - b);
    }

    if (group === 'all') return sortIds(ds);
    if (group === 'same4') return sortIds(ds); // best-effort: same-4 defaults to all (position-dependent)
    if (group === 'headposition') {
      // Heads' home couples (1,3) — the head position dancers.
      const subs = this.subsetOf(board, 'heads');
      return subs ? [...new Set(subs.flat())].sort((a, b) => a - b) : null;
    }
    if (group === 'sideposition') {
      const subs = this.subsetOf(board, 'sides');
      return subs ? [...new Set(subs.flat())].sort((a, b) => a - b) : null;
    }
    if (group === 'verycenters') {
      const centers = this.subsetOf(board, 'verycenters');
      return centers ? [...new Set(centers.flat())].sort((a, b) => a - b) : null;
    }
    if (group === 'outside6') {
      // All except the very centers.
      const centers = this.subsetOf(board, 'verycenters');
      const centerIds = centers ? new Set(centers.flat()) : new Set<number>();
      return ds.filter((d) => !centerIds.has(d.id)).map((d) => d.id).sort((a, b) => a - b);
    }

    // N boys/girls have partner on a side — approximate by gender + position.
    const sideMatch = /^(one|two|three|four) (boy|girl)s? have (girl|boy) on (right|left)$/.exec(n);
    if (sideMatch) {
      const gender = sideMatch[2] === 'boy' ? 'boy' : 'girl';
      return sortIds(ds.filter((d) => d.gender === gender));
    }
    const countMatch = /^(one|two|three|four) (boys|girls|men|women|ladies)$/.exec(n);
    if (countMatch) {
      const kind = countMatch[2];
      const gender = kind === 'boys' || kind === 'men' ? 'boy' : 'girl';
      return sortIds(ds.filter((d) => d.gender === gender));
    }
    const ladiesChain = /^(\d+) ladies chain$/.exec(n);
    if (ladiesChain) return sortIds(ds.filter((d) => d.gender === 'girl'));

    return null;
  }

  /**
   * Resolve a COMBINATION: each term's keys INTERSECTED in order, the positive terms UNIONED, then
   * every negated term SUBTRACTED.
   *
   * A key is resolved through `resolveSelection`, so the combination layer adds composition without
   * re-implementing any group - `very centers`, `outside 6`, `couple #2` and the rest all keep the
   * one resolver that already knows what they mean. A key that does not resolve makes the whole
   * expression unresolvable rather than silently contributing nothing.
   */
  private resolveExpression(board: Board, expr: GroupExpression): number[] | null {
    const positive = new Set<number>();
    const negative = new Set<number>();
    for (const term of expr.terms) {
      // INTERSECTION within a term. The first key seeds it; each later key must also contain the id.
      let ids: number[] | null = null;
      for (const key of term.keys) {
        const part = this.resolveSelection(board, key);
        if (!part) return null;
        ids = ids === null ? part : ids.filter((id) => part.includes(id));
        if (ids.length === 0) break;
      }
      if (ids === null) continue;
      for (const id of ids) (term.negated ? negative : positive).add(id);
    }
    if (negative.size === 0) return [...positive].sort((a, b) => a - b);
    return [...positive].filter((id) => !negative.has(id)).sort((a, b) => a - b);
  }

  /**
   * The dancer ids standing as the couples numbered `numbers`, grouped one array per number.
   *
   * THE NUMBER IS THE BOY'S AND THE PAIR IS HIS CURRENT ONE. `SeqDancer.couple` is the HOME couple -
   * assigned once from the start formation and never changed - so it is the wrong answer here the
   * moment partners change, and the girl's copy of it is her memory of the couple she STARTED in,
   * which is what `Heads`/`Sides`/FASR want and what this deliberately does not use.
   *
   * MEASURED, and why this exists: after `Square Thru 2` from a squared set the home couples are
   * `c1=[5,6] c2=[3,4] c3=[1,2] c4=[7,8]` while the pairs actually standing together are
   * `c1=[5,2] c3=[6,1]` - the girl `#2` (home couple 3) has adopted boy `#5`'s number 1, and `#6` boy
   * `#1`'s number 3. Reading the stored field alone would have named `#5+#6`, who after the call FACE
   * each other across the set rather than standing as a couple. And the resolver answered `Couple #1`
   * with ALL EIGHT dancers, because the name never reached the parametric branch at all.
   * `couples.ts` owns the current-partnership derivation; this only groups by it.
   *
   * A dancer the derivation pairs with nobody keeps its home number (see `currentCoupleNumbers`), so a
   * board where no pairing is recognised reads exactly as the home couples did.
   */
  private coupleGroups(board: Board, numbers: number[]): number[][] {
    const current = currentCoupleNumbers(board);
    const ds = board.dancers.filter((d) => !d.isGhost);
    const out: number[][] = [];
    for (const n of numbers) {
      const ids = ds
        .filter((d) => (current.get(d.id) ?? d.couple) === n)
        .map((d) => d.id)
        .sort((a, b) => a - b);
      if (ids.length) out.push(ids);
    }
    return out;
  }

  /** Positional role within each couple: the dancer on the LEFT relative to the
   * couple's shared facing is the beau; the dancer on the RIGHT is the belle.
   *
   * PAIRED BY THE CURRENT PARTNERSHIP, not by home couple. The ROLE was already recomputed from
   * position and facing — that part was always right — but the two dancers it was computed BETWEEN
   * were the home partners, so once partners change the role was being read off a pair that is no
   * longer standing together. The couple the role belongs to is the one on the floor now
   * (`couples.ts`); a dancer with no current partner falls back to its home couple, so a board whose
   * dancers are not standing as couples behaves exactly as before. */
  private beauBelle(
    ds: SeqDancer[],
    role: 'beaus' | 'belles',
  ): number[][] | null {
    const current = currentCoupleNumbers({ dancers: ds });
    const coupleNoOf = (d: SeqDancer): number => current.get(d.id) ?? d.couple;
    // Only REAL couples define a beau/belle pair; UNKNOWN_COUPLE is not a couple, so a
    // geometry-only board yields no positional role here.
    const coupleNos = [...new Set(ds.map(coupleNoOf))].filter(isKnownCouple);
    const out: number[] = [];
    for (const c of coupleNos) {
      const pair = ds.filter((d) => coupleNoOf(d) === c);
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

  /** Positional role in a line: the dancer at the FRONT of a tandem leads, the one behind trails.
   *
   * Transcribed from the reference (`call_context.dart` `analyze()`), which decides it PER DANCER
   * from two counts rather than by pairing dancers up:
   *
   *     if (frontcount % 2 == 0 && backcount % 2 == 1) leader
   *     else if (frontcount % 2 == 1 && backcount % 2 == 0) trailer
   *
   * where "in front"/"in back" are `dancersInFront`/`dancersInBack` — the dancers DIRECTLY ahead of
   * and behind this dancer, within an angular tolerance (`isAround(0)` / `isAround(pi)`, 0.1 rad).
   * A dancer with an ODD count on both sides is neither, which is the point of the parity: in a
   * Completed Double Pass Thru the back dancer of an east-facing tandem has one dancer ahead and one
   * behind, and is not a leader.
   *
   * WHY THIS REPLACED A PAIRING. The previous rule bucketed by heading axis — 0 or 180 ONLY — sorted
   * each bucket by x, and emitted `sorted[i]` for EVERY i, so a bucket of four dancers produced
   * THREE leaders, and a tandem travelling north/south was never seen at all. Measured on All8's
   * `Leaders Trade` from a Completed Double Pass Thru: the engine designated SIX dancers
   * (`[2,3,4,5,7,8]`) where the call has four (`[1,4,5,8]`), and the refusal it produced named the
   * wrong dancer - "no other designated dancer is beside (-1.0,1.0), so it has no one to trade
   * with". Four figures stop there.
   */
  private leadersTrailers(
    ds: SeqDancer[],
    role: 'leaders' | 'trailers',
  ): number[][] | null {
    const TOL = 0.1; // the reference's own `isAround(..., delta: 0.1)`
    const rel = (a: SeqDancer, b: SeqDancer) => normAngle(Math.atan2(b.y - a.y, b.x - a.x) - a.heading);
    const out: number[] = [];
    for (const d of ds) {
      const front = ds.filter((o) => o.id !== d.id && Math.abs(rel(d, o)) <= TOL).length;
      const back = ds.filter((o) => o.id !== d.id && Math.abs(normAngle(rel(d, o) - Math.PI)) <= TOL).length;
      const isLeader = front % 2 === 0 && back % 2 === 1;
      const isTrailer = front % 2 === 1 && back % 2 === 0;
      if (role === 'leaders' ? isLeader : isTrailer) out.push(d.id);
    }
    return out.length ? [[...out].sort((a, b) => a - b)] : null;
  }

  /** Parallel-action: apply a call to each disjoint subset of a named group
   * concurrently (by checking each subset in isolation). */
  parallelApplicable(board: Board, group: string, callName: string): { subsets: number[][] | null; legalOnAll: boolean; illegalSubsets: number[][] } {    const subsets = this.subsetOf(board, group);
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
