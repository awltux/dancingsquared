// THE BOARD, pinned (DESIGN.md §6, §11): one partition per mode, level and period, ranked by score.
//
// WHY THIS IS A GATE. §6 makes a board a scoreboard of the SERVER's numbers, and the endpoint that reads it is the
// first thing in this API that reads a PARTITION rather than a key — so it is where a store's `query` could quietly
// become a scan. The checks below are therefore about the two things that can go wrong without looking wrong: an
// answer that reached into another board (the negative control at §3, which is what a scan would do), and an answer
// that ranked a TRUNCATED read as if it were the whole board (§5, where the cap is reached and the answer says so).
//
// IT IS ALSO WHERE THE ROW'S SHAPE IS PINNED. The player is the row's SORT KEY and the store hands back values, not
// keys — so the row carries `playerId`, and a board row that did not would be a rank with nobody on it. That write
// site is `POST /runs` (`handlers/runs.ts`), and `runs-probe.mjs` checks the row it writes.
//
// Usage: node api/test/leaderboard-probe.mjs
import { BOARD_READ_CAP, LEADERBOARD_PAGE, getLeaderboard } from '../src/handlers/leaderboard.ts';
import { STATUS } from '../src/status.ts';
import { boardKey, boardPk } from '../src/keys.ts';
import { MemoryStore } from '../src/store/memory.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const SEASON = '2026-10';
const DAY = '2026-10-16';

/** The deps, with NO identity: a board is a READ, and A20 serves reads to a signed-out caller. */
const depsFor = (store) => ({ store, clock: { nowMs: () => 1_700_000_000_000 }, identityOf: () => null });
const ask = (query) => ({ method: 'GET', path: '/leaderboard', query, body: null, headers: {} });

/** One player's entry on a board, as `POST /runs` writes it: the folded value and the player the row is keyed by. */
const entry = (store, mode, level, period, playerId, score, runs = 1) =>
  store.put(boardKey(mode, level, period, playerId), { playerId, score, runs }, null);

console.log('== 1. the request is checked before any partition is read ==');
{
  const deps = depsFor(new MemoryStore());
  const cases = [
    [{ level: '1', period: SEASON }, 'no mode', 'bad_mode'],
    [{ mode: 'solo', level: '1', period: SEASON }, 'a mode that is not one', 'bad_mode'],
    [{ mode: 'drill', period: SEASON }, 'no level', 'bad_level'],
    [{ mode: 'drill', level: '0', period: SEASON }, 'level 0', 'bad_level'],
    [{ mode: 'drill', level: '1.5', period: SEASON }, 'a fractional level', 'bad_level'],
    [{ mode: 'drill', level: '1' }, 'no period', 'bad_period'],
    [{ mode: 'drill', level: '1', period: '' }, 'an empty period', 'bad_period'],
  ];
  for (const [query, why, code] of cases) {
    const answer = await getLeaderboard(ask(query), deps);
    check(answer.status === STATUS.badRequest && answer.body.error.code === code, `${why} is refused (${answer.status} ${answer.body.error?.code})`);
  }
}

console.log('\n== 2. the board is ranked by score, and a tie has ONE order ==');
{
  const store = new MemoryStore();
  const deps = depsFor(store);
  // WRITTEN IN SCORE ORDER THAT IS NOT THE RANK ORDER, so an endpoint that returned the partition as it came would
  // fail: the scores are 10, 90, 40 and the ranking must find the 90 first.
  await entry(store, 'daily', 1, DAY, 'p10', 10);
  await entry(store, 'daily', 1, DAY, 'p90', 90, 3);
  await entry(store, 'daily', 1, DAY, 'p40', 40);
  // A TIE, because the order has to be STABLE rather than whatever the read returned: two players on one score would
  // otherwise swap places between two identical requests, which makes a board page unrepeatable.
  await entry(store, 'daily', 1, DAY, 'pb-tie', 40);

  const answer = await getLeaderboard(ask({ mode: 'daily', level: '1', period: DAY }), deps);
  const board = answer.body.board;
  check(answer.status === STATUS.ok, `the board answers (${answer.status})`);
  check(board.entries.map((each) => each.playerId).join(',') === 'p90,p40,pb-tie,p10', `highest first, ties by player id (${board.entries.map((each) => each.playerId).join(',')})`);
  check(board.entries[0].score === 90 && board.entries[0].runs === 3, `with the score and the runs that earned it (${board.entries[0].score} over ${board.entries[0].runs} run(s))`);
  check(board.examined === 4 && board.truncated === false, `and it reports what it examined, which is the whole board (${board.examined}, truncated ${board.truncated})`);
  check(board.mode === 'daily' && board.levelIndex === 1 && board.period === DAY, 'and names the board it ranked, so a caller cannot misread which one it got');
}

console.log('\n== 3. a board is ONE partition, and another board is not in it ==');
{
  const store = new MemoryStore();
  const deps = depsFor(store);
  await entry(store, 'daily', 1, DAY, 'mine', 55);
  // THE SAME PLAYER ON THE NEXT DAY, THE NEXT LEVEL, AND THE OTHER MODE. Each is a different partition, and a read
  // that returned any of them would be reading the table rather than the board.
  await entry(store, 'daily', 1, '2026-10-17', 'other-day', 99);
  await entry(store, 'daily', 2, DAY, 'other-level', 99);
  await entry(store, 'drill', 1, SEASON, 'other-mode', 99);

  const answer = await getLeaderboard(ask({ mode: 'daily', level: '1', period: DAY }), deps);
  check(answer.body.board.entries.length === 1 && answer.body.board.entries[0].playerId === 'mine', `only this board's one entry comes back (${answer.body.board.entries.map((each) => each.playerId).join(',')})`);

  const season = await getLeaderboard(ask({ mode: 'drill', level: '1', period: SEASON }), deps);
  check(season.body.board.entries.length === 1 && season.body.board.entries[0].playerId === 'other-mode', `and the SEASON is its own board, read by its own period (${season.body.board.entries.map((each) => each.playerId).join(',')})`);

  // AN EMPTY BOARD IS AN EMPTY ANSWER, not an error: a day nobody played is a real board with nobody on it.
  const empty = await getLeaderboard(ask({ mode: 'daily', level: '9', period: DAY }), deps);
  check(empty.status === STATUS.ok && empty.body.board.entries.length === 0 && empty.body.board.examined === 0, `a board nobody is on answers empty (${empty.status}, ${empty.body.board.entries.length} entries)`);
}

console.log('\n== 4. a row this build cannot rank is an OPERATOR FINDING, not a zero ==');
{
  const store = new MemoryStore();
  const deps = depsFor(store);
  await entry(store, 'daily', 1, DAY, 'good', 20);
  // A ROW WITHOUT ITS PLAYER: the shape `POST /runs` used to write. Skipping it would drop a player from the board
  // silently, and reading it as zero would rank them last — both are worse than saying the row is unreadable.
  await store.put(boardKey('daily', 1, DAY, 'nobody'), { score: 30, runs: 1 }, null);
  const nameless = await getLeaderboard(ask({ mode: 'daily', level: '1', period: DAY }), deps);
  check(nameless.status === STATUS.unavailable && nameless.body.error.code === 'unreadable_board', `a board row with no player is refused rather than skipped (${nameless.status} ${nameless.body.error?.code})`);

  const store2 = new MemoryStore();
  const deps2 = depsFor(store2);
  await store2.put(boardKey('daily', 1, DAY, 'broken'), { playerId: 'broken', score: 'lots', runs: 1 }, null);
  const unreadable = await getLeaderboard(ask({ mode: 'daily', level: '1', period: DAY }), deps2);
  check(unreadable.status === STATUS.unavailable && unreadable.body.error.code === 'unreadable_board', `and so is one whose score is not a number (${unreadable.body.error?.code})`);
}

console.log('\n== 5. the read is CAPPED, and a capped board says so ==');
{
  const store = new MemoryStore();
  const deps = depsFor(store);
  // THE SORT KEY IS THE PLAYER, so this endpoint cannot ask the store for "the best N" — it reads under a cap and
  // sorts. Filling the cap is therefore the ONLY way to reach the truncation, and the check is that the answer
  // admits it instead of ranking a read that stopped early as if it were the board.
  for (let index = 0; index < BOARD_READ_CAP; index++) {
    await entry(store, 'daily', 1, DAY, `p${String(index).padStart(4, '0')}`, index);
  }
  const answer = await getLeaderboard(ask({ mode: 'daily', level: '1', period: DAY }), deps);
  check(answer.body.board.examined === BOARD_READ_CAP && answer.body.board.truncated === true, `a board at the cap is reported as TRUNCATED (examined ${answer.body.board.examined}, truncated ${answer.body.board.truncated})`);
  check(answer.body.board.entries.length === LEADERBOARD_PAGE, `and the page it answers with is its own size, chosen after the sort (${answer.body.board.entries.length} of ${LEADERBOARD_PAGE})`);
  // THE PAGE IS THE TOP OF WHAT WAS EXAMINED, and the fixture's scores are its row numbers, so the highest score is
  // the last one written: a page taken from the READ rather than from the sort would start at the lowest.
  check(answer.body.board.entries[0].score === BOARD_READ_CAP - 1, `with the highest score first (${answer.body.board.entries[0].score})`);
  const under = await getLeaderboard(ask({ mode: 'daily', level: '2', period: DAY }), deps);
  check(under.body.board.truncated === false, 'NEGATIVE CONTROL: a board under the cap is NOT reported as truncated');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
