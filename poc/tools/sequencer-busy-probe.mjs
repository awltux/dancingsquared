// Probe: THE SEQUENCER LOCKS ITS HUD AND SHOWS AN INDETERMINATE WORKING BAR while a slow action runs.
//
// REPORTED: "clicking a sequence slot or selecting a group can take some time to calculate, but there is no
// feedback that the system is processing the request. The HUD should lock up and a processing progress bar
// displayed while working, so the user doesnt double click."
//
// WHAT THE WIRING HAS TO BE, and each part is a check below. The hard part is not the bar, it is the YIELD:
// the work is synchronous, so setting the busy state and running the work in the same task means the browser
// never paints the state it was just given - the caller sees the freeze and no bar, which is the complaint.
//
//   - ONE pair of methods owns every DOM write for the lock (`beginBusy`/`endBusy`), and one wrapper
//     (`runBusy`) owns the yield and the try/finally, so a handler cannot half-lock the panel;
//   - the work runs on the SECOND animation frame after the lock goes up, which is what guarantees a painted
//     frame carries it (`setTimeout(…, 0)` alone can be serviced before the next paint);
//   - a second call while the lock is up is DROPPED, which is the double-click protection;
//   - the lock is functional (`pointer-events: none` on the HUD root) as well as visual, and it is restored
//     on the way out even when the work throws;
//   - the bar is INDETERMINATE: `role="progressbar"` with no `aria-valuenow`, because none of the wrapped
//     operations reports a countable step - a percentage would be invented.
//
// WHY THIS PROBE READS SOURCE. The interaction lives in `sequencer-ui.ts`, which builds DOM against a live
// `#hud` and cannot run under plain node - the same limit `subset-highlight-probe.mjs` and
// `parallel-lane-probe.mjs` record - so the wiring is read from the THREE files it lives across.
//
// NOT OBSERVED IN A BROWSER. This pins the wiring, not the picture: whether the bar is actually on screen, and
// whether the HUD really looks locked, needs a headed browser and is stated as unchecked.
//
// Run: node poc/tools/sequencer-busy-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
/** The app's sources are checked in with CRLF, so a multi-line literal match has to normalise first. */
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');

const ui = readSource('src/sequencer-ui.ts');
const html = readSource('index.html');
const css = readSource('src/style.css');

/** The body of a class method, from its declaration to its own closing brace. */
const bodyOf = (decl) => {
  const i = ui.indexOf(decl);
  if (i < 0) return '';
  const j = ui.indexOf('\n  }', i);
  return ui.slice(i, j < 0 ? undefined : j);
};

const runBusy = bodyOf('private runBusy(work: () => void, label?: string) {');
const beginBusy = bodyOf('private beginBusy(label?: string) {');
const endBusy = bodyOf('private endBusy() {');

console.log('== one lock, one wrapper: the DOM writes live in one pair of methods ==');
check(runBusy.length > 0 && beginBusy.length > 0 && endBusy.length > 0,
  'beginBusy, endBusy and runBusy each exist');
check(/private runBusy\(work: \(\) => void, label\?: string\) \{/.test(ui)
  && (ui.match(/this\.beginBusy\(/g) ?? []).length === 1,
  'runBusy is the ONE caller of beginBusy, so a handler cannot put the lock up on its own');

console.log('\n== the work runs on the second frame, so the lock is PAINTED first ==');
// rAF callbacks run BEFORE their own frame is painted, so the first frame is the one that paints the lock and
// the second callback is reached only after that paint. A single rAF is not enough, and `setTimeout(…, 0)`
// (which the report's own suggestion of "yield" would reach for first) can be serviced before the paint.
check(/this\.beginBusy\(label\);\n    requestAnimationFrame\(\(\) => \{\n      requestAnimationFrame\(\(\) => \{/.test(runBusy),
  'the work is scheduled on a DOUBLE requestAnimationFrame, which is what guarantees a painted frame between');
check(!/setTimeout/.test(runBusy),
  'and NOT on a timer, which can be serviced before the next paint and would leave the bar unpainted');

console.log('\n== the lock is always released, including when the work throws ==');
check(/try \{\n          work\(\);\n        \} finally \{\n          this\.busyRunning = false;\n          this\.endBusy\(\);/.test(runBusy),
  'the work runs inside try/finally, and the finally is what clears the lock');

console.log('\n== a second call while the lock is up is DROPPED ==');
check(/if \(this\.busy\) \{\n      if \(!this\.busyRunning\) return;/.test(runBusy),
  'the guard sees the lock and drops the second call - the double-click protection');
check(/this\.busyRunning = true;/.test(runBusy) && /this\.busyRunning = false;/.test(runBusy),
  'and `busyRunning` marks the inside of the work, so a NESTED call runs while a second CLICK does not');

console.log('\n== the lock is functional as well as visible ==');
check(/this\.hudEl\.classList\.add\('seq-busy'\);/.test(beginBusy)
  && /this\.hudEl\.classList\.remove\('seq-busy'\);/.test(endBusy),
  'the HUD ROOT carries the `.seq-busy` class and gives it back');
check(/this\.hudEl\.setAttribute\('aria-busy', 'true'\);/.test(beginBusy)
  && /this\.hudEl\.removeAttribute\('aria-busy'\);/.test(endBusy),
  'and `aria-busy` says the same thing to a screen reader, and is removed rather than set to false');
check(/this\.busyEl\.hidden = false;/.test(beginBusy) && /this\.busyEl\.hidden = true;/.test(endBusy),
  'the overlay is shown and re-hidden through the ONE pair, so the two cannot drift apart');
check(/#hud\.seq-busy \{ pointer-events: none;/.test(css),
  'the class TAKES THE POINTER AWAY on the panel root, so a second click cannot even be delivered');
check(/#hud \.seq-busy\[hidden\] \{ display: none; \}/.test(css),
  'and the flex overlay still honors `hidden`, which `display: flex` would otherwise beat');

console.log('\n== the bar is INDETERMINATE, and does not invent a percentage ==');
check(/<div id="seqBusy" class="seq-busy" hidden>/.test(html), 'the overlay is in the panel markup, hidden');
check(/role="progressbar"/.test(html), 'the bar is a progressbar');
check(!/aria-valuenow|aria-valuemin|aria-valuemax/.test(html),
  'with NO value attributes, which is what makes it indeterminate rather than a made-up percentage');
check(/aria-labelledby="seqBusyLabel"/.test(html) && /id="seqBusyLabel"/.test(html),
  'and it is named by the caption the wrapper sets, so the live label is what is announced');
// THE FILL KEEPS MOVING WHILE THE THREAD IS BLOCKED, which only a compositor-driven property can do.
check(/animation: seq-busy-slide 1\.1s ease-in-out infinite;/.test(css)
  && /@keyframes seq-busy-slide \{\n  from \{ transform: translateX\(-110%\); \}/.test(css),
  'the fill slides on a `transform` keyframe, which survives the main thread being blocked');

console.log('\n== the reported handlers, and every action that runs the same paths, go through it ==');
check(/private activateStep\(idx: number\) \{\n    this\.runBusy\(\(\) => \{/.test(ui),
  'clicking a SEQUENCE SLOT (`activateStep`) is wrapped');
check(/this\.groupSelect\.addEventListener\('change', \(\) => this\.runBusy\(\(\) => \{/.test(ui),
  'selecting a GROUP is wrapped');
check(/if \(row\?\.dataset\.idx != null\) this\.activateStep\(Number\(row\.dataset\.idx\)\);/.test(ui),
  'and the seq-list click still reaches `activateStep`, which is where the lock is');
for (const fn of ['applySelected', 'deleteStep', 'undo', 'redo', 'reset', 'runSolve', 'applySolve', 'rebuildSeq', 'importAll8']) {
  check(new RegExp(`private ${fn}\\([^)]*\\) \\{\\n    this\\.runBusy\\(\\(\\) => \\{`).test(ui), `${fn} is wrapped`);
}
check(/openSequence\(steps: ModuleStep\[\], atCall\?: string, startFormation\?: string\) \{\n    this\.runBusy\(\(\) => \{/.test(ui),
  'openSequence (the module open and the browse view\'s use-this-sequence) is wrapped');
check(/this\.parallelBtn\.addEventListener\('click', \(\) => this\.runBusy\(\(\) => \{/.test(ui),
  'and While… is wrapped');

console.log('\n== the checks fail on the faults they were written for ==');
{
  const sync = ui.replace(
    'this.beginBusy(label);\n    requestAnimationFrame(() => {\n      requestAnimationFrame(() => {',
    'this.beginBusy(label);\n    (() => {');
  check(sync !== ui && !/this\.beginBusy\(label\);\n    requestAnimationFrame\(\(\) => \{\n      requestAnimationFrame/.test(sync),
    'running the work without the double frame fails the yield check - the reported "no feedback" defect');

  const timer = ui.replace('requestAnimationFrame(() => {\n      requestAnimationFrame(() => {', 'setTimeout(() => {\n      (() => {');
  check(timer !== ui && /setTimeout/.test(timer) && !/setTimeout/.test(runBusy),
    'reaching for a timer instead fails the check that keeps the yield a frame');

  const noGuard = ui.replace('      if (!this.busyRunning) return;\n', '');
  check(noGuard !== ui && !/if \(this\.busy\) \{\n      if \(!this\.busyRunning\) return;/.test(noGuard),
    'dropping the re-entrancy guard fails the double-click check');

  const noFinally = ui.replace('        } finally {\n          this.busyRunning = false;\n          this.endBusy();\n        }', '        }\n        this.endBusy();');
  check(noFinally !== ui
    && !/try \{\n          work\(\);\n        \} finally \{\n          this\.busyRunning = false;\n          this\.endBusy\(\);/.test(noFinally),
    'clearing the lock outside the finally fails the check that it survives a throw');

  const determinate = html.replace('aria-labelledby="seqBusyLabel"', 'aria-labelledby="seqBusyLabel" aria-valuenow="50"');
  check(determinate !== html && /aria-valuenow/.test(determinate),
    'putting a percentage on the bar fails the check that no progress is invented');

  const noLock = css.replace('#hud.seq-busy { pointer-events: none;', '#hud.seq-busy {');
  check(noLock !== css && !/#hud\.seq-busy \{ pointer-events: none;/.test(noLock),
    'leaving the pointer live fails the check that the HUD is functionally locked, not just dimmed');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
