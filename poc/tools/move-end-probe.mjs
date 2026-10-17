// Probe: WHAT DOES DRAGGING A CURVE'S END POINT DO TO THE REST OF THE DANCE?
//
// Asked for: "Add a drag point for the end of a curve. This also requires adjusting the bezier controls to
// ensure the control for this curve is aligned with the next control to preserve dancer direction. If there
// is a facing override, this must also be managed to preserve the direction of travel to the next curve."
//
// The mechanism is one line of the engine's composition (`poseFor`): the move's end point is `p3`, and the
// heading it ends on - the frame the NEXT move is played in - is `bezierAngle(rotate ?? translate, 1)`, the
// direction of the tangent at `t = 1`, which for a cubic is exactly `p3 - p2`. So moving `p3` alone changes
// the destination AND the frame, and the second one swings the rest of the track. `moveCurveEnd` holds the
// exit handle vector so it cannot. This probe measures, over the whole ms level:
//
//   1. how often, and by how much, a real drag WOULD change the exit direction if the handle were not held;
//   2. that with the hold the exit direction is unchanged and every later boundary is the old one CARRIED -
//      same headings, same shape, moved by the distance the end point moved;
//   3. and that this is true BOTH with and without a facing curve, which are two different mechanisms:
//      with one, the heading comes from the rotation curve and what the hold protects is the direction of
//      TRAVEL; without one, the tangent IS the heading and the hold is what keeps the track from turning.
//
// Run: node tools/move-end-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const assets = path.join(POC_DIR, '..', 'assets');
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

// THE CORPUS: every call in the ms level, every dancer, every move that has something after it (the claim
// is about the moves that follow).
const cases = [];
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
      if (k === dancer.path.length - 1) return;
      const handle = seg.translate.x2 - seg.translate.cx2;
      const handleY = seg.translate.y2 - seg.translate.cy2;
      cases.push({ file: f, call, i, k, seg, facing: !!seg.rotate, handle: Math.hypot(handle, handleY) });
    });
  });
}
console.log(`== What is being swept ==`);
console.log(`    ${cases.length} moves with something after them, over the ms level; ${cases.filter((c) => c.facing).length} carry a facing curve and ${cases.filter((c) => !c.facing).length} do not`);
check(cases.length > 500, 'the sweep is the whole level, not a witness or two');

const boundaries = (call, i) => call.dancers[i].path.map((_, k) => engine.poseFor(call.dancers[i], engine.moveBeatRange(call.dancers[i], k).to));

// THE DRAG ITSELF, as the panel performs it: the pointer's local point becomes x2/y2, and the exit handle
// is held by the engine.
const DX = 0.5;
const DY = -0.35;

// ---------------------------------------------------------------- 1. what the hold is worth
console.log('\n== 1. How much would a drag swing WITHOUT the hold? ==');
{
  let turned = 0;
  let worst = 0;
  let worstAt = null;
  const degs = [];
  for (const c of cases) {
    const t = c.seg.translate;
    const raw = { ...t, x2: t.x2 + DX, y2: t.y2 + DY };
    const da = Math.abs(norm(engine.bezierAngle(raw, 1) - engine.bezierAngle(t, 1)));
    degs.push(da * DEG);
    if (da * DEG > 1) turned++;
    if (da * DEG > worst) {
      worst = da * DEG;
      worstAt = `${c.file} dancer ${c.i + 1} move ${c.k + 1}`;
    }
  }
  degs.sort((a, b) => a - b);
  const median = degs[Math.floor(degs.length / 2)];
  console.log(`    moving the end point by (${DX}, ${DY}) turns the exit direction by a median of ${median.toFixed(2)}deg, and by more than 1deg in ${turned} of ${cases.length} moves (worst ${worst.toFixed(1)}deg, ${worstAt})`);
  check(turned > cases.length / 4, 'the side effect is not a corner case: a plain drag would re-aim a large share of the corpus\'s moves');
}

// ---------------------------------------------------------------- 2. with the hold
console.log('\n== 2. With the exit handle held: the tail is the old tail, CARRIED ==');
{
  let worstPos = 0;
  let worstHead = 0;
  let worstExit = 0;
  let checked = 0;
  const byFacing = { true: { n: 0, pos: 0, head: 0 }, false: { n: 0, pos: 0, head: 0 } };
  for (const c of cases) {
    const before = c.call;
    const held = engine.moveCurveEnd(c.seg.translate, c.seg.translate.x2 + DX, c.seg.translate.y2 + DY);
    const after = engine.setMove(before, c.i, c.k, { ...c.seg, translate: held });
    const range = engine.moveBeatRange(before.dancers[c.i], c.k);
    const p0 = engine.poseFor(before.dancers[c.i], range.to);
    const p1 = engine.poseFor(after.dancers[c.i], range.to);
    const shift = { x: p1.x - p0.x, y: p1.y - p0.y };
    worstExit = Math.max(worstExit, Math.abs(norm(engine.bezierAngle(held, 1) - engine.bezierAngle(c.seg.translate, 1))));
    const b0 = boundaries(before, c.i);
    const b1 = boundaries(after, c.i);
    let pos = 0;
    let head = 0;
    for (let j = c.k + 1; j < b0.length; j++) {
      pos = Math.max(pos, Math.hypot(b1[j].x - b0[j].x - shift.x, b1[j].y - b0[j].y - shift.y));
      head = Math.max(head, Math.abs(norm(b1[j].heading - b0[j].heading)));
    }
    const bucket = byFacing[String(c.facing)];
    bucket.n++;
    bucket.pos = Math.max(bucket.pos, pos);
    bucket.head = Math.max(bucket.head, head);
    worstPos = Math.max(worstPos, pos);
    worstHead = Math.max(worstHead, head);
    checked++;
  }
  console.log(`    ${checked} moves dragged; the exit direction moved by at most ${(worstExit * DEG).toExponential(1)}deg`);
  console.log(`      with a facing curve (${byFacing.true.n}): worst tail position error ${byFacing.true.pos.toExponential(1)}, worst heading error ${(byFacing.true.head * DEG).toExponential(1)}deg`);
  console.log(`      without one (${byFacing.false.n}): worst tail position error ${byFacing.false.pos.toExponential(1)}, worst heading error ${(byFacing.false.head * DEG).toExponential(1)}deg`);
  check(worstExit * DEG < 1e-12, 'the direction the dancer leaves on is unchanged, to floating-point noise, in every case');
  check(worstPos < 1e-9 && worstHead < 1e-9, 'and every later boundary is the old one carried by the distance the end point moved - same headings, same shape: the rest of the dance keeps doing what it did');
}

// ---------------------------------------------------------------- 3. the negative control
console.log('\n== 3. Without the hold, the tail follows - and the two cases differ ==');
{
  let movedWithFacing = 0;
  let movedWithout = 0;
  let worstWith = 0;
  let worstWithout = 0;
  let travelTurnedWithFacing = 0;
  for (const c of cases) {
    const t = c.seg.translate;
    const raw = engine.setMove(c.call, c.i, c.k, { ...c.seg, translate: { ...t, x2: t.x2 + DX, y2: t.y2 + DY } });
    if (Math.abs(norm(engine.bezierAngle(raw.dancers[c.i].path[c.k].translate, 1) - engine.bezierAngle(t, 1))) * DEG > 1) travelTurnedWithFacing += c.facing ? 1 : 0;
    const b0 = boundaries(c.call, c.i);
    const b1 = boundaries(raw, c.i);
    let head = 0;
    for (let j = c.k + 1; j < b0.length; j++) head = Math.max(head, Math.abs(norm(b1[j].heading - b0[j].heading)));
    if (c.facing) {
      if (head * DEG > 0.01) movedWithFacing++;
      worstWith = Math.max(worstWith, head * DEG);
    } else {
      if (head * DEG > 0.01) movedWithout++;
      worstWithout = Math.max(worstWithout, head * DEG);
    }
  }
  console.log(`    writing x2/y2 alone: with a facing curve ${movedWithFacing} moves turn the tail (worst ${worstWith.toFixed(2)}deg) but ${travelTurnedWithFacing} change the DIRECTION OF TRAVEL;`);
  console.log(`      with no facing curve ${movedWithout} moves turn the tail (worst ${worstWithout.toFixed(1)}deg)`);
  check(movedWithout > 0 && worstWithout > 1, 'without a facing curve the tail turns with the exit - the swing the hold prevents');
  check(movedWithFacing === 0 && travelTurnedWithFacing > 0, 'with a facing curve the tail does NOT turn (the heading comes from the rotation curve) - so there the hold protects the direction of travel, which is exactly what was asked for');
}

// ---------------------------------------------------------------- the wiring
console.log('\n== the panel offers both handle sets, and the end drag goes through the engine ==');
const src = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
check(/private handleMode: 'control' \| 'end'/.test(src), 'the panel carries one handle mode, so the two sets are never drawn together');
check(/if \(this\.handleMode === 'end'\) \{\s*\/\/ THE END POINT/.test(src) && /id: `d\$\{d\}:c3`/.test(src),
  'and in END mode the travel curve is drawn as its end point alone, anchored on its own exit control so the handle line IS the direction a drag holds');
check(/if \(this\.handleMode === 'end'\) \{\s*handles\.push\(\{ id: `d\$\{d\}:r3`/.test(src),
  'and the facing curve as its end (the heading the move finishes on), which is the same rule one shape over');
check(/translate: moveCurveEnd\(seg\.translate, lx, ly\)/.test(src), 'and the drag writes the end point through the engine\'s `moveCurveEnd`, so the hold has one definition');
check(/dataset\.key = `m\$\{i\}:\$\{k\}:handles`/.test(src), 'with a button in the tile to flip between the two sets');
// AND THE BUTTON AND THE `S` KEY ARE THE SAME FLIP. One method, so the two cannot end up toggling different
// state or disagreeing about the sentence in the status line; `keys-probe.mjs` measures the binding itself.
check(/private toggleHandleMode\(\): void \{/.test(src) && /hbtn\.addEventListener\('click', \(\) => this\.toggleHandleMode\(\)\)/.test(src),
  'and the tile button calls ONE `toggleHandleMode`, which is what the `S` key is bound to as well');
check(/hbtn\.title \+= ' The S key flips this too\.'/.test(src), 'with the shortcut named in the button\'s own tooltip');

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
