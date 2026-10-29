// THE DRILL CLOCK'S ORIGIN, pinned — the rule that decides when a run started, and the one failure it exists to prevent.
//
// REPORTED from a second device: "The server would not record this run: the run claims 50.4s and the drill was issued
// 13.3 seconds ago". The server refused it, and it was right to: a claim longer than the drill has existed is a lie
// about the run (api/src/handlers/runs.ts, `impossible_elapsed`). The claim was not play time. 50.4 − 13.3 = 37.1 s of
// that device's CLOCK OFFSET from the server's, because the client computed `elapsed = Date.now() − issuedAtMs` — its own
// wall clock minus a stamp the server minted. On this machine those two clocks are one clock, which is why the defect
// only appeared from the phone.
//
// SO THIS PROBE PINS TWO THINGS:
//   1. the origin is a DEVICE reading — a saved one is carried only while its `issuedAtMs` still names the same
//      issuance, so a re-issued position starts its clock again (the 421 s refusal DESIGN.md §15 records);
//   2. the claim it produces is SKEW-FREE: the same device clock on both sides of the subtraction, which the control in
//      section 2 shows the old rule did not do.
//
// Usage: node game/test/drill-clock-probe.mjs
import { drillClockOrigin, Stopwatch } from '../src/game/clock.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** A saved drill clock: the device reading it started at, and the server's stamp it belongs to. */
const saved = (startedAtMs, issuedAtMs) => ({ startedAtMs, issuedAtMs });

console.log('== 1. a saved clock is carried only for the SAME issuance ==');
{
  const issuedAt = 1_700_000_000_000;
  // THE DEVICE'S OWN READING, which is not the server's stamp — that difference is the whole point.
  const deviceStart = 1_700_000_000_123;
  const now = 1_700_000_050_000;
  check(drillClockOrigin(issuedAt, saved(deviceStart, issuedAt), now) === deviceStart,
    'a reload of the same issuance continues the clock it started');
  // A RE-ISSUED POSITION IS A DIFFERENT RUN (a restarted store, a replay), so its clock starts now.
  check(drillClockOrigin(issuedAt + 37_000, saved(deviceStart, issuedAt), now) === now,
    'while a save whose issuance MOVED starts a fresh clock — the 421 s refusal, prevented');
  check(drillClockOrigin(issuedAt, null, now) === now, 'and a drill with nothing saved starts at now');
  // THE OFFLINE FIXTURE HAS NO SERVER STAMP (0), and both sides say 0, so a practice drill still resumes across a
  // reload and still charges the time away — the behaviour DESIGN.md 9 asks for.
  check(drillClockOrigin(0, saved(deviceStart, 0), now) === deviceStart, 'an offline drill (no stamp on either side) still resumes');
  check(drillClockOrigin(0, { startedAtMs: deviceStart }, now) === deviceStart,
    'and a record written before the stamp existed reads as 0, so it resumes an offline drill and nothing else');
  check(drillClockOrigin(issuedAt, { startedAtMs: deviceStart }, now) === now,
    'NEGATIVE CONTROL: the same stamp-less record against a SERVER drill starts fresh rather than carrying a clock it cannot place');
}

console.log('\n== 2. the claim is skew-free, which the old rule was not ==');
{
  // THE REPORTED CASE, in numbers. The server issued at `issued`; the phone's clock runs 37.1 s ahead; 13.3 s of real
  // play. The phone's honest elapsed is 13.3 s.
  const issued = 1_700_000_000_000;
  const skewMs = 37_100;
  const playMs = 13_300;
  const phoneNow = issued + skewMs + playMs;
  // THE FIXED RULE: the origin is a device reading taken at the start, so the offset cancels.
  const origin = drillClockOrigin(issued, null, phoneNow - playMs);
  const clock = new Stopwatch();
  clock.resume(0, phoneNow - origin);
  check(clock.elapsedSeconds(0) === 13.3, `the phone claims its 13.3 s of play, with the 37.1 s offset cancelled (${clock.elapsedSeconds(0)} s)`);

  // NEGATIVE CONTROL: the rule that shipped — `Date.now() − issuedAtMs` — claims play PLUS the offset, which is the
  // refused 50.4 s. It reddens ONLY this check; every check in section 1 passes under it, because they never mix clocks.
  const shipped = new Stopwatch();
  shipped.resume(0, phoneNow - issued);
  check(shipped.elapsedSeconds(0) === 50.4, `CONTROL: mixing the server's stamp with the device's clock claims 50.4 s for 13.3 s of play (${shipped.elapsedSeconds(0)} s)`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
