// A FACING CURVE IS A TURN, AND A TURN STARTS AT ZERO.
//
// Reported: "Adding a move to a trace creates some strange rotation behaviour at the transition from the
// previous move. The first Move has a facing trace enabled. The added move doesn't have Facing enabled. In
// this situation, the added Move it's supposed to keep the rotation from the end of the previous Moves
// Facing trace, but it seems to use the direction of the previous Moves position trace."
//
// THAT IS EXACTLY WHAT IT DID, and the mechanism is a unit confusion in `poseFor`. Both facing channels are
// read with `bezierAngle`, which is `atan2` of the derivative - but they mean different things:
//
//   - a `rotate` curve says what the move TURNS THROUGH, so its angle at t=0 is where the dancer already is;
//   - a `translate` curve says where the move GOES, so its angle at t=0 is the direction the path DEPARTS in.
//
// Used as a turn, only the first of those starts at zero. So a move with no facing curve did not CONTINUE
// the heading it arrived with - it SNAPPED to face its own departure direction, and then turned back. For a
// sidestep that is a 90 degree flick at the move's start; for a back-up it is 180 degrees, and the dancer
// ends the move facing backwards having walked backwards, which is the opposite of the dance.
//
// THE FIX IS ONE TERM: `angle(facing, t) - <the direction the curve departs in>`. Section 1 measures the property
// that makes it a no-op on every shipped call, section 2 proves the corpus is bit-identical under it, and
// section 3 measures the snap it removes. Section 4 pins the invariant that comes free with it: ticking the
// panel's `explicit` box - which seeds the new facing curve by COPYING the travel curve - no longer changes
// the animation, which is what makes that seed defensible.
//
// THE DATUM IS `departureAngle`, NOT `bezierAngle(..., 0)`, and that came later: `bezierAngle` is `atan2` of the
// derivative, so where a curve's derivative VANISHES - an end whose control point sits on that end - it answers
// 0 by convention whatever the curve does. MEASURED, a curve shaped like a hold read a turn of pi once mirrored
// (`engine/src/core.ts`, `engine/test/departure-angle.mjs`, which owns that rule and pins it against sampled
// directions). This probe's section 6 asserts the SOURCE text, so it is the check that has to move with it.
//
// RED ON PURPOSE, AND THE OWNER HAS RULED: the two failing checks below assert that NO shipped heading
// moves - "the corpus only ever walks forward along +X" - and the 2026-10-09 re-authoring of
// `ms/swing.xml` and `ms/promenade.xml` put travel curves in the corpus that DEPART OFF-AXIS (worst 37.7deg
// at `ms/swing.xml:31`). Under `67bba6f`'s relative-turn reading that is the intended behaviour: a
// no-facing move no longer snaps its heading to the travel tangent, so those moves now turn. MEASURED: 22
// offending moves in those two files, and 178 of 134480 sampled headings differ (worst 159.02deg at
// `ms/swing.xml` beat 3.63). The owner chose to LEAVE IT FOR NOW rather than decide whether those swing
// curves are intended, so the red stands as a recorded question rather than a defect: do NOT re-pin it to
// a non-zero worst without that ruling, which would hide a possibly mis-authored swing.
//
// Run: node tools/start-facing-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf, levelsAvailable } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const movesXml = fs.readFileSync(path.join(corpusRoot(), 'moves.xml'), 'utf8');
const formationsXml = fs.readFileSync(path.join(corpusRoot(), 'formations.xml'), 'utf8');
const LEVELS = levelsAvailable().filter((level) => level !== 'src');
const DEG = Math.PI / 180;
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (r) => (norm(r) * 180) / Math.PI;
const fmt = (n) => (Math.round(n * 1e6) / 1e6).toString();

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

function* calls() {
  for (const level of LEVELS) {
    const dir = path.join(corpusRoot(), level);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of filesOf(level)) {
      if (!f.endsWith('.xml')) continue;
      let call;
      try {
        call = engine.normalizeInstance(
          engine.loadCallFromXml(fs.readFileSync(path.join(dir, f), 'utf8'), movesXml, formationsXml, 0),
        );
      } catch { continue; }
      yield { where: `${level}/${f}`, call };
    }
  }
}

// ------------------------------------------------------------------ the OLD rule, kept as the control
//
// `poseFor`, mirrored, with the facing read as the RAW tangent - which is what it did before the fix.
// Section 2 compares this to the real `poseFor` to show the change is invisible to the corpus, and
// section 5 lists every sample where the two disagree, which is the population the fix is FOR.
function poseOld(dancer, t, headingMode = 'rotation') {
  const start = engine.fromPosAngle(dancer.x, dancer.y, dancer.angleDeg * DEG);
  let m = start;
  let rem = t;
  let heading = Math.atan2(start.sin, start.cos);
  let travelHeading = heading;
  for (const s of dancer.path) {
    if (rem <= 0) break;
    const local = Math.min(rem, s.beats);
    const tt = s.beats > 0 ? local / s.beats : 0;
    const segStartHeading = heading;
    travelHeading = segStartHeading + engine.bezierAngle(s.translate, tt);
    const pt = engine.bezierPoint(s.translate, tt);
    m = engine.mul(m, engine.translateBy(pt.x, pt.y));
    m = engine.mul(m, engine.rotateBy(engine.bezierAngle(s.rotate ?? s.translate, tt)));
    heading = Math.atan2(m.sin, m.cos);
    rem -= local;
  }
  const finalHeading = headingMode === 'travel' ? travelHeading : heading;
  if (dancer.mirror) return { heading: norm(finalHeading + Math.PI) };
  return { heading: finalHeading };
}

const z = (n) => ({ x: n.x, y: n.y });

// ------------------------------------------------------------------ 1. why the change is invisible
console.log('== 1. what the corpus\'s own curves do at t=0 (the reason the two readings agreed) ==');
let nRot = 0;
let nNoFacing = 0;
let worstRot0 = 0;
let worstNoFacing0 = 0;
for (const { call } of calls()) {
  for (const d of call.dancers) {
    for (const s of d.path) {
      if (s.rotate) {
        nRot++;
        worstRot0 = Math.max(worstRot0, Math.abs(engine.bezierAngle(s.rotate, 0)));
      } else {
        nNoFacing++;
        worstNoFacing0 = Math.max(worstNoFacing0, Math.abs(engine.bezierAngle(s.translate, 0)));
      }
    }
  }
}
console.log(`    ${nRot} facing curves and ${nNoFacing} moves with no facing, over ${[...calls()].length} calls.`);
check(nRot > 3000 && nNoFacing > 3000, `both populations are big enough to mean something (${nRot} / ${nNoFacing})`);
check(worstRot0 === 0, `every FACING curve starts at exactly 0 (worst ${worstRot0}) - it is authored as a turn`);
check(worstNoFacing0 === 0,
  `and so does every move with NO facing (worst ${worstNoFacing0}) - the corpus only ever walks forward along +X`);

// ------------------------------------------------------------------ 2. the change is a no-op on the corpus
console.log('\n== 2. the corpus under the fix: is any shipped animation different? ==');
let worstCorpus = 0;
let worstCorpusAt = null;
let samples = 0;
for (const { where, call } of calls()) {
  for (const d of call.dancers) {
    const total = d.path.reduce((s, x) => s + x.beats, 0);
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * total;
      samples++;
      const gap = Math.abs(deg(engine.poseFor(d, t).heading - poseOld(d, t).heading));
      if (gap > worstCorpus) { worstCorpus = gap; worstCorpusAt = `${where} at beat ${t.toFixed(2)}`; }
    }
  }
}
console.log(`    ${samples} heading samples over every dancer of every call.`);
check(samples > 50000, `the sweep is every shipped pose, not a witness (${samples} samples)`);
check(worstCorpus === 0,
  `NOT ONE shipped heading moved - the fix is invisible to the corpus${worstCorpus ? ` (worst ${fmt(worstCorpus)}deg at ${worstCorpusAt})` : ''}`);

// ------------------------------------------------------------------ 3. the snap the report is about
console.log('\n== 3. an AUTHORED move that does not leave along the dancer\'s own facing ==');

const baseCall = engine.normalizeInstance(
  engine.loadCallFromXml(fs.readFileSync(path.join(corpusRoot(), 'a1/as_couples.xml'), 'utf8'), movesXml, formationsXml, 0),
);
// Sound curves, each with a well-defined tangent at BOTH ends. `snap` is the heading jump across the
// move's own start - the thing the report calls "strange rotation behaviour at the transition".
const SHAPES = [
  { name: 'forward   (+X)  ', t: { cx1: 1 / 3, cy1: 0, cx2: 2 / 3, cy2: 0, x2: 1, y2: 0 } },
  { name: 'sidestep  (+90) ', t: { cx1: 0, cy1: 1 / 3, cx2: 0, cy2: 2 / 3, x2: 0, y2: 1 } },
  { name: 'sidestep  (-90) ', t: { cx1: 0, cy1: -1 / 3, cx2: 0, cy2: -2 / 3, x2: 0, y2: -1 } },
  { name: 'back up   (180) ', t: { cx1: -1 / 3, cy1: 0, cx2: -2 / 3, cy2: 0, x2: -1, y2: 0 } },
  { name: 'quarter turn   ', t: { cx1: 1 / 3, cy1: 0, cx2: 1, cy2: 0, x2: 1, y2: 1 } },
  { name: 'quarter turn - ', t: { cx1: 1 / 3, cy1: 0, cx2: 1, cy2: 0, x2: 1, y2: -1 } },
];

let worstSnapNow = 0;
let worstSnapOld = 0;
let worstTurnErr = 0;
for (const shape of SHAPES) {
  const seg = { beats: 1, hands: 'none', translate: shape.t, rotate: null };
  const after = engine.addMove(baseCall, 0, seg);
  const d = after.dancers[0];
  const n = d.path.length;
  const b = d.path.slice(0, n - 1).reduce((a, x) => a + x.beats, 0);
  const arrive = engine.poseFor(d, b - 1e-9).heading;
  const startNow = engine.poseFor(d, b + 1e-9).heading;
  const startOld = poseOld(d, b + 1e-9).heading;
  const snapNow = Math.abs(deg(startNow - arrive));
  const snapOld = Math.abs(deg(startOld - arrive));
  worstSnapNow = Math.max(worstSnapNow, snapNow);
  worstSnapOld = Math.max(worstSnapOld, snapOld);
  // AND THE TURN IS THE PATH'S OWN TURN: the facing moves by exactly what the travel curve turns through.
  const pathTurn = deg(engine.bezierAngle(shape.t, 1) - engine.bezierAngle(shape.t, 0));
  const facingTurn = deg(engine.poseFor(d, b + 1).heading - arrive);
  worstTurnErr = Math.max(worstTurnErr, Math.abs(facingTurn - pathTurn));
  console.log(
    `    ${shape.name}: arrives ${deg(arrive).toFixed(1).padStart(7)}deg  ->  ` +
      `snap ${snapNow.toFixed(1).padStart(6)}deg now (was ${snapOld.toFixed(1).padStart(6)}deg), ` +
      `turns ${facingTurn.toFixed(1).padStart(6)}deg against a path turn of ${pathTurn.toFixed(1).padStart(6)}deg`,
  );
}
check(worstSnapNow < 1e-6, `NO shape snaps at the move's start any more (worst ${fmt(worstSnapNow)}deg)`);
check(worstSnapOld > 89, `and the rule this replaced snapped by up to ${fmt(worstSnapOld)}deg on the same shapes`);
check(worstTurnErr < 1e-6,
  `the facing turns by exactly the PATH's own turn, so the heading continues from the previous move (worst ${fmt(worstTurnErr)}deg)`);

// ------------------------------------------------------------------ 4. ticking `explicit` changes nothing
console.log('\n== 4. the panel seeds a new facing by COPYING the travel curve - does that stay a no-op? ==');
{
  const shape = { cx1: 0, cy1: 1 / 3, cx2: 0, cy2: 2 / 3, x2: 0, y2: 1 };
  const plain = engine.addMove(baseCall, 0, { beats: 1, hands: 'none', translate: shape, rotate: null });
  const ticked = engine.addMove(baseCall, 0, { beats: 1, hands: 'none', translate: shape, rotate: { ...shape } });
  let worst = 0;
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * plain.beats;
    worst = Math.max(worst, Math.abs(deg(engine.poseFor(plain.dancers[0], t).heading - engine.poseFor(ticked.dancers[0], t).heading)));
  }
  check(worst === 0,
    `an unticked move and the same move with \`explicit\` ticked are the SAME animation (worst ${fmt(worst)}deg), so the copy is a faithful seed rather than an edit`);
}

// ------------------------------------------------------------------ 5. the mode this deliberately does NOT change
console.log('\n== 5. `travel` heading mode is untouched, because absolute IS what that mode means ==');
{
  const shape = { cx1: 0, cy1: 1 / 3, cx2: 0, cy2: 2 / 3, x2: 0, y2: 1 };
  const after = engine.addMove(baseCall, 0, { beats: 1, hands: 'none', translate: shape, rotate: null });
  const d = after.dancers[0];
  const n = d.path.length;
  const b = d.path.slice(0, n - 1).reduce((a, x) => a + x.beats, 0);
  // In `travel` mode the heading at the move's start is still the ABSOLUTE departure direction, which for a
  // sidestep is a hard 90 degrees from the arrival - unchanged, and unchanged on purpose.
  const arriveRot = engine.poseFor(d, b - 1e-9).heading;
  const startTravel = engine.poseFor(d, b + 1e-9, 'travel').heading;
  const startRot = engine.poseFor(d, b + 1e-9).heading;
  console.log(`    arrives ${deg(arriveRot).toFixed(1)}deg | 'rotation' starts ${deg(startRot).toFixed(1)}deg | 'travel' starts ${deg(startTravel).toFixed(1)}deg`);
  check(Math.abs(deg(startTravel - arriveRot) - 90) < 1,
    `'travel' still faces the instantaneous direction of motion absolutely (${deg(startTravel - arriveRot).toFixed(1)}deg off the arrival, unchanged)`);
  check(Math.abs(deg(startRot - arriveRot)) < 1e-6, `while 'rotation' now continues the arrival (${deg(startRot - arriveRot).toFixed(6)}deg)`);
}

// ------------------------------------------------------------------ 6. the source, so this cannot rot
console.log('\n== 6. the rule in the source ==');
{
  const core = fs.readFileSync(path.join(POC_DIR, '..', 'engine/src/core.ts'), 'utf8');
  check(/const facing = s\.rotate \?\? s\.translate;\s*\n\s*const a = curveAngle\(facing, tt\) - departureAngle\(facing\);/.test(core),
    '`poseFor` reads the facing as a turn: the curve\'s angle at t, less the direction the curve departs in');
  check(/A FACING CURVE IS A TURN, AND A TURN STARTS AT ZERO/.test(core),
    'and says so, with the reason the corpus could not tell the difference');
  check(!/const a = bezierAngle\(s\.rotate \?\? s\.translate, tt\);/.test(core),
    'the raw-tangent reading is gone, not merely shadowed');
  // AND THE DATUM IS NOT A RAW `bezierAngle(..., 0)`: that is the `atan2(0, 0)` the departure rule replaced, and a
  // curve at rest is exactly what a hold is (`engine/test/departure-angle.mjs`).
  check(!/const a = .*bezierAngle\(facing, 0\)/.test(core),
    'and the datum is the departure rule, not `bezierAngle(facing, 0)` - which is `atan2(0, 0)` on a curve at rest');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
