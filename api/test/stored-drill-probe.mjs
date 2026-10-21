// THE PUBLISHED DRILL IS STORED, AND SERVING READS IT RATHER THAN REGENERATING IT.
//
// WHY THIS IS A GATE. The owner's rule is that every player must travel the same progression, and a puzzle is a
// pure function of `(seed, level, poolVersion)` only while the GENERATOR's code is unchanged — so a store that
// regenerates on read is a promise about a build, not about the data. The failure this probe rules out is the
// quiet one: a level that keeps serving boards from an older generator because nothing ever compares the stamp.
//
// Each refusal is asked for its own cause, because an operator's next move differs: unpublished (publish it),
// stale generator (republish), stale pool (republish), unreadable (corruption).
//
// Usage: node api/test/stored-drill-probe.mjs
import { GENERATOR_VERSION } from 'dancing-squared-game';
import { MemoryStore } from '../src/store/memory.ts';
import { seedLocalRegimes } from '../src/local-regime.ts';
import { drillKey, scheduleKey } from '../src/keys.ts';
import { asStoredDrill, readDrill } from '../src/stored-drill.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const store = new MemoryStore();
const levels = await seedLocalRegimes(store);
check(levels.length > 0, `the local fixture seeds ${levels.length} level(s)`);

console.log('\n== 1. publishing writes one drill per entry, and the board is the entry\'s ==');
{
  const schedule = (await store.get(scheduleKey(1))).value;
  const entries = schedule.entries;
  check(entries.length > 0, `level 1 publishes ${entries.length} entr(ies)`);
  for (let i = 0; i < entries.length; i++) {
    const stored = await store.get(drillKey(1, i));
    const drill = stored ? asStoredDrill(stored.value) : null;
    check(!!drill, `entry ${i} has a stored drill`);
    check(drill?.seed === entries[i].seed && drill?.levelIndex === 1,
      `entry ${i} stores its own seed (${drill?.seed}) and level (${drill?.levelIndex})`);
    check(drill?.generatorVersion === GENERATOR_VERSION,
      `entry ${i} is stamped with the generator that built it (${drill?.generatorVersion})`);
    const read = await readDrill(store, 1, i, entries[i].poolVersion);
    check(read.ok, `and it is served back (${read.ok ? 'ok' : read.reason})`);
  }
}

console.log('\n== 2. a STALE generator stamp is refused, naming both versions ==');
{
  const key = drillKey(1, 0);
  const current = await store.get(key);
  await store.put(key, { ...current.value, generatorVersion: 'g0-old' }, current.rev);
  const read = await readDrill(store, 1, 0, current.value.poolVersion);
  check(!read.ok && read.reason.includes('g0-old') && read.reason.includes(GENERATOR_VERSION),
    `the refusal names the stored and the running version (${read.ok ? 'SERVED' : read.reason})`);
}

console.log('\n== 3. a mismatched POOL version is refused, and its reason is the pool ==');
{
  const read = await readDrill(store, 1, 1, 'ms-0-somewhere-else');
  check(!read.ok && read.reason.includes('ms-0-somewhere-else'),
    `asking about a different pool is refused, not answered (${read.ok ? 'SERVED' : read.reason})`);
}

console.log('\n== 4. an UNPUBLISHED position and an unreadable row are different refusals ==');
{
  const beyond = await readDrill(store, 1, 999, 'anything');
  check(!beyond.ok && beyond.reason.includes('no published drill'), `a position nothing wrote is unpublished (${beyond.ok ? 'SERVED' : beyond.reason})`);

  const key = drillKey(1, 2);
  const current = await store.get(key);
  await store.put(key, { scheduleVersion: 'x' }, current.rev);
  const broken = await readDrill(store, 1, 2, current.value.poolVersion);
  check(!broken.ok && broken.reason.includes('not a record this build can read'),
    `a row this build cannot read says so (${broken.ok ? 'SERVED' : broken.reason})`);
  // NEGATIVE CONTROL for the parser: the strict reader must reject the same junk directly, or the refusal above is
  // a statement about `readDrill` rather than about the shape.
  check(asStoredDrill({ scheduleVersion: 'x' }) === null, 'NEGATIVE CONTROL: the parser rejects a body with no boards');
  check(asStoredDrill(current.value) !== null, 'and accepts the real one it was given');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
