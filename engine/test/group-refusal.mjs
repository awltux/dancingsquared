// A REFUSAL THAT NAMES THE GROUP WHICH WOULD WORK.
//
// A call refused for the WHOLE-BOARD reading is not a call that cannot be performed here, and the difference is
// invisible to a caller reading `mayOffer` alone. MEASURED, the picker's own filter once dropped `Dosado` because
// all-8 `Dosado` from a square is refused at MS, which emptied `Head Boys Dosado` out of the list — the symptom
// `group-calls.mjs` pins. `permissionReason` now names the group that would work, and this harness pins that the
// NAME IS TRUE (checked with `groupCanPerform`, the same predicate the picker uses) rather than merely present.
//
// THE CONTROLS ARE THE OTHER HALF OF EVERY CHECK, because a sentence appended to every refusal would pass a
// "the reason mentions a group" test: a call that IS offered must get NO reason at all, a call that NO group can
// perform must keep the plain reason, and a call that already names its dancers must get no hint.
//
// Run: node test/group-refusal.mjs   (engine must be built)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '..', '..', 'assets');
const seq = new Sequencer(
  (await import('node:fs')).readFileSync(path.join(ASSETS, 'moves.xml'), 'utf8'),
  (await import('node:fs')).readFileSync(path.join(ASSETS, 'formations.xml'), 'utf8'),
  callsByTitle(ASSETS),
);
if (!seq.setFormation('Static Square')) throw new Error('the corpus no longer declares Static Square');
const board = seq.boardForFormation('Static Square');

console.log('\n== 1. the whole-board refusal names a group that really can perform it ==');
{
  // THE WITNESS IS THE ENGINE'S OWN: all-8 `Dosado` from a squared set is not offered at MS, and `Head Boys
  // Dosado` is. `permissions.mjs` pins the first half; this pins that the new sentence agrees with the second.
  const all8 = seq.mayOffer('Dosado', 'All 8');
  check(all8.allowed === false, `all-8 Dosado is refused (${all8.allowed})`);
  const group = seq.groupForCall(board, 'Dosado');
  check(group !== null, `a group is named for it (${group})`);
  check(group !== null && seq.groupCanPerform(board, group, 'Dosado'), `and the engine's own predicate agrees ${group} can perform Dosado`);
  check(group !== null && seq.mayOffer('Dosado', group).allowed, `and the picker may offer it for ${group}`);
  const reason = seq.permissionReason('Dosado', 'All 8');
  check(reason !== null && reason.includes(group ?? '\u0000'), `the status line names it (${JSON.stringify(reason)})`);
}

console.log('\n== 2. CONTROL: a call that IS offered gets no reason at all ==');
{
  const offered = seq.legalNext().find((c) => seq.mayOffer(c, 'All 8').allowed && seq.groupForCall(board, c) === null);
  check(offered !== undefined, `some call is offered whole-board and needs no group (${offered})`);
  if (offered !== undefined) {
    check(seq.permissionReason(offered, 'All 8') === null, `and its reason is null rather than a hint (${JSON.stringify(seq.permissionReason(offered, 'All 8'))})`);
    check(seq.groupForCall(board, offered) === null, `because no group had to be named for it`);
  }
}

console.log('\n== 3. CONTROL: a refusal no group can fix keeps the plain reason ==');
{
  // THERE IS NO REAL WITNESS FROM A SQUARED SET, and that is a fact worth reporting rather than hiding: MEASURED,
  // every registered call that is refused whole-board there has SOME group that can perform it, so the hint fires
  // for essentially every whole-board refusal from home. The control therefore uses the engine's own rule seam:
  // a rule that forbids the call for EVERY reading, which `groupCanPerform` refuses too (permission first), so
  // there is no group for the sentence to name.
  const groups = seq.subsetGroups(board);
  const real = callsByTitle(ASSETS)
    .map((c) => c.name)
    .find((c) => !seq.mayOffer(c, 'All 8').allowed && !groups.some((g) => seq.groupCanPerform(board, g, c)));
  console.log(`       (a real unperformable call from a squared set: ${real ?? 'none — every refused call has a group'})`);

  seq.setPermissionRules([{ call: ['Dosado'], level: 'ms', reason: 'a test rule forbids Dosado outright' }]);
  try {
    check(seq.mayOffer('Dosado', 'All 8').allowed === false, 'the rule refuses it for the whole board');
    check(seq.groupForCall(board, 'Dosado') === null, 'and groupForCall names no group, because the rule binds every reading');
    const reason = seq.permissionReason('Dosado', 'All 8');
    check(reason === 'a test rule forbids Dosado outright', `so its reason is the rule's own, with no hint appended (${JSON.stringify(reason)})`);
  } finally {
    seq.setPermissionRules([]);
  }
}

console.log('\n== 4. CONTROL: a call that names its own dancers gets no group hint ==');
{
  // "Head Boys Dosado" is already the group's reading, so there is no wider group to recommend. The second
  // check is what makes the first mean something: the SAME call under a group it cannot use is not the point —
  // what is pinned is that the composed name is refused a hint even though a group reading of it exists.
  check(seq.groupForCall(board, 'Head Boys Dosado') === null, 'groupForCall refuses to hint a composed name');
  check(seq.groupCanPerform(board, 'Heads', 'Dosado') === true, 'CONTROL: yet the plain call IS performable by Heads, so the null above is the composed-name rule and not a dead path');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
