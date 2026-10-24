// WHAT COUNTS AS "THE SAME MOVE": the panel's group gate, as a pure rule a probe can import.
//
// WHY THIS IS ITS OWN MODULE. Every predicate here decides whether two dancers are doing the same thing, and five
// probes need that answer: `clone-refusal-probe.mjs`, `connect-assign-probe.mjs`, `coords-gate-probe.mjs`,
// `match-link-probe.mjs` and `select-row-probe.mjs`. Each of them carried a COPY - the two windows (`0.025`, `0.5`)
// and a local `travelGap`/`sameTravel`/`sameFacingCurve`, one of them saying so in a comment ("THE PANEL'S GATE,
// copied in the two numbers that define it"). The two NUMBERS were pinned by grepping the panel's text; the
// COMPARISON was not pinned anywhere - a probe that restates the arithmetic measures a copy of the rule and is one
// edit away from measuring nothing (AGENTS.md 5). The rule was pure already (engine types, no DOM, no `three`), so
// the only thing standing between it and a gate was where it lived.
//
// THE SHAPE WINDOW IS HALF A PIXEL'S WORTH OF MOVEMENT, and the two numbers that decide it are in a gap in the data
// rather than in an argument. MEASURED (`poc/tools/clone-refusal-probe.mjs --sweep`, the walk-in the connect writes
// for every call x every formation the picker offers, 12248 refused pairs, at the flat view's 40.91 px per unit): the
// refusals come in exactly two sizes - **232 rest on a difference under half a pixel, and the next smallest is
// 2 px** - with NOTHING at all between 0.5 and 2 px. So the window may be anywhere in that empty band and the same
// refusals are made; it sat at 0.01 units (0.4 px), which refused the 232, and those are differences nobody can see.
//
// THE ONE THAT PROMPTED THIS: "All 4 Couples Promenade Full" cloned onto the formation made from the end of
// `Right and Left Grand`, connected, then dancers 1 and 3 selected - refused, on a difference of 0.0142 units, which
// is **0.58 px**. The curves were a hair apart and the panel said the two dancers do not move alike. The window is
// now 0.025 units, one pixel, which opens that witness and all 232 and refuses nothing else in the corpus.
//
// AND THE WINDOW IS ON THE CURVES, not on the control points. A Bezier is a convex combination of its control points,
// so equal control points mean equal curves - but a control point can differ by more than the window while the curves
// stay well inside it, which is how the same move written as an ease-in and as a constant-speed line was refused
// although both trace the same segment. What a caller compares is the drawn shape, so that is what is measured, at
// seventeen points along it.
//
// The window used to be 1e-6 ON THE RAW NUMBERS, and its fault was not its width but its KIND: it asked whether five
// numbers match rather than whether the move does. MEASURED (`poc/tools/coords-gate-probe.mjs`): it refused group
// edits resting on a difference of 0.0 units and 0.0 degrees, which is what a caller reported as "they look the
// same". They did.
//
// THE FACING IS COMPARED THROUGH THE ENGINE, which also knows the one exact case: a facing curve multiplied by a
// positive constant is the SAME facing at every instant, because `bezierAngle` is `atan2` of the derivative. Half a
// degree is well below the spacing of the facing ticks themselves, and MEASURED the facing refusals start at
// 3.15deg - three degrees above the window rather than a hair above it.
import type { Seg } from 'dancing-squared-engine';
import { bezierPoint, sameFacing } from 'dancing-squared-engine';

/** The travel window, in board units. See the header for the measurement that puts it in an empty band. */
export const SHAPE_WINDOW = 0.025;
/** The facing window, in degrees. See the header for why half a degree is below the ticks' own spacing. */
export const FACING_WINDOW_DEG = 0.5;

/** Which of a move's TWO curves an edit is about. They are different spaces - the travel Bezier is where
 *  the dancer goes, the rotation Bezier is how they turn - and so is every edit that writes one. */
export type CurveKind = 'travel' | 'facing';

/**
 * How far apart two dancers' TRAVEL curves are, in board units, measured along the curves themselves.
 *
 * A window is a PARAMETER on the predicates below rather than a closure over the constant, because the probes need
 * the counterfactual: `select-row-probe.mjs` asks what a widened 4-unit window would refuse, and `coords-gate-probe`
 * sweeps the boundaries. A rule whose threshold cannot be varied cannot be measured either.
 */
export function travelGap(a: Seg, b: Seg): number {
  let gap = 0;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const qa = bezierPoint(a.translate, t);
    const qb = bezierPoint(b.translate, t);
    gap = Math.max(gap, Math.hypot(qa.x - qb.x, qa.y - qb.y));
  }
  return gap;
}

/**
 * Whether two dancers' TRAVEL curves are the same local shape: "the same shape, rotated to each dancer's position"
 * made checkable. Beats and hands are deliberately NOT compared - the gate is about shapes, and unifying a timing or
 * a hold across a selection is a legitimate group edit.
 */
export function sameTravel(a: Seg, b: Seg, window: number = SHAPE_WINDOW): boolean {
  return travelGap(a, b) < window;
}

/**
 * Whether two dancers FACE the same way through the move, compared through the engine.
 *
 * `rotate ?? translate` IS the facing a dancer has: an absent rotation curve means "face along the travel tangent",
 * which `poseFor` implements by reading the translation curve's direction. So a dancer with an explicit facing that
 * happens to equal its path faces EXACTLY like one that has none - and comparing a null against a curve refused the
 * pair on a difference of nothing at all. A positive rescaling of a facing curve is the same facing at every instant,
 * which `sameFacing` knows exactly.
 */
export function sameFacingCurve(a: Seg, b: Seg, windowDeg: number = FACING_WINDOW_DEG): boolean {
  return sameFacing(a.rotate ?? a.translate, b.rotate ?? b.translate, windowDeg);
}

/**
 * THE GATE IS PER CURVE, and that is the whole of what makes a completed clone editable.
 *
 * A coordinate edit writes ONE curve: a field on the Move tab writes `translate.<attr>`, a field on the Facing tab
 * writes `rotate.<attr>`, and a handle drag writes whichever curve the handle belongs to. So the question the gate has
 * to answer is whether THAT curve agrees across the selection - not whether the two curves agree, which is a strictly
 * stronger condition on a write that touches one of them.
 *
 * MEASURED (`poc/tools/connect-assign-probe.mjs`, after a `connect` onto each of the 134 start formations): of the
 * walk-in pairs the gate refuses, 76 are refused on the FACING alone while their travel curves agree to within the
 * window - 24 of them with all six numbers identical, i.e. the same straight line to the last bit, refused because the
 * two dancers end the walk facing 45.15deg apart (the ancestor's own first move turns half its dancers and not the
 * other half) - so the tab that edits the line they share was locked over a curve it does not write. 242 are refused
 * on the travel alone while facing identically, locking the Facing tab on a pair a facing edit cannot collapse. 64 of
 * the 134 targets have at least one such pair.
 */
export function sameCurve(a: Seg, b: Seg, curve: CurveKind): boolean {
  return curve === 'travel' ? sameTravel(a, b) : sameFacingCurve(a, b);
}

/**
 * WHETHER TWO DANCERS ARE DOING THE SAME THING, move for move.
 *
 * This is the paperclip's question, and it is the GATE'S OWN comparison asked over a whole PATH instead of at one
 * index: the same travel shape, the same turn, the same duration and the same hands, with the same number of moves.
 * Built out of `sameTravel`/`sameFacingCurve` rather than a second notion of "the same", because a link that stopped
 * being offered while the traces still differed (or the reverse) is exactly the fault a second definition produces.
 *
 * THE START POSE IS NOT PART OF IT, deliberately. It is where the dancer stands and which way its own frame points -
 * the frame every move of the path is authored in - so it belongs to the FORMATION. A link that "made two dancers the
 * same" by moving one of them onto the other's spot would be rewriting the set, not the trace, and the Dancer scope is
 * where that edit lives.
 *
 * BEATS AND HANDS ARE PART OF IT, and they are the half the old per-curve copy deliberately left out. The caller asked
 * for "the Moves and settings", and a trace that keeps its own timing against a different donor's is two dancers doing
 * the same shape at different times.
 */
export function sameTrace(a: Seg[], b: Seg[]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    if (!sameTravel(a[k], b[k]) || !sameFacingCurve(a[k], b[k])) return false;
    if (a[k].beats !== b[k].beats || a[k].hands !== b[k].hands) return false;
  }
  return true;
}
