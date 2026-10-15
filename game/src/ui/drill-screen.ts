// The Drill screen: the DOM, and nothing else that matters.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: it does not decide whether an answer is right (that is
// `game/drill.ts`), it does not draw (that is `render/stage-view.ts`), and it does not own the clock (that is
// `main.ts`). It turns clicks into `DrillController.answer` calls and controller state into DOM, which is the
// only thing a screen should be responsible for — and the reason the verdict rules can be probed without a
// browser while this file cannot be.
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML`. Every string here that comes from data — a call name, a
// formation label, and above all the ENGINE'S OWN refusal reason — is authored prose from a corpus this app
// does not own, and AGENTS.md §6 requires it to be impossible for any of it to become markup. The one place
// markup is built is static, with no interpolation.
import type { DrillController, DrillView } from '../game/drill.ts';
import type { SequenceMotion } from '../puzzle/types.ts';

/** The elements this screen owns, resolved once and named, so a missing id fails at the first read. */
interface El {
  canvas: HTMLCanvasElement;
  regime: HTMLElement;
  prompt: HTMLElement;
  answers: HTMLElement;
  verdict: HTMLElement;
  review: HTMLButtonElement;
  view: HTMLButtonElement;
  next: HTMLButtonElement;
  loading: HTMLElement;
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the page has no #${id}`);
  return found as T;
}

export class DrillScreen {
  private readonly els: El;
  private controller: DrillController | null = null;
  private busy = false;

  /** The motion a replay is currently drawing, or null when nothing is replaying. */
  private replay: SequenceMotion | null = null;

  constructor(
    /** Called when an option or the illegal choice is clicked. */
    private readonly onAnswer: (choice: number | 'unknown') => void,
    /** Called when the player asks for the answer. */
    private readonly onReview: () => void,
    private readonly onNext: () => void,
    private readonly onToggleView: () => void,
  ) {
    this.els = {
      canvas: el<HTMLCanvasElement>('stage'),
      regime: el('regime'),
      prompt: el('prompt'),
      answers: el('answers'),
      verdict: el('verdict'),
      review: el<HTMLButtonElement>('review'),
      view: el<HTMLButtonElement>('view'),
      next: el<HTMLButtonElement>('next'),
      loading: el('loading'),
    };
    this.els.review.addEventListener('click', () => this.onReview());
    this.els.next.addEventListener('click', () => this.onNext());
    this.els.view.addEventListener('click', () => this.onToggleView());
  }

  /** The canvas, for the stage. */
  get canvas(): HTMLCanvasElement {
    return this.els.canvas;
  }

  /** The motion a replay should draw, or null when nothing is replaying. */
  replayMotion(): SequenceMotion | null {
    return this.replay;
  }

  /** Show or hide the loading notice. */
  setLoading(on: boolean, message = ''): void {
    this.els.loading.hidden = !on;
    if (message) this.els.loading.textContent = message;
  }

  /**
   * A button was pressed. THE SCREEN DOES NOT DECIDE ANYTHING — it forwards, and `main.ts` asks the
   * controller. That is what keeps the verdict rules out of the DOM.
   */
  private choose(choice: number | 'unknown'): void {
    if (this.busy) return;
    this.onAnswer(choice);
  }

  /** Point the screen at a puzzle. */
  show(controller: DrillController, position: number): void {
    this.controller = controller;
    this.replay = null;
    this.busy = false;
    this.els.regime.textContent = `Drill ${position + 1} — level ${controller.puzzleRef.level.index}, ${controller.view().stepCount} call${controller.view().stepCount === 1 ? '' : 's'} to find`;
    this.els.verdict.textContent = '';
    this.els.next.hidden = true;
    this.els.review.hidden = false;
    this.render();
  }

  /** The current step's question, or the solved state. */
  render(): void {
    const controller = this.controller;
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

    this.els.next.hidden = !view.atEnd;
    this.els.review.hidden = view.atEnd;
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

  /** Start drawing `motion`; the loop calls `replayMotion` while it runs. */
  beginReplay(motion: SequenceMotion): void {
    this.replay = motion;
  }

  /**
   * STOP drawing the motion, so that the next `draw()` shows the controller's own board.
   *
   * The motion is dropped rather than left in place, because a stale one is what would let the drawing loop
   * keep sampling after the motion has been reported — the picture would keep moving after the verdict was
   * announced.
   *
   * IT TAKES NO BOARD, and an earlier version took one and ignored it (`void board`): what is on screen is
   * `main.ts`'s business, not this object's. A dropped parameter reads as a contract the screen does not
   * have, which is why the call sites pass nothing.
   */
  endReplay(): void {
    this.replay = null;
  }

  /** The label on the 2D/3D button, which names what pressing it will DO rather than the current mode. */
  setViewButton(next: '2d' | '3d'): void {
    this.els.view.textContent = next === '2d' ? 'Switch to 2D' : 'Switch to 3D';
  }
}
