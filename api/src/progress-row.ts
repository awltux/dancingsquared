// The Progress row: its shape on the wire to the store, and the strict reading of it.
//
// ONE HOME FOR A ROW SHAPE. These two functions lived in `handlers/drill.ts` until the run handler needed to
// read the same row — and two readers of one row is two parsers waiting to disagree about what a bad row is.
// The rule is the same one the schedule answers to: a row this build cannot read is REFUSED rather than
// silently emptied, because "the player has no progress" and "the player's progress is unreadable" are
// different facts and only one of them is safe to act on.
import type { StoredItem } from './ports.ts';
import { emptyProgress, type DrillProgress, type IssuedDrill } from './drill-regime.ts';

/** A stored row as progress, or null when it is not one this build can read. Absent reads as a fresh record. */
export function asProgress(stored: StoredItem | null, levelIndex: number): DrillProgress | null {
  if (!stored) return emptyProgress(levelIndex);
  const value = stored.value as { levelIndex?: unknown; issued?: unknown; finished?: unknown };
  if (value.levelIndex !== levelIndex || !Array.isArray(value.finished)) return null;
  for (const index of value.finished) if (typeof index !== 'number') return null;
  if (value.issued === null || value.issued === undefined) {
    return { levelIndex, issued: null, finished: value.finished as number[] };
  }
  const raw = value.issued as { id?: unknown; index?: unknown; seed?: unknown; poolVersion?: unknown; issuedAtMs?: unknown };
  if (typeof raw.id !== 'string' || typeof raw.index !== 'number' || typeof raw.seed !== 'number'
    || typeof raw.poolVersion !== 'string' || typeof raw.issuedAtMs !== 'number') return null;
  const issued: IssuedDrill = { id: raw.id, index: raw.index, seed: raw.seed, poolVersion: raw.poolVersion, issuedAtMs: raw.issuedAtMs };
  return { levelIndex, issued, finished: value.finished as number[] };
}

/** The stored form of a progress record. */
export function asProgressItem(progress: DrillProgress): Record<string, unknown> {
  return { levelIndex: progress.levelIndex, issued: progress.issued, finished: progress.finished };
}
