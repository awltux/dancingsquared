// THE END SETUP NEAR-MATCH FILTER: when it is offered, what it says, at which tolerance, and that it IS the engine's answer.
//
// Asked for as: "When the end setup displays Unknown formation, offer a filter icon button to the right of the select
// element. This button filters the listed setups to those that are close matches. I find I need this because some call
// moves leave the dancers in positions that are just outside a matching formation. So this filter would search for
// formations that almost match using a slightly more relaxed tolerance. If this list is empty, then that also tells me
// that this is a completely new formation." AND THEN: "Change the edEndNearFilter button to a selector that defines the
// tolerance of the filter. The default would be its current hard-coded values. Display just the options [0.2, 0.4, 0.6,
// 0.8], defaulting to the current value of 0.2. The radian tolerances should also increment [0.3, 0.5, 0.7, 0.9]. Keep the
// current logic that only shows it if there is no exact match."
//
// TWO RULES, TWO HOMES, and this probe keeps them apart on purpose:
//   * WHETHER the row offers the control, WHAT it says, and WHICH tolerances it offers are
//     `poc/src/end-setup-state.ts`'s - pure, so the cases below drive the functions rather than reading a 6,400-line DOM
//     method (AGENTS.md §8 trap 27);
//   * WHICH formations are near, and at what margin, are the ENGINE's (`nearEndFormations`), and the panel must call it with
//     the chosen row rather than re-deriving a distance. The checks ask the engine directly, on a real corpus call, at every
//     tolerance in the table, and compare with what the note would report - so the sentence and the list are one answer.
//
// THE NEGATIVE CONTROLS, each the plausible wrong rule:
//   * "offer the control always" - red for a NAMED end, where it could only hide the formation the row is pointing at;
//   * "say nothing when the list is empty" - the request's whole point is that an empty list is a MEASUREMENT ("a
//     completely new formation"), and a bare empty picker reads as a broken one;
//   * "a note without the margin" - indistinguishable from a filter that looked nowhere;
//   * "the panel computes its own distance" - the engine's list is compared to the field the panel would have to
//     re-derive, and the source check requires the import;
//   * "the selector shows one tolerance and searches with another" - every (position, heading) pair is checked as a
//     table, and the panel's search is required to take the parsed VALUE, so a mismatch is red rather than plausible.
//
// Run: node poc/tools/end-near-filter-probe.mjs   (from anywhere; build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(POC_DIR, '..');
const { endSetupState, nearFilterChoice, NEAR_FILTER_ALL, NEAR_FILTER_CHOICES, nearFilterNote, showsNearFilter, UNKNOWN_SETUP } = await import(
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

console.log('\n== 2b. the tolerances the selector offers, `all`, and the default ==');
{
  // Asked for as: "Display just the options [0.2, 0.4, 0.6, 0.8], defaulting to the current value of 0.2. The radian
  // tolerances should also increment [0.3, 0.5, 0.7, 0.9].", then "I need more range, expand the tolerance set to include
  // 1.0/1.1 and 1.2/1.3", then "Change the default to 'off', as there is currently no way to show all formations" - "Make
  // that 'all'".
  check(NEAR_FILTER_CHOICES.length === 6, `six rows (${NEAR_FILTER_CHOICES.length}) - the four asked for, plus the two more range`);
  check(NEAR_FILTER_CHOICES.map((c) => c.position).join(',') === '0.2,0.4,0.6,0.8,1,1.2',
    `the positions step 0.2 from 0.2 to 1.2 (${NEAR_FILTER_CHOICES.map((c) => c.position).join(', ')})`);
  check(NEAR_FILTER_CHOICES.map((c) => c.heading).join(',') === '0.3,0.5,0.7,0.9,1.1,1.3',
    `and the radians lead each position by 0.1, 0.3 to 1.3 (${NEAR_FILTER_CHOICES.map((c) => c.heading).join(', ')})`);
  // THE PAIRING IS THE RULE, so it is checked as one rather than as two lists that happen to line up.
  check(NEAR_FILTER_CHOICES.every((c) => Math.abs(c.heading - (c.position + 0.1)) < 1e-9),
    'every heading is exactly its own position + 0.1');
  // THE FIRST ROW IS STILL THE OLD HARD-CODED MARGIN, which is what makes it a measured number rather than a guess: the
  // engine's own `NEAR_END_BOARD_TOL` is what the filter searched with before it had a selector.
  check(NEAR_FILTER_CHOICES[0].position === engine.NEAR_END_BOARD_TOL.position &&
    NEAR_FILTER_CHOICES[0].heading === engine.NEAR_END_BOARD_TOL.heading,
    `the first row IS the engine's near margin (${engine.NEAR_END_BOARD_TOL.position} / ${engine.NEAR_END_BOARD_TOL.heading})`);
  check(NEAR_FILTER_ALL === 'all', `the no-filter value is the word the request settled on (${JSON.stringify(NEAR_FILTER_ALL)})`);
  // THE TOLERANCE SELECTOR IS OFF BY DEFAULT: `all` must be what the control opens on, or the picker hides formations the
  // caller asked to see (which is the defect the request names - there was no way back to the whole list).
  check(nearFilterChoice(NEAR_FILTER_ALL) === null && nearFilterChoice('') === null && nearFilterChoice('off') === null,
    '`all` - and any value the table does not name - means NO filter, not the narrowest one');
  check(nearFilterChoice('0.2') === NEAR_FILTER_CHOICES[0] && nearFilterChoice('1.2') === NEAR_FILTER_CHOICES[5],
    'while a tolerance value maps to its own row, at both ends of the range');
  // NEGATIVE CONTROL: a stale or hand-edited value must not land on a ROW (which would search), and must not pass `NaN`
  // into the search either - both would read as "no formation is close" for a value nobody chose.
  check(nearFilterChoice('0.7') === null && nearFilterChoice('NaN') === null && nearFilterChoice('') === null,
    'NEGATIVE CONTROL: an unknown value is treated as `all`, so it shows the whole list rather than searching with NaN');
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
  console.log(`    ${call.title}: ${near.length} near match(es) of ${formations.length} at the default margin`);
  const note = nearFilterNote(near.length, formations.length, engine.NEAR_END_BOARD_TOL, near[0]?.name ?? null);
  check(note.includes(`${near.length} of ${formations.length}`) || (near.length === 0 && /no named formation/.test(note)),
    `the sentence reports the engine's own count (${note})`);
  check(near.every((f, i) => i === 0 || near[i - 1].worst.position <= f.worst.position),
    'and the engine returns them nearest first, which is the order the picker shows');
  check(near.every((f) => f.worst.position <= engine.NEAR_END_BOARD_TOL.position &&
    f.worst.heading <= engine.NEAR_END_BOARD_TOL.heading),
    'and every one of them is inside the relaxed margin, so the list is a filter and not the whole catalogue');
  // EVERY ROW, ON THE SAME CALL: the search really uses the tolerance it is given, the list only widens as the row
  // widens, and nothing outside the chosen margin sneaks in.
  const counts = [];
  let slowest = 0;
  for (const choice of NEAR_FILTER_CHOICES) {
    const t0 = Date.now();
    const list = engine.nearEndFormations(call, formations, choice);
    slowest = Math.max(slowest, Date.now() - t0);
    counts.push(list.length);
    if (!list.every((f) => f.worst.position <= choice.position && f.worst.heading <= choice.heading)) {
      check(false, `every match at ${choice.position} is inside that row's margin`);
    }
  }
  console.log(`    counts at ${NEAR_FILTER_CHOICES.map((c) => c.position).join('/')}: ${counts.join(' / ')} (slowest search ${slowest} ms)`);
  check(counts.every((n, i) => i === 0 || counts[i - 1] <= n),
    `widening the tolerance can only ADD matches (${counts.join(' / ')})`);
  check(counts[counts.length - 1] > counts[0] || counts[0] === formations.length,
    'and on this call the widest row is not the same list as the default, so the selector buys something');
  // THE COST the panel pays per changed end board, because `renderEndSetupState` re-searches after a drag: measured here so
  // the comment in `editor-ui.ts` can quote a number rather than a hope.
  check(slowest < 25, `one search is cheap enough to run per changed board (${slowest} ms)`);
}

console.log('\n== 4. the panel wires it: one rule, one engine call, one writer for the list ==');
{
  // LINE ENDINGS ARE NORMALISED, because the working tree is CRLF (`core.autocrlf`) and every multi-line pattern below
  // would otherwise match nothing and read as "the panel does not do this" (AGENTS.md §8 trap 2).
  const readApp = (p) => fs.readFileSync(path.join(POC_DIR, p), 'utf8').replace(/\r\n/g, '\n');
  const src = readApp('src/editor-ui.ts');
  const html = readApp('index.html');
  const css = readApp('src/style.css');
  check(/import \{ endIdentityOptions, endSetupState, KEEP_END_PLACEHOLDER, nearFilterChoice, nearFilterNote, showsNearFilter \} from '\.\/end-setup-state'/.test(src),
    'the panel imports the row rule AND the tolerance table from `end-setup-state.ts` rather than restating either');
  check(/nearEndFormations,/.test(src),
    'and imports the engine\'s near lookup, so the search is not re-derived here');
  check(/private setEndNearFilter\(\)[\s\S]{0,1200}?nearFilterChoice\(this\.endNearFilterSel\.value\)[\s\S]{0,900}?nearEndFormations\(call, formations, tol\)/.test(src),
    'the control\'s VALUE becomes the tolerance the engine searches with - one read, no second copy of the number');
  // `all` DOES NOT SEARCH: the branch has to hand the picker its own full list back, which is the whole point of the
  // request ("there is currently no way to show all formations").
  check(/private setEndNearFilter\(\)[\s\S]{0,1400}?if \(tol === null\) \{[\s\S]{0,300}?this\.endNear = null;[\s\S]{0,200}?this\.fillEndFormationOptions\(null\);/.test(src),
    'and `all` (or any value the table does not name) puts the WHOLE list back instead of searching');
  check(/private setEndNearFilter\(\)[\s\S]{0,1600}?nearFilterNote\(/.test(src),
    'and the sentence is the row rule\'s, so the count, the list and the margin cannot disagree');
  check(/const near = showsNearFilter\(info\.name\);\n    this\.endNearFilterSel\.hidden = !near;/.test(src),
    'the control is shown from the rule, on the same `name` the placeholder is built from - the "only when no exact match" rule survives');
  check(/const tol = nearFilterChoice\(this\.endNearFilterSel\.value\);\n    if \(call !== null && this\.endNear === null && tol !== null\) this\.setEndNearFilter\(\);/.test(src),
    'and being on screen only means a SHORTLIST when a tolerance is chosen: `all` leaves the full list alone (so a load\'s own status sentence is not overwritten), and a loaded call guards the re-entrant fill');
  check(/if \(!near\) \{[\s\S]{0,400}?this\.endNear = null;[\s\S]{0,200}?this\.fillEndFormationOptions\(null\);/.test(src),
    'an end that becomes NAMED retires the shortlist instead of leaving one for a stale premise');
  check(/private endSetupInfo\(call: CallBundle\)[\s\S]{0,2400}?if \(this\.endNear !== null\) \{/.test(src),
    'a DIFFERENT END BOARD retires it too - the shortlist is a view of one finish, not a mode of the panel');
  check(/this\.endNearFilterSel\.addEventListener\('change', \(\) => this\.setEndNearFilter\(\)\);/.test(src),
    'and changing the selector re-applies the filter - or, on `all`, the full list');
  check(/private fillEndFormationOptions\(names: readonly string\[\] \| null\)/.test(src) &&
    /this\.fillEndFormationOptions\(null\);/.test(src),
    'ONE writer fills the End list (the filter and the call change both go through it), so the placeholder cannot be left by whichever ran last');
  check(/new Option\(KEEP_END_PLACEHOLDER, ''\)/.test(src),
    'and the placeholder text comes from the rule\'s constant rather than a second spelling of it');
  // THE MARKUP: a select with EXACTLY the rows the TABLE names, headed by `all` - derived from the table, so a row added
  // there cannot be forgotten here - `all` selected, and hidden to start.
  const markup = /<select id="edEndNearFilter" class="ed-near-tol" hidden[^>]*>([\s\S]*?)<\/select>/.exec(html);
  check(markup !== null, 'the control is a `<select>` in the markup, right of the picker, and starts hidden');
  const options = markup ? [...markup[1].matchAll(/<option value="([^"]+)"( selected)?>([^<]*)<\/option>/g)].map((m) => ({ value: m[1], selected: !!m[2], label: m[3] })) : [];
  check(options.length === NEAR_FILTER_CHOICES.length + 1 && options[0].value === NEAR_FILTER_ALL && options[0].label === 'all',
    `it opens with the \`all\` row (${options.map((o) => o.label).join(' / ')})`);
  // The VALUE is a number the panel parses (`parseFloat`), so the comparison is numeric: the markup writes `1.0` where the
  // table writes `1`, and those are the same row.
  const expected = NEAR_FILTER_CHOICES.map((c) => c.position);
  check(options.slice(1).map((o) => parseFloat(o.value)).join(',') === expected.join(','),
    `then exactly the table's rows, in order (${options.slice(1).map((o) => o.value).join(', ')} of ${expected.join(', ')})`);
  check(options.filter((o) => o.selected).length === 1 && options[0].selected,
    'and `all` is the one selected by default - the whole list is the default, which is the request');
  check(options.every((o) => o.label === o.value),
    `each option reads as its own number or as \`all\`, not as a sentence (${options.map((o) => o.label).join(' / ')})`);
  check(html.indexOf('id="edEndFormation"') < html.indexOf('id="edEndNearFilter"'),
    'and it sits AFTER the select element it filters, which is where the request put it');
  check(/#editorPanel \.ed-near-tol \{[\s\S]{0,200}?flex: 0 0 auto;/.test(css),
    'the CSS gives it a narrow, non-stretching select so the picker keeps the row');
  check(!/ed-near\[aria-pressed/.test(css) && !/id="edEndNearFilter"[^>]*aria-pressed/.test(html),
    'and no pressed state is left behind: the control is a value now, not an icon toggle');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
