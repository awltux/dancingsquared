// Probe: WHAT DOES ADJUSTING THE END OF A FACING CURVE DO TO THE REST OF THE TRACE?
//
// Reported: "adjusting the end of the facing curve alters the direction of the rest of the trace. This
// shouldn't happen." MEASURED, and then checked against the reference implementation, it SHOULD happen and
// it does: the heading a move ends on is the frame the next move is played in. The caller's follow-up was
// "yes, I think it's all correct. My misunderstanding", and this probe is what settled it - so it stays as
// the instrument that explains the behaviour rather than as a bug hunt.
//
// The claim has three parts, and each is measured below: the move's own POSITION does not change (a facing
// curve carries no translation), the REST of the call does change, and that change is a rigid rotation of
// everything after the move about the pose the move ends on, by exactly the change in the end heading.
//
// The reference composes a dancer's moves the same way -
//
//   taminations-flutter/lib/math/path.dart, Path.recalculate():
//     var tx = Matrix.getIdentity();
//     _transformlist = movelist.map((it) {
//       tx = tx * it.translate();     // this move's translation, in the frame so far
//       tx = tx * it.rotate();        // then this move's turn, which the frame carries forward
//       return tx.clone();
//     })
//
// - so the swing is the format's semantics, the trail and the animation agree by construction, and a facing
// edit is a REAL edit: the end formation turns with it. `engine/test/editor.mjs` 19 pins the same numbers
// in the headless suite.
//
// Run: node tools/facing-chain-probe.mjs [call title] [dancer index] [move index]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);
const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);

const CALL = process.argv[2] ?? 'Circle Left';
const DEG = 180 / Math.PI;
const assets = path.join(POC_DIR, 'src', 'assets');
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
const fmt = (p) => `(${p.x.toFixed(4)}, ${p.y.toFixed(4)}) @ ${(p.heading * DEG).toFixed(2)}deg`;

const entry = callsByTitle(assets).find((c) => c.name === CALL);
if (!entry) {
  console.log(`✗ no call titled "${CALL}"`);
  process.exit(1);
}
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const base = engine.normalizeInstance(engine.loadCallFromXml(entry.xml, movesXml, formationsXml, 0));

// The dancer and move, defaulting to the first move that HAS a facing curve and IS not the last.
const d = Number(process.argv[3] ?? 0);
// The move to edit: the first one that HAS a facing curve and has something after it, because the
// question is what the edit does to the REST of the call.
const auto = (() => {
  const p = base.dancers[d].path;
  const withRot = p.map((s, i) => (s.rotate ? i : -1)).filter((i) => i >= 0);
  return withRot.find((i) => i < p.length - 1) ?? withRot[0] ?? 0;
})();
const k = process.argv[4] != null ? Number(process.argv[4]) : auto;
const path0 = base.dancers[d].path;
if (!path0[k]?.rotate) {
  console.log(`✗ dancer ${d + 1} move ${k + 1} has no facing curve`);
  process.exit(1);
}
console.log(`== ${CALL} ==`);
console.log(`   dancer ${d + 1} has ${path0.length} moves; editing move ${k + 1}, which has a facing curve`);

// THE EDIT, as the Facing tab's r3 handle makes it: every number in the final control span of the facing
// Bezier rotated, which turns the heading the move ends on by exactly that angle and nothing else.
const DELTA = 10 / DEG;
const r0 = path0[k].rotate;
const spun = { ...r0, cx2: rot(r0.cx2, r0.cy2, DELTA).x, cy2: rot(r0.cx2, r0.cy2, DELTA).y, x2: rot(r0.x2, r0.y2, DELTA).x, y2: rot(r0.x2, r0.y2, DELTA).y };
const edited = engine.setMove(base, d, k, { ...path0[k], rotate: spun });

const endHeading = (call) => engine.bezierAngle(call.dancers[d].path[k].rotate, 1) * DEG;
const dh = norm((endHeading(edited) - endHeading(base)) / DEG) * DEG;
console.log(`\n== the edit ==`);
console.log(`   the heading move ${k + 1} ends on: ${endHeading(base).toFixed(3)}deg -> ${endHeading(edited).toFixed(3)}deg (a change of ${dh.toFixed(3)}deg)`);

// The boundary poses of the move and of everything after it, before and after the edit.
const boundary = (call, j) => engine.poseFor(call.dancers[d], engine.moveBeatRange(call.dancers[d], j).to);
const pEnd0 = boundary(base, k);
const pEnd1 = boundary(edited, k);
console.log(`   the pose it ends on: ${fmt(pEnd0)} -> ${fmt(pEnd1)}`);
console.log(`   the position moved ${Math.hypot(pEnd0.x - pEnd1.x, pEnd0.y - pEnd1.y).toExponential(2)} units; the heading moved ${norm(pEnd1.heading - pEnd0.heading) * DEG === 0 ? '0' : (norm(pEnd1.heading - pEnd0.heading) * DEG).toFixed(6)}deg`);
check(Math.hypot(pEnd0.x - pEnd1.x, pEnd0.y - pEnd1.y) < 1e-9,
  'THE MOVE ITSELF DOES NOT MOVE: a facing edit writes no translation, so the position the move ends on is bit-identical');

// THE REST OF THE CALL. For every move after this one, is its boundary pose the OLD one rigidly rotated
// about the end pose, by the heading change?
console.log(`\n== the rest of the call ==`);
let worstOff = 0;
let worstAt = -1;
let headingsAllShifted = true;
for (let j = k + 1; j < path0.length; j++) {
  const q0 = boundary(base, j);
  const q1 = boundary(edited, j);
  // Where q1 SHOULD be if the rest were rigidly rotated by dh about pEnd0.
  const v = rot(q0.x - pEnd0.x, q0.y - pEnd0.y, dh / DEG);
  const want = { x: pEnd0.x + v.x, y: pEnd0.y + v.y };
  const off = Math.hypot(q1.x - want.x, q1.y - want.y);
  if (off > worstOff) { worstOff = off; worstAt = j; }
  const headingShift = norm(q1.heading - q0.heading) * DEG;
  if (Math.abs(headingShift - dh) > 1e-6) headingsAllShifted = false;
  console.log(`   move ${j + 1}: ${fmt(q0)} -> ${fmt(q1)}  (rotated by the edit: ${off.toExponential(1)} units off, heading shifted ${headingShift.toFixed(3)}deg)`);
}
const end0 = engine.poseFor(base.dancers[d], base.beats);
const end1 = engine.poseFor(edited.dancers[d], base.beats);
console.log(`   the call's end: ${fmt(end0)} -> ${fmt(end1)}, which is ${Math.hypot(end1.x - end0.x, end1.y - end0.y).toFixed(4)} units away`);
check(worstOff < 1e-9 && worstAt >= 0,
  `AND THE REST OF THE CALL IS RIGIDLY ROTATED BY EXACTLY ${dh.toFixed(2)}deg about that pose (worst error ${worstOff.toExponential(1)} units): the frame the next move is played in is the heading this one ends on, which is what the reference implementation composes too`);
check(headingsAllShifted, `every later move's heading is shifted by the same ${dh.toFixed(2)}deg, so the dancer does the same footwork facing ${dh.toFixed(0)}deg round`);

// AND WHAT THE CALLER SEES: the trail. Every later move's own local shape is untouched, but the DIRECTION
// it points on the floor is the frame it is played in, so the drawn trace after the edit swings round.
console.log(`\n== the drawn trace ==`);
{
  const dirOf = (call, j) => {
    const s = call.dancers[d].path[j].translate;
    const a = engine.poseFor(call.dancers[d], engine.moveBeatRange(call.dancers[d], j).from);
    const q0 = engine.bezierPoint(s, 0);
    const q1 = engine.bezierPoint(s, 1);
    const w0 = { x: a.x + Math.cos(a.heading) * q0.x - Math.sin(a.heading) * q0.y, y: a.y + Math.sin(a.heading) * q0.x + Math.cos(a.heading) * q0.y };
    const w1 = { x: a.x + Math.cos(a.heading) * q1.x - Math.sin(a.heading) * q1.y, y: a.y + Math.sin(a.heading) * q1.x + Math.cos(a.heading) * q1.y };
    return { dir: Math.atan2(w1.y - w0.y, w1.x - w0.x) * DEG, len: Math.hypot(w1.x - w0.x, w1.y - w0.y), from: w0 };
  };
  for (let j = k + 1; j < path0.length; j++) {
    const a = dirOf(base, j);
    const b = dirOf(edited, j);
    console.log(`   move ${j + 1}: drawn from ${a.dir.toFixed(2)}deg to ${b.dir.toFixed(2)}deg (swung ${norm((b.dir - a.dir) / DEG) * DEG === 0 ? '0' : (norm((b.dir - a.dir) / DEG) * DEG).toFixed(2)}deg), same length ${a.len.toFixed(4)} -> ${b.len.toFixed(4)}`);
  }
}

// ---------------------------------------------------------------- the answer
//
// There is nothing to fix: this is the format, and the trail agrees with the animation because they are
// the same composition. What is worth keeping is the MEASUREMENT - how far, and about what - so that the
// next person to read "the facing curve moved my call" finds the number rather than an opinion.
console.log(`\n== what the caller is seeing ==`);
console.log(`   the heading move ${k + 1} ends on sets the frame move ${k + 2} is played in, so turning it turns`);
console.log(`   every later heading by ${dh.toFixed(2)}deg and rotates the rest of the call about ${fmt(pEnd0)} by the same`);
console.log(`   angle: the drawn trace swings ${dh.toFixed(2)}deg and the call's end lands ${Math.hypot(end1.x - end0.x, end1.y - end0.y).toFixed(3)} units away.`);
console.log(`   That is how taminations composes a dancer's moves - \`tx * translate * rotate\` per move, carrying the`);
console.log(`   frame forward - so the panel says it on the Facing tab and \`engine/test/editor.mjs\` 19 pins it.`);

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
