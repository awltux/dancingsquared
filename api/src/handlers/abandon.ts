// `POST /daily/abandon` — record that a player gave up on a challenge (DESIGN.md 11.1, A25's accounting).
//
// WHAT IT IS FOR, NOW THAT A23 IS IN. The design's original job for this endpoint was the hint an abandoned run
// owes: "an abandoned run is debited at abandonment" (§11.1 A23) — but the debit moved to the moment a hint is
// TAKEN, which is strictly better, because a hint that is never submitted can no longer be a hint nobody pays for.
// So what is left is the RECORD: without it, a challenge that was given up is indistinguishable from one that was
// never finished, and the operator's picture of "how often do players walk away, and how far in" is missing exactly
// the rows that answer it (A25's "record what you refuse" — an instrument's silence is itself a bug).
//
// IT DOES NOT REFUSE A LATER SUBMISSION, AND THAT IS DELIBERATE. The app lets a player give up and then replay both
// lines, and a rule that forbade submitting afterwards would turn a teaching feature into a lost run. The
// abandonment is a fact about the ATTEMPT; the run is a separate fact, and `POST /runs` scores it on its own terms.
//
// IT IS IDEMPOTENT: giving up twice keeps the FIRST stamp, because the interesting number is when the player
// walked away, and a second call would quietly move it.
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Deps } from '../ports.ts';
import { failure, requireIdentity, STATUS } from '../status.ts';
import { attemptKey } from '../keys.ts';
import { dayParam, levelParam } from '../query.ts';
import { asAttempt, asAttemptItem } from '../attempt-row.ts';

export async function postAbandon(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;

  const body = request.body as { levelIndex?: unknown; date?: unknown } | null;
  const levelIndex = levelParam(typeof body?.levelIndex === 'number' ? String(body.levelIndex) : undefined);
  if (levelIndex === null) return failure(STATUS.badRequest, 'bad_level', 'levelIndex must be a positive integer');
  const day = dayParam(typeof body?.date === 'string' ? body.date : undefined);
  if (day === null) return failure(STATUS.badRequest, 'bad_date', 'date must be a real UTC day, as YYYY-MM-DD');

  const key = attemptKey(playerId, 'daily', `${levelIndex}#${day}`);
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const stored = await deps.store.get(key);
    // A CHALLENGE NOBODY READ CANNOT BE ABANDONED: there is no attempt to record anything against, and inventing
    // one would put a row in the table that says a player started something they never fetched.
    if (!stored) {
      return failure(STATUS.conflict, 'no_attempt_row', `this player never read the challenge for ${day} at level ${levelIndex}, so there is nothing to abandon`);
    }
    const record = asAttempt(stored);
    if (!record) return failure(STATUS.unavailable, 'unreadable_attempt', `the attempt row for level ${levelIndex} on ${day} is not a record this build can read`);
    if (record.abandonedAtMs !== null) {
      return { status: STATUS.ok, body: { abandoned: true, abandonedAtMs: record.abandonedAtMs, hintsSpent: record.hints.length } };
    }
    const next = { ...record, abandonedAtMs: deps.clock.nowMs() };
    if (await deps.store.put(key, asAttemptItem(next), stored.rev)) {
      return { status: STATUS.ok, body: { abandoned: true, abandonedAtMs: next.abandonedAtMs, hintsSpent: record.hints.length } };
    }
  }
  return failure(STATUS.conflict, 'contended', 'another request is writing this attempt; try again');
}
