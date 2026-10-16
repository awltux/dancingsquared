// THAT A REFUSAL IS RECORDED, and that an accepted run is not (DESIGN.md 11.1, A25).
//
// WHY THIS IS A GATE. `abuse#<playerId>` is the operator's only signal that someone is probing: the run row keeps
// what was measured against what was claimed for the runs that LAND, and a refused submission has no run row at
// all. A counter that is incremented in the wrong place — or not at all, which is what happens when it is wired at
// twelve separate `return failure(...)` sites — is an instrument that reads zero, and AGENTS.md §4.1 says an
// instrument's silence is itself a bug.
//
// Usage: node api/test/abuse-probe.mjs
import { drillCurrent } from '../src/handlers/drill.ts';
import { postDrillAnswer } from '../src/handlers/answer.ts';
import { postRun } from '../src/handlers/runs.ts';
import { STATUS } from '../src/status.ts';
import { abuseKey } from '../src/keys.ts';
import { levelAt, puzzleFor } from '../src/levels.ts';
import { seedLocalRegimes } from '../src/local-regime.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { devIdentityOf } from '../src/auth/identity.ts';
import { asAbuse, countRefusal, MAX_COUNT_PER_CODE, MAX_TRACKED_CODES } from '../src/abuse.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const LEVEL = 1;
const CLOCK = 1_700_000_000_000;
const devId = (name) => devIdentityOf({ headers: { 'x-dev-player': name } }).playerId;

let now = CLOCK;
const depsFor = (store) => ({ store, clock: { nowMs: () => now }, identityOf: devIdentityOf });
const get = (player) => ({ method: 'GET', path: '/drill/current', query: { level: String(LEVEL) }, body: null, headers: { 'x-dev-player': player } });
const press = (player, drillId, step, call) => ({ method: 'POST', path: '/drill/answer', query: {}, body: { drillId, step, call }, headers: { 'x-dev-player': player } });
const submit = (player, body) => ({ method: 'POST', path: '/runs', query: {}, body, headers: { 'x-dev-player': player } });

async function fresh() {
  const store = new MemoryStore();
  await seedLocalRegimes(store);
  return { store, deps: depsFor(store) };
}

/** The drill this player is on, with its correct calls and the recorded presses a submission needs. */
async function issue(deps, player) {
  const served = await drillCurrent(get(player), deps);
  const drill = served.body.drill;
  const generated = puzzleFor(drill.seed, levelAt(LEVEL));
  if (!generated.ok) throw new Error(`the probe's seed does not generate: ${generated.reason}`);
  const correct = generated.puzzle.steps.map((step) => step.moves[step.correctIndex].call);
  for (let step = 0; step < correct.length; step++) await postDrillAnswer(press(player, drill.id, step, correct[step]), deps);
  return { drill, correct, puzzle: generated.puzzle };
}

const counted = async (store, player) => asAbuse(await store.get(abuseKey(devId(player))));

console.log('== 1. a refused run is counted, by the code the API answered with ==');
{
  const { store, deps } = await fresh();
  check((await counted(store, 'a1')).total === 0, 'a player who has been refused nothing has no refusals');

  // A TRANSCRIPT THE SERVER CANNOT VERIFY, refused for a code of its own: the drill IS in flight (so the transcript
  // check passes) and NO press was recorded, which is `no_press_log` — the refusal that says the count cannot be
  // made. MEASURED while writing this: submitting against a drill nobody issued answers `stale_drill` first, so the
  // setup here is an issued drill with an empty log.
  const served = await drillCurrent(get('a1'), deps);
  const drill = served.body.drill;
  const generated = puzzleFor(drill.seed, levelAt(LEVEL));
  if (!generated.ok) throw new Error(`the probe's seed does not generate: ${generated.reason}`);
  const correct = generated.puzzle.steps.map((step) => step.moves[step.correctIndex].call);
  now += 1000;
  const refused = await postRun(submit('a1', { runId: 'r-1', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls: correct }), deps);
  check(refused.status === STATUS.conflict && refused.body.error.code === 'no_press_log', `a run with no recorded presses is refused (${refused.status} ${refused.body.error?.code})`);
  const first = await counted(store, 'a1');
  check(first.total === 1 && first.codes.length === 1 && first.codes[0].code === 'no_press_log' && first.codes[0].count === 1, `and the refusal is counted under that code (${JSON.stringify(first.codes)})`);
  check(first.lastAtMs === CLOCK + 1000, `with the SERVER's clock on the tally (${first.lastAtMs})`);

  // A SECOND REFUSAL, FOR A DIFFERENT REASON: a transcript that is not the puzzle's answer, which is refused before
  // the log is even read.
  now += 1000;
  const wrongLine = await postRun(submit('a1', { runId: 'r-2', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls: correct.map(() => 'Not A Call At All') }), deps);
  check(wrongLine.body.error.code === 'not_solved', `a wrong transcript is refused (${wrongLine.body.error?.code})`);
  const second = await counted(store, 'a1');
  check(second.total === 2 && second.codes.map((entry) => entry.code).join(',') === 'no_press_log,not_solved', `and the tally holds both codes, most recent last (${second.codes.map((entry) => `${entry.code}=${entry.count}`).join(' ')})`);

  // AND THE ACCEPTED RUN IS NOT COUNTED, which is the control that says this measures refusals rather than traffic:
  // the same player PLAYS the drill and submits again, and the total does not move.
  for (let step = 0; step < correct.length; step++) await postDrillAnswer(press('a1', drill.id, step, correct[step]), deps);
  const accepted = await postRun(submit('a1', { runId: 'r-3', mode: 'drill', levelIndex: LEVEL, drillId: drill.id, elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls: correct }), deps);
  check(accepted.status === STATUS.ok, `an honest run is accepted (${accepted.status})`);
  check((await counted(store, 'a1')).total === 2, 'NEGATIVE CONTROL: and the tally did not move for it, so it counts refusals and not requests');
}

console.log('\n== 2. the tally is bounded, and the total is not ==');
{
  const { store, deps } = await fresh();
  const key = abuseKey(devId('a2'));
  // ONE CODE, REFUSED MORE TIMES THAN THE CEILING: the count saturates and the total does not, because the alarm
  // reads the total and a saturated code still says which one is being hammered.
  let abuse = asAbuse(null);
  for (let index = 0; index < MAX_COUNT_PER_CODE + 5; index++) abuse = countRefusal(abuse, 'no_press_log', CLOCK);
  await store.put(key, { total: abuse.total, codes: abuse.codes, lastAtMs: abuse.lastAtMs }, null);
  const saturated = await counted(store, 'a2');
  check(saturated.codes[0].count === MAX_COUNT_PER_CODE, `one code's count saturates at ${MAX_COUNT_PER_CODE} (${saturated.codes[0].count})`);
  check(saturated.total === MAX_COUNT_PER_CODE + 5, `while the total keeps counting (${saturated.total})`);

  // AND THE CODES ARE CAPPED: a client inventing a new code per request must not grow the item without limit.
  let many = saturated;
  for (let index = 0; index < MAX_TRACKED_CODES + 4; index++) many = countRefusal(many, `invented_${index}`, CLOCK);
  check(many.codes.length === MAX_TRACKED_CODES, `at most ${MAX_TRACKED_CODES} codes are remembered (${many.codes.length})`);
  check(many.total === saturated.total + MAX_TRACKED_CODES + 4, `and every refusal still counts toward the total (${many.total})`);
  check(many.codes[many.codes.length - 1].code === `invented_${MAX_TRACKED_CODES + 3}`, `with the most recent kept last (${many.codes[many.codes.length - 1].code})`);
  // THE DROPPED CODES ARE THE OLDEST, which is the one an operator is least likely to need next.
  check(!many.codes.some((entry) => entry.code === 'no_press_log'), 'the oldest code is the one that falls off');

  // IT IS PER PLAYER: another account's refusals are its own row.
  await postRun({ ...submit('a3', { runId: 'r-4', mode: 'drill', levelIndex: LEVEL, drillId: '1:0', elapsedSeconds: 1, hintsUsed: 0, attempts: 0, calls: [] }), headers: {} }, deps);
  check((await counted(store, 'a3')).total === 0, 'an unauthenticated refusal is attributed to nobody rather than to a guess');
}

console.log('\n== 3. the row is a row: an unreadable one is not silently zero ==');
{
  const { store } = await fresh();
  const key = abuseKey(devId('a4'));
  await store.put(key, { total: 'lots', codes: [] }, null);
  check(asAbuse(await store.get(key)) === null, 'a row whose total is not a number reads as unreadable');
  await store.put(key, { total: 1, codes: [{ code: 'x', count: 'many' }] }, 1);
  check(asAbuse(await store.get(key)) === null, 'and so does a code whose count is not a number');
  await store.put(key, { total: 1, codes: [] }, 2);
  check(asAbuse(await store.get(key))?.total === 1, 'while a well-formed row reads');
  check(asAbuse(null).total === 0, 'and an absent row is zeroes rather than unreadable, which is the one "absent means empty" this API allows');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
