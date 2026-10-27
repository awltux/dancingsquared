// WHICH BOARD A RUN IS ON: the period rule, driven as a table.
//
// WHY THIS IS A GATE. The rule decides which leaderboard a run is ranked on, and it lived in `main.ts` - the app layer,
// which is the one part of the game no probe can load - so the only instrument that could have caught the defect it
// was written for was a browser, against a real server, at a month boundary. The defect it WAS written for: the drill
// board's period came from `seasonOf(Date.now())`, so a drill finished just after a month boundary, or after the
// publisher replaced a set, ranked a run on a board its drill did not come from - and a set that was EXTENDED moved
// the denominator under scores already on it. It is `src/puzzle/board-period.ts` now, and this drives it.
//
// THE THREE CASES, and the two ways to get them wrong:
//   daily  -> the UTC day given      (the day IS the challenge, so the client computing it cannot disagree)
//   drill  -> the schedule version the SERVER issued
//   drill, none -> null              (an offline practice drill is on no board; a month would show an empty board that
//                                     looks real)
//
// THE NEGATIVE CONTROLS are the plausible wrong rules, measured rather than asserted:
//   * "the drill period is the day's month" - the rule that shipped. It agrees whenever the run happens to fall in the
//     set's own month, which is why it looked right for a whole season and fails exactly at the boundary.
//   * "no set means the current month" - a fallback that fills the screen with a board nobody is on.
// The first is a ROW-BY-ROW comparison over several witnesses, and the count is printed: one witness would not show
// that the wrong rule is wrong only at the boundary.
//
// THE SHELL is checked as source, and labelled as such: `main.ts` cannot be imported here (it builds DOM, reads
// storage and calls the network), so the check is that the thin `boardPeriod()` passes the ISSUED drill's
// `scheduleVersion` and `utcDay(new Date())`, and derives neither itself.
//
// Usage: node game/test/board-period-probe.mjs   (no engine build needed; the rule imports nothing)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardPeriodOf } from '../src/puzzle/board-period.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('== 1. the three cases ==');
{
  check(boardPeriodOf('daily', '2026-10-15', null) === '2026-10-15', 'a Daily run is ranked on the UTC DAY it was played');
  check(boardPeriodOf('daily', '2026-10-15', '2026-09') === '2026-10-15',
    'and an issued set does not override it - the daily half cannot be talked out of the day it was given');
  check(boardPeriodOf('drill', '2026-10-15', '2026-10') === '2026-10', 'a Drill run is ranked on the schedule version the server ISSUED');
  check(boardPeriodOf('drill', '2026-10-15', null) === null,
    'and with no server-issued drill the answer is NULL - an offline practice drill is on no board, and a month would invent one');
}

console.log('\n== 2. the drill half never reads the clock ==');
{
  // THE WHOLE POINT OF THE EXTRACTION: the day is an ARGUMENT, and drill mode must not touch it. Two days a year apart
  // through the same issued set give one answer.
  const a = boardPeriodOf('drill', '2026-01-01', '2026-10');
  const b = boardPeriodOf('drill', '2026-12-31', '2026-10');
  check(a === b && a === '2026-10', `two days a year apart give the same board when the server issued one set (${a} = ${b})`);
  const days = ['2026-01-01', '2026-06-30', '2026-10-31', '2026-11-01', '2027-02-28'];
  check(new Set(days.map((d) => boardPeriodOf('drill', d, '2026-10'))).size === 1,
    `and over ${days.length} days it answers "${boardPeriodOf('drill', days[0], '2026-10')}" every time, so the clock has no path into the drill half`);
}

console.log('\n== 3. the negative control: the rule that shipped, against the rule ==');
{
  // THE SHIPPED RULE, as a function: the drill period came from the month the run was played in.
  const dayDerived = (day) => day.slice(0, 7);
  const witnesses = [
    ['2026-10-15', '2026-10'],
    ['2026-11-02', '2026-10'],
    ['2026-11-02', '2026-11'],
    ['2026-10-31', '2026-09'],
    ['2027-01-01', '2026-12'],
  ];
  let disagree = 0;
  let agree = 0;
  for (const [day, issued] of witnesses) {
    const right = boardPeriodOf('drill', day, issued);
    const wrong = dayDerived(day);
    if (right === wrong) agree++;
    else disagree++;
  }
  console.log(`     ${witnesses.length} witnesses: the day-derived rule agrees with the shipped rule on ${agree} and DISAGREES on ${disagree}`);
  check(agree > 0 && disagree > 0,
    'the control is not trivially always-wrong: it matches whenever the run falls inside the set\'s own month, which is why it looked right for a season');
  // THE BOUNDARY ITSELF, named: a set published for October that runs into November.
  check(dayDerived('2026-11-02') === '2026-11' && boardPeriodOf('drill', '2026-11-02', '2026-10') === '2026-10',
    'CONTROL: a drill finished on 2026-11-02 under the 2026-10 set is ranked on "2026-10"; the day-derived rule said "2026-11", a board its drill did not come from');
  // AND THE FALLBACK CONTROL: inventing a month when nothing was issued.
  const fallback = (mode, day, issued) => boardPeriodOf(mode, day, issued) ?? dayDerived(day);
  check(fallback('drill', '2026-11-02', null) === '2026-11' && boardPeriodOf('drill', '2026-11-02', null) === null,
    'CONTROL: "no issued set means the current month" fills in "2026-11"; the rule answers null, because that board holds nobody');
}

console.log('\n== 4. the shell: the app layer supplies the two facts and derives neither ==');
{
  // THE APP LAYER IS NOT LOADABLE (DOM, storage, network), so this is a SOURCE check and says so.
  const main = fs.readFileSync(path.join(here, '..', 'src', 'main.ts'), 'utf8');
  const shell = /function boardPeriod\(\): string \| null \{[\s\S]{0,400}?\n\}/.exec(main)?.[0] ?? '';
  check(shell.length > 0, 'the thin `boardPeriod()` shell was found, so the next checks are about it rather than about nothing');
  // THE FIRST ARGUMENT IS A VARIABLE, NOT THE NAME `mode`, SINCE THE APP GREW PAGES. The board is its own page with its
  // own filter (`boardMode`), because a board is a READ and a player who has never opened a drill must still be able to
  // read the Daily board. The property this check exists for is unchanged — three arguments, none of them derived in the
  // shell — so it is pinned by SHAPE rather than by the name of one variable, which was the check that went red when the
  // page landed.
  check(/boardPeriodOf\([A-Za-z_$][\w$]*, utcDay\(new Date\(\)\), issued\?\.scheduleVersion \?\? null\)/.test(shell),
    'it passes a mode, the UTC day and the ISSUED drill\'s schedule version - all three as arguments');
  check(/serverIssued\(\) \? serverDrill : null/.test(shell),
    'and "the issued drill" is the app\'s own predicate, so a practice drill cannot be mistaken for one');
  check(!/seasonOf|\.slice\(0, 7\)/.test(shell), 'and it derives no period of its own: no season and no month arithmetic in the shell');
  check(/from '\.\/puzzle\/board-period\.ts'/.test(main), 'the rule is IMPORTED, so the app cannot carry a second copy of it');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
