// THE FULL POSE OF A BOARD, as a string — one identity for "the picture the player is shown".
//
// WHY IT IS NOT `boardSig`. `boardSig` is the engine's cheap, order-free, POSITIONS-ONLY key, and AGENTS.md §8 trap 11
// records what that costs when it is used as an identity: a board that differs only in FACING returns the same
// signature, so a caller that files two boards under it treats them as one. The applier's caches learned that the hard
// way (they were serving one board's list for another); the generator learned it a second time, as DUPLICATE DRILLS —
// MEASURED, the named goal boards reachable in one call from a level-1 start are 1…17 per start, and by `boardSig`
// they collapse to 1…6, so 500 seeds produced 33 distinct (start, goal) pictures with the commonest one repeated 34
// times.
//
// WHY IT IS NOT `arrangementKey` EITHER. That key is the engine's congruence — positions and headings quotiented by
// the eight rotations and both reflections — which is the right unit for a WAYPOINT and the wrong one here: a board
// rotated a quarter turn is the same formation and a different picture, and a puzzle's goal is a picture.
//
// IT CARRIES THE IDENTITY FIELDS AS WELL AS THE GEOMETRY, because `sameBoardById` — the game's only board equality —
// compares identity too: two boards with the same geometry and different dancer ids are the same picture and are NOT
// the same board.
//
// THE FORMAT IS NOT A CONTRACT: nothing parses it back. It exists to be compared, and the caller that needs a stable
// file format should use the engine's keys instead.
import type { Board } from 'dancing-squared-engine';

/** Every dancer's identity, couple, gender, position and heading, exactly as they are. */
export function poseKey(board: Board): string {
  let key = '';
  for (const d of board.dancers) key += `${d.id},${d.couple},${d.gender},${d.x},${d.y},${d.heading};`;
  return key;
}
