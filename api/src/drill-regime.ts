// THE REGIME'S RULES: which drill a player is on, and what advancing one means. Pure, over plain data.
//
// WHY THIS FILE IS THE SLICE. DESIGN.md 14 names the serving-side rules as "the new fairness surface" and
// says they are to be tested "as a pure function over a schedule, a run history and a fake progress record".
// The three decisions it means are all here, and each is one sentence of DESIGN.md 8:
//
//   1. THE ORDER IS NOT THE PLAYER'S TO CHOOSE. The schedule is served in order and the next entry is the
//      first one this player has not finished. Nothing a client sends can name a seed.
//   2. A DRILL IS LOCKED WHEN IT IS ISSUED. Asking again returns the same seed, the same issue time and the
//      same id — even if the schedule has been republished since, because "a schedule edit cannot rewrite a
//      drill already handed out" (DESIGN.md 8). That is also why the issued record carries its own seed rather
//      than reading it back out of the schedule.
//   3. ADVANCING FINISHES THE DRILL THAT WAS ISSUED, NOT THE NEXT ONE. This is the rule a double-submit would
//      otherwise break: the second advance of the same drill must not mark the entry after it as done, because
//      that would skip a drill nobody played. It is measured in `test/drill-probe.mjs` against the wrong rule,
//      which finishes "the first unfinished entry" and therefore skips one per repeat.
//
// WHAT IS NOT HERE, ON PURPOSE: no clock of its own (the caller passes `nowMs`), no store, no HTTP. The
// handler in `handlers/drill.ts` is where a CAS write turns these answers into a stored row, and everything
// this module decides can be checked without one.
import type { ScheduleEntry } from 'dancing-squared-game';

/**
 * The level's regime as published: an ordered list of seeds, and the version of them.
 *
 * IT IS THE STORAGE FORM OF THE `Schedule` ITEM in DESIGN.md 11's table — `schedule#<level>` — which is "the
 * level's ordered seeds, published ahead of play, with the level stored beside each seed and the schedule
 * version". A seed and its level, and no puzzle: a puzzle is derivable from `(seed, level, poolVersion)`, and
 * publishing the puzzles is what §7.2 refuses to do.
 */
export interface Regime {
  readonly scheduleVersion: string;
  readonly entries: readonly ScheduleEntry[];
}

/**
 * The drill a player has been issued, as it is stored.
 *
 * THE SEED IS COPIED IN HERE rather than looked up when it is served, and that is the whole of rule 2: the
 * Progress row is the authority for a drill already handed out, so republishing the schedule cannot change
 * what a player is in the middle of. `poolVersion` travels with it for the same reason, and
 * `issuedAtMs` is what a client shows as "issued today" and what a season boundary would measure from.
 */
export interface IssuedDrill {
  readonly id: string;
  readonly index: number;
  readonly seed: number;
  readonly poolVersion: string;
  /**
   * The PUBLISHED SET this drill was handed out from — the `Schedule` row's own version, which is
   * `seasonVersion(poolVersion, season)` for a season the publisher wrote (DESIGN.md §15 Q17(vii)).
   *
   * IT IS HERE FOR THE BOARD RATHER THAN FOR THE PUZZLE. The Drill's board key holds the challenge's identity
   * instead of a time period, and for the Drill that identity IS the published set — so a run has to land on the
   * board of the set it was issued from, not on whatever set is current when it is submitted. Carrying it on the
   * ISSUED RECORD is rule 2's own argument one field over: a drill already handed out keeps its seed across a
   * republish, so it has to keep the set it belongs to as well.
   *
   * A REPUBLISH THEREFORE DOES NOT RE-ISSUE A LOCKED DRILL, and that is deliberate rather than an oversight: the
   * drill in flight finishes on the OLD set's board, which is the board its score belongs to, and the next drill is
   * drawn from the new set. `isPlayable` deliberately does not compare this field.
   */
  readonly scheduleVersion: string;
  readonly issuedAtMs: number;
  /**
   * THIS ISSUE IS A REATTEMPT OF A POSITION THE PLAYER ALREADY CLOSED, not the next one in the order.
   *
   * WHY IT HAS TO BE RECORDED RATHER THAN INFERRED. Rule 1 says the order is not the player's to choose and rule 2
   * says an issued drill is locked, so "the drill in flight" is normally a position that is NOT finished —
   * `isPlayable` refuses a finished index for exactly that reason. A reattempt is the one legitimate exception: the
   * player asked for a position they already moved past, and a reload must resume it rather than quietly replacing it
   * with the real next drill. So the exception is a FLAG ON THE ISSUE, which is the only thing that can tell the two
   * apart from the row alone.
   *
   * IT IS NOT A WAY BACK INTO THE ORDER. A replay can only name a position that is `finished` and NOT `passed`
   * (`replayDrill` below), it never changes `nextIndex`, and closing one earns nothing: the position is already in
   * `finished`, so `countSuccess`'s first-time test is false. What it buys is the PASS, which is the only thing a skip
   * left undone.
   */
  readonly replay?: boolean;
}

/**
 * One player's position in one level's regime.
 *
 * `finished` HOLDS SCHEDULE INDICES, NOT SEEDS. A seed can legitimately repeat in a regime (the lint reports
 * a repeat rather than forbidding it), so a set of seeds would confuse two entries; the index is the position
 * in the order, which is what "the first unfinished one" is defined by.
 */
export interface DrillProgress {
  readonly levelIndex: number;
  readonly issued: IssuedDrill | null;
  readonly finished: readonly number[];
  /**
   * The positions the player SOLVED ON THEIR OWN MERITS — finished without a reveal and without a skip.
   *
   * `finished` IS NOT `passed`, and the difference is the level grid's whole reason for wanting both: a skipped
   * drill advances the position (the player moved past it and must not see it again) but it is not a pass, and a
   * revealed drill is the same. The grid draws a cell as done-but-not-passed, which is a fact a caller can act on
   * — "you moved past this one" — where a single finished bit would say the player had learned it.
   *
   * IT IS A SUBSET OF `finished`, ALWAYS. Recorded separately rather than as a record per position so a progress
   * row written before this field existed reads as "finished, pass unknown" rather than as a failure.
   */
  readonly passed: readonly number[];
}

/** The id of the drill at a position. MEANINGFUL RATHER THAN OPAQUE — see `parseDrillId`. */
export function drillId(levelIndex: number, index: number): string {
  return `${levelIndex}:${index}`;
}

/**
 * The position an id names, or null when it is not an id this server could have issued.
 *
 * WHY NOT AN OPAQUE TOKEN. An opaque id would need a row (or an index) to map back to a position, and the
 * only check that matters — "is this the drill I issued you?" — is already answered by comparing the id
 * against the Progress row. Encoding the position makes a stale id detectable without a read, makes a log
 * line say which drill it was, and cannot be forged into a different position than it names because the
 * comparison it is used for is exact. The pool version and the seed are NOT in the id: an id that changed
 * when the schedule was republished would unlock a drill that rule 2 locks.
 */
export function parseDrillId(id: string): { levelIndex: number; index: number } | null {
  const match = /^(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  return { levelIndex: Number(match[1]), index: Number(match[2]) };
}

/** A player with no progress in a level: nothing issued, nothing finished, nothing passed. */
export function emptyProgress(levelIndex: number): DrillProgress {
  return { levelIndex, issued: null, finished: [], passed: [] };
}

/**
 * Whether this level's block is FULL — every one of the level's `levelSize` drills finished.
 *
 * IT READS THE SAME `finished` SET THE BLOCK DRAWS, which is the whole reason it takes the progress record
 * rather than a count handed in from elsewhere: the 10×10 surface fills a cell per finished drill, and a
 * promotion rule fed a different number (a count of runs, a season length, the regime's length) would disagree
 * with the block the player is looking at. A level whose regime is shorter than `levelSize` cannot fill its
 * block at all, which is a publisher's job — see `LEVEL_SIZE`'s own comment.
 *
 * UNFINISHED IS NOT THE SAME AS ABSENT: a player who has finished nothing has an empty set and is not complete,
 * so the rule is a comparison rather than a null check.
 */
export function levelComplete(progress: DrillProgress, levelSize: number): boolean {
  return progress.finished.length >= levelSize;
}

/**
 * The first entry of the regime this player has not finished, or `entries.length` when the regime is complete.
 *
 * IT IS A COUNT OF THE PREFIX IN PRACTICE — a player advances one entry at a time and cannot finish a later
 * one first — but it is written as "the first unfinished" because that is the rule, and because the fixture
 * and a hand-edited row can both produce a gap. The scan is over a season's entries (a few hundred at most),
 * not over anything corpus-scale.
 */
export function nextIndex(regime: Regime, finished: readonly number[]): number {
  for (let index = 0; index < regime.entries.length; index++) {
    if (!finished.includes(index)) return index;
  }
  return regime.entries.length;
}

/** What a request for "the drill I am on" resolved to. */
export type CurrentOutcome =
  | { readonly kind: 'drill'; readonly drill: IssuedDrill; readonly progress: DrillProgress; readonly changed: boolean }
  /** The regime is complete: every entry has been finished, and this slice does not wrap (see below). */
  | { readonly kind: 'complete'; readonly progress: DrillProgress };

/**
 * The drill this player is on, issuing one when there is none.
 *
 * `changed` IS THE ANSWER TO "DOES THIS NEED WRITING?", and it is not decoration: the resumed case is the
 * common one (every reload of the app asks again), and a handler that wrote on every read would turn a
 * read-only request into a compare-and-set race for no reason. The probe measures it by counting writes.
 *
 * THE REGIME COMPLETE CASE DOES NOT WRAP, and the local fixture does. `schedule-fixture.ts` wraps because it
 * is a demo of a regime and a player who finishes the twelfth drill should not see an empty screen; on the
 * server, wrapping would silently re-serve a season that the score table already has, and the season boundary
 * is left open by DESIGN.md 6/§15. So the server says "complete" and the client decides what to show.
 */
export function currentDrill(regime: Regime, levelIndex: number, progress: DrillProgress, currentPoolVersion: string, nowMs: number): CurrentOutcome {
  const locked = progress.issued;
  if (locked && isPlayable(locked, progress, currentPoolVersion)) {
    return { kind: 'drill', drill: locked, progress, changed: false };
  }
  // A drill that cannot be played again is REPLACED by whatever this player is actually on next. That covers
  // the three ways a lock goes stale — the pool moved under it, the entry it named is gone from the schedule,
  // or it was somehow finished already — and it is why none of them needs its own branch here.
  const index = nextIndex(regime, progress.finished);
  const entry = regime.entries[index];
  if (!entry) return { kind: 'complete', progress };
  const drill: IssuedDrill = {
    id: drillId(levelIndex, index),
    index,
    seed: entry.seed,
    poolVersion: entry.poolVersion,
    scheduleVersion: regime.scheduleVersion,
    issuedAtMs: nowMs,
  };
  return { kind: 'drill', drill, progress: { ...progress, issued: drill }, changed: true };
}

/**
 * Whether an issued drill can still be served to this build.
 *
 * THE POOL CHECK IS THE ONE THAT MATTERS. A seed is only meaningful against the pool it was validated at
 * (§7.2), so a `poolVersion` the running build does not have means the puzzle cannot be regenerated at all —
 * the same conclusion the client reaches when it drops a saved run from another pool (Phase 4). The other two
 * conditions are the row being inconsistent with itself.
 */
function isPlayable(issued: IssuedDrill, progress: DrillProgress, currentPoolVersion: string): boolean {
  if (issued.poolVersion !== currentPoolVersion) return false;
  // A REATTEMPT NAMES A FINISHED POSITION ON PURPOSE — see `IssuedDrill.replay`. Everything else is refused, which is
  // what stops a hand-edited row from re-serving a drill the player has already done.
  if (!issued.replay && progress.finished.includes(issued.index)) return false;
  return issued.index >= 0;
}

/** What a request to reattempt a closed position resolved to. */
export type ReplayOutcome =
  | {
      readonly kind: 'drill';
      readonly drill: IssuedDrill;
      readonly progress: DrillProgress;
      /** Whether this needs writing: false when the same reattempt is already in flight (a second press). */
      readonly changed: boolean;
    }
  /** A refusal carries a CODE as well as prose, because the four causes are four different client mistakes. */
  | { readonly kind: 'refused'; readonly code: 'bad_index' | 'no_entry' | 'not_finished' | 'already_passed'; readonly reason: string };

/**
 * The drill to reattempt `index`, or the reason it cannot be reattempted — rule 1's one legitimate exception.
 *
 * WHY THIS EXISTS AT ALL. A skip closes a position without teaching it (`finished` without `passed`), and before this
 * the closed position could never be opened again: the level screen drew it as a statement, `isPlayable` refused a
 * finished index, and no route asked for a position by name. So a player who skipped a drill could never pass it, and
 * a level's `passed` column could never be completed. That is the DEFECT this function answers — report: "the player
 * has to be able to reattempt drills that are skipped, currently they are locked off".
 *
 * THE THREE CONDITIONS ARE ALL NARROWING ON PURPOSE, and each is a different sentence:
 *   - the position must exist in the regime, or there is no drill to serve;
 *   - it must be FINISHED, because an unfinished position belongs to the order (rule 1) — a client naming one is
 *     asking to choose its next drill, which is the request the order exists to refuse;
 *   - it must NOT be PASSED, because a pass is monotone and there is nothing left for a reattempt to earn. Allowing it
 *     would also reopen the one thing the board's "best per player per board" rule is guarding: an endless replay of a
 *     favourite drill (§6).
 *
 * THE ID IS THE POSITION'S OWN (`drillId`), so `finishDrill` finds it in flight and the two paths that close a drill —
 * `POST /drill/advance` and `POST /runs` — need no change at all. `finishDrill` already puts the index in `finished`
 * once and adds the pass when it is earned, which is exactly what a reattempt has to do.
 */
export function replayDrill(
  regime: Regime,
  levelIndex: number,
  progress: DrillProgress,
  index: number,
  nowMs: number,
): ReplayOutcome {
  if (!Number.isInteger(index) || index < 0) {
    return { kind: 'refused', code: 'bad_index', reason: `${JSON.stringify(index)} is not a drill position` };
  }
  const entry = regime.entries[index];
  if (!entry) {
    return { kind: 'refused', code: 'no_entry', reason: `level ${levelIndex} has no drill at position ${index}` };
  }
  if (!progress.finished.includes(index)) {
    return { kind: 'refused', code: 'not_finished', reason: `position ${index} is not finished, so it is reached through the order rather than reattempted` };
  }
  if (progress.passed.includes(index)) {
    return { kind: 'refused', code: 'already_passed', reason: `position ${index} was already passed, so there is nothing for a reattempt to earn` };
  }
  // A SECOND PRESS IS A READ, for the reason `currentDrill` reports `changed`: every reload would otherwise turn a
  // reattempt into a compare-and-set race to record an issue that is already the row's.
  const inFlight = progress.issued;
  if (inFlight && inFlight.replay === true && inFlight.index === index) {
    return { kind: 'drill', drill: inFlight, progress, changed: false };
  }
  const drill: IssuedDrill = {
    id: drillId(levelIndex, index),
    index,
    seed: entry.seed,
    poolVersion: entry.poolVersion,
    scheduleVersion: regime.scheduleVersion,
    issuedAtMs: nowMs,
    replay: true,
  };
  return { kind: 'drill', drill, progress: { ...progress, issued: drill }, changed: true };
}

/** The result of advancing a drill. A refusal carries prose, because the client shows it. */
export type AdvanceOutcome =
  | { readonly kind: 'done'; readonly progress: DrillProgress }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Mark the drill named by `id` finished — RULE 3, and the only place a drill is ever finished.
 *
 * IT REFUSES RATHER THAN GUESSING when the id is not the one issued. The guess available would be "finish the
 * first unfinished entry", which is right for the first advance and WRONG for every repeat of it: the second
 * call would finish the NEXT entry, so a client that retried an advance after a timeout would burn a drill
 * the player never saw. MEASURED in `test/drill-probe.mjs`: the wrong rule takes a player from 2 finished to
 * 4 with one drill played.
 *
 * A REFUSAL WRITES NOTHING, which is what makes the retry safe and is why the refusal is a value rather than
 * a thrown error: there is no state for the caller to have to roll back.
 */
export function finishDrill(progress: DrillProgress, id: string, passed: boolean): AdvanceOutcome {
  const parsed = parseDrillId(id);
  if (!parsed || parsed.levelIndex !== progress.levelIndex) {
    return { kind: 'refused', reason: `${id} is not a drill id for level ${progress.levelIndex}` };
  }
  const issued = progress.issued;
  if (!issued) {
    return { kind: 'refused', reason: 'this player has no drill in flight, so there is nothing to advance' };
  }
  if (issued.id !== id) {
    return { kind: 'refused', reason: `the drill in flight is ${issued.id}, not ${id}` };
  }
  // AN INDEX IS FINISHED ONCE. `finished` is a set of positions that the hint rule, the board and "the first
  // unfinished entry" all read, and a duplicate would inflate a count rather than record a fact — so a position
  // that is somehow handed out twice (a republished schedule, a row written by hand) still lands in it once.
  const finished = progress.finished.includes(issued.index)
    ? [...progress.finished]
    : [...progress.finished, issued.index].sort((a, b) => a - b);
  // PASSED IS DECIDED BY THE CALLER, because only the caller knows WHY the drill closed: a skip and a revealed
  // solve both finish a position, and neither is a pass. A pass is monotone — a position already passed stays
  // passed, and a later skip of the same position cannot take it back.
  const passedAlready = progress.passed.includes(issued.index);
  const passedList = !passed || passedAlready
    ? [...progress.passed]
    : [...progress.passed, issued.index].sort((a, b) => a - b);
  return { kind: 'done', progress: { ...progress, issued: null, finished, passed: passedList } };
}

/**
 * Whether a FINISHED position can be WATCHED — the read behind `GET /drill/replay`.
 *
 * IT IS NOT `replayDrill`, AND THE DIFFERENCE IS THE QUESTION. `replayDrill` above REOPENS a position: it is a write, it
 * makes the position the drill in flight, and it refuses one that was PASSED — "nothing for a reattempt to earn". That
 * refusal is right for an ATTEMPT and wrong for a REWATCH, which is the reported ask: "Allow completed levels to be
 * replayed, not re-solved." So this one asks only whether the position is CLOSED, and answers with what to draw: the
 * entry, and whether the player passed it, so the panel can say which it was rather than pretending a skip was a solve.
 *
 * IT WRITES NOTHING. No `issued`, no revision, no press log — a rewatch that touched the row would be a replay the
 * player could be charged for, which is the opposite of what the block's own cells offer.
 */
export type WatchOutcome =
  | { readonly kind: 'watch'; readonly entry: ScheduleEntry; readonly passed: boolean }
  | { readonly kind: 'refused'; readonly code: string; readonly reason: string };

export function watchDrill(regime: Regime, levelIndex: number, progress: DrillProgress, index: number): WatchOutcome {
  if (!Number.isInteger(index) || index < 0) {
    return { kind: 'refused', code: 'bad_index', reason: `${JSON.stringify(index)} is not a drill position` };
  }
  const entry = regime.entries[index];
  if (!entry) {
    return { kind: 'refused', code: 'no_entry', reason: `level ${levelIndex} has no drill at position ${index}` };
  }
  if (!progress.finished.includes(index)) {
    return { kind: 'refused', code: 'not_finished', reason: `position ${index} is not finished, so there is nothing to watch back` };
  }
  return { kind: 'watch', entry, passed: progress.passed.includes(index) };
}