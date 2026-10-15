// The LOCAL regime: the stand-in for the publishing pipeline, and the same schedule the app plays locally.
//
// WHAT THIS IS NOT. It is not the pipeline of DESIGN.md 7.2 — that is a separate tool, it validates every seed
// with `lintSchedule` before writing anything, and it is a separate commit because it is a separate job (an
// operator action no player can reach). This is the four-entry-per-level FIXTURE the game already ships in
// `src/game/schedule-fixture.ts`, written into the store so a developer can run the API with no AWS, no Docker
// and no publishing step. The dev server calls it at boot; nothing else does.
//
// IT TAKES THE FIXTURE RATHER THAN COPYING IT. The 12 seeds in that file are MEASURED — each generates at its
// declared level and carries an illegal option — and `game/test/schedule-fixture-probe.mjs` re-runs that
// generation, so a second copy here would be a second thing to keep true.
import { LOCAL_SCHEDULE, FIXTURE_POOL_VERSION, type ScheduleFixture } from 'dancing-squared-game/schedule-fixture';
import type { ScheduleEntry } from 'dancing-squared-game';
import type { ItemStore } from './ports.ts';
import { scheduleKey } from './keys.ts';
import type { Regime } from './drill-regime.ts';

/**
 * The fixture's own version string.
 *
 * IT EXISTS BECAUSE THE `Schedule` ITEM CARRIES ONE (DESIGN.md 11): republishing a regime is a new version,
 * and `IssuedDrill` is what keeps a drill already handed out playable across one. It is derived from the
 * fixture's pool version rather than being a second copy of it, so a bumped pool cannot leave this claiming
 * the old one, and it names itself `local-fixture` so a hand-published regime in a development DynamoDB table
 * is distinguishable from it at a glance.
 */
export const LOCAL_SCHEDULE_VERSION = `local-fixture/${FIXTURE_POOL_VERSION}`;

/** The fixture, grouped into one regime per level — which is how the storage and the endpoints take it. */
export function localRegimes(fixture: ScheduleFixture = LOCAL_SCHEDULE): Regime[] {
  const byLevel = new Map<number, ScheduleEntry[]>();
  for (const entry of fixture) {
    const list = byLevel.get(entry.levelIndex) ?? [];
    list.push(entry);
    byLevel.set(entry.levelIndex, list);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, entries]) => ({ scheduleVersion: LOCAL_SCHEDULE_VERSION, entries }));
}


/**
 * Write a regime, replacing the one there.
 *
 * IT REPLACES RATHER THAN REFUSING, and that is the pipeline's behaviour rather than this file's liberty: a
 * level's schedule is one row that the publisher replaces in full, which is exactly why the row carries a
 * version and why an issued drill does not read its seed back out of it.
 */
export async function putRegime(store: ItemStore, levelIndex: number, regime: Regime): Promise<void> {
  const key = scheduleKey(levelIndex);
  const value = { scheduleVersion: regime.scheduleVersion, entries: regime.entries };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await store.get(key);
    if (await store.put(key, value, current?.rev ?? null)) return;
  }
  throw new Error(`could not write ${key.pk}: another writer kept winning`);
}

/** Seed every level of the local fixture, and report which levels now have a regime. */
export async function seedLocalRegimes(store: ItemStore): Promise<number[]> {
  const levels: number[] = [];
  for (const regime of localRegimes()) {
    const levelIndex = regime.entries[0]?.levelIndex;
    if (levelIndex === undefined) continue;
    await putRegime(store, levelIndex, regime);
    levels.push(levelIndex);
  }
  return levels;
}
