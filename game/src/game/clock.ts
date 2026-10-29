// The run clock: how long a player has been on the board, with time INJECTED rather than read.
//
// WHY THERE IS NO `Date.now()` IN THIS FILE. A clock read from inside a computation makes the value it
// produces unreproducible, and a run's elapsed time is part of what the server recomputes to clamp a score
// (DESIGN.md 6). So the caller passes the frame's timestamp — `main.ts` already owns the one animation frame
// loop — and this class only remembers when the run started and stopped.
//
// IT IS NOT `ui/playhead.ts`. That measures how far through a REPLAY the picture is; this measures the RUN,
// which spans many replays and stops once. Two concerns, two objects, and neither reaches into the other.

/**
 * WHEN A DRILL'S CLOCK STARTED, as a DEVICE reading — the one origin the run's elapsed may be measured from.
 *
 * TWO CLOCKS MUST NEVER BE SUBTRACTED FROM EACH OTHER, and that is the whole of this function. REPORTED from a second
 * device: *"The server would not record this run: the run claims 50.4s and the drill was issued 13.3 seconds ago"* — a
 * refused run whose claim was **37 s too long**, and 50.4 − 13.3 = 37.1 is not play time but the device's clock offset
 * from the server's. The rule that produced it was `elapsed = Date.now() − issuedAtMs`: a stamp taken from the SERVER
 * subtracted from a reading taken on the DEVICE, which is zero only when both are the same machine.
 *
 * SO THE ORIGIN IS ALWAYS THIS DEVICE'S `Date.now()`, and a saved one is CARRIED only while it belongs to the same
 * issuance. A server re-issues a position (a restarted store, a replay) and its stamp moves, so a stored origin whose
 * `issuedAtMs` no longer matches is a clock for a different run and starts again at zero — which is the failure
 * DESIGN.md §15 records in the other direction, where the save was 421 s old and the server had re-issued 19.8 s before.
 * The step and the wrong tries are still carried; they are progress, not a clock.
 *
 * THE SERVER MEASURES THE RUN ANYWAY (A21: `submittedAt − issuedAt`, its own facts), so the device's reading is the
 * audit input. Starting from this device's own zero can only UNDER-claim, which the server records beside its own
 * number and never scores.
 */
export function drillClockOrigin(
  serverIssuedAtMs: number,
  saved: { readonly issuedAtMs?: number; readonly startedAtMs: number } | null,
  nowMs: number,
): number {
  const sameIssuance = saved !== null && (saved.issuedAtMs ?? 0) === serverIssuedAtMs;
  return sameIssuance ? saved.startedAtMs : nowMs;
}

export class Stopwatch {
  private startedAt: number | null = null;
  private stoppedAt: number | null = null;

  /**
   * Begin timing at `nowMs`.
   *
   * STARTING A RUNNING CLOCK RESTARTS IT, deliberately: the only caller starts a clock when a run begins,
   * and a restart is what a "start over" would mean. It cannot silently double-count, because `stoppedAt`
   * is cleared with the start.
   */
  start(nowMs: number): void {
    this.startedAt = nowMs;
    this.stoppedAt = null;
  }

  /** Stop at `nowMs`. Stopping a stopped clock is a no-op, so a second finish cannot extend the time. */
  stop(nowMs: number): void {
    if (this.startedAt === null || this.stoppedAt !== null) return;
    this.stoppedAt = nowMs;
  }

  /**
   * Re-base a clock onto a run that began BEFORE this page was open.
   *
   * THE ORIGIN MOVES, NOT THE READING. `elapsedSeconds(nowMs)` is `now - startedAt`, so resuming a run that
   * had already spent 40 seconds means starting the clock 40 seconds ago — there is no separate "elapsed so
   * far" field to drift out of step with it, and no second clock for the resumed run to disagree with.
   *
   * IT LEAVES THE CLOCK RUNNING, because that is what a resumed run is. A caller resuming a run whose clock
   * had already STOPPED (a solved Daily) calls `stop(nowMs)` straight after, which freezes it at exactly the
   * elapsed it was given — the same two calls that produced the original state.
   *
   * A NEGATIVE `elapsedMs` IS CLAMPED TO ZERO rather than trusted: it can only come from a corrupt record or
   * a clock that moved backwards, and either way the player has not been running for negative time.
   */
  resume(nowMs: number, elapsedMs: number): void {
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    this.startedAt = nowMs - elapsed;
    this.stoppedAt = null;
  }

  /** Whether the clock is running now (started and not stopped). */
  get isRunning(): boolean {
    return this.startedAt !== null && this.stoppedAt === null;
  }

  /** Whether it has been stopped — the state a finished run is in. */
  get isStopped(): boolean {
    return this.stoppedAt !== null;
  }

  /**
   * Seconds elapsed, floored to a tenth of a second — the readout's resolution.
   *
   * A CLOCK THAT HAS NOT STARTED READS 0, and one that is stopped reads its frozen value whatever `nowMs`
   * says. Both matter: the first is the state a screen is drawn in before a run exists, and the second is
   * what keeps a solved run's time from creeping up while the player reads the board.
   *
   * THE FLOOR TO TENTHS is what makes the value stable across frames: a raw millisecond count changes on
   * every frame, so the readout would rewrite itself 60 times a second to show the same text, and a probe
   * comparing two of them would be measuring the clock's jitter rather than the rule.
   */
  elapsedSeconds(nowMs: number): number {
    if (this.startedAt === null) return 0;
    const end = this.stoppedAt ?? nowMs;
    const tenths = Math.max(0, Math.floor((end - this.startedAt) / 100));
    return tenths / 10;
  }
}
