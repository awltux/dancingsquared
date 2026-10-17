// The issued drill, as the two endpoints that need it must see it (POST /runs and POST /drill/answer).
//
// WHY IT IS ITS OWN MODULE. Both endpoints begin with the same four questions — is there a Progress row, does it
// hold a drill, is it THE drill this request names, and can this build regenerate it — and a second copy of that
// preflight is how one endpoint comes to accept a drill the other refuses. The pool check lives here for the
// reason §7.2 gives: a seed is only meaningful against the pool it was validated at, so a drill from another pool
// cannot be re-derived and neither endpoint may pretend otherwise.
import { MAIN_POOL } from 'dancing-squared-game';
import type { ApiResult, Deps } from './ports.ts';
import { progressKey } from './keys.ts';
import { asProgress } from './progress-row.ts';
import { levelAt, puzzleFor } from './levels.ts';
import { failure, STATUS } from './status.ts';
import type { DrillProgress, IssuedDrill } from './drill-regime.ts';
import type { Puzzle } from 'dancing-squared-game';

/** The drill a request is about, with everything the server had to check to believe in it. */
export interface Issued {
  readonly issued: IssuedDrill;
  /** The Progress row as read, and the revision a later transaction must still find. */
  readonly progress: DrillProgress;
  readonly progressRev: number | null;
  /** The puzzle, regenerated from the ISSUED seed — the source of every correct answer. */
  readonly puzzle: Puzzle;
}

/**
 * The drill this player has in flight, or the refusal to return.
 *
 * THE ORDER OF THE CHECKS IS THE ORDER OF THE ANSWERS A CLIENT NEEDS. An unreadable row is an operator finding
 * (503); a drill that is not the one in flight is the player being out of date (409 `stale_drill`); a pool this
 * build does not serve is a deployment that has moved under the player (409 `stale_pool`). All three are checked
 * before the puzzle is regenerated, because regenerating is the expensive part (~0.2-1.2 s at these levels) and
 * none of the three needs it.
 */
export async function readIssuedDrill(
  deps: Deps,
  playerId: string,
  levelIndex: number,
  drillId: string,
): Promise<{ issued: Issued } | { refusal: ApiResult }> {
  const key = progressKey(playerId, levelIndex);
  const stored = await deps.store.get(key);
  const progress = asProgress(stored, levelIndex);
  if (!progress) return { refusal: failure(STATUS.unavailable, 'unreadable_progress', `the progress row for ${key.pk} is not a record this build can read`) };

  const issued = progress.issued;
  if (!issued || issued.id !== drillId) {
    return { refusal: failure(STATUS.conflict, 'stale_drill', `the drill in flight is ${issued?.id ?? 'nothing'}, not ${drillId}`) };
  }
  if (issued.poolVersion !== MAIN_POOL.version) {
    return { refusal: failure(STATUS.conflict, 'stale_pool', `drill ${issued.id} was issued against pool ${issued.poolVersion}, and this build serves ${MAIN_POOL.version}`) };
  }
  const generated = puzzleFor(issued.seed, levelAt(levelIndex), 'drill');
  if (!generated.ok) return { refusal: failure(STATUS.unavailable, 'unplayable_drill', `the issued drill does not generate: ${generated.reason}`) };

  return { issued: { issued, progress, progressRev: stored?.rev ?? null, puzzle: generated.puzzle } };
}
