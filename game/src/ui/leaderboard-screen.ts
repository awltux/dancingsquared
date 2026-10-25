// The board panel: one level's standings for one mode and period (DESIGN.md §6, §11).
//
// WHAT THIS FILE DOES NOT DO, the split both other screens make: it owns no network and no rule. `net/api.ts` fetches
// and the SERVER ranks; this turns a `BoardView` into DOM and a click into a callback. The panel is loaded ON
// DEMAND rather than with the page, because a board is a request and a player who came to play should not pay for
// one they did not ask for.
//
// IT SAYS WHAT IT IS SHOWING, AND WHEN IT IS ONLY PART OF IT. Three things a standings panel can get wrong are all
// visible here rather than implied: WHICH board (the mode, the level and the period are written down, because
// "the leaderboard" is three facts and a player comparing across levels is comparing nothing — §6 "the level id is
// the only leaderboard partition"), WHICH PLAYER IS YOU (the caller passes the id it believes it is, so the row is
// marked rather than guessed from an address), and WHETHER THE LIST IS COMPLETE (`truncated` is shown as a sentence,
// because a cut-off list presented as the standings is worse than no list).
//
// TEXT GOES IN VIA `textContent`, NEVER `innerHTML` — a player id is server data and, in the dev mode, whatever an
// operator typed (AGENTS.md §6).
import type { BoardView } from '../net/api.ts';
import { el } from './dom.ts';

interface BoardCallbacks {
  /** Load (or reload) the board, in whatever mode the app is in. */
  load: () => void;
}

interface El {
  panel: HTMLElement;
  heading: HTMLElement;
  load: HTMLButtonElement;
  status: HTMLElement;
  list: HTMLElement;
}

export class LeaderboardScreen {
  private readonly els: El;
  private busy = false;

  constructor(private readonly on: BoardCallbacks) {
    this.els = {
      panel: el('board'),
      heading: el('boardHeading'),
      load: el<HTMLButtonElement>('boardToggle'),
      status: el('boardStatus'),
      list: el('boardList'),
    };
    this.els.load.addEventListener('click', () => this.on.load());
  }

  /**
   * Draw a board.
   *
   * `you` IS THE PLAYER THIS APP BELIEVES IT IS, or null when it is nobody: the board is public (A20 serves reads to
   * a signed-out caller) and so is the panel, so "which of these is me" is answered by the id the app holds rather
   * than by hiding the board from a stranger.
   */
  show(board: BoardView, you: string | null): void {
    this.els.heading.textContent = boardHeading(board);
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
      // THE ROW IS THE PLAYER ID, because that is what the server keys a board on and this app has no display name
      // for anyone. Marking `you` is what makes the list about the player reading it.
      name.textContent = entry.playerId === you ? `${entry.playerId} (you)` : entry.playerId;
      if (entry.playerId === you) item.className = 'you';
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

  /** Show the panel (a third button, not a third mode: a board is not something a player plays). */
  open(): void {
    this.els.panel.hidden = false;
  }

  /** Collapse the panel and forget the list, so a board from another mode is never left on screen. */
  close(): void {
    this.els.panel.hidden = true;
    this.els.list.replaceChildren();
    this.els.status.textContent = '';
    this.els.heading.textContent = '';
  }

  /** Disable the button while a request is in flight, so a double press cannot race the first. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.els.load.disabled = busy;
  }
}

/** Which board this is, in one line: the three facts §6 partitions it by. */
function boardHeading(board: BoardView): string {
  return board.mode === 'daily'
    ? `Today's Daily — level ${board.levelIndex}, ${board.period} (UTC)`
    : `The Drill — level ${board.levelIndex}, season ${board.period}`;
}
