// The game's pure core: the ladder, the pool, the generator, the schedule lint and the session.
//
// ENGINE-FREE BY CONSTRUCTION. Nothing reachable from this barrel imports an engine VALUE — only its
// types, which are erased. The engine-backed `GameApplier` lives in `src/engine/applier.ts` and is
// deliberately NOT re-exported here, so a consumer that wants it says so. The split is what makes the
// core testable with a stub and keeps the generator's determinism a property of this package.
export * from './types.ts';
export * from './levels.ts';
export * from './pool.ts';
export * from './rand.ts';
export * from './config.ts';
export * from './daily.ts';
export * from './generator.ts';
export * from './schedule.ts';
export * from './session.ts';
