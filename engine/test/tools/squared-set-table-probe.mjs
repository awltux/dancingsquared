// STEP 2 PROBE: the [S] arrangement table in the MODULE, checked cell for cell against the engine's
// own home square and against the source page's printed columns.
//
// The transcription's two anchors are independent, which is why this is a check rather than a taste:
//
//   1. the GENDERS come from All8's printed token stream (6 arrangements x 2 letters per Side row, 1
//      per Head row - squared-set-source-probe.mjs prints it), and
//   2. arrangement 0 must BE the home arrangement, and the engine's home square's occupied lattice is
//      known (`.gB. / B..g / g..B / .Bg.` with facings `.vv. / >..< / >..< / .^^.`).
//
// The row ORDER and the CELL COLUMNS are forced by (2): the home square projects onto those rows, and
// the module's arrangement lookup compares the facing layout exactly, so a table stated the other way
// round simply refuses the home board. squared-set-readout-probe.mjs is the end-to-end check that it
// does not; this one checks the table's cells and its own invariants.
//
// Usage: node engine/test/tools/squared-set-table-probe.mjs

import { ARRANGEMENT_TABLES, ARRANGEMENT_NUMBER_ORDER, EMPTY_CELL, arrangementFor } from '../../dist/index.js';

const HOME = ['.gB.', 'B..g', 'g..B', '.Bg.'];
const HOME_FACING = ['.vv.', '>..<', '>..<', '.^^.'];
const FACING = { '>': 0, '^': 90, '<': 180, v: 270 };
const DEG = Math.PI / 180;

let failures = 0;
const fail = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const ok = (m) => console.log(`  ok    ${m}`);

const table = ARRANGEMENT_TABLES.S;
console.log(`=== the module's [S] table: ${table?.length} rows ===`);
if (!table) { console.log('  FAIL  no [S] table in ARRANGEMENT_TABLES'); process.exit(1); }
table.forEach((r, i) => console.log(`  row ${i} facing ${r.facing}  genders ${r.genders.join(' ')}`));

console.log('\n=== arrangement 0 is the engine home square ===');
table.forEach((row, i) => {
  if (row.facing !== HOME_FACING[i]) fail(`row ${i} facing ${row.facing} vs home square ${HOME_FACING[i]}`);
  if (row.genders[0] !== HOME[i]) fail(`row ${i} arrangement 0 gender ${row.genders[0]} vs home square ${HOME[i]}`);
});
if (!failures) ok('every row\'s arrangement-0 gender and facing equals the home square\'s own row');

console.log('\n=== the table\'s invariants ===');
const width = table[0].facing.length;
const occupied = table.reduce((n, r) => n + [...r.facing].filter((f) => f !== EMPTY_CELL).length, 0);
console.log(`  ${table.length} rows x ${width} columns, ${occupied} occupied spots`);
if (occupied !== 8) fail(`expected 8 occupied spots, found ${occupied}`);
table.forEach((r, i) => {
  if (r.facing.length !== width) fail(`row ${i} facing width ${r.facing.length}`);
  r.genders.forEach((g, k) => {
    if (g.length !== width) fail(`row ${i} arrangement ${ARRANGEMENT_NUMBER_ORDER[k]}: width ${g.length}`);
    [...g].forEach((c, j) => {
      if ((r.facing[j] === EMPTY_CELL) !== (c === EMPTY_CELL)) fail(`row ${i} arrangement ${ARRANGEMENT_NUMBER_ORDER[k]} col ${j}: the hole is not in the same column in facing and genders`);
    });
  });
});
const patterns = ARRANGEMENT_NUMBER_ORDER.map((_, k) => table.map((r) => r.genders[k]).join('/'));
console.log(`  distinct arrangements: ${new Set(patterns).size} of 6`);
if (new Set(patterns).size !== 6) fail('the 6 arrangements are not distinct');
ARRANGEMENT_NUMBER_ORDER.forEach((number, k) => {
  const boys = patterns[k].split('').filter((c) => c === 'B').length;
  const girls = patterns[k].split('').filter((c) => c === 'g').length;
  console.log(`    [${number}S] ${patterns[k]}  boys ${boys} girls ${girls}`);
  if (boys !== 4 || girls !== 4) fail(`[${number}S] is not 4 boys / 4 girls`);
});

console.log('\n=== every arrangement round-trips through the module ===');
const boardFromTable = (number) => {
  const k = ARRANGEMENT_NUMBER_ORDER.indexOf(number);
  const dancers = [];
  table.forEach((row, r) => {
    [...row.facing].forEach((f, c) => {
      const g = row.genders[k][c];
      if (g === EMPTY_CELL) return;
      dancers.push({ id: dancers.length + 1, couple: 0, gender: g === 'B' ? 'boy' : 'girl', x: c, y: -r, heading: FACING[f] * DEG });
    });
  });
  return { dancers };
};
for (const number of ARRANGEMENT_NUMBER_ORDER) {
  const r = arrangementFor(boardFromTable(number), 'S');
  const named = r.number === number || r.candidates.includes(number);
  console.log(`  [${number}S] -> ${r.number ?? 'null'} candidates [${r.candidates.join(',')}]${named ? '' : '  <-- WRONG'}`);
  if (!named) {
    // 0<->4 and 1<->2 and 3<->5 are the half-turn pairs of a ring, which is a property of the shape;
    // anything else is a real failure.
    const pair = { 0: 4, 4: 0, 1: 2, 2: 1, 3: 5, 5: 3 }[number];
    if (!r.candidates.includes(pair)) fail(`[${number}S] does not read back`);
  }
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
