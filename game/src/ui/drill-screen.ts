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
    if (!controller) return;
    const view: DrillView = controller.view();

    this.els.prompt.textContent = view.atEnd
      ? 'Solved. That is the way to the goal board.'
      : view.stepCount === 1
        ? 'Which call takes the set to the goal board?'
        : `Step ${view.stepIndex + 1} of ${view.stepCount}: which call makes progress towards the goal board?`;

    // REBUILT RATHER THAN PATCHED, because the option count comes from the LEVEL and changes between
    // puzzles: a screen that patched labels onto a fixed set of buttons would show three where the level
    // offers two. The count is read from the level, never assumed (P1 measured that levels 1..15 ship two).
    this.els.answers.replaceChildren();
    if (!view.atEnd) {
      for (let i = 0; i < view.options.length; i++) {
        const option = view.options[i];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'answer';
        button.textContent = option.call;
        button.dataset['option'] = String(i);
        button.disabled = this.busy;
        button.addEventListener('click', () => this.choose(i));
        this.els.answers.append(button);
      }
      if (view.unknown) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'answer illegal';
        button.textContent = view.unknown.call;
        button.dataset['option'] = 'unknown';
        button.disabled = this.busy;
        button.addEventListener('click', () => this.choose('unknown'));
        this.els.answers.append(button);
      }
    }
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

  /** Drop the verdict line, for a screen that is about to ask a different question. */
  clearVerdict(): void {
    this.els.verdict.textContent = '';
    delete this.els.verdict.dataset['kind'];
  }
}
