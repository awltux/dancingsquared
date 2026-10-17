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

const formationsXml = read('../assets/formations.xml');
const movesXml = read('../assets/moves.xml');

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
  const passed = (ui.match(/callTamXml\([^)]*exportSymmetry\(/g) ?? []).length;
  check(passed >= 3, `every export site goes through the one decision (${passed} of them)`);
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
  const tams = parseCallXml(read('../assets/ms/circle.xml'));
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
  // THE ENGINE STILL FALLS BACK, because it has no caller to ask and no screen to report on: handed `symmetry: 2`
  // for a call that is not a half set, `callToXml` writes the whole set. That is now a fact about the ENGINE only
  // - section 4 pins that the PANEL never lets it happen, because "correct XML, wrong answer" is exactly what was
  // reported: the box said half and the file said `asymmetric="true"`.
  check(/asymmetric="true"/.test(callToXml(lopsided, lopsided.from, { symmetry: 2 })),
    'the engine itself still falls back to the whole set - which is why the refusal has to live in the panel');
}

// ---------------------------------------------------------------- 4. and the panel REFUSES
console.log('\n== 4. the panel refuses an export it cannot honour, and says why ==');
{
  const ui = read('src/editor-ui.ts');
  const css = read('src/style.css').replace(/\/\*[\s\S]*?\*\//g, ' ');

  // THE ONE DECISION, and the refusal in it.
  check(/private exportSymmetry\(call: CallBundle, name\?: string\): Symmetry \{/.test(ui),
    'the export asks ONE place what declaration to write');
  check(/if \(this\.asymCb\.checked\) return 1;/.test(ui) && /if \(!rep\.ok\) \{[\s\S]{0,400}?throw new Error\(/.test(ui),
    'a TICKED box is always writable, and an unticked one is REFUSED rather than quietly written whole');
  check(/the half set cannot be written, so nothing was exported - \$\{rep\.reason\}/.test(ui),
    'and the refusal carries the reason `halfSetReport` gave, which names the dancers and the move it stopped on');
  check(/Tick "Asymmetric" to write the whole set with asymmetric="true" instead\./.test(ui),
    'and says what the caller can do about it, rather than only that it will not happen');

  // EVERY site that writes a tam takes it, or one of them can still lie.
  check(/callTamXml\(this\.instance, this\.instance\.from, this\.exportSymmetry\(this\.instance, this\.instance\.from\)\)/.test(ui) &&
    /callTamXml\(call, label, this\.exportSymmetry\(call, label\)\)/.test(ui) &&
    /xml: callTamXml\(this\.instance, this\.instance\.from, this\.exportSymmetry\(this\.instance, this\.instance\.from\)\),/.test(ui),
    'the single export AND the xml a saved edit stores both take it, so a save cannot store the lie either');
  check(!/callTamXml\([^)]*declaredSymmetry\(\)/.test(ui),
    'and no write site is left on the raw selector, which is what produced the reported mismatch');

  // THE REFUSAL REACHES THE SCREEN, both of the surfaces that asked.
  check(/this\.xmlEl\.value = '';/.test(ui),
    'a refused export CLEARS the pane, so an old tam cannot sit there looking like the result');
  check(/private doSave\(\) \{\s*\n\s*let spec: CallEdit \| null;\s*\n\s*try \{/.test(ui) &&
    /this\.refusal\(\(err as Error\)\.message\);/.test(ui),
    'and the save reports the same refusal through `refusal` instead of throwing out of a click handler');
  check(/private refusal\(message: string\) \{\s*\n\s*this\.statusEl\.textContent = '\\u2717 ' \+ message;/.test(ui),
    '`refusal` is the one place the marker is written, as an escape so the source stays plain ASCII');

  // AND THE NOTICE IS NOT A STATUS LINE. Asked what the old message had said, the answer was "I didn't notice /
  // the line was empty" - so the row is flagged and the CSS turns that flag into the panel's amber.
  check(/this\.asymInfoEl\.classList\.add\('warn'\);/.test(ui) && /this\.asymInfoEl\.classList\.remove\('warn'\);/.test(ui),
    'the selector s line is FLAGGED when the export will refuse, and un-flagged in every other case');
  check(/#hud \.part\.warn \{ color: var\(--warn\); font-weight: 600; \}/.test(css) && /--warn: #ffb454;/.test(css),
    'and the flag is the amber the panel already uses for "track incomplete" and "cannot pair"');
  check(/will NOT export: the half set cannot be written - \$\{rep\.reason\}/.test(ui),
    'the sentence leads with what will NOT happen, rather than with the geometry');

  // THE INERT CASE IS NOT REFUSED: when the export names its formation no dancers are written, so a half-set test
  // would be refusing something that never gets emitted.
  check(/private willNameFormation\(call: CallBundle, name\?: string\): boolean \{[\s\S]{0,240}?startsFromFormation\(call, poses\)/.test(ui) &&
    /if \(this\.willNameFormation\(call, name\)\) return 2;/.test(ui),
    'and an export that NAMES its formation is not refused: the choice is inert there, and the test is the same one `tam-xml` uses');
  check(/if \(this\.willNameFormation\(call, name\)\) \{\s*\n\s*this\.asymInfoEl\.textContent = `the export names/.test(ui),
    'the on-screen line uses that same predicate, so the notice and the export cannot disagree about it');
}

console.log(failures === 0 ? '\nasymmetric-export-probe: all green' : `\nasymmetric-export-probe: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
