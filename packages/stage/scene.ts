// Three.js render adapter. This knows nothing about the engine's data model —
// it consumes Pose[] and grip targets and draws 3D avatars.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// `DANCER_WIDTH`/`DANCER_DEPTH` are the body the CONTACT RULES measure, so the flat marker is drawn to
// exactly that size. See `bodies.ts`: a dancer is 0.95 across the facing and 0.45 deep along it, and the
// visual must agree or the picture stops being evidence about the collision model.
import {
  DANCER_DEPTH,
  DANCER_WIDTH,
  type DancerSpec,
  type Pose,
} from 'dancing-squared-engine';

// THE TWO FLOOR GRIDS AND THEIR MAGNET LIVE IN ONE PURE MODULE, so this file DRAWS from the same spec the
// editor's CTRL-drag SNAPS to - see `grid-magnet.ts`. Both grids are drawn at the same divisions; only the
// shape of the reference changes.
import {
  RADIAL_SPOKES,
  RADIAL_SPOKE_STEP,
  RADIAL_CARDINAL_EVERY,
  radialCircleRadii,
  squareHalfOffsets,
  type GridMode,
} from './grid-magnet';

/**
 * How much of the canvas is covered by floating UI on each side, in CSS pixels - see `setViewInsets`.
 * Every field is optional and defaults to none.
 */
export interface ViewInsets {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** Fixed top-down orthographic camera used in the 2D (flat) view. */
  camera2d: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  /** `controls` is deliberately NOT exported any more: there is one orbit control per camera, and a
   *  caller reaching for "the" controls while the 2D view was up is exactly how the 2D camera ended up
   *  with no pan and no zoom. Use `setControlsEnabled` and `updateControls`, which act on whichever
   *  view is on screen. */
  /** Switch the active camera between the 3D orbit camera and the fixed top-down
   * 2D camera (which pans and zooms, but does not rotate). */
  setView2D(on: boolean): void;
  /** WHICH FLOOR GRID IS ON THE BOARD - the square lines or the radial spokes and circles.
   *
   *  ONE OF THE TWO IS ALWAYS DRAWN, which is why this is a mode rather than a visibility flag: a board with
   *  neither would have no reference at all, and a board with both would draw two grids over each other.
   *  The grid is on every board in every panel, so this is NOT scoped to the panel that happens to be on
   *  screen - unlike the editor's 2D/3D choice. */
  setGridMode(mode: GridMode): void;
  resize(): void;
  /** TELL THE STAGE HOW MUCH OF THE CANVAS THE FLOATING UI COVERS, in CSS pixels from each canvas edge, so the
   *  floor can be framed and centred in what is left rather than under the panels. `main.ts` measures the real
   *  element and passes `left`; the other sides are there because the arithmetic is the same for all four and a
   *  top bar is the obvious next thing to add.
   *
   *  Measured, not assumed: the panel is content-sized and changes width with the mode. Re-applies the framing
   *  immediately, and is remembered across resizes. */
  setViewInsets(insets: ViewInsets): void;
  /** Turn pointer input to the ACTIVE camera's controls on or off. The Bezier drag uses this so the
   *  board cannot rotate or pan underneath a point being dragged - and it goes through here rather
   *  than through `controls` because there are TWO control sets now, and reaching for the 3D one while
   *  the 2D view is up is how the 2D camera came to be left out of the pan and zoom. */
  setControlsEnabled(on: boolean): void;
  /** Advance both control sets (damping). Call once per frame. */
  updateControls(): void;
  /** Show the Bezier gizmo for one move, or clear it with `setGizmo(null)`.
   *
   *  A handle is the classic vector-editor gadget: a line from an anchor out to the control point,
   *  with a grabbable dot at the end. A curve is the Bezier ITSELF, already sampled into a polyline by
   *  the caller - this module stays a renderer, and the samples come from the engine's own
   *  `bezierPoint`, so what is drawn is the curve the engine evaluates rather than a lookalike. */
  setGizmo(handles: HandleSpec[] | null, curves?: CurveSpec[] | null): void;
  /** The handle id under a canvas point, or null. */
  pickHandle(clientX: number, clientY: number): string | null;
  /** The BOARD (x, y) under a canvas point, on the floor plane - the inverse of the drawing
   *  mapping - or null when the ray misses the plane. */
  floorPoint(clientX: number, clientY: number): { x: number; y: number } | null;
}

/**
 * The handle colours, so the palette lives in one place and the panel can name them.
 *
 * THEY ARE DIFFERENT COLOURS BECAUSE THEY ARE DIFFERENT KINDS OF CURVE. Magenta is the TRAVEL curve -
 * a path on the floor, where the dancer goes. Cyan is the FACING curve - a curve drawn in the mover's
 * own frame at the move's start whose DIRECTION at each point is the heading the dancer has at that
 * instant. One colour for both would invite reading the second as a place the dancer goes.
 *
 * AMBER IS A THIRD KIND AGAIN, not a shade of either: a dancer's START POSE, which is not a curve at
 * all but the frame the whole track is authored in - see `drawDancerHandles`. In magenta it would read
 * as the first control point of the move, and in cyan as a facing, both of which are things you edit
 * one move at a time rather than once per dancer.
 *
 * AND GREEN IS THE GRID'S OWN COLOUR, for the one control that is neither a point to drag nor a pose: the
 * RADIAL ARC FIT that bends the curve onto a circle of the grid (see `radialArcFit`). It is drawn in the colour
 * the grid draws its circles in, because that is what pressing it makes the curve follow - so a caller reads
 * "this dot is about the grid" from the dot itself.
 */
export const HANDLE_COLOR = { travel: 0xff6fd0, facing: 0x3fd0ff, dancer: 0xffd23f, arc: 0x8fd6b5 } as const;

/**
 * HOW FAR THE FLOOR REACHES from its centre, in board units - the ONE number every drawing on it derives from.
 *
 * The floor is TEN UNITS ACROSS - half-width 5 - so the square grid is 10 cells, and with the half lines at
 * 0.5 … 4.5 it is the 20 x 20 grid the caller counts. Asked for as: "Expand the board's square and radial
 * background grids from -4/+4 to -5/+5", and it was one edit, because the two grids, the radial circles, the
 * half marks, the axes, the pan limit and the framing all derive from this rather than repeating it.
 *
 * IT IS EXPORTED because the floor is not only the stage's business: the Call editor asks this same number
 * which CIRCLES the radial grid draws, so that a curve whose ends both lie on one of them can be fitted to it
 * (`radialArcFit`). A second copy of "5" in the panel is exactly how the two would come to disagree.
 */
export const FLOOR_HALF = 5;

/** A Bezier curve to draw, already sampled into board coordinates by the caller. */
export interface CurveSpec {
  points: { x: number; y: number }[];
  color?: number;
}

/** One draggable Bezier control point: where its line is anchored, and where the dot is. */
export interface HandleSpec {
  /** `d<dancerIndex>:c1|c2` for the travel curve, `d<dancerIndex>:r1|r2|r3` for the facing curve - so
   *  a hit says WHICH dancer's handle and WHICH control point it is. */
  id: string;
  anchor: { x: number; y: number };
  point: { x: number; y: number };
  /** Defaults to the travel colour. */
  color?: number;
}

/** A flat always-facing-camera text label (Sprite) so axis/angle names stay
 * readable in both the 3D orbit and 2D top-down views. */
function makeTextSprite(text: string, color: string, height = 1.15): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontPx = 130;
  const font = `800 ${fontPx}px system-ui, "Segoe UI", sans-serif`;
  ctx.font = font;
  const pad = 46;
  const w = Math.ceil(ctx.measureText(text).width + pad * 2);
  const h = Math.ceil(fontPx * 1.15 + pad);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Dark halo so the text reads over the grid/floor.
  ctx.lineWidth = 22;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(5, 10, 15, 0.85)';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  const aspect = w / h;
  sprite.scale.set(height * aspect, height, 1);
  return sprite;
}

/** A small arrowhead cone lying flat on the floor, tip pointing along `dir` (a
 * unit 3D vector in the xz floor plane, y = 0). */
function makeArrowHead(dir: THREE.Vector3, color: number, size = 0.55): THREE.Mesh {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.17, size, 12),
    new THREE.MeshBasicMaterial({ color }),
  );
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return cone;
}

/**
 * HOW TALL AN AXIS LABEL IS, as a fraction of the floor's own half-width.
 *
 * The label used to be a CONSTANT 1.15 world units, which was written when the floor was 20 units across; on the
 * 8-unit floor that was 29% of the half-width and read as a headline rather than as a coordinate key. Reported
 * from use: "The axis text is much larger than it needs to be." A fraction rather than another constant, so the
 * labels stay the same SIZE ON THE BOARD when the floor is resized again - which is how they drifted in the first
 * place, and which is why the floor going from 8 units to 10 needed no edit here. 0.12 of today's half-width is
 * 0.60 units, about 48 px tall on a 1600 x 900 canvas, with glyphs around 23 px - an ordinary UI caption.
 */
const AXIS_LABEL_FRAC = 0.12;

/** The main X (east–west) and Y (north–south) reference axes with arrowheads and
 * angle labels at 90° increments. Heading 0° faces +x (east), 90° faces +y
 * (north, which maps to 3D −z), so the labels give the compass a dancer heading
 * is measured against. Returns a group already positioned at the floor level. */
function buildFloorAxes(half: number): THREE.Group {
  const g = new THREE.Group();
  const Y0 = 0.02; // sit just above the grid/floor
  const inner = 0.9; // start radius (keep clear of the origin clutter)
  // THE ARROWS STOP AT THE FLOOR'S OWN EDGE and the labels sit just outside it, so both follow the floor
  // rather than a pair of radii that were written when it was 20 units across.
  const outer = half - 0.1; // arrow tip radius
  const labelR = half + 0.35; // label placement radius (beyond the arrow tips)
  const labelH = half * AXIS_LABEL_FRAC; // see AXIS_LABEL_FRAC
  const X_COL = 0xffce6a; // X axis (0°/180°) — warm
  const Y_COL = 0x6fd0ff; // Y axis (90°/270°) — cool

  // heading (deg) -> unit 3D floor direction (x, 0, -sin(heading))
  const dirFor = (deg: number) => new THREE.Vector3(Math.cos(deg * Math.PI / 180), 0, -Math.sin(deg * Math.PI / 180));

  const addAxisRay = (deg: number, outward: THREE.Vector3, color: number, labelText: string) => {
    const a = outward.clone().multiplyScalar(inner).setY(Y0);
    const b = outward.clone().multiplyScalar(outer).setY(Y0);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    g.add(line);
    const head = makeArrowHead(outward, color);
    head.position.copy(b);
    g.add(head);
    const lab = makeTextSprite(labelText, color === X_COL ? '#ffe2a8' : '#bfe6ff', labelH);
    lab.position.copy(outward.clone().multiplyScalar(labelR).setY(Y0));
    g.add(lab);
  };

  // X axis: east = 0°, west = 180°. Each label carries BOTH facts, because they answer
  // different questions: the signed axis name says which way the board COORDINATE grows
  // (board +x is east, so `+X` is the 0° ray), and the angle is the compass a dancer's
  // HEADING is measured against (0° faces east, 90° faces north = board +y, which maps to
  // 3D −z). Sign first, so it reads the way a coordinate axis is written.
  addAxisRay(0, new THREE.Vector3(1, 0, 0), X_COL, '+X  0°');
  addAxisRay(180, new THREE.Vector3(-1, 0, 0), X_COL, '-X  180°');
  // Y axis (board +y = north = 3D −z): 90°, and 270° south.
  addAxisRay(90, new THREE.Vector3(0, 0, -1), Y_COL, '+Y  90°');
  addAxisRay(270, new THREE.Vector3(0, 0, 1), Y_COL, '-Y  270°');

  // Central origin dot so the crossing point reads clearly.
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 24),
    new THREE.MeshBasicMaterial({ color: 0xdde6ee }),
  );
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = Y0;
  g.add(dot);
  return g;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  // THE FLOOR, AND THE FRAME IT IS DRAWN IN.
  /** How much floor is left around the grid inside the frame, in board units - so the outermost line is not
   *  clipped by the screen edge and the axis labels just outside it are still on screen. */
  const FRAME_PAD = 0.6;
  /** The world half-extent the frame has to show: the floor plus its pad. */
  const FRAME_HALF = FLOOR_HALF + FRAME_PAD;

  /**
   * HOW MUCH OF THE CANVAS THE FLOATING UI COVERS, in CSS pixels, and the box that is left.
   *
   * The stage does not know what a "panel" is - it is told a number and it frames around it. The number comes
   * from measuring the real element (`main.ts` reads `#hud`'s box), because the panel is content-sized: 320 px
   * wide at its narrowest and 780 px in the instance editor, so a constant here would be wrong in one mode or
   * the other and would drift again the next time the panel grew a row.
   *
   * THE INSET IS CAPPED, and not only for tidiness: a panel wider than the canvas would otherwise leave a
   * visible box of nothing, and an orthographic frustum of zero width has no inverse - the flat view would go
   * blank rather than frame anything. Past the cap the panel is most of the window and there is no visible
   * region left to centre in, so the frame keeps the largest box it can still draw the floor in.
   */
  const INSET_MAX_FRACTION = 0.45;
  const insets: Required<ViewInsets> = { left: 0, right: 0, top: 0, bottom: 0 };
  const visibleBox = (w: number, h: number) => {
    const l = Math.min(Math.max(0, insets.left), w * INSET_MAX_FRACTION);
    const r = Math.min(Math.max(0, insets.right), w * INSET_MAX_FRACTION);
    const t = Math.min(Math.max(0, insets.top), h * INSET_MAX_FRACTION);
    const b = Math.min(Math.max(0, insets.bottom), h * INSET_MAX_FRACTION);
    return { l, r, t, b, w: Math.max(1, w - l - r), h: Math.max(1, h - t - b) };
  };
  /**
   * WHERE THE FLOOR GOES, for a canvas of this size and the floating UI that covers it.
   *
   * THE GRID IS FITTED, NOT GUESSED, and it is FITTED RATHER THAN FILLED ON BOTH AXES because a square floor
   * cannot do both on a canvas that is not square: the frame shows the floor whole on the TIGHTER axis and
   * the spare space falls on the other, which is what "fills and centres" can mean for a square. The old
   * framing was a constant 11 units, so the floor filled the height and left a wide margin at the sides
   * whatever the canvas was; this asks the canvas what it is and answers.
   *
   * AND IT IS FITTED TO WHAT CAN BE SEEN, NOT TO THE CANVAS. The panels are DOM overlays floating on top of
   * the canvas, so the canvas is the full window while the BOARD is only the part of it nothing covers.
   * Reported from use: "the board seems to be centralised to the screen, but it hasn't taken into account
   * that the left hand dialog changes the visible board to the right hand side." So the fit is against the
   * canvas MINUS the covered strips (`visibleBox`), and the floor is centred on the centre of what is left
   * rather than on the centre of the canvas - which is the two things `halfW/halfV` and `cX/cY` below do.
   *
   * The maths, once, because both cameras derive from it:
   *
   *   - the canvas shows `2 * halfV` world units vertically and `2 * halfW` horizontally, with
   *     `halfW / halfV = w / h` so the board keeps its shape (the probe measures px/unit on both axes);
   *   - `pxPerUnit = h / (2 * halfV)` on both axes, so the VISIBLE box (w' x h') shows
   *     `halfV * h' / h` world units vertically and, by the same scale, `halfV * w' / h` horizontally.
   *     Requiring both to reach FRAME_HALF gives the two terms of the `max` below;
   *   - the frustum's centre is moved by the visible box's centre offset, in world units:
   *     a point at the frustum centre lands at the middle of the screen, so the centre has to move by
   *     `-(dx / pxPerUnit)` with `dx` the visible centre's offset in CSS pixels.
   *
   * (`cX`/`cY` are relative to the camera's own position, which is the pan target: panning still pans.)
   */
  const frame = (w: number, h: number) => {
    const v = visibleBox(w, h);
    const halfV = Math.max(FRAME_HALF * h / v.h, FRAME_HALF * h / v.w);
    const halfW = halfV * (w / h);
    const dx = (v.l - v.r) / 2; // px the VISIBLE centre sits right of the canvas centre
    const dy = (v.t - v.b) / 2; // px ... and below it
    return { halfW, halfV, cX: (-dx * 2 * halfW) / w, cY: (dy * 2 * halfV) / h, v };
  };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);

  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
  // Top-down view so the compass maps cleanly to the screen: north (2D +y -> 3D
  // -z) at the top, south (nearest the viewer) at the bottom, east right, west
  // left. Screen-up = -z is chosen so couple colours (red at the bottom, then
  // yellow right, green top, blue left) line up with where you see them.
  camera.up.set(0, 0, -1);
  /**
   * THE 3D VIEW IS FRAMED FROM THE SAME FLOOR AND THE SAME VISIBLE BOX as the flat view.
   *
   * At 50 degrees of vertical field of view the visible half-height at the target is `distance * tan(25)`, so
   * the floor plus its pad needs `4.6 / tan(25) = 9.86` of it - which is where the old fixed 9.84 came from,
   * and it is still right on a canvas wider than it is tall, because there the VERTICAL is the tighter axis.
   * On a portrait canvas it is not: the old constant left the floor cropped 0.8 units off each side, since a
   * distance chosen for the height cannot also fit a width the same camera sees less of. `frame3D` below
   * computes it from the visible box instead, so this is the same rule the flat view uses rather than a second
   * one that happens to agree on the default window.
   */
  const VIEW_FOV = 50;
  /** The camera's direction from its target - straight down, tipped a few degrees towards the viewer so the
   *  dancers read as standing rather than as discs. Only the DIRECTION is fixed; `frame3D` sets the distance. */
  const VIEW_DIR = new THREE.Vector3(0, 9.84, 0.65).normalize();
  camera.position.copy(VIEW_DIR).multiplyScalar(FRAME_HALF / Math.tan((VIEW_FOV / 2) * Math.PI / 180));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.update();
  // ONCE THE CALLER HAS TOUCHED THE 3D VIEW, ITS DISTANCE IS THEIRS. The startup framing is derived from the
  // canvas, so it has to be recomputed when the canvas changes - but a resize is not a reason to throw away an
  // orbit the caller set up, and re-fitting the distance would do exactly that. The 'start' event is the first
  // pointer touch of any gesture, which is the moment the view stops being ours. The LENS SHIFT is not gated
  // this way, and does not need to be: it changes the projection, not the camera.
  let userFramed3D = false;
  controls.addEventListener('start', () => { userFramed3D = true; });

  // Fixed top-down orthographic camera for the flat 2D view (north up = -z), on a square frustum at the frame
  // the floor needs on a square canvas. `resize` is called before the first frame and re-frames it from the
  // canvas's real size, so this is only what a canvas that has not been measured yet gets.
  const frame0 = frame(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
  const camera2d = new THREE.OrthographicCamera(-frame0.halfW, frame0.halfW, frame0.halfV, -frame0.halfV, 0.1, 200);
  // Height above the floor. For an ORTHOGRAPHIC camera this is not a distance - the frustum does the
  // scaling - it only has to be off the floor and inside the near/far planes.
  const ORTHO_CAM_HEIGHT = 40;
  camera2d.position.set(0, ORTHO_CAM_HEIGHT, 0);
  camera2d.up.set(0, 0, -1);
  camera2d.lookAt(0, 0, 0);

  // A SECOND CONTROL SET, BECAUSE ORBITCONTROLS IS BOUND TO ONE CAMERA OBJECT for its whole life.
  // The flat view used to switch `controls.enabled` off entirely, which is why dragging and zooming
  // did nothing in 2D - and it is why they still would not work if this had simply stayed disabled:
  // the one control set drives the 3D camera, so allowing it in 2D would pan and dolly the camera
  // that is not on screen.
  //
  // ROTATION IS OFF because a top-down view that can be tilted is not a 2D view; pan and dolly are
  // exactly what a flat plan needs and both work on an orthographic camera (the dolly changes
  // `camera.zoom`, which `resize` never touches, so the zoom survives a resize).
  //
  // LEFT DRAGS PAN, and that is a deliberate departure from the 3D defaults: OrbitControls maps the
  // left button to ROTATE, and with rotation disabled a left drag would do nothing at all - which is
  // the gesture a caller reaches for first. The Bezier-handle drag still wins where it applies,
  // because grabbing a handle switches these controls off for the duration of the gesture.
  const controls2d = new OrbitControls(camera2d, canvas);
  controls2d.target.set(0, 0, 0);
  controls2d.enableRotate = false;
  controls2d.enableDamping = true;
  controls2d.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  // AND THE TOUCH MAPPINGS TOO, for the same reason the left button was re-mapped: one finger defaults to
  // ROTATE, which is a dead gesture here (rotation is off) - so without this the flat view answers a
  // one-finger drag with nothing at all, which is the "pan does not work in 2D" report over again.
  controls2d.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  // ZOOM IS BOUNDED, and not for taste: an orthographic frustum of zero width has no inverse, so an
  // unbounded dolly ends in a blank screen - and zooming out forever loses the board just as
  // thoroughly. 0.2 shows 5x the floor, 20 is close enough to place a control point by eye.
  controls2d.minZoom = 0.2;
  controls2d.maxZoom = 20;
  controls2d.enabled = false; // the 3D view is the one on screen at startup (see `applyControlsEnabled`)
  controls2d.update();

  /**
   * THE FLAT VIEW'S ONE INVARIANT, ENFORCED RATHER THAN CONFIGURED.
   *
   * Reported: "in 2d mode, the drag board must not rotate on the x and y, only drag, keeping the board
   * perpendicular to the camera. Currently the drag rotates the dance floor." The controls ARE built with
   * `enableRotate = false` and a pan mapping on every button, so the configuration says this cannot happen -
   * and a report that contradicts the configuration is the kind that should not be answered by re-reading
   * it. "2D" is a statement about the CAMERA, so it is now enforced on the camera, once per frame, and the
   * input mapping stops being the thing the guarantee rests on:
   *
   *   - the camera is put back DIRECTLY OVER THE TARGET, with the board's +y up the screen (`up = -z`),
   *     so no gesture can leave it tilted, whichever control set is live or whatever a future handler does;
   *   - the offset is taken from the TARGET rather than remembered, so panning still works: a pan moves the
   *     target and the camera follows it at the same height, which is what a pan IS for a top-down view.
   *
   * It runs AFTER the controls have been updated, so it is the last word on the camera each frame.
   */
  const squareCamera2D = () => {
    camera2d.up.set(0, 0, -1);
    camera2d.position.set(controls2d.target.x, ORTHO_CAM_HEIGHT, controls2d.target.z);
    camera2d.lookAt(controls2d.target);
    camera2d.updateMatrixWorld();
  };

  // HOW FAR THE FLAT VIEW MAY BE PANNED, as a function of the zoom rather than a constant: the whole
  // point of the limit is that the floor cannot be pushed off screen with no gesture that brings it
  // back, and how far "off screen" is depends on how much world the viewport covers. The limit is
  // PER AXIS - the floor's half-width plus the visible half-span on that axis - so it lands exactly
  // where the floor's own edge reaches the edge of the screen in whichever direction you pan.
  //
  // THE FIRST VERSION USED ONE SYMMETRIC LIMIT AND WAS MEASURABLY TOO TIGHT: `tools/view2d-probe.mjs`
  // caught the floor's edge stopping 0.571 of a screen-half short of the side edge on a 21:9 canvas,
  // because a limit that only accounts for the vertical half-span is conservative horizontally by
  // exactly the aspect ratio. It kept the board reachable, which was the point, but it also refused
  // panning that the caller can see nothing wrong with.
  //
  // IT IS READ OFF THE FRUSTUM RATHER THAN RE-DERIVED, and that matters more now that the frustum is
  // asymmetric: an inset moves the frame's CENTRE, so a limit built only from the half-extents would be
  // measured from the wrong point. Both the centre and the half-extent are what `resize` wrote, so they are
  // the authority on what is on screen. The zoom divides the half-extent but NOT the centre - an orthographic
  // dolly scales the frustum about its centre.
  const panLimit2D = () => {
    const zoom = camera2d.zoom;
    const halfW = (camera2d.right - camera2d.left) / (2 * zoom);
    const halfV = (camera2d.top - camera2d.bottom) / (2 * zoom);
    const cX = (camera2d.left + camera2d.right) / 2; // frustum centre, board x
    // The frustum's vertical centre is in VIEW y, which is board +y (screen-up = -z), so the board-z centre
    // of the view is its negation.
    const cZ = -(camera2d.top + camera2d.bottom) / 2;
    return { x: FLOOR_HALF + halfW - cX, z: FLOOR_HALF + halfV - cZ };
  };

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(5, 12, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-6, 4, -5);
  scene.add(rim);

  // Floor grid — a clear reference so dancer positions are readable. Dancers are
  // placed at integer dance-grid coords (±1, ±2, ±3…), so 1-unit cells over ±10
  // lets you read where each dancer stands; the centre lines are brighter.
  //
  /**
   * THE HALF MARK, DRAWN TO BE SEEN AND TO BE TOLD APART - and it is ONE material for BOTH grids.
   *
   * Asked for twice, in this order: "Add a half grid line for the circles. Make this more subtle than the unit
   * circles." and then "Add the same subtle half-grid line used by the radial grid to the square grid." The
   * word doing the work in the second is SAME, so the square grid's half lines and the radial grid's half rings
   * share this object: two definitions could drift, and a probe that read one of them would still pass.
   *
   * WHY IT LOOKS LIKE THIS. The first cut was the UNIT colour at 0.4, which composites to 0x202a35 - a contrast
   * of 1.27 against the 0x0e141b floor, DIMMER than the 2-unit overlay already on that floor (1.43) and only a
   * quarter brighter than the floor itself. Reported from use: "I cannot see the half circles on the radial
   * grid, they are too subtle."
   *
   * Brightness alone then left the two families to be told apart by a 1.67-against-1.95 difference, and the
   * whole palette was ONE HUE - the floor, the divisions and the overlay are all 212 (blue). So the half mark
   * takes a VIOLET-GREY instead: hue 270 at the same lightness, 58 degrees away from the divisions and still
   * subtle at this saturation. It is deliberately NOT the teal of the cardinal spokes (hue 159) or the warm of
   * the axis labels, so the three families on this floor read as three.
   *
   * 0x5c5068 at 0.6 composites to 0x3d3849, a contrast of 1.64: above the overlay's 1.43 so the half mark is
   * not the faintest line in the picture, below the divisions' 1.95 so it is still the weaker family.
   * `radial-grid-probe.mjs` recomputes the contrast AND the hue gap from this material and the floor - and
   * checks that BOTH grids draw from it.
   */
  const halfMat = new THREE.LineBasicMaterial({ color: 0x5c5068, transparent: true, opacity: 0.6 });

  // THE BOARD HAS TWO GRIDS NOW, and they are ALTERNATIVES rather than layers: the square one below and the
  // radial one after it, exactly one of which is visible. Both are drawn at the SAME divisions - a line or a
  // circle every whole unit out to `FLOOR_HALF`, with every second one overlaid at the coarser weight - so
  // switching changes the SHAPE of the reference and not its scale. `grid-magnet.ts` owns those numbers, so
  // what is drawn and what the CTRL-drag magnet pulls to cannot drift apart.
  const squareGroup = new THREE.Group();
  const grid = new THREE.GridHelper(FLOOR_HALF * 2, FLOOR_HALF * 2, 0x2f9e77, 0x3a4a5c);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.95;
  squareGroup.add(grid);
  // A coarser overlay every 2 units (matching the usual 2-unit dancer spacing).
  const coarse = new THREE.GridHelper(FLOOR_HALF * 2, FLOOR_HALF, 0x8fd6b5, 0x5b6b7d);
  (coarse.material as THREE.Material).transparent = true;
  (coarse.material as THREE.Material).opacity = 0.35;
  squareGroup.add(coarse);
  // THE HALF LINES, and they are the SAME MARK the radial grid makes: the same offsets and, below, the same
  // material. A `LineSegments` rather than a `GridHelper` because a GridHelper divides its span evenly - 40
  // divisions would put a line at EVERY half unit, overdrawing the divisions the grid already has, where the
  // half mark is only the positions BETWEEN them (see `squareHalfOffsets`).
  const halfLinePts: THREE.Vector3[] = [];
  for (const v of squareHalfOffsets(FLOOR_HALF)) {
    for (const s of [v, -v]) {
      // one line along the board's Y (which is -z here) at x = s ...
      halfLinePts.push(new THREE.Vector3(s, 0, FLOOR_HALF), new THREE.Vector3(s, 0, -FLOOR_HALF));
      // ... and one along the board's X at y = s
      halfLinePts.push(new THREE.Vector3(-FLOOR_HALF, 0, s), new THREE.Vector3(FLOOR_HALF, 0, s));
    }
  }
  squareGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(halfLinePts), halfMat));
  scene.add(squareGroup);

  // THE RADIAL GRID: the same floor divided into 16 spokes, a circle at every whole unit, and a FAINT ring
  // at each half unit between them.
  //
  // A SPOKE IS A LINE FROM THE ORIGIN and a circle is a closed polyline; both are ordinary `Line`s on the
  // floor plane, at y = 0 like `GridHelper` and above the floor at -0.001. Three has no circle primitive, so
  // a ring is SAMPLED: at 128 segments the chord between two samples is 0.05 units on the outermost ring,
  // which is well inside a pixel in the flat view.
  //
  // THE FOUR CARDINAL SPOKES take the bright centre-line colour the square grid gives x = 0 and y = 0, so
  // the compass the axis labels mark below is drawn in both grids.
  //
  // THE BOARD MAPPING IS (x, 0, -y) - see `placeDancer` - so a board point at angle `a` and radius `r` is
  // (cos a * r, 0, -sin a * r) here, and the picture turns the same way the data does.
  const radialGroup = new THREE.Group();
  const CIRCLE_SEGMENTS = 128;
  const radialMat = {
    line: new THREE.LineBasicMaterial({ color: 0x3a4a5c, transparent: true, opacity: 0.95 }),
    // THE SAME HALF MARK THE SQUARE GRID DRAWS, as rings. One material, `halfMat`, for both.
    half: halfMat,
    cardinal: new THREE.LineBasicMaterial({ color: 0x2f9e77, transparent: true, opacity: 0.95 }),
    coarse: new THREE.LineBasicMaterial({ color: 0x5b6b7d, transparent: true, opacity: 0.35 }),
  };
  const ring = (r: number, mat: THREE.LineBasicMaterial) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, -Math.sin(a) * r));
    }
    radialGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  };
  for (let k = 0; k < RADIAL_SPOKES; k++) {
    const a = k * RADIAL_SPOKE_STEP;
    const cardinal = k % RADIAL_CARDINAL_EVERY === 0;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(a) * FLOOR_HALF, 0, -Math.sin(a) * FLOOR_HALF),
    ]);
    radialGroup.add(new THREE.Line(geo, cardinal ? radialMat.cardinal : radialMat.line));
  }
  const circleRadii = radialCircleRadii(FLOOR_HALF);
  for (const r of circleRadii.fine) ring(r, radialMat.line);
  // THE HALF RINGS, drawn faintly so they read as a guide BETWEEN the divisions rather than as divisions of
  // the same standing. See `radialCircleRadii` for why the radial grid draws them and the square one does
  // not: a ring between two circles adds a reading, where a line every half unit would lattice the floor.
  for (const r of circleRadii.halves) ring(r, radialMat.half);
  for (const r of circleRadii.coarse) ring(r, radialMat.coarse);
  radialGroup.visible = false;
  scene.add(radialGroup);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_HALF * 2, FLOOR_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x0e141b, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.001;
  floor.receiveShadow = true;
  scene.add(floor);

  // Main X (east–west) and Y (north–south) axes with 90°-increment angle labels.
  // Heading 0° faces +x (east), 90° faces +y (north, 3D -z), so the labels mark
  // the compass a dancer heading is measured against.
  scene.add(buildFloorAxes(FLOOR_HALF));

  /**
   * Size the renderer and BOTH cameras to the canvas as it is RIGHT NOW.
   *
   * THE 2D CAMERA IS THE REASON THIS IS NOT JUST A RENDERER CALL. Its left/right are the canvas
   * ASPECT times its half-height, so a stale aspect draws the floor stretched - and the app never
   * called this at startup, which left the flat view on the SQUARE frustum its constructor was given
   * (±11 on both axes) however wide the canvas actually was. The grid was visibly not square until
   * the first window resize recomputed it, which is exactly what a caller reported: "it used to jump
   * to square when dragged or scaled". `createStage` now calls this once itself, `setView2D` calls it
   * on every switch, and a ResizeObserver below calls it whenever the canvas box changes, so the
   * frame is never a layout behind again.
   *
   * `camera2d.zoom` is deliberately untouched: the flat view's pan and zoom belong to the caller, and
   * a resize is not a reason to throw them away. The 3D camera's DISTANCE is also left alone once the
   * caller has touched the view - see `frame3D`.
   */
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return; // a hidden canvas has no aspect; keep the last good one
    renderer.setSize(w, h, false);
    const f = frame(w, h);
    camera2d.left = f.cX - f.halfW;
    camera2d.right = f.cX + f.halfW;
    camera2d.top = f.cY + f.halfV;
    camera2d.bottom = f.cY - f.halfV;
    camera2d.updateProjectionMatrix();
    frame3D(w, h, f);
  };

  /**
   * THE 3D VIEW'S TWO HALVES: a LENS SHIFT that is always applied, and a DISTANCE that is applied until the
   * caller takes the view over.
   *
   * THE SHIFT IS `camera.setViewOffset`, which renders a window onto a wider virtual frame. It is what a
   * tilt/shift lens does, and it is the right tool here for a reason that a moved camera would not have: it
   * changes NOTHING about where the camera is, so the inset can be re-applied on every resize, on every mode
   * change, without disturbing a view the caller has orbited, panned or zoomed. Shifting the camera and its
   * target sideways would look the same once and then throw that view away on the next resize.
   *
   *   `setViewOffset(fullW, fullH, x, 0, w, h)` shows the sub-rectangle [x, x + w] of a `fullW`-wide virtual
   *   frame. The content moves by exactly the sub-rectangle's offset, so the frame we want - the floor centred
   *   `d` px right of the canvas centre - is `fullW = w + 2|d|` with `x = 0` for `d > 0` and `x = 2|d|` for
   *   `d < 0` (and the same again, vertically, for a top/bottom inset).
   *
   *   A view offset also takes `camera.aspect` over (`setViewOffset` sets it to `fullW / fullH`), so it is
   *   CLEARED rather than overwritten when there is no inset - writing `aspect = w / h` while an offset is
   *   live would size the projection from the canvas and the shift from the virtual frame.
   *
   * THE DISTANCE fits the floor into the visible box: the window is `h / fullH` of the virtual frame's
   * height, so the visible half-height at the target is `distance * tan(fov / 2) * h / fullH` and the visible
   * half-width is the same expression with `w`. The larger of the two requirements wins. On a canvas taller
   * than it is wide - including one narrowed by a panel - that is the WIDTH, which the old fixed 9.84 ignored
   * and cropped the floor by.
   */
  const VIEW_TAN_HALF_FOV = Math.tan((VIEW_FOV / 2) * Math.PI / 180);
  const frame3D = (w: number, h: number, f: ReturnType<typeof frame>) => {
    const dx = (f.v.l - f.v.r) / 2;
    const dy = (f.v.t - f.v.b) / 2;
    const fullW = w + 2 * Math.abs(dx);
    const fullH = h + 2 * Math.abs(dy);
    if (dx !== 0 || dy !== 0) {
      camera.setViewOffset(fullW, fullH, dx > 0 ? 0 : 2 * Math.abs(dx), dy > 0 ? 0 : 2 * Math.abs(dy), w, h);
    } else {
      camera.aspect = w / h;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    if (userFramed3D) return;
    const d = (FRAME_HALF * fullH) / (VIEW_TAN_HALF_FOV * Math.min(w, h));
    camera.position.copy(controls.target).addScaledVector(VIEW_DIR, d);
  };

  resize();

  // The window listener in `main.ts` only fires when the WINDOW changes size; the canvas box can
  // change without that (a device-pixel-ratio change, fullscreen, browser zoom), and the two cameras
  // would then be sizing themselves to a frame that no longer exists. The observer fires once on
  // observe too, so this is also the second line of defence for the startup sizing above.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => resize()).observe(canvas);
  }

  /** See `Stage.setViewInsets`: remember what the panels cover, then re-frame. */
  const setViewInsets = (next: ViewInsets) => {
    insets.left = next.left ?? 0;
    insets.right = next.right ?? 0;
    insets.top = next.top ?? 0;
    insets.bottom = next.bottom ?? 0;
    resize();
  };

  /** Keep the flat view's centre within reach of the floor - see `panLimit2D`. */
  const clampPan2D = () => {
    const limit = panLimit2D();
    const tx = Math.max(-limit.x, Math.min(limit.x, controls2d.target.x));
    const tz = Math.max(-limit.z, Math.min(limit.z, controls2d.target.z));
    if (tx === controls2d.target.x && tz === controls2d.target.z) return;
    // THE CLAMP IS ON WHERE YOU ARE LOOKING, so it moves the TARGET and lets the invariant put the camera
    // back above it: one place decides where the flat camera is, and it is `squareCamera2D`.
    controls2d.target.x = tx;
    controls2d.target.z = tz;
  };

  // ---------------------------------------------------------------- Bezier handles
  //
  // The classic vector-editor gadget for ONE move's Bezier curves: a line from an anchor out to each
  // control point, and a dot you can grab. See HANDLE_COLOR above for why the two curves are drawn in
  // two colours. Only the SHAPE is editable here - the travel curve's endpoints are the authored
  // track, and moving them is a different gesture (the shared connecting point between two curves)
  // that this deliberately does not offer.
  //
  // THE BOARD MAPPING IS (x, 0, -y): board +x is 3D +x, board +y is 3D -z. `floorPoint` is its
  // inverse, so a drag lands where the pointer is rather than mirrored across an axis.
  const HANDLE_Y = 0.12;
  // A THIRD of what it was (0.3). The 0.3 was 2.5x a DANCER MARKER (0.12), which is the actual reason
  // it read as "very big": the handle was larger than the thing it is a handle FOR, so the board
  // looked like it was mostly handle. At 0.1 it is a little under a dancer.
  const HANDLE_RADIUS = 0.1;
  // THE PICK TARGET IS NOT THE DOT. It is a floor-plane radius, left at the old dot's size, because
  // shrinking the visible dot to a third shrinks its hit area nine-fold, and a handle you can see but
  // cannot grab is a worse artefact than a large one. Padding a target beyond the drawn shape is
  // ordinary UI practice.
  //
  // WHAT A GENEROUS RADIUS COSTS, MEASURED over all 9994 resolved segments of the 542 catalog calls
  // (`tools/handle-pick-probe.mjs`): 69.7% of curves have their two handles further apart than this
  // radius, 24.8% have them distinct but closer, and 5.5% have them EXACTLY coincident - a Stand, or
  // any curve whose control points collapse onto the dancer's own position. In those cases "nearest"
  // has no meaning, and the tie goes to c1, because the scan takes the first strict improvement and
  // c1 is pushed first. That is a real limit: where the dots overlap, ONE of them is unreachable.
  // It is not a regression - two coincident meshes picked in traversal order before this - but it is
  // not a feature either, and a deterministic tie is the most a single grab point can honestly offer.
  const HANDLE_PICK_RADIUS = 0.3;
  // THE CURVE RIDES A HAIR BELOW THE DOTS, so a control point that sits ON its own curve - which is
  // every point of a straight walk's facing curve, where the controls are collinear between the ends -
  // draws the dot over the line rather than z-fighting with it.
  const CURVE_Y = HANDLE_Y - 0.01;
  const handleGroup = new THREE.Group();
  scene.add(handleGroup);
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  // y = HANDLE_Y: THREE's plane is `normal . p + constant = 0`, so the constant is the NEGATED height.
  const handlePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HANDLE_Y);
  const ndc = new THREE.Vector2();

  const toNdc = (clientX: number, clientY: number) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  };

  const setGizmo = (handles: HandleSpec[] | null, curves?: CurveSpec[] | null) => {
    handleGroup.clear();
    // ONE MATERIAL PER COLOUR, cached for the call: a move shows both curves at once only while the
    // panel is switching between them, but the two colours have to coexist whenever they do.
    const lineMats = new Map<number, THREE.LineBasicMaterial>();
    const dotMats = new Map<number, THREE.MeshBasicMaterial>();
    const lineMatFor = (c: number, opacity = 0.85) => {
      const key = c * 100 + Math.round(opacity * 100);
      let m = lineMats.get(key);
      if (!m) { m = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity }); lineMats.set(key, m); }
      return m;
    };
    const dotMatFor = (c: number) => {
      let m = dotMats.get(c);
      if (!m) { m = new THREE.MeshBasicMaterial({ color: c }); dotMats.set(c, m); }
      return m;
    };
    // THE CURVES FIRST, THEN THE GADGET OVER THEM: the polyline is the shape, the handle lines are the
    // scaffolding, and drawing the scaffolding last keeps the dots and their arms legible against it.
    for (const c of curves ?? []) {
      if (c.points.length < 2) continue;
      const color = c.color ?? HANDLE_COLOR.travel;
      const pts = c.points.map((p) => new THREE.Vector3(p.x, CURVE_Y, -p.y));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMatFor(color, 1));
      line.frustumCulled = false;
      handleGroup.add(line);
    }
    for (const h of handles ?? []) {
      const color = h.color ?? HANDLE_COLOR.travel;
      const a = new THREE.Vector3(h.anchor.x, HANDLE_Y - 0.03, -h.anchor.y);
      const b = new THREE.Vector3(h.point.x, HANDLE_Y, -h.point.y);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMatFor(color));
      line.frustumCulled = false;
      handleGroup.add(line);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(HANDLE_RADIUS, 18), dotMatFor(color));
      dot.rotation.x = -Math.PI / 2; // lie flat on the floor
      dot.position.copy(b);
      // The id rides on the mesh so the picker has no index arithmetic to do on the way back.
      dot.userData.handleId = h.id;
      dot.name = `handle:${h.id}`;
      handleGroup.add(dot);
    }
  };

  /**
   * Which handle is under the pointer, or null.
   *
   * A plane at the handles' OWN height (`HANDLE_Y`), not the floor: the dots lie at `HANDLE_Y`, so
   * intersecting there puts the ray's point in exactly the plane of the positions it is compared
   * against and the distance test stays a flat one. Intersecting the floor instead would displace
   * the point by the perspective foreshortening of 0.12 units - small, but a bias that grows with the
   * camera angle, and a pick that drifts with the camera is the kind of thing blamed on the mouse.
   */
  const pickHandle = (clientX: number, clientY: number): string | null => {
    if (handleGroup.children.length === 0) return null;
    toNdc(clientX, clientY);
    raycaster.setFromCamera(ndc, out.camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(handlePlane, hit)) return null;
    // NEAREST WITHIN THE RADIUS, over the DOTS only: a leader line is a thin target, and treating one
    // as grabbable would move the wrong control point when reaching for the other. On the 5.5% of
    // curves whose two handles coincide, the strict `<` gives the tie to c1 - see the note on
    // HANDLE_PICK_RADIUS.
    let best: string | null = null;
    let bestSq = HANDLE_PICK_RADIUS * HANDLE_PICK_RADIUS;
    for (const child of handleGroup.children) {
      if ((child as THREE.Mesh).isMesh !== true) continue;
      const p = child.position;
      const sq = (p.x - hit.x) * (p.x - hit.x) + (p.z - hit.z) * (p.z - hit.z);
      if (sq < bestSq) {
        bestSq = sq;
        best = (child.userData.handleId as string) ?? null;
      }
    }
    return best;
  };

  const floorPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    toNdc(clientX, clientY);
    raycaster.setFromCamera(ndc, out.camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return null;
    return { x: hit.x, y: -hit.z };
  };

  // WHETHER CAMERA INPUT IS SUPPRESSED RIGHT NOW, which is a DIFFERENT QUESTION from which view is on
  // screen - and keeping them in one variable was a real bug rather than a tidy-up.
  //
  // `setControlsEnabled(false)` silences the camera for the length of a Bezier drag, and the drag
  // re-renders on every pointer move: `updateCall` -> `applyDisplay` -> `setView2D`, which used to
  // write `controls.enabled = !on` and therefore RE-ENABLED the camera in the middle of the gesture.
  // The panel's own pointermove handler runs first, so by the time OrbitControls' handler ran on the
  // same event the controls were live again and the board panned under the point being dragged - which
  // is exactly what a caller reported.
  //
  // So the two facts are kept apart: `inputSuppressed` is the caller's, and the view decides only
  // WHICH control set it applies to.
  let inputSuppressed = false;
  const applyControlsEnabled = () => {
    controls.enabled = !inputSuppressed && out.camera === camera;
    controls2d.enabled = !inputSuppressed && out.camera === camera2d;
  };

  const out: Stage = {
    scene,
    camera,
    camera2d,
    renderer,
    resize,
    setViewInsets,
    setView2D: (on: boolean) => {
      out.camera = on ? camera2d : camera;
      // THE FRUSTUM IS RE-APPLIED ON EVERY SWITCH, not only on a resize: entering the flat view after
      // any layout change would otherwise draw one frame (or more) of floor at the wrong aspect.
      resize();
      // ...and the flat camera is squared on the way IN as well as once a frame below, so the first frame
      // of the flat view is overhead even if something tilted it while it was off screen.
      if (on) squareCamera2D();
      // ...and this respects a suppression in force, so a view switch mid-drag cannot start a pan.
      applyControlsEnabled();
    },
    setControlsEnabled: (on: boolean) => {
      inputSuppressed = !on;
      applyControlsEnabled();
    },
    setGridMode: (mode: GridMode) => {
      // EXACTLY ONE, EVERY TIME. Setting both from one boolean is what stops the two grids ever being drawn
      // over each other, or the floor being left with no reference at all - there is no state in which the
      // caller has to turn one off before the other on.
      const radial = mode === 'radial';
      squareGroup.visible = !radial;
      radialGroup.visible = radial;
    },
    updateControls: () => {
      // BOTH are advanced, not just the one on screen: with damping an orbit keeps gliding for a
      // moment after the input stops, and a camera frozen mid-glide looks like a jump on the switch
      // back. The cost is a few trigonometric operations per frame.
      controls.update();
      controls2d.update();
      clampPan2D();
      // THE LAST WORD ON THE FLAT CAMERA EACH FRAME. Everything above may move it; this decides where it
      // is, and it is the reason the reported tilt cannot recur whatever the input does.
      if (out.camera === camera2d) squareCamera2D();
    },
    setGizmo,
    pickHandle,
    floorPoint,
  };
  return out;
}

// ------------------------------------------------------------------ avatar

// Couple color scheme: 1=red, 2=yellow, 3=green, 4=blue.
const COUPLE_COLORS = [0xe33b3b, 0xe8c23a, 0x3fbf6f, 0x3b7ee8];
const PHANTOM_COLOR = 0x9aa6b2;

export const coupleColor = (couple: number): number =>
  couple > 0 ? COUPLE_COLORS[(couple - 1) % COUPLE_COLORS.length] : PHANTOM_COLOR;

/** Build a flat top-down dancer marker, drawn to the SAME body the contact rules use.
 *
 * A boy is a RECTANGLE, a girl an ELLIPSE, both `DANCER_WIDTH` wide ACROSS the facing and
 * `DANCER_DEPTH` deep ALONG it, with a white semicircle "nose" marking the front. Those are the engine's
 * own body constants (`sequencer/bodies.ts`) rather than literals, so the picture cannot drift away from
 * the collision model: a dancer drawn 0.95 by 0.45 IS the body the contact rules measure, and changing
 * the model changes what you see.
 *
 * WHY THE SHAPE MATTERS AT ALL, and it is the reason this is not decoration. `bodyGap` measures two
 * ORIENTED boxes, so how a dancer is turned decides whether it touches its neighbour. A round marker
 * cannot show that — it has no facing to speak of, and the whole point of the recent change is that
 * a body is wider than it is deep. The ellipse and the rectangle both read their size from their
 * orientation, so a contact the engine reports is one you can now see on the floor.
 *
 * Lies on the floor (xz); local +x is forward, so set group.rotation.y = heading.
 *
 * THE AXES ARE NOT THE OBVIOUS ONES. Under the 2D->3D mapping (z = -y with rotation.y = +heading) the
 * marker's local +x IS the dancer's forward, but local +y is NOT the 2D lateral axis — the yaw carries a
 * 90 degree chirality twist. The shapes here are symmetric about the forward axis, so the silhouette is
 * unaffected either way; what matters is that forward is local +x, and both shape and nose use it.
 */
export function buildFlatMarker(
  gender: string,
  couple: number,
  body: { width: number; depth: number } = { width: DANCER_WIDTH, depth: DANCER_DEPTH },
): THREE.Group {
  const g = new THREE.Group();
  const color = coupleColor(couple);
  const baseMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  // Local x is FORWARD (depth), local y is ACROSS (width).
  const fwd = body.depth / 2;
  const side = body.width / 2;

  const shape = new THREE.Shape();
  if (gender === 'girl') {
    // An ellipse: `absellipse` sweeps the full turn, so this is one closed curve.
    shape.absellipse(0, 0, fwd, side, 0, Math.PI * 2, false);
  } else {
    // A rectangle, four corners. `fwd` is the half-depth on x, `side` the half-width on y.
    shape.moveTo(-fwd, -side);
    shape.lineTo(fwd, -side);
    shape.lineTo(fwd, side);
    shape.lineTo(-fwd, side);
    shape.closePath();
  }
  const base = new THREE.Mesh(new THREE.ShapeGeometry(shape), baseMat);
  base.rotation.x = -Math.PI / 2; // lay flat on the floor
  base.position.y = 0.01;
  g.add(base);

  // Facing nose: filled semicircle, dome toward local +x (forward), flat edge across the width so it
  // sits inside the body like a face rather than spilling out of the sides.
  const noseHalf = side * 0.4;
  const nose = new THREE.Shape();
  nose.absarc(0, 0, noseHalf, -Math.PI / 2, Math.PI / 2, false);
  nose.lineTo(0, 0);
  nose.closePath();
  const noseMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(nose),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  );
  noseMesh.rotation.x = -Math.PI / 2;
  noseMesh.position.y = 0.02;
  g.add(noseMesh);

  // Outline so markers read against the floor. TRAVERSED from the shape's own curves rather than
  // `EdgesGeometry`, which finds edges between faces — a smooth outline (the ellipse, and now the
  // circle the girl used to be) has none and would draw nothing at all.
  const pts = shape
    .getPoints(64)
    .map((p) => new THREE.Vector3(p.x, p.y, 0));
  if (pts.length > 1) {
    pts.push(pts[0].clone());
  }
  const outline = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }),
  );
  outline.rotation.x = -Math.PI / 2;
  outline.position.y = 0.03;
  g.add(outline);
  return g;
}

// A lowercase role letter appended to the couple number so a dancer's couple
// reads as e.g. "1h" (head) or "2s" (side). Heads are couples 1 & 3, sides are
// couples 2 & 4; the pattern repeats for larger sets (odd couple = head, even
// couple = side).
export function coupleTag(couple: number): string {
  return String(couple) + (couple % 2 === 1 ? 'h' : 's');
}

// A small floating label showing a dancer's couple number + role letter (e.g.
// "1h" for a head couple, "2s" for a side couple) so you can verify which
// colour maps to which couple and whether it's a head or a side.
function makeNumberLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.font = 'bold 46px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4;
  ctx.strokeText(text, 32, 32);
  ctx.fillText(text, 32, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
  sprite.scale.set(0.55, 0.55, 0.55);
  sprite.position.set(0, 2.0, 0);
  return sprite;
}

// Driving input for the walk cycle. `phase` is the fraction of a two-step cycle
// in [0,1) (one full step = half a cycle = one beat, so a step lands every
// beat). The caller advances `phase` with the call/sequence beat, so the legs
// step in time with the beats. The avatar itself decides whether to actually
// step (stride) by measuring its own translation — a dancer that has stopped
// moving settles to rest instead of walking in place.
export interface WalkCycle {
  phase: number;
}

interface AvatarParts {
  group: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  lUp: THREE.Mesh;
  lFo: THREE.Mesh;
  rUp: THREE.Mesh;
  rFo: THREE.Mesh;
}

// Low-poly wireframe humanoid. Polygon counts are kept low so the wireframe
// reads as a clean cage rather than a tangle of lines. The yellow nose cone
// stays solid (not wireframe) so orientation remains readable. Women get a
// narrower torso and a flared skirt so gender is readable by SHAPE, not just
// color.
function buildAvatar(color: number, phantom: boolean, gender: DancerSpec['gender']): AvatarParts {
  const group = new THREE.Group();
  const woman = gender === 'girl';
  const mat = new THREE.MeshStandardMaterial({
    color,
    wireframe: true,
    roughness: 0.8,
    transparent: phantom,
    opacity: phantom ? 0.45 : 1,
  });
  const darker = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.72),
    wireframe: true,
    roughness: 0.8,
    transparent: phantom,
    opacity: phantom ? 0.45 : 1,
  });

  // Torso (low-poly capsule along +Y); women are narrower.
  const torsoRadius = woman ? 0.17 : 0.22;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(torsoRadius, 0.72, 3, 8), mat);
  torso.position.y = 0.86;
  group.add(torso);

  // Head (low-poly sphere); women slightly smaller.
  const head = new THREE.Mesh(new THREE.SphereGeometry(woman ? 0.14 : 0.16, 10, 8), mat);
  head.position.y = woman ? 1.42 : 1.44;
  group.add(head);

  // Women wear a flared skirt from the waist down over the upper legs.
  if (woman) {
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.62, 8, 1, true), mat);
    skirt.position.y = 0.45;
    group.add(skirt);
  }

  // Legs: each hangs from a hip pivot so it can swing forward/back (rotate
  // around the dancer's local z-axis) as the walk cycle advances.
  const legGeo = new THREE.CapsuleGeometry(0.07, 0.5, 3, 7);
  const leftLegPivot = new THREE.Group();
  const rightLegPivot = new THREE.Group();
  for (const [pivot, sx] of [
    [leftLegPivot, -0.09],
    [rightLegPivot, 0.09],
  ] as const) {
    pivot.position.set(sx, 0.57, 0); // hip joint
    const leg = new THREE.Mesh(legGeo, darker);
    leg.position.y = -0.32; // leg centre below the hip
    pivot.add(leg);
    group.add(pivot);
  }

  // Arms: each is a 2-segment capsule chain (upper, forearm). Segments are
  // unit-length capsules along +Z, positioned/oriented by IK each frame.
  const makeSeg = () => {
    const geo = new THREE.CapsuleGeometry(0.055, 1, 3, 7);
    geo.rotateX(Math.PI / 2); // length axis -> +Z
    return new THREE.Mesh(geo, mat);
  };
  const lUp = makeSeg();
  const lFo = makeSeg();
  const rUp = makeSeg();
  const rFo = makeSeg();
  group.add(lUp, lFo, rUp, rFo);

  // Forward-facing indicator ("nose"): makes orientation visible. Points +X.
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.4 }),
  );
  nose.rotation.z = -Math.PI / 2; // cone default +Y -> point +X
  nose.position.set(0.22, 1.02, 0);
  group.add(nose);

  return { group, torso, head, leftLegPivot, rightLegPivot, lUp, lFo, rUp, rFo };
}

function orientSeg(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  const len = a.distanceTo(b);
  if (len < 1e-4) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  const dir = b.clone().sub(a).normalize();
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  mesh.scale.set(1, 1, len);
}

// 2-bone IK: shoulder -> elbow -> hand, with a small lateral bend.
function placeArm(
  upper: THREE.Mesh,
  fore: THREE.Mesh,
  shoulder: THREE.Vector3,
  hand: THREE.Vector3,
): void {
  const dir = hand.clone().sub(shoulder);
  const len = dir.length();
  const upperLen = 0.34;
  const total = 0.68;
  if (len >= total || len < 1e-3) {
    // Reached or point blank: straight arm, slight downward sag when idle.
    const reach = Math.min(len || 0.4, total);
    const e = shoulder.clone().add(dir.clone().normalize().multiplyScalar(Math.min(reach, upperLen)));
    orientSeg(upper, shoulder, e);
    orientSeg(fore, e, hand);
    return;
  }
  const n = dir.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(n, up).normalize().multiplyScalar(0.1);
  const elbow = shoulder.clone().add(n.clone().multiplyScalar(upperLen)).add(side);
  orientSeg(upper, shoulder, elbow);
  orientSeg(fore, elbow, hand);
}

export class DancerView {
  group: THREE.Group;
  private parts: AvatarParts;
  trail: THREE.Line;
  /** The couple colour `trail` was built with, so `setTrailWarning` can take a warning back off. */
  private readonly trailColor: number;
  /**
   * THE SELECTION RING: a circle on the floor around a dancer an edit applies to.
   *
   * A SCENE CHILD RATHER THAN A CHILD OF `group`, and that is not tidiness. `group` carries the avatar's 2x
   * scale, its heading rotation and its vertical bob, so a ring parented to it would be scaled, lifted off
   * the floor with every stride, and would ALSO disappear in the 2D view - where the avatar group is hidden
   * and the flat marker is drawn instead. As a child of the scene it is placed by `update`, which runs for
   * both representations, and it stays flat on the floor.
   */
  selectionRing: THREE.Line;
  /** The chosen move's own stretch of `trail`, drawn on top of it in a contrasting colour.
   *  Invisible until a caller highlights a range - see `setTrailHighlight`. */
  trailHighlight: THREE.Line;
  /** HEADING TICKS along a stretch: the FACING shape, which the path cannot show. A move has two
   *  curves - where the dancer goes, and how they turn - and they live in different spaces, so the
   *  second one has to be drawn as something other than the path. */
  facingTicks: THREE.LineSegments;

  // Walk-cycle state: we measure the dancer's own translation frame-to-frame so
  // the stride eases to rest the moment the dancer stops moving.
  private lastX = 0;
  private lastY = 0;
  private lastT = -1;
  private stride = 0;
  private static readonly SPEED_THRESH = 0.05; // units/sec -> treat as moving
  private static readonly EASE = 0.25; // stride smoothing toward the target

  /** `couple` is a DISPLAY colour index (1..4) - callers may pass a display-only
   * value for a dancer whose real home couple is unknown. `ghost` marks a
   * non-physical reference dancer: it is the ONLY thing that makes an avatar
   * translucent, so a real dancer whose identity is merely unknown is not drawn
   * as a phantom. */
  constructor(spec: DancerSpec, couple = 0, ghost = false) {
    const color = coupleColor(couple);
    const parts = buildAvatar(color, ghost, spec.gender);
    this.group = parts.group;
    this.parts = parts;
    // Double the avatar size (geometry is authored in ~1.6-unit tall units).
    // Feet stay at the group origin, and the arm IK is done in local space, so
    // a uniform group scale keeps the whole figure — and its reach — consistent.
    this.group.scale.set(2, 2, 2);
    if (couple > 0) this.group.add(makeNumberLabel(coupleTag(couple)));

    this.trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    this.trail.frustumCulled = false;
    // KEPT, because a mismatch warning REPLACES the colour and has to be able to put it back: the couple
    // colour is the track's identity - whose it is - and the warning is a statement about it.
    this.trailColor = color;

    // THE SELECTION RING. A closed circle in the XZ plane, at floor level; `update` positions it.
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a) * SELECTION_RING_R, 0, -Math.sin(a) * SELECTION_RING_R));
    }
    this.selectionRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: SELECTION_RING_COLOR, transparent: true, opacity: 0.9 }),
    );
    this.selectionRing.frustumCulled = false;
    this.selectionRing.visible = false;

    // The move highlight. Amber (the same colour the hand holds use) rather than the couple
    // colour, so "the move you have selected" is never confused with "whose track this is".
    // It sits 0.03 ABOVE the trail: the two are the same curve, and co-planar lines z-fight.
    this.trailHighlight = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 1 }),
    );
    this.trailHighlight.frustumCulled = false;
    this.trailHighlight.visible = false;

    // Heading ticks are CYAN, against the move highlight's amber: the two selections show two
    // different shapes over the same beats, and they must never be mistaken for one another.
    this.facingTicks = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 1 }),
    );
    this.facingTicks.frustumCulled = false;
    this.facingTicks.visible = false;
  }

  update(pose: Pose, arms: { left?: THREE.Vector3; right?: THREE.Vector3 }, walk?: WalkCycle): void {
    // Detect actual motion since the last frame. When paused or when the dancer
    // stands in place during a call, speed is ~0 and the stride eases to rest.
    const now = performance.now();
    let target = 0;
    if (walk && this.lastT >= 0) {
      const dt = Math.max(now - this.lastT, 1e-3) / 1000; // seconds
      const speed = Math.hypot(pose.x - this.lastX, pose.y - this.lastY) / dt;
      target = speed > DancerView.SPEED_THRESH ? 1 : 0;
    }
    this.lastX = pose.x;
    this.lastY = pose.y;
    this.lastT = now;
    this.stride += (target - this.stride) * DancerView.EASE;
    const s = this.stride;

    // Map 2D grid (x, y) -> 3D (x, 0, -y). The sign of the z component MUST
    // match rotation.y = +heading or the body rotates opposite to its orbit
    // (a chirality mismatch). See README note on the 2D->3D mapping.
    // A small vertical bob accompanies the stride when walking.
    const phase = walk ? walk.phase : 0;
    const swing = Math.sin(phase * Math.PI * 2) * s;
    const bob = Math.abs(Math.cos(phase * Math.PI * 2)) * s * 0.05;
    this.group.position.set(pose.x, bob, -pose.y);
    this.group.rotation.y = pose.heading;
    // THE RING FOLLOWS THE SPOT, NOT THE BODY: no bob and no heading - it is a circle, so a rotation would be
    // invisible anyway, and a ring that lifted with the stride would read as part of the avatar rather than
    // as a mark on the floor.
    this.selectionRing.position.set(pose.x, 0.02, -pose.y);
    // Ensure matrixWorld reflects this frame's pose BEFORE we invert it for arm
    // IK. Otherwise the first frame reads a stale (identity) matrixWorld and
    // every arm is placed at world coordinates in local space — a flash frame
    // where all dancers appear to reach across the whole set.
    this.group.updateMatrixWorld(true);

    // Walk cycle: swing the legs opposite each other, pivoting at the hips.
    this.parts.leftLegPivot.rotation.z = swing * 0.6;
    this.parts.rightLegPivot.rotation.z = -swing * 0.6;

    // Convert world arm targets into the avatar's local frame.
    const inv = this.group.matrixWorld.clone().invert();
    const toLocal = (v: THREE.Vector3) => v.clone().applyMatrix4(inv);

    const shoulderY = 1.18;
    const halfW = 0.24;
    // Chirality note: under the 2D->3D mapping (z = -y, rotation.y = +heading),
    // the avatar's local +z points to the dancer's 2D RIGHT. So the solver's
    // "left" hand belongs on local -z and "right" on local +z; swap here or the
    // hands render crossed to the opposite sides.
    const lShoulder = new THREE.Vector3(0, shoulderY, -halfW);
    const rShoulder = new THREE.Vector3(0, shoulderY, halfW);

    // Idle arms swing opposite their same-side leg (left arm back when the left
    // leg is forward). Holding arms are driven solely by IK, no swing.
    const armSwing = swing * 0.2;

    if (arms.left) {
      placeArm(this.parts.lUp, this.parts.lFo, lShoulder, toLocal(arms.left));
    } else {
      const idle = toLocal(this.group.position.clone().add(new THREE.Vector3(0, 0, -halfW)));
      idle.y = 0.35;
      idle.x -= armSwing;
      placeArm(this.parts.lUp, this.parts.lFo, lShoulder, idle);
    }
    if (arms.right) {
      placeArm(this.parts.rUp, this.parts.rFo, rShoulder, toLocal(arms.right));
    } else {
      const idle = toLocal(this.group.position.clone().add(new THREE.Vector3(0, 0, halfW)));
      idle.y = 0.35;
      idle.x += armSwing;
      placeArm(this.parts.rUp, this.parts.rFo, rShoulder, idle);
    }

    // Orientation is driven entirely by the data heading via the group
    // rotation. No additive torso twist (it compounded with the group rotation
    // and made wheels look like a spin); keep only a subtle forward lean.
    this.parts.torso.rotation.y = 0;
    this.parts.torso.rotation.x = 0.05;
    this.parts.head.rotation.y = 0;
  }

  setTrail(points: { x: number; y: number }[]): void {
    const arr = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      arr[i * 3] = points[i].x;
      arr[i * 3 + 1] = 0.03;
      arr[i * 3 + 2] = -points[i].y; // match position mapping (z = -y)
    }
    this.trail.geometry.dispose();
    this.trail.geometry = new THREE.BufferGeometry();
    this.trail.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  }

  /**
   * Mark the stretch of the track that ONE MOVE is responsible for, or pass null to clear it.
   *
   * Setting a highlight also DIMS the trail underneath it, which is the point, and the two levels
   * are named here rather than buried: the dancer's WHOLE track stays visible at a LOW brightness,
   * and the move being edited is the only thing at full brightness. The track is context; the move
   * is the subject.
   *
   * The geometry is rebuilt in place (a handful of points, once per selection change, never per
   * frame).
   */
  setTrailHighlight(points: { x: number; y: number }[] | null): void {
    const on = points != null && points.length > 1;
    (this.trail.material as THREE.LineBasicMaterial).opacity = on ? TRAIL_DIM_OPACITY : TRAIL_OPACITY;
    this.trailHighlight.visible = on;
    this.trailHighlight.geometry.dispose();
    if (!on) {
      this.trailHighlight.geometry = new THREE.BufferGeometry();
      return;
    }
    const arr = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      arr[i * 3] = points[i].x;
      arr[i * 3 + 1] = 0.06; // above the trail, so the two do not z-fight
      arr[i * 3 + 2] = -points[i].y;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.trailHighlight.geometry = geo;
  }

  /**
   * MARK THIS TRACK AS ONE WHOSE CURVE DOES NOT MATCH THE REST OF THE SELECTION.
   *
   * The couple colour says WHOSE track it is; the mismatch colour says THIS is the one that disagrees, so a
   * caller who has selected four dancers can see which path is the odd one out instead of being told a
   * number. It is drawn at FULL opacity, which is the other half of the message - the normal trail sits at
   * 0.55 and a dimmed one at 0.45.
   *
   * TAKING IT OFF RESTORES BOTH the colour and the brightness, so the warning is a state and not a smudge:
   * `applyDisplay` re-applies it on every rebuild, and a selection that comes to agree clears every warned
   * track.
   */
  setTrailWarning(on: boolean): void {
    const mat = this.trail.material as THREE.LineBasicMaterial;
    mat.color.setHex(on ? TRAIL_MISMATCH_COLOR : this.trailColor);
    mat.opacity = on ? 1 : TRAIL_OPACITY;
  }

  /** Show or hide the selection ring. See the field for why it is a scene child. */
  setSelected(on: boolean): void {
    this.selectionRing.visible = on;
  }

  /**
   * Draw the FACING along a stretch as short ticks, one per sample, pointing where the dancer faces
   * at that instant - or pass null to clear them.
   *
   * This is the second of a move's two shapes. The translation curve is a path on the floor; the
   * rotation curve is a direction, and no amount of path drawing shows it, so the honest way to draw
   * it is a row of headings. A tick at every sample, deliberately: a smooth facing curve and a
   * jittery one look different here, which is the point of being able to select it at all.
   */
  setFacingTicks(poses: { x: number; y: number; heading: number }[] | null, len = 0.5): void {
    const on = poses != null && poses.length > 1;
    this.facingTicks.visible = on;
    this.facingTicks.geometry.dispose();
    const verts: number[] = [];
    if (on) {
      for (const p of poses) {
        // Board (x, y) -> 3D (x, 0, -y), and a heading of 0 faces +x, 90 faces +y (3D -z).
        verts.push(p.x, 0.08, -p.y, p.x + Math.cos(p.heading) * len, 0.08, -(p.y + Math.sin(p.heading) * len));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.facingTicks.geometry = geo;
  }
}

/**
 * The two brightnesses of a trail, and they have to be far enough apart to read as two things.
 *
 * `TRAIL_DIM_OPACITY` is the chosen dancer's WHOLE track while one move is highlighted - the
 * context, and `TRAIL_OPACITY` is a track with nothing selected. The dim value started at 0.22 and
 * was REPORTED INVISIBLE: a saturated couple colour at 22% over a floor whose grid lines are drawn
 * at 95% in `0x2f9e77` loses to the grid, so the only thing visible was the amber highlight and the
 * "full track at low brightness" contract was not met. It is now just under the unselected level,
 * which reads as a faint line rather than a ghost. Anything below about a third does not survive
 * this floor; if a future change to the floor or the grid makes the track compete again, move this
 * number rather than the grid.
 */
const TRAIL_OPACITY = 0.55;
const TRAIL_DIM_OPACITY = 0.45;

/**
 * THE MISMATCH COLOUR: a track whose curve does NOT match the rest of the selection.
 *
 * WHY A COLOUR AND NOT ANOTHER LINE. When four dancers are selected and one of them disagrees, the panel's
 * number says HOW FAR apart the two paths are but not WHICH track the caller is looking at - and the board is
 * where that answer is. Painting the track that disagrees is the whole statement, and it needs no extra
 * geometry on the floor.
 *
 * IT IS A VIVID RED DRAWN AT FULL OPACITY, and the second half is what makes it work: the couple colours are
 * the same four hues the trails already use (0xe33b3b red among them), so the HUE alone could be mistaken for
 * couple 1. Full opacity against the normal 0.55 and the dimmed 0.45 cannot: a warned track is the brightest
 * thing on the floor, which is what "this is the one that is wrong" has to look like.
 */
const TRAIL_MISMATCH_COLOR = 0xff3b3b;

/**
 * THE SELECTION RING, and its size.
 *
 * A circle on the FLOOR around a dancer an edit applies to - and it is on the floor, and drawn for BOTH
 * representations, because the two ways a dancer is drawn have nothing in common to outline: a 3D avatar is a
 * figure and a 2D marker is a flat shape, and their only shared property is where they are standing. A ring
 * around the spot is that property.
 *
 * 0.7 UNITS OF RADIUS, which is a plain reading of the floor: couples stand 2 units apart, so a ring of 1.4
 * across leaves room between neighbours and still encloses a body (0.95 by 0.45, `DANCER_WIDTH`/`DANCER_DEPTH`).
 */
const SELECTION_RING_R = 0.7;
const SELECTION_RING_COLOR = 0xffffff;

export function buildHandConnectors(scene: THREE.Scene): {
  group: THREE.Group;
  set(lines: [number, number][], pts: Pose[]): void;
} {
  const group = new THREE.Group();
  scene.add(group);
  const material = new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 });
  const set = (lines: [number, number][], pts: Pose[]) => {
    group.clear();
    for (const [i, j] of lines) {
      const a = new THREE.Vector3(pts[i].x, 1.0, -pts[i].y);
      const b = new THREE.Vector3(pts[j].x, 1.0, -pts[j].y);
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const mesh = new THREE.Line(geo, material);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  };
  return { group, set };
}
