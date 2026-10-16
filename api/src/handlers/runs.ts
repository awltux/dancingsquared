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
// engine), the level, and — for the Drill — that the clock cannot claim more time than has passed since it was
// issued. NOT verifiable from the state this API holds, and said rather than implied: the ATTEMPTS count and
// the HINT SPEND are the client's claims, because neither has a server-side interaction in this design. They
// are bounded, priced and recorded rather than trusted or refused; DESIGN.md §15 Q19 records that with the
// arithmetic of what a dishonest client gains.
//
// ONE TRANSACTION, OR NOTHING. The run's own row is created in the same `transact` as its effects with
// `expectedRev: null`, so a resubmitted `runId` cannot land twice: the condition fails and this handler answers
// from the row already there. That is what makes a client retry safe, and it is why the record is not a
// separate "has this happened" query with a race between the query and the write.
import { MAIN_POOL, MOVE_ALLOWANCE_CUSHION, SCORE_VERSION, elapsedSeconds, recordSuccess } from 'dancing-squared-game';
import { MAX_WRITE_ATTEMPTS, type ApiRequest, type ApiResult, type Deps, type StoreWrite } from '../ports.ts';
import { boardKey, hintsKey, publishedDailyKey, progressKey, runKey } from '../keys.ts';
import { levelAt, lineReachesGoal, puzzleFor } from '../levels.ts';
import { asProgress, asProgressItem } from '../progress-row.ts';
import { failure, identity, STATUS } from '../status.ts';
import { finishDrill, type DrillProgress } from '../drill-regime.ts';
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
}

/**
 * The season a Drill run belongs to: the calendar month, UTC.
 *
 * §15 Q4 recommends calendar months, so the period is a function of the clock rather than a stored value — a
 * season boundary therefore resets the board by construction (the key changes) instead of by a job that deletes
 * rows. UTC is the same choice the Daily's day makes (§9), so the two boards turn over together.
 */
export function seasonOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/** The Drill's source: the issued drill, the regenerated puzzle, and the per-step answer re-derived. */
async function verifyDrill(
  submission: RunSubmission,
  deps: Deps,
  playerId: string,
  level: ReturnType<typeof levelAt>,
  nowMs: number,
): Promise<{ source: Source } | { refusal: ApiResult }> {
  const key = progressKey(playerId, submission.levelIndex);
  const stored = await deps.store.get(key);
  const progress = asProgress(stored, submission.levelIndex);
  if (!progress) return { refusal: failure(STATUS.unavailable, 'unreadable_progress', `the progress row for ${key.pk} is not a record this build can read`) };

  const issued = progress.issued;
  if (!issued || issued.id !== submission.drillId) {
    return { refusal: failure(STATUS.conflict, 'stale_drill', `the drill in flight is ${issued?.id ?? 'nothing'}, not ${submission.drillId}`) };
  }
  if (issued.poolVersion !== MAIN_POOL.version) {
    // A SEED IS ONLY MEANINGFUL AGAINST THE POOL IT WAS VALIDATED AT (§7.2), so a drill from another pool cannot
    // be regenerated — and scoring a puzzle nobody issued would be worse than refusing it.
    return { refusal: failure(STATUS.conflict, 'stale_pool', `drill ${issued.id} was issued against pool ${issued.poolVersion}, and this build serves ${MAIN_POOL.version}`) };
  }
  const generated = puzzleFor(issued.seed, level);
  if (!generated.ok) return { refusal: failure(STATUS.unavailable, 'unplayable_drill', `the issued drill does not generate: ${generated.reason}`) };

  // THE PER-STEP ANSWER, RE-DERIVED. §11 says the server decides which option was correct at each step, so the
  // client's `calls` are checked against the puzzle rather than against the client's own claim about them.
  const puzzle = generated.puzzle;
  if (submission.calls.length !== puzzle.steps.length) {
    return { refusal: failure(STATUS.badRequest, 'not_solved', `a Drill run has one call per step: this level asks ${puzzle.steps.length} and the run names ${submission.calls.length}`) };
  }
  for (let step = 0; step < puzzle.steps.length; step++) {
    const correct = puzzle.steps[step].moves[puzzle.steps[step].correctIndex].call;
    if (submission.calls[step] !== correct) {
      return { refusal: failure(STATUS.badRequest, 'not_solved', `step ${step + 1} was answered "${submission.calls[step]}", and the correct option was "${correct}"`) };
    }
  }

  // THE CLOCK'S BOUND. The Drill's issue time is the server's own fact, so a claim of more time than has passed
  // is refused; the tolerance is for the difference between the client's clock and this one, not for a slow
  // player. A claim well BELOW the bound is still possible — this rules out the absurd, it does not time a run.
  const wallSeconds = (nowMs - issued.issuedAtMs) / 1000;
  if (submission.clockSeconds > wallSeconds + CLOCK_SKEW_SECONDS) {
    return {
      refusal: failure(STATUS.badRequest, 'impossible_elapsed', `the run claims ${submission.clockSeconds.toFixed(1)} s and the drill was issued ${wallSeconds.toFixed(1)} s ago`),
    };
  }

  return {
    source: {
      seed: issued.seed,
      progress,
      progressRev: stored?.rev ?? null,
      // ONE ANSWER PER STEP AND NOTHING TO WASTE: `moves` is the puzzle's own shortest, exactly as the client
      // computes it (`moves: controller.puzzleRef.shortest`). The Drill's cost is its attempts, not its waste.
      facts: {
        shortest: puzzle.shortest,
        moves: puzzle.shortest,
        clockSeconds: submission.clockSeconds,
        hintsUsed: submission.hintsUsed,
        attempts: submission.attempts,
      },
    },
  };
}

/** The Daily's source: the published challenge, and the player's line walked through the engine. */
async function verifyDaily(
  submission: RunSubmission,
  deps: Deps,
  level: ReturnType<typeof levelAt>,
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
  const generated = puzzleFor(value.seed, level);
  if (!generated.ok) return { refusal: failure(STATUS.unavailable, 'unplayable_daily', `the published challenge does not generate: ${generated.reason}`) };

  const walked = lineReachesGoal(level, generated.puzzle, submission.calls);
  if (!walked.ok) return { refusal: failure(STATUS.badRequest, 'not_solved', walked.reason) };

  // THE ALLOWANCE IS CHECKED BECAUSE THE LINE IS THE PLAYER'S. `MOVE_ALLOWANCE_CUSHION` is the same constant the
  // client's allowance is built from (`src/puzzle/config.ts`), so a line the client would not have let the
  // player submit is refused here rather than scored.
  const allowance = generated.puzzle.shortest + MOVE_ALLOWANCE_CUSHION;
  if (submission.calls.length > allowance) {
    return { refusal: failure(STATUS.badRequest, 'over_allowance', `the line is ${submission.calls.length} calls and this puzzle allows ${allowance}`) };
  }
  return {
    source: {
      seed: value.seed,
      progress: null,
      progressRev: null,
      // THE DAILY IS NOT SCORED ON ATTEMPTS (§6), so it is priced on its line and its hints alone. `moves` is
      // the length of the line the player actually built, which is what the waste factor measures.
      facts: { shortest: generated.puzzle.shortest, moves: submission.calls.length, clockSeconds: submission.clockSeconds, hintsUsed: submission.hintsUsed, attempts: 0 },
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
  const who = identity(request, deps);
  if ('refusal' in who) return who.refusal;
  const parsed = parseRunSubmission(request.body);
  if (!parsed.ok) return failure(STATUS.badRequest, parsed.refusal.code, parsed.refusal.message);
  const submission = parsed.submission;
  const level = levelAt(submission.levelIndex);
  const nowMs = deps.clock.nowMs();
  const period = submission.mode === 'daily' ? (submission.date ?? '') : seasonOf(nowMs);
  const runItem = runKey(who.playerId, submission.runId);

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    // ALREADY RECORDED? Then this is a retry, and the answer is what was recorded: no second credit, no second
    // accumulation, and no error — a retry is what a client SHOULD do when it is unsure whether the first one
    // arrived.
    const recorded = await deps.store.get(runItem);
    if (recorded) {
      const hints = asHints(await deps.store.get(hintsKey(who.playerId)));
      if (!hints) return failure(STATUS.unavailable, 'unreadable_hints', 'the hint balance is not a record this build can read');
      const board = asBoard(await deps.store.get(boardKey(submission.mode, submission.levelIndex, period, who.playerId)));
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
      ? await verifyDrill(submission, deps, who.playerId, level, nowMs)
      : await verifyDaily(submission, deps, level);
    if ('refusal' in verified) return verified.refusal;
    const source = verified.source;

    // THE ROWS THIS RUN TOUCHES, read at the revisions the transaction will require.
    const hintsStored = await deps.store.get(hintsKey(who.playerId));
    const hints = asHints(hintsStored);
    if (!hints) return failure(STATUS.unavailable, 'unreadable_hints', 'the hint balance is not a record this build can read');
    const boardStored = await deps.store.get(boardKey(submission.mode, submission.levelIndex, period, who.playerId));
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
    // THE DEBIT IS THE CLIENT'S CLAIM, CLAMPED TO THE BALANCE: claiming more hints than are held cannot take the
    // balance below zero, and claiming fewer keeps a hint the player spent (see the header, and §15 Q19).
    const debited = debitHints(credit.ledger, submission.hintsUsed);
    const folded = foldBoard(submission.mode, board, score.score);

    const writes: StoreWrite[] = [
      { key: runItem, expectedRev: null, value: asRunItem({ submission, seed: source.seed, score: score.score, scoreVersion: SCORE_VERSION, nowMs }) },
      { key: hintsKey(who.playerId), expectedRev: hintsStored?.rev ?? null, value: { hints: debited.hints, successes: debited.successes } },
      { key: boardKey(submission.mode, submission.levelIndex, period, who.playerId), expectedRev: boardStored?.rev ?? null, value: { score: folded.score, runs: folded.runs } },
    ];
    if (finishedProgress) {
      writes.push({ key: progressKey(who.playerId, submission.levelIndex), expectedRev: source.progressRev, value: asProgressItem(finishedProgress) });
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
          hints: debited,
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
