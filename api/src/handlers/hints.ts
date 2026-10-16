// `POST /me/hints` — spend a hint on today's Daily, as an EVENT (DESIGN.md 11.1, A23).
//
// WHAT IT CLOSES. A hint is a 60-second charge folded into the elapsed the score is computed from, and the spend
// used to be a field in the submission: a client could take the help and report none, keeping the time it bought.
// The review that produced §11.1 measured that family at up to 4.8x. Now the balance is debited HERE, when the hint
// is taken, and the run is charged for what was recorded — so the penalty follows from receiving the help rather
// than from what the client says afterwards.
//
// IT IS THE DAILY'S ENDPOINT BECAUSE §10 SPENDS HINTS ON THE DAILY: they are EARNED on the drill line and spent
// where the player is stuck, which is a line they are building. A hint for a Drill would hand over the answer to a
// two-option question, which is not what the hint is for.
//
// WHAT IS NOT YET THE SERVER'S: the CALL the hint names. §10's look-up runs over the BOARD the player is standing
// on, and the Daily's board is the recorded line — `POST /daily/move` is what records it, and until that lands the
// client names the call from the puzzle it was served (DESIGN.md §11.1's known limit 2: that information is
// derivable anyway, so the server naming it is a fairness feature rather than an anti-cheat one). The SPEND is the
// anti-cheat part, and that is what this endpoint owns.
//
// IT IS NOT A SCORING ENDPOINT. It debits one hint and records one event; the run's TIME CHARGE happens in
// `POST /runs`, from the recorded events, which is why a hint taken on a run that is never submitted still costs
// the player the balance — because the event is the fact.
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Deps } from '../ports.ts';
import { failure, requireIdentity, STATUS } from '../status.ts';
import { attemptKey, hintsKey } from '../keys.ts';
import { dayParam, levelParam } from '../query.ts';
import { asAttempt, asAttemptItem } from '../attempt-row.ts';
import { asHints } from '../runs.ts';

/** How many hints one challenge may spend. Three is the whole balance (§10), and the bound is the item's. */
export const MAX_HINTS_PER_ATTEMPT = 3;

/**
 * Spend one hint on one published challenge.
 *
 * THE ORDER OF THE CHECKS IS THE ORDER OF THE ANSWERS THE PLAYER NEEDS: a bad level or date is a 400; a challenge
 * this player never read has no attempt row and cannot be charged (`no_attempt_row`); an empty balance is
 * `no_hints`; and a challenge that has already spent three is `hints_exhausted`.
 *
 * BOTH WRITES ARE ONE TRANSACTION: the balance and the attempt row move together, so a hint cannot be recorded
 * without being paid for, and a lost race re-reads rather than half-applying.
 */
export async function postHint(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;

  const body = request.body as { levelIndex?: unknown; date?: unknown } | null;
  const levelIndex = levelParam(typeof body?.levelIndex === 'number' ? String(body.levelIndex) : undefined);
  if (levelIndex === null) return failure(STATUS.badRequest, 'bad_level', 'levelIndex must be a positive integer');
  const day = dayParam(typeof body?.date === 'string' ? body.date : undefined);
  if (day === null) return failure(STATUS.badRequest, 'bad_date', 'date must be a real UTC day, as YYYY-MM-DD');

  const rowKey = attemptKey(playerId, 'daily', `${levelIndex}#${day}`);
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const balanceStored = await deps.store.get(hintsKey(playerId));
    const balance = asHints(balanceStored);
    if (!balance) return failure(STATUS.unavailable, 'unreadable_hints', 'the hint balance is not a record this build can read');
    // THE BALANCE IS THE SERVER'S, so a player holding none is refused rather than being granted the help and
    // charged later: a hint that cannot be paid for is not a hint.
    if (balance.hints <= 0) {
      return failure(STATUS.conflict, 'no_hints', 'no hint is held: hints are earned one per ten finished drills');
    }

    const attemptStored = await deps.store.get(rowKey);
    if (!attemptStored) {
      return failure(STATUS.conflict, 'no_attempt_row', `this player never read the challenge for ${day} at level ${levelIndex}, so a hint cannot be charged to it`);
    }
    const record = asAttempt(attemptStored);
    if (!record) return failure(STATUS.unavailable, 'unreadable_attempt', `the attempt row for level ${levelIndex} on ${day} is not a record this build can read`);
    if (record.hints.length >= MAX_HINTS_PER_ATTEMPT) {
      return failure(STATUS.conflict, 'hints_exhausted', `the challenge for ${day} has already spent ${MAX_HINTS_PER_ATTEMPT} hints`);
    }

    const event = { step: record.hints.length, call: '', atMs: deps.clock.nowMs() };
    const written = await deps.store.transact([
      { key: hintsKey(playerId), expectedRev: balanceStored?.rev ?? null, value: { hints: balance.hints - 1, successes: balance.successes } },
      { key: rowKey, expectedRev: attemptStored.rev, value: asAttemptItem({ ...record, hints: [...record.hints, event] }) },
    ]);
    if (written) {
      return { status: STATUS.ok, body: { hints: { hints: balance.hints - 1, successes: balance.successes }, spent: record.hints.length + 1 } };
    }
  }
  return failure(STATUS.conflict, 'contended', 'another request is writing this attempt; try again');
}
