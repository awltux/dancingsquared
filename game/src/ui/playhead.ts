// The replay playhead: how a click becomes a motion, and what happens when it lands.
//
// IT MEASURES BEATS, NOT A FRACTION, and that changed in Phase 3 with the thing it draws. While a replay was
// a straight line from one board to the next, a fraction was the honest unit — there was nothing else to be a
// fraction OF. The engine's walk charges a call a number of BEATS (`sequenceBeats`) and can be sampled at any
// beat, so the unit the picture is sampled in is now the unit the engine measures in, and `MS_PER_BEAT` is
// the only place the two are related.
//
// IT IS NOT THE POC'S `Player`, and the difference is the point. `poc/src/player.ts` is a state machine over
// a call's BEATS — lead-in hold, play, end hold, speed multiplier, seek — because the browse view lets a
// caller scrub a call's timeline. Here the clock only ever runs forward: DESIGN.md §8's Drill is "watch the
// option, then answer", not an editor, so there is no speed control and no scrubbing.
//
// IT DRIVES NOTHING ITSELF. `main.ts` owns the one rAF loop that calls `advance` and then draws, so there is
// a single place that knows about time — a second loop inside this class is how two clocks end up
// disagreeing about what frame it is.
import { MS_PER_BEAT } from '../puzzle/config.ts';

export class Replay {
  private running = false;
  /** Whether a motion has ever been asked for. See `beat`: it is not the same as "running". */
  private asked = false;
  private elapsedMs = 0;
  private totalMs = 0;
  private beats = 0;

  /** Whether a motion is in flight. The UI uses this to disable the buttons while one plays. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * The beat to draw.
   *
   * ZERO BEFORE ANY REPLAY HAS BEEN ASKED FOR — `spec === null` — and the whole walk's beats after one has
   * finished. Those are two different states and the first version of this class conflated them: a playhead
   * that has nothing to show must report the START, while a finished one must report the LANDING. Reporting
   * the end for both drew the ending board before any option had been chosen.
   */
  get beat(): number {
    if (!this.asked) return 0;
    if (!this.running) return this.beats;
    return Math.min(this.beats, this.elapsedMs / MS_PER_BEAT);
  }

  /** How many beats the motion that is playing (or last played) was charged. */
  get totalBeats(): number {
    return this.beats;
  }

  /**
   * Start a replay of `totalBeats` beats.
   *
   * A ZERO-BEAT MOTION IS NOT AN ERROR — it completes immediately on the next `advance`, which is what a
   * caller gets for a list the engine cannot walk at all (a refused call has no motion to show) and what it
   * wants: the end state is drawn with no motion rather than a special case at every call site.
   *
   * IT TAKES NOTHING BUT A LENGTH. It used to take a `{ label, done }` spec, and by Phase 4 nothing read
   * either: the caption is the SCREEN's (it says the call in the verdict line, where it stays visible after
   * the motion), and the completion is a return value from `advance` rather than a callback — which is what
   * keeps one verdict per motion rather than one per frame.
   */
  start(totalBeats: number): void {
    this.asked = true;
    this.beats = totalBeats;
    this.totalMs = totalBeats * MS_PER_BEAT;
    this.elapsedMs = 0;
    this.running = true;
  }

  /**
   * Advance by `dt` ms. Returns true when the motion has FINISHED ON THIS CALL — the edge, not the state,
   * so a caller reports the verdict once rather than once per frame.
   */
  advance(dt: number): boolean {
    if (!this.running) return false;
    this.elapsedMs += dt;
    if (this.elapsedMs < this.totalMs) return false;
    this.running = false;
    // CLAMPED, so `beat` is exactly the total on the landing frame: the last thing drawn must be the ending
    // board itself, not a value a hair short of it. A walk that stopped at 0.999 of its beats would draw a
    // board nobody's verdict was computed against.
    this.elapsedMs = this.totalMs;
    return true;
  }

  /** Stop without reporting, for a replay abandoned by a mode change or a new puzzle. */
  cancel(): void {
    this.running = false;
    this.asked = false;
    this.elapsedMs = 0;
    this.beats = 0;
  }
}
