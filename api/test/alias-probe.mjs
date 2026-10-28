// THE ALIAS, ON THE SERVER — `GET /me/profile`, `POST /me/alias`, and the names a board carries.
//
// REPORTED: "the user needs a login alias that can be displayed in the leaderboard. Dont expose the email address
// anywhere on the UI." and then "alias needs to be sanitised somehow."
//
// WHY THIS PROBE EXISTS WHEN THE RULE HAS ITS OWN. `game/test/alias-probe.mjs` pins what a name may be; this pins what
// the ENDPOINTS do with one, and each check is a thing that would look right on screen while being wrong:
//   1. THE SERVER RUNS THE RULE. A client that posts `ada@example.com` or a 17-character name is refused HERE, with the
//      rule's own code — the app's sanitiser is a convenience, never the enforcement.
//   2. ONE NAME, ONE PLAYER. The claim row is created conditionally, so a second player claiming the same folded name is
//      refused `alias_taken` and the FIRST player's row is untouched. The negative control re-claims with the winner to
//      show the refusal is about the name and not about a second claim in general.
//   3. THE FOLD IS THE UNIQUENESS. `Ada` then `ada` collides, which is the whole reason the key is normalised.
//   4. A BOARD CARRIES NAMES, NOT IDENTIFIERS. The entry answers `alias` for a player who claimed one and `null` for one
//      who did not — never the playerId, which is the leak the endpoint exists to stop.
//   5. AN UNREADABLE ROW IS NOT "NO NAME YET". A profile row that exists and cannot be read answers `unreadable_profile`,
//      because a silent null would let the player claim a second name over the top of it.
//
// Usage: node api/test/alias-probe.mjs
import { getProfile, postAlias } from '../src/handlers/profile.ts';
import { getLeaderboard } from '../src/handlers/leaderboard.ts';
import { STATUS } from '../src/status.ts';
import { aliasClaimKey, boardIndexKeys, boardKey, profileKey } from '../src/keys.ts';
import { MemoryStore } from '../src/store/memory.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** The deps for one player: an identity, a clock, and the store under test. */
const depsFor = (store, playerId) => ({
  store,
  clock: { nowMs: () => 1_700_000_000_000 },
  identityOf: () => (playerId === null ? null : { playerId, standing: 'ranked' }),
});

const claim = (playerId, alias) => ({ method: 'POST', path: '/me/alias', query: {}, body: { alias }, headers: {} });
const read = () => ({ method: 'GET', path: '/me/profile', query: {}, body: null, headers: {} });

console.log('== 1. the server enforces the rule, whatever the client sent ==');
{
  const store = new MemoryStore();
  const deps = depsFor(store, 'emu:1');
  const refused = [
    ['ada@example.com', 'alias_bad_characters', 'an email address'],
    ['ab', 'alias_too_short', 'a two-character name'],
    ['a'.repeat(17), 'alias_too_long', 'seventeen characters'],
    ['_ada', 'alias_bad_shape', 'a leading separator'],
    ['admin', 'alias_reserved', 'a reserved operator word'],
    ['   ', 'alias_empty', 'whitespace only'],
  ];
  for (const [alias, code, why] of refused) {
    const answer = await postAlias(claim('emu:1', alias), deps);
    check(answer.status === STATUS.badRequest && answer.body.error.code === code,
      `${why} is refused by the server (${answer.status} ${answer.body.error?.code})`);
  }
  // AND NOTHING WAS WRITTEN: a refused claim must not leave a claim row behind, or the name would be taken by a player
  // whose profile says nothing.
  const got = await getProfile(read(), deps);
  check(got.status === STATUS.ok && got.body.alias === null, `no claim survived the refusals (${JSON.stringify(got.body)})`);
}

console.log('\n== 2. one name, one player ==');
{
  const store = new MemoryStore();
  const first = depsFor(store, 'emu:1');
  const second = depsFor(store, 'emu:2');
  const won = await postAlias(claim('emu:1', 'Ada Lovelace'), first);
  check(won.status === STATUS.ok && won.body.alias === 'Ada Lovelace', `the first claim is accepted (${won.status} ${won.body.alias})`);
  const lost = await postAlias(claim('emu:2', 'Ada Lovelace'), second);
  check(lost.status === STATUS.conflict && lost.body.error.code === 'alias_taken',
    `a second player claiming it is refused (${lost.status} ${lost.body.error?.code})`);
  const robbed = await getProfile(read(), second);
  check(robbed.body.alias === null, 'and the loser holds no name');
  const winner = await getProfile(read(), first);
  check(winner.body.alias === 'Ada Lovelace', 'while the winner keeps theirs');
  // CONTROL: the SAME player claiming the same name again is not a conflict — which shows the refusal above is about the
  // name belonging to somebody else rather than about a second claim in general.
  const again = await postAlias(claim('emu:1', 'Ada Lovelace'), first);
  check(again.status === STATUS.ok, `CONTROL: the holder re-claiming it succeeds (${again.status})`);
}

console.log('\n== 3. the fold is the uniqueness, and the name keeps its capitals ==');
{
  const store = new MemoryStore();
  const one = depsFor(store, 'emu:1');
  const two = depsFor(store, 'emu:2');
  await postAlias(claim('emu:1', 'Ada Lovelace'), one);
  const folded = await postAlias(claim('emu:2', 'ada  lovelace'), two);
  check(folded.status === STATUS.conflict && folded.body.error.code === 'alias_taken',
    `"ada  lovelace" collides with "Ada Lovelace" (${folded.status} ${folded.body.error?.code})`);
  const shown = await getProfile(read(), one);
  check(shown.body.alias === 'Ada Lovelace', `and the stored name keeps the capitals it was typed with (${shown.body.alias})`);
}

console.log('\n== 4. a board carries names, not identifiers ==');
{
  const store = new MemoryStore();
  const season = '2026-10';
  // Two players on one board: one has claimed a name, the other has not. The rows are written the way `POST /runs`
  // writes them, through the same key helper, so this measures the reader against the real row shape.
  for (const [playerId, score] of [['emu:1', 90], ['emu:2', 40]]) {
    await store.put(boardKey('drill', 1, season, playerId), { playerId, score, runs: 1, ...boardIndexKeys('drill', 1, season, playerId, score) }, null);
  }
  await postAlias(claim('emu:1', 'Ada'), depsFor(store, 'emu:1'));

  const board = await getLeaderboard({ method: 'GET', path: '/leaderboard', query: { mode: 'drill', level: '1', period: season }, body: null, headers: {} }, depsFor(store, null));
  check(board.status === STATUS.ok, `the board answers (${board.status})`);
  const entries = board.body.board.entries;
  check(entries.length === 2, `with both players on it (${entries.length})`);
  check(entries[0].alias === 'Ada', `the player who claimed a name shows it (${JSON.stringify(entries[0].alias)})`);
  check(entries[1].alias === null, `and the one who did not shows null rather than an id (${JSON.stringify(entries[1].alias)})`);
  // THE LEAK CHECK: the id is still in the answer as the row's own key (the app needs it to mark "you"), and what must
  // never appear is an EMAIL. A board built from profile rows cannot carry one; this asserts the shape rather than a
  // string, because the id is legitimately present.
  check(entries.every((e) => typeof e.alias !== 'string' || !e.alias.includes('@')),
    'and no entry carries an address in its name');
}

console.log('\n== 5. an unreadable profile is not "no name yet" ==');
{
  const store = new MemoryStore();
  const deps = depsFor(store, 'emu:1');
  await store.put(profileKey('emu:1'), { alias: 42 }, null);
  const answer = await getProfile(read(), deps);
  check(answer.status === STATUS.unavailable && answer.body.error.code === 'unreadable_profile',
    `a profile row that cannot be read is reported (${answer.status} ${answer.body.error?.code})`);
  const boardStore = new MemoryStore();
  // The board keeps `null` for the same row, deliberately: a board must not fail because one player's profile is
  // unreadable, and it must not fall back to the id either.
  await boardStore.put(profileKey('emu:1'), { alias: 42 }, null);
  await boardStore.put(boardKey('daily', 1, '2026-10-16', 'emu:1'), {
    playerId: 'emu:1', score: 10, runs: 1, ...boardIndexKeys('daily', 1, '2026-10-16', 'emu:1', 10),
  }, null);
  const board = await getLeaderboard({ method: 'GET', path: '/leaderboard', query: { mode: 'daily', level: '1', period: '2026-10-16' }, body: null, headers: {} }, depsFor(boardStore, null));
  check(board.status === STATUS.ok && board.body.board.entries[0].alias === null,
    `while a board answers with its entries and a null name (${board.status} ${JSON.stringify(board.body.board?.entries?.[0]?.alias)})`);
}

console.log('\n== 6. a claim is refused for a caller the server cannot name ==');
{
  const store = new MemoryStore();
  const answer = await postAlias(claim('emu:1', 'Ada'), depsFor(store, null));
  check(answer.status === STATUS.unauthenticated && answer.body.error.code === 'unauthenticated',
    `a signed-out claim is refused (${answer.status} ${answer.body.error?.code})`);
  check((await store.get(aliasClaimKey('ada'))) === null, 'and nothing is written');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
