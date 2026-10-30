// The imported ledger: runs a device recorded BEFORE it had an account (DESIGN.md 11.1, A26).
//
// WHY THEY ARE HISTORY AND NOT RESULTS. A run the server never issued, never timed and never verified cannot be
// ranked: it has no Progress row to check, no window to measure and no recorded presses to count, so the only
// honest thing to do with it is to KEEP it and let it count for NOTHING — no board entry, no hint credit, no
// finished drill. That is the amendment decision 6 needed: "the anonymous ledger is kept, and it buys no standing"
// (§11.1 A26). A server that scored these would be handing out places on a board for numbers it cannot check.
//
// THE ROW IS WRITTEN ONCE AND NEVER UPDATED. `runId` is the device's own id and it is the key, so a retry is free:
// the second import of the same run finds the row present and SKIPS it, and a second import claiming a higher score
// for that id changes nothing. That is what stops the import from being a way to overwrite history with a better
// story — MEASURED in `api/test/history-probe.mjs`.
//
// IT IS ALSO BOUNDED, in three places, because a client writes this body: how many runs one call may carry, how
// long the transcript may be, and which fields must be real numbers. Everything else is dropped rather than
// stored, so a hand-built body cannot put a novel in the table.
import type { StoredItem } from './ports.ts';

/** How many runs one import may carry. A device's offline ledger is small, and a body is not a backup. */
export const MAX_IMPORTED_RUNS = 200;

/**
 * The longest transcript one imported run may name. It is a sanity bound on an IMPORTED row — a device's own record, not a
 * played run — and not a playing rule: a run has no call limit (REPORTED: "Remove the move limit").
 */
const MAX_IMPORTED_CALLS = 64;

/** One imported run, as the row stores it: the device's own words, marked as unverified and never scored. */
export interface HistoryRun {
  readonly runId: string;
  readonly mode: 'drill' | 'daily';
  readonly levelIndex: number;
  readonly score: number;
  readonly elapsedSeconds: number;
  readonly hintsUsed: number;
  readonly calls: readonly string[];
  readonly date: string | null;
  /** When the SERVER took the import, which is the only time this row can honestly claim. */
  readonly importedAtMs: number;
}

/** A stored row as an imported run, or null when it is not one this build can read. */
export function asHistoryRun(stored: StoredItem): HistoryRun | null {
  const value = stored.value as Record<string, unknown>;
  if (typeof value.runId !== 'string' || value.runId === '') return null;
  if (value.mode !== 'drill' && value.mode !== 'daily') return null;
  if (typeof value.levelIndex !== 'number' || typeof value.score !== 'number' || typeof value.elapsedSeconds !== 'number' || typeof value.hintsUsed !== 'number') return null;
  if (typeof value.importedAtMs !== 'number') return null;
  if (!Array.isArray(value.calls)) return null;
  return {
    runId: value.runId,
    mode: value.mode,
    levelIndex: value.levelIndex,
    score: value.score,
    elapsedSeconds: value.elapsedSeconds,
    hintsUsed: value.hintsUsed,
    calls: value.calls as string[],
    date: typeof value.date === 'string' ? value.date : null,
    importedAtMs: value.importedAtMs,
  };
}

export function asHistoryItem(run: HistoryRun): Record<string, unknown> {
  return {
    runId: run.runId,
    mode: run.mode,
    levelIndex: run.levelIndex,
    score: run.score,
    elapsedSeconds: run.elapsedSeconds,
    hintsUsed: run.hintsUsed,
    calls: [...run.calls],
    date: run.date,
    importedAtMs: run.importedAtMs,
    // THE MARK IS PART OF THE ROW, not something a reader has to remember: every row in this partition is history,
    // and saying so on the row is what stops a later endpoint from treating one as a result.
    unverified: true,
  };
}

interface LedgerRefusal {
  readonly code: string;
  readonly message: string;
}

/**
 * The imported runs a body carries, or the refusal to return.
 *
 * THE FIRST BAD ENTRY REFUSES THE WHOLE CALL rather than being dropped: a partial import would leave the device and
 * the server disagreeing about what was kept, and the client's job is to send what it has. The refusals name the
 * index, because "run 7 has no runId" is actionable and "the ledger is invalid" is not.
 */
export function parseLedger(body: unknown): { ok: true; runs: readonly Omit<HistoryRun, 'importedAtMs'>[] } | { ok: false; refusal: LedgerRefusal } {
  const raw = (body as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(raw)) return { ok: false, refusal: { code: 'bad_ledger', message: 'the body must carry a `runs` array' } };
  if (raw.length === 0) return { ok: false, refusal: { code: 'bad_ledger', message: 'the ledger is empty, so there is nothing to import' } };
  if (raw.length > MAX_IMPORTED_RUNS) {
    return { ok: false, refusal: { code: 'ledger_too_long', message: `one import may carry at most ${MAX_IMPORTED_RUNS} runs, and this carries ${raw.length}` } };
  }
  const runs: Omit<HistoryRun, 'importedAtMs'>[] = [];
  for (let index = 0; index < raw.length; index++) {
    const entry = raw[index] as Record<string, unknown>;
    if (typeof entry !== 'object' || entry === null) return { ok: false, refusal: { code: 'bad_run', message: `run ${index + 1} is not an object` } };
    if (typeof entry.runId !== 'string' || entry.runId === '') return { ok: false, refusal: { code: 'bad_run', message: `run ${index + 1} has no runId` } };
    if (entry.mode !== 'drill' && entry.mode !== 'daily') return { ok: false, refusal: { code: 'bad_run', message: `run ${index + 1} is neither a drill nor a daily` } };
    if (typeof entry.levelIndex !== 'number' || !Number.isInteger(entry.levelIndex) || entry.levelIndex < 1) {
      return { ok: false, refusal: { code: 'bad_run', message: `run ${index + 1} has no level index` } };
    }
    for (const field of ['score', 'elapsedSeconds', 'hintsUsed'] as const) {
      const value = entry[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return { ok: false, refusal: { code: 'bad_run', message: `run ${index + 1} has no usable ${field}` } };
      }
    }
    // ABSENT CALLS ARE TOLERATED AND A MALFORMED FIELD IS NOT: a device that never kept the transcript still has a
    // run worth keeping, but `calls: "Boys Run"` is a body built wrong and importing it would store a string where
    // the row's shape says a list.
    if (entry.calls !== undefined && !Array.isArray(entry.calls)) {
      return { ok: false, refusal: { code: 'bad_run', message: `run ${index + 1} has calls that are not a list` } };
    }
    const calls = Array.isArray(entry.calls) ? entry.calls : [];
    if (calls.length > MAX_IMPORTED_CALLS) {
      return { ok: false, refusal: { code: 'bad_run', message: `run ${index + 1} names ${calls.length} calls, and at most ${MAX_IMPORTED_CALLS} may be imported` } };
    }
    if (!calls.every((call) => typeof call === 'string')) return { ok: false, refusal: { code: 'bad_run', message: `run ${index + 1} has a call that is not a name` } };
    runs.push({
      runId: entry.runId,
      mode: entry.mode,
      levelIndex: entry.levelIndex,
      score: entry.score as number,
      elapsedSeconds: entry.elapsedSeconds as number,
      hintsUsed: entry.hintsUsed as number,
      calls: calls as string[],
      date: typeof entry.date === 'string' ? entry.date : null,
    });
  }
  return { ok: true, runs };
}
