// Headless verification against the dancing-squared-engine package (built dist).
// Usage: node verify.cjs  (engine must be built: run `npm run build` in ../engine)
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

// Use the engine's built ESM dist (Node >= 22 can require ESM).
const eng = require('../engine/dist/index.js');
eng.setParser(DOMParser);

const { loadCallFromXml, callMeta, parseMoves, buildCallVariants } = eng;
const { poseFor, dancerBeats, allPoses, computeHandholds } = eng;

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const movesXml = read('../assets/moves.xml');
const formationsXml = read('../assets/formations.xml');

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
}
function isFiniteNum(n) { return typeof n === 'number' && Number.isFinite(n); }

/**
 * EVERY `<tam>` in a call file that BUILDS, with the `title` and `from` it declares.
 *
 * THE PLURAL READING OF THE LOADER'S SELECTOR, and it exists because a selector that names a call is
 * not always unique. `from` distinguishes the Allemande Left tams from one another, but it does not
 * make them unique: `50d3e95` ("retire b1/b2 into ms 2026") migrated a SECOND authoring of
 * `Allemande Left` `from="Left-Hand Waves"` into `ms/allemande.xml`, so `{ title, from }` now matches
 * two tams and `selectTam` refuses to guess which - correctly, and at the cost of the whole gate,
 * which used to die at the throw with nothing after it measured.
 *
 * A probe asserting a property of a call wants the plural reading anyway: the property has to hold for
 * every way the corpus dances it, not for whichever tam the resolver would have picked.
 *
 * A FILE THAT CANNOT BUILD AT ALL IS REPORTED, NOT THROWN. `buildCallVariants` has no per-tam
 * tolerance (unlike the library's `loadVariants`, which records each failure), so one bad tam would
 * otherwise kill the run - the same "the gate dies and measures nothing" fault this helper exists to
 * undo. MEASURED: the only two un-buildable tams in the shipped corpus are `Ferris Wheel` and
 * `Couples Circulate` (both naming `T-Bone Couples`), and neither is in a file this gate reads.
 */
function listAuthorings(file, xml, movesXml, formationsXml) {
  try {
    return buildCallVariants(xml, movesXml, formationsXml, true);
  } catch (e) {
    check(false, `${file} cannot be built at all: ${e.message}`);
    return [];
  }
}

/**
 * THE CALL SELECTORS THIS FILE LOADS BY NAME ARE PINNED AS NAMED CHECKS, not left as a throw inside a load.
 *
 * WHY. Each of them names ONE tam today, and that is a fact about the CORPUS rather than about the selector: a second
 * authoring of the same call, from the same setup, makes `selectTam` refuse - correctly, it will not guess - and the
 * refusal is a THROW in the middle of this file, so everything after it measures nothing (AGENTS §11.2.1). That is
 * exactly what happened when `50d3e95` migrated a second `Allemande Left` from `Left-Hand Waves` into
 * `ms/allemande.xml`: the gate died at the throw and the checks below never ran.
 *
 * So the uniqueness is asserted FIRST, one line per selector, and a corpus edit that breaks one of them produces a
 * named FAIL next to the selector instead of an exception. The predicate is the engine's own `selectTam` - re-counting
 * the match here would be a copy of the rule that picks the tam (AGENTS §5) - and its message already names the count.
 *
 * THE SIXTH SELECTOR, `end-spin-probe.mjs`'s `Right and Left Grand` from `Quarter Tag Facing`, is pinned the same way
 * in that probe; it is listed here because the census that found this item counted six.
 */
const SINGULAR_SELECTORS = [
  ['../assets/a1/brace_thru.xml', { title: 'Brace Thru', from: 'Lines, Boys Ends' }],
  ['../assets/ms/pass_thru.xml', { title: 'Pass Thru', from: 'Lines', formation: 'Normal Lines' }],
  ['../assets/ms/circle.xml', { title: 'Circle Left', formation: 'Static Square' }],
  ['../assets/ms/wheel_around.xml', { title: 'Wheel Around', from: 'Lines' }],
  ['../assets/ms/right_and_left_grand.xml', { title: 'Right and Left Grand', from: 'Quarter Tag Facing' }],
];
console.log('== the call selectors this gate loads by name are still unique ==');
for (const [file, selector] of SINGULAR_SELECTORS) {
  let refusal = null;
  try {
    eng.selectTam(eng.parseCallXml(read(file)), selector);
  } catch (e) {
    refusal = e.message;
  }
  const named = `${JSON.stringify(selector)} in ${file}`;
  check(refusal === null, refusal === null
    ? `${named} still names exactly one tam, so the load below cannot throw`
    : `${named} no longer names ONE tam: ${refusal}`);
}

// ------------------------------------------------------------- move resolution
console.log('== Move registry resolution ==');
const moves = parseMoves(movesXml);
check(moves.size > 50, `moves registry has ${moves.size} named paths`);

// Half-group call: Brace Thru "Lines, Boys Ends" is authored for ONE line of 4.
// With mirroring ON it should expand to the full two-line setup (8 dancers).
const beau = loadCallFromXml(read('../assets/a1/brace_thru.xml'), movesXml, formationsXml, { title: 'Brace Thru', from: 'Lines, Boys Ends' }); // mirror default ON
const beauHalf = loadCallFromXml(read('../assets/a1/brace_thru.xml'), movesXml, formationsXml, { title: 'Brace Thru', from: 'Lines, Boys Ends' }, false);

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
// SELECTED BY ITS `from`, NOT BY AN INDEX, and that is the whole of this change.
//
// This read `tamIndex: 1`, which WAS the `Lines` authoring - until a hand-added `from="Facing
// Couples"` variant was inserted at index 1 (the separation-2 tam the published get-outs need; the
// asset carries its own comment). Inserting it silently moved this test onto a TWO-dancer
// facing-couples PAIR, and the three checks below went red saying "Pass Thru half has 2 dancers" -
// true of the tam it loaded, and wrong about the one it meant. The numbers here (4 half, 8 mirrored,
// a line of four all holding hands) describe the `Normal Lines` authoring and nothing else, so the
// lookup names it. A position into an authored list is not an identity: the pair authoring is a
// legitimate 2-written shape (2 declares 4), so the tam was never the thing at fault.
const passXml = read('../assets/ms/pass_thru.xml');
// NAMED, NOT NUMBERED, and the loader is what enforces it now: the selector resolves title + formation +
// from together and THROWS if that authoring is gone, which is stricter than the findIndex it replaces -
// the old code checked an index and then passed it on, so a later insertion could still move it.
const passName = { title: 'Pass Thru', from: 'Lines', formation: 'Normal Lines' };
const passHalf = loadCallFromXml(passXml, movesXml, formationsXml, passName, false);
const pass = loadCallFromXml(passXml, movesXml, formationsXml, passName);
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
const circle = loadCallFromXml(read('../assets/ms/circle.xml'), movesXml, formationsXml, { title: 'Circle Left', formation: 'Static Square' }); // Circle Left, mirrored
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
const allemandeXml = read('../assets/ms/allemande.xml');
// EVERY AUTHORING from that board, not the first. `from` tells the Allemande Left tams apart from
// each other but does NOT make one unique - see `listAuthorings` - and the hand-hold property below
// has to hold for every way the corpus dances the call, so the plural reading is the one it wants.
const allemande = listAuthorings('ms/allemande.xml', allemandeXml, movesXml, formationsXml);
for (const from of ['Left-Hand 3/4 Tag', 'Left-Hand Waves', 'Static Square']) {
  const authored = allemande.filter((v) => v.title === 'Allemande Left' && v.from === from);
  // AN EMPTY LIST IS A FAILURE, NOT A PASS: a `from` the corpus no longer authors would otherwise
  // test nothing at all and read as green.
  check(authored.length > 0, `the corpus authors Allemande Left from "${from}" (${authored.length} authoring(s))`);
  authored.forEach((al, k) => {
    const aposes = al.dancers.map((d) => poseFor(d, al.beats * 0.55));
    const aholds = computeHandholds(aposes, 'active');
    const adeg = new Array(al.dancers.length).fill(0);
    aholds.forEach((h) => { adeg[h.i]++; adeg[h.j]++; });
    const maxDeg = Math.max(0, ...adeg);
    check(maxDeg <= 1, `Allemande (${from}${authored.length > 1 ? `, authoring ${k + 1} of ${authored.length}` : ''}) each dancer holds at most 1 partner (maxDeg=${maxDeg})`);
  });
}

// Wheel Around: each couple wheels together and must NOT grab the opposite
// couple. Throughout the move each dancer holds only its wheel partner (so the
// partner pairs stay constant and every dancer's degree is 1).
console.log('== Wheel Around (couples stay paired) ==');
const wheel = loadCallFromXml(read('../assets/ms/wheel_around.xml'), movesXml, formationsXml, { title: 'Wheel Around', from: 'Lines' }, true); // Lines, mirrored
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
// THE DIRECTORIES ARE THE LEVELS, so the scan asks the corpus rather than carrying a list: this one named `b1` and
// `b2` for years after both were retired, and `filesOf`-style emptiness made that silent (the loop skipped them).
const assetsDir = path.join(__dirname, '../assets');
const levels = fs.readdirSync(assetsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((l) => l !== 'src');
let total = 0;
let loaded = 0;
const failures2 = [];
for (const lv of levels) {
  const dir = path.join(__dirname, '../assets', lv);
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
