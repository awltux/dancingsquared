// THE DAILY RUN, pinned against a STUB applier: the clock stops once, a hint is charged once and never
// refunded, the allowance is a cap the run cannot exceed, and a given-up run has a time but no score.
//
// WHY A STUB AND NOT THE CORPUS. Every rule here is about the RUN, not about dancing: the clock, the hint
// charge, the cap and the outcome. A real puzzle would make this probe fail for generator reasons and would
// cost seconds per case; the stub makes "reached the goal" decidable by field equality and each case a
// microsecond (AGENTS.md 4.3: the core takes the engine as an argument, and a probe substitutes it).
//
// THE NEGATIVE CONTROLS ARE NAMED PER CHECK, and two of them are load-bearing enough to have been measured
// by breaking the implementation on purpose: a clock that keeps running after the solve, and a hint whose
// charge is refunded by an undo. Both are printed in the summary of the commit that added this file.
//
// Usage: node game/test/daily-run-probe.mjs   (engine must be built: session.ts imports boardSig)
import { makeSquaredSet } from 'dancing-squared-engine';
import { DailyRun } from '../src/game/daily-run.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** One dancer is enough: the session and the run never inspect a second one, and a distinct `x` per board
 * is what lets the exact `reachesGoal` tell them apart. */
const board = (x) => ({ dancers: [{ id: 1, couple: 1, gender: 'boy', x, y: 0, heading: 0 }] });

const A = board(0);
const B = board(1);
const C = board(2);
const D = board(3);

/** The stub's graph: A -> B -> D and A -> C -> D, so the goal is reachable two ways and `stuck` is always
 * refused (which is what makes `hint()`'s "never name a refused call" rule checkable). */
const CALLS = new Map([
  [A, { 'go-b': B, 'go-c': C }],
  [B, { 'go-d': D }],
  [C, { 'go-d': D }],
  [D, {}],
]);

const HINT_PENALTY_SECONDS = 60;   // the shipped charge, and this probe's stub calls are not hint-charged by the engine
const eq = (a, b) =>
  a.dancers.length === b.dancers.length &&
  a.dancers.every((d, i) => d.id === b.dancers[i].id && d.x === b.dancers[i].x && d.y === b.dancers[i].y);

const applier = {
  offered: (b) => Object.entries(CALLS.get(b) ?? {}).map(([call, board]) => ({ call, board })),
  // THE STUB HAS NO GROUPS, so every reading is the whole board — which is exactly what this probe needs: the run's
  // grouping is the SCREEN's question, and the engine-backed list is measured by `daily-readings-probe.mjs`.
  readings: (b) => Object.entries(CALLS.get(b) ?? {}).map(([call, board]) => ({ call, selection: null, board })),
  candidateCalls: () => ['go-b', 'go-c', 'go-d', 'stuck'],
  refusalOf: (b, call) => (call in (CALLS.get(b) ?? {}) ? null : { call, reason: 'no' }),
  apply: (b, call) => {
    const out = CALLS.get(b)?.[call];
    if (!out) throw new Error(`apply(${call}) was refused after refusalOf said it applies`);
    return out;
  },
  reachesGoal: eq,
  nameOf: () => 'Stub Formation',
  // THE WIDER VALIDITY QUESTION, so the stub can describe GameApplier without pretending: every board it makes is a
  // named stub formation, and the corpus name beside that is the same string.
  formationOf: () => 'Stub Formation',
};

const puzzle = {
  mode: 'daily',
  seed: 1,
  level: { index: 3, poolSize: 15, depth: 2, optionCount: 2 },
  poolVersion: 'stub',
  start: A,
  goal: D,
  path: [A, D],
  steps: [],
  solution: ['go-b', 'go-d'],
  shortest: 2,
  alternatePath: true,
  explored: 0,
};

/** A fresh run with the clock starting at t = 0 ms. */
const fresh = (allowance) => new DailyRun(puzzle, applier, 0, allowance);

console.log('== 1. a fresh run is playing, on the start board, with the shipped allowance ==');
{
  const run = fresh();
  const v = run.view(0);
  check(v.outcome === 'playing', 'the run is playing');
  check(v.board === A, 'the board is the puzzle start');
  check(v.atGoal === false, 'and the goal is not reached');
  check(v.elapsedSeconds === 0, 'the clock reads zero at the frame the run started');
  // MEASURED: `shortest` is 2 and the cushion is 2, so the shipped allowance is 4.
  check(v.allowance === 4, `the allowance is the shortest solution plus the cushion (${v.allowance})`);
  check(v.movesLeft === 4 && v.movesUsed === 0, 'and nothing has been spent');
  check(v.goalName === 'Stub Formation', 'the goal board is named for display only');
  check(v.readings.length === 2, `the offering list is what is legal now (${v.readings.map((m) => m.call).join(', ')})`);
  check(run.board === A, 'and the run reports the board it is standing on');
}

console.log('\n== 2. a wrong move lands and is free to undo, and the clock keeps running ==');
{
  const run = fresh();
  const first = run.play('go-b', 1000);
  check(first.verdict === 'wrong', `a move that does not reach the goal is 'wrong' (${first.verdict})`);
  check(run.view(1000).moves.length === 1, 'and it is recorded as a move');
  check(run.view(1000).elapsedSeconds === 1, 'the clock reads one second at t = 1000 ms');
  // Negative control: a clock that only ticks on a move would report 0 here, and nothing else checks that
  // the clock is READ rather than incremented.
  check(run.view(2500).elapsedSeconds === 2.5, 'and 2.5 at t = 2500 ms, with no move in between');
  check(run.undo() === true, 'the move can be undone');
  check(run.view(2500).moves.length === 0 && run.view(2500).board === A, 'which puts the player back on the start board');
  check(run.redo() === true && run.view(2500).moves.length === 1, 'and redone');
  check(run.view(2500).elapsedSeconds === 2.5, 'with the undo costing no time of its own — the clock never stopped');
}

console.log('\n== 3. solving stops the clock and scores once ==');
{
  const run = fresh();
  run.play('go-b', 1000);
  const end = run.play('go-d', 4000);
  check(end.verdict === 'correct', `the second move reaches the goal (${end.verdict})`);
  const v = run.view(4000);
  check(v.outcome === 'solved', 'so the run is solved');
  check(v.result !== null, 'and it has a result');
  check(v.result.elapsedSeconds === 4, `the elapsed time is the clock's (${v.result?.elapsedSeconds})`);
  // Negative control: a clock that kept running would make these differ, and that is the check that a
  // finished run's time cannot creep up while the player reads the board.
  check(run.view(60000).elapsedSeconds === 4, 'and reading the run a minute later does not move it');
  check(run.view(60000).result.score === v.result.score, 'nor does the score change');
  check(v.readings.length === 0, 'the offering list is empty once the run is over');
  check(run.undo() === false && run.redo() === false, 'and the stack is closed');
  const late = run.play('go-c', 61000);
  check(late.verdict === 'over' && late.reason.includes('already been scored'), `a late click is refused with its own reason (${late.reason})`);
}

console.log('\n== 4. a hint is charged once, never refunded, and its marker is valid from one board ==');
{
  const run = fresh();
  const h = run.takeHint();
  check(h.spent === true && typeof h.call === 'string', `the hint names a call (${h.call})`);
  check(run.view(0).readings.some((m) => m.call === h.call), 'and it is a call the offering list contains, so the player can follow it');
  check(h.call !== 'stuck', 'and never the refused call');
  // THE SERVER'S NAME WINS WHEN THERE IS ONE (A23's naming), checked on its OWN run so the counting below is not
  // disturbed: the server looks the call up from the line it RECORDED, which is the board the player is actually on,
  // where this object's own look-up runs from the position it believes it is on. NEGATIVE CONTROL: a run that ignored
  // the argument would name its own call here, and these two are the only checks in the suite that would fail.
  const namedRun = fresh();
  const named = namedRun.takeHint('Bend the Line');
  check(named.spent === true && named.call === 'Bend the Line', `NEGATIVE CONTROL: a name handed in is the one it uses (${named.call})`);
  check(namedRun.view(0).hintedCall === 'Bend the Line', 'and the marker follows the server\'s name, not a local one');
  check(run.view(0).elapsedSeconds === 60, `taking it charges one minute (${run.view(0).elapsedSeconds}s at the frame it was taken)`);
  check(run.view(0).hintsUsed === 1, 'and the run carries the count, because the server clamps on it');
  check(run.view(0).hintedCall === h.call, 'and the marker is on the named call while the player is still on that board');

  run.play(h.call, 1000);
  check(run.view(1000).hintedCall === null, 'the marker clears once the player moves off the board it was named from');
  check(run.view(1000).hintsUsed === 1, 'but the hint is still spent');
  run.undo();
  // NEGATIVE CONTROL, MEASURED: making `undo` decrement `hintsUsed` reddens the three checks in this
  // section that read the count or the clock after an undo, and nothing outside it. It is the rule
  // DESIGN.md 10 states as "information cannot be un-known" — a refundable hint would be a free look at the
  // answer, taken, used, and undone.
  check(run.view(1000).hintsUsed === 1, 'and an undo does not refund it');
  check(run.view(1000).elapsedSeconds === 61, `so the minute is still on the clock (${run.view(1000).elapsedSeconds}s)`);

  const second = run.takeHint();
  check(second.spent === true && run.view(1000).elapsedSeconds === 121, `a second hint is a second minute (${run.view(1000).elapsedSeconds}s)`);
}

console.log('\n== 4b. a SUBMISSION carries the clock, not the time the player is judged on ==');
{
  // THE SERVER ADDS THE HINT CHARGE ITSELF from `hintsUsed` (DESIGN.md 6, 10), so the transcript must carry the
  // CLOCK: sending the charged total would charge every hint twice. The round trip is the check — the two numbers
  // the submission carries must reproduce exactly the time `view` reports, because that is the number the server
  // recomputes with.
  const run = fresh(4);
  // ONE CALL, SO THE RUN IS STILL PLAYING: `go-b` walks the first hop of the route section 3 solves with, and a
  // run that has already reached the goal cannot be hinted at all (the check below would be measuring that instead).
  run.play('go-b', 0);
  check(run.view(5000).elapsedSeconds === 5, `five seconds of thinking reads as five (${run.view(5000).elapsedSeconds})`);
  run.takeHint();
  const view = run.view(10_000);
  const facts = run.submissionFacts(10_000);
  check(view.elapsedSeconds === 10 + HINT_PENALTY_SECONDS, `the view reports the CHARGE (${view.elapsedSeconds} = 10 + ${HINT_PENALTY_SECONDS})`);
  check(facts.clockSeconds === 10, `while the submission carries the clock alone (${facts.clockSeconds})`);
  check(facts.clockSeconds + HINT_PENALTY_SECONDS * facts.hintsUsed === view.elapsedSeconds, 'and the two round trip to the number the player is judged on');
  // NEGATIVE CONTROL, MEASURED: sending `view.elapsedSeconds` instead double-charges, which is a run worth less
  // than it was — the check above is the only one that catches it, because both numbers are "a time" and only
  // their sum is pinned to the view.
  check(facts.clockSeconds !== view.elapsedSeconds, `NEGATIVE CONTROL: the two numbers differ by exactly the charge (${view.elapsedSeconds - facts.clockSeconds} s)`);
  check(facts.hintsUsed === 1, `and how many hints were spent travels beside it (${facts.hintsUsed})`);
  check(facts.calls.join(',') === 'go-b', `with the player's own line as the transcript (${facts.calls.join(',')})`);
  const solved = fresh(4);
  solved.play('go-b', 0);
  solved.play('go-d', 1000);
  check(solved.view(1000).outcome === 'solved' && solved.submissionFacts(1000).score === solved.view(1000).result.score, 'a solved run carries the score the view shows, as the claim the server clamps');
  check(run.submissionFacts(10_000).score === 0, 'and a run still playing carries no score at all');
}

console.log('\n== 5. the allowance is a HARD CAP, and undo is what frees it ==');
{
  const run = fresh(1);
  check(run.view(0).allowance === 1, 'an explicit allowance overrides the shipped one');
  check(run.play('go-b', 0).verdict === 'wrong', 'the first call is allowed');
  const over = run.play('go-d', 0);
  check(over.verdict === 'over', `the second is refused by the budget, not by the engine (${over.verdict})`);
  check(over.reason.includes('undo'), `and the reason says what to do about it (${over.reason})`);
  check(over.board === B && run.view(0).moves.length === 1, 'the refused call did not move the player or the move stack');
  check(run.view(0).movesLeft === 0, 'and the run reports no calls left');
  // Negative control: a session that checked the budget AFTER legality would report `correct` here, which is
  // how a spent run would quietly reach the goal one call past its allowance. `session-undo-probe` pins the
  // same ordering from the session's own side.
  check(run.undo() === true, 'undoing frees a call');
  check(run.view(0).movesLeft === 1, 'so the budget reports one again');
  // The refused call was refused because the BUDGET was spent, not because of the call: after the undo the
  // run accepts a call from the start board again. (From A the legal calls are go-b and go-c — `go-d` was
  // refused above as the SECOND call from B, so re-trying it here would test the engine instead.)
  check(run.play('go-b', 0).verdict === 'wrong', 'and a call is accepted again, so the budget was the whole refusal');
}

console.log('\n== 6. giving up freezes the time and produces no score ==');
{
  const run = fresh();
  run.play('go-b', 1000);
  run.giveUp(9000);
  const v = run.view(9000);
  check(v.outcome === 'given-up', 'the run is given up');
  check(v.result === null, 'and it has NO result: a run nobody solved is not a score');
  check(v.elapsedSeconds === 9, `the time is the clock's at the moment of giving up (${v.elapsedSeconds}s)`);
  check(run.view(60000).elapsedSeconds === 9, 'and it does not keep running after that');
  check(run.play('go-d', 60000).verdict === 'over', 'no further call is accepted');
  const review = run.review();
  check(review.mine.length === 1 && review.mine[0] === 'go-b', `the review can dance the player's own line (${review.mine.join(' ')})`);
  check(review.shortest.length === 2 && review.shortest[0] === 'go-b', `and the generator's shortest (${review.shortest.join(' ')})`);
}

console.log('\n== 7. a run survives a reload, and the gap is charged ==');
{
  // THE ROUND TRIP THE PHASE EXISTS FOR. `save` writes the RUN's clock (never the hint-charged total) and
  // `resume` rebuilds the run from it: the same board, the same line, the same hints, and a clock that kept
  // running while the page was closed.
  const run = fresh();
  run.takeHint();
  run.play('go-b', 1000);
  const saved = run.save('2026-10-15', 'run-r', 1000, 5000);
  check(saved.day === '2026-10-15' && saved.outcome === 'playing', `the record names the day and the state (${saved.day}, ${saved.outcome})`);
  check(saved.moves.length === 1 && saved.moves[0] === 'go-b', `and the line played so far (${saved.moves.join(' ')})`);
  check(saved.elapsedMs === 1000, `and the CLOCK, not the hint-charged total (${saved.elapsedMs} ms, where the view charges the minute separately)`);
  // A MOVE CLEARS THE MARKER, and the record carries the cleared one: the marker names a call from the board
  // the player is standing on, and the move took them off it. The charge stays, which is the no-refund rule.
  check(saved.hintedCall === null, 'a moved-past hint saves no marker');
  check(saved.hintsUsed === 1, 'while its charge does, because an undo cannot refund it and neither can a reload');

  const resumed = DailyRun.resume(puzzle, applier, 20000, saved, { gapMs: 4000 });
  check(resumed !== null, 'the record resumes');
  check(resumed.board === B, 'onto the board the player had reached');
  check(resumed.view(20000).moves.join(' ') === 'go-b', 'with the line intact');
  check(resumed.view(20000).hintsUsed === 1, 'and the hint still spent');
  check(resumed.view(20000).hintedCall === null, 'and no marker left over for a board the player has left');

  // THE OTHER DIRECTION: a marker that WAS still valid when the page closed comes back, because it names a
  // call the resumed run is still standing in front of.
  const standing = fresh();
  const hint = standing.takeHint();
  const markerSaved = standing.save('2026-10-15', 'run-r', 500, 5000);
  check(markerSaved.hintedCall === hint.call, 'a hint taken and not yet acted on saves its marker');
  const markerBack = DailyRun.resume(puzzle, applier, 20000, markerSaved, { gapMs: 0 });
  check(markerBack !== null && markerBack.view(20000).hintedCall === hint.call, 'and the resumed run shows it again');
  // THE GAP, which is the anti-pause rule: 1 s of play + 4 s away reads as 5 s of clock, and the hint's
  // minute is on top of that.
  check(resumed.view(20000).elapsedSeconds === 65, `the away time is charged to the clock (${resumed.view(20000).elapsedSeconds}s = 1 + 4 + 60)`);
  check(resumed.play('go-d', 20000).verdict === 'correct', 'and the resumed run can be finished');
}

console.log('\n== 8. a FINISHED run comes back finished, at its own time ==');
{
  const run = fresh();
  run.play('go-b', 1000);
  run.play('go-d', 4000);
  const before = run.view(4000);
  const saved = run.save('2026-10-15', 'run-r', 4000, 5000);
  check(saved.outcome === 'solved' && saved.elapsedMs === 4000, `the solved run saves its frozen clock (${saved.elapsedMs} ms)`);

  // A STOPPED CLOCK GETS NO GAP: the page was away for a minute, but the clock had already stopped, so
  // charging it would move the result the player earned.
  const resumed = DailyRun.resume(puzzle, applier, 65000, saved, { gapMs: 60000 });
  check(resumed !== null, 'the solved record resumes');
  const after = resumed.view(65000);
  check(after.outcome === 'solved', 'still solved');
  check(after.result !== null && after.result.score === before.result.score, `with exactly the score it earned (${after.result?.score})`);
  check(after.elapsedSeconds === before.elapsedSeconds, `and exactly its time (${after.elapsedSeconds}s)`);
  check(resumed.review().mine.join(' ') === 'go-b go-d', 'and the review can dance the line it was played with');

  const givenUp = fresh();
  givenUp.play('go-b', 1000);
  givenUp.giveUp(9000);
  const back = DailyRun.resume(puzzle, applier, 60000, givenUp.save('2026-10-15', 'run-r', 9000, 9500), { gapMs: 50000 });
  check(back !== null && back.view(60000).outcome === 'given-up', 'a given-up run comes back given up');
  check(back.view(60000).result === null && back.view(60000).elapsedSeconds === 9, `with no score and its own time (${back.view(60000).elapsedSeconds}s)`);
}

console.log('\n== 9. a record that no longer applies is REFUSED, not repaired ==');
{
  const run = fresh();
  run.play('go-b', 1000);
  const saved = run.save('2026-10-15', 'run-r', 1000, 5000);
  // NEGATIVE CONTROL, MEASURED: the stub refuses `stuck` (it is the illegal call), so this is the state a
  // pool or corpus change leaves behind — a saved line whose calls no longer apply. A resume that ignored the
  // verdict would rebuild a run that does not match the record it was given.
  const refused = DailyRun.resume(puzzle, applier, 20000, { ...saved, moves: ['stuck'] }, {});
  check(refused === null, 'a saved line containing a call the engine now refuses does not resume');
  // And a record that contradicts itself — a solved state whose line does not solve — is refused too: the
  // moves are the truth and the outcome has to agree with them.
  const contradictory = DailyRun.resume(puzzle, applier, 20000, { ...saved, outcome: 'solved' }, {});
  check(contradictory === null, 'nor does a record claiming a solve its own moves do not reach');
}

console.log('\n== 7. the waypoints are formations, and undo rewinds the progress ==');
{
  // ONE-DANCER BOARDS ARE ENOUGH FOR THE RUN AND USELESS FOR A WAYPOINT: `geometryKey` normalises translation and
  // rotation, so every one-dancer board is the same arrangement. These are real squared sets; `nudge` changes the
  // formation and `shift` moves the same one, which is the distinction `puzzle/arrangement.ts` is built on.
  const A = makeSquaredSet();
  const B = { dancers: A.dancers.map((d, i) => (i === 0 ? { ...d, x: d.x + 0.5 } : d)) };
  const C = { dancers: B.dancers.map((d) => ({ ...d, x: d.x + 1 })) };
  const ROUTE = new Map([[A, { 'go-b': B }], [B, { 'go-c': C }], [C, {}]]);
  /** The same stub surface as above, over the real boards and by IDENTITY, which is exact for these. */
  const stub = {
    ...applier,
    offered: (b) => Object.entries(ROUTE.get(b) ?? {}).map(([call, board]) => ({ call, board })),
    readings: (b) => Object.entries(ROUTE.get(b) ?? {}).map(([call, board]) => ({ call, selection: null, board })),
    refusalOf: (b, call) => (call in (ROUTE.get(b) ?? {}) ? null : { call, reason: 'no' }),
    apply: (b, call) => {
      const out = ROUTE.get(b)?.[call];
      if (!out) throw new Error(`apply(${call}) was refused after refusalOf said it applies`);
      return out;
    },
    reachesGoal: (x, y) => x === y,
    nameOf: (b) => (b === A ? 'Squared Set' : b === B ? 'Ocean Wave' : 'Ocean Wave, moved'),
    formationOf: (b) => (b === A ? 'Squared Set' : b === B ? 'Ocean Wave' : 'Ocean Wave, moved'),
  };
  const p = { ...puzzle, start: A, goal: C, path: [A, B, C], solution: ['go-b', 'go-c'], shortest: 2 };
  const run = new DailyRun(p, stub, 0, 4);
  const v = run.view(0);
  check(v.waypoints.length === 2, `three route boards, TWO waypoints — C is the formation B already was (${v.waypoints.length})`);
  check(v.waypoints[0].board === A && v.waypoints[1].board === B, 'and each carries the route’s own board, for the picture');
  check(v.waypoints[0].label === 'Squared Set' && v.waypoints[1].label === 'Ocean Wave',
    `with the recogniser's name as the caption (${v.waypoints.map((w) => w.label).join(' → ')})`);
  check(v.progress === 0, 'the start is waypoint 1, so nothing is behind the player yet');

  run.play('go-b', 1000);
  check(run.view(1000).progress === 1, 'a move into a new formation advances the waypoint');

  // THE USER'S RULE, MEASURED: "the existing undo/redo buttons should update these states" — progress is derived
  // from the move stack, so it rewinds and re-advances with it and cannot disagree with the line. This is done
  // BEFORE the solve, because a finished run closes the stack (section 3 pins that).
  check(run.undo() === true && run.view(1500).progress === 0, 'undo rewinds the waypoint to the start');
  check(run.redo() === true && run.view(1500).progress === 1, 'and redo brings it back');

  run.play('go-c', 2000);
  check(run.view(2000).outcome === 'solved', 'the second move reaches the goal board');
  check(run.view(2000).progress === 1, `and reaches NO new waypoint, because it ends in the formation it was already in (${run.view(2000).progress})`);
  check(run.undo() === false, 'a solved run closes the stack, so that state cannot be unwound by accident');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
