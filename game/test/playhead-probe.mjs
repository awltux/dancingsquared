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
import { Replay } from '../src/ui/playhead.ts';
import { MS_PER_BEAT } from '../src/puzzle/config.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const spec = (onDone) => ({ label: 'Swing', done: onDone ?? (() => undefined) });

console.log('== 1. before anything has been asked for, the beat is ZERO ==');
{
  const p = new Replay();
  // NEGATIVE CONTROL: a playhead that reported the walk's total here would draw the LANDING board before any
  // option had been pressed — the defect the fraction-based version already recorded once, in the same words.
  check(p.beat === 0, `a fresh playhead is at beat 0 (${p.beat})`);
  check(p.isRunning === false, 'and it is not running');
  check(p.label === '', 'and it has no label to show');
}

console.log('\n== 2. a running replay reports the beat it has reached ==');
{
  const p = new Replay();
  p.start(spec(), 8);
  check(p.isRunning === true, 'starting a motion makes it running');
  check(p.beat === 0, 'and it begins at beat 0');
  check(p.totalBeats === 8, `with the walk's total to draw against (${p.totalBeats})`);
  check(p.advance(MS_PER_BEAT) === false, 'one beat in, it has not finished');
  check(p.beat === 1, `and it reports beat 1 (${p.beat})`);
  check(p.advance(MS_PER_BEAT / 2) === false, 'half a beat later it still has not finished');
  check(p.beat === 1.5, `and the beat is fractional, so the picture can be drawn mid-call (${p.beat})`);
  check(p.label === 'Swing', 'and the label rides along for a caption');
}

console.log('\n== 3. the finish is an EDGE, reported once, on the exact total ==');
{
  let done = 0;
  const p = new Replay();
  p.start(spec(() => done++), 4);
  check(p.advance(4 * MS_PER_BEAT) === true, 'the frame that reaches the end reports the finish');
  check(p.isRunning === false, 'and the motion is no longer running');
  check(done === 0, 'and `done` is the CALLER\'s to invoke: the playhead reports the edge, it does not own the verdict');
  // THE CLAMP, and it is what keeps the picture and the verdict in agreement: a motion that stopped a hair
  // short of its beats would draw a board nobody's verdict was computed against.
  check(p.beat === 4, `a finished replay reports exactly the walk's total (${p.beat})`);
  check(p.advance(100) === false, 'and advancing a stopped playhead reports nothing further');
  check(p.beat === 4, 'and does not move the beat');
}

console.log('\n== 4. a zero-beat motion still settles on the ending ==');
{
  // A call the engine cannot walk is charged 0 beats, so there is nothing to interpolate and the replay must
  // complete immediately rather than hang on a frame that never reaches its total.
  const p = new Replay();
  p.start(spec(), 0);
  check(p.beat === 0, 'a zero-beat motion starts at 0');
  check(p.advance(16) === true, 'and completes on the next frame');
  check(p.beat === 0, 'reporting beat 0, which for a stopped walk IS the landing board');
}

console.log('\n== 5. cancel() abandons a motion without reporting ==');
{
  const p = new Replay();
  p.start(spec(), 8);
  p.advance(2 * MS_PER_BEAT);
  p.cancel();
  check(p.isRunning === false, 'the motion is no longer running');
  check(p.beat === 0, 'and the playhead is back in the "nothing asked for" state, not paused mid-walk');
  // Negative control: a `cancel` that left `totalBeats` set would make `beat` report the total for a motion
  // that no longer exists — and `main.ts` uses this on a new puzzle, where the stale motion is the old one.
  check(p.label === '', 'and it has dropped the motion it was showing');
  check(p.advance(MS_PER_BEAT) === false, 'so nothing more is reported from the abandoned walk');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
