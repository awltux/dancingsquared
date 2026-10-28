// WHETHER THE SKIP IS OFFERED, pinned — including the fact that a phone is not a desktop here.
//
// REPORTED: "In mobile view, remove the skip and show-me buttons. They are too easy to warrant this. They must solve them. Also,
// they hide the choices, so very bad UI design." Two reasons, and the probe pins both halves of the answer: the sheet never gets
// the control, and the desktop keeps it under exactly the conditions it had before.
//
// WHAT IS PINNED, and what each check rules out:
//   1. A SHEET IS NOT OFFERED IT, in every identity mode — the one condition that does not care what the server would say.
//   2. A DESKTOP STILL IS, when the server will take the write: this is the asymmetry the owner asked for, and a rule that quietly
//      removed the control everywhere would pass the sheet checks and fail these.
//   3. A REATTEMPT IS NOT SKIPPABLE: the position is already closed, so advancing would close a drill that is already closed.
//   4. A DEMO/UNRANKED CALLER IS NOT OFFERED IT: a skip is a WRITE, and the server refuses every write from a caller it served
//      without a Progress row (`§11.1`, A20). Offline there is no server to ask, so the local ledger's mark is offered.
//
// THE NEGATIVE CONTROLS are the two plausible wrong rules: "a sheet and a desktop are the same" (which fails 1) and "a sheet hides
// only when the server would refuse" (which also fails 1, for the offline case).
//
// Usage: node game/test/skip-offer-probe.mjs   (pure: no DOM, no server, no engine)
import { skipOffered } from '../src/game/skip-offer.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** A ranked desktop run on a server-issued, open drill: the case where the control is offered. */
const base = { serverIssued: true, replay: false, mayWrite: true, configured: true, sheet: false };

console.log('\n== 1. a phone (the sheet layout) is never offered it ==');
{
  const sheet = { ...base, sheet: true };
  check(skipOffered(sheet) === false, 'a ranked, open, server-issued drill on a sheet is NOT skippable');
  check(skipOffered({ ...sheet, mayWrite: false }) === false, 'and neither is a demo one');
  check(skipOffered({ ...sheet, serverIssued: false }) === false, 'nor an offline one');
  check(skipOffered({ ...sheet, serverIssued: false, configured: false }) === false, 'nor the fixture drill with no server configured');
  // THE NEGATIVE CONTROL: the rule that shipped before this change — no sheet condition at all — offers it in two of the four cases
  // above, which is exactly what the report was about.
  const before = (facts) => (facts.serverIssued ? (facts.replay ? false : facts.mayWrite) : !facts.configured);
  check(before(sheet) === true && skipOffered(sheet) === false,
    'CONTROL: the rule without the sheet condition offers the skip on the phone, which is the defect');
}

console.log('\n== 2. a desktop keeps it, and only where it works ==');
{
  check(skipOffered(base) === true, 'a ranked, open, server-issued drill on a desktop IS skippable');
  check(skipOffered({ ...base, mayWrite: false }) === false, 'a demo run is not: the server would refuse the write (A20)');
  check(skipOffered({ ...base, replay: true }) === false, 'a reattempt is not: the position is already closed (Q5)');
  check(skipOffered({ ...base, serverIssued: false, configured: false }) === true,
    'the offline fixture drill is skippable — the local ledger records the mark, and there is no server to ask');
  check(skipOffered({ ...base, serverIssued: false, configured: true }) === false,
    'but a FIXTURE drill on a server-configured page is not: that is a practice run, and it is not the season\'s');
  // THE NEGATIVE CONTROL for this half: "a sheet and a desktop are the same" fails sections 1 and 2 in opposite directions.
  const noSheet = (facts) => skipOffered({ ...facts, sheet: false });
  check(noSheet({ ...base, mayWrite: false }) === false && skipOffered({ ...base, mayWrite: false, sheet: true }) === false,
    'CONTROL: removing the sheet condition does not change the desktop answers, which is why section 1 has to exist');
}

console.log('\n== 3. the answer is a function of the facts, not of their order ==');
{
  // THE SWEEP: every combination, so a branch that returns early cannot hide a case. 32 rows, and the two counts are the check —
  // printed as counts rather than as 32 lines, because a per-row check that repeats one sentence is noise, not evidence.
  let rows = 0;
  let offered = 0;
  let offeredOnSheet = 0;
  for (const serverIssued of [true, false]) {
    for (const replay of [true, false]) {
      for (const mayWrite of [true, false]) {
        for (const configured of [true, false]) {
          for (const sheet of [true, false]) {
            rows++;
            if (!skipOffered({ serverIssued, replay, mayWrite, configured, sheet })) continue;
            offered++;
            if (sheet) offeredOnSheet++;
          }
        }
      }
    }
  }
  check(rows === 32, `the sweep drove ${rows} combinations (a zero here is a FAILURE, not a pass)`);
  // SIX OF THE THIRTY-TWO, and the number is derived rather than felt: a server-issued OPEN drill the server will take (2 rows —
  // `configured` makes no difference once a drill is server-issued), plus the offline fixture with no server configured (4 rows —
  // `replay` and `mayWrite` say nothing about a device's own drill). A rule that stopped offering it anywhere would read 0 here.
  check(offered === 6, `and offered the skip in ${offered} of them (a server-issued open drill, or the offline fixture)`);
  check(offeredOnSheet === 0, `none of them on a sheet (${offeredOnSheet})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
