// Probe: CHANGING THE SETUP KEEPS THE SCRUB, CHANGING THE CALL DOES NOT.
//
// Asked for as: "When in the call editor, changing setup shouldn't reset the scrub time. Sometimes I want to
// compare the end formation while stepping through the setups."
//
// One call has several AUTHORINGS (`<tam>`), and comparing their end formations means holding the scrub at
// the same place in each. A reset to 0 on every change destroys the thing being compared just as it is
// reached - so this is about WHICH of the two call/setup pickers owns the reset, not about removing it.
//
// There is nothing here to measure numerically: the rule lives in DOM code no engine harness can run.
// What CAN be checked is the wiring, and the three ways it could go wrong silently:
//
//   1. THE SETUP PICKER PASSES `keepBeat`. If it does not, the reset is back and the request is unmet.
//   2. THE CALL PICKER DOES NOT. A beat is a place in ONE dance: carrying it into a different call of a
//      different length would put the caller at a position nobody chose. This is the NEGATIVE CONTROL -
//      a rule that keeps the beat on BOTH pickers passes check 1 and is still wrong.
//   3. THE KEPT BEAT IS CLAMPED to the new authoring's length. Two authorings of one call can differ in
//      beats, and an unclamped beat leaves the readout, the bar and the playhead describing three
//      different places - which is worse than the reset this replaces.
//
// VERIFIED IN A BROWSER as well (Chromium against a fresh `poc/dist`): with `Forward and Back` open on
// `Facing Couples Compact`, the scrub was moved to `beat 0.40 / 4.00`; switching the setup to
// `Normal Lines` and back to `Facing Couples Compact` left it at `beat 0.40 / 4.00`, and switching the
// CALL to `Heads Forward and Back` and then back to `Forward and Back` reset it to `beat 0.00 / 4.00`.
//
// Run: node poc/tools/editor-setup-scrub-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(POC, p), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const ui = read('src/editor-ui.ts');

console.log('== the signature and the keep ==');
check(/private loadInstance\(keepBeat = false\)/.test(ui),
  '`loadInstance` takes a `keepBeat` flag, so the reset is the CALLER\'s decision rather than a side effect of loading');
check(/const wasAt = this\.editBeat;/.test(ui),
  'the beat is captured before the try, so a failed load cannot leave it half-restored');
check(/this\.editBeat = keepBeat \? Math\.max\(0, Math\.min\(this\.instance\.beats, wasAt\)\) : 0;/.test(ui),
  'and it is CLAMPED to the new authoring\'s own length when kept, and zeroed when not');
check(!/this\.editBeat = 0;/.test(ui),
  'there is no unguarded `this.editBeat = 0` left, so no path can reset it without saying so');

console.log('\n== who passes it ==');
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

console.log('\n== and the readout is driven by editBeat, so the keep is visible ==');
check(/const b = Math\.max\(0, Math\.min\(total, this\.editBeat\)\);/.test(ui),
  '`renderScrub` shows `editBeat`, clamped to the total - which is what makes the kept value survive the reload');
check(/this\.showAt\(call, this\.editBeat \+ call\.leadin\);/.test(ui),
  'and `showInstance` poses the board at that same beat, so the dancers and the readout cannot disagree');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
