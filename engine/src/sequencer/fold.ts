// Fold and Cross Fold as GEOMETRY-DERIVED calls.
//
// WHY THESE ARE DERIVED AND NOT A CATALOG SETUP. `ms/fold.xml` marks both `Boys Fold` tams and both
// `Girls Fold` tams `sequencer="no"`, and the library's own note names the reason: Taminations
// implements Fold in CODE (`taminations-flutter/lib/sequencer/calls/ms/fold.dart`), so its tams are
// demonstrations. The engine deliberately does not filter `sequencer="no"` out of matching
// (measured in Phase 4 as a change for the worse), so a DEMONSTRATION was being matched as an
// ordinary setup — and the consequence was specific and measurable, not theoretical:
//
//   `Boys Fold` from the canonical `Ocean Waves` board matched `from="Ocean Waves"` at error 0.000
//   with `reflect=true`, and folded DANCERS 2, 4, 6 and 8 — two girls and two boys — instead of the
//   four boys, pushing the moved dancers from x=∓2 out to ∓4 and leaving the board unnamed.
//
// The tams DO say which dancers fold, but through the setup's gender pattern, and `genderSpecific`
// is false for them (only `sequencer="gender-specific"` sets it), so `matchFormations` ran with
// `requireGender=false` and the pattern was ignored. A demonstration matched as a setup is a
// designation-blind match, which is exactly this failure mode.
//
// THE RULE, transcribed from the two reference files rather than re-derived, and the two are the SAME
// RULE with a different `d2`:
//
//     fold.dart         d2 = the dancer to fold in front of, "usually the partner"; when there is no
//                            partner, the side with an ODD number of dancers on it
//     cross_fold.dart   d2 = the SECOND dancer on that side ("passing both the center of the Line
//                            and one dancer position")
//     both              m = d2.isRightOf(d) ? FoldRight : FoldLeft
//                       d.path = m.scale(0.75, d.distanceTo(d2) / 2)
//
// and in `moves.dart` the base path is a half turn that ends 2 forward and 2 toward that side, so the
// scaling makes the net displacement **1.5 forward** and **`dist` toward `d2`**, with the facing
// reversed. `CrossFold` uses the SAME `FoldRight`/`FoldLeft` base — it is not a different arc; only
// `d2` is further away, which is what makes the lateral displacement twice as large.
//
// TWO THINGS THE REFERENCE DOES THAT ARE KEPT, and one it does not:
//   - the reference calls `ctx.noSnap()`, because "dancers often end up in unusual formations after
//     Fold or Cross Fold" and CALLERLAB's own comment says the same (implicit adjustments normalise
//     them on the next call). So the fold does not try to tidy the result.
//   - the reference throws when the chosen `d2` is itself active. CALLERLAB's command examples are
//     all designated ("Boys Fold", "Ends Fold", "Leaders Fold"), and `Everyone Fold` is documented as
//     a GIMMICK, so refusing is the honest reading rather than inventing the gimmick's end pose.
//   - the reference works with all dancers "because partners of the folders need to adjust". That
//     adjustment is in the reference's ANIMATION, not in its end pose: the non-designated dancer
//     has the `Stand` path. So here only the designated dancers move, which is what CALLERLAB's
//     "The non-designated dancer is inactive and does not move" says.

import { normAngle } from '../moves.js';
import type { Board } from './types.js';

/** A board dancer, narrowed to what this rule reads. */
type D = Board['dancers'][number];

const physical = (board: Board): D[] => board.dancers.filter((d) => !d.isGhost);

const dist = (a: D, b: D): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Where `b` lies in `a`'s own frame: `lateral > 0` means b is on a's LEFT, `< 0` on a's RIGHT.
 * The same signed pair `trade-run.ts` uses, so the two rules cannot disagree about a side.
 */
function relative(a: D, b: D): { forward: number; lateral: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const c = Math.cos(a.heading);
  const s = Math.sin(a.heading);
  return { forward: dx * c + dy * s, lateral: -dx * s + dy * c };
}

/** How far off the lateral axis a dancer may stand and still count as BESIDE rather than diagonal.
 * The same tolerance and the same reason as `trade-run.ts`: a candidate in the ADJACENT line of a
 * two-line set is a whole unit of forward offset away and must not be a candidate at all. */
const ALIGN_TOL = 1.0;

/** Dancers beside `d` on one side, nearest first — the reference's `dancersToLeft`/`dancersToRight`,
 * which are `dancersInOrder(d, o => o.isLeftOf(d))`. */
function beside(d: D, others: D[]): { left: D[]; right: D[] } {
  const left: D[] = [];
  const right: D[] = [];
  for (const o of others) {
    if (o.id === d.id) continue;
    const r = relative(d, o);
    if (Math.abs(r.forward) > ALIGN_TOL || Math.abs(r.lateral) <= 0.01) continue;
    (r.lateral > 0 ? left : right).push(o);
  }
  const byNear = (a: D, b: D) => dist(d, a) - dist(d, b);
  left.sort(byNear);
  right.sort(byNear);
  return { left, right };
}

/** The authored base displacement forward: 2 in `moves.dart`, scaled by the reference's `dxscale`. */
const FOLD_FORWARD = 2 * 0.75;

/**
 * `Fold` and `Cross Fold`: each designated dancer steps forward 1.5 and half-turns around to the
 * side of the dancer it folds in front of, ending facing back the way it came. The non-designated
 * dancers do not move.
 *
 * `cross` selects the reference's `cross_fold.dart` reading of `d2` — the SECOND dancer on the side
 * rather than the first — and nothing else changes.
 */
export function foldRule(
  board: Board,
  selectedIds: number[],
  cross = false,
): { board: Board } | { reason: string } {
  const phys = physical(board);
  const picked = new Set(selectedIds);
  const actives = phys.filter((d) => picked.has(d.id));

  if (actives.length === 0) {
    return { reason: `${cross ? 'Cross Fold' : 'Fold'} needs at least one designated dancer, and none is designated` };
  }

  const moved = new Map<number, { x: number; y: number; heading: number }>();

  for (const d of actives) {
    const { left, right } = beside(d, phys);
    let d2: D | null = null;

    if (cross) {
      // cross_fold.dart: "Centers and ends cannot both cross fold", then the side is chosen by
      // counting, and the SECOND dancer on that side is the one to fold in front of.
      let isRight = true;
      if (right.length < 2) isRight = false;
      if (right.length >= 4 && right.length - 4 < 2) isRight = false;
      if (isRight && right.length > 1) d2 = right[1];
      else if (left.length > 1) d2 = left[1];
      if (!d2) {
        return {
          reason: `Cross Fold needs two dancers on one side of (${d.x.toFixed(1)},${d.y.toFixed(1)}) to pass, and there ${
            left.length + right.length === 1 ? 'is only one' : 'are none'
          }`,
        };
      }
    } else {
      // The side carrying an ODD number of dancers: the reference's parity test, the same one
      // `trade.dart` uses. `fold.dart` FIRST tries `d.data.partner`, and this parity search is its
      // fallback -- but the two agree wherever the reference's partner is well defined, because
      // `CallContext.analyze()` DERIVES that partner from exactly these left/right counts.
      //
      // The engine must not substitute its own `couple` field here, and this was MEASURED rather
      // than reasoned: `couple` is the dancer's HOME couple, not the current partner, so after
      // `1/2 Tag | Scoot Back` a boy at one end of a wave has his home partner at the other end,
      // SIX away. Using it moved dancers 4 to 6 units (`Boys Fold`, figm30) and left the board
      // unnamed; the parity rule picks the adjacent wave dancer, which is who the reference means.
      if (left.length % 2 === 0 && right.length % 2 === 1) {
        d2 = right[0];
      } else if (left.length % 2 === 1 && right.length % 2 === 0) {
        d2 = left[0];
      }
      if (!d2) {
        return {
          reason: `cannot tell who the dancer at (${d.x.toFixed(1)},${d.y.toFixed(1)}) Folds in front of: ${left.length} dancer(s) on its left and ${right.length} on its right, which is neither an odd/even pair`,
        };
      }
    }

    // The side is the SIGN of the lateral offset and the magnitude is the reference's Euclidean
    // `distanceTo`, exactly as `m.scale(0.75, dist / 2)` gives: forward 1.5, lateral `dist`, on the
    // side `d2` is on. `isRightOf` in the reference is "the angle to d2 is around 3pi/2", i.e. the
    // same side test.
    const lateralSign = relative(d, d2).lateral >= 0 ? 1 : -1;
    const forward = FOLD_FORWARD;
    const lateral = lateralSign * dist(d, d2);
    const c = Math.cos(d.heading);
    const s = Math.sin(d.heading);
    moved.set(d.id, {
      x: d.x + forward * c - lateral * s,
      y: d.y + forward * s + lateral * c,
      heading: normAngle(d.heading + Math.PI),
    });
  }

  return {
    board: {
      dancers: board.dancers.map((d) => {
        const m = moved.get(d.id);
        return m ? { ...d, x: m.x, y: m.y, heading: m.heading } : d;
      }),
    },
  };
}
