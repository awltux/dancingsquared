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
import { BADGE_TEXT, type ResultCard } from '../puzzle/result-card.ts';
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
   * THE SCORED MOMENT — stars, the score, the working and the badges — in place of the verdict sentence.
   *
   * REPORTED as "still looking very messy, UI design wise" and, before that, "time to make the UI more gamified": a solved
   * drill produced one line of prose in the same slot and the same voice as a refusal, which is the one moment of reward
   * the game has. `puzzle/result-card.ts` decides WHAT the card says (and is gated by `result-card-probe.mjs`); this method
   * is only how it looks, which is why it takes the card rather than computing any of it.
   *
   * THE STARS ARE ONE ACCESSIBLE STRING, not three glyphs a screen reader would read as "black star black star white
   * star": the row carries `aria-label="3 of 3 stars"` and the glyphs are `aria-hidden`. The `N of 3` is also written
   * beside them, so the count survives a font that cannot draw ★.
   */
  card(card: ResultCard, share: string | null = null): void {
    const box = document.createElement('div');
    box.className = 'result-card';
    box.dataset['stars'] = String(card.stars);

    const stars = document.createElement('p');
    stars.className = 'result-stars';
    stars.setAttribute('aria-label', `${card.stars} of 3 stars`);
    for (let i = 1; i <= 3; i++) {
      const glyph = document.createElement('span');
      glyph.setAttribute('aria-hidden', 'true');
      glyph.className = i <= card.stars ? 'star filled' : 'star';
      glyph.textContent = i <= card.stars ? '★' : '☆';
      stars.append(glyph);
    }
    const count = document.createElement('span');
    count.className = 'result-stars-count';
    count.textContent = `${card.stars} of 3`;
    stars.append(count);

    const headline = document.createElement('p');
    headline.className = 'result-headline';
    const scoreTerm = card.terms.find((term) => term.label === 'Score');
    headline.textContent = `${card.headline} — ${scoreTerm?.value ?? '0'} points`;

    const terms = document.createElement('dl');
    terms.className = 'result-terms';
    for (const term of card.terms) {
      if (term.label === 'Score') continue; // the headline carries it, in the bigger voice
      const dt = document.createElement('dt');
      dt.textContent = term.label;
      const dd = document.createElement('dd');
      dd.textContent = term.value;
      terms.append(dt, dd);
    }

    box.append(stars, headline, terms);
    if (card.badges.length) {
      const badges = document.createElement('ul');
      badges.className = 'result-badges';
      for (const badge of card.badges) {
        const item = document.createElement('li');
        item.textContent = BADGE_TEXT[badge];
        badges.append(item);
      }
      box.append(badges);
    }
    // THE SHARE LINE, when the shell has one: a plain sentence the player can select and paste, which is the whole mechanic
    // (Wordle's grid, without the tracker). NO CLIPBOARD CALL HERE: `navigator.clipboard` is refused on a `file://` build and
    // needs a user gesture to be sure of, and a button that sometimes silently fails is worse than text that always works.
    if (share !== null) {
      const line = document.createElement('p');
      line.className = 'result-share';
      line.textContent = share;
      box.append(line);
    }

    this.els.verdict.replaceChildren(box);
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
   * THE SERVER'S ANSWER ARRIVES AFTER THE LOCAL SCORE, and it used to overwrite the card with a sentence — MEASURED in the
   * browser: a solved drill showed "Recorded — the server scores it 100 points…" where the stars had been a moment
   * earlier, because `submitSolvedRun` called `say`. A card is the moment; the server's confirmation is a footnote to it,
   * so it is appended (and a refusal on the same path is appended too, in the refusal's own colour, because the local
   * score still stands). When there is no card — a demo, a revealed run — this degrades to `say`, which is the same
   * behaviour that path had before.
   */
  amend(text: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
    const card = this.els.verdict.querySelector('.result-card');
    if (!card) {
      this.say(text, kind);
      return;
    }
    let note = card.querySelector('.result-note');
    if (!note) {
      note = document.createElement('p');
      note.className = 'result-note';
      card.append(note);
    }
    note.textContent = text;
    (note as HTMLElement).dataset['kind'] = kind;
  }
}
