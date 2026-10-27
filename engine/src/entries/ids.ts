// THE IDENTITY LAYER, as one entry point: the five schemes, the board they are taken over, and canonical keys.
//
// AUDIENCE: anything that names a shape and has to agree with the engine about WHICH shape - the POC's setup
// catalogue, the sequence document, the tagger, a probe. MEASURED at landing: two of the newest POC modules import
// exactly this layer (`poc/src/setup-catalogue.ts` asks for `formationId`/`arrangementId`/`setupId`, and
// `poc/src/sequence-json.ts` asks for those three by name), which is why it is an entry rather than a paragraph in
// the README.
//
// `constants` is here for ONE name a caller building a board from geometry has to write: `UNKNOWN_COUPLE`. The rest
// of that module (`SAME_BOARD_TOL`, the canonical name table) is the shared vocabulary the ids are taken under, so
// it travels whole rather than as a cherry-picked export - an entry with two mechanisms would be its own defect.
//
// RE-EXPORTS ONLY (see `core.ts`); `engine/test/entry-tiers.mjs` pins the shape and the module ceiling.
export { formationId, formationCanonical, canonicalOf, isFormationId, FORMATION_ID_VERSION, FORMATION_ID_GRID, FORMATION_ID_HEADING_STEP } from '../sequencer/formation-id.js';
export { arrangementId, arrangementCanonical, isArrangementId, ARRANGEMENT_ID_VERSION } from '../sequencer/arrangement-id.js';
export { setupId, setupCanonical, isSetupId, isPhysicalDancer, SETUP_ID_VERSION } from '../sequencer/setup-id.js';
export { callVariantId, callVariantCanonical, isCallVariantId, CALL_VARIANT_ID_VERSION } from '../sequencer/call-variant-id.js';
export { ID_ALPHABET, ID_BASE, ID_WIDTH, ID_SPACE, ID_SCHEMES, encodeId, isIdOf, fnv1a64 } from '../sequencer/id-code.js';
export type { IdSchemeName } from '../sequencer/id-code.js';
export { makeSquaredSet, cloneBoard, reorderLike, boardSig, boardAtBeat, sameBoardById } from '../sequencer/board.js';
export { CALL_TITLE, isCallTitle } from '../sequencer/call-titles.js';
export type { CallTitle } from '../sequencer/call-titles.js';
export { canonicalName, FORMATION_SYNONYMS, CALL_SYNONYMS, STANDARD_FINISHES, SAME_BOARD_TOL, SIGNATURE_DIVISOR, UNKNOWN_COUPLE, DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX } from '../sequencer/constants.js';
