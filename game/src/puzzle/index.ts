// The game's pure core: the ladder, the pool, the generator, the daily, the schedule lint, the session,
// the hint ledger and the score.
//
// NO SEQUENCER, NO DOM, NO `three`, AND NO `import.meta.glob` — which is what makes the whole barrel
// loadable by bare Node, so every rule in it can be probed. The engine-backed `GameApplier` lives in
// `src/engine/applier.ts` and is deliberately NOT re-exported here: a consumer that wants the sequencer
// says so, and the seam above (a `GameApplier` argument) is what lets a probe substitute a stub.
//
// IT IS NOT "ENGINE-FREE", and a comment here used to claim it was. The engine's own PURE RULES are
// imported by the modules that need them (`sameBoardById`, `boardSig`, `makeSquaredSet`), because the probes
// import the same functions and a local copy would be the second implementation AGENTS.md 5 forbids. What is
// excluded is the mutable, environmental side of the engine, and that exclusion is the one this barrel
// actually guarantees.
export * from './types.ts';
export * from './levels.ts';
// THE WAYPOINT RULE, exported because the SERVER applies it too: `POST /runs` verifies a Daily's line against the same
// arrangement sequence the client's session uses (`api/src/levels.ts`), and a server-side copy of "did this line pass
// the waypoints" would be the second implementation AGENTS.md §5 forbids.
export * from './arrangement.ts';
export * from './pool.ts';
export * from './rand.ts';
export * from './config.ts';
export * from './daily.ts';
export * from './generator.ts';
export * from './hints.ts';
export * from './score.ts';
export * from './schedule.ts';
export * from './session.ts';
// THE WIRE'S SHAPE CHECK, exported because the client now draws puzzles it did not generate (DESIGN.md §9), so the
// module that reads one off a response needs the same rule the probe measures.
export * from './parse.ts';
