// THE LEDGER MERGE IS APPEND-ONLY, AND AN ALIAS IS A DECISION NOT A GUESS.
//
// WHY THIS IS SEPARATE FROM `test/tools/formation-roots.mjs`. That tool's verdict costs a corpus walk (~4 min)
// because its INPUT does; the rules it applies to that input are pure, and a rule that can only be measured at
// corpus scale is a rule nobody runs while editing. `renderLedger` is the pure half: it decides what a fresh
// render does with a committed ledger and a hand-written alias, and that decision is what this harness pins.
//
// THE CHECKS, each with the wrong rule it rules out:
//   - a new shape is appended rooted at ITSELF (the wrong rule: root it at whichever line was written last);
//   - an existing line is never dropped when a shape vanishes (the wrong rule: render fresh from the corpus,
//     which is what makes a corrected formation silently re-key every variant that hung off it);
//   - an alias resolves the NEW id to the OLD root (the wrong rule: alias to the new id, which is a no-op);
//   - a chain resolves through to the end (the wrong rule: one hop, which leaves a half-migrated ledger);
//   - an already-rooted id is left exactly as it was (the wrong rule: re-root it now that its alias changed).
//
// Run: node test/formation-roots-merge.mjs   (from engine/; the engine must be built)
import { renderLedger } from './tools/formation-roots.mjs';

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};

const shapes = (...ids) => new Map(ids.map((id) => [id, `example ${id}`]));

console.log('== 1. a new shape is appended, rooted at itself ==');
const first = renderLedger(null, {}, shapes('F3-aaaaaaaa'));
check(first.roots['F3-aaaaaaaa'] === 'F3-aaaaaaaa', 'the first render roots a shape at its own id');
check(first.version === 1, 'the ledger carries its version');

console.log('== 2. an existing line is never dropped ==');
const committed = { version: 1, roots: { 'F3-aaaaaaaa': 'F3-aaaaaaaa', 'F3-00000000': 'F3-00000000' } };
const vanished = renderLedger(committed, {}, shapes('F3-aaaaaaaa'));
check(vanished.roots['F3-00000000'] === 'F3-00000000', 'a shape that no longer appears keeps its line');
check(Object.keys(vanished.roots).length === 2, 'and the render is still a superset of the committed ledger');

console.log('== 3. an alias resolves the NEW id to the OLD root ==');
const corrected = renderLedger(committed, { 'F3-newnwnew': 'F3-00000000' }, shapes('F3-aaaaaaaa', 'F3-newnwnew'));
check(corrected.roots['F3-newnwnew'] === 'F3-00000000', 'the alias makes the new id share the old root');
check(corrected.roots['F3-newnwnew'] !== 'F3-newnwnew', 'CONTROL: without the alias the new id would be its own root, and every variant keyed on it would re-key');
check(renderLedger(committed, {}, shapes('F3-aaaaaaaa', 'F3-newnwnew')).roots['F3-newnwnew'] === 'F3-newnwnew', 'the same render without the alias is the wrong answer this rules out');

console.log('== 4. a chain resolves through to the end ==');
const chained = renderLedger({ version: 1, roots: { 'F3-00000000': 'F3-00000000' } }, { 'F3-midmidmid': 'F3-00000000', 'F3-newnwnew': 'F3-midmidmid' }, shapes('F3-midmidmid', 'F3-newnwnew'));
check(chained.roots['F3-newnwnew'] === 'F3-00000000', 'the newest id lands on the original root, not on the middle hop', JSON.stringify(chained.roots));

console.log('== 5. an already-rooted id is left alone ==');
const steady = renderLedger({ version: 1, roots: { 'F3-newnwnew': 'F3-00000000', 'F3-00000000': 'F3-00000000' } }, { 'F3-newnwnew': 'F3-11111111' }, shapes('F3-newnwnew'));
check(steady.roots['F3-newnwnew'] === 'F3-00000000', 'a committed line is not re-rooted because an alias was edited afterwards');

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
