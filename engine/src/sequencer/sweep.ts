// `Sweep a Quarter` as a GEOMETRY-DERIVED call.
//
// WHY DERIVED. The call is not in the catalogue at all (`hasCall('Sweep 1/4')` is false and it is not
// in `CALL_SYNONYMS`), so every one of its uses refused with `Unknown call` - five figures in the
// census, plus three more reached through a `Centers`/`Heads` selection. CALLERLAB (Mainstream
// definitions, p.57):
//
//   > **Sweep a Quarter** is a *suffix call*, which means that its action depends on the preceding
//   > call. Starting formation: **Facing Couples only**. Dance action: **Circle Right or Left 1/4**,
//   > except that each Couple does not join hands with the Couple they are facing. **The circling
//   > direction continues the motion that completed the previous call.** Ending formation: Facing
//   > Couples. Timing: 2. Styling: Dancers use a Couple handhold.
//   > Comments: "When the previous call ends, each dancer's motion around the center of the forming
//   > Facing Couples must be the same (either clockwise or counter-clockwise). Sweep a Quarter is
//   > improper after Chain Down the Line ... Similarly, it is improper to call Sweep a Quarter after
//   > Bend the Line, Wheel Around, Cast Off 3/4, etc. **From a Wave, Recycle and Sweep a Quarter is
//   > proper.** This is an exception made because of years of use."
//
// So the rule is: each facing-couple BOX rotates a quarter turn about its OWN centre, in the direction
// the previous call's motion already had, and the ending is Facing Couples again - which is why the
// FACINGS rotate with the positions rather than being left behind.
//
// THE DIRECTION IS READ PER BOX, and that was measured before the rule was written. `lastTurnDir` is
// recorded per dancer, and re-running the eight corpus cases with each board decomposed showed a
// consensus in six of them (`figm21`/`figm150` after `Wheel and Deal`: all right; `figm63`/`figm64`
// after `Ferris Wheel`: all right; `figm26`/`figm139` after `Flutterwheel`: 8 of 8 left) and NO
// consensus in two (`figm18` is 3 left / 1 right, and `figm187` has dancers with no remembered
// direction at all). CALLERLAB's own comment says exactly why a box can be mixed - `Flutterwheel`
// turns the two dancers of a couple in opposite senses about the COUPLE's centre - so a box with no
// consensus is REFUSED with its reason rather than approximated.
//
// THE TILING IS NOT DONE HERE. Which four dancers form a box comes from the engine's own matcher
// (`CallApplicator.boxGroups`), because ad-hoc geometry does not decide it: `figm21` and `figm150`
// are the same chain with the same preceding call and their boards tile differently, and `figm150`
// does not tile into facing-couple boxes at all.

import { normAngle } from '../moves.js';
import type { Board } from './types.js';

type D = Board['dancers'][number];

const physical = (board: Board): D[] => board.dancers.filter((d) => !d.isGhost);

/** Why a BOX cannot Sweep, or null when it can. */
export function sweepProblem(box: Board): string | null {
  const phys = physical(box);
  if (phys.length !== 4) return `Sweep a Quarter acts on a box of four dancers, and this box has ${phys.length}`;
  const dirs = new Set(phys.map((d) => d.lastTurnDir ?? null));
  if (dirs.has(null)) {
    return 'Sweep a Quarter continues the motion that completed the previous call, and not every dancer in this box has one';
  }
  if (dirs.size !== 1) {
    return 'Sweep a Quarter needs the whole box to have turned the same way, and this box is mixed (CALLERLAB: "each dancer\'s motion around the center of the forming Facing Couples must be the same")';
  }
  return null;
}

/** The sweep itself: the box rotates a quarter turn about its own centre, positions and facings
 * together. `lastTurnDir` is "+ = left / CCW" in this engine (`moves.ts`), and "Circle Left 1/4"
 * continues motion that was already counter-clockwise. */
export function sweepBox(box: Board): Board {
  const phys = physical(box);
  const turn = phys[0].lastTurnDir === 'left' ? Math.PI / 2 : -Math.PI / 2;
  const cx = phys.reduce((s, d) => s + d.x, 0) / phys.length;
  const cy = phys.reduce((s, d) => s + d.y, 0) / phys.length;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return {
    dancers: box.dancers.map((d) => {
      if (d.isGhost) return d;
      const dx = d.x - cx;
      const dy = d.y - cy;
      return {
        ...d,
        x: cx + dx * c - dy * s,
        y: cy + dx * s + dy * c,
        heading: normAngle(d.heading + turn),
      };
    }),
  };
}

/** How close two dancers may end before the swept board counts as broken. The engine's formations put
 * adjacent dancers 2 apart, so this sits in the empty band below that. */
export const SWEEP_COLLISION_MIN = 1.0;

/**
 * Why the SWEPT board is not a board, or null when it is: a box 2 wide and 4 tall rotating 90 degrees
 * about its own centre becomes 4 wide and 2 tall, so when boxes stand side by side along the rotation
 * axis their sweeps OVERLAP. That is a property of the geometry, not of the tiling, and it is the
 * reason a board of facing LINES cannot Sweep at all.
 *
 * MEASURED, and this postcondition exists because the trap was walked into: reading CALLERLAB's
 * temporary couple number inside `boxGroups` unblocked the tiling of `figm` #17/#120 (a `Normal Lines`
 * board whose stored couples straddle the boxes), let the Sweep apply, and the result had four dancers
 * on two spots — the figures then refused on `Promenade` from an UNNAMED board, with the figure count
 * unchanged. The refusal was right; only its reason was wrong. This check states the real reason at
 * the call that causes it, so a future tiling change cannot launder the collision.
 *
 * CALLERLAB's handhold test is the other half of the same idea and is checked per box in
 * `sweepProblem`; this one can only be asked of the WHOLE board, because it is about neighbouring
 * boxes.
 */
export function sweepCollision(board: Board): string | null {
  const phys = physical(board);
  for (let i = 0; i < phys.length; i++) {
    for (let j = i + 1; j < phys.length; j++) {
      const gap = Math.hypot(phys[i].x - phys[j].x, phys[i].y - phys[j].y);
      if (gap < SWEEP_COLLISION_MIN) {
        return `Sweep a Quarter would put dancers ${phys[i].id} and ${phys[j].id} ${gap.toFixed(2)} apart - this board's boxes stand too close for each to rotate a quarter about its own centre`;
      }
    }
  }
  return null;
}
