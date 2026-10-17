// `GET /puzzle?mode=daily&level&date` — the published challenge, as a READ.
//
// THE READ NOW CARRIES THE PUZZLE, and that is the reversal DESIGN.md §9 records: a puzzle was derivable from
// `(seed, level, poolVersion)`, so the serving layer answered with the seed and the client drew the board. The
// client no longer generates anything, so the seed alone is not playable — this endpoint generates the puzzle the
// seed names (through `puzzleFor`'s cache, so a re-read is a `Map` lookup) and answers with it.
//
// WHAT IS STILL STORED IS THE SEED, NOT THE PUZZLE, and the difference is deliberate: `POST /runs` re-derives the
// puzzle from the seed to verify a submission, so a stored board would be a second copy that a corrupt or edited
// row could disagree with. One derivation, used by every reader, is the stronger property.
//
// A DAY NOBODY PUBLISHED IS THE BOUNDARY JOB'S ABSENCE, and it is reported as such rather than answered with a
// freshly derived seed: a server that invented one on demand would serve a challenge that was never validated
// (§7.2), and the two sides would disagree about it the moment the pool moved. `npm run api:publish-daily` is
// the fix, and the refusal names the day.
import { MAIN_POOL, type Puzzle } from 'dancing-squared-game';
import type { ApiRequest, ApiResult, Deps } from '../ports.ts';
import { attemptKey, publishedDailyKey } from '../keys.ts';
import { failure, optionalIdentity, STATUS } from '../status.ts';
import { dayParam, levelParam } from '../query.ts';
import { asAttempt, asAttemptItem, startAttempt } from '../attempt-row.ts';
import { levelAt, puzzleFor, startReadings } from '../levels.ts';

/** The one mode this endpoint serves, named so the refusal can say what was asked for instead. */
const MODE = 'daily';

/**
 * The published challenge for a level and a day.
 *
 * NO IDENTITY IS REQUIRED, AND NONE IS NEEDED TO READ IT. The answer is the published artefact itself: the same
 * seed, level and pool version for every caller, signed in or not, so there is nothing here for an identity to
 * decide — the version of this handler before §11.1 asked for one anyway and answered a signed-out browser `401`
 * to a request that never mentioned the player. That is exactly what §11.2's demo is for: the funnel is "try it
 * read-only, then sign in to be ranked", and a read is already unranked.
 *
 * AN IDENTIFIED READ DOES ONE MORE THING, AND IT IS WHY THIS HANDLER WRITES AT ALL: it records WHEN this player
 * first looked at this challenge (`attempt-row.ts`). That stamp is the Daily's clock — a run submitted later is
 * scored on `submittedAt − lookedAt`, both of them the server's own facts — and there is no other moment to take
 * it from, because the seed is public and a client can derive the board without ever asking. A SIGNED-OUT read
 * records nothing, and the answer is the same bytes either way.
 */
export async function getPuzzle(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const identity = optionalIdentity(request, deps);
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

  // ONLY A PLAYABLE CHALLENGE HAS A PUZZLE THIS BUILD CAN DRAW, and generating a foreign seed's puzzle here would
  // hand the client a board the server would refuse to score — the worst of the three answers, because it looks
  // playable. `puzzle: null` beside `playable: false` says exactly what is true.
  let puzzle: Puzzle | null = null;
  let readings: ReturnType<typeof startReadings> = [];
  if (playable) {
    // THE ROW'S LEVEL, not the query's, because the row's is what the answer reports and the seed was validated
    // against it. A disagreeing row is a corrupt row, and generating at the query's level would publish a puzzle
    // under a level number it was not generated at — the §7.2 rule the drill's schedule lint exists to enforce.
    const dailyLevel = levelAt(value.levelIndex);
    const generated = puzzleFor(value.seed, dailyLevel, 'daily');
    if (!generated.ok) {
      return failure(STATUS.unavailable, 'unplayable_daily', `the published challenge for ${day} does not generate: ${generated.reason}`);
    }
    puzzle = generated.puzzle;
    // THE START BOARD'S GROUPED LIST, so the picker draws without the client paying `applicableMoves` first. It is a
    // pure function of the board and the level's pool, and the applier is already warm from the generation.
    readings = startReadings(generated.puzzle, dailyLevel);
  }

  if (identity) {
    const stamped = await stampAttempt(deps, identity.playerId, levelIndex, day);
    if ('refusal' in stamped) return stamped.refusal;
  }

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
        puzzle,
        readings,
      },
    },
  };
}

/**
 * Record that this player has looked at this challenge, ONCE.
 *
 * A LOST RACE IS NOT AN ERROR HERE, and that is not a shortcut: two reads arriving together both want the same
 * row, the condition is create-only, and the loser's state — "the row is already there" — is exactly the state it
 * wanted. The stamp that survives is the FIRST one, which is the whole point (A21: a re-read must not refresh the
 * clock). A row that is PRESENT AND UNREADABLE is refused instead, because scoring a run against a stamp nobody
 * can parse is worse than saying the row is broken.
 */
async function stampAttempt(deps: Deps, playerId: string, levelIndex: number, day: string): Promise<{ ok: true } | { refusal: ApiResult }> {
  const key = attemptKey(playerId, 'daily', `${levelIndex}#${day}`);
  const stored = await deps.store.get(key);
  if (stored) {
    if (!asAttempt(stored)) return { refusal: failure(STATUS.unavailable, 'unreadable_attempt', `the attempt row for ${key.pk}/${key.sk} is not a record this build can read`) };
    return { ok: true };
  }
  const { attempt } = startAttempt(null, deps.clock.nowMs());
  await deps.store.put(key, asAttemptItem(attempt), null);
  return { ok: true };
}
