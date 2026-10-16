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
import { LEADERBOARD_PAGE, getLeaderboard } from '../src/handlers/leaderboard.ts';
import { STATUS } from '../src/status.ts';
import { BOARD_INDEX, boardIndexKeys, boardKey, boardPk, SCORE_CEILING } from '../src/keys.ts';
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

/**
 * One player's entry on a board, as `POST /runs` writes it: the folded value, the player the row is keyed by, AND
 * THE INDEX KEYS THAT RANK IT.
 *
 * THE INDEX KEYS ARE BUILT BY THE SAME FUNCTION THE WRITER USES (`keys.ts`'s `boardIndexKeys`), not spelled here: a
 * probe that wrote its own attributes would be measuring its own copy of the schema, and the twin, the adapter and
 * the table definition are the three things that have to agree about it. A row WITHOUT them is invisible to the
 * endpoint — the index does not carry it — which is a migration hazard rather than a bug: no deployed table exists
 * yet (§13's stage 7), and `handlers/runs.ts` is the one writer, so a new row always has them.
 */
const entry = (store, mode, level, period, playerId, score, runs = 1) =>
  store.put(boardKey(mode, level, period, playerId), { playerId, score, runs, ...boardIndexKeys(mode, level, period, playerId, score) }, null);

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
  // A ROW WHOSE INDEX KEYS RANK IT BUT WHICH NAMES NO PLAYER: the read finds it (the index is what the read uses) and
  // cannot report it. Skipping it would drop a player from the board silently, and reading it as zero would rank them
  // last — both are worse than saying the row is unreadable, which is the same rule the other readers keep.
  await store.put(boardKey('daily', 1, DAY, 'nobody'), { score: 30, runs: 1, ...boardIndexKeys('daily', 1, DAY, 'nobody', 30) }, null);
  const nameless = await getLeaderboard(ask({ mode: 'daily', level: '1', period: DAY }), deps);
  check(nameless.status === STATUS.unavailable && nameless.body.error.code === 'unreadable_board', `a board row with no player is refused rather than skipped (${nameless.status} ${nameless.body.error?.code})`);

  const store2 = new MemoryStore();
  const deps2 = depsFor(store2);
  await store2.put(boardKey('daily', 1, DAY, 'broken'), { playerId: 'broken', score: 'lots', runs: 1, ...boardIndexKeys('daily', 1, DAY, 'broken', 10) }, null);
  const unreadable = await getLeaderboard(ask({ mode: 'daily', level: '1', period: DAY }), deps2);
  check(unreadable.status === STATUS.unavailable && unreadable.body.error.code === 'unreadable_board', `and so is one whose score is not a number (${unreadable.body.error?.code})`);

  // A ROW THE INDEX DOES NOT CARRY IS NOT READ AT ALL, and that is stated rather than discovered: the index is built
  // from attributes the WRITER adds, so a row written without them cannot appear however the endpoint behaves. There
  // is no deployed table yet (§13's stage 7) and `handlers/runs.ts` is the only writer, so this is the shape of a
  // migration hazard rather than a live defect — and a check is how it stays stated.
  const store3 = new MemoryStore();
  const deps3 = depsFor(store3);
  await store3.put(boardKey('daily', 1, DAY, 'pre-index'), { playerId: 'pre-index', score: 500, runs: 1 }, null);
  const missed = await getLeaderboard(ask({ mode: 'daily', level: '1', period: DAY }), deps3);
  check(missed.status === STATUS.ok && missed.body.board.entries.length === 0, `a row written without index keys is invisible to the board, which is why the writer is the one place they are built (${missed.body.board.entries.length} entries)`);
}

console.log('\n== 5. the index makes the board a PAGE, and a full page says so ==');
{
  const store = new MemoryStore();
  const deps = depsFor(store);
  // MORE PLAYERS THAN A PAGE, so the question "is this list the whole board?" has an answer other than yes. The
  // scores are the row numbers, so the top of the board is the LAST one written: a read that returned the partition
  // in player order rather than through the index would answer with the LOWEST scores, which is what these checks
  // catch (they replaced a `BOARD_READ_CAP` this endpoint no longer has).
  const players = LEADERBOARD_PAGE + 10;
  for (let index = 0; index < players; index++) {
    await entry(store, 'daily', 1, DAY, `p${String(index).padStart(4, '0')}`, index);
  }
  const answer = await getLeaderboard(ask({ mode: 'daily', level: '1', period: DAY }), deps);
  check(answer.body.board.entries.length === LEADERBOARD_PAGE, `a board larger than a page answers with one page (${answer.body.board.entries.length} of ${players} players)`);
  check(answer.body.board.examined === LEADERBOARD_PAGE && answer.body.board.truncated === true, `and reports that the page filled (examined ${answer.body.board.examined}, truncated ${answer.body.board.truncated})`);
  // THE PAGE IS THE TOP OF THE BOARD: the highest score in the fixture is `players - 1`, and it must be FIRST — a read
  // in player order would put `p0000` there instead.
  check(answer.body.board.entries[0].score === players - 1 && answer.body.board.entries[LEADERBOARD_PAGE - 1].score === players - LEADERBOARD_PAGE, `with the highest scores first (${answer.body.board.entries[0].score} down to ${answer.body.board.entries[LEADERBOARD_PAGE - 1].score})`);
  // AND A BOARD THAT FITS SAYS IT FITS, which is the other half of the flag: `truncated` must not be a constant.
  await entry(store, 'daily', 2, DAY, 'only', 5);
  const small = await getLeaderboard(ask({ mode: 'daily', level: '2', period: DAY }), deps);
  check(small.body.board.truncated === false && small.body.board.examined === 1, `NEGATIVE CONTROL: a board that fits is not reported as truncated (examined ${small.body.board.examined}, truncated ${small.body.board.truncated})`);
}

console.log('\n== 6. the score has to FIT the sort key that orders the board ==');
{
  // THE CEILING IS A PROPERTY OF THE KEY, NOT OF THE ENDPOINT: DynamoDB orders a sort key ascending and cannot negate
  // a number, so the score is inverted into a FIXED-WIDTH field (`keys.ts`) and a score wider than that field would
  // sort as if it were the ceiling. The pure function is what refuses it, and this is the only place it can be
  // reached — a board's score cannot get there through the game's arithmetic, which is why the check is on the
  // function rather than on a run.
  check(boardIndexKeys('daily', 1, DAY, 'p1', SCORE_CEILING) !== null, `a score at the ceiling is orderable (${JSON.stringify(boardIndexKeys('daily', 1, DAY, 'p1', SCORE_CEILING)?.GSI1SK)})`);
  check(boardIndexKeys('daily', 1, DAY, 'p1', SCORE_CEILING + 1) === null, 'and one above it is REFUSED rather than clamped into a wrong rank');
  check(boardIndexKeys('daily', 1, DAY, 'p1', 7.5) === null && boardIndexKeys('daily', 1, DAY, 'p1', -1) === null, 'nor is a fractional or negative score rankable');
  // THE WIDTH IS WHAT MAKES THE COMPARISON WORK: a shorter field would sort '100' before '99'.
  const wide = boardIndexKeys('daily', 1, DAY, 'p1', 1)?.GSI1SK ?? '';
  const narrow = boardIndexKeys('daily', 1, DAY, 'p1', 100)?.GSI1SK ?? '';
  check(wide.length === narrow.length && narrow < wide, `and the inverted field is one fixed width, so a higher score sorts first (${narrow} < ${wide})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
