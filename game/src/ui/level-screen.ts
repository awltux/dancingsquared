// The level screen: the 10x10 block, one cell per drill — and nothing else.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not decide a cell's state (that is `puzzle/block.ts`, gated by
// `test/block-probe.mjs`), it does not issue, fetch or advance anything (`main.ts` owns the shell), and it does not
// know what "the next level" means. It turns a `LevelView` into DOM, which is the only thing a screen should be
// responsible for — and the reason the cell rule can be probed while this file cannot.
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML` (AGENTS.md §6). Every string here is a number or a word this file
// writes itself, but the rule is the file's, not the data's.
import { blockCells, blockSummary, type CellState } from '../puzzle/block.ts';
import { el } from './dom.ts';

/** What the shell knows about the level, as the screen needs it. */
export interface LevelView {
  readonly levelIndex: number;
  /** How many drills the level has PUBLISHED — the denominator, never the block's 100. */
  readonly length: number;
  readonly finished: readonly number[];
  readonly passed: readonly number[];
  /** The position the server handed out as next, or null when there is nothing to play. */
  readonly next: number | null;
  /** The block is full, so the level is over and the shell offers the way on. */
  readonly complete: boolean;
  /** One line the shell wants said — a demo, a refusal — or absent for the ordinary heading. */
  readonly note?: string;
}

interface El {
  heading: HTMLElement;
  block: HTMLElement;
  nextLevel: HTMLButtonElement;
}

/** What each state is called to a screen reader, since the cell itself shows only its number. */
const WORDING: Record<CellState, string> = {
  'done-passed': 'solved',
  'done-not-passed': 'done, not passed',
  next: 'next drill',
  published: 'not handed out yet',
  unpublished: 'not published yet',
};

export class LevelScreen {
  private readonly els: El;

  constructor(
    /** Called when the NEXT cell is pressed — the one cell that starts a drill. */
    private readonly onPlay: () => void,
    /** Called when the level is full and the player takes the way on. */
    private readonly onNextLevel: () => void,
  ) {
    this.els = {
      heading: el('levelHeading'),
      block: el('levelBlock'),
      nextLevel: el<HTMLButtonElement>('levelNext'),
    };
    this.els.nextLevel.addEventListener('click', () => this.onNextLevel());
  }

  /**
   * Paint the block for a level.
   *
   * REBUILT RATHER THAN PATCHED, for the reason `drill-screen.ts` gives about its options: the published length
   * changes between levels, so a screen that patched a fixed set of cells would show four where the publisher wrote
   * a hundred.
   *
   * ONLY THE NEXT CELL IS A CONTROL. The progress map (DESIGN.md §8) gives a player one drill at a time, and a
   * finished drill cannot be re-issued: there is no route that asks the server for position N, which is a decision
   * rather than an omission (the plan's Q18 kept the order the server's). So a done cell is a statement, not a
   * button — pressing it would need an endpoint that does not exist.
   */
  render(view: LevelView): void {
    const cells = blockCells(view);
    const summary = blockSummary(cells);
    this.els.heading.textContent = view.note
      ?? `Level ${view.levelIndex} — ${summary.done} of ${summary.published} done, ${summary.passed} passed`;

    this.els.block.replaceChildren();
    for (const cell of cells) {
      const wording = `Drill ${cell.index + 1}: ${WORDING[cell.state]}`;
      if (cell.state === 'next') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cell next';
        button.textContent = String(cell.index + 1);
        button.setAttribute('aria-label', wording);
        button.addEventListener('click', () => this.onPlay());
        this.els.block.append(button);
        continue;
      }
      const span = document.createElement('span');
      span.className = `cell ${cell.state}`;
      // AN UNPUBLISHED CELL SHOWS NOTHING, because its number would be a promise of a drill that does not exist.
      span.textContent = cell.state === 'unpublished' ? '' : String(cell.index + 1);
      span.setAttribute('aria-label', wording);
      this.els.block.append(span);
    }

    this.els.nextLevel.hidden = !view.complete;
    this.els.nextLevel.textContent = `Start level ${view.levelIndex + 1}`;
  }
}
