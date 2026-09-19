// Three.js render adapter. This knows nothing about the engine's data model —
// it consumes Pose[] and grip targets and draws 3D avatars.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { DancerSpec, Pose } from 'dancing-squared-engine';

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
  resize(): void;
  /** Turn pointer input to the ACTIVE camera's controls on or off. The Bezier drag uses this so the
   *  board cannot rotate or pan underneath a point being dragged - and it goes through here rather
   *  than through `controls` because there are TWO control sets now, and reaching for the 3D one while
   *  the 2D view is up is how the 2D camera came to be left out of the pan and zoom. */
  setControlsEnabled(on: boolean): void;
  /** Advance both control sets (damping). Call once per frame. */
  updateControls(): void;
  /** Show the Bezier control-point handles for one move, or clear them with null.
   *  A handle is the classic vector-editor gadget: a line from an anchor out to the control point,
   *  with a grabbable dot at the end. */
  setHandles(handles: HandleSpec[] | null): void;
  /** The handle id under a canvas point, or null. */
  pickHandle(clientX: number, clientY: number): string | null;
  /** The BOARD (x, y) under a canvas point, on the floor plane - the inverse of the drawing
   *  mapping - or null when the ray misses the plane. */
  floorPoint(clientX: number, clientY: number): { x: number; y: number } | null;
}

/**
 * The two handle colours, so the palette lives in one place and the panel can name them.
 *
 * THEY ARE DIFFERENT COLOURS BECAUSE THEY ARE DIFFERENT SPACES. Magenta points are the TRAVEL curve's
 * control points: real places on the floor, where the dancer goes. Cyan points are the FACING curve's:
 * a heading profile's coefficients, drawn in the dancer's frame at the move's start, where distance
 * means nothing and DIRECTION is the heading. A single colour would invite reading the second set as
 * positions on the board.
 */
export const HANDLE_COLOR = { travel: 0xff6fd0, facing: 0x3fd0ff } as const;

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

/** The main X (east–west) and Y (north–south) reference axes with arrowheads and
 * angle labels at 90° increments. Heading 0° faces +x (east), 90° faces +y
 * (north, which maps to 3D −z), so the labels give the compass a dancer heading
 * is measured against. Returns a group already positioned at the floor level. */
function buildFloorAxes(): THREE.Group {
  const g = new THREE.Group();
  const Y0 = 0.02; // sit just above the grid/floor
  const inner = 0.9; // start radius (keep clear of the origin clutter)
  const outer = 8.9; // arrow tip radius
  const labelR = 10.3; // label placement radius (beyond the arrow tips)
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
    const lab = makeTextSprite(labelText, color === X_COL ? '#ffe2a8' : '#bfe6ff');
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
  // The flat view's frame, in the two numbers the whole thing is built from: the floor is 20 units
  // across, so its half-width is 10, and the orthographic camera shows 11 units above and below the
  // centre at zoom 1. `resize` and `panLimit2D` both derive from these rather than repeating them.
  const FLOOR_HALF = 10;
  const ORTHO_HALF_HEIGHT = 11;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);

  const camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
  // Top-down view so the compass maps cleanly to the screen: north (2D +y -> 3D
  // -z) at the top, south (nearest the viewer) at the bottom, east right, west
  // left. Screen-up = -z is chosen so couple colours (red at the bottom, then
  // yellow right, green top, blue left) line up with where you see them.
  camera.up.set(0, 0, -1);
  camera.position.set(0, 15, 1);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.update();

  // Fixed top-down orthographic camera for the flat 2D view (north up = -z).
  const camera2d = new THREE.OrthographicCamera(-ORTHO_HALF_HEIGHT, ORTHO_HALF_HEIGHT, ORTHO_HALF_HEIGHT, -ORTHO_HALF_HEIGHT, 0.1, 200);
  camera2d.position.set(0, 40, 0);
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
  // ZOOM IS BOUNDED, and not for taste: an orthographic frustum of zero width has no inverse, so an
  // unbounded dolly ends in a blank screen - and zooming out forever loses the board just as
  // thoroughly. 0.2 shows 5x the floor, 20 is close enough to place a control point by eye.
  controls2d.minZoom = 0.2;
  controls2d.maxZoom = 20;
  controls2d.enabled = false; // the 3D view is the one on screen at startup
  controls2d.update();

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
  const panLimit2D = () => {
    const halfH = ORTHO_HALF_HEIGHT / camera2d.zoom;
    // The aspect as FRAMED, read back off the camera rather than the canvas: `resize` is the one place
    // that sets these, so they are the authority on what is on screen.
    const aspect = (camera2d.right - camera2d.left) / (2 * ORTHO_HALF_HEIGHT);
    return { x: FLOOR_HALF + halfH * aspect, z: FLOOR_HALF + halfH };
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
  const grid = new THREE.GridHelper(20, 20, 0x2f9e77, 0x3a4a5c);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.95;
  scene.add(grid);
  // A coarser overlay every 2 units (matching the usual 2-unit dancer spacing).
  const coarse = new THREE.GridHelper(20, 10, 0x8fd6b5, 0x5b6b7d);
  (coarse.material as THREE.Material).transparent = true;
  (coarse.material as THREE.Material).opacity = 0.35;
  scene.add(coarse);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x0e141b, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.001;
  floor.receiveShadow = true;
  scene.add(floor);

  // Main X (east–west) and Y (north–south) axes with 90°-increment angle labels.
  // Heading 0° faces +x (east), 90° faces +y (north, 3D -z), so the labels mark
  // the compass a dancer heading is measured against.
  scene.add(buildFloorAxes());

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
   * a resize is not a reason to throw them away.
   */
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return; // a hidden canvas has no aspect; keep the last good one
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const aspect = Math.max(0.1, w / h);
    camera2d.left = -ORTHO_HALF_HEIGHT * aspect;
    camera2d.right = ORTHO_HALF_HEIGHT * aspect;
    camera2d.top = ORTHO_HALF_HEIGHT;
    camera2d.bottom = -ORTHO_HALF_HEIGHT;
    camera2d.updateProjectionMatrix();
  };
  resize();

  // The window listener in `main.ts` only fires when the WINDOW changes size; the canvas box can
  // change without that (a device-pixel-ratio change, fullscreen, browser zoom), and the two cameras
  // would then be sizing themselves to a frame that no longer exists. The observer fires once on
  // observe too, so this is also the second line of defence for the startup sizing above.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => resize()).observe(canvas);
  }

  /** Keep the flat view's centre within reach of the floor - see `panLimit2D`. */
  const clampPan2D = () => {
    const limit = panLimit2D();
    const tx = Math.max(-limit.x, Math.min(limit.x, controls2d.target.x));
    const tz = Math.max(-limit.z, Math.min(limit.z, controls2d.target.z));
    if (tx === controls2d.target.x && tz === controls2d.target.z) return;
    // The camera carries the same offset as the target, so moving one by a delta moves the other by
    // the same delta and the view direction is untouched: this is a clamp on where you are looking,
    // not a tilt.
    camera2d.position.x += tx - controls2d.target.x;
    camera2d.position.z += tz - controls2d.target.z;
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

  const setHandles = (handles: HandleSpec[] | null) => {
    handleGroup.clear();
    if (!handles) return;
    // ONE MATERIAL PER COLOUR, cached for the call: a move shows both curves at once only while the
    // panel is switching between them, but the two colours have to coexist whenever they do.
    const lineMats = new Map<number, THREE.LineBasicMaterial>();
    const dotMats = new Map<number, THREE.MeshBasicMaterial>();
    const lineMatFor = (c: number) => {
      let m = lineMats.get(c);
      if (!m) { m = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.85 }); lineMats.set(c, m); }
      return m;
    };
    const dotMatFor = (c: number) => {
      let m = dotMats.get(c);
      if (!m) { m = new THREE.MeshBasicMaterial({ color: c }); dotMats.set(c, m); }
      return m;
    };
    for (const h of handles) {
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

  const out: Stage = {
    scene,
    camera,
    camera2d,
    renderer,
    resize,
    setView2D: (on: boolean) => {
      out.camera = on ? camera2d : camera;
      // THE FRUSTUM IS RE-APPLIED ON EVERY SWITCH, not only on a resize: entering the flat view after
      // any layout change would otherwise draw one frame (or more) of floor at the wrong aspect.
      resize();
      controls.enabled = !on;
      controls2d.enabled = on;
    },
    setControlsEnabled: (on: boolean) => {
      // Only the ACTIVE view's controls, or a handle drag in 2D would leave the 3D camera live.
      controls.enabled = on && out.camera === camera;
      controls2d.enabled = on && out.camera === camera2d;
    },
    updateControls: () => {
      // BOTH are advanced, not just the one on screen: with damping an orbit keeps gliding for a
      // moment after the input stops, and a camera frozen mid-glide looks like a jump on the switch
      // back. The cost is a few trigonometric operations per frame.
      controls.update();
      controls2d.update();
      clampPan2D();
    },
    setHandles,
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

/** Build a flat top-down dancer marker: a SQUARE for a boy, a CIRCLE for a girl,
 * in the couple colour, with a small white semicircle "nose" on the forward side.
 * Lies on the floor (xz); local +x is forward, so set group.rotation.y = heading. */
export function buildFlatMarker(
  gender: string,
  couple: number,
  r = 0.75,
): THREE.Group {
  const g = new THREE.Group();
  const color = coupleColor(couple);
  const baseMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const shape = new THREE.Shape();
  if (gender === 'girl') {
    shape.absarc(0, 0, r, 0, Math.PI * 2, false);
  } else {
    const h = r * 0.85;
    shape.moveTo(-h, -h);
    shape.lineTo(h, -h);
    shape.lineTo(h, h);
    shape.lineTo(-h, h);
    shape.closePath();
  }
  const base = new THREE.Mesh(new THREE.ShapeGeometry(shape), baseMat);
  base.rotation.x = -Math.PI / 2; // lay flat on the floor
  base.position.y = 0.01;
  g.add(base);
  // Facing nose: filled semicircle, dome toward local +x (forward).
  const nr = r * 0.42;
  const nose = new THREE.Shape();
  nose.absarc(0, 0, nr, -Math.PI / 2, Math.PI / 2, false);
  nose.lineTo(0, 0);
  nose.closePath();
  const noseMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(nose),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  );
  noseMesh.rotation.x = -Math.PI / 2;
  noseMesh.position.y = 0.02;
  g.add(noseMesh);
  // Outline so markers read against the floor.
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.ShapeGeometry(shape)),
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

// Assign couple numbers 1..N by pairing each boy with his nearest girl, then
// numbering the pairs by angular position around the set centre (couple 1 = the
// pair nearest the "north" side). Dancers with no opposite-gender partner (e.g.
// phantoms) get couple 0 (gray).
export function assignCouples(dancers: DancerSpec[]): number[] {
  const n = dancers.length;
  const couple = new Array<number>(n).fill(0);
  // A mirrored (half-set) dancer's base (x,y) is the authored half; its real
  // full-set position is rotated 180° about the origin, so use that for pairing
  // and compass numbering.
  const pos = (d: DancerSpec) => (d.mirror ? { x: -d.x, y: -d.y } : { x: d.x, y: d.y });
  const boys = dancers.map((d, i) => ({ i, d, p: pos(d) })).filter((x) => x.d.gender === 'boy');
  const girls = dancers.map((d, i) => ({ i, d, p: pos(d) })).filter((x) => x.d.gender === 'girl');
  if (boys.length === 0 || girls.length === 0) return couple;

  const usedGirls = new Set<number>();
  const pairs: { boy: number; girl: number }[] = [];
  for (const b of boys) {
    let best = -1;
    let bestD = Infinity;
    for (const g of girls) {
      if (usedGirls.has(g.i)) continue;
      const d = Math.hypot(b.p.x - g.p.x, b.p.y - g.p.y);
      if (d < bestD) {
        bestD = d;
        best = g.i;
      }
    }
    if (best >= 0) {
      usedGirls.add(best);
      pairs.push({ boy: b.i, girl: best });
    }
  }

  const cx = dancers.reduce((s, d) => s + pos(d).x, 0) / n;
  const cy = dancers.reduce((s, d) => s + pos(d).y, 0) / n;
  // Number couples anti-clockwise, couple 1 nearest the viewer (the "bottom"):
  // bottom=1, right=2, top=3, left=4. Ascending 2D angle from the -y (south)
  // side gives couple 1 at the bottom, then east -> north -> west.
  pairs.sort((a, b) => Math.atan2(pos(dancers[a.boy]).y - cy, pos(dancers[a.boy]).x - cx) - Math.atan2(pos(dancers[b.boy]).y - cy, pos(dancers[b.boy]).x - cx));
  pairs.forEach((p, k) => {
    couple[p.boy] = k + 1;
    couple[p.girl] = k + 1;
  });
  return couple;
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
