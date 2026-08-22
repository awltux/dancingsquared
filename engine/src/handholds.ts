// Geometric hand-hold solver.
//
// Hand holds are DERIVED from dancer positions + facing, following codified
// rules (from taminations' handhold.dart):
//   1. A dancer only holds when it has a hand available. Its `right` hand
//      reaches its single nearest partner on its right; its `left` hand its
//      single nearest partner on its left (one partner per hand).
//   2. A hold only exists if the two dancers MUTUALLY reach each other (i's
//      chosen target is j AND j's chosen target is i). This keeps a couple
//      holding during a Wheel and stops opposite-couple dancers grabbing each
//      other, even when they pass close.
//   3. Partners must be within reach and roughly to the side (not directly in
//      front/behind), so facing pairs about to pass through do not hold.
// `static` (resting formation) gives every dancer both hands, so a contiguous
// LINE or RING shows all dancers joined. `active` uses the movement `hands`
// state, so a Wheel keeps its grip, a Circle Left forms a ring (gripboth), and
// an Allemande reaches only its single corner.

import type { Pose } from './types.js';

export type Hand = 'left' | 'right';

export interface HoldEdge {
  i: number;
  j: number;
  hi: Hand;
  hj: Hand;
}

const TWO_PI = Math.PI * 2;
// Max angle-score for a side hold. A CIRCLE of 8 puts neighbours ~45deg off the
// "directly to the side" position, so the cutoff must be wide enough (~0.8).
// Facing pairs (partner directly in front, ~90deg off the side) score ~1.47 and
// are still excluded.
const SIDE_CUTOFF = 0.8;

const wrap = (x: number) => {
  x = x % TWO_PI;
  return x < 0 ? x + TWO_PI : x;
};

// 0 when the partner is exactly to the dancer's side; grows as the partner
// moves toward the front/back.
const sideScore = (facing: number, a0: number, phase: number) => {
  const a = wrap(facing - a0 + phase);
  const s = Math.PI / 6;
  const af1 = 0.8;
  const af2 = 1.0;
  const m = a < TWO_PI - a ? a : TWO_PI - a; // symmetric about the side
  return m > s ? (m - s) * af2 + s * af1 : m * af1;
};

const DIST_CUTOFF = 2.3;

export type HoldMode = 'static' | 'active';

function hasRight(h: Pose['hands']): boolean {
  return ['right', 'both', 'gripright', 'gripboth'].includes(h);
}
function hasLeft(h: Pose['hands']): boolean {
  return ['left', 'both', 'gripleft', 'gripboth'].includes(h);
}

// Whether a partner at angle a0 (from this dancer to the partner) is on this
// dancer's right/left side (i.e. the hand would reach it, not the front/back).
const isRightSide = (facing: number, a0: number) => sideScore(facing, a0, (3 * Math.PI) / 2) < SIDE_CUTOFF;
const isLeftSide = (facing: number, a0: number) => sideScore(facing, a0, Math.PI / 2) < SIDE_CUTOFF;

export function computeHandholds(poses: Pose[], mode: HoldMode = 'active'): HoldEdge[] {
  const n = poses.length;
  const hasRightHand = poses.map((p) => (mode === 'static' ? true : hasRight(p.hands)));
  const hasLeftHand = poses.map((p) => (mode === 'static' ? true : hasLeft(p.hands)));

  const rightTarget: (number | null)[] = new Array(n).fill(null);
  const leftTarget: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    let bestR: number | null = null;
    let bestRd = Infinity;
    let bestL: number | null = null;
    let bestLd = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = poses[j].x - poses[i].x;
      const dy = poses[j].y - poses[i].y;
      const d = Math.hypot(dx, dy);
      if (d > DIST_CUTOFF) continue;
      const a0 = Math.atan2(dy, dx);
      if (hasRightHand[i] && isRightSide(poses[i].heading, a0) && d < bestRd) {
        bestRd = d;
        bestR = j;
      }
      if (hasLeftHand[i] && isLeftSide(poses[i].heading, a0) && d < bestLd) {
        bestLd = d;
        bestL = j;
      }
    }
    rightTarget[i] = bestR;
    leftTarget[i] = bestL;
  }

  const holds: HoldEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const iReachesJ = rightTarget[i] === j || leftTarget[i] === j;
      const jReachesI = rightTarget[j] === i || leftTarget[j] === i;
      if (!iReachesJ || !jReachesI) continue;
      const hi: Hand = rightTarget[i] === j ? 'right' : 'left';
      const hj: Hand = rightTarget[j] === i ? 'right' : 'left';
      holds.push({ i, j, hi, hj });
    }
  }
  return holds;
}
