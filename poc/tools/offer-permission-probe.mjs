// Probe: THE SEQUENCER REFUSES A CALL THE PERMISSION LAYER REFUSES, not only hides it.
//
// Reported: "sequencer still allows me to apply All 8: Lead Right to Static Square. This should not be
// possible." The declaration already existed as a permission rule (all-8 `Lead Right` from a Static
// Square), and the answer to "is `PERMISSION_RULES` used to check population of the sequencer UI and
// reject if Applied" was: it was used for NEITHER end of that sentence properly. Two separate gaps, and
// this probe pins both:
//
//   1. POPULATION. `Sequencer.legalNext()` consults `mayOffer`, but it is "offerable in SOME reading": a
//      call whose own reading was refused is KEPT when any group on the board could perform it (which is
//      what keeps `Head Boys Dosado` offerable). The panel then offered every bare name it found, asking
//      only `!group`, so an ALL-8 denial reached the picker anyway. The panel now asks the layer's own
//      question - `mayOffer(bare, 'All 8', board)` - for its no-group reading.
//   2. APPLICATION. The permission layer is picker-only by design (`permissions.ts`, and
//      `engine/test/permissions.mjs` section 7 pins that the engine still applies what it refuses), so
//      `applyToBoard` CANNOT be the refusal. Apply in the panel is reachable without the list - a name
//      left selected from another board, a group changed under it, a restored figure - so the panel
//      checks the layer itself before it dances the call, and shows the engine's own reason when refused.
//   3. THE TWO-DANCER AUTHORINGS. `Lead Right - Close` / `- Normal` / `- Far` and `Lead Left - Normal` /
//      `- Far` are published BESIDE the bare calls, and a rule keyed on the bare call matches exactly, so
//      they used to fall through to the default and be offered for the whole square. `5096c63` governs
//      them; the probe asks both directions at the panel's own entry point, `mayOffer`.
//
// THE PROBE WAS RED ON MASTER ON THREE CHECKS, and they are corrected here rather than presented as a fresh
// defect: `a476a4f` moved the deciding rule (two of them named the old shape) and rewrote the corpus the
// tiling check described, and this probe had not been rerun against either. `engine/test/permissions.mjs`
// section 13 owns both of those measurements; this probe pins that the PANEL sees the same answers.
//
// THE RULE IS NOT MIRRORED HERE. Every behavioural check calls the engine's `mayOffer`; the two panel
// decisions are pinned as WIRING, the way `call-filter-probe.mjs` pins its panel's, because they are DOM
// code that cannot be driven from a probe. What that costs is stated rather than hidden: a wiring check
// catches the rule being removed or asked wrongly, and does not catch a rendered list being wrong.
//
// Run: node poc/tools/offer-permission-probe.mjs   (from anywhere; reads engine/dist, so build the engine)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const assets = path.join(POC, '..', 'assets');
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const { callsByTitle } = await import('../../engine/test/lib/engine-calls.mjs');
const seq = new engine.Sequencer(asset('moves.xml'), asset('formations.xml'), callsByTitle(assets));
seq.setActiveLevel('ms');
const square = seq.boardForFormation('Static Square');
const lines = seq.boardForFormation('Normal Lines');

console.log('== the layer answers for the reported reading ==');
const denied = seq.mayOffer('Lead Right', 'All 8', square);
check(denied.allowed === false, 'all-8 `Lead Right` from a Static Square is refused');
// THE DECIDING RULE HAS MOVED TWICE, and this probe follows the ENGINE HARNESS rather than the shape it was
// written against: `a476a4f` replaced the square-set deny with a catch-all deny on the call plus ALLOW rows for
// the readings that survive, and `PermissionRule.call` became an ARRAY when the layer learned to name a whole
// authoring family in one rule (the `Lead Right - *` siblings are one decision - `permissions.mjs` section 17).
// What the check is FOR is unchanged - the refusal is a RULE and not the default - and
// `engine/test/permissions.mjs` sections 13 and 17 are where the corrections and their measurements live.
check(denied.rule?.call?.includes('Lead Right') && denied.rule?.decision === 'deny',
  `and a rule decided it, not the default (${(denied.rule?.call ?? []).join(' / ')}/${denied.rule?.group ?? '*'}/${denied.rule?.board ?? '*'})`);
check(!!denied.reason && denied.reason === denied.rule?.reason,
  `the reason it shows is the deciding rule's own ("${denied.reason}")`);
check(seq.mayOffer('Dosado', 'All 8', square).allowed === false,
  'the older all-8 `Dosado` deny still answers the same way');

console.log('\n== the two-dancer authorings are governed too ==');
// THE SIBLING GAP, asked the way the PANEL asks it. The corpus publishes `Lead Right - Close` / `- Normal` /
// `- Far` and `Lead Left - Normal` / `- Far` beside the bare calls; a rule keyed on the bare call matches
// exactly (the engine harness pins that), so before `5096c63` they matched no rule, fell through to the
// DEFAULT - which section 8 of the engine harness pins as ALLOW - and were offered for the whole square.
// Both directions are checked, because a deny that swallowed the call it protects would pass the first line
// alone. This is the panel-level control for what `engine/test/permissions.mjs` sections 15 and 16 pin.
for (const title of ['Lead Right - Close', 'Lead Right - Normal', 'Lead Right - Far', 'Lead Left - Normal', 'Lead Left - Far']) {
  check(seq.mayOffer(title, 'All 8', square).allowed === false, `${title}: all-8 is refused`);
  check(seq.mayOffer(title, 'Couple #1', square).allowed === true, `${title}: and a numbered couple may dance it`);
}

console.log('\n== the readings that ARE the call are untouched ==');
// The negative control for the rule: a deny that swallowed these would be the rule failing, not working.
for (const g of ['Heads', 'Sides']) {
  check(seq.mayOffer('Lead Right', g, square).allowed === true, `${g} Lead Right is still permitted`);
}
check(seq.mayOffer('Heads Lead Right', 'Heads', square).allowed === true,
  'and the prefixed spelling is permitted for Heads - `mayOffer` keys on the bare call');
check(seq.mayOffer('Lead Right', 'All 8', lines).allowed === true,
  'all-8 Lead Right is still permitted from Normal Lines, where the eight-dancer authoring lives');
check(seq.mayOffer('Star Thru', 'All 8', square).allowed === true,
  'and an unrelated whole-board call is untouched, so this is a rule and not a blanket refusal');

console.log('\n== why the PICKER has to ask, measured ==');
// This is the contract that made gap (1): `legalNext` is deliberately wider than the layer, so a panel
// that offers it verbatim still hands the caller a refused reading.
seq.setBoard(square);
const legal = seq.legalNext();
const groups = ['Heads', 'Sides', 'Boys', 'Girls', 'Centers', 'Ends'];
check(legal.includes('Lead Right'),
  '`legalNext()` still LISTS Lead Right - it is "offerable in SOME reading", not "permitted whole-board"');
check(groups.some((g) => seq.groupCanPerform(square, g, 'Lead Right')),
  'and the group reading is why: at least one group can perform it, so the call is kept');
check(legal.includes('Dosado'), 'the already-denied all-8 Dosado is kept in the same list, for the same reason');

console.log('\n== and the capability is deliberately still there ==');
// The layer is picker-only; the refusal in the panel is the panel's. Pinning this here so that moving the
// refusal into the engine is a DELIBERATE change to this probe and to `permissions.mjs` section 7.
const applied = seq.applyToBoard(square, 'Lead Right');
check(applied.legal === true, '`applyToBoard` still applies all-8 Lead Right - the engine refuses nothing');
// TWO GROUPS OF FOUR AT THIS REVISION, and it was FOUR GROUPS OF TWO when this check was written. The cause
// is the corpus, not the rules (this layer cannot affect `applyToBoard`): `a476a4f` rewrote `lead_right.xml`
// and promoted the 2-dancer `Adjacent Dancers` bodies to their own titles, so the bare name now matches the
// 4-dancer `Facing Couples` authoring. `engine/test/permissions.mjs` section 13 carries the same correction
// and the measurement; a probe that kept asserting the old shape was pinning the pre-rewrite corpus.
check(!!applied.parallel && applied.parallel.groups.length === 2,
  `it tiles the square as two groups of four (${applied.parallel?.groups.map((g) => g.length).join('+')}), which is the defect`);

console.log('\n== the panel asks the layer in both places (wiring) ==');
// A MULTI-LINE MATCH MUST NORMALISE LINE ENDINGS: `git checkout` restores CRLF in this tree, and a
// `\n`-anchored pattern then matches nothing at all - the same trap `AGENTS.md` trap 2 records.
const ui = fs.readFileSync(path.join(POC, 'src', 'sequencer-ui.ts'), 'utf8').replace(/\r\n/g, '\n');
check(/const allowed = group\n\s*\? this\.seq\.groupCanPerform\(on, group, bare\)\n\s*: this\.seq\.mayOffer\(bare, 'All 8', on\)\.allowed;/.test(ui),
  'the no-group OFFER asks `mayOffer(bare, \'All 8\', on)`, not merely `!group`');
check(/const on = this\.parallel \? this\.parallel\.board : this\.seq\.board;/.test(ui),
  'and it asks about the board the offer is about, which is not the live one in parallel mode');
check(/const perm = this\.seq\.mayOffer\(splitSelection\(name\)\.call, splitSelection\(name\)\.selection \?\? group \?\? 'All 8', from\);/.test(ui),
  'APPLY asks the layer for the reading it is about to dance');
// THE READING ASKED ABOUT IS THE NAME'S OWN: a call the catalogue publishes with a designator is applied
// with no group chosen, and asking the WHOLE-BOARD question for it would refuse a legitimate designated
// call - `Heads Lead Left` from a square is the reading that IS the call.
check(/\.selection \?\? group \?\? 'All 8'/.test(ui),
  'and it asks about the selection the name carries before falling back to the whole board');
check(/if \(!perm\.allowed\) \{\n\s*this\.setStatus\('error', `✗ \$\{name\} — \$\{perm\.reason \?\? 'not offered from this board'\}`\);\n\s*return;\n\s*\}\n\s*const step = this\.seq\.apply\(name\);/.test(ui),
  'and returns with the engine\'s own reason BEFORE applying, so the call is never danced');
// A DESIGNATED NAME MUST SURVIVE THE APPLY CHECK, and this is the control for the line above: the ask is
// `Name[selection] ?? group ?? 'All 8'`, so `Heads Lead Left` applies with no group chosen.
check(seq.mayOffer('Lead Left', 'Heads', square).allowed === true,
  'a designated call applies as its own reading, not as the whole-board one');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
