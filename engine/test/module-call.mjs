// A MODULE COMPOSED INTO ONE CALL — the composition, its refusals, and the two numbers that make it a claim.
//
// Asked for: "is there also a way to make modules look like virtual calls, so they can be inserted and offered in the
// same way call variants are."
//
// WHAT IS MEASURED. `Sequencer.moduleCall(board, name)` returns ONE `CallBundle` for a module's whole step list, or a
// named refusal. The claim that needs pinning is not that it returns something — it is that the composed bundle lands on
// the board the REPLAY lands on (`evaluateSequence`), because a module is a chain of per-step placements and a wrong
// chain still produces a plausible-looking animation. Check 2 is that claim, and check 6 is its negative control.
//
// THE OTHER CLAIM IS THE CLOCK. Replacing a module's N steps with one composed call must not change what the sequence
// costs, so `bundle.beats` is asserted against `sequenceBeats` over the same flattened steps (check 3). A composition
// that animated correctly and charged differently would move every later call's beat.
//
// THE REFUSALS ARE PART OF THE FEATURE, not an error path: a "while" figure and a coded move have no single authored
// track, and a module that cannot compose is still playable call by call through `flatten`. Each refusal is checked by
// name, because a refusal that does not say which step is a refusal the caller cannot act on.
//
// Usage: node engine/test/module-call.mjs   (after `npm run build --prefix engine`)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, normAngle, setParser, poseFor } from '../dist/index.js';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(corpusRoot(), p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(read('moves.xml'), read('formations.xml'));
for (const [title, file] of [
  ['Pass Thru', 'ms/pass_thru.xml'],
  ['Right and Left Thru', 'ms/right_and_left_thru.xml'],
  ['Star Thru', 'ms/star_thru.xml'],
  ['Swing Thru', 'ms/swing_thru.xml'],
]) {
  seq.register(title, read(file));
}
const HOME = seq.startBoard();

/** The worst dancer's offset between a composed bundle's own end and the board the REPLAY ends on. */
function convergence(bundle, steps, board) {
  const walked = seq.evaluateSequence(seq.flatten(steps), bundle.beats, board).board;
  let worst = 0;
  for (const [i, d] of bundle.dancers.entries()) {
    const p = poseFor(d, bundle.beats);
    const w = walked.dancers[i];
    worst = Math.max(worst, Math.hypot(p.x - w.x, p.y - w.y), Math.abs(normAngle(p.heading - w.heading)));
  }
  return worst;
}

console.log('== 1. a module from home composes into ONE call ==');
// TWO CALLS THE PICKER OFFERS FROM HOME IN THIS ORDER, so the fixture is a real chain rather than one chosen by hand and
// hoping: `Star Thru` leaves facing couples and `Right and Left Thru` takes them to an `Eight Chain Thru`.
const STEPS = ['Star Thru', 'Right and Left Thru'];
seq.registerModule('Probe One Call', STEPS);
const one = seq.moduleCall(HOME, 'Probe One Call');
check(one.legal, `it composes (${one.legal ? 'legal' : one.reason})`);
if (!one.legal) {
  console.log('\ncomposition refused; nothing below can run');
  process.exit(1);
}
const { bundle } = one;
check(bundle.dancers.length === 8, 'the bundle is an eight-dancer authoring, so it can be drawn and applied as one call');
check(bundle.title === 'Probe One Call' && bundle.from === 'Static Square',
  `the title is the module's name and the start is the board it was composed from (${bundle.title} from ${bundle.from})`);
check(bundle.vid === null && bundle.virtual === undefined && bundle.module?.name === 'Probe One Call',
  'it carries NO authored variant id and NO virtual placement, only its own `module` provenance');
check(bundle.module?.steps.join(' | ') === STEPS.join(' | '),
  `and the provenance lists the steps it was composed from (${bundle.module?.steps.join(' | ')})`);
check(bundle.module?.endFormation?.length > 0, `naming the board it ends on (${bundle.module?.endFormation})`);

console.log('\n== 2. it lands where the REPLAY lands (the claim) ==');
// THE TOLERANCE IS THE ENGINE'S OWN BOUND, not this harness's taste: a composed module and the replay can differ by the
// engine's per-call snap, and `Sequencer` refuses anything beyond 0.02 — the same number `anim-convergence` allows
// between its last drawn frame and the board it is drawn against. The residue is PRINTED, so an increase is visible
// rather than absorbed.
const worst = convergence(bundle, STEPS, HOME);
console.log(`    worst dancer between the composition and the replay: ${worst.toExponential(2)}`);
check(worst <= 0.02, 'every dancer of the composed end board is the replay end board, within the engine\'s 0.02 bound');
check(Math.abs(one.residue - worst) < 1e-12,
  `and the engine reports the residue this harness computes for itself (${one.residue.toExponential(2)}), so the number is not a second guess`);
const replayedEnd = seq.evaluateSequence(seq.flatten(STEPS), bundle.beats, HOME).board;
check(one.end.dancers.every((d, i) => Math.hypot(d.x - replayedEnd.dancers[i].x, d.y - replayedEnd.dancers[i].y) < 1e-9),
  'the returned `end` board IS the replay\'s, which is the board a following call has to start from');
check(one.end.dancers.length === 8, 'and it is a board, so a caller does not have to read poses');

console.log('\n== 3. and the clock does not move ==');
const charged = seq.sequenceBeats(seq.flatten(STEPS), HOME);
check(Math.abs(bundle.beats - charged) < 1e-9,
  `one composed call costs what the ${STEPS.length} flattened steps cost (${bundle.beats} vs ${charged} beats)`);

console.log('\n== 4. a SCOPED step composes, and the dancers it does not name hold ==');
const SCOPED = [{ selection: 'Heads', call: 'Right and Left Thru' }];
seq.registerModule('Probe Scoped', SCOPED);
const scoped = seq.moduleCall(HOME, 'Probe Scoped');
check(scoped.legal, `a scoped module composes (${scoped.legal ? 'legal' : scoped.reason})`);
if (scoped.legal) {
  const endBoard = seq.evaluateSequence(seq.flatten(SCOPED), scoped.bundle.beats, HOME).board;
  // WHICH DANCERS THE SELECTION NAMES IS THE ENGINE'S ANSWER, so the harness counts the dancers who HELD rather than
  // assuming which board indices "Heads" are: a Static Square's array order is not the caller's, and asserting indices
  // here would pin an order that the corpus owns.
  const held = scoped.bundle.dancers.filter((d) => {
    const p0 = poseFor(d, 0);
    const p1 = poseFor(d, scoped.bundle.beats);
    return Math.hypot(p0.x - p1.x, p0.y - p1.y) < 1e-9 && Math.abs(normAngle(p0.heading - p1.heading)) < 1e-9;
  });
  check(held.length === 4, `exactly the four dancers the selection does not name stand still for the step (${held.length} held)`);
  const worstScoped = convergence(scoped.bundle, SCOPED, HOME);
  console.log(`    worst dancer, scoped: ${worstScoped.toExponential(2)}`);
  check(worstScoped <= 0.02, 'and the scoped composition still lands on the replay board');
  check(endBoard.dancers.length === 8, 'the replay of a scoped step is still an eight-dancer board');
}

console.log('\n== 5. what cannot be composed is refused BY NAME ==');
{
  const unknown = seq.moduleCall(HOME, 'No Such Module');
  check(!unknown.legal && unknown.reason.includes('Unknown module'),
    `an unknown module is refused rather than throwing (${unknown.legal ? '' : unknown.reason})`);
}
{
  seq.registerModule('Probe While', [{ groups: [{ selection: 'Heads', calls: ['Pass Thru'] }, { selection: 'Sides', calls: ['Pass Thru'] }] }]);
  const r = seq.moduleCall(HOME, 'Probe While');
  check(!r.legal && /step 1 of 1/.test(r.reason) && /"while"/.test(r.reason),
    `a "while" step is refused and the refusal names the step (${r.legal ? '' : r.reason})`);
}
{
  seq.registerModule('Probe Coded', ['Face Left']);
  const r = seq.moduleCall(HOME, 'Probe Coded');
  check(!r.legal && /coded move/.test(r.reason),
    `a coded move with no authored track is refused by name (${r.legal ? '' : r.reason})`);
}
{
  seq.registerModule('Probe Unknown Step', ['Pass Thru', 'Square Thru']);
  const r = seq.moduleCall(seq.boardForFormation('Normal Lines'), 'Probe Unknown Step');
  check(!r.legal, 'a step that does not apply from its start board refuses the whole composition');
  check(/step 2 of 2 \(Square Thru\)/.test(r.legal ? '' : r.reason), `and says which step, and why (${r.legal ? '' : r.reason})`);
}

console.log('\n== 6. the negative control: a broken chain is caught by check 2 ==');
{
  // THE PLAUSIBLE WRONG EDIT is an out-of-order concatenation, so that is what is reconstructed: dancer 0's two step
  // blocks swapped. Checks 1/3/4 still pass on such a bundle - it is still eight dancers, still the module's title, still
  // the replay's beat count - so check 2 is the ONLY one that can see it, which is what makes it the acceptance test.
  const broken = {
    ...bundle,
    dancers: bundle.dancers.map((d, i) => (i === 0 ? { ...d, path: [...d.path.slice(1), d.path[0]] } : d)),
  };
  const bad = convergence(broken, STEPS, HOME);
  console.log(`    worst dancer with the chain out of order: ${bad.toExponential(2)}`);
  check(bad > 0.02, 'a misplaced step block moves the dancer by whole units, so the convergence check would fail it');
  check(convergence(bundle, STEPS, HOME) <= 0.02, 'while the composition itself still passes');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nmodule-call: all checks hold');
process.exit(failures ? 1 : 0);
