// Every tunable number the pure core reads, in ONE module.
//
// WHY THEY ARE ALL HERE. DESIGN.md 6 asks for exactly this ("all weights live in one checked-in config
// module so retuning the game is one edit, not a hunt"), and the reason is broader than scoring: a
// number buried in a screen is a number nobody can find when the ladder stalls or generation gets slow.
//
// WHAT IS MEASURED AND WHAT IS CHOSEN. Each value below carries which it is. A chosen value is a
// decision to revisit with playtest data; presenting one of those as measured would be the fabrication
// AGENTS.md 4.1 forbids, so they are labelled.

import type { GeneratorConfig, LevelSpec, PuzzleMode } from './types.ts';

/**
 * The states a single search may enumerate — read by the GENERATOR, and by the hint's reverse BFS.
 *
 * CHOSEN, and then bounded by measurement: the ladder census prints the explored count and the wall time
 * per level, so this number is revisited from data rather than from taste. It exists because the state
 * space is exponential in `depth` and the pool, and an unbounded search is how a browser tab stops
 * responding — both readers run on the CLIENT (`generatePuzzle` for the Daily per DESIGN.md 4.4, and
 * `PlaySession.distanceToGoal` for a hint per DESIGN.md 10), so the budget has to fit a browser rather
 * than a server.
 *
 * ONE NUMBER FOR TWO SEARCHES, deliberately: both are "a bounded search over boards inside one frame's
 * worth of patience", and they are the same order of work, so a playtest that moves one is a reason to
 * look at the other. They are NOT the same budget — the hint's is additionally bounded by the move
 * allowance — which is why the hint search would be the reader to give its own constant if the two ever
 * want different values.
 */
export const NODE_BUDGET = 50_000;

/**
 * The generator configuration for ONE LEVEL, at the budget this build ships.
 *
 * WHY THE CONFIG OBJECT IS BUILT HERE AND NOT AT EACH CALL SITE. Every caller used to build it by hand,
 * and MEASURED, they disagreed: the generator's own default was dead, and four call sites (the app plus
 * three probes) each carried their own literal `50_000`, so retuning `NODE_BUDGET` moved the GAME and
 * left the GATE measuring the old budget — the one failure a budget is gated for. `main.ts` additionally
 * had to restate the level's depth, which is the same class of defect one field over.
 *
 * IT BUILDS A NEW OBJECT on every call rather than returning a shared one: a module-level config object
 * is one `Object.assign` (or one field write) away from a caller editing the default for everybody.
 *
 * `mode` DEFAULTS TO THE DRILL, because that is what nearly every caller wants and a default that failed
 * loudly would put an argument at every call site that has no opinion. The Daily is the one caller that
 * passes `'daily'`, and `game/test/config-probe.mjs` pins both readings — MEASURED, the generator stamped
 * `mode: 'drill'` on every puzzle before this, so a Daily challenge was labelled as a Drill.
 */
export function generatorConfigFor(poolVersion: string, level: LevelSpec, mode: PuzzleMode = 'drill'): GeneratorConfig {
  return { poolVersion, mode, maxDepth: level.depth, nodeBudget: NODE_BUDGET };
}

/**
 * The Daily's move allowance: the shortest solution plus this many calls.
 *
 * CHOSEN, not measured, and it is the number DESIGN.md 9 calls "a stated, calibrated number". The
 * allowance exists because with free undo and honest offerings an unlimited budget would let a player
 * eliminate their way to any displayed board, so the allowance plus the waste factor is what makes
 * that lose. Whether the cushion is 2 or 3 is a playtest question, not an arithmetic one.
 */
export const MOVE_ALLOWANCE_CUSHION = 2;

/**
 * The hint penalty, in seconds, folded into the elapsed time (DESIGN.md 10).
 *
 * CHOSEN, not measured. It is deliberately legible — a minute is a thing a player can feel — and
 * deliberately dominant at low levels, where `par` is one call.
 *
 * NOT YET READ BY ANY CODE, and kept anyway: DESIGN.md 6 names this number and `HINT_CAP` as the config
 * module's own contents, and DESIGN.md 13's Phase 3 (the Daily UI and the hint) is their first reader.
 * Deleting them would be a smaller diff and would make that section of the design cite an example that
 * no longer exists.
 */
export const HINT_PENALTY_SECONDS = 60;

/** The most hints a player may hold at once (DESIGN.md 10). Not yet read; see `HINT_PENALTY_SECONDS`. */
export const HINT_CAP = 3;
