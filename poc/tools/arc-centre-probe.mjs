// Probe: THE ARC-CENTRE HANDLE - what the swing holds, and what it costs.
//
// Asked for: "When in the end of curve drag mode, and the curve closely represents an arc or a circle, provide
// another drag point that represent the center of the circle. Dragging this will keep the radius the same and
// rotate around the curves start point. Care must be taken to maintain the dancers direction in transition
// from the previous curve, including the facing curve." Then: "When dragging the center of the arc, the start
// control point isnt adjusted to maintain the arc shape."
//
// THE SECOND MESSAGE CHANGES THE RULE, and it is worth saying why the first one could not stand: the start
// control point IS the direction the dancer arrives with, and on an arc that direction is perpendicular to the
// radius - so turning the arc turns the joint, and holding the joint is what stops the curve being an arc.
// The swing is now a RIGID rotation of the whole curve (so the radius and the shape cannot change, which is
// exact rather than approximate), and the JOINT is kept smooth by turning the PREVIOUS move's exit with it.
//
// AND THE OBVIOUS VERSION OF THAT IS A GESTURE THAT DOES NOTHING, which is the other half of this probe: if
// the previous move's FACING alone absorbed the angle, the frame this arc is played in would rotate by the
// same amount the arc did, and the arc would land back exactly where it started. The absorb has to freeze the
// previous move's heading change (writing a facing curve only when it had none), so the frame does not move.
// Both versions are measured here, so "the swing is visible" is a number rather than a claim.
//
// Run: node tools/arc-centre-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const assets = path.join(POC_DIR, 'src', 'assets');
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const DEG = 180 / Math.PI;

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Every arc the panel would offer a centre for: every travel curve of every 8-dancer call in the ms level,
// WITH a move before it (the joint is the thing being measured).
const arcs = [];
for (const f of fs.readdirSync(path.join(assets, 'ms')).filter((x) => x.endsWith('.xml'))) {
  let call;
  try {
    call = engine.normalizeInstance(engine.loadCallFromXml(fs.readFileSync(path.join(assets, 'ms', f), 'utf8'), movesXml, formationsXml, 0));
  } catch {
    continue;
  }
  if (call.dancers.length !== 8) continue;
  call.dancers.forEach((dancer, i) => {
    dancer.path.forEach((seg, k) => {
      if (k === 0) return;
      const fit = engine.fitCircle(seg.translate, 0.02);
      if (fit) arcs.push({ file: f, call, i, k, seg, fit });
    });
  });
}
console.log(`== What is being swept ==`);
console.log(`    ${arcs.length} arc-ish moves WITH a move before them (of every travel curve in the ms level), ${arcs.filter((a) => a.seg.rotate).length} carrying a facing curve on the arc, ${arcs.filter((a) => a.call.dancers[a.i].path[a.k - 1].rotate).length} with one on the move before it`);
check(arcs.length > 50, 'the sweep is every arc the panel would offer a centre for, not a witness');

const ANGLES = [0.13, 0.5, 1.0, Math.PI / 2, 2.4, -0.37, -1.9];
const pose = (call, i, k, end) => {
  const r = engine.moveBeatRange(call.dancers[i], k);
  return engine.poseFor(call.dancers[i], end ? r.to : r.from);
};
const worldDir = (call, i, k, t) => {
  const p = engine.poseFor(call.dancers[i], engine.moveBeatRange(call.dancers[i], k).from);
  return norm(engine.bezierAngle(call.dancers[i].path[k].translate, t) + p.heading);
};
/** The corner at the joint: how far the previous move's departure misses this move's arrival. */
const corner = (call, i, k) => Math.abs(norm(worldDir(call, i, k - 1, 1) - worldDir(call, i, k, 0)));

// ---------------------------------------------------------------- 1. the arc and the radius, exactly
console.log('\n== 1. The arc, the radius and the start are EXACTLY what they were ==');
{
  let worstShape = 0;
  let worstRadius = 0;
  let worstStart = 0;
  let worstChord = 0;
  let movedLeast = Infinity;
  for (const a of arcs) {
    for (const theta of ANGLES) {
      const after = engine.swingArcAboutStart(a.call, a.i, a.k, theta);
      const fit = engine.fitCircle(after.dancers[a.i].path[a.k].translate, 1);
      worstShape = Math.max(worstShape, Math.abs(fit.relDev - a.fit.relDev));
      const s0 = pose(a.call, a.i, a.k, false);
      const s1 = pose(after, a.i, a.k, false);
      worstStart = Math.max(worstStart, Math.hypot(s1.x - s0.x, s1.y - s0.y), Math.abs(norm(s1.heading - s0.heading)));
      const e0 = pose(a.call, a.i, a.k, true);
      const e1 = pose(after, a.i, a.k, true);
      const r0 = Math.hypot(e0.x - s0.x, e0.y - s0.y);
      const r1 = Math.hypot(e1.x - s1.x, e1.y - s1.y);
      worstRadius = Math.max(worstRadius, Math.abs(r1 - r0) / r0, Math.abs(fit.r - a.fit.r) / a.fit.r);
      const moved = Math.hypot(e1.x - e0.x, e1.y - e0.y);
      movedLeast = Math.min(movedLeast, moved);
      // The chord is a LENGTH: `2r·sin(theta/2)` is signed, and a negative swing is not a negative chord.
      worstChord = Math.max(worstChord, Math.abs(moved - 2 * r0 * Math.abs(Math.sin(theta / 2))));
    }
  }
  console.log(`    the shape (deviation from its own circle) moves by ${worstShape.toExponential(1)}, the radius by ${worstRadius.toExponential(1)} of itself, the start pose by ${worstStart.toExponential(1)}`);
  check(worstShape < 1e-15 && worstStart < 1e-12, 'the START CONTROL POINT turns with the curve, so the arc and its radius are preserved EXACTLY - the correction asked for, made exact by making the rotation rigid');
  check(worstChord < 1e-9 && movedLeast > 1e-3, `and the END really moves: by the chord of the swing angle, to ${worstChord.toExponential(1)} (at least ${movedLeast.toFixed(4)} units at the smallest angle measured)`);
}

// ---------------------------------------------------------------- 2. the joint is as smooth as it was
console.log('\n== 2. The transition from the previous move: no new corner, and no rotated frame ==');
{
  let worstCorner = 0;
  let worstFrame = 0;
  let worstPrevEnds = 0;
  let kinkWithout = 0;
  let cornerNoDirection = 0;
  let arcsNoDirection = 0;
  for (const a of arcs) {
    // A previous move with NO departure direction cannot follow, and is left alone rather than given one:
    // its exit handle has collapsed onto its endpoint, so there is nothing to turn - and the joint is
    // reported rather than claimed. The check below therefore measures the two cases separately.
    const canFollow = engine.hasExitDirection(a.call.dancers[a.i].path[a.k - 1].translate);
    if (!canFollow) arcsNoDirection++;
    for (const theta of ANGLES) {
      const after = engine.swingArcAboutStart(a.call, a.i, a.k, theta);
      const dCorner = Math.abs(corner(after, a.i, a.k) - corner(a.call, a.i, a.k));
      if (canFollow) worstCorner = Math.max(worstCorner, dCorner);
      else cornerNoDirection = Math.max(cornerNoDirection, dCorner);
      // The FRAME is the heading this move starts in: it is the previous move's own end heading, and if it
      // rotated with the arc the swing would cancel itself out.
      const h0 = pose(a.call, a.i, a.k, false).heading;
      const h1 = pose(after, a.i, a.k, false).heading;
      worstFrame = Math.max(worstFrame, Math.abs(norm(h1 - h0)));
      // The previous move's own start and finish do not move; only its departure turns.
      const p0 = pose(a.call, a.i, a.k - 1, false);
      const p1 = pose(after, a.i, a.k - 1, false);
      const q0 = pose(a.call, a.i, a.k - 1, true);
      const q1 = pose(after, a.i, a.k - 1, true);
      worstPrevEnds = Math.max(worstPrevEnds, Math.hypot(p1.x - p0.x, p1.y - p0.y), Math.hypot(q1.x - q0.x, q1.y - q0.y));
      // The negative control: the rigid swing ALONE.
      const alone = engine.setMove(a.call, a.i, a.k, { ...a.seg, translate: engine.rotateCurveAboutStart(a.seg.translate, theta) });
      kinkWithout = Math.max(kinkWithout, Math.abs(corner(alone, a.i, a.k) - corner(a.call, a.i, a.k)));
    }
  }
  console.log(`    where the previous move HAS a departure direction (${arcs.length - arcsNoDirection} of ${arcs.length}), the corner moves by ${(worstCorner * DEG).toExponential(1)}deg; the frame by ${(worstFrame * DEG).toExponential(1)}deg; the previous move's own ends by ${worstPrevEnds.toExponential(1)}`);
  console.log(`    the other ${arcsNoDirection} arcs follow a move whose exit handle has no length at all: there is no direction there to turn, so its joint takes the swing (up to ${(cornerNoDirection * DEG).toFixed(1)}deg) and the panel says so instead of pretending otherwise`);
  check(worstCorner * DEG < 1e-9, 'the joint is EXACTLY as smooth as it was: the previous move departs along the arc\'s new arrival direction, so a swing cannot introduce a corner');
  check(worstFrame * DEG < 1e-9, 'and the frame this arc is played in does not rotate - which is what keeps the swing VISIBLE instead of cancelling it');
  check(worstPrevEnds < 1e-9, 'and the previous move still starts and finishes where it did: only its departure direction turned');
  console.log(`    without the re-aim, the same gesture leaves a corner of up to ${(kinkWithout * DEG).toFixed(1)}deg - the fault the re-aim prevents`);
  check(kinkWithout * DEG > 5, 'and that negative control is large: the rigid swing alone kinks the joint by the swing angle');
}

// ---------------------------------------------------------------- 3. why the absorb is on the exit
console.log('\n== 3. The other version of the absorb is a gesture that does nothing ==');
{
  // "Absorb the turn in the previous move's facing" read literally: turn that move's FACING by -theta and
  // leave its travel alone. The frame then rotates by the same amount the arc did, and the arc lands back
  // exactly where it started - measured, because it is the reason the rule is not written that way.
  let worstWorld = 0;
  for (const a of arcs) {
    const theta = 0.5;
    let out = engine.setMove(a.call, a.i, a.k, { ...a.seg, translate: engine.rotateCurveAboutStart(a.seg.translate, theta) });
    const prev = out.dancers[a.i].path[a.k - 1];
    const base = prev.rotate ?? { ...a.call.dancers[a.i].path[a.k - 1].translate };
    out = engine.setMove(out, a.i, a.k - 1, { ...prev, rotate: engine.rotateCurveAboutStart(base, -theta) });
    const before = pose(a.call, a.i, a.k, true);
    const after = pose(out, a.i, a.k, true);
    worstWorld = Math.max(worstWorld, Math.hypot(after.x - before.x, after.y - before.y));
  }
  console.log(`    turning the previous FACING by -theta and leaving its path alone moves the arc's end by at most ${worstWorld.toExponential(1)} units across the whole corpus`);
  check(worstWorld < 1e-9, 'so that version is a NO-OP in world space: the frame rotates by the swing and the arc rotates back, which is why the rule freezes the heading change and turns the EXIT instead');
}

// ---------------------------------------------------------------- 4. the wiring
console.log('\n== 4. The panel offers the centre only for an arc, in end mode, and drags it by the engine rule ==');
const src = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
check(/const ARC_FIT_TOL = 0\.02;/.test(src), 'the panel has ONE tolerance for "closely an arc", inside the corpus\'s empty band (engine/test/editor.mjs 23)');
check(/if \(this\.handleMode === 'end'\) \{[\s\S]*?fitCircle\(t, ARC_FIT_TOL\)[\s\S]*?id: `d\$\{d\}:cc`/.test(src),
  'the centre handle is drawn in END mode only, and only when the fit says the curve is an arc');
check(/if \(which === 'cc'\) \{[\s\S]*?this\.coordinatesAgree\('travel'\)[\s\S]*?swingArcAboutStart\(next, dd, this\.moveIndex, base\.theta\)/.test(src),
  'and its drag runs the engine\'s own `swingArcAboutStart` - the arc, the joint and the previous move\'s facing are ONE operation, not three edits the panel could get out of step');
check(/private dragArcBase: \{ call: CallBundle; phi0: number; centre: \{ x: number; y: number \}; theta: number \} \| null = null;/.test(src) && /this\.dragArcBase = null;/.test(src),
  'measured from the whole CALL captured at pointerdown - the swing writes two moves, so rotating the live bundle per pointer move would compound - and cleared at the end of the gesture');
check(/const centreLocal = dragging \? rotatePoint\(dragging\.centre, dragging\.theta\)/.test(src),
  'and the handle is drawn at the BASE circle\'s rotated centre while the gesture runs, so it cannot vanish from under the pointer');
check(!/rotateAboutStart\(/.test(src), 'with the old, shape-breaking rule gone rather than left switched off');

// SHOWN TO FAIL: the rule the caller's second message replaced.
console.log('\n== the checks fail on the fault they were written for ==');
{
  let worstShape = 0;
  for (const a of arcs) {
    // The previous rule: turn the end and the exit control, leave the start handle where it was.
    const spun = engine.rotateCurveAboutStart(a.seg.translate, 0.5);
    const kept = { ...a.seg.translate, cx2: spun.cx2, cy2: spun.cy2, x2: spun.x2, y2: spun.y2 };
    const fit = engine.fitCircle(kept, 1);
    worstShape = Math.max(worstShape, fit ? fit.relDev - a.fit.relDev : 1);
  }
  console.log(`    holding the start handle instead puts the curve up to ${worstShape.toFixed(2)} of its radius off its own circle`);
  check(worstShape > 0.1, 'so the reported fault is real and this check can see it: leaving the start control point behind is what stops the swing being an arc');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
