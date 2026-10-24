// Body-relative "codified move" transforms, in the engine's per-dancer 5x5
// affine model (see matrix.ts). A move is defined in the dancer's LOCAL frame:
//   local +x = the dancer's facing direction (heading θ)
//   local +y = the dancer's left (90° CCW from facing)
// A move records a net local displacement (dx, dy) plus a net heading change
// `turn` (radians, + = left/CCW). Applying it to a dancer with world heading θ:
//   world displacement = R(θ)·(dx, dy)     R(θ) = rotation by θ
//   world end heading  = θ + turn
// A pure face/turn has dx = dy = 0 (the dancer pivots in place).
//
// This mirrors taminations-flutter's coded moves.dart primitives (Face Left =
// QuarterLeft, Face Right = QuarterRight, U-Turn, Forward, ...) but expressed as
// reusable per-dancer affine transforms + board helpers, so calls can be built
// from these without needing XML path data.

import type { DancerState } from './matrix.js';
import { dancerMatrix } from './matrix.js';
import type { Mat5 } from './matrix.js';
import { EXACT_TOL } from './tolerances.js';

export const PI = Math.PI;

/** Normalise an angle to (-PI, PI]. */
export function normAngle(a: number): number {
  let r = a % (2 * PI);
  if (r <= -PI) r += 2 * PI;
  else if (r > PI) r -= 2 * PI;
  return r;
}

/**
 * A codified, body-relative move. `dx`/`dy` are in the dancer's local frame;
 * `turn` is the net heading change in radians (+ = left / CCW).
 */
export interface Move {
  readonly name: string;
  readonly dx: number;
  readonly dy: number;
  /** Net heading change, radians (+ = left / CCW). */
  readonly turn: number;
  /** Approx. beats for the move (informational, default 1). */
  readonly beats?: number;
}

const mv = (name: string, dx: number, dy: number, turn: number, beats = 1): Move => ({ name, dx, dy, turn, beats });

// ------------------------------------------------------------------ primitives

// No-op / hold.
export const Stand = mv('Stand', 0, 0, 0, 1);
// Walk forward one slot (in the facing direction).
export const Forward = mv('Forward', 1, 0, 0, 1);
// Walk backward one slot.
export const Back = mv('Back', -1, 0, 0, 1);
// Face/pivot turns (no displacement): turn the heading about the dancer's own
// position. +turn = left (CCW), -turn = right (CW).
export const FaceLeft = mv('Face Left', 0, 0, +PI / 2, 1.5);
export const FaceRight = mv('Face Right', 0, 0, -PI / 2, 1.5);
export const FaceHalf = mv('Face Half (U-Turn Back)', 0, 0, PI, 2); // 180° turn in place


// ------------------------------------------------------------------ turns

/** U-turn left (180° CCW about own position). */
export const UTurnLeft = FaceHalf;


// ------------------------------------------------------------------ helpers

/** End state of a dancer after `move`, given its world start state. */
export function applyMoveToState(d: DancerState, move: Move): DancerState {
  const c = Math.cos(d.heading);
  const s = Math.sin(d.heading);
  // local +x = facing = (c, s); local +y = left = (-s, c).
  return {
    x: d.x + move.dx * c - move.dy * s,
    y: d.y + move.dx * s + move.dy * c,
    heading: normAngle(d.heading + move.turn),
  };
}

/** The per-dancer 5x5 affine matrix implementing `move` for a world start state. */
export function moveMatrix(d: DancerState, move: Move): Mat5 {
  const end = applyMoveToState(d, move);
  return dancerMatrix(d.x, d.y, d.heading, end.x, end.y, end.heading);
}

/** The quarter turn itself, in radians: `Face In`/`Face Out` is one of these, never a partial step. */
const QUARTER = Math.PI / 2;

/**
 * How close to a multiple of 90 degrees a facing must be before it IS that grid facing, for the
 * `Face In`/`Face Out` turn below. It exists because the corpus's authored tams do NOT close on the grid
 * exactly, and the cap used to compare with `1e-9`, so a board a fraction of a degree off the grid made
 * the cap fire at the START of the sweep instead of the end: a dancer 0.5 degrees off a grid facing had
 * that facing "strictly inside" its own quarter turn, so the whole turn collapsed to the residue.
 *
 * THE VALUE IS A MEASURED RANGE, from a census of every authored heading the engine registers - 80452
 * headings over 2209 titles, taking each tam's own START and END heading:
 *
 *     exactly on the grid        78265
 *     off-grid, banded by degree  [0,1) 869   [1,2) 147   [2,3) 20   [3,4) 12   [6,7) 1
 *     the next population         [15,16) 2, then the deliberate facings (the 22.5-degree circle
 *                                 ends, 656 of them, and the 45-degree diagonals)
 *
 * So the residue cluster ends at **6.521 degrees** (`Single Circle Left 1/2`) and the smallest DELIBERATE
 * off-grid facing the corpus authors is **15.876 degrees** (`Single File Promenade`) - an empty band from
 * 4 to 6 degrees and another from 7 to 15. The band is set at 10 degrees: above every authored residue
 * with 1.5x of margin, and below every deliberate facing with 1.6x, so it can only ever absorb sloppiness
 * and can never reinterpret a bearing the corpus meant. It is NOT a floating-point tolerance - `FACING_EPS`
 * in sequence.ts is 1e-3 rad (0.057 degrees) and this is 175x larger, because the thing it absorbs is
 * authoring error rather than arithmetic.
 */
const GRID_SNAP_EPS = (10 * Math.PI) / 180;

/**
 * The grid facing `h` is within `GRID_SNAP_EPS` of, or `h` itself when it is not near one.
 *
 * IT IS APPLIED TO THE FACING THE TURN STARTS FROM, and that is the whole fix. The cap below excludes
 * the start and the end of the sweep, so a dancer already on the grid takes its full quarter turn - which
 * is the case the cap was written for. A dancer a fraction of a degree OFF the grid used to fall outside
 * that exclusion by `1e-9`, so the grid facing it was sitting on became "strictly inside" its own turn and
 * the turn collapsed to the residue: MEASURED, `Heads Circle Four Left Full` leaves the heads 0.5 degrees
 * off the grid and `Heads Face In` turned the two boys by 0.5 degrees while the two girls, whose turn runs
 * the other way, took the full quarter - reported as "only the Girls face in". Snapping the reference
 * facing first makes such a dancer ON the grid, so the cap sees exactly the case it was written for.
 */
function snapToGrid(h: number): number {
  const k = Math.round(h / QUARTER);
  const grid = normAngle(k * QUARTER);
  return Math.abs(normAngle(h - grid)) <= GRID_SNAP_EPS ? grid : h;
}

/**
 * Turn each of the given dancers to face the set centre (Face In) or away from
 * it (Face Out). Which way each dancer turns depends on its angle about the
 * centre, so the moves are not fixed matrices — computed per dancer. Returns a
 * list of per-dancer end states (in the same order as `dancers`).
 *
 * IT IS A QUARTER TURN, NOT "POINT AT THE CENTRE", and CALLERLAB says so outright:
 *
 *   "Face In: Each individual turns in place 90 degrees, turning toward the center of the set."
 *   "Face Out: Each individual turns in place 90 degrees, turning away from the center of the set."
 *
 * The difference matters whenever a dancer is not axis-aligned with the centre. Aiming at the exact
 * bearing leaves a dancer on a diagonal - from a Completed Double Pass Thru the corner dancer at
 * (1,3) facing north has the centre at -108.4 degrees - and the whole set then sits off the 90-degree
 * grid, so every later call that needs an axis facing refuses or mangles the board. MEASURED:
 * `figm92`'s `Tag the Line, Face In` produced headings of -108/-135/-45 degrees, and the `Star Thru`
 * after it collapsed the set to two dancers 0.32 apart. With the quarter turn it ends in the
 * `Normal Lines` pattern, which is what CALLERLAB's own worked note promises ("From General Lines,
 * Tag the Line, Face In (or Face Out) ends in Facing Lines (or Lines Back-to-Back)").
 *
 * The SENSE of the turn is what "toward the centre" decides: turn left when the centre is
 * counter-clockwise of the dancer's facing, right when it is clockwise. Facing exactly away leaves
 * the two senses equivalent and the left one is taken; `Face In` is called from dancers facing out,
 * where the centre is never behind them along their own axis.
 *
 * AND THE TURN STOPS AT THE FIRST 90-DEGREE FACING IT CROSSES, which is the refinement asked for as:
 * "turn 90 deg towards the origin ... but stop turning if they reach adjacent to the axis before they
 * turn 90 deg ... this refinement is for dancers not starting from square, e.g. after a `dosado your
 * corner`." A dancer on the grid is unaffected - its start IS a 90-degree facing and its end is the
 * next one, so nothing lies strictly between them and the full quarter turn is taken. A dancer that
 * starts OFF the grid (`Dosado your Corner` leaves one at a diagonal) is the case it exists for: on a
 * 30-degree facing a quarter turn toward the centre sweeps through north, and the dancer stops THERE
 * rather than ending 60 degrees past it on a bearing no later call can read.
 *
 * THE CAP CANNOT OVERSHOOT THE QUARTER TURN, which is CALLERLAB's own sentence and is pinned on the
 * `Completed Double Pass Thru` by `sequencer.mjs`: the stop is the first grid facing STRICTLY inside a
 * sweep of at most 90 degrees, so the turn is always <= 90 and the end is always grid-aligned.
 */
export function faceInOutStates(
  dancers: DancerState[],
  towardCentre: boolean,
): DancerState[] {
  const cx = dancers.reduce((a, d) => a + d.x, 0) / dancers.length;
  const cy = dancers.reduce((a, d) => a + d.y, 0) / dancers.length;
  return dancers.map((d) => {
    const toCentre = Math.atan2(cy - d.y, cx - d.x);
    const signed = normAngle(toCentre - d.heading);
    const left = signed >= 0;
    const turn = QUARTER * ((towardCentre ? left : !left) ? 1 : -1);
    // AT MOST ONE 90-degree facing lies strictly inside a sweep this short, so the loop order does not
    // matter and `firstGridFacing` is a search rather than a comparison of candidates.
    //
    // THE TURN IS COMPUTED FROM THE SNAPPED FACING, and the SENSE is still decided by the dancer's REAL
    // heading and the real bearing to the centre (`signed` above), so the direction is bit-for-bit what it
    // was - only the facing the sweep starts from changes, and only when it was a residue off the grid.
    const from = snapToGrid(d.heading);
    return { x: d.x, y: d.y, heading: normAngle(firstGridFacing(from, turn) ?? from + turn) };
  });
}

/**
 * The first multiple of 90 degrees reached by sweeping `turn` from `from`, or null when the sweep
 * reaches the end without crossing one - which is every dancer that starts ON the grid.
 *
 * STRICTLY INSIDE, so a dancer already facing a grid direction does not "stop" where it stands: the
 * start is excluded, and the end of a quarter turn from a grid facing is a grid facing too, so it is
 * excluded as well and the full turn is taken. That is what keeps this invisible on a squared set, a
 * line and a column, and it is the whole reason the cap could be added without touching them.
 *
 * `from` IS THE SNAPPED FACING, not the raw heading - see `GRID_SNAP_EPS` and `snapToGrid`. The
 * strictness here stays exact (`1e-9`) because the residue that used to break it is removed before it
 * arrives: a heading a fraction of a degree off the grid is the grid by the time this is called, so the
 * "already on the grid" case above covers it.
 */
function firstGridFacing(from: number, turn: number): number | null {
  const dir = Math.sign(turn);
  if (dir === 0) return null;
  const limit = Math.abs(turn);
  const lo = Math.floor(from / QUARTER) - 1;
  const hi = Math.ceil((from + turn) / QUARTER) + 1;
  for (let k = lo; k <= hi; k++) {
    const ahead = dir * normAngle(k * QUARTER - from);
    if (ahead > EXACT_TOL && ahead < limit - EXACT_TOL) return normAngle(k * QUARTER);
  }
  return null;
}

// ------------------------------------------------------------------ board apply

/** A minimal dancer on a board (the fields moves.ts needs). */
export interface MoveDancer {
  id: number;
  x: number;
  y: number;
  heading: number;
  /** Direction this dancer last turned, for calls that depend on it ("and Roll"). Optional
   * because a bare MoveDancer need not carry sequencer metadata. */
  lastTurnDir?: 'left' | 'right';
}

/**
 * Apply `move` to the dancers whose ids are in `ids` (or all if `ids` is null),
 * returning a NEW board with those dancers' end states. Non-selected dancers are
 * left untouched. `board.dancers` entries must carry id/x/y/heading at least.
 *
 * The remembered turn direction is recorded here too. The CATALOG path records it
 * (`applicator.ts`), but a coded pivot goes straight through this function, so `Face Left` and
 * `U-Turn Back` used to leave the metadata UNSET - measured, and a call that depends on it
 * therefore had nothing to read after a pivot. `turn` is documented as "+ = left / CCW", and a
 * 180-degree move has no direction from the delta alone, so the previous value is kept there.
 */
export function applyMoveToBoard<B extends { dancers: MoveDancer[] }>(
  board: B,
  move: Move,
  ids?: number[] | null,
): B {
  const want = ids ? new Set(ids) : null;
  const dancers = board.dancers.map((d) => {
    if (want && !want.has(d.id)) return d;
    const e = applyMoveToState(d, move);
    let turnDir = d.lastTurnDir;
    if (Math.abs(Math.abs(move.turn) - PI) > 1e-3) {
      if (move.turn > 1e-6) turnDir = 'left';
      else if (move.turn < -1e-6) turnDir = 'right';
    }
    return { ...d, x: e.x, y: e.y, heading: e.heading, lastTurnDir: turnDir };
  });
  return { ...board, dancers };
}

/**
 * Apply a per-dancer facing adjustment toward/away the set centre (Face In/Out)
 * to the dancers in `ids`. Returns a new board.
 */
export function applyFaceInOutToBoard<B extends { dancers: MoveDancer[] }>(
  board: B,
  towardCentre: boolean,
  ids?: number[] | null,
): B {
  const want = ids ? new Set(ids) : null;
  const targets = want ? board.dancers.filter((d) => want.has(d.id)) : board.dancers;
  const ends = faceInOutStates(targets, towardCentre);
  const byId = new Map(targets.map((d, i) => [d.id, ends[i]]));
  const dancers = board.dancers.map((d) => {
    const e = byId.get(d.id);
    return e ? { ...d, heading: e.heading } : d;
  });
  return { ...board, dancers };
}
