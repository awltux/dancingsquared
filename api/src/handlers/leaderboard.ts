// `GET /leaderboard?mode&level&period` — one board (DESIGN.md §6, §11).
//
// WHAT A BOARD IS. One partition per (mode, level, period): `board#<mode>#<level>#<period>`, one row per player
// (`api/src/keys.ts`), which is why the store's `query` takes a partition and cannot scan. The PERIOD means
// different things per mode and the caller says which (§6): the Daily's board is one UTC DAY, the Drill's is a
// SEASON — the UTC calendar month, §15 Q4's recommendation — so a season boundary starts a new board by
// construction rather than by a job that deletes rows.
//
// IT READS THE BOARD INDEX, SO THE TOP N IS ONE BOUNDED READ. The base table's sort key for a board is the PLAYER,
// so ranking by score there means reading the whole partition and sorting it here — which is what this endpoint did
// first, under a 1000-row cap it had to admit in the answer (`BOARD_READ_CAP`, now GONE with that read). The index
// carries the score INVERTED in its sort key, so ascending IS best-first and the tie-break by player id is part of
// the same key; `limit` therefore returns the top of the board and this handler sorts nothing. `examined` and
// `truncated` remain, with the meanings the new read gives them: the size of the page, and whether the page filled
// (which may mean there is more behind it).
import type { ApiRequest, ApiResult, Deps } from '../ports.ts';
import { failure, STATUS } from '../status.ts';
import { BOARD_INDEX, boardPk } from '../keys.ts';
import { asBoardRow } from '../runs.ts';

/** How many entries the answer carries, and the `Limit` of the one read that produces them. */
export const LEADERBOARD_PAGE = 50;

/** One rank on a board: who, their score, and how many runs earned it. */
interface Entry {
  readonly playerId: string;
  readonly score: number;
  readonly runs: number;
}

/**
 * The board for one mode, one level and one period, highest score first.
 *
 * THE ORDER COMES FROM THE INDEX, NOT FROM A SORT HERE. The base table's sort key for a board is the PLAYER, so
 * ranking by score would mean reading the whole partition and sorting it in this process — which is what this
 * endpoint did, under a 1000-row cap it had to report as `truncated`. `keys.ts`'s board index carries the score
 * INVERTED in its sort key, so ascending order IS best-first, the tie-break by player id is part of the key, and
 * `limit` returns the top of the board: ONE bounded read, and no sort. There is nothing to sort because the store
 * guarantees the order, which is also why a `Query` limit is exact here (no `FilterExpression`).
 */
export async function getLeaderboard(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const mode = request.query['mode'];
  if (mode !== 'drill' && mode !== 'daily') {
    return failure(STATUS.badRequest, 'bad_mode', "mode must be 'drill' or 'daily'");
  }
  const rawLevel = request.query['level'];
  const levelIndex = Number(rawLevel);
  if (rawLevel === undefined || !Number.isInteger(levelIndex) || levelIndex < 1) {
    return failure(STATUS.badRequest, 'bad_level', 'level must be a positive integer');
  }
  // THE PERIOD IS NOT SHAPE-CHECKED, and that is the same division the move endpoint makes: what a period MEANS
  // belongs to the mode (`2026-10-15` for a Daily, `2026-10` for a season), and a period nobody played is an EMPTY
  // board rather than an error — a second date validator here would be a second answer to "is this a day".
  const period = request.query['period'];
  if (period === undefined || period === '') {
    return failure(STATUS.badRequest, 'bad_period', 'period must name the board, which is a day for a Daily and a season for the Drill');
  }

  const rows = await deps.store.query({ pk: boardPk(mode, levelIndex, period), index: BOARD_INDEX, limit: LEADERBOARD_PAGE });
  const entries: Entry[] = [];
  for (const row of rows) {
    const board = asBoardRow(row);
    if (!board) {
      // AN UNREADABLE ROW IS AN OPERATOR FINDING, not a zero and not a skip: a board that quietly dropped a player
      // would be a leaderboard nobody could audit, which is the same rule the other readers keep.
      return failure(STATUS.unavailable, 'unreadable_board', `a board row for ${period} at level ${levelIndex} is not a record this build can read`);
    }
    entries.push({ playerId: board.playerId, score: board.score, runs: board.runs });
  }

  return {
    status: STATUS.ok,
    body: {
      board: {
        mode,
        levelIndex,
        period,
        entries,
        // THE SIZE OF THE READ, which with a bounded page is the page's own size.
        examined: entries.length,
        // A FULL PAGE MAY HAVE MORE BEHIND IT, and one more read per request to decide a sentence is not worth it —
        // so the answer says the list is a page rather than claiming to be the whole board. Before the index this
        // flag meant "the 1000-row cap was reached"; it is re-stated rather than re-used, and `BOARD_READ_CAP` is
        // GONE with that read rather than left as a constant nothing consults.
        truncated: rows.length >= LEADERBOARD_PAGE,
      },
    },
  };
}
