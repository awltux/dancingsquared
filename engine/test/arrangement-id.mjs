// AN ARRANGEMENT'S IDENTITY IS THE SHAPE **AND** WHERE THE GENDERS STAND.
//
// WHAT THIS HARNESS PINS. Section 1 the format and that it is a different string from the formation id (one
// scheme, two keys - not a re-spelling of one); 2 that rotation, translation and array order drop out exactly
// as they do for the formation id; 3 that a gender relabelling SPLITS it where the formation id merges - with
// the formation id run beside it as the negative control, because "gender is not part of a setup" is the
// plausible wrong rule and it is exactly the rule that leaves a gender-specific call unmatched; 4 that the
// gender may not be sorted away from its position, with that implementation run beside it as the second
// control; 5 that the arrangement canonicalisation IS the formation canonicalisation plus a suffix, which is
// what stops the two schemes drifting into two mechanisms.
//
// WHAT IS NOT HERE. The corpus figures (242 arrangements over 1,771 starts, 115 calls that end on the same
// shape in a different arrangement) are pinned by `arrangement-census.mjs`, which walks the corpus and is not a
// light gate.
//
// Run: node test/arrangement-id.mjs   (from engine/; the engine must be built)
import {
  arrangementId, arrangementCanonical, isArrangementId, ARRANGEMENT_ID_VERSION,
  formationId, formationCanonical, canonicalOf, fnv1a64, encodeId,
} from '../dist/index.js';

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};

let nextId = 1;
const dancer = (gender, x, y, heading) => ({ id: nextId++, couple: 1, gender, x, y, heading });
const board = (dancers) => ({ dancers });
const rotate = (b, turn) => board(b.dancers.map((d) => {
  let X = d.x;
  let Y = d.y;
  for (let i = 0; i < turn; i++) { const nx = -Y; const ny = X; X = nx; Y = ny; }
  return { ...d, x: X, y: Y, heading: d.heading + turn * (Math.PI / 2) };
}));
const translate = (b, dx, dy) => board(b.dancers.map((d) => ({ ...d, x: d.x + dx, y: d.y + dy })));

const home = board([
  dancer('boy', -1, 1, 0), dancer('girl', 1, 1, Math.PI),
  dancer('boy', 1, -1, 0), dancer('girl', -1, -1, Math.PI),
]);
const sashayed = board(home.dancers.map((d) => ({ ...d, gender: d.gender === 'boy' ? 'girl' : 'boy' })));

console.log('== 1. the format, and it is not the formation id ==');
const id = arrangementId(home);
check(new RegExp(`^${ARRANGEMENT_ID_VERSION}[0-9a-z]{8}$`).test(id), `an arrangement id is the prefix and eight low-case characters (${id})`);
check(id !== formationId(home), 'the arrangement id is a different string from the formation id', `${id} vs ${formationId(home)}`);
check(isArrangementId(id), 'isArrangementId accepts it');
check(isArrangementId(id.toUpperCase()), 'and an upper-case retype (an id retyped by hand is the same id)');
check(!isArrangementId(formationId(home)), 'isArrangementId refuses a formation id');
check(!isArrangementId('Facing Couples'), 'and refuses a formation name');

console.log('== 2. rotation, translation and array order drop out ==');
for (const turn of [1, 2, 3]) check(arrangementId(rotate(home, turn)) === id, `a quarter turn x${turn} keeps the id`);
check(arrangementId(translate(home, 2.5, -7)) === id, 'a translation keeps the id');
check(arrangementId(board([...home.dancers].reverse())) === id, 'a reversed dancer array keeps the id');
check(arrangementId(board([...home.dancers].slice(2).concat(home.dancers.slice(0, 2)))) === id, 'a rotated array keeps the id');

console.log('== 3. a gender relabelling splits it - the formation id is the control ==');
check(formationId(sashayed) === formationId(home), 'CONTROL: the formation id calls the two boards one shape (gender is not part of a shape)');
check(arrangementId(sashayed) !== id, 'the arrangement id separates them', `${arrangementId(sashayed)} vs ${id}`);

console.log('== 4. the gender may not be sorted away from its position ==');
const swapped = board(home.dancers.map((d, i) => (i < 2 ? { ...d, gender: d.gender === 'boy' ? 'girl' : 'boy' } : d)));
check(formationId(swapped) === formationId(home), 'the swap keeps the shape (the formation id is blind to it)');
check(arrangementId(swapped) !== id, 'and changes the arrangement');
// The plausible wrong rule: the shape plus the gender multiset, sorted, with no positions. It cannot tell
// this swap from `home`, which is exactly the distinction a gender-specific call needs.
const multisetId = (b) => encodeId(ARRANGEMENT_ID_VERSION, fnv1a64(
  formationCanonical(b) + '|' + b.dancers.map((d) => d.gender).sort().join(''),
), 8);
check(multisetId(swapped) === multisetId(home), 'CONTROL: a gender-multiset id collides on the swap, which is why position is in the key');
check(multisetId(home) !== id, 'and the real id does not agree with it');

console.log('== 5. the arrangement canonicalisation IS the formation one, plus a suffix ==');
const strip = (canonical) => canonical.split('|').map((part, i) => (i === 0 ? part : part.replace(/,[Bgp?]$/, ''))).join('|');
const samples = [home, sashayed, swapped, rotate(home, 1), translate(home, 3, 4), board([
  dancer('phantom', 0, 0, 0), dancer('boy', 2, 0, Math.PI), dancer('girl', 0, -2, Math.PI / 2),
])];
let strippedOk = 0;
for (const b of samples) if (strip(arrangementCanonical(b)) === formationCanonical(b)) strippedOk++;
check(strippedOk === samples.length, `stripping the gender reproduces the formation canonicalisation (${strippedOk} of ${samples.length})`);
check(canonicalOf(home) === formationCanonical(home), 'canonicalOf with no symbol is formationCanonical');

console.log('== 6. a phantom is its own symbol ==');
const withPhantom = board([dancer('phantom', -1, 1, 0), dancer('girl', 1, 1, Math.PI), dancer('boy', 1, -1, 0), dancer('girl', -1, -1, Math.PI)]);
const withBoy = board([dancer('boy', -1, 1, 0), dancer('girl', 1, 1, Math.PI), dancer('boy', 1, -1, 0), dancer('girl', -1, -1, Math.PI)]);
check(arrangementId(withPhantom) !== arrangementId(withBoy), 'a phantom on a spot is a different arrangement from a boy on it');
check(formationId(withPhantom) === formationId(withBoy), 'while the formation id sees one shape (the phantom occupies the same spot)');

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
