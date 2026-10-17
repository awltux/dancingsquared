// The Daily screen: the offering list, the player's line, the readouts and the result card.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO, the same split the Drill's screen makes: it does not decide
// whether a move is legal (`DailyRun` does, through the engine), it does not draw (`render/stage-view.ts`),
// and it does not own the clock (`main.ts` hands it the elapsed seconds when they change). It turns clicks
// into callbacks and a `DailyView` into DOM.
//
// THE JOB TALLY AND THE HINT BALANCE LIVE IN THE SHARED FOOTER, which `main.ts` owns, because the balance is
// earned in one mode and spent in the other (DESIGN.md 10) and two screens writing it would be two sources
// of truth for one number.
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML` — every call name and the goal board's formation name
// are authored corpus prose, and AGENTS.md §6 requires it to be impossible for any of it to become markup.
//
// THE OFFERING LIST IS REBUILT FROM THE VIEW, not patched, and that is a rule rather than laziness: the list
// changes with every move, the allowance changes as it is spent, and the hint marker moves. A screen that
// patched buttons would show a stale allowance next to a fresh board. The readouts are the cheap strings, and
// they are written only when they change — see `writeClock`, which the frame loop calls.
import type { DailyView } from '../game/daily-run.ts';
import { groupReadings } from '../puzzle/readings.ts';
import { el } from './dom.ts';

interface El {
  prompt: HTMLElement;
  readout: HTMLElement;
  offer: HTMLElement;
  line: HTMLElement;
  verdict: HTMLElement;
  result: HTMLElement;
}

export interface DailyCallbacks {
  play: (call: string) => void;
}

export class DailyScreen {
  private readonly els: El;
  private busy = false;
  /** The last clock string written, so the frame loop does not rewrite the DOM 60 times a second. */
  private clockText: string | null = null;

  constructor(private readonly on: DailyCallbacks) {
    this.els = {
      prompt: el('dailyPrompt'),
      readout: el('dailyReadout'),
      offer: el('offer'),
      line: el('line'),
      verdict: el('dailyVerdict'),
      result: el('dailyResult'),
    };
  }

  /** Draw the whole panel from the run's view. */
  show(view: DailyView): void {
    this.els.prompt.textContent = view.outcome === 'playing'
      ? `Reach the goal board${view.goalName ? ` — the goal is ${view.goalName}` : ''}.`
      : view.outcome === 'solved'
        ? 'Solved. That is the run.'
        : 'Given up — you can still replay both lines below.';

    this.els.offer.replaceChildren();
    if (view.outcome === 'playing') {
      // AT THE CAP THE LIST IS DISABLED, not emptied: the player can still see what was legal, and the
      // readout says the allowance is spent. An empty list would look like a broken puzzle.
      const spent = view.movesLeft === 0;
      // GROUPED BY THE READING: one section per subset that can perform something, the whole board first.
      //
      // WHY SECTIONS AND NOT A PREFIX IN THE LABEL. The engine's own vocabulary is a GROUP plus a call ("Heads"
      // + "Dosado"), and prefixed labels made every row a sentence to re-read ("Head Boys Dosado" beside
      // "Dosado"). A heading says it once, the rows stay the call's own name, and the same call appearing under
      // two headings is honest: those are two different moves, by different dancers.
      for (const section of groupReadings(view.readings)) {
        const heading = document.createElement('h3');
        heading.className = 'offer-group';
        heading.textContent = section.label;
        this.els.offer.append(heading);

        const row = document.createElement('div');
        row.className = 'offer-row';
        for (const reading of section.readings) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'offer';
          // THE HINT MARKS THE CALL IN THE LIST, which is what DESIGN.md 10 asks a hint to be: one call name,
          // marked where the player is already looking. The run drops the marker as soon as they move, so it
          // can never point at a call that is no longer offered. A hinted call is highlighted in EVERY group it
          // is legal for, because the hint names a call and not a reading.
          if (reading.call === view.hintedCall) {
            button.classList.add('hinted');
            button.textContent = `${reading.call} · hint`;
          } else {
            button.textContent = reading.call;
          }
          // WHAT IS PLAYED IS THE GROUP'S OWN SPELLING. The engine, the server's replay and the saved line all read
          // "Heads Dosado", so the button hands the picker that string and nothing has to translate it later.
          const played = reading.selection === null ? reading.call : `${reading.selection} ${reading.call}`;
          button.disabled = this.busy || spent;
          button.addEventListener('click', () => this.on.play(played));
          row.append(button);
        }
        this.els.offer.append(row);
      }
      if (view.readings.length === 0) {
        const note = document.createElement('p');
        note.textContent = 'No call is available from here — undo one to back out.';
        this.els.offer.append(note);
      }
    }

    this.els.line.textContent = view.moves.length ? `Your line: ${view.moves.join(' → ')}` : 'Your line: (nothing yet)';
    this.writeClock(view);
    this.showResult(view);
  }

  /**
   * The elapsed/allowance readout. Split out because the frame loop refreshes ONLY this, once a second.
   *
   * THE CACHE IS THE POINT: `textContent = same string` is a DOM write, and the loop runs at 60 Hz. The
   * value itself is floored to a tenth of a second by the clock, so a comparison here is exact.
   */
  writeClock(view: DailyView): void {
    const text = readoutText(view);
    if (text === this.clockText) return;
    this.clockText = text;
    this.els.readout.textContent = text;
  }

  /** A verdict line, and optionally the engine's own reason. */
  say(text: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
    this.els.verdict.textContent = text;
    this.els.verdict.dataset['kind'] = kind;
  }

  /** Disable the list while a motion plays, so a second click cannot race the first. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    for (const button of this.els.offer.querySelectorAll('button')) button.disabled = busy;
  }

  /** The result card, shown once the run is over. A given-up run has a time and no score. */
  private showResult(view: DailyView): void {
    if (view.outcome === 'playing') {
      this.els.result.hidden = true;
      this.els.result.textContent = '';
      return;
    }
    this.els.result.hidden = false;
    const time = `${view.elapsedSeconds.toFixed(1)} s`;
    const moves = `${view.movesUsed} of ${view.allowance} moves`;
    const hints = view.hintsUsed === 0 ? 'no hints' : `${view.hintsUsed} hint${view.hintsUsed === 1 ? '' : 's'}`;
    this.els.result.textContent = view.result
      // THE TERMS ARE SHOWN, not just the number: the score is a product of three ratios (`score.ts`), and
      // the minute a hint cost is visible on the clock above this line.
      ? `Score ${view.result.score} — ${time}, ${moves}, ${hints} (par ${view.result.parSeconds} s).`
      : `No score — given up after ${time}, ${moves}, ${hints}.`;
  }
}

/**
 * The readout text, so the frame loop can compare without touching the DOM.
 *
 * THE HINT CHARGE APPEARS ON THE CLOCK, where it was paid (DESIGN.md 9/10: "the penalty is folded into
 * elapsed"), so a player who takes a hint watches the time jump by a minute rather than reading a second
 * number they would have to reconcile with the first.
 */
function readoutText(view: DailyView): string {
  const minutes = Math.floor(view.elapsedSeconds / 60);
  const seconds = Math.floor(view.elapsedSeconds % 60);
  const hintPart = view.hintsUsed > 0 ? ` incl. ${view.hintsUsed} min hint${view.hintsUsed === 1 ? '' : 's'}` : '';
  return `moves allowed: ${view.movesUsed} of ${view.allowance} used  ·  time ${minutes}:${String(seconds).padStart(2, '0')}${hintPart}`;
}
