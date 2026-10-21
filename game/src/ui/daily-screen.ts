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
import { decidePick, isArmed } from '../puzzle/arming.ts';
import { groupReadings, readingSpelling } from '../puzzle/readings.ts';
import type { MoveReading } from '../puzzle/types.ts';
import { el } from './dom.ts';

interface El {
  prompt: HTMLElement;
  waypoints: HTMLElement;
  readout: HTMLElement;
  offer: HTMLElement;
  line: HTMLElement;
  verdict: HTMLElement;
  result: HTMLElement;
  pairHint: HTMLElement;
}

export interface DailyCallbacks {
  /** Play one reading's own spelling. */
  play: (call: string) => void;
  /** Play TWO readings at once — the label `A || B`, which the engine reads back as a group step. */
  parallel: (label: string) => void;
}

export class DailyScreen {
  private readonly els: El;
  private busy = false;
  /** The last clock string written, so the frame loop does not rewrite the DOM 60 times a second. */
  private clockText: string | null = null;
  /**
   * The first half of a parallel step, while the player is choosing the second: the label of the armed reading.
   *
   * THE ARMED READING IS HELD HERE, not in the run, because it is not part of the line until the second group is chosen
   * — a half-made move must never reach the session, the save or the server. It is cleared by every `show()` that is
   * not the immediate re-render of an arming click, which is what happens on a new move: the board changed, so the
   * armed reading may no longer be legal.
   */
  private armed: MoveReading | null = null;
  /** The view the last `show()` was drawn from, so arming can redraw without a new one. */
  private lastView: DailyView | null = null;

  constructor(private readonly on: DailyCallbacks) {
    this.els = {
      prompt: el('dailyPrompt'),
      waypoints: el('dailyWaypoints'),
      readout: el('dailyReadout'),
      offer: el('offer'),
      pairHint: el('offerPairHint'),
      line: el('line'),
      verdict: el('dailyVerdict'),
      result: el('dailyResult'),
    };
  }

  /**
   * The panel while the challenge is being CREATED, which is a state it did not have before.
   *
   * REPORTED: "The Today's Daily button seems to hang the app." The request is the server's to answer, and creating a
   * Daily costs seconds (MEASURED 9.4-15.1 s at the shipped level-1 pool, DESIGN.md §7.1) — while the panel used to
   * stay EMPTY, every element below left as the previous mode had it, so the app looked frozen rather than busy. This
   * says what is happening, and clears everything a challenge owns so nothing from a previous day or level is left
   * standing as if it belonged to this one.
   */
  pending(text: string): void {
    this.els.prompt.textContent = text;
    for (const clean of [this.els.waypoints, this.els.readout, this.els.offer, this.els.pairHint, this.els.line, this.els.verdict, this.els.result]) {
      clean.replaceChildren();
    }
    this.els.result.hidden = true;
    // THE ARMED READING AND THE LAST VIEW GO WITH IT: they belong to a challenge that is no longer on screen, and the
    // next `show` must not redraw from a stale view.
    this.armed = null;
    this.lastView = null;
    this.clockText = null;
  }

  /** Draw the whole panel from the run's view. */
  show(view: DailyView): void {
    this.els.prompt.textContent = view.outcome === 'playing'
      ? `Reach the goal board${view.goalName ? ` — the goal is ${view.goalName}` : ''}.`
      : view.outcome === 'solved'
        ? 'Solved. That is the run.'
        : 'Given up — you can still replay both lines below.';

    // THE WAYPOINT SEQUENCE, as text: what the route passes through, which stages are behind the player, and which is
    // next. A "✓" is a stage whose arrangement the player has stood in — not a call they made, because many calls land
    // in the same arrangement and the route is a sequence of ARRANGEMENTS (puzzle/arrangement.ts).
    this.els.waypoints.replaceChildren();
    if (view.waypoints.length > 0) {
      const label = document.createElement('span');
      label.textContent = 'Route: ';
      this.els.waypoints.append(label);
      for (const [i, stage] of view.waypoints.entries()) {
        if (i > 0) {
          const arrow = document.createElement('span');
          arrow.className = 'waypoint-arrow';
          arrow.textContent = ' → ';
          this.els.waypoints.append(arrow);
        }
        const mark = document.createElement('span');
        mark.className = stage.reached ? 'waypoint reached' : 'waypoint';
        mark.textContent = `${stage.reached ? '✓' : '·'} ${stage.label}`;
        this.els.waypoints.append(mark);
      }
      const arrow = document.createElement('span');
      arrow.className = 'waypoint-arrow';
      // THE GOAL CLOSES THE SEQUENCE and is named by the prompt above, so it is marked rather than captioned twice.
      arrow.textContent = ' → goal';
      this.els.waypoints.append(arrow);
    }

    this.els.offer.replaceChildren();
    // A NEW VIEW CLEARS A HALF-MADE STEP unless the view is the ARMED one being redrawn: `lastView === view` only on the
    // arming click's own re-render, where the board has not moved.
    const redrawing = this.lastView === view;
    if (!redrawing) this.armed = null;
    this.lastView = view;
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
          const armedNow = isArmed(this.armed, reading);
          if (armedNow) {
            button.classList.add('armed');
            button.textContent = `${reading.call} · 1st of two`;
          } else if (reading.call === view.hintedCall) {
            button.classList.add('hinted');
            button.textContent = `${reading.call} · hint`;
          } else {
            button.textContent = reading.call;
          }
          button.disabled = this.busy || spent;
          // THE GESTURE IS THE MODE: a plain click plays, a Shift-click arms the first half of a two-group step
          // (`puzzle/arming.ts` owns the rule, and its probe pins every row of that table).
          button.addEventListener('click', (event) => this.choose(reading, event.shiftKey));
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

    // THE INSTRUCTION LINE carries the whole interaction, so it is NOT empty on the ordinary path: with nothing armed
    // it says how to arm one (the gesture is the mode, and a gesture nobody is told about does not exist), and with a
    // reading armed it says what a second click does — a button reading "1st of two" is only half the instruction. It
    // is empty only when the run is over and there is nothing left to pick.
    this.els.pairHint.textContent = view.outcome !== 'playing'
      ? ''
      : this.armed
        ? `${readingSpelling(this.armed)} armed — pick a call under a DIFFERENT group to dance both at once, or pick the same one again to cancel.`
        : 'Shift-click a call (⇧) to start a two-group step, then pick a call under another group.';

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

  /**
   * A CLICK ON A READING: play it, arm it, or complete a pair.
   *
   * THE GESTURE IS THE MODE, and the rule is `puzzle/arming.ts`'s `decidePick` rather than a branch here: a plain click
   * PLAYS the reading (the common case, one press — the run is scored on the clock, so a press costs the player time);
   * a SHIFT-click arms it as the first of two; with one armed, a click on a reading for a DIFFERENT group plays both at
   * once, a click on the armed reading cancels, and a reading of the SAME group re-arms (that is a sequence, and the two
   * orders disagree half the time).
   *
   * THIS METHOD ONCE DID NOTHING BUT ARM, and the difference is why the rule was extracted: the version before this one
   * had no `play` call at all, so a single call could not be made and the Daily was unplayable past its first move.
   * `game/test/picker-interaction-probe.mjs` pins every row of the table.
   */
  private choose(reading: MoveReading, arming: boolean): void {
    const decision = decidePick(this.armed, reading, arming);
    switch (decision.kind) {
      case 'play':
        // NOTHING LOCAL CHANGES: the run's next view arrives with the move in it, and a new view clears the arming.
        this.on.play(decision.call);
        return;
      case 'arm':
        this.armed = decision.reading;
        if (this.lastView) this.show(this.lastView);
        return;
      case 'disarm':
        this.armed = null;
        if (this.lastView) this.show(this.lastView);
        return;
      case 'parallel':
        this.armed = null;
        this.on.parallel(decision.label);
        return;
    }
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
