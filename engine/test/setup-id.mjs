// A SETUP'S IDENTITY IS THE ARRANGEMENT **AND** THE ORDER THE EIGHT PHYSICAL DANCERS ARE LISTED IN.
//
// WHAT THIS HARNESS PINS. Section 1 the format, that it is the shared encoder rather than a copy, and that it is a
// different string from the arrangement and formation ids; 2 the EIGHT-PHYSICAL guard, which is what separates it
// from `dancers.length === 8`; 3 that a phantom is not in the key at all, wherever it sits in the array, and that
// the engine's identity stamps (`id`, `couple`) are not either; 4 the invariances (rotation, translation) and the
// one thing that must NOT be invariant - the ARRAY ORDER - with `arrangementId` run beside every split as the
// control, because "the arrangement is enough" is exactly the plausible wrong rule and it is the rule this scheme
// exists to replace; 5 that the canonicalisation is the arrangement's plus a suffix, which is what keeps the two
// schemes one mechanism; 6 the HALF-SET rule, against `reconstituteWholeSet`: a half and its COMPLEMENTARY half are
// one setup; 7 the rotationally symmetric case, where the arrangement canonicalisation has a tie and the order
// string is what resolves it; 8 the control in the other direction - a scheme built from the order alone collides
// on a gender relabelling.
//
// WHAT IS NOT HERE. The corpus population (how many distinct setups the eight-physical authoring starts and the
// generated instances carry) is pinned by `identity-census.mjs`, which walks the corpus and is not a light gate.
//
// Run: node test/setup-id.mjs   (from engine/; the engine must be built)
import {
  setupId, setupCanonical, isSetupId, isPhysicalDancer, SETUP_DANCERS, SETUP_ID_VERSION,
  formationId, arrangementId, arrangementCanonical, canonicalOf, encodeId, fnv1a64,
  makeSquaredSet, reconstituteWholeSet,
} from '../dist/index.js';

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};

const DEG = Math.PI / 180;
let nextId = 1;
const dancer = (gender, x, y, heading) => ({ id: nextId++, couple: 1, gender, x, y, heading });
const board = (dancers) => ({ dancers });
const ghost = (d) => ({ ...d, isGhost: true });
const phantomGender = (d) => ({ ...d, gender: 'phantom' });
/** The physical sub-board, through the module's own predicate rather than a second copy of the rule. */
const physical = (b) => board(b.dancers.filter(isPhysicalDancer));
const rotate = (b, turn) => board(b.dancers.map((d) => {
  let X = d.x;
  let Y = d.y;
  for (let i = 0; i < turn; i++) { const nx = -Y; const ny = X; X = nx; Y = ny; }
  return { ...d, x: X, y: Y, heading: d.heading + turn * (Math.PI / 2) };
}));
const translate = (b, dx, dy) => board(b.dancers.map((d) => ({ ...d, x: d.x + dx, y: d.y + dy })));

// The engine's own squared set, in its own array order (couples 3,3,2,2,1,1,4,4): a real board, with real
// identity stamps this scheme must ignore.
const home = makeSquaredSet();
const id = setupId(home);
/** The two array reorderings that keep the arrangement and move the order. */
const reversed = board([...home.dancers].reverse());
const shifted = board([...home.dancers.slice(2), ...home.dancers.slice(0, 2)]);

console.log('== 1. the format, and the encoder ==');
check(SETUP_ID_VERSION === 'S1-', `the scheme prefix is S1- (${SETUP_ID_VERSION})`);
check(new RegExp(`^${SETUP_ID_VERSION}[0-9a-z]{8}$`).test(id), `a setup id is the prefix and eight low-case characters (${id})`);
check(setupId(home) === encodeId('setup', fnv1a64(setupCanonical(home))),
  'encodeId(\'setup\', fnv1a64(canonical)) reproduces setupId - the shared encoder, not a copy',
  `${setupId(home)} vs ${encodeId('setup', fnv1a64(setupCanonical(home)))}`);
check(id !== formationId(home) && id !== arrangementId(home), 'it is neither the formation id nor the arrangement id',
  `${id} / ${formationId(home)} / ${arrangementId(home)}`);
check(isSetupId(id), 'isSetupId accepts it');
check(isSetupId(id.toUpperCase()), 'and an upper-case retype (an id retyped by hand is the same id)');
check(!isSetupId(arrangementId(home)), 'isSetupId refuses an arrangement id');
check(!isSetupId(formationId(home)), 'and a formation id');
check(!isSetupId('Circle'), 'and a formation name');
check(!isSetupId(id.slice(0, -1)) && !isSetupId(`${id}q`), 'and a short and a long payload');

console.log('== 2. the eight-PHYSICAL guard, not a count of array entries ==');
check(SETUP_DANCERS === 8, `a setup is ${SETUP_DANCERS} physical dancers`);
check(isPhysicalDancer({ gender: 'boy' }) && isPhysicalDancer({ gender: 'girl' }), 'a boy and a girl are physical');
check(!isPhysicalDancer({ gender: 'phantom' }), 'a phantom gender is not');
check(!isPhysicalDancer({ gender: 'boy', isGhost: true }), 'and a ghost is not, whatever its gender says');
const seven = home.dancers.slice(0, 7);
check(setupId(board(seven)) === null, 'seven dancers get no setup id');
check(setupId(board([...seven, ghost(seven[0])])) === null, 'and neither do seven PHYSICAL dancers plus a ghost');
check(setupId(board([...seven, phantomGender(seven[0])])) === null, 'nor seven plus a phantom-gender dancer');
check(setupCanonical(board(seven)) === null, 'the canonicalisation refuses too, so no id can be built past the guard');
for (const n of [2, 4, 6]) check(setupId(board(home.dancers.slice(0, n))) === null, `${n} dancers get no setup id`);
check(typeof setupCanonical(home) === 'string' && typeof id === 'string', 'an eight-dancer board gets both');

console.log('== 3. a phantom is not in the key, wherever it sits ==');
for (const at of [0, 3, 8]) {
  const withGhost = board([...home.dancers.slice(0, at), ghost(home.dancers[0]), ...home.dancers.slice(at)]);
  check(setupId(withGhost) === id, `a ghost inserted at index ${at} changes nothing`);
}
for (const at of [0, 4, 8]) {
  const withPhantom = board([...home.dancers.slice(0, at), phantomGender(home.dancers[0]), ...home.dancers.slice(at)]);
  check(setupId(withPhantom) === id, `a phantom-gender dancer inserted at index ${at} changes nothing`);
}
check(setupId(physical(board([...home.dancers, ghost(home.dancers[1])]))) === id,
  'the physical sub-board is the board the id names, which is why filtering and re-indexing is the rule');
const restamped = board(home.dancers.map((d, i) => ({ ...d, id: 100 + i, couple: 4 - (i % 4) })));
check(setupId(restamped) === id, 'and the identity stamps (id, couple) are not part of it - the geometry and order are');

console.log('== 4. rotation and translation drop out; the ARRAY ORDER does not ==');
for (const turn of [1, 2, 3]) {
  check(setupId(rotate(home, turn)) === id, `a quarter turn x${turn} keeps the id`);
  check(arrangementId(rotate(home, turn)) === arrangementId(home), `...and the arrangement id, as it always has`);
}
check(setupId(translate(home, 2.5, -7)) === id, 'a translation keeps the id');
{
  check(setupId(reversed) !== id, 'a REVERSED array is a different setup', `${setupId(reversed)} vs ${id}`);
  check(arrangementId(reversed) === arrangementId(home), 'CONTROL: the arrangement id cannot see it, which is why this scheme exists');
}
{
  // A cyclic shift by one COUPLE is not a free reorder on this board: its couples sit a quarter turn apart, so the
  // shift and a rotation are the same board and the id must NOT change. That is measured, not asserted.
  const samePose = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
    && Math.abs(Math.atan2(Math.sin(a.heading - b.heading), Math.cos(a.heading - b.heading))) < 1e-9
    && a.gender === b.gender;
  const turn = [0, 1, 2, 3].find((k) => rotate(home, k).dancers.every((d, i) => samePose(d, shifted.dancers[i])));
  check(turn !== undefined, `a cyclic shift of the array by one couple IS a quarter turn of this board (turn ${turn})`);
  check(setupId(shifted) === id, 'so the id is unchanged - the shift moved no couple relative to the others');
  check(arrangementId(shifted) === arrangementId(home), 'CONTROL: and the arrangement id agrees, as it must');
}
{
  // Two BOYS exchanged, so every spot keeps its gender: the arrangement is untouched and only the order moves.
  const boys = home.dancers.map((d, i) => ({ d, i })).filter(({ d }) => d.gender === 'boy').slice(0, 2).map(({ i }) => i);
  const swapped = board(home.dancers.map((d, i) => {
    if (i === boys[0]) return { ...d, x: home.dancers[boys[1]].x, y: home.dancers[boys[1]].y, heading: home.dancers[boys[1]].heading };
    if (i === boys[1]) return { ...d, x: home.dancers[boys[0]].x, y: home.dancers[boys[0]].y, heading: home.dancers[boys[0]].heading };
    return d;
  }));
  check(arrangementId(swapped) === arrangementId(home), 'CONTROL: two boys exchanged leave every spot one boy (same arrangement)');
  check(setupId(swapped) !== id, 'and the setup id separates them - the pair roles moved');
}

console.log('== 5. the canonicalisation is the arrangement\'s, plus the order ==');
{
  const canon = setupCanonical(home);
  const arrangementPart = arrangementCanonical(physical(home));
  check(canon === `${arrangementPart}#${canonicalOf(physical(home), (_d, i) => String(i))}`,
    'the key is the arrangement canonicalisation, then #, then the same canonicaliser with the index as the symbol');
  check(canon.startsWith(`${arrangementPart}#`), 'so the setup key starts with the arrangement key');
  check(!arrangementPart.includes('#'), 'and the # cannot come from inside the arrangement part');
  const samples = [home, ...[1, 2, 3].map((t) => rotate(home, t)), reversed, shifted, board([...home.dancers, ghost(home.dancers[2])])];
  const pairs = [];
  for (const b of samples) pairs.push([setupId(b), arrangementId(physical(b))]);
  const bad = pairs.filter(([sid, aid], i) => pairs.some(([sid2, aid2], j) => i !== j && sid === sid2 && aid !== aid2));
  check(bad.length === 0, `equal setup id implies equal arrangement id (${pairs.length} board(s) compared)`, JSON.stringify(bad));
}

console.log('== 6. the half-set rule: a half and its COMPLEMENTARY half are one setup ==');
{
  // The written half in square-set order: the south couple then the east couple, partners side by side.
  const half = [
    { x: -1, y: -3, heading: 90 * DEG, gender: 'boy' },
    { x: 1, y: -3, heading: 90 * DEG, gender: 'girl' },
    { x: 3, y: -1, heading: 180 * DEG, gender: 'boy' },
    { x: 3, y: 1, heading: 180 * DEG, gender: 'girl' },
  ];
  const asPlaced = (ds) => ds.map((d, i) => ({ id: i + 1, couple: 0, gender: d.gender, x: d.x, y: d.y, angleDeg: d.heading / DEG }));
  const asBoard = (ds) => board(ds.map((d) => ({ id: d.id, couple: d.couple, gender: d.gender, x: d.x, y: d.y, heading: d.angleDeg * DEG })));
  check(setupId(asBoard(asPlaced(half))) === null, 'a written half is four physical dancers, so it is not a setup');
  const whole = reconstituteWholeSet(asPlaced(half));
  const wholeId = setupId(asBoard(whole));
  check(whole.length === 8 && typeof wholeId === 'string', `the completion is the whole set (${whole.length} dancers, ${wholeId})`);
  const complement = whole.slice(4);
  check(setupId(asBoard(complement)) === null, 'the other half on its own is four dancers, so it is not a setup either');
  check(setupId(asBoard(reconstituteWholeSet(complement))) === wholeId,
    'completing the COMPLEMENTARY half mints the same setup id (it is the whole board turned 180 degrees)');
  const reordered = [half[2], half[3], half[0], half[1]];
  const reorderedWhole = asBoard(reconstituteWholeSet(asPlaced(reordered)));
  check(arrangementId(reorderedWhole) === arrangementId(asBoard(whole)),
    'CONTROL: re-ordering the written half cannot change the arrangement - a permutation moves no gender');
  check(setupId(reorderedWhole) !== wholeId, 'and the setup id separates the two, because the couples are numbered differently');
  const sameGenderFirst = [half[2], half[1], half[0], half[3]];
  check(arrangementId(asBoard(reconstituteWholeSet(asPlaced(sameGenderFirst)))) === arrangementId(asBoard(whole)),
    'two boys exchanged in the written half leave the arrangement alone');
  check(setupId(asBoard(reconstituteWholeSet(asPlaced(sameGenderFirst)))) !== wholeId,
    'and the setup id separates them');
}

console.log('== 7. the rotationally symmetric case: where a tie exists, the order resolves it ==');
{
  check(arrangementId(rotate(home, 1)) === arrangementId(home),
    'the arrangement canonicalisation is unchanged by a quarter turn here (the sorted key ties)');
  check(setupId(rotate(home, 1)) === id, 'and the setup id is still one value, because the index makes the four keys distinct');
  check(setupId(board([...rotate(home, 1).dancers, ghost(home.dancers[0])])) === id,
    'with a ghost added to the turned board, the id is the same as the unturned one');
}

console.log('== 8. the control in the other direction: the order alone is not enough ==');
{
  const orderOnly = (b) => encodeId('setup', fnv1a64(canonicalOf(physical(b), (_d, i) => String(i))));
  const genderSwapped = board(home.dancers.map((d) => ({ ...d, gender: d.gender === 'boy' ? 'girl' : 'boy' })));
  check(arrangementId(genderSwapped) !== arrangementId(home), 'a gender relabelling changes the arrangement');
  check(setupId(genderSwapped) !== id, 'and changes the setup id');
  check(orderOnly(genderSwapped) === orderOnly(home),
    'CONTROL: a setup key built from the order alone collides on it, so the arrangement half is load-bearing too');
}

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
