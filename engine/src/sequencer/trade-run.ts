// Run and Trade as GEOMETRY-DERIVED calls.
//
// WHY THESE ARE DERIVED AND NOT A CATALOG SETUP. Taminations marks the whole `Run` family
// (32 variants) and bare `Trade` `sequencer="no"`, and implements both in CODE
// (`taminations-flutter/lib/sequencer/calls/ms/run.dart`, `trade.dart`) - which is exactly
// why those tams are not-for-sequencer. Our engine matched the tams instead, and the only
// tams matching the engine's own wave template are UNGATED demonstrations authored for the
// other gender layout, so `Boys Trade` from the `Ocean Waves` template moved the four GIRLS
// and `Boys Run` turned the wave into two-faced lines. Both defects are pinned in
// `engine/test/selection.mjs`.
//
// THE RULE, and it is a SWAP. Both calls exchange the complete state - position AND facing -
// of the dancers they pair up, and nobody else moves:
//
//   - `Run`: the designated dancers run around an ADJACENT dancer and take that dancer's
//     place; the dancer run around steps into the vacated place. Reference `run.dart` scales
//     both paths by the same `dist/2` (in the two dancers' own frames, which face opposite),
//     so the net effect is an exact exchange.
//   - `Trade`: the designated dancers trade with each other, running around any dancers in
//     between (reference `trade.dart`: "allow enough room to get around them and pass right
//     shoulders"), which is what `Boys Trade` from a `BggB` wave is - the two boys trade
//     ACROSS the two girls, and the girls do not move.
//
// The facing half of the exchange is what keeps a formation coherent, and it is MEASURED, not
// inferred. Static reading of the reference was inconclusive: `math/bezier.dart:71-76` takes
// the facing from the TANGENT of the rotation curve, and for `RunRight` (where `brotate =
// btranslate`) that tangent at the endpoint points 180 degrees from the start, while
// `rolling()` (`:79-88`) special-cases 180 to the halfway tangent, which points -90. Feeding
// the authored variants their OWN declared formation and reading the end board settles it, and
// the corpus independently corroborates it: the shipped `B-Run` motion leaves partners 4-6
// units apart in 6 published promenade get-outs, whereas an exchange keeps the wave a wave.
//
// TWO HONEST LIMITS, both refused with a reason rather than approximated:
//   - a Run around MORE than one dancer (`Run Around 2`) is not implemented;
//   - the reference's hand-holds for the swing/slip trade cases (`!samedir && dist < 2.1`) are
//     not modelled, because our board carries no hand state into a derived apply.

import { normAngle } from '../moves.js';
import type { Board } from './types.js';

/** A board dancer, narrowed to what these rules read. */
type D = Board['dancers'][number];

/** The physical (non-ghost) dancers, in board order. */
const physical = (board: Board): D[] => board.dancers.filter((d) => !d.isGhost);

const dist = (a: D, b: D): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Where `b` lies in `a`'s own frame: `lateral > 0` means b is on a's LEFT, `< 0` on a's
 * RIGHT, and `forward` is positive in front. This is the reference's `isLeftOf` / `isRightOf`
 * / `isInFrontOf` / `isInBackOf` expressed as one signed pair, so the four agree by
 * construction instead of being four independent comparisons that can drift.
 */
function relative(a: D, b: D): { forward: number; lateral: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const c = Math.cos(a.heading);
  const s = Math.sin(a.heading);
  // Rotate the world offset back into a's local frame (the inverse of the frame our
  // `applyMoveToState` builds: x' = dx*cos + dy*sin, y' = -dx*sin + dy*cos).
  return { forward: dx * c + dy * s, lateral: -dx * s + dy * c };
}

/** Whether `a` and `b` are declared partners (same known home couple, different dancers). */
function arePartners(a: D, b: D): boolean {
  return !!a.couple && a.couple === b.couple && a.id !== b.id;
}

/** How far off the lateral axis a dancer may stand and still count as being BESIDE the
 * runner/trader rather than diagonal to them. A Run and a Trade both pair a dancer with
 * someone in the same line, so a candidate in the ADJACENT wave of a two-wave set — which is
 * a whole unit of forward offset away — must not be a candidate at all. Without this the
 * side-search reached across the set and reported "4 further dancers on that side", refusing
 * `Boys Run` from a wave outright. */
const ALIGN_TOL = 1.0;

/** Whether `b` is BESIDE `a` (same line, offset laterally) rather than diagonally placed. */
function isBeside(a: D, b: D): boolean {
  const r = relative(a, b);
  return Math.abs(r.forward) <= ALIGN_TOL && Math.abs(r.lateral) > 0.01;
}

/** The nearest dancer in `candidates` by Euclidean distance, or null when there are none. */
function nearest(from: D, candidates: D[]): D | null {
  let best: D | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = dist(from, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/**
 * Apply a pair exchange. Positions are always swapped - both dancers move half the gap, which is
 * what the reference's `dist/2` scaling gives - but the FACINGS are not, and the difference is
 * load-bearing:
 *
 *   - the RUNNER turns 180 degrees from its own heading. `RunLeft`/`RunRight` pass no rotation
 *     curve, so `brotate = btranslate` and the facing follows the path's tangent, which at the
 *     endpoint points back the way the dancer came.
 *   - the DANCER RUN AROUND keeps its own heading. `DodgeLeft`/`DodgeRight` DO carry a rotation
 *     curve and it ends pointing forward, so a dodge is a pure sidestep.
 *
 * Swapping both facings instead - which this function used to do, on the reasoning that a full
 * exchange is what keeps a wave coherent - is WRONG, and the corpus says so. From a wave the
 * runner and the dancer run around face opposite ways, so a full exchange reproduces the wave;
 * the reference's rule turns only the runner, so the pair ends facing the SAME way and the wave
 * becomes a TWO-FACED LINE. All8's published get-out `--SwThr B-Run --BendL` only works if that is
 * so, because `Bend the Line` is legal from a two-faced line and not from a wave - and it is the
 * reason those lines were stopping at `Bend the Line`.
 *
 * `flipRunner` selects the behaviour: true for Run (runner turns), false for Trade, where both
 * dancers trade and each ends facing the way the other did.
 */
function exchange(board: Board, pairs: [D, D][], flipRunner: boolean): Board {
  const swap = new Map<number, { x: number; y: number; heading: number }>();
  for (const [a, b] of pairs) {
    if (flipRunner) {
      swap.set(a.id, { x: b.x, y: b.y, heading: normAngle(a.heading + Math.PI) });
      swap.set(b.id, { x: a.x, y: a.y, heading: b.heading });
    } else {
      swap.set(a.id, { x: b.x, y: b.y, heading: b.heading });
      swap.set(b.id, { x: a.x, y: a.y, heading: a.heading });
    }
  }
  return {
    dancers: board.dancers.map((d) => {
      const s = swap.get(d.id);
      return s ? { ...d, x: s.x, y: s.y, heading: s.heading } : d;
    }),
  };
}

/**
 * `Run`: each designated dancer runs around an ADJACENT dancer and takes its place; that
 * dancer steps into the vacated place. Nobody else moves.
 *
 * Side selection follows `run.dart`: a dancer can only run around someone on a side that has a
 * non-designated dancer on it, and when BOTH sides are open the reference runs around the
 * PARTNER (a Run past your partner is the common reading; the `usePartner` pass in `run.dart`
 * only fires once the unambiguous assignments have been made). Identity is real data - a board
 * with unknown couples simply has no partner preference, which is why `arePartners` requires a
 * known couple rather than falling back to array position.
 */
export function runRule(board: Board, selectedIds: number[]): { board: Board } | { reason: string } {
  const phys = physical(board);
  const picked = new Set(selectedIds);
  const runners = phys.filter((d) => picked.has(d.id));
  const walkers = phys.filter((d) => !picked.has(d.id));

  if (runners.length === 0) return { reason: 'a Run needs at least one designated dancer to run' };
  if (walkers.length === 0) return { reason: 'a Run needs a dancer to run around, and every dancer is designated' };

  const unclaimed = new Set(walkers.map((d) => d.id));
  const pairs: [D, D][] = [];

  for (const runner of runners) {
    const open = walkers.filter((w) => unclaimed.has(w.id));
    const beside = open.filter((w) => isBeside(runner, w));
    const left = beside.filter((w) => relative(runner, w).lateral > 0.01);
    const right = beside.filter((w) => relative(runner, w).lateral < -0.01);
    if (left.length === 0 && right.length === 0) {
      // Distinguish "nobody there at all" from "somebody there but not beside you", because
      // the second is a real call shape we do not implement (run around a dancer directly in
      // front or behind), not a board with nowhere to run.
      const inLine = open.filter((w) => Math.abs(relative(runner, w).lateral) <= 0.01);
      return {
        reason: inLine.length > 0
          ? `running around a dancer directly in front or behind (${inLine.length} of them at (${runner.x.toFixed(1)},${runner.y.toFixed(1)})) is not implemented`
          : `no dancer is beside (${runner.x.toFixed(1)},${runner.y.toFixed(1)}) to run around`,
      };
    }

    const side = left.length > 0 && right.length > 0
      ? (left.some((w) => arePartners(runner, w)) ? left : right)
      : (left.length > 0 ? left : right);

    // Run around exactly ONE dancer: the reference's default is `runAround = 1`, and a caller
    // asking for more says so explicitly ("Run Around 2"). So the nearest dancer BESIDE the
    // runner is the one it runs around — a further dancer down the same line is not "in the
    // way", it is simply further along, which is why `Boys Run` from a wave (where the runner
    // at the end has both girls of its wave beside it) must still run around only the near one.
    const walker = [...side].sort((a, b) => dist(runner, a) - dist(runner, b))[0];

    unclaimed.delete(walker.id);
    pairs.push([runner, walker]);
  }

  return { board: exchange(board, pairs, true) };
}

/**
 * `Trade`: the designated dancers trade with each other, running around anyone in between;
 * the dancers in between do not move.
 *
 * Direction and partner selection follow `trade.dart`: a trader trades with the NEAREST other
 * trader in the direction holding an ODD number of them, and the reference requires that side
 * to be unambiguous (the opposite side holds an even number). Every trader must resolve, and
 * each is used at most once.
 */
export function tradeRule(board: Board, selectedIds: number[]): { board: Board } | { reason: string } {
  const phys = physical(board);
  const picked = new Set(selectedIds);
  const traders = phys.filter((d) => picked.has(d.id));

  if (traders.length < 2) {
    return { reason: `a Trade needs at least two designated dancers, and ${traders.length} ${traders.length === 1 ? 'is' : 'are'} designated` };
  }
  if (traders.length % 2 !== 0) {
    return { reason: `a Trade needs an even number of designated dancers, and ${traders.length} are designated` };
  }

  const unclaimed = new Set(traders.map((d) => d.id));
  const pairs: [D, D][] = [];

  for (const trader of traders) {
    if (!unclaimed.has(trader.id)) continue;
    const others = traders.filter((t) => unclaimed.has(t.id) && t.id !== trader.id && isBeside(trader, t));
    if (others.length === 0) {
      return { reason: `no other designated dancer is beside (${trader.x.toFixed(1)},${trader.y.toFixed(1)}), so it has no one to trade with` };
    }

    const left = others.filter((t) => relative(trader, t).lateral > 0.01);
    const right = others.filter((t) => relative(trader, t).lateral < -0.01);

    // The reference's parity rule: trade in the direction whose count is ODD (the other must
    // be even). When both are odd or both even it cannot decide and raises.
    const leftOdd = left.length % 2 === 1;
    const rightOdd = right.length % 2 === 1;
    let side: D[];
    if (leftOdd && !rightOdd) side = left;
    else if (rightOdd && !leftOdd) side = right;
    else if (left.length > 0 && right.length === 0) side = left;
    else if (right.length > 0 && left.length === 0) side = right;
    else {
      return { reason: `cannot tell which way the dancer at (${trader.x.toFixed(1)},${trader.y.toFixed(1)}) trades: ${left.length} designated dancer(s) left and ${right.length} right, which is neither an odd/even pair` };
    }

    const partner = nearest(trader, side)!;
    unclaimed.delete(trader.id);
    unclaimed.delete(partner.id);
    pairs.push([trader, partner]);
  }

  return { board: exchange(board, pairs, false) };
}
