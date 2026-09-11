// Dancing-Squared Engine — public API.
//
// A standalone, renderer-agnostic square-dance engine:
//   - convert:   taminations XML -> normalized CallBundle
//   - core:      pure pose evaluation (position, facing, hands)
//   - handholds: hand-hold derivation from poses
//
// Usage (browser): DOMParser is global, so:
//   const engine = new Engine(movesXml, formationsXml);
//   const call = engine.loadCall(callXml);
//   const poses = engine.poses(call, 3.5);
//   const holds = engine.handholds(poses);
//
// In Node, first call setParser(@xmldom/xmldom's DOMParser).

export * from './types.js';
export * from './core.js';
export * from './handholds.js';
export * from './matrix.js';
export * from './moves.js';

export { Engine } from './engine.js';
export type { HoldMode, HoldEdge, Hand } from './handholds.js';
export type { HeadingMode } from './core.js';

// Sequencer / FASR.
export { Sequencer } from './sequencer/sequencer.js';
export { assignHomeIdentity } from './sequencer/identity.js';
export * from './sequencer/types.js';
export { matchFormations, matchFormationsAll } from './sequencer/match.js';
export type { FormationMatch, Matchable } from './sequencer/match.js';
export { analyzeFasr } from './sequencer/fasr.js';
// All8's call notation (abbreviation table, tokenizer, line decoder) - the shared vocabulary behind
// both the get-out conformance harnesses and the All8 sequence import/export codec.
export {
  TOKENS,
  MULTI_TOKENS,
  REPEAT_TOKENS,
  SUFFIX_TOKENS,
  GROUP,
  tokenize,
  decodeToken,
  decodeTokenAll,
  decodeLine,
  normalizeToken,
} from './sequencer/all8-notation.js';
// All8 sequence import/export: the codec for All8's published choreography format, including its
// call-sharing layout.
export {
  ALL8_PITCH,
  ALL8_BASE_COLUMN,
  parseAll8Figures,
  parseAll8CellRows,
  splitSetup,
  looksLikeAll8Call,
  tokensWithColumns,
  decodeAll8Call,
  formatAll8Call,
  formatAll8Figures,
  ENGINE_TO_TOKEN,
} from './sequencer/all8-format.js';
export type { All8Call, All8Figure } from './sequencer/all8-format.js';
export {
  alignmentOf,
  arrangementFor,
  sequenceFor,
  relationshipCode,
  letterForFormation,
  ARRANGEMENT_TABLES,
  ARRANGEMENT_NUMBER_ORDER,
  FORMATION_LETTER,
  FORMATIONS_FOR_LETTER,
  HOME_RING_ORDER,
  REFERENCE_PAIR_RULES,
  parseAlignmentId,
  adjacentPairs,
  relationshipStateOf,
  ADJACENT_PAIR,
  REFERENCE_PAIR_SPOTS,
  boardsForAlignment,
  boardForAlignment,
  boardFromDiagram,
  readLayout,
} from './sequencer/alignment.js';
export type {
  Alignment,
  ArrangementResult,
  SequenceResult,
  ArrangementNumber,
  SequenceCode,
  RelationshipCode,
  AlignmentSpec,
  ConstructionResult,
  BoardLayout,
  PairingResult,
  AdjacentPairResult,
  PartnerPair,
  RelationshipState,
} from './sequencer/alignment.js';
export { canonicalName, FORMATION_SYNONYMS, CALL_SYNONYMS, STANDARD_FINISHES } from './sequencer/constants.js';
export { applyCodedMove } from './sequencer/coded-moves.js';
export { normalisedState, orientationDeltaSteps, ORIENTATION_STEP, ORIENTATION_STEPS } from './sequencer/fsm.js';
export { FsmTable, FSM_TABLE_SCHEMA_VERSION, type FsmTableEdge, type FsmTableData } from './sequencer/fsm-table.js';
export { normalizeSelection, selectionGroup, splitSelection } from './sequencer/selection.js';
export { findCodedMove, codedMoveApplies, CODED_MOVES, CODED_MOVE_NAMES, CODED_MOVE_BEATS, RUN_TRADE_BEATS } from './sequencer/coded-moves.js';
export type { CodedMove } from './sequencer/coded-moves.js';
export {
  promenadeHome,
  promenadeApplies,
  promenadeProblem,
  promenadeAnchor,
  PROMENADE_ALIASES,
  PROMENADE_BEATS,
  PROMENADE_COUPLE_MIN,
  PROMENADE_COUPLE_MAX,
} from './sequencer/promenade.js';
export type { PromenadeResult } from './sequencer/promenade.js';
export type { CallStep } from './sequencer/types.js';

// Call editor: synthesize missing setups by padding core moves.
export {
  rigidFit,
  alignFormationToCore,
  deriveFormationMapping,
  padSegment,
  synthesizeSetup,
  synthesizeSetupChain,
  setupToXml,
  callToXml,
  endPoses,
  closureDiscrepancy,
  correctEndTo,
  alignTargetToStart,
} from './editor.js';
export type { FormDancer, NewSetup, ChainSpec, ClosureDiscrepancy, Rigid } from './editor.js';

export {
  setParser,
  parseMoves,
  parseFormations,
  parseCallXml,
  buildCall,
  buildCallVariants,
  callMeta,
  loadCallFromXml,
} from './convert.js';
export type { CallMeta } from './convert.js';
// The four values of the `<tam sequencer="…">` attribute. Only `no` is behaviour-bearing so
// far: it marks a demonstration animation the sequencer must not match. `perimeter` and
// `exact` are carried but not yet acted on — see the note on `SequencerMode`.
export type { SequencerMode } from './types.js';
// Search-cost counters: what a getout/getin/fixIt actually cost, in the terms that separate
// the catalogue-scan term from the (previously quadratic) equivalents term.
export type { SearchStats } from './sequencer/config.js';
