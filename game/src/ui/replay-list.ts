// THE REPLAY LIST: the calls a solved line was made of, as text — and nothing else.
//
// IT USED TO CARRY A SCRUB AND A PLAY/PAUSE, and they were removed on the owner's word: "The list of calls and the
// 'your line' button are actually enough in the control panel. Remove the play button and the scrub bar." That is a
// product decision, and it takes the whole transport with it — the call boundaries (`puzzle/replay-line.ts`), the
// playhead's pause/seek, and the transport's per-frame render — because a rule with no caller is a claim nobody checks
// (AGENTS.md §4.5). What is left is the part the player reads back: WHICH calls, in order, and which line they came
// from.
//
// THIS FILE OWNS NO RULE, and now it owns no state either: what the calls were is `DailyRun.review()`'s (the player's
// own line) or the drill's answer key, and the shell decides which of the two is showing. Here there is only DOM.
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML`: a call name is authored corpus data, and this file must not be
// able to make it markup.
import { el } from './dom.ts';

/** The elements the list owns, resolved once and named, so a missing id fails at the first read. */
interface El {
  box: HTMLElement;
  heading: HTMLElement;
  calls: HTMLElement;
}

export class ReplayList {
  private readonly els: El;

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
      this.els.calls.append(item);
    }
    this.els.box.hidden = false;
  }

  hide(): void {
    this.els.box.hidden = true;
  }
}
