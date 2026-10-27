// THE GHOST LAYER'S PAIRING: WHICH DANCER ON THE OTHER BOARD IS WHICH DANCER HERE.
//
// REPORTED: "The two boards are awkward due to screen realestate. Is there a way that only one board is shown at a time
// but it's obvious how to navigate between them." The answer is one board plus the other board's dancers drawn as ghosts,
// and this probe pins the part that can be wrong while still looking right: THE PAIRING. A call moves people, so the
// third dancer in the array is not the third dancer in the picture; pairing by index would put one dancer's target on
// another dancer's body, and the picture would stay plausible. `SeqDancer.id` is carried through every apply, so the
// identity is there to use.
//
// WHAT THIS PINS, and the negative control for each:
//   1. IDENTITY PAIRS, NOT INDEX. A board against a REVERSED copy of itself pairs every dancer with their OWN pose, which
//      an index pairing gets wrong for six of eight — the `indexPairs` control below computes what the wrong rule would
//      have answered, and the two disagree.
//   2. THE FALLBACK IS THE INDEX, and only with equal counts. A hand-built board whose ids match nothing pairs by
//      position; a board with a different COUNT returns `null` (no ghost), because there is no honest pairing to draw.
//   3. `moved` IS THE ANSWER TO "WHAT CHANGES". A dancer displaced by 0.03 board units (below `GHOST_POSITION_EPS`) or
//      turned by 0.01 rad is NOT moved; 0.06 units or 0.03 rad is. The renderer draws the two at different opacities.
//   4. THE ORDER IS THE FOCUSED BOARD'S, so a caller may index the result by dancer — pinned because a silent reorder
//      would draw every ghost on the wrong body while still passing a count.
//
// Usage: node game/test/ghost-pair-probe.mjs   (engine must be built: it imports `makeSquaredSet`)
import { makeSquaredSet } from 'dancing-squared-engine';
import { ghostPoses, GHOST_POSITION_EPS, GHOST_HEADING_EPS } from '../src/render/ghost-pair.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const base = makeSquaredSet();
check(base.dancers.length === 8, `the fixture is a whole set (${base.dancers.length} dancers)`);
const withDancers = (dancers) => ({ ...base, dancers });

/** Move dancer `i` by (dx, dy) and turn them by `turn`, keeping their identity. */
const nudged = (board, i, dx, dy = 0, turn = 0) =>
  withDancers(board.dancers.map((d, k) => (k === i ? { ...d, x: d.x + dx, y: d.y + dy, heading: d.heading + turn } : d)));

/** WHAT THE WRONG RULE WOULD ANSWER: pair by array position. Used only as the control. */
const indexPairs = (focused, other) =>
  other.dancers.length === focused.dancers.length
    ? focused.dancers.map((_, i) => ({ x: other.dancers[i].x, y: other.dancers[i].y }))
    : null;

console.log('\n== 1. a board against itself: eight ghosts, none of them a move ==');
{
  const ghosts = ghostPoses(base, base);
  check(Array.isArray(ghosts) && ghosts.length === 8, `one ghost per dancer (${ghosts?.length})`);
  check(ghosts.every((g) => g.moved === false), 'and every one is marked unmoved');
  check(ghosts.every((g, i) => g.dancerIndex === i), 'in the focused board\'s own order');
  check(ghosts.every((g, i) => g.pose.x === base.dancers[i].x && g.pose.y === base.dancers[i].y), 'at their own coordinates');
}

console.log('\n== 2. identity pairs, not index — the reversed-array control ==');
{
  // REVERSED: every dancer keeps their own position and identity; only the array order changes. An index pairing now
  // answers the pose of the dancer seven places away, which is the defect this module exists to prevent.
  const reversed = withDancers([...base.dancers].reverse());
  const ghosts = ghostPoses(base, reversed);
  const byIndex = indexPairs(base, reversed);
  check(ghosts !== null && ghosts.length === 8, 'the reversed board still pairs (8 ghosts)');
  const identityHits = ghosts.filter((g, i) => g.pose.x === base.dancers[i].x && g.pose.y === base.dancers[i].y).length;
  check(identityHits === 8, `every ghost is the dancer's OWN target, all 8 (${identityHits})`);
  const indexHits = byIndex.filter((p, i) => p.x === base.dancers[i].x).length;
  check(indexHits === 0, `NEGATIVE CONTROL: an index pairing gets 0 of 8 right here (${indexHits})`);
  check(ghosts.every((g) => g.moved === false), 'and nothing counts as moved, because nobody moved');
}

console.log('\n== 3. a call that moves two dancers marks exactly two ==');
{
  const after = nudged(nudged(base, 2, 1.5, -2), 5, -1, 1.5);
  const ghosts = ghostPoses(base, after);
  const moved = ghosts.filter((g) => g.moved).map((g) => g.dancerIndex).sort();
  check(moved.join() === '2,5', `the two who moved are the two marked (${moved.join(', ')})`);
  check(ghosts[2].pose.x === after.dancers[2].x && ghosts[2].pose.y === after.dancers[2].y, 'ghost 2 points at dancer 2\'s new spot');
  check(ghosts[5].pose.x === after.dancers[5].x && ghosts[5].pose.y === after.dancers[5].y, 'and ghost 5 at dancer 5\'s');
  // THE REVERSE DIRECTION IS NOT THE SAME QUESTION: focused=after pairs the same ids, and the ghosts are now where the
  // dancers CAME FROM. A pairing that only worked one way would be a silent asymmetry.
  const back = ghostPoses(after, base);
  check(back[2].pose.x === base.dancers[2].x && back[2].moved === true, 'the reverse pairing points back at the start spot');
}

console.log('\n== 4. the tolerances, from both sides ==');
{
  const tiny = ghostPoses(base, nudged(base, 0, GHOST_POSITION_EPS - 0.02, 0));
  check(tiny[0].moved === false, `a ${(GHOST_POSITION_EPS - 0.02).toFixed(2)}-unit nudge is not a move`);
  const enough = ghostPoses(base, nudged(base, 0, GHOST_POSITION_EPS + 0.01, 0));
  check(enough[0].moved === true, `a ${(GHOST_POSITION_EPS + 0.01).toFixed(2)}-unit nudge is`);
  const turnTiny = ghostPoses(base, nudged(base, 0, 0, 0, GHOST_HEADING_EPS - 0.01));
  check(turnTiny[0].moved === false, `a ${(GHOST_HEADING_EPS - 0.01).toFixed(2)}-radian turn is not a move`);
  const turnEnough = ghostPoses(base, nudged(base, 0, 0, 0, GHOST_HEADING_EPS + 0.01));
  check(turnEnough[0].moved === true, `a ${(GHOST_HEADING_EPS + 0.01).toFixed(2)}-radian turn is`);
  // A turn across the -pi/+pi seam must be read as SHORT, not as nearly a full circle: the delta is a wrapped angle.
  const seam = withDancers(base.dancers.map((d, i) => (i === 0 ? { ...d, heading: Math.PI - 0.005 } : d)));
  const across = withDancers(base.dancers.map((d, i) => (i === 0 ? { ...d, heading: -Math.PI + 0.005 } : d)));
  check(ghostPoses(seam, across)[0].moved === false, 'a heading across the pi seam is 0.01 rad apart, not 6.27');
}

console.log('\n== 5. refusals are values ==');
{
  // A SIX-DANCER BOARD AGAINST THE EIGHT IT CAME FROM PAIRS THE SIX BY IDENTITY, deliberately rather than by a missed
  // guard: MEASURED, the module's first version refused every count mismatch, which threw away a pairing that was exact.
  // The rule is "no honest pairing", not "no equal counts".
  const six = withDancers(base.dancers.slice(0, 6));
  const sixGhosts = ghostPoses(six, base);
  check(sixGhosts !== null && sixGhosts.length === 6, `six focused dancers pair against the eight by id (${sixGhosts?.length})`);
  check(sixGhosts !== null && sixGhosts.every((g, i) => g.pose.x === base.dancers[i].x), 'and each to their own dancer');
  // THE COUNT MISMATCH THAT DOES REFUSE: six dancers against eight whose ids cannot match. There is no honest reading and
  // the index fallback is not allowed either, because positions six to eight are dancers nobody paired.
  const strangerEight = withDancers(base.dancers.map((d, i) => ({ ...d, id: 500 + i })));
  check(ghostPoses(six, strangerEight) === null, 'unmatched ids across a count mismatch REFUSE (null) rather than guess');
  check(ghostPoses(base, withDancers([])) === null, 'an empty board refuses too');
  // THE INDEX FALLBACK: ids that match nothing, equal counts. The pair is positional, and it is DECLARED rather than
  // silent — a probe asserts the poses so a future change to the fallback is visible.
  const foreign = withDancers(base.dancers.map((d, i) => ({ ...d, id: 100 + i })));
  const fallback = ghostPoses(base, foreign);
  check(fallback !== null && fallback.every((g, i) => g.pose.x === foreign.dancers[i].x),
    'ids that match nothing fall back to the array order, and the poses show it');
  // AND THE MIXED CASE IS THE DANGEROUS ONE: one id matches, the rest do not. The matched one is paired by IDENTITY even
  // though the count is equal, so the two rules cannot mix within a board.
  const mixed = withDancers(base.dancers.map((d, i) => (i === 3 ? { ...d, id: 100 + i } : d)));
  const mixedGhosts = ghostPoses(base, mixed);
  check(mixedGhosts[3].pose.x === mixed.dancers[3].x && mixedGhosts[0].pose.x === mixed.dancers[0].x,
    'a mixed board pairs the ids it has and the positions the others share');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
