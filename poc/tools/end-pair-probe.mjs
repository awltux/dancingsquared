// Probe: WHICH SPOT OF AN END FORMATION DOES EACH DANCER FINISH ON - AND WHO DECIDES?
//
// Asked for: "Add an option to select a different end formation and Connect a last move to the new end
// point. How can the interface handle formations with different indexes to the end positions. I may
// connect the end of the dance path to the wrong formation point. Need a solution to change the
// auto-selected endpoint."
//
// So this probe answers the INDEX question with a measurement rather than an opinion, and then measures the
// machinery the answer depends on:
//
//   1. HOW OFTEN IS INDEX-FOR-INDEX WRONG? A formation's spot `j` is wherever ITS OWN file wrote its j-th
//      dancer, so `dancer 3 -> spot 3` is a coincidence of two unrelated authorings. Swept over every call
//      in the ms level and every formation the picker offers, and reported with the distance a dancer is
//      sent when the pairing IS by index.
//   2. IS THE DERIVED PAIRING A PERMUTATION? Every spot used exactly once - which "the call finishes on
//      this formation" requires, and which the panel's swap-on-taken-spot rule preserves.
//   3. DOES THE PANEL'S MANUAL ROUTE AGREE WITH THE ENGINE'S WHOLE-SET ONE? The panel re-aims the last move
//      ONE DANCER AT A TIME (`setDancerEnd`, which is what an override needs); the engine has a whole-set
//      `correctEndTo` that derives the pairing itself. Measured against each other on the corpus, so the
//      manual route cannot quietly become a second geometry.
//   4. DOES AN OVERRIDE LAND THE DANCER WHERE IT SAYS, AND LEAVE EVERYTHING ELSE ALONE? That is the
//      feature: changing the auto-selected endpoint must move THAT dancer's end and nothing else.
//   5. DOES THE CALL ACTUALLY FINISH IN THE FORMATION? The end board is handed to the library's own
//      recogniser, so "it ends on Ocean Waves" is checked by the thing that names formations.
//
// Run: node tools/end-pair-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);
const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);
// THE CORPUS'S HALF-SET RULE, imported rather than re-spelled: the panel's end target is the formation as
// `corpusFormationsOfSize` builds it, so the witness below has to be the same shape the picker offers.
const half = await import(pathToFileURL(path.join(POC_DIR, 'src', 'half-set.ts')).href);

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

const seq = new engine.Sequencer(movesXml, formationsXml, callsByTitle(assets));

// THE FORMATIONS THE PICKER OFFERS, by the same call the panel's host uses (`boardForSetup`, 8 dancers).
const formations = [];
for (const name of seq.listFormations()) {
  const b = seq.boardForSetup(name);
  if (!b || b.dancers.length !== 8) continue;
  formations.push({ name, poses: b.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender })) });
}

// THE CALLS: every file in the ms level, its first authoring - the level the editor opens on.
const calls = [];
for (const f of fs.readdirSync(path.join(assets, 'ms')).filter((x) => x.endsWith('.xml'))) {
  try {
    const call = engine.normalizeInstance(engine.loadCallFromXml(fs.readFileSync(path.join(assets, 'ms', f), 'utf8'), movesXml, formationsXml, 0));
    if (call.dancers.length === 8) calls.push({ file: `ms/${f}`, call });
  } catch {
    /* a file that is not a call setup */
  }
}

const startsOf = (call) =>
  call.dancers.map((d) => {
    const p = engine.poseFor(d, 0);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
const endPoseOf = (call, i) => engine.poseFor(call.dancers[i], call.beats);
const identityPairing = (n) => [...Array(n).keys()];

/** THE PANEL'S PAIRING: the geometry, with the formation's declared arrangement preferred. */
const pairFor = (start, poses) => engine.deriveFormationMapping(start, poses, true);

/** The panel's own route: one dancer at a time, so an explicit pairing can replace the derived one. */
function connectEndByDancer(call, target, pairing) {
  let out = engine.normalizeInstance(call);
  for (let i = 0; i < out.dancers.length; i++) {
    if (out.dancers[i].path.length === 0) continue;
    out = engine.setDancerEnd(out, i, target[pairing[i]]);
  }
  return out;
}

console.log(`== What is being swept ==`);
console.log(`    ${calls.length} calls (every call file in the ms level that loads as an 8-dancer setup) x ${formations.length} formations the picker offers = ${calls.length * formations.length} pairings`);
check(calls.length > 10 && formations.length > 100, 'the sample is a whole level against the whole picker, not a hand-picked few');

// ---------------------------------------------------------------- 1. index vs geometry
console.log('\n== 1. Is index-for-index the correspondence? ==');
let pairs = 0;
let indexAgrees = 0;
let worstIndexSend = 0;
let worstWitness = null;
for (const { file, call } of calls) {
  const start = startsOf(call);
  for (const f of formations) {
    const derived = pairFor(start, f.poses);
    pairs++;
    if (derived.every((s, i) => s === i)) {
      indexAgrees++;
      continue;
    }
    // HOW FAR APART THE TWO ANSWERS PUT THE DANCERS: the largest distance from the spot the geometry
    // chose to the spot the array index would have chosen.
    for (let i = 0; i < derived.length; i++) {
      const a = f.poses[derived[i]];
      const b = f.poses[i];
      const d = Math.hypot(a.x - b.x, a.y - b.y) + Math.abs(norm(a.heading - b.heading)) * 0.5;
      if (d > worstIndexSend) {
        worstIndexSend = d;
        worstWitness = `${file} -> ${f.name}`;
      }
    }
  }
}
console.log(`    index-for-index gives the same pairing as the geometry for ${indexAgrees} of ${pairs} pairings (${((100 * indexAgrees) / pairs).toFixed(1)}%)`);
console.log(`    where it differs, a dancer is sent up to ${worstIndexSend.toFixed(3)} units from the spot the geometry assigns (worst: ${worstWitness})`);
check(indexAgrees < pairs, 'pairing by array index is NOT the correspondence: past a handful of formations it sends dancers to spots the geometry does not');
check(worstIndexSend > 1, `and the difference is a dancer moved a real distance (${worstIndexSend.toFixed(2)} units), not float noise`);

// ---------------------------------------------------------------- 2. a permutation, always
console.log('\n== 2. The derived pairing uses every spot exactly once ==');
let notAPermutation = 0;
for (const { call } of calls) {
  const start = startsOf(call);
  for (const f of formations) {
    const d = pairFor(start, f.poses);
    const seen = new Set(d);
    if (d.length !== f.poses.length || seen.size !== f.poses.length || [...seen].some((s) => s < 0 || s >= f.poses.length)) notAPermutation++;
  }
}
check(notAPermutation === 0, `every one of the ${pairs} pairings is a bijection onto the formation's spots (${notAPermutation} were not)`);

// ---------------------------------------------------------------- 3. the panel's route vs the engine's
console.log('\n== 3. Re-aiming one dancer at a time vs the engine\'s whole-set route ==');
// A subject of its own, and it turned up something worth knowing: the engine's whole-set `correctEndTo`
// RE-DERIVES the correspondence between the call and the target it is handed, so it cannot be given an
// explicit pairing at all. Where its re-derivation lands on the same pairing, the two routes must agree
// exactly - and where it does not, the divergence is measured, because that is the reason an override has
// to go through the engine's PER-DANCER mutator instead.
let worstSameRoute = 0;
let worstOtherRoute = 0;
let routeWitness = null;
let keptPairing = 0;
let lostPairing = 0;
for (const ci of [0, Math.floor(calls.length / 2), calls.length - 1]) {
  const call = calls[ci].call;
  const start = startsOf(call);
  for (const fi of [0, 19, 38, 57, 76, 95, 114, formations.length - 1]) {
    const f = formations[fi];
    const pairing = pairFor(start, f.poses);
    const manual = connectEndByDancer(call, f.poses, pairing);
    const ordered = pairing.map((j) => f.poses[j]);
    const whole = engine.correctEndTo(call, ordered);
    let worst = 0;
    for (let i = 0; i < call.dancers.length; i++) {
      const a = engine.poseFor(manual.dancers[i], manual.beats);
      const b = engine.poseFor(whole.dancers[i], whole.beats);
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y), Math.abs(norm(a.heading - b.heading)));
    }
    // Did `correctEndTo` keep the pairing it was handed? It derives the correspondence from the ordered
    // target, so the answer is not automatic - and the question is whether that re-derivation is the
    // IDENTITY in the ordered array's own index space.
    const again = engine.deriveFormationMapping(start, ordered);
    if (again.every((s, i) => s === i)) {
      keptPairing++;
      worstSameRoute = Math.max(worstSameRoute, worst);
    } else {
      lostPairing++;
      if (worst > worstOtherRoute) {
        worstOtherRoute = worst;
        routeWitness = `${calls[ci].file} -> ${f.name}`;
      }
    }
  }
}
console.log(`    ${keptPairing} of ${keptPairing + lostPairing} applied pairings keep the correspondence; worst disagreement there ${worstSameRoute.toExponential(2)}`);
console.log(`    ${lostPairing} do not: \`correctEndTo\` derives its own pairing from the target it is handed (and does not prefer the arrangement), so it cannot carry an explicit one (worst divergence ${worstOtherRoute.toFixed(2)} units, ${routeWitness})`);
check(keptPairing > 0 && worstSameRoute < 1e-9, 'where the whole-set route keeps the pairing, the panel\'s one-dancer-at-a-time route agrees with it to floating-point noise, so the manual path is not a second geometry');
check(lostPairing > 0, 'and the measurement behind the manual route: the engine\'s whole-set operation derives its own correspondence, so an explicit pairing has to go through the per-dancer mutator - if that ever changes, this line fails and says so');

// ---------------------------------------------------------------- 4. an override moves one end
console.log('\n== 4. Changing the auto-selected endpoint moves THAT dancer\'s end, and nothing else ==');
const OVERRIDE_CALL = calls[0];
{
  const call = OVERRIDE_CALL.call;
  const start = startsOf(call);
  let worstLanding = 0;
  let worstUntouched = 0;
  let worstEarlierMove = 0;
  let swaps = 0;
  for (const f of formations.slice(0, 40)) {
    const derived = pairFor(start, f.poses);
    const before = connectEndByDancer(call, f.poses, derived);
    // Swap two dancers' targets - the same move the panel's spot picker makes when the chosen spot is
    // already held.
    const swapped = [...derived];
    const a = 0;
    const b = 3;
    [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
    const after = connectEndByDancer(call, f.poses, swapped);
    swaps++;
    // (a) the two dancers land exactly on the spot they were pointed at
    for (const i of [a, b]) {
      const p = engine.poseFor(after.dancers[i], after.beats);
      const t = f.poses[swapped[i]];
      worstLanding = Math.max(worstLanding, Math.hypot(p.x - t.x, p.y - t.y), Math.abs(norm(p.heading - t.heading)));
    }
    // (b) EVERY OTHER DANCER'S END is exactly what it was
    for (let i = 0; i < call.dancers.length; i++) {
      if (i === a || i === b) continue;
      const p = engine.poseFor(after.dancers[i], after.beats);
      const q = engine.poseFor(before.dancers[i], before.beats);
      worstUntouched = Math.max(worstUntouched, Math.hypot(p.x - q.x, p.y - q.y), Math.abs(norm(p.heading - q.heading)));
    }
    // (c) and the SWAPPED dancers' earlier moves are untouched too: only the last one is re-aimed.
    for (const i of [a, b]) {
      const nA = after.dancers[i].path.length;
      const nB = before.dancers[i].path.length;
      if (nA !== nB) worstEarlierMove = Infinity;
      for (let k = 0; k < nA - 1; k++) {
        const pa = engine.poseFor({ ...after.dancers[i], path: after.dancers[i].path.slice(0, k + 1) }, after.dancers[i].path.slice(0, k + 1).reduce((s, x) => s + x.beats, 0));
        const pb = engine.poseFor({ ...before.dancers[i], path: before.dancers[i].path.slice(0, k + 1) }, before.dancers[i].path.slice(0, k + 1).reduce((s, x) => s + x.beats, 0));
        worstEarlierMove = Math.max(worstEarlierMove, Math.hypot(pa.x - pb.x, pa.y - pb.y));
      }
    }
  }
  console.log(`    ${swaps} formations, dancers 1 and 4 swapped`);
  console.log(`    worst landing error ${worstLanding.toExponential(2)}; every other end moved by ${worstUntouched.toExponential(2)}; earlier moves by ${worstEarlierMove.toExponential(2)}`);
  check(worstLanding < 1e-9, 'an overridden dancer lands EXACTLY on the spot it was pointed at');
  check(worstUntouched < 1e-12, 'and no other dancer\'s end moves at all');
  check(worstEarlierMove < 1e-12, 'and no earlier move of the two swapped dancers moves either: only the last one is re-aimed');
}

// ---------------------------------------------------------------- 5. does it finish IN the formation?
console.log('\n== 5. The library\'s own recogniser reads the end board ==');
{
  // ONLY THE TARGETS THE LIBRARY WILL NAME. `recognize` is the CURATED read and refuses to guess, and most
  // of the picker's formations are not curated boards - so the comparison that means something is: where
  // the library names the target formation's own board, does the CONNECTED END read the same name? That is
  // the claim "the call now finishes in this formation", checked by the thing that names formations.
  const probeCalls = [calls[0], calls[Math.floor(calls.length / 2)], calls[calls.length - 1]];
  let curated = 0;
  let same = 0;
  let unnamed = 0;
  const examples = [];
  // HEADINGS SNAPPED TO 1e-9 BEFORE THE COMPARISON, and section 6 is why: the recogniser has a KNIFE EDGE at
  // the heading branch cut - a GLOBAL rotation of 1e-14 rad, i.e. a rotation by nothing at all, changes its
  // name for some formations. The connected end's headings differ from the target's by ~3e-15 rad (the
  // connect composes a rotation), so comparing the raw read would test that knife edge rather than the
  // connect. Snapping both boards the same way compares the boards; the knife edge is measured on its own.
  const snap = (b) => ({ dancers: b.dancers.map((d) => ({ ...d, heading: Math.round(d.heading / 1e-9) * 1e-9 })) });
  for (const { file, call } of probeCalls) {
    const start = startsOf(call);
    for (const f of formations) {
      const targetBoard = seq.boardForSetup(f.name);
      const want = seq.recognize(snap(targetBoard))?.name ?? null;
      if (want === null) {
        unnamed++;
        continue;
      }
      curated++;
      const derived = pairFor(start, f.poses);
      const done = connectEndByDancer(call, f.poses, derived);
      const got = seq.recognize(snap(engine.boardAtBeat(done, done.beats)))?.name ?? null;
      if (got === want) same++;
      else if (examples.length < 6) examples.push(`${file} -> ${f.name} (reads as ${want}): the end reads as ${got ?? 'nothing'}`);
    }
  }
  console.log(`    ${same} of ${curated} targets the library NAMES are read back with the same name after connecting (${unnamed} of the picker's formations are boards the curated read refuses to name, so there is no name to compare)`);
  for (const e of examples) console.log(`      ${e}`);
  check(curated > 0 && same === curated, 'every connected end whose target the library can name is read back as that formation');
}

// ---------------------------------------------------------------- 6. arrangement, and a knife edge
console.log('\n== 6. The ARRANGEMENT, and a knife edge in the library\'s naming ==');
{
  // THE ARRANGEMENT IS PART OF THE PAIRING. A formation's genders are which spots hold a boy and which a
  // girl, so pairing a dancer with the other gender's spot gives the right SHAPE and a different SETUP -
  // and the shape is all the eye sees, which is why this is worth a number rather than a sentence.
  let mismatchPlain = 0;
  let mismatchKept = 0;
  let pairsWithPlain = 0;
  let worstPlain = null;
  for (const { file, call } of calls) {
    const start = startsOf(call);
    for (const f of formations) {
      const plain = engine.deriveFormationMapping(start, f.poses);
      const kept = pairFor(start, f.poses);
      const bad = (p) => p.filter((s, i) => f.poses[s].gender !== start[i].gender).length;
      mismatchPlain += bad(plain);
      mismatchKept += bad(kept);
      if (bad(plain) > 0) {
        pairsWithPlain++;
        if (!worstPlain || bad(plain) > worstPlain.bad) worstPlain = { file, name: f.name, bad: bad(plain) };
      }
    }
  }
  console.log(`    the geometry alone puts a dancer on the other gender's spot in ${pairsWithPlain} of ${pairs} pairings (${mismatchPlain} spots); preferring the declared arrangement leaves ${mismatchKept}`);
  if (worstPlain) console.log(`      worst: ${worstPlain.file} -> ${worstPlain.name}, ${worstPlain.bad} of 8 dancers on the wrong gender`);
  check(mismatchPlain > pairs / 2, 'the arrangement is wrong for MOST (call, formation) pairings if the pairing is the geometry alone');
  check(mismatchKept === 0, 'and preferring the declared arrangement leaves nobody on a spot the formation declares for the other gender');

  // THE KNIFE EDGE, measured on the library's own boards so it is nobody's feature: rotating a board by
  // 1e-14 rad - a rotation by nothing - changes the name for some of the formations the curated read can
  // name at all.
  let named = 0;
  let unstable = 0;
  const flipped = [];
  for (const f of formations) {
    const b = seq.boardForSetup(f.name);
    const a = seq.recognize(b)?.name ?? null;
    const nudged = { dancers: b.dancers.map((d) => ({ ...d, heading: d.heading + 1e-14 })) };
    const c = seq.recognize(nudged)?.name ?? null;
    if (a !== null || c !== null) named++;
    if (a !== c) {
      unstable++;
      if (flipped.length < 4) flipped.push(`${f.name}: "${a}" -> "${c}"`);
    }
  }
  console.log(`    the recogniser names ${named} of the ${formations.length} formations; ${unstable} of those change their NAME when every heading is nudged by 1e-14 rad`);
  for (const x of flipped) console.log(`      ${x}`);
  check(unstable > 0, 'the knife edge is real and is REPORTED rather than worked around: this is a property of the read, so nothing here asserts a name across it');
}

// ---------------------------------------------------------------- 7. the panel's own pairing argument
console.log('\n== 7. The panel\'s own argument, and the reported witness ==');
{
  // THE START POSES ARE THE ARGUMENT. `preferGender` is a preference over the formation's DECLARED
  // arrangement, and it can only be applied against a start that declares one - so a start built without
  // `gender` made the flag inert and the pairing a pure-geometry one. This check turns red if the field is
  // dropped again; everything below measures what dropping it costs.
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  // The map's OWN body, bounded by the indented close, so the field has to be inside the start poses rather
  // than anywhere in the following lines.
  const startMap = /const start = inst\.dancers\.map\(\(d\) => \{[\s\S]*?\n    \}\);/.exec(ui);
  check(!!startMap && /gender: d\.gender/.test(startMap[0]),
    'the panel builds the end-pairing start poses WITH the dancers\' genders, so `preferGender` is not inert');

  // THE REPORTED WITNESS, named the way the corpus names a tam - by title and `from`, never by list position.
  // Reported: "loaded 'Right and Left Grand' call, Setup '1/4 Tag' ... applied End setup 'Right and Left Grand
  // Circle' ... flipped boys and girls as they end up facing opposite direction", and then "none of the
  // rotations give a correct direction" - which is the currency of this check, because the turn rotates the
  // spots WITHOUT renumbering them, so a gender-correct pairing is correct at every one of the eight steps.
  const call = engine.normalizeInstance(engine.loadCallFromXml(
    asset('ms/right_and_left_grand.xml'), movesXml, formationsXml,
    { title: 'Right and Left Grand', from: '1/4 Tag' }));
  const ds = engine.parseFormations(formationsXml).get('Right and Left Grand Circle');
  const target = half.completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * engine.DEG, gender: d.gender })));
  check(target.length === call.dancers.length, `the reported end setup is offered at the call's own size (${target.length} dancers)`);
  const genders = call.dancers.map((d) => d.gender);
  const startNoGender = call.dancers.map((d) => { const q = engine.poseFor(d, 0); return { x: q.x, y: q.y, heading: q.heading }; });
  const startWithGender = startNoGender.map((q, i) => ({ ...q, gender: genders[i] }));
  const wrong = (pairing) => pairing.filter((s, i) => target[s].gender !== genders[i]).length;

  // THE NEGATIVE CONTROL IS THE FAULT ITSELF. The flag OFF is exactly what the panel ran while its start
  // poses carried no gender, and it puts 4 of the 8 dancers on a spot the formation declares for the other
  // gender - the boys on the girls' spots, facing the girls' way.
  const geometryOnly = engine.deriveFormationMapping(startNoGender, target);
  check(wrong(geometryOnly) === 4,
    `the geometry alone - the panel's behaviour while the flag was inert - pairs ${wrong(geometryOnly)} of 8 dancers with a spot declared for the other gender`);
  const kept = engine.deriveFormationMapping(startWithGender, target, true);
  check(wrong(kept) === 0, `and the panel's own argument, with the genders, leaves ${wrong(kept)} of 8 there`);

  // A REQUEST THAT CANNOT BE HONOURED IS REFUSED, not degraded: the refusal is what makes the defect
  // non-recurrable, and it fails this check if it is ever softened back to a silent no-op.
  let refused = false;
  try { engine.deriveFormationMapping(startNoGender, target, true); } catch { refused = true; }
  check(refused, 'and the engine REFUSES `preferGender` when the start poses declare no gender');

  // ALL EIGHT DIRECTIONS. `rotateFormation` turns every spot and its facing together and does not renumber
  // them, so every step keeps each spot's declared gender - which is why the fix makes all eight steps
  // correct arrangements rather than moving the fault round the ring.
  let turnedWrong = 0;
  for (let k = 0; k < 8; k++) {
    const turned = k === 0 ? target : engine.rotateFormation(target, (k * Math.PI) / 4);
    for (let s = 0; s < turned.length; s++) if (turned[s].gender !== target[s].gender) turnedWrong++;
  }
  check(turnedWrong === 0, 'and every one of the eight 45-degree steps keeps each spot\'s declared gender, so all eight finish directions are correct arrangements');
}

// ---------------------------------------------------------------- wiring
console.log('\n== the panel uses the geometry, and keeps the caller\'s correction ==');
const editorSrc = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
// THE PAIRING IS DERIVED FROM THE FORMATION AS AUTHORED, even though the End setup has a rotation control.
// The correspondence is between the call's DANCERS and the formation's NUMBERED SPOTS, and a turn moves the
// spots without renumbering them - so the pairing must not see the turn. Deriving it from the turned target
// asks a question whose answer is a knife edge (this derivation searches all eight rotations and keeps the
// first of any tie), which made the placed end headings jump between equally-good answers instead of
// marching round. `poc/tools/end-spin-probe.mjs` section 4 reproduces that fault and measures the fix.
check(/private endPairing\(\)[\s\S]*?deriveFormationMapping\(start, target\.poses, true\)/.test(editorSrc),
  'the panel derives the pairing with the engine\'s `deriveFormationMapping`, preferring the formation\'s declared ARRANGEMENT - the same rule `setStartFormation` applies at the start - and from the formation AS AUTHORED');
check(!/const poses = this\.endTargetPoses\(\);[\s\S]{0,200}?deriveFormationMapping\(start, poses, true\)/.test(editorSrc),
  'and NOT from the turned target: that was the fault, and it made the pairing - and so the placed headings - jump between equally-good correspondences');
check(/const holder = next\.indexOf\(spot\)/.test(editorSrc) && /next\[holder\] = next\[dancer\]/.test(editorSrc),
  'and a spot another dancer holds is SWAPPED, so eight picks keep using every spot once');
check(/this\.endOverride = null;\n(\s*)\/\/ A NEW instance/.test(editorSrc) || /this\.endOverride = null;/.test(editorSrc),
  'and the correction is cleared when another instance is loaded, so a pairing cannot outlive the setup it was made for');

// SHOWN TO FAIL: the two faults this feature exists to avoid.
console.log('\n== the check fails on the bugs it was written for ==');
{
  const start = startsOf(calls[0].call);
  const f = formations.find((x) => !pairFor(start, x.poses).every((s, i) => s === i));
  const derived = pairFor(start, f.poses);
  const good = connectEndByDancer(calls[0].call, f.poses, derived);
  const byIndex = connectEndByDancer(calls[0].call, f.poses, identityPairing(f.poses.length));
  let diff = 0;
  for (let i = 0; i < 8; i++) {
    const a = engine.poseFor(good.dancers[i], good.beats);
    const b = engine.poseFor(byIndex.dancers[i], byIndex.beats);
    diff = Math.max(diff, Math.hypot(a.x - b.x, a.y - b.y));
  }
  console.log(`    pairing "${f.name}" by INDEX instead moves ends by up to ${diff.toFixed(3)} units`);
  check(diff > 0.5, 'pairing by array index really does produce a different end board here - so section 1\'s count is a measurement, not a tautology');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
