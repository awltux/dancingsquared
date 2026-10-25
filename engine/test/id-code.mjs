// THE ID ENCODING IS ONE MECHANISM: one alphabet, one width, one digest, and one place the prefixes live.
//
// WHAT THIS HARNESS PINS. Section 1 that the formation id IS produced by the shared encoder rather than by a copy
// of it (the anti-drift check: a second implementation of "36^width, reduced, rendered low case" would eventually
// disagree, and a harness comparing ids only with themselves would not notice); 2 the ends of the payload space;
// 3 that `isIdOf` tells an id from a name, reads the prefix from the scheme table, and escapes it; 4 THE CONTROL
// that rules out a cheap digest; 5 the hash against published values.
//
// THE CONTROL IS SECTION 4. The plausible wrong rule is "a wider id is just the same hash with more letters", and
// it is measured to leave `0` as the FIRST character of all 1,000 ids, because a 32-bit digest cannot fill a
// 36^8 = 2,821,109,907,456 space - it needs at most seven base-36 characters, so the eighth is always zero. That
// is why every scheme digests with 64 bits, and it is the reason the encoder takes the digest MODULO the space
// rather than truncating it.
//
// Run: node test/id-code.mjs   (from engine/; the engine must be built)
import {
  formationId, formationCanonical,
  ID_ALPHABET, ID_BASE, ID_WIDTH, ID_SPACE, ID_SCHEMES, encodeId, isIdOf, fnv1a64,
} from '../dist/index.js';

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};

/**
 * A 32-BIT digest, implemented HERE and nowhere else, because it is the rejected alternative this harness measures
 * rather than imports: the engine no longer has a 32-bit hash, and a control that imported one would not exist.
 */
const fnv1a32Control = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const board = (spots) => ({ dancers: spots.map(([x, y, h]) => ({ x, y, heading: h })) });
const board1 = board([[1, 3, 0], [-1, 3, Math.PI], [1, -3, 0], [-1, -3, Math.PI]]);
const board2 = board([[0, 0, 0], [2, 0, Math.PI], [0, -2, Math.PI / 2], [2, -2, -Math.PI / 2]]);

console.log('== 1. the formation id is the shared encoder, not a copy ==');
for (const [name, b] of [['home-ish', board1], ['box-ish', board2]]) {
  const composed = encodeId('formation', fnv1a64(formationCanonical(b)));
  check(formationId(b) === composed, `${name}: encodeId('formation', fnv1a64(canonical)) reproduces formationId`,
    `${formationId(b)} vs ${composed}`);
}
check(formationId(board1) !== formationId(board2), 'two different boards get different ids');
check(new RegExp(`^${ID_SCHEMES.formation}[0-9a-z]{${ID_WIDTH}}$`).test(formationId(board1)),
  `the id is the scheme's prefix and ${ID_WIDTH} low-case characters`);

console.log('== 2. the ends of the payload space ==');
check(ID_WIDTH === 8 && ID_BASE === 36, `every scheme is ${ID_WIDTH} characters over a ${ID_BASE}-symbol alphabet`);
check(encodeId('formation', 0n) === 'F3-00000000', 'zero is all zeros');
check(encodeId('formation', ID_SPACE - 1n) === 'F3-zzzzzzzz', 'the last code of the space is all z');
check(encodeId('formation', ID_SPACE) === 'F3-00000000', 'one past the space wraps to zero (it is a reduction, not a truncation)');
check(encodeId('arrangement', 0n) === 'A1-00000000' && encodeId('setup', 0n) === 'S1-00000000' && encodeId('variant', 0n) === 'V1-00000000',
  'and the other three schemes render the same digest under their own prefixes');
check(ID_ALPHABET.length === ID_BASE && ID_ALPHABET === '0123456789abcdefghijklmnopqrstuvwxyz',
  "the alphabet is the digits then the letters, lower case, so `0` is not `o` and `1` is not `l`");

console.log('== 3. an id is not a name, and the prefix is read from the scheme table ==');
check(isIdOf('formation', 'F3-a3k9m2zq'), 'accepts a well-formed id');
check(isIdOf('formation', 'F3-A3K9M2ZQ'), 'accepts an upper-case retype (an id retyped by hand is the same id)');
check(!isIdOf('formation', 'Facing Couples'), 'rejects a formation name');
check(!isIdOf('formation', 'F3-a3k9m2z'), 'rejects a SHORT payload');
check(!isIdOf('formation', 'F3-a3k9m2zqq'), 'rejects a LONG one');
check(!isIdOf('arrangement', 'F3-a3k9m2zq'), 'and one scheme does not accept another scheme\'s prefix');
// THE PREFIX IS ESCAPED, and this is the only way to measure it now that the table is the single source: the
// scheme is given a prefix containing a regex metacharacter for the duration of the check and then put back. An
// unescaped `.` would match any character, so "F3x00000000" would be accepted - which is the defect.
{
  const table = ID_SCHEMES;
  const before = table.formation;
  table.formation = 'F3.';
  check(!isIdOf('formation', 'F3x00000000'), 'CONTROL: an unescaped `.` in a prefix would accept any character');
  check(isIdOf('formation', 'F3.00000000'), 'and the escaped prefix still matches itself literally');
  table.formation = before;
}

console.log('== 4. the control: a 32-bit digest cannot fill this space ==');
const strings = [];
for (let i = 0; i < 1000; i++) strings.push(`board:${i}:${(i * 7919) % 10007}`);
// The digest is encoded with the same function, so the only difference is the digest's width.
const narrow = strings.map((s) => encodeId('formation', BigInt(fnv1a32Control(s))));
const wide = strings.map((s) => encodeId('formation', fnv1a64(s)));
const narrowZero = narrow.filter((id) => id[ID_SCHEMES.formation.length] === '0').length;
const wideZero = wide.filter((id) => id[ID_SCHEMES.formation.length] === '0').length;
check(narrowZero === narrow.length, `every 32-bit id begins with 0 (${narrowZero} of ${narrow.length})`);
check(wideZero < wide.length, `the 64-bit ids do not (${wideZero} of ${wide.length} begin with 0)`);
check(new Set(wide).size === wide.length, `all ${wide.length} 64-bit ids are distinct`);
check(new Set(narrow).size > narrow.length * 0.99, 'the 32-bit ids are distinct too - the defect is entropy, not collisions');

console.log('== 5. FNV-1a, 64 bit, against its published values ==');
check(fnv1a64('') === 0xcbf29ce484222325n, 'the empty string is the offset basis');
check(fnv1a64('a') === 0xaf63dc4c8601ec8cn, 'the string "a" is 0xaf63dc4c8601ec8c');
check(fnv1a64('foobar') === 0x85944171f73967e8n, 'the string "foobar" is 0x85944171f73967e8');

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
