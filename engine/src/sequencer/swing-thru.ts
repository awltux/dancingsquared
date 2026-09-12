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

/** Angular difference in [0, pi]. */
function angDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d < -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
}

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
 */
function handPairs(board: Board, side: 'left' | 'right'): [D, D][] {
  const out: [D, D][] = [];
  const used = new Set<number>();
  for (const d of physical(board)) {
    if (used.has(d.id)) continue;
    const w = sideNeighbour(board, d, side, 3.0);
    if (!w) continue;
    const back = sideNeighbour(board, w, side, 3.0);
    if (!back || back.id !== d.id) continue;
    used.add(d.id);
    used.add(w.id);
    out.push([d, w]);
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

/** The two trades, in the order the definition names them. */
function twoTrades(board: Board, first: 'left' | 'right'): Board {
  const after1 = exchangePairs(board, handPairs(board, first));
  return exchangePairs(after1, handPairs(after1, first === 'left' ? 'right' : 'left'));
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
  const ds = physical(board);
  if (ds.length < 4) return { board, reason: 'Swing Thru needs at least four dancers' };

  // ARM 1 — an existing wave. The union of the two hand-hold relations must cover the dancers, which
  // is what makes this a wave rather than a stray adjacent pair; the parts themselves need no
  // coverage rule, because the definition is "those who CAN turn".
  {
    const touched = new Set<number>();
    for (const side of ['left', 'right'] as const) for (const [a, b] of handPairs(board, side)) { touched.add(a.id); touched.add(b.id); }
    if (covers(board, touched)) return { board: twoTrades(board, first) };
  }

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
      return { board: twoTrades(stepped, first) };
    }
  }

  return {
    board,
    reason: 'Swing Thru starts from an Ocean Wave, an Alamo Ring, or facing couples (the Facing '
      + 'Couples Rule); this board is none of those',
  };
}
