// THE OFFLINE SEASON, as the app reads it: the fixture entry's baked puzzle, by position.
//
// WHY THIS IS A MODULE AND NOT A LINE IN `main.ts`. The season has two halves that must agree — `LOCAL_SCHEDULE`
// (seeds, `schedule-fixture.ts`, which the API also imports for its local regimes) and `SEASON_PUZZLES` (baked
// boards, `season-data.ts`). Keeping the pairing in one small module means the app, the bake tool and the probe all
// ask the same question of the same two lists, and it is why the 133 KB of boards is NOT pulled into the API's
// import graph: `schedule-fixture.ts` stays seeds-only.
//
// THE INDEX IS THE POSITION, not the seed. The fixture reuses seeds 1..4 at every level, so a seed cannot name a
// puzzle here — the same defect AGENTS.md trap 7 records for a position into an authored list, one level up: the
// POSITION is the identity because it is what the regime serves and what the URL of a drill means.
import type { Puzzle } from '../puzzle/types.ts';
import { schedulePosition } from './schedule-fixture.ts';
import { SEASON_POOL_VERSION, SEASON_PUZZLES } from './season-data.ts';

export { SEASON_POOL_VERSION };

/** The baked puzzle the fixture serves at `position`, wrapping with the entry list. */
export function seasonPuzzleFor(position: number): Puzzle {
  return SEASON_PUZZLES[schedulePosition(position)];
}
