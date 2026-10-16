// `POST /daily/move` — one move, undo or redo, recorded (DESIGN.md §11.1, A22's Daily half).
//
// WHAT THIS BUYS, in one sentence: the Daily's LINE stops being something a submission states and becomes something
// the server watched. That matters because §6 prices the line — `wasteFactor` measures the calls used against the
// shortest — so a modified client could otherwise play a wasteful line and submit the short one, which is the same
// class of lie A21 and A23 removed from the clock and the hints.
//
// IT RECORDS THE MOVE AND NOTHING ELSE. No line, no length, no verdict: the line is a pure replay of the log
// (`levels.ts`'s `replayDailyMoves`), and judging the move would mean generating the puzzle on every click for an
// answer the client already has. The endpoint that adjudicates the line is `POST /runs`, which walks the derived
// line through the engine exactly as it walked the claimed one — so a log that plays an illegal call derives a
// line without it, and a log that never reaches the goal is refused there.
//
// A MOVE NEEDS AN ATTEMPT, and that is A21's rule rather than this endpoint's caution: the attempt row is created by
// this player's IDENTIFIED read of the challenge (`handlers/puzzle.ts`), so a move against a row that does not
// exist is a move on a challenge this player never fetched from this server — the same `<no_attempt_row>` refusal a
// Daily submission gets, for the same reason.
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Deps } from '../ports.ts';
import { failure, requireIdentity, STATUS } from '../status.ts';
import { asAttempt, asAttemptItem, type Attempt } from '../attempt-row.ts';
import { attemptKey } from '../keys.ts';
import { MAX_DAILY_MOVES, parseDailyMove, type DailyMove } from '../daily-line.ts';

/**
 * Record one move against the player's Daily attempt.
 *
 * THE APPEND IS A COMPARE-AND-SET LOOP, exactly as the Drill's press log is: the log is one item, two clicks can
 * overlap, and a loser re-reads and appends again. The cost is one read and one write per move.
 *
 * THE ANSWER IS THE LOG'S LENGTH. It is the only number the server knows without generating the puzzle, and it is
 * what the client needs: that the write landed, which is the difference between "recorded" and "refused" — the same
 * job `presses` does for the Drill's answer.
 */
export async function postDailyMove(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;

  const body = request.body as { levelIndex?: unknown; date?: unknown } | null;
  const levelIndex = body?.levelIndex;
  if (typeof levelIndex !== 'number' || !Number.isInteger(levelIndex) || levelIndex < 1) {
    return failure(STATUS.badRequest, 'bad_level', 'levelIndex must be a positive integer');
  }
  // THE DAY IS NOT FORMAT-CHECKED, and that is not laxity: it is the second half of the row's key, so a day the
  // player never read has no attempt row and is refused by the check below. A format rule here would add a refusal
  // code that can never fire on its own.
  const date = body?.date;
  if (typeof date !== 'string' || date === '') {
    return failure(STATUS.badRequest, 'bad_date', 'date must be the challenge day the player read');
  }

  const parsed = parseDailyMove(request.body);
  if (!parsed.ok) return failure(STATUS.badRequest, parsed.code, parsed.message);

  const key = attemptKey(playerId, 'daily', `${levelIndex}#${date}`);
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const stored = await deps.store.get(key);
    if (!stored) {
      return failure(
        STATUS.conflict,
        'no_attempt_row',
        `this player never read the challenge for ${date} on level ${levelIndex}: a move is recorded against an attempt, and there is none`,
      );
    }
    const row: Attempt | null = asAttempt(stored);
    // A DAILY ROW WITHOUT A STAMP IS NOT A DAILY ATTEMPT, the same distinction `POST /runs` makes: a Drill's row (or
    // a hand-written one) holds no start stamp, so it cannot be the row a Daily's moves belong to.
    if (!row || row.startedAtMs === null) {
      return failure(STATUS.unavailable, 'unreadable_move_log', `the attempt row for level ${levelIndex} on ${date} is not a move log this build can read`);
    }
    if (row.moves.length >= MAX_DAILY_MOVES) {
      return failure(STATUS.conflict, 'move_log_full', `this challenge already holds ${MAX_DAILY_MOVES} moves, and no player makes more`);
    }
    // THE STAMP IS THE SERVER'S, and the union is rebuilt rather than spread: `{ ...parsed.move, atMs }` loses the
    // discrimination between an `add` (which has a call) and an undo/redo (which must not), and that discrimination
    // is what makes the replay typed.
    const atMs = deps.clock.nowMs();
    const move: DailyMove = parsed.move.kind === 'add' ? { kind: 'add', call: parsed.move.call, atMs } : { kind: parsed.move.kind, call: null, atMs };
    const next = [...row.moves, move];
    if (await deps.store.put(key, asAttemptItem({ ...row, moves: next }), stored.rev ?? null)) {
      return { status: STATUS.ok, body: { recorded: next.length } };
    }
  }
  return failure(STATUS.conflict, 'contended', 'another move is being recorded for this challenge; try again');
}
