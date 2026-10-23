// The replay transport: the calls a solved line was made of, a scrub over them, and ONE button that is Play or Pause.
//
// WHY ONE BUTTON AND NOT TWO. The state is the PLAYHEAD's — running, paused, or parked at the end — and a Play/Pause
// pair would be two controls to keep in step with one fact, with a disabled combination for every state somebody has to
// draw. One button asks the playhead what it is doing and says it, which is also why its label is the test that a
// replay is not silently stuck: "Play"/"Pause"/"Play again" are the three things the player can be looking at.
//
// THIS FILE OWNS NO RULE. Which call the playhead is inside is `puzzle/replay-line.ts`; when a motion has finished is
// `ui/playhead.ts`; what the calls were is `DailyRun.review()`'s. Here there is only DOM — the list, the slider, the
// label — which is the split that lets the two rules be probed without a browser (AGENTS.md §8 trap 27).
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML`: a call name is authored corpus data, and this file must not be
// able to make it markup.
import { callAt, type ReplayLine } from '../puzzle/replay-line.ts';
import { el } from './dom.ts';

/** The elements the transport owns, resolved once and named, so a missing id fails at the first read. */
interface El {
  box: HTMLElement;
  heading: HTMLElement;
  calls: HTMLElement;
  scrub: HTMLInputElement;
  position: HTMLElement;
  toggle: HTMLButtonElement;
}

/** What the transport asks the shell to do. The shell decides, because it owns the one playhead. */
export interface ReplayHandlers {
  /** The single button: play, pause, or play again, depending on where the playhead is. */
  onToggle(): void;
  /** A scrub: the CALL the player dragged to, 0 for the start and `calls.length` for the landing board. */
  onSeek(call: number): void;
}

export class ReplayControls {
  private readonly els: El;
  private line: ReplayLine | null = null;
  /** What was last written, so a per-frame `render` touches the DOM only when something changed. */
  private drawn = { call: -1, playing: false, atEnd: false };

  constructor(handlers: ReplayHandlers) {
    this.els = {
      box: el('replayBox'),
      heading: el('replayHeading'),
      calls: el('replayCalls'),
      scrub: el<HTMLInputElement>('replayScrub'),
      position: el('replayPosition'),
      toggle: el<HTMLButtonElement>('replayToggle'),
    };
    this.els.toggle.addEventListener('click', () => handlers.onToggle());
    this.els.scrub.addEventListener('input', () => handlers.onSeek(Number(this.els.scrub.value)));
  }

  /**
   * Show a line: its calls as a list, the scrub's stops, and the heading that says WHICH line this is.
   *
   * THE LIST IS REBUILT rather than patched, for the reason `drill-screen.ts` gives about its options: the length is
   * the line's and changes with every puzzle, so a screen patching labels onto a fixed set of items would show five
   * calls where the line has four.
   */
  show(line: ReplayLine, heading: string): void {
    this.line = line;
    this.drawn = { call: -1, playing: false, atEnd: false };
    this.els.heading.textContent = heading;
    this.els.calls.replaceChildren();
    for (const [k, call] of line.calls.entries()) {
      const item = document.createElement('li');
      item.textContent = `${k + 1}. ${call}`;
      item.dataset['call'] = String(k);
      this.els.calls.append(item);
    }
    this.els.scrub.min = '0';
    this.els.scrub.max = String(line.calls.length);
    this.els.scrub.value = '0';
    this.els.scrub.step = '1';
    this.els.scrub.disabled = line.calls.length === 0;
    this.els.box.hidden = false;
  }

  hide(): void {
    this.line = null;
    this.els.box.hidden = true;
  }

  /**
   * Keep the transport in step with the playhead. Called from the frame loop, so it writes nothing unless the call,
   * the running state or the end state changed — the same discipline `daily-screen.ts`'s clock readout follows.
   */
  render(beat: number, playing: boolean, atEnd: boolean): void {
    const line = this.line;
    if (!line) return;
    const call = callAt(line, beat);
    if (call === this.drawn.call && playing === this.drawn.playing && atEnd === this.drawn.atEnd) return;
    this.drawn = { call, playing, atEnd };

    for (const item of this.els.calls.children) {
      const index = Number((item as HTMLElement).dataset['call']);
      item.className = index < call ? 'played' : index === call && call < line.calls.length ? 'now' : '';
    }
    this.els.scrub.value = String(call);
    this.els.position.textContent = `${call} of ${line.calls.length} call${line.calls.length === 1 ? '' : 's'} played`;
    // THE ONE BUTTON'S THREE LABELS, and the third is not decoration: a replay parked at the end that said "Play" would
    // look stuck, because pressing it would do nothing (a finished motion does not resume — `Replay.resume`).
    this.els.toggle.textContent = playing ? 'Pause' : atEnd ? 'Play again' : 'Play';
    this.els.toggle.dataset['playing'] = playing ? 'true' : 'false';
  }

}

