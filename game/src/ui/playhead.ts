// The replay playhead: how a click becomes a motion, and what happens when it lands — and, since a completed puzzle
// became replayable, how a scrub moves a playhead that is not running.
//
// IT MEASURES BEATS, NOT A FRACTION, and that changed in Phase 3 with the thing it draws. While a replay was
// a straight line from one board to the next, a fraction was the honest unit — there was nothing else to be a
// fraction OF. The engine's walk charges a call a number of BEATS (`sequenceBeats`) and can be sampled at any
// beat, so the unit the picture is sampled in is now the unit the engine measures in, and `MS_PER_BEAT` is
// the only place the two are related.
//
// IT IS NOT THE POC'S `Player`, and the difference is the point. `poc/src/player.ts` is a state machine over
// a call's BEATS — lead-in hold, play, end hold, speed multiplier, seek — because the browse view lets a
// caller scrub a call's timeline. This playhead now has a SEEK too, but only because a solved puzzle's replay
// is something a player drives: the transcript is a line of calls, and the scrub is how they walk back through it.
// What it still does NOT have is a speed control, and that is deliberate: nothing in the game teaches faster.
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
   * ZERO BEFORE ANY REPLAY HAS BEEN ASKED FOR — `spec === null` — and the walk's total once it has finished.
   * Those are two different states and the first version of this class conflated them: a playhead that has
   * nothing to show must report the START, while a finished one must report the LANDING.
   *
   * IT IS READ FROM `elapsedMs` RATHER THAN FROM `running`, and that is what a SEEK needs: a paused playhead is
   * neither "nothing asked" nor "finished", and the old `!running ⇒ beats` rule would report the end for a
   * scrubbed-to-the-second-call line. `elapsedMs` is CLAMPED to the total on the finish edge, so "finished"
   * still reads as exactly the walk's total.
   */
  get beat(): number {
    if (!this.asked) return 0;
    return Math.min(this.beats, this.elapsedMs / MS_PER_BEAT);
  }

  /** How many beats the motion that is playing (or last played) was charged. */
  get totalBeats(): number {
    return this.beats;
  }

  /** Whether the playhead is parked at the end of the motion it was given — where a replay starts again from 0. */
  get isAtEnd(): boolean {
    return this.asked && this.elapsedMs >= this.totalMs;
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

  /** Stop where we are. The beat stays, so the picture stays and a `resume` continues from it. */
  pause(): void {
    this.running = false;
  }

  /**
   * Continue a paused motion. Returns whether there was anywhere to continue to.
   *
   * A FINISHED MOTION CANNOT RESUME — the caller restarts it (`start`) — and a fresh playhead has never been given
   * anything, so both answer false rather than pretending to run. `main.ts` uses the answer to decide whether the
   * same press means "play" or "play again".
   */
  resume(): boolean {
    if (!this.asked || this.isAtEnd) return false;
    this.running = true;
    return true;
  }

  /**
   * Park the playhead at `beat` and stop. A negative or over-long beat is CLAMPED, so the scrub cannot take the
   * picture off the walk it belongs to: the ends of the range are the start board and the landing board.
   *
   * IT DOES NOTHING BEFORE ANY MOTION HAS BEEN ASKED FOR. A scrub is drawn from a line that is already on screen;
   * a seek from a stale event after a puzzle changed must not resurrect a motion the shell has cancelled.
   */
  seek(beat: number): void {
    if (!this.asked) return;
    const clamped = Math.min(Math.max(beat, 0), this.beats);
    this.elapsedMs = clamped * MS_PER_BEAT;
    this.running = false;
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
    this.totalMs = 0;
    this.beats = 0;
  }
}
