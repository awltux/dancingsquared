// THE FIGURE ("WHILE…") MODE'S STATE AND ITS CHROME EACH HAVE EXACTLY ONE OWNER.
//
// REPORTED: with a figure open (`Heads Promenade 3/4 to home` with `All But Heads` in the lane), clicking the
// CURRENT TIMELINE SLOT broke the mode - the while BOX stayed on screen while the group selector said `All 8`
// and the primary button said "Add to sequence". `While…` then opened nothing, calls landed in the sequence
// instead of a lane, and there was no way back.
//
// WHAT THE WIRING HAS TO BE, and each part is a check below:
//
//   - the STATE (`this.parallel`) is written in ONE place, `setParallel`, which runs the chrome with it - the
//     edit paths used to assign it at fourteen sites, so a clear that repainted one display and not another
//     was one edit away;
//   - the CHROME is derived in ONE place, `applyParallelChrome`, from the state alone: the panel edge
//     (`seq-figure`), the banner, the two figure buttons and the primary button's caption. Before this, the
//     edge and the banner were painted by `renderFigureBar` and the buttons and group list by
//     `refreshCallSelect` - two windows on one state, which is what let the box and the button disagree;
//   - `render()` and `refreshCallSelect()` BOTH route through it, so neither can rebuild its own half of the
//     mode while leaving the other stale;
//   - the timeline-slot path (`activateStep`) clears the mode THROUGH the setter rather than assigning the
//     state, which is the reported defect in one line.
//
// WHY THIS PROBE READS SOURCE. `sequencer-ui.ts` builds DOM against a live `#hud` and cannot run under plain
// node - the same limit `subset-highlight-probe.mjs`, `sequencer-busy-probe.mjs` and `parallel-lane-probe.mjs`
// record. So the wiring is read from the source and the COUNTS are the assertion: "there is exactly one writer
// of each of these" is measurable where "the box went away" is not.
//
// PINS WIRING ONLY. NO BROWSER CHECK WAS PERFORMED for this change, and this probe cannot make one: whether
// the box, the button and the group selector actually agree on screen needs a headed browser, and is stated
// here as unchecked rather than implied.
//
// Run: node poc/tools/parallel-owner-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures++; }
};
/** The app's TypeScript is checked in with CRLF, so a multi-line literal match has to normalise first. */
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');

const ui = readSource('src/sequencer-ui.ts');
const css = readSource('src/style.css');

/** The body of a class member, from its declaration to its own closing brace at the class-member indent. */
const bodyOf = (s, decl) => {
  const i = s.indexOf(decl);
  if (i < 0) return '';
  const j = s.indexOf('\n  }', i);
  return j < 0 ? '' : s.slice(i, j);
};

// THE COUNTS ARE THE ASSERTION. A regex for each write that must exist ONCE, so the gate is a measurement
// rather than a reading of the method that happens to be there today.
const stateWriters = (s) => (s.match(/this\.parallel\s*=/g) ?? []).length;
const edgeWriters = (s) => (s.match(/classList\.(?:toggle|add|remove)\('seq-figure'/g) ?? []).length;
const buttonWriters = (s) => (s.match(/this\.applyBtn\.textContent/g) ?? []).length;
/** The rest of the mode's chrome, each of which `refreshCallSelect` and `renderFigureBar` used to split. */
const chromeWriters = (s) => (s.match(/this\.(?:parallelBtn|parallelDoneBtn)\.(?:disabled|title)\s*=|this\.figureBarEl\.hidden\s*=/g) ?? []).length;

const chrome = 'private applyParallelChrome() {';
const chromeBody = bodyOf(ui, chrome);
const setter = bodyOf(ui, 'private setParallel(p: ParallelEntry | null) {');

// ------------------------------------------------------------------ 1. one writer of the state
console.log('== 1. the figure state has ONE writer, and it runs the chrome with it ==');

check(setter.length > 0, '`setParallel` is where the mode is written');
check(stateWriters(ui) === 1,
  `exactly ONE assignment to \`this.parallel\` in the file (found ${stateWriters(ui)})`);
check(/this\.parallel = p;/.test(setter),
  'and it is inside `setParallel` - the fourteen per-site assignments are gone');
check(/this\.applyParallelChrome\(\);/.test(setter),
  'the setter derives the chrome in the same step, so the state and the picture cannot be changed apart');

// ------------------------------------------------------------------ 2. one writer of each piece of chrome
console.log('\n== 2. each piece of the mode\'s chrome has ONE writer, and it is `applyParallelChrome` ==');

check(chromeBody.length > 0, '`applyParallelChrome` is the method that derives the chrome');
check(edgeWriters(ui) === 1,
  `exactly ONE place toggles the \`seq-figure\` edge (found ${edgeWriters(ui)})`);
check(/classList\.toggle\('seq-figure', !!p\)/.test(chromeBody),
  'and that place derives it from the state, so the edge cannot outlive the figure');
check(buttonWriters(ui) === 1,
  `exactly ONE assignment to \`applyBtn.textContent\` (found ${buttonWriters(ui)})`);
check(/this\.applyBtn\.textContent = this\.parallel \? 'Add to lane' : 'Add to sequence';/.test(chromeBody),
  'and the primary button is captioned from the same state');
check(chromeWriters(ui) === 5,
  `the banner, the two figure buttons and their titles are written ONCE each (found ${chromeWriters(ui)}, expected 5)`);
for (const w of ['this.figureBarEl.hidden = !p;', 'this.parallelBtn.disabled = !p;', 'this.parallelDoneBtn.disabled = !p;']) {
  check(chromeBody.includes(w), `\`${w}\` lives in \`applyParallelChrome\`, not in the caller`);
}
check(/if \(p\) this\.fillParallelGroupSelect\(\);\n    else this\.refreshGroupSelect\(\);/.test(chromeBody),
  'and the group selector is populated from the same state - the figure\'s list, or the board\'s');

// ------------------------------------------------------------------ 3. both callers route through it
console.log('\n== 3. render() AND refreshCallSelect() route through the one chrome method ==');

const renderBody = bodyOf(ui, '  render() {');
const pickerBody = bodyOf(ui, 'private refreshCallSelect() {');
check(/this\.applyParallelChrome\(\);/.test(renderBody),
  'render() repaints the mode\'s chrome through the one method');
check(/this\.applyParallelChrome\(\);/.test(pickerBody),
  'refreshCallSelect() does the same, so a picker rebuild cannot leave the chrome behind');
check(!/classList\.(?:toggle|add|remove)\('seq-figure'/.test(bodyOf(ui, 'private renderFigureBar() {')),
  'renderFigureBar() no longer paints the edge itself - the split that produced the reported mismatch');
check(!/this\.figureBarEl\.hidden/.test(bodyOf(ui, 'private renderFigureBar() {')),
  'and no longer shows or hides the banner itself');
check(!/if \(this\.parallel\)/.test(bodyOf(ui, 'private refreshGroupSelect() {')),
  'refreshGroupSelect() is the board\'s own list again, not the figure\'s - the figure has `fillParallelGroupSelect`');

// ------------------------------------------------------------------ 4. the timeline slot reconciles
console.log('\n== 4. the timeline-slot path clears the state THROUGH the setter ==');

const activate = bodyOf(ui, 'private activateStep(idx: number) {');
check(/this\.setParallel\(null\)/.test(activate),
  'clicking a non-figure slot clears the mode through `setParallel`, which repaints the box, button and group');
check(!/this\.parallel\s*=/.test(activate),
  'and does NOT assign the state directly - the half-done clear that was reported');
check(/if \(!this\.resumeFigure\(idx\) && this\.parallel\) \{/.test(activate),
  'the clear itself is kept: the mode belongs to the row it was opened from');
check(/if \(this\.parallel\) \{ this\.setParallel\(null\); this\.refreshCallSelect\(\); \}/.test(ui),
  'and arrowing off a figure takes the same route');
check(/#hud\.seq-figure \{ /.test(css),
  'the edge class the toggle sets still has a style, so it is a visible mode and not a no-op');

// ------------------------------------------------------------------ 5. the faults the checks were written for
console.log('\n== 5. the checks fail on the faults they were written for ==');
{
  // THE REPORTED DEFECT, injected: the timeline-slot clear writes the state directly and repaints the picker
  // only. That turns the one-owner count red AND the "routes through the setter" check red - the two checks
  // that would have caught the report.
  const rawClear = ui.replace(
    '        this.setParallel(null);\n        this.refreshCallSelect();\n      }',
    '        this.parallel = null;\n        this.refreshCallSelect();\n      }');
  check(rawClear !== ui && stateWriters(rawClear) === 2 && !/this\.setParallel\(null\)/.test(bodyOf(rawClear, 'private activateStep(idx: number) {')),
    'assigning the state in the timeline path fails BOTH the one-owner count and the routes-through check');

  // A SECOND WINDOW ON THE BUTTON, which is the reported mismatch in miniature: the picker repaints the
  // caption on its own. This is the check that keeps the caption in one place, and only that one.
  const splitButton = ui.replace(
    '    this.applyParallelChrome();\n    const prev = this.callSelect.value;',
    "    this.applyParallelChrome();\n    this.applyBtn.textContent = this.parallel ? 'Add to lane' : 'Add to sequence';\n    const prev = this.callSelect.value;");
  check(splitButton !== ui && buttonWriters(splitButton) !== 1 && buttonWriters(ui) === 1,
    'repainting the caption in the picker fails the ONE-assignment check for `applyBtn.textContent`');

  // A SECOND WINDOW ON THE EDGE: the banner paints the class again, which is exactly how the edge and the
  // button came to disagree. Caught by the edge count and by the renderFigureBar check; the button check and
  // the state count stay GREEN, which is why the counts are separate.
  const splitEdge = ui.replace(
    '    if (!p) return;\n    const lanes = p.groups',
    "    if (!p) return;\n    this.hudEl.classList.toggle('seq-figure', !!p);\n    const lanes = p.groups");
  check(splitEdge !== ui && edgeWriters(splitEdge) === 2
    && /classList\.toggle\('seq-figure'/.test(bodyOf(splitEdge, 'private renderFigureBar() {')),
    'toggling the edge from renderFigureBar again fails the ONE-toggle check and the renderFigureBar check');

  // DROPPING THE ROUTE: render() keeps its own half and stops deriving the chrome. Caught by the route check
  // alone - the counts, the setter and the timeline path are untouched by it.
  const unrouted = ui.replace(
    '    this.applyParallelChrome();\n    this.renderFigureBar();',
    '    this.renderFigureBar();');
  check(unrouted !== ui && !/this\.applyParallelChrome\(\);/.test(bodyOf(unrouted, '  render() {'))
    && stateWriters(unrouted) === 1,
    'dropping the route from render() fails the routes-through check while the one-owner count stays green');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
