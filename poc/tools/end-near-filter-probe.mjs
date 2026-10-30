// THE END SETUP NEAR-MATCH FILTER: when it is offered, what it says, and that it IS the engine's answer.
//
// Asked for as: "When the end setup displays Unknown formation, offer a filter icon button to the right of the select
// element. This button filters the listed setups to those that are close matches. I find I need this because some call
// moves leave the dancers in positions that are just outside a matching formation. So this filter would search for
// formations that almost match using a slightly more relaxed tolerance. If this list is empty, then that also tells me
// that this is a completely new formation."
//
// TWO RULES, TWO HOMES, and this probe keeps them apart on purpose:
//   * WHETHER the row offers the button, and WHAT it says when pressed, are `poc/src/end-setup-state.ts`'s - pure, so the
//     cases below drive the function rather than reading a 6,400-line DOM method (AGENTS.md §8 trap 27);
//   * WHICH formations are near, and with what margin, are the ENGINE's (`nearEndFormations` / `NEAR_END_BOARD_TOL`),
//     and the panel must call it rather than re-deriving a distance. The check below asks the engine directly, on a real
//     corpus call, and compares it with what the note would report - so the sentence and the list are one answer.
//
// THE NEGATIVE CONTROLS, each the plausible wrong rule:
//   * "offer the filter always" - red for a NAMED end, where it could only hide the formation the row is pointing at;
//   * "say nothing when the list is empty" - the request's whole point is that an empty list is a MEASUREMENT ("a
//     completely new formation"), and a bare empty picker reads as a broken one;
//   * "a note without the margin" - indistinguishable from a filter that looked nowhere;
//   * "the panel computes its own distance" - the engine's list is compared to the field the panel would have to
//     re-derive, and the source check requires the import.
//
// Run: node poc/tools/end-near-filter-probe.mjs   (from anywhere; build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');
const { endSetupState, nearFilterNote, showsNearFilter, UNKNOWN_SETUP } = await import(
  pathToFileURL(path.join(POC_DIR, 'src', 'end-setup-state.ts')).href
);
const engine = await import(pathToFileURL(path.join(ROOT, 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else {
    failures++;
    console.log('  FAIL ' + msg);
  }
};
const read = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');

console.log('== 1. the filter is offered only where it can say something ==');
{
  check(showsNearFilter(''), 'an UNNAMED end offers the filter');
  // THE TWO RULES READ THE SAME `name`, so the state that says "Unknown Setup" is the state that offers the filter -
  // and the check is that COUPLING rather than the placeholder string, which the panel never passes in.
  check(showsNearFilter('') && endSetupState('', 8).placeholder === UNKNOWN_SETUP,
    'and it is the same unnamed state the row states as "Unknown Setup", so the button and the sentence cannot disagree');
  for (const nothing of [null, undefined, '   ', '\t']) {
    check(showsNearFilter(nothing), `a ${JSON.stringify(nothing)} name counts as unnamed, so a blank never hides the button`);
  }
  check(!showsNearFilter('Alamo Wave'), 'a NAMED end does not offer it - the row already shows the answer');
  check(!showsNearFilter('Sashayed Lines'), 'and a second named end agrees, so the rule is not one special case');
}

console.log('\n== 2. what it says: the count, the margin, the closest - or the verdict ==');
{
  const tol = { position: 0.2, heading: 0.3 };
  const none = nearFilterNote(0, 217, tol, null);
  check(/no named formation is within/.test(none), `an EMPTY list says nothing is close (${none})`);
  check(none.includes('0.20') && none.includes('0.30'), 'and names the margin it searched, so "nothing" is a measurement');
  check(/new shape|does not carry/.test(none) && /Export/.test(none),
    'and says what that MEANS (a shape the corpus does not carry) and the way out (Export)');
  const one = nearFilterNote(1, 217, tol, 'Normal Lines');
  check(/^1 of 217/.test(one) && /is within/.test(one) && /closest Normal Lines/.test(one),
    `a single match reports one, the total and who (${one})`);
  const many = nearFilterNote(4, 217, tol, 'Circle');
  check(/^4 of 217/.test(many) && /are within/.test(many) && /closest Circle/.test(many),
    `several matches use the plural and still name the nearest (${many})`);
  const unnamed = nearFilterNote(2, 217, tol, '');
  check(!/closest/.test(unnamed), 'and no closest clause when the caller has no name to give');
  // NEGATIVE CONTROLS.
  check(nearFilterNote(0, 217, tol, null) !== nearFilterNote(4, 217, tol, 'Circle'),
    'NEGATIVE CONTROL: the empty verdict is not the same sentence as a hit, so a filter that looked nowhere cannot read as success');
  check(/0\.20/.test(nearFilterNote(0, 217, { position: 0.4, heading: 0.3 }, null)) === false,
    'NEGATIVE CONTROL: the margin in the sentence is the one passed in, not a constant copied into the wording');
}

console.log('\n== 3. the list IS the engine\'s answer, on a real call ==');
{
  // A real eight-dancer call whose end the corpus does NOT name would be ideal, but any call proves the WIRING: the note
  // must report the same count as `nearEndFormations` returns. `pass_thru` is used rather than a fixture so the numbers
  // are about the corpus.
  const moves = read('moves.xml');
  const formationsXml = read('formations.xml');
  let call = null;
  for (const variant of engine.buildCallVariants(read('ms/pass_thru.xml'), moves, formationsXml)) {
    const c = engine.normalizeInstance(variant);
    if (c.dancers.length === 8) {
      call = c;
      break;
    }
  }
  check(call !== null, 'an eight-dancer corpus call was loaded');
  const RAD = Math.PI / 180;
  const formations = [];
  for (const [name, ds] of engine.parseFormations(formationsXml)) {
    const poses = engine.completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * RAD, gender: d.gender })));
    if (poses.length === 8) formations.push({ name, poses });
  }
  const near = engine.nearEndFormations(call, formations);
  console.log(`    ${call.title}: ${near.length} near match(es) of ${formations.length}`);
  const note = nearFilterNote(near.length, formations.length, engine.NEAR_END_BOARD_TOL, near[0]?.name ?? null);
  check(note.includes(`${near.length} of ${formations.length}`) || (near.length === 0 && /no named formation/.test(note)),
    `the sentence reports the engine's own count (${note})`);
  check(near.every((f, i) => i === 0 || near[i - 1].worst.position <= f.worst.position),
    'and the engine returns them nearest first, which is the order the picker shows');
  check(near.every((f) => f.worst.position <= engine.NEAR_END_BOARD_TOL.position &&
    f.worst.heading <= engine.NEAR_END_BOARD_TOL.heading),
    'and every one of them is inside the relaxed margin, so the list is a filter and not the whole catalogue');
}

console.log('\n== 4. the panel wires it: one rule, one engine call, one writer for the list ==');
{
  // LINE ENDINGS ARE NORMALISED, because the working tree is CRLF (`core.autocrlf`) and every multi-line pattern below
  // would otherwise match nothing and read as "the panel does not do this" (AGENTS.md §8 trap 2).
  const readApp = (p) => fs.readFileSync(path.join(POC_DIR, p), 'utf8').replace(/\r\n/g, '\n');
  const src = readApp('src/editor-ui.ts');
  const html = readApp('index.html');
  const css = readApp('src/style.css');
  check(/import \{ endIdentityOptions, endSetupState, KEEP_END_PLACEHOLDER, nearFilterNote, showsNearFilter \} from '\.\/end-setup-state'/.test(src),
    'the panel imports the row rule from `end-setup-state.ts` rather than restating it');
  check(/nearEndFormations,\n  NEAR_END_BOARD_TOL,/.test(src),
    'and imports the engine\'s near lookup AND its margin, so the search is not re-derived here');
  check(/private setEndNearOnly\(on: boolean\)[\s\S]{0,900}?nearEndFormations\(call, formations\)/.test(src),
    'pressing the filter asks the engine for the near matches of THIS instance');
  check(/private setEndNearOnly\(on: boolean\)[\s\S]{0,1400}?nearFilterNote\(/.test(src),
    'and reports them with the row rule\'s sentence, so the count and the list cannot disagree');
  check(/const near = showsNearFilter\(info\.name\);\n    this\.endNearFilterBtn\.hidden = !near;/.test(src),
    'the button is shown from the rule, on the same `name` the placeholder is built from');
  check(/if \(!near && this\.endNearOnly\)/.test(src),
    'and an end that becomes NAMED retires the filtered list instead of leaving a shortlist for a stale premise');
  check(/private endSetupInfo\(call: CallBundle\)[\s\S]{0,1200}?if \(this\.endNearOnly\) \{/.test(src),
    'a DIFFERENT END BOARD retires it too - the filter is a view of one finish, not a mode of the panel');
  check(/this\.endNearFilterBtn\.addEventListener\('click', \(\) => this\.setEndNearOnly\(!this\.endNearOnly\)\)/.test(src),
    'and clicking it toggles the view');
  check(/private fillEndFormationOptions\(names: readonly string\[\] \| null\)/.test(src) &&
    /this\.fillEndFormationOptions\(null\);/.test(src),
    'ONE writer fills the End list (the filter and the call change both go through it), so the placeholder cannot be left by whichever ran last');
  check(/new Option\(KEEP_END_PLACEHOLDER, ''\)/.test(src),
    'and the placeholder text comes from the rule\'s constant rather than a second spelling of it');
  check(/<button id="edEndNearFilter" class="ed-near" hidden aria-pressed="false"/.test(html),
    'the button is in the markup, right of the picker, starts hidden and states its pressed state');
  check(html.indexOf('id="edEndFormation"') < html.indexOf('id="edEndNearFilter"'),
    'and it sits AFTER the select element it filters, which is where the request put it');
  check(/#editorPanel \.ed-near\[aria-pressed="true"\] \{ border-color: var\(--accent\); color: var\(--accent\); \}/.test(css),
    'pressed is a visible state in the panel\'s own accent colour - the filtered list otherwise looks like any other list');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
