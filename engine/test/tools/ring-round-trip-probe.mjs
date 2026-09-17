// STEP 1 PROBE: rings must be representable, and nothing already representable may move.
//
// Part A is the behaviour freeze: every formation the module already has a table for is built from
// that table (all 6 arrangements) and read back through `arrangementFor` at all 4 rotations, and the
// reading must be identical to what the table says. This is the same 24-reading round trip
// `test/alignment.mjs` runs, repeated here so the guard change can be judged on its own.
//
// Part B is the new capability, measured on the SHAPE rather than on a transcribed table: a squared
// set (4x4 lattice, 8 occupied, middle of every row and column empty - exactly what the guard used to
// refuse; see ring-representability-probe.mjs) and a diamond (3x3, 4 occupied). A table with holes is
// injected for the duration of the probe, so what is exercised is the real `toGrid` / `projectCells`
// path a transcribed [S] table will use in the next step. Nothing is written to the source.
//
// Usage: node engine/test/tools/ring-round-trip-probe.mjs

import {
  ARRANGEMENT_TABLES,
  ARRANGEMENT_NUMBER_ORDER,
  arrangementFor,
  readLayout,
} from '../../dist/index.js';

const FACING = { '>': 0, '^': 90, '<': 180, v: 270 };
const DEG = Math.PI / 180;
let failures = 0;
const fail = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const ok = (m) => console.log(`  ok    ${m}`);

/** Build a board straight from a table's own frame: column c -> x, row r -> -y. */
function boardFromTable(letter, number) {
  const table = ARRANGEMENT_TABLES[letter];
  const k = ARRANGEMENT_NUMBER_ORDER.indexOf(number);
  const dancers = [];
  table.forEach((row, r) => {
    [...row.facing].forEach((f, c) => {
      const g = row.genders[k][c];
      if (g === '.') return; // a hole carries no dancer
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

console.log('== A. behaviour freeze: every mapped formation, 6 arrangements x 4 rotations ==');
let readings = 0;
for (const letter of Object.keys(ARRANGEMENT_TABLES)) {
  const table = ARRANGEMENT_TABLES[letter];
  const bad = [];
  for (const number of ARRANGEMENT_NUMBER_ORDER) {
    for (const turns of [0, 1, 2, 3]) {
      readings++;
      const r = arrangementFor(rotateBoard(boardFromTable(letter, number), turns), letter);
      if (r.number !== number) bad.push(`${number}@${turns * 90}deg -> ${r.number ?? 'null'} (${r.reason ?? ''})`);
    }
  }
  if (bad.length) fail(`[${letter}] ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? ` (+${bad.length - 3})` : ''}`);
  else ok(`[${letter}] ${table.length} rows, all ${ARRANGEMENT_NUMBER_ORDER.length * 4} readings correct`);
}
console.log(`  ${readings} readings compared against the tables`);

console.log('\n== B. a ring now projects, and its holes land where the table says ==');
// TEMPORARY table, injected for the probe only; the source tables are untouched. The [S] facade is
// not a claim about All8's [S] spelling - it is the SHAPE (4x4 with the middle of each row/column
// empty) that Step 1 has to make representable. Step 2 transcribes the real table from all8.
const SQUARED_FACING = ['.vv.', '>..<', '>..<', '.^^.'];
const SQUARED_HOME = ['.gB.', 'B..g', 'g..B', '.Bg.'];
/** Put the home pattern in the requested arrangement column, holes staying holes. */
const squaredGenders = (k) => (k === 0
  ? SQUARED_HOME
  : SQUARED_FACING.map((f, r) => [...f].map((ch, c) => (ch === '.' ? '.' : SQUARED_HOME[r][c] === 'B' ? 'g' : 'B')).join('')));
const SQUARED = SQUARED_FACING.map((f) => ({ facing: f, genders: ARRANGEMENT_NUMBER_ORDER.map((_, k) => squaredGenders(k)[SQUARED_FACING.indexOf(f)]) }));

const hadS = Object.prototype.hasOwnProperty.call(ARRANGEMENT_TABLES, 'PROBE_S');
ARRANGEMENT_TABLES.PROBE_S = SQUARED;
try {
  const board = boardFromTable('PROBE_S', 0);
  console.log(`  squared set built from the table: ${board.dancers.length} dancers on a 4x4 lattice`);
  const layout = readLayout(board, 'PROBE_S');
  if (!layout) fail('readLayout refused the squared set');
  else {
    console.log(`  readLayout rows: ${layout.rows.join(' / ')}`);
    const holes = layout.cells.flat().filter((c) => !c).length;
    if (holes !== 8) fail(`expected 8 holes in a 4x4 squared set, found ${holes}`);
    else ok('8 occupied spots, rows carry the empty marker, 8 holes in the cells grid');
  }
  const r = arrangementFor(board, 'PROBE_S');
  if (r.number !== 0) fail(`squared set -> ${r.number ?? 'null'} (${r.reason ?? ''})`);
  else ok('squared set reads back as arrangement 0');

  for (const turns of [1, 2, 3]) {
    const rr = arrangementFor(rotateBoard(board, turns), 'PROBE_S');
    if (rr.number !== 0) fail(`squared set rotated ${turns * 90}deg -> ${rr.number ?? 'null'} (${rr.reason ?? ''})`);
  }
  if (failures === 0) ok('squared set still reads 0 at every rotation');

  // A diamond: 3x3 lattice, 4 occupied, the corners empty. The other shape the guard refused - and
  // it comes with a measurement worth keeping: a 4-dancer diamond is symmetric under a half turn, so
  // arrangement 0 and arrangement 4 are BOTH readings of the same board and the module correctly
  // reports the ambiguity rather than picking one. That is a property of the SHAPE, not of the guard,
  // and it is the same question a squared set raises in Step 2.
  // (Gender strings here DO carry the '.' marker, as a transcribed table's rows must.)
  ARRANGEMENT_TABLES.PROBE_D = [
    { facing: '.^.', genders: ['.B.', '.g.', '.g.', '.B.', '.g.', '.B.'] },
    { facing: '<.>', genders: ['B.g', 'g.B', 'B.g', 'g.B', 'B.g', 'g.B'] },
    { facing: '.v.', genders: ['.B.', '.g.', '.B.', '.g.', '.g.', '.B.'] },
  ];
  const diamond = boardFromTable('PROBE_D', 0);
  const dl = readLayout(diamond, 'PROBE_D');
  const dr = arrangementFor(diamond, 'PROBE_D');
  console.log(`  diamond built: ${diamond.dancers.length} dancers, readLayout ${dl ? dl.rows.join(' / ') : 'refused'}, arrangement ${dr.number ?? 'null'}, candidates [${dr.candidates.join(',')}]`);
  if (!dl) fail(`readLayout refused the diamond (${dr.reason ?? ''})`);
  else if (dr.candidates.join() !== '0,4') fail(`diamond candidates [${dr.candidates.join(',')}], expected [0,4] (the half-turn symmetry)`);
  else ok('diamond (3x3, 4 occupied, corners empty) projects; its half-turn symmetry makes 0 and 4 both readings, reported as ambiguous');
  delete ARRANGEMENT_TABLES.PROBE_D;

  console.log('\n== C. what must STILL be refused (inside the injected table) ==');
  // Two dancers on one spot: crowded, so not a board at all.
  const crowded = { dancers: [
    { id: 1, couple: 0, gender: 'boy', x: 0, y: 0, heading: 0 },
    { id: 2, couple: 0, gender: 'girl', x: 0, y: 0, heading: 0 },
    { id: 3, couple: 0, gender: 'boy', x: 1, y: 1, heading: 0 },
  ] };
  const cr = arrangementFor(crowded, 'PROBE_S');
  if (cr.number !== null) fail(`a board with two dancers on one spot read as ${cr.number}`);
  else ok(`crowded board refused: ${cr.reason ?? '(no reason given)'}`);

  // A t-bone: a non-axis-aligned facing cannot be written as a table cell.
  const tbone = boardFromTable('PROBE_S', 0);
  tbone.dancers[0] = { ...tbone.dancers[0], heading: Math.PI / 4 };
  const tr = arrangementFor(tbone, 'PROBE_S');
  if (tr.number !== null) fail(`a t-bone board read as ${tr.number}`);
  else ok('t-bone board refused (a facing off the four axes has no table character)');
} finally {
  if (!hadS) delete ARRANGEMENT_TABLES.PROBE_S;
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
