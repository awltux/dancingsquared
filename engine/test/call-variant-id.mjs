// A VARIANT IS (LEVEL, CALL, THE START DEFINITION'S STORED `fid`), AND THE `fid` IS WHAT SURVIVES AN EDIT.
//
// WHAT THIS HARNESS PINS. Section 1 the format and that it is its own scheme; 2 that each of the three inputs
// moves the id - level, title, `fid`; 3 the fold: case and whitespace do not mint a second id, and the fold goes
// NO FURTHER than that, with the over-eager normaliser run beside it as a control (stripping fractions collides
// `Tag the Line` with `3/4 Tag the Line`, which `map-calls.mjs` already paid for); 4 THAT THE THIRD INPUT IS A
// STORED TAG AND NOT A CONTENT ADDRESS: a geometry correction mints a new formation id and the variant id does NOT
// move, with the raw-formation-id call run beside it as the negative control - that is the whole difference between
// a reference and a content address, and it is why the tree's root ledger could be deleted (a stored tag has the
// stability the ledger reconstructed, so there is nothing left to alias).
//
// Run: node test/call-variant-id.mjs   (from engine/; the engine must be built)
import { DOMParser } from '@xmldom/xmldom';
import {
  setParser, callVariantId, callVariantCanonical, isCallVariantId, CALL_VARIANT_ID_VERSION,
  formationId, arrangementId, parseFormationTags,
} from '../dist/index.js';

setParser(DOMParser);

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
// ONE STORED TAG FOR BOTH: that is what a `fid` written on a definition does when the definition's geometry is
// corrected - the bytes keep the id, so the tag does not move. The corpus writes them; this is the same fact.
const fid = shapeNow;

console.log('== 1. the format, and it is its own scheme ==');
const id = callVariantId('ms', 'Swing', fid);
check(new RegExp(`^${CALL_VARIANT_ID_VERSION}[0-9a-z]{8}$`).test(id), `a variant id is the prefix and eight low-case characters (${id})`);
check(isCallVariantId(id), 'isCallVariantId accepts it');
check(isCallVariantId(id.toUpperCase()), 'and an upper-case retype');
check(!isCallVariantId(formationId(home)), 'it refuses a formation id');
check(!isCallVariantId(arrangementId(home)), 'and an arrangement id');
check(id !== formationId(home) && id !== arrangementId(home), 'the three schemes are three strings');

console.log('== 2. all three inputs move the id ==');
check(callVariantId('plus', 'Swing', fid) !== id, 'the LEVEL moves it (the same call authored at two levels is two variants)');
check(callVariantId('ms', 'Swing Thru', fid) !== id, 'the TITLE moves it');
check(callVariantId('ms', 'Swing', shapeAfter) !== id, 'the FID moves it');

console.log('== 3. the fold: case and whitespace, and nothing else ==');
check(callVariantId('ms', '  swing ', fid) === id, 'case and surrounding whitespace are the same call');
check(callVariantId('MS', 'Swing', fid) === id, 'a level spelled in upper case is the same level');
check(callVariantId('ms', 'Tag the Line', fid) !== callVariantId('ms', '3/4 Tag the Line', fid), 'a fraction is NOT folded away');
// The plausible wrong fold: strip the fraction words, as the book's old matcher did. It collides these two.
const overEager = (t) => t.toLowerCase().replace(/\b(\d+\/\d+)\s+/g, '').replace(/[^a-z]/g, '');
check(overEager('Tag the Line') === overEager('3/4 Tag the Line'), 'CONTROL: a fraction-stripping fold collides "Tag the Line" and "3/4 Tag the Line"');
check(callVariantCanonical('ms', 'Swing', fid) === `ms|swing|${fid}`, 'the canonical form is level|title|fid, folded');

console.log('== 4. the fid is a stored tag, so an edit to the geometry does not move it (the negative control) ==');
{
  // THE TWO SIDES OF A GEOMETRY CORRECTION, as the corpus writes them: one definition, one `fid`, and the dancers
  // changed. `home` and `wider` above ARE those two geometries; the blocks here differ in nothing else.
  const block = (w) => `<formations><formation name="Sq" fid="F3-aaaaaaaa" aid="A1-aaaaaaaa">`
    + `<dancer gender="boy" x="${-w}" y="1" angle="0"/><dancer gender="girl" x="${w}" y="1" angle="180"/>`
    + `</formation></formations>`;
  const tagBefore = parseFormationTags(block(1)).get('Sq')?.fid;
  const tagAfter = parseFormationTags(block(2)).get('Sq')?.fid;
  check(tagBefore === 'F3-aaaaaaaa' && tagBefore === tagAfter, 'the STORED tag is the same on both sides of the correction');
  check(shapeNow !== shapeAfter, 'the correction did mint a new formation id');
  check(callVariantId('ms', 'Swing', tagBefore) === callVariantId('ms', 'Swing', tagAfter), 'so a variant minted from the STORED tag does NOT move');
  check(callVariantId('ms', 'Swing', shapeNow) !== callVariantId('ms', 'Swing', shapeAfter), 'CONTROL: keying on the content address would have moved it - which is the difference between a reference and a content address');
}

console.log('== 5. the tag the id is minted from is one the corpus writes ==');
{
  // THE STORED TAG IS THE REAL INPUT, so the format check is on a real one rather than an invented constant. The
  // corpus's own definitions are what `test/formation-tags.mjs` proves are all tagged; here the type only has to be
  // the right shape for `callVariantId`.
  const tags = parseFormationTags('<formations><formation name="X" fid="F3-aaaaaaaa" aid="A1-bbbbbbbb"/></formations>');
  const tagged = [...tags.values()].map((t) => t.fid).filter(Boolean);
  check(tagged.length === 1 && isCallVariantId(callVariantId('ms', 'X', tagged[0])), 'a tag read off a definition mints a variant id');
}

console.log('== 6. deterministic ==');
check(callVariantId('ms', 'Swing', fid) === callVariantId('ms', 'Swing', fid), 'the same inputs give the same id');

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
