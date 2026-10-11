// Probe: CHANGING THE SETUP KEEPS THE SCRUB, AND AN END-PINNED SCRUB STAYS AT THE END.
//        CHANGING THE CALL STILL RESETS.
//
// Asked for in two parts. First: "When in the call editor, changing setup shouldn't reset the scrub
// time. Sometimes I want to compare the end formation while stepping through the setups." Then, once
// that shipped: "If I step through the setups and the initial scrub was at it's max, set it to max for
// subsequent setups, so I'm always viewing the end formation of the call i.e. last frame of the call.
// Currently it maintains the first calls duration, which doesnt work if the next setup opens a call
// that is longer."
//
// THE ARITHMETIC IS IMPORTED, NOT MIRRORED (§5). It lives in `poc/src/scrub-keep.ts`, which has no DOM
// and no `three`, so node's type stripping can load it here - the same arrangement `grid-magnet.ts` has
// with `snap-grid-probe.mjs`. A probe that restated the formula would be measuring a copy of it.
//
// The DOM half cannot be reached from a probe, so the WIRING is read as source: `editor-ui.ts` is
// searched for the two call sites. That half is weakest and is stated as such - it proves the pickers
// pass the right flag, not that the board follows.
//
// NEGATIVE CONTROL, and it is the exact rule this replaces: carry the absolute beat and clamp it
// (`min(nextBeats, at)`). Measured below, it agrees with `keptScrubBeat` on EVERY case except one -
// at-the-end into a LONGER authoring - so "the end stays the end" is the check that catches it, and the
// position checks cannot, because on those the two rules return the same number.
//
// VERIFIED IN A BROWSER as well (Chromium against a fresh `poc/dist`), because the arithmetic is only
// half of it and no probe can see where the playhead ended up. `Left Turn Thru` is the call to use: its
// two authorings really do differ, 4 beats from `Facing Couples Compact` against 5 from `Wave LH`. With
// the scrub at `beat 4.00 / 4.00`, switching the setup gave `beat 5.00 / 5.00` - the last frame of the
// longer authoring, where the clamp this replaces would have shown its middle (`4.00 / 5.00`).
//
// THE NEGATIVE CONTROL IN THE SAME PANEL: the scrub was then set mid-call to `beat 2.00 / 5.00`, and
// switching back to the shorter authoring read `beat 2.00 / 4.00` - carried as a position, not pinned.
// The CALL picker's reset was measured in the previous run of this probe's feature (`Forward and Back`
// -> `Heads Forward and Back` -> `beat 0.00 / 4.00`).
//
// AND `Forward and Back` CANNOT SHOW THIS, which cost a browser session to find out: all three of its
// authorings are 4 beats, so the setup picker there is a no-op for this rule. A call with several
// authorings is not enough - they have to differ in LENGTH.
//
// Run: node poc/tools/editor-setup-scrub-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(POC, p), 'utf8').replace(/\r\n/g, '\n');

const { SCRUB_STEP, keptScrubBeat } = await import(pathToFileURL(path.join(POC, 'src/scrub-keep.ts')).href);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

console.log('== the reported case: at the end, into a LONGER authoring ==');
// The measurement from the report, stated as a number rather than an adjective: 4.00 of 4.00, stepping
// to an 8-beat authoring. The rule this replaces lands on 4.00 - the MIDDLE of the new call - so the end
// formation the caller was stepping through the setups to compare is the one thing the step hides.
const replaced = (at, nextBeats) => Math.max(0, Math.min(nextBeats, at));
check(keptScrubBeat(4, 4, 8) === 8,
  'beat 4.00 / 4.00 into an 8-beat authoring lands on 8.00 (the last frame), not on 4.00 (the middle)');
check(replaced(4, 8) === 4,
  'and the clamp this replaces really does land on 4.00 there - so this check, and not the position checks below, is the one that rules it out');

console.log('\n== the pin is self-sustaining, which is what "subsequent setups" needs ==');
// No extra state: each step re-reads "am I at the end" from the position the previous step produced, so
// stepping 4 -> 8 -> 6 -> 12 stays on the last frame of every one of them.
let beat = 4;
const walk = [];
for (const [prev, next] of [[4, 8], [8, 6], [6, 12]]) {
  beat = keptScrubBeat(beat, prev, next);
  walk.push(`${beat}/${next}`);
}
check(walk.join(' -> ') === '8/8 -> 6/6 -> 12/12',
  `stepping the setups 4 -> 8 -> 6 -> 12 stays at the end of each (${walk.join(' -> ')})`);

console.log('\n== everything that is NOT the end is still a position ==');
check(keptScrubBeat(2.5, 4, 8) === 2.5, 'a mid-call scrub into a longer authoring is carried as a position (2.50)');
check(keptScrubBeat(4, 4, 2) === 2, 'an at-the-end scrub into a SHORTER authoring lands on its end (2.00)');
check(keptScrubBeat(4, 4, 4) === 4, 'and into an authoring of the same length it lands on the same beat (4.00)');
check(keptScrubBeat(3, 4, 2) === 2, 'a position PAST a shorter authoring is clamped into range, never left outside it');
check(keptScrubBeat(-2, 8, 8) === 0, 'and a position below zero is clamped up to it');
check(keptScrubBeat(0, 4, 8) === 0, 'a scrub at the START is a position, so it stays at 0 rather than pinning to either end');
check(keptScrubBeat(1, 0, 8) === 1 && keptScrubBeat(0, 0, 8) === 0,
  'a call with no beats has no last frame to pin to, so it falls through to the clamp');

console.log('\n== the end test is HALF A STEP, bounded from both sides ==');
// Both bounds are load-bearing and the second is the one that keeps the tolerance honest: one whole step
// back from the end is a position the arrow keys can reach, so it must NOT be read as the end.
check(keptScrubBeat(4 - SCRUB_STEP, 4, 8) === 4 - SCRUB_STEP,
  `one whole step back from the end (${(4 - SCRUB_STEP).toFixed(2)}) is a position and is carried, not pinned`);
check(keptScrubBeat(4 - SCRUB_STEP / 2, 4, 8) === 8,
  'but half a step back is the end as far as the bar can express it, so it pins');
check(SCRUB_STEP === 0.01, `SCRUB_STEP is the bar's own step (${SCRUB_STEP})`);

console.log('\n== and the bar is driven by that same step, not a second copy of it ==');
const ui = read('src/editor-ui.ts');
check(/this\.scrubEl\.step = String\(SCRUB_STEP\);/.test(ui),
  '`renderScrub` sets the control\'s step from `SCRUB_STEP`, so the bar and the end test cannot drift');

console.log('\n== who passes the keep, and what it is given ==');
const handler = (id) => {
  const m = new RegExp(`this\\.${id}\\.addEventListener\\('change', \\(\\) => \\{([\\s\\S]*?)\\n    \\}\\);`).exec(ui);
  return m ? m[1] : null;
};
const setup = handler('editSetupSel');
const call = handler('editCallSel');
check(setup !== null && /this\.loadInstance\(true\);/.test(setup),
  'the SETUP picker reloads with `keepBeat` - the request');
check(call !== null && /this\.loadInstance\(\);/.test(call) && !/loadInstance\(true\)/.test(call),
  'the CALL picker still reloads with the reset - a beat is a place in ONE dance, so carrying it into another is not a favour');
check(/loadInstance/.test(setup) && /loadInstance/.test(call),
  'both still go through the one loader, so there is no second copy of the rules about what a fresh instance starts with');
check(/this\.editBeat = keepBeat \? keptScrubBeat\(wasAt, wasBeats, this\.instance\.beats\) : 0;/.test(ui),
  'and the loader delegates the placement to the imported rule rather than spelling out a clamp of its own');
// THE TRAP: `this.instance` is REPLACED inside the try below, so reading its beats afterwards would
// compare the new authoring against itself and the end test would never fire.
check(ui.indexOf('const wasBeats = this.instance ? this.instance.beats : 0;') > -1 &&
  ui.indexOf('const wasBeats = this.instance ? this.instance.beats : 0;') < ui.indexOf('this.source = normalizeInstance('),
  'the OUTGOING authoring\'s beats are captured before the load replaces `this.instance`');

console.log('\n== and the readout is driven by editBeat, so the keep is visible ==');
check(/const b = Math\.max\(0, Math\.min\(total, this\.editBeat\)\);/.test(ui),
  '`renderScrub` shows `editBeat`, clamped to the total - which is what makes the kept value survive the reload');
check(/this\.showAt\(call, this\.editBeat \+ call\.leadin\);/.test(ui),
  'and `showInstance` poses the board at that same beat, so the dancers and the readout cannot disagree');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
