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

/**
 * HOW LONG A LINE'S LANDING BOARD IS HELD once the walk has been drawn.
 *
 * REPORTED: "Put as 2 second delay/pause after the playing the sequence for Drills and Todays Daily before resetting
 * to the first formation/arrangement. It makes it easier for a person to digest the animation is finished."
 *
 * THE SNAPBACK WAS REAL AND IT WAS THE SHELL'S: when a replay finished, `main.ts` dropped the motion in the same
 * frame, so `drawPair` painted the PANEL's pair again — and the panel's left board is the board the run STARTED
 * from (`DrillController.view().from`, and the Daily's own first waypoint). So the line played to its ending and
 * then jumped straight back to the opening formation, which reads as "that was not the end of anything".
 *
 * TWO SECONDS, asked for by the owner, and it is a HOLD rather than a longer walk: the picture stops on the final
 * frame, nothing is charged extra, and the input stays live (see `isRunning`) so the player can answer the next
 * call while the last board is still on screen.
 */
export const LANDING_HOLD_MS = 2000;

/**
 * HOW LONG A DRILL ANSWER'S ANIMATION HOLDS ITS LANDING.
 *
 * REPORTED: "Drill: Selecting an incorrect answer for a drill that can show an animation should pause at the end like the
 * correct animation. This allows the player to analyse the end setup." It did not: the wrong answer's replay was started with
 * no hold (`main.ts` passed nothing), so the picture went back to the question's own pair on the landing frame — the board
 * that says where the call went was gone in the instant it arrived.
 *
 * THREE WAYS A DRILL ANSWER ENDS, and the hold is what each one is for:
 *   * A CORRECT ANSWER ON THE LAST STEP HOLDS. It is the run's ending, and `autoProgress` counts its pause before advancing.
 *   * A CORRECT ANSWER BEFORE THE LAST STEP HOLDS NOTHING, and that is the one exception: the next question is asked FROM
 *     this landing, so holding would leave the new options on screen beside a board that is still frozen — the confusion the
 *     hold exists to remove rather than add (the measurement is on a correct mid-run answer in `main.ts`'s `answer`).
 *   * A WRONG ANSWER HOLDS, which is the report. The board after the wrong call IS the thing to study — "legal, but the set
 *     is no closer to the goal" is a claim about a picture — and a wrong answer does not advance the step, so nothing is
 *     revealed early by waiting.
 *
 * THE RULE LIVES HERE because this module owns the hold, and it is a function rather than three inline ternaries so that a
 * probe can drive the four cases: `game/test/playhead-probe.mjs` pins them, with the rule that shipped (hold only on a
 * correct final answer) as the negative control.
 */
export function drillAnswerHoldMs(kind: 'correct' | 'wrong', atEnd: boolean): number {
  if (kind === 'correct' && !atEnd) return 0;
  return LANDING_HOLD_MS;
}

export class Replay {
  private running = false;
  /** Whether a motion has ever been asked for. See `beat`: it is not the same as "running". */
  private asked = false;
  private elapsedMs = 0;
  private totalMs = 0;
  private beats = 0;
  /** The landing frame is on screen and the motion has been drawn to its end. See `phase`. */
  private holding = false;
  private holdMs = 0;
  private holdMsLeft = 0;

  /**
   * Whether a motion is IN FLIGHT — the input guard, and NOT the same as "the picture is a motion".
   *
   * THE HOLD IS DELIBERATELY EXCLUDED: during the two-second landing hold the animation is over, so a button that
   * refused a press would be refusing one the player is entitled to make. `phase` is what the frame loop asks.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /** What the shell's loop should do: `idle` nothing, `playing` draw the walk, `holding` draw its last frame. */
  get phase(): 'idle' | 'playing' | 'holding' {
    if (this.running) return 'playing';
    if (this.holding) return 'holding';
    return 'idle';
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
   * Start a replay of `totalBeats` beats, holding the landing for `holdMs`.
   *
   * THE HOLD IS AN ARGUMENT BECAUSE THE TWO KINDS OF MOTION WANT DIFFERENT ENDINGS. A VERDICT animation — one move,
   * whose message is already on screen — must hand the picture straight back, or the next question would appear while
   * the previous board was still frozen. A LINE played from the panel's `Play` is the thing the player asked to watch,
   * so its ending is the content: `playLine` passes `LANDING_HOLD_MS` and every other caller passes nothing.
   *
   * A ZERO-BEAT MOTION IS NOT AN ERROR — it lands on the first `advance`, which is what a caller gets for a list the
   * engine cannot walk at all (a refused call has no motion to show) and what it wants: the end state is drawn with no
   * motion rather than a special case at every call site.
   *
   * IT TAKES NO CALLBACKS. It used to take a `{ label, done }` spec, and by Phase 4 nothing read either: the caption
   * is the SCREEN's, and the completion is a return value from `advance` — which is what keeps one verdict per motion
   * rather than one per frame.
   */
  start(totalBeats: number, holdMs = 0): void {
    this.asked = true;
    this.beats = totalBeats;
    this.totalMs = totalBeats * MS_PER_BEAT;
    this.elapsedMs = 0;
    this.running = true;
    this.holdMs = holdMs;
    this.holdMsLeft = holdMs;
    this.holding = false;
  }

  /**
   * Advance by `dt` ms, reporting the two edges ONCE each.
   *
   * `landed` is the frame the walk reaches its last beat — where the verdict and the step's advance belong. `done` is
   * the frame the landing hold expires — where the picture goes back to the panel's own pair. They are the SAME frame
   * for an unheld motion (`holdMs === 0`), which is every verdict animation, so the two-edge shape costs those callers
   * nothing.
   *
   * THE EDGES ARE EDGES, NOT STATES: the frame loop acts on them, and a `true` that repeated would run the verdict
   * handling sixty times a second.
   */
  advance(dt: number): { landed: boolean; done: boolean } {
    if (this.holding) {
      this.holdMsLeft -= dt;
      if (this.holdMsLeft > 0) return { landed: false, done: false };
      this.holding = false;
      this.holdMsLeft = 0;
      return { landed: false, done: true };
    }
    if (!this.running) return { landed: false, done: false };
    this.elapsedMs += dt;
    if (this.elapsedMs < this.totalMs) return { landed: false, done: false };
    // CLAMPED, so `beat` is exactly the total on the landing frame: the last thing drawn must be the ending board
    // itself, not a value a hair short of it. A walk that stopped at 0.999 of its beats would draw a board nobody's
    // verdict was computed against.
    this.elapsedMs = this.totalMs;
    this.running = false;
    if (this.holdMs > 0) {
      this.holding = true;
      this.holdMsLeft = this.holdMs;
      return { landed: true, done: false };
    }
    return { landed: true, done: true };
  }

  /** Stop without reporting, for a replay abandoned by a mode change or a new puzzle. */
  cancel(): void {
    this.running = false;
    this.holding = false;
    this.asked = false;
    this.elapsedMs = 0;
    this.beats = 0;
    this.holdMs = 0;
    this.holdMsLeft = 0;
  }
}
