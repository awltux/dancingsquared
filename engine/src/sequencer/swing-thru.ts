// `Swing Thru` as a DERIVED call — the first row of the Phase 9e-2 port (PLAN.md).
//
// WHY DERIVED. The catalogue's `Swing Thru` tams are demonstrations, authored for one arrangement of
// the formation and carrying no identity, so a board reached with a different arrangement gets
// motion authored for another — the failure Phase 9a pinned as "the same geometry, six authored
// pairings". The reference does not match this call at all: `sequencer/calls/ms/swing_thru.dart`
// asks the dancers RELATIONSHIP questions and applies `Trade` twice. CALLERLAB's definition says the
// same thing independently:
//
//   "Swing Thru / Left Swing Thru — Starting formations: Ocean Wave, Alamo Ring. Dance action:
//    Those who can turn 1/2 (180 degrees) by the right; then those who can turn 1/2 (180 degrees)
//    by the left. ... The Facing Couples Rule applies to these calls."
//   "Facing Couples Rule — ... the dancers first step into a momentary Right-Hand Ocean Wave and
//    complete the call."
//
// A half arm turn with your hand-neighbour leaves you exactly where that neighbour was, so each part
// IS a `Trade` — which is why the whole call is two of them, and why we already had the primitive.
//
// THE TWO ARMS, both validated against the engine's own authored motion before this file was written
// (`test/tools/swing-thru-rule.mjs`):
//
//   1. AN EXISTING WAVE. Part 1 trades the dancers who hold RIGHT hands with each other, part 2 the
//      dancers who hold LEFT hands; the second part is recomputed on the board the first produced.
//      That reproduces the authored wave motion EXACTLY, 8 of 8 dancers — and it needs no coverage
//      rule, because "those who CAN turn" is the definition: a wave's end dancer has only one
//      neighbour and so acts in one part only.
//
//   2. FACING COUPLES (the Facing Couples Rule). This needed the momentary wave's POSITIONS, and a
//      Swing Thru only trades, so it never moves anyone off them: the positions the authored motion
//      ends on ARE the momentary wave's. The construction that reproduces them: centre a canonical
//      four-dancer wave on the BOX's centre with its line perpendicular to the couples' facing axis,
//      slots two apart; each dancer takes a slot with its OWN facing, and within that pair of slots
//      the one that moves it least. Then the same two trades. Validated 8 of 8 on the Eight Chain
//      Thru template.
//
// The hand primitives are transcribed from `call_context.dart` — note MUTUAL right-to-right, which
// the first draft got wrong as right-to-left:
//
//   dancersHoldingRightHands = { d : d2 = dancerToRight(d, minDistance 3.0); dancerToRight(d2) == d }
//   dancersHoldingLeftHands  = { d : d2 = dancerToLeft(d,  minDistance 3.0); dancerToLeft(d2)  == d }
//
// with `isRightOf`/`isLeftOf` FACING-RELATIVE (bearing -pi/2 / +pi/2 in the dancer's own frame) and a
// tolerance of 0.1 rad (`extensions.dart`).

import { normAngle } from '../moves.js';
import type { Board } from './types.js';

type D = Board['dancers'][number];

/** The reference's `isAround` tolerance, in radians. */
const DELTA = 0.1;

/** The reference's `minDistance`: the farthest a dancer can be and still be the one on that side. */
const MIN_DISTANCE = 3.0;

const physical = (board: Board): D[] => board.dancers.filter((d) => !d.isGhost);
const dist = (a: D, b: D): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Bearing of `b` in `a`'s own frame: 0 = in front, -pi/2 = right, +pi/2 = left. */
function bearing(a: D, b: D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const c = Math.cos(a.heading);
  const s = Math.sin(a.heading);
  return Math.atan2(-dx * s + dy * c, dx * c + dy * s);
}

/** Angular difference in [0, pi] — the rule, not a copy of it. */
const angDiff = (a: number, b: number): number => Math.abs(normAngle(a - b));

const isAround = (a: number, target: number): boolean => angDiff(a, target) < DELTA;

function nearest(from: D, cands: D[]): D | null {
  let best: D | null = null;
  let bestD = Infinity;
  for (const c of cands) {
    const d = dist(from, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** `dancerToRight` / `dancerToLeft`: the nearest dancer at bearing -pi/2 / +pi/2 from `d`. */
function sideNeighbour(board: Board, d: D, side: 'left' | 'right', maxDist = Infinity): D | null {
  const target = side === 'right' ? -Math.PI / 2 : Math.PI / 2;
  const cands = physical(board).filter((o) => o.id !== d.id && dist(d, o) <= maxDist && isAround(bearing(d, o), target));
  return nearest(d, cands);
}

/**
 * `dancersHoldingRightHands` / `dancersHoldingLeftHands`: a MUTUAL same-side pair — both dancers have
 * the other as their nearest dancer on that side (within 3.0, the reference's `minDistance`).
 *
 * `group` KEEPS EVERY PAIR INSIDE ONE WAVE, and it is passed only where the caller already knows the
 * partition (`waveTrades`). The Tidal Wave needs it: see `waveGroups`.
 */
function handPairs(board: Board, side: 'left' | 'right', group?: Map<number, number>): [D, D][] {
  const out: [D, D][] = [];
  const used = new Set<number>();
  for (const d of physical(board)) {
    if (used.has(d.id)) continue;
    const w = sideNeighbour(board, d, side, MIN_DISTANCE);
    if (!w) continue;
    if (group && group.get(d.id) !== group.get(w.id)) continue;
    const back = sideNeighbour(board, w, side, MIN_DISTANCE);
    if (!back || back.id !== d.id) continue;
    used.add(d.id);
    used.add(w.id);
    out.push([d, w]);
  }
  return out;
}

/**
 * THE WAVES THE CALL IS DANCED IN — "active dancers form one or more groups of four dancers each".
 *
 * WHY THIS EXISTS. A Tidal Wave is TWO Ocean Waves end to end, and CALLERLAB is explicit about what that
 * means for this call: "From a Tidal Wave, Swing Thru is danced in the Ocean Wave on each half; NO DANCERS
 * CROSS THE CENTER of the Tidal Wave." MEASURED before this partition existed, from the corpus's `Right-Hand
 * Tidal Wave` board (one line of eight, y = -3.5 .. -0.5 and +0.5 .. +3.5): part 1 traded correctly inside
 * the halves and part 2 then paired the inner dancers of the two halves - 1.0 apart and facing opposite ways,
 * which is geometrically indistinguishable from a real hand-pair - so TWO dancers crossed the centre, against
 * the definition. The authored tam crosses none; the project owner adjudicated "The tam is the correct version".
 *
 * THE SEAM IS NOT VISIBLE ON THE STARTING BOARD, which is what makes this a partition rather than a search.
 * A wave's neighbours alternate: `#4` faces 0 and `#8` faces 180 across the centre exactly as `#3` and `#4` do
 * 1.0 apart inside a half, and the eight are evenly spaced, so NO local test tells the seam from an interior
 * join. The only information is the count: eight dancers, groups of four. So the wave is read as a CHAIN and
 * cut into consecutive fours from an end of it. MEASURED on the corpus's Tidal Wave: from `#1` the chain is
 * `1 2 3 4 8 7 6 5`, giving `{1,2,3,4} {5,6,7,8}`, and from `#5` the chain is `5 6 7 8 4 3 2 1`, giving the
 * SAME two sets - so the choice of end does not matter for the only Tidal Wave the corpus carries. It would
 * matter for twelve, which is why the cut is taken from the first endpoint the component scan meets and this
 * comment does not claim otherwise.
 *
 * A component of four or fewer is already ONE group. A LONGER one that is not a simple chain, or whose length
 * is not a multiple of four, is also left as ONE group: the partition then restricts nothing, which is exactly
 * the behaviour before this existed.
 */
export function waveGroups(board: Board): Map<number, number> {
  const ds = physical(board);
  // TWO DANCERS ARE WAVE NEIGHBOURS when they are a MUTUAL HAND-HOLD of either hand - the reference's own
  // wave relation, and the only one that does not also link a dancer to the one BEYOND its neighbour: in the
  // corpus's Tidal Wave `#1` and `#4` stand 3.0 apart, side by side and facing opposite ways, so a bare
  // distance test makes every dancer a triple junction and yields no chain at all (MEASURED - one group).
  const nbr = new Map<number, number[]>(ds.map((d) => [d.id, []]));
  for (const side of ['left', 'right'] as const) {
    for (const [a, b] of handPairs(board, side)) {
      nbr.get(a.id)?.push(b.id);
      nbr.get(b.id)?.push(a.id);
    }
  }
  /** The component as an ordered chain, or null when it is not a simple path. */
  const chainOf = (comp: number[]): number[] | null => {
    const ends = comp.filter((id) => (nbr.get(id) ?? []).length === 1);
    if (ends.length !== 2) return null;
    const chain: number[] = [];
    let prev = -1;
    let cur = ends[0];
    for (;;) {
      chain.push(cur);
      const next = (nbr.get(cur) ?? []).find((w) => w !== prev);
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    return chain.length === comp.length ? chain : null;
  };
  const out = new Map<number, number>();
  const seen = new Set<number>();
  let group = 0;
  for (const d of ds) {
    if (seen.has(d.id)) continue;
    const comp: number[] = [];
    const stack = [d.id];
    seen.add(d.id);
    while (stack.length > 0) {
      const id = stack.pop() as number;
      comp.push(id);
      for (const w of nbr.get(id) ?? []) if (!seen.has(w)) { seen.add(w); stack.push(w); }
    }
    const chain = comp.length > 4 && comp.length % 4 === 0 ? chainOf(comp) : null;
    if (chain) {
      for (let i = 0; i < chain.length; i += 4) {
        for (const id of chain.slice(i, i + 4)) out.set(id, group);
        group++;
      }
    } else {
      for (const id of comp) out.set(id, group);
      group++;
    }
  }
  return out;
}

/** Exchange the members of each pair in full: position AND facing, which is what a half arm turn
 *  with your hand-neighbour comes to. */
function exchangePairs(board: Board, pairs: [D, D][]): Board {
  const swap = new Map<number, { x: number; y: number; heading: number }>();
  for (const [a, b] of pairs) {
    swap.set(a.id, { x: b.x, y: b.y, heading: b.heading });
    swap.set(b.id, { x: a.x, y: a.y, heading: a.heading });
  }
  return { dancers: board.dancers.map((d) => { const s = swap.get(d.id); return s ? { ...d, ...s } : d; }) };
}

/** The two trades, in the order the definition names them, or null when the board is not a wave.
 *
 *  BOTH TRADES STAY INSIDE THE WAVES READ OFF THE STARTING BOARD (`waveGroups`). Part 1 needs nothing there,
 *  but part 2 does: after part 1 the two inner dancers of a Tidal Wave stand 1.0 apart facing each other,
 *  which is exactly what a real hand-pair looks like, so a part 2 that reads the board afresh pairs them
 *  ACROSS THE SEAM and two dancers cross the centre of the Tidal Wave - measured at 2 before this existed. */
function waveTrades(board: Board, first: 'left' | 'right', second: 'left' | 'right'): [Board, Board] | null {
  const group = waveGroups(board);
  const touched = new Set<number>();
  for (const side of ['left', 'right'] as const) {
    for (const [a, b] of handPairs(board, side, group)) { touched.add(a.id); touched.add(b.id); }
  }
  if (!covers(board, touched)) return null;
  const after1 = exchangePairs(board, handPairs(board, first, group));
  return [after1, exchangePairs(after1, handPairs(after1, second, group))];
}

/**
 * The INTERMEDIATE boards of a Swing Thru: `[after part 1, after part 2]`, or null when neither arm
 * applies.
 *
 * WHY THE ANIMATION NEEDS THEM. A Swing Thru is two trades done in sequence, and its NET position
 * permutation is what those two compose into - which on a wave is two 4-CYCLES, not a set of swaps.
 * MEASURED (`swing-thru-anim-probe.mjs`): from `Ocean Waves` the net is `4+4`, so a route that looks
 * for exchanging pairs never fires, the frames fall back to straight lines, and two dancers traverse
 * the same four-unit segment in opposite directions - closest pair 0.000 at the halfway beat.
 *
 * The net is an artefact of the composition; the DANCE is the two parts, and each part IS a pair
 * trade that the exchange routing already handles. So the animation is given the parts instead.
 */
export function swingThruLegs(board: Board, isLeft = false): Board[] | null {
  const first: 'left' | 'right' = isLeft ? 'left' : 'right';
  const second: 'left' | 'right' = isLeft ? 'right' : 'left';
  // Arm 1, an existing wave.
  const existing = waveTrades(board, first, second);
  if (existing) return existing;
  // Arm 2, facing couples via the Facing Couples Rule: step into the momentary wave, then the same.
  const boxes = findBoxes(board);
  if (boxes.length > 0) {
    const members = new Set<number>();
    const waves: D[] = [];
    for (const box of boxes) {
      const wave = momentaryWave(box, isLeft);
      if (!wave) return null;
      waves.push(...wave);
      for (const d of box) members.add(d.id);
    }
    if (waves.length > 0 && covers(board, members)) {
      const stepped: Board = { dancers: board.dancers.map((d) => waves.find((w) => w.id === d.id) ?? d) };
      return waveTrades(stepped, first, second);
    }
  }
  return null;
}

/**
 * A BOX of facing couples: a four-set containing TWO facing pairs (each directly in front of the
 * other) and TWO couple pairs (side by side, facing the same way), disjoint and covering the four.
 * Characterised by that structure rather than by chasing relations, so it cannot half-match.
 */
function findBoxes(board: Board): D[][] {
  const ds = physical(board);
  if (ds.length === 0 || ds.length % 4 !== 0) return [];
  const isFacingPair = (a: D, b: D): boolean =>
    isAround(bearing(a, b), 0) && isAround(bearing(b, a), 0) && dist(a, b) < 2.5;
  const isCouplePair = (a: D, b: D): boolean => {
    const s = angDiff(bearing(a, b), Math.PI / 2);
    return isAround(a.heading, b.heading) && (s < DELTA || s > Math.PI - DELTA);
  };
  const combos: number[][] = [];
  const rec = (start: number, acc: number[]): void => {
    if (acc.length === 4) { combos.push([...acc]); return; }
    for (let i = start; i < ds.length; i++) rec(i + 1, [...acc, i]);
  };
  rec(0, []);
  const boxes: D[][] = [];
  const usedIdx = new Set<number>();
  for (const c of combos) {
    if (c.some((i) => usedIdx.has(i))) continue;
    const m = c.map((i) => ds[i]);
    const fronts: [number, number][] = [];
    const couples: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        if (isFacingPair(m[i], m[j])) fronts.push([i, j]);
        if (isCouplePair(m[i], m[j])) couples.push([i, j]);
      }
    }
    const disjoint = (p: [number, number], q: [number, number]): boolean =>
      q[0] !== p[0] && q[0] !== p[1] && q[1] !== p[0] && q[1] !== p[1];
    let found = false;
    for (const f1 of fronts) {
      for (const f2 of fronts) {
        if (!disjoint(f1, f2)) continue;
        for (const k1 of couples) {
          for (const k2 of couples) {
            if (!disjoint(k1, k2)) continue;
            if (new Set([...f1, ...f2, ...k1, ...k2]).size !== 4) continue;
            boxes.push(m);
            for (const i of c) usedIdx.add(i);
            found = true;
            break;
          }
          if (found) break;
        }
        if (found) break;
      }
      if (found) break;
    }
  }
  return boxes;
}

/**
 * The momentary wave a box steps into. A Swing Thru only trades, so it never moves anyone off the
 * wave's positions — which means the positions the call ends on ARE the momentary wave's, and this
 * is a construction of them rather than an invention: a canonical four-dancer wave centred on the
 * box's centre, its line PERPENDICULAR to the couples' facing axis, slots two apart; each dancer
 * takes a slot with its own facing, choosing the nearer of the two, which is the step that moves it
 * least. Returns null when no slot assignment fits.
 *
 * The HANDEDNESS is part of it, and it was measured rather than assumed: CALLERLAB says a left-hand
 * call steps into a momentary LEFT-Hand wave, so the facing pattern along the line is MIRRORED for
 * `Left Swing Thru`. Without that, the arm reproduced the catalogue on `Eight Chain Thru` for
 * `Swing Thru` but NOT for `Left Swing Thru` — the two results differed by which slot each dancer
 * took, which is exactly the symptom of the wrong handedness.
 */
function momentaryWave(box: D[], isLeft: boolean): D[] | null {
  const cx = box.reduce((n, d) => n + d.x, 0) / box.length;
  const cy = box.reduce((n, d) => n + d.y, 0) / box.length;
  const h0 = box[0].heading;
  const facing = { x: Math.round(Math.cos(h0)), y: Math.round(Math.sin(h0)) };
  const line = { x: -facing.y, y: facing.x };
  const slots = [3, 1, -1, -3].map((t) => ({
    x: cx + line.x * t,
    y: cy + line.y * t,
    // the facing alternates along the line, so the two slots of one facing sit four apart; which of
    // the two alternating patterns is the right-hand one is what `isLeft` selects
    heading: (t === 3 || t === -1) === !isLeft ? h0 : normAngle(h0 + Math.PI),
  }));
  // Every dancer must take a slot with its own facing; among those, the assignment that moves the
  // whole box least. Four dancers means 24 candidate assignments, so this is enumerated rather than
  // assumed — the choice is where a wrong guess would show up immediately.
  const perms = (arr: number[]): number[][] =>
    arr.length <= 1 ? [arr] : arr.flatMap((v, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((r) => [v, ...r]));
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (const p of perms([0, 1, 2, 3])) {
    let cost = 0;
    let ok = true;
    for (let i = 0; i < box.length; i++) {
      const s = slots[p[i]];
      if (!isAround(box[i].heading, s.heading)) { ok = false; break; }
      cost += Math.hypot(box[i].x - s.x, box[i].y - s.y);
    }
    if (ok && cost < bestCost) { bestCost = cost; best = p; }
  }
  if (!best) return null;
  return box.map((d, i) => ({ ...d, x: slots[best![i]].x, y: slots[best![i]].y, heading: slots[best![i]].heading }));
}

const covers = (board: Board, picked: Set<number>): boolean =>
  physical(board).every((d) => picked.has(d.id));

/**
 * `Swing Thru` (or `Left Swing Thru`) from this board: the resulting board, or the reason it cannot
 * be danced.
 */
export function swingThru(board: Board, isLeft = false): { board: Board; reason?: string } {
  const first: 'left' | 'right' = isLeft ? 'left' : 'right';
  const second: 'left' | 'right' = isLeft ? 'right' : 'left';
  const ds = physical(board);
  if (ds.length < 4) return { board, reason: 'Swing Thru needs at least four dancers' };

  // ARM 1 — an existing wave. `waveTrades` refuses a board whose two hand-hold relations do not cover the
  // dancers, which is what makes this a wave rather than a stray adjacent pair; the parts themselves need no
  // coverage rule, because the definition is "those who CAN turn".
  const existing = waveTrades(board, first, second);
  if (existing) return { board: existing[1] };

  // ARM 2 — facing couples, via the Facing Couples Rule: step into a momentary wave, then the same
  // two trades. The boxes must cover the board: a call acts on everyone it applies to, and a board
  // where only some dancers are in facing couples is not this call.
  const boxes = findBoxes(board);
  if (boxes.length > 0) {
    const members = new Set<number>();
    const waves: D[] = [];
    for (const box of boxes) {
      const wave = momentaryWave(box, isLeft);
      if (!wave) { waves.length = 0; break; }
      waves.push(...wave);
      for (const d of box) members.add(d.id);
    }
    if (waves.length > 0 && covers(board, members)) {
      const stepped: Board = { dancers: board.dancers.map((d) => waves.find((w) => w.id === d.id) ?? d) };
      const steppedTrades = waveTrades(stepped, first, second);
      if (steppedTrades) return { board: steppedTrades[1] };
    }
  }

  return {
    board,
    reason: 'Swing Thru starts from an Ocean Wave, an Alamo Ring, or facing couples (the Facing '
      + 'Couples Rule); this board is none of those',
  };
}
