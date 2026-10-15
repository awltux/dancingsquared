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
  readonly issuedAtMs: number;
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

/** A player with no progress in a level: nothing issued, nothing finished. */
export function emptyProgress(levelIndex: number): DrillProgress {
  return { levelIndex, issued: null, finished: [] };
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
  if (progress.finished.includes(issued.index)) return false;
  return issued.index >= 0;
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
export function finishDrill(progress: DrillProgress, id: string): AdvanceOutcome {
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
  return {
    kind: 'done',
    progress: { ...progress, issued: null, finished: [...progress.finished, issued.index].sort((a, b) => a - b) },
  };
}
