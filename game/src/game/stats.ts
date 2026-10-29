// THE HEADER'S SCORES: WHERE THEY COME FROM, AND WHAT AN ANSWER DOES TO THEM.
//
// THE SERVER IS THE ONE POINT OF TRUTH FOR A SCORE. REPORTED: "I would like to move away from the offline score. You can
// play without logging in, but you need access to the server and so the score should be stored on the server. A single
// point of truth." The device's own ledger of solved drills is GONE (`game/store.ts` no longer holds runs), because it was
// a different quantity: it counted demo and practice runs the server never saw, and it could disagree with the board by
// any amount — REPORTED twice as a header total beside a leaderboard that did not match.
//
// SO THERE ARE TWO BOARD FACTS AND NOTHING ELSE:
//   * the DRILL board is the account's ranked total for their level and published set;
//   * the DAILY board is their ranked score for today.
// Both are reported by `GET /me/profile` (so a boot on any page has them), by a run submission's answer (the fold), and
// by the leaderboard read (the caller's own row) as a last resort. The header shows them, and shows ZERO / NO SCORE when
// the app does not know them: a signed-out or practice run is unscored by design, not by an offline fallback.
//
// THIS MODULE IS PURE: no DOM, no storage, no network. The shell gathers the answers; the two rules a probe can drive —
// "does an answer move the known board?" and "which row on a board is mine?" — live here.

/** One board's value for one player: the score, and how many runs earned it. */
export interface BoardTotal {
  readonly score: number;
  readonly runs: number;
}

/**
 * WHAT A SERVER ANSWER DOES TO THE BOARD THE HEADER ALREADY KNOWS.
 *
 * A READ CAN CARRY THE PLAYER'S BOARD, OR NOTHING, and the two must not be read alike. The app used to assign null on
 * every read; a read that did not carry the board (an older server, or a row it could not read) then replaced a known
 * total, and the header fell back to the device's sum — REPORTED: "When I pass a drill, the score in the header is
 * updated. But as soon as I leave that screen the score reverts back to a number I don't recognise."
 *
 *   - A BOARD PRESENT: it wins, INCLUDING ZERO (a real answer: no ranked runs yet).
 *   - NO BOARD, AND THE ANSWER IS A DEMO: forget it. A signed-out caller's board is not this player's, and the header
 *     shows no score until they sign in.
 *   - NO BOARD, AND THE ANSWER IS NOT A DEMO: the server did not say — NO NEWS, not NO SCORE. The last known board is
 *     kept, because replacing it with nothing is the revert this rule exists to prevent.
 */
export function adoptedBoard(known: BoardTotal | null, board: BoardTotal | null, demo: boolean): BoardTotal | null {
  if (board !== null) return board;
  if (demo) return null;
  return known;
}

/**
 * THE CALLER'S OWN ROW ON A BOARD PAGE, or null when their row is not on it.
 *
 * A leaderboard page carries one row per player for the level and set it names, so a row whose `playerId` is the
 * caller's IS their score on that board — the same number every server answer above reports. It is a FALLBACK SOURCE for
 * a server that does not send the board on the other reads (MEASURED: the dev server on :8090 answered `GET
 * /drill/current` with only `drill, demo, regime`, and the header then showed the device's 726 beside the board's 1818).
 *
 * A NULL PLAYER ID ANSWERS NULL: a signed-out caller has no row, and a device that has not been given an identity must not
 * claim one.
 */
export function boardEntryOf(
  entries: readonly { readonly playerId: string; readonly score: number; readonly runs: number }[],
  playerId: string | null,
): BoardTotal | null {
  if (playerId === null) return null;
  for (const entry of entries) {
    if (entry.playerId === playerId) return { score: entry.score, runs: entry.runs };
  }
  return null;
}
