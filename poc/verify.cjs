// Headless verification against the dancing-squared-engine package (built dist).
// Usage: node verify.cjs  (engine must be built: run `npm run build` in ../engine)
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

// Use the engine's built ESM dist (Node >= 22 can require ESM).
const eng = require('../engine/dist/index.js');
eng.setParser(DOMParser);

const { loadCallFromXml, callMeta, parseMoves, parseCallXml } = eng;
const { poseFor, dancerBeats, allPoses, computeHandholds } = eng;

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const movesXml = read('src/assets/moves.xml');
const formationsXml = read('src/assets/formations.xml');

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
}
function isFiniteNum(n) { return typeof n === 'number' && Number.isFinite(n); }

// ------------------------------------------------------------- move resolution
console.log('== Move registry resolution ==');
const moves = parseMoves(movesXml);
check(moves.size > 50, `moves registry has ${moves.size} named paths`);

// Half-group call: Brace Thru "Lines, Boys Ends" is authored for ONE line of 4.
// With mirroring ON it should expand to the full two-line setup (8 dancers).
const beau = loadCallFromXml(read('src/assets/a1/brace_thru.xml'), movesXml, formationsXml, 0); // mirror default ON
const beauHalf = loadCallFromXml(read('src/assets/a1/brace_thru.xml'), movesXml, formationsXml, 0, false);

console.log('== Brace Thru (Lines, Boys Ends) ==');
check(beauHalf.dancers.length === 4, `Brace Thru half has ${beauHalf.dancers.length} dancers (expect 4)`);
check(beau.dancers.length === 8, `Brace Thru full (mirrored) has ${beau.dancers.length} dancers (expect 8)`);
check(beau.beats > 0, `Brace Thru max beats = ${beau.beats.toFixed(2)}`);
check(beau.totalBeats === beau.leadin + beau.beats + beau.leadout, 'totalBeats = leadin+beats+leadout');
beauHalf.dancers.forEach((d, i) => {
  const p0 = poseFor(d, 0);
  const pe = poseFor(d, d.path.reduce((s, x) => s + x.beats, 0));
  const moved = Math.hypot(pe.x - p0.x, pe.y - p0.y);
  check(isFiniteNum(p0.x) && isFiniteNum(pe.x) && isFiniteNum(pe.heading), `dancer ${i} poses are finite`);
  check(moved > 0.001, `dancer ${i} moves ${moved.toFixed(2)} units`);
  console.log(`    dancer ${i} ${d.gender.padEnd(6)} start(${p0.x.toFixed(2)},${p0.y.toFixed(2)}) -> end(${pe.x.toFixed(2)},${pe.y.toFixed(2)}) heading ${(pe.heading * 180 / Math.PI).toFixed(0)}deg`);
});
const gripHands = beauHalf.dancers.some((d) => d.path.some((s) => /grip/.test(s.hands)));
check(gripHands, 'Brace Thru resolves hand holds (grip* segments present)');

// Starting formation is a line of 4 -> all dancers hold hands along the line,
// derived geometrically from the data (positions + facing + hands).
console.log('== Start line hand holds (derived from data) ==');
const startPoses = beauHalf.dancers.map((d) => poseFor(d, 0));
const startHolds = computeHandholds(startPoses, 'static');
const startEdges = startHolds.map((h) => [h.i, h.j]);
const covered = new Set(startEdges.flat());
check(startEdges.length === 3, `start line derives ${startEdges.length} hand holds (expect 3 for a line of 4)`);
check(covered.size === 4, `all ${covered.size} dancers are joined in the start line (expect 4)`);

// Ending formation is also a line -> all dancers hold hands (static mode).
console.log('== End line hand holds (static mode) ==');
const endPoses = beauHalf.dancers.map((d) => poseFor(d, beauHalf.beats));
const endHolds = computeHandholds(endPoses, 'static');
const endEdges = endHolds.map((h) => [h.i, h.j]);
const endCovered = new Set(endEdges.flat());
check(endEdges.length === 3, `end line derives ${endEdges.length} hand holds (expect 3 for a line of 4)`);
check(endCovered.size === 4, `all ${endCovered.size} dancers are joined in the end line (expect 4)`);

// Mirror symmetry: dancer i and its duplicate partner i+4 are a 180-degree
// rotation about the origin (both x and y negated).
console.log('== Duplicate-half symmetry (180deg rotation about origin) ==');
let symOk = true;
for (const t of [0, beau.beats * 0.5, beau.beats]) {
  for (let i = 0; i < 4; i++) {
    const a = poseFor(beau.dancers[i], t, 'rotation');
    const b = poseFor(beau.dancers[i + 4], t, 'rotation');
    if (Math.abs(a.x + b.x) > 1e-6 || Math.abs(a.y + b.y) > 1e-6) { symOk = false; }
  }
}
check(symOk, 'duplicate dancer poses are 180-degree rotations (x and y negated)');

// Forward/backward walking during the wheel is deducible from the data: the
// man's movement (Beau Wheel = a "BackRun") faces ~180deg from his travel
// tangent (he backs up), while the woman (Belle Wheel) faces along travel.
console.log('== Forward/backward walking (deduced from rotation vs travel) ==');
const boy = beauHalf.dancers[0];
const girl = beauHalf.dancers[1];
const tWheel = 4.5; // mid-wheel for Brace Thru (segment 2 runs beats 3..6)
const angDiff = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const boyRot = poseFor(boy, tWheel, 'rotation').heading;
const boyTrav = poseFor(boy, tWheel, 'travel').heading;
const girlRot = poseFor(girl, tWheel, 'rotation').heading;
const girlTrav = poseFor(girl, tWheel, 'travel').heading;
check(angDiff(boyRot, boyTrav) > 2.5, `Brace Thru boy faces ~opposite travel (backs up); diff=${(angDiff(boyRot, boyTrav) * 180 / Math.PI).toFixed(0)}deg`);
check(angDiff(girlRot, girlTrav) < 0.5, `Brace Thru girl faces ~along travel (walks forward); diff=${(angDiff(girlRot, girlTrav) * 180 / Math.PI).toFixed(0)}deg`);

// 3D chirality consistency. The 2D->3D mapping is (x, y) -> (x, 0, -y) with
// rotation.y = +heading. Under that mapping a dancer's body must rotate in the
// SAME sense as its orbit (its nose aligned with the 3D velocity for a forward
// walker, opposite for a backer-up). This guards against the chirality bug
// where the body rotated opposite to the orbit.
console.log('== 3D chirality (body rotation matches orbit) ==');
const mapped = (p) => ({ x: p.x, z: -p.y, fx: Math.cos(p.heading), fz: -Math.sin(p.heading) });
const travel3 = (spec, t) => {
  const dt = 0.02;
  const a = poseFor(spec, t, 'rotation');
  const b = poseFor(spec, Math.min(t + dt, beau.beats), 'rotation');
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy) || 1;
  return { vx: vx / len, vz: -vy / len };
};
const align = (f, v) => f.fx * v.vx + f.fz * v.vz;
const g3 = mapped(poseFor(girl, tWheel, 'rotation'));
const gv = travel3(girl, tWheel);
const b3 = mapped(poseFor(boy, tWheel, 'rotation'));
const bv = travel3(boy, tWheel);
check(align(g3, gv) > 0.9, `girl body points along her 3D orbit; cos=${align(g3, gv).toFixed(2)}`);
check(align(b3, bv) < -0.9, `boy body points opposite his 3D orbit (backs up); cos=${align(b3, bv).toFixed(2)}`);

// ------------------------------------------------------------- pass thru
console.log('== Pass Thru (Normal Lines) ==');
const passHalf = loadCallFromXml(read('src/assets/ms/pass_thru.xml'), movesXml, formationsXml, 1, false);
const pass = loadCallFromXml(read('src/assets/ms/pass_thru.xml'), movesXml, formationsXml, 1);
check(passHalf.dancers.length === 4, `Pass Thru half has ${passHalf.dancers.length} dancers (expect 4)`);
check(pass.dancers.length === 8, `Pass Thru full (mirrored) has ${pass.dancers.length} dancers (expect 8)`);
passHalf.dancers.forEach((d, i) => {
  const p0 = poseFor(d, 0);
  const pe = poseFor(d, d.path.reduce((s, x) => s + x.beats, 0));
  const moved = Math.hypot(pe.x - p0.x, pe.y - p0.y);
  check(moved > 0.001, `dancer ${i} moves ${moved.toFixed(2)} units`);
  console.log(`    dancer ${i} ${d.gender.padEnd(6)} start(${p0.x.toFixed(2)},${p0.y.toFixed(2)}) -> end(${pe.x.toFixed(2)},${pe.y.toFixed(2)})`);
});
// During the pass (active mode) no dancers hold hands; at the start/end lines
// (static mode) they form a line and all hold hands.
const passMid = passHalf.dancers.map((d) => poseFor(d, 1));
check(computeHandholds(passMid, 'active').length === 0, 'Pass Thru mid-move shows no active hand holds');
const passStart = passHalf.dancers.map((d) => poseFor(d, 0));
const passStartHolds = computeHandholds(passStart, 'static');
check(passStartHolds.length === 3 && new Set(passStartHolds.flatMap((h) => [h.i, h.j])).size === 4, 'Pass Thru start line shows all dancers holding hands (static)');

// Circle Left: all 8 dancers hold hands in a ring as they circle.
console.log('== Circle Left ring (deduced from data) ==');
const circle = loadCallFromXml(read('src/assets/ms/circle.xml'), movesXml, formationsXml, 0); // Circle Left, mirrored
const cposes = circle.dancers.map((d) => poseFor(d, circle.beats * 0.5));
const cholds = computeHandholds(cposes, 'active');
const cdeg = new Array(circle.dancers.length).fill(0);
cholds.forEach((h) => { cdeg[h.i]++; cdeg[h.j]++; });
check(circle.dancers.length === 8, `Circle Left full has ${circle.dancers.length} dancers (expect 8)`);
check(cholds.length === 8, `Circle Left derives ${cholds.length} holds (expect 8 for a ring)`);
check(cdeg.every((d) => d === 2), 'every dancer holds exactly 2 neighbours (a ring)');

// Allemande Left: during the swing each dancer reaches only its ONE corner —
// no cross-group connections (regression: wide side-tolerance used to over-connect).
console.log('== Allemande Left (no cross-group holds) ==');
const allemandeXml = read('src/assets/ms/allemande.xml');
const alTams = parseCallXml(allemandeXml);
for (const from of ['Left-Hand 3/4 Tag', 'Left-Hand Waves', 'Static Square']) {
  const idx = alTams.findIndex((t) => t.from === from);
  const al = loadCallFromXml(allemandeXml, movesXml, formationsXml, idx, true);
  const aposes = al.dancers.map((d) => poseFor(d, al.beats * 0.55));
  const aholds = computeHandholds(aposes, 'active');
  const adeg = new Array(al.dancers.length).fill(0);
  aholds.forEach((h) => { adeg[h.i]++; adeg[h.j]++; });
  const maxDeg = Math.max(0, ...adeg);
  check(maxDeg <= 1, `Allemande (${from}) each dancer holds at most 1 partner (maxDeg=${maxDeg})`);
}

// Wheel Around: each couple wheels together and must NOT grab the opposite
// couple. Throughout the move each dancer holds only its wheel partner (so the
// partner pairs stay constant and every dancer's degree is 1).
console.log('== Wheel Around (couples stay paired) ==');
const wheel = loadCallFromXml(read('src/assets/ms/wheel_around.xml'), movesXml, formationsXml, 2, true); // Lines, mirrored
const wheelPairs = ['0-1', '2-3', '4-5', '6-7'];
let wheelOk = true;
for (let k = 0; k <= 20; k++) {
  const wposes = wheel.dancers.map((d) => poseFor(d, (k / 20) * wheel.beats));
  const wholds = computeHandholds(wposes, 'active').map((h) => `${Math.min(h.i, h.j)}-${Math.max(h.i, h.j)}`);
  const wdeg = new Array(wheel.dancers.length).fill(0);
  computeHandholds(wposes, 'active').forEach((h) => { wdeg[h.i]++; wdeg[h.j]++; });
  const expected = wheelPairs.filter((p) => wholds.includes(p));
  if (wholds.length !== wheelPairs.length || expected.length !== wheelPairs.length || wdeg.some((d) => d > 1)) wheelOk = false;
}
check(wheelOk, 'Wheel Around: the four couples stay paired throughout (no opposite-couple holds)');

// ------------------------------------------------------------- motion sanity
console.log('== Motion sanity (mid-beat interpolation) ==');
const mid = poseFor(beau.dancers[0], beau.beats / 2);
check(isFiniteNum(mid.x) && isFiniteNum(mid.y) && isFiniteNum(mid.heading), 'mid-call pose is finite');

// Validate that during lead-in (negative beat) the dancer holds start.
const lead = poseFor(beau.dancers[0], -5);
const pstart = poseFor(beau.dancers[0], 0);
check(Math.abs(lead.x - pstart.x) < 1e-9 && Math.abs(lead.y - pstart.y) < 1e-9, 'lead-in holds starting position');

// ------------------------------------------------------------- catalog scan
// Try to load every call across all levels (mirroring ON) to prove the
// pipeline scales to the full catalog.
console.log('== Catalog scan (all levels) ==');
const levels = ['b1', 'b2', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
let total = 0;
let loaded = 0;
const failures2 = [];
for (const lv of levels) {
  const dir = path.join(__dirname, 'src/assets', lv);
  if (!fs.existsSync(dir)) continue;
  let n = 0;
  let ok = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.xml')) continue;
    const xml = fs.readFileSync(path.join(dir, f), 'utf8');
    // Skip non-call files (moves definitions / rule references: no <tam>).
    if (callMeta(xml).setups.length === 0) continue;
    n++;
    try {
      loadCallFromXml(xml, movesXml, formationsXml, 0);
      ok++;
    } catch (e) {
      failures2.push(`${lv}/${f}: ${e.message}`);
    }
  }
  total += n;
  loaded += ok;
  console.log(`  ${lv.padEnd(5)} ${ok}/${n} loadable`);
}
check(loaded === total, `all ${loaded}/${total} catalog calls load without error`);
if (failures2.length) {
  console.log('  failures:');
  for (const m of failures2.slice(0, 10)) console.log(`    - ${m}`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
