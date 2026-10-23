// COMBINED GROUP SELECTORS, pinned.
//
// The grammar is the reference's (`taminations-flutter` `coded_call.dart` specifier +
// `common/double_selector.dart`): tokens within a side INTERSECT, sides joined by `and` UNION, and a
// negated side is SUBTRACTED.
//
// The numbers below were MEASURED on the engine as it stood, from the single-group resolutions:
// heads=#1,#2,#5,#6  sides=#3,#4,#7,#8  boys=#1,#3,#5,#7  girls=#2,#4,#6,#8  on a home squared set.
//
// Usage: node engine/test/combined-groups.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, splitSelection } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const home = seq.boardForFormation('Static Square');
const ids = (b, sel) => {
  const r = seq.selectionIds(b, sel);
  return r ? r.map((i) => `#${i}`).join(',') : 'null';
};

console.log('== intersections on a home squared set ==');
const CASES = [
  ['Heads', '#1,#2,#5,#6'],
  ['Head Boys', '#1,#5'],
  ['Head Girls', '#2,#6'],
  ['Side Boys', '#3,#7'],
  ['Side Girls', '#4,#8'],
  ['Head Men', '#1,#5'],
  ['Side Women', '#4,#8'],
  ['Head Couples', '#1,#2,#5,#6'],
  // The phrase that used to return ALL FOUR heads, because it was a phrase mapping to `heads`.
  ['Head Ladies', '#2,#6'],
  ['Side Ladies', '#4,#8'],
  // ON A SQUARED SET THE BEAUS *ARE* THE BOYS. The rule is the A-1 definition - "dancers with partner
  // on the right are Beaus" (`taminations-flutter/assets/info/designators.md`) - and in a squared set
  // every boy has his partner on his right. These two cases USED TO PIN `#2,#5` / `#1,#6`, one boy and
  // one girl each, which was the DEGENERATE beau/belle test's answer: it crossed two parallel vectors,
  // so the sign fell through to the board's array order. See `couples.mjs` §7 for the measurement and
  // the reverted control.
  ['Head Beaus', '#1,#5'],
  ['Head Belles', '#2,#6'],
];
for (const [sel, want] of CASES) {
  const got = ids(home, sel);
  check(got === want, `${sel.padEnd(14)} -> ${got}${got === want ? '' : ` (want ${want})`}`);
}

console.log('\n== unions ==');
for (const [sel, want] of [
  ['Head Boys and Side Girls', '#1,#4,#5,#8'],
  ['Head Girls and Side Boys', '#2,#3,#6,#7'],
  ['Head Boys and Head Girls', '#1,#2,#5,#6'],
  ['Head Boys and Head Girls and Side Boys and Side Girls', '#1,#2,#3,#4,#5,#6,#7,#8'],
]) {
  const got = ids(home, sel);
  check(got === want, `${sel} -> ${got}${got === want ? '' : ` (want ${want})`}`);
}

console.log('\n== exclusion ==');
for (const [sel, want] of [
  ['All Except Head Boys', '#2,#3,#4,#6,#7,#8'],
  ['All Except Heads', '#3,#4,#7,#8'],
  ['Heads Except Boys', '#2,#6'],
  ['All Except Head Boys and Side Girls', '#2,#3,#6,#7'],
]) {
  const got = ids(home, sel);
  check(got === want, `${sel} -> ${got}${got === want ? '' : ` (want ${want})`}`);
}

console.log('\n== combinations are BOARD-DEPENDENT, and unresolvable parts refuse ==');
{
  const nl = seq.boardForFormation('Normal Lines');
  check(ids(nl, 'Head Boys') === 'null', 'Head Boys is unresolvable on Normal Lines (no head/side there)');
  check(ids(nl, 'Center Boys') === '#3,#7', `Center Boys resolves on Normal Lines (got ${ids(nl, 'Center Boys')})`);
  check(ids(nl, 'Center Girls') === '#2,#6', `Center Girls resolves on Normal Lines (got ${ids(nl, 'Center Girls')})`);
  const ow = seq.boardForFormation('Ocean Waves');
  check(ids(ow, 'Leader Boys') === '#4,#8', `Leader Boys resolves on Ocean Waves (got ${ids(ow, 'Leader Boys')})`);
  check(ids(ow, 'Trailer Girls') === '#3,#7', `Trailer Girls resolves on Ocean Waves (got ${ids(ow, 'Trailer Girls')})`);
  check(ids(ow, 'Head Boys') === 'null', 'Head Boys is unresolvable on Ocean Waves');
}

console.log('\n== a combination that names EVERYONE is not a selection ==');
{
  // The UI's `subsetGroups` refuses a group resolving to all eight. The combination layer must not
  // smuggle one past that rule: "Outer 6" alone resolves to all eight on a squared set.
  const groups = seq.subsetGroups(home);
  check(!groups.includes('Outer 6'), `subsetGroups omits Outer 6 on a squared set (${groups.join(', ')})`);
}

console.log('\n== splitSelection separates the combination from the call ==');
for (const [raw, wantSel, wantCall] of [
  ['Head Boys Trade', 'Head Boys', 'Trade'],
  ['Head Boys and Side Girls Run', 'Head Boys and Side Girls', 'Run'],
  ['All Except Head Boys Pass Thru', 'All Except Head Boys', 'Pass Thru'],
  ['Centers Pass Thru', 'Centers', 'Pass Thru'],
]) {
  const s = splitSelection(raw);
  check(s.selection === wantSel && s.call === wantCall,
    `"${raw}" -> {selection:"${s.selection}", call:"${s.call}"}`);
}

console.log('\n== a call TITLE that starts with a group word is not eaten by the parser ==');
{
  // `Boys Trade`, `Centers Run` and 110 other ms titles begin with a group word. `splitSelection` DOES
  // split them (it cannot know what is registered), so the gate is NOT the splitter - it is
  // `applyToBoardInner`, which prefers the whole-board reading when the FULL name is a registered call.
  // The point is that a title is still reachable as a WHOLE CALL wherever it is legal at all, so each
  // is checked on a board its own authored setup matches rather than on an arbitrary one.
  const home = seq.boardForFormation('Static Square');
  const r = seq.applyToBoard(home, 'Boys Run');
  check(r.legal === true, `"Boys Run" applies whole-board from a squared set (legal=${r.legal})`);
  // THE PRECEDENCE THAT KEEPS TITLES SAFE. `splitSelection` cannot know what is registered, so it
  // splits "Boys Trade" into `{Boys, Trade}` - and that is harmless because `applyToBoardInner` asks
  // `hasCall` FIRST and takes the whole-board reading whenever the full name is a registered call.
  // That check is the gate, so this pins IT rather than looking for a board `Boys Trade` happens to
  // be legal on (its scoped tams are refused by the Run/Trade rule on most boards, which is a
  // separate matter from which path the name takes).
  // `Head Ladies` is deliberately NOT in this list: it is a SELECTION, not a call title, so nothing
  // depends on it surviving as a whole call - and the phrase mapping that used to make it "work" is
  // exactly what returned all four heads instead of the two girls.
  for (const title of ['Boys Trade', 'Centers Run', 'Boys Run']) {
    check(seq.hasCall(title) === true,
      `"${title}" is a REGISTERED call, so the whole-board reading wins over the combination split`);
  }
  // ...and the COMBINATION form of a call applies too, which is the new capability.
  const combined = seq.applyToBoard(home, 'Head Boys Pass Thru');
  check(combined.legal === true, `"Head Boys Pass Thru" applies as a combination (legal=${combined.legal}${combined.reason ? `: ${combined.reason.slice(0, 50)}` : ''})`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
