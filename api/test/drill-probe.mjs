// THE SERVING-SIDE RULES, pinned: which drill a player is on, what locks it, what advancing means, and who is
// allowed to ask.
//
// WHY THIS IS A GATE. DESIGN.md 14 calls these rules "the new fairness surface", because they are the client's
// opposite: the client's copy of the puzzle is a convenience, and the server's order is what every player at a
// level shares. Three of them are decisions rather than plumbing — the order is not the player's to choose, a
// drill is locked when it is issued, and an advance finishes the drill that was ISSUED rather than the next
// one — and each is measured here against the plausible wrong rule, driven through the same inputs.
//
// THE PROBE DRIVES THE HANDLERS, NOT A MOCK OF THEM. The store is the in-memory twin the dev server boots
// with (same CAS protocol as the DynamoDB adapter will implement), the clock is a fixed number, and the last
// section starts a real server on an ephemeral port and speaks HTTP to it — so identity, routing, JSON and
// status codes are measured rather than assumed.
//
// Usage: node api/test/drill-probe.mjs
import { drillAdvance, drillCurrent } from '../src/handlers/drill.ts';
import { STATUS } from '../src/status.ts';
import { currentDrill, drillId, emptyProgress, finishDrill, nextIndex, parseDrillId } from '../src/drill-regime.ts';
import { LOCAL_SCHEDULE_VERSION, localRegimes, putRegime, seedLocalRegimes } from '../src/local-regime.ts';
import { ladderKey, progressKey } from '../src/keys.ts';
import { FIRST_LEVEL, asLadderItem, asLadderLevel } from '../src/ladder.ts';
import { levelAt, puzzleFor } from '../src/levels.ts';
import { startDevServer } from '../src/dev-server.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { FIXTURE_POOL_VERSION, LOCAL_SCHEDULE } from 'dancing-squared-game/schedule-fixture';
import { LEVEL_SIZE, MAIN_POOL, levelSpec } from 'dancing-squared-game';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = 1;
/** The level-1 seeds of the local fixture, in the order the regime serves them. */
const SEEDS = LOCAL_SCHEDULE.filter((entry) => entry.levelIndex === LEVEL).map((entry) => entry.seed);
const CLOCK = 1_700_000_000_000;

/**
 * THE IDENTITY ADAPTER IS IMPORTED, NOT RE-SPELLED. What "a header names a player" means is `devIdentityOf`'s
 * business; a probe with its own copy of that rule keeps passing after the adapter changes, and the id it writes
 * a fixture row under would silently stop matching the id the handler uses.
 */
const depsFor = (store, nowMs = CLOCK) => ({
  store,
  clock: { nowMs: () => nowMs },
  identityOf: devIdentityOf,
});
/** The player id the dev adapter gives a name, so a probe's key is the handler's key. */
const devId = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;
const progressRow = (name, level = LEVEL) => progressKey(devId(name), level);

const get = (player, level = LEVEL) => ({
  method: 'GET',
  path: '/drill/current',
  query: { level: String(level) },
  body: null,
  headers: player ? { 'x-dev-player': player } : {},
});

const advance = (player, id) => ({
  method: 'POST',
  path: '/drill/advance',
  query: {},
  body: { drillId: id },
  headers: player ? { 'x-dev-player': player } : {},
});

/** A store that counts writes and can lose a compare-and-set on purpose, for the contention checks. */
const spy = (inner, lose = 0) => {
  // READS ARE COUNTED PER KEY, not in total: a request reads the schedule row as well as the player's progress,
  // so a bare total would report three reads for a two-attempt retry and look like an extra attempt.
  const state = { writes: 0, reads: 0, losses: 0, readsByPk: {} };
  return {
    state,
    store: {
      get: (key) => {
        state.reads++;
        state.readsByPk[key.pk] = (state.readsByPk[key.pk] ?? 0) + 1;
        return inner.get(key);
      },
      put: (key, value, expectedRev) => {
        if (state.losses < lose) {
          state.losses++;
          return Promise.resolve(false);
        }
        state.writes++;
        return inner.put(key, value, expectedRev);
      },
      // FORWARDED SO THE PROXY IS STILL A STORE: a port has more than the two methods the drill endpoints use,
      // and a wrapper that dropped one would be a store that throws the first time a handler reached for it.
      transact: (writes) => inner.transact(writes),
    },
  };
};

console.log('== 1. the regime is served in order, and an issued drill is LOCKED ==');
{
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const deps = depsFor(store);
  const first = await drillCurrent(get('p1'), deps);
  const drill = first.body.drill;
  check(first.status === STATUS.ok, `the first request is answered (${first.status})`);
  check(drill.id === drillId(LEVEL, 0) && drill.seed === SEEDS[0], `the first entry of the regime is served first (${drill.id}, seed ${drill.seed})`);
  check(drill.resumed === false && drill.index === 0, 'and it is reported as newly issued rather than resumed');
  // THE LEVEL TRAVELS WITH THE DRILL, which §11's row promises and which a client needs: the schedule can move
  // under a player, and the response's level — not the one the client asked with — is the one to generate from.
  check(drill.levelIndex === LEVEL, `and it names the level it was issued at (${drill.levelIndex})`);
  check(first.body.regime.finished === 0 && first.body.regime.length === SEEDS.length, `the regime reports 0 of ${SEEDS.length} finished`);

  const again = await drillCurrent(get('p1'), deps);
  check(again.body.drill.id === drill.id && again.body.drill.seed === drill.seed, 'asking again returns the same drill');
  check(again.body.drill.issuedAtMs === drill.issuedAtMs, `with the same issue time (${again.body.drill.issuedAtMs})`);
  check(again.body.drill.resumed === true, 'and it says so, because that is what a client shows the player');

  // THE READ OF A LOCKED DRILL DOES NOT WRITE. MEASURED by counting the writes the whole sequence performs:
  // the issue is one write, and every further read is none — so a reload is not a compare-and-set race.
  const counted = spy(store);
  const countingDeps = depsFor(counted.store);
  await drillCurrent(get('p1'), countingDeps);
  check(counted.state.writes === 0, `a resumed drill performs NO write (${counted.state.writes}) while an issue performs one — see the check below`);
  const fresh = spy(new MemoryStore());
  await seedLocalRegimes(fresh.store);
  const issueWrites = spy(fresh.store);
  await drillCurrent(get('p1'), depsFor(issueWrites.store, CLOCK + 5000));
  check(issueWrites.state.writes === 1, `while issuing a drill performs exactly one (${issueWrites.state.writes})`);

  const advanced = await drillAdvance(advance('p1', drill.id), deps);
  check(advanced.status === STATUS.ok && advanced.body.regime.finished === 1, `advancing it leaves 1 of ${SEEDS.length} finished (${advanced.body.regime?.finished})`);
  const next = await drillCurrent(get('p1'), deps);
  check(next.body.drill.id === drillId(LEVEL, 1) && next.body.drill.seed === SEEDS[1], `and the NEXT entry is served (${next.body.drill.id}, seed ${next.body.drill.seed})`);
  check(next.body.drill.issuedAtMs === CLOCK, 'issued at the clock the request was served at');
}

console.log('\n== 2. a republished schedule cannot rewrite a drill already handed out ==');
{
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const deps = depsFor(store);
  const issued = (await drillCurrent(get('p2'), deps)).body.drill;
  // NEGATIVE CONTROL, MEASURED: the wrong rule reads the seed back out of the schedule. Republishing the same
  // level with all-new seeds makes the two rules answer differently on the SAME request — the real one serves
  // `issued.seed`, the wrong one serves 900 — so this pair of checks is what catches it, and the "asking again
  // returns the same drill" checks in section 1 pass under both rules (nothing had changed there).
  const republished = localRegimes().find((regime) => regime.entries[0].levelIndex === LEVEL);
  await putRegime(store, LEVEL, {
    scheduleVersion: `${LOCAL_SCHEDULE_VERSION}#republished`,
    entries: republished.entries.map((entry, index) => ({ ...entry, seed: 900 + index })),
  });
  const after = (await drillCurrent(get('p2'), deps)).body.drill;
  check(after.seed === issued.seed, `the issued drill keeps its own seed across a republish (${after.seed}, where the schedule now says 900)`);
  check(after.id === issued.id && after.issuedAtMs === issued.issuedAtMs, 'and it is still the same issued drill, not a re-issue');
  check(after.resumed === true, 'and it is reported as resumed');
}

console.log('\n== 3. an advance finishes the drill that was ISSUED, not the next one ==');
{
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const deps = depsFor(store);
  for (const [step, expected] of [[0, 0], [1, 1]]) {
    const drill = (await drillCurrent(get('p3'), deps)).body.drill;
    check(drill.index === expected, `step ${step + 1}: the player is on entry ${expected} (${drill.id})`);
    await drillAdvance(advance('p3', drill.id), deps);
  }
  const third = (await drillCurrent(get('p3'), deps)).body.drill;
  check(third.index === 2, `and then on entry 2 (${third.id})`);
  await drillAdvance(advance('p3', third.id), deps);
  const repeat = await drillAdvance(advance('p3', third.id), deps);
  check(repeat.status === STATUS.conflict && repeat.body.error.code === 'stale_drill', `a REPEATED advance is refused (${repeat.status} ${repeat.body.error?.code})`);
  const after = (await drillCurrent(get('p3'), deps)).body;
  check(after.regime.finished === 3, `and nothing changed: 3 of ${SEEDS.length} finished (${after.regime.finished})`);
  check(after.drill.id === drillId(LEVEL, 3), `so the player is on the next drill, entry 3 (${after.drill.id})`);

  // NEGATIVE CONTROL, MEASURED: "finish the first unfinished entry" is the plausible wrong rule, and it is
  // RIGHT for the first advance and wrong for every repeat of it. Driven through the same inputs — a player
  // with entries 0 and 1 finished and entry 2 issued — the real rule finishes 3 and refuses the repeat, while
  // the wrong rule finishes entry 3 as well: FOUR finished with THREE played, which is a drill nobody saw.
  const regime = localRegimes().find((r) => r.entries[0].levelIndex === LEVEL);
  const progress = {
    levelIndex: LEVEL,
    issued: { id: drillId(LEVEL, 2), index: 2, seed: SEEDS[2], poolVersion: FIXTURE_POOL_VERSION, issuedAtMs: CLOCK },
    finished: [0, 1],
  };
  const wrongOnce = (row) => ({ ...row, issued: null, finished: [...row.finished, nextIndex(regime, row.finished)].sort((a, b) => a - b) });
  check(wrongOnce(wrongOnce(progress)).finished.length === 4, `NEGATIVE CONTROL: the wrong rule reaches 4 finished after the repeat (${wrongOnce(wrongOnce(progress)).finished.length})`);
  const once = finishDrill(progress, drillId(LEVEL, 2));
  const twice = once.kind === 'done' ? finishDrill(once.progress, drillId(LEVEL, 2)) : once;
  check(once.kind === 'done' && once.progress.finished.length === 3, `where the real rule finishes 3 (${once.progress?.finished.length})`);
  check(twice.kind === 'refused', 'and refuses the repeat rather than finishing anything else');
}

console.log('\n== 4. a drill whose pool has moved is RE-ISSUED, not served ==');
{
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const deps = depsFor(store, CLOCK + 60_000);
  // A row written by an older build: the same level and index, a seed validated against a pool this build does
  // not have. A seed is only meaningful against the pool it was generated at (DESIGN.md 7.2). `scheduleVersion` is
  // the SET the row names — a field the strict reader requires, so a fixture row without one is a different test
  // (an unreadable row) rather than this one.
  const stale = {
    levelIndex: LEVEL,
    issued: { id: drillId(LEVEL, 0), index: 0, seed: 7, poolVersion: 'ms-0', scheduleVersion: LOCAL_SCHEDULE_VERSION, issuedAtMs: CLOCK - 90_000 },
    finished: [],
  };
  await store.put(progressRow('p4', LEVEL), stale, null);
  const served = (await drillCurrent(get('p4'), deps)).body.drill;
  check(served.seed === SEEDS[0] && served.poolVersion === MAIN_POOL.version, `the seed comes from the current schedule (${served.seed}, pool ${served.poolVersion})`);
  check(served.issuedAtMs === CLOCK + 60_000, `and it was issued now rather than carried over (${served.issuedAtMs})`);
  // NEGATIVE CONTROL, MEASURED WITHOUT A SECOND IMPLEMENTATION: dropping the pool comparison from the lock
  // test is EXACTLY "the row's own pool version is the current one", so calling the rule with the row's version
  // demonstrates the wrong answer on the same row — the stale seed served, unchanged, as if it were playable.
  const wrong = currentDrill(localRegimes().find((r) => r.entries[0].levelIndex === LEVEL), LEVEL, stale, 'ms-0', CLOCK + 60_000);
  check(wrong.kind === 'drill' && wrong.changed === false && wrong.drill.seed === 7, `NEGATIVE CONTROL: without the pool check the stale seed is served unchanged (${wrong.drill?.seed})`);
}

console.log('\n== 5. a finished regime is COMPLETE, and does not wrap ==');
{
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const deps = depsFor(store);
  for (let index = 0; index < SEEDS.length; index++) {
    const drill = (await drillCurrent(get('p5'), deps)).body.drill;
    await drillAdvance(advance('p5', drill.id), deps);
  }
  const done = await drillCurrent(get('p5'), deps);
  check(done.status === STATUS.ok, `the request is still answered (${done.status})`);
  check(done.body.drill === null, 'with no drill rather than the first entry again');
  check(done.body.regime.finished === SEEDS.length && done.body.regime.length === SEEDS.length, `and ${SEEDS.length} of ${SEEDS.length} reported finished`);
  // NEGATIVE CONTROL: the local FIXTURE wraps (`scheduleEntryFor` modulo), deliberately, so a demo never shows
  // an empty screen. A server that wrapped would re-serve a season the score table already holds, which is why
  // the two rules differ — MEASURED here by the fact that entry 0 has a seed at all to wrap to.
  check(localRegimes().find((r) => r.entries[0].levelIndex === LEVEL).entries.length === SEEDS.length, 'NEGATIVE CONTROL: the fixture has an entry to wrap to, and the server does not use it');
}

console.log('\n== 6. the payload carries the puzzle, and it is the server\'s own ==');
{
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const deps = depsFor(store);
  const drill = (await drillCurrent(get('p6'), deps)).body.drill;
  const level = levelAt(LEVEL);
  const generated = puzzleFor(drill.seed, level, 'drill');
  check(generated.ok, `the served seed generates for this level (${generated.ok})`);
  // THE WHOLE PUZZLE, BYTE FOR BYTE THE ONE THE SERVER SCORES AGAINST. This is the property that replaced the
  // option labels: the client draws what the server will score, so `POST /drill/answer` and `POST /runs` cannot
  // be measuring a different question from the one on screen.
  check(JSON.stringify(drill.puzzle) === JSON.stringify(generated.puzzle), `the drill carries the puzzle the same seed generates, exactly (${drill.puzzle?.steps?.length} step(s))`);
  // NEGATIVE CONTROL, MEASURED: a payload that ignored the seed would satisfy nothing above — so assert the seed
  // DECIDES, by comparing with the puzzle a neighbouring seed produces. Without this, a server that returned one
  // fixed puzzle for every drill would pass the equality check only if the generator were fixed too.
  const other = puzzleFor(drill.seed + 1, level, 'drill');
  check(other.ok && JSON.stringify(other.puzzle) !== JSON.stringify(drill.puzzle), `NEGATIVE CONTROL: a different seed is a different puzzle (${drill.seed} vs ${drill.seed + 1})`);
  check(drill.puzzle.steps.length === level.depth, `and it has the level's ${level.depth} step(s)`);
  // THE WIRE IS JSON, AND JSON DROPS `undefined`. Every optional field on a dancer and on a board is one, so the
  // only copy of this puzzle a client will ever hold is a round-tripped one. This asserts what the WIRE can
  // promise: the step's `after` and its correct option's board travel as the same bytes. Whether the engine still
  // calls them the same board after the round trip is the CLIENT's gate, where the engine is a dependency —
  // `game/test/puzzle-wire-probe.mjs` measures that half with the engine's own `sameBoardById`.
  const wired = JSON.parse(JSON.stringify(drill.puzzle));
  check(
    wired.steps.every((step) => JSON.stringify(step.after) === JSON.stringify(step.moves[step.correctIndex].board)),
    'and every step\'s `after` is byte-identical to the board its correct option reaches, so the wire carries one board twice rather than two claims',
  );
  check(wired.steps.every((step) => step.moves.length === level.optionCount && step.correctIndex < step.moves.length), `with ${level.optionCount} options per step and an index inside them`);
}

console.log('\n== 7. refusals: what is refused, and what a refusal changes ==');
{
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const deps = depsFor(store);

  // THE READ IS A DEMO, NOT A REFUSAL, AND IT IS THE POSITIVE FORM OF THE SAME CHECK: the drill is served, no
  // Progress row is written for a caller the server cannot name, and the body says which of the two it is
  // (DESIGN.md 11.1 A20). The old check here asserted a 401 and had to be rewritten when the demo landed — which
  // is the check doing its job.
  const anonymous = await drillCurrent(get(null), deps);
  check(anonymous.status === STATUS.ok && anonymous.body.demo === true, `a request with no player id is served as a demo (${anonymous.status}, demo=${anonymous.body.demo})`);
  check((await store.get(progressRow('p7', LEVEL))) === null, 'and it wrote NO progress row, because there is no player to key one on');

  // A DEMO HAS NO LADDER, SO IT STILL CHOOSES ITS LEVEL — and that is the ONLY path on which the query's level is
  // read at all, because the server owns a PLAYER's level (§15 Q17(vi)). The refusal for a malformed one
  // therefore lives on this path now, and the check below its other half is what pins the difference.
  for (const [query, why] of [[{ level: 'x' }, 'not a number'], [{ level: '0' }, 'zero'], [{}, 'absent']]) {
    const answer = await drillCurrent({ ...get(null), query }, deps);
    check(answer.status === STATUS.badRequest && answer.body.error.code === 'bad_level', `a demo's level ${why} is a 400 (${answer.status} ${answer.body.error?.code})`);
  }

  // THE TWO IDENTITIES, ONE INPUT, TWO ANSWERS: level 900 is a level of the ladder with no published regime, so a
  // demo asking for it is refused by the SCHEDULE — while an identified player asking for it is served the level
  // their LADDER row names, because for them the query is not consulted. MEASURED: the old check asserted the 404
  // for an identified caller, which is the rule this change replaces.
  const unpublished = await drillCurrent(get(null, 900), deps);
  check(unpublished.status === STATUS.notFound && unpublished.body.error.code === 'no_schedule', `a demo's unpublished level is a 404 no_schedule (${unpublished.status} ${unpublished.body.error?.code})`);
  check(levelSpec(900) !== null, `NEGATIVE CONTROL: level 900 IS a level of the ladder (${JSON.stringify(levelSpec(900))})`);
  // `p11` AND NOT `p7`, because this request ISSUES a drill and the section below depends on p7 having none in
  // flight — MEASURED while writing it: sharing the player made "advancing a drill nobody issued" succeed and made
  // the corrupt-row fixture fail to write (its `expectedRev: null` no longer held), which read as three unrelated
  // failures two screens away.
  const ignored = await drillCurrent(get('p11', 900), deps);
  check(ignored.status === STATUS.ok && ignored.body.drill.levelIndex === LEVEL, `and an IDENTIFIED caller asking for it is served their ladder level instead (${ignored.status}, level ${ignored.body.drill?.levelIndex})`);

  for (const [body, why] of [[null, 'a null body'], [{}, 'no drillId'], [{ drillId: 7 }, 'a number'], [{ drillId: 'x' }, 'not an id']]) {
    const answer = await drillAdvance({ ...advance('p7', ''), body }, deps);
    check(answer.status === STATUS.badRequest, `advance with ${why} is a 400 (${answer.status})`);
  }
  const noFlight = await drillAdvance(advance('p7', drillId(LEVEL, 0)), deps);
  check(noFlight.status === STATUS.conflict && noFlight.body.error.code === 'stale_drill', `advancing a drill nobody issued is a 409 stale_drill (${noFlight.status} ${noFlight.body.error?.code})`);

  // A ROW THIS BUILD CANNOT READ IS REFUSED RATHER THAN SILENTLY EMPTIED — the alternative would reset a
  // player's progress and look like it had never been written. MEASURED on both sides of the line: the
  // refusal, and the row still being there with its revision untouched.
  const corrupt = progressRow('p7', LEVEL);
  await store.put(corrupt, { levelIndex: LEVEL, finished: ['zero'], issued: null }, null);
  const before = await store.get(corrupt);
  const answer = await drillCurrent(get('p7'), deps);
  const after = await store.get(corrupt);
  check(answer.status === STATUS.unavailable && answer.body.error.code === 'unreadable_progress', `an unreadable progress row is a 503 (${answer.status} ${answer.body.error?.code})`);
  check(after.rev === before.rev && JSON.stringify(after.value) === JSON.stringify(before.value), 'and the refusal WROTE NOTHING to the row');
  check(JSON.stringify(after.value.finished) === '["zero"]', `NEGATIVE CONTROL: the bad row is still there, not replaced by an empty progress (${JSON.stringify(after.value.finished)})`);
}

console.log('\n== 8. two requests cannot issue two drills, and a lost race retries ==');
{
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const deps = depsFor(store);
  const [a, b] = await Promise.all([drillCurrent(get('p8'), deps), drillCurrent(get('p8'), deps)]);
  check(a.status === STATUS.ok && b.status === STATUS.ok, `both concurrent requests are answered (${a.status}, ${b.status})`);
  check(a.body.drill.id === b.body.drill.id && a.body.drill.issuedAtMs === b.body.drill.issuedAtMs, `and they agree on ONE issued drill (${a.body.drill.id}, ${a.body.drill.issuedAtMs})`);
  check((await store.get(progressRow('p8', LEVEL))).value.issued.id === a.body.drill.id, 'and the stored row holds exactly that one');

  // A LOST COMPARE-AND-SET IS RETRIED, not surfaced: the store below refuses the first write, which is what
  // another writer moving first looks like, and the player still gets a drill. THE SEEDING GOES STRAIGHT TO
  // THE INNER STORE AND THE SPY IS WRAPPED AFTERWARDS, because a spy that eats a write would eat the seeding
  // write instead of the one under test — MEASURED while writing this: the first version of this check passed
  // with the loss consumed by `seedLocalRegimes`, so it was measuring nothing.
  const contendedInner = new MemoryStore();
  await seedLocalRegimes(contendedInner);
  const contended = spy(contendedInner, 1);
  const retried = await drillCurrent(get('p9'), depsFor(contended.store));
  check(retried.status === STATUS.ok && retried.body.drill !== null, `a lost race is retried and still answered (${retried.status})`);
  // THE KEY COMES FROM `progressRow`, NOT FROM A STRING LITERAL, and this check is why: the row's key carries the
  // identity namespace, so a literal `progress#p9` silently counted zero reads and the check read as a retry that
  // never happened (MEASURED: `0 reads of it, 1 loss`).
  //
  // THE COUNT IS THREE AND THE EXTRA READ IS THE LADDER'S, not a second retry: `servableLevel` reads this row to
  // ask whether the block is full (`ladder.ts`), `withProgress` reads it to decide, and the lost compare-and-set
  // makes `withProgress` read it once more. What the check pins is the LAST of those — a loss costs exactly one
  // extra read of the row it lost on — so the number is stated with its breakdown rather than as a bare 2.
  const progressReads = contended.state.readsByPk[progressRow('p9').pk] ?? 0;
  check(contended.state.losses === 1 && progressReads === 3, `and the progress row was read again after losing (${progressReads} reads of it: the ladder's, the decision's, and the re-read; ${contended.state.losses} loss)`);

  // AND A ROW THAT KEEPS LOSING IS REPORTED RATHER THAN LOOPED ON: three attempts, then a 409.
  const hopelessInner = new MemoryStore();
  await seedLocalRegimes(hopelessInner);
  const hopeless = spy(hopelessInner, 99);
  const gaveUp = await drillCurrent(get('p10'), depsFor(hopeless.store));
  check(gaveUp.status === STATUS.conflict && gaveUp.body.error.code === 'contended', `a writer that never lands is reported as contended (${gaveUp.status} ${gaveUp.body.error?.code})`);
  check(hopeless.state.losses === 3, `after exactly MAX_WRITE_ATTEMPTS attempts (${hopeless.state.losses})`);
}

console.log('\n== 9. the local server, over a real socket ==');
{
  // THE MODE IS NAMED RATHER THAN INHERITED: a probe that took the default would be testing a different mode the
  // day the default changed, and this section is about the `dev` adapter's two spellings.
  const server = await startDevServer({ port: 0, auth: 'dev' });
  const base = `http://127.0.0.1:${server.port}`;
  const call = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, options);
    return { status: response.status, body: await response.json() };
  };
  try {
    const health = await call('/health');
    check(health.status === 200 && health.body.ok === true, `health answers (${health.status}, ${health.body.store})`);
    // THE LIST IS NOT PINNED TO A COUNT: it grows as the endpoints land, and a count here would be a check that
    // reddens when someone adds an endpoint and says nothing about whether the health answer is right. What is
    // pinned is that the routes served are named and that the gap `/health` reports is the REAL one — which is now
    // NONE, because §11's ten endpoints are all in the table (the leaderboard was the last, and this check used to
    // assert the opposite: AGENTS.md §8 trap 8).
    check(health.body.endpoints.includes('GET /drill/current') && health.body.endpoints.includes('POST /drill/advance'), `and names the routes it serves (${health.body.endpoints.join(', ')})`);
    check(health.body.endpoints.length === health.body.planned, `out of ${health.body.planned} planned, so the gap it reports is closed`);
    check(health.body.auth?.mode === 'dev', `and names the identity mode it was started in (${health.body.auth?.mode})`);

    // A SIGNED-OUT CALLER GETS THE DRILL AS A DEMO, NOT A 401 (DESIGN.md 11.1 A20 / 11.2). It is the SAME drill
    // the first identified player is about to be served, because a demo reads the regime and the order and
    // nothing else — and the body says so, which is what the client marks the run unranked with.
    const anonymous = await call('/drill/current?level=1');
    check(anonymous.status === 200 && anonymous.body.demo === true, `a request with no identity is served the drill as a demo (${anonymous.status}, demo=${anonymous.body.demo})`);
    check(anonymous.body.drill?.id === drillId(LEVEL, 0), `and it is the season's first drill, exactly as an identified player's first is (${anonymous.body.drill?.id})`);

    // THE WRITE IS WHERE THE WALL IS. The demo can read; it cannot claim anything, and this is the 401 that says so.
    const demoAdvance = await call('/drill/advance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drillId: anonymous.body.drill.id }),
    });
    check(demoAdvance.status === 401, `and a write with no identity is a 401 (${demoAdvance.status} ${demoAdvance.body.error?.code ?? ''})`);

    const headers = { 'x-dev-player': 'e2e' };
    const first = await call('/drill/current?level=1', { headers });
    check(first.status === 200 && first.body.drill.id === drillId(LEVEL, 0), `and one with an identity gets the first drill (${first.body.drill?.id})`);
    check(first.body.demo === undefined, 'with no demo flag, because this answer is a stored one');
    // THE PUZZLE SURVIVES A REAL HTTP ROUND TRIP, which is the one thing the handler-level checks above cannot
    // measure: they compare objects in one process, where the served puzzle is a reference to the generated one.
    // Here it has been through `JSON.stringify`, the socket and `JSON.parse`, so this is the payload a browser gets.
    const overTheWire = puzzleFor(first.body.drill.seed, levelAt(LEVEL), 'drill');
    check(
      overTheWire.ok && JSON.stringify(first.body.drill.puzzle) === JSON.stringify(overTheWire.puzzle),
      `the puzzle survives the socket byte for byte (${first.body.drill.puzzle?.steps?.length} step(s), ${JSON.stringify(first.body.drill.puzzle?.steps?.[0]?.moves?.map((m) => m.call))})`,
    );

    const bearer = await call('/drill/current?level=1', { headers: { authorization: 'Bearer dev:e2e' } });
    check(bearer.status === 200 && bearer.body.drill.id === first.body.drill.id, 'the bearer spelling names the same player (a browser test and a curl are the two ways in)');

    const advanced = await call('/drill/advance', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ drillId: first.body.drill.id }),
    });
    check(advanced.status === 200 && advanced.body.regime.finished === 1, `an advance over HTTP lands (${advanced.status}, ${advanced.body.regime?.finished} finished)`);

    const second = await call('/drill/current?level=1', { headers });
    check(second.body.drill.id === drillId(LEVEL, 1), `and the next request is the next drill (${second.body.drill.id})`);

    // THE BROWSER'S PREFLIGHT, MEASURED, because a page on another port is the intended local arrangement and it
    // was exactly this that failed first: a cross-origin fetch with `x-dev-player` is refused before it is sent
    // unless the preflight names that header. The negative control is the shape of the check itself — the
    // response is asked for the header it must carry, not merely for a 2xx.
    const preflight = await fetch(`${base}/drill/current?level=1`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:8089', 'access-control-request-headers': 'x-dev-player' },
    });
    check(preflight.status === 204, `a preflight is answered (${preflight.status})`);
    check((preflight.headers.get('access-control-allow-origin') ?? '') !== '', `with an origin (${preflight.headers.get('access-control-allow-origin')})`);
    check((preflight.headers.get('access-control-allow-headers') ?? '').includes('x-dev-player'), `and the identity header it must allow (${preflight.headers.get('access-control-allow-headers')})`);
    const carried = await fetch(`${base}/health`, { headers: { origin: 'http://localhost:8089' } });
    check((carried.headers.get('access-control-allow-origin') ?? '') !== '', 'and every ordinary answer carries one too, so a preflight is not the only thing that works');

    // THE DEV SERVER'S BOOT IS THE LOCAL STAND-IN FOR THE BOUNDARY JOB, and this is the measurement: a Daily exists
    // for TODAY the moment the server is up, because the in-memory store is per process and a separate publish run
    // could never reach it. The client's own `/puzzle` call is pinned in `game/test/api-client-probe.mjs`.
    const today = new Date().toISOString().slice(0, 10);
    const daily = await call(`/puzzle?mode=daily&level=1&date=${today}`, { headers });
    check(daily.status === 200 && typeof daily.body.daily?.seed === 'number', `the boot published today's Daily (${daily.body.daily?.seed} for ${today})`);
    const tomorrow = await call(`/puzzle?mode=daily&level=1&date=2099-01-01`, { headers });
    check(tomorrow.status === 404, `NEGATIVE CONTROL: and only today's, so the seeding is the boundary job's stand-in rather than a generated-on-demand answer (${tomorrow.status})`);

    const missing = await call('/nope', { headers });
    check(missing.status === 404 && missing.body.error.code === 'not_found', `an unserved path is a 404 (${missing.status})`);
  } finally {
    await server.close();
  }
  // THE PROBE'S OWN EXPECTATIONS ABOUT THE FIXTURE, so a change to it fails HERE rather than as a mystery:
  // level 1's regime is the fixture's four level-1 seeds, in order.
  check(SEEDS.length === 4 && localRegimes().length === 3, `the fixture is ${localRegimes().length} regimes of ${SEEDS.length} entries at level 1`);
  check(parseDrillId(drillId(LEVEL, 3)).index === 3, 'and a drill id round trips to its position');
  check(emptyProgress(LEVEL).issued === null, 'and a fresh progress record holds nothing');
}

console.log('\n== 10. the LADDER: the level is the player\'s, and a full block promotes ==');
{
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  const deps = depsFor(store);
  const seedsOf = (levelIndex) => LOCAL_SCHEDULE.filter((entry) => entry.levelIndex === levelIndex).map((entry) => entry.seed);
  // THE BLOCK IS `LEVEL_SIZE` CELLS, and the probe writes the finished set DIRECTLY: driving 100 drills through
  // the endpoints would measure 100 issues rather than the rule under test.
  const full = Array.from({ length: LEVEL_SIZE }, (_, index) => index);

  // AN ABSENT ROW IS THE FIRST LEVEL, and reading it must not WRITE one: a new player's first request is not a
  // compare-and-set race to record a fact that is already known.
  const fresh = await drillCurrent(get('l0'), deps);
  check(fresh.status === STATUS.ok && fresh.body.drill.levelIndex === FIRST_LEVEL, `a player with no ladder row is served level ${FIRST_LEVEL} (${fresh.body.drill?.levelIndex})`);
  check((await store.get(ladderKey(devId('l0')))) === null, 'and NO ladder row is written, because an absent row already means that level');

  // THE LADDER ROW DECIDES THE LEVEL, not the query. The same request a level-1 player sends is answered from
  // level 2 for a player whose row says 2 — which is the whole of "the server owns the player's level".
  await store.put(ladderKey(devId('l1')), asLadderItem(2), null);
  const onTwo = await drillCurrent(get('l1'), deps);
  check(onTwo.status === STATUS.ok && onTwo.body.drill.levelIndex === 2, `a ladder row at level 2 is served level 2 (${onTwo.body.drill?.levelIndex})`);
  check(onTwo.body.drill.seed === seedsOf(2)[0], `and the seed is the level-2 regime's first (${onTwo.body.drill.seed}, where level 1's is ${seedsOf(1)[0]})`);
  const asked = await drillCurrent(get('l1', 900), deps);
  check(asked.body.drill.levelIndex === 2, `and a ?level= in the query does not move it (${asked.body.drill?.levelIndex})`);

  // A FULL BLOCK PROMOTES, and the promotion is DERIVED on the read rather than written when a drill is finished:
  // finishing happens on two paths, and a second row written on either can be lost with nothing left to retry it.
  await store.put(progressRow('l2', LEVEL), { levelIndex: LEVEL, issued: null, finished: full }, null);
  const promoted = await drillCurrent(get('l2'), deps);
  check(promoted.status === STATUS.ok && promoted.body.drill.levelIndex === 2, `a full block at level 1 is promoted to level 2 (${promoted.body.drill?.levelIndex})`);
  check(promoted.body.drill.seed === seedsOf(2)[0], `and served level 2's first seed (${promoted.body.drill.seed})`);
  const rowL2 = await store.get(ladderKey(devId('l2')));
  check(rowL2?.value.levelIndex === 2, `and the ladder row now SAYS level 2, so the next request needs no promotion (${rowL2?.value.levelIndex})`);
  check(asLadderLevel(rowL2) === 2, 'which is what the reader this build serves with makes of it');
  check(promoted.body.regime.length === seedsOf(2).length, `and the regime reported is level 2's (${promoted.body.regime?.length})`);

  // NEGATIVE CONTROL: ONE CELL SHORT IS NOT A FULL BLOCK. This is the plausible wrong rule — "the regime has no
  // unfinished entry, so the level is done" — and the fixture is exactly the shape that separates them: its
  // regimes are 4 entries long, so a player can complete one without filling a 100-cell block.
  await store.put(progressRow('l3', LEVEL), { levelIndex: LEVEL, issued: null, finished: full.slice(0, LEVEL_SIZE - 1) }, null);
  const short = await drillCurrent(get('l3'), deps);
  check(short.status === STATUS.ok && short.body.drill === null, `NEGATIVE CONTROL: ${LEVEL_SIZE - 1} finished leaves the level complete rather than promoted (${short.status})`);
  check((await store.get(ladderKey(devId('l3')))) === null, 'and NO ladder row is written, so the level it says is still the first one');

  // AND THE TOP PUBLISHED LEVEL DOES NOT PROMOTE INTO NOTHING. Level 3 is the highest regime the fixture seeds, so
  // a full block there would move the player to a level with no schedule and answer `404 no_schedule` — for good,
  // because nothing moves them back. The promotion waits for the operator instead.
  await store.put(ladderKey(devId('l4')), asLadderItem(3), null);
  await store.put(progressRow('l4', 3), { levelIndex: 3, issued: null, finished: full }, null);
  const top = await drillCurrent(get('l4'), deps);
  check(top.status === STATUS.ok && top.body.drill === null, `a full block at the top published level is not promoted into no schedule (${top.status} ${top.body.drill === null ? 'complete' : top.body.drill?.levelIndex})`);
  check((await store.get(ladderKey(devId('l4')))).value.levelIndex === 3, 'and its ladder row is untouched, so the promotion lands the moment level 4 is published');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
