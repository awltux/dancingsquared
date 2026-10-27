// THE FRAME CLOCK, PINNED — including the case that made it a module (a hidden tab coming back).
//
// WHY. MEASURED: `main.ts`'s frame function charged `Math.min(100, nowMs - lastFrameMs)` to the playhead, and a tab hidden for
// three minutes therefore handed `ui/playhead.ts` a 180 000 ms step — a 320 ms board slide would complete in one jump rather
// than resume. The clamp was a constant inside an animation callback, which is a rule no probe can reach; `ui/frame-clock.ts`
// is that rule, and this pins it.
//
// WHAT THIS PINS:
//   1. THE CLAMP on both sides: a 5-minute gap charges `MAX_FRAME_DELTA_MS`, and a 16 ms gap charges 16.
//   2. A CLOCK THAT GOES BACKWARDS charges ZERO, not a negative step — a system time correction must not un-draw an
//      animation, and `playhead.advance(-n)` would run the line backwards.
//   3. THE FIRST FRAME charges a nominal step, not the page's uptime: `lastMs <= 0` and a non-finite value both answer
//      `FIRST_FRAME_DELTA_MS`, so an animation starts at its beginning.
//   4. THE PAUSE RULE: only `'visible'` animates.
//
// THE NEGATIVE CONTROL is the code this replaces — `Math.min(100, now - last)` with no guards — measured against the same
// cases: it charges a NEGATIVE delta when the clock goes backwards, and it charges the page's uptime for the first frame when
// `last` starts at 0. Both fail checks that the extracted rule passes.
//
// Usage: node game/test/frame-clock-probe.mjs   (pure arithmetic; no DOM, no clock)
import {
  frameDelta, shouldAnimate, MAX_FRAME_DELTA_MS, FIRST_FRAME_DELTA_MS,
} from '../src/ui/frame-clock.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** The rule this replaces, verbatim from the frame function it was extracted from. */
const oldRule = (nowMs, lastMs) => (lastMs === 0 ? 16 : Math.min(100, nowMs - lastMs));

console.log('\n== 1. the clamp ==');
{
  check(frameDelta(16, 0) === FIRST_FRAME_DELTA_MS, `the first frame charges ${FIRST_FRAME_DELTA_MS} ms`);
  check(frameDelta(1_000, 984) === 16, 'a normal frame charges its own gap (16 ms)');
  check(frameDelta(984 + 40, 984) === 40, 'a 40 ms frame charges 40');
  check(frameDelta(984 + 320, 984) === MAX_FRAME_DELTA_MS, `a 320 ms frame is clamped to ${MAX_FRAME_DELTA_MS}`);
  // THE CASE THAT MOTIVATED IT: three minutes hidden.
  check(frameDelta(180_000, 984) === MAX_FRAME_DELTA_MS, 'three minutes hidden charges the clamp, not the gap');
  check(MAX_FRAME_DELTA_MS < 320, 'and the clamp is shorter than the board slide it protects (320 ms)');
}

console.log('\n== 2. a clock that goes backwards charges nothing ==');
{
  check(frameDelta(900, 1_000) === 0, 'a backwards clock is zero');
  check(frameDelta(1_000, 1_000) === 0, 'and so is the same instant twice');
  // NEGATIVE CONTROL: the rule this replaces hands a negative step to the playhead.
  check(oldRule(900, 1_000) === -100, `the old rule charges ${oldRule(900, 1_000)} ms here — the defect this closes`);
}

console.log('\n== 3. the first frame is a frame, not the uptime ==');
{
  check(frameDelta(100_000, 0) === FIRST_FRAME_DELTA_MS, 'lastMs = 0 charges a nominal step, not 100 s');
  check(oldRule(100_000, 0) === 16, 'and the control agrees on this one (it checks `last === 0` too)');
  check(frameDelta(Number.NaN, 984) === FIRST_FRAME_DELTA_MS, 'a non-finite now is treated as the first frame');
  check(frameDelta(984, Number.NaN) === FIRST_FRAME_DELTA_MS, 'and so is a non-finite last');
  check(frameDelta(1_000, -5) === FIRST_FRAME_DELTA_MS, 'and a negative last (which no real frame has)');
  check(oldRule(1_000, -5) === 100, `the old rule would clamp a negative last to ${oldRule(1_000, -5)} — the control`);
}

console.log('\n== 4. only the visible state animates ==');
{
  check(shouldAnimate('visible'), 'visible animates');
  check(!shouldAnimate('hidden'), 'hidden does not');
  check(!shouldAnimate('prerender'), 'and neither does a prerendered page, which is not on screen either');
  check(!shouldAnimate(''), 'an empty state is not visible');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
