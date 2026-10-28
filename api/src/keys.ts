// The item table's key shapes, in one place.
//
// THE STORAGE CONTRACT IS ONE FILE BECAUSE THREE THINGS BUILD THESE KEYS: the handlers, the local seeding, and
// (in the deployment) the publishing tool. A key spelled twice is a key that can drift into two rows nobody
// notices, because both writes succeed and only a read fails later. Keys are pure functions of the ids, so
// they are also what a probe can write a fixture row with.
import type { ItemKey } from './ports.ts';

/** One player's position in one level's regime — the `Progress` item of DESIGN.md 11's table. */
export const progressKey = (playerId: string, levelIndex: number): ItemKey => ({
  pk: `progress#${playerId}`,
  sk: `level#${levelIndex}`,
});

/** One level's published regime — the `Schedule` item. `current` is the only sort key the pipeline writes. */
export const scheduleKey = (levelIndex: number): ItemKey => ({ pk: `schedule#${levelIndex}`, sk: 'current' });

/**
 * ONE DRILL, as published: its seed AND its boards, keyed by the level and the position in the regime.
 *
 * ONE ROW PER DRILL rather than one row per level, and the reason is a hard limit: a stored puzzle is ~11 KB,
 * so 100 of them in one item is ~1.1 MB against DynamoDB's 400 KB item ceiling. A row per drill also makes the
 * serving read a single `get`, which is what the level grid wants — the grid itself carries no puzzle data.
 *
 * THE SORT KEY IS THE POSITION, unpadded, because nothing range-reads this partition: the schedule row owns the
 * level's LENGTH and its order, and a drill is fetched by the index that order names.
 */
export const drillKey = (levelIndex: number, index: number): ItemKey => ({ pk: `drill#${levelIndex}`, sk: `${index}` });

/**
 * THE PLAYER'S LEVEL — the one row that says which level is THEIRS (DESIGN.md §15 Q17(vi)).
 *
 * IT IS A SEPARATE PARTITION FROM `progress#` BECAUSE THE TWO HAVE DIFFERENT CARDINALITIES. Progress is one row
 * PER LEVEL (`progressKey(playerId, levelIndex)`) — a player keeps the finished set of every level they have
 * been through — while the ladder is one row per player. `sk` is a constant because there is exactly one fact in
 * the row and a sort key that could vary would make "which level am I on" a query rather than a read.
 */
export const ladderKey = (playerId: string): ItemKey => ({ pk: `ladder#${playerId}`, sk: 'current' });

/**
 * One completed run, keyed by the id the CLIENT minted.
 *
 * THE ID IS THE KEY, WHICH IS WHAT MAKES A RETRY FREE: the run is created inside the same transaction that
 * writes its effects, so a resubmission finds the item present, the transaction is cancelled by its condition,
 * and the handler answers with what was already recorded instead of counting the run twice.
 */
export const runKey = (playerId: string, runId: string): ItemKey => ({ pk: `runs#${playerId}`, sk: `run#${runId}` });

/** A player's hint balance: `hints` and the progress towards the next one (DESIGN.md 10, 11). */
export const hintsKey = (playerId: string): ItemKey => ({ pk: `hints#${playerId}`, sk: 'balance' });

/**
 * One board's partition, WITHOUT a player: the whole board, which is what a leaderboard reads.
 *
 * IT IS A SECRETARY FOR `boardKey` RATHER THAN A SECOND SPELLING, so the leaderboard cannot ask for a partition the
 * writer never writes: a `query` built from its own string would keep working while every board row landed
 * somewhere else, and the failure would look like an empty board.
 */
export const boardPk = (mode: 'drill' | 'daily', levelIndex: number, period: string): string => `board#${mode}#${levelIndex}#${period}`;

/**
 * One entry on one board, keyed by the board's own partition (DESIGN.md 6).
 *
 * THE PERIOD IS PART OF THE KEY AND IT MEANS TWO DIFFERENT THINGS, which is why the caller passes it: the
 * Daily's board is one UTC day per level (`2026-10-15`), which IS its challenge's identity, and the Drill's is the
 * PUBLISHED SET the run's drill came from — `seasonVersion(poolVersion, season)` for a season the publisher wrote,
 * or the local fixture's own version in development (`Schedule.scheduleVersion`, §15 Q17(vii)). A REPUBLISHED SET
 * therefore resets the Drill's board by construction rather than by a job that deletes rows — and the Drill has no
 * month, so nothing resets a score while the block keeps filling.
 */
export const boardKey = (mode: 'drill' | 'daily', levelIndex: number, period: string, playerId: string): ItemKey => ({
  pk: boardPk(mode, levelIndex, period),
  sk: `player#${playerId}`,
});

/**
 * The index the leaderboard reads: one board, ordered by SCORE.
 *
 * WHY AN INDEX AT ALL. A board is one partition whose SORT KEY IS THE PLAYER, so the base table can return a board
 * only in player order — and "the top N scores" then means reading the whole partition and sorting it in the
 * handler. That is what the endpoint did while it recorded `truncated`: it read up to a 1000-row cap per request
 * and had to admit the ranking might be partial. With the score in this index's sort key the same question is a
 * bounded read of the first page.
 *
 * THE SCORE IS INVERTED SO THAT ASCENDING IS BEST-FIRST. DynamoDB orders a sort key ascending and cannot negate a
 * number, so this key holds `(SCORE_CEILING - score)` zero-padded to a fixed width: a HIGHER score sorts FIRST, and
 * the tie-break is the player id, which keeps a board answering ONE order. The ceiling is therefore a real bound on
 * a board row's score rather than decoration, and a board's score can be CUMULATIVE (the Drill's is the season's
 * total), so `boardIndexKeys` REFUSES a score outside the space instead of clamping it: a clamped row would sit at
 * the wrong rank forever, and a board that silently mis-ranks one player is worse than a write that fails loudly.
 */
export const BOARD_INDEX = 'GSI1';
export const BOARD_INDEX_PK = 'GSI1PK';
export const BOARD_INDEX_SK = 'GSI1SK';

/** The highest score a board row can order. Nine digits, which is far above any board this game's arithmetic reaches. */
export const SCORE_CEILING = 999_999_999;

/** The width of the inverted-score field, so every sort key compares at the same length. */
const SCORE_DIGITS = String(SCORE_CEILING).length;

/**
 * The attribute names behind each index name, so a store can resolve one without knowing the schema.
 *
 * THE NAME IS WHAT A CALLER PASSES AND THE ATTRIBUTES ARE WITHIN THE STORE'S REMIT, which is why this map lives
 * here beside the keys and is read by BOTH implementations and by the table definition. A caller that spelled an
 * attribute name would be writing the schema at a call site.
 */
export const INDEX_ATTRIBUTES: Readonly<Record<string, { readonly pk: string; readonly sk: string }>> = {
  [BOARD_INDEX]: { pk: BOARD_INDEX_PK, sk: BOARD_INDEX_SK },
};

/** One board row's index keys, or null when the score is outside the space the sort key can hold. */
export function boardIndexKeys(
  mode: 'drill' | 'daily',
  levelIndex: number,
  period: string,
  playerId: string,
  score: number,
): Record<string, string> | null {
  if (!Number.isInteger(score) || score < 0 || score > SCORE_CEILING) return null;
  return {
    [BOARD_INDEX_PK]: boardPk(mode, levelIndex, period),
    [BOARD_INDEX_SK]: `${String(SCORE_CEILING - score).padStart(SCORE_DIGITS, '0')}#${playerId}`,
  };
}

/** One level's published challenge for one UTC day, written by the boundary job (DESIGN.md 11). */export const publishedDailyKey = (levelIndex: number, day: string): ItemKey => ({ pk: `daily#${levelIndex}`, sk: `date#${day}` });

/**
 * One player's account, keyed by the email they sign in with (DESIGN.md 11.2).
 *
 * THE EMAIL IS THE KEY BECAUSE IT IS THE ONLY THING A SIGN-IN HAS. The player id is inside the item, so a
 * `signin` is one read by the handle the caller typed; a key shaped the other way round would need a lookup by
 * value, which this store deliberately has no operation for (ports.ts). The email is normalised (trimmed and
 * lowercased) by the emulator BEFORE this is called, so `Alice@x` and `alice@x` cannot become two accounts.
 */
export const accountKey = (email: string): ItemKey => ({ pk: `auth#${email}`, sk: 'account' });

/**
 * One player's tally of REFUSED requests (DESIGN.md 11.1, A25).
 *
 * THE PARTITION IS THE PLAYER AND THERE IS ONE ROW, because the question an operator asks is "is this account
 * probing?" rather than "what did it probe" — the per-code tally inside the row answers the second well enough, and
 * the refusal rate the alarm watches needs only the total.
 */
export const abuseKey = (playerId: string): ItemKey => ({ pk: `abuse#${playerId}`, sk: 'counters' });

/**
 * One player's attempt at one challenge — the `Attempts` item of DESIGN.md 11 (A21's server clock).
 *
 * THE PARTITION IS THE PLAYER AND THE SORT KEY IS THE CHALLENGE, which is the opposite of the run row's shape and
 * deliberately so: a run is one item per submission, while an attempt is one item per challenge the player has
 * LOOKED at, and the question asked of it is always "when did THIS player start THIS one".
 *
 * `id` IS THE CHALLENGE'S OWN NAME. Only the Daily writes one today — the Drill's issue stamp is already the
 * server's own fact in the Progress row — and the Daily's is `<level>#<day>`, which is what makes the same
 * challenge on two days two attempts rather than one.
 */
export const attemptKey = (playerId: string, mode: 'drill' | 'daily', id: string): ItemKey => ({
  pk: `attempts#${playerId}`,
  sk: mode === 'drill' ? `drill#${id}` : `daily#${id}`,
});

/**
 * One imported run, keyed by the DEVICE's own id (DESIGN.md 11.1, A26).
 *
 * IT IS A SEPARATE PARTITION FROM `runs#` ON PURPOSE: everything under `runs#` is a result the server issued,
 * timed, verified and possibly ranked, and everything under `history#` is a story a device brought with it. Keeping
 * them apart means a query for RESULTS cannot accidentally include history, which is a mistake that would stay
 * invisible until somebody's offline play turned up on a leaderboard.
 */
export const historyKey = (playerId: string, runId: string): ItemKey => ({ pk: `history#${playerId}`, sk: `run#${runId}` });

/**
 * One player's PUBLIC PROFILE — the alias a leaderboard row shows instead of an identifier.
 *
 * REPORTED: "the user needs a login alias that can be displayed in the leaderboard. Dont expose the email address
 * anywhere on the UI." A one-row partition like `hints#` and `ladder#`, because there is one alias per player and the
 * question is always "what is this player's name" — a read, never a range.
 */
export const profileKey = (playerId: string): ItemKey => ({ pk: `profile#${playerId}`, sk: 'alias' });

/**
 * One CLAIMED alias, so a name belongs to exactly one player.
 *
 * THE CLAIM IS THE CONDITIONAL WRITE, and that is what makes two players racing for the same name answer one winner and
 * one `alias_taken` rather than both storing it: `put(aliasKey(key), …, null)` creates only if absent, the same
 * mechanism that makes a run idempotent.
 *
 * A RETIRED NAME IS NOT REUSED, deliberately, and the store's own shape is the reason it is also the only rule that can
 * be implemented: there is no delete in the port. That is the right outcome anyway — a freed name could be claimed by
 * somebody passing themselves off as the player who had it, and a leaderboard that shows a name as a player's identity
 * must not reassign it.
 *
 * `key` IS ALREADY FOLDED: `aliasKeyOf` in `game/src/puzzle/alias.ts` lowercases and collapses it, so this key is
 * case-insensitive by construction rather than by a second rule here.
 */
export const aliasClaimKey = (key: string): ItemKey => ({ pk: `alias#${key}`, sk: 'claim' });