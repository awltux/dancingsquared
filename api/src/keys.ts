// The item table's key shapes, in one place.
//
// THE STORAGE CONTRACT IS ONE FILE BECAUSE THREE THINGS BUILD THESE KEYS: the handlers, the local seeding, and
// (in the deployment) the publishing tool. A key spelled twice is a key that can drift into two rows nobody
// notices, because both writes succeed and only a read fails later. Keys are pure functions of the ids, so
// they are also what a probe can write a fixture row with.
import type { ItemKey } from './ports.ts';

/** One player's position in one level's regime — the `Progress` item of DESIGN.md 11's table. */
export const progressKey = (playerId: string, levelIndex: number): ItemKey => ({
  pk: `progress#${playerId}`,
  sk: `level#${levelIndex}`,
});

/** One level's published regime — the `Schedule` item. `current` is the only sort key the pipeline writes. */
export const scheduleKey = (levelIndex: number): ItemKey => ({ pk: `schedule#${levelIndex}`, sk: 'current' });

/**
 * One completed run, keyed by the id the CLIENT minted.
 *
 * THE ID IS THE KEY, WHICH IS WHAT MAKES A RETRY FREE: the run is created inside the same transaction that
 * writes its effects, so a resubmission finds the item present, the transaction is cancelled by its condition,
 * and the handler answers with what was already recorded instead of counting the run twice.
 */
export const runKey = (playerId: string, runId: string): ItemKey => ({ pk: `runs#${playerId}`, sk: `run#${runId}` });

/** A player's hint balance: `hints` and the progress towards the next one (DESIGN.md 10, 11). */
export const hintsKey = (playerId: string): ItemKey => ({ pk: `hints#${playerId}`, sk: 'balance' });

/**
 * One entry on one board, keyed by the board's own partition (DESIGN.md 6).
 *
 * THE PERIOD IS PART OF THE KEY AND IT MEANS TWO DIFFERENT THINGS, which is why the caller passes it: the
 * Daily's board is one UTC day per level (`2026-10-15`), and the Drill's is a SEASON — calendar months, the
 * recommendation in §15 Q4 — so its period is `2026-10`. A season boundary therefore resets the Drill's board
 * by construction rather than by a job that deletes rows.
 */
export const boardKey = (mode: 'drill' | 'daily', levelIndex: number, period: string, playerId: string): ItemKey => ({
  pk: `board#${mode}#${levelIndex}#${period}`,
  sk: `player#${playerId}`,
});

/** One level's published challenge for one UTC day, written by the boundary job (DESIGN.md 11). */
export const publishedDailyKey = (levelIndex: number, day: string): ItemKey => ({ pk: `daily#${levelIndex}`, sk: `date#${day}` });
