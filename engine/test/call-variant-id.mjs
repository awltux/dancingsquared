// A VARIANT IS (LEVEL, CALL, FORMATION ROOT), AND THE ROOT IS WHAT SURVIVES AN EDIT.
//
// WHAT THIS HARNESS PINS. Section 1 the format and that it is its own scheme; 2 that each of the three inputs
// moves the id - level, title, root; 3 the fold: case and whitespace do not mint a second id, and the fold goes
// NO FURTHER than that, with the over-eager normaliser run beside it as a control (stripping fractions collides
// `Tag the Line` with `3/4 Tag the Line`, which `map-calls.mjs` already paid for); 4 the ledger walk, including
// a chain and a cycle; 5 THE POINT OF THE ROOT: a formation edit re-keys the formation id and the variant id
// does NOT move, with the raw-formation-id call run beside it as the negative control - that is the whole
// difference between a reference and a content address.
//
// Run: node test/call-variant-id.mjs   (from engine/; the engine must be built)
import {
  callVariantId, callVariantCanonical, isCallVariantId, formationRootOf, CALL_VARIANT_ID_VERSION,
  formationId, arrangementId,
} from '../dist/index.js';

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};

const board = (spots) => ({ dancers: spots.map(([x, y, h, g], i) => ({ id: i + 1, couple: 1, gender: g, x, y, heading: h })) });
const home = board([[-1, 1, 0, 'boy'], [1, 1, Math.PI, 'girl'], [1, -1, 0, 'boy'], [-1, -1, Math.PI, 'girl']]);
// The same square one grid cell wider: a geometry correction that changes the shape but not the call.
const wider = board([[-2, 1, 0, 'boy'], [2, 1, Math.PI, 'girl'], [2, -1, 0, 'boy'], [-2, -1, Math.PI, 'girl']]);

const shapeNow = formationId(home);
const shapeAfter = formationId(wider);
const roots = { [shapeNow]: shapeNow, [shapeAfter]: shapeNow };

console.log('== 1. the format, and it is its own scheme ==');
const id = callVariantId('ms', 'Swing', shapeNow);
check(new RegExp(`^${CALL_VARIANT_ID_VERSION}[0-9a-z]{8}$`).test(id), `a variant id is the prefix and eight low-case characters (${id})`);
check(isCallVariantId(id), 'isCallVariantId accepts it');
check(isCallVariantId(id.toUpperCase()), 'and an upper-case retype');
check(!isCallVariantId(formationId(home)), 'it refuses a formation id');
check(!isCallVariantId(arrangementId(home)), 'and an arrangement id');
check(id !== formationId(home) && id !== arrangementId(home), 'the three schemes are three strings');

console.log('== 2. all three inputs move the id ==');
check(callVariantId('plus', 'Swing', shapeNow) !== id, 'the LEVEL moves it (the same call authored at two levels is two variants)');
check(callVariantId('ms', 'Swing Thru', shapeNow) !== id, 'the TITLE moves it');
check(callVariantId('ms', 'Swing', shapeAfter) !== id, 'the FORMATION ROOT moves it');

console.log('== 3. the fold: case and whitespace, and nothing else ==');
check(callVariantId('ms', '  swing ', shapeNow) === id, 'case and surrounding whitespace are the same call');
check(callVariantId('MS', 'Swing', shapeNow) === id, 'a level spelled in upper case is the same level');
check(callVariantId('ms', 'Tag the Line', shapeNow) !== callVariantId('ms', '3/4 Tag the Line', shapeNow), 'a fraction is NOT folded away');
// The plausible wrong fold: strip the fraction words, as the book's old matcher did. It collides these two.
const overEager = (t) => t.toLowerCase().replace(/\b(\d+\/\d+)\s+/g, '').replace(/[^a-z]/g, '');
check(overEager('Tag the Line') === overEager('3/4 Tag the Line'), 'CONTROL: a fraction-stripping fold collides "Tag the Line" and "3/4 Tag the Line"');
check(callVariantCanonical('ms', 'Swing', shapeNow) === `ms|swing|${shapeNow}`, 'the canonical form is level|title|root, folded');

console.log('== 4. the ledger walk ==');
check(formationRootOf('F2-never', {}) === 'F2-never', 'an unseen formation root is itself (a shape minted since the census)');
check(formationRootOf(shapeAfter, roots) === shapeNow, 'an aliased id resolves to its root');
check(formationRootOf(shapeNow, roots) === shapeNow, 'and a root resolves to itself');
const chain = { 'F2-a': 'F2-b', 'F2-b': 'F2-c', 'F2-c': 'F2-c' };
check(formationRootOf('F2-a', chain) === 'F2-c', 'a chain is followed to its end');
const cycle = { 'F2-a': 'F2-b', 'F2-b': 'F2-a' };
check(formationRootOf('F2-a', cycle) === 'F2-a', 'a cycle terminates instead of hanging (a ledger defect the census reports)');

console.log('== 5. the root is what survives a formation edit (the negative control) ==');
const before = callVariantId('ms', 'Swing', formationRootOf(shapeNow, roots));
const after = callVariantId('ms', 'Swing', formationRootOf(shapeAfter, roots));
check(shapeNow !== shapeAfter, 'the edit really did mint a new formation id');
check(before === after, 'the variant id did NOT move', `${before} vs ${after}`);
check(callVariantId('ms', 'Swing', shapeNow) !== callVariantId('ms', 'Swing', shapeAfter), 'CONTROL: keying on the raw formation id would have moved it - which is the difference between a reference and a content address');

console.log('== 6. deterministic ==');
check(callVariantId('ms', 'Swing', shapeNow) === callVariantId('ms', 'Swing', shapeNow), 'the same inputs give the same id');

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
