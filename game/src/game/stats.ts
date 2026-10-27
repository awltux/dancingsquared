// WHAT THE DEVICE'S OWN RECORD ADDS UP TO: A STREAK, A COUNT, A BEST AND A MEAN.
//
// WHY. REPORTED: "I think its time to make the UI more gamified, attractive and captivating." The retention loop a game
// like this lives on is "did you play today, and how many days in a row" — Wordle's one-a-day and Duolingo's streak are the
// same idea — and the device already holds everything needed to answer it: `store.ts`'s `RunRecord[]` carries the mode, the
// DAY the server published a Daily for, the score, the elapsed time, the hints and the attempts. So this is arithmetic over
// records that already exist: NO schema change, NO new field, and nothing invented from a server this module cannot see.
//
// IT COUNTS DISTINCT DAYS, NOT RUNS. Two solves on one day are one day of a streak; a run recorded twice (the store dedupes
// on `runId`, but a hand-edited record need not) is still one day. That is the rule a `runs.filter(...).length` gets
// wrong, and `stats-probe.mjs` pins it against exactly that mistake.
//
// A STREAK THAT ENDED YESTERDAY IS STILL ALIVE TODAY. The day is not over until it is over, so `statsFor` counts back from
// TODAY when there is a Daily solved today, and from YESTERDAY when there is not — a player who has not played yet still
// has their streak. Missing both makes it zero, which is the only honest answer: nothing on this device says they intend
// to continue.
//
// DAYS ARE CALENDAR DATES, COMPARED IN UTC. The `day` string is the SERVER's `YYYY-MM-DD` (DESIGN.md §9: the Daily is
// published for a level and a day), so it is a plain date, not a moment; stepping from one to the previous one through
// `Date.UTC` keeps that true across a month, a year and a leap day, where a local `setDate(-1)` would drift by an hour and
// lose a day twice a year in a timezone with DST.

import type { RunRecord } from './store.ts';

/** How many days running the Daily has been solved, and whether that includes today. */
export interface Streak {
  days: number;
  today: boolean;
}

/** The device's own totals. Every field is derived from the records; nothing is stored separately. */
export interface Stats {
  streak: Streak;
  /** Drill runs recorded — one per solved drill, which is what "x drills" means to the player. */
  drills: number;
  /** The best single run, or null with no runs at all. */
  best: number | null;
  /** Mean time on the clock over every recorded run, or null with none. */
  meanSeconds: number | null;
}

/** `YYYY-MM-DD` shifted by `days`, through UTC so a calendar date stays a calendar date. */
export function shiftDay(day: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/** The distinct days a Daily was solved on, newest first. A record with no `day` is not a Daily. */
function dailyDays(runs: readonly RunRecord[]): string[] {
  const seen = new Set<string>();
  for (const run of runs) {
    if (run.mode !== 'daily' || typeof run.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(run.day)) continue;
    seen.add(run.day);
  }
  return [...seen].sort().reverse();
}

/**
 * The streak that ends at `today`, or at yesterday when today has not been played.
 *
 * It walks back one day at a time and STOPS at the first gap — a streak is a run of days, not a count of them, which is
 * why sorting the days and counting the difference would be a different (and wrong) answer.
 */
function streakOf(days: readonly string[], today: string): Streak {
  if (days.length === 0) return { days: 0, today: false };
  const has = new Set(days);
  const playsToday = has.has(today);
  let cursor = playsToday ? today : shiftDay(today, -1);
  if (!has.has(cursor)) return { days: 0, today: false };
  let count = 0;
  while (has.has(cursor)) {
    count++;
    cursor = shiftDay(cursor, -1);
  }
  return { days: count, today: playsToday };
}

/** The device's totals, for the record it was given. */
export function statsFor(runs: readonly RunRecord[], today: string): Stats {
  const days = dailyDays(runs);
  const drills = runs.filter((run) => run.mode === 'drill').length;
  const best = runs.length === 0 ? null : Math.max(...runs.map((run) => run.score));
  const meanSeconds = runs.length === 0
    ? null
    : runs.reduce((total, run) => total + run.elapsedSeconds, 0) / runs.length;
  return { streak: streakOf(days, today), drills, best, meanSeconds };
}
