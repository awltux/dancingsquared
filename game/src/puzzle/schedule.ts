// The Drill schedule: an ordered list of seeds, and the lint that decides whether one is publishable.
//
// A SCHEDULE IS A LIST OF SEEDS AND NOTHING ELSE (DESIGN.md 7). A puzzle is derivable from
// `(seed, level, poolVersion)`, so publishing a regime does not need a table of puzzles — which is
// what makes the whole thing cacheable and cheap. The lint below is what keeps that claim honest.
//
// THE RULE THIS FILE EXISTS FOR is the one DESIGN.md 7.2 records as measured: **a seed is valid only
// for the level it was generated at.** `generatePuzzle` draws its pool from `level.poolSize`, so the
// same seed at a different pool returns a DIFFERENT puzzle. A schedule that reused a seed across
// levels would therefore not be reusing a puzzle; it would be publishing a puzzle nobody validated,
// and the failure is silent because the seed LOOKS like the identity of the puzzle.

import { levelSpec } from './levels.ts';
import { generatePuzzle } from './generator.ts';
import type { GameApplier, GeneratorConfig, ScheduleEntry, ScheduleFinding } from './types.ts';

/**
 * Check every entry, in order, and report what is wrong.
 *
 * TWO KINDS OF FINDING, and they are different in kind rather than in severity:
 *   * STRUCTURAL — a version mismatch, an unknown level, a duplicate, a non-ascending seed. These make
 *     the schedule meaningless and are pure data checks.
 *   * SEMANTIC — the seed no longer generates a puzzle at its level. This is the expensive one, and it
 *     is the reason the lint exists: it re-runs the generator, so a schedule cannot outlive a change to
 *     the generator, the ladder or the pool without saying so.
 *
 * `verify` defaults to true and the structural checks run first, so a schedule that is obviously wrong
 * is reported without paying for 60 generations.
 */
export function lintSchedule(
  entries: readonly ScheduleEntry[],
  config: GeneratorConfig,
  applierForLevel: (levelIndex: number) => GameApplier,
  opts: { verify?: boolean } = {},
): ScheduleFinding[] {
  const findings: ScheduleFinding[] = [];
  if (entries.length === 0) findings.push({ index: -1, reason: 'the schedule is empty, so there is no regime to play' });

  const seenSeeds = new Map<number, number>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const level = levelSpec(e.levelIndex);
    if (!level) {
      findings.push({ index: i, reason: `levelIndex ${e.levelIndex} is not a level` });
      continue;
    }
    if (e.poolVersion !== config.poolVersion) {
      findings.push({ index: i, reason: `pool version "${e.poolVersion}" does not match the configured "${config.poolVersion}"` });
    }
    const first = seenSeeds.get(e.seed);
    if (first !== undefined) {
      // A repeated seed is not automatically wrong — a regime could revisit a puzzle — but it is
      // always deliberate or a copy-paste, so it is reported rather than assumed either way.
      findings.push({ index: i, reason: `seed ${e.seed} already appears at index ${first}` });
    } else {
      seenSeeds.set(e.seed, i);
    }
  }

  if (opts.verify === false) return findings;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const level = levelSpec(e.levelIndex);
    if (!level) continue;
    // The configured depth is the level's, not the generator default: a schedule entry is validated
    // against the puzzle it claims to be.
    const result = generatePuzzle({ ...config, maxDepth: level.depth }, e.seed, level, applierForLevel(e.levelIndex));
    if (!result.ok) findings.push({ index: i, reason: `seed ${e.seed} does not generate at level ${e.levelIndex}: ${result.reason}` });
  }
  return findings;
}
