// The replay clock: how a dancer's pose gets from one board to the next.
//
// ============================================================================================
// THIS IS A TWEEN, NOT THE CALL'S OWN PATH, AND THE DIFFERENCE MATTERS.
//
// A `PuzzleStep` carries the board each option ENDS on (`PuzzleStep.moves[i].board`) — that is what makes
// the option buttons finishable and comparable with `sameBoardById` — but it does not carry the MOTION the
// call authors. Drawing the authored motion needs the call's Bézier bundle rebased onto the live board and
// walked per beat, which is the `Sequencer.evaluateSequence` work DESIGN.md §4.3 puts in **Phase 3**. So
// this module interpolates in a straight line from where each dancer stands to where the call leaves it.
//
// WHAT THAT COSTS, stated because a teaching tool must not imply more than it shows: the END POINTS are
// exact — a replay arrives on precisely the board the verdict was computed against — but a call whose
// dancers travel an arc (a `Swing`, a `California Twirl`) is drawn as a chord through it, and no hand
// holds are shown, because a pair of boards carries no grip state. The teaching point of a Drill option is
// "where does this call leave the set", and that is exact here. The path and the holds are Phase 3's, and
// when they land this module is what they replace.
// ============================================================================================
//
// TWO THINGS ARE LOAD-BEARING AND EASY TO GET WRONG:
//
// 1. DANCERS ARE MATCHED BY ID, NEVER BY INDEX. The two boards can be arrayed differently — `reorderLike`
//    exists precisely because a component that hands back a rebuilt board in its own order scrambles the
//    set on the frame it lands on (engine/src/sequencer/board.ts). Interpolating index-to-index would walk
//    each dancer to a stranger's spot, and every position in the result would still look legal.
//
// 2. THE HEADING ARC TAKES THE SHORT WAY. Headings are radians on a circle, so a dancer turning from 350
//    degrees to 10 turns twenty degrees, not three hundred and forty — and a naive `a + (b - a) * f` turns
//    them the long way through every other facing in the set. `shortestArc` is that correction.
import type { Board, Hands, Pose, SeqDancer } from 'dancing-squared-engine';

/** A dancer's pose mid-move, in the `Pose` shape the renderer takes. */
export interface TweenPose extends Pose {}

/**
 * The grip state a snapshot carries.
 *
 * `Pose.hands` exists because a call's SEGMENT declares what its dancer holds; a pair of BOARDS declares
 * only where they stand, so there is nothing to interpolate and `'none'` is the honest value. See the
 * header for why the holds are a Phase 3 concern rather than an oversight.
 */
const NO_GRIP: Hands = 'none';

/** The signed shortest angle from `a` to `b`, in `(-pi, pi]`. */
export function shortestArc(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Ease-in-out, so a replay starts and stops rather than snapping into motion. */
export function easeInOut(f: number): number {
  const t = Math.min(1, Math.max(0, f));
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * The pose of every dancer at `fraction` of the way from `from` to `to`, in the ID ORDER OF `from`.
 *
 * THE RESULT IS INDEXED LIKE `from`, because that is the binding the renderer holds: a `DancerView` was
 * built from a dancer of `from`, so pose `i` must belong to that dancer. A dancer present in one board and
 * absent from the other is a puzzle defect rather than a rendering question, so it throws rather than
 * guessing a spot.
 */
export function tweenBoards(from: Board, to: Board, fraction: number): TweenPose[] {
  const f = Math.min(1, Math.max(0, fraction));
  const byId = new Map<number, SeqDancer>();
  for (const d of to.dancers) byId.set(d.id, d);
  if (byId.size !== to.dancers.length) throw new Error('the target board has duplicate dancer ids');
  return from.dancers.map((d) => {
    const target = byId.get(d.id);
    if (!target) throw new Error(`dancer ${d.id} is in the start board and not in the end board`);
    return {
      x: d.x + (target.x - d.x) * f,
      y: d.y + (target.y - d.y) * f,
      heading: d.heading + shortestArc(d.heading, target.heading) * f,
      hands: NO_GRIP,
    };
  });
}

/**
 * A pose list at rest on one board.
 *
 * Exists so the view has ONE way to obtain poses, whether it is drawing a still board or a replay in
 * flight — a second path would be a second place for the board-to-pose mapping to drift.
 */
export function stillBoard(board: Board): TweenPose[] {
  return board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, hands: NO_GRIP }));
}
