// THE SCHEDULE LINT, pinned: what does `lintSchedule` actually protect, and does it say so at the right
// index?
//
// A schedule is a list of seeds and nothing else (DESIGN.md 7), so publishing a regime is cheap -- and
// there is no puzzle table to eyeball, which is why the lint has to be right. WHAT IT PROTECTS:
//
//   (a) A SEED STILL GENERATES AT THE LEVEL IT IS DECLARED AT. The semantic check re-runs the real
//       generator, so a schedule cannot outlive a change to the generator, the ladder or the pool
//       without saying so. This is the expensive check and `verify: false` skips it.
//   (b) THE POOL VERSION MATCHES the schedule's configured version -- a leaderboard entry is meaningful
//       only within one pool version.
//   (c) A DUPLICATE SEED IS REPORTED, keyed on the seed VALUE regardless of the level it sits at, so a
//       copy-paste is visible rather than silently replayed.
//
// A SEED REUSED ACROSS LEVELS IS NOT ITSELF AN ERROR, and the header says so because the first draft of
// this probe assumed the opposite and was wrong. MEASURED by the probe below: the same seed at L1 and L3
// generates BOTH times (never a finding) and reaches a DIFFERENT goal, because `generatePuzzle` draws its
// pool from `level.poolSize` and seeds its rng with `level.index` (generator.ts). So a reused seed is a
// DIFFERENT puzzle at the other level -- the schedule is expected to have validated it THERE, and the
// lint's job is to say whether it still generates, not to forbid the reuse. The distinction matters
// because the failure it guards against (a schedule gone stale after a pool or ladder change) IS silent:
// the entry still carries a seed, and a seed LOOKS like the identity of a puzzle.
//
// Each check names the wrong rule it rules out (AGENTS.md 5: every check needs a negative control, and
// the comment says which check catches which alternative).
//
// Usage: node game/test/schedule-lint-probe.mjs   (engine must be built)
import { generatePuzzle } from '../src/puzzle/generator.ts';
import { levelSpec } from '../src/puzzle/levels.ts';
import { MAIN_POOL, poolFor } from '../src/puzzle/pool.ts';
import { lintSchedule } from '../src/puzzle/schedule.ts';
import { applierFor } from './lib/corpus.mjs';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/** The seed budget for the semantic seeds. Kept small so the probe stays well inside the ~30 s the
 * sibling probes take: a level-1 generation is ~150 ms and a level-2/3 depth-2 generation ~380 ms
 * (MEASURED, `game/src/puzzle/levels.ts`'s census table). */
const SEED_TRIES = 20;
/** How many seeds 8b may try at L2 before falling back. The generator SEEDS ITS RNG WITH `level.index`
 * (generator.ts), so L2 and L3 are different runs and a seed can fail at one and not the other. */
const L2_SEED_TRIES = 40;
const NODE_BUDGET = 50_000;

const VERSION = MAIN_POOL.version;
const L1 = levelSpec(1);
const L2 = levelSpec(2);
const L3 = levelSpec(3);

// THE APPLIER IS THE REAL ONE, sliced to the level's own titles -- a stub would make this probe measure
// the stub rather than the engine's legality and refusals (game/test/lib/corpus.mjs). L2 and L3 share
// pool 15, so one applier serves both; the LEVEL still differs in the generator's rng.
const { applier: applier1 } = applierFor(poolFor(L1, MAIN_POOL), L1.poolSize);
const { applier: applier15 } = applierFor(poolFor(L2, MAIN_POOL), L2.poolSize);
const applierForLevel = (levelIndex) => (levelIndex === 1 ? applier1 : applier15);

const CONFIG1 = { poolVersion: VERSION, maxDepth: L1.depth, nodeBudget: NODE_BUDGET };
const CONFIG2 = { poolVersion: VERSION, maxDepth: L2.depth, nodeBudget: NODE_BUDGET };
const CONFIG3 = { poolVersion: VERSION, maxDepth: L3.depth, nodeBudget: NODE_BUDGET };

// STRUCTURAL checks pass `verify: false` so they do not pay for generation: what they pin is the data
// rule, and running the generator would let a slow level mask an index that is simply wrong.
const NO_VERIFY = { verify: false };

const entry = (seed, levelIndex, poolVersion = VERSION) => ({ seed, levelIndex, poolVersion });

/** Every findings array this probe produced, with the schedule it came from, so section 9 can assert
 * every index is inside the schedule it describes rather than trusting each case in isolation. */
const cases = [];
const record = (label, entries, findings) => {
  cases.push({ label, entries, findings });
  return findings;
};

console.log('== 1. a well-formed schedule produces NO findings ==');
{
  // Negative control: a lint that reports a finding for every schedule (or one that reports the wrong
  // key, e.g. flags a repeated `levelIndex` as a duplicate) fails HERE and nowhere else.
  const entries = [entry(101, L1.index), entry(202, L2.index)];
  const findings = record('well-formed', entries, lintSchedule(entries, CONFIG2, applierForLevel, NO_VERIFY));
  check(findings.length === 0, `a non-empty schedule of ${entries.length} valid entries reports no finding (${findings.length})`);
}

console.log('\n== 2. an EMPTY schedule is reported about the schedule, not an entry ==');
{
  // Negative control: an implementation that reports the empty schedule at index 0 (there is no entry 0)
  // or emits nothing at all ("empty is trivially valid") fails this index check.
  const findings = record('empty', [], lintSchedule([], CONFIG1, applierForLevel, NO_VERIFY));
  check(findings.length === 1, `the empty schedule is reported (${findings.length} finding(s))`);
  check(findings.length === 1 && findings[0].index === -1, 'and the finding is about the whole schedule (index -1), not entry 0');
}

console.log('\n== 3. a pool-version mismatch is reported at the offending entry ==');
{
  // Negative control: a lint that compares against the FIRST entry's version, or reports every mismatch
  // at index 0, or stays silent because the entries agree with each other, fails the index assertion.
  const entries = [entry(303, L1.index), entry(404, L1.index, 'pool-v0-stale')];
  const findings = record('version-mismatch', entries, lintSchedule(entries, CONFIG1, applierForLevel, NO_VERIFY));
  check(findings.length === 1, `the mismatched entry is reported alone (${findings.length})`);
  check(findings[0]?.index === 1, `and it is reported at index 1, where the mismatch is (got ${findings[0]?.index})`);
  check(findings[0]?.reason.includes('pool-v0-stale') === true, 'and the reason names the offending version');
}

console.log('\n== 4. an index that is not a level is reported at that entry ==');
{
  // Negative control: an implementation that called `levelSpec` without checking its null -- or that
  // reported "not a level" about the schedule as a whole -- fails these index assertions.
  //
  // THE TRAP: 999 IS A LEVEL. `levelSpec` is total and closed-form for every integer >= 1, so it answers
  // a huge poolSize rather than null; only a non-integer or an index < 1 is "not a level". The first
  // draft asserted 999 and failed. The negative controls are therefore 0 and -3.
  const entries = [entry(505, 0), entry(606, -3)];
  const findings = record('bad-levels', entries, lintSchedule(entries, CONFIG1, applierForLevel, NO_VERIFY));
  check(findings.length === 2, `both non-levels are reported (${findings.length})`);
  check(findings.some((f) => f.index === 0 && f.reason.includes('not a level')), 'levelIndex 0 is reported as not a level, at index 0');
  check(findings.some((f) => f.index === 1 && f.reason.includes('not a level')), 'levelIndex -3 is reported as not a level, at index 1');
  check(levelSpec(999) !== null, 'and levelIndex 999 is NOT a non-level: levelSpec is total for integers >= 1');
}

console.log('\n== 5. a duplicate seed is reported at the SECOND occurrence ==');
{
  // Negative control: an implementation that reports the duplicate at the FIRST occurrence (pointing at
  // the innocent entry), or that reports it about the schedule as a whole, fails the index assertion.
  const entries = [entry(777, L1.index), entry(777, L2.index)];
  const findings = record('duplicate-seed', entries, lintSchedule(entries, CONFIG1, applierForLevel, NO_VERIFY));
  check(findings.length === 1, `the repeated seed is reported once (${findings.length})`);
  check(findings[0]?.index === 1, `and at the SECOND occurrence's index 1 (got ${findings[0]?.index})`);
  check(findings[0]?.reason.includes('index 0') === true, 'and the reason names the index where it first appeared');
}

console.log('\n== 6. distinct seeds at existing levels report no STRUCTURAL finding ==');
{
  // Negative control: without this, sections 1-5 could all be passing because the lint reports something
  // for every schedule, which would make the negative controls above meaningless.
  const entries = [entry(11, L1.index), entry(22, L2.index), entry(33, levelSpec(4).index)];
  const findings = record('structural-clean', entries, lintSchedule(entries, CONFIG1, applierForLevel, NO_VERIFY));
  check(findings.length === 0, `a schedule with distinct seeds and real levels has no structural finding (${findings.length})`);
}

console.log('\n== 7 (8a). a seed that DOES generate at its level produces no finding ==');
let level1Seed = null;
{
  // The working seed comes from the generator itself, so this probes agreement between `generatePuzzle`
  // and the lint's own regeneration rather than a hard-coded seed that may rot.
  for (let s = 1; s <= SEED_TRIES && level1Seed === null; s++) {
    if (generatePuzzle(CONFIG1, s, L1, applier1).ok) level1Seed = s;
  }
  check(level1Seed !== null, `a seed in 1..${SEED_TRIES} generates at L${L1.index}`);
  if (level1Seed !== null) {
    const entries = [entry(level1Seed, L1.index)];
    const findings = record('semantic-clean', entries, lintSchedule(entries, CONFIG1, applierForLevel));
    check(findings.length === 0, `seed ${level1Seed}, known to generate at L${L1.index}, reports no finding (${findings.length})`);
  }
}

console.log('\n== 8. THE SEMANTIC CHECK, and what a reused seed is NOT ==');
{
  // 8b. THE STALENESS RULE THIS CHECK ACTUALLY CARRIES: "the seed still generates at the level it is
  // declared at". It fires when generation FAILS -- which is what a pool, ladder or generator change
  // looks like from here. It does NOT fire merely because a seed appears at another level: MEASURED
  // above and below, the same seed generates at L1 and L3 both, so cross-level reuse is not an error to
  // this lint and must not be asserted as one. The seed below is found by searching, not hard-coded,
  // because which seeds fail depends on the level's rng stream (generator.ts seeds with `level.index`).
  //
  // WHY THE FALLBACK BELOW IS A GENUINE ABSENCE RATHER THAN A COVERAGE GAP: this probe finds 0 of 40
  // failing at L2, and a wider scratch scan found 0 of 200 failing at L3 -- at these pools the generator
  // always finds a depth-1/2 puzzle, so there is no failing seed to exercise the verify pass with. The
  // fallback reports that measurement in its message instead of hiding it (AGENTS.md 4.1: an
  // instrument's silence is itself a bug unless the zero says which it is).
  //
  // Negative control: whichever branch runs, a lint that reported nothing (or reported at the wrong
  // index) fails it and no structural check above does.
  let failSeed = null;
  for (let s = 1; s <= L2_SEED_TRIES && failSeed === null; s++) {
    if (!generatePuzzle(CONFIG2, s, L2, applier15).ok) failSeed = s;
  }
  if (failSeed !== null) {
    const entries = [entry(failSeed, L2.index)];
    const findings = record('semantic-stale', entries, lintSchedule(entries, CONFIG2, applierForLevel));
    check(
      findings.length === 1 && findings[0].index === 0 && findings[0].reason.includes(`seed ${failSeed}`),
      `seed ${failSeed} does not generate at L${L2.index}, so its entry is reported at index 0 and the reason names it`,
    );
  } else {
    // GUARANTEED FALLBACK, stated rather than hidden: if no seed in the budget fails at L2, the verify
    // pass cannot be exercised with a failing seed here, and this asserts the other rule the lint owns at
    // the same index -- the pool-version mismatch -- so the check still has a negative control.
    const entries = [entry(1, L1.index, 'pool-v0-stale')];
    const findings = record('semantic-fallback', entries, lintSchedule(entries, CONFIG1, applierForLevel, NO_VERIFY));
    check(
      findings.length === 1 && findings[0].index === 0 && findings[0].reason.includes('pool-v0-stale'),
      `no seed in 1..${L2_SEED_TRIES} fails at L${L2.index}; 8b falls back to the version mismatch at index 0`,
    );
  }

  // 8c. THE LEVEL IS PART OF THE PUZZLE'S IDENTITY, which is why `ScheduleEntry` carries `levelIndex`.
  // MEASURED: the same seed at L1 and L3 reaches a DIFFERENT goal, because `generatePuzzle` takes its
  // pool from `level.poolSize` and its rng from `level.index`. So the duplicate rule below keys on the
  // seed VALUE, and two entries at different levels with different seeds are genuinely different entries.
  let dualSeed = null;
  let p1 = null;
  let p3 = null;
  for (let s = 1; s <= SEED_TRIES && dualSeed === null; s++) {
    const a = generatePuzzle(CONFIG1, s, L1, applier1);
    const b = generatePuzzle(CONFIG3, s, L3, applier15);
    if (a.ok && b.ok) {
      dualSeed = s;
      p1 = a.puzzle;
      p3 = b.puzzle;
    }
  }
  check(dualSeed !== null, `a seed in 1..${SEED_TRIES} generates at BOTH L${L1.index} and L${L3.index}`);
  check(
    dualSeed !== null && !applier15.boardsMatch(p1.goal, p3.goal),
    `the same seed reaches a DIFFERENT goal at L${L3.index} than at L${L1.index}, so a reused seed is not a reused puzzle`,
  );

  // The duplicate rule is about the seed VALUE, not the (seed, level) pair: the same value at two
  // different levels IS reported, and two different values are not.
  const same = [entry(9001, L1.index), entry(9001, L3.index)];
  const sameFindings = record('same-seed-two-levels', same, lintSchedule(same, CONFIG1, applierForLevel, NO_VERIFY));
  check(
    sameFindings.length === 1 && sameFindings[0].index === 1 && sameFindings[0].reason.includes('index 0'),
    'the same seed at two DIFFERENT levels is reported as a duplicate at index 1 -- the rule keys on the seed value',
  );
  const different = [entry(9002, L1.index), entry(9003, L3.index)];
  const differentFindings = record('different-seeds-two-levels', different, lintSchedule(different, CONFIG1, applierForLevel, NO_VERIFY));
  check(differentFindings.length === 0, `two distinct seeds at two different levels report nothing (${differentFindings.length})`);
}

console.log('\n== 9. every reported index is inside the schedule it describes ==');
{
  // An index outside -1..entries.length-1 would be an instrument bug: it would point a caller at an entry
  // that does not exist. -1 is reserved for a finding about the schedule as a whole.
  let outOfRange = 0;
  const offenders = [];
  for (const c of cases) {
    for (const f of c.findings) {
      if (!Number.isInteger(f.index) || f.index < -1 || f.index > c.entries.length - 1) {
        outOfRange++;
        offenders.push(`${c.label}: index ${f.index} for ${c.entries.length} entry/entries`);
      }
    }
  }
  check(outOfRange === 0, `every finding's index is within -1..entries.length-1 (${outOfRange} out of range; ${cases.length} case(s) checked)`);
  for (const o of offenders.slice(0, 4)) console.log(`       ${o}`);

}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
