// THE PLAYER'S LEVEL: the row that says which level is theirs, and the rule that moves it up.
//
// WHY THIS IS ITS OWN MODULE. `drill-regime.ts` next door is PURE — it owns "which drill is the next one" and
// "what advancing means" over plain data, with no store, which is what makes those rules measurable — and this
// needs three reads and a conditioned write. It is not in `handlers/drill.ts` either, because the level is not a
// fact about that endpoint: `/drill/current` is where it is read today, and the 10x10 block reads the same level
// off the same answer.
//
// THE PROMOTION IS EVALUATED WHERE THE LEVEL IS READ, NOT WHERE A DRILL IS FINISHED, and that is a decision with
// a failure mode behind it rather than a preference. A drill is finished on TWO paths — `POST /drill/advance` and
// `POST /runs`, which finishes the drill itself — so a promotion written on either is a SECOND row, and a lost
// write leaves the drill finished and the promotion unwritten. A player whose block is full has no next drill to
// finish, so nothing on the finish side would ever retry it: they would sit on a complete level forever, which is
// the worst outcome the rule has. Evaluating it on the READ makes the level DERIVED rather than recorded — every
// request recomputes it from the same `finished` set the block draws — so a lost write heals on the next request,
// and there is exactly one place for the rule to be wrong.
//
// AND IT REFUSES RATHER THAN GUESSING, like every other row in this package: a ladder row this build cannot read
// is a schema change or corruption, and reading it as level 1 would silently restart a player's ladder.
import { LEVEL_SIZE } from 'dancing-squared-game';
import { ladderKey, progressKey, scheduleKey } from './keys.ts';
import { asProgress } from './progress-row.ts';
import { levelComplete } from './drill-regime.ts';
import { MAX_WRITE_ATTEMPTS, type ApiResult, type Deps, type StoredItem } from './ports.ts';
import { failure, STATUS } from './status.ts';

/** The level every player starts on. A level is the unit of progress (DESIGN.md §15 Q17), so there is no level 0. */
export const FIRST_LEVEL = 1;

/** The stored form of a ladder row. One field, because there is exactly one fact in it. */
export function asLadderItem(levelIndex: number): Record<string, unknown> {
  return { levelIndex };
}

/**
 * The level a stored row names, or null when the row is not one this build can read.
 *
 * AN ABSENT ROW IS THE FIRST LEVEL, and it is the only row that reads as something it is not. A player who has
 * never been promoted has no row; writing one on their first read would turn every read of a new player into a
 * compare-and-set race to record a fact that is already known.
 */
export function asLadderLevel(stored: StoredItem | null): number | null {
  if (!stored) return FIRST_LEVEL;
  const value = stored.value as { levelIndex?: unknown };
  if (typeof value.levelIndex !== 'number' || !Number.isInteger(value.levelIndex) || value.levelIndex < FIRST_LEVEL) return null;
  return value.levelIndex;
}

/**
 * The level this player is on, with a FULL BLOCK already promoted past.
 *
 * THE NEXT LEVEL MUST BE SERVABLE BEFORE THE PROMOTION IS WRITTEN. Without that check a player who finished the
 * top published level would be moved to a level with no regime and answered `404 no_schedule` — for good, since
 * nothing moves them back. With it, the level stays complete and the next request promotes them the moment the
 * operator publishes `level + 1`, which is the same self-healing the rule gets from being derived.
 *
 * A LOST RACE ON THE PROMOTION IS RETRIED, NOT SURFACED: another request moving the same player forward is not an
 * error, and a row already at or past the next level is the winner's answer rather than a conflict. Only a writer
 * that keeps losing for `MAX_WRITE_ATTEMPTS` is reported, exactly as the progress row is.
 */
export async function servableLevel(deps: Deps, playerId: string): Promise<{ levelIndex: number } | { refusal: ApiResult }> {
  const key = ladderKey(playerId);
  const level = asLadderLevel(await deps.store.get(key));
  if (level === null) {
    return { refusal: failure(STATUS.unavailable, 'unreadable_ladder', `the ladder row for ${key.pk} is not a record this build can read`) };
  }
  const at = progressKey(playerId, level);
  const progress = asProgress(await deps.store.get(at), level);
  if (progress === null) {
    return { refusal: failure(STATUS.unavailable, 'unreadable_progress', `the progress row for ${at.pk} is not a record this build can read`) };
  }
  if (!levelComplete(progress, LEVEL_SIZE)) return { levelIndex: level };
  const next = level + 1;
  if (!(await deps.store.get(scheduleKey(next)))) return { levelIndex: level };

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const current = await deps.store.get(key);
    const read = asLadderLevel(current);
    if (read === null) {
      return { refusal: failure(STATUS.unavailable, 'unreadable_ladder', `the ladder row for ${key.pk} is not a record this build can read`) };
    }
    if (read >= next) return { levelIndex: read };
    if (await deps.store.put(key, asLadderItem(next), current?.rev ?? null)) return { levelIndex: next };
  }
  return { refusal: failure(STATUS.conflict, 'contended', "another request is moving this player's level; try again") };
}
