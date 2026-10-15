// A board's poses: the ONE way the renderer gets from a board to what it draws.
//
// WHY THIS SURVIVES THE TWEEN IT REPLACED. `game/tween.ts` existed to walk a dancer in a straight line from
// one board to the next, because a `PuzzleStep` carries only the boards each option ENDS on. Phase 3 replaced
// that with the engine's own walk (`GameApplier.motion`), so the interpolation, the short-arc heading
// correction and the easing are all gone — they were the engine's job and the engine already did it. What is
// left is the part no engine call does: turning a BOARD into the pose list `DancerView.update` takes.
//
// TWO PROPERTIES, AND BOTH ARE LOAD-BEARING:
//
// 1. ONE POSE PER DANCER, IN THE BOARD'S OWN ARRAY ORDER. That is the binding the renderer holds — its
//    `DancerView` for index `i` was built from `board.dancers[i]`, and `BoardView` rebuilds the whole set
//    when the id list changes. A pose list in any other order puts a correct set in the wrong places, which
//    is the failure `reorderLike` exists to prevent in the engine.
//
// 2. `hands: 'both'`. A board carries no grip state — a pair of boards says where everyone stands and
//    nothing about who is holding whom — so this is the honest statement that the HOLD is derived from
//    geometry rather than authored: `computeHandholds(poses, 'static')` gives every dancer both hands and
//    finds the pairs that mutually reach, which is what draws a ring or a line joined up. It is the same
//    choice the POC's sequence panel makes when it poses an evaluated board (`renderBoard` in
//    `poc/src/sequencer-ui.ts`), and it is the reason a Drill's replay shows holds at all: the authored
//    per-segment grip is not reachable from a board, and is the one thing a future `sequenceInfo`-based
//    motion could add.
import type { Board, Hands, Pose } from 'dancing-squared-engine';

const BOTH_HANDS: Hands = 'both';

/**
 * The poses of `board` as it stands.
 *
 * USED FOR A RESTING BOARD AND FOR EVERY FRAME OF A SAMPLED MOTION, because those are the same thing: a
 * frame of the engine's walk IS a board, and the whole point of sampling it per beat is that no interpolation
 * happens here at all.
 */
export function stillBoard(board: Board): Pose[] {
  return board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, hands: BOTH_HANDS }));
}
