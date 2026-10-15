// THE DAILY'S IDENTITY, pinned: one challenge per UTC day per level, the same one for everyone, and the
// same one forever.
//
// WHY THIS IS A GATE AND NOT A NOTE. The Daily is the one puzzle nobody validates at authoring time: the
// Drill's seeds are curated into a schedule and linted, while the Daily is DERIVED — so the derivation is
// the only thing standing between "everyone at L4 gets the same puzzle" and every player getting their
// own. It is also the property Phase 5 depends on when the server stops deriving and starts serving: the
// server's seed must be the client's seed, and this probe is the client's half of that contract.
//
// WHAT EACH CHECK RULES OUT is named in its comment (AGENTS.md 5). The three that matter are the level
// binding, the UTC day, and the malformed-day refusal; the generation sweep at the end is the measurement
// that says whether a derived Daily actually exists, and it PRINTS its failure count either way.
//
// Usage: node game/test/daily-probe.mjs   (engine must be built)
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { generatorConfigFor } from '../src/puzzle/config.ts';
import { dailyEntry, dailySeed, isUtcDay, utcDay } from '../src/puzzle/daily.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, POOL_VERSION, poolFor } from '../src/puzzle/pool.ts';
import { applierFor } from './lib/corpus.mjs';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** The host's offset from UTC, in minutes, measured rather than assumed — see the UTC section below, where
 * a host at UTC makes one negative control a COVERAGE GAP rather than a pass. */
const OFFSET_MINUTES = -new Date().getTimezoneOffset();

/** The day the LOCAL clock reports for an instant, which is the rule `utcDay` must NOT be. */
const localDayOf = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

console.log('== 1. the same day and level give the same seed ==');
{
  const a = dailySeed(4, '2026-10-15');
  const b = dailySeed(4, '2026-10-15');
  check(a === b, `repeating the call gives the same seed (${a})`);
  check(Number.isInteger(a) && a >= 0 && a <= 0xffffffff, `and it is a 32-bit unsigned integer (${a})`);
  // Negative control: a seed drawn from the clock, or from a counter, fails this and nowhere else in the
  // probe — and it is the failure that would silently give every player a different Daily.
}

console.log('\n== 2. the seed binds the LEVEL and the DAY, and neither is decoration ==');
{
  const day = '2026-10-15';
  const seedFor = (level, d) => dailySeed(level, d);
  // Negative control: a hash of the day alone (the level forgotten) fails the first two checks, and a hash
  // of the level alone (the day forgotten) fails the second two. DESIGN.md 9 requires the level in the
  // seed because the same date at a different poolSize is a different puzzle.
  check(seedFor(1, day) !== seedFor(2, day), 'two levels on one day get different seeds');
  check(seedFor(1, day) !== seedFor(16, day), 'and so do two levels far apart, where the pool actually differs');
  check(seedFor(1, day) !== seedFor(1, '2026-10-16'), 'one level on two days gets different seeds');
  check(seedFor(1, day) !== seedFor(1, '2027-10-15'), 'and a year apart differs too');

  // THE LEVEL INDEX IS NOT CONCATENATED INTO THE DAY: `#` separates them, so a day and a level that would
  // collide as one string do not. MEASURED over the grid below is the collision count, which is the check
  // that a hash is doing work rather than a truncation.
  const seen = new Map();
  let collisions = 0;
  const samples = [];
  for (let level = 1; level <= 30; level++) {
    for (let d = 0; d < 40; d++) {
      const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      samples.push([level, day]);
    }
  }
  for (const [level, day] of samples) {
    const s = dailySeed(level, day);
    if (seen.has(s)) collisions++;
    else seen.set(s, `${day}#${level}`);
  }
  check(collisions === 0, `no two of the ${samples.length} sampled (day, level) pairs share a seed (${collisions} collision(s))`);
}

console.log('\n== 3. the day is UTC, not the host clock ==');
{
  // NEGATIVE CONTROL, AND IT DEPENDS ON THE HOST: a `getFullYear()`-based rule differs from the UTC rule
  // only when the host is not at UTC. On a UTC host the two agree for every instant, so the control is a
  // COVERAGE GAP and this says so rather than reporting a pass (AGENTS.md 4.1: an instrument's silence is
  // itself a bug unless the zero says which it is).
  const lateEvening = new Date('2026-10-15T23:30:00Z');
  check(utcDay(lateEvening) === '2026-10-15', 'an instant at 23:30 UTC is that UTC day');
  if (OFFSET_MINUTES === 0) {
    console.log('  note  this host is at UTC, so a local-clock rule cannot be told apart here; the two checks below are a coverage gap on this host, not a pass');
  } else {
    check(
      localDayOf(lateEvening) !== utcDay(lateEvening),
      `a local-clock rule would call that instant ${localDayOf(lateEvening)} on this host (UTC${OFFSET_MINUTES > 0 ? '+' : ''}${OFFSET_MINUTES / 60}) and the UTC rule calls it ${utcDay(lateEvening)}`,
    );
  }
  // The OFFSET IN THE INPUT is normalised rather than trusted: both of these are the 15th in UTC.
  check(utcDay(new Date('2026-10-16T00:30:00+02:00')) === '2026-10-15', 'a timestamp written with a +02:00 offset is read as its UTC day');
  check(utcDay(new Date('2026-10-15T00:30:00-02:00')) === '2026-10-15', 'and one with -02:00 likewise');
  check(utcDay(new Date('2026-10-15T23:59:59.999Z')) === '2026-10-15', 'and the last millisecond of a UTC day is still that day');
  check(utcDay(new Date('2026-10-16T00:00:00.000Z')) === '2026-10-16', 'while the first millisecond of the next is the next');
}

console.log('\n== 4. a malformed day is refused rather than hashed ==');
{
  check(isUtcDay('2026-10-15') === true, 'a real day is accepted');
  // `2026-02-30` matches the SHAPE and is not a day: a hash of it is a challenge outside any calendar.
  const bad = ['2026-02-30', '2026-13-45', '2026-1-5', '15/10/2026', '', 'today'];
  for (const day of bad) {
    let threw = false;
    try {
      dailyEntry(levelSpec(1), MAIN_POOL.version, day);
    } catch {
      threw = true;
    }
    check(threw, `${JSON.stringify(day)} is refused by dailyEntry`);
  }
  // Negative control: a shape-only check accepts `2026-02-30` and `2026-13-45` and fails exactly those two
  // lines — MEASURED by making `isUtcDay` shape-only, which reddened those two and nothing else.
}

console.log('\n== 5. the entry the server will issue carries the level and the pool version ==');
{
  const level = levelSpec(7);
  const entry = dailyEntry(level, POOL_VERSION, '2026-10-15');
  check(entry.levelIndex === level.index, `the entry names the level it was built for (${entry.levelIndex})`);
  check(entry.poolVersion === POOL_VERSION, `and the pool version (${entry.poolVersion})`);
  check(entry.seed === dailySeed(level.index, '2026-10-15'), 'and its seed is the day-and-level seed, not a second derivation');
  check(dailyEntry(level, POOL_VERSION, '2026-10-15').seed === entry.seed, 'so two readers of the same day agree, which is the whole mode');
}

console.log('\n== 6. a derived Daily actually generates, and regenerates identically ==');
{
  // THE MEASUREMENT THE MODE RESTS ON. A seed is published without a puzzle, so a day whose seed cannot
  // generate has NO challenge — DESIGN.md 9 forbids falling back to another seed, because that would break
  // "the same challenge to every player at a level". This sweeps a small grid and PRINTS the failure count
  // whether it is zero or not, so a zero cannot be read as "not measured".
  const days = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-11-01'];
  const levelIndexes = [1, 2, 3];
  let generated = 0;
  let failed = 0;
  const reasons = [];
  let mismatched = 0;
  let notDaily = 0;
  let worstMs = 0;
  for (const levelIndex of levelIndexes) {
    const level = levelSpec(levelIndex);
    const { applier } = applierFor(poolFor(level, MAIN_POOL), level.poolSize);
    for (const day of days) {
      const entry = dailyEntry(level, MAIN_POOL.version, day);
      const config = generatorConfigFor(entry.poolVersion, level, 'daily');
      const started = Date.now();
      const result = generatePuzzle(config, entry.seed, level, applier);
      worstMs = Math.max(worstMs, Date.now() - started);
      if (!result.ok) {
        failed++;
        if (reasons.length < 3) reasons.push(`L${levelIndex} ${day}: ${result.reason}`);
        continue;
      }
      generated++;
      if (result.puzzle.mode !== 'daily') notDaily++;
      const again = generatePuzzle(config, entry.seed, level, applier);
      if (!again.ok || fingerprint(again.puzzle) !== fingerprint(result.puzzle)) mismatched++;
    }
  }
  check(generated + failed === days.length * levelIndexes.length, `the sweep ran every cell (${generated} generated, ${failed} failed)`);
  check(notDaily === 0, `every derived puzzle is stamped as a Daily (${notDaily} were not)`);
  check(mismatched === 0, `and regenerating the same day gives the identical puzzle (${mismatched} differed)`);
  console.log(`       ${generated}/${days.length * levelIndexes.length} of the sampled days generate; worst ${worstMs} ms`);
  for (const r of reasons) console.log(`       why: ${r.slice(0, 120)}`);
  check(failed === 0, `every sampled day generates (${failed} did not) — a failed seed is a day with no challenge`);
}

/** Everything about a puzzle that the seed is supposed to decide. Boards are compared by their signed
 * geometry rather than by identity, because a regenerated puzzle is a fresh object graph. */
function fingerprint(puzzle) {
  const board = (b) => b.dancers.map((d) => `${d.id}:${d.x.toFixed(6)},${d.y.toFixed(6)},${d.heading.toFixed(6)}`).join('|');
  return JSON.stringify({
    seed: puzzle.seed,
    level: puzzle.level.index,
    start: board(puzzle.start),
    goal: board(puzzle.goal),
    path: puzzle.path.map(board),
    steps: puzzle.steps.map((s) => ({ from: board(s.from), moves: s.moves.map((m) => `${m.call}@${board(m.board)}`), correct: s.correctIndex })),
    solution: puzzle.solution,
  });
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
