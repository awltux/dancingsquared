// `GET /me/profile` and `POST /me/alias` — the public name a leaderboard row shows (DESIGN.md §11).
//
// WHAT IT REPLACES. A board row carries a `playerId`, which is a Cognito sub in the deployed build and `emu:1` in the
// emulator — neither is a name. The app was printing whatever it had, which is why a row could read `emu:1`, and the
// owner's requirement is the reason this exists: "the user needs a login alias that can be displayed in the leaderboard.
// Dont expose the email address anywhere on the UI."
//
// THE RULE IS NOT HERE. `sanitizeAlias` lives in `game/src/puzzle/alias.ts` and both this handler and the app call it, so
// what the server accepts and what the app tells a player to expect cannot drift (AGENTS.md §5). The server runs it
// because a client that skipped it is exactly the client this endpoint has to survive.
//
// TWO WRITES, ONE OUTCOME: the claim row (`alias#<key>`) is created conditionally, so a name belongs to one player, and
// the profile row is written only after the claim exists. A lost race on either answers `alias_taken` or re-reads — never
// a half-applied rename, which would be a board row naming a player whose profile says something else.
//
// A NAME ONCE USED STAYS RESERVED. The port has no delete, and that is the behaviour worth having anyway: a leaderboard
// that shows a name as a player's identity must not hand that name to somebody else later (`keys.ts`'s `aliasClaimKey`).
import type { ApiRequest, ApiResult, Deps } from '../ports.ts';
import { failure, requireIdentity, STATUS } from '../status.ts';
import { aliasClaimKey, boardKey, hintsKey, ladderKey, profileKey, progressKey, scheduleKey } from '../keys.ts';
import { asLadderLevel } from '../ladder.ts';
import { asProgress } from '../progress-row.ts';
import { asBoard, asHints, type BoardValue } from '../runs.ts';
import { sanitizeAlias, utcDay, type HintLedger } from 'dancing-squared-game';

/**
 * The player's own cumulative Drill board for the level and set they are playing, or null when the server cannot say.
 *
 * IT RIDES THE PROFILE READ because that is the one player-bound request every signed-in boot makes (`main.ts`'s
 * `loadAlias`), so the app's header scores are right on EVERY page after a reload — not only after a play page has issued a
 * drill. REPORTED: "Check all the pages to ensure that the header score is correctly updated." The scores are the SERVER's:
 * the device's own ledger was removed, so a page that has not asked the server has no score to show.
 *
 * READ-ONLY, AND THAT IS WHY IT DOES NOT USE `servableLevel`: that function PROMOTES a full block, and a profile read must
 * not move a player's level. The set is the player's in-flight drill's when one is issued (a lock survives a republish),
 * and the published schedule's otherwise. An unreadable row answers null rather than failing the name read: this is a
 * display fact, and the alias is what the endpoint is for.
 */
async function playerDrillBoard(deps: Deps, playerId: string): Promise<BoardValue | null> {
  const levelIndex = asLadderLevel(await deps.store.get(ladderKey(playerId)));
  if (levelIndex === null) return null;
  const progress = asProgress(await deps.store.get(progressKey(playerId, levelIndex)), levelIndex);
  if (progress === null) return null;
  const issued = progress.issued?.scheduleVersion;
  const published = issued ?? (await deps.store.get(scheduleKey(levelIndex)))?.value['scheduleVersion'];
  if (typeof published !== 'string') return null;
  return asBoard(await deps.store.get(boardKey('drill', levelIndex, published, playerId)));
}

/**
 * The player's own Daily board for TODAY, or null when the server cannot say.
 *
 * THE DAILY BOARD'S PERIOD IS THE UTC DAY, and the header carries that score too: both ride the one player-bound read
 * every signed-in boot makes, so a reload on any page has both numbers rather than one.
 */
async function playerDailyBoard(deps: Deps, playerId: string): Promise<BoardValue | null> {
  const levelIndex = asLadderLevel(await deps.store.get(ladderKey(playerId)));
  if (levelIndex === null) return null;
  const day = utcDay(new Date(deps.clock.nowMs()));
  return asBoard(await deps.store.get(boardKey('daily', levelIndex, day, playerId)));
}

/**
 * The player's hint balance, or null when the server cannot read it.
 *
 * REPORTED: "When logged out, the hints bank still shows my hints, it should be empty. The hint bank should be stored on
 * the server, not locally." The balance always WAS the server's — `POST /me/hints` debits it and `POST /runs` credits it
 * (A23) — but the app kept a copy in its own saved record and drew that copy, so a signed-out page went on showing the
 * last player's hints. The copy is gone (`game/src/game/store.ts`), so the balance has to arrive on the one read every
 * signed-in boot makes, and this is it: `null` for an unreadable row, "no news" rather than "no hints".
 */
async function playerHints(deps: Deps, playerId: string): Promise<HintLedger | null> {
  return asHints(await deps.store.get(hintsKey(playerId)));
}

/**
 * The alias currently claimed, or null when this player has never claimed one.
 *
 * A READ THAT NEEDS AN IDENTITY, unlike the board: an alias is the player's own row, and there is nothing to show a
 * signed-out caller. It answers `alias: null` rather than a 404 for a player who has not chosen yet — "no name yet" is a
 * state the app draws a form for, not an error.
 */
export async function getProfile(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;
  // THE BOARDS ARE READ FOR EVERY ANSWER, name or not: they are the header's scores on the pages that issue no drill.
  const drillBoard = await playerDrillBoard(deps, playerId);
  const dailyBoard = await playerDailyBoard(deps, playerId);
  const hints = await playerHints(deps, playerId);
  const stored = await deps.store.get(profileKey(playerId));
  if (!stored) return { status: STATUS.ok, body: { alias: null, drillBoard, dailyBoard, hints } };
  const alias = stored.value['alias'];
  if (typeof alias !== 'string') {
    // AN UNREADABLE PROFILE IS AN OPERATOR FINDING, not a silent null: a row that exists and cannot be read would
    // otherwise present as "this player has never claimed a name", which is a different fact and would let them claim a
    // second one over the top of the unreadable row.
    return failure(STATUS.unavailable, 'unreadable_profile', 'the profile row is not a record this build can read');
  }
  return { status: STATUS.ok, body: { alias, drillBoard, dailyBoard, hints } };
}

/**
 * Claim an alias, or change the one this player holds.
 *
 * THE REFUSALS ARE THE RULE'S OWN CODES, so the app can branch on `alias_too_long` without parsing a sentence — and the
 * sentence is carried too, because that is what the app shows under the input (`ui/alias.ts` builds the same words, and
 * the server's copy is authoritative).
 */
export async function postAlias(request: ApiRequest, deps: Deps): Promise<ApiResult> {
  const who = requireIdentity(request, deps);
  if ('refusal' in who) return who.refusal;
  const playerId = who.identity.playerId;

  const body = request.body as { alias?: unknown } | null;
  const verdict = sanitizeAlias(body?.alias);
  if (!verdict.ok) return failure(STATUS.badRequest, verdict.code, verdict.message);

  const claim = await deps.store.get(aliasClaimKey(verdict.key));
  if (claim) {
    if (claim.value['playerId'] === playerId) {
      // THE SAME NAME AGAIN IS NOT AN ERROR: the claim is this player's, so the thing to do is make sure the profile row
      // agrees with it (a rename that lost its second write, or a first claim whose profile write failed).
      await deps.store.put(profileKey(playerId), { alias: verdict.alias, key: verdict.key }, null);
      return { status: STATUS.ok, body: { alias: verdict.alias } };
    }
    return failure(STATUS.conflict, 'alias_taken', `"${verdict.alias}" has already been claimed`);
  }

  // THE CLAIM FIRST, CONDITIONALLY. `expectedRev: null` means "create only if absent", so two players racing for one
  // name leave one claim row and one refusal here rather than two rows that overwrite each other.
  const claimed = await deps.store.put(aliasClaimKey(verdict.key), { playerId }, null);
  if (!claimed) return failure(STATUS.conflict, 'alias_taken', `"${verdict.alias}" has already been claimed`);
  await deps.store.put(profileKey(playerId), { alias: verdict.alias, key: verdict.key }, null);
  return { status: STATUS.ok, body: { alias: verdict.alias } };
}
