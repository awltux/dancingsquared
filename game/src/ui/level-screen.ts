// The level screen: the 10x10 block, one cell per drill — and nothing else.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not decide a cell's state (that is `puzzle/block.ts`, gated by
// `test/block-probe.mjs`), it does not issue, fetch or advance anything (`main.ts` owns the shell), and it does not
// know what "the next level" means. It turns a `LevelView` into DOM, which is the only thing a screen should be
// responsible for — and the reason the cell rule can be probed while this file cannot.
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML` (AGENTS.md §6). Every string here is a number or a word this file
// writes itself, but the rule is the file's, not the data's.
import { blockCells, blockSummary, isReplayable, isWatchable, type CellState } from '../puzzle/block.ts';
import { columnsFor, mapFor } from './level-map.ts';
import { el } from './dom.ts';

/**
 * How tall one row of the path is, in pixels. A node is `NODE_PX` across and the row gives it a finger's width of space
 * either side, so a hundred drills come to `rows * 40` — at the panel's 340 px and eight columns that is 13 rows, 520 px,
 * a scroll rather than a squashed grid. The number lives here rather than in the stylesheet because the container's height
 * is COMPUTED from the row count, and a second copy in CSS would be the one that drifts.
 */
const NODE_ROW_PX = 40;

/** What the shell knows about the level, as the screen needs it. */
interface LevelView {
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
  /** The progress track, and the span inside it that carries the width — a `<div>` cannot be a bar with `::after` cleanly. */
  progress: HTMLElement;
  progressFill: HTMLElement;
}

/** What each state is called to a screen reader, since the cell itself shows only its number. */
const WORDING: Record<CellState, string> = {
  'done-passed': 'solved',
  'done-not-passed': 'done, not passed',
  next: 'next drill',
  published: 'not handed out yet',
  unpublished: 'not published yet',
};

/**
 * THE CELL'S MARK, one glyph per state — and the NUMBER IS GONE.
 *
 * REPORTED as "still looking very messy, UI design wise", and the 10 x 10 grid of two-digit numbers was the messiest
 * thing in the panel: MEASURED at the panel's 340 px width a cell is 31 px, its number is two digits wide, and a hundred
 * near-identical numerals read as a spreadsheet rather than as progress. A mark says the same thing in one symbol: a tick
 * is solved, a replay arrow is a drill closed without being passed (and pressable to reattempt), a play triangle is the
 * drill the server has issued. THE NUMBER IS NOT LOST — it is in each cell's `aria-label` ("Drill 12: solved"), which is
 * where a two-digit label belongs on a 31 px target.
 */
const MARK: Record<CellState, string> = {
  'done-passed': '✓',
  'done-not-passed': '↺',
  next: '▶',
  published: '',
  unpublished: '',
};

export class LevelScreen {
  private readonly els: El;

  constructor(
    /** Called when a PLAYABLE cell is pressed — the next drill, or a skipped one to reattempt — with its index. */
    private readonly onPlay: (index: number) => void,
    /** Called when the level is full and the player takes the way on. */
    private readonly onNextLevel: () => void,
  ) {
    this.els = {
      heading: el('levelHeading'),
      block: el('levelBlock'),
      nextLevel: el<HTMLButtonElement>('levelNext'),
      progress: el('levelProgress'),
      progressFill: el('levelProgressFill'),
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
   * TWO STATES ARE CONTROLS, and the second one is a correction. `next` is the drill the server has issued; a
   * `done-not-passed` cell is a drill that was closed WITHOUT being passed — skipped, or solved only after the answer
   * was shown — and it is pressable because the player has to be able to go back and earn the pass. It used to be a
   * statement, on the recorded decision that no route asked for a position by name (§15 Q25(a)); that decision was the
   * DEFECT once the block grew a `passed` column, because a skipped drill could never be passed and the column could
   * never be completed. `POST /drill/replay` is the route, and `isReplayable` (in `puzzle/block.ts`, gated by
   * `block-probe.mjs`) is the rule that decides which cells offer it — never this file.
   */
  render(view: LevelView): void {
    const cells = blockCells(view);
    const summary = blockSummary(cells);
    this.els.heading.textContent = view.note
      ?? `Level ${view.levelIndex} — ${summary.done} of ${summary.published} done, ${summary.passed} passed`;

    // THE PROGRESS BAR IS THE HEADER'S FACT, DRAWN: "3 of 100 done" is a sentence, and the same number as a filled track is
    // read at a glance. Its denominator is the PUBLISHED length (what the server has handed out), never the block's 100 —
    // a bar that filled a level the publisher has not written yet would be a promise.
    const share = summary.published > 0 ? Math.round((summary.done / summary.published) * 100) : 0;
    this.els.progress.setAttribute('aria-valuenow', String(share));
    this.els.progressFill.style.width = `${share}%`;

    // THE PATH, FROM `ui/level-map.ts`: a serpentine whose consecutive nodes are neighbours, which is the whole reason it
    // replaces the grid this screen used to build (see that module's header).
    //
    // THE COLUMN COUNT COMES FROM THE CONTAINER'S OWN WIDTH, and the node's size comes back from the column count as a CSS
    // variable — MEASURED, a rule keyed on the viewport put ten columns into a 304 px card and 28 px nodes overlapped by
    // 3 px. `columnsFor` reads `clientWidth`, which is 0 before the section is shown; it answers the floor then, and the
    // next paint (every state change repaints) has a real width.
    const map = mapFor(cells.length, columnsFor(this.els.block.clientWidth));
    this.els.block.replaceChildren();
    this.els.block.style.height = `${map.rows * NODE_ROW_PX}px`;
    this.els.block.style.setProperty('--level-columns', String(map.columns));

    // NO CONNECTOR LINE, AND THAT IS A MEASUREMENT RATHER THAN AN OMISSION. An SVG polyline through the node centres was
    // drawn and looked at twice: at the 30 px pitch this path uses, the horizontal runs pass UNDER each node's own circle,
    // so the line either hides completely (2 px stroke) or shows through the node as a bar inside it (8 px, MEASURED in the
    // browser). A connector that has to weave around the dots it joins is not worth the machinery; the serpentine itself
    // carries the adjacency, and `level-map-probe.mjs` pins it.

    for (const [i, cell] of cells.entries()) {
      const node = map.nodes[i];
      if (!node) continue;
      const wording = `Drill ${cell.index + 1}: ${WORDING[cell.state]}`;
      const place = (element: HTMLElement): void => {
        element.style.left = `${node.x}%`;
        element.style.top = `${node.y}%`;
      };
      // THREE STATES ARE CONTROLS: the issued drill, a skipped one to REATTEMPT, and a PASSED one to WATCH BACK. The
      // last is what makes a completed level openable — the same split the server makes between the write that reopens a
      // skipped position and the read that shows a passed one.
      if (cell.state === 'next' || isReplayable(cell.state) || isWatchable(cell.state)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `cell ${cell.state}`;
        button.textContent = MARK[cell.state];
        // EACH CONTROL SAYS WHICH IT IS IN ITS ACCESSIBLE NAME, because the mark alone does not say which drill it is —
        // and the whole point of both closed cells is that they have been played.
        button.setAttribute(
          'aria-label',
          isReplayable(cell.state) ? `${wording} — reattempt it` : isWatchable(cell.state) ? `${wording} — watch it back` : wording,
        );
        button.addEventListener('click', () => this.onPlay(cell.index));
        place(button);
        this.els.block.append(button);
        continue;
      }
      const span = document.createElement('span');
      span.className = `cell ${cell.state}`;
      // AN UNPUBLISHED CELL SHOWS NOTHING, because a mark would promise a drill that does not exist.
      span.textContent = MARK[cell.state];
      span.setAttribute('aria-label', wording);
      place(span);
      this.els.block.append(span);
    }

    this.els.nextLevel.hidden = !view.complete;
    this.els.nextLevel.textContent = `Start level ${view.levelIndex + 1}`;
  }
}
