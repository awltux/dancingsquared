// WHAT A DRAG OF A DANCER'S START POSE DOES TO THE REST OF THE SELECTION: one board transform about
// the board's centre, read off the one dancer under the pointer.
//
// ASKED FOR: "When multiple dancers are selected and I've selected Edit: Dancers: Position, when I move the
// highlighted dancer all the other dancers move in lock step rather than using a board transform e.g. If I
// move a dancer towards the center of the board, all dancers should move towards the center of the board.
// Currently they move using global coordinates."
//
// WHY THIS IS ITS OWN MODULE, with no DOM and no `three`: the rule has to be measurable. The drag itself
// lives in `editor-ui.ts`, which builds DOM and cannot run under plain node - so a rule that lived there
// could only ever be MIRRORED by `poc/tools/start-pose-drag-probe.mjs`, which is what that probe used to do
// and is one edit away from a probe that measures a copy of the rule rather than the rule. `grid-magnet.ts`
// is the same trade made the same way, and this is the second half of the floor's own arithmetic.
//
// THE RULE IS SCALE PLUS TRANSLATION, and the split is forced rather than chosen: it is the only
// decomposition in which the dragged dancer lands EXACTLY where the pointer is, while the current
// same-delta behaviour survives as one slice of it.
//
//     r0 = |p0|, r1 = |p1|          the focus's distance from the centre, before and now
//     scale = r1 / r0               the radial part of the drag, as a ratio
//     (dx, dy) = p1 - scale * p0    whatever motion is left over
//
// so a dancer is written to `scale * p + (dx, dy)`.
//
// THE OLD CONTRACT IS THE CONSTANT-RADIUS CASE, EXACTLY. A drag that keeps the focus on its own circle has
// `r1 == r0`, hence `scale == 1` and `(dx, dy) == p1 - p0` - the same floor shift on every selected dancer,
// which is what this axis did before. Nothing that used to be possible is lost: sliding the selection across
// the floor is a drag at a constant radius.
//
// AND A PURELY RADIAL DRAG IS A PURE SCALE: if `p1` is `p0` scaled (the caller drags straight in or out
// along the line the handle is drawn on) then `(dx, dy)` is zero and every selected dancer moves along its
// own radius by the same factor - which is the report's example, with a dancer standing on the centre held
// there as the pivot.
//
// NOTHING HERE TURNS A DANCER. The headings are the `rotation` axis's business (`edAxisHead`), and a
// position drag that re-aimed the tracks would be a second way to make an edit that axis already owns.
// Nor is any authored curve touched: an edit here writes START POSES, which is what the axis's own
// description promises ("a set can be placed and turned without touching a single move"), and
// `setDancerStart` carries each dancer's moves through verbatim in the frame the caller just chose.
//
// THE CENTRE IS A PARAMETER, defaulting to the board's own origin - the point `drawDancerHandles` already
// anchors the position handle to, and the centre `snapRadial` and `radialArcFit` measure from. Passing it
// explicitly is what lets the probe measure the rule against the same origin the board draws.

// THE ENGINE'S "SHOULD BE EXACT" TOLERANCE, imported rather than spelled: `NO_RADIUS` below was a bare 1e-9 with its
// own four lines of reasoning, and the engine names the same rule (`tolerances.ts`). A drag's degenerate pivot is the
// same question the engine asks of a zero radius.
import { EXACT_TOL } from 'dancing-squared-engine/core';

/** A point in BOARD coordinates - the floor's own frame, which is the one the grid is drawn in. */
export interface Point {
  x: number;
  y: number;
}

/**
 * ONE BOARD TRANSFORM OF A SELECTION: a uniform scale about the centre, then a floor shift.
 *
 * `scale` is never negative, because it is a ratio of two distances. A negative scale would be a
 * half-turn wearing a scale's clothes, and the axis does not turn anybody.
 */
interface BoardTransform {
  scale: number;
  /** The shift applied AFTER the scale, so the dragged point lands on the pointer. */
  dx: number;
  dy: number;
}

/** The board's centre: the origin the floor, the grid and the position handle are all drawn about. */
export const BOARD_CENTRE: Point = { x: 0, y: 0 };

/**
 * Below this, a dancer is ON the centre and has no radius to take a ratio of. The number is a distance in
 * board units against a floor 10 units across and a magnet whose finest tier is 0.125, so it is far below
 * anything a caller can place by hand - it exists to keep `r1 / r0` from being 0/0 on a dancer chosen as
 * the pivot.
 */
const NO_RADIUS = EXACT_TOL;

/**
 * The transform a drag from `p0` to `p1` means.
 *
 * A FOCUS ON THE CENTRE HAS NO RATIO, so `scale` is 1 and the drag degenerates to the plain translation -
 * the old rule, and the only reading of "drag the pivot" that does anything sensible. It is not an error:
 * dragging a dancer who stands on the centre is a legitimate way to slide the selection.
 */
export function boardTransformOf(p0: Point, p1: Point, centre: Point = BOARD_CENTRE): BoardTransform {
  const r0 = Math.hypot(p0.x - centre.x, p0.y - centre.y);
  const r1 = Math.hypot(p1.x - centre.x, p1.y - centre.y);
  const scale = r0 > NO_RADIUS ? r1 / r0 : 1;
  return {
    scale,
    dx: p1.x - (centre.x + scale * (p0.x - centre.x)),
    dy: p1.y - (centre.y + scale * (p0.y - centre.y)),
  };
}

/** Where one dancer's start goes. The centre itself is fixed by the scale and moves only by the shift. */
export function applyBoardTransform(p: Point, t: BoardTransform, centre: Point = BOARD_CENTRE): Point {
  return {
    x: centre.x + t.scale * (p.x - centre.x) + t.dx,
    y: centre.y + t.scale * (p.y - centre.y) + t.dy,
  };
}

