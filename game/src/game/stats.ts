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
interface Streak {
  days: number;
  today: boolean;
}

/** The device's own totals. Every field is derived from the records; nothing is stored separately. */
interface Stats {
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

/**
 * THE DRILL TOTAL THE HEADER SHOWS.
 *
 * THE SERVER'S NUMBER WINS WHENEVER THE APP HAS ONE. It is the account's ranked total for the level and set — the same
 * figure the post-run note prints and the board page ranks — and the device's own sum is a DIFFERENT quantity: it
 * includes demo, practice and revealed runs the server never counts, and it is computed from the most recent
 * `MAX_SAVED_RUNS` records, so it can go DOWN when one is evicted. Two running totals on one screen is the confusion
 * REPORTED as "The scoring system seems a little confused. The header shows 215 but the response ... reads 34/100 ...
 * Board: 1307 over 21 run(s)".
 *
 * THE FALLBACK IS THE DEVICE'S SUM, for a signed-out player or a server too old to send the board: it is the only total
 * there is then, and the ledger line beside it says what this device keeps.
 *
 * `0` IS A REAL SERVER TOTAL and must not be read as absent — a signed-in player with no ranked runs on this set has
 * zero, and a demo-inflated device sum would be a worse answer than zero. Only a NaN or a negative (a malformed
 * answer) falls back.
 */
export function drillTotalFor(serverTotal: number | null, runs: readonly RunRecord[]): number {
  if (serverTotal !== null && Number.isFinite(serverTotal) && serverTotal >= 0) return serverTotal;
  return runs.reduce((sum, run) => (run.mode === 'drill' ? sum + run.score : sum), 0);
}

/**
 * WHAT A DRILL ANSWER DOES TO THE TOTAL THE HEADER ALREADY KNOWS.
 *
 * A DRILL READ CARRIES THE PLAYER'S BOARD, OR NOTHING. The two must not be read alike, and treating "nothing" as "no
 * total" is what REPORTED: "When I pass a drill, the score in the header is updated. But as soon as I leave that screen
 * the score reverts back to a number I don't recognise." Leaving the drill screen re-issues a drill; a build whose read
 * does not carry the board (an older server, or a row it could not read) had the shell assign null, so the header fell
 * back to the device's own sum — a different quantity, and the unrecognised number.
 *
 *   - A TOTAL PRESENT: it wins, INCLUDING ZERO (a real answer: no ranked runs on this set).
 *   - NO TOTAL, AND THE ANSWER IS A DEMO: forget it. A signed-out caller's board is not this player's, so the device's
 *     own sum is the honest fallback.
 *   - NO TOTAL, AND THE ANSWER IS NOT A DEMO: the server did not say — which is NO NEWS, not NO SCORE. The last known
 *     total is kept, because replacing it with a different quantity is the revert this rule exists to prevent.
 */
export function adoptedDrillTotal(known: number | null, boardScore: number | null, demo: boolean): number | null {
  if (boardScore !== null) return boardScore;
  if (demo) return null;
  return known;
}
