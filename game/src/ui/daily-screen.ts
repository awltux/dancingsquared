// The Daily screen: the offering list, the player's line, the readouts and the result line.
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
import { ALL_READINGS, filterReadings, groupReadings, readingSpelling, toggleSelection, type ReadingFilter } from '../puzzle/readings.ts';
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
  callFilter: HTMLElement;
  callSearch: HTMLInputElement;
  callCount: HTMLElement;
  callSubsets: HTMLElement;
}

interface DailyCallbacks {
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
  /** Whether this run's score is the server's to store (see `show`). A demo's result is shown as unscored. */
  private scored = true;
  /**
   * What the player has narrowed the picker to (a subset and a search query), and IT SURVIVES EVERY REPAINT: the list
   * is rebuilt on every move, so a filter held in the DOM would be lost the moment the player moved — which is the one
   * moment they are most likely to be part-way through looking for the next call. Reset when a new challenge arrives
   * (`resetFilters`) and when a HINT names a call the filter would hide.
   */
  private filter: ReadingFilter = ALL_READINGS;
  /** The hint the last `show()` drew, so a NEW hint can clear the filter and an existing one can leave it alone. */
  private lastHinted: string | null = null;

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
      callFilter: el('callFilter'),
      callSearch: el<HTMLInputElement>('callSearch'),
      callCount: el('callCount'),
      callSubsets: el('callSubsets'),
    };
    // THE FILTER IS WIRED ONCE, because the input is a PERSISTENT element (index.html) and is never rebuilt: a screen
    // that re-created it per paint would lose the caret mid-word. Typing repaints the LIST only — never the panel — so
    // the armed reading, the clock cache and the caret all survive a keystroke.
    this.els.callSearch.addEventListener('input', () => {
      this.filter = { ...this.filter, query: this.els.callSearch.value };
      this.repaintOffers();
    });
    // ESCAPE IS THE WAY OUT WITHOUT A MOUSE, and it is what a search box is expected to do: clear, not blur.
    this.els.callSearch.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.els.callSearch.value === '') return;
      event.preventDefault();
      this.els.callSearch.value = '';
      this.filter = { ...this.filter, query: '' };
      this.repaintOffers();
    });
  }

  /** Forget the narrowing: a different challenge is on screen, so the player's search belongs to the last one. */
  resetFilters(): void {
    this.clearFilter();
    this.repaintOffers();
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
    // next `show` must not redraw from a stale view. The narrowing goes too, for the same reason — and the filter bar is
    // hidden until a list exists to narrow.
    this.armed = null;
    this.lastView = null;
    this.lastHinted = null;
    this.clockText = null;
    this.els.callFilter.hidden = true;
    this.els.callSubsets.replaceChildren();
    this.els.callCount.textContent = '';
    this.clearFilter();
  }

  /**
   * Draw the whole panel from the run's view.
   *
   * `scored` IS WHAT THE SERVER WILL DO WITH THIS RUN, and it is a field as well as an argument because this screen
   * re-renders itself on an arming click (`show(this.lastView)`): a re-render must not silently turn an unscored demo's
   * result back into a score. The rule is the shell's (`mayWrite`), because the screen owns no standing.
   */
  show(view: DailyView, scored: boolean = this.scored): void {
    this.scored = scored;
    // THE PROMPT NAMES THE SEQUENCE, not just the goal board: the run is won by passing every waypoint IN ORDER and
    // ending on the last, so "reach the goal board" describes a rule the mode no longer has (a shortcut to the final
    // arrangement does not finish). The count comes from the view so the sentence cannot drift from the sequence.
    const goal = view.goalName ? ` — the goal is ${view.goalName}` : '';
    this.els.prompt.textContent = view.outcome === 'playing'
      ? `Pass all ${view.waypoints.length} waypoints in order, ending on the goal board${goal}.`
      : view.outcome === 'solved'
        ? 'Solved. That is the run.'
        : 'Given up — you can still replay both lines below.';

    // THE WAYPOINT SEQUENCE, as text: the formations the puzzle passes through, which of them the player has stood
    // in, and which is next. A "✓" is a WAYPOINT reached IN ORDER — not a call they made, because many calls land in
    // the same formation and a call that leaves the set where it already was does not reach a new one
    // (puzzle/arrangement.ts owns the rule, and `waypoint-pair.ts` the states the board borders draw).
    //
    // THE NUMBER IS PART OF THE LABEL because the captions over the boards say "waypoint 2 of 4" and the two have to
    // be read as the same list.
    this.els.waypoints.replaceChildren();
    if (view.waypoints.length > 0) {
      const label = document.createElement('span');
      label.textContent = 'Route: ';
      this.els.waypoints.append(label);
      for (const [i, waypoint] of view.waypoints.entries()) {
        if (i > 0) {
          const arrow = document.createElement('span');
          arrow.className = 'waypoint-arrow';
          arrow.textContent = ' → ';
          this.els.waypoints.append(arrow);
        }
        const reached = i <= view.progress;
        const mark = document.createElement('span');
        mark.className = reached ? 'waypoint reached' : 'waypoint';
        mark.textContent = `${reached ? '✓' : '·'} ${i + 1}. ${waypoint.label}`;
        this.els.waypoints.append(mark);
      }
    }

    // A NEW VIEW CLEARS A HALF-MADE STEP unless the view is the ARMED one being redrawn: `lastView === view` only on the
    // arming click's own re-render, where the board has not moved.
    const redrawing = this.lastView === view;
    if (!redrawing) this.armed = null;
    this.lastView = view;
    // A HINT NAMES A CALL, AND A FILTER MUST NOT HIDE IT. The list is a narrowing the player chose; the hint is the game
    // telling them one call, so a NEW hint clears the narrowing rather than leaving "Hint: Dosado" on screen with no
    // Dosado in the list below it. An existing hint leaves the filter alone, so a player who searches while a hint is
    // showing keeps their search.
    if (view.hintedCall !== null && view.hintedCall !== this.lastHinted) this.clearFilter();
    this.lastHinted = view.hintedCall;
    this.renderOffers(view);

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
   * The filter bar and the offering list, from the view and this screen's own narrowing.
   *
   * SPLIT FROM `show` BECAUSE THE FILTER REPAINTS ON ITS OWN: a keystroke or a subset press must not re-run the whole
   * panel — a full `show` would clear the ARMED reading on a view it has already drawn, so searching in the middle of a
   * two-group step would silently disarm it.
   *
   * THE SUBSET BUTTONS ARE RE-DERIVED EVERY PAINT, because legality changes with every move: a group with no legal call
   * on this board has no button and cannot be selected. A selection that has just disappeared is therefore DROPPED
   * rather than left standing, which would show an empty list with no button pressed and nothing to explain it.
   */
  private renderOffers(view: DailyView): void {
    this.els.callFilter.hidden = view.outcome !== 'playing';
    this.els.offer.replaceChildren();
    this.els.callSubsets.replaceChildren();
    if (view.outcome !== 'playing') {
      this.els.callCount.textContent = '';
      return;
    }
    const labels = groupReadings(view.readings).map((section) => section.label);
    if (this.filter.selection !== null && !labels.includes(this.filter.selection)) {
      this.filter = { ...this.filter, selection: null };
    }
    for (const label of labels) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'call-subset';
      button.textContent = label;
      // ARIA-PRESSED CARRIES THE STATE, not a colour: a toggle told by colour alone is unreadable for a colour-vision
      // difference, the same rule the hinted call and the waypoint borders follow.
      button.setAttribute('aria-pressed', String(this.filter.selection === label));
      // THE TOGGLE IS `readings.ts`'s RULE rather than a branch here, so "press the pressed one again" is pinned by a
      // probe instead of by whoever reads this handler.
      button.addEventListener('click', () => {
        this.filter = { ...this.filter, selection: toggleSelection(this.filter.selection, label) };
        this.repaintOffers();
      });
      this.els.callSubsets.append(button);
    }
    const visible = filterReadings(view.readings, this.filter);
    // THE COUNT ANSWERS "is this zero a coverage gap or a genuine absence": "0 of 306 calls" says the list exists and the
    // narrowing hid it, where an unqualified empty list would read like a broken puzzle (AGENTS.md §4.1).
    this.els.callCount.textContent =
      visible.length === view.readings.length ? `${visible.length} calls` : `${visible.length} of ${view.readings.length} calls`;
    if (view.readings.length === 0) {
      const note = document.createElement('p');
      note.textContent = 'No call is available from here — undo one to back out.';
      this.els.offer.append(note);
      return;
    }
    if (visible.length === 0) {
      const narrowed = `${this.filter.query.trim() ? ` “${this.filter.query.trim()}”` : ''}${this.filter.selection ? ` in ${this.filter.selection}` : ''}`;
      const note = document.createElement('p');
      note.textContent = `No call matches${narrowed} — clear the search or pick another group.`;
      this.els.offer.append(note);
      return;
    }
    // AT THE CAP THE LIST IS DISABLED, not emptied: the player can still see what was legal, and the readout says the
    // allowance is spent. An empty list would look like a broken puzzle.
    const spent = view.movesLeft === 0;
    // GROUPED BY THE READING: one section per subset that can perform something, the whole board first.
    //
    // WHY SECTIONS AND NOT A PREFIX IN THE LABEL. The engine's own vocabulary is a GROUP plus a call ("Heads" + "Dosado"),
    // and prefixed labels made every row a sentence to re-read ("Head Boys Dosado" beside "Dosado"). A heading says it
    // once, the rows stay the call's own name, and the same call appearing under two headings is honest: those are two
    // different moves, by different dancers.
    for (const section of groupReadings(visible)) {
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
        // THE HINT MARKS THE CALL IN THE LIST, which is what DESIGN.md 10 asks a hint to be: one call name, marked where
        // the player is already looking. The run drops the marker as soon as they move, so it can never point at a call
        // that is no longer offered. A hinted call is highlighted in EVERY group it is legal for, because the hint names
        // a call and not a reading.
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
  }

  /** Repaint the list from the view already on screen — what a keystroke or a subset press needs. */
  private repaintOffers(): void {
    if (this.lastView) this.renderOffers(this.lastView);
  }

  /**
   * Forget both narrowings AND the box they were typed in.
   *
   * ONE PLACE, because the two must move together: a cleared filter with yesterday's query still in the box would look
   * like the search was on and doing nothing.
   */
  private clearFilter(): void {
    this.filter = ALL_READINGS;
    this.els.callSearch.value = '';
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

  /** The Daily's result line, shown once the run is over. A given-up run has a time and no score. */
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
      // THE SCORE IS THE SERVER'S. A solved demo has no stored score, so its result says so rather than printing a number
      // the server will never hold — the device's own ledger is gone.
      ? this.scored
        // THE TERMS ARE SHOWN, not just the number: the score is a product of three ratios (`score.ts`), and
        // the minute a hint cost is visible on the clock above this line.
        ? `Score ${view.result.score} — ${time}, ${moves}, ${hints} (par ${view.result.parSeconds} s).`
        : `Solved — not scored: ${time}, ${moves}, ${hints}. Sign in to be counted.`
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
