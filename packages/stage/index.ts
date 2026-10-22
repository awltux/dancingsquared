// dancing-squared-stage - the package entry point.
//
// THREE CONCERNS THAT SHIP TOGETHER, and the barrel is what lets a consumer take any of them without
// knowing the file layout:
//
//   * `grid-magnet.ts` - the pure square/radial grid rule and its magnet. No DOM, no `three`, so
//     `poc/tools/*-probe.mjs` loads it by path under node's type stripping to measure the rule
//     rather than a copy of it. It also stays reachable as the `./grid-magnet` subpath for exactly
//     that reason; this barrel does not hide it.
//   * `display-couple.ts` - WHICH COLOUR a dancer is drawn in, including the pair-number fallback for a board whose
//     home couples the engine does not know. Pure for the same reason `grid-magnet` is: both apps need one rule, and
//     the POC's `display-couple-probe.mjs` loads it by path.
//   * `scene.ts` - the Three.js render adapter. It knows nothing about the engine's semantics: it
//     consumes `Pose[]` and grip targets from `dancing-squared-engine` and draws avatars.
//
// The star re-export is deliberate rather than a hand-kept list: scene.ts already re-exports the
// engine's `Pose`/`DancerSpec` types, and a second list here would be one more place for a name to
// go missing when a consumer imports it.
export * from './display-couple.js';
export * from './grid-magnet.js';
export * from './scene.js';
