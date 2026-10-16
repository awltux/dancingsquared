// `POST /drill/reveal` — the answer was SHOWN to this player, recorded (DESIGN.md §15 Q16).
//
// WHAT THIS EXISTS FOR, in one sentence: the app's "show me the answer" button used to leave no trace the server
// could see, so pressing it and then pressing the call it named earned the same success as answering, and ten of
// those minted a hint. The hint balance is the server's (A23), so the fact that decides whether a run counts has to
// reach the server — and a fact the server did not witness is not a fact, which is why this records an EVENT rather
// than accepting a field on the submission (A22's shape, for A22's reason).
//
// THE NAME IS THE SERVER'S, exactly as A23's hint name is. The reveal carries only WHICH STEP; the call is looked up
// from the puzzle the server issued, so the row says what was actually shown rather than what the client says it was
// shown. For a Drill that look-up is the step's own correct option — the same expression `handlers/answer.ts` derives
// the verdict from and `POST /runs` re-derives the transcript from, so one position has one answer across all three.
//
// IT IS NOT A SCORING ENDPOINT AND IT IS NOT A PRESS. It changes no row but the attempt log, so it stays as cheap as
// a press; and it is deliberately NOT recorded as a press, because a reveal is not an answer the player committed and
// counting it as a wrong try would charge for the app's own help.
//
// THE STEP IS DEDUPLICATED, unlike a press, and that is a rule rather than an optimisation: the fact this endpoint
// exists to record is "this player was shown this step's answer", and a second press of the same button shows the same
// call. An event per press would make the row's length a count of a nervous hand, and a retry after a dropped
// connection would look like a second, different piece of help taken. So the row holds at most one reveal per step,
// the append is skipped when the step is already there, and the answer says which of the two happened.
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Deps } from '../ports.ts';
import { failure, requireIdentity, STATUS } from '../status.ts';
import { asAttempt, asAttemptItem, emptyAttempt, type RevealEvent } from '../attempt-row.ts';
import { attemptKey } from '../keys.ts';
import { parseDrillId } from '../drill-regime.ts';
import { readIssuedDrill } from '../issued-drill.ts';

/**
 * Record that one step's answer was shown, and answer with the call the server named.
 *
 * THE COMPARE-AND-SET LOOP IS THE PRESS LOG'S, because the row is the same row: two reveals can overlap, so the read
 * hands back a revision, the write requires it, and a loser re-reads. A reveal appended to a row read without that
 * revision would DROP a press recorded in between, which is the failure `attempt-row.ts`'s header records.
 */
export async function postDrillReveal(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;

  const body = request.body as { drillId?: unknown; step?: unknown } | null;
  const drillId = body?.drillId;
  if (typeof drillId !== 'string') return failure(STATUS.badRequest, 'bad_drill_id', 'drillId must be a string');
  const parsed = parseDrillId(drillId);
  if (!parsed) return failure(STATUS.badRequest, 'bad_drill_id', `${JSON.stringify(drillId)} is not a drill id`);

  const step = body?.step;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 0) {
    return failure(STATUS.badRequest, 'bad_step', 'step must be a non-negative integer');
  }

  const read = await readIssuedDrill(deps, playerId, parsed.levelIndex, drillId);
  if ('refusal' in read) return read.refusal;
  const puzzle = read.issued.puzzle;
  if (step >= puzzle.steps.length) {
    return failure(STATUS.badRequest, 'bad_step', `drill ${drillId} has ${puzzle.steps.length} step(s) and this reveal is for step ${step + 1}`);
  }
  const named = puzzle.steps[step].moves[puzzle.steps[step].correctIndex].call;

  const key = attemptKey(playerId, 'drill', drillId);
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const stored = await deps.store.get(key);
    const record = stored ? asAttempt(stored) : emptyAttempt(null);
    if (!record) return failure(STATUS.unavailable, 'unreadable_attempt', `the attempt row for ${drillId} is not a record this build can read`);
    const already = record.reveals.find((reveal) => reveal.step === step);
    if (already) {
      // THE SAME STEP, SHOWN AGAIN. Nothing is written, and the call answered is the RECORDED one rather than a
      // second look-up: a row and an answer that could disagree about what was shown would be worse than a repeat.
      return { status: STATUS.ok, body: { call: already.call, step, reveals: record.reveals.length, recorded: false } };
    }
    const reveals: RevealEvent[] = [...record.reveals, { step, call: named, atMs: deps.clock.nowMs() }];
    if (await deps.store.put(key, asAttemptItem({ ...record, reveals }), stored?.rev ?? null)) {
      return { status: STATUS.ok, body: { call: named, step, reveals: reveals.length, recorded: true } };
    }
  }
  return failure(STATUS.conflict, 'contended', 'another request is writing this drill; try again');
}
