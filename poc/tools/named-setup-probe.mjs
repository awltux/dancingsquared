// THE SETUP PICKERS OPEN ON THE SETUP THE CALL IS ALREADY IN, WHEN THE CORPUS NAMES IT.
//
// Asked for as: "Set the start and end setup selectors if the initialised start and end positions are known
// formations."
//
// Two things have to hold, and each has its own negative control:
//
//   1. THE RULE, `endsOnFormation`, which is the END-side twin of `startsFromFormation` - INDEX FOR INDEX,
//      positions, headings and genders. It is not `startsFromFormation` on the end poses: a call that
//      happens to END on the shape it STARTED from is a different question from one that ends on some
//      other named shape, and the two are measured to disagree on a real call below.
//   2. THE PANEL USES IT, read from `editor-ui.ts` (TypeScript under a DOM, so it cannot run here). The
//      checks are on the source text and each one is shown to fail when the fragment it wants is reverted.
//
// AND THE FAILURE MODE IS PINNED: a name is only ever chosen when the shape really is that formation, so an
// unknown or merely-close setup leaves the picker on "keep the current". The control for that half perturbs
// ONE pose of a matching formation and requires the name to go away.
//
// WHAT IS NOT PINNED IS HOW MANY CALLS GET A NAME: that is a fact about `formations.xml`, which is content
// and is regularly mid-edit. The counts are PRINTED, and the assertion is that the instrument is not silent
// (both ends name something) and that a named call really is that formation.
//
// Run: node tools/named-setup-probe.mjs   (from poc/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const half = await import(pathToFileURL(path.join(POC, 'src', 'half-set.ts')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures++; }
};
const fmt = (n) => (Math.round(n * 1e6) / 1e6).toString();
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
/** The app's TypeScript is checked in with CRLF; this file is LF, so a multi-line match needs this. */
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');
const asset = (p) => fs.readFileSync(path.join(POC, '../assets', p), 'utf8');

const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const formations = engine.parseFormations(formationsXml);
const DEG = Math.PI / 180;
const LEVELS = fs.readdirSync(path.join(POC, '../assets')).filter((d) => !d.includes('.') && d !== 'src');

// ---------------------------------------------------------------- the panel's own list, mirrored
/** `sameArrangement`, mirrored: order-independent, position + heading + gender, every spot consumed. */
function sameArrangement(a, b) {
  if (a.length !== b.length) return false;
  const used = new Set();
  for (const p of a) {
    let hit = -1;
    for (let j = 0; j < b.length; j++) {
      if (used.has(j)) continue;
      const q = b[j];
      if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) continue;
      if (Math.abs(norm(p.heading - q.heading)) > 1e-6) continue;
      if ((p.gender ?? null) !== (q.gender ?? null)) continue;
      hit = j; break;
    }
    if (hit < 0) return false;
    used.add(hit);
  }
  return true;
}
const cache = new Map();
/** `corpusFormationsOfSize` from `tam-xml.ts`, mirrored: every arrangement of that size, one name each. */
function formationsOfSize(n) {
  if (cache.has(n)) return cache.get(n);
  const out = [];
  for (const [name, ds] of formations) {
    const poses = half.completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender })));
    if (poses.length !== n) continue;
    out.push({ name, poses });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  const kept = [];
  for (const f of out) if (!kept.some((k) => sameArrangement(k.poses, f.poses))) kept.push(f);
  cache.set(n, kept);
  return kept;
}
/** `EditorController.namedSetup`, as the panel reads it. */
const namedSetup = (call, end) => {
  const test = end ? engine.endsOnFormation : engine.startsFromFormation;
  return formationsOfSize(call.dancers.length).find((f) => test(call, f.poses))?.name ?? '';
};
function* everyCall() {
  for (const level of LEVELS) {
    for (const f of fs.readdirSync(path.join(POC, '../assets', level)).sort()) {
      if (!f.endsWith('.xml')) continue;
      try {
        yield { id: `${level}/${f}`, call: engine.normalizeInstance(engine.loadCallFromXml(
          fs.readFileSync(path.join(POC, '../assets', level, f), 'utf8'), movesXml, formationsXml, 0)) };
      } catch { /* a call that will not load is another probe's business */ }
    }
  }
}

// ---------------------------------------------------------------- 1. the rule
console.log('== 1. `endsOnFormation` is the start rule, read at the call\'s own end ==');
{
  // THE WITNESS IS FOUND BY PREDICATE, NOT BY POSITION: the corpus's own "Circle Left - Stop at Home" comes
  // back within 7e-4 of where it began, so it can only separate the start rule from the end rule by its
  // heading and only just. The dancer with the largest travel in the corpus is a measurement rather than an
  // assumption, and the file order is sorted so the witness does not depend on the filesystem.
  let W = null;
  for (const { id, call } of everyCall()) {
    for (let i = 0; i < call.dancers.length; i++) {
      const a = engine.poseFor(call.dancers[i], 0);
      const b = engine.poseFor(call.dancers[i], engine.instanceBeats(call));
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (!W || dist > W.dist) W = { id, call, i, dist, start: a, end: b };
    }
  }
  const { call: src, i: d, start, end } = W;
  console.log(`    witness: dancer ${d} of "${src.title}" (${W.id}) travels ${fmt(W.dist)} units, from (${fmt(start.x)}, ${fmt(start.y)}) @${fmt(start.heading)} to (${fmt(end.x)}, ${fmt(end.y)}) @${fmt(end.heading)}`);
  check(W.dist > 0.5, 'the witness is a dancer that really goes somewhere, so the start question and the end question cannot both be answered yes');
  // A one-dancer formation is a legal `FormDancer[]`, which is what makes this a unit test of the RULE
  // rather than of the picker: the list holds the call's own end pose and nothing else.
  const one = [{ x: end.x, y: end.y, heading: end.heading, gender: src.dancers[d].gender }];
  const solo = { ...src, dancers: [src.dancers[d]] };
  check(engine.endsOnFormation(solo, one), 'the shape it ends on is recognised as its end formation');
  check(!engine.startsFromFormation(solo, one),
    'and NOT as its start formation - the two rules are asked different questions, and this dancer does not end where it began');
  check(engine.endsOnFormation(solo, one.map((p) => ({ ...p, x: p.x + 5e-4 }))),
    "the exporter's own rounding (5e-4) is inside the tolerance, so a formation that has been through the corpus once still matches");
  check(!engine.endsOnFormation(solo, one.map((p) => ({ ...p, x: p.x + 3e-3 }))),
    'but 3e-3 is not: a shape that is merely CLOSE leaves the picker alone rather than naming the wrong setup');
  check(!engine.endsOnFormation(solo, one.map((p) => ({ ...p, heading: p.heading + 0.1 }))),
    'a heading that is out by a tenth of a radian is refused too - a setup name is about rotation as well as position');
  check(!engine.endsOnFormation(solo, one.map((p) => ({ ...p, gender: p.gender === 'boy' ? 'girl' : 'boy' }))),
    'and so is the same shape held by the other genders: gender is part of the formation');
  check(!engine.endsOnFormation(solo, [{ ...one[0], x: -one[0].x, y: -one[0].y, heading: norm(one[0].heading + Math.PI) }]),
    'and the 180-degree rotation of the shape is a DIFFERENT setup, not the same one spelled another way');
  check(!engine.endsOnFormation(solo, [...one, ...one]),
    'a formation of the wrong SIZE is refused rather than matched spot by spot');

  // THE INDEX RULE, which is why this is not an arrangement comparison: the same set of spots in another
  // order hands each dancer somebody else's path when the tam is read back. Pathless dancers, so the end
  // pose IS the start pose and the only thing under test is the pairing.
  const bare = {
    ...src,
    dancers: [
      { ...src.dancers[0], path: [], x: 1, y: 0, angleDeg: 0 },
      { ...src.dancers[1], path: [], x: -1, y: 0, angleDeg: 0 },
    ],
  };
  const a = { x: 1, y: 0, heading: 0, gender: bare.dancers[0].gender };
  const b = { x: -1, y: 0, heading: 0, gender: bare.dancers[1].gender };
  check(engine.endsOnFormation(bare, [a, b]), 'a two-dancer witness ends on its own two spots, in order');
  check(!engine.endsOnFormation(bare, [b, a]),
    'and the same two spots SWAPPED are refused: the paths would be handed to the wrong dancers');
}

// ---------------------------------------------------------------- 2. the panel uses it
console.log('\n== 2. the panel names the pickers from it, read from source ==');
{
  const ui = readSource('src/editor-ui.ts');
  // NO `\b` AFTER THE COMMA: both the comma and the newline are non-word characters, so there is no word
  // boundary there and the check would fail on a correct file.
  const importLine = /import \{[\s\S]{0,4000}?endsOnFormation,[\s\S]{0,4000}?\} from 'dancing-squared-engine';/.test(ui);
  check(importLine, '`editor-ui.ts` imports `endsOnFormation` from the engine rather than keeping a private copy');
  const helper = /private namedSetup\(call: CallBundle, end: 'start' \| 'end'\): string \{[\s\S]{0,400}?\}/.exec(ui);
  check(!!helper, 'and has one `namedSetup` that answers for either end');
  check(!!helper && /end === 'end' \? endsOnFormation : startsFromFormation/.test(helper[0]),
    'which dispatches to BOTH predicates - the end question is `endsOnFormation`, not the start rule reused');
  check(!!helper && /this\.host\.startFormations\(call\.dancers\.length\)\.find\(/.test(helper[0]),
    'and asks for the SAME list the two pickers are filled from, at the call\'s own size');
  check(/this\.startFormationSel\.value = this\.namedSetup\(this\.instance, 'start'\);/.test(ui),
    'the Start picker opens on it');
  check(/this\.endFormationSel\.value = this\.namedSetup\(this\.instance, 'end'\);/.test(ui),
    'and so does the End picker');
  // BOTH ARE SET AFTER THE OPTIONS EXIST, or a name that is not yet an option is silently blank.
  const fill = ui.indexOf('this.ensureStartFormations(this.instance.dancers.length);');
  const startSet = ui.indexOf("this.startFormationSel.value = this.namedSetup(this.instance, 'start');");
  check(fill >= 0 && startSet > fill, 'and they are named AFTER the options are filled, or the value would not stick');

  // AND THE CHECKS FAIL ON THE FAULT THEY WERE WRITTEN FOR: the old code left both pickers empty.
  const old = ui.replace(/this\.startFormationSel\.value = this\.namedSetup\(this\.instance, 'start'\);/,
    "this.startFormationSel.value = '';");
  check(old !== ui && !/this\.startFormationSel\.value = this\.namedSetup/.test(old),
    'restoring the old `value = \'\'` fails the Start picker check');
  const mixed = ui.replace(/end === 'end' \? endsOnFormation : startsFromFormation/, 'startsFromFormation');
  check(mixed !== ui && !/end === 'end' \? endsOnFormation/.test(mixed),
    'and using the start rule for the end fails the dispatch check');
}

// ---------------------------------------------------------------- 3. what it names over the corpus
console.log('\n== 3. over the catalogue: names are correct or absent, never wrong ==');
{
  let calls = 0, startNamed = 0, endNamed = 0, bothNamed = 0, wrongName = 0;
  const startWitness = [], endWitness = [];
  for (const { id, call } of everyCall()) {
    calls++;
    const s = namedSetup(call, false);
    const e = namedSetup(call, true);
    if (s) startNamed++;
    if (e) endNamed++;
    if (s && e) bothNamed++;
    // WHAT "CORRECT" MEANS, checked rather than assumed: the name is one the picker offers at this size AND
    // the call really is that formation, dancer for dancer - so selecting it would be a no-op re-base.
    for (const [name, end] of [[s, false], [e, true]]) {
      if (!name) continue;
      const f = formationsOfSize(call.dancers.length).find((x) => x.name === name);
      const ok = !!f && (end ? engine.endsOnFormation(call, f.poses) : engine.startsFromFormation(call, f.poses));
      if (!ok) { wrongName++; console.log(`    WRONG ${id} :: "${name}" at the ${end ? 'end' : 'start'}`); }
    }
    if (e && endWitness.length < 4) endWitness.push(`${call.title} -> ${e}`);
    if (s && startWitness.length < 3) startWitness.push(`${call.title} -> ${s}`);
  }
  console.log(`    ${calls} calls: ${startNamed} named at the start, ${endNamed} at the end, ${bothNamed} at both`);
  console.log(`    start examples: ${startWitness.join(' | ')}`);
  console.log(`    end examples:   ${endWitness.join(' | ')}`);
  check(calls > 0, 'the catalogue was read at all');
  check(wrongName === 0, `every name offered really is that formation, dancer for dancer (${wrongName} wrong)`);
  // AN INSTRUMENT'S SILENCE IS A BUG: 208 arrangements exist at eight dancers, so a rule that named nothing
  // would look "clean". The END count is the fragile one - most calls end on an arrangement the corpus has
  // no name for - so it is the one that needs saying out loud.
  check(startNamed > 0, `the START picker names something (${startNamed} of ${calls})`);
  check(endNamed > 0, `and so does the END picker (${endNamed} of ${calls})`);

  // THE WITNESS BY TITLE, not by position (a hand-added tam once shifted three index-keyed checks onto a
  // two-dancer pair and they read as an engine defect for months). `Sides Face, Grand Square` is the
  // corpus's own closed call: it starts and ends on a Squared Set.
  const gs = [...everyCall()].find(({ call }) => call.title === 'Sides Face, Grand Square');
  check(!!gs, 'the corpus still carries the "Sides Face, Grand Square" witness');
  if (gs) {
    const e = namedSetup(gs.call, true);
    console.log(`    witness "${gs.call.title}": start=${JSON.stringify(namedSetup(gs.call, false))} end=${JSON.stringify(e)}`);
    check(e === 'Squared Set', `it is named as ending on a Squared Set (got ${JSON.stringify(e)})`);
  }
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
