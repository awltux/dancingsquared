// Three.js render adapter. This knows nothing about the engine's data model —
// it consumes Pose[] and grip targets and draws 3D avatars.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { DancerSpec, Pose } from 'dancing-squared-engine';

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  resize(): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
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

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(5, 12, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(-6, 4, -5);
  scene.add(rim);

  // Floor grid.
  const grid = new THREE.GridHelper(20, 20, 0x2a3542, 0x182029);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.6;
  scene.add(grid);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x0e141b, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.001;
  floor.receiveShadow = true;
  scene.add(floor);

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  return { scene, camera, renderer, controls, resize };
}

// ------------------------------------------------------------------ avatar

// Couple color scheme: 1=red, 2=yellow, 3=green, 4=blue.
const COUPLE_COLORS = [0xe33b3b, 0xe8c23a, 0x3fbf6f, 0x3b7ee8];
const PHANTOM_COLOR = 0x9aa6b2;

export const coupleColor = (couple: number): number =>
  couple > 0 ? COUPLE_COLORS[(couple - 1) % COUPLE_COLORS.length] : PHANTOM_COLOR;

// A small floating label showing a dancer's couple number (for verifying which
// colour maps to which couple).
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

  // Walk-cycle state: we measure the dancer's own translation frame-to-frame so
  // the stride eases to rest the moment the dancer stops moving.
  private lastX = 0;
  private lastY = 0;
  private lastT = -1;
  private stride = 0;
  private static readonly SPEED_THRESH = 0.05; // units/sec -> treat as moving
  private static readonly EASE = 0.25; // stride smoothing toward the target

  constructor(spec: DancerSpec, couple = 0) {
    const phantom = spec.gender === 'phantom';
    const color = coupleColor(couple);
    const parts = buildAvatar(color, phantom, spec.gender);
    this.group = parts.group;
    this.parts = parts;
    // Double the avatar size (geometry is authored in ~1.6-unit tall units).
    // Feet stay at the group origin, and the arm IK is done in local space, so
    // a uniform group scale keeps the whole figure — and its reach — consistent.
    this.group.scale.set(2, 2, 2);
    if (couple > 0) this.group.add(makeNumberLabel(String(couple)));

    this.trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    this.trail.frustumCulled = false;
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
}

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
