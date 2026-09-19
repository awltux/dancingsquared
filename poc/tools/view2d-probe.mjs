// Probe: the FLAT (2D) view - the aspect it is framed with, and the limits of its pan and zoom.
//
// Three claims are checked here, and the first is a bug reproduction rather than a proof:
//
//   1. THE SQUARE FRUSTUM THE CONSTRUCTOR GIVES IS NOT SQUARE ON SCREEN. `new OrthographicCamera(-11,
//      11, 11, -11)` frames a SQUARE of world however wide the canvas is, so on a 16:9 window the
//      floor grid is drawn 16/9 wider than it is tall. That is what a caller saw when switching to 2D,
//      and it snapped to square on the first window resize because that is the first time the frustum
//      was recomputed from the canvas aspect. `createStage` now sizes both cameras before returning.
//   2. THE RESIZED FRUSTUM IS SQUARE at every aspect, and a resize does not disturb the zoom the
//      caller set - which is what makes "resize on every view switch" a safe thing to do.
//   3. THE PAN LIMIT IS DERIVED FROM THE ZOOM, so it lands exactly where the floor's own edge reaches
//      the edge of the screen: any part of the floor can be centred at any zoom, and none of it can be
//      pushed off. Asserted numerically at five zooms and four aspects.
//
// The frustum arithmetic below is a COPY of `resize` and `panLimit2D` in `poc/src/scene.ts`, because
// that module builds a WebGLRenderer and cannot be imported outside a browser. What is measured with
// real three.js is what those numbers DO to a real OrthographicCamera - that the pixel scale is equal
// on both axes, and where a world point lands on screen.
//
// Run: node tools/view2d-probe.mjs   (from poc/)
import * as THREE from 'three';

const FLOOR_HALF = 10;
const ORTHO_HALF_HEIGHT = 11;

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/** The flat camera exactly as `createStage` builds it, before any resize. */
const makeCamera2d = () => {
  const cam = new THREE.OrthographicCamera(-ORTHO_HALF_HEIGHT, ORTHO_HALF_HEIGHT, ORTHO_HALF_HEIGHT, -ORTHO_HALF_HEIGHT, 0.1, 200);
  cam.position.set(0, 40, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
};

/** `resize` in scene.ts: frame the flat camera for this canvas. */
const frame = (cam, w, h) => {
  const aspect = Math.max(0.1, w / h);
  cam.left = -ORTHO_HALF_HEIGHT * aspect;
  cam.right = ORTHO_HALF_HEIGHT * aspect;
  cam.top = ORTHO_HALF_HEIGHT;
  cam.bottom = -ORTHO_HALF_HEIGHT;
  cam.updateProjectionMatrix();
};

/** `panLimit2D` in scene.ts - per axis, so the floor's edge reaches the screen edge either way. */
const panLimit2D = (cam) => {
  const halfH = ORTHO_HALF_HEIGHT / cam.zoom;
  const aspect = (cam.right - cam.left) / (2 * ORTHO_HALF_HEIGHT);
  return { x: FLOOR_HALF + halfH * aspect, z: FLOOR_HALF + halfH };
};

/** Screen pixels per world unit of the BOARD along each axis. Board (x, y) is 3D (x, 0, -y). */
const pxPerUnit = (cam, w, h, axis) => {
  const a = new THREE.Vector3(0, 0, 0).project(cam);
  const step = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
  const b = step.clone().project(cam);
  return Math.hypot((b.x - a.x) * (w / 2), (b.y - a.y) * (h / 2));
};

/** Where a board point lands in normalised device coordinates (each in [-1, 1] is on screen). */
const ndcOf = (cam, x, y) => new THREE.Vector3(x, 0, -y).project(cam);

// ---------------------------------------------------------------- 1. the bug, reproduced
console.log('== 1. the square frustum is not square on a widescreen canvas ==');
{
  const W = 1600;
  const H = 900;
  const cam = makeCamera2d();
  const px = pxPerUnit(cam, W, H, 'x');
  const py = pxPerUnit(cam, W, H, 'y');
  console.log(`    as constructed, on ${W}x${H}: ${px.toFixed(4)} px/unit across, ${py.toFixed(4)} px/unit up`);
  console.log(`    ratio ${(px / py).toFixed(6)} against the canvas aspect ${(W / H).toFixed(6)}`);
  check(Math.abs(px / py - W / H) < 1e-9,
    `the construction-time frustum stretches the floor by exactly the canvas aspect (${(px / py).toFixed(4)}) - this is the "grid is not square" report`);
  frame(cam, W, H);
  const px2 = pxPerUnit(cam, W, H, 'x');
  const py2 = pxPerUnit(cam, W, H, 'y');
  check(Math.abs(px2 - py2) < 1e-9,
    `after framing for the canvas it is square: ${px2.toFixed(6)} vs ${py2.toFixed(6)} px/unit`);
  check(Math.abs(py2 - H / (2 * ORTHO_HALF_HEIGHT)) < 1e-9,
    `and the scale is the one asked for (${py2.toFixed(6)} = ${H}/${2 * ORTHO_HALF_HEIGHT})`);
}

// ---------------------------------------------------------------- 2. square at every aspect, zoom kept
console.log('\n== 2. square at every aspect, and a resize keeps the zoom ==');
{
  const shapes = [
    ['16:9', 1600, 900],
    ['4:3', 1200, 900],
    ['21:9 ultrawide', 2520, 1080],
    ['square', 1000, 1000],
    ['portrait 9:16', 900, 1600],
    ['short and wide', 2400, 500],
  ];
  let worst = 0;
  for (const [label, w, h] of shapes) {
    const cam = makeCamera2d();
    frame(cam, w, h);
    const ratio = pxPerUnit(cam, w, h, 'x') / pxPerUnit(cam, w, h, 'y');
    worst = Math.max(worst, Math.abs(ratio - 1));
    if (Math.abs(ratio - 1) > 1e-12) console.log(`    ${label}: ratio ${ratio}`);
  }
  check(worst < 1e-12, `x and y scales are equal at all ${shapes.length} shapes (worst deviation ${worst.toExponential(2)})`);

  const cam = makeCamera2d();
  cam.zoom = 2.5;
  cam.updateProjectionMatrix();
  frame(cam, 1000, 1000);
  check(cam.zoom === 2.5, `framing for a new canvas leaves camera.zoom alone (${cam.zoom})`);
  // Pixels per unit is `height * zoom / (2 * ORTHO_HALF_HEIGHT)`, so the expected value after the
  // resize is computed rather than remembered: comparing against the OLD canvas's scale would be
  // measuring the canvas change and calling it a zoom change.
  const after = pxPerUnit(cam, 1000, 1000, 'y');
  const expect = (1000 * 2.5) / (2 * ORTHO_HALF_HEIGHT);
  check(Math.abs(after - expect) < 1e-9,
    `and the scale is exactly height*zoom/22 (${after.toFixed(4)} = ${expect.toFixed(4)}), so the zoom survived the resize`);
}

// ---------------------------------------------------------------- 3. the pan clamp
console.log('\n== 3. the pan limit puts the floor\'s edge exactly at the screen edge ==');
{
  const zooms = [0.2, 0.5, 1, 3, 20];
  const shapes = [
    ['16:9', 1600, 900],
    ['4:3', 1200, 900],
    ['square', 1000, 1000],
    ['21:9', 2520, 1080],
  ];
  let worstEdge = 0;
  let minVisible = Infinity;
  for (const zoom of zooms) {
    for (const [label, w, h] of shapes) {
      const cam = makeCamera2d();
      frame(cam, w, h);
      cam.zoom = zoom;
      cam.updateProjectionMatrix();
      const limit = panLimit2D(cam);
      // Pan fully in +x and fully in +y (board), the two directions the clamp acts on.
      for (const [dx, dy] of [[limit.x, 0], [-limit.x, 0], [0, limit.z], [0, -limit.z]]) {
        const camAt = makeCamera2d();
        frame(camAt, w, h);
        camAt.zoom = zoom;
        camAt.position.x += dx;
        camAt.position.z += -dy; // board +y is 3D -z
        camAt.updateProjectionMatrix();
        camAt.updateMatrixWorld(true);
        // Where the floor's near edge lands: the edge the clamp was aimed at must be ON the screen.
        const edge = dx > 0 ? ndcOf(camAt, FLOOR_HALF, 0) : dx < 0 ? ndcOf(camAt, -FLOOR_HALF, 0) : ndcOf(camAt, 0, dy > 0 ? FLOOR_HALF : -FLOOR_HALF);
        const axisNdc = dx !== 0 ? edge.x : edge.y;
        worstEdge = Math.max(worstEdge, Math.abs(Math.abs(axisNdc) - 1));
        // And how much of the floor is still on screen, as a fraction of its own width/height.
        const corners = [[-FLOOR_HALF, -FLOOR_HALF], [FLOOR_HALF, -FLOOR_HALF], [-FLOOR_HALF, FLOOR_HALF], [FLOOR_HALF, FLOOR_HALF]]
          .map(([x, y]) => ndcOf(camAt, x, y));
        const xs = corners.map((p) => p.x);
        const ys = corners.map((p) => p.y);
        const visW = Math.max(0, Math.min(1, Math.max(...xs)) - Math.max(-1, Math.min(...xs)));
        const visH = Math.max(0, Math.min(1, Math.max(...ys)) - Math.max(-1, Math.min(...ys)));
        // At a clamp the floor is a thin strip on one axis; it must never be zero on BOTH.
        minVisible = Math.min(minVisible, Math.max(visW, visH));
      }
    }
  }
  console.log(`    zooms ${zooms.join(', ')} x ${shapes.length} canvas shapes = ${zooms.length * shapes.length * 4} clamped positions`);
  check(worstEdge < 1e-9,
    `at the clamp the floor's edge is exactly AT the viewport edge (worst gap ${worstEdge.toExponential(2)})`);
  check(minVisible > 0.05,
    `and a strip of the floor is always still on screen (smallest visible fraction ${(minVisible * 100).toFixed(1)}%)`);

  // The other half of the claim: the limit is not so tight that the board cannot be centred.
  const cam = makeCamera2d();
  frame(cam, 1600, 900);
  const limit = panLimit2D(cam);
  const corner = ndcOf(cam, FLOOR_HALF, FLOOR_HALF);
  check(limit.x > FLOOR_HALF && limit.z > FLOOR_HALF && Math.abs(corner.x) < 1 && Math.abs(corner.y) < 1,
    `at zoom 1 the limit (${limit.x.toFixed(2)} across, ${limit.z.toFixed(2)} up) still lets a floor corner be brought on screen (corner at ${corner.x.toFixed(3)}, ${corner.y.toFixed(3)})`);

  // The zoom bounds are finite on purpose: an orthographic frustum of zero width has no inverse, so
  // an unbounded dolly ends in a blank screen rather than a very close look.
  for (const zoom of [0.2, 20]) {
    const c = makeCamera2d();
    frame(c, 1600, 900);
    c.zoom = zoom;
    c.updateProjectionMatrix();
    const e = c.projectionMatrix.elements;
    check(Number.isFinite(e[0]) && e[0] > 0 && Number.isFinite(e[5]) && e[5] > 0,
      `at zoom ${zoom} the projection matrix is still invertible (p00 ${e[0].toFixed(4)}, p11 ${e[5].toFixed(4)})`);
  }
  {
    const wide = makeCamera2d();
    frame(wide, 1600, 900);
    wide.zoom = 0.2;
    wide.updateProjectionMatrix();
    const far = pxPerUnit(wide, 1600, 900, 'y');
    const tight = makeCamera2d();
    frame(tight, 1600, 900);
    tight.zoom = 20;
    tight.updateProjectionMatrix();
    const near = pxPerUnit(tight, 1600, 900, 'y');
    console.log(`    zoom range: ${(2 * ORTHO_HALF_HEIGHT / 0.2).toFixed(0)} world units tall at 0.2 (floor is ${2 * FLOOR_HALF}), ${(2 * ORTHO_HALF_HEIGHT / 20).toFixed(2)} at 20`);
    check(near / far > 90, `the zoom range spans ${(near / far).toFixed(0)}x on screen`);
  }
}

// ---------------------------------------------------------------- 4. the controls, driven for real
//
// The configuration is asserted against three.js's OWN OrbitControls, with a fake canvas standing in
// for the DOM element, because every claim below is about what that class does with these settings
// rather than about arithmetic of ours: that rotation is inert in the flat view, that a LEFT drag
// pans (the default mapping is rotate, which `enableRotate = false` would otherwise leave dead), that
// a dolly changes the ZOOM and not the camera's position - which is why the zoom survives the resize
// - and that the zoom bound is enforced.
console.log('\n== 4. the flat view\'s controls, driven through real OrbitControls ==');
class FakeCanvas {
  constructor(w, h) {
    this.clientWidth = w;
    this.clientHeight = h;
    this.style = {};
    this._l = new Map();
  }
  addEventListener(t, fn) {
    if (!this._l.has(t)) this._l.set(t, []);
    this._l.get(t).push(fn);
  }
  removeEventListener(t, fn) {
    const a = this._l.get(t);
    if (a) this._l.set(t, a.filter((f) => f !== fn));
  }
  getRootNode() { return { addEventListener() {}, removeEventListener() {} }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  dispatch(type, event) { for (const fn of [...(this._l.get(type) ?? [])]) fn(event); }
}

const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
{
  const W = 1600;
  const H = 900;
  const el = new FakeCanvas(W, H);
  const cam = makeCamera2d();
  frame(cam, W, H);
  const c = new OrbitControls(cam, el);
  c.target.set(0, 0, 0);
  c.enableRotate = false;
  c.enableDamping = true;
  c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  c.minZoom = 0.2;
  c.maxZoom = 20;
  c.enabled = true;
  c.update();

  const mouse = (x, y, extra = {}) => ({
    pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, deltaMode: 0,
    clientX: x, clientY: y, ctrlKey: false, metaKey: false, shiftKey: false,
    preventDefault() {}, ...extra,
  });
  // Damping spreads the motion over frames, so a gesture is settled the way the render loop would.
  const settle = (n = 400) => { for (let i = 0; i < n; i++) c.update(); };
  const rest = () => {
    const offset = cam.position.clone().sub(c.target);
    return { offset, y: cam.position.y, zoom: cam.zoom };
  };

  const before = rest();
  el.dispatch('pointerdown', mouse(800, 450));
  el.dispatch('pointermove', mouse(900, 500)); // 100 px right, 50 px down
  el.dispatch('pointerup', mouse(900, 500));
  settle();
  const afterPan = rest();
  console.log(`    a left drag of (100, 50) px moved the view centre to (${c.target.x.toFixed(4)}, ${c.target.z.toFixed(4)})`);
  check(Math.abs(c.target.x) > 0.5 && Math.abs(c.target.z) > 0.5,
    'a LEFT drag PANS the flat view (the 3D default would have rotated, and with rotation off, done nothing)');
  check(Math.abs(cam.position.y - 40) < 1e-9,
    `and the camera stays directly overhead at y = ${cam.position.y} - the flat view cannot be tilted`);
  check(Math.abs(afterPan.offset.y - 40) < 1e-9 && Math.abs(afterPan.offset.z - before.offset.z) < 1e-6,
    'the camera keeps the same offset from the view centre, so the pan is a pan and not a tilt');
  // The pan distance is the settings' own arithmetic: deltaPx * (top-bottom)/zoom/clientHeight.
  const expectedZ = (50 * (2 * ORTHO_HALF_HEIGHT)) / 1 / H;
  check(Math.abs(Math.abs(c.target.z) - expectedZ) < 1e-6,
    `the pan matches the orthographic pan scale (${Math.abs(c.target.z).toFixed(6)} = ${expectedZ.toFixed(6)} units for 50 px)`);

  const beforeZoom = rest();
  el.dispatch('wheel', mouse(800, 450, { wheel: true, deltaY: -100 }));
  settle(400);
  console.log(`    one wheel notch up: zoom ${beforeZoom.zoom} -> ${cam.zoom.toFixed(4)}`);
  check(cam.zoom > beforeZoom.zoom, 'a wheel dollies the flat view IN');
  check(Math.abs(cam.position.x - beforeZoom.offset.x - c.target.x) < 1e-6 && Math.abs(cam.position.y - 40) < 1e-9,
    'and a dolly changes the ZOOM only - the camera does not move, which is why a resize cannot disturb it');
  for (let i = 0; i < 100; i++) el.dispatch('wheel', mouse(800, 450, { deltaY: -100 }));
  settle(50);
  check(cam.zoom === 20, `zooming in is bounded at maxZoom (${cam.zoom})`);
  for (let i = 0; i < 400; i++) el.dispatch('wheel', mouse(800, 450, { deltaY: 100 }));
  settle(50);
  check(cam.zoom === 0.2, `and zooming out is bounded at minZoom (${cam.zoom}), so the board cannot be lost`);
  const e = cam.projectionMatrix.elements;
  check(Number.isFinite(e[0]) && e[0] > 0, `the projection matrix is still invertible at the far end (p00 ${e[0].toFixed(5)})`);
}

// ---------------------------------------------------------------- 5. input suppression vs the view
//
// THE REPORTED FAULT: dragging a Bezier control point also dragged the board. The cause was two facts
// sharing one variable. `setControlsEnabled(false)` silences the camera for the length of a drag, but
// the drag re-renders on every pointer move - `updateCall` -> `applyDisplay` -> `setView2D` - and
// `setView2D` wrote `controls.enabled = !on`, which RE-ENABLED the camera in the middle of the gesture.
// The panel's pointermove handler runs first, so by the time OrbitControls' handler ran on the same
// event the controls were live again and the view panned under the point being dragged.
//
// This drives three's own OrbitControls through a fake canvas to show both halves: the rule as it is
// now (a view switch honours a suppression in force) and the rule it replaced (a view switch re-enables,
// and the next pointer move pans) - because a check that cannot fail on the bug is decoration.
console.log('\n== 5. a drag keeps the camera still, and the negative control shows why ==');
{
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const W = 1600;
  const H = 900;
  const el = new FakeCanvas(W, H);
  const cam = makeCamera2d();
  frame(cam, W, H);
  const c = new OrbitControls(cam, el);
  c.target.set(0, 0, 0);
  c.enableRotate = false;
  c.enableDamping = true;
  c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  c.enabled = true;
  c.update();

  const mouse = (x, y, extra = {}) => ({
    pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, deltaMode: 0,
    clientX: x, clientY: y, ctrlKey: false, metaKey: false, shiftKey: false,
    preventDefault() {}, ...extra,
  });
  const settle = (n = 300) => { for (let i = 0; i < n; i++) {
    // The render loop, with whichever rule is being tested.
    c.update();
  } };
  /**
   * One drag of a Bezier handle, in the order the browser actually delivers it.
   *
   * THE ORDER IS THE WHOLE POINT: OrbitControls registers its pointerdown listener when the stage is
   * built, so on a handle grab ITS handler runs FIRST and starts a gesture, and only then does the
   * panel's handler silence the camera. Simulating the suppression before the pointerdown - the first
   * version of this did - lets OrbitControls decline the gesture entirely, and then nothing can pan
   * however the view switch behaves. That is why the negative control passed when it should have failed.
   */
  const dragHandle = (oldRule) => {
    const before = { x: c.target.x, z: c.target.z };
    c.enabled = true; // as the camera is when the pointer goes down
    el.dispatch('pointerdown', mouse(800, 450)); // OrbitControls starts a PAN
    c.enabled = false; // ...and the panel's own handler suppresses input for the drag
    for (const [x, y] of [[820, 470], [860, 500], [900, 530]]) {
      // The handle edit re-renders, which re-applies the view: `setView2D` on every pointer move.
      if (oldRule) c.enabled = true; // THE OLD RULE: setView2D wrote enabled = !on
      // ...and OrbitControls' handler runs on the SAME event, after the panel's.
      el.dispatch('pointermove', mouse(x, y));
      settle(20);
    }
    c.enabled = false;
    el.dispatch('pointerup', mouse(900, 530));
    settle();
    return Math.hypot(c.target.x - before.x, c.target.z - before.z);
  };

  const movedAsIs = dragHandle(false);
  console.log(`    with the fix (a view switch honours the suppression): the view moved ${movedAsIs.toFixed(4)} units`);
  check(movedAsIs < 1e-9, 'dragging a control point leaves the BOARD exactly where it was');

  // The negative control, on a fresh control set so the first drag cannot have left state behind.
  const cam2 = makeCamera2d();
  frame(cam2, W, H);
  const c2 = new OrbitControls(cam2, el);
  c2.target.set(0, 0, 0);
  c2.enableRotate = false;
  c2.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  c2.enabled = true;
  c2.update();
  {
    const before = { x: c2.target.x, z: c2.target.z };
    c2.enabled = true;
    el.dispatch('pointerdown', mouse(800, 450));
    c2.enabled = false;
    for (const [x, y] of [[820, 470], [860, 500], [900, 530]]) {
      c2.enabled = true; // the old rule, on every re-render
      el.dispatch('pointermove', mouse(x, y));
      for (let i = 0; i < 20; i++) c2.update();
    }
    c2.enabled = false;
    el.dispatch('pointerup', mouse(900, 530));
    for (let i = 0; i < 300; i++) c2.update();
    const moved = Math.hypot(c2.target.x - before.x, c2.target.z - before.z);
    console.log(`    with the OLD rule (a view switch re-enables): the view moved ${moved.toFixed(4)} units`);
    check(moved > 0.5, `and that is the reported fault - the board panned ${moved.toFixed(2)} units under the point being dragged`);
  }
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
