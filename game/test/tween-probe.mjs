// The replay tween, pinned: it starts and ends EXACTLY on the two boards, matches dancers by IDENTITY, and
// takes the short way round a heading.
//
// THE ENDPOINTS ARE THE LOAD-BEARING PART. A replay is the picture that accompanies a verdict, so if its last
// frame is not the ending board the verdict was computed against, the game shows one board and scores
// another — and a tween that stopped at 0.999 would do exactly that, invisibly.
//
// Usage: node game/test/tween-probe.mjs
import { shortestArc, tweenBoards, easeInOut, stillBoard } from '../src/game/tween.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** A board of `[id, x, y, headingDegrees]` rows, in the order given. */
const board = (rows) => ({
  dancers: rows.map(([id, x, y, deg]) => ({ id, couple: 1, gender: 'boy', x, y, heading: (deg * Math.PI) / 180 })),
});

const FROM = board([
  [1, 0, 0, 0],
  [2, 2, 0, 0],
]);
const TO = board([
  [1, 4, 2, 90],
  [2, 0, 2, 180],
]);

console.log('== the endpoints ARE the boards ==');
{
  const start = tweenBoards(FROM, TO, 0);
  check(start[0].x === 0 && start[0].y === 0, 'at fraction 0 a dancer is exactly on the start board (x = 0)');
  check(start[1].x === 2, 'and the other one too (x = 2)');

  const end = tweenBoards(FROM, TO, 1);
  check(end[0].x === 4 && end[0].y === 2, 'at fraction 1 a dancer is exactly on the end board (4, 2)');
  check(end[1].x === 0 && end[1].y === 2, 'and the other one (0, 2)');
  check(Math.abs(end[0].heading - Math.PI / 2) < 1e-12, 'and its heading is exactly the end heading (90 deg)');
  // A fraction outside [0,1] is CLAMPED rather than extrapolated. An extrapolated frame for f = 1.2 walks the
  // dancers off the board, and the caller that produced it would be a clock glitch, not a dance move.
  const over = tweenBoards(FROM, TO, 1.5);
  check(over[0].x === 4 && over[0].y === 2, 'a fraction above 1 is clamped to the end board rather than extrapolated');
  const under = tweenBoards(FROM, TO, -0.5);
  check(under[0].x === 0, 'and one below 0 is clamped to the start');
}

console.log('== it interpolates in between, monotonically ==');
{
  const mid = tweenBoards(FROM, TO, 0.5);
  check(mid[0].x === 2 && mid[0].y === 1, `half way is half way (2, 1) — got (${mid[0].x}, ${mid[0].y})`);
  let monotone = true;
  let previous = -Infinity;
  for (let f = 0; f <= 1.0001; f += 0.1) {
    const x = tweenBoards(FROM, TO, f)[0].x;
    if (x < previous - 1e-12) monotone = false;
    previous = x;
  }
  check(monotone, 'and the dancer never goes backwards along the way');
}

console.log('== dancers are matched by ID, not by array position ==');
{
  // THE TRAP THIS CATCHES, and it is the engine's own recorded one: a rebuilt board may come back in a
  // different array order (`reorderLike` exists for exactly that). An index-to-index tween would walk each
  // dancer to a STRANGER's spot — every position on the result still looking legal.
  const reordered = board([
    [2, 0, 2, 180],
    [1, 4, 2, 90],
  ]);
  const a = tweenBoards(FROM, reordered, 1);
  check(a[0].x === 4 && a[0].y === 2, 'dancer 1 goes to dancer 1\'s end spot even when the end board is arrayed the other way');
  check(a[1].x === 0 && a[1].y === 2, 'and dancer 2 to dancer 2\'s');
  // The RESULT is ordered like `from`, because that is the binding the renderer holds: the `DancerView` for
  // pose `i` was built from `from.dancers[i]`.
  check(a.length === FROM.dancers.length, 'and the result is as long as the START board, so it indexes like `from`');
}

console.log('== a mismatched dancer set is a defect, not a guess ==');
{
  let threw = false;
  try {
    tweenBoards(FROM, board([[1, 1, 1, 0]]), 0.5);
  } catch {
    threw = true;
  }
  // A dancer missing from one side is a PUZZLE defect. Guessing a spot for it would animate a dancer to
  // nowhere and report no error at all, which is how a generation bug would reach a player.
  check(threw, 'tweening boards with different dancer sets throws');
}

console.log('== the heading arc takes the SHORT way round ==');
{
  // A NAIVE `a + (b - a) * f` FAILS THIS: 350 -> 10 degrees is +20 degrees, and the naive form unwinds it
  // 340 degrees the other way, through every other facing in the set.
  const d = shortestArc((350 * Math.PI) / 180, (10 * Math.PI) / 180);
  check(Math.abs(d - (20 * Math.PI) / 180) < 1e-12, `350 -> 10 degrees is +20 degrees, not -340 (got ${(d * 180 / Math.PI).toFixed(1)})`);
  // The OTHER direction must still be the other direction: an `abs` would lose the sign and spin backwards.
  const back = shortestArc((10 * Math.PI) / 180, (350 * Math.PI) / 180);
  check(Math.abs(back + (20 * Math.PI) / 180) < 1e-12, `and 10 -> 350 is -20 degrees (got ${(back * 180 / Math.PI).toFixed(1)})`);
  const half = tweenBoards(board([[1, 0, 0, 350]]), board([[1, 0, 0, 10]]), 0.5);
  const midway = ((half[0].heading * 180) / Math.PI + 360) % 360;
  check(Math.abs(midway - 360) < 1e-9 || Math.abs(midway - 0) < 1e-9, `and half way is 0/360 degrees, i.e. the short way (got ${midway.toFixed(1)})`);
}

console.log('== `stillBoard` is the same shape as a tween frame ==');
{
  const still = stillBoard(FROM);
  const frame = tweenBoards(FROM, TO, 0);
  check(JSON.stringify(still) === JSON.stringify(frame), 'a still board IS the fraction-0 frame, so the view has one pose shape and not two');
  check(still.every((p) => p.hands === 'none'), 'and every pose carries a grip state, which a snapshot can only honestly call "none"');
}

console.log('== the easing is monotone and hits both ends ==');
{
  check(easeInOut(0) === 0 && easeInOut(1) === 1, 'easing starts at 0 and ends at 1');
  let ok = true;
  let last = -Infinity;
  for (let f = 0; f <= 1.0001; f += 0.05) {
    const e = easeInOut(f);
    if (e < last - 1e-12 || e < 0 || e > 1) ok = false;
    last = e;
  }
  check(ok, 'and never goes backwards or outside [0, 1]');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
