// THE DAILY'S ROUTE AND THE RULE THAT WINS IT, pinned.
//
// WHY THIS IS A GATE. REPORTED: "The last generated daily was only 2 waypoints. Thats not challenging enough for a
// daily. It should be from 5 to 10 waypoints." Both halves of that are rules a generator can quietly lose:
//
//   * THE COUNT IS THE LADDER'S. The Daily used to ask for "a board exactly three calls away" and DERIVE its waypoints
//     from the route, so the count was a side effect: MEASURED over 24 level-1 seeds, **2 waypoints on 1, 3 on 4 and
//     4 on 19**, and the reported day was the two. A regime that silently goes back to deriving the count would pass a
//     "the puzzle generates" check and fail this one.
//   * THE WAYPOINTS ARE THE WIN. The goal board alone used to be the rule, so a line that jumped to the last
//     arrangement won without passing the rest — MEASURED, the reported day's goal was ONE call from the start, which
//     is how a two-waypoint "challenge" was a one-call question with two presses of the same call on the end.
//
// SO THE CHECKS ARE: the count equals the level's ladder on every seed, every stage lands in a NEW arrangement, the
// route's own walk wins, and a line that reaches the last arrangement WITHOUT the waypoints does not.
//
// Usage: node game/test/daily-waypoints-probe.mjs   (engine must be built)
import { makeSquaredSet } from 'dancing-squared-engine';
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { DAILY_WAYPOINTS_MAX, DAILY_WAYPOINTS_MIN, dailySpec, dailyWaypointsFor, levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { arrangementKey, waypointBoards, waypointReached } from '../src/puzzle/arrangement.ts';
import { PlaySession } from '../src/puzzle/session.ts';
import { applierFor } from '../src/data/corpus-node.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = levelSpec(1);
const spec = dailySpec(LEVEL);
const { applier } = applierFor(poolFor(LEVEL, MAIN_POOL), LEVEL.poolSize);
const KEYS = (boards) => boards.map(arrangementKey);
const WAYPOINTS = dailyWaypointsFor(LEVEL);

console.log('== 1. the count is the LEVEL\'S, on every seed ==');
{
  let ok = 0;
  let exact = 0;
  let stagesNew = 0;
  let goalDiffers = 0;
  let goalIsFormation = 0;
  let parIsCalls = 0;
  let noSteps = 0;
  const counts = new Set();
  // 24 SEEDS, the sample the old count was measured over, so the report is comparable with the number that was wrong.
  for (let i = 1; i <= 24; i++) {
    const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec, 'daily'), 2026_10_15 + i, spec, applier);
    if (!built.ok) continue;
    ok++;
    const puzzle = built.puzzle;
    const keys = KEYS(puzzle.path);
    const waypoints = waypointBoards(puzzle.path);
    counts.add(waypoints.length);
    if (waypoints.length === WAYPOINTS) exact++;
    if (keys.every((key, j) => j === 0 || key !== keys[j - 1])) stagesNew++;
    if (arrangementKey(puzzle.goal) !== arrangementKey(puzzle.start)) goalDiffers++;
    if (applier.formationOf(puzzle.goal) !== null) goalIsFormation++;
    if (puzzle.shortest === puzzle.solution.length && puzzle.shortest === waypoints.length - 1) parIsCalls++;
    if (puzzle.steps.length === 0) noSteps++;
  }
  check(ok === 24, `all 24 seeds generate at level 1 (${ok})`);
  // THE COUNT, which is the reported defect: one number per seed and it is the ladder's.
  check(exact === ok && counts.size === 1 && counts.has(WAYPOINTS),
    `every one has exactly the level's ${WAYPOINTS} waypoints (${[...counts].join(', ')} over ${ok} seeds)`);
  // A WAYPOINT IS A FORMATION, so no stage may repeat the arrangement before it — the collapse is what made the count
  // a side effect, and the walk refuses a same-arrangement step rather than letting the display collapse it.
  check(stagesNew === ok, `every stage lands in a NEW arrangement from the one before (${stagesNew} of ${ok})`);
  check(goalDiffers === ok, 'the goal is never the start\'s own arrangement, so the puzzle is not "you are already there"');
  check(goalIsFormation === ok, 'and it is a formation the corpus defines, which is the picture the player is aiming at');
  // `shortest` IS EXACT, NOT AN ESTIMATE: one call stands the set in one arrangement, so n waypoints take at least n-1
  // calls and the route uses that. That is the par the score divides by.
  check(parIsCalls === ok, `shortest is the call count and one less than the waypoint count (${spec.depth} at level 1)`);
  check(noSteps === ok, 'and the Daily carries NO option steps, because its answer is any reading that advances a waypoint');
}

console.log('\n== 2. the route WINS, and only by passing the waypoints ==');
{
  // SEED 5131 IS PINNED BECAUSE ITS GOAL IS REACHABLE IN TWO CALLS WHILE SKIPPING THE WAYPOINTS — the shape that made
  // the reported Daily a one-call question. MEASURED on the walk that shipped: `Double Pass Thru -> California Twirl`
  // lands on the goal's arrangement having passed 0 of 4 waypoints. If a generator change removes such a line, RE-DERIVE
  // the control rather than deleting it: a seed with no shortcut cannot measure the rule the control is for.
  const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec, 'daily'), 5131, spec, applier);
  check(built.ok, `the probe's own seed generates${built.ok ? '' : `: ${built.reason}`}`);
  const puzzle = built.puzzle;
  const keys = waypointBoards(puzzle.path).map(arrangementKey);
  const session = new PlaySession(puzzle, applier);
  const progress = (s) => waypointReached(keys.slice(1), s.playedBoards().map(arrangementKey));

  check(session.atGoal() === false, 'standing on the start is not a win');
  const rises = [];
  for (const call of puzzle.solution) {
    session.play(call);
    rises.push(progress(session));
  }
  check(rises.every((value, index) => value === index + 1), `each call of the route raises the waypoint count by exactly one (${rises.join(', ')})`);
  check(session.atGoal(), `and the last one wins the run (${session.movesUsed} of ${session.allowance} calls)`);

  // UNDO REWINDS THE WIN, because the count is derived from the move stack rather than stored beside it.
  session.undo();
  check(!session.atGoal() && progress(session) === keys.length - 2, `an undo takes the win and the last waypoint back (${progress(session)} of ${keys.length - 1})`);
  session.redo();
  check(session.atGoal(), 'and a redo restores both');

  // THE SHORTCUT CONTROL, which is the defect this rule exists for: a line that reaches the GOAL's arrangement without
  // standing on the waypoints before it must not win. It is searched for rather than assumed to exist, because a
  // generated goal is usually several calls from the start — when it is not, that is exactly the old two-waypoint Daily.
  let shortcut = null;
  {
    // A BOUNDED BFS over what is offered, stopping at the goal's arrangement. The allowance is the bound: a line longer
    // than it could not be played, so it could not be a shortcut either. The BOARDS are carried because the waypoint
    // count is over arrangements, and a line that happens to pass every waypoint is a solution rather than a shortcut.
    const goalKey = arrangementKey(puzzle.goal);
    const frontier = [{ calls: [], boards: [puzzle.start] }];
    const seen = new Set([arrangementKey(puzzle.start)]);
    while (frontier.length && !shortcut) {
      const node = frontier.shift();
      const board = node.boards[node.boards.length - 1];
      if (node.calls.length > 0 && arrangementKey(board) === goalKey) {
        if (waypointReached(keys.slice(1), node.boards.map(arrangementKey)) < keys.length - 1) shortcut = node.calls;
        continue;
      }
      if (node.calls.length >= session.allowance - 1) continue;
      for (const move of applier.offered(board)) {
        const key = arrangementKey(move.board);
        if (seen.has(key)) continue;
        seen.add(key);
        frontier.push({ calls: [...node.calls, move.call], boards: [...node.boards, move.board] });
      }
    }
  }
  check(shortcut !== null, `this seed has a line to the goal's arrangement that skips the waypoints (${shortcut?.join(' -> ') ?? 'NONE — re-derive the control, do not delete it'})`);
  if (shortcut) {
    const jumped = new PlaySession(puzzle, applier);
    for (const call of shortcut) jumped.play(call);
    check(arrangementKey(jumped.board) === arrangementKey(puzzle.goal), 'the shortcut really does land on the goal\'s arrangement');
    check(!jumped.atGoal(), `NEGATIVE CONTROL: and it does NOT win, because it passed ${progress(jumped)} of ${keys.length - 1} waypoints — the goal-board rule would have won it here`);
  }
}

console.log('\n== 3. the ladder: 5 at level 1, one more every four levels, capped at 10 ==');
{
  const ladder = [1, 2, 5, 9, 13, 17, 21, 25, 33].map((index) => ({ index, waypoints: dailyWaypointsFor(levelSpec(index)) }));
  check(ladder.every((entry) => entry.waypoints >= DAILY_WAYPOINTS_MIN && entry.waypoints <= DAILY_WAYPOINTS_MAX),
    `every level asks for between ${DAILY_WAYPOINTS_MIN} and ${DAILY_WAYPOINTS_MAX} waypoints (${ladder.map((e) => `L${e.index}:${e.waypoints}`).join(' ')})`);
  check(ladder[0].waypoints === DAILY_WAYPOINTS_MIN, `level 1 is the floor (${ladder[0].waypoints})`);
  check(ladder.every((entry, i) => i === 0 || entry.waypoints >= ladder[i - 1].waypoints), 'the count never falls as the ladder rises');
  check(ladder[ladder.length - 1].waypoints === DAILY_WAYPOINTS_MAX, `and the top of the ladder reaches the cap (L33: ${ladder[ladder.length - 1].waypoints})`);
  // ONE FIELD, TWO REGIMES: the Daily's spec is the level with its call count set to the waypoints minus one, which is
  // what the walk reads and what `puzzle.shortest` reports.
  check(dailySpec(LEVEL).depth === WAYPOINTS - 1 && dailySpec(levelSpec(21)).depth === DAILY_WAYPOINTS_MAX - 1,
    `the spec's depth is the calls the route takes, one fewer than its waypoints (L1 ${dailySpec(LEVEL).depth}, L21 ${dailySpec(levelSpec(21)).depth})`);
}

console.log('\n== 4. the hint aims at the NEXT waypoint ==');
{
  const built = generatePuzzle(generatorConfigFor(MAIN_POOL.version, spec, 'daily'), 2026_10_17, spec, applier);
  const puzzle = built.puzzle;
  const keys = waypointBoards(puzzle.path).map(arrangementKey);
  const session = new PlaySession(puzzle, applier);
  const progress = (s) => waypointReached(keys.slice(1), s.playedBoards().map(arrangementKey));
  let advanced = 0;
  let named = 0;
  for (let step = 0; step < puzzle.solution.length; step++) {
    const call = session.hint();
    if (call === null) continue;
    named++;
    // THE PROPERTY, measured by PLAYING it on a copy of the line rather than by reading the answer key.
    const before = progress(session);
    const copy = new PlaySession(puzzle, applier);
    for (const played of session.moves) copy.play(played);
    const verdict = copy.play(call).verdict;
    if (verdict !== 'illegal' && progress(copy) === before + 1) advanced++;
    // IF THE SEPARATE COPY IS NOT THE SESSION, the hint above was computed for that same board, so the two must agree.
    if (step < puzzle.solution.length) session.play(puzzle.solution[step]);
  }
  check(named === puzzle.solution.length, `the hint names a call from every position of the route (${named} of ${puzzle.solution.length})`);
  check(advanced === named, `and every one of them RAISES the waypoint count by one when played (${advanced} of ${named})`);
  // A SPENT ALLOWANCE HAS NO HINT: naming a call the run would refuse is not advice.
  const spent = new PlaySession(puzzle, applier, 0);
  check(spent.hint() === null, 'a run with no calls left has no hint to give');
}

console.log('\n== 5. the key is the ARRANGEMENT, not the board object ==');
{
  const start = makeSquaredSet();
  check(arrangementKey(start) === arrangementKey(makeSquaredSet()), 'two independently built squared sets share a key');
  const pose = (b) => b.dancers.map((d) => `${d.id}:${d.x},${d.y},${d.heading}`).join('|');
  const readings = applier.readings(start);
  const elsewhere = readings.filter((r) => arrangementKey(r.board) !== arrangementKey(start));
  check(elsewhere.length > 0, `${elsewhere.length} reading(s) leave a DIFFERENT arrangement (e.g. "${elsewhere[0]?.call}"), which is why a stage can be told from the start`);
  // THE OTHER HALF, AND IT IS THE FACT THE WHOLE DESIGN RESTS ON: a call can leave the arrangement you were in — the same
  // key, a different board. That is "many calls end up in the same place", and it is why the key is coarser than the
  // board (and coarser than the pose): two different calls satisfy the same waypoint.
  const sameArrangement = readings.filter((r) => arrangementKey(r.board) === arrangementKey(start) && pose(r.board) !== pose(start));
  check(sameArrangement.length > 0, `and ${sameArrangement.length} leave the SAME arrangement on a DIFFERENT board (e.g. "${sameArrangement[0]?.call}"), so a waypoint is an arrangement rather than a pose`);
  check(arrangementKey(start) !== arrangementKey(elsewhere[0].board) && arrangementKey(start) === arrangementKey(sameArrangement[0].board), 'and the key separates exactly those two cases');
  // THE KEY IS THE ENGINE'S OWN QUOTIENT (`geometryKey` over `boardMatchables`), so this probe does NOT re-test
  // rotation invariance — `engine/test/cells.mjs` does, and a second test here would be a second implementation.
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
