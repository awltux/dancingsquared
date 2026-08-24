// Per-dancer affine matrix model for calls.
//
// A dancer's state is v = (x, y, cosθ, sinθ, 1). A call start->end is an EXACT
// affine map on v per dancer: position by a rotation+translation, heading by the
// same rotation on (cosθ, sinθ). This module provides the 5x5 matrix primitives
// plus helpers to build per-dancer matrices from a start/end board, detect rigid
// calls (a single global rotation+translation fits all dancers), invert, and
// compose. It is the shared foundation for:
//   - a rigid-call M^-1 getout fast-path in the sequencer,
//   - an algebraically-filled formation-transition table,
//   - per-dancer matrix end-pose computation in applyToBoard.
//
// All matrices are ROW-vector conventions: applyM(M, v) treats v as a column
// vector, so M[v] = M·v.

export type Mat5 = number[][]; // 5x5

/** Identity 5x5 matrix. */
export function identity5(): Mat5 {
  const M: Mat5 = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (let i = 0; i < 5; i++) M[i][i] = 1;
  return M;
}

/** Matrix product A·B (5x5). */
export function mul5(A: Mat5, B: Mat5): Mat5 {
  const C: Mat5 = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++) {
      let s = 0;
      for (let k = 0; k < 5; k++) s += A[i][k] * B[k][j];
      C[i][j] = s;
    }
  return C;
}

/** Apply a 5x5 matrix to a 5-vector (column). */
export function apply5(M: Mat5, v: number[]): number[] {
  const out = Array(5).fill(0);
  for (let i = 0; i < 5; i++) {
    let s = 0;
    for (let k = 0; k < 5; k++) s += M[i][k] * v[k];
    out[i] = s;
  }
  return out;
}

/** 5x5 matrix inverse via Gauss-Jordan. Returns null if singular. */
export function invert5(M: Mat5): Mat5 | null {
  const n = 5;
  const a: number[][] = M.map((r) => [...r]);
  const inv: number[][] = identity5().map((r) => [...r]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [inv[col], inv[pivot]] = [inv[pivot], inv[col]];
    }
    const d = a[col][col];
    for (let j = 0; j < n; j++) {
      a[col][j] /= d;
      inv[col][j] /= d;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        a[r][j] -= f * a[col][j];
        inv[r][j] -= f * inv[col][j];
      }
    }
  }
  return inv;
}

/** Dancer state vector from a pose. */
export function poseToVec(x: number, y: number, heading: number): number[] {
  return [x, y, Math.cos(heading), Math.sin(heading), 1];
}

/** Build the per-dancer affine matrix that maps (sx,sy,sth) -> (ex,ey,eth).
 * Position: rotate+translate; heading: same rotation on (cos,sin). */
export function dancerMatrix(sx: number, sy: number, sth: number, ex: number, ey: number, eth: number): Mat5 {
  const d = eth - sth;
  const c = Math.cos(d);
  const s = Math.sin(d);
  const M = identity5();
  M[0][0] = c;
  M[0][1] = -s;
  M[0][4] = ex - (c * sx - s * sy);
  M[1][0] = s;
  M[1][1] = c;
  M[1][4] = ey - (s * sx + c * sy);
  M[2][2] = c;
  M[2][3] = -s;
  M[3][2] = s;
  M[3][3] = c;
  return M;
}

export interface DancerState {
  x: number;
  y: number;
  heading: number;
}

/** Per-dancer matrices keyed by dancer id, computed from a start and end board. */
export function dancerMatricesById(
  start: DancerState[],
  end: DancerState[],
): { M: Map<number, Mat5>; maxError: number } {
  const sById = new Map(start.map((d, i) => [i, d]));
  const M = new Map<number, Mat5>();
  let maxError = 0;
  for (let i = 0; i < end.length; i++) {
    const s = sById.get(i)!;
    const e = end[i];
    const m = dancerMatrix(s.x, s.y, s.heading, e.x, e.y, e.heading);
    M.set(i, m);
    const v = poseToVec(s.x, s.y, s.heading);
    const out = apply5(m, v);
    const eh = Math.atan2(out[3], out[2]);
    let dh = Math.abs(eh - e.heading) % (2 * Math.PI);
    if (dh > Math.PI) dh = 2 * Math.PI - dh;
    maxError = Math.max(maxError, Math.hypot(out[0] - e.x, out[1] - e.y) + dh);
  }
  return { M, maxError };
}

export interface RigidFit {
  /** The single global rotation+translation applied to every dancer (the first
   * three rows, translation in column 4). */
  M: Mat5;
  /** Worst-case positional residual of the single-matrix fit. */
  residual: number;
}

/**
 * Fit ONE global rigid matrix (rotation+translation) to map `start` onto `end`.
 * Returns null if a single rigid transform does not explain the move (residual
 * exceeds `maxResidual`), i.e. the call is NOT rigid. For rigid calls the matrix
 * is frame-invariant and directly invertible, which the getout fast-path uses.
 */
export function fitRigidMatrix(
  start: DancerState[],
  end: DancerState[],
  maxResidual = 1e-3,
): RigidFit | null {
  const n = start.length;
  if (n === 0 || n !== end.length) return null;
  const sc = start.reduce((a, d) => [a[0] + d.x, a[1] + d.y], [0, 0]);
  const ec = end.reduce((a, d) => [a[0] + d.x, a[1] + d.y], [0, 0]);
  const sxc = sc[0] / n;
  const syc = sc[1] / n;
  const exc = ec[0] / n;
  const eyc = ec[1] / n;
  // Least-squares rotation from the centered start to the centered end (Kabsch
  // in 2D): best rotation angle = atan2(Σ cross, Σ dot).
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < n; i++) {
    dot += (start[i].x - sxc) * (end[i].x - exc) + (start[i].y - syc) * (end[i].y - eyc);
    cross += (start[i].x - sxc) * (end[i].y - eyc) - (start[i].y - syc) * (end[i].x - exc);
  }
  const theta = Math.atan2(cross, dot);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // Translation = end-center - R * start-center.
  const tx = exc - (c * sxc - s * syc);
  const ty = eyc - (s * sxc + c * syc);
  const M = identity5();
  M[0][0] = c;
  M[0][1] = -s;
  M[0][4] = tx;
  M[1][0] = s;
  M[1][1] = c;
  M[1][4] = ty;
  let residual = 0;
  for (let i = 0; i < n; i++) {
    const px = c * start[i].x - s * start[i].y + tx;
    const py = s * start[i].x + c * start[i].y + ty;
    residual = Math.max(residual, Math.hypot(px - end[i].x, py - end[i].y));
  }
  if (residual > maxResidual) return null;
  return { M, residual };
}

/** Apply a rigid (global) matrix to a single dancer pose. */
export function applyRigidToPose(M: Mat5, p: DancerState): DancerState {
  const v = poseToVec(p.x, p.y, p.heading);
  const out = apply5(M, v);
  // The heading rotation is the same θ as the position rotation block.
  const theta = Math.atan2(M[3][2], M[2][2]);
  return { x: out[0], y: out[1], heading: p.heading + theta };
}
