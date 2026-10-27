// THE DOCUMENT LAYER, as one entry point: taminations XML in, a normalized `CallBundle` out - and back.
//
// AUDIENCE: a tool that reads or writes the corpus and never runs a board - `book/tools`, a converter, a probe that
// parses a `<tam>`. It carries the parser seam (`setParser`), the parsers, `buildCall`/`callMeta`, the two writers
// (`callToXml`, `formationToXml`) and the half-set reconstitution the format needs.
//
// RE-EXPORTS ONLY (see `core.ts`): the names are the barrel's, so nothing moves out of `"."`; the entry exists to
// make "I only convert XML" a thing a consumer can say. `engine/test/entry-tiers.mjs` fails on a declaration in this
// file, and its ceiling stops an XML-only entry from quietly pulling the board model or the sequencer in.
export { setParser, parseMoves, parseFormations, parseFormationTags, parseCallXml, buildCall, buildCallVariants, callMeta, formationToXml, loadCallFromXml, selectTam, tamName, reconstituteWholeSet, swapLR, setupLabel, parseTaminationTitle } from '../convert.js';
export type { CallMeta, FormationTag } from '../convert.js';
export { exportNumber, exportAngleDeg } from '../export-format.js';
export { GOING_VALUES, goingOfTitle } from '../going.js';
export type { Going } from '../going.js';
