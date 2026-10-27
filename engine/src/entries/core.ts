// THE DANCE MODEL, as one entry point: what a pose, a hand hold, an angle and a matrix ARE.
//
// AUDIENCE: a renderer, a drawing tool, a probe that asks where a dancer is. It needs no XML, no board, no
// sequencer and no catalogue - which is the point: MEASURED, this entry's module closure is 8 of the engine's 59,
// where the barrel's is all 59, so a consumer that only draws dancers stops paying for the sequencer tower.
//
// RE-EXPORTS ONLY, and that is a rule rather than a style: every name here is the barrel's, so `"."` stays the
// complete surface and a consumer can move to an entry without anything else changing. Adding a name here would
// make two surfaces to keep in step; `engine/test/entry-tiers.mjs` fails on a declaration in this file.
//
// The ceiling is in that harness: an import here that reaches the sequencer would grow this closure past it.
export type { SequencerMode, Gender, Hands, BezierData, Seg, DancerSpec, Symmetry, FormationTag, CallBundle, ModuleCallInfo, VirtualCallInfo, Pose } from '../types.js';
export { DEG, bezierPoint, bezierAngle, departureAngle, arrivalAngle, curveAngle, ident, fromPosAngle, mul, apply, translateBy, rotateBy, poseFor, dancerBeats, allPoses, sampleTrail, sampleTrailRange } from '../core.js';
export type { HeadingMode, Transform } from '../core.js';
export { PI, normAngle, Stand, Forward, Back, FaceLeft, FaceRight, FaceHalf, UTurnLeft, applyMoveToState, moveMatrix, faceInOutStates, applyMoveToBoard, applyFaceInOutToBoard } from '../moves.js';
export type { Move, MoveDancer } from '../moves.js';
export { identity5, mul5, apply5, invert5, poseToVec, dancerMatrix, dancerMatricesById, fitRigidMatrix, applyRigidToPose } from '../matrix.js';
export type { Mat5, DancerState, RigidFit } from '../matrix.js';
export { computeHandholds } from '../handholds.js';
export type { HoldMode, HoldEdge, Hand } from '../handholds.js';
export { EXACT_TOL, XML_ROUND_TRIP_TOL } from '../tolerances.js';
export { GOING_VALUES, goingOfTitle } from '../going.js';
export type { Going } from '../going.js';
export { exportNumber, exportAngleDeg } from '../export-format.js';
