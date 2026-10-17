// THE DAILY'S RECORDED MOVES, pinned (DESIGN.md §11.1, A22's Daily half).
//
// WHY THIS IS A GATE. §6 prices the Daily's LINE — `wasteFactor` measures the calls used against the shortest — so
// while the line was a FIELD in the submission a modified client could play a wasteful line and submit the short
// one. The endpoint here records what the player DID, and `POST /runs` scores the line those moves derive.
//
// THE DERIVATION IS CHECKED AGAINST THE CLIENT'S OWN CLASS rather than against numbers written down here. For each
// sequence below the probe drives a real `PlaySession` with the kinds IT posted and compares that line with the one
// `replayDailyMoves` derives from what the server STORED. The two agree only if the endpoint stored the sequence
// faithfully AND the derivation is that same session (DESIGN.md §4.4) — a probe that restated undo/redo arithmetic
// would be measuring a copy of the rule, and one that only compared the derivation with itself would measure nothing.
//
// WHAT IS *NOT* HERE ON PURPOSE: the refusals at the other end of the flow — `no_recorded_line` and `line_mismatch` —
// are pinned in `runs-probe.mjs`, where the submission is. This probe is the recorder.
//
// Usage: node api/test/daily-move-probe.mjs
import { getPuzzle } from '../src/handlers/puzzle.ts';
import { postDailyMove } from '../src/handlers/daily-move.ts';
import { STATUS } from '../src/status.ts';
import { attemptKey, publishedDailyKey } from '../src/keys.ts';
import { levelAt, puzzleFor, replayDailyMoves, runtimeFor } from '../src/levels.ts';
import { seedLocalRegimes } from '../src/local-regime.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { asAttempt } from '../src/attempt-row.ts';
import { MAX_DAILY_MOVES } from '../src/daily-line.ts';
import { PlaySession } from 'dancing-squared-game';
import { FIXTURE_POOL_VERSION, LOCAL_SCHEDULE } from 'dancing-squared-game/schedule-fixture';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = 2;
const DAY = '2026-10-15';
const CLOCK = 1_700_000_000_000;

const devId = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;
const rowOf = (name, level = LEVEL, date = DAY) => attemptKey(devId(name), 'daily', `${level}#${date}`);

let now = CLOCK;
const depsFor = (store) => ({ store, clock: { nowMs: () => now }, identityOf: devIdentityOf });
const read = (player, level = LEVEL, date = DAY) => ({ method: 'GET', path: '/puzzle', query: { mode: 'daily', level: String(level), date }, body: null, headers: { 'x-dev-player': player } });
const move = (player, body, level = LEVEL, date = DAY) => ({
  method: 'POST',
  path: '/daily/move',
  query: {},
  body: { levelIndex: level, date, ...body },
  headers: player ? { 'x-dev-player': player } : {},
});

async function fresh() {
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const seed = LOCAL_SCHEDULE.find((entry) => entry.levelIndex === LEVEL).seed;
  await store.put(publishedDailyKey(LEVEL, DAY), { seed, levelIndex: LEVEL, poolVersion: FIXTURE_POOL_VERSION }, null);
  const generated = puzzleFor(seed, levelAt(LEVEL), 'daily');
  if (!generated.ok) throw new Error(`the probe's seed does not generate: ${generated.reason}`);
  return { store, deps: depsFor(store), puzzle: generated.puzzle, line: generated.puzzle.solution };
}

/** The moves the server actually stored for a player, or a failure if the row is unreadable. */
async function storedMoves(store, player) {
  const row = asAttempt(await store.get(rowOf(player)));
  if (!row) throw new Error('the probe could not read the attempt row it just wrote');
  return row.moves;
}

/** Post a sequence of moves, and refuse to continue if any of them did not land. */
async function play(deps, player, sequence) {
  for (const [kind, call] of sequence) {
    const posted = await postDailyMove(move(player, kind === 'add' ? { move: kind, call } : { move: kind }), deps);
    if (posted.status !== STATUS.ok) throw new Error(`the probe could not record ${kind}: ${posted.status} ${posted.body.error?.code}`);
  }
}

/**
 * The session a client would hold after playing `sequence` — the real `PlaySession`, the class the app uses.
 *
 * IT IS THE INDEPENDENT SIDE OF THE COMPARISON: the server's derivation starts from the STORED log, this starts from
 * the kinds the probe posted, and the two meet only if the storage was faithful.
 */
function clientSession(puzzle, sequence) {
  const session = new PlaySession(puzzle, runtimeFor(levelAt(LEVEL)).applier);
  for (const [kind, call] of sequence) {
    if (kind === 'add') session.play(call);
    else if (kind === 'undo') session.undo();
    else session.redo();
  }
  return session;
}

/** The line that session holds. */
function clientLine(puzzle, sequence) {
  return clientSession(puzzle, sequence).moves;
}

console.log("== 1. a move is recorded against the challenge that was READ, by the SERVER's clock ==");
{
  const { store, deps, line } = await fresh();
  // A CHALLENGE NOBODY READ HAS NOWHERE TO PUT A MOVE, which is A21's rule rather than this endpoint's caution: the
  // attempt row is created by the player's identified read of the challenge.
  const unread = await postDailyMove(move('m1', { move: 'add', call: line[0] }), deps);
  check(unread.status === STATUS.conflict && unread.body.error.code === 'no_attempt_row', `a move on a challenge nobody read is refused (${unread.status} ${unread.body.error?.code})`);
  check((await store.get(rowOf('m1'))) === null, 'and nothing was written for the refusal');

  await getPuzzle(read('m1'), deps);
  now += 3000;
  const posted = await postDailyMove(move('m1', { move: 'add', call: line[0] }), deps);
  check(posted.status === STATUS.ok && posted.body.recorded === 1, `a move is recorded (${posted.status}, recorded ${posted.body.recorded})`);
  const moves = await storedMoves(store, 'm1');
  check(moves.length === 1 && moves[0].call === line[0], `with the call the player made (${moves[0]?.call})`);
  // THE STAMP IS THE SERVER'S ARRIVAL TIME: the request carries no `atMs` at all, so a client cannot choose it.
  check(moves[0].atMs === CLOCK + 3000, `stamped by the server, after the read (${moves[0].atMs - CLOCK} ms)`);
  const row = asAttempt(await store.get(rowOf('m1')));
  check(row.startedAtMs === CLOCK, 'and the start stamp the clock is measured from is untouched — one item holds both writers');

  // AN UNDO NAMES NO CALL, and a call sent with one is ignored rather than stored: the log's undo has nothing to name.
  await postDailyMove(move('m1', { move: 'undo', call: 'Boys Run' }), deps);
  const afterUndo = await storedMoves(store, 'm1');
  check(afterUndo.length === 2 && afterUndo[1].kind === 'undo' && afterUndo[1].call === null, `an undo is recorded as an undo, with no call of its own (${JSON.stringify(afterUndo[1])})`);

  const anon = await postDailyMove({ ...move(null, { move: 'add', call: line[0] }), headers: {} }, deps);
  check(anon.status === STATUS.unauthenticated, `and a move with no identity is a 401 (${anon.status})`);
  for (const [body, why] of [[{ move: 'sideways' }, 'a move that is not one'], [{ move: 'add' }, 'an add with no call'], [{ move: 'add', call: 'x'.repeat(200) }, 'a call longer than a name']]) {
    const answer = await postDailyMove(move('m1', body), deps);
    check(answer.status === STATUS.badRequest, `${why} is refused (${answer.status} ${answer.body.error?.code})`);
  }
  const badLevel = await postDailyMove(move('m1', { move: 'undo' }, 0), deps);
  check(badLevel.status === STATUS.badRequest && badLevel.body.error.code === 'bad_level', `and a level that is not one (${badLevel.body.error?.code})`);
}

console.log("\n== 2. the line the moves DERIVE is the line the client's own session derives ==");
{
  const { store, deps, puzzle, line } = await fresh();
  await getPuzzle(read('m2'), deps);
  check(line.length >= 2, `the probe's challenge has a multi-call solution, so an undo has something to take back (${line.length} calls)`);

  const played = [['add', line[0]], ['add', line[1]], ['undo', null], ['redo', null]];
  await play(deps, 'm2', played);
  const afterRedo = replayDailyMoves(levelAt(LEVEL), puzzle, await storedMoves(store, 'm2'));
  check(
    JSON.stringify(afterRedo) === JSON.stringify(clientLine(puzzle, played)),
    `add, add, undo, redo leaves the line the client holds (${JSON.stringify(afterRedo)})`,
  );
  check(afterRedo.length === 2, `and it is the whole line back, so the redo restored what the undo took (${JSON.stringify(afterRedo)})`);

  // A LEGAL ADD AFTER AN UNDO TRUNCATES THE REDO BRANCH — `PlaySession.play`'s own rule, which is why the derivation
  // is that class rather than arithmetic written out here. It runs on a FRESH PLAYER, so the log is exactly the
  // sequence this check means. MEASURED, and this is what the first version got wrong twice: appending to the
  // sequence above tested the board its final REDO left (the whole line back), and using the solution's own first
  // call as the add was an ILLEGAL move from the board an undo leaves — and `play` refuses an illegal call BEFORE it
  // clears the branch, so the check passed while exercising nothing. The call is therefore taken from what the
  // client's session OFFERS at that board.
  await getPuzzle(read('m4'), deps);
  const prefix = [['add', line[0]], ['add', line[1]], ['undo', null]];
  const offered = clientSession(puzzle, prefix).offered()[0]?.call;
  check(typeof offered === 'string', `the board an undo leaves has a call to play (${offered})`);
  const truncating = [...prefix, ['add', offered]];
  await play(deps, 'm4', truncating);
  const derived = replayDailyMoves(levelAt(LEVEL), puzzle, await storedMoves(store, 'm4'));
  check(
    JSON.stringify(derived) === JSON.stringify(clientLine(puzzle, truncating)),
    `an add after an undo gives the line the client holds (${JSON.stringify(derived)})`,
  );
  // AND A REDO NOW DOES NOTHING ON EITHER SIDE, which is the branch being gone. IF THE TRUNCATION WERE MISSING the
  // server's replay would push the taken-back call a second time and this comparison would fail — the derivation is
  // compared with the CLASS driven over the same sequence, not with a line written out here.
  const redoing = [...truncating, ['redo', null]];
  await play(deps, 'm4', [['redo', null]]);
  check(
    JSON.stringify(replayDailyMoves(levelAt(LEVEL), puzzle, await storedMoves(store, 'm4'))) === JSON.stringify(clientLine(puzzle, redoing)),
    `and a redo after it does nothing, because the branch is gone (${JSON.stringify(clientLine(puzzle, redoing))})`,
  );
  check(clientLine(puzzle, redoing).length === clientLine(puzzle, truncating).length, `with no call restored by it (${clientLine(puzzle, redoing).length} calls)`);

  // AN ILLEGAL CALL NEVER ENTERS THE LINE: the recorder does not judge, so it IS stored — and the replay drops it,
  // because `PlaySession.play` refuses an illegal call without pushing. That is what stops a log from containing a
  // move no board could produce.
  const withIllegal = [...redoing, ['add', 'Not A Call At All']];
  await play(deps, 'm4', [['add', 'Not A Call At All']]);
  const stored = await storedMoves(store, 'm4');
  check(stored.length === withIllegal.length, `the illegal call IS in the log (${stored.length} moves, last ${stored[stored.length - 1].kind})`);
  check(
    JSON.stringify(replayDailyMoves(levelAt(LEVEL), puzzle, stored)) === JSON.stringify(clientLine(puzzle, withIllegal)),
    'and the replay derives the same line the client would, so it never entered the line',
  );
}

console.log('\n== 3. the log is BOUNDED, because a client writes it ==');
{
  const { deps } = await fresh();
  await getPuzzle(read('m3'), deps);
  // UNDOS ARE FREE (§9) and need no allowance, so they are what makes the bound reachable at all: a log can only be
  // filled to the bound by a player undoing, since the adds are capped by the puzzle's own allowance.
  for (let index = 0; index < MAX_DAILY_MOVES; index++) {
    const posted = await postDailyMove(move('m3', { move: 'undo' }), deps);
    if (posted.status !== STATUS.ok) throw new Error(`the probe could not fill the log: ${posted.status} at ${index}`);
  }
  const full = await postDailyMove(move('m3', { move: 'undo' }), deps);
  check(full.status === STATUS.conflict && full.body.error.code === 'move_log_full', `the ${MAX_DAILY_MOVES + 1}th move is refused (${full.status} ${full.body.error?.code})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
