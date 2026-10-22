// THE SLIDE, pinned: three board slots moving one place left, from a measured start to an exact end.
//
// WHY THIS IS A GATE. "The boards slide to the next two waypoints" is a numerical claim, and the two ways to get it
// wrong are invisible in a screenshot of either end state: a board that does not land EXACTLY in its slot leaves a
// visible jump at the commit, and a direction that is not monotone makes one board overtake another mid-transition.
// Both are checked here against the module the stage actually animates with — no copy of the arithmetic.
//
// THE ENDPOINTS ARE THE CONTRACT. `t = 0` is the resting pair (left board at −centre, right at +centre, incoming
// parked at +3·centre) and `t = 1` is one slot along (the right board exactly where the left one was, the incoming
// board exactly where the right one was) — which is what lets the commit ROTATE THE SLOT ROLES without moving
// anything. `ease` is exact at 0, 0.5 and 1 for the same reason.
//
// Usage: node game/test/slide-probe.mjs
import { ease, slideOffsets } from '../src/render/slide-math.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const CENTRE = 2.9;
const near = (a, b) => Math.abs(a - b) < 1e-12;

console.log('== 1. the easing is exact where the animation has to land ==');
{
  check(ease(0) === 0, 'ease(0) is exactly 0, so the first frame is the resting pair');
  check(ease(1) === 1, 'ease(1) is exactly 1, so the commit lands on the slot rather than near it');
  check(ease(0.5) === 0.5, 'ease(0.5) is exactly 0.5, so the three slots stay evenly spaced at the midpoint');
  check(ease(-1) === 0 && ease(2) === 1, 'and a t outside the animation clamps to its ends rather than extrapolating');
  // THE NEGATIVE CONTROL: a linear interpolation passes every endpoint check above, so the endpoints alone do not
  // pin the easing. This is the check that says the curve is an ease at all.
  check(ease(0.25) !== 0.25, `NEGATIVE CONTROL: it is an ease, not a straight line (ease(0.25) = ${ease(0.25)})`);
}

console.log('\n== 2. the three slots at rest, and one slot along ==');
{
  const start = slideOffsets(0, CENTRE);
  check(near(start.left, -CENTRE) && near(start.right, CENTRE) && near(start.incoming, 3 * CENTRE),
    `t = 0: left ${start.left}, right ${start.right}, incoming ${start.incoming}`);
  const end = slideOffsets(1, CENTRE);
  check(near(end.left, -3 * CENTRE), 't = 1: the left board has left, one slot to the left');
  check(near(end.right, -CENTRE), 'the right board is EXACTLY where the left one was — so the commit does not move it');
  check(near(end.incoming, CENTRE), 'and the incoming board is EXACTLY where the right one was');
}

console.log('\n== 3. every slot moves one way, and no board overtakes another ==');
{
  const samples = [];
  for (let i = 0; i <= 20; i++) samples.push(slideOffsets(i / 20, CENTRE));
  const decreasing = (key) => samples.every((s, i) => i === 0 || s[key] <= samples[i - 1][key]);
  check(decreasing('left'), 'the leaving board only ever moves left');
  check(decreasing('right'), 'the arriving-into-left board only ever moves left');
  check(decreasing('incoming'), 'and the incoming board only ever moves left');
  // THE ORDER IS THE PICTURE: left of right of incoming, at every sample, or two boards would cross on the way.
  check(samples.every((s) => s.left < s.right && s.right < s.incoming),
    'and at every sample the three are still in order, so no two boards cross');
  // A BOARD CANNOT TELEPORT: the biggest single step over 20 samples is a fraction of a slot.
  const step = Math.max(...samples.map((s, i) => (i === 0 ? 0 : Math.abs(s.incoming - samples[i - 1].incoming))));
  check(step < CENTRE, `no single sample jumps a whole slot (largest step ${step.toFixed(3)} against ${CENTRE})`);
}

console.log('\n== 4. the slots come from the resting arithmetic, not a second set of numbers ==');
{
  // The stage places the boards at ±centreFor(scale) and parks the incoming one at 3·centre, exactly the t=0
  // offsets above — so a change of the slot arithmetic breaks this rather than drifting from it silently.
  const start = slideOffsets(0, CENTRE);
  check(near(start.right, CENTRE) && near(start.left, -CENTRE), 'the resting slots are ±centre');
  check(near(slideOffsets(1, CENTRE).incoming, start.right), 'and the incoming board ends where the right one started');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
