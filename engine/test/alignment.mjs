// Step 2 of the get-out conformance work: a classifier for the other three FASR
// dimensions of a board - ARRANGEMENT, SEQUENCE and RELATIONSHIP.
//
// WHY: All8 indexes its get-outs by alignment ([0B1p], [1W2p], ...), not by call
// list. Running them - or even reporting which of them the engine can reach -
// needs the engine to say which alignment a board is in. naming the formation
// (step 1) is only one of the four dimensions.
//
// HOW, and what is actually verified here:
//   1. The hand-written arrangement tables in src/sequencer/alignment.ts must
//      equal a machine parse of All8's own arrangement-diagram page
//      (fixtures/all8-arrangements.json). Transcribing 36 tables by eye is the
//      obvious failure mode, so it is checked rather than trusted.
//   2. Every one of the 6 arrangement numbers, for every mapped formation, is
//      built from the table and must classify back to its own number - and must
//      still classify correctly after rotation. This exercises all 36 cells, not
//      just the one the engine's templates happen to sit in.
//   3. The engine's own templates must classify as arrangement 0. They are not
//      stored in All8's drawing orientation (they are 90 degrees clockwise from
//      it), so this also exercises the symmetry search, and it is an independent
//      agreement: the tables come from All8, the templates come from the engine.
//   4. Sequence is checked against the home squared set, which All8 states is
//      in sequence, and against synthetic relabellings for the other 3 states.
//   5. Relationship letters are checked against the home square's geometry.
//
// Run: `npm run build && node test/alignment.mjs` from engine/.
//
// NOTE on what is NOT claimed: Callerlab defines the reference pair needed for a
// relationship only for [0L], [0B], [0F] and [0W], and only in standard
// arrangement. Picking the reference pair is a per-formation convention, so
// alignmentOf() reports a relationship only when one is supplied. See
// REFERENCE_PAIR_RULES and the finding at the end.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  setParser,
  Sequencer,
  analyzeFasr,
  arrangementFor,
  sequenceFor,
  relationshipCode,
  letterForFormation,
  alignmentOf,
  boardFromDiagram,
  relationshipStateOf,
  centresPassThru,
  readLayout,
  fasrooOf,
  relabelCouples,
  boardsForAlignment,
  REFERENCE_PAIR_SPOTS,
  ARRANGEMENT_TABLES,
  ARRANGEMENT_NUMBER_ORDER,
  HOME_RING_ORDER,
} from '../dist/index.js';
import { HOME_DANCERS } from '../dist/sequencer/identity.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const FACING = { '>': 0, '^': 90, '<': 180, 'v': 270 };
const DEG = Math.PI / 180;
let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const ok = (msg) => console.log(`  ok    ${msg}`);

// ------------------------------------------------------ 1. table vs All8's page

const FIXTURE = path.join(__dirname, 'fixtures', 'all8-arrangements.json');
if (!existsSync(FIXTURE)) { console.log(`FAIL: no fixture at ${FIXTURE}`); process.exit(1); }
const parsed = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const numberOrder = parsed.keys.numberOrder;

console.log('== 1. hand-written arrangement tables vs a machine parse of All8\'s page ==');
console.log(`  fixture: ${Object.keys(parsed.formations).length} formations parsed from ${parsed.source}`);
if (numberOrder.join() !== ARRANGEMENT_NUMBER_ORDER.join()) {
  fail(`column order differs: fixture ${numberOrder.join()} vs module ${ARRANGEMENT_NUMBER_ORDER.join()}`);
}
let checkedCells = 0;
for (const [letter, table] of Object.entries(ARRANGEMENT_TABLES)) {
  const src = parsed.formations[letter];
  if (!src) { fail(`[${letter}] is in the module but was not parsed from the page`); continue; }
  // All8 prints the [S] table twice (two orientations of the same square), so the page holds more
  // rows than the formation has; the arrangements All8 lists are the FIRST table.length of them.
  const rows = src.rows.slice(0, table.length);
  if (rows.length !== table.length) { fail(`[${letter}]: ${table.length} rows vs ${rows.length} on the page`); continue; }
  let bad = 0;
  table.forEach((row, i) => {
    const srcRow = rows[i];
    if (row.facing.replace(/\./g, '') !== srcRow.facing) {
      fail(`[${letter}] row ${i} facing ${row.facing} vs ${srcRow.facing}`);
      bad++;
    }
    // The fixture holds the source's PRINTED tokens (one per occupied spot), and the module's rows
    // carry the empty marker, so the cells are compared on the positions that are NOT holes.
    const srcCells = srcRow.gender;
    row.genders.forEach((g, k) => {
      checkedCells++;
      const mine = [...g].filter((c) => c !== '.').join('');
      if (mine !== srcCells[k]) {
        fail(`[${letter}] row ${i} arrangement ${numberOrder[k]}: ${mine} vs ${srcCells[k]}`);
        bad++;
      }
    });
  });
  if (!bad) ok(`[${letter}] ${table.length} rows x 6 arrangements match the page`);
}
console.log(`  ${checkedCells} gender cells compared`);

// structural self-check: 6 DISTINCT patterns per table, consistent widths
console.log('\n  table structure');
for (const [letter, table] of Object.entries(ARRANGEMENT_TABLES)) {
  const width = table[0].facing.length;
  const patterns = numberOrder.map((_, k) => table.map((r) => r.genders[k]).join('/'));
  const distinct = new Set(patterns).size;
  const badWidth = table.some((r) => r.facing.length !== width || r.genders.some((g) => g.length !== width));
  const badChars = table.some((r) => /[^v^<>. ]/.test(r.facing)) || table.some((r) => r.genders.some((g) => /[^Bg.]/.test(g)));
  // A hole is a HOLE: wherever the facing has the empty marker the gender must too, and vice versa.
  const holeMismatch = table.some((r) => r.genders.some((g) => [...g].some((c, j) => (c === '.') !== (r.facing[j] === '.'))));
  const spots = table.reduce((n, r) => n + [...r.facing].filter((f) => f !== '.').length, 0);
  const counts = table.map((r) => numberOrder.map((_, k) => table.map((rr) => rr.genders[k]).join('').split('').filter((c) => c === 'B').length));
  const balanced = counts.every((row) => row.every((n) => n === spots / 2));
  if (distinct !== 6) fail(`[${letter}] has ${distinct} distinct arrangements, expected 6`);
  if (badWidth) fail(`[${letter}] rows disagree on width`);
  if (badChars) fail(`[${letter}] has characters outside v^<> / Bg / .`);
  if (holeMismatch) fail(`[${letter}] the empty marker is not in the same column in facing and genders`);
  if (!balanced) fail(`[${letter}] an arrangement is not ${spots / 2} boys / ${spots / 2} girls`);
  if (distinct === 6 && !badWidth && !badChars && !holeMismatch && balanced) ok(`[${letter}] 6 distinct, ${table.length}x${width}, ${spots} occupied, all ${spots / 2}B/${spots / 2}g`);
}

// ------------------------------------------- 2. all 6 arrangements round-trip

/** Build a board straight from the table's own frame: column c -> x, row r -> -y. */
function boardFromTable(letter, number) {
  const table = ARRANGEMENT_TABLES[letter];
  const k = ARRANGEMENT_NUMBER_ORDER.indexOf(number);
  const dancers = [];
  table.forEach((row, r) => {
    [...row.facing].forEach((f, c) => {
      const g = row.genders[k][c];
      if (g === '.') return; // a HOLE: the lattice has the spot, the formation does not
      dancers.push({
        id: dancers.length + 1,
        couple: 0,
        gender: g === 'B' ? 'boy' : 'girl',
        x: c,
        y: -r,
        heading: FACING[f] * DEG,
      });
    });
  });
  return { dancers };
}

const rotateBoard = (board, quarterTurns) => ({
  dancers: board.dancers.map((d) => {
    let { x, y } = d;
    for (let i = 0; i < quarterTurns; i++) [x, y] = [-y, x];
    return { ...d, x, y, heading: d.heading + quarterTurns * 90 * DEG };
  }),
});

console.log('\n== 2. every arrangement number round-trips, including rotated ==');
for (const letter of Object.keys(ARRANGEMENT_TABLES)) {
  const results = [];
  for (const number of ARRANGEMENT_NUMBER_ORDER) {
    for (const turns of [0, 1, 2, 3]) {
      const r = arrangementFor(rotateBoard(boardFromTable(letter, number), turns), letter);
      results.push({ number, turns, got: r.number, candidates: r.candidates, reason: r.reason });
    }
  }
  // A board is "read correctly" when its own number is among the readings. For the five full grids
  // that is the same as an exact match; for a RING it is not, because a ring has rotational symmetry
  // the grid does not: a half turn maps two of a squared set's arrangements onto each other
  // (0<->4, 1<->2, 3<->5), so such a board has TWO honest readings and the module reports the pair
  // rather than picking one. The gate is that the source arrangement is one of them.
  const bad = results.filter((r) => r.got !== r.number && !r.candidates.includes(r.number));
  if (bad.length) {
    for (const b of bad.slice(0, 4)) {
      fail(`[${letter}] arrangement ${b.number} rotated ${b.turns * 90}deg -> ${b.got ?? 'null'} (${b.reason ?? ''})`);
    }
    if (bad.length > 4) console.log(`  ... and ${bad.length - 4} more`);
  } else {
    const split = results.filter((r) => r.got !== r.number).length;
    ok(`[${letter}] 6 arrangements x 4 rotations = ${results.length} readings, each naming its own arrangement${split ? ` (${split} by a two-reading pair)` : ''}`);
  }
}

// ---------------------- 2b. reflections never decide, but the mirror map is data

console.log('\n== 2b. reflections never decide - and what mirroring actually maps to ==');
// Reflecting a board is not something dancers can do, so a reflected reading must
// never be the answer. That matters concretely in [B], [P] and [L]: there the
// left-right mirror of arrangement 0 is exactly arrangement 5's gender pattern, so
// allowing reflections would relabel a 0 board as 5. Test 2 above is the gate for
// that (it demands the table-frame board reads back as its own number).
//
// What is checked here instead is the mirror MAP, as a property of the tables: it
// must be a well-defined involution on the 6 numbers. It also shows which tables
// cannot be read at all from a mirrored board, because their facing layout is not
// mirror-invariant - those are the ones whose handedness the table pins down.
for (const letter of Object.keys(ARRANGEMENT_TABLES)) {
  // The image of an arrangement under reflection can be a SET of readings for a ring (see test 2), so
  // the map is recorded as number -> readings and the involution is checked set-wise: every reading of
  // the image must map back to the original number.
  const map = new Map();
  const refused = [];
  for (const number of ARRANGEMENT_NUMBER_ORDER) {
    const plain = boardFromTable(letter, number);
    const mirrored = { dancers: plain.dancers.map((d) => ({ ...d, x: -d.x, heading: Math.PI - d.heading })) };
    const r = arrangementFor(mirrored, letter);
    if (r.number === null && !r.candidates.length) { refused.push(number); continue; }
    map.set(number, r.number !== null ? [r.number] : r.candidates);
  }
  const pairs = [...map.entries()].map(([a, b]) => `${a}->${b.join('|')}`);
  // Involution, set-wise: starting from a, every reading of its image must lead back to a.
  const image = (n) => map.get(n) ?? [];
  const involution = [...map.keys()].every((a) =>
    image(a).every((b) => image(b).some((c) => c === a || image(c).includes(a))));
  if (!involution) fail(`[${letter}] mirror map is not an involution: ${pairs.join(' ')}`);
  else if (refused.length === ARRANGEMENT_NUMBER_ORDER.length) {
    ok(`[${letter}] every mirrored board refused: the table's facing layout is not mirror-invariant, so handedness is pinned`);
  } else {
    ok(`[${letter}] mirror map ${pairs.join(' ')} (involution)${refused.length ? `, refused ${refused.join(',')}` : ''}`);
  }
}
console.log('  (0->5 is the half-sashay complement: the reason a reflection must never be allowed to decide.)');

// --------------------------------------------- 3. the engine's own templates

const assets = path.join(root, 'assets');
const levels = ['discovered', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
const calls = [];
for (const lv of levels) {
  const dir = path.join(assets, lv);
  if (!existsSync(dir)) continue;
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    calls.push({ name: f.replace(/\.xml$/, ''), xml: readFileSync(path.join(dir, f), 'utf8') });
  }
}
const seq = new Sequencer(read(path.join('assets/moves.xml')), read(path.join('assets/formations.xml')), calls);

console.log('\n== 3. engine templates classify as arrangement 0 ==');
const TEMPLATES = [
  ['Eight Chain Thru', 'B'],
  ['Double Pass Thru', 'P'],
  ['Normal Lines', 'L'],
  ['Ocean Waves', 'W'],
  ['Two-Faced Lines', 'F'],
  ['Two-Faced Lines LH', 'L.F'],
];
for (const [name, letter] of TEMPLATES) {
  const board = seq.boardForFormation(name);
  if (!board) { fail(`${name}: no template board`); continue; }
  const r = arrangementFor(board, letter);
  if (r.number === 0) ok(`${name.padEnd(20)} -> [0${letter}]`);
  else fail(`${name} -> [${r.number ?? 'null'}${letter}] (${r.reason ?? ''}); candidates ${r.candidates.join(',') || 'none'}`);
}
console.log('  (the templates are NOT stored in All8\'s drawing orientation, so this is a real rotation search)');

// ------------------------------------------------------------- 4. sequence

const home = { dancers: HOME_DANCERS.map((d) => ({ ...d })) };

/** Relabel each gender's couples, positionally in C.C.W. order from couple 1. */
function relabel(board, boyCycle, girlCycle) {
  const cx = board.dancers.reduce((s, d) => s + d.x, 0) / board.dancers.length;
  const cy = board.dancers.reduce((s, d) => s + d.y, 0) / board.dancers.length;
  const idOf = new Map();
  for (const d of HOME_DANCERS) idOf.set(`${d.gender}${d.couple}`, d.id);
  const out = board.dancers.map((d) => ({ ...d }));
  for (const [gender, cycle] of [['boy', boyCycle], ['girl', girlCycle]]) {
    if (!cycle) continue;
    const list = out.filter((d) => d.gender === gender)
      .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    const start = list.findIndex((d) => d.couple === 1);
    list.forEach((d, i) => {
      const c = cycle[(i - start + 4) % 4];
      d.couple = c;
      d.id = idOf.get(`${gender}${c}`);
    });
  }
  return { dancers: out };
}

console.log('\n== 4. sequence ==');
const homeSeq = sequenceFor(home);
if (homeSeq.code === 1) ok(`home squared set -> sequence 1 (boys ${homeSeq.boys.join('')}, girls ${homeSeq.girls.join('')})`);
else fail(`home squared set -> sequence ${homeSeq.code} (${homeSeq.reason ?? ''})`);
console.log(`  ring order derived from HOME_DANCERS: [${HOME_RING_ORDER.join(', ')}]`);

const SEQ_CASES = [
  { name: 'both in  ', boys: [1, 2, 3, 4], girls: [1, 2, 3, 4], want: 1 },
  { name: 'both out ', boys: [1, 4, 3, 2], girls: [1, 4, 3, 2], want: 2 },
  { name: 'boys in  ', boys: [1, 2, 3, 4], girls: [1, 4, 3, 2], want: 3 },
  { name: 'girls in ', boys: [1, 4, 3, 2], girls: [1, 2, 3, 4], want: 4 },
  { name: 'asym boy ', boys: [1, 3, 2, 4], girls: [1, 2, 3, 4], want: null },
];
for (const c of SEQ_CASES) {
  const r = sequenceFor(relabel(home, c.boys, c.girls));
  const label = `boys ${c.boys.join('')} girls ${c.girls.join('')}`;
  if (r.code === c.want) ok(`${c.name} ${label} -> sequence ${r.code ?? 'none'} (asymmetric is correct here)`.replace(' (asymmetric is correct here)', c.want === null ? ' (asymmetric, as intended)' : ''));
  else fail(`${c.name} ${label} -> ${r.code ?? 'null'}, expected ${c.want} (${r.reason ?? ''})`);
}
const noIdentity = sequenceFor(boardFromTable('B', 0));
if (noIdentity.code === null) ok('a gender-only board reports no sequence rather than guessing');
else fail(`a board with no identity reported sequence ${noIdentity.code}`);

// --------------------------------------------------------- 5. relationship

console.log('\n== 5. relationship letters ==');
const LETTERS = { 0: 'p', 1: 'r', 2: 'o', 3: 'c' };
let relBad = 0;
for (let b = 1; b <= 4; b++) {
  for (let g = 1; g <= 4; g++) {
    const want = LETTERS[(((g - b) % 4) + 4) % 4];
    const got = relationshipCode(b, g);
    if (got !== want) { fail(`boy of couple ${b} with girl of couple ${g} -> ${got}, expected ${want}`); relBad++; }
  }
}
if (!relBad) ok('all 16 boy/girl couple combinations follow the ring-offset model');

// The home square: All8's own worked example is that in a circle formed from the
// squared set "each boy has his partner girl to his right". So for the #1 boy the
// partner is on his right, and the girl on his left is his corner.
const homeByCouple = new Map();
for (const d of home.dancers) homeByCouple.set(`${d.gender}${d.couple}`, d);
const b1 = homeByCouple.get('boy1');
const facing = ((Math.round((b1.heading / DEG) % 360) + 360) % 360);
const leftOf = (f) => ((f + 90) % 360);
const rightOf = (f) => ((f + 270) % 360);
const sideOf = (boy, girl) => {
  const f = ((Math.round((boy.heading / DEG) % 360) + 360) % 360);
  const a = ((Math.round((Math.atan2(girl.y - boy.y, girl.x - boy.x) / DEG) % 360) + 360) % 360);
  const norm = (x) => ((x % 360) + 360) % 360;
  return { left: norm(a - leftOf(f)), right: norm(a - rightOf(f)) };
};
const partner = homeByCouple.get('girl1');
const cornerGirl = homeByCouple.get('girl4');
const rightGirl = homeByCouple.get('girl2');
const sP = sideOf(b1, partner);
const sC = sideOf(b1, cornerGirl);
const sR = sideOf(b1, rightGirl);
const near = (s) => Math.min(s.left, s.right, 360 - s.left, 360 - s.right) < 45;
console.log(`  #1 boy at (${b1.x}, ${b1.y}) facing ${facing}deg:`);
console.log(`      girl of couple 1 (partner)  is ${near(sP) ? (sP.left < sP.right ? 'LEFT' : 'RIGHT') : 'not beside him'}  -> relationshipCode says ${relationshipCode(1, 1)}`);
console.log(`      girl of couple 4            is ${near(sC) ? (sC.left < sC.right ? 'LEFT' : 'RIGHT') : 'not beside him'}  -> relationshipCode says ${relationshipCode(1, 4)}`);
console.log(`      girl of couple 2            is ${near(sR) ? (sR.left < sR.right ? 'LEFT' : 'RIGHT') : 'not beside him'}  -> relationshipCode says ${relationshipCode(1, 2)}`);
const partnerOnRight = near(sP) && sP.right < sP.left;
if (partnerOnRight) ok('the #1 boy\'s partner is on his RIGHT, matching All8\'s circle-from-a-squared-set example');
else fail('the #1 boy\'s partner is not on his right - the home geometry disagrees with All8');
if (relationshipCode(1, 1) === 'p' && relationshipCode(1, 2) === 'r' && relationshipCode(1, 3) === 'o' && relationshipCode(1, 4) === 'c') {
  ok('partner -> p, next couple counter-clockwise -> r, opposite -> o, previous couple -> c');
} else fail('relationship letters do not match the documented offsets');

// ------------------------------------------- 6. All8's published 16 states

const S16 = path.join(__dirname, 'fixtures', 'all8-16-states.json');
console.log('\n== 6. All8\'s published 16-state tables ==');
if (!existsSync(S16)) { fail('no all8-16-states.json fixture'); } else {
  const s16 = JSON.parse(readFileSync(S16, 'utf8'));
  for (const [letter, entry] of Object.entries(s16.formations)) {
    const ids = entry.states.map((s) => s.id);
    const combos = new Set(entry.states.map((s) => `${s.sequence}${s.relationship}`));
    const arrangements = new Set(entry.states.map((s) => s.arrangement));
    const problems = [];
    if (entry.states.length !== 16) problems.push(`${entry.states.length} states`);
    if (combos.size !== 16) problems.push(`${combos.size} distinct sequence/relationship combos`);
    if (new Set(ids).size !== ids.length) problems.push('duplicate labels');
    if (arrangements.size !== 1 || !arrangements.has('0')) problems.push(`arrangements ${[...arrangements].join(',')} (expected standard only)`);
    if (problems.length) fail(`[${letter}] ${problems.join('; ')}`);
    else ok(`[${letter}] 16 distinct states = all 4 sequences x 4 relationships, arrangement 0`);
  }
  const hints = Object.values(s16.formations).flatMap((f) => f.states.filter((s) => s.hint));
  console.log(`  ${hints.length} states carry a resolve hint, e.g. ${hints.slice(0, 4).map((s) => `[${s.id}] ${s.hint}`).join(', ')}`);
}

// -------------------------------------------------- 7. findings, not gates

console.log('\n== 7. findings ==');

// 7a. the engine's own FASR corner vs Callerlab's.
const fasr = analyzeFasr(home, 'Squared Set');
let cornerAgree = 0, cornerTotal = 0;
const cornerDetail = [];
for (const boy of home.dancers.filter((d) => d.gender === 'boy')) {
  const wantGirlCouple = (((boy.couple - 2) % 4) + 4) % 4 + 1; // offset +3 = corner
  const want = home.dancers.find((d) => d.gender === 'girl' && d.couple === wantGirlCouple);
  const got = home.dancers.find((d) => d.id === fasr.relationship[boy.id]?.corner);
  cornerTotal++;
  if (got && want && got.id === want.id) cornerAgree++;
  else cornerDetail.push(`couple ${boy.couple} boy: engine says ${got ? `couple ${got.couple}` : 'none'}, corner is couple ${wantGirlCouple}`);
}
console.log(`  analyzeFasr() corner vs Callerlab corner on the home square: ${cornerAgree}/${cornerTotal} agree`);
for (const d of cornerDetail) console.log(`      ${d}`);
console.log('  FIXED (Phase 5): analyzeFasr() now derives the corner from HOME COUPLE IDENTITY by the same');
console.log('  ring offset relationshipCode() uses (+3 = corner), instead of the fixed +45deg angular offset');
console.log('  it used before. Measured on the home square, all eight dancers: the opposite-gender dancer');
console.log('  geometrically on a dancer LEFT is ALWAYS the one at ring offset +3, boys and girls alike.');
console.log('  The old bearing method landed on the next ring position - the girl on his right - for all');
console.log('  four boys (0/4, which is what this line used to report) and happened to be right for all');
console.log('  four girls, which is why it survived: half the dancers agreed.');
// ...and it is a GATE now, for both genders, because a wrong corner is not cosmetic: fasrKey is
// built from it, and that backs isZero and the solver's Static Square check.
{
  let agree = 0, n = 0;
  for (const d of home.dancers) {
    const wantCouple = ((d.couple - 1 + 3) % 4) + 1; // +3 = corner, same rule for both genders
    const want = home.dancers.find((o) => o.gender !== d.gender && o.couple === wantCouple);
    const got = home.dancers.find((o) => o.id === fasr.relationship[d.id]?.corner);
    n++;
    if (got && want && got.id === want.id) agree++;
    else fail(`${d.gender} of couple ${d.couple}: corner is the ${want?.gender} of couple ${wantCouple}, engine says ${got ? `couple ${got.couple}` : 'none'}`);
  }
  if (agree === n) ok(`analyzeFasr corner: ALL ${n} dancers agree with the home ring (+3), both genders`);
}
// A dancer with no known home couple has NO corner: identity is data, so a relation between two
// dancers with no known identity is not a fact we have (square-dancing.md §8.2).
{
  const anon = { dancers: home.dancers.map((d) => ({ ...d, couple: 0 })) };
  const f = analyzeFasr(anon, null);
  const corners = Object.values(f.relationship).filter((r) => r.corner !== null).length;
  if (corners !== 0) fail(`a board with no known couples reported ${corners} corners; it must report none`);
  else ok('a board with no known home couples reports no corners (identity is data)');
}

// 7b. what would settle the corner/right-hand naming for good.
console.log('\n  7b. All8 publishes both halves of a cross-check:');
console.log('      [0B1c] has resolve hint "AL" (allemande left works straight away) and the get-out');
console.log('      fixture gives [0B1p] the get-out "Pass Thru > Allemande Left". So Pass Thru from a');
console.log('      [B1p] board must land on c, not r. Reproducing that needs a constructed board in a');
console.log('      named alignment - step 3 - and will confirm or refute the corner/right assignment.');

// 7c. what the classifier refuses to answer.
const homeAl = alignmentOf(home, 'Squared Set');
console.log(`\n  7c. alignmentOf(home, 'Squared Set') -> ${homeAl.notation}`);
console.log(`      arrangement: ${homeAl.arrangement ?? 'unknown'} (${homeAl.arrangementResult?.reason ?? 'read from the [S] table'})`);
console.log(`      relationship: ${homeAl.relationshipReason}`);
const b = seq.boardForFormation('Eight Chain Thru');
const bAl = alignmentOf(b, 'Eight Chain Thru');
console.log(`      alignmentOf(Eight Chain Thru template) -> ${bAl.notation}`);
console.log(`      arrangement ${bAl.arrangement}, sequence: ${bAl.sequenceResult.reason}`);
console.log(`      relationship: ${bAl.relationshipReason}`);
console.log('      Home now reads [0S1?]: the letter is all8\'s, the arrangement is the [S] table\'s and');
console.log('      the sequence is the home board\'s own. The relationship stays unknown because Callerlab');
console.log('      defines a reference pair for [L] [B] [F] [W] only, and the templates carry no identity.');

// 8. [P] (Beginning Double Pass Thru): the reference pair and the relationship rule it needs.
//
// Callerlab agrees a reference pair for [L] [B] [F] [W] only, and [P] is the formation where a fixed
// pair cannot pick a letter at all. All8 supplies the missing half itself (16com_p.htm): "mentally
// have the Centers Pass Thru then evaluate relationship in the resulting [0B] Eight Chain Thru
// Formation". This gate reads All8's four published [P] diagrams out of the get-out fixture - the
// same ground truth `alignment-boards.mjs` rebuilds everything else from - and pins both halves.
// (The call-level half, that the reduction IS the catalogue's own Centers Pass Thru and lands on the
// conversion All8 publishes beside each diagram, is gated in `alignment-boards.mjs`, which has the
// call catalogue loaded.)
{
  const getouts = JSON.parse(read('engine/test/fixtures/all8-getouts.json'));
  const pTemplate = seq.boardForFormation('Double Pass Thru');
  const wantCell = REFERENCE_PAIR_SPOTS.P[0];
  let letters = 0, cells = 0, boards = 0;
  for (const a of getouts.alignments.filter((x) => /^P[1-4][pocr]$/.test(x.id ?? ''))) {
    const spec = { arrangement: 0, letter: 'P', sequence: Number(a.id[1]), relationship: a.id[2] };
    const built = boardFromDiagram(pTemplate, 'P', spec.arrangement, a.diagram);
    if (!built.board) { fail(`[${a.id}]: ${built.reason}`); continue; }
    boards++;
    const rel = relationshipStateOf(built.board, 'P');
    if (rel.code === spec.relationship) letters++;
    else fail(`[${a.id}] reads relationship '${rel.code ?? 'none'}', All8 publishes '${spec.relationship}'`);
    const layout = readLayout(built.board, 'P');
    let cell = null;
    layout?.cells.forEach((row, r) => row.forEach((d, c) => { if (d && d.id === rel.reference?.boy) cell = [r, c]; }));
    if (cell && cell[0] === wantCell[0] && cell[1] === wantCell[1]) cells++;
    else fail(`[${a.id}] reference pair is at ${cell ? `(${cell})` : 'no cell'}, not the recorded (row ${wantCell[0]}, col ${wantCell[1]})`);
  }
  if (boards && letters === boards) ok(`[P] relationship: All8's published letter reproduced on all ${boards} published alignments`);
  if (boards && cells === boards) ok(`[P] reference pair: the same drawing cell on all ${cells}, and it is the pair fasrooOf reads Orientation from`);
  // The reduction is a PASS THRU, so applying it twice is the identity - a property, not a reading.
  const own = centresPassThru(pTemplate);
  const twice = own.board ? centresPassThru(own.board) : null;
  const involutive = own.board && twice?.board
    && pTemplate.dancers.every((d) => {
      const o = twice.board.dancers.find((x) => x.id === d.id);
      return o && Math.abs(o.x - d.x) < 1e-9 && Math.abs(o.y - d.y) < 1e-9;
    });
  if (involutive) ok('[P] the mental Centers Pass Thru is a pass thru: applying it twice restores the board');
  else fail('[P] the mental Centers Pass Thru is not an involution, so it is not a pass thru');
}

// 9. ORIENTATION, against the only two places All8 publishes the letter with a picture.
//
// (a) All8's worked pair - `[0P1cH+]` and `[0P1cH']` are the SAME board with the couples shifted, and
//     All8 labels BOTH "H", differing only in Occupation. This is the witness the orientation
//     construction was blocked on, and it is stated in the labels themselves.
// (b) All8's four `[0B]` orientation diagrams put the reference boy south-west / north-east /
//     north-west / south-east and label them H / O / L / R. That is the rule: the CLOCKWISE
//     90-degree step from his home side to the side of his own drawing he now occupies.
//
// The construction reads that step in the formation's arrangement TABLE - All8's own drawing frame,
// whose facing layout is exactly what those diagrams are drawn on - rather than from the board's
// coordinates, which for a LINE are not a rotation of home at all.
{
  const getouts = JSON.parse(read('engine/test/fixtures/all8-getouts.json'));
  const p1c = getouts.alignments.find((a) => a.id === 'P1c');
  const built = boardFromDiagram(seq.boardForFormation('Double Pass Thru'), 'P', 0, p1c.diagram);
  const H = built.board ? fasrooOf(built.board, 'Double Pass Thru') : null;
  const Hp = built.board ? fasrooOf(relabelCouples(built.board, 1), 'Double Pass Thru') : null;
  if (H?.orientation?.code === 'H' && H.occupation === '+') ok('[P] orientation: All8\'s `[0P1cH+]` reads H with occupation +');
  else fail(`[P] All8 publishes \`[0P1cH+]\`; the engine reads ${H?.orientation?.code ?? '?'} with occupation ${H?.occupation ?? '?'}`);
  if (Hp?.orientation?.code === 'H' && Hp.occupation === "'") ok('[P] orientation: All8\'s `[0P1cH\']` - the same board, couples shifted - also reads H, with occupation \'');
  else fail(`[P] All8 publishes \`[0P1cH']\`; the engine reads ${Hp?.orientation?.code ?? '?'} with occupation ${Hp?.occupation ?? '?'}`);

  // (c) the four boards a code admits must be told apart: a code names a class, and FASROO is what
  // sorts it. All five formations All8 defines a reference pair for - and which the repo has now
  // pinned to spots, [W] and [F] from All8's own reference-pair diagram - must resolve four distinct
  // codes. `[L.F]` (Two-Faced Lines LH) is the exception and is refused outright: Callerlab agrees the
  // pair for the four standard-arrangement formations only, and the left-handed variant is not one.
  let distinctOk = 0, checked = 0;
  for (const [letter, formation] of [['B', 'Eight Chain Thru'], ['L', 'Normal Lines'], ['P', 'Double Pass Thru'], ['F', 'Two-Faced Lines'], ['W', 'Ocean Waves']]) {
    const template = seq.boardForFormation(formation);
    if (!template) continue;
    for (const sequence of [1, 2, 3, 4]) {
      for (const relationship of ['p', 'o', 'c', 'r']) {
        const boards = boardsForAlignment(template, { letter, arrangement: 0, sequence, relationship }).boards;
        if (!boards.length) continue;
        checked++;
        const notations = boards.map((b) => fasrooOf(b, formation).notation);
        const distinct = new Set(notations).size;
        if (distinct === boards.length) distinctOk++;
        else fail(`[${letter}${sequence}${relationship}] ${boards.length} boards resolve to only ${distinct} FASROO code(s): ${notations.join(' ')}`);
      }
    }
  }
  if (checked && distinctOk === checked) ok(`all five formations with an agreed reference pair resolve their boards to distinct FASROO codes (${distinctOk}/${checked})`);
  const handed = fasrooOf(seq.boardForFormation('Two-Faced Lines LH'), 'Two-Faced Lines LH');
  if (handed.orientation === null && handed.reason?.includes('reference pair')) ok(`[L.F] is refused a reference pair rather than guessed (Callerlab agrees one for the four standard formations only)`);
  else fail(`[L.F] was given ${handed.notation} instead of being refused`);

  // (d) IDENTITY IS DATA: a synthesised board carries no home couple, so it must NOT be given an
  // orientation read off its (arbitrary) ids - it has to say why instead.
  const synthesised = fasrooOf(seq.boardForFormation('Double Pass Thru'), 'Double Pass Thru');
  if (synthesised.orientation === null && synthesised.reason) ok(`a board with no identity is refused an orientation, with its reason: "${synthesised.reason.slice(0, 60)}..."`);
  else fail(`a synthesised board was given orientation ${synthesised.orientation?.code ?? 'null'} instead of being refused`);
}

console.log('\n=================');
console.log(failures === 0
  ? 'ALIGNMENT: all gates passed.'
  : `ALIGNMENT: ${failures} gate(s) FAILED.`);
if (failures) process.exitCode = 1;
