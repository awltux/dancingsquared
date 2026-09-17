// STEP 2 PROBE: after [S] is in the module, does the engine read the home square, and what does it
// say about home's whole FASR(OO)?
//
// Three questions, all measured:
//   1. does `arrangementFor(homeSquare, 'S')` read the home arrangement, and is it AMBIGUOUS (home is
//      symmetric under a quarter turn, so 0 and 4 are both readings)?
//   2. do all 6 arrangements of the transcribed table round-trip, at every rotation?
//   3. what does `alignmentOf(home, 'Static Square')` and `fasrooOf(home, 'Static Square')` now print -
//      i.e. what does the POC readout become once [S] exists?
//
// Usage: node engine/test/tools/squared-set-readout-probe.mjs

import {
  ARRANGEMENT_TABLES,
  ARRANGEMENT_NUMBER_ORDER,
  arrangementFor,
  alignmentOf,
  fasrooOf,
  letterForFormation,
  FORMATIONS_FOR_LETTER,
} from '../../dist/index.js';
import { HOME_DANCERS } from '../../dist/sequencer/identity.js';

const FACING = { '>': 0, '^': 90, '<': 180, v: 270 };
const DEG = Math.PI / 180;
let failures = 0;
const fail = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const ok = (m) => console.log(`  ok    ${m}`);

const home = { dancers: HOME_DANCERS.map((d) => ({ ...d })) };
const rotate = (board, turns) => ({
  dancers: board.dancers.map((d) => {
    let { x, y } = d;
    for (let i = 0; i < turns; i++) [x, y] = [-y, x];
    return { ...d, x, y, heading: d.heading + turns * 90 * DEG };
  }),
});

/** Build a board straight from the table's own frame: column c -> x, row r -> -y. */
function boardFromTable(letter, number) {
  const table = ARRANGEMENT_TABLES[letter];
  const k = ARRANGEMENT_NUMBER_ORDER.indexOf(number);
  const dancers = [];
  table.forEach((row, r) => {
    [...row.facing].forEach((f, c) => {
      const g = row.genders[k][c];
      if (g === '.') return;
      dancers.push({ id: dancers.length + 1, couple: 0, gender: g === 'B' ? 'boy' : 'girl', x: c, y: -r, heading: FACING[f] * DEG });
    });
  });
  return { dancers };
}

console.log('=== 1. the letter, and the home square ===');
console.log(`  letterForFormation('Static Square') = ${letterForFormation('Static Square')}`);
console.log(`  FORMATIONS_FOR_LETTER['S'] = ${JSON.stringify(FORMATIONS_FOR_LETTER.S)}`);
if (letterForFormation('Static Square') !== 'S') fail('Static Square is not mapped to [S]');

// The engine's home square is not stored in the table's orientation (the tables are drawn 90 degrees
// from it), so find the reading that reproduces the table's own facing layout.
const faceChar = (h) => '>^<v'[Math.round((((h / (Math.PI / 2)) % 4) + 4) % 4)];
const gridOf = (board, turns, mirrored) => {
  const moved = board.dancers.map((d) => {
    let { x, y } = d;
    let h = d.heading;
    if (mirrored) { x = -x; h = Math.PI - h; }
    for (let i = 0; i < turns; i++) { [x, y] = [-y, x]; h += Math.PI / 2; }
    return { ...d, x, y, heading: h };
  });
  const xs = [...new Set(moved.map((d) => +d.x.toFixed(4)))].sort((a, b) => a - b);
  const ys = [...new Set(moved.map((d) => +d.y.toFixed(4)))].sort((a, b) => b - a);
  return ys.map((y) => xs.map((x) => {
    const d = moved.find((q) => +q.x.toFixed(4) === x && +q.y.toFixed(4) === y);
    return { facing: d ? faceChar(d.heading) : '.', gender: d ? (d.gender === 'boy' ? 'B' : 'g') : '.' };
  }));
};
console.log('\n  readings of the home square (the table wants .^^./<..>/<..>/.vv.):');
for (const mirrored of [false, true]) {
  for (const turns of [0, 1, 2, 3]) {
    const g = gridOf(home, turns, mirrored);
    console.log(`    mirror=${String(mirrored).padEnd(5)} turns=${turns}  facing ${g.map((r) => r.map((c) => c.facing).join('')).join('/')}  genders ${g.map((r) => r.map((c) => c.gender).join('')).join('/')}`);
  }
}

const homeRead = arrangementFor(home, 'S');
console.log(`  arrangementFor(home, 'S') -> ${homeRead.number ?? 'null'}  candidates [${homeRead.candidates.join(',')}]${homeRead.reason ? `  (${homeRead.reason})` : ''}`);
if (!homeRead.candidates.includes(0)) fail('the home square is not read as arrangement 0 at all');
if (homeRead.candidates.length > 1) ok(`home reads as a SET of arrangements (${homeRead.candidates.join(', ')}) - expected: home is symmetric under a quarter turn`);
else ok('home reads as exactly one arrangement');

console.log('\n=== 2. every [S] arrangement round-trips, including rotated ===');
let readings = 0;
const bad = [];
for (const number of ARRANGEMENT_NUMBER_ORDER) {
  for (const turns of [0, 1, 2, 3]) {
    readings++;
    const r = arrangementFor(rotate(boardFromTable('S', number), turns), 'S');
    // 0 and 4 are the same pattern on this symmetric ring, so both are accepted for 0; the others
    // must be exact.
    const want = number === 0 ? [0, 4] : [number];
    if (!want.includes(r.number) && !r.candidates.some((c) => want.includes(c))) {
      bad.push(`${number}@${turns * 90}deg -> ${r.number ?? 'null'} candidates [${r.candidates.join(',')}]`);
    }
  }
}
if (bad.length) fail(`[S] ${bad.slice(0, 4).join('; ')}`);
else ok(`[S] all ${readings} readings land on their own arrangement (0 and 4 interchangeable, as the shape dictates)`);

console.log('\n=== 3. what the readout becomes ===');
const a = alignmentOf(home, 'Static Square');
console.log(`  alignmentOf(home, 'Static Square').notation = ${a.notation}`);
console.log(`    formation ${a.formation}, letter ${a.letter}, arrangement ${a.arrangement ?? 'null'}, sequence ${a.sequence ?? 'null'}`);
console.log(`    arrangement reason: ${a.arrangementResult?.reason ?? '(none - a single reading)'}`);
console.log(`    relationship reason: ${a.relationshipReason ?? '(none)'}`);
const f = fasrooOf(home, 'Static Square');
console.log(`  fasrooOf(home, 'Static Square') = ${JSON.stringify(f)}`);

console.log('\n=== 4. a board that is NOT [0S] still differs ===');
// A half-sashay: the dancers of each couple exchange places. Try the two plausible readings of that
// on the home square and report what each one reads, rather than assuming which is right.
const variants = {
  'half turn of the whole square': home.dancers.map((d) => ({ ...d, x: -d.x, y: -d.y, heading: d.heading + Math.PI })),
  'swap each couple\'s two spots': home.dancers.map((d) => {
    const partner = home.dancers.find((o) => o.couple === d.couple && o.id !== d.id);
    return { ...d, x: partner.x, y: partner.y };
  }),
};
for (const [name, dancers] of Object.entries(variants)) {
  const r = arrangementFor({ dancers }, 'S');
  console.log(`  ${name.padEnd(32)} -> arrangement ${r.number ?? 'null'} candidates [${r.candidates.join(',')}]`);
}
const sashed = { dancers: home.dancers.map((d) => {
  const partner = home.dancers.find((o) => o.couple === d.couple && o.id !== d.id);
  return { ...d, x: partner.x, y: partner.y };
}) };
const s = arrangementFor(sashed, 'S');
if (s.number !== 5 && !s.candidates.includes(5)) fail('neither half-sashay reading is arrangement 5');
else ok(`the half-sashay (partner spots exchanged) is arrangement ${s.number}, so home and half-sashayed home differ`);

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
