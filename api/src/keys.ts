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
