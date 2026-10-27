// THE SESSION LAYER, as one entry point: run a board through calls, ask what is legal, read what it is, solve for
// home, and compose a module into a single call.
//
// AUDIENCE: anything that DANCES a board - the POC's sequencer panel, the game's applier, the teacher's preview -
// rather than only drawing one. `Sequencer` is the composition root of the engine (it builds the library, matcher,
// applicator, grouping, legality, analyzer, solver and FSM store and injects the selection and permission
// resolvers), so this entry's closure is 54 of the engine's 59 modules: asking for the sequencer IS asking for the
// engine, and the entry's value is that it says so in one word.
//
// RE-EXPORTS ONLY (see `core.ts`). `relations` and `module-call` are the two capabilities the resync added to this
// job - partner/corner calls need a board that carries couples, and a saved module is offered and applied as ONE
// call - and `alignment` is the FASR/All8 vocabulary a session panel reads. The ceiling in
// `engine/test/entry-tiers.mjs` is the engine's own module count, so a new engine module either joins this list
// deliberately or the gate says so.
export { Sequencer } from '../sequencer/sequencer.js';
export { isGroupStep, stepCall, stepSelection, stepLabel, parseStep, groupCalls, normalizeGroupLane } from '../sequencer/types.js';
export type { CallStep, GroupLane, LegacyGroupLane, GroupStep, ModuleStep, SeqDancer, Board, RecognizedFormation, SeqStep, LaneRun, FasrRelations, Fasr, Module, VariantMatch } from '../sequencer/types.js';
export { evaluatePermissions, levelRank, PERMISSION_LEVELS, PERMISSION_RULES } from '../sequencer/permissions.js';
export type { PermissionDecision, PermissionLevel, PermissionRequest, PermissionResult, PermissionRule } from '../sequencer/permissions.js';
export { relationNamedBy, carriesCouples, relationRefusal } from '../sequencer/relations.js';
export { composeModuleCall } from '../sequencer/module-call.js';
export type { ComposedModule, ModuleCallOutcome, ModuleStepTrack, ModuleTracks } from '../sequencer/module-call.js';
export { geometryKey, buildCellLattice, boardMatchables, CELL_ROUND, congruenceOf, congruentWithin, CONGRUENCE_SIGNATURE_MAX } from '../sequencer/cells.js';
export type { BoardCell, CellGeometry, CellLattice } from '../sequencer/cells.js';
export { alignmentOf, arrangementFor, sequenceFor, relationshipCode, letterForFormation, ARRANGEMENT_TABLES, ARRANGEMENT_NUMBER_ORDER, EMPTY_CELL, FORMATION_LETTER, FORMATIONS_FOR_LETTER, HOME_RING_ORDER, REFERENCE_PAIR_RULES, parseAlignmentId, adjacentPairs, relationshipStateOf, centresPassThru, ADJACENT_PAIR, REFERENCE_PAIR_SPOTS, boardsForAlignment, boardForAlignment, boardForFasrCode, boardFromDiagram, readLayout, coupleToSpot, sameCoupleToSpot, rotationBetweenBoards, relabelCouples, canonicalBoard, CANONICAL_INDEX, FORMATION_SETUP_CODE, setupForFormation, compliesWithSetup, fasrooOf, ORIENTATION_STEP_DEG } from '../sequencer/alignment.js';
export type { Fasroo, Orientation, OrientationCode, OccupationCode, Alignment, ArrangementResult, SequenceResult, ArrangementNumber, SequenceCode, RelationshipCode, AlignmentSpec, ConstructionResult, BoardLayout, PairingResult, AdjacentPairResult, PartnerPair, RelationshipState, CoupleToSpot, FormationSetup, ComplianceLevel } from '../sequencer/alignment.js';
export { CALL_ALIAS, readCallName, readCallSequence } from '../sequencer/call-name.js';
export type { CallNameHow, CallNameReading, CallSequenceHow, CallSequenceReading } from '../sequencer/call-name.js';
export { CALL_TITLE, isCallTitle } from '../sequencer/call-titles.js';
export type { CallTitle } from '../sequencer/call-titles.js';
export { matchFormations, matchFormationsAll } from '../sequencer/match.js';
export type { FormationMatch, Matchable } from '../sequencer/match.js';
export { normalizeSelection, resolveReading, selectionGroup, splitSelection, GROUP_NAMES, SINGLES_GROUP_NAMES, COUPLES_GROUP_NAMES, SUBSET_GROUP_NAMES, COMBINED_GROUP_NAMES } from '../sequencer/selection.js';
export { canonicalName, FORMATION_SYNONYMS, CALL_SYNONYMS, STANDARD_FINISHES, SAME_BOARD_TOL, SIGNATURE_DIVISOR, UNKNOWN_COUPLE, DEFAULT_MATCH_MAX, SEARCH_MATCH_MAX } from '../sequencer/constants.js';
export { assignHomeIdentity, identifyByAssignment, spotKey } from '../sequencer/identity.js';
