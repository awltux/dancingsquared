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
  if (src.rows.length !== table.length) { fail(`[${letter}]: ${table.length} rows vs ${src.rows.length} on the page`); continue; }
  let bad = 0;
  table.forEach((row, i) => {
    if (row.facing !== src.rows[i].facing) { fail(`[${letter}] row ${i} facing ${row.facing} vs ${src.rows[i].facing}`); bad++; }
    row.genders.forEach((g, k) => {
      checkedCells++;
      if (g !== src.rows[i].gender[k]) {
        fail(`[${letter}] row ${i} arrangement ${numberOrder[k]}: ${g} vs ${src.rows[i].gender[k]}`);
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
  const badChars = table.some((r) => /[^v^<>]/.test(r.facing)) || table.some((r) => r.genders.some((g) => /[^Bg]/.test(g)));
  const counts = table.map((r) => numberOrder.map((_, k) => table.map((rr) => rr.genders[k]).join('').split('').filter((c) => c === 'B').length));
  const balanced = counts.every((row) => row.every((n) => n === table.length * width / 2));
  if (distinct !== 6) fail(`[${letter}] has ${distinct} distinct arrangements, expected 6`);
  if (badWidth) fail(`[${letter}] rows disagree on width`);
  if (badChars) fail(`[${letter}] has characters outside v^<> / Bg`);
  if (!balanced) fail(`[${letter}] an arrangement is not 4 boys / 4 girls`);
  if (distinct === 6 && !badWidth && !badChars && balanced) ok(`[${letter}] 6 distinct, ${table.length}x${width}, all 4B/4g`);
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
      results.push({ number, turns, got: r.number, reason: r.reason });
    }
  }
  const bad = results.filter((r) => r.got !== r.number);
  if (bad.length) {
    for (const b of bad.slice(0, 4)) {
      fail(`[${letter}] arrangement ${b.number} rotated ${b.turns * 90}deg -> ${b.got ?? 'null'} (${b.reason ?? ''})`);
    }
    if (bad.length > 4) console.log(`  ... and ${bad.length - 4} more`);
  } else {
    ok(`[${letter}] 6 arrangements x 4 rotations = ${results.length} readings, all correct`);
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
  const map = new Map();
  const refused = [];
  let ambiguous = false;
  for (const number of ARRANGEMENT_NUMBER_ORDER) {
    const plain = boardFromTable(letter, number);
    const mirrored = { dancers: plain.dancers.map((d) => ({ ...d, x: -d.x, heading: Math.PI - d.heading })) };
    const r = arrangementFor(mirrored, letter);
    if (r.number === null) { refused.push(number); continue; }
    if (!map.has(number)) map.set(number, r.number);
    else if (map.get(number) !== r.number) ambiguous = true;
  }
  if (ambiguous) { fail(`[${letter}] mirror map is not a function (same arrangement mirrors to two numbers)`); continue; }
  const pairs = [...map.entries()].map(([a, b]) => `${a}->${b}`);
  const involution = [...map.entries()].every(([a, b]) => map.get(b) === a);
  if (!involution) fail(`[${letter}] mirror map is not an involution: ${pairs.join(' ')}`);
  else if (refused.length === ARRANGEMENT_NUMBER_ORDER.length) {
    ok(`[${letter}] every mirrored board refused: the table's facing layout is not mirror-invariant, so handedness is pinned`);
  } else {
    ok(`[${letter}] mirror map ${pairs.join(' ')} (involution)${refused.length ? `, refused ${refused.join(',')}` : ''}`);
  }
}
console.log('  (0->5 is the half-sashay complement: the reason a reflection must never be allowed to decide.)');

// --------------------------------------------- 3. the engine's own templates

const assets = path.join(root, 'poc/src/assets');
const levels = ['discovered', 'b1', 'b2', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
const calls = [];
for (const lv of levels) {
  const dir = path.join(assets, lv);
  if (!existsSync(dir)) continue;
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    calls.push({ name: f.replace(/\.xml$/, ''), xml: readFileSync(path.join(dir, f), 'utf8') });
  }
}
const seq = new Sequencer(read(path.join('poc/src/assets/moves.xml')), read(path.join('poc/src/assets/formations.xml')), calls);

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
console.log('  (relationshipCode() derives the corner from the home ring; analyzeFasr() uses a fixed +45deg');
console.log('   angular offset, which in a squared set lands on the next ring position - the girl on his right -');
console.log('   and, once the partner is excluded, falls through to the opposite girl.)');

// 7b. what would settle the corner/right-hand naming for good.
console.log('\n  7b. All8 publishes both halves of a cross-check:');
console.log('      [0B1c] has resolve hint "AL" (allemande left works straight away) and the get-out');
console.log('      fixture gives [0B1p] the get-out "Pass Thru > Allemande Left". So Pass Thru from a');
console.log('      [B1p] board must land on c, not r. Reproducing that needs a constructed board in a');
console.log('      named alignment - step 3 - and will confirm or refute the corner/right assignment.');

// 7c. what the classifier refuses to answer.
const unknownLetter = alignmentOf(home, 'Squared Set');
console.log(`\n  7c. alignmentOf(home, 'Squared Set') -> ${unknownLetter.notation}`);
console.log(`      arrangement: ${unknownLetter.arrangementResult ? 'no table for [S]' : 'n/a'}; relationship: ${unknownLetter.relationshipReason}`);
const b = seq.boardForFormation('Eight Chain Thru');
const bAl = alignmentOf(b, 'Eight Chain Thru');
console.log(`      alignmentOf(Eight Chain Thru template) -> ${bAl.notation}`);
console.log(`      arrangement ${bAl.arrangement}, sequence: ${bAl.sequenceResult.reason}`);
console.log(`      relationship: ${bAl.relationshipReason}`);
console.log('      Both refusals are deliberate: [S] has no Callerlab arrangement, and templates carry no identity.');

console.log('\n=================');
console.log(failures === 0
  ? 'ALIGNMENT: all gates passed.'
  : `ALIGNMENT: ${failures} gate(s) FAILED.`);
if (failures) process.exitCode = 1;
