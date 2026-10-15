// The Daily Challenge's IDENTITY: which puzzle a level is issued on a given day, and nothing else.
//
// WHY THIS IS A PURE FUNCTION AND NOT A STORED PUZZLE. DESIGN.md 7: a puzzle is derivable from
// `(seed, level, poolVersion)`, so publishing a Daily is publishing a number. That is what makes the
// challenge the SAME challenge for everyone at a level without a table of boards, and it is why
// "past dailies stay playable" (DESIGN.md 9) costs nothing: every day's seed still resolves forever.
//
// THE DAY IS UTC, and the whole mode depends on it. A local-date rule would give two players on the same
// call a different challenge for the same calendar day, which is the one thing "issued to everyone at
// this level" forbids. `utcDay` therefore reads `toISOString` and never the local clock.
//
// THE SEED BINDS THE LEVEL, because the same date must be a DIFFERENT puzzle at a different poolSize:
// `generatePuzzle` draws its pool from `level.poolSize`, so the level is part of the question's identity
// (DESIGN.md 9). The pool VERSION is deliberately NOT hashed: it travels beside the seed on the entry,
// exactly as a schedule entry carries it, and a pool change invalidates the entry by version rather than
// by silently producing a different puzzle under an old seed (DESIGN.md 7).

import type { LevelSpec, ScheduleEntry } from './types.ts';

/** A `YYYY-MM-DD` day, which is the only shape this module ever publishes. */
const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The UTC day an instant falls in, as `YYYY-MM-DD`.
 *
 * `toISOString` IS THE RULE, not a convenience: it is the UTC reading of the instant, so the answer does
 * not depend on where the player or the server is standing. MEASURED: `2026-10-15T23:30:00Z` is the 15th
 * here and the 16th on a host at UTC+01:00 (this repository's development host), which is the difference
 * the mode cannot survive — `game/test/daily-probe.mjs` measures the host's own offset and says so when
 * it is zero, because on a UTC host a local-clock bug is invisible rather than absent.
 *
 * A DATE HAS NO TIMEZONE UNTIL IT IS READ, so the caller passes the instant it means (a `new Date()` for
 * "now", or a constructed one for a test) and gets the day that instant is in.
 */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Whether `day` is a real `YYYY-MM-DD` day.
 *
 * THE ROUND-TRIP IS THE SECOND HALF, and it is not pedantry: `2026-02-30` matches the shape and is not a
 * day, and a hash of a nonsense day is a challenge nobody can reason about — a player would see a Daily
 * that never appears again on any calendar.
 */
export function isUtcDay(day: string): boolean {
  if (!DAY_SHAPE.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/**
 * FNV-1a, 32-bit, as an unsigned integer.
 *
 * WHY THIS HASH: `generatePuzzle` seeds its rng with this number, so it has to be a fixed 32-bit value
 * that both sides compute identically. FNV-1a is five lines, has no dependency, and is specified down to
 * the prime — a `Math.imul` keeps each multiply inside 32 bits, where `hash * 16777619` would exceed
 * 2^53 and start dropping low bits, which would make the seed depend on the engine's float behaviour.
 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The seed for one level on one day.
 *
 * TOTAL OVER ITS INPUT rather than validating, because this is arithmetic: `dailyEntry` below is the
 * published thing and is where the day's shape is checked. The separator is `#` so that a day and a level
 * cannot collide by concatenation (`2026-1` + `01` vs `2026-10` + `1` are different inputs here).
 */
export function dailySeed(levelIndex: number, day: string): number {
  return fnv1a(`${day}#${levelIndex}`);
}

/**
 * The entry the serving layer issues for a level on a day.
 *
 * A `ScheduleEntry`, deliberately: the Daily and the Drill are both "a seed, a level and a pool version",
 * and DESIGN.md 9 makes exactly that claim — so the type that carries a published Drill carries a
 * published Daily, and a mismatch between them cannot be represented.
 *
 * THROWS ON A MALFORMED DAY rather than hashing it into a mystery challenge. The only producer in the app
 * is `utcDay`, so reaching this is a bug in the caller and is worth a loud failure (AGENTS.md 4.5: no
 * silent branch nobody checked).
 */
export function dailyEntry(level: LevelSpec, poolVersion: string, day: string): ScheduleEntry {
  if (!isUtcDay(day)) throw new Error(`${JSON.stringify(day)} is not a UTC day (expected YYYY-MM-DD)`);
  return { seed: dailySeed(level.index, day), levelIndex: level.index, poolVersion };
}
