// Probe: the FRAMING of the board - the aspect the flat view is framed at, where the panels leave the board,
// and the limits of the flat view's pan and zoom.
//
// Five claims are checked here, and the first is a bug reproduction rather than a proof:
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
//   4. THE FRAME IS THE VISIBLE BOX, NOT THE CANVAS. The panels are floating overlays, so the floor is
//      centred in the canvas MINUS what they cover, on BOTH cameras - the 3D one through a lens shift
//      that moves the projection rather than the camera. The negative control is the old framing, which
//      centres the board on the screen and leaves half a panel of it underneath.
//   5. THE FLOOR IS FITTED TO THAT BOX, so the panel can decide the SCALE, and the 3D camera stands back
//      far enough to hold the floor on a canvas that is taller than it is wide - which the old fixed
//      9.84 did not (it cropped 0.8 units off each side).
//
// The arithmetic below is a COPY of `visibleBox`, `frame`, `frame3D` and `panLimit2D` in `poc/src/scene.ts`,
// because that module builds a WebGLRenderer and cannot be imported outside a browser. What is measured with
// real three.js is what those numbers DO to a real camera - that the pixel scale is equal on both axes, and
// where a world point lands on screen.
//
// Run: node tools/view2d-probe.mjs   (from poc/)
import * as THREE from 'three';
import fs from 'node:fs';

const FLOOR_HALF = 5;
/** `scene.ts`: the margin left around the grid inside the frame. */
const FRAME_PAD = 0.6;
const FRAME_HALF = FLOOR_HALF + FRAME_PAD;
/** `scene.ts`: how much of the canvas the floating panels may take before the frame stops shrinking. */
const INSET_MAX_FRACTION = 0.45;
/** `scene.ts`: the canvas minus the panels floating over it - the board the caller can actually see. */
const visibleBox = (w, h, insets = {}) => {
  const l = Math.min(Math.max(0, insets.left ?? 0), w * INSET_MAX_FRACTION);
  const r = Math.min(Math.max(0, insets.right ?? 0), w * INSET_MAX_FRACTION);
  const t = Math.min(Math.max(0, insets.top ?? 0), h * INSET_MAX_FRACTION);
  const b = Math.min(Math.max(0, insets.bottom ?? 0), h * INSET_MAX_FRACTION);
  return { l, r, t, b, w: Math.max(1, w - l - r), h: Math.max(1, h - t - b) };
};
/**
 * `scene.ts`: WHERE THE FLOOR GOES - the world half-extents of the frame and the frustum centre that puts the
 * floor in the middle of the VISIBLE box rather than the middle of the canvas. The floor is FITTED, not assumed:
 * a square floor cannot fill a non-square canvas on both axes, so it is fitted to the tighter one.
 */
const frame = (w, h, insets = {}) => {
  const v = visibleBox(w, h, insets);
  const halfV = Math.max((FRAME_HALF * h) / v.h, (FRAME_HALF * h) / v.w);
  const halfW = halfV * (w / h);
  const dx = (v.l - v.r) / 2;
  const dy = (v.t - v.b) / 2;
  return { halfW, halfV, cX: (-dx * 2 * halfW) / w, cY: (dy * 2 * halfV) / h, v };
};

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

/**
 * The flat camera as the OLD `createStage` built it: a square frustum of whatever the floor needed on a square
 * canvas. Section 1 reproduces the fault that came from it, so the construction it mirrors has to stay the
 * square one - the current stage frames from the canvas straight away, which is the fix being measured.
 */
const makeCamera2d = () => {
  const f0 = FRAME_HALF;
  const cam = new THREE.OrthographicCamera(-f0, f0, f0, -f0, 0.1, 200);
  cam.position.set(0, 40, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
};

/** `resize` in scene.ts: frame the flat camera for this canvas and the panels floating over it. */
const frameCam = (cam, w, h, insets = {}) => {
  const f = frame(w, h, insets);
  cam.left = f.cX - f.halfW;
  cam.right = f.cX + f.halfW;
  cam.top = f.cY + f.halfV;
  cam.bottom = f.cY - f.halfV;
  cam.updateProjectionMatrix();
};

/** `panLimit2D` in scene.ts - per axis, so the floor's edge reaches the screen edge either way. */
const panLimit2D = (cam) => {
  const zoom = cam.zoom;
  const halfW = (cam.right - cam.left) / (2 * zoom);
  const halfV = (cam.top - cam.bottom) / (2 * zoom);
  const cX = (cam.left + cam.right) / 2;
  const cZ = -(cam.top + cam.bottom) / 2;
  return { x: FLOOR_HALF + halfW - cX, z: FLOOR_HALF + halfV - cZ };
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
  frameCam(cam, W, H);
  const px2 = pxPerUnit(cam, W, H, 'x');
  const py2 = pxPerUnit(cam, W, H, 'y');
  check(Math.abs(px2 - py2) < 1e-9,
    `after framing for the canvas it is square: ${px2.toFixed(6)} vs ${py2.toFixed(6)} px/unit`);
  const fitted = frame(W, H).halfV;
  check(Math.abs(py2 - H / (2 * fitted)) < 1e-9,
    `and the scale is the one asked for (${py2.toFixed(6)} = ${H}/${2 * fitted})`);
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
    frameCam(cam, w, h);
    const ratio = pxPerUnit(cam, w, h, 'x') / pxPerUnit(cam, w, h, 'y');
    worst = Math.max(worst, Math.abs(ratio - 1));
    if (Math.abs(ratio - 1) > 1e-12) console.log(`    ${label}: ratio ${ratio}`);
  }
  check(worst < 1e-12, `x and y scales are equal at all ${shapes.length} shapes (worst deviation ${worst.toExponential(2)})`);

  const cam = makeCamera2d();
  cam.zoom = 2.5;
  cam.updateProjectionMatrix();
  frameCam(cam, 1000, 1000);
  check(cam.zoom === 2.5, `framing for a new canvas leaves camera.zoom alone (${cam.zoom})`);
  // Pixels per unit is `height * zoom / (2 * halfH)`, where `halfH` is the FRAMED half-height this canvas
  // gets (the floor fitted to its tighter axis), so the expected value after the
  // resize is computed rather than remembered: comparing against the OLD canvas's scale would be
  // measuring the canvas change and calling it a zoom change.
  const after = pxPerUnit(cam, 1000, 1000, 'y');
  const expect = (1000 * 2.5) / (2 * frame(1000, 1000).halfV);
  check(Math.abs(after - expect) < 1e-9,
    `and the scale is exactly height*zoom/(2*half) (${after.toFixed(4)} = ${expect.toFixed(4)}), so the zoom survived the resize`);
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
      frameCam(cam, w, h);
      cam.zoom = zoom;
      cam.updateProjectionMatrix();
      const limit = panLimit2D(cam);
      // Pan fully in +x and fully in +y (board), the two directions the clamp acts on.
      for (const [dx, dy] of [[limit.x, 0], [-limit.x, 0], [0, limit.z], [0, -limit.z]]) {
        const camAt = makeCamera2d();
        frameCam(camAt, w, h);
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
  frameCam(cam, 1600, 900);
  const limit = panLimit2D(cam);
  const corner = ndcOf(cam, FLOOR_HALF, FLOOR_HALF);
  check(limit.x > FLOOR_HALF && limit.z > FLOOR_HALF && Math.abs(corner.x) < 1 && Math.abs(corner.y) < 1,
    `at zoom 1 the limit (${limit.x.toFixed(2)} across, ${limit.z.toFixed(2)} up) still lets a floor corner be brought on screen (corner at ${corner.x.toFixed(3)}, ${corner.y.toFixed(3)})`);

  // The zoom bounds are finite on purpose: an orthographic frustum of zero width has no inverse, so
  // an unbounded dolly ends in a blank screen rather than a very close look.
  for (const zoom of [0.2, 20]) {
    const c = makeCamera2d();
    frameCam(c, 1600, 900);
    c.zoom = zoom;
    c.updateProjectionMatrix();
    const e = c.projectionMatrix.elements;
    check(Number.isFinite(e[0]) && e[0] > 0 && Number.isFinite(e[5]) && e[5] > 0,
      `at zoom ${zoom} the projection matrix is still invertible (p00 ${e[0].toFixed(4)}, p11 ${e[5].toFixed(4)})`);
  }
  {
    const wide = makeCamera2d();
    frameCam(wide, 1600, 900);
    wide.zoom = 0.2;
    wide.updateProjectionMatrix();
    const far = pxPerUnit(wide, 1600, 900, 'y');
    const tight = makeCamera2d();
    frameCam(tight, 1600, 900);
    tight.zoom = 20;
    tight.updateProjectionMatrix();
    const near = pxPerUnit(tight, 1600, 900, 'y');
    const tall = frame(1600, 900).halfV;
    console.log(`    zoom range: ${((2 * tall) / 0.2).toFixed(0)} world units tall at 0.2 (floor is ${2 * FLOOR_HALF}), ${((2 * tall) / 20).toFixed(2)} at 20`);
    check(near / far > 90, `the zoom range spans ${(near / far).toFixed(0)}x on screen`);
  }
}

// ---------------------------------------------------------------- 4. the board is framed in the VISIBLE box
//
// THE PANELS ARE DOM OVERLAYS, so the canvas is the whole window and the BOARD is only the part of it nothing
// covers. Reported from use: "the board seems to be centralised to the screen, but it hasn't taken into account
// that the left hand dialog changes the visible board to the right hand side."
//
// Two claims, both about the same rule (`scene.ts`: `visibleBox` -> `frame`):
//
//   (a) with a panel down the left, the floor is CENTRED IN WHAT IS LEFT and lies ENTIRELY inside it - and the
//       negative control shows the old framing putting the floor's centre at the canvas centre, half a panel to
//       the left of the visible one, which is the report;
//   (b) the fit is against the visible box, so the panel can be what decides the SCALE on a canvas where the
//       width is the tighter axis - which a rule based on the canvas aspect cannot do.
//
// AND THE SAME RULE DRIVES THE 3D VIEW, through a LENS SHIFT (`camera.setViewOffset`) rather than by moving the
// camera: the 3D view is the one on screen at startup, so a fix that only reached the flat view would not be
// the fix that was asked for. It is measured here with a real PerspectiveCamera, because the whole point of
// using a view offset is what three.js does with one.
console.log('\n== 4. the panels are subtracted from the frame, on BOTH cameras ==');
{
  /** Where a board point lands, in CSS pixels, on a `w` x `h` canvas. */
  const screenPx = (cam, w, h, x, y) => {
    const p = new THREE.Vector3(x, 0, -y).project(cam);
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
  };
  const W = 1600;
  const H = 900;
  const PANEL = 420;
  const LOOK = 8; // the panel's gap, as `main.ts` applies it
  const insets = { left: PANEL + LOOK };

  // (a) centred in the visible box, and inside it.
  const cam = makeCamera2d();
  frameCam(cam, W, H, insets);
  const v = visibleBox(W, H, insets);
  const visCentre = v.l + v.w / 2;
  const centre = screenPx(cam, W, H, 0, 0);
  console.log(`    a ${PANEL}px panel leaves ${v.w}px of board: the floor's centre lands at ${centre.x.toFixed(1)}px, the middle of that box is ${visCentre.toFixed(1)}px`);
  check(Math.abs(centre.x - visCentre) < 1e-9,
    `the floor's centre is at the centre of the VISIBLE box (${centre.x.toFixed(1)} = ${visCentre.toFixed(1)}), not the canvas's (${W / 2})`);
  check(Math.abs(centre.y - H / 2) < 1e-9, 'and vertically in the middle, there being no top or bottom panel');
  const corners = [[-FLOOR_HALF, -FLOOR_HALF], [FLOOR_HALF, -FLOOR_HALF], [-FLOOR_HALF, FLOOR_HALF], [FLOOR_HALF, FLOOR_HALF]]
    .map(([x, y]) => screenPx(cam, W, H, x, y));
  const inside = corners.every((c) => c.x >= v.l - 1e-9 && c.x <= W - v.r + 1e-9 && c.y >= v.t - 1e-9 && c.y <= H - v.b + 1e-9);
  const [minX, maxX] = [Math.min(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.x))];
  check(inside,
    `and the whole floor is inside it, clear of the panel (it spans ${minX.toFixed(1)}..${maxX.toFixed(1)}px of the ${v.l}..${W - v.r}px box)`);

  // THE NEGATIVE CONTROL: the old rule, which framed against the canvas alone.
  const camOld = makeCamera2d();
  frameCam(camOld, W, H);
  const oldCentre = screenPx(camOld, W, H, 0, 0);
  console.log(`    framing against the canvas instead puts it at ${oldCentre.x.toFixed(1)}px - ${(visCentre - oldCentre.x).toFixed(1)}px left of the visible middle`);
  check(Math.abs(oldCentre.x - W / 2) < 1e-9 && visCentre - oldCentre.x > 100,
    `which is the reported fault: the board is centred on the screen while ${(visCentre - oldCentre.x).toFixed(0)}px of its middle is under the panel`);

  // The panel may not eat the frame: past the cap there is no visible region left to centre in, and an
  // orthographic frustum of zero width has no inverse.
  const huge = visibleBox(W, H, { left: 4000 });
  const camHuge = makeCamera2d();
  frameCam(camHuge, W, H, { left: 4000 });
  const eHuge = camHuge.projectionMatrix.elements;
  check(huge.w > 1 && huge.l === W * INSET_MAX_FRACTION && Number.isFinite(eHuge[0]) && eHuge[0] > 0,
    `a panel wider than the cap (${huge.l.toFixed(0)}px of ${W}) still leaves a ${huge.w.toFixed(0)}px box and an invertible frustum`);

  // (b) the panel can be the thing that decides the scale.
  const narrow = [900, 1000];
  const withPanel = frame(narrow[0], narrow[1], { left: 320 });
  const withoutPanel = frame(narrow[0], narrow[1]);
  const scaleWith = narrow[1] / (2 * withPanel.halfV);
  const scaleWithout = narrow[1] / (2 * withoutPanel.halfV);
  console.log(`    on ${narrow[0]}x${narrow[1]}: ${scaleWith.toFixed(1)} px/unit with a 320px panel, ${scaleWithout.toFixed(1)} without`);
  check(scaleWith < scaleWithout * 0.9,
    `the panel decides the SCALE where the width is the tighter axis (${scaleWith.toFixed(1)} vs ${scaleWithout.toFixed(1)} px/unit), so the floor is fitted to what is left`);

  // (c) the 3D view, through the lens shift.
  const VIEW_DIR = new THREE.Vector3(0, 9.84, 0.65).normalize();
  const TAN25 = Math.tan((50 / 2) * (Math.PI / 180));
  const camera3 = (w, h, dx, dy) => {
    const c = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    c.up.set(0, 0, -1);
    const fullH = h + 2 * Math.abs(dy);
    c.position.copy(VIEW_DIR).multiplyScalar((FRAME_HALF * fullH) / (TAN25 * Math.min(w, h)));
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld(true);
    if (dx !== 0 || dy !== 0) {
      const fullW = w + 2 * Math.abs(dx);
      c.setViewOffset(fullW, fullH, dx > 0 ? 0 : 2 * Math.abs(dx), dy > 0 ? 0 : 2 * Math.abs(dy), w, h);
    }
    c.updateMatrixWorld(true);
    return c;
  };
  const dx = (v.l - v.r) / 2;
  const c3 = camera3(W, H, dx, 0);
  const c3Centre = screenPx(c3, W, H, 0, 0);
  const c3No = camera3(W, H, 0, 0);
  const c3NoCentre = screenPx(c3No, W, H, 0, 0);
  console.log(`    the 3D view: ${c3Centre.x.toFixed(1)}px with the lens shift against ${c3NoCentre.x.toFixed(1)}px without, and the board should sit at ${visCentre.toFixed(1)}px`);
  check(Math.abs(c3Centre.x - visCentre) < 1e-6,
    `the 3D view puts the floor's centre at the visible middle too (${c3Centre.x.toFixed(1)} = ${visCentre.toFixed(1)})`);
  check(Math.abs(c3NoCentre.x - W / 2) < 1e-6 && Math.abs(c3Centre.x - c3NoCentre.x - dx) < 1e-6,
    `the lens shift moves the picture by exactly the offset (${(c3Centre.x - c3NoCentre.x).toFixed(1)}px = ${dx.toFixed(1)}px), and moves the camera not at all`);
  check(Math.abs(screenPx(c3, W, H, 0, 0).y - H / 2) < 1e-6, 'and a horizontal panel shift leaves the vertical centring alone');
  // The 3D distance is fitted to the tighter axis too, which the old fixed 9.84 was not: on a portrait canvas
  // a distance chosen for the height cropped the floor by 0.8 units off each side.
  const pW = 700;
  const pH = 1000;
  const c3Portrait = camera3(pW, pH, 0, 0);
  const pc = [[-FLOOR_HALF, -FLOOR_HALF], [FLOOR_HALF, -FLOOR_HALF], [-FLOOR_HALF, FLOOR_HALF], [FLOOR_HALF, FLOOR_HALF]]
    .map(([x, y]) => screenPx(c3Portrait, pW, pH, x, y));
  const fits = pc.every((c) => c.x > 0 && c.x < pW && c.y > 0 && c.y < pH);
  check(fits,
    `and on a portrait canvas the 3D camera stands back far enough to hold the floor (x ${Math.min(...pc.map((c) => c.x)).toFixed(0)}..${Math.max(...pc.map((c) => c.x)).toFixed(0)} of ${pW}px)`);
}

// ---------------------------------------------------------------- 5. the controls, driven for real
//
// The configuration is asserted against three.js's OWN OrbitControls, with a fake canvas standing in
// for the DOM element, because every claim below is about what that class does with these settings
// rather than about arithmetic of ours: that rotation is inert in the flat view, that a LEFT drag
// pans (the default mapping is rotate, which `enableRotate = false` would otherwise leave dead), that
// a dolly changes the ZOOM and not the camera's position - which is why the zoom survives the resize
// - and that the zoom bound is enforced.
console.log('\n== 5. the flat view\'s controls, driven through real OrbitControls ==');
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
  frameCam(cam, W, H);
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
  const expectedZ = (50 * (cam.top - cam.bottom)) / cam.zoom / H;
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
console.log('\n== 6. a drag keeps the camera still, and the negative control shows why ==');
{
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const W = 1600;
  const H = 900;
  const el = new FakeCanvas(W, H);
  const cam = makeCamera2d();
  frameCam(cam, W, H);
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
  frameCam(cam2, W, H);
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

// ---------------------------------------------------------------------------------------------
// 7. THE FLAT CAMERA CANNOT BE TILTED, whoever is driving it
// ---------------------------------------------------------------------------------------------
//
// Reported: "in 2d mode, the drag board must not rotate on the x and y, only drag, keeping the board
// perpendicular to the camera. Currently the drag rotates the dance floor."
//
// The controls in `scene.ts` are built with `enableRotate = false` and a pan mapping on every button, so
// the CONFIGURATION says this cannot happen. Rather than re-read the configuration, the flat camera is now
// SQUARED once per frame (`squareCamera2D`: put it directly over the target, board +y up the screen), so
// "2D" is a property of the camera instead of a hope about the input. This section measures both halves:
//
//   (a) what a ROTATE gesture does to a camera when it is allowed - the symptom, reproduced with real
//       three.js, because a fix whose fault cannot be shown is a fix nobody can check;
//   (b) that the squaring rule takes the tilt back to exactly zero, every frame of the drag;
//   (c) and that WITHOUT it the tilt persists, which is the negative control that stops this being
//       decoration.
console.log('\n== 7. the flat camera is squared whatever the controls do ==');
{
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const W = 1600;
  const H = 900;
  const el = new FakeCanvas(W, H);
  const mouse = (x, y, extra = {}) => ({
    pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, deltaMode: 0,
    clientX: x, clientY: y, ctrlKey: false, metaKey: false, shiftKey: false,
    preventDefault() {}, ...extra,
  });
  /** How far the camera is off straight-down, in degrees. 0 = perpendicular to the board. */
  const tilt = (cam, target) => {
    const d = cam.position.clone().sub(target).normalize();
    return (Math.acos(Math.min(1, Math.abs(d.y))) * 180) / Math.PI;
  };
  /** `squareCamera2D` in scene.ts: the flat camera's one invariant, applied after the controls. */
  const square = (cam, target) => {
    cam.up.set(0, 0, -1);
    cam.position.set(target.x, 40, target.z);
    cam.lookAt(target);
    cam.updateMatrixWorld();
  };
  /** A left drag, with the controls left able to ROTATE - which is the fault being reproduced. */
  const rotateDrag = (cam, withSquare) => {
    const c = new OrbitControls(cam, el);
    c.target.set(0, 0, 0);
    c.enableRotate = true;
    c.enableDamping = false;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.enabled = true;
    c.update();
    const target = c.target;
    const run = () => (withSquare ? square(cam, target) : undefined);
    run();
    el.dispatch('pointerdown', mouse(800, 450));
    for (const [x, y] of [[820, 430], [860, 400], [900, 370]]) {
      el.dispatch('pointermove', mouse(x, y));
      c.update();
      run();
    }
    el.dispatch('pointerup', mouse(900, 370));
    c.update();
    run();
    return tilt(cam, target);
  };
  const tilted = rotateDrag(makeCamera2d(), false);
  console.log(`    a rotate gesture tilts the camera ${tilted.toFixed(2)}deg off straight-down`);
  check(tilted > 5, 'the fault is real when rotation is allowed: the board tips away from the camera, which is what was reported');

  const squared = rotateDrag(makeCamera2d(), true);
  console.log(`    with the frame's squaring applied: ${squared.toExponential(1)}deg`);
  check(squared === 0, 'and with the flat view\'s invariant applied after the controls, the camera is EXACTLY straight down again');
}

// And the wiring, so the rule cannot be dropped from the frame loop without this failing.
{
  const sceneSrc = fs.readFileSync(new URL('../src/scene.ts', import.meta.url), 'utf8');
  check(/const squareCamera2D = \(\) => \{/.test(sceneSrc), 'the stage has ONE place that decides where the flat camera is');
  check(/updateControls:[\s\S]*?clampPan2D\(\);[\s\S]*?if \(out\.camera === camera2d\) squareCamera2D\(\);/.test(sceneSrc),
    'and it runs after the controls have been updated, so it is the last word on the camera each frame');
  check(/if \(on\) squareCamera2D\(\);/.test(sceneSrc), 'and on the way into the flat view, so its first frame is overhead too');
  check(!/camera2d\.position\.[xz] \+=/.test(sceneSrc), 'with the pan clamp moving the TARGET rather than the camera: only `squareCamera2D` writes the camera\'s position');
  check(/controls2d\.touches = \{ ONE: THREE\.TOUCH\.PAN, TWO: THREE\.TOUCH\.DOLLY_PAN \}/.test(sceneSrc),
    'and a one-finger touch pans too, because the default is ROTATE - a dead gesture where rotation is off, which is the "pan does nothing in 2D" report over again');
}

// And the WIRING of the panel inset, end to end: the scene.ts half has to be told, and it has to be told by a
// MEASUREMENT of the real element - a constant here would be right in one HUD mode and wrong in the next, which
// is the same failure as the fixed floor size. Both files are only readable as text, and every claim above is
// about arithmetic that a resize could stop calling.
{
  const sceneSrc = fs.readFileSync(new URL('../src/scene.ts', import.meta.url), 'utf8');
  const mainSrc = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check(/const resize = \(\) => \{[\s\S]*?frame3D\(w, h, f\);/.test(sceneSrc),
    'one resize re-frames BOTH cameras from the same `frame(w, h)`, so the two views cannot disagree about where the board is');
  check(/camera\.setViewOffset\(fullW, fullH, dx > 0 \? 0 : 2 \* Math\.abs\(dx\), dy > 0 \? 0 : 2 \* Math\.abs\(dy\), w, h\)/.test(sceneSrc),
    'and the 3D view is moved by a LENS SHIFT, so a resize can re-apply the inset without throwing away the caller\'s camera');
  check(/controls\.addEventListener\('start', \(\) => \{ userFramed3D = true; \}\)/.test(sceneSrc),
    'with the distance left to the caller once they have touched the view, so a resize cannot reset an orbit');
  check(/setViewInsets,/.test(sceneSrc), 'the stage exposes the inset it frames around');
  check(/stage\.setViewInsets\(/.test(mainSrc) && /hudEl\?\.getBoundingClientRect\(\)/.test(mainSrc),
    'and `main.ts` MEASURES the panel rather than assuming its width, because the HUD is content-sized');
  check(/new ResizeObserver\(applyViewInsets\)\.observe\(hudEl\)/.test(mainSrc),
    're-measuring when the panel changes shape on its own, which it does when the mode adds rows to it');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
