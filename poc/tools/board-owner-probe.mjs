// Probe: THE BOARD BELONGS TO THE PANEL THAT IS ON SCREEN.
//
// Found in a real browser, not by reading code: on first load the Browse tab (the default mode) showed the
// Call editor's call on the board and in its legend while its own dropdown named a different one. A stack
// captured on the legend's `innerHTML` setter named the writers - the editor's constructor previewed through
// `loadEditSetup` and again through its own `applyMode`, and the LAST one won.
//
// The first attempt guarded `loadInstance`, which fixed nothing: there were EIGHT preview sites. The rule this
// probe pins is therefore about the STRUCTURE that makes the guard hold - one writer, and no way around it -
// rather than about the one path that happened to be blamed first.
//
// Run: node poc/tools/board-owner-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
const read = (p) => fs.readFileSync(path.join(POC, p), 'utf8');

const editor = read('src/editor-ui.ts');
const main = read('src/main.ts');
const browser = read('src/browser.ts');
const count = (s, re) => (s.match(re) ?? []).length;

console.log('== one writer ==');
check(count(editor, /this\.host\.preview\(/g) === 1, '`host.preview` is called from exactly one place in the editor');
check(count(editor, /this\.host\.previewAt\(/g) === 1, 'and so is `host.previewAt`');
check(/private show\(call: CallBundle\): void \{\s*\n\s*if \(this\.active\) this\.host\.preview\(call\);/.test(editor),
  'that place is `show`, and it asks whether this panel is the one on screen');
check(/private showAt\(call: CallBundle, beat: number\): void \{\s*\n\s*if \(this\.active\) this\.host\.previewAt\(call, beat\);/.test(editor),
  'with `showAt` carrying the same rule for a preview that also places the playhead');
check(count(editor, /this\.show\(/g) >= 5 && count(editor, /this\.showAt\(/g) === 1,
  'and every preview in the file goes through them');
// THE POINT OF THE WHOLE THING: nothing can bypass the guard by calling the host directly.
check(count(editor, /host\.preview(At)?\(/g) === 2, 'no other site reaches the host, so no path can skip the guard');

console.log('\n== and the guard is the only thing that decides ==');
check(!/if \(this\.active\) this\.showInstance/.test(editor),
  'the ad-hoc guard on `loadInstance` is GONE - one rule in one place, not two that can disagree');
check(/private showInstance\(call: CallBundle\) \{\s*\n\s*this\.showAt\(call, this\.editBeat\);/.test(editor),
  '`showInstance` goes through `showAt`, so it inherits the rule rather than restating it');
check(/if \(a\) \{[\s\S]{0,400}if \(this\.instance\) this\.showInstance\(this\.instance\);/.test(editor),
  'and ENTERING the editor paints its instance, which is the half that makes the guard safe: the call the constructor refused to show while inactive is shown the moment the panel is');

console.log('\n== the browse view takes its board back ==');
check(/reload\(\) \{\s*\n\s*this\.loadCurrent\(\);/.test(browser), 'the browse view has one way to re-show the call its own selectors name');
check(/if \(lastMode === 'editor' && mode !== 'editor'\) \{[\s\S]{0,320}if \(mode === 'browse'\) browser\.reload\(\);/.test(main),
  'and leaving the editor for the Browse tab uses it, so the dropdown and the board cannot stay split');
check(/editorUi\.setActive\(ed && !fsm\);/.test(main), 'the editor is told whether it is on screen at all, which is what `active` is');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
