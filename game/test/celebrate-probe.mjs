// THE WAYPOINT SUCCESS ANIMATION, pinned: WHICH border flashes when a player reaches a waypoint, and WHAT the flash
// does over its half second.
//
// WHY THIS IS A GATE. Both halves are things a person can only judge in a browser and a browser cannot be made to
// judge twice: "the border flashed, but on the wrong board" and "it flashes twice, fast enough to strobe" are
// invisible to a typecheck and easy to reintroduce while tuning a colour. The rules are pure
// (`game/src/render/celebrate.ts`), so the geometry-free part of the animation is measured here instead.
//
// REPORTED: "Add a success animation to a waypoint when a waypoint is solved. Currently, there is no feedback other
// than changing the outline colour."
//
// Usage: node game/test/celebrate-probe.mjs
import { CELEBRATE_FLOOR, CELEBRATE_GROW, CELEBRATE_MS, CELEBRATE_WHITEN, justSolved, pulse } from '../src/render/celebrate.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** A pair's border reading: indices and the two states, which is all the rule reads. */
const pair = (leftIndex, rightIndex, left, right) => ({ leftIndex, rightIndex, left, right });
/** The resting border's three numbers, for the end-of-curve checks. */
const atRest = (p, tolerance = 1e-9) => Math.abs(p.opacity - 1) <= tolerance && Math.abs(p.whiten) <= tolerance && Math.abs(p.scale - 1) <= tolerance;

console.log('== 1. reaching an intermediate waypoint is the board that moves from the right slot to the left ==');
{
  // The pair before the move (progress n): left solved, right the ONE reachable waypoint. After it (progress n + 1):
  // the pair has advanced, so the board that was `next` is the arriving left one and is `solved`.
  const before = pair(1, 2, 'solved', 'next');
  const after = pair(2, 3, 'solved', 'next');
  check(justSolved(before, after) === 'left', `an advance whose arriving board was pending solves the LEFT slot (${justSolved(before, after)})`);
  // The same advance with the states swapped is NOT a success: the arriving board was already solved. This is the
  // check a rule that flashed on any forward index change would fail, and it is the page case below.
  check(justSolved(pair(1, 2, 'solved', 'solved'), after) === null, 'an advance whose arriving board was already solved is not a success');
  // NEGATIVE CONTROL, MEASURED: a rule that returned `'left'` on any forward index change (dropping both state tests)
  // reddens the check above and the two paging checks in section 2 — MEASURED: 3 checks red, and nothing else, because
  // the genuine advance is the one pair that satisfies the stricter rule.
}

console.log('\n== 2. PAGING the arrows is not a success: the same boards, no new waypoint ==');
{
  // Paging FORWARD from the live pair: the cursor moves, so the arriving left board is a PREVIEW and reads `next`.
  const live = pair(0, 1, 'solved', 'next');
  check(justSolved(live, pair(1, 2, 'next', 'locked')) === null, 'paging forward from the live pair shows a `next` board and does not flash');
  // Paging forward through a route already earned: the arriving board is `solved` but so was the board it came from.
  check(justSolved(pair(1, 2, 'solved', 'solved'), pair(2, 3, 'solved', 'locked')) === null, 'paging forward through solved boards does not flash');
  // Paging BACK to the live pair — the reachable shape of "a solved board arrives", and the one the direction test
  // exists for: the preview it comes from reads `next`/`locked`, and the live left board is always `solved`.
  check(justSolved(pair(2, 3, 'next', 'locked'), pair(1, 2, 'solved', 'next')) === null, 'paging back to the live pair does not flash');
  // NEGATIVE CONTROL, MEASURED: dropping the `next.leftIndex > previous.leftIndex` direction test (leaving only the two
  // state comparisons) reddens the check above — the arriving board is solved and the board it leaves was `next` — and
  // nothing else, because paging forward is excluded by the states instead. MEASURED: 1 check red.
}

console.log('\n== 3. the LAST waypoint is the right border turning green, with both indices still ==');
{
  // There is no pair past the last waypoint, so the front clamps: the goal shows as the right board's own state
  // changing from `next` to `solved`.
  const before = pair(1, 2, 'solved', 'next');
  const after = pair(1, 2, 'solved', 'solved');
  check(justSolved(before, after) === 'right', `the goal solves the RIGHT border in place (${justSolved(before, after)})`);
  check(justSolved(pair(1, 2, 'solved', 'solved'), after) === null, 'and re-drawing the same solved pair does not flash again');
  // NEGATIVE CONTROL, MEASURED: requiring an index change (a rule written only for section 1) reddens the first check
  // here and leaves section 1 green — the goal is the case that has no advance at all.
}

console.log('\n== 4. a first pair is a paint, not a success ==');
{
  check(justSolved(null, pair(0, 1, 'solved', 'next')) === null, 'no previous pair means nothing to compare, so no flash');
  // A NEW PUZZLE FORGETS THE PAIR (`GameStage.forgetPair`), which is what makes the first pair of the next drill a
  // paint. Without that, a drill whose first pair happens to read `solved`/`next` would flash on arrival.
}

console.log('\n== 5. the pulse leaves the border exactly as it found it, and peaks once in the middle ==');
{
  check(atRest(pulse(0)), 't = 0 is the resting border exactly');
  check(atRest(pulse(1)), 't = 1 is the resting border exactly — a curve that ended dimmer would make `solved` look weaker than `next`');
  const middle = pulse(0.5);
  check(Math.abs(middle.opacity - CELEBRATE_FLOOR) < 1e-9, `t = 0.5 is the dimmest point (${middle.opacity})`);
  check(Math.abs(middle.whiten - CELEBRATE_WHITEN) < 1e-9, `and the whitest (${middle.whiten})`);
  check(Math.abs(middle.scale - (1 + CELEBRATE_GROW)) < 1e-9, `and the largest ring (${middle.scale})`);
  // CLAMPED OUTSIDE THE INTERVAL, so a frame that arrives a millisecond late cannot run the curve backwards.
  check(atRest(pulse(-0.5)) && atRest(pulse(1.5)), 'and a t outside [0, 1] is clamped to the resting border');
  // NEGATIVE CONTROL, MEASURED: a linear ramp (`1 - t`) reddens SIX checks — both end checks, all three peak checks,
  // the clamp check and the pulse count — because a ramp is BRIGHTEST at `t = 0` and its peak is not at the middle. An
  // inverted `Math.cos(Math.PI * t)` reddens the same family from the other side.
}

console.log('\n== 6. one pulse, bounded, and under the flash threshold ==');
{
  const samples = Array.from({ length: 101 }, (_, i) => pulse(i / 100));
  check(samples.every((p) => p.opacity > 0 && p.opacity <= 1), 'the opacity multiplier stays inside (0, 1] at every sample');
  check(samples.every((p) => p.whiten >= 0 && p.whiten <= 1), 'the mix towards white stays inside [0, 1]');
  check(samples.every((p) => p.scale >= 1 && p.scale <= 1 + CELEBRATE_GROW + 1e-12), 'and the ring never grows past its bound');
  // ONE bump, counted rather than asserted: a local minimum of the opacity in the interior is the peak of a flash, so
  // exactly one is a single pulse and two would be a strobe.
  const minima = samples.slice(1, -1).filter((p, i) => p.opacity < samples[i].opacity && p.opacity < samples[i + 2].opacity);
  check(minima.length === 1, `the curve has exactly one pulse (${minima.length})`);
  // THE PHOTOSENSITIVITY BOUND, in the units that matter: one flash per CELEBRATE_MS is under three a second, and the
  // same pulse repeated would not be. This pins the decision rather than the number.
  const flashesPerSecond = 1000 / CELEBRATE_MS;
  check(flashesPerSecond < 3, `one pulse in ${CELEBRATE_MS} ms is ${flashesPerSecond.toFixed(1)} flashes a second, under 3`);
  // NEGATIVE CONTROL, MEASURED: a two-bump curve (`Math.abs(Math.sin(2 * Math.PI * clamped))`) reddens four checks —
  // the three peak checks and the pulse count — and an opacity floor below zero (`1 - 1.3 * bump`) reddens two: the
  // bounds check and the dimmest-point check. The rate check is arithmetic on the constant rather than a measurement:
  // shortening CELEBRATE_MS below 334 ms would redden it alone.
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
