// The committed DRILL FIXTURE, pinned: every seed in it generates a real puzzle at the level it claims.
//
// WHY THIS IS A GATE AND NOT A NOTE. The fixture names seeds, and a seed is only meaningful against a corpus
// and a generator — so a pool edit or a generator change can quietly turn a fixture entry into one that
// produces nothing. The app would then show a blank board on that drill, which is the worst kind of failure
// because it looks like a rendering bug rather than a data one. Re-running the generation here turns that
// into a red gate.
//
// IT ALSO PINS THE APPORTIONMENT, which is the property the LADDER rests on: every seed is declared at the
// level it generates at, with the DEPTH that level asks for. A seed moved between levels is a different
// puzzle (P1 measured that 20 of 20 seeds produce a different goal at a different pool), so an entry that
// drifts is a puzzle nobody validated.
//
// Usage: node game/test/schedule-fixture-probe.mjs   (engine must be built)
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { LOCAL_SCHEDULE, FIXTURE_POOL_VERSION, scheduleEntryFor, scheduleLength } from '../src/game/schedule-fixture.ts';
import { applierFor } from './lib/corpus.mjs';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('== the fixture is well formed before it is expensive ==');
{
  check(LOCAL_SCHEDULE.length > 0, `the fixture holds ${LOCAL_SCHEDULE.length} drill(s)`);
  check(scheduleLength() === LOCAL_SCHEDULE.length, 'and reports its own length');
  const versions = new Set(LOCAL_SCHEDULE.map((e) => e.poolVersion));
  check(versions.size === 1 && versions.has(FIXTURE_POOL_VERSION), 'every entry carries the same pool version');
  // A DUPLICATE SEED AT THE SAME LEVEL IS PROBABLY A COPY-PASTE, while the same seed at a DIFFERENT level is a
  // different puzzle — so the key is the pair, not the seed alone.
  const pairs = LOCAL_SCHEDULE.map((e) => `${e.levelIndex}:${e.seed}`);
  check(new Set(pairs).size === pairs.length, 'no two entries are the same seed AT THE SAME LEVEL');
  const levels = new Set(LOCAL_SCHEDULE.map((e) => e.levelIndex));
  check(levels.size >= 2, `the fixture spans ${levels.size} level(s), so progression is exercised`);
  check(scheduleEntryFor(0) === LOCAL_SCHEDULE[0], 'position 0 is the first entry');
  check(scheduleEntryFor(LOCAL_SCHEDULE.length) === LOCAL_SCHEDULE[0], 'and the schedule WRAPS rather than running out');
}

console.log('== every seed generates at the level it declares ==');
{
  // The expensive half, and the one that matters. One applier per level, built once: constructing a sequencer
  // is the slow part and the fixture reuses each level several times.
  const runtimes = new Map();
  const runtimeFor = (levelIndex) => {
    let entry = runtimes.get(levelIndex);
    if (!entry) {
      const level = levelSpec(levelIndex);
      entry = { level, ...applierFor(poolFor(level, MAIN_POOL), level.poolSize) };
      runtimes.set(levelIndex, entry);
    }
    return entry;
  };

  for (let i = 0; i < LOCAL_SCHEDULE.length; i++) {
    const e = LOCAL_SCHEDULE[i];
    const { level, applier, registered } = runtimeFor(e.levelIndex);
    check(level !== null, `entry ${i} names level ${e.levelIndex}, which is a level`);
    if (!level) continue;
    check(
      registered === level.poolSize,
      `level ${e.levelIndex} has all ${level.poolSize} of its titles in the corpus (${registered})`,
    );
    const result = generatePuzzle({ poolVersion: FIXTURE_POOL_VERSION, maxDepth: level.depth, nodeBudget: 50_000 }, e.seed, level, applier);
    if (!result.ok) {
      check(false, `entry ${i} (seed ${e.seed}, level ${e.levelIndex}) generates: ${result.reason}`);
      continue;
    }
    const p = result.puzzle;
    check(p.steps.length === level.depth, `entry ${i}: seed ${e.seed} generates a ${p.steps.length}-call puzzle, the level's depth (${level.depth})`);
    check(p.steps.every((s) => s.moves.length === level.optionCount), `entry ${i}: every step offers the level's ${level.optionCount} option(s)`);
    check(
      p.steps.every((s) => s.correctIndex >= 0 && s.correctIndex < s.moves.length),
      `entry ${i}: every step's correctIndex is inside its options`,
    );
    // THE ILLEGAL OPTION IS THE ONE THING THE APP ADVERTISES SEPARATELY, so a fixture entry without one would
    // render a two-button question where the player expects the refusal case. P1 measured that all twelve
    // seeds carry one, so a missing one is a change worth failing on rather than tolerating.
    check(p.steps.some((s) => s.unknown !== undefined), `entry ${i}: carries an illegal choice for step 1`);
  }
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
