// `POST /runs`: a completed run, verified by regeneration, and the four effects of accepting it.
//
// WHAT THIS ENDPOINT IS FOR, in DESIGN.md 11's words: "One completed run. Daily: the level, seed, elapsed,
// move list, hintsUsed and client runId. Drill: the issued-drill id, elapsed, runId and the calls chosen — one
// per step ... The server re-derives which option was correct at each step rather than trusting the client's
// claim about it." And §6: "the server clamps every submission to the maximum score the server can itself
// recompute", and "a client cannot claim a hint it did not spend or hide one it did".
//
// WHAT IS VERIFIED, AND WHAT CANNOT BE. Verified: the puzzle (regenerated from the server's own seed), which
// option was correct (the Drill's per-step answer), that a Daily line reaches the goal (walked through the
// engine), the level, and THE TIME — the elapsed a run is scored on is `submittedAt − startedAt` from the server's
// own stamp (the Progress row's issue date for the Drill, the attempt row an identified read creates for the
// Daily), with the client's `elapsedSeconds` kept as an audit input and never scored (DESIGN.md 11.1, A21). NOT
// verifiable from the state this API holds, and said rather than implied: the ATTEMPTS count and the HINT SPEND
// are the client's claims, because neither has a server-side interaction in this design. They are bounded, priced
// and recorded rather than trusted or refused; DESIGN.md §15 Q19 records that with the arithmetic of what a
// dishonest client gains.
//
// ONE TRANSACTION, OR NOTHING. The run's own row is created in the same `transact` as its effects with
// `expectedRev: null`, so a resubmitted `runId` cannot land twice: the condition fails and this handler answers
// from the row already there. That is what makes a client retry safe, and it is why the record is not a
// separate "has this happened" query with a race between the query and the write.
import { MAIN_POOL, SCORE_VERSION, elapsedSeconds, recordSuccess, seasonOf } from 'dancing-squared-game';
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Deps, type StoreWrite } from '../ports.ts';
import { attemptKey, boardKey, hintsKey, publishedDailyKey, progressKey, runKey } from '../keys.ts';
import { levelAt, lineReachesGoal, puzzleFor, replayDailyMoves } from '../levels.ts';
import { asProgress, asProgressItem } from '../progress-row.ts';
import { failure, requireIdentity, STATUS } from '../status.ts';
import { finishDrill, type DrillProgress } from '../drill-regime.ts';
import { asAttempt, elapsedSince } from '../attempt-row.ts';
// The refusal COUNT is not wired here: it is applied at the route table, so every endpoint is covered by
// construction (buse.ts: countingRefusals).
import { explains, wrongPresses } from '../press-log.ts';
import { readIssuedDrill } from '../issued-drill.ts';
import {
  asBoard,
  asHints,
  asRunItem,
  debitHints,
  foldBoard,
  parseRunSubmission,
  scoreWithClaim,
  CLOCK_SKEW_SECONDS,
  type BoardValue,
  type RunSubmission,
  type VerifiedRun,
} from '../runs.ts';

/** Where a run's puzzle came from, once the server has decided it may be scored. */
interface Source {
  readonly seed: number;
  /** The Drill's progress row as read, or null for the Daily; `progressRev` is the revision to transact on. */
  readonly progress: DrillProgress | null;
  readonly progressRev: number | null;
  readonly facts: VerifiedRun;
  /** What the client claimed its time was. Kept for the record and never scored (DESIGN.md 11.1, A21). */
  readonly claimedSeconds: number;
  /** What the client claimed its wrong-try count was. Kept for the record and never scored (A22). */
  readonly claimedAttempts: number;
  /** What the client claimed it spent on hints. Kept for the record; the Drill's CHARGE is the recorded spend (A23). */
  readonly claimedHints: number;
}

/** The Drill's source: the issued drill, the regenerated puzzle, and the per-step answer re-derived. */
async function verifyDrill(
  submission: RunSubmission,
  deps: Deps,
  playerId: string,
  level: ReturnType<typeof levelAt>,
  nowMs: number,
): Promise<{ source: Source } | { refusal: ApiResult }> {
  const read = await readIssuedDrill(deps, playerId, submission.levelIndex, submission.drillId ?? '');
  if ('refusal' in read) return { refusal: read.refusal };
  const { issued, progress, progressRev, puzzle } = read.issued;

  // THE PER-STEP ANSWER, RE-DERIVED. §11 says the server decides which option was correct at each step, so the
  // client's `calls` are checked against the puzzle rather than against the client's own claim about them.
  if (submission.calls.length !== puzzle.steps.length) {
    return { refusal: failure(STATUS.badRequest, 'not_solved', `a Drill run has one call per step: this level asks ${puzzle.steps.length} and the run names ${submission.calls.length}`) };
  }
  const correctCalls = puzzle.steps.map((step) => step.moves[step.correctIndex].call);
  for (let step = 0; step < puzzle.steps.length; step++) {
    if (submission.calls[step] !== correctCalls[step]) {
      return { refusal: failure(STATUS.badRequest, 'not_solved', `step ${step + 1} was answered "${submission.calls[step]}", and the correct option was "${correctCalls[step]}"`) };
    }
  }

  // THE PRESSES ARE THE SERVER'S, and this is what A22 bought: `attempts` is the number of wrong presses THE
  // SERVER recorded, not the number the submission reports. A run whose transcript the log does not explain is
  // refused rather than scored — the client is told which of the two it is, because the fix differs: `no_press_log`
  // is a client that never posted (a version skew or a lost connection), `unexplained_calls` is a transcript the
  // recorded presses cannot account for.
  const logged = await deps.store.get(attemptKey(playerId, 'drill', issued.id));
  if (!logged) {
    return { refusal: failure(STATUS.conflict, 'no_press_log', `no press was recorded for drill ${issued.id}, so its attempts cannot be counted`) };
  }
  const record = asAttempt(logged);
  if (!record) {
    return { refusal: failure(STATUS.unavailable, 'unreadable_attempt', `the attempt row for drill ${issued.id} is not a record this build can read`) };
  }
  const presses = record.presses;
  if (!explains(presses, submission.calls)) {
    return { refusal: failure(STATUS.badRequest, 'unexplained_calls', `the recorded presses do not explain this transcript, so the run cannot be counted`) };
  }
  const measuredAttempts = wrongPresses(presses, correctCalls);
  if (submission.hintsUsed > record.hints.length) {
    // A CLAIM ABOVE THE RECORDED SPEND IS THE LAST CHEAT IN THIS FAMILY: hints are spent through
    // POST /me/hints, which debits the balance and records the event (A23), so a claim of more than was recorded
    // is either a client that never posted (and would otherwise be charged nothing for help it took) or one
    // inventing a spend. Refused rather than flagged, because scoring it would charge the help and refuse to
    // count it either way.
    return { refusal: failure(STATUS.badRequest, 'unrecorded_hints', `the run claims ${submission.hintsUsed} hint(s) and ${record.hints.length} were recorded for this drill`) };
  }
  // THE HINT SPEND IS WHAT THE SERVER RECORDED, for the same reason the tries are: a hint is a 60-second charge
  // folded into the elapsed, and a client that reported none kept the time it bought (A23). The balance was already
  // debited when the hint was TAKEN, so this number is a time charge and not a payment.
  const recordedHints = record.hints.length;

  // THE CLOCK IS THE SERVER'S, AND THIS IS WHERE THAT IS TRUE. `issuedAtMs` is this API's own stamp, written when
  // it issued the drill, so the run is scored on `now − issued` — the client's `clockSeconds` is not used for
  // anything except the refusal below and the record (A21). MEASURED, and it is the defect this replaced: the
  // elapsed used to BE the client's claim, bounded only above by the wall time, so a 100-second run could claim
  // par and score 100 instead of 15 (6.7x).
  const measuredSeconds = elapsedSince(issued.issuedAtMs, nowMs);
  // A CLAIM ABOVE THE WINDOW IS A LIE THE SERVER CAN SEE, so it is refused rather than quietly replaced: the
  // tolerance is for the difference between the client's clock and this one, not for a slow player. A claim BELOW
  // the window is not refused — it is simply not the number that scores.
  if (submission.clockSeconds > measuredSeconds + CLOCK_SKEW_SECONDS) {
    return {
      refusal: failure(STATUS.badRequest, 'impossible_elapsed', `the run claims ${submission.clockSeconds.toFixed(1)} s and the drill was issued ${measuredSeconds.toFixed(1)} s ago`),
    };
  }

  return {
    source: {
      seed: issued.seed,
      progress,
      progressRev,
      claimedSeconds: submission.clockSeconds,
      // A CLAIM BELOW THE RECORDED COUNT IS NOT REFUSED, and that is deliberate: `attemptFactor` prices wrong
      // tries, so claiming FEWER can only lower the score the server is about to compute, and the audit row keeps
      // both numbers. Claiming MORE is also ignored — the count is the log's.
      claimedAttempts: submission.attempts,
      claimedHints: submission.hintsUsed,
      // ONE ANSWER PER STEP AND NOTHING TO WASTE: `moves` is the puzzle's own shortest, exactly as the client
      // computes it (`moves: controller.puzzleRef.shortest`). The Drill's cost is its attempts, not its waste.
      facts: {
        shortest: puzzle.shortest,
        moves: puzzle.shortest,
        clockSeconds: measuredSeconds,
        // THE RECORDED SPEND, NOT THE CLAIM: a hint is a 60-second charge folded into the elapsed, and the client's
        // report of it was the last thing a player could hide (A23 — MEASURED in `hint-event-probe.mjs`, where
        // hiding a recorded hint paid 25 instead of the 13 the charge earns).
        hintsUsed: recordedHints,
        attempts: measuredAttempts,
      },
    },
  };
}

/**
 * The Daily's source: the published challenge, the player's line walked through the engine, and the SERVER's clock.
 *
 * THE ATTEMPT ROW IS WHERE THE CLOCK COMES FROM, and a submission without one is refused. It is created by this
 * player's identified read of the challenge (`handlers/puzzle.ts`), which is the only moment the server sees the
 * run start — the seed is public and a client can derive the board without asking, so "the client says it began at
 * 12:00" is exactly the kind of fact §11.1 forbids scoring on. The refusal is `no_attempt_row` rather than a
 * silent zero-length window, because a missing row means the run cannot be MEASURED, and an unmeasurable run is
 * not a fast one.
 */
async function verifyDaily(
  submission: RunSubmission,
  deps: Deps,
  playerId: string,
  level: ReturnType<typeof levelAt>,
  nowMs: number,
): Promise<{ source: Source } | { refusal: ApiResult }> {
  const date = submission.date ?? '';
  const stored = await deps.store.get(publishedDailyKey(submission.levelIndex, date));
  if (!stored) return { refusal: failure(STATUS.notFound, 'no_published_daily', `level ${submission.levelIndex} has no published challenge for ${date}`) };
  const value = stored.value as { seed?: unknown; poolVersion?: unknown };
  if (typeof value.seed !== 'number' || typeof value.poolVersion !== 'string') {
    return { refusal: failure(STATUS.unavailable, 'unreadable_daily', `the published challenge for ${date} is not a record this build can read`) };
  }
  if (value.poolVersion !== MAIN_POOL.version) {
    return { refusal: failure(STATUS.conflict, 'stale_pool', `the challenge was published against pool ${value.poolVersion}, and this build serves ${MAIN_POOL.version}`) };
  }

  const attemptStored = await deps.store.get(attemptKey(playerId, 'daily', `${submission.levelIndex}#${date}`));
  if (!attemptStored) {
    return {
      refusal: failure(STATUS.conflict, 'no_attempt_row', `this player never read the challenge for ${date}: it was not fetched from this server, so the run cannot be timed`),
    };
  }
  const attempt = asAttempt(attemptStored);
  if (!attempt || attempt.startedAtMs === null) {
    // A DAILY ROW WITHOUT A STAMP IS NOT A DAILY ATTEMPT: the stamp is what the clock is measured from, and a row
    // that has none (a Drill's, a hand-written one) cannot time anything (A21).
    return { refusal: failure(STATUS.unavailable, 'unreadable_attempt', `the attempt row for level ${submission.levelIndex} on ${date} holds no start stamp`) };
  }
  const measuredSeconds = elapsedSince(attempt.startedAtMs, nowMs);
  if (submission.clockSeconds > measuredSeconds + CLOCK_SKEW_SECONDS) {
    return {
      refusal: failure(STATUS.badRequest, 'impossible_elapsed', `the run claims ${submission.clockSeconds.toFixed(1)} s and the challenge was read ${measuredSeconds.toFixed(1)} s ago`),
    };
  }

  // THE SAME RULE AS THE DRILL'S, for the same reason: the balance moved when the hint was TAKEN
  // (`POST /me/hints`), so a claim of more than the record is help the server never saw being charged for.
  if (submission.hintsUsed > attempt.hints.length) {
    return { refusal: failure(STATUS.badRequest, 'unrecorded_hints', `the run claims ${submission.hintsUsed} hint(s) and ${attempt.hints.length} were recorded for this challenge`) };
  }

  const generated = puzzleFor(value.seed, level);
  if (!generated.ok) return { refusal: failure(STATUS.unavailable, 'unplayable_daily', `the published challenge does not generate: ${generated.reason}`) };

  // THE LINE IS THE SERVER'S (A22's Daily half): it is replayed from the moves recorded against this attempt, and it
  // is the ONLY source of the line the run is scored on — §6 prices it, so a client that could state it could hide
  // what it wasted. The replay goes through the same `PlaySession` the client drove, so it cannot disagree with what
  // the player saw (levels.ts's `replayDailyMoves`).
  const recorded = replayDailyMoves(level, generated.puzzle, attempt.moves);
  if (recorded.length === 0) {
    return {
      refusal: failure(STATUS.conflict, 'no_recorded_line', `this challenge has no recorded moves for ${date}: the line is built by POST /daily/move, and a submission cannot supply it`),
    };
  }
  // THE CLAIM IS A CROSS-CHECK RATHER THAN AN INPUT. It is not ignored — a client whose moves did not all land would
  // otherwise be scored on a line it never played and told nothing — and it is not the source, because the log is.
  if (submission.calls.length !== recorded.length || submission.calls.some((call, index) => call !== recorded[index])) {
    return {
      refusal: failure(
        STATUS.badRequest,
        'line_mismatch',
        `the submission names ${submission.calls.length} call(s) and ${recorded.length} were recorded for this challenge`,
      ),
    };
  }

  const walked = lineReachesGoal(level, generated.puzzle, recorded);
  if (!walked.ok) return { refusal: failure(STATUS.badRequest, 'not_solved', walked.reason) };

  // THE ALLOWANCE CHECK THAT USED TO BE HERE IS GONE, and its absence is a guarantee rather than a gap: the line is
  // replayed through `PlaySession`, whose budget is `shortest + MOVE_ALLOWANCE_CUSHION` — the same constant the
  // client's allowance is built from — so a RECORDED line cannot be longer than the allowance. The check existed
  // because the client wrote the line; with the log as the source it is unreachable (`over_allowance` is gone from
  // this endpoint's refusals, and no client can reach it).
  return {
    source: {
      seed: value.seed,
      progress: null,
      progressRev: null,
      claimedSeconds: submission.clockSeconds,
      // THE DAILY IS NOT SCORED ON ATTEMPTS (§6), so its count is the claimed one and nothing reads it; it is
      // carried so the audit row has the same shape in both modes.
      claimedAttempts: submission.attempts,
      claimedHints: submission.hintsUsed,
      // THE DAILY IS NOT SCORED ON ATTEMPTS (§6), so it is priced on its line and its hints alone. `moves` is the
      // length of the RECORDED line — the calls the player actually built, which is what the waste factor measures.
      facts: { shortest: generated.puzzle.shortest, moves: recorded.length, clockSeconds: measuredSeconds, hintsUsed: attempt.hints.length, attempts: 0 },
    },
  };
}

/** Everything a run's answer reports: what the SERVER decided, so the client never has to guess. */
interface AnswerParts {
  readonly submission: RunSubmission;
  readonly score: number;
  readonly elapsedSeconds: number;
  readonly clamped: boolean;
  readonly duplicate: boolean;
  readonly hints: { hints: number; successes: number };
  readonly granted: boolean;
  readonly board: BoardValue;
  readonly period: string;
  readonly progress: { finished: number } | null;
}

function runAnswer(parts: AnswerParts): unknown {
  return {
    run: {
      runId: parts.submission.runId,
      mode: parts.submission.mode,
      score: parts.score,
      elapsedSeconds: parts.elapsedSeconds,
      scoreVersion: SCORE_VERSION,
      clamped: parts.clamped,
      duplicate: parts.duplicate,
    },
    hints: { hints: parts.hints.hints, successes: parts.hints.successes, granted: parts.granted },
    board: { period: parts.period, score: parts.board.score, runs: parts.board.runs },
    progress: parts.progress,
  };
}

/**
 * Record a completed run.
 *
 * THE READ-DECIDE-TRANSACT LOOP IS THE DRILL ENDPOINTS' SHAPE, and for the same reason: the decision is a pure
 * function of rows that can move under it, so the write carries the revisions it read and a loser re-reads. What
 * differs is that the loser usually finds the RUN ROW ALREADY THERE, because a retry is the common case for a
 * submission rather than an edge case.
 */
export async function postRun(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;
  const parsed = parseRunSubmission(request.body);
  if (!parsed.ok) return failure(STATUS.badRequest, parsed.refusal.code, parsed.refusal.message);
  const submission = parsed.submission;
  const level = levelAt(submission.levelIndex);
  const nowMs = deps.clock.nowMs();
  const period = submission.mode === 'daily' ? (submission.date ?? '') : seasonOf(nowMs);
  const runItem = runKey(playerId, submission.runId);

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    // ALREADY RECORDED? Then this is a retry, and the answer is what was recorded: no second credit, no second
    // accumulation, and no error — a retry is what a client SHOULD do when it is unsure whether the first one
    // arrived.
    const recorded = await deps.store.get(runItem);
    if (recorded) {
      const hints = asHints(await deps.store.get(hintsKey(playerId)));
      if (!hints) return failure(STATUS.unavailable, 'unreadable_hints', 'the hint balance is not a record this build can read');
      const board = asBoard(await deps.store.get(boardKey(submission.mode, submission.levelIndex, period, playerId)));
      if (!board) return failure(STATUS.unavailable, 'unreadable_board', 'the board entry is not a record this build can read');
      const value = recorded.value as { score?: unknown; clockSeconds?: unknown; hintsUsed?: unknown };
      return {
        status: STATUS.ok,
        body: runAnswer({
          submission,
          score: typeof value.score === 'number' ? value.score : 0,
          // THE RECORDED RUN'S TIME, RECOMPUTED FROM THE TWO FIELDS THE RECORD HOLDS rather than stored as a sum:
          // `elapsedSeconds` is `clock + HINT_PENALTY_SECONDS × hintsUsed` (score.ts), so retuning the penalty
          // re-prices every stored run instead of leaving a number nobody can explain.
          elapsedSeconds: elapsedSeconds(
            typeof value.clockSeconds === 'number' ? value.clockSeconds : submission.clockSeconds,
            typeof value.hintsUsed === 'number' ? value.hintsUsed : submission.hintsUsed,
          ),
          clamped: false,
          duplicate: true,
          hints,
          granted: false,
          board,
          period,
          progress: null,
        }),
      };
    }

    // THE SOURCE: the server's own seed, and the verification of what the client claims about it.
    const verified = submission.mode === 'drill'
      ? await verifyDrill(submission, deps, playerId, level, nowMs)
      : await verifyDaily(submission, deps, playerId, level, nowMs);
    if ('refusal' in verified) return verified.refusal;
    const source = verified.source;

    // THE ROWS THIS RUN TOUCHES, read at the revisions the transaction will require.
    const hintsStored = await deps.store.get(hintsKey(playerId));
    const hints = asHints(hintsStored);
    if (!hints) return failure(STATUS.unavailable, 'unreadable_hints', 'the hint balance is not a record this build can read');
    const boardStored = await deps.store.get(boardKey(submission.mode, submission.levelIndex, period, playerId));
    const board = asBoard(boardStored);
    if (!board) return failure(STATUS.unavailable, 'unreadable_board', 'the board entry is not a record this build can read');

    // A DRILL'S SUCCESS IS THE ONE THAT FINISHED IT. This single condition gates the hint credit AND the board's
    // accumulation, and it is why re-solving a finished drill cannot mint a hint (§6, §10): the progress row is
    // where "the set of finished ones" lives.
    // THE CREDIT IS GATED ON THE ISSUED INDEX BEING NEW, not merely on the drill being finishable: a position
    // that is somehow still in flight after being finished (`finishDrill` keeps it in the set once) must not pay
    // a second success, which is the rule DESIGN.md 6 and 10 state from two directions.
    const issuedIndex = source.progress?.issued?.index ?? -1;
    const wasFinished = source.progress?.finished.includes(issuedIndex) ?? false;
    const finishing = source.progress ? finishDrill(source.progress, submission.drillId ?? '') : null;
    if (finishing?.kind === 'refused') return failure(STATUS.conflict, 'stale_drill', finishing.reason);
    const finishedProgress = finishing?.kind === 'done' && !wasFinished ? finishing.progress : null;

    const score = scoreWithClaim(source.facts, level, submission.claimedScore);
    const credit = finishedProgress ? recordSuccess(hints) : { ledger: hints, granted: false };
    // A HINT IS PAID FOR WHEN IT IS TAKEN (`handlers/hints.ts` debits the balance and records the event), so the run
    // must not take it a second time. This used to debit the client's claim — clamped to the balance — and that
    // debit was the cheat A23 closes: help that was never paid for. What the run does with hints is CHARGE THEIR
    // TIME (`facts.hintsUsed`, from the record), not move the balance.
    const ledger = credit.ledger;
    const folded = foldBoard(submission.mode, board, score.score);

    const writes: StoreWrite[] = [
      { key: runItem, expectedRev: null, value: asRunItem({ submission, seed: source.seed, measuredSeconds: source.facts.clockSeconds, claimedSeconds: source.claimedSeconds, measuredAttempts: source.facts.attempts, claimedAttempts: source.claimedAttempts, measuredHints: source.facts.hintsUsed, claimedHints: source.claimedHints, score: score.score, scoreVersion: SCORE_VERSION, nowMs }) },
      { key: hintsKey(playerId), expectedRev: hintsStored?.rev ?? null, value: { hints: ledger.hints, successes: ledger.successes } },
      { key: boardKey(submission.mode, submission.levelIndex, period, playerId), expectedRev: boardStored?.rev ?? null, value: { playerId, score: folded.score, runs: folded.runs } },
    ];
    if (finishedProgress) {
      writes.push({ key: progressKey(playerId, submission.levelIndex), expectedRev: source.progressRev, value: asProgressItem(finishedProgress) });
    }
    if (await deps.store.transact(writes)) {
      return {
        status: STATUS.ok,
        body: runAnswer({
          submission,
          score: score.score,
          elapsedSeconds: score.elapsedSeconds,
          clamped: score.clamped,
          duplicate: false,
          hints: ledger,
          granted: credit.granted,
          board: folded,
          period,
          progress: finishedProgress ? { finished: finishedProgress.finished.length } : null,
        }),
      };
    }
  }
  return failure(STATUS.conflict, 'contended', 'another request is writing this run; try again');
}
