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
// WHAT THE SERVER NAMES, AND WHY IT CAN NOW. The CALL a hint names is the server's: §10's look-up runs over the
// BOARD the player is standing on, and for the Daily that board is the RECORDED line — `POST /daily/move` records it
// and `nameHintFor` replays it through `PlaySession.hint()`, the same function the screen calls. So the server names
// the call from the position it WATCHED the player reach, where the client names from the position it believes it is
// on (which can lag by a move that has not landed) — and the answer carries the name so the app can adopt it rather
// than show a second one.
//
// THE SPEND REMAINS THE ANTI-CHEAT PART. A hint is a 60-second charge folded into the elapsed the score is computed
// from, and `POST /runs` charges what was RECORDED here. §11.1's known limit 2 still stands: the information a hint
// reveals is derivable from the puzzle the client was served, so the NAMING is a fairness feature rather than a
// defence — what is a defence is that the help cannot be taken without the balance moving.
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
import { levelAt, nameHintFor, publishedPuzzle } from '../levels.ts';

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

    // THE NAME COMES FROM THE RECORDED BOARD, and the puzzle is generated once per spend (the memoised
    // `puzzleFor`, so a second hint on the same challenge costs a Map lookup). A refusal here is the published
    // row's — the same three `verifyDaily` answers with — and it is returned BEFORE the balance moves.
    const challenge = await publishedPuzzle(deps.store, levelIndex, day);
    if (!challenge.ok) return failure(challenge.status, challenge.code, challenge.message);
    const named = nameHintFor(levelAt(levelIndex), challenge.puzzle, record.moves);
    // A HINT THAT CANNOT SAY ANYTHING IS NOT A HINT, which is the app's own rule and now the server's: the look-up
    // runs over the recorded board, so the server can tell BEFORE it debits that there is nothing to name (a dead
    // end). Refusing here is what stops a player paying for a hint that names no call — MEASURED as reachable the
    // moment the naming moved to the server, because the debit used to happen with an empty name.
    if (named === null) {
      return failure(STATUS.conflict, 'nothing_to_name', 'there is no call to name from this board: a hint that cannot say anything is not a hint');
    }

    const event = { step: record.hints.length, call: named, atMs: deps.clock.nowMs() };
    const written = await deps.store.transact([
      { key: hintsKey(playerId), expectedRev: balanceStored?.rev ?? null, value: { hints: balance.hints - 1, successes: balance.successes } },
      { key: rowKey, expectedRev: attemptStored.rev, value: asAttemptItem({ ...record, hints: [...record.hints, event] }) },
    ]);
    if (written) {
      return {
        status: STATUS.ok,
        // THE CALL IS IN THE ANSWER so the app can SHOW the server's name rather than its own: two names for one
        // fact is the confusion the shared look-up exists to avoid. It is never null — the refusal above means a
        // spend that cannot name a call does not happen.
        body: { hints: { hints: balance.hints - 1, successes: balance.successes }, spent: record.hints.length + 1, call: named },
      };
    }
  }
  return failure(STATUS.conflict, 'contended', 'another request is writing this attempt; try again');
}
