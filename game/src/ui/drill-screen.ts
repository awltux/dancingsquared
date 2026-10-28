// The Drill screen: the question, the option buttons and the verdict — and nothing else.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: it does not decide whether an answer is right (that is
// `game/drill.ts`), it does not draw (that is `render/stage-view.ts`), it does not own the clock or the
// replay (that is `main.ts`), and it does not own the footer — the mode switch, the hint balance and the
// three shared action buttons belong to the shell, because the Daily uses them too. It turns clicks into
// `DrillController.answer` calls and controller state into DOM, which is the only thing a screen should be
// responsible for — and the reason the verdict rules can be probed without a browser while this file cannot.
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML`. Every string here that comes from data — a call name, a
// formation label, and above all the ENGINE'S OWN refusal reason — is authored prose from a corpus this app
// does not own, and AGENTS.md §6 requires it to be impossible for any of it to become markup. The one place
// markup is built is static, with no interpolation.
import type { DrillController, DrillView } from '../game/drill.ts';
import { el } from './dom.ts';

/** The elements this screen owns, resolved once and named, so a missing id fails at the first read. */
interface El {
  prompt: HTMLElement;
  answers: HTMLElement;
  verdict: HTMLElement;
}

export class DrillScreen {
  private readonly els: El;
  private busy = false;

  constructor(
    /** Called when an option or the illegal choice is clicked. */
    private readonly onAnswer: (choice: number | 'unknown') => void,
  ) {
    this.els = {
      prompt: el('prompt'),
      answers: el('answers'),
      verdict: el('verdict'),
    };
  }

  /**
   * A button was pressed. THE SCREEN DOES NOT DECIDE ANYTHING — it forwards, and `main.ts` asks the
   * controller. That is what keeps the verdict rules out of the DOM.
   */
  private choose(choice: number | 'unknown'): void {
    if (this.busy) return;
    this.onAnswer(choice);
  }

  /** The current step's question, or the solved state. */
  render(controller: DrillController | null): void {
    // NO DRILL IS ON SCREEN, SO NOTHING MAY LOOK PRESSABLE (DESIGN.md §15 Q24). This used to return here and leave the
    // last question and its options standing, which made a failed issue — the season complete, an outage — look like
    // a live question. They were inert, because every handler in `main.ts` guards on `controller`, but a control that
    // looks live and silently does nothing is exactly what this file's own out-of-range comment calls worse than a
    // message. THE BOARD STAYS (the picture is where the player was, and clearing it is the caller's business); the
    // QUESTION goes, and the prompt says there is nothing to play while the verdict line — which the caller has
    // already set — says why.
    if (!controller) {
      this.els.prompt.textContent = 'No drill to play.';
      this.els.answers.replaceChildren();
      return;
    }
    const view: DrillView = controller.view();

    this.els.prompt.textContent = view.atEnd
      ? 'Solved. That is the way to the goal board.'
      : view.finalStep
        ? 'Which call takes the set to the goal board?'
        : `Step ${view.stepIndex + 1} of ${view.stepCount}: which call makes progress towards the goal board?`;

    // REBUILT RATHER THAN PATCHED, because the option count comes from the LEVEL and changes between
    // puzzles: a screen that patched labels onto a fixed set of buttons would show three where the level
    // offers two. The count is read from the level, never assumed (P1 measured that levels 1..15 ship two).
    //
    // THE ILLEGAL CHOICE SITS AMONG THE OTHERS, at the puzzle's own position, and LOOKS LIKE THEM. It used to be
    // appended last with its own class and a dashed red border, which was a giveaway twice over: the position was
    // always the same and the marking said which button to avoid, so the one thing the option exists to teach ("that
    // cannot be called from here") was learned by looking rather than by pressing. Nothing here marks it — the engine's
    // refusal is the feedback, and it arrives when the button is pressed (`main.ts`'s `answer`). The two kinds of button
    // still differ in ONE respect that is invisible before the press: the legal ones carry `data-option` as an index
    // into `options`, and the illegal one carries `'unknown'` — which is the handler's business, not styling.
    this.els.answers.replaceChildren();
    if (!view.atEnd) {
      const total = view.options.length + (view.unknown ? 1 : 0);
      // A POSITION THE PAYLOAD DOES NOT CARRY IS THE LAST BUTTON, which is where every earlier build drew it; a position
      // outside the buttons it must index is clamped for the same reason `block.ts` clamps its sets rather than
      // throwing: a malformed extra must not take the question off the screen.
      const unknownAt = view.unknown ? Math.min(Math.max(view.unknownIndex ?? total - 1, 0), total - 1) : -1;
      let optionIndex = 0;
      for (let at = 0; at < total; at++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'answer';
        button.disabled = this.busy;
        if (at === unknownAt) {
          button.textContent = view.unknown?.call ?? '';
          button.dataset['option'] = 'unknown';
          button.addEventListener('click', () => this.choose('unknown'));
        } else {
          const i = optionIndex++;
          button.textContent = view.options[i].call;
          button.dataset['option'] = String(i);
          button.addEventListener('click', () => this.choose(i));
        }
        this.els.answers.append(button);
      }
    }
  }

  /**
   * The WATCHING state: a closed position is being replayed, so there is no question to answer.
   *
   * IT IS A STATE AND NOT "no drill" (`render(null)`), because the two look alike on purpose and mean opposite things:
   * one is a panel that failed to get a drill, the other is a drill that is over and being watched back. The options are
   * REMOVED rather than disabled — a disabled button under a replay still reads as the question — and the shell keeps the
   * answering handlers inert while this is up.
   */
  renderWatching(prompt: string): void {
    this.els.prompt.textContent = prompt;
    this.els.answers.replaceChildren();
  }

  /** Disable the buttons while a motion plays, so a second click cannot race the first. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    for (const button of this.els.answers.querySelectorAll('button')) button.disabled = busy;
  }

  /** A verdict line, and optionally the engine's own reason. */
  say(text: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
    this.els.verdict.textContent = text;
    this.els.verdict.dataset['kind'] = kind;
  }

  /**
   * THE SCORED MOMENT — one line of text, the score out of its ceiling, and nothing else.
   *
   * REPORTED: "When the player successfully completes a drill, the results pane is lost in the background. There is too
   * much unnecessary info in that pane. We only need the score out of text e.g. 10/100, and bring it to the main page."
   * The pane it replaces was a card — stars, a headline, the attempt/time breakdown and the badges — and the score was one
   * of five things in it. The text itself is `puzzle/score-line.ts`'s (gated by `score-line-probe.mjs`); this method only
   * paints it, and it takes the finished string so the denominator cannot be re-derived here as a second definition.
   *
   * IT IS A `.result-score` ELEMENT RATHER THAN PLAIN VERDICT TEXT because the server's footnote (`amend`) has to arrive
   * BESIDE it: the card used to be the thing that appended the note, and with the text loose in the verdict slot the note
   * would have overwritten the score — the defect `amend` was written for the first time.
   */
  showScore(line: string): void {
    const scored = document.createElement('p');
    scored.className = 'result-score';
    scored.textContent = line;
    this.els.verdict.replaceChildren(scored);
    this.els.verdict.dataset['kind'] = 'ok';
  }

  /** Drop the verdict line, for a screen that is about to ask a different question. */
  clearVerdict(): void {
    this.els.verdict.textContent = '';
    delete this.els.verdict.dataset['kind'];
  }

  /**
   * ADD a line to whatever the verdict slot holds, instead of replacing it.
   *
   * THE SERVER'S ANSWER ARRIVES AFTER THE LOCAL SCORE, and it used to overwrite the scored pane with a sentence — MEASURED in
   * the browser: a solved drill showed "Recorded — the server scores it 100 points…" where the stars had been a moment
   * earlier, because `submitSolvedRun` called `say`. The score line is the moment; the server's confirmation is a footnote
   * to it, so it is appended (and a refusal on the same path is appended too, in the refusal's own colour, because the local
   * score still stands). When there is no score line — a demo, a revealed run — this degrades to `say`, which is the same
   * behaviour that path had before.
   */
  amend(text: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
    if (!this.els.verdict.querySelector('.result-score')) {
      this.say(text, kind);
      return;
    }
    let note = this.els.verdict.querySelector('.result-note');
    if (!note) {
      note = document.createElement('p');
      note.className = 'result-note';
      // A SIBLING OF THE SCORE LINE, not a child of it: the line is one text node the player reads as a score, and a
      // confirmation inside it would become part of that reading.
      this.els.verdict.append(note);
    }
    note.textContent = text;
    (note as HTMLElement).dataset['kind'] = kind;
  }
}
