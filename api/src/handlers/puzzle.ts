// `GET /puzzle?mode=daily&level&date` — the published challenge, as a READ.
//
// DESIGN.md 11 puts this endpoint's whole point in one clause: "a read of the published artefact, not a
// generation per request". So it returns the stored seed and level and does NOT generate: the client derives the
// board from the seed with the same generator the server used (§9), and the seed is the thing that makes
// everyone's challenge the same. That is also why it is fast — no applier is touched on this path, where
// `POST /runs` regenerates for verification and pays for it.
//
// A DAY NOBODY PUBLISHED IS THE BOUNDARY JOB'S ABSENCE, and it is reported as such rather than answered with a
// freshly derived seed: a server that invented one on demand would serve a challenge that was never validated
// (§7.2), and the two sides would disagree about it the moment the pool moved. `npm run api:publish-daily` is
// the fix, and the refusal names the day.
import { MAIN_POOL } from 'dancing-squared-game';
import type { ApiRequest, ApiResult, Deps } from '../ports.ts';
import { publishedDailyKey } from '../keys.ts';
import { failure, identity, STATUS } from '../status.ts';
import { dayParam, levelParam } from '../query.ts';

/** The one mode this endpoint serves, named so the refusal can say what was asked for instead. */
const MODE = 'daily';

export async function getPuzzle(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = identity(request, deps);
  if ('refusal' in who) return who.refusal;

  const mode = request.query['mode'] ?? MODE;
  if (mode !== MODE) return failure(STATUS.badRequest, 'bad_mode', `this endpoint serves mode=${MODE}, and ${JSON.stringify(mode)} was asked for`);
  const levelIndex = levelParam(request.query['level']);
  if (levelIndex === null) return failure(STATUS.badRequest, 'bad_level', 'level must be a positive integer');
  const day = dayParam(request.query['date']);
  if (day === null) return failure(STATUS.badRequest, 'bad_date', 'date must be a real UTC day, as YYYY-MM-DD');

  const stored = await deps.store.get(publishedDailyKey(levelIndex, day));
  if (!stored) return failure(STATUS.notFound, 'no_published_daily', `level ${levelIndex} has no published challenge for ${day}`);
  const value = stored.value as { seed?: unknown; levelIndex?: unknown; poolVersion?: unknown; publishedAtMs?: unknown };
  if (typeof value.seed !== 'number' || typeof value.levelIndex !== 'number' || typeof value.poolVersion !== 'string') {
    return failure(STATUS.unavailable, 'unreadable_daily', `the published challenge for ${day} is not a record this build can read`);
  }
  // A POOL THIS BUILD DOES NOT HAVE CANNOT BE PLAYED, and saying so here is cheaper than letting the client
  // generate a board the server would then refuse to score (`stale_pool`). It is the same rule as §7.2's: a
  // seed is only meaningful against the pool it was validated at.
  const playable = value.poolVersion === MAIN_POOL.version;
  return {
    status: STATUS.ok,
    body: {
      daily: {
        day,
        levelIndex: value.levelIndex,
        seed: value.seed,
        poolVersion: value.poolVersion,
        publishedAtMs: typeof value.publishedAtMs === 'number' ? value.publishedAtMs : null,
        playable,
      },
    },
  };
}
