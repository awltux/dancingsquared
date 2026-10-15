// The replay playhead: how a click becomes a motion, and what happens when it lands.
//
// IT IS NOT THE POC'S `Player`, and the difference is the point. `poc/src/player.ts` is a state machine over
// a call's BEATS — lead-in hold, play, end hold, speed multiplier, seek — because the browse view lets a
// caller scrub a call's timeline. A Drill option is a single transition between two boards, so this owns a
// FRACTION and a duration, and deliberately has no speed control and no scrubbing: DESIGN.md §13's Drill is
// "watch the option, then answer", not an editor.
//
// IT DRIVES NOTHING ITSELF. `main.ts` owns the one rAF loop that calls `advance` and then draws, so there is
// a single place that knows about time — a second loop inside this class is how two clocks end up
// disagreeing about what frame it is.
import { easeInOut } from '../game/tween.ts';

export interface ReplaySpec {
  /** Shown while the motion runs and once it lands. */
  label: string;
  /** The verdict the playhead's completion reports, so the caller does not keep a parallel copy. */
  done: () => void;
}

export class Replay {
  private running = false;
  private elapsedMs = 0;
  private totalMs = 0;
  private spec: ReplaySpec | null = null;

  /** Whether a motion is in flight. The UI uses this to disable the buttons while one plays. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * The eased fraction to draw: 0 at the start board, 1 on the ending board.
   *
   * ZERO BEFORE ANY REPLAY HAS BEEN ASKED FOR — `spec === null` — and 1 after one has finished. Those are
   * two different states and the first version conflated them: a playhead that has nothing to show must
   * report the START (0), while a finished one must report the LANDING (1). Reporting 1 for both drew the
   * ending board before any option had been chosen.
   */
  get fraction(): number {
    if (this.spec === null) return 0;
    if (!this.running) return 1;
    return this.totalMs <= 0 ? 1 : easeInOut(this.elapsedMs / this.totalMs);
  }

  get label(): string {
    return this.spec?.label ?? '';
  }

  /**
   * Start a replay of `durationMs`.
   *
   * A ZERO OR NEGATIVE DURATION IS NOT AN ERROR — it completes immediately on the next `advance`, which is
   * what a caller gets if it wants the end state drawn with no motion. Refusing it would put a special case
   * in every call site for the one case where "there is nothing to show" is the right answer.
   */
  start(spec: ReplaySpec, durationMs = 700): void {
    this.spec = spec;
    this.totalMs = durationMs;
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
    // CLAMPED, so `fraction` is exactly 1 on the landing frame: the last thing drawn must be the ending
    // board itself, not a value a hair short of it. An interpolation that stops at 0.999 draws a board
    // nobody's verdict was computed against.
    this.elapsedMs = this.totalMs;
    return true;
  }

  /** Stop without reporting, for a replay abandoned by a mode change or a new puzzle. */
  cancel(): void {
    this.running = false;
    this.spec = null;
    this.elapsedMs = 0;
  }
}
