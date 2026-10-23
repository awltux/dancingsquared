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
  check(p.advance(MS_PER_BEAT) === false, 'one beat in, it has not finished');
  check(p.beat === 1, `and it reports beat 1 (${p.beat})`);
  check(p.advance(MS_PER_BEAT / 2) === false, 'half a beat later it still has not finished');
  check(p.beat === 1.5, `and the beat is fractional, so the picture can be drawn mid-call (${p.beat})`);
}

console.log('\n== 3. the finish is an EDGE, reported once, on the exact total ==');
{
  const p = new Replay();
  p.start(4);
  check(p.advance(4 * MS_PER_BEAT - 1) === false, 'one millisecond short of the end is not the finish');
  check(p.advance(1) === true, 'the frame that reaches the end reports it');
  check(p.isRunning === false, 'and the motion is no longer running');
  // THE EDGE, NOT THE STATE: `advance` is what the shell acts on, so a second `true` would run the verdict
  // handling twice — which is why the return is checked here rather than the flag alone.
  check(p.advance(MS_PER_BEAT) === false, 'and a later frame reports nothing, because the edge has passed');
  // NEGATIVE CONTROL, MEASURED: reporting the finish by STATE (`if (elapsed < total) return false;` with no
  // `running = false`) reddens the two checks above this one — a stopped playhead would claim to be running
  // and would report the finish on every frame the shell ever asks again.
  // THE CLAMP, and it is what keeps the picture and the verdict in agreement: a motion that stopped a hair
  // short of its beats would draw a board nobody's verdict was computed against.
  check(p.beat === 4, `a finished replay reports exactly the walk's total (${p.beat})`);
  check(p.advance(100) === false, 'and advancing a stopped playhead reports nothing further');
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
  check(p.advance(16) === true, 'and completes on the next frame');
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
  check(p.advance(MS_PER_BEAT) === false, 'so nothing more is reported from the abandoned walk');
}

console.log('\n== 6. a PAUSED playhead keeps its beat, and a SEEK moves it ==');
{
  // THE TRANSPORT'S HALF OF THE CLASS: a solved puzzle's replay is driven by the player (play / pause / scrub), so
  // "not running" no longer means "at the end". MEASURED as the defect this replaces: `beat` was `!running ? beats`,
  // so a pause on call 2 of 5 would have repainted the LANDING board while the transport said call 2.
  const p = new Replay();
  p.start(8);
  p.advance(3 * MS_PER_BEAT);
  p.pause();
  check(p.isRunning === false, 'a pause stops the motion');
  check(p.beat === 3, `and holds the beat where it stopped (${p.beat})`);
  check(p.isAtEnd === false, 'while not claiming to be at the end');
  check(p.advance(5 * MS_PER_BEAT) === false && p.beat === 3, 'and frames pass without moving it');

  p.resume();
  check(p.isRunning === true, 'resume continues from the same beat');
  check(p.advance(MS_PER_BEAT) === false && p.beat === 4, `and the next beat is the one after the pause (${p.beat})`);

  p.seek(6.5);
  check(p.isRunning === false, 'a seek stops the motion — scrubbing is not playing');
  check(p.beat === 6.5, `and parks the playhead exactly there (${p.beat})`);
  p.seek(-3);
  check(p.beat === 0, `and a negative seek clamps to the start rather than throwing (${p.beat})`);
  p.seek(99);
  check(p.beat === 8 && p.isAtEnd === true, `and a seek past the end lands on the landing board (${p.beat})`);
  check(p.resume() === false, 'a playhead parked at the end does not resume — the transport restarts it instead');

  // AND A CANCELLED PLAYHEAD IGNORES A SEEK, so a stale scrub event cannot resurrect the motion it belonged to.
  p.cancel();
  p.seek(4);
  check(p.beat === 0 && p.totalBeats === 0, 'a seek on a cancelled playhead is ignored, so a stale event draws nothing');
  check(p.resume() === false, 'and it cannot be resumed either');

  // NEGATIVE CONTROL for the pause: the rule `!running ⇒ beats` (the pre-transport one) reports the LANDING after the
  // pause, which is exactly the check above — `holds the beat where it stopped` — and nothing else in this probe.
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
