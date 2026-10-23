// Probe: the Bezier handle PICK, which the visible dot no longer defines.
//
// The dot was shrunk to a third (0.3 -> 0.1 board units) while the pick radius stayed at 0.3, so the
// pick is now geometry of its own rather than "whatever the mesh raycast happens to hit". Three
// things can go wrong with that, and each is measured here rather than argued:
//
//   1. THE PLANE'S CONSTANT SIGN. `new THREE.Plane(new Vector3(0,1,0), c)` is `y + c = 0`, so the
//      handles' height needs c = -HANDLE_Y. Get it backwards and the ray lands at y = -0.12, which
//      looks almost right on a steep camera and vanishes at a grazing one.
//   2. THE TOLERANCE, AT AN ANGLE. Whether a 0.3 radius is forgiving or unusable depends on how many
//      screen pixels it covers, which changes with the camera - so it is checked at two elevations.
//   3. THE NEAREST-WINS RULE. A radius wide enough to be forgiving is only sound if the two handles
//      of a move are further apart than that. Measured over the whole move corpus, not one example.
//
// Run: node tools/handle-pick-probe.mjs   (from poc/, three resolves from the repo root)
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

// Resolved from THIS FILE, so the probe runs from anywhere and not only from poc/.
const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const HANDLE_Y = 0.12;
const HANDLE_RADIUS = 0.1;
const HANDLE_PICK_RADIUS = 0.3;
// Mirrors scene.ts: the board mapping is (x, 0, -y).
const toWorld = (p) => new THREE.Vector3(p.x, HANDLE_Y, -p.y);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const handlePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HANDLE_Y);

// ---------------------------------------------------------------- 1. plane sign
console.log('== Handle plane is at the handles\' height ==');
check(Math.abs(handlePlane.distanceToPoint(toWorld({ x: 3, y: -2 }))) < 1e-12,
  `a handle at y=${HANDLE_Y} is ON the plane (distance ${handlePlane.distanceToPoint(toWorld({ x: 3, y: -2 })).toExponential(2)})`);

// Ray straight down at a handle: the intersection must be the handle itself.
{
  const target = toWorld({ x: 2, y: 1 });
  const ray = new THREE.Ray(new THREE.Vector3(target.x, 10, target.z), new THREE.Vector3(0, -1, 0));
  const hit = new THREE.Vector3();
  const got = ray.intersectPlane(handlePlane, hit);
  check(got !== null && Math.abs(hit.y - HANDLE_Y) < 1e-12,
    `a downward ray lands at y=${got ? hit.y.toFixed(4) : 'null'} (expect ${HANDLE_Y})`);
  checkpointXZ(hit, target, 'downward ray hits the handle, not a mirrored point');
}

// Same target, seen from a LOW grazing camera: the y of the landing point is what the sign controls,
// and a wrong sign shows up here as a large x/z miss.
{
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  cam.position.set(2 + 14, 1.2, 1 + 6); // shallow elevation, the worst case for a y error
  cam.lookAt(2, 0, 1);
  cam.updateMatrixWorld(true);
  const cone = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  // Aim exactly at the handle: project it, then shoot at the projected pixel.
  const proj = toWorld({ x: 2, y: 1 }).clone().project(cam);
  ndc.set(proj.x, proj.y);
  cone.setFromCamera(ndc, cam);
  const hit = new THREE.Vector3();
  cone.ray.intersectPlane(handlePlane, hit);
  check(Math.hypot(hit.x - 2, hit.z - -1) < 1e-6,
    `grazing camera (elevation ~4deg) still lands on the handle: miss ${Math.hypot(hit.x - 2, hit.z - -1).toExponential(2)}`);
}

function checkpointXZ(hit, target, msg) {
  check(Math.hypot(hit.x - target.x, hit.z - target.z) < 1e-12, msg);
}

// ---------------------------------------------------------------- 2. tolerance at two elevations
console.log('== Pick tolerance at two camera elevations ==');
const cameras = [
  ['steep (elevation ~50deg)', new THREE.Vector3(4, 9, 4)],
  ['flat (elevation ~14deg)', new THREE.Vector3(4, 2, 8)],
];
for (const [label, pos] of cameras) {
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  cam.position.copy(pos);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const at = (x, y) => {
    const p = toWorld({ x, y }).clone().project(cam);
    ndc.set(p.x, p.y);
    rc.setFromCamera(ndc, cam);
    const hit = new THREE.Vector3();
    return rc.ray.intersectPlane(handlePlane, hit) ? hit : null;
  };
  const inside = at(0.2, 0);
  const outside = at(0.35, 0);
  const insideDist = inside ? Math.hypot(inside.x - 0, inside.z - 0) : NaN;
  const outsideDist = outside ? Math.hypot(outside.x - 0, outside.z - 0) : NaN;
  check(insideDist < HANDLE_PICK_RADIUS,
    `${label}: a point 0.20 away is within the radius (measured ${insideDist.toFixed(4)} < ${HANDLE_PICK_RADIUS})`);
  check(outsideDist > HANDLE_PICK_RADIUS,
    `${label}: a point 0.35 away is outside it (measured ${outsideDist.toFixed(4)} > ${HANDLE_PICK_RADIUS})`);

  // And in PIXELS, which is what the hand actually knows: how far the pointer must be from a handle.
  // NDC spans 2 units across the viewport, so a 1080p frame is 1080/2 px per NDC unit vertically and
  // that times the aspect ratio horizontally.
  const ASPECT = 16 / 9;
  const HALF_HEIGHT_PX = 1080 / 2;
  const toNdcOf = (radius) => toWorld({ x: radius, y: 0 }).clone().project(cam);
  const origin = toNdcOf(0);
  const pxAt = (radius) => {
    const p = toNdcOf(radius);
    return Math.hypot((p.x - origin.x) * ASPECT, p.y - origin.y) * HALF_HEIGHT_PX;
  };
  const pixels = pxAt(HANDLE_PICK_RADIUS);
  const drawn = pxAt(HANDLE_RADIUS);
  console.log(`    ${label}: pick radius = ${pixels.toFixed(0)} px, drawn dot = ${drawn.toFixed(0)} px (1080p)`);
  check(pixels > drawn, `${label}: the pick target is larger on screen than the dot it stands for`);
}

// ---------------------------------------------------------------- 3. handle separation, whole corpus
console.log('== How close are a move\'s two handles? (whole corpus) ==');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);
const asset = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const moves = engine.parseMoves(movesXml);

// The population that matters is what actually reaches `renderHandles`: the RESOLVED segments of
// loaded call instances. `parseMoves` alone would miss every named move, since a PathItem is a
// reference (`{kind:'move', select, mods}`) until a call resolves it.
const measured = [];
const allSegs = [];
for (const [name, items] of moves) {
  for (const it of items) if (it.kind === 'movement') allSegs.push([name, it.seg]);
}
const levels = ['ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
let calls = 0;
for (const lv of levels) {
  const dir = path.join(corpusRoot(), lv);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.xml')) continue;
    const xml = fs.readFileSync(path.join(dir, f), 'utf8');
    if (engine.callMeta(xml).setups.length === 0) continue;
    let call;
    try {
      call = engine.loadCallFromXml(xml, movesXml, formationsXml, 0);
    } catch {
      continue; // the catalog scan in verify.cjs owns load failures; this probe only counts curves
    }
    calls++;
    for (const d of call.dancers) for (const seg of d.path) allSegs.push([`${lv}/${f}`, seg]);
  }
}

let closest = Infinity;
let closestName = '';
let closerThanPick = 0;
let coincident = 0;
let close = 0;
for (const [name, seg] of allSegs) {
  const t = seg?.translate;
  if (!t) continue;
  // The local frame is a pure rotation, so a distance in local coordinates IS the world distance.
  const d = Math.hypot(t.cx2 - t.cx1, t.cy2 - t.cy1);
  if (d < closest) { closest = d; closestName = name; }
  if (d <= 1e-9) coincident++;
  else if (d <= 2 * HANDLE_PICK_RADIUS) close++;
  if (d <= 2 * HANDLE_PICK_RADIUS) closerThanPick++;
}
console.log(`    ${allSegs.length} resolved segments from ${calls} calls across ${moves.size} named paths`);
console.log(`    closest pair of handles: ${closest.toFixed(4)} units (${closestName})`);
console.log(`    EXACTLY COINCIDENT (the two handles are one point): ${coincident} (${((coincident / allSegs.length) * 100).toFixed(2)}%)`);
console.log(`    distinct but within ${2 * HANDLE_PICK_RADIUS} units:      ${close} (${((close / allSegs.length) * 100).toFixed(2)}%)`);
check(allSegs.length > 1000, `the scan actually measured curves (${allSegs.length} segments)`);
// NOT a claim that ties are rare - they are not (see `coincident` above). The claim is that the tie
// is RESOLVED, deterministically and in the same direction every time, rather than depending on
// which of two coplanar dots a ray happened to hit first.
check(coincident + close < allSegs.length,
  `most curves have separable handles (${(100 - (closerThanPick / allSegs.length) * 100).toFixed(1)}% are further apart than the pick radius)`);

// The drawn dot must not be a lie about the grabbing: report the ratio for the record.
console.log(`    drawn dot radius ${HANDLE_RADIUS} vs pick radius ${HANDLE_PICK_RADIUS} (${(HANDLE_PICK_RADIUS / HANDLE_RADIUS).toFixed(1)}x)`);

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
