// The board panel: one level's standings for one mode and period (DESIGN.md §6, §11).
//
// WHAT THIS FILE DOES NOT DO, the split both other screens make: it owns no network and no rule. `net/api.ts` fetches
// and the SERVER ranks; this turns a `BoardView` into DOM and a click into a callback. The panel is loaded ON
// DEMAND rather than with the page, because a board is a request and a player who came to play should not pay for
// one they did not ask for.
//
// IT OWNS NO VISIBILITY EITHER, and that is the change pages forced: the board used to be a panel shown and hidden by a
// footer button, and it is now a PAGE whose visibility is the router's (`main.ts`'s `paintPages`). A screen that hid
// its own section could not be shown by a navigation, which is the failure `paintView` already carries a note about.
//
// IT SAYS WHAT IT IS SHOWING, AND WHEN IT IS ONLY PART OF IT. Three things a standings panel can get wrong are all
// visible here rather than implied: WHICH board (the mode, the level and the period are written down, because
// "the leaderboard" is three facts and a player comparing across levels is comparing nothing — §6 "the level id is
// the only leaderboard partition"), WHICH PLAYER IS YOU (the caller passes the id it believes it is, so the row is
// marked rather than guessed from an address), and WHETHER THE LIST IS COMPLETE (`truncated` is shown as a sentence,
// because a cut-off list presented as the standings is worse than no list).
//
// THE ELEMENTS ARE PASSED IN, because the SAME READ is drawn by more than one screen now: the board page's in-panel list
// on a sheet, and the two full-screen standings in the side area (`main.ts`). A class that resolved `#boardList` itself
// could only ever paint one of them, which is the second implementation AGENTS.md §4.3 refuses.
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML` — a NAME is server data and, in the dev mode, whatever an operator
// typed (AGENTS.md §6). That matters more since the rows are names: an alias is player-authored input.
import type { BoardView } from '../net/api.ts';

/** One standings panel's elements. `load` is absent for a panel nothing can be pressed on. */
export interface BoardElements {
  readonly caption: HTMLElement;
  readonly status: HTMLElement;
  readonly list: HTMLElement;
  readonly load?: HTMLButtonElement;
}

interface BoardCallbacks {
  /** Load (or reload) the board, in whatever mode the board page is set to. */
  load: () => void;
}

export class LeaderboardScreen {
  private busy = false;

  constructor(
    private readonly els: BoardElements,
    private readonly on?: BoardCallbacks,
  ) {
    this.els.load?.addEventListener('click', () => this.on?.load());
  }

  /**
   * Draw a board.
   *
   * `you` IS THE PLAYER THIS APP BELIEVES IT IS, or null when it is nobody: the board is public (A20 serves reads to
   * a signed-out caller) and so is the panel, so "which of these is me" is answered by the id the app holds rather
   * than by hiding the board from a stranger.
   */
  show(board: BoardView, you: string | null): void {
    this.els.caption.textContent = boardHeading(board);
    this.els.list.replaceChildren();
    if (board.entries.length === 0) {
      const note = document.createElement('li');
      note.className = 'muted';
      note.textContent = 'Nobody has a score on this board yet.';
      this.els.list.append(note);
    }
    for (let index = 0; index < board.entries.length; index++) {
      const entry = board.entries[index];
      const item = document.createElement('li');
      const name = document.createElement('span');
      // THE ROW IS THE PLAYER'S NAME, WHICH IS THEIR ALIAS — never the id and never an address. REPORTED: "the user needs a
      // login alias that can be displayed in the leaderboard. Dont expose the email address anywhere on the UI." A player
      // who has not claimed one shows as "Unnamed player": the row must not fall back to `playerId` (an `emu:1` or a
      // Cognito sub on a public board), and hiding the row would be worse than a row with no name. Marking `you` is by the
      // id, because a name is not an identity.
      const mine = entry.playerId === you;
      name.textContent = mine ? `${entry.alias ?? 'Unnamed player'} (you)` : entry.alias ?? 'Unnamed player';
      if (mine) item.className = 'you';
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = `${entry.score} — ${entry.runs} run${entry.runs === 1 ? '' : 's'}`;
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = `${index + 1}.`;
      item.append(rank, name, score);
      this.els.list.append(item);
    }
    // THE PAGE IS SAID OUT LOUD WHEN THERE IS MORE BEHIND IT. The server ranks through an index whose sort key is the
    // SCORE, so the list IS the top of the board — but it is one PAGE of it, and `truncated` says the page filled.
    // Presenting a page as the whole standings is the failure this sentence exists to prevent, and it no longer says
    // "of the rows the server could read": that was true while the endpoint read a partition under a cap and reported
    // how much it had examined, and it is not what the answer means now (`examined` is the page's own size).
    this.els.status.textContent = board.truncated
      ? `The top ${board.entries.length} are listed — this board has more players than one page shows.`
      : board.entries.length === 0
        ? ''
        : `${board.entries.length} player${board.entries.length === 1 ? '' : 's'} on this board.`;
    this.setBusy(this.busy);
  }

  /** A line for the player: a refusal, or that there is no server to ask. */
  say(text: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
    this.els.status.textContent = text;
    this.els.status.dataset['kind'] = kind;
  }

  /** Clear the page for a reload: the old caption over a board that is being re-read is a stale fact on screen. */
  clear(): void {
    this.els.list.replaceChildren();
    this.els.caption.textContent = '';
    this.els.status.textContent = '';
  }

  /** Disable the button while a request is in flight, so a double press cannot race the first. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    if (this.els.load) this.els.load.disabled = busy;
  }
}

/**
 * What the board page says above the list: `<count>: <title>`.
 *
 * REPORTED: "The heading for the board should be simplified to "<count>: <Title>"." It read "Today's Daily — level 1,
 * 2026-10-27 (UTC)" / "The Drill — level 1, season 2026-10", which is a sentence in the slot where a number and a name
 * belong. The TITLE keeps the two facts that identify the board — the mode and its level — and the PERIOD is dropped
 * because the page is only ever showing one board at a time and the date was the widest part of the sentence.
 */
function boardHeading(board: BoardView): string {
  const title = board.mode === 'daily' ? `Daily level ${board.levelIndex}` : `Drill level ${board.levelIndex}`;
  return `${board.entries.length}: ${title}`;
}
