// THE DEVICE'S TOTALS, PINNED — the streak's calendar arithmetic above all.
//
// REPORTED: "I think its time to make the UI more gamified, attractive and captivating." The retention loop is "did you
// play today, and how many days running" (Wordle's one-a-day, Duolingo's streak), and the device already holds the records
// that answer it — `store.ts`'s `RunRecord[]`, with the DAY the server published a Daily for. `game/src/game/stats.ts` adds
// them up; this probe pins the four things a streak gets wrong:
//
//   1. OUT OF ORDER AND WITH GAPS. A streak is a RUN of days, not a count: three records on Monday, Wednesday and Friday
//      are three days played and a streak of one. The naive `runs.filter(...).length` fails that.
//   2. DISTINCT DAYS, NOT RUNS. Two solves on one day are one day. That is the specific mistake the `byRunCount` control
//      below makes, and it is caught here and nowhere else.
//   3. THE STREAK SURVIVES UNTIL THE DAY ENDS. A player who solved yesterday and has not played yet today still has their
//      streak; if they also missed yesterday, it is zero. The `today` flag says which of the two it is.
//   4. CALENDAR ARITHMETIC ACROSS A MONTH, A YEAR AND A LEAP DAY, in UTC. MEASURED: a local `setDate(-1)` step loses or
//      repeats a day around DST in a zone that has it, which would break a streak for a player who played every day.
//
// The other three fields are simpler but are pinned with it: `drills` counts drill records, `best` is the maximum score,
// and `meanSeconds` is the mean time — each null or zero from an empty record rather than NaN.
//
// AND WHICH TOTAL THE HEADER SHOWS (section 7): `drillTotalFor` prefers the SERVER's ranked board total and falls back
// to this device's own sum, because the two are different quantities and showing both was the reported confusion.
//
// Usage: node game/test/stats-probe.mjs   (pure arithmetic over records; no engine, no DOM, no clock)
import { drillTotalFor, statsFor, shiftDay } from '../src/game/stats.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

let counter = 0;
/** A run record, defaulting to a solved Daily today; overrides say what the case is about. */
const run = (over = {}) => ({
  runId: `r${counter++}`,
  mode: 'daily',
  levelIndex: 1,
  poolVersion: 'ms-8',
  seed: 42,
  day: '2026-10-15',
  elapsedSeconds: 30,
  attempts: 0,
  score: 100,
  scoreVersion: 1,
  recordedAtMs: 0,
  ...over,
});
const drill = (over = {}) => run({ mode: 'drill', day: undefined, ...over });
const TODAY = '2026-10-15';

console.log('\n== 1. an empty record is zeroes, not NaNs ==');
{
  const stats = statsFor([], TODAY);
  check(stats.streak.days === 0 && stats.streak.today === false, 'no record is no streak');
  check(stats.drills === 0, 'and no drills');
  check(stats.best === null && stats.meanSeconds === null, 'with null best and mean rather than 0 or NaN');
}

console.log('\n== 2. a streak is a run of days ==');
{
  const three = statsFor([
    run({ day: TODAY }),
    run({ day: '2026-10-14' }),
    run({ day: '2026-10-13' }),
  ], TODAY);
  check(three.streak.days === 3 && three.streak.today === true, `today and the two before it is 3 (${three.streak.days})`);
  // A GAP ENDS IT: Sunday and today are two days played and a streak of one.
  const gapped = statsFor([run({ day: TODAY }), run({ day: '2026-10-11' })], TODAY);
  check(gapped.streak.days === 1, `a two-day gap makes the streak one (${gapped.streak.days})`);
  // NEGATIVE CONTROL: counting records instead of consecutive days would call the gap a streak of two.
  const byRunCount = (runs) => runs.filter((r) => r.mode === 'daily').length;
  check(byRunCount([run({ day: TODAY }), run({ day: '2026-10-11' })]) === 2 && gapped.streak.days === 1,
    'a record-count would say 2 where the streak is 1 — the control');
  // ORDER IS NOT THE RECORD'S JOB: the same three days in a shuffled order are the same streak.
  const shuffled = statsFor([
    run({ day: '2026-10-13' }),
    run({ day: TODAY }),
    run({ day: '2026-10-14' }),
  ], TODAY);
  check(shuffled.streak.days === 3, 'the order the records arrive in does not matter');
}

console.log('\n== 3. distinct days, not runs ==');
{
  const twiceToday = statsFor([run({ day: TODAY }), run({ day: TODAY }), run({ day: '2026-10-14' })], TODAY);
  check(twiceToday.streak.days === 2, `two solves today plus one yesterday is 2 days (${twiceToday.streak.days})`);
  check(statsFor([run({ day: TODAY })], TODAY).streak.today === true, 'today is reported as played');
  // A DAILY RECORD WITH NO DAY IS NOT A DAILY: it cannot be placed on the calendar, so it cannot extend a streak.
  const noDay = statsFor([run({ day: TODAY }), run({ day: undefined }), run({ day: 'not-a-day' })], TODAY);
  check(noDay.streak.days === 1, `a record with no usable day is ignored (${noDay.streak.days})`);
  // DRILLS ARE NOT DAILIES: a hundred drills do not make a streak.
  check(statsFor([drill(), drill()], TODAY).streak.days === 0, 'drills do not count towards the Daily streak');
}

console.log('\n== 4. a streak survives until the day ends ==');
{
  const notTodayYet = statsFor([run({ day: '2026-10-14' }), run({ day: '2026-10-13' })], TODAY);
  check(notTodayYet.streak.days === 2 && notTodayYet.streak.today === false,
    `yesterday and the day before is still a streak of 2, not yet played today (${notTodayYet.streak.days})`);
  const stale = statsFor([run({ day: '2026-10-13' })], TODAY);
  check(stale.streak.days === 0, `a run two days ago is not a streak (${stale.streak.days})`);
  // A FUTURE DAY IS NOT A STREAK EITHER: a device clock behind the server's would otherwise manufacture one.
  const future = statsFor([run({ day: '2026-10-16' })], TODAY);
  check(future.streak.days === 0, 'tomorrow alone is not a streak');
}

console.log('\n== 5. calendar arithmetic, in UTC ==');
{
  check(shiftDay('2026-10-15', -1) === '2026-10-14', 'one day back');
  check(shiftDay('2026-10-01', -1) === '2026-09-30', 'across a month boundary');
  check(shiftDay('2026-01-01', -1) === '2025-12-31', 'across a year boundary');
  check(shiftDay('2024-03-01', -1) === '2024-02-29', 'across a leap day');
  check(shiftDay('2026-03-01', -1) === '2026-02-28', 'and a non-leap February');
  check(shiftDay('2026-10-25', -1) === '2026-10-24' && shiftDay('2026-03-29', -1) === '2026-03-28',
    'the two European DST change dates step by exactly one day');
  check(shiftDay('not-a-day', -1) === 'not-a-day', 'a string that is not a day is returned unchanged rather than throwing');
  // A STREAK THAT CROSSES NEW YEAR, through the same functions the module uses.
  const newYear = statsFor([run({ day: '2026-01-01' }), run({ day: '2025-12-31' })], '2026-01-01');
  check(newYear.streak.days === 2, `a streak across New Year is 2 (${newYear.streak.days})`);
}

console.log('\n== 6. the other three totals ==');
{
  const stats = statsFor([
    drill({ elapsedSeconds: 10, score: 50 }),
    drill({ elapsedSeconds: 20, score: 300 }),
    run({ elapsedSeconds: 60, score: 120 }),
  ], TODAY);
  check(stats.drills === 2, `two drill records is 2 drills (${stats.drills})`);
  check(stats.best === 300, `the best is the maximum score, across both modes (${stats.best})`);
  check(stats.meanSeconds === 30, `the mean time is over every run (${stats.meanSeconds})`);
  const one = statsFor([drill({ elapsedSeconds: 12.5, score: 5 })], TODAY);
  check(one.meanSeconds === 12.5, 'a single run means its own time');
  check(one.best === 5 && one.drills === 1, 'and its own score and count');
}

console.log('\n== 7. which drill total the header shows ==');
{
  // TWO DRILLS AND A DAILY: the device's sum counts the DRILL RECORDS only, which is the quantity the header used to
  // show on its own.
  const runs = [drill({ score: 100 }), drill({ score: 34 }), run({ score: 500 })];
  check(drillTotalFor(null, runs) === 134, `without a server the device's drill sum is 134 (${drillTotalFor(null, runs)})`);
  // THE SERVER'S IS A DIFFERENT QUANTITY, and it wins: the account's ranked total on the level and set, which the
  // post-run "Board:" line and the board page both name.
  check(drillTotalFor(1307, runs) === 1307, `the account's ranked total wins when there is one (${drillTotalFor(1307, runs)})`);
  // ZERO IS A REAL ANSWER, not "absent": a signed-in player with no ranked runs on this set has 0, and falling back to
  // the device's demo-inflated sum would print a board score that does not exist.
  check(drillTotalFor(0, runs) === 0, `a zero server total stays zero (${drillTotalFor(0, runs)})`);
  check(drillTotalFor(null, []) === 0 && drillTotalFor(0, []) === 0, 'and an empty device with no server is zero');
  // NEGATIVE CONTROL: the rule this replaces — the device sum alone — answers 134 where the board says 1307. That gap IS
  // the reported confusion ("the header shows 215 ... Board: 1307 over 21 run(s)"), and only this section decides it.
  const deviceOnly = (records) => records.reduce((sum, record) => (record.mode === 'drill' ? sum + record.score : sum), 0);
  check(deviceOnly(runs) === 134 && drillTotalFor(1307, runs) !== deviceOnly(runs),
    'the device-only rule answers the other number, so the choice is real rather than a restatement');
  // AN ANSWER THIS APP CANNOT TRUST FALLS BACK rather than being printed: a non-finite or negative total is malformed.
  check(drillTotalFor(Number.NaN, runs) === 134 && drillTotalFor(-1, runs) === 134,
    'a non-finite or negative server total falls back to the device sum');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
