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
 * The states a single search may enumerate — read by the GENERATOR, and by nothing else since the hint stopped
 * searching from the goal.
 *
 * CHOSEN, and then bounded by measurement: the ladder census prints the explored count and the wall time
 * per level, so this number is revisited from data rather than from taste. It exists because the state
 * space is exponential in `depth` and the pool, and an unbounded search is how a browser tab stops
 * responding. The generator runs on the SERVING side and at bake time (DESIGN.md §9: the client generates
 * nothing), where a few seconds is a loading state rather than a hung tab.
 *
 * THE HINT'S SEARCH HAS ITS OWN, SMALLER BUDGET (`HINT_SEARCH_NODES`), because it is the one that runs in a browser
 * while a player waits for a press.
 */
export const NODE_BUDGET = 50_000;

/**
 * THE HINT'S SEARCH: how many Calls away it will look, and how many Boards it may expand before giving up.
 *
 * BOTH ARE SMALL, and the reason is where the search runs: a player presses the hint and the work happens in the
 * browser (DESIGN.md 10), so the worst case is a pause the player feels. MEASURED at the shipped level-1 pool, one
 * `offered` on a board the applier has not cached is ~66-75 ms — so the bound that matters is the BOARD count, and the
 * depth is capped because a target three calls away needs more boards than a press is worth.
 *
 * MEASURED, the first version: the reverse BFS from the goal spent the whole of `NODE_BUDGET` and cost **79-91 s for one
 * table**. The search that replaced it stops at the next waypoint, which is one call away in the ordinary case — a hit
 * at depth 1 expands NO board — and the cost is paid only by a player who has wandered off the route. MEASURED over the
 * positions a generated level-1 route passes through: a hint costs **0-650 ms** and names the route's own call (or
 * another call into the same arrangement), and a player one call off the route costs **~1.0 s** for the first press
 * from that board.
 */
export const HINT_SEARCH_DEPTH = 2;
export const HINT_SEARCH_NODES = 48;

/**
 * The version of the GENERATOR itself, stamped on every puzzle a server STORES.
 *
 * WHY THIS EXISTS SEPARATELY FROM `POOL_VERSION`. A puzzle is a pure function of `(seed, level, poolVersion)` —
 * so two builds that share a pool version agree ONLY while the generator's code is identical. A stored drill is
 * frozen bytes, which is the point of storing it (every player must travel the same progression), and that
 * makes a generator change INVISIBLE: the store keeps serving yesterday's boards and nothing notices, because a
 * seed that is no longer regenerable is never regenerated.
 *
 * BUMP IT WHEN THE GENERATED PUZZLE CHANGES FOR A FIXED INPUT — a change to the search, the option builder, the
 * rng draw order or `NODE_BUDGET`. A stored drill whose stamp disagrees is then refused rather than served, and
 * the publisher refuses to mix stamps within one level, so the failure is loud instead of a level that quietly
 * runs on two generators.
 *
 * `g2` IS THE START-BOARD CHANGE: the generator now opens on one of the level's own formations, chosen by the
 * seed, instead of always on a squared set — so every seed produces a different puzzle from the one `g1`
 * produced, and a `g1` store would be serving boards whose start this build no longer generates.
 *
 * `g3` IS THE ILLEGAL CHOICE: it is now drawn from the whole refused pool rather than from its alphabetical front
 * (MEASURED before the change: one call, `Adjust to an Alamo`, in 100 of 100 level-1 seeds) and it carries a seeded
 * position among the buttons (`PuzzleStep.unknownIndex`). Both are part of the puzzle, so a `g2` store would serve a
 * drill whose fourth button no longer matches what this build draws.
 *
 * `g4` IS THE PERMISSION TABLE: the option list is now drawn from the calls the permission table offers, not from
 * every geometrically legal one. MEASURED at the level-1 pool from a squared set: 40 offerable titles before, 31
 * after, the nine removed being the eight `Circle Four` authorings plus `Dosado` - a call the table refuses and
 * `legalCalls` alone does not. A `g3` store would serve a drill whose button the build now refuses to offer.
 *
 * `g5` IS THE QUESTION SPACE: a goal candidate is a BOARD rather than a `boardSig`, and the start no longer has to be
 * a formation the recogniser can name. MEASURED at level 1 over seeds 1..100: **27 distinct (start, goal) pictures
 * before, 49 after**, and 12 starts before, 29 after. The old identity was positions-only (AGENTS.md §8 trap 11), so
 * a goal that differed only in FACING was the same candidate — MEASURED, a start's named one-call goals are 1..17 by
 * pose and 1..6 by signature. A `g4` store would serve a block whose questions this build no longer generates.
 *
 * `g6` IS THE GOAL'S VALIDITY: a goal is now any arrangement the CORPUS defines (`GameApplier.formationOf`, every
 * formation in `formations.xml`) rather than one the curated recogniser names. MEASURED at level 1: the one-call
 * outcomes accepted as goals go from **91 to 206** of 303, the starts blocked by that gate go from **13 to 0**, and 24
 * of 40 sampled goals are formations the curated recogniser cannot name. A goal the player is shown is a picture, and
 * the corpus's answer to "is this one of ours" is wider than the twenty-odd standard names a caption prefers. A `g5`
 * store would serve a block whose goals this build no longer picks.
 *
 * `g7` IS THE DAILY'S REGIME: a Daily is now a seeded WALK through 5-10 waypoint arrangements (`generator.ts`,
 * `levels.ts`'s `dailyWaypointsFor`) rather than a board exactly three calls away, so the same seed is a DIFFERENT
 * puzzle — a longer one, ending somewhere else, with no option steps. THE DRILL IS UNTOUCHED: it still generates the
 * same boards from the same seed at the same level, which is why this is a Daily-shaped change and not a re-season.
 * A `g6` store would serve a Daily whose waypoints this build does not have and whose steps it does not draw.
 */
export const GENERATOR_VERSION = 'g7';

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
 * IT IS ADDED, NOT MULTIPLIED, and that is the rule `game/test/score-probe.mjs` pins: a hint costs a
 * minute of elapsed time and nothing else, so a run with one hint and no thinking time scores exactly what
 * a run with no hint and a minute of thinking scores (DESIGN.md 6: "one added term, not a multiplier").
 * A refundable hint would be a free look at the answer, so nothing un-charges it — the charge is applied
 * once, by `DailyRun.takeHint`, and an undo does not touch it.
 */
export const HINT_PENALTY_SECONDS = 60;

/** The most hints a player may hold at once (DESIGN.md 10). Enforced by `puzzle/hints.ts`. */
export const HINT_CAP = 3;

/**
 * How many successful Drill puzzles earn one hint (DESIGN.md 10: "one hint per 10").
 *
 * CHOSEN, not measured, and the cadence is what makes a hint a tip rather than a resource. It is also the
 * number the schedule's cadence interacts with — how long ten successes take is a property of the regime —
 * which is part of why DESIGN.md 15 leaves the cadence itself open.
 */
export const HINT_SUCCESS_STEP = 10;

// ---------------------------------------------------------------------------------------------- scoring
//
// DESIGN.md 6's formula, one factor per rule, with the weights gathered here so retuning is one edit. EVERY
// NUMBER BELOW IS CHOSEN AND NOT MEASURED — there is no playtest data in this repository and there cannot
// be one before the game runs, which is what DESIGN.md 6 says in as many words. Presenting any of them as
// measured would be the fabrication AGENTS.md 4.1 forbids.

/** What one level point of a perfect run is worth, before the three factors below. */
export const BASE_SCORE = 100;

/**
 * The seconds a single call is expected to take, which is what makes `par` derived rather than hand-set
 * (DESIGN.md 6): `par = shortest × this`. At L1 that is a fifteen-second par for a one-call solution, so a
 * clean level-1 Daily scores its maximum for anything under fifteen seconds.
 */
export const SECONDS_PER_CALL = 15;

/**
 * How much each non-correct Drill answer costs, as the divisor of `1 / (1 + this × attempts)`.
 *
 * DRILL ONLY (DESIGN.md 6): a wrong OPTION is a discrete event worth pricing, while the Daily's wandering
 * is already priced by `wasteFactor` — charging it twice would make the Daily's first mistake cost more
 * than the Drill's.
 */
export const ATTEMPT_PENALTY = 0.25;

/**
 * The floor on a solved run's score.
 *
 * A SOLVED RUN IS NEVER WORTH ZERO, because zero is the score of not having solved it at all: the board
 * records the best attempt, and a player who took five minutes and four moves still solved the puzzle. A
 * floor of 1 keeps "solved" and "unsolved" distinguishable on a leaderboard that only stores a number.
 */
export const MIN_RUN_SCORE = 1;

/**
 * How long one beat of a dance takes on screen, in milliseconds.
 *
 * The POC's `MS_PER_BEAT` (500, i.e. 120 beats a minute), reused rather than re-chosen: the panel that
 * authors these calls plays them at this tempo, and an animation that ran at a different one would make the
 * same call look like two different dances in one app. It is the ONLY place a beat is related to a
 * millisecond — `ui/playhead.ts` reads it and nothing else does.
 */
export const MS_PER_BEAT = 500;

// -------------------------------------------------------------------------------------------- persistence
//
// DESIGN.md 13's Phase 4: the anonymous player's regime, tips and runs survive a reload. The shape of what
// is stored is `game/store.ts`'s; these are the three numbers that shape it, and each is CHOSEN with the
// measurement that justifies it recorded where it is used.

/**
 * The localStorage key. The `dsq.` prefix is the one this origin already uses for the book's own
 * preferences, so a reader can tell this app's keys from anyone else's.
 *
 * THE SCHEMA VERSION IS IN THE PAYLOAD AND NOT THE KEY, deliberately: a version bump must be able to READ
 * the older record to decide what survives it (a pool change keeps the hints), and a key that moved would
 * leave the old record behind instead of migrating from it.
 */
export const SAVE_KEY = 'dsq.game.save';

/**
 * How many completed runs the local ledger keeps.
 *
 * CHOSEN, and bounded by measurement: `game/test/save-probe.mjs` prints the serialised size of a full ledger
 * so the number is checked against localStorage's few megabytes rather than assumed to fit. The newest are
 * kept, because the ledger is a QUEUE for Phase 5's `POST /me/runs:bulk` — a claim submits what has not been
 * claimed, in order — and a best-of keeps nothing claimable.
 */
export const MAX_SAVED_RUNS = 50;

/**
 * WHICH WEIGHTS a stored score was computed with.
 *
 * DESIGN.md 6 says every scoring weight is proposed and "must be calibrated from playtest data before
 * launch", so the weights WILL move — and a score computed with the old ones is not comparable with a score
 * computed with the new ones. This is bumped in the same commit as any weight, and the local ledger keeps
 * the old runs (they are the player's history) while the best-score readout counts only the current version.
 * It is the same staleness rule `poolVersion` carries for a puzzle, one level up.
 */
export const SCORE_VERSION = 1;
