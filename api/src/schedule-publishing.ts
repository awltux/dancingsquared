// The Drill's regime, authored: which seeds a level's season is, and writing the ones that validate.
//
// WHAT THE PIPELINE IS FOR, in DESIGN.md 7.2: "The schedule is code-adjacent data, so it needs the gate every
// generated artefact in this repository needs", and "the lint re-runs the generator rather than trusting the
// author's memory". So a season is GENERATED and every entry is validated by regenerating it, and a level whose
// season cannot be filled is reported rather than published short.
//
// THE ORDER IS THE CONTRACT, and so is the PREFIX. Seeds are scanned from `firstSeed` upward and taken in order,
// which makes the season a deterministic function of `(poolVersion, level, length)` — two consequences that are
// both wanted: re-running the publisher is a no-op, and a LONGER season has the shorter one as its prefix, so
// extending a season cannot rewrite a drill that was already handed out (§8: "a schedule edit cannot rewrite a
// drill already handed out").
//
// WHY THE SEASON LENGTH IS STILL AN OPTION. §15 Q3 recommends "one new drill per day per level and a season of a
// fixed number of drills"; Q17 then fixed what that number IS — a level is `LEVEL_SIZE` (100) drills, because a
// level is a 10x10 block and finishing all of it is what promotes a player — so the tool's default is now that
// number rather than 31, and the flag remains for a deliberately shorter run (a probe, a first look at the cost).
// THE TWO SIDES READ THE SAME CONSTANT and that is the point of it: the publisher fills to `LEVEL_SIZE` and
// `api/src/ladder.ts` promotes at `LEVEL_SIZE`, so "this level is full" cannot mean two different things.
import { MAIN_POOL, POOL_VERSION, generatorConfigFor, lintSchedule, type ScheduleEntry } from 'dancing-squared-game';
import { levelAt, publishableLevels, puzzleFor, runtimeFor } from './levels.ts';
import { scheduleKey } from './keys.ts';
import type { ItemStore } from './ports.ts';

/**
 * The levels the app serves today: 1 to 3.
 *
 * NOT ALL 33 THE CORPUS CAN FILL, AND THE REASON IS MEASURED, NOT CHOSEN. DESIGN.md 7.1 pins generation cost per
 * level: 460 ms at L1 and up to 4959 ms at L23, with L25-L30 at 3.3-4.9 s. A 31-drill season is therefore ~3.2 s
 * at level 1 (MEASURED: 40 seeds at 104 ms each, none refused) and ~2.5 MINUTES per deep level — so "publish
 * every level" is an hour of work for shelves nothing plays yet. Levels 1-3 are also the part of the ladder
 * `schedule-fixture.ts` names as the one that always generates, which is what the app has been played on.
 */
export const SERVED_LEVELS: readonly number[] = [1, 2, 3];

/** How many seeds beyond what was asked for the scan will try before giving up on a level. See `generateSeason`. */
export const SCAN_PATIENCE = 10;

/** The version stamped on a published season. */
export function seasonVersion(poolVersion: string, season: number): string {
  return `${poolVersion}-season${season}`;
}

/** A level's season: the entries, and the seeds the scan skipped on the way (reported, never silent). */
export interface Season {
  readonly levelIndex: number;
  readonly entries: ScheduleEntry[];
  readonly skipped: { seed: number; reason: string }[];
  readonly attempts: number;
}

/**
 * Scan for a level's season, validating every candidate by GENERATING it.
 *
 * `accepts` IS A SEAM FOR THE SKIP RULE, and it exists because the rule cannot otherwise be measured: MEASURED,
 * seeds 1..40 at level 1 all generate (0 refusals, 104 ms each), so no affordable range contains a refusal to
 * demonstrate with. A probe drives the skip with a predicate that refuses a named seed, while the real generator
 * is measured separately by generating a short season for real — the rule with a stub, the arithmetic with the
 * thing itself.
 *
 * THE SCAN IS BOUNDED, and it has to be: a level whose pool cannot produce a valid puzzle would otherwise spin
 * forever. `SCAN_PATIENCE` attempts per entry requested is not a tuned number — it is a ceiling on a scan that
 * measured zero refusals per 40 candidates at the cheapest level, and hitting it is a finding to report.
 */
export function generateSeason(
  levelIndex: number,
  options: { season: number; poolVersion?: string; firstSeed?: number; accepts?: (seed: number) => { ok: true } | { ok: false; reason: string } },
): Season {
  const poolVersion = options.poolVersion ?? POOL_VERSION;
  const level = levelAt(levelIndex);
  const accepts = options.accepts ?? ((seed: number) => puzzleFor(seed, level));
  const limit = options.season * SCAN_PATIENCE;
  const entries: ScheduleEntry[] = [];
  const skipped: { seed: number; reason: string }[] = [];
  let seed = options.firstSeed ?? 1;
  let attempts = 0;

  while (entries.length < options.season && attempts < limit) {
    attempts++;
    const verdict = accepts(seed);
    if (verdict.ok) entries.push({ seed, levelIndex, poolVersion });
    else skipped.push({ seed, reason: verdict.reason });
    seed++;
  }
  return { levelIndex, entries, skipped, attempts };
}

/**
 * The design's own lint, on the season as it would be published.
 *
 * TWO MODES, AND THE TOOL USES THE CHEAP ONE. `verify: true` re-generates EVERY entry, which is the gate §7.2
 * describes ("every seed in the schedule passes the §7 quality gates for its level, or the build fails") — but
 * `generateSeason` has already generated each seed to accept it, so a publish that generated everything twice
 * would double a cost measured in minutes. The tool runs the STRUCTURAL checks (`verify: false`: empty, unknown
 * level, duplicate, pool mismatch) and a probe runs the full one on a short season, which is where the expensive
 * proof belongs.
 */
export function lintSeason(entries: readonly ScheduleEntry[], levelIndex: number, verify: boolean): string[] {
  const level = levelAt(levelIndex);
  const config = generatorConfigFor(POOL_VERSION, level, 'drill');
  const findings = lintSchedule(entries, config, (index) => runtimeFor(levelAt(index)).applier, { verify });
  return findings.map((finding) => `${finding.index < 0 ? 'schedule' : `entry ${finding.index}`}: ${finding.reason}`);
}

/**
 * Write a level's season, replacing what is there.
 *
 * REPLACED IN FULL, which is why the row carries a version and why an issued drill copies its own seed into the
 * player's progress row rather than reading it back out of here (§8). A read-modify-write that converges: the
 * value does not depend on what was there, so a loser of the race writes the same bytes on its next attempt.
 */
export async function publishSeason(store: ItemStore, levelIndex: number, entries: readonly ScheduleEntry[], version: string): Promise<void> {
  const key = scheduleKey(levelIndex);
  const value = { scheduleVersion: version, entries };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await store.get(key);
    if (await store.put(key, value, current?.rev ?? null)) return;
  }
  throw new Error(`could not publish ${key.pk}: another writer kept winning`);
}

/** Whether the corpus can fill this level's pool — ONE definition, in `levels.ts`, shared with the Daily's job. */
export function levelIsPublishable(levelIndex: number): boolean {
  return publishableLevels().includes(levelIndex);
}


