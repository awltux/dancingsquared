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
export const FaceEighthLeft = mv('Face 1/8 Left', 0, 0, +PI / 4, 0.75);
export const FaceEighthRight = mv('Face 1/8 Right', 0, 0, -PI / 4, 0.75);
export const FaceEighthOfThreeLeft = mv('Face 3/8 Left', 0, 0, +3 * PI / 4, 2.25);
export const FaceEighthOfThreeRight = mv('Face 3/8 Right', 0, 0, -3 * PI / 4, 2.25);

// ------------------------------------------------------------------ turns

/** U-turn left (180° CCW about own position). */
export const UTurnLeft = FaceHalf;
/** U-turn right (180° CW about own position) — geometrically identical to a
 * U-turn left for a pure 180° pivot, kept for caller/taminations parity. */
export const UTurnRight = mv('U-Turn Right', 0, 0, -PI, 3);

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

/**
 * Turn each of the given dancers to face the set centre (Face In) or away from
 * it (Face Out). Which way each dancer turns depends on its angle about the
 * centre, so the moves are not fixed matrices — computed per dancer. Returns a
 * list of per-dancer end states (in the same order as `dancers`).
 */
export function faceInOutStates(
  dancers: DancerState[],
  towardCentre: boolean,
): DancerState[] {
  const cx = dancers.reduce((a, d) => a + d.x, 0) / dancers.length;
  const cy = dancers.reduce((a, d) => a + d.y, 0) / dancers.length;
  return dancers.map((d) => {
    const target = Math.atan2(cy - d.y, cx - d.x) + (towardCentre ? 0 : PI);
    const turn = normAngle(target - d.heading);
    // Normalise the turn to the shorter direction (-PI, PI].
    return { x: d.x, y: d.y, heading: normAngle(d.heading + turn) };
  });
}

// ------------------------------------------------------------------ board apply

/** A minimal dancer on a board (the fields moves.ts needs). */
export interface MoveDancer {
  id: number;
  x: number;
  y: number;
  heading: number;
}

/**
 * Apply `move` to the dancers whose ids are in `ids` (or all if `ids` is null),
 * returning a NEW board with those dancers' end states. Non-selected dancers are
 * left untouched. `board.dancers` entries must carry id/x/y/heading at least.
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
    return { ...d, x: e.x, y: e.y, heading: e.heading };
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
