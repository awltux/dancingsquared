// THE ID ENCODING IS ONE MECHANISM, AND A WIDTH HAS A CEILING.
//
// WHAT THIS HARNESS PINS. Section 1 that the formation id IS produced by the shared encoder rather than by a
// copy of it (the anti-drift check: a second implementation of "36^width, reduced, rendered low case" would
// eventually disagree, and the harness would not notice if it only compared ids with themselves); 2 the ends of
// a payload space; 3 that `isIdOf` tells an id from a name and escapes its prefix; 4 the width fact that forces
// the 64-bit digest, measured BOTH ways beside each other; 5 the 64-bit hash against published values.
//
// THE NEGATIVE CONTROL IS SECTION 4. The plausible wrong rule is "eight characters is just six with two more
// letters, so keep the 32-bit hash" - and it is measured to produce `0` as the FIRST character of every one of
// 1000 ids, where the 64-bit digest does not. 36^7 = 78,364,164,096 > 2^32 = 4,294,967,296; 36^6 = 2,176,782,336
// does not. That is why `A1-` and `V1-` digest with 64 bits and `F2-` does not.
//
// Run: node test/id-code.mjs   (from engine/; the engine must be built)
import {
  formationId, formationCanonical, FORMATION_ID_VERSION,
  ID_ALPHABET, ID_BASE, idSpace, encodeId, isIdOf, fnv1a32, fnv1a64,
} from '../dist/index.js';

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};

const board = (spots) => ({ dancers: spots.map(([x, y, h]) => ({ x, y, heading: h })) });
const board1 = board([[1, 3, 0], [-1, 3, Math.PI], [1, -3, 0], [-1, -3, Math.PI]]);
const board2 = board([[0, 0, 0], [2, 0, Math.PI], [0, -2, Math.PI / 2], [2, -2, -Math.PI / 2]]);

console.log('== 1. the formation id is the shared encoder, not a copy ==');
for (const [name, b] of [['home-ish', board1], ['box-ish', board2]]) {
  const composed = encodeId(FORMATION_ID_VERSION, fnv1a32(formationCanonical(b)), 6);
  check(formationId(b) === composed, `${name}: encodeId(fnv1a32(canonical)) reproduces formationId`, `${formationId(b)} vs ${composed}`);
}
check(formationId(board1) !== formationId(board2), 'two different boards get different ids');
check(new RegExp(`^${FORMATION_ID_VERSION}[0-9a-z]{6}$`).test(formationId(board1)), 'the id is the prefix and six low-case characters');

console.log('== 2. the ends of a payload space ==');
check(encodeId('X-', 0, 6) === 'X-000000', 'zero is all zeros at width 6');
check(encodeId('X-', idSpace(6) - 1n, 6) === 'X-zzzzzz', 'the last code of the space is all z at width 6');
check(encodeId('X-', idSpace(6), 6) === 'X-000000', 'one past the space wraps to zero (it is a reduction, not a truncation)');
check(encodeId('Y-', 0, 8) === 'Y-00000000', 'zero is all zeros at width 8');
check(encodeId('Y-', idSpace(8) - 1n, 8) === 'Y-zzzzzzzz', 'the last code of the space is all z at width 8');
check(ID_ALPHABET.length === ID_BASE && ID_BASE === 36, 'the alphabet is 36 symbols');

console.log('== 3. an id is not a name, and the prefix is escaped ==');
check(isIdOf('F2-', 6, 'F2-a3k9m2'), 'accepts a well-formed id');
check(isIdOf('F2-', 6, 'F2-A3K9M2'), 'accepts an upper-case retype (an id retyped by hand is the same id)');
check(!isIdOf('F2-', 6, 'Facing Couples'), 'rejects a formation name');
check(!isIdOf('F2-', 6, 'F2-a3k9m'), 'rejects a short payload');
check(!isIdOf('F2.', 2, 'F2xab'), 'CONTROL: an unescaped `.` in the prefix would match any character, so the prefix is escaped and "F2xab" is NOT an id of the scheme "F2."');
check(isIdOf('F2.', 2, 'F2.ab'), 'the escaped prefix matches itself literally');

console.log('== 4. eight characters do not fit in 32 bits (the control for the 64-bit digest) ==');
const strings = [];
for (let i = 0; i < 1000; i++) strings.push(`board:${i}:${(i * 7919) % 10007}`);
const narrow = strings.map((s) => encodeId('Y-', fnv1a32(s), 8));
const wide = strings.map((s) => encodeId('Y-', fnv1a64(s), 8));
const narrowZero = narrow.filter((id) => id[2] === '0').length;
const wideZero = wide.filter((id) => id[2] === '0').length;
check(narrowZero === narrow.length, `every 32-bit eight-character id begins with 0 (${narrowZero} of ${narrow.length})`);
check(wideZero < wide.length, `the 64-bit ids do not (${wideZero} of ${wide.length} begin with 0)`);
check(new Set(wide).size === wide.length, `all ${wide.length} 64-bit ids are distinct`);
check(new Set(narrow).size > narrow.length * 0.99, 'the 32-bit ids are distinct too - the defect is entropy, not collisions');

console.log('== 5. FNV-1a, 64 bit, against its published values ==');
check(fnv1a64('') === 0xcbf29ce484222325n, 'the empty string is the offset basis');
check(fnv1a64('a') === 0xaf63dc4c8601ec8cn, 'the string "a" is 0xaf63dc4c8601ec8c');
check(fnv1a64('foobar') === 0x85944171f73967e8n, 'the string "foobar" is 0x85944171f73967e8');
check(fnv1a32('foobar') === 0xbf9cf968, 'and the 32-bit hash still matches its own published value');

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
