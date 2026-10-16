// `GET /leaderboard?mode&level&period` — one board (DESIGN.md §6, §11).
//
// WHAT A BOARD IS. One partition per (mode, level, period): `board#<mode>#<level>#<period>`, one row per player
// (`api/src/keys.ts`), which is why the store's `query` takes a partition and cannot scan. The PERIOD means
// different things per mode and the caller says which (§6): the Daily's board is one UTC DAY, the Drill's is a
// SEASON — the UTC calendar month, §15 Q4's recommendation — so a season boundary starts a new board by
// construction rather than by a job that deletes rows.
//
// IT READS THE PARTITION AND SORTS, WHICH IS THE HONEST SHAPE OF THIS ENDPOINT TODAY AND NOT A FINISHED ONE.
// The board's sort key is the PLAYER, so the store cannot return score order and a `limit` on the query would
// return "the first N players" rather than "the top N scores" — a leaderboard that was silently the wrong fifty.
// So the whole partition is read under `BOARD_READ_CAP`, sorted here, and the answer REPORTS WHAT IT EXAMINED
// (`examined`, `truncated`): a board larger than the cap is a board this endpoint cannot rank, and saying so is
// the difference between a truncated answer and a wrong one (AGENTS.md §4.1: an instrument's silence is a bug).
// The step that removes the cap is the GSI DESIGN §11 describes and the table does not have yet — it is NOT built,
// so the cost here is stated in the answer rather than assumed away.
import type { ApiRequest, ApiResult, Deps } from '../ports.ts';
import { failure, STATUS } from '../status.ts';
import { boardPk } from '../keys.ts';
import { asBoardRow } from '../runs.ts';

/**
 * How many rows one board read may examine.
 *
 * IT IS A BOUND ON A READ, NOT A PAGE SIZE, and the two are different things: the entries a caller receives are
 * `LEADERBOARD_PAGE` of them, chosen by SCORE from everything this read saw. A cap of 1000 is far above any board
 * this game has (a board is one level, one period and the players who played it) and low enough that one request
 * cannot walk a runaway partition; a board that hits it is reported as truncated rather than ranked.
 */
export const BOARD_READ_CAP = 1000;

/** How many entries the answer carries. The board's own page, chosen after the sort rather than by the read. */
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
 * TIES ARE BROKEN BY PLAYER ID, so the same board answers the same order every time: two players on the same score
 * would otherwise be ordered by whatever the read returned, which makes a board page unrepeatable for a caller
 * flicking between two requests. The id is arbitrary but STABLE, which is what an order needs to be.
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

  const rows = await deps.store.query({ pk: boardPk(mode, levelIndex, period), limit: BOARD_READ_CAP });
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

  entries.sort((left, right) => (right.score - left.score) || (left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0));
  return {
    status: STATUS.ok,
    body: {
      board: {
        mode,
        levelIndex,
        period,
        entries: entries.slice(0, LEADERBOARD_PAGE),
        // WHAT THE READ SAW, so a caller can tell a short board from a truncated one — and so the operator can see
        // the cap being reached rather than reading a rank that was never computed.
        examined: entries.length,
        truncated: rows.length >= BOARD_READ_CAP,
      },
    },
  };
}
