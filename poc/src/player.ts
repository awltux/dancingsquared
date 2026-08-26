// Player: the browse call's playhead state machine. Owns the current call, the
// beat, play/pause/step/scrub state, and the start-hold / play / end-hold phase
// advance. It performs NO rendering — the host reads its state each frame and
// renders the views. Keeping this as a class isolates the trickiest timing logic
// from the DOM/bootstrap code.

import type { CallBundle } from 'dancing-squared-engine';

export type PlayPhase = 'start' | 'play' | 'end';

export interface PlayerOptions {
  /** Reads the current playback speed multiplier (e.g. from the speed select). */
  speed: () => number;
  msPerBeat?: number;
  /** How long to hold on the start/end formations (ms). */
  holdMs?: number;
}

export class Player {
  call: CallBundle | null = null;
  beat = 0; // absolute call beat (may be negative during lead-in)
  playing = true;
  phase: PlayPhase = 'start';

  private readonly msPerBeat: number;
  private readonly holdMs: number;
  private phaseTime = 0;
  private lastTime = performance.now();

  constructor(private readonly opts: PlayerOptions) {
    this.msPerBeat = opts.msPerBeat ?? 500;
    this.holdMs = opts.holdMs ?? 2000;
  }

  /** Start playing a new call: reset the playhead to its lead-in/start hold. */
  setCall(call: CallBundle): void {
    this.call = call;
    this.beat = -call.leadin;
    this.phase = 'start';
    this.phaseTime = 0;
  }

  setPlaying(v: boolean): void {
    this.playing = v;
    this.lastTime = performance.now();
  }

  /** Toggle play, restarting from the start when playback already ended. */
  play(): void {
    if (!this.call) return;
    if (this.phase === 'end') {
      this.beat = -this.call.leadin;
      this.phase = 'start';
      this.phaseTime = 0;
    }
    this.setPlaying(true);
  }

  pause(): void {
    this.setPlaying(false);
  }

  /** Step the beat by `step` beats (may be negative), pausing first. */
  step(step: number): void {
    if (!this.call) return;
    this.setPlaying(false);
    this.beat = Math.max(-this.call.leadin, Math.min(this.call.totalBeats, this.beat + step));
    this.phase = 'play';
  }

  /** Seek to a fraction [0,1] of the call (from the scrubber), pausing first. */
  scrub(f: number): void {
    if (!this.call) return;
    this.setPlaying(false);
    this.beat = -this.call.leadin + f * this.call.totalBeats;
    this.phase = 'play';
  }

  /** Advance playback by `dt` ms (clamped by the caller). Returns the new beat. */
  advance(dt: number): number {
    if (!this.call) return this.beat;
    const total = this.call.totalBeats;
    if (this.playing) {
      if (this.phase === 'start') {
        this.beat = -this.call.leadin;
        this.phaseTime += dt;
        if (this.phaseTime >= this.holdMs) {
          this.phase = 'play';
          this.phaseTime = 0;
        }
      } else if (this.phase === 'end') {
        this.beat = total;
        this.phaseTime += dt;
        if (this.phaseTime >= this.holdMs) {
          this.phase = 'start';
          this.phaseTime = 0;
          this.beat = -this.call.leadin;
        }
      } else {
        this.beat += (dt / this.msPerBeat) * this.opts.speed();
        if (this.beat >= total) {
          this.phase = 'end';
          this.phaseTime = 0;
        }
      }
    }
    return this.beat;
  }
}
