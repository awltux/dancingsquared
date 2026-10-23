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
// HOW A CALL GOES: the derived `close`/`normal`/`far` label, exported because a rule or a probe that keys on a body has to
// be able to enumerate the values and derive one from a title (`going.ts`).
export { GOING_VALUES, goingOfTitle } from './going.js';
export type { Going } from './going.js';

export { Engine } from './engine.js';
export type { HoldMode, HoldEdge, Hand } from './handholds.js';
export type { HeadingMode } from './core.js';

// Sequencer / FASR.
export { Sequencer } from './sequencer/sequencer.js';
export type { SequenceStop } from './sequencer/sequence.js';
export { assignHomeIdentity, identifyByAssignment, spotKey } from './sequencer/identity.js';
// The CURRENT partner relation, which is NOT the home couple on `SeqDancer.couple`. See `couples.ts`
// for why the two notions are separate and which consumers want which.
export {
  findCouplePairs,
  currentCoupleNumbers,
  currentCoupleOf,
  areCurrentPartners,
  currentHeadSide,
  COUPLE_WIDTH,
  COUPLE_WIDTH_TOL,
  COUPLE_FACING_TOL,
  FACING_COUPLE_MAX,
} from './sequencer/couples.js';
export type { CouplePair } from './sequencer/couples.js';
// The ORIENTED body model: how much room is between two dancers, which is NOT the distance between
// their centres. See `bodies.ts` for why a centre-distance test cannot answer this.
export {
  bodyGap,
  bodyOverlap,
  bodyAxes,
  worstBodyGap,
  overlappingDancers,
  DANCER_HALF_FRONT_BACK,
  DANCER_HALF_SIDE_SIDE,
  DANCER_WIDTH,
  DANCER_DEPTH,
  BODY_OVERLAP_EPS,
} from './sequencer/bodies.js';
export type { BodyPair } from './sequencer/bodies.js';
// The PICKER-ONLY permission layer: what the call chooser may offer, level-scoped so a later programme
// can override an earlier one. See `permissions.ts`; the engine's own legality check is untouched.
export {
  evaluatePermissions,
  levelRank,
  PERMISSION_LEVELS,
  PERMISSION_RULES,
} from './sequencer/permissions.js';
export type {
  PermissionDecision,
  PermissionLevel,
  PermissionRequest,
  PermissionResult,
  PermissionRule,
} from './sequencer/permissions.js';
// THE FORMATION IDENTITY: a board's key where no name reaches it. See `formation-id.ts` for what it is and
// what it deliberately ignores, and `Sequencer.boardIdentity` for the name-then-id pair the layer uses.
export {
  formationId,
  formationCanonical,
  isFormationId,
  FORMATION_ID_VERSION,
  FORMATION_ID_GRID,
  FORMATION_ID_HEADING_STEP,
} from './sequencer/formation-id.js';
// The constants that decide when motion is refused, exported so an instrument cannot report a threshold
// the engine does not enforce. `body-collision-scan.mjs` reads them rather than restating them.
export { BODY_PATH_CLEARANCE, BODY_COLLISION_MIN } from './sequencer/applicator.js';
export {
  makeSquaredSet,
  cloneBoard,
  reorderLike,
  boardSig,
  boardAtBeat,
  // The goal test: are these two boards THE SAME BOARD, by dancer identity? Distinct from `boardSig`
  // (positions-only congruence, for search dedup) — see the function's own comment.
  sameBoardById,
} from './sequencer/board.js';
export * from './sequencer/types.js';
export { matchFormations, matchFormationsAll } from './sequencer/match.js';
export type { FormationMatch, Matchable } from './sequencer/match.js';
// THE VIRTUAL CALL: a subwhole-set authoring placed on a whole-set board, with the owner's constraint that it
// must START and END on a formation the engine NAMES. The rule, the policy and the refusal each live in their
// own function so a harness can pin them apart; `Sequencer.virtualCall` is the thin delegate that supplies the
// catalogue and the namer.
export { placeVirtual, resolveVirtual, chooseVirtual } from './sequencer/virtual-call.js';
export type {
  FormationNamer,
  PlacementCopy,
  VirtualCandidate,
  VirtualKind,
  VirtualOptions,
  VirtualOutcome,
} from './sequencer/virtual-call.js';
// The mixed-arity (multi-size) grouping enumeration. Exported for the REPORTER that pins its measured
// yield — see `partitionsFor` for why it is deliberately wired to nothing else.
export { partitionsFor, MIXED_PARTITION_CAP } from './sequencer/applicator.js';
// The CELL vocabulary: a board's identity as a cell of a finite DECLARED lattice. Exported for the
// census that measures the reachable-vs-declared split; see `cells.ts` for why a declared lattice,
// not All8's FASR letters, is what bounds the FSM's node set.
export { geometryKey, buildCellLattice, boardMatchables, CELL_ROUND } from './sequencer/cells.js';
export type { BoardCell, CellGeometry, CellLattice } from './sequencer/cells.js';
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
  EMPTY_CELL,
  FORMATION_LETTER,
  FORMATIONS_FOR_LETTER,
  HOME_RING_ORDER,
  REFERENCE_PAIR_RULES,
  parseAlignmentId,
  adjacentPairs,
  relationshipStateOf,
  centresPassThru,
  ADJACENT_PAIR,
  REFERENCE_PAIR_SPOTS,
  boardsForAlignment,
  boardForAlignment,
  boardForFasrCode,
  boardFromDiagram,
  readLayout,
  coupleToSpot,
  sameCoupleToSpot,
  rotationBetweenBoards,
  relabelCouples,
  canonicalBoard,
  CANONICAL_INDEX,
  FORMATION_SETUP_CODE,
  setupForFormation,
  compliesWithSetup,
  fasrooOf,
  ORIENTATION_STEP_DEG,
} from './sequencer/alignment.js';
export type {
  Fasroo,
  Orientation,
  OrientationCode,
  OccupationCode,
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
  CoupleToSpot,
  FormationSetup,
  ComplianceLevel,
} from './sequencer/alignment.js';
export { canonicalName, FORMATION_SYNONYMS, CALL_SYNONYMS, STANDARD_FINISHES, SAME_BOARD_TOL } from './sequencer/constants.js';
// Every call title the corpus carries, as constants — GENERATED by `scripts/call-titles.mjs`, gated by
// `engine/test/call-titles.mjs`. A title the CODE names goes through `CALL_TITLE`, so a corpus retitle breaks
// the call site at compile time instead of leaving a name that resolves to nothing (AGENTS.md §11.2.6).
export { CALL_TITLE, isCallTitle } from './sequencer/call-titles.js';
export type { CallTitle } from './sequencer/call-titles.js';
// What call a RAW STRING names: the title, a description, a spoken name, a selection over a base call, the
// corpus's two suffix conventions, or All8 shorthand — in that measured order, with a refusal that names what
// it tried (`engine/test/call-names.mjs` pins every branch).
export { CALL_ALIAS, readCallName, readCallSequence } from './sequencer/call-name.js';
export type { CallNameHow, CallNameReading, CallSequenceHow, CallSequenceReading } from './sequencer/call-name.js';
export { applyCodedMove } from './sequencer/coded-moves.js';
export { normalisedState, orientationDeltaSteps, ORIENTATION_STEP, ORIENTATION_STEPS } from './sequencer/fsm.js';
export {
  FsmTable,
  FSM_TABLE_SCHEMA_VERSION,
  type FsmTableEdge,
  type FsmTableData,
  type FsmReading,
  type FsmEndKind,
} from './sequencer/fsm-table.js';
export { normalizeSelection, resolveReading, selectionGroup, splitSelection } from './sequencer/selection.js';
// THE WHOLE GROUP VOCABULARY, as one array: every name the picker can offer, which is also every name a
// permission rule's `group` may usefully carry. Exported so a consumer names all of them from ONE list
// rather than re-typing the eight gender spellings - the mistake the Lead Right rules made.
export { GROUP_NAMES, SINGLES_GROUP_NAMES, COUPLES_GROUP_NAMES, SUBSET_GROUP_NAMES, COMBINED_GROUP_NAMES } from './sequencer/selection.js';
export { findCodedMove, codedMoveApplies, CODED_MOVES, CODED_MOVE_NAMES, CODED_MOVE_BEATS, RUN_TRADE_BEATS, isDeferredCall } from './sequencer/coded-moves.js';
export type { CodedMove } from './sequencer/coded-moves.js';
// `Step Forward` and the return-or-stay rule a parallel step resolves it with. Exported so a caller
// (and the gate) can ask the RULE a question rather than infer it from a board.
export { stepForwardRule, stepForwardAndBackRule, stepForwardSteps, resolveStepForward, STEP_FORWARD_UNITS, STEP_FORWARD_BEATS, STEP_FORWARD_AND_BACK_BEATS } from './sequencer/step-forward.js';
export type { StepForwardResolution } from './sequencer/step-forward.js';
export { armTurn, armTurnProblem, ARM_TURN_FRACTIONS } from './sequencer/arm-turn.js';
// THE WAVES A CALL IS DANCED IN - "one or more groups of four dancers each", which is what keeps a Tidal
// Wave's Swing Thru inside its two halves (see `swing-thru.ts`).
export { waveGroups } from './sequencer/swing-thru.js';
// THE STEP-SOURCE GATE: which of the two sources serves a call on a given board (see `apply-source.ts`).
export { authoredTamWins, authoredStepWins, sameBoard } from './sequencer/apply-source.js';
export type { ArmTurnHand, ArmTurnFraction } from './sequencer/arm-turn.js';
export type { CallStep, GroupLane, LegacyGroupLane, GroupStep, ModuleStep } from './sequencer/types.js';
export { isGroupStep, stepCall, stepSelection, stepLabel, parseStep, groupCalls, normalizeGroupLane } from './sequencer/types.js';

// Call editor: synthesize missing setups by padding core moves.
export {
  rigidFit,
  alignFormationToCore,
  deriveFormationMapping,
  padSegment,
  moveCurveEnd,
  holdFollowingTrace,
  fitCircle,
  rotateCurveExit,
  hasExitDirection,
  rotateCurveAboutStart,
  swingArcAboutStart,
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

// Call editor, part two: edit a call INSTANCE directly - its start formation and the
// arrangement of that formation, its end formation, and the moves between them.
export {
  normalizeInstance,
  instanceTable,
  instanceBeats,
  moveBeatRange,
  setStartFormation,
  connectStart,
  endPoseError,
  setDancerStart,
  setDancerGender,
  setDancerEnd,
  placeDancerEnd,
  setMove,
  addMove,
  removeMove,
  setDancerPath,
  swapDancers,
  ARC_K,
  ARC_TOL,
  ARC_ANGLE_TOL,
  // How closely a cubic must follow a circle to count as an arc: the ONE copy, which `fitCircle`'s and
  // `fitCircleRun`'s defaults and the POC panel all use (`poc/src/editor-ui.ts` used to hold a second).
  ARC_FIT_TOL,
  arcBezier,
  arcBezierAbout,
  arcOf,
  arcIsCircle,
  arcCorner,
  arcBlocker,
  projectToArc,
  setMoveArc,
  RUN_ARC_MAX,
  runCircleMoveCount,
  circleThrough,
  fitCircleRun,
  runTurn,
  RUN_FIT_MAX_DEV,
  setRunCircle,
  facingProfile,
  sameFacing,
  startsFromFormation,
  endsOnFormation,
  endFormationName,
  END_BOARD_TOL,
  rotateFormation,
  callToXmlNamed,
  halfSetReport,
  // The track-level mirror behind the Call editor's X / Y buttons: a dancer's moves reflected across one
  // of the board's own axes, with the start pose - position AND rotation - left exactly where it was.
  mirrorDancerMoves,
} from './editor.js';
export type { InstanceDancer, ArcParams, ArcBlocker, CallXmlOptions, FormationRef, RunCircle, HalfSetReport, MirrorAxis, EndBoardTolerance } from './editor.js';

export {
  setParser,
  parseMoves,
  parseFormations,
  parseCallXml,
  buildCall,
  buildCallVariants,
  callMeta,
  formationToXml,
  loadCallFromXml,
  selectTam,
  tamName,
  // The one definition of the hand state's mirror, exported so a probe can measure a mirroring edit against
  // the corpus's own convention instead of restating it.
  swapLR,
} from './convert.js';
export type { CallMeta } from './convert.js';
export { setupLabel, parseTaminationTitle } from './convert.js';
// The four values of the `<tam sequencer="…">` attribute. Only `no` is behaviour-bearing so
// far: it marks a demonstration animation the sequencer must not match. `perimeter` and
// `exact` are carried but not yet acted on — see the note on `SequencerMode`.
export type { SequencerMode } from './types.js';
// Search-cost counters: what a getout/getin/fixIt actually cost, in the terms that separate
// the catalogue-scan term from the (previously quadratic) equivalents term.
export type { SearchStats } from './sequencer/config.js';

// REORDERING A FORMATION'S DANCER ORDER. A `<tam>`'s paths are paired with a formation's dancers by INDEX,
// so the order is part of the formation and changing it is a path permutation, not a rewrite: a 180-degree
// turn about the centre maps a dancer's local frame onto its antipode's, so the two share a local track.
// `scripts/reorder-formation.mjs` is the driver and `engine/test/formation-order.mjs` pins the result;
// the rules live here so both - and any probe - import one implementation instead of restating it.
export {
  sameSpotUpToHalfTurn,
  sameSpotExact,
  formationReorderPermutation,
  permuteBy,
  formationCompassOrder,
  compassLetters,
  completedFormation,
  compareGeometry,
  COMPASS_SEQUENCE,
} from './formation-order.js';
export type { CompassPoint, ReorderPlan, ReorderRefusal, GeometryComparison } from './formation-order.js';
