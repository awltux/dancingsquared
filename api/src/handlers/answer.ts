// `POST /drill/answer` — one press, recorded (DESIGN.md 11.1, A22).
//
// WHAT THIS BUYS, in one sentence: `attempts` stops being something a submission says and becomes something the
// server counted. `attemptFactor` is a score factor, and a client that reported zero wrong tries was believed —
// §11.1 measured what a hidden factor is worth in the same family (a hidden hint was 21 -> 100).
//
// THE SERVER DECIDES THE VERDICT, AND IT IS THE ONLY THING IT DECIDES. The press carries a step and a call; the
// correct option at that step comes from the puzzle the server regenerated from the seed it issued, exactly as
// `POST /runs` re-derives it for the transcript. Nothing about the press is taken from the client except which
// button was pressed, and even that is checked against the step's own options before it is stored.
//
// IT IS NOT A SCORING ENDPOINT. A press earns nothing and changes no row but the log: the drill's progress, the
// board, the balance and the hint ledger are all `POST /runs`'s business, and keeping them out of here is what
// makes a press cheap enough to send on every click.
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Deps } from '../ports.ts';
import { failure, requireIdentity, STATUS } from '../status.ts';
import { asAttempt, asAttemptItem, emptyAttempt } from '../attempt-row.ts';
import { attemptKey } from '../keys.ts';
import { parseDrillId } from '../drill-regime.ts';
import { readIssuedDrill } from '../issued-drill.ts';
import { MAX_CALL_LENGTH, MAX_PRESSES, wrongPresses } from '../press-log.ts';

/**
 * Record one press and answer what the SERVER made of it.
 *
 * THE APPEND IS A COMPARE-AND-SET LOOP, because the log is one item and two clicks can overlap: the read hands
 * back a revision, the write requires it, and a loser re-reads and appends again. MEASURED cost is one read and
 * one write per press, which is the price of the count being the server's.
 *
 * A STEP OUTSIDE THE PUZZLE IS REFUSED (`bad_step`) rather than logged, because it names a question the client
 * was never asked — and the log's reader counts such a row as wrong, which would let a broken client borrow
 * `attempts` it did not earn. A CALL LONGER THAN A NAME IS REFUSED for the same reason: the log is a record, not
 * a place to put anything.
 */
export async function postDrillAnswer(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;

  const body = request.body as { drillId?: unknown; step?: unknown; call?: unknown } | null;
  const drillId = body?.drillId;
  if (typeof drillId !== 'string') return failure(STATUS.badRequest, 'bad_drill_id', 'drillId must be a string');
  const parsed = parseDrillId(drillId);
  if (!parsed) return failure(STATUS.badRequest, 'bad_drill_id', `${JSON.stringify(drillId)} is not a drill id`);

  const step = body?.step;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 0) {
    return failure(STATUS.badRequest, 'bad_step', 'step must be a non-negative integer');
  }
  const call = body?.call;
  if (typeof call !== 'string' || call === '' || call.length > MAX_CALL_LENGTH) {
    return failure(STATUS.badRequest, 'bad_call', `call must be a non-empty name of at most ${MAX_CALL_LENGTH} characters`);
  }

  const read = await readIssuedDrill(deps, playerId, parsed.levelIndex, drillId);
  if ('refusal' in read) return read.refusal;
  const puzzle = read.issued.puzzle;
  if (step >= puzzle.steps.length) {
    return failure(STATUS.badRequest, 'bad_step', `drill ${drillId} has ${puzzle.steps.length} step(s) and this press is for step ${step + 1}`);
  }
  // THE ANSWER IS THE SERVER'S, from the puzzle it issued. A call that is not this step's correct option is a
  // WRONG press — including the illegal token, whose distinctness is the client's teaching content, not this
  // endpoint's.
  const correct = puzzle.steps[step].moves[puzzle.steps[step].correctIndex].call;
  const verdict = call === correct ? 'correct' : 'wrong';

  const key = attemptKey(playerId, 'drill', drillId);
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const stored = await deps.store.get(key);
    const attempt = stored ? asAttempt(stored) : emptyAttempt(null);
    if (!attempt) return failure(STATUS.unavailable, 'unreadable_press_log', `the attempt row for ${drillId} is not a record this build can read`);
    if (attempt.presses.length >= MAX_PRESSES) {
      return failure(STATUS.conflict, 'press_log_full', `drill ${drillId} already holds ${MAX_PRESSES} presses, which is more than any player makes`);
    }
    const next = [...attempt.presses, { step, call, atMs: deps.clock.nowMs() }];
    if (await deps.store.put(key, asAttemptItem({ ...attempt, presses: next }), stored?.rev ?? null)) {
      const correctCalls = puzzle.steps.map((each) => each.moves[each.correctIndex].call);
      return {
        status: STATUS.ok,
        body: { verdict, attempts: wrongPresses(next, correctCalls), presses: next.length },
      };
    }
  }
  return failure(STATUS.conflict, 'contended', 'another press is being recorded for this drill; try again');
}
