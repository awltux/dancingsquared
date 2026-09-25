// Call editor UI controller: three features.
//   1. EDIT INSTANCE — edit a taminations call instance (`<tam>`) directly: the start
//      formation and its arrangement (the gender of each spot), the end formation, and the
//      moves that carry every dancer between them.
//   2. FIX CLOSURE — correct an existing call setup so it ends at the start position of a
//      chosen POST call setup.
//   3. CREATE POSITION — synthesize a NEW position for a call from the END of a PRE call
//      setup to the START of a POST call setup, through the edit call's core setup.
//
// The engine owns every geometric decision (`normalizeInstance`, `instanceTable`,
// `setDancerStart`, `setDancerGender`, `setDancerEnd`, `setMove`, `callToXml`); this file
// owns the DOM, the current state, and NOTHING ELSE. That split is deliberate: the POC
// cannot be observed in this sandbox, so the behaviour that matters is asserted headlessly
// in `engine/test/editor.mjs` and only the wiring lives here.
import {
  alignFormationToCore,
  synthesizeSetup,
  correctEndTo,
  deriveFormationMapping,
  poseFor,
  bezierPoint,
  bezierAngle,
  endPoses,
  rigidFit,
  normalizeInstance,
  instanceTable,
  setDancerStart,
  setDancerGender,
  setDancerEnd,
  setMove,
  addMove,
  removeMove,
  moveCurveEnd,
  // A facing edit holds the following trace: see `foldMoveChange`.
  holdFollowingTrace,
  fitCircle,
  swingArcAboutStart,
  hasExitDirection,
  moveBeatRange,
  boardAtBeat,
  setStartFormation,
  connectStart,
  endPoseError,
  // The quarter arc: the one shape a curve can be LOCKED to, so that the coordinate fields stop
  // being five independent numbers and become the two handle lengths the arc is made of.
  ARC_K,
  arcBezier,
  arcOf,
  arcIsCircle,
  arcCorner,
  arcBlocker,
  projectToArc,
  sameFacing,
  // The RUN-level circle: a run of consecutive moves laid on ONE arc, both ends kept.
  RUN_ARC_MAX,
  runCircleMoveCount,
  circleThrough,
  fitCircleRun,
  runTurn,
  setRunCircle,
  // The `asymmetric` declaration read backwards: what a half-set tam needs, and whether this
  // call can be written as one.
  halfSetReport,
  startsFromFormation,
} from 'dancing-squared-engine';
import type { ArcBlocker, ArcParams, Board, BezierData, CallBundle, FormDancer, Gender, Hands, InstanceDancer, RunCircle, Seg, Symmetry } from 'dancing-squared-engine';

import {
  availableCalls,
  availableLevels,
  loadCall,
  loadEdits,
  persistEdits,
  setApplied,
  effectiveSetups,
  rebuildEdit,
} from './data';
import type { CallEdit, CallInfo } from './data';
// The one place that decides whether an exported `<tam>` embeds its start formation or NAMES it.
import { callTamXml, corpusFormationPoses } from './tam-xml';
import type { Stage, CurveSpec, HandleSpec } from './scene';
import { HANDLE_COLOR } from './scene';
import { el, esc } from './dom';

export interface EditorUI {
  setActive(a: boolean): void;
  /** Open the INSTANCE editor on one call and one setup, as if both had been chosen from the lists. */
  openCall(callId: string, setupIdx: number): void;
}

/** What the editor needs from the rest of the app. */
export interface EditorHost {
  /** Show a call bundle (a still frame or a synthesized/edited instance) and let it ANIMATE. */
  preview(call: CallBundle): void;
  /** Show a call with the playhead PARKED at an absolute beat, animation off.
   *
   *  The moves editor works on one frame at a time: an animation that keeps running moves the
   *  dancers out from under the move being edited, and a re-preview happens on EVERY edit (each
   *  commit re-shows the instance), so the position has to be the caller's and has to survive being
   *  re-shown. This is that - `preview` plus a seek, in one call. */
  previewAt(call: CallBundle, absoluteBeat: number): void;
  /** Move the parked playhead without re-showing the call, for a drag. Re-showing would rebuild all
   *  eight dancer views and their trails on every pointer move. */
  setPlayhead(absoluteBeat: number): void;
  /** Re-path the shown call WITHOUT rebuilding the views: same dancers, new geometry. Used by the
   *  handle drag, where `previewAt`'s full rebuild is far too much work per pointer move. */
  updateCall(call: CallBundle): void;
  /** Show only `index`'s track, with `range` highlighted, or every track in full for null.
   *  The moves editor drives the TRAIL with these two selections: which dancer is being
   *  edited decides whose track is shown, and which move decides which stretch of it. `kind` says
   *  WHICH OF THE MOVE'S TWO SHAPES to draw over that stretch - the path, or the facings. */
  focusTrail(index: number | null, range: { from: number; to: number } | null, kind?: 'move' | 'facing'): void;
  /** The 8-dancer named formations a clone's start can be re-based onto, as start poses.
   *  Sourced from the sequencer's formation library - building a second one here would
   *  double the catalogue registration the app already pays for at startup. */
  startFormations(): { name: string; poses: FormDancer[] }[];
  /** The library's name for a board, or null. Used to NAME a generated setup after the formation it
   *  starts from, which is what every other setup's label is - see `instanceName`. */
  nameBoard(board: Board): string | null;
  /** How the dancers are drawn: flat icons from above, and/or no dancers drawn at all. */
  setDisplayMode(opts: { use2d?: boolean; showDancers?: boolean }): void;
}

// Warning threshold for a "large" closure correction.
const HEADING_WARN = 0.35; // rad (~20deg)
const POS_WARN = 2.0; // units

/** The level the editor's call lists open on. See `populateLevels`. */
const DEFAULT_LEVEL = 'ms';

/** The Clone button's tooltip while a clone is ALREADY being built. See `renderCloneChrome`. */
const CLONE_BUSY_TITLE =
  'A clone is already being built. Clone would RE-LOAD the catalogue instance and throw away the re-based start and every move edit made since, so it is off until you Reset back to that setup.';

const HANDS: Hands[] = ['none', 'left', 'right', 'both', 'gripleft', 'gripright', 'gripboth'];
const GENDERS: Gender[] = ['boy', 'girl', 'phantom'];

/** Hands, abbreviated for a compact move tile. */
const HANDS_SHORT: Record<Hands, string> = {
  none: '—',
  left: 'L',
  right: 'R',
  both: 'B',
  gripleft: 'gL',
  gripright: 'gR',
  gripboth: 'gB',
};
const handsShort = (h: Hands): string => HANDS_SHORT[h] ?? h;

/**
 * The two windows the group gate turns on, both tied to what a caller can SEE.
 *
 * THE SHAPE WINDOW IS HALF A PIXEL'S WORTH OF MOVEMENT, and the two numbers that decide it are in a gap
 * in the data rather than in an argument. MEASURED (`poc/tools/clone-refusal-probe.mjs --sweep`, the walk-in
 * the connect writes for every call x every formation the picker offers, 12248 refused pairs, at the flat
 * view's 40.91 px per unit): the refusals come in exactly two sizes - **232 rest on a difference under half
 * a pixel, and the next smallest is 2 px** - with NOTHING at all between 0.5 and 2 px. So the window may be
 * anywhere in that empty band and the same refusals are made; it sat at 0.01 units (0.4 px), which refused
 * the 232, and those are differences nobody can see.
 *
 * THE ONE THAT PROMPTED THIS: "All 4 Couples Promenade Full" cloned onto the formation made from the end of
 * `Right and Left Grand`, connected, then dancers 1 and 3 selected - refused, on a difference of 0.0142
 * units, which is **0.58 px**. The curves were a hair apart and the panel said the two dancers do not move
 * alike. The window is now 0.025 units, one pixel, which opens that witness and all 232 and refuses nothing
 * else in the corpus.
 *
 * AND THE WINDOW IS ON THE CURVES, not on the control points. A Bezier is a convex combination of its
 * control points, so equal control points mean equal curves - but a control point can differ by more than
 * the window while the curves stay well inside it, which is how the same move written as an ease-in and as
 * a constant-speed line was refused although both trace the same segment. What a caller compares is the
 * drawn shape, so that is what is measured, at seventeen points along it.
 *
 * The window used to be 1e-6 ON THE RAW NUMBERS, and its fault was not its width but its KIND: it asked
 * whether five numbers match rather than whether the move does. MEASURED (`poc/tools/coords-gate-probe.mjs`):
 * it refused group edits resting on a difference of 0.0 units and 0.0 degrees, which is what a caller
 * reported as "they look the same". They did.
 *
 * THE FACING IS COMPARED THROUGH THE ENGINE, which also knows the one exact case: a facing curve
 * multiplied by a positive constant is the SAME facing at every instant, because `bezierAngle` is `atan2`
 * of the derivative. Half a degree is well below the spacing of the facing ticks themselves, and MEASURED
 * the facing refusals start at 3.15deg - three degrees above the window rather than a hair above it.
 */
const SHAPE_WINDOW = 0.025;
const FACING_WINDOW_DEG = 0.5;

/** Which of a move's TWO curves an edit is about. They are different spaces - the travel Bezier is where
 *  the dancer goes, the rotation Bezier is how they turn - and so is every edit that writes one. */
type CurveKind = 'travel' | 'facing';

/** How far apart two dancers' TRAVEL curves are, in board units, measured along the curves themselves. */
function travelGap(a: Seg, b: Seg): number {
  let gap = 0;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const qa = bezierPoint(a.translate, t);
    const qb = bezierPoint(b.translate, t);
    gap = Math.max(gap, Math.hypot(qa.x - qb.x, qa.y - qb.y));
  }
  return gap;
}

/**
 * Whether two dancers' TRAVEL curves are the same local shape: "the same shape, rotated to each dancer's
 * position" made checkable. Beats and hands are deliberately NOT compared - the gate is about shapes, and
 * unifying a timing or a hold across a selection is a legitimate group edit.
 */
function sameTravel(a: Seg, b: Seg): boolean {
  return travelGap(a, b) < SHAPE_WINDOW;
}

/**
 * Whether two dancers FACE the same way through the move, compared through the engine.
 *
 * `rotate ?? translate` IS the facing a dancer has: an absent rotation curve means "face along the
 * travel tangent", which `poseFor` implements by reading the translation curve's direction. So a
 * dancer with an explicit facing that happens to equal its path faces EXACTLY like one that has none -
 * and comparing a null against a curve refused the pair on a difference of nothing at all. A positive
 * rescaling of a facing curve is the same facing at every instant, which `sameFacing` knows exactly.
 */
function sameFacingCurve(a: Seg, b: Seg): boolean {
  return sameFacing(a.rotate ?? a.translate, b.rotate ?? b.translate, FACING_WINDOW_DEG);
}

/**
 * THE GATE IS PER CURVE, and that is the whole of what makes a completed clone editable.
 *
 * A coordinate edit writes ONE curve: a field on the Move tab writes `translate.<attr>`, a field on the
 * Facing tab writes `rotate.<attr>`, and a handle drag writes whichever curve the handle belongs to. So
 * the question the gate has to answer is whether THAT curve agrees across the selection - not whether
 * the two curves agree, which is a strictly stronger condition on a write that touches one of them.
 *
 * MEASURED (`poc/tools/connect-assign-probe.mjs`, after a `connect` onto each of the 134 start
 * formations): of the walk-in pairs the gate refuses, 76 are refused on the FACING alone while their
 * travel curves agree to within the window - 24 of them with all six numbers identical, i.e. the same
 * straight line to the last bit, refused because the two dancers end the walk facing 45.15deg apart (the
 * ancestor's own first move turns half its dancers and not the other half) - so the tab that edits the
 * line they share was locked over a curve it does not write. 242 are refused on the travel alone while
 * facing identically, locking the Facing tab on a pair a facing edit cannot collapse. 64 of the 134
 * targets have at least one such pair.
 */
function sameCurve(a: Seg, b: Seg, curve: CurveKind): boolean {
  return curve === 'travel' ? sameTravel(a, b) : sameFacingCurve(a, b);
}

/** Round the way the engine's XML export does, so a value read out of the table and typed
 *  back in is the same number rather than a 15-digit float. */
const show = (n: number): string => (Math.round(n * 1e4) / 1e4).toString();
const toDeg = (rad: number): number => (rad * 180) / Math.PI;
/** The shortest signed angle equal to `a`, in (-PI, PI]. The engine's own is private to `editor.ts`, and
 *  a facing delta that wrapped would hold the trace by a whole turn. */
const normAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * The grid a CTRL-drag snaps to, and how close the pointer must come before it is pulled in.
 *
 * THE CELL IS THE FLOOR'S OWN, and the authority is the format's own header rather than a preference:
 * "The scale is in dancer units, same as shown when the grid is on", and the floor this app draws is 20
 * units in 20 divisions. So a whole unit is a drawn cell, a `Forward` (x2 = 1) is one cell of travel,
 * and MEASURED (`tools/snap-grid-probe.mjs`) the couples of a squared set stand 2 units apart. Only
 * 46% of the corpus's authored coordinates are on the unit grid, so this is a new convention rather
 * than a restoration of one - which is why it is behind a modifier.
 *
 * IT IS A MAGNET AND NOT A LOCK: the point is pulled onto a line only when it is already within a
 * quarter of a cell of one, and is left exactly where the pointer is otherwise. Rounding from anywhere
 * in the cell would make the drag quantised - every position a grid position - which is a different
 * gesture from "help me land on the line". The quarter cell is about 10 px in the flat view at 1080p
 * (the probe measures 40.9 px per unit there), so the pull is felt but the drag stays smooth.
 *
 * AND IT IS THE BOARD'S GRID, not a grid turned with the dancer's frame: the point is snapped in the
 * coordinates the floor is drawn in, before it is taken into the local frame at all. So a snapped
 * control point lands on a line the caller can SEE. The tile's numbers are then the dancer-local
 * coordinates of a grid point, which are not round when the dancer is turned - the honest consequence of
 * snapping to a grid drawn in another frame, and the reason the panel does not pretend otherwise.
 */
/**
 * How closely a curve must follow a circle before the arc-centre handle is OFFERED, as a fraction of the
 * radius - and the threshold is only a formality here, because the corpus leaves a wide empty band for it to
 * sit in. MEASURED over the ms level's 1016 travel curves: 222 have a centre at all, the worst curve that IS
 * an arc deviates **1.47e-2** of its radius and the closest curve that is NOT deviates **1.55e-1 - eleven
 * times further out** - so 2% is inside the gap rather than a judgement call. 134 curves (13%) qualify.
 * `engine/test/editor.mjs` 23 measures the band and `poc/tools/arc-centre-probe.mjs` measures the gesture.
 */
const ARC_FIT_TOL = 0.02;

/**
 * Rotate a curve about its OWN START POINT: the end and the exit control turn, the start handle does not.
 *
 * THAT ASYMMETRY IS THE WHOLE POINT, and it is the answer to the caller's own warning - "care must be taken
 * to maintain the dancers direction in transition from the previous curve, including the facing curve": the
 * direction the dancer arrives with IS the start handle's direction (`poseFor` reads the tangent at t=0), so
 * rotating it would kink the move against the one before it. Leaving it alone holds that direction EXACTLY
 * while the rest of the curve swings, which is the gesture. The facing curve is untouched for the same
 * reason: it is authored in this move's own frame, so the heading profile does not move with the arc.
 */
function rotatePoint(p: { x: number; y: number }, theta: number): { x: number; y: number } {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}



const SNAP_CELL = 1;
const SNAP_TOL = SNAP_CELL / 4;
/**
 * The HALF grid's pull, and it is deliberately weaker than the whole grid's.
 *
 * HALF POSITIONS ARE WHERE THIS DANCE'S OWN COORDINATES LIVE. MEASURED over the move registry
 * (`tools/snap-grid-probe.mjs`): 61% of the authored coordinates sit on half units against 46% on whole
 * ones - a half-slot step is an ordinary thing to author - so a magnet that only knew the drawn lines
 * would refuse the position the assets use most.
 *
 * Two tiers rather than one finer grid, so the DRAWN lines keep their precedence: a whole unit wins
 * whenever both are in range, which is why this pull is half as wide. A point a quarter of a unit from
 * both lands on the drawn line.
 *
 * NOTE THAT NOTHING IS DRAWN AT THE HALF POSITIONS - the floor draws 1-unit cells and a 2-unit overlay -
 * so a half-snapped control point sits midway between two lines. That is a real place in this dance's
 * vocabulary rather than an arbitrary point, but it is not a place the grid shows, and the two tiers are
 * the honest way to say both things at once.
 */
const SNAP_HALF_TOL = SNAP_CELL / 8;
/**
 * Pull a coordinate onto the nearest grid line, or leave it exactly where it is.
 *
 * BOTH AXES ARE HANDLED INDEPENDENTLY, so a point can land on a line in x and stay free in y - which is
 * what "on the grid" means for a control point, and it avoids rounding a coordinate the caller did not
 * put near anything.
 */
const snapTo = (v: number): number => {
  const whole = Math.round(v / SNAP_CELL) * SNAP_CELL;
  if (Math.abs(v - whole) <= SNAP_TOL) return whole;
  const half = Math.round(v / (SNAP_CELL / 2)) * (SNAP_CELL / 2);
  if (Math.abs(v - half) <= SNAP_HALF_TOL) return half;
  return v;
};

/**
 * A Bezier as a polyline, using the ENGINE'S OWN `bezierPoint`.
 *
 * The curve is drawn from the same function the engine evaluates the dance with, so the picture cannot
 * drift from the data: a hand-rolled cubic in the renderer would be a second implementation of the
 * engine's geometry, which is the one thing this POC's split exists to avoid.
 *
 * 32 segments, which is finer than the eye and cheap enough to rebuild on every pointer move of a drag.
 */
const CURVE_SEGMENTS = 32;
function sampleBezier(b: BezierData, segments = CURVE_SEGMENTS): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) pts.push(bezierPoint(b, i / segments));
  return pts;
}

/**
 * ONE STEP OF THE EDITOR'S OWN HISTORY: everything a change to the instance can move, so the last 50 of them
 * can be put back.
 *
 * WHAT IS IN IT, AND WHY ONLY THIS. A change writes `this.instance` and sometimes the flags that go with it -
 * a re-based START carries the end pairing, a circle run carries its parameters, a clone carries `asClone`.
 * Those are the things an undo has to put back or the panel would show a state the data is not in. What is NOT
 * in it is a deliberate line: the SAVED EDIT LIST (a global list of edits applied to the catalogue, not a
 * change to the call on screen), the mode, and the level - undoing a move should not silently switch tabs.
 *
 * THE INSTANCE IS RETAINED BY REFERENCE, not copied, and that is safe rather than optimistic: every editor
 * operation in the engine RETURNS a new bundle (`setMove` maps to new arrays and new dancers) and never writes
 * through the one it was given, so a snapshot cannot be changed by anything that happens afterwards. It is
 * also what makes 50 of them cheap: the snapshots share all the structure they have not touched.
 */
interface EditorSnapshot {
  instance: CallBundle | null;
  instanceEdited: boolean;
  asClone: boolean;
  endTarget: { name: string; poses: FormDancer[] } | null;
  endOverride: number[] | null;
  circleTo: number | null;
  circleRadius: number | null;
  circleCentre: { x: number; y: number } | null;
  circleSide: 1 | -1;
  moveIndex: number;
  selected: number[];
}

/** How many changes the editor can put back. Asked for as "the last 50 UI changes". */
const UNDO_LIMIT = 50;

/**
 * A MOVE'S OWN FRAME: where the dancer stands when the move begins, and which way they face. The origin of
 * the curve's local coordinates, and `+X` is the facing there - see `BezierData`.
 */
interface MoveFrame {
  x: number;
  y: number;
  heading: number;
}

/** A point of a move's curve, in BOARD coordinates. */
const localToFloor = (f: MoveFrame, lx: number, ly: number): { x: number; y: number } => ({
  x: f.x + Math.cos(f.heading) * lx - Math.sin(f.heading) * ly,
  y: f.y + Math.sin(f.heading) * lx + Math.cos(f.heading) * ly,
});

/**
 * THE INVERSE, and it is an isometry - so placing a point and reading it back is the identity, and an edit
 * made in either set of coordinates is exact in the other.
 *
 * ONE DEFINITION, because three things need it: the handles that are DRAWN on the board, the drag that
 * reads a pointer off it, and the tile's board-coordinate fields. They were two copies of the same rotation
 * before this (a note in `facing-handle-probe.mjs` says so, and says it is the reason the drag rules are not
 * under test), and a drag and a field that disagreed about the frame would move a point somewhere neither
 * of them named.
 */
const floorToLocal = (f: MoveFrame, x: number, y: number): { lx: number; ly: number } => {
  const dx = x - f.x;
  const dy = y - f.y;
  return {
    lx: Math.cos(f.heading) * dx + Math.sin(f.heading) * dy,
    ly: -Math.sin(f.heading) * dx + Math.cos(f.heading) * dy,
  };
};

/**
 * THE THREE POINTS A CURVE IS DRAWN FROM, and the local fields each one owns.
 *
 * P0 is the dancer's own spot at the move's start and is not a handle, so the points are the two controls
 * and the endpoint - the vocabulary the panel, the probes and the engine's own comments already use.
 * `ly` is null for a point whose Y the FORMAT CANNOT CARRY, which is the first control of a FACING curve:
 * `tamination.dtd` declares the rotate as `cx3, cx4, cy4, x4, y4`, there is no `cy3`, so that point is
 * pinned to the dancer's forward axis and its board pair is a readout rather than an edit.
 */
const CURVE_POINTS: { point: string; lx: 'cx1' | 'cx2' | 'x2'; ly: 'cy1' | 'cy2' | 'y2' | null }[] = [
  { point: 'C1', lx: 'cx1', ly: 'cy1' },
  { point: 'C2', lx: 'cx2', ly: 'cy2' },
  { point: 'P3', lx: 'x2', ly: 'y2' },
];

/**
 * ONE MOVE'S OWN COPIED END POINT, in both of the frames the tile shows it in.
 *
 * `curve` is the shape it was taken from, because the Move and Facing tabs edit different curves and a point
 * from one is nonsense in the other.
 */
type MoveClip = { curve: CurveKind; rel: { x: number; y: number }; abs: { x: number; y: number } };

export class EditorController implements EditorUI {
  private stage: Stage;
  private host: EditorHost;
  private active = false;

  private modeSel = el<HTMLSelectElement>('edMode');
  private levelSel = el<HTMLSelectElement>('edLevel');
  private callFilterInput = el<HTMLInputElement>('edCallFilter');
  private callFoundEl = el<HTMLSpanElement>('edCallFound');
  private editCallSel = el<HTMLSelectElement>('edCall');
  private editSetupSel = el<HTMLSelectElement>('edSetup');
  private postRow = el<HTMLDivElement>('edPostRow');
  private postCallSel = el<HTMLSelectElement>('edPostCall');
  private postSetupSel = el<HTMLSelectElement>('edPostSetup');
  private showTargetBtn = el<HTMLButtonElement>('edShowTarget');
  private fixPanel = el<HTMLDivElement>('edFixPanel');
  private showEndBtn = el<HTMLButtonElement>('edShowEnd');
  private fixBtn = el<HTMLButtonElement>('edFix');
  private fixInfoEl = el<HTMLSpanElement>('edFixInfo');
  private createPanel = el<HTMLDivElement>('edCreatePanel');
  private preCallSel = el<HTMLSelectElement>('edPreCall');
  private preSetupSel = el<HTMLSelectElement>('edPreSetup');
  private showStartBtn = el<HTMLButtonElement>('edShowStart');
  private nameInput = el<HTMLInputElement>('edName');
  private padInput = el<HTMLInputElement>('edPadBeats');
  private createBtn = el<HTMLButtonElement>('edCreate');
  private saveBtn = el<HTMLButtonElement>('edSave');
  private exportBtn = el<HTMLButtonElement>('edExport');
  private statusEl = el<HTMLSpanElement>('edStatus');
  private savedEl = el<HTMLDivElement>('edSaved');
  private exportAllBtn = el<HTMLButtonElement>('edExportAll');
  private xmlEl = el<HTMLTextAreaElement>('edXml');
  private hideDancersChk = el<HTMLInputElement>('edHideDancers');
  private view2dChk = el<HTMLInputElement>('edView2d');
  /** The dialog the two view options live in: opened by a click on the board, closed by its button. */
  private viewDialogEl = el<HTMLDivElement>('viewDialog');
  private viewDialogClose = el<HTMLButtonElement>('viewDialogClose');

  // ---- the instance editor ----
  private instPanel = el<HTMLDivElement>('edInstancePanel');
  private instResetBtn = el<HTMLButtonElement>('edInstReset');
  private cloneBtn = el<HTMLButtonElement>('edClone');
  private instExportBtn = el<HTMLButtonElement>('edInstExport');
  private instInfoEl = el<HTMLSpanElement>('edInstInfo');
  private startFormationSel = el<HTMLSelectElement>('edStartFormation');
  private connectBtn = el<HTMLButtonElement>('edConnect');
  private endFormationSel = el<HTMLSelectElement>('edEndFormation');
  private connectEndBtn = el<HTMLButtonElement>('edConnectEnd');
  private endAutoBtn = el<HTMLButtonElement>('edEndAuto');
  private endInfoEl = el<HTMLSpanElement>('edEndInfo');
  private endPairEl = el<HTMLDivElement>('edEndPair');
  private cloneBarEl = el<HTMLDivElement>('edCloneBar');
  private cloneTextEl = el<HTMLSpanElement>('edCloneText');
  private cloneInfoEl = el<HTMLDivElement>('edCloneInfo');
  /** The Clone button's tooltip from the MARKUP, read once: the panel restores it when the clone is
   *  abandoned, and keeping the sentence in the HTML means there is only one copy of it. */
  private readonly cloneTitle = this.cloneBtn.title;
  private formationEl = el<HTMLDivElement>('edFormation');
  private scrubEl = el<HTMLInputElement>('edScrub');
  private beatReadoutEl = el<HTMLSpanElement>('edBeatReadout');
  private moveDancerSel = el<HTMLSpanElement>('edDancerPicks');
  private selNoneBtn = el<HTMLButtonElement>('edSelNone');
  private selAllBtn = el<HTMLButtonElement>('edSelAll');
  private selBoysBtn = el<HTMLButtonElement>('edSelBoys');
  private selGirlsBtn = el<HTMLButtonElement>('edSelGirls');
  private selMatchBtn = el<HTMLButtonElement>('edSelMatch');
  private moveStripEl = el<HTMLDivElement>('edMoveStrip');
  private moveInfoEl = el<HTMLSpanElement>('edMoveInfo');
  private moveAddBtn = el<HTMLButtonElement>('edMoveAdd');
  private moveDelBtn = el<HTMLButtonElement>('edMoveDel');
  /** The `asymmetric` selector, and the line that says what the export will ACTUALLY do with it. */
  private asymCb = el<HTMLInputElement>('edAsym');
  private asymInfoEl = el<HTMLSpanElement>('edAsymInfo');
  private revertBtn = el<HTMLButtonElement>('edRevert');

  /**
   * THE LAST 50 CHANGES, newest last, each holding the state as it was BEFORE that change.
   *
   * PUSHED BY THE CHANGE, NOT BY THE GESTURE THAT CAUSES IT. `commit` is the discrete path - every field, every
   * select, every button - and `applyLight` is the drag path, where a single gesture fires once per pointer
   * move. So the drag pushes ONCE, on its first move (`dragPushed`), and a fifty-move drag costs one step
   * rather than filling the history with the frames of one gesture.
   */
  private undoStack: EditorSnapshot[] = [];
  /** The state the last render left behind, and its key. See `noteState`. */
  private lastSnapshot: EditorSnapshot | null = null;
  private lastKey: unknown[] | null = null;

  private catalog = availableCalls();
  private saved: CallEdit[] = loadEdits();
  /** The call filter's text. One box, every call list - see `applyCallFilter`. */
  private callQuery = '';
  /** See `haystack`. */
  private haystacks: Map<string, string> | null = null;

  // current state
  private editSetup: CallBundle | null = null;
  private postStart: FormDancer[] | null = null;
  private preEnd: FormDancer[] | null = null;
  /** The library's name for the pre call's end formation: the start formation of a CREATED setup,
   *  and therefore what that setup is called. See `loadPre`. */
  private preEndName: string | null = null;
  private generated: CallBundle | null = null;
  private generatedName = '';

  /** The instance being edited, in FULL-SET coordinates and with no mirrors. */
  private instance: CallBundle | null = null;
  private instanceEdited = false;
  /** The instance as it was loaded from the catalogue: the REFERENCE TRACK a clone re-bases
   *  away from and then reconnects to, and what `endPoseError` is measured against. */
  private source: CallBundle | null = null;
  /** Whether Save/apply should ADD this instance as a new setup ('clone') rather than replace
   *  the one it came from ('instance'). Set by the Clone button. */
  private asClone = false;
  /**
   * WHERE THE DANCE SHOULD FINISH, and WHICH OF ITS SPOTS EACH DANCER FINISHES ON.
   *
   * `endTarget` is the named formation and its authored poses; `endOverride` is ONLY a caller's
   * correction to the pairing, kept as `dancer -> spot`. The automatic pairing is NOT stored: it is derived
   * on demand by `endPairing()` from the instance's own start poses, so it cannot go stale when a start,
   * a gender or a move changes underneath it - and an override that survives those changes stays exactly
   * what the caller said, which is the rule this editor applies to identity everywhere.
   */
  private endTarget: { name: string; poses: FormDancer[] } | null = null;
  private endOverride: number[] | null = null;
  private startFormationsLoaded = false;
  /**
   * WHICH DANCERS AN EDIT APPLIES TO, and the answer to "whose values am I looking at".
   *
   * There is no separate "focused dancer" any more: the LOWEST-numbered selected dancer IS the one the
   * tile shows and the strip lists. A caller picking a dancer to look at and a caller picking dancers
   * to change are doing the same thing, and keeping two pieces of state for it only produced a way for
   * the panel to show values that edits did not touch.
   *
   * THE LOCAL FRAME IS WHAT MAKES THE GROUP EDIT EXACT RATHER THAN APPROXIMATE. A move's translation
   * Bezier is authored in dancer-LOCAL coordinates - the origin is the dancer's spot when the move
   * begins and +X is the facing at that instant - so the SAME local control point on two dancers IS
   * the same shape, rotated and translated into each of their positions. Propagating a change needs no
   * rotation arithmetic at all: the value IS the shared description. (Only a DRAG needs the one
   * conversion, from the pointer's floor position into the dragged dancer's frame.)
   */
  private selectedDancers = new Set<number>([0]);

  /** The dancer whose values the tile shows: the lowest-numbered selected one. */
  private get moveDancer(): number {
    return this.selectedSorted()[0] ?? 0;
  }
  /** WHICH OF THE MOVE'S TWO SHAPES is selected: the translation curve or the facing curve. */
  private moveKind: 'move' | 'facing' = 'move';
  /**
   * WHICH SET OF HANDLES THE BOARD OFFERS: the curve's CONTROL POINTS, or its END POINT.
   *
   * A toggle rather than both at once, and the reason is MEASURED rather than aesthetic: the handles of a
   * curve routinely land on top of each other - over all 9994 resolved segments of the 542 catalog calls,
   * **5.5% have their control points EXACTLY coincident** (a `Stand`, or any curve whose controls collapse
   * onto the dancer's own spot) and a further **24.8% have them distinct but closer than the pick radius**
   * (`poc/tools/handle-pick-probe.mjs`), where nearest-wins has no meaning and one dot is unreachable. An
   * END POINT is the same problem one step further out: it is the point the curve finishes on, and a
   * control point can sit exactly there.
   *
   * So the two sets are never drawn together, and the mode says which one the board is showing. The END is
   * the last handle of the shape - `translate.x2/y2` for the move, `rotate.x2/y2` for the facing - which in
   * both cases is exactly what the move's END means: where the dancer is, and which way it is facing.
   */
  private handleMode: 'control' | 'end' = 'control';
  /**
   * Whether the curve being edited is LOCKED to a quarter arc, and which curve that answer is about.
   *
   * The lock is EDITING state rather than data: the `<tam>` format has no "this is an arc" flag, and
   * adding one would be inventing a field the assets cannot read. So the flag is a mode that follows
   * the selection, and `arcKey` is what makes it follow: whenever the tile is built for a different
   * (dancer, move, curve), the flag is re-initialised FROM THE DATA - a curve whose numbers already
   * are a quarter arc comes up locked, and the panel cannot claim a curve is free when it is not.
   * Unticking releases the fields without touching the curve, so an arc can be edited like any other
   * shape once the caller says so.
   */
  private arcOn = false;
  private arcKey = '';
  /** Which of the shown dancer's moves is selected in the strip. */
  private moveIndex = 0;
  /**
   * The other end of the CIRCLE run: the run is `moveIndex .. circleTo` inclusive, and null means "just the
   * selected move", so the run-level controls are only offered once a user has asked for one.
   *
   * The run starts at the selected move rather than being a free range because the strip already says which
   * move is being edited, and a second, unrelated cursor would be two answers to the same question.
   */
  private circleTo: number | null = null;
  /** The radius asked for, or null to take the run's own. */
  private circleRadius: number | null = null;
  /**
   * A centre the caller has NAMED, or null to let each dancer's own run say where its centre is.
   *
   * Naming one is a different edit from naming a radius, and the difference is what makes it useful: the run's
   * START is pinned, so the distance from the centre to that start IS the radius - which means moving the
   * centre can only resize, and "put the centre here" re-centres an orbit on the thing it should have been
   * going round. `ms/circle.xml`'s `Circle Left` from a `Circle` is the case: the dancers stand on a ring of
   * radius 2.613 about the origin and walk an orbit of radius 2.595 centred 1.013 units off it.
   */
  private circleCentre: { x: number; y: number } | null = null;
  /** Which way round. The discrete half of the parameterisation - the radius is the continuous half. */
  private circleSide: 1 | -1 = 1;
  /**
   * THE COPIED END POINTS, or null when nothing has been copied.
   *
   * Asked for: "Add [C]opy/[Pa]PasteAbsolute/[Pr]PasteRelative buttons to each Move pane, beside the 'arc'
   * checkbox, that keeps a local copy of the move x/y end coordinates and can paste them back at a later date
   * (if it was changed by deleting/adding other Moves)."
   *
   * BOTH PAIRS ARE STORED, and that is the whole reason there are two paste buttons rather than one. Deleting
   * or adding a move earlier in the track leaves every later move's LOCAL numbers alone and moves where they
   * land on the FLOOR; re-aiming a move, or re-basing a clone, moves the local numbers under a floor position
   * that has not changed. One stored pair cannot answer both, so the copy holds the relative pair AND the
   * board pair as they were, and each paste button puts one of them back.
   *
   * ONE ENTRY PER MOVE IN THE RUN, in strip order, so a run can be taken and put back as a run.
   *
   * IT IS NOT PART OF THE UNDO STATE. It is not a change to the call - it is a thing the caller is holding -
   * so a revert must not clear it or put an older one back.
   */
  /**
   * THE POINT EACH COPIED MOVE IS HOLDING, KEYED ON THE MOVE ITSELF.
   *
   * Asked for: "each Users Move has it's own copy of the coordinates. If multiple Dancers and Moves are enabled,
   * they copy their own specific coordinates. These copied coordinates are only available to that specific
   * move." So this is not a clipboard the panel owns - there is no list, and there is nothing to pair up: a
   * move either is holding a point or is not, and only that move can paste it.
   *
   * THE KEY IS THE `Seg` OBJECT, and the engine makes that free: `setMove` clones ONLY the move it writes
   * (`moves.map((s, k) => k === i ? cloneSegs([seg])[0] : s)`), `addMove` splices one in and `removeMove`
   * splices one out, and all three end in a SHALLOW `retime` - so a move that was not the one written keeps its
   * object identity across a delete, an insert and an edit of any other move. Which is the whole answer to
   * "will the copy cope with deleting a Move": deleting a move in front of a copied one shifts every INDEX down
   * by one and changes no object, so the copy is still on the move it was taken from. An index cannot do that.
   *
   * THE ONE HOLE IS THE MOVE BEING WRITTEN, whose object `setMove` replaces by design, and `carryMoveClips`
   * closes it by re-registering the replaced move's point on the object that replaced it.
   *
   * A WeakMap, because a move that is deleted should take its point with it rather than leak.
   */
  private moveClips = new WeakMap<Seg, MoveClip>();
  /**
   * The editor's OWN playhead, in THE CALL'S OWN BEATS - 0 at the first move of the first dancer, `beats` at
   * the end of the last one. The animation is OFF while editing an instance, so this is the only thing that
   * moves the dancers - and it has to be remembered HERE because every edit re-shows the instance and
   * re-showing parks the playhead at the lead-in.
   *
   * THE CALL'S CLOCK, NOT THE TIMELINE'S. A `<tam>` declares a `leadin` and a `leadout` - two beats each in
   * the whole corpus - which the player draws as dead time before the first move and after the last, and
   * `moveBeatRange` measures the moves from ZERO regardless of them. Asked for: "the call edit scrub progress
   * bar has a 2 second intro and outro that dont actually exist in the call Moves. Can these fictitious dead
   * beats be removed." So the scrub spans `[0, beats]` and this field is in the same units the moves are,
   * and `+ leadin` is applied only where the STAGE is told where to stand - see `absoluteEditBeat`.
   */
  private editBeat = 0;

  /** The editor's playhead in the PLAYER's absolute beats (0 = the start of the lead-in, as `seekAbsolute` says). */
  private absoluteEditBeat(call: CallBundle | null): number {
    return this.editBeat + (call?.leadin ?? 0);
  }
  /** The `data-key` of the field being edited, so re-rendering after a commit can put the
   *  focus back where it was (a `change` on a number input fires on blur, but it also fires
   *  on every spin-button click). */
  private focusKey: string | null = null;

  constructor(stage: Stage, host: EditorHost) {
    this.stage = stage;
    this.host = host;

    this.populateLevels();
    // The same call the Find box and the level selector make, so the panel opens with its readout
    // filled in and the three lists showing the same view a change to either control would produce.
    this.applyCallFilter();

    this.wireEvents();
    this.wireHandleDrag();
    this.wireBoardClick();
    this.fillSetupSelect(this.editSetupSel, this.editCallSel.value);
    this.fillSetupSelect(this.postSetupSel, this.postCallSel.value);
    this.fillSetupSelect(this.preSetupSel, this.preCallSel.value);
    this.loadEditSetup();
    this.loadInstance();
    this.loadPost();
    this.loadPre();
    this.applyMode();
  }

  // ---- geometry helpers ----

  private callStart(c: CallBundle): FormDancer[] {
    return c.dancers.map((d) => {
      const p = poseFor(d, 0);
      return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
    });
  }
  private callEnd(c: CallBundle): FormDancer[] {
    return c.dancers.map((d) => {
      const p = poseFor(d, c.beats);
      return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
    });
  }
  private alignToSetup(c: CallBundle, formation: FormDancer[]): FormDancer[] {
    return alignFormationToCore(this.callStart(c), formation);
  }

  private staticCall(name: string, form: FormDancer[]): CallBundle {
    const dancers = form.map((f) => ({
      gender: (f.gender ?? 'boy') as Gender,
      x: f.x,
      y: f.y,
      angleDeg: (f.heading * 180) / Math.PI,
      path: [{ beats: 1, hands: 'both' as Hands, translate: { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 }, rotate: null }],
    }));
    // A still frame is a legitimate call bundle: it needs the same bookkeeping fields as any
    // other, including the sequencer flags this used to leave off.
    return {
      title: name,
      from: name,
      // NULL: a still frame is authored INLINE, dancer by dancer, so it declares no formation NAME.
      // It reaches the level-scoped state vocabulary the same way any inline setup does - through its
      // GEOMETRY (`allVariantSetups()`), which is what `formation` being null means everywhere else.
      formation: null,
      parts: '',
      taminator: '',
      dancers,
      beats: 1,
      leadin: 0,
      leadout: 0,
      totalBeats: 1,
      sequencerMode: null,
      forSequencer: true,
      // A still frame is written out dancer by dancer, so it is a WHOLE set: symmetry 1, take the
      // dancers as they stand. The alternative - completing them - would double a four-dancer form.
      symmetry: 1,
    };
  }

  private fillSetupSelect(sel: HTMLSelectElement, callId: string) {
    sel.innerHTML = '';
    effectiveSetups(callId).forEach((s, i) => sel.add(new Option(s.label, String(i))));
  }

  // ---- the call filter ----

  /**
   * Fill the LEVEL selector, and choose its default.
   *
   * MS IS THE DEFAULT because it is where a caller's own authoring normally belongs, and because the
   * panel used to open on whatever call happens to sort first in a catalogue of every level the app
   * ships - which is not a choice anybody made. `All levels` stays available: the level narrows what
   * the lists OFFER, and a selector with no way back to the whole catalogue would make every other
   * level unreachable from the editor.
   *
   * The list itself comes from the loaded catalogue, not from a hard-coded level list, so a level the
   * app has no calls for cannot be offered - the same rule the browse and sequence views use.
   */
  private populateLevels() {
    this.levelSel.add(new Option('All levels', ''));
    for (const lv of availableLevels()) this.levelSel.add(new Option(lv.toUpperCase(), lv));
    // Only if the catalogue really has it: `value` on a select ignores an id it does not hold, which
    // would silently leave the first option selected and the default a lie.
    if (Array.from(this.levelSel.options).some((o) => o.value === DEFAULT_LEVEL)) this.levelSel.value = DEFAULT_LEVEL;
  }

  /** Lazily built lower-cased haystacks for the filter: level, title, file and every setup
   *  label. Built once, because the catalogue does not change while the app runs and this is
   *  read on every keystroke (three selects x the whole catalogue). */
  private haystack(c: CallInfo): string {
    if (!this.haystacks) {
      this.haystacks = new Map(
        this.catalog.map((x) => [x.id, `${x.level} ${x.title} ${x.file} ${x.setups.map((s) => s.from).join(' ')}`.toLowerCase()]),
      );
    }
    return this.haystacks.get(c.id) ?? '';
  }

  /**
   * Re-populate a call select from the catalogue, narrowed by the panel's filter.
   *
   * THE CURRENT SELECTION IS ALWAYS KEPT, re-inserted at the top when the filter excludes it,
   * and that is not politeness. Clearing a select's options moves its `value` onto whatever
   * survived, and no `change` event fires - so a filter typed over the top of the chosen call
   * would leave the PANEL showing one call while the editor's state still held another, with
   * nothing to reconcile them. Keeping the selection makes the filter a pure VIEW of the
   * catalogue: it can only ever change which calls you can reach, never which one you have.
   */
  private fillCallSelect(sel: HTMLSelectElement, keepId: string): number {
    const terms = this.callQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const level = this.levelSel.value;
    // THE TITLE ALONE. The list used to lead every entry with its level (`MS · Circle Left`), which
    // was the only way to tell the levels apart while one list held all of them - and it made every
    // name longer for a fact the LEVEL selector now states once, above the list. `All levels` is the
    // one case where the entry no longer carries its level; the order still groups them.
    const label = (c: CallInfo) => c.title;
    sel.innerHTML = '';
    const keep = this.catalog.find((c) => c.id === keepId) ?? null;
    let kept = false;
    let found = 0;
    for (const c of this.catalog) {
      // The level narrows the list exactly as the Find box does, and for the same reason: it is a
      // VIEW of the catalogue. `All levels` (`''`) is not a level, so it matches everything.
      if (level && c.level !== level) continue;
      if (!terms.every((t) => this.haystack(c).includes(t))) continue;
      found++;
      sel.add(new Option(label(c), c.id, false, c.id === keepId));
      if (c.id === keepId) kept = true;
    }
    if (keep && !kept) {
      const opt = new Option(`▸ ${label(keep)}`, keep.id, false, true);
      opt.title = 'kept — this is the call you have selected, and the filter excludes it';
      sel.insertBefore(opt, sel.firstChild);
    }
    if (sel.options.length === 0) {
      // Only reachable when the select held no valid id to begin with.
      const opt = new Option('no call matches', '');
      opt.disabled = true;
      sel.add(opt);
    }
    return found;
  }

  /**
   * Apply the filter to every call list in the panel.
   *
   * One box narrows all three (edit, post and pre) because they are the same list, and a
   * filter that quietly worked for one of three identical controls would be its own bug -
   * the input's tooltip says so. The terms are ANDed substrings over the level, title, file
   * and setup labels, so "ms circle" and "static square" both read the way they should.
   */
  private applyCallFilter() {
    const found = this.fillCallSelect(this.editCallSel, this.editCallSel.value);
    this.fillCallSelect(this.postCallSel, this.postCallSel.value);
    this.fillCallSelect(this.preCallSel, this.preCallSel.value);
    // The readout is the panel's account of WHY a list is short, so it names the level whenever the
    // level is doing any narrowing at all - matching what the Find box already did for its terms.
    const bits: string[] = [];
    const level = this.levelSel.value;
    if (level) bits.push(level.toUpperCase());
    if (level || this.callQuery.trim()) bits.push(`${found} of ${this.catalog.length} calls`);
    this.callFoundEl.textContent = bits.join(' · ');
  }

  // ---- loading ----

  private loadEditSetup() {
    const id = this.editCallSel.value;
    const tam = parseInt(this.editSetupSel.value || '0', 10);
    try {
      this.editSetup = loadCall(id, tam, true);
      this.show(this.staticCall(`edit setup start — ${this.editSetup.title}`, this.callStart(this.editSetup)));
      this.refreshFixInfo();
    } catch (err) {
      this.editSetup = null;
      this.statusEl.textContent = `edit call failed: ${(err as Error).message}`;
    }
    this.renderSaved();
  }

  /**
   * Load the selected call INSTANCE into the instance editor.
   *
   * `normalizeInstance` is applied on load, so every number in the table is a FULL-SET
   * coordinate: a `<tam>` authored for half the set publishes its four dancers in half-set
   * space, and letting a caller edit those numbers would move a dancer to the mirror image
   * of the spot that was typed. The engine's test proves the normalization does not move
   * anybody (worst pose gap 2.3e-15 units).
   */
  private loadInstance() {
    const id = this.editCallSel.value;
    const tam = parseInt(this.editSetupSel.value || '0', 10);
    this.ensureStartFormations();
    try {
      // `source` is the REFERENCE TRACK: what a clone re-bases away from and reconnects to.
      // A NEW CALL HAS NO HISTORY: the steps in the stack describe a different call, so putting one back
      // would swap the instance out from under the lists that name it.
      this.clearUndo();
      // AND NO COPIED POINTS: a copy describes a move of the call it was taken from, in that call's frames, so
      // pasting it into a different call would put a point on the floor that nobody chose. A fresh WeakMap is
      // both the clear and the tidy-up - the old call's segments become unreachable with it.
      this.moveClips = new WeakMap<Seg, MoveClip>();
      this.source = normalizeInstance(loadCall(id, tam, true));
      this.instance = this.source;
      this.instanceEdited = false;
      this.asClone = false;
      // THE SELECTOR OPENS ON WHAT THE LOADED CALL DECLARES, which is `symmetry === 1`, i.e. the tam
      // saying `asymmetric="true"`. So a call that IS explicit opens ticked, and the corpus's own
      // half-set tams and every created call open UNTICKED - the default.
      this.asymCb.checked = this.instance.symmetry === 1;
      this.renderAsymInfo();
      this.moveIndex = 0;
      // The run, the radius and the centre belong to the track that was being edited, so a new one starts
      // with none of them.
      this.circleTo = null;
      this.circleRadius = null;
      this.circleCentre = null;
      this.circleSide = 1;
      this.selectedDancers = new Set([0]);
      this.startFormationSel.value = '';
      // A NEW instance starts with no end target: both re-bases belong to the setup that was loaded, so
      // loading another one must not leave a stale target (or a stale pairing) behind.
      this.endFormationSel.value = '';
      this.endTarget = null;
      this.endOverride = null;
      // A NEW instance starts at its own first beat, with the animation off.
      this.editBeat = 0;
      // The board is only borrowed while this panel is on screen; showInstance -> showAt is where that is decided.
      this.showInstance(this.instance);
      this.renderInstance();
    } catch (err) {
      this.instance = null;
      this.source = null;
      this.statusEl.textContent = `edit call failed: ${(err as Error).message}`;
      this.renderScrub(null);
      this.renderInstance();
    }
  }

  private loadPost() {
    try {
      const c = loadCall(this.postCallSel.value, parseInt(this.postSetupSel.value || '0', 10), true);
      this.postStart = this.callStart(c);
      this.statusEl.textContent = `post start — ${c.title}`;
    } catch (err) {
      this.postStart = null;
      this.statusEl.textContent = `post call failed: ${(err as Error).message}`;
    }
    this.refreshFixInfo();
  }

  private loadPre() {
    try {
      const c = loadCall(this.preCallSel.value, parseInt(this.preSetupSel.value || '0', 10), true);
      this.preEnd = this.callEnd(c);
      // THE PRE CALL'S END FORMATION, by name. It is the formation a CREATED position starts from,
      // so it is what that setup should be called - and it is one gated engine call away
      // (`boardAtBeat` reads the board, the host names it), not a guess. Without it the only name
      // available to the editor was a pair of CALL names, which is exactly what a setup name must
      // not be.
      this.preEndName = this.host.nameBoard(boardAtBeat(c, c.beats));
      this.statusEl.textContent = `pre end — ${c.title}${this.preEndName ? ` → ${this.preEndName}` : ''}`;
    } catch (err) {
      this.preEnd = null;
      this.preEndName = null;
      this.statusEl.textContent = `pre call failed: ${(err as Error).message}`;
    }
  }

  // ---- closure discrepancy ----

  private fixDiscrepancy(): { posErr: number; maxHead: number } {
    const editEnd = endPoses(this.editSetup!);
    const fit = rigidFit(editEnd.map((p) => ({ x: p.x, y: p.y })), this.postStart!.map((p) => ({ x: p.x, y: p.y })));
    let maxHead = Infinity;
    const ROTS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    for (const rot of ROTS) {
      let m = 0;
      for (let i = 0; i < Math.min(editEnd.length, this.postStart!.length); i++) {
        let d = editEnd[i].heading - this.postStart![i].heading - rot;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d <= -Math.PI) d += 2 * Math.PI;
        m = Math.max(m, Math.abs(d));
      }
      if (m < maxHead) maxHead = m;
    }
    return { posErr: fit.error, maxHead };
  }

  private refreshFixInfo() {
    if (!this.editSetup || !this.postStart) {
      this.fixInfoEl.textContent = 'pick an edit call+setup and a post call+setup';
      return;
    }
    const { posErr, maxHead } = this.fixDiscrepancy();
    this.fixInfoEl.textContent =
      `end formation ${posErr.toFixed(2)} apart from post-call start (rigid fit)` +
      (maxHead > 0.1 ? `, headings up to ${((maxHead * 180) / Math.PI).toFixed(0)}° apart` : '');
  }

  // =================================================================== instance editing

  /** What the instance editor shows for the current mode. */
  private isInstanceMode(): boolean {
    return this.modeSel.value === 'instance';
  }

  /**
   * The saved name of a generated setup: THE FORMATION ITSELF, with no call name in it.
   *
   * A setup lives INSIDE a call's `<tam>` list, so the call is already the address and repeating it
   * in the label is redundant - and it is not what the corpus does: every shipped setup is labelled
   * by its `from` alone ("Static Square", "Facing Couples"). A generated one is no different, and the
   * dropdown and the saved list now read the same way. `loadCall` resolves a setup by its (call,
   * index) pair, so nothing about uniqueness depended on the call name here.
   */
  private instanceName(call: CallBundle): string {
    return call.from || 'default';
  }

  /**
   * Show the instance with the animation OFF and the playhead where the caller left it.
   *
   * EVERY instance preview goes through here. Editing a move re-shows the instance, and re-showing
   * calls `Player.setCall`, which parks the playhead at the lead-in - so without re-applying
   * `editBeat` the dancers would jump back to the start on every keystroke, and the scrub would be
   * useless for the one thing it is for.
   */
  private showInstance(call: CallBundle) {
    this.showAt(call, this.editBeat + call.leadin);
    this.renderScrub(call);
  }

  /**
   * Show a call on the board - IF THIS PANEL IS THE ONE ON SCREEN.
   *
   * EVERY preview in this file goes through here, and that is the whole point. The board belongs to the BROWSE
   * view: `host.preview` sets the player's call AND the browse panel's legend. This panel borrows it, and its
   * constructor loads an instance, a fix setup and a mode before the editor has ever been visible - the app
   * opens on Browse - so each of those paths painted the editor's call over the browse view, and the LAST
   * writer won. MEASURED in a browser (a stack captured on the legend's `innerHTML` setter): the constructor
   * previewed "edit setup start - ..." from `loadEditSetup` and then the raw instance from `applyMode`, leaving
   * the board on the editor's call while the browse dropdown named its own. Guarding one of those paths fixed
   * nothing; there are eight, and one place has to decide.
   */
  private show(call: CallBundle): void {
    if (this.active) this.host.preview(call);
  }

  /** The same rule for a preview that also places the playhead. See `show`. */
  private showAt(call: CallBundle, beat: number): void {
    if (this.active) this.host.previewAt(call, beat);
  }

  /** The editor's own progress bar: its value IS the beat, and the animation is off. */
  private renderScrub(call: CallBundle | null) {
    if (!call) {
      this.beatReadoutEl.textContent = '';
      return;
    }
    // THE CALL'S OWN BEATS, NOT `totalBeats`. `totalBeats` is `leadin + beats + leadout`, so a bar over it
    // spends its first and last two beats on time in which no move happens - the dead intro and outro the
    // caller asked to be rid of. The moves run from 0 to `beats` on the call's own clock.
    const total = call.beats || 1;
    this.scrubEl.max = String(total);
    // A HUNDREDTH OF A BEAT. The bar was in quarter beats, which is coarse for the job it does here -
    // placing a dancer while shaping a curve needs fine adjustment, and at this step a drag across
    // the bar is finer than one step per pixel (so the movement is smooth as well as precise) and the
    // arrow keys nudge by 0.01 while Page Up/Down move by 0.1.
    this.scrubEl.step = '0.01';
    const b = Math.max(0, Math.min(total, this.editBeat));
    // Never write into the control the caller is dragging: the value is theirs while the pointer is
    // down, and a write that lands mid-gesture is the classic way a scrubber starts fighting back.
    if (document.activeElement !== this.scrubEl) this.scrubEl.value = String(b);
    const parts = call.parts ? call.parts.split(';') : [];
    let acc = 0;
    let idx = -1;
    // `parts` is authored against the call's own clock, which is what `b` is now - the subtraction that used
    // to be here is gone with the dead beats.
    for (let k = 0; k < parts.length; k++) {
      acc += parseFloat(parts[k]);
      if (b >= acc) idx = k + 1;
    }
    this.beatReadoutEl.textContent = `beat ${b.toFixed(2)} / ${total.toFixed(2)}` + (idx >= 0 ? ` · part ${idx + 1}/${parts.length}` : '');
  }

  /** The selected dancers, in index order. */
  private selectedSorted(): number[] {
    return [...this.selectedDancers].sort((a, b) => a - b);
  }

  /**
   * THE DANCERS WHOSE MOVE HERE IS THE SAME SHAPE AS THE ONE THE TILE SHOWS.
   *
   * This is `matching`, and it is built out of the SAME comparison the coordinate lock uses (`sameCurve`,
   * which is the gate itself) rather than a second definition of "the same move": the set it returns is
   * therefore a set the fields will accept, by construction. The reference is the lowest selected dancer's
   * move at the selected index - the same dancer the tile is showing - so "matching" answers "who else is
   * doing this, here".
   *
   * `curve` is the tab's curve, because that is what an edit writes: the Move tab selects the dancers whose
   * PATHS match, the Facing tab those whose TURN matches.
   */
  private matchingDancers(curve: CurveKind): number[] {
    const call = this.instance;
    if (!call) return [];
    const ref = call.dancers[this.moveDancer]?.path[this.moveIndex];
    if (!ref) return [];
    const out: number[] = [];
    for (let j = 0; j < call.dancers.length; j++) {
      const seg = call.dancers[j]?.path[this.moveIndex];
      if (seg && sameCurve(ref, seg, curve)) out.push(j);
    }
    return out;
  }

  /**
   * MAKE ONE DANCER AGREE with the selected ones, by copying their coordinates into its move here.
   *
   * Asked for as: "Add a link symbol next to the dancers that dont match, that will correct the non-matching
   * coordinates using the matching coodinates. Remove the link once they do match and select the now matching
   * dancer."
   *
   * WHAT IS COPIED IS THE CURVE THE TAB EDITS, and nothing else - the beats and the hands are left alone, which
   * is the same line the coordinate gate draws: it compares SHAPES, and unifying a timing across a selection is
   * a legitimate separate edit.
   *
   * THE FACING TAB COPIES `rotate ?? translate`, AND THAT IS NOT THE SAME AS COPYING `rotate`. A dancer with no
   * rotation curve faces along its own travel tangent - that is what `poseFor` implements and what
   * `sameFacingCurve` compares - so copying a NULL would leave the dancer facing by its own path and it still
   * would not match. Copying the EFFECTIVE facing as an explicit curve makes the two identical BY CONSTRUCTION,
   * which is what "correct them using the matching coordinates" has to mean if the link is to disappear.
   *
   * MATCHING BY CONSTRUCTION RATHER THAN BY HOPE: afterwards `sameTravel` compares a curve with itself (gap 0)
   * and `sameFacing` compares two identical profiles, so the link is guaranteed to go - and the caller's own
   * gate has already decided the set was worth widening.
   */
  private matchDancer(i: number, curve: CurveKind) {
    const call = this.instance;
    if (!call) return;
    const ref = call.dancers[this.moveDancer]?.path[this.moveIndex];
    const seg = call.dancers[i]?.path[this.moveIndex];
    if (!ref || !seg || i === this.moveDancer) return;
    const source = curve === 'facing' ? ref.rotate ?? ref.translate : ref.translate;
    const patched: Seg = curve === 'facing' ? { ...seg, rotate: { ...source } } : { ...seg, translate: { ...source } };
    // THE SELECTION FIRST, so the re-render `commit` does shows the dancer both corrected and picked - the two
    // halves of what was asked for arrive in one frame rather than one after the other.
    this.selectedDancers.add(i);
    this.commit(setMove(call, i, this.moveIndex, patched));
    this.statusEl.textContent = `dancer ${i + 1} now ${curve === 'travel' ? 'moves' : 'faces'} with the selection`;
  }
  /** The curve the tile is editing, which is the one `matching` and the lock are asked about. */
  private tabCurve(): CurveKind {
    return this.moveKind === 'facing' ? 'facing' : 'travel';
  }

  /**
   * REPLACE the selection with a set, whoever asked. The one writer of `selectedDancers` outside the
   * per-dancer ticks, so every bulk pick ends in the same re-render and the same stage sync.
   *
   * AN EMPTY SET IS A LEGAL STATE NOW, and that is `none`'s whole purpose: it is how a caller clears eight
   * ticks before picking two. What it must NOT be is a state where the panel still shows numbers and the
   * edits go nowhere - so the empty set is reported where the tile would be, no handles are drawn, and the
   * coordinate gate refuses (`foldMoveChange` already returns null for it: there is nothing to fold).
   */
  private setDancerSelection(next: number[], what: string) {
    this.selectedDancers = new Set(next);
    this.renderInstance();
    const n = this.selectedDancers.size;
    this.statusEl.textContent = n === 0 ? 'no dancers selected — edits have nowhere to go' : `${what}: ${n} dancer${n === 1 ? '' : 's'} selected`;
  }

  /** The bulk picks, and what each of them can currently do. */
  private renderSelectRow() {
    const call = this.instance;
    const sel = this.selectedSorted();
    // `matching` needs something to match FROM and a selection that already agrees - the rule as asked for:
    // it WIDENS a set that can be edited together, and it is not a way to select a disagreeing set.
    const agrees = sel.length > 0 && this.coordinatesAgree(this.tabCurve());
    const matches = agrees ? this.matchingDancers(this.tabCurve()) : [];
    const boys = call ? call.dancers.filter((d) => d.gender === 'boy').length : 0;
    const girls = call ? call.dancers.filter((d) => d.gender === 'girl').length : 0;
    // The move buttons need a dancer for the same reason the fields do: `+ Move` on nobody is not a move.
    this.moveAddBtn.disabled = !call || sel.length === 0;
    this.moveDelBtn.disabled = !call || sel.length === 0;
    this.selMatchBtn.disabled = !agrees;
    this.selAllBtn.disabled = !call;
    this.selBoysBtn.disabled = !call || boys === 0;
    this.selGirlsBtn.disabled = !call || girls === 0;
    this.selNoneBtn.disabled = !call || sel.length === 0;
    // THE EXPLANATION IS A HOVER, NOT A LINE OF TEXT. The row used to print a sentence about what matching
    // was looking at, which is one line of prose between the buttons and the table - and a sentence a caller
    // reads once and then reads past is noise on every render. It is the same sentence, in the tooltip,
    // where it is there when the question is asked and nowhere when it is not. The button's LABEL keeps the
    // count, because a number is not prose and it is the one thing worth seeing before the click.
    this.selMatchBtn.textContent = matches.length ? `matching (${matches.length})` : 'matching';
    const what = this.tabCurve() === 'travel' ? 'path' : 'turn';
    this.selMatchBtn.title = !call
      ? 'Select a call first'
      : sel.length === 0
        ? `Select some dancers to start from — matching widens a set that can be edited together, so it needs one. It picks every dancer whose ${what} here is the same as the dancer the tile is showing's.`
        : agrees
          ? `${matches.length} of the ${call.dancers.length} dancers share this ${what} with dancer ${this.moveDancer + 1} — click to select them. That is the same comparison the coordinate lock makes, so the set can be edited together.`
          : `The selected dancers do not share this ${what} here, so matching has nothing to match on. Select dancers that already agree, or one dancer, and matching then picks everyone else doing the same thing.`;
  }

  /**
   * Whether every selected dancer's move at this index carries the SAME LOCAL COORDINATES ON THE CURVE
   * BEING EDITED - which is what "the same shape, rotated to each position" means, and the only case
   * where ONE set of numbers describes them all.
   *
   * THE FIELDS ARE LOCKED WHEN THEY DIFFER, and this is the reason. Writing a number into a field writes
   * it to EVERY selected dancer, so on a selection whose curve disagrees it would silently collapse
   * genuinely different shapes into one - destroying, in a keystroke, the per-dancer difference the
   * caller was looking at. Where they agree the write is a no-op in meaning (the same shape stays the
   * same shape), which is exactly when it is safe.
   *
   * `curve` IS THE CURVE THE EDIT WRITES (see `sameCurve`), because asking about the other one locks a
   * tab whose own numbers are unanimous.
   *
   * The BEATS and HANDS are deliberately not gated: they are not coordinates, and unifying a timing or
   * a hold across a selection is a legitimate group edit rather than a collapse of geometry.
   */
  private coordinatesAgree(curve: CurveKind): boolean {
    const call = this.instance;
    if (!call) return true;
    const sel = this.selectedSorted();
    // NOWHERE TO WRITE. `none` is a legal selection (see `setDancerSelection`), and the fields are locked
    // for it rather than live: a field that accepted a number and wrote it to nobody would be the silent
    // no-op this panel refuses everywhere else.
    if (sel.length === 0) return false;
    if (sel.length < 2) return true; // one dancer is always editable
    const first = call.dancers[sel[0]]?.path[this.moveIndex];
    if (!first) return false;
    for (const d of sel.slice(1)) {
      const seg = call.dancers[d]?.path[this.moveIndex];
      if (!seg || !sameCurve(first, seg, curve)) return false;
    }
    return true;
  }

  /**
   * Apply a PER-DANCER change to the selected dancers' same-numbered move.
   *
   * THE CHANGE IS A FUNCTION OF THE DANCER'S OWN SEGMENT, not a finished segment. That is the whole
   * difference between "set this control point on all of them" and "copy this dancer's whole move
   * onto the others": a patch built from the focused dancer's translate would overwrite every other
   * dancer's OTHER control points with the focused one's, which is exactly the per-dancer difference
   * the caller is trying to keep.
   *
   * A selected dancer with no move at that index is SKIPPED rather than given one: the dancers of a
   * call do not always have the same number of moves, and inventing a move would change the track.
   */
  private commitMoveChange(f: (seg: Seg) => Seg, focusKey: string, light = false, curve: CurveKind | null = null) {
    // NOWHERE TO WRITE IS REFUSED OUT LOUD. Every write in the tile comes through here, including the ones
    // the coordinate gate does not cover (beats, hands, the explicit-facing box), and a write to an empty
    // selection would otherwise be a keystroke that quietly did nothing.
    if (this.selectedDancers.size === 0) {
      this.statusEl.textContent = 'no dancers selected — pick dancers above the table, or the edit has nowhere to go';
      return;
    }
    // THE COORDINATE GATE, enforced HERE as well as in the fields, because the drag path reaches this
    // without going through them: a coordinate change on a selection whose curve differs would collapse
    // them into one shape, which is the whole thing `coordinatesAgree` exists to prevent.
    if (curve && !this.coordinatesAgree(curve)) return;
    const next = this.foldMoveChange(f, curve);
    if (!next) return;
    if (!light) {
      this.commit(next, focusKey);
      return;
    }
    this.applyLight(next);
  }

  /**
   * THE DRAG PATH: new geometry, no view rebuild and no DOM rebuild - because this runs on every pointer
   * move, and rebuilding eight dancer views and a hundred table inputs per move is the difference between a
   * drag and a slideshow. The playhead is re-applied because it is parked.
   *
   * The numbers are the ONE part of the panel that must not wait for the gesture to end: they are what the
   * caller is steering by. Writing them is eight field assignments, not a rebuild.
   */
  private applyLight(next: CallBundle) {
    // THE DRAG WRITES HERE, so it needs the same carry: a drag that moves the copied end point would otherwise
    // drop the copy on the first pointer move.
    this.carryMoveClips(this.instance, next);
    this.instance = next;
    this.instanceEdited = true;
    this.host.updateCall(next);
    this.host.setPlayhead(this.absoluteEditBeat(this.instance));
    this.renderHandles();
    this.refreshNumberFields();
  }

  /** The selected dancers' move, each changed by `f` in its OWN frame. Null when nothing applies.
   *
   *  A FACING write goes through here like any other. It cannot be "just the facing": the heading a move
   *  ends on IS the frame the next move is played in - the format composes `tx * translate * rotate` per
   *  move (`taminations-flutter/lib/math/path.dart`, `Path.recalculate`) - so turning it turns every later
   *  heading AND swings every later segment round the floor. MEASURED (`poc/tools/facing-chain-probe.mjs`):
   *  10deg of extra end heading rotates every later boundary pose rigidly about the pose the move ends on
   *  and carries the call's end 0.42 units across the board. That is what the dance means, and the Facing
   *  tab says so rather than pretending otherwise; `engine/test/editor.mjs` 19 pins it.
   *
   *  THE COMPOSITION IS THE FORMAT'S, BUT THE GESTURE MUST NOT EXPOSE IT THAT WAY. Because the same angle
   *  turns the facing and the following path, the angle BETWEEN them is a constant of the data - so the
   *  facing controls could not set the one relationship a facing expresses, reported as "I cannot face the
   *  dancer without corrupting the next follow path". A facing write therefore HOLDS THE FOLLOWING TRACE:
   *  `holdFollowingTrace` turns each later path about its own start by the same angle, leaving every later
   *  position and floor direction exactly as they were and moving only the headings. The facing rotates and
   *  the follow direction does not, which is what the control says it does.
   *
   *  The delta is PER DANCER, because the selection shares the local numbers and not the frame they land
   *  in. It compounds correctly through a drag: each pointer move writes the facing ABSOLUTELY and holds
   *  the tail by the step since the last one, so the accumulated hold is the whole of the edit. */
  private foldMoveChange(f: (seg: Seg, dancer: number) => Seg, curve: CurveKind | null = null, at = this.moveIndex, base = this.instance): CallBundle | null {
    const call = base;
    if (!call) return null;
    let next = call;
    let changed = false;
    for (const d of this.selectedSorted()) {
      const seg = next.dancers[d]?.path[at];
      if (!seg) continue;
      const before = bezierAngle(seg.rotate ?? seg.translate, 1);
      // THE DANCER COMES WITH THE SEGMENT, because an absolute write is per-dancer: the selection shares a
      // LOCAL end point, not the frame it lands in, so the conversion has to be done inside this loop.
      const patched = f(seg, d);
      next = setMove(next, d, at, patched);
      changed = true;
      // A change to the heading the move ends on is the whole of what swings the tail. A `cx1` drag does
      // not move it, so that gesture is left exactly as it was.
      if (curve === 'facing') {
        const delta = normAngle(bezierAngle(patched.rotate ?? patched.translate, 1) - before);
        if (delta !== 0) next = holdFollowingTrace(next, d, at, delta);
      }
    }
    return changed ? next : null;
  }

  /**
   * The circle to lay ONE dancer's run on, from that dancer's own two ends - or null when there is none.
   *
   * THE ENDS ARE TAKEN FROM THE DANCER'S OWN PATH, not shared across the selection. Eight dancers circling one
   * centre start and finish in eight different places, so what a group edit can hold in common is the RADIUS
   * (and the side); the centre is whatever follows from each dancer's own run. That is also why this cannot be
   * one `RunCircle` for the whole selection.
   *
   * A RUN THAT IS ALREADY A CIRCLE KEEPS ITS CENTRE, and only its radius and its turn are touched. That is not
   * a refinement, it is the difference between working and destroying the call. MEASURED (`ms/circle.xml`, the
   * 360deg `Circle Left`): two points on a circle admit TWO arcs, the endpoints do not say which, and this run's
   * ends are **0.055** apart on a radius of 2.595 - so the chord is nearly a point and the side of it the
   * centre falls on is not a decision the geometry can support. Choosing by the chord gave the run a **1.2deg**
   * arc through those ends and collapsed a 16.34-unit orbit to **0.06**, which is what a caller saw as a single
   * drag point and no trail. A run that already has a centre does not need to be told one, and the turn it
   * already takes is the turn to keep.
   *
   * A RUN THAT IS NOT A CIRCLE HAS NO CENTRE TO KEEP, so there the ENDS are the anchor and the radius and side
   * are what the caller supplies - which is the case the "both ends are kept exactly" property belongs to.
   */
  private circleFor(call: CallBundle, d: number, from: number, to: number, radius: number | null, side: 1 | -1, centre: { x: number; y: number } | null): RunCircle | null {
    const dancer = call.dancers[d];
    if (!dancer || to <= from || to >= dancer.path.length) return null;
    const p0 = poseFor(dancer, from === 0 ? 0 : moveBeatRange(dancer, from - 1).to);
    const p1 = poseFor(dancer, moveBeatRange(dancer, to).to);
    const own = fitCircleRun(call, d, from, to);
    const turn = own ? (side === 1 ? own.sweep : -own.sweep) : runTurn(call, d, from, to);
    // A CENTRE THE CALLER NAMES IS SHARED AND THE RADIUS FOLLOWS FROM WHERE EACH DANCER STARTS, and that is the
    // whole reason a named centre needs no radius field: the start is pinned, so |start - centre| IS the radius.
    // It is also what makes "put the centre here" the right gesture for an ORBIT rather than a translation -
    // moving the centre while the start stays put can only resize, and for `ms/circle.xml`'s `Circle Left` that
    // is exactly the correction wanted: its dancers stand on a ring of radius 2.613 about the origin and walk a
    // circle of radius 2.595 offset 1.013 from it, so naming the origin re-centres each dancer's orbit on the
    // ring it started from.
    if (centre) {
      const r = Math.hypot(p0.x - centre.x, p0.y - centre.y);
      if (!(r > 1e-9)) return null;
      return { cx: centre.x, cy: centre.y, r, sweep: turn };
    }
    if (own) {
      // The centre is kept as a DIRECTION from the run's start, so the new radius is reached exactly and
      // `setRunCircle`'s own snap-to-the-start is a no-op rather than a fight. The turn is kept as it is -
      // including a 361deg one, which rounding to whole revolutions would quietly make 360.
      const dist = Math.hypot(p0.x - own.cx, p0.y - own.cy);
      if (!(dist > 1e-9)) return null;
      const k = radius! / dist;
      return {
        cx: p0.x + (own.cx - p0.x) * k,
        cy: p0.y + (own.cy - p0.y) * k,
        r: radius!,
        sweep: side === 1 ? own.sweep : -own.sweep,
      };
    }
    // No circle of its own: the run's own turn still says how much of one it covers, and passing it is what
    // stops the minor arc from being chosen when the run turns most of the way round.
    if (radius === null) return null;
    return circleThrough(p0, p1, radius, side, runTurn(call, d, from, to));
  }

  /**
   * Lay the selected dancers' run on a circle.
   *
   * THE RADIUS IS THE COMMON THING AND THE CENTRE IS PER DANCER, for the reason `circleFor` gives. Each dancer
   * is edited against the bundle as it stands, which is sound because `setRunCircle` touches exactly one
   * dancer's path and the run's frames depend on that dancer alone.
   *
   * A REFUSAL FROM THE ENGINE IS SHOWN, NOT SWALLOWED. The engine refuses a turn a move cannot carry in
   * quarters, naming the move and the angle, and that message is the whole value of the refusal - so it goes
   * to the status line rather than being turned into "nothing happened".
   */
  private doRunCircle() {
    const call = this.instance;
    if (!call) return;
    const targets = this.selectedSorted();
    if (targets.length === 0) {
      this.statusEl.textContent = 'no dancers selected — pick dancers above the table, or the circle has nowhere to write';
      return;
    }
    const from = this.moveIndex;
    const to = this.circleTo ?? this.moveIndex;
    if (to <= from) {
      this.statusEl.textContent = 'a circle needs a RUN of moves — pick a second move with shift-click, or raise the "to" move';
      return;
    }
    let next = call;
    let done = 0;
    const why: string[] = [];
    for (const d of targets) {
      const fit = fitCircleRun(next, d, from, to);
      const radius = this.circleRadius ?? fit?.r ?? null;
      // A NAMED CENTRE NEEDS NO RADIUS, because the start is pinned and the radius follows from it.
      if (!this.circleCentre && (radius === null || !(radius > 0))) {
        why.push(`dancer ${d + 1}: this run is not a circle, so it needs a radius`);
        continue;
      }
      const circle = this.circleFor(next, d, from, to, radius, this.circleSide, this.circleCentre);
      if (!circle) {
        why.push(`dancer ${d + 1}: no circle of that radius joins this run's ends`);
        continue;
      }
      try {
        next = setRunCircle(next, d, from, to, circle);
        done++;
      } catch (err) {
        why.push(`dancer ${d + 1}: ${(err as Error).message}`);
      }
    }
    if (done === 0) {
      this.statusEl.textContent = `✗ ${why[0] ?? 'nothing to do'}`;
      return;
    }
    this.commit(next, `run:${from}:${to}:circle`);
    this.statusEl.textContent =
      `✓ circle over moves ${from + 1}–${to + 1} for ${done} dancer${done === 1 ? '' : 's'}` +
      (why.length ? ` · ${why.length} left alone — ${why[0]}` : '');
  }

  /**
   * The control points of the move's SELECTED curve, as draggable handles on the floor - drawn for
   * `moveDancer`, the first selected dancer.
   *
   * Drawing a gadget per selected dancer is the literal picture of the group edit - the same shape,
   * drawn around each dancer's own position - and an earlier version did exactly that. It was
   * unreadable: with a dozen dancers selected the board fills with near-identical gadgets, and which
   * one belongs to which dancer is not something the dots themselves say. They are not independent
   * anyway, because the drag writes one LOCAL value to every selected dancer, so the second is a copy
   * of the first and a copy is all the picture needs. The one drawn is the same dancer whose numbers
   * the tile shows and whose track the strip lists, so the board and the panel never disagree.
   *
   * THE CURVE'S OWN FRAME IS THE DANCER'S POSE WHERE THE MOVE BEGINS. Both Beziers are authored in
   * dancer-local coordinates, so a control point is placed by transforming it by the pose at the
   * move's start - one rotation and one translation, and no other arithmetic for either curve.
   *
   * THE TRAVEL CURVE gets two points, c1 and c2, each with a line from its own fixed anchor: c1's from
   * the move's start, c2's from the end. That is the classic layout, and it is also what makes it
   * obvious which control point you are about to move. It gets NO drawn Bezier of its own, and that is
   * not an omission: THE TRAVEL CURVE IS ALREADY DRAWN, because it IS the trail - `sampleTrailRange`
   * walks the very same cubic onto the floor, highlighted in amber for exactly this move. A second copy
   * would sit on top of it and say nothing new.
   *
   * THE FACING CURVE gets three points AND the curve itself. The curve is the point: it is a heading
   * profile, and WHAT THE HEADING IS AT ANY INSTANT IS THE DIRECTION OF THE CURVE AT THAT INSTANT.
   * `poseFor` reads the curve with `bezierAngle`, whose own comment says "atan2 of the tangent", so the
   * tangent's direction IS the heading change - not, as an earlier version of this comment claimed, the
   * ray from the dancer out to a point of the curve. That is why the curve is drawn as a curve: the
   * control polygon alone says where the coefficients are, and only the curve says which way the dancer
   * faces. Its length means nothing (uniformly scaling the whole curve leaves every tangent unchanged,
   * so the facing is untouched), which is the one thing to be careful about when reading it.
   *
   * The cyan heading ticks on the highlighted trail are the SAME headings, drawn where the dancer
   * actually is, so the two can be compared: at each instant the tick and the curve's direction agree.
   * For a no-translation turn in `moves.xml` (`x4="0" y4="2"`, the heading running 0deg to 180deg) there
   * is nowhere on the floor to put a facing, so the curve is drawn in the dancer's own frame at the
   * move's start - the frame the control points are authored in - rather than anywhere on the track.
   *
   * THREE POINTS AND NOT TWO, BECAUSE THE TILE HAS FIVE FIELDS. The facing tab edits `r.cx3 cx4 cy4
   * x4 y4` - five numbers - and the curve's three points carry exactly them: r1 -> cx1, r2 -> cx2
   * and cy2, r3 -> x2 and y2. A pair like the travel curve's would leave the endpoint, which is the
   * heading the move FINISHES on, with no handle at all. The travel curve keeps its pair on purpose:
   * there the endpoint IS the authored track, and dragging it is the deferred "shared connecting
   * point" gesture.
   */
  private renderHandles() {
    const call = this.instance;
    const stage = this.stage;
    if (!call || !this.active || !this.isInstanceMode()) {
      stage.setGizmo(null);
      return;
    }
    // NO HANDLES WHEN THE CURVE ON SCREEN DIFFERS, because a handle drag is a coordinate edit of THAT
    // curve and the gate would refuse it. Drawing a draggable-looking dot that does nothing is worse
    // than drawing none. The gate names the curve rather than both: the Move tab's handles write the
    // travel curve and the Facing tab's write the rotation, so a pair whose paths agree and whose turns
    // do not can be dragged on the tab that edits what they share.
    if (!this.coordinatesAgree(this.moveKind === 'facing' ? 'facing' : 'travel')) {
      stage.setGizmo(null);
      return;
    }
    const d = this.moveDancer;
    const dancer = call.dancers[d];
    const seg = dancer?.path[this.moveIndex];
    if (!dancer || !seg) {
      stage.setGizmo(null);
      return;
    }
    const range = moveBeatRange(dancer, this.moveIndex);
    const p0 = poseFor(dancer, range.from);
    const world = (lx: number, ly: number) => localToFloor(p0, lx, ly);
    const handles: HandleSpec[] = [];

    if (this.moveKind === 'facing') {
      // FACING IS ONLY SELECTABLE WHEN IT EXISTS - `rotate` absent means "face along the travel
      // tangent", which is not a curve anyone can edit - so the tab being on is the whole guard.
      const r = seg.rotate;
      if (!r) {
        stage.setGizmo(null);
        return;
      }
      // r1 IS PINNED TO THE DANCER'S OWN FORWARD AXIS, and that is the FORMAT's constraint rather than
      // this gadget's choice: the rotate element carries no cy3, the converter hardcodes `cy1: 0` and
      // the exporter emits no cy1, so an edit to cy1 is silently thrown away on export (measured: a
      // cy1 of 0.5 turns the dancer 331deg mid-move and re-parses as the authored curve exactly). So
      // r1 writes cx1 ALONE, which is also why no drag here can produce a facing the corpus cannot
      // express. In the 14 curves whose cx1 is already 0 the rail pointer sits on the dancer's own
      // spot - a real authored shape (Sashay, Lateral Substitute), not a degenerate accident: the
      // curve's tangent there is the zero vector and atan2(0, 0) is still 0, so it means "no change of
      // heading at the start" either way.
      const c1 = world(r.cx1, 0);
      const c2 = world(r.cx2, r.cy2);
      const p3 = world(r.x2, r.y2);
      const origin = { x: p0.x, y: p0.y };
      // WHICH END OF THE SHAPE IS ON OFFER: the interior controls, or the point the move finishes on -
      // which for a facing IS the heading it finishes on. See `handleMode`.
      if (this.handleMode === 'end') {
        handles.push({ id: `d${d}:r3`, anchor: c2, point: p3, color: HANDLE_COLOR.facing });
      } else {
        handles.push({ id: `d${d}:r1`, anchor: origin, point: c1, color: HANDLE_COLOR.facing });
        // r2 IS ANCHORED ON THE POINT THE CURVE ENDS AT, like every other handle here - the travel branch
        // anchors its second control on the move's end pose for the same reason. It used to be anchored on
        // `c1`, which drew the line from one CONTROL POINT to the other: a line that says nothing about where
        // the curve finishes, on the one shape whose whole meaning is where the dancer finishes facing.
        // Reported as: "It connects from the control point to the other control point. It should connect to the
        // end point."
        handles.push({ id: `d${d}:r2`, anchor: p3, point: c2, color: HANDLE_COLOR.facing });
      }
      // The cubic the engine evaluates, sampled in the same local frame as the dots and transformed by
      // the same `world`, so the curve, the dots and the tile's numbers are one picture of one thing.
      const curve: CurveSpec[] = [{ points: sampleBezier(r).map((p) => world(p.x, p.y)), color: HANDLE_COLOR.facing }];
      stage.setGizmo(handles, curve);
      return;
    }

    const p1 = poseFor(dancer, range.to);
    const t = seg.translate;
    if (this.handleMode === 'end') {
      // THE END POINT, anchored on its own exit control so the LINE DRAWING THE HANDLE IS THE DIRECTION
      // THE MOVE LEAVES ON - which is the direction a drag of this point holds (see `moveCurveEnd`), so
      // the picture says what the gesture does.
      handles.push({ id: `d${d}:c3`, anchor: world(t.cx2, t.cy2), point: world(t.x2, t.y2) });
      // AND, WHEN THE CURVE IS CLOSELY AN ARC, ITS CENTRE - anchored on the move's START, so the handle's
      // own line IS the radius and reads the fit at a glance. Dragging it swings the arc about that start
      // (see `applyHandleDrag`), which is a gesture the end point alone cannot express.
      // WHILE THE GESTURE RUNS the centre is the BASE circle's centre rotated by the angle applied so far,
      // not a fresh fit: past a wide swing the curve is no longer a circle at all (the cost measured in
      // `poc/tools/arc-centre-probe.mjs`), and a dot that vanished from under the pointer mid-drag would read
      // as the gesture having failed rather than as the arc having been swung past what a circle describes.
      const dragging = this.dragHandle?.endsWith(':cc') ? this.dragArcBase : null;
      const fitted = dragging ? null : fitCircle(t, ARC_FIT_TOL);
      const centreLocal = dragging ? rotatePoint(dragging.centre, dragging.theta) : fitted ? { x: fitted.cx, y: fitted.cy } : null;
      if (centreLocal) {
        // ANCHORED ON THE MOVE'S START, so the handle's own line IS the radius of the swing.
        handles.push({
          id: `d${d}:cc`,
          anchor: { x: p0.x, y: p0.y },
          point: world(centreLocal.x, centreLocal.y),
          color: HANDLE_COLOR.facing,
        });
      }
    } else {
      handles.push({ id: `d${d}:c1`, anchor: { x: p0.x, y: p0.y }, point: world(t.cx1, t.cy1) });
      handles.push({ id: `d${d}:c2`, anchor: { x: p1.x, y: p1.y }, point: world(t.cx2, t.cy2) });
    }
    stage.setGizmo(handles);
  }

  /** The handle being dragged, as `d<dancer>:c<1|2|3>` for travel or `d<dancer>:r<1|2|3>` for facing.
   *  `c3` is the move's END POINT and is drawn only in the `end` handle mode; `r3` is the facing's end
   *  and is drawn in both (it is the only handle the facing curve has beyond its two controls). `cc` is the
   *  fitted CIRCLE's centre, and it is the one drag whose result is a FUNCTION OF THE START OF THE GESTURE
   *  rather than of the pointer alone. */
  private dragHandle: string | null = null;
  /**
   * WHAT THE ARC-CENTRE DRAG IS MEASURED FROM, captured at pointerdown.
   *
   * Every other handle writes the pointer's own local point, which makes it idempotent - the same pointer
   * position always writes the same numbers. The centre drag cannot: it ROTATES the curve, and a rotation
   * applied to the curve the last move produced compounds. So the curve and the angle of its centre at the
   * moment the gesture began are kept, and each pointer move writes `rotate(base, theta)` for the current
   * theta. That is also why this is cleared on pointerup rather than left for the next gesture to inherit.
   */
  private dragArcBase: { call: CallBundle; phi0: number; centre: { x: number; y: number }; theta: number } | null = null;

  /**
   * Wire the canvas for handle dragging.
   *
   * The camera is switched OFF for the duration (`controls.enabled = false`) - otherwise the orbit
   * control takes the same gesture and the board rotates while the handle is being dragged, which is
   * the single most obvious way this could feel broken.
   */
  /**
   * A CLICK ON THE BOARD OPENS THE VIEW DIALOG; a DRAG does not.
   *
   * Asked for as: "A click release on the dance board, opens a small dialog with the Hide Dancers checkbox and
   * a 2D/3D selector (similar to 2d icons checkbox). Use Close button when finished."
   *
   * A RELEASE, NOT A PRESS, and that is the whole of the gesture: the same canvas carries the orbit controls and
   * the handle drags, so a press that turns into a drag must not leave a dialog behind. The test is the
   * pointer's own travel - four pixels - plus whether a HANDLE was under it at the press, taken then rather than
   * read at the release, because the handle drag's own listener clears `dragHandle` on the same event and the
   * order the two listeners run in is not something to depend on.
   *
   * IT IS EDITOR-SCOPED, like the options themselves: `applyViewOptions` releases them when another panel is on
   * screen ("a caller who hid the dancers in the editor would find them gone in the browse view too, with
   * nothing on that panel to explain why"), so offering the dialog elsewhere would be offering controls that do
   * nothing.
   */
  private wireBoardClick() {
    const canvas = this.stage.renderer.domElement;
    let down: { x: number; y: number; onHandle: boolean } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, onHandle: this.stage.pickHandle(e.clientX, e.clientY) !== null };
    });
    canvas.addEventListener('pointerup', (e) => {
      const from = down;
      down = null;
      if (!from || from.onHandle) return;
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return; // a camera move, not a click
      if (!this.active || !this.isInstanceMode()) return;
      this.showViewDialog(e.clientX, e.clientY);
    });
    // A pointer that leaves the canvas mid-gesture never releases here, so the next press starts clean.
    canvas.addEventListener('pointercancel', () => { down = null; });
  }

  /** Show the view dialog with its top-left near the pointer, kept inside the window. */
  private showViewDialog(clientX: number, clientY: number) {
    this.viewDialogEl.hidden = false;
    const box = this.viewDialogEl.getBoundingClientRect();
    const x = Math.min(clientX + 10, Math.max(0, window.innerWidth - box.width - 8));
    const y = Math.min(clientY + 10, Math.max(0, window.innerHeight - box.height - 8));
    this.viewDialogEl.style.left = `${Math.max(0, x)}px`;
    this.viewDialogEl.style.top = `${Math.max(0, y)}px`;
  }

  private hideViewDialog() {
    this.viewDialogEl.hidden = true;
  }

  private wireHandleDrag() {
    const canvas = this.stage.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || !this.isInstanceMode()) return;
      const id = this.stage.pickHandle(e.clientX, e.clientY);
      if (!id) return;
      this.dragHandle = id;
      // The arc-centre drag measures from HERE - see `dragArcBase` - so the fit and the centre's angle are
      // taken once, before the first pointer move has changed anything.
      this.dragArcBase = null;
      if (id.endsWith(':cc')) {
        const dancer = this.instance?.dancers[parseInt(id.slice(1), 10)];
        const seg = dancer?.path[this.moveIndex];
        const circle = seg ? fitCircle(seg.translate, ARC_FIT_TOL) : null;
        if (circle && this.instance) {
          // THE WHOLE CALL, not just the curve: swinging an arc also re-aims the PREVIOUS move's exit so the
          // joint stays smooth, and every pointer move has to start from the same bundle or the two edits
          // would compound (see the cc branch in `applyHandleDrag`).
          this.dragArcBase = {
            call: this.instance,
            phi0: Math.atan2(circle.cy, circle.cx),
            centre: { x: circle.cx, y: circle.cy },
            theta: 0,
          };
        }
      }
      // The selected dancers are DELIBERATELY not re-ordered by grabbing a handle: the gadget on the
      // board is already `moveDancer`'s, and the drag writes the same LOCAL value to every selected
      // dancer, so the tile's numbers read the same either way. Touching the selection mid-gesture
      // would only be motion for nothing.
      // THE ACTIVE VIEW'S controls, whichever that is: in the flat view this has to silence the 2D
      // orbit or the board pans while a control point is being dragged.
      this.stage.setControlsEnabled(false);
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragHandle) return;
      const p = this.stage.floorPoint(e.clientX, e.clientY);
      if (!p) return;
      // CTRL SNAPS TO THE GRID, read from the event rather than held as state: a modifier that stays
      // latched after the key is released is worse than no snap at all.
      this.applyHandleDrag(this.dragHandle, p, e.ctrlKey);
    });
    const endDrag = (e: PointerEvent) => {
      if (!this.dragHandle) return;
      this.dragHandle = null;
      this.dragArcBase = null;
      this.stage.setControlsEnabled(true);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      // A FULL re-render once, at the end. The tile's NUMBERS follow the drag live (see
      // `refreshNumberFields`), but the rest of the panel - the strip's beat and hand labels, the
      // scrub bar, the clone warning - is only worth rebuilding when the gesture is over.
      this.renderInstance();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  /**
   * One step of a handle drag: put the dragged control point where the pointer is, and re-path.
   *
   * The pointer is turned into the move's LOCAL frame once, and that is the only rotation accounting
   * the group edit needs: every selected dancer receives this local value and each re-frames it, which
   * is what makes them land on the SAME shape rather than on the same spot.
   *
   * WHICH CONTROLS THE POINT WRITES IS THE WHOLE DIFFERENCE BETWEEN THE TWO CURVES:
   *
   *  - travel `c1`/`c2` write the point's own x and y, and stop there. The endpoint (`x2`, `y2`) and
   *    the beats and hands are untouched, which is what makes this the control-point gesture rather
   *    than a way to move the track.
   *  - facing `r1` is on the RAIL: only cx1 is written, because the format has no cy3 and an edit to
   *    cy1 does not survive the export. `r2` and `r3` write both of their local coordinates.
   *
   * NOTE WHAT "the pointer's local point" MEANS FOR A FACING: it is the position of a coefficient in a
   * tangent space, drawn where the tile's numbers can be read off it. The drag is honest about the
   * data - it writes exactly the number the field shows - and the DIRECTION of the curve is what the
   * dancer's heading responds to, not the distance.
   *
   * CTRL SNAPS TO THE GRID as a MAGNET: see `SNAP_CELL` - the point is pulled onto a line only when it
   * is already within a quarter of a cell of one, and left where the pointer is otherwise.
   *
   * WITH THE ARC ON, EVERY HANDLE IS ON A RAIL, because the curve is no longer five free numbers: the
   * arc's parameters are the two handle LENGTHS, so a drag can only change a length and never a
   * direction. r1 slides along the start direction, r2 along the finish direction, and r3 - the corner
   * - sets both lengths at once. That is what "locks out manual editing" means here: not that the
   * handles stop working, but that nothing they can do takes the curve off the family.
   */
  private applyHandleDrag(handle: string, board: { x: number; y: number }, snap = false) {
    const call = this.instance;
    if (!call) return;
    const d = parseInt(handle.slice(1), 10);
    const which = handle.slice(handle.indexOf(':') + 1);
    const dancer = call.dancers[d];
    if (!dancer) return;
    const seg = dancer.path[this.moveIndex];
    if (!seg) return;
    const range = moveBeatRange(dancer, this.moveIndex);
    const p0 = poseFor(dancer, range.from);
    // THE SNAP GOES ON THE BOARD POINT, IN THE FRAME THE GRID IS DRAWN IN - and only then is the point
    // taken into the dancer's local frame. Snapping the LOCAL coordinates instead puts the dot on a grid
    // ROTATED WITH THE DANCER, so it lines up with the lines the caller can see only when the dancer's
    // frame happens to be square to the floor: a snap that looks broken rather than one that looks like
    // help. The cost is on the other side and is worth stating plainly - the numbers left in the tile
    // are whatever a grid point's dancer-local coordinates are, so they are not round when the dancer is
    // turned. "Snap to the grid" means the grid you can see.
    const snapped = snap ? { x: snapTo(board.x), y: snapTo(board.y) } : board;
    // The INVERSE of the placement in `renderHandles`: the pointer's floor point -> the LOCAL frame
    // of the move as the DRAGGED dancer performs it.
    const { lx, ly } = floorToLocal(p0, snapped.x, snapped.y);

    // THE ARC'S CENTRE IS NOT A COORDINATE EDIT: it swings the whole curve AND re-aims the previous move's
    // exit, so it cannot go through the per-move patch chain below - that writes ONE move of every selected
    // dancer. Everything it does is one engine operation, applied to the call captured at pointerdown so each
    // pointer move is a rotation of a FIXED bundle rather than a compounding one.
    if (which === 'cc') {
      const base = this.dragArcBase;
      if (!base || !this.coordinatesAgree('travel')) return;
      base.theta = Math.atan2(ly, lx) - base.phi0;
      let next = base.call;
      try {
        for (const dd of this.selectedSorted()) next = swingArcAboutStart(next, dd, this.moveIndex, base.theta);
      } catch (err) {
        this.statusEl.textContent = `✗ ${(err as Error).message}`;
        return;
      }
      this.applyLight(next);
      // AND SAY WHEN THE JOINT COULD NOT FOLLOW. The move before an arc has to turn its departure with the
      // swing; a move that arrives with nothing left to travel has no departure direction to turn, so its
      // joint keeps the angle it had and the caller is told rather than left to notice a corner.
      const prevSeg = base.call.dancers[this.moveDancer]?.path[this.moveIndex - 1];
      this.statusEl.textContent =
        this.moveIndex > 0 && prevSeg && !hasExitDirection(prevSeg.translate)
          ? 'swung the arc — the move before it has no departure direction to turn, so that joint keeps the angle it had'
          : `swung the arc by ${(toDeg(base.theta)).toFixed(1)}° about its start`;
      return;
    }

    const facing = which.startsWith('r');
    const bez = facing ? seg.rotate : seg.translate;
    const arc = this.arcOn && bez ? arcOf(bez) : null;
    if (arc) {
      // THE ARC'S TWO LENGTHS, in the arc's own orthonormal frame: u along the start handle, w along
      // the finish one. `x` is a length and cannot be negative, so the clamp is the definition rather
      // than a guard; `y` keeps its sign, which is which way the turn goes.
      const ux = Math.cos(arc.angle);
      const uy = Math.sin(arc.angle);
      const wx = -uy;
      const wy = ux;
      const a = arc.x / ARC_K;
      const b = arc.y / ARC_K;
      const cornerX = a * ux + b * wx;
      const cornerY = a * uy + b * wy;
      let x = arc.x;
      let y = arc.y;
      if (which === 'r1' || which === 'c1') {
        x = Math.max(0, lx * ux + ly * uy);
      } else if (which === 'r2' || which === 'c2') {
        y = (cornerX - lx) * wx + (cornerY - ly) * wy;
      } else {
        x = Math.max(0, ARC_K * (lx * ux + ly * uy));
        y = ARC_K * (lx * wx + ly * wy);
      }
      const next: ArcParams = { x, y, angle: arc.angle };
      const b2 = arcBezier(next);
      this.commitMoveChange(
        (s) => (facing ? { ...s, rotate: b2 } : { ...s, translate: b2 }),
        `m${this.moveDancer}:${this.moveIndex}:tab:${this.moveKind}`,
        true,
        facing ? 'facing' : 'travel',
      );
      if (facing) this.noteFacingHold(seg);
      return;
    }

    const patch: (seg: Seg) => Seg =
      which === 'r1'
        ? // THE RAIL. cx1 alone; cy1 stays exactly the 0 the format requires, so the dot cannot leave
          // the dancer's forward axis even momentarily mid-drag.
          (seg) => (seg.rotate ? { ...seg, rotate: { ...seg.rotate, cx1: lx } } : seg)
        : which === 'r2'
          ? (seg) => (seg.rotate ? { ...seg, rotate: { ...seg.rotate, cx2: lx, cy2: ly } } : seg)
          : which === 'r3'
            ? (seg) => (seg.rotate ? { ...seg, rotate: { ...seg.rotate, x2: lx, y2: ly } } : seg)
            : which === 'c1'
              ? (seg) => ({ ...seg, translate: { ...seg.translate, cx1: lx, cy1: ly } })
              : which === 'c2'
                ? (seg) => ({ ...seg, translate: { ...seg.translate, cx2: lx, cy2: ly } })
                  : // THE END POINT, and the ONE handle that writes more than the point it is on: the exit
                  // handle goes with it, held as a vector, so the direction the dancer leaves on - and,
                  // with no facing curve, the heading the NEXT move is played in - does not change. The
                  // engine owns that rule (`moveCurveEnd`); the panel only says where the point went.
                  (seg) => ({ ...seg, translate: moveCurveEnd(seg.translate, lx, ly) });
    this.commitMoveChange(patch, `m${this.moveDancer}:${this.moveIndex}:tab:${this.moveKind}`, true, facing ? 'facing' : 'travel');
    if (facing) this.noteFacingHold(seg);
  }

  /**
   * Say what a FACING drag did, and say that the trace did NOT move with it.
   *
   * The old behaviour was reported as a bug twice - "adjusting the end of the facing curve alters the
   * direction of the rest of the trace" - and the honest fix leaves the panel silent, so a caller cannot
   * tell the new behaviour from the old one except by watching the floor. This is the sentence that says
   * which one they have, and the number is the rotation, which is now the only thing that changed.
   */
  private noteFacingHold(before: Seg) {
    const after = this.instance?.dancers[this.moveDancer]?.path[this.moveIndex];
    if (!after) return;
    const turned = toDeg(normAngle(bezierAngle(after.rotate ?? after.translate, 1) - bezierAngle(before.rotate ?? before.translate, 1)));
    if (Math.abs(turned) > 0.05) {
      this.statusEl.textContent = `turned the end facing ${turned.toFixed(1)}Â° - the following trace is held where it was`;
    }
  }

  /**
   * Put the live instance's numbers into the tile's fields, without rebuilding anything.
   *
   * THE DRAG PATH NEEDS THIS. `applyHandleDrag` deliberately skips `renderInstance` per pointer move -
   * rebuilding the table, the strip and eight dancer views sixty times a second is the difference
   * between a drag and a slideshow - but that left the one thing the caller is watching, the numbers,
   * frozen until the pointer came up. So the numbers follow the drag and nothing else does.
   *
   * The FOCUSED field is skipped: a drag and a keystroke cannot happen at once, but a value written
   * under a caret is a real way to lose an edit, and the check is one comparison.
   */
  private refreshNumberFields() {
    const call = this.instance;
    if (!call) return;
    const i = this.moveDancer;
    const k = this.moveIndex;
    const seg = call.dancers[i]?.path[k];
    if (!seg) return;
    const values: [string, number][] = [];
    for (const key of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2'] as const) values.push([`m${i}:${k}:t.${key}`, seg.translate[key]]);
    if (seg.rotate) for (const key of ['cx1', 'cx2', 'cy2', 'x2', 'y2'] as const) values.push([`m${i}:${k}:r.${key}`, seg.rotate[key]]);
    values.push([`m${i}:${k}:beats`, seg.beats]);
    // AND THE BOARD PAIR, which moves with them: a drag rewrites the local numbers on every pointer move,
    // so a floor readout that waited for the pointer to come up would be describing the previous frame.
    const frame = poseFor(call.dancers[i], moveBeatRange(call.dancers[i], k).from);
    const displayed = this.moveKind === 'facing' ? seg.rotate : seg.translate;
    if (displayed) {
      for (const p of CURVE_POINTS) {
        const at = localToFloor(frame, displayed[p.lx], p.ly ? displayed[p.ly] : 0);
        values.push([`m${i}:${k}:a.${p.point}x`, at.x], [`m${i}:${k}:a.${p.point}y`, at.y]);
      }
    }
    for (const [key, v] of values) {
      const el = this.instPanel.querySelector<HTMLInputElement>(`input[data-key="${key}"]`);
      if (el && el !== document.activeElement) el.value = show(v);
    }
  }

  /**
   * Apply an engine edit, show it, and re-draw the table.
   *
   * A FULL re-render on every commit is safe here because the listeners are on `change`
   * (blur / Enter) rather than `input`, so the field being edited has already been left;
   * `focusKey` puts the focus back for the case where the value was committed with the
   * spin buttons or Enter without leaving the field.
   */
  /**
   * MOVE THE COPIED POINTS ONTO THE OBJECTS THAT REPLACED THEM.
   *
   * `setMove` replaces the segment it writes - that is the one place identity is broken - and it does so for
   * EVERY write: a field, the drag, the arc, the explicit box, a facing edit's held trace (which writes every
   * later move), and a paste. Without this, copying a move and then editing that same move would lose the copy,
   * which is the single most likely thing to do with it.
   *
   * ONLY WHEN THE PATH DID NOT CHANGE LENGTH, and that guard is a BUG FIX rather than a formality. `commit` is
   * also the path `+ Move` and `- Move` take, and a delete or an insert SHIFTS every later move down or up by
   * one - so comparing the two paths by position compares DIFFERENT MOVES. The old code did exactly that, which
   * copied the DELETED move's point onto the move that took its index. Reported from use: "select two moves,
   * press C to copy x,y, delete the first move, then Pa the remaining Move - it pastes the deleted move's
   * coordinates."
   *
   * A move that is added or removed KEEPS THE OBJECT IT HAD, so its copy is already keyed correctly and there is
   * nothing to carry; only an in-place rewrite needs this at all.
   */
  private carryMoveClips(from: CallBundle | null, to: CallBundle) {
    if (!from) return;
    const dancers = Math.min(from.dancers.length, to.dancers.length);
    for (let d = 0; d < dancers; d++) {
      const before = from.dancers[d]?.path ?? [];
      const after = to.dancers[d]?.path ?? [];
      // SAME LENGTH OR NOTHING: a shifted path is not a rewritten one, and pairing it by position would take
      // one move's point and leave it on another.
      if (before.length !== after.length) continue;
      for (let j = 0; j < before.length; j++) {
        if (before[j] === after[j]) continue;
        const carried = this.moveClips.get(before[j]);
        if (carried) this.moveClips.set(after[j], carried);
      }
    }
  }

  private commit(next: CallBundle, focusKey?: string) {
    this.carryMoveClips(this.instance, next);
    this.instance = next;
    this.instanceEdited = true;
    this.showInstance(next);
    this.renderInstance(focusKey);
  }

  /** The state a change is about to replace. See `EditorSnapshot`. */
  private snapshot(): EditorSnapshot {
    return {
      instance: this.instance,
      instanceEdited: this.instanceEdited,
      asClone: this.asClone,
      endTarget: this.endTarget,
      endOverride: this.endOverride,
      circleTo: this.circleTo,
      circleRadius: this.circleRadius,
      circleCentre: this.circleCentre,
      circleSide: this.circleSide,
      moveIndex: this.moveIndex,
      selected: this.selectedSorted(),
    };
  }

  /**
   * WHAT COUNTS AS A CHANGE, as the values a change moves. Deliberately NOT the move index or the selection:
   * those are where the caller is LOOKING, and stepping through moves does not put a step in the history.
   * They are still captured by `snapshot`, so an undo puts the caller back on the move it changed.
   */
  private stateKey(): unknown[] {
    return [
      this.instance, this.instanceEdited, this.asClone,
      this.endTarget, this.endOverride,
      this.circleTo, this.circleRadius, this.circleCentre, this.circleSide,
    ];
  }

  /**
   * TAKE A STEP IF THE STATE HAS MOVED, called by the render that follows a change.
   *
   * ONE PLACE, SO NONE CAN BE MISSED. Every edit in this panel - a field, a select, a button, a re-base, a
   * connect, the end pairing, a drag when it finishes - ends in `renderInstance`, and the edits that do NOT
   * go through `commit` (there are eight of those) would each have needed their own push. Keyed on the state
   * instead, a change is recorded because it HAPPENED rather than because whoever wrote the handler
   * remembered to say so.
   *
   * IT ALSO MAKES A DRAG ONE STEP. `applyLight` deliberately does not render - a pointer move must not
   * rebuild the table - so the gesture is recorded by the ONE render at pointerup, and the snapshot pushed
   * there is the state from before the drag began. Nothing needs to know a drag is in progress.
   *
   * `lastKey === null` MEANS "NO HISTORY YET", which is how a load starts a fresh one without pushing the
   * call it replaced.
   */
  private noteState() {
    const key = this.stateKey();
    const changed = this.lastKey !== null && !key.every((v, i) => v === this.lastKey![i]);
    if (changed && this.lastSnapshot) {
      this.undoStack.push(this.lastSnapshot);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.updateRevertBtn();
    }
    this.lastKey = key;
    this.lastSnapshot = this.snapshot();
  }

  /** Re-baseline without recording anything, for the states that are not a change of the caller's making. */
  private resetNoteState() {
    this.lastKey = this.stateKey();
    this.lastSnapshot = this.snapshot();
  }

  /** Forget the history: a new call has been loaded, so there is nothing of it to put back. */
  private clearUndo() {
    this.undoStack.length = 0;
    this.lastKey = null;
    this.lastSnapshot = null;
    this.updateRevertBtn();
  }

  private updateRevertBtn() {
    const n = this.undoStack.length;
    this.revertBtn.disabled = n === 0;
    this.revertBtn.title = n === 0
      ? 'Nothing to revert: every edit made in this tab has already been undone, or none has been made. Loading another call starts a fresh history.'
      : `Put back the state before the last change (${n} of up to ${UNDO_LIMIT} step${n === 1 ? '' : 's'} available). A drag counts as ONE step, not one per pointer move.`;
  }

  /**
   * PUT THE LAST CHANGE BACK.
   *
   * The instance and the flags that travel with it are restored, and the panel re-renders from them - which is
   * the whole of it, because the editor holds no other copy of what it is editing. The MOVE INDEX is put back
   * too (clamped to the restored path, since undoing an `addMove` shortens it) so the caller is shown the move
   * the change was made on rather than wherever the strip happened to be left.
   *
   * NOTHING IS RE-APPLIED TO THE CATALOGUE and nothing is saved: this is the same class of action as Reset,
   * which also only moves the tab's own copy. An edit already APPLIED to the live catalogue is a different
   * thing and is undone by unapplying it, as Reset's own note says.
   */
  private doRevert() {
    const previous = this.undoStack.pop();
    if (!previous) {
      this.updateRevertBtn();
      this.statusEl.textContent = 'nothing to revert';
      return;
    }
    this.instance = previous.instance;
    this.instanceEdited = previous.instanceEdited;
    this.asClone = previous.asClone;
    this.endTarget = previous.endTarget;
    this.endOverride = previous.endOverride;
    this.circleTo = previous.circleTo;
    this.circleRadius = previous.circleRadius;
    this.circleCentre = previous.circleCentre;
    this.circleSide = previous.circleSide;
    this.selectedDancers = new Set(previous.selected);
    const path = this.instance?.dancers[0]?.path.length ?? 0;
    this.moveIndex = path > 0 ? Math.max(0, Math.min(previous.moveIndex, path - 1)) : 0;
    this.arcKey = '';
    if (this.instance) this.showInstance(this.instance);
    // RE-BASELINE FIRST, so the render below does not record the undo as a change - which would make the
    // next press put it straight back instead of walking further back.
    this.resetNoteState();
    this.updateRevertBtn();
    this.renderInstance();
    this.statusEl.textContent = this.undoStack.length === 0
      ? 'reverted - the history is empty now'
      : `reverted ${this.undoStack.length} change${this.undoStack.length === 1 ? '' : 's'} still to put back`;
  }

  private renderInstance(focusKey?: string | null) {
    if (focusKey !== undefined) this.focusKey = focusKey;
    this.renderFormation();
    // Every edit changes the geometry the half-set test reads, so the line that reports it is redrawn
    // with the rest of the panel rather than only when the checkbox moves.
    this.renderAsymInfo();
    this.renderScrub(this.instance);
    this.renderDancerPicks();
    this.renderMoveStrip();
    this.renderInstanceInfo();
    this.renderSelectRow();
    this.renderCloneChrome();
    this.renderEndTarget();
    this.refreshCloneInfo();
    this.syncStageSelection();
    // LAST, and it must stay last: the step describes the state this render is SHOWING.
    this.noteState();
    if (this.focusKey) {
      const el2 = this.instPanel.querySelector<HTMLElement>(`[data-key="${this.focusKey}"]`);
      el2?.focus();
    }
  }

  /**
   * Point the stage at what is being edited: the trail focus AND the Bezier handles.
   *
   * THE TWO SELECTIONS IN THE MOVES ROW ARE THE WHOLE INSTRUCTION. "Moves of" hides every other
   * dancer's track and "Move" highlights the stretch that move owns; the range and the mapping from
   * beats to floor positions both come from the engine (`moveBeatRange` + `sampleTrailRange`), so what
   * is highlighted is the move the panel says it is rather than a plausible-looking slice. Every other
   * mode, and every state where there is nothing to edit, restores the full tracks.
   *
   * THE HANDLES ARE IN HERE RATHER THAN BESIDE IT, and that is the fix for a real bug rather than
   * tidying: they were called from `renderInstance` only, so selecting a move in the strip - which
   * re-renders the strip and re-focuses the trail - left the gizmo sitting on the PREVIOUS move's
   * control points, on the board, while the tile and the highlight described the new one. Anything that
   * resyncs the stage now gets the handles for free, because they are one thing with the focus: both
   * say "this is the move being edited", and either alone is a board that disagrees with the panel.
   */
  private syncStageSelection() {
    if (!this.active || !this.isInstanceMode() || !this.instance || this.selectedDancers.size === 0) {
      this.host.focusTrail(null, null);
      this.renderHandles();
      return;
    }
    const dancer = this.instance.dancers[this.moveDancer];
    const seg = dancer?.path[this.moveIndex];
    if (!dancer || !seg) {
      this.host.focusTrail(this.moveDancer, null);
      this.renderHandles();
      return;
    }
    // A facing selection with no facing curve to show falls back to the move, so the board can never
    // be drawing a shape the tile is not editing.
    const kind = this.moveKind === 'facing' && !seg.rotate ? 'move' : this.moveKind;
    this.host.focusTrail(this.moveDancer, moveBeatRange(dancer, this.moveIndex), kind);
    this.renderHandles();
  }

  /**
   * The first selected dancer whose curve at this move differs from the first selected one's, and HOW
   * BIG the difference is IN THE UNITS OF THE CURVE THE TAB IS EDITING: board units for the travel
   * curve, degrees for the facing.
   *
   * WHY A SIZE AND NOT THE NUMBERS. Two dancers author a move in their OWN frames, so their local
   * numbers are not comparable - but what they do IS, and a caller looking at the board is asking about
   * that. This is what turns "coordinates locked" from a rule into an answer to "but they look the
   * same": the panel can name the pair and the size.
   *
   * THE MEASURE IS THE SAME FRAME THE GATE USES, and it did not used to be. The old note measured the
   * two dancers' curves where they LIE ON THE FLOOR, which is dominated by how far apart the two
   * dancers stand: two dancers doing exactly the same move two units apart reported "2.00 units apart",
   * a disagreement that is not about the move at all. MEASURED (`poc/tools/coords-gate-probe.mjs`
   * measures both): the same shape measured in the dancers' own frames is the number that answers the
   * question, and it is the one the gate's windows are set against.
   */
  private coordsDisagreement(curve: CurveKind): { dancer: number; gap: number } | null {
    const call = this.instance;
    if (!call) return null;
    const sel = this.selectedSorted();
    if (sel.length < 2) return null;
    const k = this.moveIndex;
    const first = call.dancers[sel[0]];
    const a = first?.path[k];
    if (!first || !a) return null;
    for (const d of sel.slice(1)) {
      const other = call.dancers[d];
      const b = other?.path[k];
      if (!other || !b || sameCurve(a, b, curve)) continue;
      if (curve === 'travel') return { dancer: d, gap: travelGap(a, b) };
      // The two dancers' own heading profiles: `bezierAngle` is the heading in the local frame, so the
      // difference is how much more one of them turns than the other, at the worst instant.
      let gap = 0;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const ha = bezierAngle(a.rotate ?? a.translate, t);
        const hb = bezierAngle(b.rotate ?? b.translate, t);
        const dd = Math.atan2(Math.sin(ha - hb), Math.cos(ha - hb));
        gap = Math.max(gap, Math.abs((dd * 180) / Math.PI));
      }
      return { dancer: d, gap };
    }
    return null;
  }

  private renderInstanceInfo() {
    const call = this.instance;
    if (!call) {
      this.instInfoEl.textContent = '';
      return;
    }
    const rows = instanceTable(call);
    const unknown = rows.filter((r) => r.couple === null).length;
    const n = this.selectedSorted().length;
    this.instInfoEl.textContent =
      `${call.title} · ${call.dancers.length} dancers · ${show(call.beats)} beats` +
      (n > 1 ? ` · ${n} selected (edits apply to all, each in its own frame)` : '') +
      (this.instanceEdited ? ' · edited' : '') +
      (unknown === call.dancers.length ? ' · no home identity (not a squared set)' : '');
  }

  /**
   * The END TARGET as the panel reports it: how far the track still is from it, and WHICH SPOT OF THE
   * FORMATION every dancer is aimed at.
   *
   * THE GAP IS RE-MEASURED EVERY RENDER, never remembered from the last Connect, and that is the point:
   * the end moves whenever the FRAME before the last move changes - re-aiming the first move, re-posing a
   * start, editing a middle move - so a panel that said "connected" because it once was would be lying
   * within one edit. What it says instead is the number, so a lost end is visible as a number.
   *
   * THE PAIRING IS ON SCREEN BECAUSE IT IS A DECISION. The automatic one is derived and is usually right,
   * but a caller can see at a glance whether dancer 3 is aimed at the spot they meant, and change it. The
   * row of pickers appears only when an end setup is chosen, because a pairing against no formation is not
   * a fact about anything.
   */
  private renderEndTarget() {
    const inst = this.instance;
    const target = this.endTarget;
    this.endPairEl.innerHTML = '';
    if (!inst || !target) {
      this.endInfoEl.textContent = '';
      this.endPairEl.hidden = true;
      this.endAutoBtn.hidden = true;
      this.connectEndBtn.disabled = true;
      return;
    }
    const pairing = this.endPairing();
    if (!pairing) {
      this.endInfoEl.innerHTML =
        `<span style="color:#ffb454">cannot pair</span> the dancers with <b>${esc(target.name)}</b> — ` +
        'the two sets cannot be matched up by position and facing, so nothing here would be a correspondence. Pick another end setup.';
      this.endPairEl.hidden = true;
      this.endAutoBtn.hidden = true;
      this.connectEndBtn.disabled = true;
      return;
    }
    this.connectEndBtn.disabled = false;
    this.endAutoBtn.hidden = this.endOverride === null;
    const gap = this.endTargetGap(pairing);
    const deg = toDeg(gap.heading);
    const connected = gap.pos < 1e-9 && Math.abs(deg) < 1e-9;
    this.endInfoEl.innerHTML = connected
      ? `<b>${esc(target.name)}</b>: every dancer ends on its spot${this.endOverride ? ' (pairing changed by hand)' : ''}`
      : `ends ${gap.pos.toFixed(2)} units / ${Math.abs(deg).toFixed(0)}° from <b>${esc(target.name)}</b> — ` +
        '<b>Connect end</b> re-aims the last move of every dancer' +
        (this.endOverride ? ' (pairing changed by hand)' : '');
    this.renderEndPairing(pairing);
  }

  /** The pairing editor: one picker per dancer, `# -> spot`, over the chosen formation's spots. */
  private renderEndPairing(pairing: number[]) {
    const target = this.endTarget;
    if (!target) return;
    pairing.forEach((spot, i) => {
      const wrap = document.createElement('span');
      wrap.className = 'ed-pair';
      const lab = document.createElement('label');
      lab.textContent = `${i + 1}→`;
      lab.title = `Which spot of "${target.name}" dancer ${i + 1} finishes on`;
      const sel = document.createElement('select');
      sel.dataset.key = `r${i}:end`;
      target.poses.forEach((p, j) => {
        const holder = pairing.indexOf(j);
        const opt = new Option(
          `#${j + 1} ${(p.gender ?? '?').charAt(0).toUpperCase()} (${show(p.x)}, ${show(p.y)}) ${toDeg(p.heading).toFixed(0)}°` +
            (holder === i ? '' : ` ⇄${holder + 1}`),
          String(j),
          false,
          j === spot,
        );
        opt.title =
          holder === i
            ? `#${j + 1}: this dancer's spot`
            : `#${j + 1} is dancer ${holder + 1}'s spot — choosing it SWAPS the two, so every spot stays used once`;
        sel.add(opt);
      });
      sel.addEventListener('change', () => this.setEndSpot(i, parseInt(sel.value, 10)));
      wrap.appendChild(lab);
      wrap.appendChild(sel);
      this.endPairEl.appendChild(wrap);
    });
    this.endPairEl.hidden = false;
  }

  /** The formation table: a start pose and an end pose per dancer, plus the reads. */
  private renderFormation() {
    const host = this.formationEl;
    host.innerHTML = '';
    const call = this.instance;
    if (!call) return;
    const rows = instanceTable(call);
    const table = document.createElement('table');
    table.className = 'ed-table';
    const thead = document.createElement('thead');
    const r1 = document.createElement('tr');
    r1.innerHTML =
      '<th></th><th></th><th colspan="4" class="ed-side">START</th>' +
      '<th colspan="3" class="ed-side">END (last move re-aimed)</th>' +
      '<th colspan="3" class="ed-side">READ</th>';
    const r2 = document.createElement('tr');
    r2.innerHTML =
      '<th title="Tick the dancers an edit applies to. Most calls give every dancer the same movement rotated into its own position, so one move change usually belongs on all of them.">sel</th>' +
      '<th>#</th><th>gender</th><th>x</th><th>y</th><th>head°</th><th>x</th><th>y</th><th>head°</th><th>couple</th><th>beats</th><th>moves</th>';
    thead.appendChild(r1);
    thead.appendChild(r2);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const r of rows) tbody.appendChild(this.formationRow(r));
    table.appendChild(tbody);
    host.appendChild(table);
  }

  private formationRow(r: InstanceDancer): HTMLTableRowElement {
    const tr = document.createElement('tr');
    const i = r.index;

    // THE SELECTION. A tick means "move edits apply to this dancer too", and the focused dancer is
    // always in it and cannot be removed - otherwise the tile would be showing values that edits do
    // not touch, which is the one state nobody can read.
    const selTd = document.createElement('td');
    const selBox = document.createElement('input');
    selBox.type = 'checkbox';
    selBox.checked = this.selectedDancers.has(i);
    selBox.title = `Apply move edits to dancer ${i + 1} as well (in its own rotated frame)`;
    selBox.addEventListener('change', () => {
      if (selBox.checked) {
        this.selectedDancers.add(i);
      } else if (this.selectedDancers.size > 1) {
        // The set is never allowed to empty: a panel showing a move with no dancer selected is not a
        // state anybody can read.
        this.selectedDancers.delete(i);
      }
      this.renderInstance();
    });
    selTd.appendChild(selBox);
    tr.appendChild(selTd);

    const num = document.createElement('td');
    num.textContent = String(i + 1);
    // THE LINK, NEXT TO THE DANCERS THAT DO NOT MATCH. Asked for as: "Add a link symbol next to the dancers
    // that dont match, that will correct the non-matching coordinates using the matching coodinates. Remove the
    // link once they do match and select the now matching dancer."
    //
    // IT IS OFFERED EXACTLY WHEN THE CORRECTION IS DEFINED: the selection has to AGREE, because that agreement
    // is what there is to copy and it is the same condition the `matching` button itself lights up on. That also
    // makes the link appear the moment `matching` is pressed without needing a mode of its own - the set
    // `matching` picks agrees by construction, so every dancer outside it gets one.
    const linkCurve = this.tabCurve();
    if (this.coordinatesAgree(linkCurve) && !this.matchingDancers(linkCurve).includes(i)) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'ed-link';
      link.textContent = '\u{1F517}';
      link.dataset.key = `r${i}:match`;
      link.title =
        `Make dancer ${i + 1}'s ${linkCurve === 'travel' ? 'path' : 'facing'} through this move the SAME as the selected dancers': ` +
        `the coordinates are copied from dancer ${this.moveDancer + 1}. The link goes as soon as they agree, ` +
        'and the dancer joins the selection.';
      link.addEventListener('click', () => this.matchDancer(i, linkCurve));
      num.appendChild(link);
    }
    tr.appendChild(num);

    // ARRANGEMENT: which spot holds a boy and which a girl.
    const gen = document.createElement('td');
    const sel = document.createElement('select');
    sel.dataset.key = `r${i}:gender`;
    for (const g of GENDERS) sel.add(new Option(g, g, false, g === r.gender));
    sel.addEventListener('change', () => {
      const call = this.instance;
      if (call) this.commit(setDancerGender(call, i, sel.value as Gender), `r${i}:gender`);
    });
    gen.appendChild(sel);
    tr.appendChild(gen);

    // START: re-posing the start re-frames that dancer's whole path (the moves are authored
    // in dancer-local coordinates), which is what makes this an edit of the INSTANCE.
    tr.appendChild(this.numCell(`r${i}:sx`, r.start.x, 0.5, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerStart(call, i, { ...r.start, x: v }), `r${i}:sx`);
    }));
    tr.appendChild(this.numCell(`r${i}:sy`, r.start.y, 0.5, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerStart(call, i, { ...r.start, y: v }), `r${i}:sy`);
    }));
    tr.appendChild(this.numCell(`r${i}:sh`, toDeg(r.start.heading), 45, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerStart(call, i, { ...r.start, heading: toRad(v) }), `r${i}:sh`);
    }));

    // END: only this dancer's LAST move is re-aimed, and the beats are held.
    tr.appendChild(this.numCell(`r${i}:ex`, r.end.x, 0.5, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerEnd(call, i, { ...r.end, x: v }), `r${i}:ex`);
    }));
    tr.appendChild(this.numCell(`r${i}:ey`, r.end.y, 0.5, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerEnd(call, i, { ...r.end, y: v }), `r${i}:ey`);
    }));
    tr.appendChild(this.numCell(`r${i}:eh`, toDeg(r.end.heading), 45, (v) => {
      const call = this.instance;
      if (call) this.commit(setDancerEnd(call, i, { ...r.end, heading: toRad(v) }), `r${i}:eh`);
    }));

    // READS: `couple` is derived from the start formation's geometry, NOT a field of the
    // format, so it is shown rather than edited.
    tr.appendChild(this.readCell(String(r.couple ?? '—'), 'Home couple, READ from the start formation (matched on position and heading). The `<tam>` format declares only gender/x/y/angle, so this is not editable and is not exported.'));
    tr.appendChild(this.readCell(show(r.beats)));
    tr.appendChild(this.readCell(String(r.moves.length)));
    return tr;
  }

  private readCell(text: string, title?: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.className = 'ed-derived';
    td.textContent = text;
    if (title) td.title = title;
    return td;
  }

  private numCell(key: string, value: number, step: number, onCommit: (v: number) => void): HTMLTableCellElement {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = show(value);
    input.dataset.key = key;
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      // A blank or unparseable field is not an edit: redraw from the model rather than
      // writing NaN into the instance.
      if (!Number.isFinite(v)) this.renderInstance();
      else onCommit(v);
    });
    td.appendChild(input);
    return td;
  }

  // ---- moves ----

  private currentMoves(): Seg[] {
    const call = this.instance;
    if (!call) return [];
    return instanceTable(call)[this.moveDancer]?.moves ?? [];
  }

  /**
   * WHERE A MOVE IS PLAYED FROM: the dancer's own pose at the move's first beat. Both of a move's Beziers are
   * authored in that frame, so it is also the frame an absolute end point is read - and written - through.
   */
  private moveFrame(call: CallBundle, d: number, j: number): MoveFrame | null {
    const dancer = call.dancers[d];
    if (!dancer || j < 0 || j >= dancer.path.length) return null;
    return poseFor(dancer, moveBeatRange(dancer, j).from);
  }

  /**
   * THE MOVES THE RUN COVERS, ascending, and never empty.
   *
   * The run is the strip's only multi-move selection, and it is stored as the two ENDS of the gesture
   * (`moveIndex`, `circleTo`) rather than as a list, so it is normalised here: shift-clicking BACKWARDS is the
   * same gesture as shift-clicking forwards, and the copy below must not care which way the caller dragged.
   * Clamped to the strip, so a run that outlives a deletion still names moves that exist.
   */
  private selectedMoveRange(): number[] {
    const last = Math.max(0, this.currentMoves().length - 1);
    const a = Math.max(0, Math.min(this.moveIndex, last));
    const b = this.circleTo === null ? a : Math.max(0, Math.min(this.circleTo, last));
    const out: number[] = [];
    for (let j = Math.min(a, b); j <= Math.max(a, b); j++) out.push(j);
    return out;
  }

  /** The curve the tile is showing, which is the curve C/Pa/Pr act on - like every other control in the tile. */
  private shownCurve(): CurveKind {
    return this.moveKind === 'facing' ? 'facing' : 'travel';
  }

  /** What the move at `j`, as the tile shows it, is holding - or undefined when it holds nothing. */
  private heldBy(j: number): MoveClip | undefined {
    const seg = this.instance?.dancers[this.moveDancer]?.path[j];
    return seg ? this.moveClips.get(seg) : undefined;
  }

  /**
   * THE `C` BUTTON: take the end point each selected move is holding, and keep it ON THAT MOVE.
   *
   * Asked for, after a first cut kept one list for the whole panel: "After the copy for one Move is activated,
   * all moves seem to be activated with the same copy data. This was not the intention... each Users Move has
   * it's own copy of the coordinates. If multiple Dancers and Moves are enabled, they copy their own specific
   * coordinates. These copied coordinates are only available to that specific move." So a copy is a property of
   * the move: pressing C on a run fills in each move of the run, and lights ONLY those moves' buttons.
   *
   * IT IS A READ, SO IT IS NOT GATED by the coordinate lock - the buttons in the tile say so too. This is also
   * the second press the request names: pressing C again replaces what a move is holding with its values now.
   */
  private copyMoveEnds() {
    const call = this.instance;
    const dancer = call?.dancers[this.moveDancer];
    if (!call || !dancer) {
      this.statusEl.textContent = 'nothing to copy - there is no call loaded';
      return;
    }
    const curve = this.shownCurve();
    const what = curve === 'facing' ? 'facing' : 'path';
    const range = this.selectedMoveRange();
    // EVERY SELECTED DANCER AND EVERY MOVE OF THE RUN, EACH TAKING ITS OWN NUMBERS. The dancer the tile shows is
    // included even when nothing is ticked, because the tile is showing its numbers - and the dancers of a call
    // need not agree about where a move goes, so each one's own pair is what gets kept.
    const dancers = new Set([this.moveDancer, ...this.selectedSorted()]);
    let stored = 0;
    let skipped = 0;
    const filled = new Set<number>();
    for (const j of range) {
      for (const d of dancers) {
        const one = call.dancers[d];
        const seg = one?.path[j];
        if (!one || !seg) continue;
        const c = curve === 'facing' ? seg.rotate : seg.translate;
        const frame = this.moveFrame(call, d, j);
        if (!c || !frame) { skipped++; continue; }
        // THE BUNDLE'S OWN SEGMENT, not the copy `currentMoves()` hands the panel: `instanceTable` clones the
        // moves it reports, so a table move is a different object on every render and would key nothing.
        this.moveClips.set(seg, { curve, rel: { x: c.x2, y: c.y2 }, abs: localToFloor(frame, c.x2, c.y2) });
        stored++;
        filled.add(j);
      }
    }
    if (stored === 0) {
      this.statusEl.textContent = `nothing to copy - no move in the run has a ${what} to take an end point from`;
      return;
    }
    // THE BUTTONS ARE IN THE TILE, so the strip is rebuilt to light the copied moves and to put each one's values
    // on its own hover. NOT a change to the call, so no undo step is taken: `renderMoveStrip` does not push one,
    // and only the render that follows a change does (`noteState`). The stage is re-pointed because the strip was
    // rebuilt - `stage-sync-probe.mjs` requires that of anything that rebuilds the strip, and it is idempotent.
    this.renderMoveStrip();
    this.syncStageSelection();
    this.statusEl.textContent =
      `copied the ${what} end point of ${filled.size === 1 ? `move ${range[0] + 1}` : `${filled.size} moves`}` +
      (skipped ? ` (${skipped} skipped, no ${what})` : '') +
      ' - each move keeps its own, and only that move can paste it';
  }

  /**
   * THE `Pa` AND `Pr` BUTTONS: put back what the moves in the run are HOLDING, each move taking its own.
   *
   * `absolute` reads the stored BOARD pair and converts it through the frame the move has NOW, so the point
   * returns to where it was on the floor whatever the moves before it now do; `Pr` writes the stored RELATIVE
   * pair straight back. A move that is holding nothing, or is holding a point taken on the OTHER tab, is LEFT
   * ALONE - which is what "these copied coordinates are only available to that specific move" means - and the
   * count of what was written and what was left is said out loud, because a paste that did nothing looks
   * exactly like a paste that worked.
   *
   * ONE COMMIT, so a paste over a run is ONE undo step rather than one per move.
   */
  private pasteMoveEnds(absolute: boolean) {
    const call = this.instance;
    const curve = this.shownCurve();
    const board = absolute ? 'BOARD' : 'RELATIVE';
    const tab = curve === 'facing' ? 'FACING' : 'MOVE';
    if (!call) return;
    if (this.arcOn) {
      this.statusEl.textContent = 'the arc lock is on, so these numbers are not independent - untick arc to paste';
      return;
    }
    // NOWHERE TO WRITE IS REFUSED FIRST, because `coordinatesAgree` is false for an empty selection as well and
    // the two want different sentences.
    if (this.selectedDancers.size === 0) {
      this.statusEl.textContent = 'no dancers selected - pick dancers above the table, or the paste has nowhere to go';
      return;
    }
    if (!this.coordinatesAgree(curve)) {
      this.statusEl.textContent = `coordinates locked: the selected dancers do not share this move's ${curve === 'travel' ? 'path' : 'facing'}, and one set of numbers cannot describe several - select one dancer to paste`;
      return;
    }
    const range = this.selectedMoveRange();
    let next = call;
    let done = 0;
    let empty = 0;
    let wrongTab = 0;
    for (const j of range) {
      // EVERY SELECTED DANCER AND EVERY MOVE OF THE RUN, EACH FROM ITS OWN COPY - the same spread the copy
      // takes, which is what was asked for: "Just as the copy works with selected Dancers and Moves, so does
      // the Paste (but the data is local to the Move)". So the decision is made PER DANCER AND MOVE inside the
      // fold below, and NOT up front from the move the tile happens to show: a dancer whose move holds nothing
      // is left exactly as it is while its neighbour's is written.
      let touched = false;
      // THE FRAME IS READ FROM THE BUNDLE BEING BUILT, not from the one it started as: pasting an earlier move
      // moves where the later ones begin, and an absolute paste has to land on the floor position it was
      // copied from - which is only true of the frame the move has AFTER the earlier pastes.
      const step = this.foldMoveChange((seg: Seg, d: number) => {
        const c = curve === 'facing' ? seg.rotate : seg.translate;
        if (!c) return seg;
        // THIS DANCER'S OWN MOVE, by its own object: a dancer whose move holds nothing is left exactly as it is.
        const own = this.moveClips.get(seg);
        if (!own) return seg;
        if (own.curve !== curve) { wrongTab++; return seg; }
        let want = own.rel;
        if (absolute) {
          const frame = this.moveFrame(next, d, j);
          if (!frame) return seg;
          const local = floorToLocal(frame, own.abs.x, own.abs.y);
          want = { x: local.lx, y: local.ly };
        }
        const moved = { ...c, x2: want.x, y2: want.y };
        touched = true;
        return curve === 'facing' ? { ...seg, rotate: moved } : { ...seg, translate: moved };
      }, curve, j, next);
      if (step && touched) { next = step; done++; }
      else if (!touched) empty++;
    }
    if (done === 0) {
      this.statusEl.textContent = wrongTab > 0 && empty === 0
        ? `nothing pasted - what these moves hold was taken on the ${tab === 'MOVE' ? 'FACING' : 'MOVE'} tab, and this tab edits the ${tab}`
        : `nothing pasted - ${empty} move${empty === 1 ? '' : 's'} in the run ${empty === 1 ? 'is' : 'are'} holding nothing; press C on a move to take its end point`;
      return;
    }
    // THE COPY IS KEPT, NOT CLEARED. The request first said "C will clear when Pa/Pr is pressed"; after using
    // it, the caller asked for the opposite - "dont clear the memory after a paste... it's more useful to keep
    // it" - so one copy can be pasted as BOARD and then as RELATIVE without taking it again. `C` stays lit
    // because the move is still holding the same point.
    this.commit(next, `m${this.moveDancer}:${this.moveIndex}:${absolute ? 'pasteAbs' : 'pasteRel'}`);
    this.statusEl.textContent =
      `pasted ${done} move${done === 1 ? '' : 's'} as ${board} coordinates` +
      (empty ? ` - ${empty} left alone, holding nothing` : '') +
      '; the points are kept, so they can be pasted again or as the other pair';
  }

  /**
   * WHAT THIS MOVE'S `C` IS HOLDING, for the hover. Asked for: "Hovering over C button will show current values
   * stored, if there are any." A highlight says that something is held; only the values say WHICH point.
   */
  private clipTitle(held: MoveClip | undefined): string {
    if (!held) {
      return 'Copy THIS move\'s end point - relative and board - and keep it on this move, so it can be pasted back after deleting or adding moves has shifted where it lands. Shift-click a second move to copy a run. This move is holding nothing.';
    }
    const what = held.curve === 'facing' ? 'facing' : 'move';
    return `HOLDING this move's ${what} end point:` + '\n' +
      `  relative ${show(held.rel.x)}, ${show(held.rel.y)}` + '\n' +
      `  board    ${show(held.abs.x)}, ${show(held.abs.y)}` + '\n' +
      'Pressing C again replaces it with the values on screen now. Pa pastes the board pair, Pr the relative one.';
  }

  /**
   * THE DANCER SELECTOR: one toggle per dancer.
   *
   * It replaced an "all" button, which was near-useless - very few calls have every dancer doing
   * exactly the same move, so "all" was a button you could press and then have to undo. One toggle per
   * dancer is what the job needs, and the LOWEST-numbered one selected is the one the tile shows.
   *
   * The set can never be emptied: unticking the last one is refused, because a panel showing a dancer's
   * move with no dancer selected has no sensible meaning.
   */
  private renderDancerPicks() {
    const call = this.instance;
    const host = this.moveDancerSel;
    host.innerHTML = '';
    if (!call) return;
    const sel = this.selectedDancers;
    // Once, not per chip: `instanceTable` matches the start formation against the home square, and
    // eight of those for eight tooltips is work nobody asked for.
    const rows = instanceTable(call);
    for (let i = 0; i < call.dancers.length; i++) {
      const d = call.dancers[i];
      const b = document.createElement('button');
      b.type = 'button';
      // NO FOCUS RING WITH NOTHING SELECTED: `moveDancer` falls back to dancer 0 for the tile's numbers, and
      // a ring round dancer 1 in a panel that says "nothing selected" reads as a selection that is not there.
      b.className = 'ed-pick' + (sel.has(i) ? ' on' : '') + (i === this.moveDancer && sel.size > 0 ? ' focus' : '');
      b.textContent = String(i + 1);
      b.title =
        `dancer ${i + 1} (${d.gender}, couple read ${rows[i]?.couple ?? '—'}, ${d.path.length} moves)` +
        (i === this.moveDancer ? ' — the one the tile shows' : '') +
        '\nClick to add it to the selection, or to take it out (the last one cannot be removed).';
      b.addEventListener('click', () => {
        if (sel.has(i)) {
          if (sel.size === 1) return; // never empty
          sel.delete(i);
        } else {
          sel.add(i);
        }
        this.renderInstance();
      });
      host.appendChild(b);
    }
  }

  /**
   * EVERY move of the chosen track, in order, as one strip - so the whole path being edited
   * is visible at once instead of one move at a time behind a dropdown. The move being edited
   * is TRIPLE WIDTH (180px against the compact tiles' 60px, per the stylesheet) and carries
   * its numbers; the others are compact tiles, and clicking one selects it - which is also
   * what moves the track highlight, because the selection IS the trail instruction.
   */
  private renderMoveStrip() {
    const host = this.moveStripEl;
    host.innerHTML = '';
    // NOWHERE TO WRITE. With no dancers selected the strip would be showing one dancer's moves as if they
    // were the edit's target, so it says what is true instead: nothing is selected.
    if (this.selectedDancers.size === 0) {
      host.innerHTML = '<i class="small">no dancers selected — the ticks in the table, or the buttons above it, pick who an edit applies to</i>';
      this.moveInfoEl.textContent = '';
      return;
    }
    const moves = this.currentMoves();
    if (moves.length === 0) {
      host.innerHTML = '<i class="small">this dancer has no moves — use + Move to add one</i>';
      this.moveInfoEl.textContent = '';
      return;
    }
    if (this.moveIndex >= moves.length) this.moveIndex = moves.length - 1;
    // A FACING SELECTION DOES NOT SURVIVE A MOVE THAT HAS NO FACING. Clicking through the strip
    // while editing facings should keep you in facing mode, but not on a move where there is no
    // such shape - otherwise the tile would claim a selection the board is not drawing.
    if (this.moveKind === 'facing' && moves[this.moveIndex]?.rotate == null) this.moveKind = 'move';
    // THE SAME RANGE THE COPY BUTTON COVERS, asked for once: the highlight below has to show exactly the moves
    // a copy would take, or the caller is checking a range the button will not use.
    const run = this.selectedMoveRange();
    for (let k = 0; k < moves.length; k++) {
      const tile = k === this.moveIndex ? this.currentMoveTile(moves[k]) : this.compactMoveTile(moves[k], k);
      // THE RUN IS VISIBLE IN THE STRIP, not only in the field that set it: a range that is invisible is a
      // range the caller cannot check before pressing the button.
      if (k !== this.moveIndex && run.includes(k)) {
        tile.classList.add('in-run');
      }
      host.appendChild(tile);
    }
    const cur = moves[this.moveIndex];
    const runLabel = run.length > 1 ? ` \u00b7 run ${run[0] + 1}\u2013${run[run.length - 1] + 1}` : '';
    this.moveInfoEl.textContent = `move ${this.moveIndex + 1}/${moves.length} · ${show(cur.beats)}b · ${cur.hands}${runLabel}`;
  }

  /** A move you are not editing: its number, its beats and its hands, and nothing else. */
  private compactMoveTile(seg: Seg, k: number): HTMLElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'ed-move';
    tile.title = `move ${k + 1}: ${show(seg.beats)} beats, hands ${seg.hands}${seg.rotate ? ', explicit facing' : ', facing along travel'} — click to edit`;
    const n = document.createElement('b');
    n.textContent = String(k + 1);
    const b = document.createElement('span');
    b.textContent = `${show(seg.beats)}b`;
    const h = document.createElement('span');
    h.textContent = handsShort(seg.hands);
    tile.append(n, b, h);
    tile.addEventListener('click', (ev) => this.selectMove(k, ev.shiftKey));
    return tile;
  }

  /**
   * Choose a move in the strip.
   *
   * `renderMoveStrip` rather than `renderInstance`, because the rest of the panel - the formation
   * table, the scrub bar, the clone warning - does not depend on which move is selected, and rebuilding
   * it on every click is work for nothing.
   *
   * `syncStageSelection` IS NOT OPTIONAL HERE, and it is what was missing: it re-focuses the trail
   * highlight AND re-draws the handles, so the board shows the move that was just clicked. Without it
   * the highlight moved and the handles stayed behind on the previous move's control points.
   */
  private selectMove(k: number, extend = false) {
    if (extend && k !== this.moveIndex) {
      // SHIFT-CLICK EXTENDS THE RUN rather than moving the cursor, which is the standard range idiom and the
      // only way to say "these moves" in a strip that otherwise selects exactly one. The run always STARTS at
      // the selected move, so extending backwards is the same gesture as extending forwards.
      this.circleTo = k;
      this.circleRadius = null;
      this.circleCentre = null;
      this.renderMoveStrip();
      this.syncStageSelection();
      return;
    }
    const changed = k !== this.moveIndex || this.circleTo !== null || this.circleRadius !== null || this.circleCentre !== null;
    this.moveIndex = k;
    // A plain click is "just this move", which is also what collapses a run that was open.
    this.circleTo = null;
    this.circleRadius = null;
    this.circleCentre = null;
    if (!changed) return;
    this.renderMoveStrip();
    this.syncStageSelection();
  }

  /** The move being edited: TRIPLE width, with its beats, hands, travel and facing.
   *
   * A MOVE HAS TWO SHAPES AND THEY ARE SELECTED SEPARATELY. The translation Bezier is where the
   * dancer GOES; the rotation Bezier is how they TURN. They are different curves in different
   * spaces, they are drawn differently on the board (a highlighted path, or heading ticks), and
   * editing one while looking at the other is how a facing gets set to nonsense. So the tile carries
   * a `move | facing` selection and shows one at a time.
   *
   * FACING IS ONLY SELECTABLE WHEN IT EXISTS. `rotate` absent means "face along the travel tangent",
   * which is the taminations default and NOT a curve anyone can edit - so with the explicit box
   * unticked there is no facing shape to select, and the tab is disabled rather than opening onto
   * nothing. The explicit box itself stays reachable in the header; turning it off while Facing is
   * selected falls back to Move. */
  private currentMoveTile(seg: Seg): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'ed-move selected';
    const i = this.moveDancer;
    const k = this.moveIndex;
    const t = seg.translate;
    const head = document.createElement('div');
    head.className = 'ed-move-head';
    const name = document.createElement('b');
    name.textContent = `move ${k + 1}`;
    head.appendChild(name);

    const rchk = document.createElement('input');
    rchk.type = 'checkbox';
    rchk.checked = seg.rotate != null;
    rchk.dataset.key = `m${i}:${k}:rot`;
    rchk.title = 'Off: the dancer faces along the travel tangent (no rotation Bezier - and no facing shape to select). On: an explicit facing curve.';
    const rc = document.createElement('label');
    rc.textContent = 'explicit';
    rchk.addEventListener('change', () => {
      // Turning the facing OFF while it is selected would leave the tile showing a shape that no
      // longer exists, so the selection falls back with it.
      if (!rchk.checked && this.moveKind === 'facing') this.moveKind = 'move';
      // Turning the facing ON copies the DANCER'S OWN translation curve, which is behaviour-
      // preserving on every selected dancer (it is the curve `poseFor` already falls back to) and
      // keeps each dancer's facing curve its own rather than the focused dancer's.
      write((s) => ({ ...s, rotate: rchk.checked ? { ...s.translate } : null }), 'rot');
    });
    head.appendChild(rchk);
    head.appendChild(rc);
    tile.appendChild(head);

    // PER-DANCER PATCHES, and that is not a detail: a patch built from THIS dancer's segment
    // (`{...t, cx1: v}`) would copy this dancer's OTHER control points onto every other selected
    // dancer, which is the per-dancer difference a group edit exists to preserve. So each field
    // writes exactly its own value, into whichever dancer's segment it is handed. `curve` names the
    // Bezier the patch writes, which is what the gate above refuses a selection on.
    const write = (patch: (seg: Seg) => Seg, field: string, curve: CurveKind | null = null) => {
      this.commitMoveChange(patch, `m${i}:${k}:${field}`, false, curve);
    };

    // ITS OWN LINE, because the tile is 180px wide and `move 4` + `explicit` + two tabs does not
    // fit beside each other; the two-shape selection is the most important control here, so it gets
    // the space rather than being squeezed to fit.
    const tabs = document.createElement('span');
    tabs.className = 'ed-tabs';
    for (const kind of ['move', 'facing'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.key = `m${i}:${k}:tab:${kind}`;
      b.textContent = kind;
      if (this.moveKind === kind) b.className = 'on';
      b.disabled = kind === 'facing' && seg.rotate == null;
      b.title =
        kind === 'facing'
          ? seg.rotate
            ? 'The FACING shape: how the dancer turns through this move (drawn as heading ticks)'
            : 'This move has no explicit facing - tick "explicit" to give it one'
          : 'The MOVE shape: where the dancer goes (drawn along the path)';
      b.addEventListener('click', () => {
        if (this.moveKind === kind) return;
        this.moveKind = kind;
        this.renderInstance(`m${i}:${k}:tab:${kind}`);
      });
      tabs.appendChild(b);
    }
    tile.appendChild(tabs);

    // WHICH HANDLES THE BOARD OFFERS, as a button, because the two sets overlap often enough that one of
    // them is unreachable when both are drawn (see `handleMode`: 5.5% of the corpus's curves have their
    // controls EXACTLY coincident, and the end point is where a control can sit anyway).
    const hbtn = document.createElement('button');
    hbtn.type = 'button';
    hbtn.dataset.key = `m${i}:${k}:handles`;
    hbtn.textContent = this.handleMode === 'end' ? '⇄ ends' : '⇄ controls';
    // AND WHEN THE PATH IS AN ARC, SAY SO - the centre handle is otherwise a dot in the middle of the floor
    // with nothing on screen to explain it. The fit is asked here rather than remembered so the sentence and
    // the handle cannot disagree.
    const arc = this.moveKind === 'move' ? fitCircle(seg.translate, ARC_FIT_TOL) : null;
    const arcNote = arc
      ? ` This path is an ARC (radius ${show(arc.r)}, ${Math.abs(toDeg(arc.sweep)).toFixed(0)}deg), so its CENTRE is drawn too: drag that to swing the arc about its start, holding both the radius and the direction the dancer arrives with.`
      : '';
    hbtn.title =
      this.handleMode === 'end'
        ? `The board is showing the END POINTS: where this move finishes, and (on the Facing tab) the heading it finishes on. Click for the curve's CONTROL POINTS.${arcNote}`
        : `The board is showing the curve's CONTROL POINTS. Click for the END POINTS - where the move finishes - because a control point can sit on top of the end point, and then only one of the two can be grabbed.${arcNote}`;
    hbtn.addEventListener('click', () => {
      this.handleMode = this.handleMode === 'end' ? 'control' : 'end';
      this.renderInstance();
      this.statusEl.textContent =
        this.handleMode === 'end'
          ? 'handles: the END points — dragging the move\'s end holds the direction the dancer leaves on'
          : 'handles: the curve\'s control points';
    });
    tile.appendChild(hbtn);

    const grid = document.createElement('div');
    grid.className = 'ed-grid';
    // THE TAB'S OWN CURVE, and nothing else: the fields below write `translate` on the Move tab and
    // `rotate` on the Facing tab, so that is what the gate is asked about.
    const curve: CurveKind = this.moveKind === 'facing' ? 'facing' : 'travel';
    const coordsOk = this.coordinatesAgree(curve);

    // THE ARC LOCK, resolved before anything is drawn.
    //
    // The flag follows the SELECTION (see `arcOn`), and it is initialised from the data every time the
    // tile is built for a different curve - so a curve whose numbers already are a quarter arc comes up
    // locked, and one that is not comes up free.
    const curveKey = `m${i}:${k}:tab:${this.moveKind}`;
    if (this.arcKey !== curveKey) {
      this.arcKey = curveKey;
      const c0 = this.moveKind === 'facing' ? seg.rotate : seg.translate;
      this.arcOn = !!c0 && arcOf(c0) !== null;
    }
    // Whether a quarter arc is POSSIBLE here is the engine's answer, not the panel's: a quarter arc's
    // two end tangents are perpendicular, so a curve whose handles are not at a right angle cannot be
    // locked without turning the dancer - and the reasons are separated because "no handle to size it
    // from" and "your handles are not at a right angle" call for different things from the caller.
    const cur = this.moveKind === 'facing' ? seg.rotate : seg.translate;
    const allowBackwards = this.moveKind === 'move';
    const blocker: ArcBlocker | null = cur ? arcBlocker(cur, allowBackwards) : 'no-handle-length';
    const arcParams = this.arcOn && cur ? (arcOf(cur) ?? projectToArc(cur, allowBackwards)) : null;

    // ---- THE CURVE'S NUMBERS: RELATIVE AND ABSOLUTE, ONE ROW PER COORDINATE --
    //
    // Asked for: "display absolute coordinates alongside the existing relative coordinates. Both can be
    // edited, updating the other."
    //
    // THE TWO SETS ARE ONE POINT SEEN FROM TWO PLACES, and the round trip is an isometry, so neither is a
    // derived readout of the other - edit either and the other follows exactly. The RELATIVE number is the
    // tangent-space description the FORMAT stores, measured from the dancer when the move begins with +X
    // along their own facing; the ABSOLUTE pair is where that same point sits on the floor. ONE ROW PER
    // COORDINATE, so the pair reads across instead of the second set arriving as a block of its own.
    //
    // WHAT AN ABSOLUTE EDIT MEANS FOR A GROUP. The frame is the SHOWN dancer's, so the numbers are theirs -
    // and the relative value they convert to is what every selected dancer receives, which is exactly the
    // drag's rule: everyone lands on the same SHAPE rather than on the same spot (`applyHandleDrag`). One
    // rule for both ways of moving a point, rather than a second, quieter one.
    {
      // `facing` is the BRANCH, not the tab: a move with no rotation curve has no facing shape to show and
      // the tab that would open on it is disabled, so a stale `moveKind` falls back to the path - as it did
      // when these were two blocks.
      const facing = this.moveKind === 'facing' && !!seg.rotate;
      const shown = facing ? seg.rotate : seg.translate;
      const dancer = this.instance?.dancers[i];
      // WHERE THE ABSOLUTE PAIR IS READ: the pose the shown dancer starts the move from. Doubt about the
      // dancer costs the second column and never the first - the relative fields are the format's own
      // numbers and need no frame at all.
      const frame = dancer && shown ? poseFor(dancer, moveBeatRange(dancer, k).from) : null;

      // THE RELATIVE FIELD BEHIND EACH ABSOLUTE ONE. The two names differ because the XML's do: a facing
      // curve's first control is `cx3` where the path's is `cx1`. It is `null` where the FORMAT CANNOT CARRY
      // the coordinate at all - `tamination.dtd` declares the rotate as `cx3, cx4, cy4, x4, y4`, so there is
      // no `cy3` - and that row has no relative field to sit beside its absolute pair.
      type Slot = 'cx1' | 'cy1' | 'cx2' | 'cy2' | 'x2' | 'y2';
      const relative: Record<string, { key: Slot; label: string } | null> = facing
        ? { C1x: { key: 'cx1', label: 'cx3' }, C1y: null, C2x: { key: 'cx2', label: 'cx4' }, C2y: { key: 'cy2', label: 'cy4' }, P3x: { key: 'x2', label: 'x4' }, P3y: { key: 'y2', label: 'y4' } }
        : { C1x: { key: 'cx1', label: 'cx1' }, C1y: { key: 'cy1', label: 'cy1' }, C2x: { key: 'cx2', label: 'cx2' }, C2y: { key: 'cy2', label: 'cy2' }, P3x: { key: 'x2', label: 'x2' }, P3y: { key: 'y2', label: 'y2' } };
      const relLocked = !coordsOk || this.arcOn;
      const REL_HINT = 'in the DANCER\'s own frame when the move begins: +X is the way they face';
      const ABS_HINT = 'the same point on the FLOOR - edit either column and the other follows';

      const table = document.createElement('div');
      table.className = 'ed-coords';
      const heading = document.createElement('div');
      heading.className = 'ed-coords-head';
      const hRel = document.createElement('span');
      hRel.textContent = 'relative';
      hRel.title = REL_HINT;
      const hAbs = document.createElement('span');
      hAbs.textContent = 'absolute';
      hAbs.title = ABS_HINT;
      heading.append(document.createElement('span'), hRel, hAbs);
      table.appendChild(heading);

      // A DASH RATHER THAN A DEAD FIELD, where there is no such number to show at all.
      const none = (title?: string) => {
        const g = document.createElement('span');
        g.className = 'ed-coord-none';
        g.textContent = '\u2014';
        if (title) g.title = title;
        return g;
      };

      for (const p of CURVE_POINTS) {
        // THE FACING CURVE'S FIRST CONTROL IS ON THE RAIL: the format has no `cy3`, so its Y is 0 by
        // construction and its absolute pair is a readout of where that dot sits rather than a second way
        // to move it.
        const railedY = facing && p.ly === 'cy1';
        const lyKey = railedY ? null : p.ly;
        const lx = shown ? (shown[p.lx] as number) : 0;
        const ly = lyKey && shown ? (shown[lyKey] as number) : 0;
        const at = frame ? localToFloor(frame, lx, ly) : null;
        for (const axis of ['x', 'y'] as const) {
          // THE RAIL IS THE POINT'S *Y*, NOT THE POINT. The format has no `cy3`, so that one number is a
          // readout - but the first control's X IS carried (`cx3`, named in the DTD's own list) and the panel
          // let it be edited long before this table existed. Locking the whole row would take that away.
          const railedAxis = railedY && axis === 'y';
          const point = `${p.point}${axis}`;
          const rel = relative[point];
          const row = document.createElement('div');
          row.className = 'ed-coords-row';
          const name = document.createElement('label');
          name.textContent = rel ? rel.label : '\u2014';
          if (!rel) name.title = 'the format has no cy3: this control of a facing curve is pinned to the dancer\'s forward axis';
          row.appendChild(name);

          // ---- the RELATIVE field: the number the FORMAT stores
          if (rel && shown) {
            row.appendChild(
              this.numberInput(
                facing ? `m${i}:${k}:r.${rel.key}` : `m${i}:${k}:t.${rel.key}`,
                shown[rel.key] as number,
                0.25,
                (v) => write(
                  (s) => (facing
                    ? { ...s, rotate: { ...(s.rotate ?? s.translate), [rel.key]: v } }
                    : { ...s, translate: { ...s.translate, [rel.key]: v } }),
                  facing ? `r.${rel.key}` : `t.${rel.key}`,
                  facing ? 'facing' : 'travel',
                ),
                // LOCKED BY EITHER GATE, and the two read the same on purpose: the group gate locks the
                // fields because one set of numbers cannot describe several shapes, and the ARC locks them
                // because the five numbers are no longer independent - they follow from the two lengths.
                relLocked,
                relLocked ? undefined : REL_HINT,
                true,
              ),
            );
          } else {
            row.appendChild(none(rel ? 'no dancer is selected, so there is no frame to read this in' : 'the format carries no cy3 for this control'));
          }

          // ---- the ABSOLUTE field: the same point on the floor
          if (at) {
            const key = `m${i}:${k}:a.${point}`;
            row.appendChild(
              this.numberInput(
                key,
                axis === 'x' ? at.x : at.y,
                0.25,
                (v) => {
                  // THE OTHER AXIS IS WHATEVER IT IS NOW, so naming an X does not silently reset the Y - and
                  // on the railed point there is no other LOCAL axis to keep: the format's own zero for the Y
                  // is left where it is and only `lx` is written.
                  if (railedAxis) return;
                  const want = axis === 'x' ? { x: v, y: at.y } : { x: at.x, y: v };
                  const local = floorToLocal(frame as MoveFrame, want.x, want.y);
                  write((s) => {
                    const c = facing ? s.rotate : s.translate;
                    if (!c) return s;
                    const next = lyKey ? { ...c, [p.lx]: local.lx, [lyKey]: local.ly } : { ...c, [p.lx]: local.lx };
                    return facing ? { ...s, rotate: next } : { ...s, translate: next };
                  }, key, facing ? 'facing' : 'travel');
                },
                // LOCKED BY THE SAME TWO GATES as the field beside it - one set of numbers cannot describe
                // several shapes, and an arc's five numbers are not independent - plus the rail, which is
                // the format's own constraint rather than this gadget's choice.
                relLocked || railedAxis,
                railedAxis
                  ? 'this control is pinned to the dancer\'s forward axis - the format has no cy3 - so its board position is a readout rather than an edit. Drag the dot, or edit cx3 above.'
                  : relLocked ? undefined : ABS_HINT,
                true,
              ),
            );
          } else {
            row.appendChild(none());
          }
          table.appendChild(row);
        }
      }
      grid.appendChild(table);
    }

    if (!coordsOk) {
      // SAID WHERE IT APPLIES, AND WITH THE DIFFERENCE IN IT. A field that is greyed out with no
      // explanation reads as a bug - and "they look the same" is the report that produced this sentence:
      // the panel names the pair and gives the size of the disagreement IN THE CURVE'S OWN UNITS, so a
      // locked Move tab says how far apart the two paths are and a locked Facing tab says by how many
      // degrees the two dancers turn differently. Naming the curve matters: on a completed clone the
      // paths are frequently identical while the turns are not, and "2.00 units apart" - the dancers'
      // standing separation, which is what measuring the floor used to report - reads as a disagreement
      // about the move when the paths in fact agree exactly.
      //
      // THERE IS NO "but it is only the last decimals" CASE ANY MORE, and the branch that said so is gone
      // with it: the windows ARE the visibility thresholds (a half-pixel of movement, half a degree of
      // turn), so a refusal is always about a difference a caller could see. The branch was reachable only
      // while the gate compared raw numbers, where a difference of 1e-16 refused two identical curves.
      const diff = this.coordsDisagreement(curve);
      const note = document.createElement('div');
      note.className = 'small';
      const what = curve === 'travel' ? 'move alike' : 'turn alike';
      const size = curve === 'travel' ? `${show(diff?.gap ?? 0)} units apart` : `${show(diff?.gap ?? 0)}deg apart`;
      const tab = curve === 'travel' ? 'Move' : 'Facing';
      note.textContent = this.selectedSorted().length === 0
        ? 'no dancers selected — this tile has nowhere to write. Pick dancers with the buttons above the table.'
        : diff
          ? `coordinates locked: dancer ${this.moveDancer + 1} and dancer ${diff.dancer + 1} do not ${what} here - their ${curve === 'travel' ? 'curves are' : 'facings are'} ${size}. The ${tab} tab edits ${curve === 'travel' ? 'the path' : 'the facing'} alone, so select one dancer to edit it.`
        : `coordinates locked: the ${this.selectedSorted().length} selected dancers do not share this move's ${curve === 'travel' ? 'path' : 'facing'}, and one set of numbers cannot describe several - select one dancer to edit it`;
      grid.appendChild(note);
    }

    // ---- the quarter-arc lock -------------------------------------------------
    //
    // A CHECKBOX ON EACH TAB, as asked for, and it is disabled - with the reason on screen - wherever a
    // quarter arc is not possible. MEASURED over b1/ms/a1 (`engine/test/editor.mjs`, section 17h):
    // 71.5% of the corpus's curves have handles that are not at a right angle, 11.9% have no handle
    // length to size from, and none of them is a quarter arc - so the disabled state is the COMMON one
    // and a dead checkbox with no explanation would be the normal experience.
    const arcRow = document.createElement('span');
    arcRow.className = 'ed-group';
    const achk = document.createElement('input');
    achk.type = 'checkbox';
    achk.checked = this.arcOn;
    achk.disabled = blocker !== null;
    achk.dataset.key = `m${i}:${k}:arc`;
    achk.title =
      blocker === 'no-handle-length'
        ? 'Both of this curve\'s handles have zero length, so there is nothing to size a quarter arc from - drag a control point out first, or type a coordinate.'
        : blocker === 'handles-not-perpendicular'
          ? 'This curve\'s two handles are not at a right angle. A quarter arc\'s end tangents are perpendicular by definition, so locking this curve would have to turn the dancer - which the lock refuses to do.'
          : blocker === 'starts-backwards'
            ? 'The start handle points backwards, which for a facing curve would mean the dancer snapping round 180deg as the move begins.'
            : 'Lock this curve to a quarter of a circle or an ellipse. Its two handles keep their lengths and their directions and the endpoint moves to the conic\'s corner, so the dancer sets off and finishes facing exactly as it did. Tick it and the coordinates stop being independent - only the two handle lengths are editable.';
    if (blocker) arcRow.classList.add('locked');
    const alab = document.createElement('label');
    alab.textContent = 'arc';
    achk.addEventListener('change', () => {
      this.arcOn = achk.checked;
      if (!achk.checked) {
        // UNTICKING DOES NOT TOUCH THE CURVE. It releases the fields, which is the whole of what the
        // lock was doing; the numbers are still a quarter arc until an edit moves them off it.
        this.renderInstance(`m${i}:${k}:arc`);
        return;
      }
      const p = cur ? projectToArc(cur, allowBackwards) : null;
      if (!p) {
        this.arcOn = false;
        this.renderInstance(`m${i}:${k}:arc`);
        return;
      }
      // ONE SET OF PARAMETERS, written to every selected dancer - the same rule as every other
      // coordinate edit, and the gate refuses it when the selected curves differ.
      write((s) => {
        const b2 = arcBezier(p);
        return this.moveKind === 'facing' ? { ...s, rotate: b2 } : { ...s, translate: b2 };
      }, 'arc', curve);
    });
    arcRow.append(achk, alab);
    grid.appendChild(arcRow);

    // ---- COPY / PASTE THE END POINT, asked for as three buttons beside the arc box ----
    //
    // The names are the request's own: C copies, Pr pastes the point back as RELATIVE coordinates and Pa as
    // BOARD ones - left to right, the order the two columns are read in. Those are different edits the moment the moves before this one have moved, which is the
    // whole reason there are two of them: deleting or adding a move leaves a later move's local numbers alone
    // and shifts where they land on the floor, while re-aiming a move moves the local numbers under a floor
    // position that did not change. Each move keeps BOTH pairs, and only that move can paste them.
    //
    // C IS LIT WHILE THIS MOVE HOLDS SOMETHING, and its hover is the numbers: a highlight says that something is
    // held, and only the values say WHICH point. Asked for: "each Users Move has it's own copy of the
    // coordinates... These copied coordinates are only available to that specific move" - so a move that holds
    // nothing shows a dim C and disabled pastes, and copying a run lights each move of it rather than all of them.
    const clipRow = document.createElement('span');
    clipRow.className = 'ed-group ed-clip';
    const held = this.heldBy(k);
    const cbtn = document.createElement('button');
    cbtn.type = 'button';
    cbtn.dataset.key = `m${i}:${k}:copy`;
    cbtn.textContent = 'C';
    cbtn.title = this.clipTitle(held);
    if (held) cbtn.classList.add('on');
    cbtn.addEventListener('click', () => this.copyMoveEnds());
    // THE PASTES WRITE, so they carry the same two locks the fields beside them do: one set of numbers cannot
    // describe several shapes, and an arc's five numbers are not independent. COPYING DOES NOT - it is a read,
    // and taking a point off a locked move before narrowing the selection is exactly when it is wanted.
    const pasteBtn = (label: string, absolute: boolean, key: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.key = key;
      b.textContent = label;
      b.disabled = !held || !coordsOk || this.arcOn;
      b.title = !held
        ? 'This move is holding nothing - press C to take its end point first. A copy belongs to the move it was taken from, so another move\'s copy cannot be pasted here.'
        : `Paste THIS move's copied end point as ${absolute ? 'BOARD' : 'RELATIVE'} coordinates: ` +
          (absolute
            ? 'it goes back to where it was on the FLOOR, whatever the moves before it now do.'
            : 'it goes back to the same place in the DANCER\'s own frame, whatever the moves before it now do.') +
          ' Every move of the run takes its own, and a move holding nothing is left alone.';
      b.addEventListener('click', () => this.pasteMoveEnds(absolute));
      return b;
    };
    // THE PASTES COME IN COLUMN ORDER. The table under the tile reads `relative` then `absolute`, so the buttons
    // read Pr then Pa - asked for as "switch the Pa, Pr buttons to reflect the column order" - and each one is
    // over the column it writes.
    clipRow.append(cbtn, pasteBtn('Pr', false, `m${i}:${k}:pasteRel`), pasteBtn('Pa', true, `m${i}:${k}:pasteAbs`));
    grid.appendChild(clipRow);
    if (blocker) {
      // SAY WHY, NUMBERED. A disabled control with no explanation is indistinguishable from a broken
      // one, and the angle is the number that tells the caller what to fix about the handles.
      const angle = blocker === 'handles-not-perpendicular' && cur ? arcCorner(cur) : null;
      const why = document.createElement('div');
      why.className = 'small';
      why.textContent =
        blocker === 'no-handle-length'
          ? 'no arc: this curve has no handle length to size one from'
          : blocker === 'starts-backwards'
            ? 'no arc: a facing curve that starts by turning 180deg'
            : `no arc: this curve's two handles are ${((Math.abs(angle ?? 0) * 180) / Math.PI).toFixed(1)}deg apart, and a quadrant needs a right angle`;
      grid.appendChild(why);
    }
    if (arcParams) {
      // THE TWO HANDLE LENGTHS ARE THE WHOLE SHAPE, so they are the two fields - and they are the
      // "x and y offsets of the lines start and finish" whose equality makes it a circle.
      const arcField = (key: 'x' | 'y', label: string) => {
        const wrap = document.createElement('span');
        wrap.className = 'ed-group';
        const l = document.createElement('label');
        l.textContent = label;
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.25';
        input.value = show(arcParams[key]);
        input.dataset.key = `m${i}:${k}:arc.${key}`;
        input.title =
          key === 'x'
            ? 'The START handle\'s length, along the direction the curve sets off in. Always a length: the direction carries the sign.'
            : 'The FINISH handle\'s length, at right angles to the start. Its sign is the turn - positive is the dancer\'s left.';
        input.addEventListener('change', () => {
          const v = parseFloat(input.value);
          if (!Number.isFinite(v)) { this.renderInstance(); return; }
          // x is a LENGTH and cannot be negative - the direction carries the sign - while y KEEPS the
          // sign the caller typed, because its sign is which way the turn goes.
          const next: ArcParams = { x: key === 'x' ? Math.max(0, v) : arcParams.x, y: key === 'y' ? v : arcParams.y, angle: arcParams.angle };
          write((s) => {
            const b2 = arcBezier(next);
            return this.moveKind === 'facing' ? { ...s, rotate: b2 } : { ...s, translate: b2 };
          }, `arc.${key}`, curve);
        });
        wrap.append(l, input);
        return wrap;
      };
      grid.appendChild(arcField('x', 'arc x'));
      grid.appendChild(arcField('y', 'arc y'));
      const shape = document.createElement('div');
      shape.className = 'small';
      const r0 = arcParams.x / ARC_K;
      const r1 = Math.abs(arcParams.y) / ARC_K;
      shape.textContent = arcIsCircle(arcParams)
        ? `quarter CIRCLE, radius ${show(r0)} - the two offsets are equal, so the conic has equal semi-axes${arcParams.y < 0 ? ', turning right' : ''}`
        : `quarter ELLIPSE, ${show(r0)} x ${show(r1)} - the offsets differ, so the semi-axes do${arcParams.y < 0 ? ', turning right' : ''}`;
      grid.appendChild(shape);
      const locked = document.createElement('div');
      locked.className = 'small';
      locked.textContent =
        'the coordinates are locked: the curve is a quarter arc, so its five numbers follow from these two handle lengths. The curve\'s directions are untouched - only the endpoint moved, to the conic\'s corner.';
      grid.appendChild(locked);
    }

    // ---- the RUN-level circle ------------------------------------------------
    //
    // A MOVE CANNOT TURN MORE THAN A QUARTER, so a circle is never one curve - it is a RUN of them. MEASURED
    // over the corpus: of 10884 circular moves NOT ONE sweeps past 90deg, while 4589 runs of two or more
    // consecutive moves lie on a single circle, with a median turn of 270deg and a longest of 765. The
    // quarter-arc lock above can only ever describe one of those pieces; this control names the whole run.
    //
    // AND IT KEEPS BOTH ENDS. A circular arc has five numbers and pinning both endpoints spends four of them,
    // so what is left is ONE continuous choice - the radius - and ONE discrete one, which way round. Both end
    // headings then follow from the circle, which is why an arc built here cannot fail to join up.
    const all = this.currentMoves();
    if (all.length >= 2 && k < all.length - 1) {
      const to = Math.min(this.circleTo ?? k + 1, all.length - 1);
      const fit = this.instance ? fitCircleRun(this.instance, i, k, to) : null;
      const beats = all.slice(k, to + 1).reduce((a, g) => a + g.beats, 0);
      const radius = this.circleRadius ?? fit?.r ?? null;
      // THREE GROUPS AND NOT ONE, because `.ed-group` is a NOWRAP flex row and `.ed-grid` is the thing that
      // wraps. Six items in a single group is a row that cannot break, so the button fell off the end of the
      // pane at the panel's width; as separate groups each label+control pair wraps like every other field.
      const runWrap = document.createElement('span');
      runWrap.className = 'ed-group';
      const lab = document.createElement('label');
      lab.textContent = 'circle to';
      lab.title =
        'Lay a RUN of consecutive moves on one arc, keeping both ends where they are. The run keeps its move count, its beats and its hands; only the shape between its ends is rewritten, and the turn is spread in proportion to the beats. The radius is the continuous choice and the side is the discrete one - the end headings follow from the circle.';
      const toInput = document.createElement('input');
      toInput.type = 'number';
      toInput.min = String(k + 2);
      toInput.max = String(all.length);
      toInput.step = '1';
      toInput.value = String(to + 1);
      toInput.dataset.key = `m${i}:${k}:circle.to`;
      toInput.title = `The LAST move of the run, which starts at move ${k + 1}. Shift-click a move in the strip to set it there instead.`;
      toInput.addEventListener('change', () => {
        const v = Math.round(parseFloat(toInput.value));
        this.circleTo = Number.isFinite(v) ? Math.min(Math.max(v - 1, k + 1), all.length - 1) : null;
        this.circleRadius = null;
        this.renderInstance(`m${i}:${k}:circle.to`);
      });
      runWrap.append(lab, toInput);
      grid.appendChild(runWrap);

      const rWrap = document.createElement('span');
      rWrap.className = 'ed-group';
      const rLab = document.createElement('label');
      rLab.textContent = 'radius';
      const rInput = document.createElement('input');
      rInput.type = 'number';
      rInput.step = '0.25';
      rInput.min = '0';
      rInput.value = radius !== null ? show(radius) : '';
      rInput.placeholder = fit ? show(fit.r) : 'needs one';
      rInput.dataset.key = `m${i}:${k}:circle.r`;
      rInput.title = fit
        ? 'The radius to lay the run on. It follows each dancer\'s OWN ends, so it is the one thing a group edit can hold in common - the centre is whatever that dancer\'s run implies.'
        : 'This run is not on a circle, so there is no radius to take from it and one has to be given.';
      rInput.addEventListener('change', () => {
        const v = parseFloat(rInput.value);
        this.circleRadius = Number.isFinite(v) && v > 0 ? v : null;
        // A RADIUS AND A CENTRE ARE TWO WAYS TO DRIVE THE SAME TWO DEGREES OF FREEDOM, so naming one releases
        // the other rather than leaving a stale value to fight it.
        if (this.circleRadius !== null) this.circleCentre = null;
        this.renderInstance(`m${i}:${k}:circle.r`);
      });
      rWrap.append(rLab, rInput);
      grid.appendChild(rWrap);

      // ---- where the circle IS -------------------------------------------------
      //
      // A CENTRE, because a radius is the wrong handle for the thing that actually goes wrong. An orbit can be
      // the right size and still be in the wrong PLACE, and because the run's start is pinned the two are not
      // independent: naming a centre FIXES the radius at |start - centre|. That is what makes this the right
      // gesture for `ms/circle.xml`'s `Circle Left` from a `Circle`, whose dancers stand on a ring of radius
      // 2.613 about the origin and walk an orbit of radius 2.595 centred 1.013 units off it - naming the origin
      // re-centres every dancer's orbit onto the ring it started from, and lets the radius fall where it may.
      const cWrap = document.createElement('span');
      cWrap.className = 'ed-group';
      const cLab = document.createElement('label');
      cLab.textContent = 'centre';
      cLab.title =
        'The point the run goes round. Unlike the radius this is SHARED by every selected dancer, and each dancer\'s own radius follows from where its run starts - so putting the centre at the origin puts every orbit round the middle of the set. Empty means "wherever each dancer\'s own run already has it".';
      const centreInput = (axis: 'x' | 'y') => {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.25';
        inp.value = this.circleCentre ? show(this.circleCentre[axis]) : '';
        inp.placeholder = fit ? show(axis === 'x' ? fit.cx : fit.cy) : axis;
        inp.dataset.key = `m${i}:${k}:circle.c${axis}`;
        inp.title = axis === 'x' ? 'Centre X. Type both to name a centre, or press `origin`.' : 'Centre Y.';
        inp.addEventListener('change', () => {
          // BOTH NUMBERS ARE NEEDED, so one is completed from the run's own centre rather than treated as zero.
          const base = this.circleCentre ?? { x: fit?.cx ?? 0, y: fit?.cy ?? 0 };
          const v = parseFloat(inp.value);
          const next = { ...base, [axis]: Number.isFinite(v) ? v : base[axis] };
          this.circleCentre = inp.value.trim() === '' && axis === 'x' ? null : next;
          this.circleRadius = null;
          this.renderInstance(`m${i}:${k}:circle.c${axis}`);
        });
        return inp;
      };
      const originBtn = document.createElement('button');
      originBtn.type = 'button';
      originBtn.textContent = 'origin';
      originBtn.dataset.key = `m${i}:${k}:circle.origin`;
      originBtn.title = 'Put the centre of the run at the origin - the middle of the set - for every selected dancer. The radius of each follows from where that dancer starts.';
      originBtn.addEventListener('click', () => {
        this.circleCentre = { x: 0, y: 0 };
        this.circleRadius = null;
        this.renderInstance(`m${i}:${k}:circle.origin`);
      });
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = 'clear';
      clearBtn.dataset.key = `m${i}:${k}:circle.clear`;
      clearBtn.title = 'Forget the named centre and go back to letting each dancer\'s own run say where the centre is.';
      clearBtn.addEventListener('click', () => {
        this.circleCentre = null;
        this.circleRadius = null;
        this.renderInstance(`m${i}:${k}:circle.clear`);
      });
      cWrap.append(cLab, centreInput('x'), centreInput('y'), originBtn, clearBtn);
      grid.appendChild(cWrap);

      const goWrap = document.createElement('span');
      goWrap.className = 'ed-group';
      const sideBtn = document.createElement('button');
      sideBtn.type = 'button';
      sideBtn.textContent = this.circleSide === 1 ? '↺' : '↻';
      sideBtn.dataset.key = `m${i}:${k}:circle.side`;
      sideBtn.title =
        'Which way round. In the usual case it is the side of the chord the centre falls on, and when a run starts and ends at the SAME point - a 360deg Circle Left - it is the direction of travel. It is the discrete half of the choice; the radius is the continuous half.';
      sideBtn.addEventListener('click', () => {
        this.circleSide = this.circleSide === 1 ? -1 : 1;
        this.renderInstance(`m${i}:${k}:circle.side`);
      });
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = 'make circle';
      go.dataset.key = `m${i}:${k}:circle.go`;
      go.title = 'Lay this run on the circle for every selected dancer, each about its own ends.';
      go.addEventListener('click', () => this.doRunCircle());
      goWrap.append(sideBtn, go);
      grid.appendChild(goWrap);

      const note = document.createElement('div');
      note.className = 'small';
      const span = `moves ${k + 1}–${to + 1} (${show(beats)} beats)`;
      if (this.circleCentre) {
        // A NAMED CENTRE FIXES THE RADIUS, so the honest readout is the one the shown dancer gets and a note
        // that the others follow from their own starts - not the radius field, which is per dancer here.
        const at = `centre (${show(this.circleCentre.x)}, ${show(this.circleCentre.y)})`;
        const shownDancer = this.instance?.dancers[i];
        const shownStart = shownDancer ? poseFor(shownDancer, k === 0 ? 0 : moveBeatRange(shownDancer, k - 1).to) : null;
        const shown = shownStart ? Math.hypot(shownStart.x - this.circleCentre.x, shownStart.y - this.circleCentre.y) : null;
        note.textContent = `${span}: ${at} · this dancer's radius follows from where its run starts` +
          (shown !== null && Number.isFinite(shown) ? ` (${show(shown)})` : '') +
          (fit ? ` · a turn of ${((Math.abs(fit.sweep) * 180) / Math.PI).toFixed(1)}°` : '');
      } else if (radius === null) {
        note.textContent = `${span}: this run is not on a circle, so give it a radius or a centre`;
      } else {
        // THE TURN THE RADIUS IMPLIES, and whether the run is long enough to carry it. A move carries at most
        // a quarter, so the requirement is stated as a number of moves rather than discovered by a refusal.
        const sweep = fit ? Math.abs(fit.sweep) : null;
        const need = sweep !== null ? runCircleMoveCount(sweep) : null;
        const bits = [`${span}: radius ${show(radius)}`];
        if (sweep !== null) bits.push(`a turn of ${((sweep * 180) / Math.PI).toFixed(1)}°`);
        if (need !== null) {
          bits.push(need <= to - k + 1 ? `carried by ${need} of its ${to - k + 1} moves` : `but that needs ${need} moves and the run has ${to - k + 1}`);
        }
        // The whole point of the quarter rule: say how many moves a full turn takes rather than letting a
        // refusal be the first the caller hears of it.
        if (sweep !== null && sweep < Math.PI / 2) bits.push(`(a full circle needs ${runCircleMoveCount(2 * Math.PI)} moves)`);
        note.textContent = bits.join(' · ');
      }
      grid.appendChild(note);
    }

    // ---- the FACING JOINT -------------------------------------------------
    //
    // THE ONE DISCONTINUITY THE HOLD CANNOT SMOOTH, said where it applies. A move with NO facing curve
    // faces along its own path - `poseFor` reads `bezierAngle(rotate ?? translate)` - so its heading at the
    // instant the move begins is the path's departure direction, `atan2(cy1, cx1)` off the forward axis,
    // and that is a STEP away from the heading the previous move left the dancer on. Holding the following
    // trace cannot remove it: the facing IS the path there, so the compensation would simply undo the edit.
    // So it is reported, and the number is the whole point - the panel otherwise gives no signal at all that
    // a joint is not smooth. Silent when both joints are, because the tile is already dense.
    {
      const stepInto = (j: number): { deg: number; facing: boolean } | null => {
        const s = this.instance?.dancers[i]?.path[j];
        if (!s) return null;
        return { deg: toDeg(normAngle(bezierAngle(s.rotate ?? s.translate, 0))), facing: !!s.rotate };
      };
      const sentence = (st: { deg: number; facing: boolean }, subject: string) => {
        const n = Math.abs(st.deg).toFixed(1);
        return st.facing
          ? `${subject} starts ${n}deg off the forward axis: its facing curve's start handle points that way, so the dancer snaps round as the move begins.`
          : `${subject} starts ${n}deg round from the way the dancer already faces, because it has no facing curve: the dancer faces along its path, and the path leaves that joint that far off.`;
      };
      const says: string[] = [];
      const here = stepInto(k);
      const after = stepInto(k + 1);
      if (here && Math.abs(here.deg) > 0.05) says.push(sentence(here, 'this move'));
      if (after && Math.abs(after.deg) > 0.05) says.push(sentence(after, 'the NEXT move'));
      if (says.length) {
        const joint = document.createElement('div');
        joint.className = 'small';
        joint.textContent = `facing joint: ${says.join(' ')}`;
        grid.appendChild(joint);
      }
    }

    tile.appendChild(grid);
    return tile;
  }

  private field(key: string, label: string, value: number, step: number, onCommit: (v: number) => void, locked = false, lockReason?: string): HTMLSpanElement {
    const wrap = document.createElement('span');
    wrap.className = 'ed-group';
    const l = document.createElement('label');
    l.textContent = label;
    const input = this.numberInput(key, value, step, onCommit, locked, lockReason);
    if (locked) wrap.classList.add('locked');
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }

  /**
   * ONE NUMBER FIELD, and the only place an input of this kind is built: `field` wraps it in a
   * label-and-input group for the panels, and the coordinate table puts it in a row of its own.
   *
   * `noStep` HIDES THE SPINNER. Asked for: a coordinate is typed or dragged, and the little up/down arrows
   * are two targets beside every number that take the width the fourth decimal needs. The `step` is still
   * set, so the arrow keys and the wheel still nudge the value.
   */
  private numberInput(key: string, value: number, step: number, onCommit: (v: number) => void, locked = false, reason?: string, noStep = false): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = show(value);
    input.dataset.key = key;
    if (noStep) input.classList.add('no-step');
    if (locked) {
      // LOCKED, NOT HIDDEN. The value shown is the first selected dancer's, so it stays readable - and
      // the reason it cannot be edited is what the caller needs to know, not that the field is gone.
      input.disabled = true;
      input.title = reason ?? 'the selected dancers differ here, and one field cannot describe several shapes - select one dancer, or make them agree';
    } else if (reason) {
      // A HINT ON A LIVE FIELD, which the coordinate table uses to say what the two columns are without
      // printing a paragraph above them.
      input.title = reason;
    }
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) this.renderInstance();
      else onCommit(v);
    });
    return input;
  }

  // =================================================================== fix / create

  private applyMode() {
    const mode = this.modeSel.value;
    const instance = mode === 'instance';
    const create = mode === 'create';
    this.instPanel.hidden = !instance;
    this.postRow.hidden = instance;
    this.fixPanel.hidden = instance || create;
    this.createPanel.hidden = !create;
    this.setHudWide();
    // The Save button is OUTSIDE the instance panel and shared with the other two modes, so whether it
    // says "Save" or "Save as new setup" has to be re-asked whenever the mode changes - not only when
    // the instance does.
    this.renderCloneChrome();
    this.renderSaved();
    if (instance) {
      // The instance editor has been showing a still frame while another mode was up, so hand the
      // preview back to the instance being edited - ANIMATION OFF, at the beat the caller left.
      if (this.instance) this.showInstance(this.instance);
    } else {
      this.refreshFixInfo();
      // Leaving the instance editor gives the full tracks back, and takes the Bézier gizmo with it:
      // it belongs to a move selection that is no longer on screen.
      this.host.focusTrail(null, null);
      this.stage.setGizmo(null);
    }
  }

  /** The instance table needs the width; the other modes do not - and a clone tints the HUD's edge, which
   *  is the third place a clone is announced. Both classes are derived here from the same three facts, so
   *  the HUD cannot say "clone" while the panel says otherwise. */
  private setHudWide() {
    const hud = document.getElementById('hud');
    if (!hud) return;
    const instance = this.active && this.isInstanceMode();
    hud.classList.toggle('ed-instance', instance);
    hud.classList.toggle('ed-clone', instance && this.asClone);
  }

  /**
   * The editor's two view options, and their SCOPE.
   *
   * The stage is shared with the browse and sequence views, so these apply while the editor is the
   * panel on screen and are RELEASED when it is not - otherwise a caller who hid the dancers in the
   * editor would find them gone in the browse view too, with nothing on that panel to explain why.
   */
  private applyViewOptions() {
    if (!this.active) {
      this.host.setDisplayMode({ use2d: false, showDancers: true });
      return;
    }
    this.host.setDisplayMode({ use2d: this.view2dChk.checked, showDancers: !this.hideDancersChk.checked });
  }

  // ---- actions ----

  private doFix() {
    if (!this.editSetup || !this.postStart) {
      this.statusEl.textContent = 'pick an edit call+setup and a post call+setup';
      return;
    }
    const { posErr, maxHead } = this.fixDiscrepancy();
    if (posErr > POS_WARN || maxHead > HEADING_WARN) {
      const size = `heading ${((maxHead * 180) / Math.PI).toFixed(0)}°, pos ${posErr.toFixed(1)}`;
      if (!window.confirm(`Correction is large (${size}) — this may not be a simple closure misalignment. Proceed?`)) return;
    }
    const target = this.alignToSetup(this.editSetup, this.postStart);
    const fixed = correctEndTo(this.editSetup, target);
    this.generated = fixed;
    // A FIX DOES NOT CHANGE THE SETUP'S FORMATION, so it keeps that setup's own label - which is
    // already a formation name. "(fixed)" was a marker for the saved list, and the list already says
    // which kind it is (`fix · Static Square`), so the suffix carried nothing but the call name.
    this.generatedName = this.instanceName(this.editSetup);
    this.show(fixed);
    this.fixInfoEl.textContent =
      `corrected: end formation now ${posErr.toFixed(2)} apart from post-call start` +
      (maxHead > 0.1 ? `, headings ${((maxHead * 180) / Math.PI).toFixed(0)}° apart` : '');
    this.statusEl.textContent = '✓ fixed closure';
  }

  private doCreate() {
    if (!this.editSetup || !this.preEnd || !this.postStart) {
      this.statusEl.textContent = 'pick an edit call+setup, a pre call+setup, and a post call+setup';
      return;
    }
    // THE NAME IS THE FORMATION THE NEW SETUP STARTS FROM - the pre call's END formation - or what
    // the caller typed. It is NEVER a pair of call names: a setup's label is a formation, and the
    // setup's own (call, index) address is what makes it unique.
    const name = this.nameInput.value.trim() || this.preEndName || 'new position';
    const beats = parseFloat(this.padInput.value) || 2;
    const start = this.alignToSetup(this.editSetup, this.preEnd);
    const end = this.alignToSetup(this.editSetup, this.postStart);
    try {
      const created = synthesizeSetup(this.editSetup, { name, start, end, padBeats: beats });
      this.generated = created;
      this.generatedName = name;
      this.show(created);
      this.statusEl.textContent = `✓ created "${name}" (${created.beats} beats)`;
    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  }

  private showTarget() {
    if (!this.postStart) return;
    const name = this.postCallSel.selectedOptions[0]?.textContent ?? this.postCallSel.value;
    this.show(this.staticCall(`post start — ${name}`, this.postStart));
  }
  private showEnd() {
    if (!this.editSetup) return;
    const name = this.editCallSel.selectedOptions[0]?.textContent ?? this.editCallSel.value;
    this.show(this.staticCall(`edit end — ${name}`, this.callEnd(this.editSetup)));
  }
  private showStart() {
    if (!this.preEnd) return;
    const name = this.preCallSel.selectedOptions[0]?.textContent ?? this.preCallSel.value;
    this.show(this.staticCall(`pre end — ${name}`, this.preEnd));
  }

  /** Throw the in-editor edits away and reload the instance from its source. NOTE what the
   *  source is: `loadCall` honours an edit already applied to the live catalogue, so a Reset
   *  after applying one reloads THAT, not the shipped tam. Unapply it to get back to shipped. */
  private doResetInstance() {
    this.loadInstance();
    this.statusEl.textContent = 'reloaded the instance';
  }

  // ---- re-basing on a named formation: the start, and the end ----

  /**
   * The formation list is asked for once, lazily: it comes from the sequencer's library.
   *
   * THE SAME LIST FILLS BOTH PICKERS. A start and an end are both "a named 8-dancer formation", and the
   * correspondence between a call's dancers and a formation's spots is derived the same way for either
   * end of the track (`setStartFormation` / `deriveFormationMapping`), so there is nothing end-specific to
   * build a second list from - and two lists that could disagree would be a bug waiting to happen.
   */
  private ensureStartFormations() {
    if (this.startFormationsLoaded) return;
    this.startFormationsLoaded = true;
    const formations = this.host.startFormations();
    this.startFormationSel.innerHTML = '';
    this.startFormationSel.add(new Option('— keep the current start —', ''));
    for (const f of formations) this.startFormationSel.add(new Option(f.name, f.name));
    this.endFormationSel.innerHTML = '';
    this.endFormationSel.add(new Option('— keep the current end —', ''));
    for (const f of formations) this.endFormationSel.add(new Option(f.name, f.name));
  }

  /** Start a NEW setup from the catalogue instance, rather than editing the existing one. */
  private doClone() {
    this.loadInstance();
    this.asClone = true;
    this.startFormationSel.value = '';
    this.refreshCloneInfo();
    // `loadInstance` has already re-rendered with the clone OFF (it resets the flag), so the state
    // written AFTER it needs its own pass - and this is the call the probe exists to require.
    this.renderCloneChrome();
    this.statusEl.textContent = 'cloned — pick a Start setup, then Connect';
  }

  /** Re-base the clone's START onto the chosen formation, KEEPING every move. The track no
   *  longer ends where the call ends; `refreshCloneInfo` measures by how much, and Connect is
   *  the other half of the operation. */
  private doStartFormation() {
    const name = this.startFormationSel.value;
    if (!name) return;
    // Re-base the CURRENT instance, not the pristine source, so move edits made before the
    // start was chosen survive. The CONNECT anchor stays the source: that is the original
    // track, and it is what makes the end invariant.
    const base = this.instance ?? this.source;
    if (!base) return;
    const formation = this.host.startFormations().find((f) => f.name === name);
    if (!formation) {
      this.statusEl.textContent = `✗ unknown formation "${name}"`;
      return;
    }
    try {
      const rebased = setStartFormation(base, formation.poses);
      // The setup's LABEL is the formation's name: a tam is identified by its `from`, and this
      // is the new setup, so the name is not decoration - it is what the export and the
      // catalogue index will carry.
      this.instance = { ...rebased, from: name };
      this.asClone = true;
      this.instanceEdited = true;
      this.showInstance(this.instance);
      this.renderInstance();
      this.statusEl.textContent = `re-based the start onto "${name}" — the track no longer closes`;
    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  }

  /** Complete the re-based track: re-aim each dancer's FIRST move onto the old track. */
  private doConnect() {
    if (!this.instance || !this.source) {
      this.statusEl.textContent = 'nothing to connect';
      return;
    }
    try {
      this.instance = connectStart(this.instance, this.source);
      this.instanceEdited = true;
      this.showInstance(this.instance);
      this.renderInstance();
      this.statusEl.textContent =
        'connected the first moves' +
        // A later start connect RE-FRAMES every move after the first, so an end that was already
        // connected is no longer on its target. The gap is re-measured above rather than assumed, and
        // saying so here is the difference between a caller pressing Connect end again and a caller
        // believing the end they asked for and that they lost it.
        (this.endTarget ? ' — the end moved with the frame: press Connect end again to re-aim the last moves' : '');
    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  }

  // ---- finishing on a named end formation ----

  /**
   * The pairing in force: WHICH SPOT OF THE END FORMATION EACH DANCER FINISHES ON.
   *
   * DERIVED, NEVER BY INDEX - and derived the way the START is, with the engine's own
   * `deriveFormationMapping`: it tries every multiple of 45 degrees of whole-set rotation about the origin
   * plus a centring translation, then keeps the best 1:1 assignment on position and facing. Array order is
   * never consulted, and that is the whole answer to "how does the interface handle a formation whose
   * spots are indexed differently from the end positions": a formation's spot `j` is wherever ITS file
   * wrote its j-th dancer, so `dancer 3 -> spot 3` is a coincidence of two unrelated authorings and not a
   * correspondence at all. MEASURED over the formations the picker offers: index-for-index puts dancers on
   * the wrong spot for most of them (`poc/tools/end-pair-probe.mjs`).
   *
   * AN EXPLICIT PAIRING WINS and is kept: the automatic answer can be right by the geometry and wrong by
   * intent - a caller may want a particular dancer to take a particular spot - and then their correction IS
   * the data. `endOverride === null` means "ask the geometry".
   */
  private endPairing(): number[] | null {
    const inst = this.instance;
    const target = this.endTarget;
    if (!inst || !target) return null;
    if (target.poses.length !== inst.dancers.length) return null;
    if (this.endOverride && this.endOverride.length === inst.dancers.length) return this.endOverride;
    const start = inst.dancers.map((d) => {
      const p = poseFor(d, 0);
      return { x: p.x, y: p.y, heading: p.heading };
    });
    try {
      // `preferGender` is what makes the pairing the CALLER'S formation rather than its shape: a
      // formation's genders are its ARRANGEMENT, and pairing a dancer with a spot declared for the other
      // gender gives the right shape with the boys on the wrong side. The start re-base has always
      // preferred the declared arrangement (`setStartFormation`); this is the same rule at the other end.
      // MEASURED: the geometry alone does it wrong in 77.7% of the 2278 (call, formation) pairings
      // (`poc/tools/end-pair-probe.mjs`).
      return deriveFormationMapping(start, target.poses, true);
    } catch {
      // No 1:1 assignment by position and facing: refused rather than paired by index, which is the
      // engine's rule and the reason `deriveFormationMapping` has no fallback to fall back to.
      return null;
    }
  }

  /** How far the call's end still is from the end target, over the pairing in force. */
  private endTargetGap(pairing: number[]): { pos: number; heading: number } {
    const inst = this.instance!;
    const target = this.endTarget!;
    let pos = 0;
    let heading = 0;
    inst.dancers.forEach((d, i) => {
      const p = poseFor(d, inst.beats);
      const t = target.poses[pairing[i]];
      pos = Math.max(pos, Math.hypot(p.x - t.x, p.y - t.y));
      heading = Math.max(heading, Math.abs(Math.atan2(Math.sin(p.heading - t.heading), Math.cos(p.heading - t.heading))));
    });
    return { pos, heading };
  }

  /**
   * Choose the formation the dance should finish on. NOTHING MOVES YET: like the Start setup, this
   * re-bases the track's intent, and `Connect end` is the step that re-aims the last moves.
   */
  private doEndFormation() {
    const name = this.endFormationSel.value;
    this.endOverride = null;
    const inst = this.instance;
    if (!name) {
      this.endTarget = null;
      this.renderInstance();
      this.statusEl.textContent = inst ? 'end target cleared' : '';
      return;
    }
    const formation = this.host.startFormations().find((f) => f.name === name);
    if (!formation) {
      this.endTarget = null;
      this.renderInstance();
      this.statusEl.textContent = `✗ unknown formation "${name}"`;
      return;
    }
    if (inst && formation.poses.length !== inst.dancers.length) {
      this.endTarget = null;
      this.renderInstance();
      this.statusEl.textContent = `✗ "${name}" has ${formation.poses.length} dancers and the call has ${inst.dancers.length}`;
      return;
    }
    this.endTarget = { name, poses: formation.poses };
    this.renderInstance();
    this.statusEl.textContent = `end target "${name}" — Connect end re-aims the last move of every dancer`;
  }

  /**
   * Re-aim the LAST move of every dancer at its assigned spot of the end formation.
   *
   * ONE DANCER AT A TIME, THROUGH THE ENGINE'S OWN PER-DANCER MUTATOR (`setDancerEnd`), which re-aims only
   * that dancer's last move and holds its beats and its hands. The whole-set `correctEndTo` does the same
   * thing but derives the pairing ITSELF, which is exactly what an override has to be able to replace; the
   * probe measures the two against each other on the corpus, so the manual route cannot drift from the
   * engine's.
   *
   * A DANCER WITH NO MOVES CANNOT BE RE-AIMED - there is no last move to aim - so it is reported rather
   * than silently left wrong, the same rule the start connect follows.
   */
  private doConnectEnd() {
    const inst = this.instance;
    const target = this.endTarget;
    const pairing = this.endPairing();
    if (!inst || !target || !pairing) {
      this.statusEl.textContent = 'pick an end setup first';
      return;
    }
    let out = inst;
    const skipped: number[] = [];
    try {
      for (let i = 0; i < inst.dancers.length; i++) {
        if (out.dancers[i].path.length === 0) {
          skipped.push(i + 1);
          continue;
        }
        out = setDancerEnd(out, i, target.poses[pairing[i]]);
      }
    } catch (err) {
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
      return;
    }
    this.commit(out);
    this.statusEl.textContent =
      `connected the last moves onto "${target.name}"` +
      (skipped.length ? ` — dancers ${skipped.join(', ')} have no move to re-aim` : '');
  }

  /**
   * Point dancer `dancer` at another spot of the end formation.
   *
   * PICKING A SPOT ANOTHER DANCER IS ON SWAPS THE TWO, and that is what keeps the pairing a PERMUTATION:
   * "the call finishes on this formation" means eight spots used ONCE EACH, so eight independent choices
   * could put two dancers on one spot and leave another empty. A free spot is simply taken; a taken one
   * trades, which is also the move a wrong automatic pairing usually needs.
   */
  private setEndSpot(dancer: number, spot: number) {
    const pairing = this.endPairing();
    if (!pairing) return;
    const next = [...pairing];
    const holder = next.indexOf(spot);
    if (holder === dancer) return;
    if (holder >= 0) next[holder] = next[dancer];
    next[dancer] = spot;
    this.endOverride = next;
    this.focusKey = `r${dancer}:end`;
    this.renderInstance();
    this.statusEl.textContent =
      holder >= 0
        ? `dancer ${dancer + 1} and dancer ${holder + 1} swapped end spots`
        : `dancer ${dancer + 1} now finishes on spot ${spot + 1}`;
  }

  /**
   * SAY THAT A CLONE IS BEING BUILT, wherever that changes what a control will do.
   *
   * A clone is not a mode: it is this same editor with `asClone` set, and the ONE thing it changes is what
   * Save does - it ADDS a setup instead of replacing the one the instance came from. That is invisible on
   * a panel where the Clone button goes back to looking unclicked and the Save button still says "Save", so
   * the state is written in three places at once: the bar over the table (which also names the source and
   * the way back to it), the Save button's own label, and the HUD's edge.
   *
   * EVERYTHING THAT CHANGES `asClone` REACHES THIS, and both entry points call it: `renderInstance` for
   * anything the editor does, and `applyMode` because the Save button lives OUTSIDE the instance panel and
   * would otherwise keep saying "Save as new setup" in Fix and Create. `poc/tools/clone-chrome-probe.mjs`
   * audits that, because this is the shape of fault this panel has produced three times already.
   *
   * The Clone button is DISABLED while a clone is in hand, and that is not decoration either: `doClone`
   * RELOADS the catalogue instance, so pressing it mid-clone would silently discard the re-based start and
   * every move edit made since - a destructive button that looks like it is offering to help.
   */
  private renderCloneChrome() {
    const cloning = this.asClone && this.isInstanceMode();
    this.cloneBarEl.hidden = !cloning;
    this.cloneBtn.disabled = cloning;
    this.cloneBtn.title = cloning ? CLONE_BUSY_TITLE : this.cloneTitle;
    this.saveBtn.textContent = cloning ? 'Save as new setup' : 'Save';
    // The HUD's own edge is `setHudWide`'s business; calling it here is what stops the two views of
    // "is a clone being built" from ever disagreeing.
    this.setHudWide();
    if (!cloning) return;
    const title = this.instance?.title || 'this call';
    const from = this.source?.from || 'the setup you started from';
    this.cloneTextEl.innerHTML =
      `building a <b>new setup</b> of <b>${esc(title)}</b> — <b>Save</b> adds it and leaves ` +
      `<i>${esc(from)}</i> as it is. <b>Reset</b> goes back to editing that one.`;
  }

  /**
   * How far the edited instance's END formation has drifted from the source track's.
   * This is the "now invalid track" made visible: re-posing a start re-frames every move, so
   * the set stops finishing where the call finishes and the editor has to SAY so rather than
   * leave the user to notice it on the stage.
   *
   * A RE-BASED END IS NOT AN INCOMPLETE TRACK, and the two are told apart by MEASUREMENT rather than by a
   * flag: if the call's end is on the chosen end target, the drift from the source is exactly what the
   * caller asked for, and the note names that instead of telling them to press Connect (which would then
   * fight the end they just set). A flag would have gone stale the moment a later edit moved the end; the
   * measurement cannot.
   */
  private refreshCloneInfo() {
    const inst = this.instance;
    const ref = this.source;
    if (!inst || !ref) {
      this.cloneInfoEl.textContent = '';
      return;
    }
    const err = endPoseError(inst, ref);
    const deg = (err.heading * 180) / Math.PI;
    if (err.pos < 1e-9 && err.heading < 1e-9) {
      this.cloneInfoEl.textContent = `end formation unchanged from "${ref.from || 'the source'}"${this.asClone ? ' · saving as a NEW setup' : ''}`;
      return;
    }
    const pairing = this.endPairing();
    const onTarget = pairing !== null && (() => {
      const gap = this.endTargetGap(pairing);
      return gap.pos < 1e-9 && Math.abs(gap.heading) < 1e-9;
    })();
    if (onTarget) {
      this.cloneInfoEl.innerHTML =
        `<span style="color:#4d9fff">end re-based</span>: the call finishes on <b>${esc(this.endTarget!.name)}</b>, ` +
        `${err.pos.toFixed(2)} units / ${deg.toFixed(0)}° from "${esc(ref.from || 'the source')}"` +
        (this.asClone ? ' · saving as a NEW setup' : '');
      return;
    }
    // The clone workflow gets the loud wording because the drift there is a DEFECT with a
    // named fix. Re-aiming an end on purpose in an ordinary edit is not a defect, so it gets
    // the same number without the alarm.
    this.cloneInfoEl.innerHTML = this.asClone
      ? `<span style="color:#ffb454">track incomplete</span>: the ends are ${err.pos.toFixed(2)} units / ` +
        `${deg.toFixed(0)}° from "${esc(ref.from || 'the source')}" — <b>Connect</b> re-aims the first move of every dancer to close it`
      : `ends differ from the catalogue's by ${err.pos.toFixed(2)} units / ${deg.toFixed(0)}°`;
  }

  private addInstanceMove() {
    const call = this.instance;
    if (!call) return;
    // A one-beat pause: a zero-travel move is the honest default, because it changes the
    // timing of the call without inventing choreography nobody asked for.
    const seg: Seg = {
      beats: 1,
      hands: 'none',
      translate: { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 },
      rotate: null,
    };
    // ON EVERY SELECTED DANCER, like every other move edit - a group edit that propagated the
    // numbers but not the moves would leave the dancers silently out of step with each other.
    let next = call;
    for (const d of this.selectedSorted()) next = addMove(next, d, seg);
    this.moveIndex = this.currentMoves().length; // the appended move
    this.commit(next, `m${this.moveDancer}:${this.moveIndex}:beats`);
  }

  private deleteInstanceMove() {
    const call = this.instance;
    if (!call || this.currentMoves().length === 0) return;
    let next = call;
    for (const d of this.selectedSorted()) {
      // A dancer with no move at this index is skipped rather than throwing the whole delete away.
      if ((next.dancers[d]?.path.length ?? 0) > this.moveIndex) next = removeMove(next, d, this.moveIndex);
    }
    this.moveIndex = Math.max(0, this.moveIndex - 1);
    this.commit(next);
  }

  // ---- save / export ----

  private currentSpec(): CallEdit | null {
    const id = this.editCallSel.value;
    if (!id) return null;
    const setupIdx = parseInt(this.editSetupSel.value || '0', 10);
    const isInstance = this.modeSel.value === 'instance';
    const isCreate = this.modeSel.value === 'create';
    if (isInstance) {
      if (!this.instance) return null;
      return {
        // A CLONE ADDS a setup; an INSTANCE edit replaces the one it came from. That is the
        // whole difference between the two, and it is why they are separate kinds rather than
        // one kind with a flag: `loadCall` and `effectiveSetups` have to agree about which
        // appended index a label names, and two kinds make that read off the data.
        kind: this.asClone ? 'clone' : 'instance',
        callId: id,
        setupIdx,
        name: this.instanceName(this.instance),
        padBeats: 1,
        // The whole edited instance, exactly as exported: expanded, full-set, and carrying
        // the declarations the apply path registers with.
        xml: callTamXml(this.instance, this.instance.from, this.exportSymmetry(this.instance, this.instance.from)),
      };
    }
    const base: CallEdit = {
      kind: isCreate ? 'create' : 'fix',
      callId: id,
      setupIdx,
      postCallId: this.postCallSel.value,
      postSetupIdx: parseInt(this.postSetupSel.value || '0', 10),
      // Same rule as `doCreate`: a formation name, never a pair of call names. `preEndName` is the
      // pre call's END formation, which is where a created setup begins.
      name: this.generatedName || this.nameInput.value.trim() || this.preEndName || 'new position',
      padBeats: isCreate ? parseFloat(this.padInput.value) || 2 : 1,
    };
    if (base.kind === 'create') {
      base.preCallId = this.preCallSel.value;
      base.preSetupIdx = parseInt(this.preSetupSel.value || '0', 10);
    }
    return base;
  }

  private doSave() {
    let spec: CallEdit | null;
    try {
      spec = this.currentSpec();
    } catch (err) {
      // THE SAME REFUSAL AS THE EXPORT, because this is the SAME xml: an edit SAVED as a whole set while the
      // selector says half would be the reported defect one step later, in the file the corpus is updated from.
      this.refusal((err as Error).message);
      return;
    }
    if (!spec) return;
    // WHAT IDENTIFIES A SAVED EDIT DEPENDS ON WHAT IT DOES TO THE CALL.
    //
    // A REPLACING edit (fix / instance) is identified by the SETUP it replaces, so re-saving it
    // replaces the previous one WHATEVER IT WAS CALLED - and that matters now that names changed
    // shape: without it, an edit saved under the old "Call · Formation" label would survive
    // alongside the new "Formation" one, both applied, and `loadCall` would take the first while the
    // list showed the second.
    //
    // An APPENDING edit (create / clone) is identified by its NAME, because the name IS the new
    // setup - two clones of one call from one setup are two different setups.
    const replaces = spec.kind === 'fix' || spec.kind === 'instance';
    this.saved = this.saved.filter(
      (s) => !(s.kind === spec.kind && s.callId === spec.callId && s.setupIdx === spec.setupIdx && (replaces || s.name === spec.name)),
    );
    this.saved.push(spec);
    persistEdits(this.saved);
    this.renderSaved();
    this.statusEl.textContent = `saved "${spec.name}"`;
  }

  /** The `asymmetric` declaration the SELECTOR asks for, the format's way round. */
  private declaredSymmetry(): Symmetry {
    return this.asymCb.checked ? 1 : 2;
  }

  /** Say a refusal the way the rest of this panel does: the marker, then the engine's own words. The marker is
   *  written as an escape because the file that builds this string has to stay plain ASCII. */
  private refusal(message: string) {
    this.statusEl.textContent = '\u2717 ' + message;
  }

  /**
   * WHETHER THE EXPORT WILL NAME ITS FORMATION INSTEAD OF WRITING DANCERS.
   *
   * `tam-xml.ts` decides it (`callToXmlNamed`) and this is the same predicate on purpose: with no dancers
   * written there is no set for the declaration to describe, so the choice is INERT - and a refusal based on
   * the half-set test would then be refusing something that is never going to be written.
   */
  private willNameFormation(call: CallBundle, name?: string): boolean {
    const label = name ?? (call.from || call.title);
    const poses = label ? corpusFormationPoses(label) : null;
    return !!poses && startsFromFormation(call, poses);
  }

  /**
   * THE DECLARATION THE EXPORT WILL ACTUALLY WRITE - and the refusal when the selector cannot be honoured.
   *
   * Reported: "The XML export is exporting all 8 dancers with the asymetric paramter = true. But the UI is
   * showing the checkbox unchecked." UNTICKED MEANS THE HALF SET, and a half set is only a description of the
   * call when the second half really is the first half turned 180 degrees about the board centre, paths
   * included - `halfSetReport` is that test. When it fails, the old behaviour wrote the WHOLE set and declared
   * `asymmetric="true"` instead: correct XML, and the wrong answer. The caller asked for a half set, the panel
   * said otherwise only in a line of small text, and the output disagreed with the control that produced it.
   *
   * SO IT REFUSES, which is what was asked for when the choice was put: "Refuse the export and say why". The
   * reason names the dancers and the move the test stopped on, and it goes to the status line like every other
   * refusal in this panel.
   *
   * TICKED IS ALWAYS WRITABLE, and so is an export that NAMES its formation: neither asks for a half set.
   */
  private exportSymmetry(call: CallBundle, name?: string): Symmetry {
    if (this.asymCb.checked) return 1;
    if (this.willNameFormation(call, name)) return 2;
    const rep = halfSetReport(call);
    if (!rep.ok) {
      throw new Error(
        `the half set cannot be written, so nothing was exported - ${rep.reason}. ` +
        'Tick "Asymmetric" to write the whole set with asymmetric="true" instead.',
      );
    }
    return 2;
  }

  /**
   * WHAT THE SELECTOR WILL ACTUALLY DO, said rather than implied.
   *
   * A control that silently cannot be honoured is worse than no control: a HALF SET only describes the
   * call when the second half really is the first half turned 180 degrees about the board centre, paths
   * included, and when it is not, `callToXml` writes the whole set instead. So this line reports which of
   * the three things the export will be, and the reason whenever it is not the one that was asked for.
   *
   * It reports the case where the choice does not apply at all, too: when the call starts from a
   * formation the corpus carries AND really starts from it, the export writes `formation="Name"` with no
   * dancers at all, and there is no set to declare the symmetry of.
   */
  private renderAsymInfo() {
    const call = this.isInstanceMode() ? this.instance : this.generated;
    // THE COLOUR IS DECIDED IN ONE PLACE, so a warning cannot be left standing on a line that is no longer one.
    this.asymInfoEl.classList.remove('warn');
    if (!call) {
      this.asymInfoEl.textContent = '';
      return;
    }
    const name = this.isInstanceMode() ? this.instance?.from : (this.generatedName || call.from || call.title);
    if (this.willNameFormation(call, name)) {
      this.asymInfoEl.textContent = `the export names "${name}", so no dancers are written and this choice does not apply`;
      return;
    }
    if (this.asymCb.checked) {
      // THE COUNT IS THE BOARD'S, not a hardcoded eight. A six-dancer call is a real case (the corpus's
      // `_Finish Line of 6 ...` setups), and saying "all 8 dancers" about one is exactly the kind of
      // wrong number this line exists to prevent.
      this.asymInfoEl.textContent = `writes all ${call.dancers.length} dancers and declares asymmetric="true"`;
      return;
    }
    const rep = halfSetReport(call);
    if (rep.ok) {
      this.asymInfoEl.textContent = `writes the HALF set (${rep.half} dancers); the reader turns it 180 degrees to complete the group`;
      return;
    }
    // A REFUSAL IS NOT A STATUS LINE. The first cut put this reason in the panel's ordinary small text and it was
    // not read - asked what the line had said, the caller answered "I didn't notice / the line was empty". So the
    // row goes amber, in the `#ffb454` that "track incomplete" and "cannot pair" already use for the same kind of
    // news, and the sentence leads with what will NOT happen.
    this.asymInfoEl.classList.add('warn');
    this.asymInfoEl.textContent =
      `will NOT export: the half set cannot be written - ${rep.reason}. Tick Asymmetric to write the whole set instead.`;
  }

  /** The XML an export should produce for the CURRENT mode, or a thrown refusal. See `exportSymmetry`. */
  private exportXml(): string | null {
    if (this.isInstanceMode()) {
      if (!this.instance) return null;
      return callTamXml(this.instance, this.instance.from, this.exportSymmetry(this.instance, this.instance.from));
    }
    const call = this.generated ?? (() => {
      const spec = this.currentSpec();
      if (!spec) return null;
      return rebuildEdit(spec);
    })();
    if (!call) return null;
    const label = this.generatedName || call.from || call.title;
    return callTamXml(call, label, this.exportSymmetry(call, label));
  }

  /**
   * Export the ONE `<tam>` on screen, stamped.
   *
   * NO `<calls>` WRAPPER. There was one, because the parser wants a document root and `<calls>` is what the
   * shipped corpus files carry - but that is the parser's business, not the export's: a lone `<tam>` with a
   * comment in front of it IS a well-formed document (an XML prolog may hold comments), and the caller who
   * copies this is pasting one tam into a corpus file, where a `<calls>` element would be a second root
   * inside a file that already has one. Export All groups into `<tamination>` blocks for the same reason and
   * has never written `<calls>`.
   */
  private doExport() {
    try {
      const xml = this.exportXml();
      if (!xml) {
        this.statusEl.textContent = 'nothing to export yet';
        return;
      }
      this.xmlEl.value = buildStamp() + '\n' + xml;
      void navigator.clipboard?.writeText(this.xmlEl.value);
      this.statusEl.textContent = 'exported <tam> XML (copied)';
    } catch (err) {
      // A REFUSAL LEAVES NO XML BEHIND. The pane must not keep showing the LAST export: an old <tam> sitting
      // there reads as the result of the button that was just pressed, which is half of how the reported
      // mismatch looked in the first place.
      this.xmlEl.value = '';
      this.statusEl.textContent = `✗ ${(err as Error).message}`;
    }
  }

  /**
   * EXPORT ALL: every saved edit, grouped the way the corpus files them.
   *
   * Asked for: "add an 'Export All' button that copies all the created calls. Each tam should be inside a
   * tamination element under its appropriate family title (this should match the existing tamination). Add a
   * filepath property to taminations, to make it easier to find the file to update. Also add a type property
   * that indicates either 'clone' or 'update'."
   *
   * THE FAMILY IS THE FILE'S OWN `<tamination title>`, not a name invented here - a file groups its calls under
   * one title (`arm_turns.xml` holds "Turn Partner by the Right", "Left Arm Turn 3/4" and more under "Arm
   * Turns"), and a block that has to be merged back needs to say which title it belongs beneath rather than
   * guess. The `filepath` rides on the same element because the title alone does not say WHICH FILE.
   *
   * AND `type` IS THE APP'S OWN WORD FOR WHAT THE EDIT DOES, which it already distinguishes in `doSave`: a
   * REPLACING edit (fix, instance) is identified by the setup it replaces, and an APPENDING one (create, clone)
   * is identified by its name because the name IS the new setup. So `update` and `clone` are not a new
   * taxonomy - they are the two things the editor has been doing all along, written where the corpus can see
   * them.
   *
   * EVERY TAM IS REBUILT rather than replayed from `s.xml`: only an instance or a clone carries its XML, and a
   * fix or a create is synthesized on demand - so replaying `s.xml` would silently export two thirds of the
   * list and say nothing about the rest.
   */
  private doExportAll() {
    if (this.saved.length === 0) {
      this.statusEl.textContent = 'nothing saved to export';
      return;
    }
    const groups = new Map<string, { family: string | null; filepath: string; tams: string[] }>();
    const problems: string[] = [];
    let exported = 0;
    for (const s of this.saved) {
      const entry = this.catalog.find((c) => c.id === s.callId);
      let built: CallBundle;
      try {
        built = rebuildEdit(s);
      } catch (err) {
        problems.push(`${s.name}: ${(err as Error).message}`);
        continue;
      }
      // EACH SAVED EDIT KEEPS ITS OWN DECLARATION rather than taking the selector's current position:
      // an instance carries it in the XML it was saved as, and a fix or a create is synthesized whole-set
      // (`synthesizeSetup` declares symmetry 1), so export-all re-emits what was saved and 'Export All'
      // cannot restyle the whole library from one checkbox.
      const tamXml = callTamXml(built, s.name, built.symmetry).match(/<tam\b[\s\S]*?<\/tam>/)?.[0];
      if (!tamXml) {
        problems.push(`${s.name}: no <tam> in the export`);
        continue;
      }
      // The type the corpus is told: a replacing edit UPDATES a tam that is there, an appending one is a CLONE.
      const type = s.kind === 'fix' || s.kind === 'instance' ? 'update' : 'clone';
      // Inserted as the FIRST attribute, which is the one place the shape is certain - the exporter always
      // writes `<tam title=".."`. A miss is REPORTED rather than exported untyped.
      const typed = tamXml.replace('<tam ', `<tam type="${type}" `);
      if (typed === tamXml) {
        problems.push(`${s.name}: could not write the type onto the <tam>`);
        continue;
      }
      const key = entry?.file ?? `?${s.callId}`;
      const group = groups.get(key) ?? {
        family: entry?.family ?? null,
        filepath: entry ? `poc/src/assets/${entry.file}.xml` : '(unknown file)',
        tams: [],
      };
      group.tams.push(typed);
      groups.set(key, group);
      exported++;
    }
    if (exported === 0) {
      this.statusEl.textContent = `X nothing could be exported${problems.length ? ` - ${problems[0]}` : ''}`;
      return;
    }
    const blocks = [...groups.values()].map((g) => {
      const open = `<tamination title="${esc(g.family ?? 'Unknown')}" filepath="${esc(g.filepath)}">`;
      return `${open}\n${g.tams.join('\n\n')}\n</tamination>`;
    });
    const out = buildStamp() + '\n' + `${blocks.join('\n\n')}\n`;
    this.xmlEl.value = out;
    void navigator.clipboard?.writeText(out);
    this.statusEl.textContent =
      `exported ${exported} saved call${exported === 1 ? '' : 's'} in ${blocks.length} tamination${blocks.length === 1 ? '' : 's'} (copied)` +
      (problems.length ? ` - ${problems.length} skipped: ${problems[0]}` : '');
  }
  private renderSaved() {
    this.savedEl.innerHTML = '';
    if (this.saved.length === 0) {
      this.savedEl.innerHTML = '<i>no saved editor results</i>';
      return;
    }
    for (const s of this.saved) {
      const row = document.createElement('div');
      row.className = 'setup' + (s.applied ? ' applied' : '');
      const label = document.createElement('b');
      const kind = s.kind === 'fix' ? 'fix' : s.kind === 'create' ? 'create' : s.kind === 'clone' ? 'clone' : 'instance';
      // THREE PARTS, because one was not enough to tell them apart. Asked for as: "Currently they are only
      // listed by the start formation. But this makes it difficult to understand what they are. In this list, it
      // should read <start formation name> -> <call name> -> <end formation name>."
      //
      // The FIRST part is `s.name`, which is the setup's own identity and is what the list already showed - the
      // name a caller gave a created formation, or the `from` a tam carries. THE END IS READ OFF THE CALL, not
      // stored: the edit holds XML, and the formation it finishes in is a fact about that geometry, so it is
      // asked of the same recogniser the browse and sequence views use (`nameBoard`) rather than duplicated into
      // the record where it could go stale.
      const built = (() => {
        try { return rebuildEdit(s); } catch { return null; }
      })();
      const callName = built ? built.title : '?';
      const endName = built ? this.host.nameBoard(boardAtBeat(built, built.totalBeats)) : null;
      label.textContent = `${s.name} → ${callName} → ${endName ?? '?'}${s.applied ? ' ✔' : ''}`;
      // The KIND said how the edit behaves (a create adds a setup, a clone re-bases one), and it is no longer in
      // the text because the three parts are what the line is FOR - so it goes where the rest of the explanation
      // lives.
      row.title =
        `${kind} · starts from ${s.name}, calls ${callName}${endName ? `, finishes in ${endName}` : ''}` +
        (s.applied ? ' · applied to the live catalogue' : '');
      row.appendChild(label);
      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'preview';
      loadBtn.addEventListener('click', () => {
        try {
          this.show(rebuildEdit(s));
          this.statusEl.textContent = `✓ ${s.name}`;
        } catch (err) {
          this.statusEl.textContent = `✗ ${(err as Error).message}`;
        }
      });
      const applyBtn = document.createElement('button');
      applyBtn.textContent = s.applied ? 'unapply' : 'apply to live';
      applyBtn.addEventListener('click', () => {
        const wasApplied = !!s.applied;
        setApplied(s, !wasApplied);
        this.saved = loadEdits();
        this.renderSaved();
        this.statusEl.textContent = wasApplied ? `removed "${s.name}" from live catalog` : `✓ "${s.name}" applied to live catalog`;
      });
      const delBtn = document.createElement('button');
      delBtn.textContent = 'del';
      delBtn.addEventListener('click', () => {
        this.saved = this.saved.filter((x) => x !== s);
        persistEdits(this.saved);
        this.renderSaved();
      });
      row.appendChild(loadBtn);
      row.appendChild(applyBtn);
      row.appendChild(delBtn);
      this.savedEl.appendChild(row);
    }
  }

  private wireEvents() {
    this.fixBtn.addEventListener('click', () => this.doFix());
    this.createBtn.addEventListener('click', () => this.doCreate());
    this.saveBtn.addEventListener('click', () => this.doSave());
    this.exportBtn.addEventListener('click', () => this.doExport());
    this.exportAllBtn.addEventListener('click', () => this.doExportAll());
    this.showTargetBtn.addEventListener('click', () => this.showTarget());
    this.showEndBtn.addEventListener('click', () => this.showEnd());
    this.showStartBtn.addEventListener('click', () => this.showStart());
    this.modeSel.addEventListener('change', () => this.applyMode());
    // LEVEL AND FIND NARROW THE LISTS ONLY, and the level selector is not exempt because it sits
    // above the lists rather than beside them: `fillCallSelect` keeps the selected call whatever
    // either control says, so switching level cannot swap the call out from under an edit in
    // progress. (Reloading the instance here would also have been the one way for a VIEW to
    // destroy work.)
    this.levelSel.addEventListener('change', () => this.applyCallFilter());
    // THE BULK PICKS. `matching` is the one that asks the data a question - see `matchingDancers` - and the
    // others are the sets a caller reaches for: nothing, everything, the boys, the girls.
    this.selNoneBtn.addEventListener('click', () => this.setDancerSelection([], 'none'));
    // The selector decides what the NEXT export writes, so moving it only has to refresh the line that
    // says what that will be.
    this.asymCb.addEventListener('change', () => this.renderAsymInfo());
    this.selAllBtn.addEventListener('click', () => {
      const call = this.instance;
      if (call) this.setDancerSelection(call.dancers.map((_, i) => i), 'all');
    });
    this.selBoysBtn.addEventListener('click', () => {
      const call = this.instance;
      if (call) this.setDancerSelection(call.dancers.map((d, i) => (d.gender === 'boy' ? i : -1)).filter((i) => i >= 0), 'boys');
    });
    this.selGirlsBtn.addEventListener('click', () => {
      const call = this.instance;
      if (call) this.setDancerSelection(call.dancers.map((d, i) => (d.gender === 'girl' ? i : -1)).filter((i) => i >= 0), 'girls');
    });
    this.selMatchBtn.addEventListener('click', () => {
      if (this.selMatchBtn.disabled) return;
      this.setDancerSelection(this.matchingDancers(this.tabCurve()), `matching ${this.tabCurve() === 'travel' ? 'paths' : 'turns'}`);
    });
    this.hideDancersChk.addEventListener('change', () => this.applyViewOptions());
    this.view2dChk.addEventListener('change', () => this.applyViewOptions());
    this.viewDialogClose.addEventListener('click', () => this.hideViewDialog());
    // The filter narrows the LISTS only, so it never reloads a call: the selected ids are
    // preserved by `fillCallSelect`, and reloading on every keystroke would fight the user.
    this.callFilterInput.addEventListener('input', () => {
      this.callQuery = this.callFilterInput.value;
      this.applyCallFilter();
    });
    this.callFilterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.callFilterInput.value = '';
        this.callQuery = '';
        this.applyCallFilter();
      }
    });
    this.editCallSel.addEventListener('change', () => {

      this.fillSetupSelect(this.editSetupSel, this.editCallSel.value);
      this.loadEditSetup();
      this.loadInstance();
    });
    this.editSetupSel.addEventListener('change', () => {

      this.loadEditSetup();
      this.loadInstance();
    });
    this.postCallSel.addEventListener('change', () => {
      this.fillSetupSelect(this.postSetupSel, this.postCallSel.value);
      this.loadPost();
    });
    this.postSetupSel.addEventListener('change', () => this.loadPost());
    this.preCallSel.addEventListener('change', () => {
      this.fillSetupSelect(this.preSetupSel, this.preCallSel.value);
      this.loadPre();
    });
    this.preSetupSel.addEventListener('change', () => this.loadPre());

    // Instance editor.
    this.instResetBtn.addEventListener('click', () => this.doResetInstance());
    this.revertBtn.addEventListener('click', () => this.doRevert());
    this.updateRevertBtn();
    // CTRL/CMD+Z, because that is what undo is. It is NOT taken from a field: a text or number input has its
    // own undo, and stealing the keystroke there would replace the caller's typing history with the panel's.
    window.addEventListener('keydown', (e) => {
      if (!this.active || !this.isInstanceMode()) return;
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
      e.preventDefault();
      this.doRevert();
    });
    this.cloneBtn.addEventListener('click', () => this.doClone());
    this.instExportBtn.addEventListener('click', () => this.doExport());
    this.startFormationSel.addEventListener('change', () => this.doStartFormation());
    this.connectBtn.addEventListener('click', () => this.doConnect());
    this.endFormationSel.addEventListener('change', () => this.doEndFormation());
    this.connectEndBtn.addEventListener('click', () => this.doConnectEnd());
    this.endAutoBtn.addEventListener('click', () => {
      this.endOverride = null;
      this.renderInstance();
      this.statusEl.textContent = 'pairing back to the derived one';
    });
    // THE MANUAL SCRUB. The animation is off in this mode, so this is the only thing that moves the
    // dancers: `setPlayhead` moves the playhead WITHOUT re-showing the call, because re-showing
    // rebuilds all eight dancer views and their trails and would be done on every pointer move.
    this.scrubEl.addEventListener('input', () => {
      const b = parseFloat(this.scrubEl.value);
      if (!Number.isFinite(b)) return;
      // The bar is in the call's own beats; the player wants the timeline's.
      this.editBeat = b;
      this.host.setPlayhead(this.absoluteEditBeat(this.instance));
      this.renderScrub(this.instance);
    });
    // There is no dancer dropdown and no "all" button any more: the chips ARE the selector
    // (`renderDancerPicks`), one toggle per dancer, and the lowest-numbered selected one is the dancer
    // the tile shows.
    // There is no "Move" dropdown any more: the strip IS the picker, and `selectMove` both
    // re-draws it and re-derives the track highlight.
    this.moveAddBtn.addEventListener('click', () => this.addInstanceMove());
    this.moveDelBtn.addEventListener('click', () => this.deleteInstanceMove());
  }

  /**
   * OPEN THE INSTANCE EDITOR on one call and one setup. This is the Browse list's Edit button.
   *
   * Asked for as: "add an Edit button ager the del button that opens the selected call in the call Editor tab."
   *
   * THE FILTER IS CLEARED IF IT HAS TO BE. The three call lists are narrowed by both the Level selector and the
   * Find box, and a formation can perfectly well have come from a call the editor is not currently offering -
   * so the button would otherwise fail on a panel state the caller cannot see the connection to. Clearing both
   * is what makes the call reachable, and it is the same as pressing Escape in the Find box.
   *
   * IT EDITS NOTHING. Choosing the call and setup and loading them is exactly what clicking the two lists does,
   * so a caller who only wanted to LOOK has changed nothing - and `instanceEdited` stays false, so Save is not
   * offered for a call nobody touched.
   */
  openCall(callId: string, setupIdx: number) {
    // THE INSTANCE TAB, because that is where a call's own `<tam>` is edited and the button says "edit the
    // call" rather than "open the editor on whatever tab was left showing".
    if (this.modeSel.value !== 'instance') {
      this.modeSel.value = 'instance';
      this.applyMode();
    }
    const offers = () => Array.from(this.editCallSel.options).some((o) => o.value === callId);
    if (!offers()) {
      this.levelSel.value = '';
      this.callFilterInput.value = '';
      this.callQuery = '';
      this.applyCallFilter();
    }
    if (!offers()) {
      this.statusEl.textContent = `✗ ${callId} is not in the loaded catalogue`;
      return;
    }
    this.editCallSel.value = callId;
    this.fillSetupSelect(this.editSetupSel, callId);
    const idx = String(setupIdx);
    if (Array.from(this.editSetupSel.options).some((o) => o.value === idx)) this.editSetupSel.value = idx;
    // THE SAME THREE CALLS THE `change` HANDLERS MAKE, in the same order - so this is not a second way to
    // load an instance, it is the way the lists already do it.
    this.loadEditSetup();
    this.loadInstance();
    // AND SAY WHAT WAS OPENED. The panel loads the full square and nothing else, so this is a plain confirmation
    // rather than a warning about which of two readings is on screen.
    this.statusEl.textContent = `opened ${this.editCallSel.selectedOptions[0]?.textContent ?? callId}`;
  }

  setActive(a: boolean) {
    this.active = a;
    this.setHudWide();
    // The view options are scoped to this panel: applied on the way in, released on the way out.
    this.applyViewOptions();
    if (a) {
      this.renderSaved();
      this.renderInstance();
      // ...AND SHOW IT: the instance loaded by the constructor was not previewed, because the board belonged to
      // the browse view at the time. This is the moment it becomes this panel's.
      if (this.instance) this.showInstance(this.instance);
    } else {
      // The editor is off screen: give every dancer's track back, and drop the Bézier gizmo so the
      // browse and sequence views cannot inherit a magenta dot from an edit that is not showing.
      this.host.focusTrail(null, null);
      this.stage.setGizmo(null);
      // The dialog belongs to this panel: leaving it up over the browse view would be two controls that do
      // nothing, on a board whose view options are released.
      this.hideViewDialog();
    }
  }
}


/**
 * The line every export carries at the top: WHICH BUILD OF THIS APP WROTE IT.
 *
 * Asked for as: "add an xml comment at the top of the export containing the web apps buildhash. This should give
 * basic version control when importing them."
 *
 * THE DIRTY FLAG IS THE HALF THAT MATTERS MOST. A short hash identifies a commit, and an export made from a
 * working tree with uncommitted changes does NOT correspond to any commit at all - so saying `commit abc1234`
 * without saying "and uncommitted changes" would be a version stamp that is quietly wrong exactly when it is
 * most needed. `__GIT_DIRTY__` is injected by `vite.config.ts` alongside the hash for the build footer, and this
 * is the same reading of the same value.
 *
 * A COMMENT RATHER THAN AN ELEMENT, so the export still parses as the thing it is: `<tam>` blocks and
 * `<tamination>` blocks are pasted into a corpus file, and an element would become part of that file's data.
 * (Comments may not contain `--`, and none of these values can.)
 */
function buildStamp(): string {
  const dirty = __GIT_DIRTY__ === 'dirty' ? ', with uncommitted changes' : '';
  const when = __BUILD_TIME__ ? `, built ${__BUILD_TIME__.slice(0, 16).replace('T', ' ')}Z` : '';
  return `<!-- exported by the dancing-squared web app: commit ${__GIT_COMMIT_SHORT__ || 'unknown'}${dirty}${when} -->`;
}

/** Backwards-compatible factory (used by main.ts). */
export function initEditor(stage: Stage, host: EditorHost): EditorUI {
  return new EditorController(stage, host);
}
