// A MODULE IS OFFERED FROM ITS OWN START BOARD, AND FROM NOWHERE ELSE.
//
// Asked for: "A module should be matches in the same way a call is matched, by using the start formation. If it gets
// inserted into a sequence the end formation defines what calls can follow it."
//
// WHY IT WAS NEEDED. A module is a SEQUENCE, and 168 of the 294 corpus modules are written for a Zero Line or a Zero Box.
// The picker offered every registered module from every board, because all `legalWithResults` did was try the steps: a
// zero-box module's first call or two often apply from a square set, so it was listed, and the caller found out the board
// was wrong by a refusal in the middle of the module (`ceder-7046` reaches its fourth call and then `Right and Left Grand`
// refuses from the `T-Bone RDRD` a square set produces - which reads as "the call is broken").
//
// A CALL IS ALREADY MATCHED THIS WAY: `findMatchingVariant` tests its authored start against the board within the
// interactive tolerance. A module with a declared `start` is now matched by the same `matchFormations` at the same
// tolerance, so the two surfaces agree.
//
// THE NEGATIVE CONTROL IS THE WHOLE POINT (check 3): the SAME steps, registered WITHOUT a start, ARE offered from the home
// square. That is what separates this change from "the calls refused", and it is the check a plausible wrong edit - gating
// on the steps, or dropping the gate - fails.
//
// Usage: node engine/test/module-start.mjs   (after `npm run build --prefix engine`)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../dist/index.js';
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
seq.register('Pass Thru', read('ms/pass_thru.xml'));

// WHERE THE MODULE SAYS IT BEGINS: an Eight Chain Thru, which is a facing board the home square is not. `Pass Thru`
// applies from both, so the STEPS cannot tell the two boards apart - only the gate can.
const ECT = seq.boardForFormation('Eight Chain Thru');
const HOME = seq.startBoard();

console.log('== 1. the two boards are really different ==');
check(!!ECT, 'the engine can stand up an Eight Chain Thru (the module\'s declared start)');
check(!!HOME && ECT.dancers.length === HOME.dancers.length, 'and both are eight-dancer boards, so a count cannot tell them apart');

console.log('\n== 2. a module with a declared start is offered from that start only ==');
seq.setBoard(HOME);
seq.registerModule('Written For ECT', ['Pass Thru'], { start: ECT.dancers });
check(!seq.legalNext().includes('Written For ECT'),
  'from the HOME square the module is NOT offered, even though its single step applies here');
seq.setBoard(ECT);
check(seq.legalNext().includes('Written For ECT'),
  'from the board it declares, it IS offered - so the gate narrows the list, it does not empty it');
seq.setBoard(HOME);

console.log('\n== 3. the negative control: the same steps with NO declared start ==');
seq.registerModule('Same Steps No Start', ['Pass Thru']);
check(seq.legalNext().includes('Same Steps No Start'),
  'ARE offered from home - which is what the old behaviour was, and what proves the gate (not the calls) did the work');

console.log('\n== 4. the declared boards are readable, and absent means "no declaration" ==');
const ectStart = seq.moduleStart('Written For ECT');
check(!!ectStart && ectStart.length === 8, '`moduleStart` gives the eight dancers that were declared');
check(ectStart[0].x === ECT.dancers[0].x && ectStart[0].y === ECT.dancers[0].y && ectStart[0].heading === ECT.dancers[0].heading,
  'and they are the declared geometry, not a re-derived guess');
seq.registerModule('With An End', ['Pass Thru'], { start: ECT.dancers, end: HOME.dancers });
const end = seq.moduleEnd('With An End');
check(!!end && end.length === 8 && end[0].x === HOME.dancers[0].x,
  '`moduleEnd` gives where the author says it ends, which is what a sequence asks "what may follow this" from');
check(seq.moduleStart('Same Steps No Start') === null && seq.moduleEnd('Same Steps No Start') === null,
  'a module with no declaration answers null for both - which is NOT "home", and is why the gate is skipped rather than applied');
check(seq.getModules().find((m) => m.name === 'Written For ECT')?.start?.length === 8,
  'and `getModules` carries the boards, so a consumer of the module LIST can see them too');

console.log('\n== 5. a start of a different SIZE is refused the same way ==');
// A four-dancer declaration is the shape a half-set authoring could produce; it must not match a full board by accident.
seq.setBoard(HOME);
seq.registerModule('Half A Start', ['Pass Thru'], { start: HOME.dancers.slice(0, 4) });
check(!seq.legalNext().includes('Half A Start'),
  'a four-dancer start does not match an eight-dancer board, and the module is not offered');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nmodule-start: all checks hold');
process.exit(failures ? 1 : 0);
