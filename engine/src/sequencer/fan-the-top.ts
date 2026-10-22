// `Fan the Top` as a GEOMETRY-DERIVED call — the first Plus call ported this way.
//
// WHY DERIVED. The catalogue's tams are DEMONSTRATIONS: the reference implements the call in code
// (`sequencer/calls/plus/fan_the_top.dart`, `class FanTheTop extends SplitCall`), so its XML is an
// animation rather than an authoritative motion. Our engine has no derived rule at all for this call
// and matches those tams as setups, which MEASURED wrong in BOTH directions (see PLAN.md, round 27):
//
//   Ocean Waves  Fan the Top -> a single line of eight at HALF spacing   (wrong)
//   Tidal Wave   Fan the Top -> Ocean Waves                              (wrong)
//
// while an 8-dancer variant matched at error 0.000 in both cases — so it is the READING of those
// per-half paths that fails, not the finding of them. `Spin the Top` inherits the same defect, because
// CALLERLAB defines it as part 1 `Swing` + part 2 `Fan the Top`.
//
// THE RULE, from CALLERLAB's own text, which the reference ships at
// `taminations-flutter/assets/plus/fan_the_top.md`:
//
//   > Starting formation - ocean wave or two-faced lines. **The centers of the line or wave turn
//   > three quarters (270°) while the outside dancers move forward in a quarter circle.** The ending
//   > formation is at right angles to the starting formation. **Centers remain centers and ends remain
//   > ends.** (Timing: 4)
//
// THE GEOMETRY, and why it is a FAN rather than a rotation. Rotation by 270° and by -90° are the SAME
// position transform, so a rule that took the two parts literally would rigidly rotate the wave and
// would send the centres BACKWARD while the ends walked forward — which no dancer does. Read as the
// definition's own contrast between "three quarters" (centres) and "a quarter circle" (ends), the two
// groups turn in OPPOSITE senses, and that reading is the only one in which **every dancer walks
// forward**, which is the check that settles it:
//
//   ends     rotate -90° (clockwise)        about the SET centre
//   centres  rotate +90° (counterclockwise) about the SET centre
//
// for positions AND headings. On the canonical four-dancer wave (slots at y = 3, 1, -1, -3, facing
// alternately east/west) that puts the four dancers on the perpendicular axis at x = -5, -3, -1, 1
// still two apart and still facing alternately — a wave again, centres still centres — and all four
// velocities point along their own facing. On the canonical EIGHT-dancer `Ocean Waves` (two parallel
// waves at x = ±2) it produces two proper waves at y = ±2, i.e. at right angles, with no collision.
//
// WHY THE SET CENTRE AND NOT EACH WAVE'S OWN. Rotating each wave about its OWN centre sends both
// waves onto the same line (both centres lie on the x-axis), where they overlap. About the SET centre
// they stay separate, which is what makes `Spin the Top` work from two parallel waves.

import { normAngle } from '../moves.js';
import type { Board } from './types.js';

type D = Board['dancers'][number];

/** The reference's `isAround` tolerance, in radians — the same value `swing-thru.ts` uses. */
const DELTA = 0.1;
/** How far away a hand-neighbour may be. The reference's `minDistance` for the hand relations. */
const HAND_MAX = 3.0;
/** How far off the lateral axis a dancer may stand and still be a hand-neighbour of the wave. */
const ALIGN_TOL = 0.6;

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

/** `a` and `b` hold hands: each has the other at its side, mutually, within `HAND_MAX`. */
function handHold(a: D, b: D): boolean {
  if (dist(a, b) > HAND_MAX) return false;
  const ab = bearing(a, b);
  const ba = bearing(b, a);
  const side = (t: number): boolean => angDiff(t, Math.PI / 2) < DELTA || angDiff(t, -Math.PI / 2) < DELTA;
  if (!side(ab) || !side(ba)) return false;
  // Both must be looking at the same side of the line they stand on, i.e. opposite facings, which is
  // what a wave is; two dancers back to back or facing each other are not in a wave together.
  return Math.abs(Math.abs(angDiff(a.heading, b.heading)) - Math.PI) < DELTA;
}

/** Group the board into WAVES OF FOUR by hand-hold, or null when the board is not such a board. */
function findWaves(board: Board): D[][] | null {
  const ds = physical(board);
  if (ds.length === 0 || ds.length % 4 !== 0) return null;
  const seen = new Set<number>();
  const waves: D[][] = [];
  for (const start of ds) {
    if (seen.has(start.id)) continue;
    const comp: D[] = [];
    const stack = [start];
    seen.add(start.id);
    while (stack.length) {
      const d = stack.pop()!;
      comp.push(d);
      for (const o of ds) {
        if (seen.has(o.id) || !handHold(d, o)) continue;
        seen.add(o.id);
        stack.push(o);
      }
    }
    if (comp.length !== 4) return null;
    waves.push(comp);
  }
  return waves.length * 4 === ds.length ? waves : null;
}

/**
 * One wave's four dancers in LINE order, so index 0 and 3 are the ENDS and 1 and 2 the CENTRES.
 * The axis is taken from the wave's own two most distant members, which is the line direction; the
 * alignment guard rejects a "wave" that is really a box, whose diagonal would order it nonsense.
 */
function orderAlongLine(wave: D[]): D[] | null {
  let axis: { x: number; y: number } | null = null;
  let far = 0;
  for (let i = 0; i < wave.length; i++) {
    for (let j = i + 1; j < wave.length; j++) {
      const d = dist(wave[i], wave[j]);
      if (d > far) {
        far = d;
        const n = Math.hypot(wave[j].x - wave[i].x, wave[j].y - wave[i].y) || 1;
        axis = { x: (wave[j].x - wave[i].x) / n, y: (wave[j].y - wave[i].y) / n };
      }
    }
  }
  if (!axis) return null;
  const a = axis;
  const proj = wave.map((d) => d.x * a.x + d.y * a.y);
  // The wave's own line: every dancer must lie ON it, not off it, or this is not a wave of four.
  const perp = wave.map((d) => -d.x * a.y + d.y * a.x);
  const spread = Math.max(...perp) - Math.min(...perp);
  if (spread > ALIGN_TOL) return null;
  return wave.map((d, i) => ({ d, p: proj[i] })).sort((m, n) => m.p - n.p).map((m) => m.d);
}

/** Rotate `d` about (cx, cy) by `turn`, heading included. */
function rotateAbout(d: D, cx: number, cy: number, turn: number): { x: number; y: number; heading: number } {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const dx = d.x - cx;
  const dy = d.y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c, heading: normAngle(d.heading + turn) };
}

/** Why this board cannot Fan the Top, or null when it can. */
export function fanTheTopProblem(board: Board): string | null {
  const ds = physical(board);
  if (ds.length === 0 || ds.length % 4 !== 0) {
    return `Fan the Top acts on waves of four, and this board has ${ds.length} dancers`;
  }
  const waves = findWaves(board);
  if (!waves) {
    return 'Fan the Top starts from an Ocean Wave or Two-Faced Line, and this board does not divide '
      + 'into waves of four joined by hand';
  }
  for (const w of waves) {
    if (!orderAlongLine(w)) {
      return 'Fan the Top needs each wave to be a straight line of four, and one of these is not';
    }
  }
  return null;
}

/**
 * Fan the Top from this board: ends a quarter circle clockwise, centres a quarter the other way,
 * both about the SET centre, positions and facings together. See the header for the derivation and
 * the two canonical boards it was validated against.
 */
export function fanTheTop(board: Board): { board: Board; reason?: string } {
  const problem = fanTheTopProblem(board);
  if (problem) return { board, reason: problem };

  const ds = physical(board);
  const cx = ds.reduce((n, d) => n + d.x, 0) / ds.length;
  const cy = ds.reduce((n, d) => n + d.y, 0) / ds.length;

  const moved = new Map<number, { x: number; y: number; heading: number }>();
  for (const wave of findWaves(board)!) {
    const line = orderAlongLine(wave)!;
    line.forEach((d, i) => {
      const isCentre = i === 1 || i === 2;
      moved.set(d.id, rotateAbout(d, cx, cy, isCentre ? Math.PI / 2 : -Math.PI / 2));
    });
  }

  return { board: { dancers: board.dancers.map((d) => { const m = moved.get(d.id); return m ? { ...d, ...m } : d; }) } };
}
