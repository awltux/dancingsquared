// THE ALL8 CODEC, as one entry point: All8's published choreography notation, decoded and encoded.
//
// AUDIENCE: the get-out conformance harnesses and the All8 sequence import/export path - the one vocabulary that is
// All8's rather than the corpus's. It is the smallest entry in the package (2 modules, 21 names) and the clearest
// case for entries at all: a tool that reads an All8 line should not evaluate a sequencer to do it.
//
// RE-EXPORTS ONLY (see `core.ts`); `engine/test/entry-tiers.mjs` pins the shape and a ceiling of 3 modules.
export { TOKENS, MULTI_TOKENS, REPEAT_TOKENS, SUFFIX_TOKENS, GROUP, tokenize, decodeToken, decodeTokenAll, decodeLine, normalizeToken } from '../sequencer/all8-notation.js';
export { ALL8_PITCH, ALL8_BASE_COLUMN, parseAll8Figures, parseAll8CellRows, splitSetup, looksLikeAll8Call, tokensWithColumns, decodeAll8Call, formatAll8Call, formatAll8Figures, ENGINE_TO_TOKEN } from '../sequencer/all8-format.js';
export type { All8Call, All8Figure } from '../sequencer/all8-format.js';
