// THE SLIDE, pinned: three board slots moving one place along, from a measured start to an exact end, in EITHER
// direction.
//
// WHY THIS IS A GATE. "The boards slide to the next two waypoints" is a numerical claim, and the ways to get it wrong
// are invisible in a screenshot of either end state: a board that does not land EXACTLY in its slot leaves a visible
// jump at the commit; a direction that is not monotone makes one board overtake another mid-transition; and a slide
// that ignores which button was pressed runs BACKWARDS — which is the reported defect ("the left button should slide
// the boards to the right, but it currently slides the boards to the left"), reproducible only as motion.
//
// THE ENDPOINTS ARE THE CONTRACT. Forward, `t = 0` is the resting pair (left board at −centre, right at +centre, the
// arriving board waiting at +3·centre) and `t = 1` is one slot along (the right board exactly where the left one was,
// the arriving board exactly where the right one was) — which is what lets the commit ROTATE THE SLOT ROLES without
// moving anything. Back is the mirror: everything ends one slot to the RIGHT and the arriving board comes from
// −3·centre. `ease` is exact at 0, 0.5 and 1 for the same reason.
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

console.log('\n== 5. the two directions are mirror images, because the buttons are ==');
{
  // FORWARD IS A STEP LEFT AND BACK IS A STEP RIGHT. The arriving board swaps ends with the direction: it waits at
  // +3·centre for a forward step and at −3·centre for a backward one, because the boards already on screen move the
  // other way.
  const fwd = slideOffsets(1, CENTRE, 1);
  const back = slideOffsets(1, CENTRE, -1);
  check(near(fwd.left, -3 * CENTRE) && near(back.left, CENTRE),
    'forward leaves the pair one step left; back leaves it one step RIGHT');
  check(near(fwd.right, -CENTRE) && near(back.right, 3 * CENTRE),
    'and the board that was on the right ends in the opposite slot in the two directions');
  check(near(slideOffsets(0, CENTRE, -1).incoming, -3 * CENTRE),
    'back: the arriving board waits off the LEFT, the mirror of forward');
  check(near(back.incoming, -CENTRE), 'and it ends exactly in the LEFT slot');

  // THE CONTROL: THE DEFECT ITSELF. An implementation that ignores the direction returns the forward offsets for a
  // backward step, so every one of these endpoint checks fails — which is what the report described.
  const ignoresDirection = (t, centre) => slideOffsets(t, centre, 1);
  check(!near(ignoresDirection(1, CENTRE).left, back.left),
    'NEGATIVE CONTROL: a slide that ignores which button was pressed lands the pair on the wrong side, so the direction is measured rather than assumed');

  const samples = [];
  for (let i = 0; i <= 20; i++) samples.push(slideOffsets(i / 20, CENTRE, -1));
  const increasing = (key) => samples.every((s, i) => i === 0 || s[key] >= samples[i - 1][key]);
  check(increasing('left') && increasing('right') && increasing('incoming'),
    'back: every slot only ever moves right');
  check(samples.every((s) => s.incoming < s.left && s.left < s.right),
    'and the arriving board stays left of the pair at every sample, so nothing crosses');
  check(near(samples[0].left, -CENTRE) && near(samples[0].right, CENTRE),
    'back starts from the resting pair, so the commit of the previous slide is not undone');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
