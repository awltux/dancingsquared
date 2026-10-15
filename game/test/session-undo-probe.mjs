// THE PLAY SESSION'S UNDO/REDO MACHINE AND ITS FOUR-VALUED VERDICT, pinned against a STUB applier
// over a hand-made four-board graph — no engine value, no corpus, no sequencer.
//
// WHAT THIS PINS, and why it needs its own probe: `puzzle-core-probe.mjs` measures the GENERATED
// puzzle (options legal, distinct, solvable, reproducible). It never plays one, so it cannot see the
// two rules that only exist once a player starts pressing buttons:
//
//   * THE TRUNCATION RULE (`session.ts:123-125`). A new move clears the redo stack, because the undone
//     moves were ALTERNATIVES to the move just played and a redo of one would splice together a path
//     that never happened. The failure this catches is a session that keeps a stale redo stack: the
//     player undoes, plays something else, and can still "redo" the discarded branch — walking to a
//     board that does not follow from where they are. Checks 5/6/7 are the sequence that isolates it;
//     a rule that only ever pushed to the redo stack would pass 5 and 6 and fail 7, and a rule that
//     never cleared the stack is exactly the alternative check 7 rules out.
//
//   * THE ILLEGAL-CALL RULE (`session.ts:116-118`). A refused call is a VERDICT, not a step: the
//     session returns `illegal` with the applier's reason verbatim and does NOT move, does NOT record
//     a move, and does NOT create a redo entry. Check 3 is the negative control for the plausible
//     wrong rule "a refusal is recorded as a move" — that would silently mark a player's illegal
//     attempt as progress and corrupt every submission built from `moves`.
//
//   * THE MOVE-ALLOWANCE CAP (section 13), which is checked BEFORE legality: at the cap the player is told
//     to undo, whether or not the call they pressed was legal too.
//
// THE STUB IS THE POINT (AGENTS.md 4.3/5: the core is pure over an injected `GameApplier`, and a probe
// substitutes one rather than importing the real engine applier). The stub's `boardsMatch` is an EXACT
// field comparison rather than a tolerance, so "reached the goal" is decidable here by construction.
//
// Usage: node game/test/session-undo-probe.mjs   (engine must be built: session.ts imports boardSig)
import { PlaySession } from '../src/puzzle/session.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- the stub graph, four boards: A -> B -> D and A -> C -> D
/** One dancer is enough: the session never inspects a second one, and a distinct `x` per board is what
 * lets the exact `boardsMatch` tell them apart. */
const board = (id, x, heading = 0) => ({
  dancers: [{ id, couple: 1, gender: 'boy', x, y: 0, heading }],
});

const A = board(1, 0);
const B = board(1, 1);
const C = board(1, 2);
const D = board(1, 3);

/** The legal calls, keyed by board IDENTITY (not by signature — a signature is positions-only and the
 * stub graph is deliberately distinguishable by identity). `stuck` is absent by construction: the stub
 * refuses it rather than offering it, which is what makes it usable as the illegal-call control. */
const CALLS = new Map([
  [A, { 'go-b': B, 'go-c': C }],
  [B, { 'go-d': D }],
  [C, { 'go-d': D }],
  [D, {}],
]);

/** EXACT comparison — same id, x, y and heading. No tolerance, so the goal test cannot pass by being
 * "close"; that is what makes every `atGoal()` assertion below decidable in the stub. */
const eq = (a, b) =>
  a.dancers.length === b.dancers.length &&
  a.dancers.every((d, i) => {
    const e = b.dancers[i];
    return d.id === e.id && d.x === e.x && d.y === e.y && d.heading === e.heading;
  });

const applier = {
  offered(b) {
    return Object.entries(CALLS.get(b) ?? {}).map(([call, board]) => ({ call, board }));
  },
  candidateCalls() {
    return ['go-b', 'go-c', 'go-d', 'stuck'];
  },
  refusalOf(b, call) {
    if (call in (CALLS.get(b) ?? {})) return null;
    // `stuck` carries the stub's own one-word reason, verbatim — the session must pass it through
    // without rewording, and check 3 asserts the exact string.
    return { call, reason: call === 'stuck' ? 'no' : `the stub knows no "${call}" from this board` };
  },
  apply(b, call) {
    const out = CALLS.get(b)?.[call];
    // Mirrors the real applier: `apply` is only reached after `refusalOf` said yes, so a miss here is a
    // caller using `apply` as a legality test rather than a quiet no-op.
    if (!out) throw new Error(`apply(${call}) was refused after refusalOf said it applies`);
    return out;
  },
  boardsMatch: eq,
  nameOf() {
    return null;
  },
};

/** Only `start`, `goal` and `shortest` are read by `PlaySession`; the step/path fields are present
 * because `Puzzle` requires them and are deliberately empty — this probe tests the session, not a
 * generated puzzle (that is `puzzle-core-probe.mjs`'s job). */
const puzzle = {
  mode: 'drill',
  seed: 1,
  level: { index: 1, poolSize: 3, depth: 2, optionCount: 2 },
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

const fresh = () => new PlaySession(puzzle, applier);

console.log('== 1. a fresh session is on the start board and has nothing to redo ==');
{
  const s = fresh();
  // Rules out a session that starts on the goal (which would make every puzzle already won) and one
  // that seeds `moves`/`canRedo` from the puzzle's own solution.
  check(s.board === A, 'board IS the puzzle start');
  check(s.moves.length === 0, `moves is empty (${s.moves.length})`);
  check(s.canRedo === false, 'canRedo is false before anything has been undone');
  check(s.atGoal() === false, 'and the start is not the goal');
}

console.log('\n== 2. a legal move that does not reach the goal is `wrong`, and IS recorded ==');
{
  const s = fresh();
  const r = s.play('go-b');
  // Rules out "wrong means refused": a dead end is a legal, recorded move (session.ts:112-114).
  check(r.verdict === 'wrong', `play('go-b') verdicts 'wrong' (${r.verdict})`);
  check(s.board === B, 'the session moved to B');
  check(s.moves.length === 1 && s.moves[0] === 'go-b', `moves is ['go-b'] (${JSON.stringify(s.moves)})`);
}

console.log('\n== 3. an ILLEGAL call is a verdict, NOT a move (the negative control) ==');
{
  const s = fresh();
  const r = s.play('stuck');
  // THE ANALYSIS DOES NOT MOVE. The wrong rule this rules out is "a refusal is recorded as a move":
  // under it the board would stay on A (indistinguishable from here) but `moves` would grow to
  // ['stuck'] and a later undo would "restore" a board that was never left.
  check(r.verdict === 'illegal', `play('stuck') verdicts 'illegal' (${r.verdict})`);
  check(r.reason === 'no', `and carries the stub's reason verbatim (${JSON.stringify(r.reason)})`);
  check(s.board === A, 'the session did NOT move');
  check(s.moves.length === 0, `moves was NOT appended to (${JSON.stringify(s.moves)})`);
  check(s.canRedo === false, 'and no redo entry was created for it');
}

console.log('\n== 4. reaching the goal is `correct` ==');
{
  const s = fresh();
  s.play('go-b');
  const r = s.play('go-d');
  check(r.verdict === 'correct', `play('go-d') from B verdicts 'correct' (${r.verdict})`);
  check(s.atGoal() === true, 'and atGoal() is true — correctness is the applier\'s board rule');
}

console.log('\n== 5. undo returns the session to the previous board ==');
{
  const s = fresh();
  s.play('go-b');
  s.play('go-d');
  check(s.undo() === true, 'undo() returns true when there was a move to undo');
  check(s.board === B, 'the board is B again');
  check(s.canRedo === true, 'the undone move is now redoable');
  check(s.atGoal() === false, 'and the goal is no longer reached');
}

console.log('\n== 6. redo replays the undone move ==');
{
  const s = fresh();
  s.play('go-b');
  s.play('go-d');
  s.undo();
  check(s.redo() === true, 'redo() returns true when there was something undone');
  check(s.board === D, 'the board is D again');
  check(s.atGoal() === true, 'and the goal is reached again');
}

console.log('\n== 7. THE TRUNCATION RULE: a new move discards the redo branch ==');
{
  const s = fresh();
  s.play('go-b');
  s.play('go-d');
  s.undo(); // now on B, with go-d redoable
  check(s.canRedo === true, 'precondition: a redo is available after the undo');
  const r = s.play('go-d'); // a NEW move from the same board
  check(r.verdict === 'correct', 'the new move applies');
  // THE CHECK THAT CATCHES A STALE REDO STACK. The move just played replaces the undone branch; if
  // `redoStack` were not cleared, canRedo would still be true and a redo would re-append a move whose
  // `from` board no longer precedes the current one — a fabricated history. Checks 5 and 6 both pass
  // under the wrong rule, which is why this one exists.
  check(s.canRedo === false, 'and canRedo is FALSE — the redo branch was discarded by the new move');
}

console.log('\n== 8. undo/redo on empty stacks report failure rather than guess ==');
{
  const s = fresh();
  // Rules out a `pop()`-and-return-true implementation where an empty stack yields `undefined` but a
  // truthy boolean, which would make an undo key look like it did something.
  check(s.undo() === false, 'undo() on a fresh session returns false');
  check(s.redo() === false, 'redo() with nothing undone returns false');
}

console.log('\n== 9. undo unwinds the whole history back to the start ==');
{
  const s = fresh();
  s.play('go-b');
  s.play('go-d');
  check(s.undo() === true, 'first undo succeeds');
  check(s.undo() === true, 'second undo succeeds');
  // Rules out "undo restores the board but leaves `moves` at its old length", which would submit a
  // longer path than the player actually stands on.
  check(s.board === A, 'the session is back on the start board A');
  check(s.moves.length === 0, `moves is empty (${JSON.stringify(s.moves)})`);
  check(s.atGoal() === false, 'and the goal is not reached');
}

console.log('\n== 10. BOTH routes win: correctness is the goal BOARD, not a fixed call list ==');
{
  const s = fresh();
  const first = s.play('go-c');
  check(first.verdict === 'wrong', `the alternate route's first move is 'wrong' (C is not the goal) (${first.verdict})`);
  const second = s.play('go-d');
  check(second.verdict === 'correct', `and its second move is 'correct' (${second.verdict})`);
  check(s.atGoal() === true, 'so the A -> C -> D route reaches the goal too');
}

console.log('\n== 11. the hint names a call the session will actually accept ==');
{
  const s = fresh();
  const h = s.hint();
  // Rules out a hint that names a REFUSED call (a hint you cannot follow is worse than none) and one
  // that names the other route's call as though it were the only answer.
  check(h === 'go-b' || h === 'go-c', `hint() returns a call of one of the two winning routes (${JSON.stringify(h)})`);
  check(h !== 'stuck', 'and never the refused call');
  // The hint must also be a call the stub offers here — the offered() list is what a player can press.
  check(s.offered().some((m) => m.call === h), 'and it is one of the calls offered from the start board');
}

console.log('\n== 12. offered() is exactly the legal calls, and not the refused one ==');
{
  const s = fresh();
  const calls = s.offered().map((m) => m.call);
  // Rules out an offered() that returns the MENU (`candidateCalls`) rather than the availability: the
  // menu contains `stuck`, and pressing it would be a guaranteed refusal.
  check(calls.length === 2, `two calls are offered from the start (${calls.length})`);
  check(calls.includes('go-b') && calls.includes('go-c'), `they are go-b and go-c (${JSON.stringify(calls)})`);
  check(!calls.includes('stuck'), 'the refused call is NOT offered');
}

console.log('\n== 13. the move allowance is a CAP, and it is checked before the call is looked at ==');
{
  // THE BUDGET IS A HARD CAP, not a score deduction (DESIGN.md 9: "the allowance bounds how much
  // elimination a player can do"). `stuck` is chosen deliberately for the second call: it is ILLEGAL, so a
  // session that checked legality first would answer `illegal` here and one that checks the budget first
  // answers `over`. That difference is the whole check — the reason the player is shown must be the one
  // they can act on, and the actionable sentence is "undo one".
  const s = new PlaySession(puzzle, applier, 1);
  check(s.allowance === 1 && s.movesLeft === 1, `an explicit allowance of 1 is reported (${s.allowance})`);
  const first = s.play('go-b');
  check(first.verdict === 'wrong', `the first call is allowed (${first.verdict})`);
  check(s.movesLeft === 0 && s.movesUsed === 1, 'and the budget is now spent');
  const over = s.play('stuck');
  check(over.verdict === 'over', `a spent run refuses the next call as 'over', not 'illegal' (${over.verdict})`);
  check(over.reason.includes('undo'), `and the reason says how to get a call back (${over.reason})`);
  check(over.board === B && s.moves.length === 1, 'the refused call did not move the board or the move stack');
  check(s.play('go-d').verdict === 'over', 'and it refuses a LEGAL call for the same reason, so the cap is the cause');
  check(s.undo() === true, 'undoing frees a call');
  check(s.movesLeft === 1, `and the budget reports one again (${s.movesLeft})`);
  // The refusal above was the BUDGET and not the call: with a call free again the session accepts one from
  // the board the undo returned to. (`go-d` is not the call to retry here — it was refused at B as the
  // second call, and from A it is genuinely illegal, which would test the engine rather than the cap.)
  check(s.play('go-c').verdict === 'wrong', 'so a call applies again, which is what makes the cap the cause');
  // Negative control, MEASURED: moving the budget check AFTER `refusalOf` reddens exactly the two checks
  // about the ILLEGAL call at the cap (the `over` verdict and its actionable reason, which became the
  // stub's `no`), while the "refuses a LEGAL call" check still passes — and that asymmetry is why the
  // illegal call is the discriminating one here.
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
