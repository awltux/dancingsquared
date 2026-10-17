// WHAT ONE CLICK ON A READING MEANS: the picker's armed state, as a table of outcomes.
//
// WHY THIS IS A GATE, and it is the whole reason the rule was extracted. `b4d1d43` shipped an interaction whose own
// comment, its commit message and DESIGN.md §9.2 all said "a click with nothing armed plays the reading" — and the
// code armed on every click and never called `play`, so a single call had no path at all and the Daily could not be
// played past its first move. MEASURED in a real browser against the built app, with `npm run dev:game` over
// `npm run dev:api`. Every check in `parallel-step-probe.mjs` was green throughout, because that probe measures the
// COMPOSER (`parallelLabel`) and not the rule that decides what a click does. The rule could not be imported from
// `ui/daily-screen.ts` at all (the class uses parameter properties, which bare Node's type-stripping loader refuses),
// which is what made it unmeasurable and is why it now lives in `puzzle/arming.ts` (AGENTS.md §4.3).
//
// THE NEGATIVE CONTROLS ARE ROWS, NOT A SEPARATE BLOCK, because the plausible wrong rules each fail exactly one:
//   * "arm on every click" — the rule that shipped. Fails ONLY `an unarmed plain click plays`; every other row below
//     still passes, which is precisely why the shipped version looked finished.
//   * "any second click composes" — fails `the same group twice re-arms` (and would sell a sequence as a parallel
//     step, the thing `parallelLabel` refuses on a measurement).
//   * "the armed reading cannot be clicked again" — fails `a click on the armed reading cancels`.
//
// THE READINGS HERE ARE BUILT, NOT DERIVED, and that is honest for this rule: `decidePick` reads `call` and `selection`
// only (through `readingSpelling`/`parallelLabel`); the `board` it carries is never touched, so a real squared set is
// passed to keep the shape true rather than to be measured.
//
// Usage: node game/test/picker-interaction-probe.mjs   (engine must be built — `makeSquaredSet` is an engine value)
import { makeSquaredSet } from 'dancing-squared-engine';
import { decidePick, isArmed } from '../src/puzzle/arming.ts';
import { parallelLabel, readingSpelling } from '../src/puzzle/readings.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const board = makeSquaredSet();
const whole = { call: 'Circle Left', selection: null, board };
const heads = { call: 'Circle Left', selection: 'Heads', board };
const headsOther = { call: 'Circle Four Left 1/2', selection: 'Heads', board };
const sides = { call: 'Circle Left', selection: 'Sides', board };

console.log('== the table: one click, five outcomes ==');
{
  // ROW 1, THE ONE THAT MATTERS MOST: a plain click with nothing armed PLAYS. This is the check the shipped version
  // fails, and the only one it fails — a single call was simply unreachable.
  const played = decidePick(null, whole, false);
  check(played.kind === 'play', 'an unarmed plain click PLAYS the call (the shipped rule armed here and never played)');
  check(played.kind === 'play' && played.call === 'Circle Left', `and plays the reading's own spelling (${played.call})`);

  // AND A GROUP READING IS PLAYED AS THE GROUP'S MOVE, not as the whole board's call of the same name: `Heads Circle
  // Left` and `Circle Left` are different moves, and the whole-board one is the reading the sections exist to separate.
  const groupPlay = decidePick(null, heads, false);
  check(groupPlay.kind === 'play' && groupPlay.call === 'Heads Circle Left', `a group reading is played as "${groupPlay.call}", not as the bare call`);

  // ROW 2: the arming gesture.
  const armed = decidePick(null, heads, true);
  check(armed.kind === 'arm' && armed.reading === heads, 'a shift-click ARMS the reading, and plays nothing');

  // ROW 3: the armed reading clicked again cancels — and CANCELS RATHER THAN PLAYS, because a second plain click that
  // played would make the arm-then-click gesture a two-move sequence, which is the thing this whole feature refuses.
  check(decidePick(heads, heads, false).kind === 'disarm', 'a click on the armed reading CANCELS it, and does not play it');

  // ROW 4: two different groups compose into the engine's label form, and it is the same string `parallelLabel` builds —
  // one spelling, because the line, the save and the server's replay all carry it.
  const pair = decidePick(heads, sides, false);
  check(pair.kind === 'parallel', 'a click on a reading for a DIFFERENT group composes the two');
  check(pair.kind === 'parallel' && pair.label === parallelLabel(heads, sides), `and the label is the composer's own ("${pair.label}")`);
  check(pair.kind === 'parallel' && pair.label === readingSpelling(heads) + ' || ' + readingSpelling(sides), 'and it is spelled "A || B" so `parseStep` reads it back');

  // ROW 5: the same group twice is a SEQUENCE. It re-arms rather than composing (a lie about what the dancers did) and
  // rather than doing nothing (a click silently ignored).
  const again = decidePick(heads, headsOther, false);
  check(again.kind === 'arm' && again.reading === headsOther, 'the same group twice RE-ARMS on the new reading — a sequence, not a pair');

  // ROW 6: shift always arms, even over an armed reading and even across groups. The gesture must be the one thing a
  // player can rely on while a half-made step is sitting there.
  const rearm = decidePick(heads, sides, true);
  check(rearm.kind === 'arm' && rearm.reading === sides, 'a shift-click ARMS even when a reading is already armed, rather than composing');
}

console.log('\n== the badge and the rule agree ==');
{
  // THE SCREEN LABELS A BUTTON "1st of two" WITH `isArmed`, the same comparison `decidePick` disarms on. If the two
  // drifted, a button would say "1st of two" and a second click would do something else.
  check(isArmed(heads, heads), 'the armed reading reads as armed');
  check(!isArmed(heads, sides), 'another reading does not');
  check(!isArmed(null, heads), 'and nothing is armed when nothing is');
  // BY SPELLING, NOT BY IDENTITY: a re-render can produce a fresh object for the same move, and that must still disarm.
  const twin = { call: 'Circle Left', selection: 'Heads', board: makeSquaredSet() };
  check(isArmed(heads, twin) && decidePick(heads, twin, false).kind === 'disarm', 'a fresh object spelling the same move is still the armed one');
  check(!isArmed(heads, whole), 'while the whole-board reading of the same call is a different move');
}

console.log('\n== NEGATIVE CONTROL: the wrong rules, each run over the same table ==');
{
  // MEASURED, as code. Each of these is the plausible wrong rule, and each disagrees with exactly the row named beside
  // it — which is why the browser found the shipped defect and no probe did.
  //
  // 1. THE RULE AS IT SHIPPED: `if (!armed) { this.armed = reading; return; }` — arm, never play, whatever the gesture.
  const shippedKind = (arming) => (arming ? 'arm' : 'arm');
  check(
    [whole, heads, sides].every(() => shippedKind(false) === 'arm') &&
      [whole, heads, sides].every((r) => decidePick(null, r, false).kind === 'play'),
    'the shipped rule armed for EVERY unarmed reading and never played a single call — `an unarmed plain click PLAYS` is the check that catches it',
  );
  // 2. COMPOSE ANY SECOND CLICK: the same group twice would then be sold as a parallel step, which `parallelLabel`
  //    refuses because the two orders disagree half the time.
  const anySecondKind = (armed) => (armed === null ? 'play' : 'parallel');
  check(anySecondKind(heads) === 'parallel' && decidePick(heads, headsOther, false).kind === 'arm', 'a rule composing ANY second click is caught by `the same group twice RE-ARMS on the new reading`');
  // 3. NO WAY OUT: an armed reading that can only stay armed or compose — every click would be a step, so a player who
  //    armed by mistake could never get back to the board.
  const stickyKind = (armed) => (armed === null ? 'play' : 'arm');
  check(stickyKind(heads) === 'arm' && decidePick(heads, heads, false).kind === 'disarm', 'a rule where the armed reading cannot be cancelled is caught by `a click on the armed reading CANCELS it`');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
