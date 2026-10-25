// WHICH BOARD A RUN IS ON: the period the leaderboard is read and written under, as a pure rule.
//
// WHY THIS IS ITS OWN MODULE, and the reason is a defect rather than a preference. This rule used to live in
// `main.ts` as a four-line function over module state (`mode`, `serverDrill`, `practiceRun`) and `Date.now()`, which
// nothing outside the screen can call - the app layer is the one part of the game that is NOT probe-loadable, so no
// gate could ask it anything. What it decides is which leaderboard a run lands on:
//
// THE TWO BOARDS MEAN DIFFERENT THINGS BY "PERIOD" (`DESIGN.md` 6), and the SERVER takes it from the caller. A DAILY
// board is ONE UTC DAY - the same `utcDay` the challenge is seeded from, which the client can compute because the day
// IS the challenge. A DRILL board is NOT a calendar month (`DESIGN.md` 15 Q17(vii)): it is the PUBLISHED SET the runs
// land on, and the only place the client can learn which set that is, is the drill the server issued - so it comes
// from the ANSWER, never from a date this app computes.
//
// THAT IS THE MEASURED DEFECT THIS RULE WAS WRITTEN FOR. The shipped version derived the drill's period from
// `seasonOf(Date.now())`, and a drill finished just after a month boundary - or after the publisher replaced a set -
// was ranked on a board its drill did not come from; a set that was EXTENDED moved the denominator under scores
// already on it. The period has to be an INPUT, which is why this function takes it as one.
//
// NULL IS AN ANSWER. With no server-drill in play there is no set to name - an offline practice drill is not on any
// board - and asking for the current month would show an empty board that looks like a real one.
//
// THE PROBE is `game/test/board-period-probe.mjs`: it drives the three cases, and its negative control is the
// day-derived rule above, measured to disagree exactly where the issued set is not that month.

/** The two boards the app reads. A mode, not a date, is what decides the meaning of "period". */
type BoardMode = 'drill' | 'daily';

/**
 * The period string a run of `mode` is ranked under.
 *
 * `day` is `utcDay(now)` and is consulted ONLY in daily mode; `issuedScheduleVersion` is the schedule version of the
 * drill the SERVER issued, or null when none is in play. Both are arguments rather than ambient state: a rule that
 * reads the clock or the module's `serverDrill` cannot be measured, and the drill half must not consult the clock at
 * all (see the header - that is the defect).
 */
export function boardPeriodOf(mode: BoardMode, day: string, issuedScheduleVersion: string | null): string | null {
  if (mode === 'daily') return day;
  return issuedScheduleVersion;
}
