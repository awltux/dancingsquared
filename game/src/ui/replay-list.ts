// THE REPLAY LIST: the calls a solved line was made of, as text, with the one being played marked.
//
// IT CARRIED A SCRUB AND A PLAY/PAUSE ONCE, and they were removed on the owner's word — "the list of calls and the 'your
// line' button are actually enough in the control panel. Remove the play button and the scrub bar" — leaving the list and
// one `Play` button that plays the line through the same one-shot motion every move uses. The HIGHLIGHT stayed with the
// list: "Highlight the currently active call variant in 'the calls you played' list while the sequence plays."
//
// THIS FILE OWNS NO RULE, and that is what makes the highlight testable: WHICH call is active is `puzzle/replay-line.ts`'s
// arithmetic (pinned by `replay-line-probe.mjs`), and WHEN the playhead stops is `ui/playhead.ts`'s. Here there is only
// DOM. It does own the list's own state — which call is currently marked — so a frame that changes nothing writes nothing.
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML`: a call name is authored corpus data, and this file must not be able
// to make it markup.
import { el } from './dom.ts';

/** The elements the list owns, resolved once and named, so a missing id fails at the first read. */
interface El {
  box: HTMLElement;
  heading: HTMLElement;
  calls: HTMLElement;
}

export class ReplayList {
  private readonly els: El;
  /** The call currently marked, or null. Compared before every write, so the frame loop is cheap. */
  private marked: number | null = null;

  constructor() {
    this.els = {
      box: el('replayBox'),
      heading: el('replayHeading'),
      calls: el('replayCalls'),
    };
  }

  /**
   * Show a line: its heading and its calls, in order.
   *
   * THE LIST IS REBUILT rather than patched, for the reason `drill-screen.ts` gives about its options: the length is the
   * line's and changes with every puzzle, so a screen patching labels onto a fixed set of items would show five calls
   * where the line has four. The heading says WHICH line this is — the player's own, the generator's shortest, or a
   * completed drill's answers — because the same list can be any of the three.
   */
  show(calls: readonly string[], heading: string): void {
    this.els.heading.textContent = heading;
    this.els.calls.replaceChildren();
    for (const [k, call] of calls.entries()) {
      const item = document.createElement('li');
      item.textContent = `${k + 1}. ${call}`;
      item.dataset['call'] = String(k);
      this.els.calls.append(item);
    }
    this.marked = null;
    this.els.box.hidden = false;
  }

  /**
   * Mark the call being played, or clear the marks with `null`.
   *
   * THE HIGHLIGHT IS DRIVEN FROM OUTSIDE — the shell samples the playhead's beat each frame and asks `replay-line.ts`
   * which call that is — because this file does not own time and must not start to. The active call is marked by a BORDER
   * AND A BOLD WEIGHT as well as a colour, the same rule the route line and the hinted call follow, so it survives a
   * colour-vision difference; the calls already played are dimmed and struck through.
   *
   * IT WRITES NOTHING IF THE MARKED CALL IS UNCHANGED, because the frame loop calls it while a line plays.
   */
  highlight(call: number | null): void {
    if (call === this.marked) return;
    this.marked = call;
    for (const item of this.els.calls.children) {
      const index = Number((item as HTMLElement).dataset['call']);
      item.className = call !== null && index < call ? 'played' : index === call ? 'now' : '';
    }
  }

  hide(): void {
    this.marked = null;
    this.els.box.hidden = true;
  }
}
