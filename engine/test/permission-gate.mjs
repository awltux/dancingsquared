// THE PERMISSION LAYER AS AN APPLY GATE: the picker and the engine give ONE answer.
//
// `permissions.ts` is a picker-only layer by design — a rule decides what the call chooser SUGGESTS, and a caller who
// names the call still gets it. That contract is kept as the default (`permissionMode: 'offer-only'`), and this pins
// BOTH: that the default really is unchanged, and that `'consistent'` makes `applyToBoard` refuse exactly what
// `mayOffer` will not offer, with the rule's own reason as the refusal.
//
// WHY THIS IS A GATE. The two answers drifting apart is invisible from either side alone: the picker simply stops
// listing a call, or the engine quietly applies something the app refuses to suggest, and both look like a corpus
// quirk. The consistency check below compares them on the SAME readings, so a change that gates one path and not the
// other fails here rather than in a user's session.
//
// THE PLACEMENT IS PINNED TOO. The gate lives at the READING boundary (`CallApplicator.applyStepInner`), not in
// `applyToBoardInner`, because a named-group reading is answered by applying the call to a SUBSET internally: a gate
// one level down would re-refuse `All 8` for that internal apply and make every group reading impossible. The shipped
// `Lead Right` rules are exactly that shape (deny `All 8`, allow four `Couple #N`), so check 3 is the one that fails
// if the gate is moved.
//
// Usage: node engine/test/permission-gate.mjs   (engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { Sequencer, makeSquaredSet, setParser } from '../dist/index.js';
import { CORPUS } from '../../vite.corpus.ts';

setParser(DOMParser);
const read = (p) => fs.readFileSync(path.join(CORPUS, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(read('moves.xml'), read('formations.xml'));
for (const t of ['Lead Right - Close', 'Lead Right - Normal', 'Lead Right - Far', 'Lead Left - Normal', 'Lead Left - Far']) {
  seq.registerByTitle(t, read('ms/lead_right.xml'));
}
// ONE ORDINARY CALL, so "the enumeration still lists the rest" is a measurement rather than an artefact of a corpus
// where every registered title is one the rules suppress.
seq.registerByTitle('Allemande Left', read('ms/allemande.xml'));
const board = makeSquaredSet();
const TITLE = 'Lead Right - Close';
const DENY_REASON = 'START A WHITE LIST FOR LEAD RIGHT';

/** One reading, as a string the app would send. */
const reading = (group, call) => (group === null ? call : `${group} ${call}`);

console.log('== 1. the DEFAULT is the picker-only contract, unchanged ==');
{
  check(seq.mayOffer(TITLE).allowed === false, 'the picker does not offer the whole-board reading');
  const applied = seq.applyToBoard(board, TITLE);
  check(applied.legal, 'and the engine still APPLIES it — `offer-only` is the default, so nothing moved');
  check(seq.mayOffer(TITLE, 'Couple #1').allowed === true, 'while the picker does offer it for one couple');
}

console.log('\n== 2. `consistent` refuses the same reading, with the rule\'s own reason ==');
seq.setPermissionMode('consistent');
{
  const applied = seq.applyToBoard(board, TITLE);
  check(applied.legal === false, 'the whole-board apply is now refused');
  check(applied.reason === DENY_REASON, `and the reason IS the deny rule's prose ("${applied.reason}")`);
  // THE SEARCH ROUTE is `applySearch` (the same `applyStepInner` with rebase off), which the facade does not publish:
  // this reaches the collaborator the way `scircle-instance.mjs` reaches `seq.library`. The point of the check is that
  // the gate is not conditional on WHICH of the two applies is running.
  const searched = seq.legality.searchLegalCalls(board).map((x) => x.name);
  check(!searched.includes(TITLE), 'and the SEARCH enumerator does not list it either — one gate, every path');
}

console.log('\n== 3. a reading the rules ALLOW is still applied (this is what pins the gate\'s placement) ==');
{
  const groupReading = reading('Couple #1', TITLE);
  const applied = seq.applyToBoard(board, groupReading);
  check(seq.mayOffer(TITLE, 'Couple #1').allowed === true, 'the rules allow "Couple #1"');
  check(applied.legal, `so the apply is legal ("${groupReading}") — a gate in applyToBoardInner would refuse it, because the group apply is answered by an internal All-8 apply`);
  check(applied.board.dancers.some((d) => d.x !== 0 || d.y !== 0), 'and it really moved somebody');
}

console.log('\n== 4. CONSISTENCY: offer and apply give one answer, over a sweep of readings ==');
{
  const calls = ['Lead Right - Close', 'Lead Right - Normal', 'Lead Right - Far', 'Lead Left - Normal', 'Lead Left - Far'];
  const groups = [null, 'Couple #1', 'Couple #2', 'Heads', 'Sides'];
  const disagree = [];
  let compared = 0;
  for (const call of calls) {
    for (const group of groups) {
      const offered = seq.mayOffer(call, group).allowed;
      const applied = seq.applyToBoard(board, reading(group, call)).legal;
      compared++;
      if (offered !== applied) disagree.push(`${reading(group, call)} offered=${offered} applied=${applied}`);
    }
  }
  console.log(`       ${compared} readings compared (${calls.length} calls x ${groups.length} groups)`);
  check(compared === 25, 'the sweep is the full matrix');
  check(disagree.length === 0, `offer and apply agree on every one${disagree.length ? `: ${disagree.slice(0, 3).join(' | ')}` : ''}`);
  // NEGATIVE CONTROL: in 'offer-only' the same sweep MUST disagree, or this check is measuring nothing.
  seq.setPermissionMode('offer-only');
  const disagreeOff = calls.filter((call) => seq.mayOffer(call).allowed !== seq.applyToBoard(board, call).legal);
  check(disagreeOff.length > 0, `NEGATIVE CONTROL: under 'offer-only' the two disagree on ${disagreeOff.length} call(s), so the sweep above can fail`);
  seq.setPermissionMode('consistent');
  // THE ONE DELIBERATE ASYMMETRY, stated so nobody "fixes" it: the sweep is the (`call`, `group`) vocabulary the picker
  // offers, and that is where the two MUST agree. A bare PUBLISHED title at the apply (`Heads Pass Thru`) is a
  // whole-board call and is asked about as itself, while `mayOffer` keeps the picker's historical split — section 8
  // pins that spelling, and `mayOffer` is otherwise untouched (its digest over seven boards is identical with and
  // without this change).
}

console.log('\n== 5. the ENUMERATORS agree too (they inherit the gate, and a duplicated check would drift) ==');
{
  const legal = seq.legalCalls(board);
  check(!legal.includes(TITLE), 'legalCalls does not list the refused title');
  check(legal.length > 0, `and still lists the rest (${legal.length} calls from a squared set)`);
  seq.setPermissionMode('offer-only');
  check(seq.legalCalls(board).includes(TITLE), 'while `offer-only` lists it, so the enumeration is what moved');
  seq.setPermissionMode('consistent');
}

console.log('\n== 6. a rule keyed on the GROUP is honoured in both directions ==');
{
  seq.setPermissionRules([{ call: TITLE, group: ['Couple #1'], level: 'ms', decision: 'deny', reason: 'no couple one here' }]);
  const one = seq.applyToBoard(board, reading('Couple #1', TITLE));
  const two = seq.applyToBoard(board, reading('Couple #2', TITLE));
  check(one.legal === false && one.reason === 'no couple one here', `the refused group names its own rule ("${one.reason}")`);
  check(two.legal, 'and the group the rule does not name still applies');
  seq.setPermissionRules([]);
}

console.log('\n== 7. a module holding a refused call refuses, with that call\'s reason ==');
{
  seq.registerModule('Going Module', [{ call: TITLE }]);
  const applied = seq.applyToBoard(board, 'Going Module');
  // The module and the step are named first, then the RULE's sentence — the point is that a rule-driven refusal is
  // never flattened into the geometric "not legal here" that would make it look like a matching problem.
  check(
    applied.legal === false && applied.reason.includes(DENY_REASON),
    `the rule's reason survives the module wrapper ("${applied.reason}")`,
  );
}

console.log('\n== 8. a SCOPED CATALOGUE TITLE is asked about as ITSELF, not split into a group ==');
{
  // `Heads Pass Thru` is a `<tam title=...>` (ms/pass_thru.xml), so the applicator applies it as a whole-board call.
  // A gate that split it into "Pass Thru" for the heads would consult a rule nobody wrote for the name in use — and
  // the check works without the call being legal here, because the gate runs BEFORE any matching.
  seq.registerByTitle('Heads Pass Thru', read('ms/pass_thru.xml'));
  seq.setPermissionRules([{ call: 'Pass Thru', level: 'ms', decision: 'deny', reason: 'plain Pass Thru is denied' }]);
  const asTitle = seq.applyToBoard(board, 'Heads Pass Thru');
  check(!(asTitle.reason ?? '').includes('plain Pass Thru is denied'), 'a rule about "Pass Thru" does not catch the TITLE "Heads Pass Thru"');
  seq.setPermissionRules([{ call: 'Heads Pass Thru', level: 'ms', decision: 'deny', reason: 'the title itself is denied' }]);
  const byTitle = seq.applyToBoard(board, 'Heads Pass Thru');
  check(byTitle.legal === false && (byTitle.reason ?? '').includes('the title itself is denied'), 'while a rule about the title does');
  seq.setPermissionRules([]);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
