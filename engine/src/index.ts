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
export {
  alignmentOf,
  arrangementFor,
  sequenceFor,
  relationshipCode,
  letterForFormation,
  ARRANGEMENT_TABLES,
  ARRANGEMENT_NUMBER_ORDER,
  FORMATION_LETTER,
  HOME_RING_ORDER,
  REFERENCE_PAIR_RULES,
} from './sequencer/alignment.js';
export type {
  Alignment,
  ArrangementResult,
  SequenceResult,
  ArrangementNumber,
  SequenceCode,
  RelationshipCode,
} from './sequencer/alignment.js';
export { canonicalName, FORMATION_SYNONYMS, CALL_SYNONYMS } from './sequencer/constants.js';
export { normalisedState, orientationDeltaSteps, ORIENTATION_STEP, ORIENTATION_STEPS } from './sequencer/fsm.js';
export { FsmTable, FSM_TABLE_SCHEMA_VERSION, type FsmTableEdge, type FsmTableData } from './sequencer/fsm-table.js';
export { normalizeSelection, selectionGroup, splitSelection } from './sequencer/selection.js';
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
