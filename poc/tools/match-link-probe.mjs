// Probe: THE MATCH LINK - does pressing the paperclip actually give the dancer the other one's trace?
//
// Asked for: "If I select one, I'd expect the paperclip symbol for the another dancer to copy the correct
// dancers Moves and settings, with appropriate transforms, to the paper-clip trace. It should clone a good
// trace to another dancer."
//
// THE FIRST VERSION OF THIS PROBE COULD NOT FAIL, and that is worth recording because it is the reason the
// feature looked gated while it was wrong. It compared the copy against THE VERY CURVE IT WAS COPIED FROM -
// `sameCurve(ref, applyMatch(seg, ref, curve), curve)` - so "the copy matches in 4632 of 4632" was a
// statement about a value being equal to itself. It never re-read the XML, never looked at a move the
// gesture did not touch, and never asked whether the TRACE was the same. A gate has to be able to say no.
//
// So this measures four things, each of which can come out wrong:
//
//   1. THE WIRING. One method clones a whole path through the engine's `setDancerPath`; the link is offered
//      on a WHOLE-TRACE comparison and reads neither the tab nor the move index.
//   2. THE GAP CLOSES. Over the corpus, every (donor, target) pair is the same trace afterwards - compared
//      move for move, with beats and hands - and the target's path is VALUE-EQUAL to the donor's.
//   3. IT SURVIVES THE FORMAT. Export the cloned call and read it back: the two traces are STILL the same.
//      This is the leg that would catch a copy the tamination format cannot carry.
//   4. THE MUTATION. The OLD copy - one curve of the move on screen - leaves a counted number of pairs
//      still not the same trace, with witnesses, so "whole trace" is a number rather than a preference.
//
// Run: node tools/match-link-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
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

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// ============================================================ 1. the wiring
console.log('== 1. Is the link wired to the rule this probe mirrors? ==');
const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
const has = (re, msg) => check(re.test(ui), msg);
has(/private matchDancer\(i: number\)/, 'there is one method that clones a trace, and it takes a dancer - NOT a curve');
has(/this\.commit\(setDancerPath\(call, i, donor\.path\)\)/,
  'which goes through the engine\'s `setDancerPath`: every move at once, not one curve of the move on screen');
has(/if \(donorPath && !sameTrace\(donorPath, r\.moves\)\)/,
  "the link is offered on every dancer whose trace is NOT the reference's - INCLUDING A SELECTED ONE THAT DISAGREES, which is what makes it the way to RESOLVE a mismatch rather than only a way to widen an agreeing set");
check(!/tracesAgree/.test(ui), 'and the old "the whole selection must already agree" premise is gone, because that is exactly the state in which the caller cannot use it');
has(/link\.addEventListener\('click', \(\) => this\.matchDancer\(i\)\)/, 'and clicking it calls that method with the dancer alone');
has(/this\.selectedDancers\.add\(i\);/, 'which SELECTS the dancer, which is the second half of what was asked for');
has(/function sameTrace\(a: Seg\[\], b: Seg\[\]\): boolean \{\s*\n\s*if \(a\.length !== b\.length\) return false;[\s\S]{0,400}?a\[k\]\.beats !== b\[k\]\.beats \|\| a\[k\]\.hands !== b\[k\]\.hands/,
  'and "the same trace" is the gate\'s own per-move comparison over a whole path: the same number of moves, the same travel, the same turn, the same beats and the same hands');
has(/const SHAPE_WINDOW = 0\.025;/, 'the travel window is 0.025 units');
has(/const FACING_WINDOW_DEG = 0\.5;/, 'and the facing window is half a degree');
// THE STALE-TAB BUG, GATED AS AN ABSENCE. `renderInstance` draws the table BEFORE `renderMoveStrip` normalises
// a stale `moveKind`, so a link drawn from the tab was offered for a facing curve the panel was about to stop
// editing. A whole-trace question has no move index, and this is what says so.
{
  const row = ui.slice(ui.indexOf('private formationRow('), ui.indexOf('private readCell('));
  check(row.length > 0, 'the formation row was found, so the next check is about the link rather than about nothing');
  check(!/tabCurve\(|matchingDancers\(|coordinatesAgree\(|linkCurve/.test(row),
    'the link\'s own condition reads neither the tab nor the move index, so it cannot disagree with the `matching` button about which curve is being edited');
}
check(typeof engine.setDancerPath === 'function', 'and the engine exports the path-level edit it needs');

// ============================================================ 2. the mirror
//
// MIRRORED rather than imported: `sameTravel`/`sameFacingCurve` are module-private in the controller, which
// builds DOM. Section 1 pins the constants and the wiring they live in; the numbers below are about what the
// rule MEANS.
const SHAPE_WINDOW = 0.025;
const FACING_WINDOW_DEG = 0.5;
const travelGap = (a, b) => {
  let gap = 0;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const qa = engine.bezierPoint(a.translate, t);
    const qb = engine.bezierPoint(b.translate, t);
    gap = Math.max(gap, Math.hypot(qa.x - qb.x, qa.y - qb.y));
  }
  return gap;
};
const sameTravel = (a, b) => travelGap(a, b) < SHAPE_WINDOW;
const sameFacingCurve = (a, b) => engine.sameFacing(a.rotate ?? a.translate, b.rotate ?? b.translate, FACING_WINDOW_DEG);
const sameTrace = (a, b) => {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    if (!sameTravel(a[k], b[k]) || !sameFacingCurve(a[k], b[k])) return false;
    if (a[k].beats !== b[k].beats || a[k].hands !== b[k].hands) return false;
  }
  return true;
};
/** The OLD copy, for the mutation: ONE curve of the move on screen. */
const oldCopy = (call, target, donor, moveIndex, curve) => {
  const ref = call.dancers[donor]?.path[moveIndex];
  const seg = call.dancers[target]?.path[moveIndex];
  if (!ref || !seg) return call;
  const source = curve === 'facing' ? ref.rotate ?? ref.translate : ref.translate;
  const patched = curve === 'facing' ? { ...seg, rotate: { ...source } } : { ...seg, translate: { ...source } };
  return engine.setMove(call, target, moveIndex, patched);
};
/** Deep value equality of two paths - the strongest form of "the clone happened". */
const valueEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ============================================================ 3. does the copy make the TRACE match?
console.log('\n== 2. Does the clone make the whole trace the same? ==');
const files = [];
for (const lvl of ['ms', 'a1', 'a2', 'plus']) {
  for (const f of fs.readdirSync(path.join(assets, lvl)).filter((x) => x.endsWith('.xml'))) files.push([lvl, f]);
}
let pairs = 0;
let cloned = 0;
let identical = 0;
let oldStillDiffer = 0;
let sameNumberOfMoves = 0;
let lengthDiffers = 0;
const oldWitness = [];
const loadCall = (lvl, f, tams = 3) => {
  // SEVERAL SETUPS PER FILE, because a level file's FIRST `<tam>` is often a two- or four-dancer authoring
  // that this question is not about - and skipping the whole FILE instead of trying the next one cost
  // three-quarters of the sample the first time this probe was written.
  for (const tam of engine.parseCallXml(asset(`${lvl}/${f}`)).slice(0, tams)) {
    try {
      const call = engine.normalizeInstance(engine.buildCall(tam, engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true));
      if (call.dancers.length === 8) return call;
    } catch { /* not loadable, try the next */ }
  }
  return null;
};
for (const [lvl, f] of files) {
  const call = loadCall(lvl, f);
  if (!call) continue;
  const donor = 0;
  for (let target = 1; target < 8; target++) {
    const donorPath = call.dancers[donor]?.path;
    const targetPath = call.dancers[target]?.path;
    if (!donorPath || !targetPath || donorPath.length === 0) continue;
    pairs++;
    const next = engine.setDancerPath(call, target, donorPath);
    if (sameTrace(next.dancers[donor].path, next.dancers[target].path)) cloned++;
    if (valueEqual(next.dancers[donor].path, next.dancers[target].path)) identical++;
    if (next.dancers[target].path.length === donorPath.length) sameNumberOfMoves++;
    else lengthDiffers++;
    // THE MUTATION: the OLD gesture, at move 0, on the Move tab's curve (the tab the panel opens on).
    const old = oldCopy(call, target, donor, 0, 'travel');
    if (!sameTrace(old.dancers[donor].path, old.dancers[target].path)) {
      oldStillDiffer++;
      if (oldWitness.length < 3) oldWitness.push(`${lvl}/${f} dancer ${target + 1}`);
    }
  }
}
console.log(`    ${pairs} (donor, target) pairs over ${files.length} files`);
check(pairs > 500, `the sample is the corpus, not a witness (${pairs} donor/target pairs over ${files.length} files)`);
check(cloned === pairs, `the clone makes the two traces THE SAME in ${cloned} of ${pairs}`);
check(identical === pairs, `and the target's path is VALUE-EQUAL to the donor's in ${identical} of ${pairs} - not merely close, which is what "clone" has to mean`);
// THE UNIT OF `pairs` IS A DANCER PAIR, not a (move, dancer) pair: the question here is about a whole trace,
// so one count per pair is the honest one. (The first version of this file counted per move and compared a
// curve with itself - both of which are why it could not fail.)
check(sameNumberOfMoves === pairs,
  `including the NUMBER of moves (${lengthDiffers} pairs needed the length changed; the corpus's eight-dancer paths all happen to be the same length, so that branch is pinned by the engine test rather than by this sweep)`);
check(oldStillDiffer > 0,
  `the OLD copy leaves ${oldStillDiffer} of ${pairs} (${((100 * oldStillDiffer) / pairs).toFixed(0)}%) still NOT the same trace - one curve of one move is not a trace, e.g. ${oldWitness.join(', ')}`);
// A CONTROL on the comparison itself: it has to say NO to two genuinely different traces, or "the same in
// every case" above would be a comparison that always says yes.
let refusals = 0;
for (const [lvl, f] of files.slice(0, 40)) {
  const call = loadCall(lvl, f);
  if (!call) continue;
  const a = call.dancers[0]?.path;
  const b = call.dancers[1]?.path;
  if (!a || !b) continue;
  if (!sameTrace(a, b)) refusals++;
}
check(refusals > 0, `and it REFUSES genuinely different traces (${refusals} of the first 40 files), so "the same" is not a function that always returns true`);

// ============================================================ 4. and it survives the format
console.log('\n== 3. Does it survive an export and a re-read? ==');
{
  let roundTripPairs = 0;
  let stillSame = 0;
  let stillIdentical = 0;
  const bad = [];
  for (const [lvl, f] of files.slice(0, 60)) {
    const call = loadCall(lvl, f);
    if (!call) continue;
    const donorPath = call.dancers[0]?.path;
    if (!donorPath || donorPath.length === 0) continue;
    let xml;
    try { xml = engine.callToXml(engine.setDancerPath(call, 1, donorPath), call.from || 'Setup'); } catch { continue; }
    let back;
    try {
      const tam = engine.parseCallXml('<calls>\n' + xml + '\n</calls>')[0];
      back = engine.normalizeInstance(engine.buildCall(tam, engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true));
    } catch { continue; }
    if (back.dancers.length !== 8) continue;
    roundTripPairs++;
    if (sameTrace(back.dancers[0].path, back.dancers[1].path)) stillSame++;
    else if (bad.length < 3) bad.push(`${lvl}/${f}`);
    if (valueEqual(back.dancers[0].path, back.dancers[1].path)) stillIdentical++;
  }
  console.log(`    ${roundTripPairs} cloned calls exported and read back`);
  check(roundTripPairs > 20, 'the round-trip sample is real');
  // THE LEG THAT MATTERS: whatever the format does to a curve, it does it to BOTH dancers now, because the
  // target's trace IS the donor's. The old copy wrote a TRAVEL curve into a FACING slot, whose `cy1` the
  // format has no attribute for (`bezRotAttr` emits only cx3/cx4/cy4/x4/y4) - so the two traces drifted
  // apart the moment the file was re-read.
  check(stillSame === roundTripPairs,
    `the two traces are STILL the same after a round trip in ${stillSame} of ${roundTripPairs}${bad.length ? ' - ' + bad.join(', ') : ''}`);
  check(stillIdentical === roundTripPairs,
    `and still value-equal in ${stillIdentical} of them, because the clone copies the donor's own segments rather than converting one curve into another kind`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
