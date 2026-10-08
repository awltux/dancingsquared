// "SUBSETS PRESENT" ENTRIES ARE LINKS THAT RING THE DANCERS THEY MEAN.
//
// REPORTED: "sequencer: 'Subsets present' entries should be links that use the dancer highlight circles from
// Call Editor to make it clear who the current subsets are. Pressing a second time disables the highlighted
// dancers."
//
// WHAT THE WIRING HAS TO BE, and each part of it is a check below:
//
//   - the line renders a LINK per group rather than one joined string, and a lit one is marked (`subsetLink`);
//   - a press TOGGLES that group (a second press takes it out), which is `litSubsets` as a SET - the line
//     lists several groups and the question is "who are these dancers", so two entries can be lit at once;
//   - the ring is the CALL EDITOR'S (`DancerView.setSelected`, asked for by name in the report) and it is set
//     on the SEQUENCER'S OWN views: `CallBrowser.setSelection` marks the browse view's dancers, and in this
//     mode those are not the ones on screen;
//   - the dancers come from the ENGINE (`Sequencer.selectionIds`), not from a name parsed in the panel - a
//     second reading of "Heads" in the app is the drift this repository keeps paying for;
//   - a board change REBUILDS the views, so the marks are re-applied there or the rings vanish with the old
//     views, and a group the new board no longer resolves loses its light.
//
// WHY THIS PROBE READS SOURCE. The interaction lives in `sequencer-ui.ts`, which builds DOM and cannot run
// under plain node - the same limit `editor-level-probe.mjs` and `formation-ref-probe.mjs` record. So the
// wiring is read from the source, and the ENGINE half it depends on is checked against the engine itself.
//
// Run: node tools/subset-highlight-probe.mjs   (from poc/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures++; }
};
/** The app's TypeScript is checked in with CRLF, so a multi-line literal match has to normalise first. */
const readSource = (rel) => fs.readFileSync(path.join(POC, rel), 'utf8').replace(/\r\n/g, '\n');

const ui = readSource('src/sequencer-ui.ts');
const css = readSource('src/style.css');

// ------------------------------------------------------------------ 1. the line renders links
console.log('== 1. the composer line renders a LINK per group, and marks the lit ones ==');

check(/groups\.map\(\(g\) => this\.subsetLink\(g\)\)\.join\(/.test(ui),
  'the subset line builds one element per group rather than joining the names into one string');
check(!/Subsets present: <b>\$\{groups\.join/.test(ui), 'and the old joined-string form is gone');
check(/private subsetLink\(name: string\): string \{/.test(ui), 'the link is built in one place');
check(/class="subset-link\$\{on \? ' on' : ''\}"/.test(ui),
  'a lit group is marked in the markup, so the caller can see which links are on');
check(/data-subset="\$\{esc\(name\)\}"/.test(ui),
  'and each link carries the group name as data rather than as a position in a list');
check(/esc\(name\)/.test(ui), 'the name is escaped, because it goes into innerHTML');

// ------------------------------------------------------------------ 2. a press toggles, and a second press clears
console.log('\n== 2. pressing toggles, so a second press disables those dancers ==');

check(/private litSubsets = new Set<string>\(\);/.test(ui),
  'the lit groups are kept as a SET - the report asks about "the current subsets", plural');
check(/this\.litSubsets\.has\(name\)\) this\.litSubsets\.delete\(name\);/.test(ui),
  'a press on a lit group REMOVES it - the second press the report asks for');
check(/else this\.litSubsets\.add\(name\);/.test(ui), 'and a press on an unlit one adds it');
check(/closest<HTMLButtonElement>\('button\[data-subset\]'\)/.test(ui),
  'the press is resolved from the clicked element, so the re-rendered line needs no per-link listeners');
check(/this\.subsetInfoEl\.addEventListener\('click'/.test(ui),
  'the listener is DELEGATED on the line itself, which is re-rendered on every board change');

// ------------------------------------------------------------------ 3. the ring, and whose dancers it marks
console.log('\n== 3. the ring is the call editor\'s, drawn on the sequencer\'s own views ==');

check(/private applySubsetMarks\(\)/.test(ui), 'one method applies the marks');
check(/board\.dancers\.forEach\(\(d, i\) => this\.views\[i\]\?\.setSelected\(this\.active && this\.litIds\.has\(d\.id\)\)\);/.test(ui),
  'every dancer is marked through `DancerView.setSelected` - the ring the Call Editor draws');
// THE RING IS A SCENE CHILD, so it is added and removed BY HAND and the panel has to do both. This is the
// fault that shipped: the mark was set (`visible = true`) on an object that was never in the scene, so the
// links lit up and nothing appeared on the floor.
check(/this\.stage\.scene\.remove\(v\.selectionRing\);/.test(ui), 'a rebuild REMOVES the ring with the views it belonged to');
check(/this\.stage\.scene\.add\(v\.selectionRing\);/.test(ui), 'and ADDS the new one, without which `setSelected` marks nothing');
// AND IT IS NOT GATED ON THE 3D/2D SWITCH: the sequencer OPENS in 2D, so a ring tied to the 3D view would be
// invisible exactly when the report was filed.
check(/v\.selectionRing\.visible = this\.active && ringId !== undefined && this\.litIds\.has\(ringId\);/.test(ui),
  'the ring is gated on `active` alone, not on `use2d`, so it shows in the 2D view the panel opens in');
check(!/v\.selectionRing\.visible = this\.active && !this\.use2d/.test(ui),
  'and is NOT tied to the avatar/track gate, which is what would hide it in 2D');
check(/private applyViewVisibility\(poses\?: Pose\[\]\)/.test(ui) && /this\.applyViewVisibility\(\);/.test(ui),
  'the per-view visibility has ONE implementation, called by the tab switch as well as by `applyView`');
{
  // ONE COPY, counted rather than assumed - the unified method must contain the loop, so "there is no such
  // loop" is not the assertion; "there is exactly one" is, and a second copy sent this gate red once already.
  const loops = ui.match(/for \(let i = 0; i < this\.views\.length; i\+\+\) \{\n      const v = this\.views\[i\];\n      v\.group\.visible/g) ?? [];
  check(loops.length === 1,
    `the per-view visibility loop exists ONCE, in the method that owns it (found ${loops.length})`);
}
check(!/\browser\.setSelection\(/.test(ui),
  'and NOT through the browse view, whose dancers are not the ones on screen in this mode');
check(/this\.seq\.selectionIds\(board, name\)/.test(ui),
  'the ids come from the engine\'s own selection resolver rather than from a name parsed here');
check(/this\.applySubsetMarks\(\);\n    this\.viewKey = SequencerController\.viewKeyOf\(board\);/.test(ui),
  'a view REBUILD re-applies the marks, or the rings would vanish with the views they were set on');
check(/if \(!groups\.includes\(n\)\) this\.litSubsets\.delete\(n\);/.test(ui),
  'and a group the new board no longer resolves loses its light rather than keeping a stale claim');

// ------------------------------------------------------------------ 4. the engine half, measured
console.log('\n== 4. the engine resolves a selection to dancer IDS, which is what the ring needs ==');

check(typeof engine.Sequencer === 'function', 'the engine exposes the Sequencer the panel calls');
const seqProto = engine.Sequencer.prototype;
check(typeof seqProto.selectionIds === 'function',
  'and `selectionIds` is on it, so the panel is not inventing a second reading of a group name');
// THE ENGINE SOURCES ARE CRLF IN THE WORKING TREE, so this read is normalised too: a multi-line literal
// match against `\n` silently finds nothing otherwise, which is the trap the repo has hit more than once.
const src = readSource('../engine/src/sequencer/sequencer.ts');
check(/selectionIds\(board: Board, selection: string\): number\[\] \| null \{[\s\S]{0,120}?resolveSelection\(board, selection\);/.test(src),
  'and it delegates to the grouping resolver rather than to a copy of the vocabulary');

// ------------------------------------------------------------------ 5. the styles, so it reads as a link
console.log('\n== 5. the styles make it a link, and the lit state is visible ==');
check(/#seqSubsetInfo \.subset-link \{/.test(css), 'the link has a style of its own');
check(/#seqSubsetInfo \.subset-link\.on \{/.test(css), 'and so does the lit state');
check(/text-decoration: underline dotted;/.test(css), 'it reads as a link rather than as a button');

// ------------------------------------------------------------------ 6. the checks fail on the faults they were written for
console.log('\n== 6. the checks fail on the bugs they were written for ==');
{
  const rejoined = ui.replace('this.subsetLink(g)', 'g');
  check(rejoined !== ui && !/groups\.map\(\(g\) => this\.subsetLink\(g\)\)/.test(rejoined),
    'joining the names back into one string fails the link check');
  const noToggle = ui.replace("if (this.litSubsets.has(name)) this.litSubsets.delete(name);", 'this.litSubsets.add(name);');
  check(noToggle !== ui && !/this\.litSubsets\.has\(name\)\) this\.litSubsets\.delete\(name\);/.test(noToggle),
    'dropping the second-press branch fails the toggle check');
  const browsed = ui.replace('this.views[i]?.setSelected(this.active && this.litIds.has(d.id))', 'browser.setSelection([...lit], [])');
  check(browsed !== ui && /browser\.setSelection/.test(browsed),
    'marking the browse view instead fails the check that keeps the ring on the dancers on screen');
  // THE FAULT THAT SHIPPED, injected: the mark is set but the object is never put in the scene.
  const orphaned = ui.replace('      this.stage.scene.add(v.selectionRing);\n', '');
  check(orphaned !== ui && !/this\.stage\.scene\.add\(v\.selectionRing\);/.test(orphaned),
    'leaving the ring out of the scene fails the check that it is added - the reported "no rings" fault');
  const noRebuild = ui.replace('    this.applySubsetMarks();\n    this.viewKey', '    this.viewKey');
  check(noRebuild !== ui && !/this\.applySubsetMarks\(\);\n    this\.viewKey/.test(noRebuild),
    'dropping the rebuild re-application fails the check that keeps the rings alive');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
