// THE `asymmetric` SELECTOR: the wiring in the POC, and the format behaviour it rests on.
//
// Asked for: "a tam.asymmetric selector added to the call. This decides if the dancers are exported
// explicitly or as a taminations half set containing equal numbers of boys and girls that can be
// reconstituted by rotating the set 180 deg around the board center. If the asymmetric flag is set, then
// this must be included in the exported tam properties. Put the asymmetric checkbox before the tables
// Select label. Default to unselected."
//
// "EQUAL NUMBERS OF BOYS AND GIRLS" MEANS HALF OF EACH, not boys == girls: a six-dancer set of four boys
// and two girls writes a half of two boys and ONE girl. What the rotation requires is that each gender's
// count be EVEN, which is what `halfSetReport` checks (and `editor.mjs` section 29 pins, on that very
// example). An earlier version of this check demanded `boys === girls` and refused the sets the form is
// for.
//
// TWO KINDS OF CHECK, and they are kept apart on purpose:
//
//   - STRUCTURAL, on the POC's own files: the control is where it was asked to go, it opens unselected,
//     and the value reaches the exporter. A browser cannot be driven from this suite, so this is the
//     part that is read rather than run.
//   - MEASURED, on the ENGINE: what the two forms actually write and what they read back as. That is
//     the half that carries the behaviour, and it is run here rather than described.
//
// The distinction matters because "a gate on the TEXT of an export is not a gate on the export"
// (editor.mjs section 27 says so, after getting it wrong once). So the text checks below only claim
// what they are: that the POC wires the control to the engine function this file then exercises.
//
// Usage: node poc/tools/asymmetric-export-probe.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const POC = path.join(DIR, '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
const {
  setParser, parseCallXml, parseFormations, parseMoves, buildCall,
  callToXml, normalizeInstance, halfSetReport, poseFor,
} = engine;
setParser(DOMParser);

const read = (p) => fs.readFileSync(path.join(POC, p), 'utf8');
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? `  ok    ${msg}` : `  FAIL  ${msg}`);
  if (!cond) failures++;
};

const formationsXml = read('src/assets/formations.xml');
const movesXml = read('src/assets/moves.xml');

// ---------------------------------------------------------------- 1. the control, and where it goes
console.log('== 1. the control, and where it goes ==');
{
  const html = read('index.html');
  const input = html.match(/<input[^>]*id="edAsym"[^>]*>/)?.[0] ?? '';
  check(input !== '', 'index.html carries an `#edAsym` input');
  check(/type="checkbox"/.test(input), 'and it is a checkbox');
  check(!/\bchecked\b/.test(input), 'and it opens UNCHECKED - the default that was asked for');
  // THE INPUT IS NESTED IN ITS LABEL, which is the app's convention (`<label><input/> Hide dancers</label>`)
  // and not cosmetic: `#hud label` is a 44px column, and the stylesheet widens a checkbox label back to
  // `auto` with `label:has(input[type="checkbox"])` - a selector that only matches a NESTED input. Written
  // as `for=` plus a SIBLING input the rule did not match, the label stayed 44px wide and the checkbox
  // covered the end of the word "Asymmetric". Reported from the running app.
  const labelTag = html.match(/<label[^>]*>(?=\s*<input[^>]*id="edAsym")[^>]*>/)?.[0] ?? '';
  check(labelTag !== '' && !/\sfor=/.test(labelTag),
    'and the input is nested INSIDE its label, so the stylesheet\'s checkbox-label rule matches it');
  const label = html.match(/<label[^>]*>\s*<input[^>]*id="edAsym"[^>]*\/?>\s*([^<]*)<\/label>/)?.[1]?.trim();
  check(label === 'Asymmetric', `its label reads "Asymmetric" (${label})`);
  // The whole `edAsymRow` block must sit before the Select row, because "before the tables Select label"
  // is a position in the MARKUP.
  const iAsym = html.indexOf('id="edAsymRow"');
  const iSelect = html.indexOf('id="edSelectRow"');
  check(iAsym >= 0 && iSelect >= 0 && iAsym < iSelect,
    `the row is placed BEFORE the tables' Select row (asym at ${iAsym}, select at ${iSelect})`);
}

// ---------------------------------------------------------------- 2. the wiring, read from the source
console.log('\n== 2. the value reaches the exporter ==');
{
  const ui = read('src/editor-ui.ts');
  check(/asymCb = el<HTMLInputElement>\('edAsym'\)/.test(ui), 'the panel holds the input');
  check(/this\.asymCb\.checked \? 1 : 2/.test(ui),
    'and maps it to the format\'s own vocabulary: 1 = whole set + `asymmetric="true"`, 2 = the half set');
  check(/this\.instance\.symmetry === 1/.test(ui),
    'and opens on what the loaded call DECLARES, so a call that is already explicit shows as explicit');
  const passed = (ui.match(/callTamXml\([^)]*declaredSymmetry\(\)/g) ?? []).length;
  check(passed >= 3, `every export site passes it through (${passed} of them)`);
  check(/callTamXml\(built, s\.name, built\.symmetry\)/.test(ui),
    'and Export All re-emits each SAVED edit\'s own declaration rather than the open call\'s selector');
  // THE REPORTED COUNT IS THE BOARD'S. This line said "writes all 8 dancers" as a literal, which is wrong
  // for the six-dancer calls the half-set form exists for - reported from the running app, and pinned here
  // so the literal cannot come back.
  check(/writes all \$\{call\.dancers\.length\} dancers/.test(ui),
    'and the count it reports is the board\'s own, not a hardcoded eight');
  const tam = read('src/tam-xml.ts');
  check(/symmetry \? \{ symmetry \} : \{\}/.test(tam), '`tam-xml.ts` forwards it to `callToXmlNamed`');
  // THE OTHER HALF OF THE ROUND TRIP, and the one that would silently break: a half-set tam is FOUR
  // dancers in the text, so a reader that is not allowed to complete it returns four.
  const data = read('src/data.ts');
  check(/return buildCall\(tam, this\.formationsMap, this\.movesMap, true\);/.test(data),
    'and `rebuildInstance` lets the DECLARATION decide the size, so a half-set export reads back whole');
}

// ---------------------------------------------------------------- 3. what the two forms write
console.log('\n== 3. the two forms, measured on a mirror-completed call ==');
{
  // `ms/circle.xml` tam 0 is `Circle Left`, whose `Circle` the corpus authors with FOUR dancers - so the
  // engine completes the second half by rotating it 180 degrees, which is exactly what a half-set tam is.
  const tams = parseCallXml(read('src/assets/ms/circle.xml'));
  const call = normalizeInstance(buildCall(tams[0], parseFormations(formationsXml), parseMoves(movesXml), true));
  check(call.dancers.length === 8, `the witness builds to a whole set (${call.dancers.length} dancers)`);
  const rep = halfSetReport(call);
  check(rep.ok, `and it IS a half set: ${rep.ok ? `a half of ${rep.half}` : rep.reason}`);

  const whole = callToXml(call, call.from, { symmetry: 1 });
  const half = callToXml(call, call.from, { symmetry: 2 });
  check((whole.match(/<dancer/g) ?? []).length === 8 && /asymmetric="true"/.test(whole),
    'TICKED writes all 8 dancers AND the property, which is the flag reaching the tam');
  check((half.match(/<dancer/g) ?? []).length === 4 && !/asymmetric=/.test(half),
    'UNTICKED writes 4 dancers and no property - the absence of the attribute is the half');

  // The written half must carry equal boys and girls, which is the stated requirement.
  const g = [...half.matchAll(/<dancer gender="(\w+)"/g)].map((m) => m[1]);
  check(g.filter((x) => x === 'boy').length === 2 && g.filter((x) => x === 'girl').length === 2,
    `and the four it writes are 2 boys and 2 girls (${g.join(',')})`);

  // THE ROUND TRIP, both ways the app reads an edit.
  const back = normalizeInstance(buildCall(parseCallXml(`<calls>\n${half}\n</calls>`)[0], parseFormations(formationsXml), parseMoves(movesXml), true));
  check(back.dancers.length === 8, `the half set READS BACK as ${back.dancers.length} dancers - the reader completes it`);
  let worst = 0;
  for (let d = 0; d < 8; d++) {
    const a = poseFor(call.dancers[d], 0);
    const b = poseFor(back.dancers[d], 0);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
  }
  check(worst < 1e-3, `and every dancer stands where it did (worst ${worst.toExponential(1)})`);
  const notAllowed = buildCall(parseCallXml(`<calls>\n${half}\n</calls>`)[0], parseFormations(formationsXml), parseMoves(movesXml), false);
  check(notAllowed.dancers.length === 4,
    `while a reader that is NOT allowed to complete sees the half it was given (${notAllowed.dancers.length}) - which is why data.ts had to change`);

  // THE REFUSAL: a set whose halves do not pair up cannot be written as a half at all, and the whole-set
  // form is what comes out instead. Writing four dancers there would have the reader invent the rest.
  const lopsided = { ...call, dancers: call.dancers.map((d, i) => (i < 4 ? { ...d, x: d.x + 2.5 } : d)) };
  const bad = halfSetReport(lopsided);
  check(!bad.ok, `a set whose halves do not pair up is refused: ${bad.reason}`);
  check(/asymmetric="true"/.test(callToXml(lopsided, lopsided.from, { symmetry: 2 })),
    'and asking for the half anyway writes the whole set, so the refusal costs only the size of the text');
}

console.log(failures === 0 ? '\nasymmetric-export-probe: all green' : `\nasymmetric-export-probe: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
