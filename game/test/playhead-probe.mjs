// THE REPLAY PLAYHEAD, pinned: the beat it reports, the two states it must not confuse, and the finish edge.
//
// WHY THIS NEEDS A PROBE NOW. Until Phase 3 the playhead reported a FRACTION of a fixed duration, and its two
// load-bearing properties were "0 before anything has been asked for" and "1 once it has finished". It now
// reports a BEAT of a motion whose length the engine decides, and the same two properties became "0 before"
// and "the walk's total after" — which is the state `main.ts` draws a finished replay from. A playhead that
// reported 0 after finishing would snap the picture back to the board the move started on while the verdict
// said where it went, and a playhead whose `advance` reported the finish on every frame would re-run the
// verdict handling 60 times a second.
//
// Usage: node game/test/playhead-probe.mjs
import { Replay, LANDING_HOLD_MS, drillAnswerHoldMs } from '../src/ui/playhead.ts';
import { MS_PER_BEAT } from '../src/puzzle/config.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('== 1. before anything has been asked for, the beat is ZERO ==');
{
  const p = new Replay();
  // These two are TRUE OF ANY IMPLEMENTATION with a zero-length field (`beat` would report 0 either way), and
  // they are here to state the shape rather than to discriminate: what rules out a wrong rule is section 3,
  // where a playhead that used `running` as its "is there a walk" flag reports the START after finishing.
  check(p.beat === 0, `a fresh playhead is at beat 0 (${p.beat})`);
  check(p.isRunning === false, 'and it is not running');
}

console.log('\n== 2. a running replay reports the beat it has reached ==');
{
  const p = new Replay();
  p.start(8);
  check(p.isRunning === true, 'starting a motion makes it running');
  check(p.beat === 0, 'and it begins at beat 0');
  check(p.totalBeats === 8, `with the walk's total to draw against (${p.totalBeats})`);
  check(p.advance(MS_PER_BEAT).landed === false, 'one beat in, it has not finished');
  check(p.beat === 1, `and it reports beat 1 (${p.beat})`);
  check(p.advance(MS_PER_BEAT / 2).landed === false, 'half a beat later it still has not finished');
  check(p.beat === 1.5, `and the beat is fractional, so the picture can be drawn mid-call (${p.beat})`);
}

console.log('\n== 3. the finish is an EDGE, reported once, on the exact total ==');
{
  const p = new Replay();
  p.start(4);
  check(p.advance(4 * MS_PER_BEAT - 1).landed === false, 'one millisecond short of the end is not the finish');
  check(p.advance(1).landed === true, 'the frame that reaches the end reports it');
  check(p.isRunning === false, 'and the motion is no longer running');
  // THE EDGE, NOT THE STATE: `advance` is what the shell acts on, so a second `true` would run the verdict
  // handling twice — which is why the return is checked here rather than the flag alone.
  check(p.advance(MS_PER_BEAT).landed === false, 'and a later frame reports nothing, because the edge has passed');
  // NEGATIVE CONTROL, MEASURED: reporting the finish by STATE (`if (elapsed < total) return false;` with no
  // `running = false`) reddens the two checks above this one — a stopped playhead would claim to be running
  // and would report the finish on every frame the shell ever asks again.
  // THE CLAMP, and it is what keeps the picture and the verdict in agreement: a motion that stopped a hair
  // short of its beats would draw a board nobody's verdict was computed against.
  check(p.beat === 4, `a finished replay reports exactly the walk's total (${p.beat})`);
  check(p.advance(100).landed === false, 'and advancing a stopped playhead reports nothing further');
  check(p.beat === 4, 'and does not move the beat');
  // NEGATIVE CONTROL, MEASURED: using `running` where the class means "a walk has been asked for" (the flag
  // `beat` reads) reddens THESE two checks — a finished playhead would report beat 0, the START board, while
  // the verdict on screen says where the call landed. It was the flag's whole reason for existing.
}

console.log('\n== 4. a zero-beat motion still settles on the ending ==');
{
  // A call the engine cannot walk is charged 0 beats, so there is nothing to interpolate and the replay must
  // complete immediately rather than hang on a frame that never reaches its total.
  const p = new Replay();
  p.start(0);
  check(p.beat === 0, 'a zero-beat motion starts at 0');
  check(p.advance(16).landed === true, 'and completes on the next frame');
  check(p.beat === 0, 'reporting beat 0, which for a stopped walk IS the landing board');
}

console.log('\n== 5. cancel() abandons a motion without reporting ==');
{
  const p = new Replay();
  p.start(8);
  p.advance(2 * MS_PER_BEAT);
  p.cancel();
  check(p.isRunning === false, 'the motion is no longer running');
  check(p.beat === 0, 'and the playhead is back in the "nothing asked for" state, not paused mid-walk');
  // Negative control, MEASURED: a `cancel` that left the walk's length set reddens this — `main.ts` calls it
  // on a new puzzle and on a mode switch, where the stale walk is the previous puzzle's, and a report of its
  // total would draw a board that is not on screen.
  check(p.totalBeats === 0, `and it has dropped the walk it was showing (${p.totalBeats} beats)`);
  check(p.advance(MS_PER_BEAT).landed === false, 'so nothing more is reported from the abandoned walk');
}

console.log('\n== 6. a LINE holds its landing frame, and a VERDICT motion does not ==');
{
  // REPORTED: "Put as 2 second delay/pause after playing the sequence for Drills and Todays Daily before resetting to
  // the first formation/arrangement." The snapback was the shell dropping the motion on the landing frame, and the
  // fix is this hold: `landed` (the verdict's frame) and `done` (the picture's) are now two edges.
  const held = new Replay();
  held.start(4, LANDING_HOLD_MS);
  check(held.advance(4 * MS_PER_BEAT).landed === true, 'the landing frame reports `landed`');
  check(held.phase === 'holding', `and the playhead is HOLDING, not idle (${held.phase})`);
  check(held.isRunning === false, 'while NOT running, so a press during the hold is answered rather than refused');
  // THE FRAME IS THE LANDING BOARD FOR THE WHOLE HOLD, which is what makes the two seconds legible: a beat that drifted
  // would draw a board nobody's verdict was computed against.
  check(held.beat === 4, `and the picture stays on the walk's last beat (${held.beat})`);
  check(held.advance(LANDING_HOLD_MS - 1).done === false, `one millisecond short of ${LANDING_HOLD_MS} ms is not the end`);
  check(held.beat === 4, 'and the beat still has not moved');
  check(held.advance(1).done === true, 'the frame that spends the hold reports `done`');
  check(held.phase === 'idle', 'and the playhead is idle again, which is what returns the picture to the pair');
  check(held.advance(100).done === false, 'and nothing more is reported after it');
  // THE VERDICT MOTION: one edge, so the next question's boards appear on the frame the call lands — a hold there would
  // show the previous answer's board while the next question was being asked.
  const verdict = new Replay();
  verdict.start(2);
  const edge = verdict.advance(2 * MS_PER_BEAT);
  check(edge.landed === true && edge.done === true, 'an unheld motion lands and finishes on the same frame');
  check(verdict.phase === 'idle', 'leaving nothing to hold');
  // NEGATIVE CONTROL, MEASURED: the pre-hold playhead (a single boolean finish) reddens THESE checks — it has no
  // `holding` phase at all, so `done` arrives with `landed` and the line snaps back to the opening formation. The two
  // checks above it are what rule out the opposite error, a hold that also blocks input.
  // AND THE HOLD IS DROPPED BY cancel(), which is the mode change's and the new puzzle's path.
  const cancelled = new Replay();
  cancelled.start(4, LANDING_HOLD_MS);
  cancelled.advance(4 * MS_PER_BEAT);
  cancelled.cancel();
  check(cancelled.phase === 'idle' && cancelled.advance(1).done === false, 'and a cancelled hold reports nothing');
}

console.log('\n== 6. which drill answers hold their landing ==');
{
  // REPORTED: "Drill: Selecting an incorrect answer for a drill that can show an animation should pause at the end like the
  // correct animation. This allows the player to analyse the end setup." The rule is `drillAnswerHoldMs`, and it has three
  // cases rather than one.
  check(drillAnswerHoldMs('wrong', true) === LANDING_HOLD_MS, `a wrong answer on the last step holds (${drillAnswerHoldMs('wrong', true)} ms)`);
  check(drillAnswerHoldMs('wrong', false) === LANDING_HOLD_MS,
    `and so does one before the last step — the step does not advance, so nothing is revealed early (${drillAnswerHoldMs('wrong', false)} ms)`);
  check(drillAnswerHoldMs('correct', true) === LANDING_HOLD_MS, 'a correct answer on the last step holds: it is the run\'s ending');
  // THE ONE EXCEPTION, AND WHY IT IS ONE: the next question is asked FROM this landing, so holding would put its options on
  // screen beside a board that is still frozen.
  check(drillAnswerHoldMs('correct', false) === 0, `a correct answer before the last step holds nothing (${drillAnswerHoldMs('correct', false)} ms)`);
  // THE HOLD IS THE SAME NUMBER FOR BOTH KINDS, which is what "like the correct animation" asks for: two different pauses
  // would be two behaviours to explain, and the report was that there was none at all on the wrong one.
  check(drillAnswerHoldMs('wrong', false) === drillAnswerHoldMs('correct', true),
    'and the wrong answer\'s pause is the same length as the correct one\'s, not a second duration');
  // NEGATIVE CONTROLS, MEASURED: the rule that shipped (hold only on a correct FINAL answer) reddens exactly the two wrong
  // checks; and the plausible "hold everything" rule reddens exactly the mid-run correct one.
  const shipped = (kind, atEnd) => (kind === 'correct' && atEnd ? LANDING_HOLD_MS : 0);
  check(shipped('wrong', true) !== drillAnswerHoldMs('wrong', true) && shipped('wrong', false) !== drillAnswerHoldMs('wrong', false),
    'CONTROL: the rule that shipped holds nothing for a wrong answer, so these two checks would go red on a revert');
  const holdEverything = () => LANDING_HOLD_MS;
  check(holdEverything('correct', false) !== drillAnswerHoldMs('correct', false),
    'CONTROL: holding every answer reddens the mid-run correct check, which is the exception this rule exists for');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
