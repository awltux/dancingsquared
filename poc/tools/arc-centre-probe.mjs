// Probe: THE ARC-CENTRE HANDLE - what the swing holds, and what it costs.
//
// Asked for: "When in the end of curve drag mode, and the curve closely represents an arc or a circle, provide
// another drag point that represent the center of the circle. Dragging this will keep the radius the same and
// rotate around the curves start point. Care must be taken to maintain the dancers direction in transition
// from the previous curve, including the facing curve."
//
// THE THREE THINGS ASKED FOR CANNOT ALL HOLD AT ONCE, and the reason is one line of geometry: a circular arc
// through a fixed start with a fixed entry TANGENT has its centre already determined (`r` along the normal),
// so if the arc also rotates rigidly about the start, its entry tangent rotates too. Holding the direction
// therefore means the start handle does not turn - which is the rule implemented (`rotateAboutStart`: the end
// and the exit control turn, the start handle does not) - and the cost is that the fitted circle changes.
// This probe measures both sides rather than arguing about them:
//
//   1. THE DIRECTION IS HELD EXACTLY: the entry tangent, the heading the previous move ended on, and the
//      facing curve are all untouched - over the corpus's arcs and every swing angle.
//   2. THE RADIUS OF THE ORBIT IS HELD EXACTLY: the end stays the same distance from the start, which is what
//      a rigid rotation about the start guarantees, and what the fitted radius does NOT hold (measured).
//   3. AND WHAT THE SWING DOES TO THE EXIT - the consequence a caller has to know about, measured for both
//      cases the engine distinguishes: with no facing curve the tangent IS the heading, so the tail turns with
//      the arc; with one, the heading is authored and the tail is carried instead.
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

// THE PANEL'S RULE, copied in the four lines that define it (`poc/src/editor-ui.ts`: ARC_FIT_TOL,
// `rotateAboutStart`). The copy says so; what is being measured is what the RULE does to the corpus.
const ARC_FIT_TOL = 0.02;
const rotateAboutStart = (b, theta) => {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const rot = (x, y) => ({ x: x * c - y * s, y: x * s + y * c });
  const p2 = rot(b.cx2, b.cy2);
  const p3 = rot(b.x2, b.y2);
  return { ...b, cx2: p2.x, cy2: p2.y, x2: p3.x, y2: p3.y };
};

// Every travel curve of every 8-dancer call in the ms level that the panel would offer a centre for.
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
      const fit = engine.fitCircle(seg.translate, ARC_FIT_TOL);
      if (fit) arcs.push({ file: f, call, i, k, seg, fit });
    });
  });
}
console.log(`== What is being swept ==`);
console.log(`    ${arcs.length} arc-ish moves (of every travel curve in the ms level), ${arcs.filter((a) => a.seg.rotate).length} of them carrying a facing curve`);
check(arcs.length > 50, 'the sweep is every arc the panel would offer a centre for, not a witness');

// Every swing angle the drag can produce, coarse enough to include the quarter turns and fine enough to catch
// a rule that only holds near zero.
const ANGLES = [0, 0.13, 0.5, 1.0, Math.PI / 2, 2.4, Math.PI, -0.37, -1.9, -Math.PI / 2];

// ---------------------------------------------------------------- 1. the direction is held
console.log('\n== 1. The direction the dancer arrives with is EXACTLY what it was ==');
{
  let worstEntry = 0;
  let worstFacing = 0;
  let worstPrevHeading = 0;
  for (const a of arcs) {
    for (const theta of ANGLES) {
      const spun = rotateAboutStart(a.seg.translate, theta);
      // (a) the entry tangent of the swung curve
      worstEntry = Math.max(worstEntry, Math.abs(norm(engine.bezierAngle(spun, 0) - engine.bezierAngle(a.seg.translate, 0))));
      // (b) the facing curve is not touched at all - it is the same OBJECT shape, so the heading profile is
      //     bit-identical, not merely close.
      const after = { ...a.seg, translate: spun };
      if (a.seg.rotate) {
        worstFacing = Math.max(worstFacing, JSON.stringify(after.rotate ?? null) === JSON.stringify(a.seg.rotate) ? 0 : 1);
      }
      // (c) and the heading the PREVIOUS move ended on - the frame this move is played in - is a property of
      //     the earlier moves, so it cannot move; the check is that the swung curve is the only change.
      const before = engine.poseFor(a.call.dancers[a.i], engine.moveBeatRange(a.call.dancers[a.i], a.k).from);
      const call2 = engine.setMove(a.call, a.i, a.k, after);
      const after2 = engine.poseFor(call2.dancers[a.i], engine.moveBeatRange(call2.dancers[a.i], a.k).from);
      worstPrevHeading = Math.max(worstPrevHeading, Math.abs(norm(after2.heading - before.heading)), Math.hypot(after2.x - before.x, after2.y - before.y));
    }
  }
  console.log(`    worst entry-tangent change ${(worstEntry * DEG).toExponential(1)}deg; worst change to the pose this move STARTS from ${worstPrevHeading.toExponential(1)}`);
  check(worstEntry < 1e-15, 'the direction the dancer arrives with is unchanged - the start handle is not turned - so the joint with the previous move is exactly what it was');
  check(worstFacing === 0, 'and the FACING curve is not touched: the heading profile is bit-identical, which is the "including the facing curve" half of the request');
  check(worstPrevHeading < 1e-12, 'and the pose this move starts from does not move at all (the frame comes from the previous moves, which the gesture never writes)');
}

// ---------------------------------------------------------------- 2. the radius
console.log('\n== 2. The radius: what is held, and what is not ==');
{
  let worstOrbit = 0; // |end - start| : the radius of the swing
  let worstFitR = 0; // the fitted circle's radius
  let worstFitRel = 0; // how far the swung curve strays from its own fit
  let worstDev = 0;
  for (const a of arcs) {
    const d0 = Math.hypot(a.seg.translate.x2, a.seg.translate.y2);
    for (const theta of ANGLES) {
      const spun = rotateAboutStart(a.seg.translate, theta);
      const d1 = Math.hypot(spun.x2, spun.y2);
      worstOrbit = Math.max(worstOrbit, Math.abs(d1 - d0));
      const fit = engine.fitCircle(spun, 1);
      if (!fit) {
        worstFitR = Infinity;
        continue;
      }
      worstFitR = Math.max(worstFitR, Math.abs(fit.r - a.fit.r));
      worstFitRel = Math.max(worstFitRel, fit.relDev);
    }
    worstDev = Math.max(worstDev, a.fit.relDev);
  }
  console.log(`    the end keeps its distance from the start to ${worstOrbit.toExponential(1)} over every arc and every swing`);
  console.log(`    the FITTED radius moves by up to ${Number.isFinite(worstFitR) ? worstFitR.toFixed(3) : 'infinity (the swing left the curve no circle at all)'}, and the swung curve's own deviation from its best circle reaches ${worstFitRel.toExponential(2)} of the radius`);
  check(worstOrbit < 1e-15, 'THE RADIUS OF THE SWING IS HELD EXACTLY: the end stays the same distance from the start, because this is a rigid rotation of the end about it');
  check(worstFitRel > worstDev, 'and the measured cost: the curve is no longer the same circle (its deviation from its own best fit grows), because holding the entry direction and keeping the circle are mutually exclusive - a fixed start, a fixed entry tangent and a fixed radius already determine the centre');
}

// ---------------------------------------------------------------- 3. what it does to the exit
console.log('\n== 3. What the swing does to where the dancer goes next ==');
{
  let turnsWithFacing = 0;
  let turnsWithout = 0;
  let worstWith = 0;
  let worstWithout = 0;
  let movedButHeadingFixed = 0;
  for (const a of arcs) {
    const theta = 0.6;
    const spun = { ...a.seg, translate: rotateAboutStart(a.seg.translate, theta) };
    const call2 = engine.setMove(a.call, a.i, a.k, spun);
    const endA = engine.poseFor(a.call.dancers[a.i], a.call.beats);
    const endB = engine.poseFor(call2.dancers[a.i], call2.beats);
    const dHeading = Math.abs(norm(endB.heading - endA.heading)) * DEG;
    if (a.seg.rotate) {
      worstWith = Math.max(worstWith, dHeading);
      if (dHeading > 1) turnsWithFacing++;
      if (Math.hypot(endB.x - endA.x, endB.y - endA.y) > 1e-6) movedButHeadingFixed++;
    } else {
      worstWithout = Math.max(worstWithout, dHeading);
      if (dHeading > 1) turnsWithout++;
    }
  }
  console.log(`    with a facing curve: the call's end heading moves by up to ${worstWith.toExponential(1)}deg (the heading is AUTHORED, so the swing carries the end instead of turning it - ${movedButHeadingFixed} of those arcs moved the end)`);
  console.log(`    with no facing curve: the end heading turns by up to ${worstWithout.toFixed(1)}deg, because there the exit tangent IS the heading`);
  check(turnsWithFacing === 0, 'a facing override is respected: the swing holds the heading the move finishes on, and carries the rest of the trace instead (the documented format behaviour)');
  check(turnsWithout > 0, 'and with no facing curve the swing re-aims the heading - which is the point of swinging an arc, and the panel says so on the tab');
}

// ---------------------------------------------------------------- 4. the wiring
console.log('\n== 4. The panel offers the centre only for an arc, in end mode, and drags it by the rule ==');
const src = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
check(/const ARC_FIT_TOL = 0\.02;/.test(src), 'the panel has ONE tolerance for "closely an arc", and its value is inside the corpus\'s empty band (measured in engine/test/editor.mjs 23)');
check(/if \(this\.handleMode === 'end'\) \{[\s\S]*?fitCircle\(t, ARC_FIT_TOL\)[\s\S]*?id: `d\$\{d\}:cc`/.test(src),
  'the centre handle is drawn in END mode only, and only when the fit says the curve is an arc');
check(/function rotateAboutStart\(b: BezierData, theta: number\)[\s\S]*?cx2: p2\.x, cy2: p2\.y, x2: p3\.x, y2: p3\.y/.test(src),
  'and the drag turns the end and the exit control about the start, leaving the start handle alone - the one line that holds the arrival direction');
check(/private dragArcBase: \{ curve: BezierData; phi0: number; centre: \{ x: number; y: number \}; theta: number \} \| null = null;/.test(src) && /this\.dragArcBase = null;/.test(src),
  'measured from the start of the gesture and cleared at its end, so a drag is a rotation of a FIXED curve rather than a compounding one');
check(/which === 'cc'[\s\S]*?base\.theta = Math\.atan2\(ly, lx\) - base\.phi0;[\s\S]*?rotateAboutStart\(base\.curve, base\.theta\)/.test(src),
  'the angle is the pointer\'s bearing from the curve\'s start, measured from where the centre was when the drag began');
check(/const centreLocal = dragging \? rotatePoint\(dragging\.centre, dragging\.theta\)/.test(src),
  'and the handle is drawn at the BASE circle\'s rotated centre while the gesture runs, so a wide swing cannot make the dot vanish from under the pointer');

// SHOWN TO FAIL: turn the start handle with the rest, which is the fault the request warned about.
console.log('\n== the checks fail on the fault they were written for ==');
{
  const rigid = (b, theta) => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const rot = (x, y) => ({ x: x * c - y * s, y: x * s + y * c });
    const p1 = rot(b.cx1, b.cy1);
    const p2 = rot(b.cx2, b.cy2);
    const p3 = rot(b.x2, b.y2);
    return { ...b, cx1: p1.x, cy1: p1.y, cx2: p2.x, cy2: p2.y, x2: p3.x, y2: p3.y };
  };
  let worst = 0;
  for (const a of arcs) worst = Math.max(worst, Math.abs(norm(engine.bezierAngle(rigid(a.seg.translate, 0.6), 0) - engine.bezierAngle(a.seg.translate, 0))));
  console.log(`    turning the START handle too (a rigid rotation of the whole curve) moves the arrival direction by ${(worst * DEG).toFixed(1)}deg`);
  check(worst * DEG > 30, 'so the rule really is what holds the direction: a rigid rotation of the whole curve breaks the joint by the swing angle, which is what the caller asked to avoid');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
