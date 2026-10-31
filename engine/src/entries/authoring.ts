// THE AUTHORING LAYER, as one entry point: build a call, edit a call's instance, re-order a formation.
//
// AUDIENCE: the Call editor and the two scripts that rewrite the corpus (`scripts/reorder-formation.mjs`,
// `scripts/tag-formations.mjs`). MEASURED, `poc/src/editor-ui.ts` imports 102 names from the barrel and most of them
// are this layer's 74: the panel is the reason the authoring surface exists, and it is the one consumer for which
// "which entry do I want" has a clear answer.
//
// RE-EXPORTS ONLY (see `core.ts`). Its closure is 16 modules - the authoring model, the document layer it writes
// through and the board identity it names - and the ceiling in `engine/test/entry-tiers.mjs` holds it there so the
// panel cannot become an excuse to load the sequencer.
export { rigidFit, alignFormationToCore, deriveFormationMapping, padSegment, moveCurveEnd, holdFollowingTrace, fitCircle, rotateCurveExit, hasExitDirection, rotateCurveAboutStart, swingArcAboutStart, synthesizeSetup, synthesizeSetupChain, setupToXml, callToXml, endPoses, closureDiscrepancy, correctEndTo, normalizeInstance, instanceTable, instanceBeats, moveBeatRange, setStartFormation, connectStart, endPoseError, setDancerStart, setDancerGender, setDancerEnd, placeDancerEnd, setMove, addMove, removeMove, setDancerPath, swapDancers, ARC_K, ARC_TOL, ARC_ANGLE_TOL, ARC_FIT_TOL, arcBezier, arcBezierAbout, arcOf, arcIsCircle, arcCorner, arcBlocker, projectToArc, setMoveArc, RUN_ARC_MAX, runCircleMoveCount, circleThrough, fitCircleRun, runTurn, RUN_FIT_MAX_DEV, setRunCircle, facingProfile, sameFacing, startsFromFormation, endsOnFormation, endFormationName, endFormationMatch, END_BOARD_TOL, nearEndFormations, NEAR_END_BOARD_TOL, rotateFormation, callToXmlNamed, halfSetReport, mirrorDancerMoves } from '../editor.js';
export type { FormDancer, NewSetup, ChainSpec, ClosureDiscrepancy, Rigid, InstanceDancer, ArcParams, ArcBlocker, CallXmlOptions, FormationRef, RunCircle, HalfSetReport, MirrorAxis, EndBoardTolerance, EndFormationMatch, NearEndFormation } from '../editor.js';
export { sameSpotUpToHalfTurn, sameSpotExact, formationReorderPermutation, permuteBy, formationCompassOrder, compassLetters, completedFormation, compareGeometry, COMPASS_SEQUENCE } from '../formation-order.js';
export type { CompassPoint, ReorderPlan, ReorderRefusal, GeometryComparison } from '../formation-order.js';
