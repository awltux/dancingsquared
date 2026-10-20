// A `<tam>` EXPORT NAMES THE SETUP THE CALL STARTS FROM, so that the `<formation>` block can go.
//
// REPORTED: "When exporting a call `<tam>` it doesnt come with a formation property (unless a Start Setup
// has been chosen) ... If a call has a Setup, use that when exporting and assign it as `formation` property
// and lose the `formation` element. The `from` property is useful if the start positions have changes and
// the formation isnt recognised."
//
// The corpus already writes it that way - `<tam title="Promenade" formation="Facing Couples
// Far">` with no block (that tam was titled `Promenade Full to Home` until the promenade family took
// the CALLERLAB names) - and the app did not, for two reasons that both live in `tam-xml.ts`:
//
//   1. THE RESOLVER COMPLETED ONLY THE 4-DANCER CASE. A named formation is authored as HALF the set (the
//      corpus's own rule), so a `formation="Name"` reference has to be compared against the COMPLETED
//      shape. Four was mirrored to eight and every other size was left as authored - so `Facing Couples
//      Far`, authored as TWO dancers and played as four, could never be "the shape the call starts from",
//      however exactly the two agreed. `startsFromFormation` refused on the size mismatch and the writer
//      embedded.
//   2. THE NAME CHAIN OMITTED THE SETUP AND NEVER SURVIVED AN EMPTY STRING. `call.formation` - where the
//      parser keeps the tam's own `formation="Name"` attribute - was not consulted, and the chain used
//      `??`, so the `''` the app passes for exactly those tams defeated every fallback below it.
//
// This probe pins the rule and the decision. THE RULE IS IMPORTED (`src/half-set.ts`), not restated: this
// file can be imported under plain node and `tam-xml.ts` cannot (it pulls `formations.xml?raw`), which is
// the whole reason the rule was extracted.
//
// Run: node tools/formation-shape-probe.mjs   (from poc/; the engine must be built)
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
/** The app's TypeScript is checked in with CRLF; this file is LF, so a multi-line match needs this. */
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');
/** The corpus is the repository's ONE copy at `assets/` in the root — one level ABOVE the POC, not beside it. */
const read = (rel) => fs.readFileSync(path.join(POC, '..', rel), 'utf8');

const movesXml = read('assets/moves.xml');
const formationsXml = read('assets/formations.xml');
const formats = engine.parseFormations(formationsXml);
const moves = engine.parseMoves(movesXml);

// ------------------------------------------------------------------ 1. the rule, at every authored size
console.log('== 1. the corpus half-set rule completes at EVERY authored size ==');

const six = Array.from({ length: 6 }, (_, i) => ({ x: Math.cos(i) * 2, y: Math.sin(i) * 2, heading: i * 0.3, gender: 'boy' }));
const two = [{ x: -1, y: -3, heading: 0, gender: 'boy' }, { x: 1, y: -3, heading: Math.PI, gender: 'girl' }];
const four = [{ x: -1, y: -3, heading: 0, gender: 'boy' }, { x: 1, y: -3, heading: Math.PI, gender: 'girl' },
  { x: 3, y: -1, heading: Math.PI / 2, gender: 'boy' }, { x: 3, y: 1, heading: -Math.PI / 2, gender: 'girl' }];
const whole = [{ x: 1, y: 1, heading: 0, gender: 'boy' }, { x: -1, y: -1, heading: Math.PI, gender: 'girl' }];

check(half.completeHalfSet(two).length === 4, `a 2-dancer formation plays as 4 (got ${half.completeHalfSet(two).length})`);
check(half.completeHalfSet(two.slice(0, 1)).length === 2, 'and a 1-dancer one as 2 - the size is doubled, not forced to eight');
check(half.completeHalfSet(four).length === 8, `a 4-dancer formation plays as 8 (got ${half.completeHalfSet(four).length})`);
check(half.completeHalfSet(six).length === 12, `a 6-dancer formation plays as 12 (got ${half.completeHalfSet(six).length})`);
check(half.completeHalfSet(whole) === whole || half.completeHalfSet(whole).length === 2,
  'and a shape that ALREADY contains its own antipodes is left alone rather than stacked');

// THE NEGATIVE CONTROL for the whole probe, and the defect itself: the rule this replaced mirrored FOUR
// and nothing else. It must fail the decision below, or section 2 is not testing what it claims.
const oldRule = (poses) => (poses.length === 4
  ? poses.concat(poses.map((p) => ({ x: -p.x, y: -p.y, heading: p.heading + Math.PI, gender: p.gender })))
  : poses);
check(oldRule(two).length === 2 && half.completeHalfSet(two).length === 4,
  'the OLD rule leaves a 2-dancer formation at 2 while the real one completes it - so the two are distinguishable');

// ------------------------------------------------------------------ 2. the export decision, end to end
console.log('\n== 2. the reported call exports as a REFERENCE, with no block ==');

const posesOf = (name) => {
  const key = engine.canonicalName(name);
  for (const [n, ds] of formats) {
    if (engine.canonicalName(n) !== key) continue;
    return half.completeHalfSet(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * Math.PI / 180, gender: d.gender })));
  }
  return null;
};
/** The OLD resolver, as the negative control: authored size, no completion. */
const oldPosesOf = (name) => {
  const key = engine.canonicalName(name);
  for (const [n, ds] of formats) {
    if (engine.canonicalName(n) !== key) continue;
    return ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * Math.PI / 180, gender: d.gender }));
  }
  return null;
};

const call = engine.loadCallFromXml(read('assets/ms/promenade.xml'), movesXml, formationsXml,
  // THE FILE NOW HOLDS TWO tams titled Promenade on Facing Couples Far: the one that stops at home
  // (no `from`, which is the reported case) and the keep-walking variant (`from="Facing Couples Far -
  // Keep Walking"`). The probe's subject is the EMPTY-`from` one, so it selects by it.
  { title: 'Promenade', formation: 'Facing Couples Far', from: '' });

console.log(`    the corpus tam: title="${call.title}" from=${JSON.stringify(call.from)} formation=${JSON.stringify(call.formation)} ${call.dancers.length} dancers`);
check(call.from === '' && call.formation === 'Facing Couples Far',
  'the reported call has an EMPTY `from` and carries its setup in `formation` - which is why the old chain fell through to nothing');

// `callTamXml`'s chain, verbatim: the app passes `this.instance.from`, which is that empty string.
const label = call.from || call.formation || call.title;
const named = engine.callToXmlNamed(call, label, posesOf);
const attrs = named.match(/<tam[^>]*>/)[0].replace(/\s+/g, ' ');
console.log(`    exported: ${attrs}`);

check(/formation="Facing Couples Far"/.test(named), 'the setup is written as the `formation` property');
check(!named.includes('<formation>'), 'and the `<formation>` ELEMENT is gone, which is the whole point');
check(/from="Facing Couples Far"/.test(named), 'and `from` carries the name, so a reader still has it if the poses have moved');

// AND IT ROUND-TRIPS, which is what makes the reference safe rather than merely tidy: the same start poses
// come back from the text alone.
const back = engine.buildCall(engine.parseCallXml(`<calls>\n${named}\n</calls>`)[0], formats, moves);
let worst = 0;
if (back.dancers.length !== call.dancers.length) worst = Infinity;
else {
  for (let i = 0; i < call.dancers.length; i++) {
    const a = engine.poseFor(call.dancers[i], 0);
    const b = engine.poseFor(back.dancers[i], 0);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y), Math.abs(Math.atan2(Math.sin(a.heading - b.heading), Math.cos(a.heading - b.heading))));
  }
}
console.log(`    re-parsed from the text alone: ${back.dancers.length} dancer(s), worst start-pose error ${fmt(worst)}`);
check(back.dancers.length === call.dancers.length && worst < 1e-6,
  'and the reference DESCRIBES the call: re-parsing it alone reproduces every start pose');

// THE NEGATIVE CONTROL: with the old resolver the same call embeds, so section 2's checks are real.
const old = engine.callToXmlNamed(call, label, oldPosesOf);
check(old.includes('<formation>') && !/formation="Facing Couples Far"/.test(old),
  'with the OLD resolver the same call writes the block out and names nothing - the reported defect');

// ------------------------------------------------------------------ 3. the panel's wiring, read from source
console.log('\n== 3. the wiring: the rule is imported, and the name chain reaches the setup ==');

const tam = readSource('src/tam-xml.ts');
check(/import \{ completeHalfSet \} from '\.\/half-set';/.test(tam),
  '`tam-xml.ts` IMPORTS the rule rather than keeping a private copy a probe cannot reach');
check(!/function completeHalfSet/.test(tam), 'and does not also define it');
check(/const label = name \|\| call\.formation \|\| call\.from \|\| call\.title;/.test(tam),
  'the export name chain consults `call.formation` - the parser\'s record of the tam\'s own setup');
check(!/name \?\? \(call\.from/.test(tam), 'and no longer treats the app\'s empty string as a name');
check(/export function completeHalfSet/.test(readSource('src/half-set.ts')), 'the module exports the rule');

{
  // AND THE SOURCE CHECKS FAIL ON THE FAULTS THEY WERE WRITTEN FOR.
  const noImport = tam.replace("import { completeHalfSet } from './half-set';", '');
  check(noImport !== tam && !/from '\.\/half-set'/.test(noImport), 'removing the import fails the import check');
  const oldChain = tam.replace('const label = name || call.formation || call.from || call.title;', 'const label = name ?? (call.from || call.title);');
  check(oldChain !== tam && !/call\.formation \|\| call\.from/.test(oldChain), 'restoring the old chain fails the chain checks');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
