// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// THE [S] TABLE, BUILT FROM THE SOURCE'S TOKEN STREAM AND THE ENGINE'S OWN HOME SQUARE.
//
// Two things are known independently and do not need deriving:
//   1. the source's printed rows, in order, as a flat stream of gender letters (2 per arrangement for
//      a Side row, 1 for a Head row). Reading them off the print is unambiguous - see
//      squared-set-pattern-order-probe.mjs, which prints the tokens.
//   2. the engine's + All8's definition of arrangement 0: it is the HOME arrangement, and the engine's
//      home square's occupied lattice is `.gB. / B..g / g..B / .Bg.`.
// The only unknown is which of the source's six arrangement columns is home, i.e. a cyclic shift. This
// prints all six shifts with the arrangements they produce, so the choice is visible and checkable.
//
// Usage: node engine/test/tools/squared-set-table-build-probe.mjs   (network needed)

const SOURCE = 'https://www.all8.com/sd/calling/arrngdia.htm';
const FACE = '^v<>';
const NUMBER_ORDER = [0, 5, 1, 2, 3, 4];
const ENGINE_FACING = ['.vv.', '>..<', '>..<', '.^^.'];
const HOME0 = ['.gB.', 'B..g', 'g..B', '.Bg.'];

const res = await fetch(SOURCE);
if (!res.ok) { console.log(`FAIL: HTTP ${res.status}`); process.exit(1); }
const html = await res.text();
const anchor = html.indexOf('<a name="S"></a>');
const open = html.indexOf('<pre>', anchor);
const block = html.slice(open + 5, html.indexOf('</pre>', open));

const HEADER = /^\s*(Formation|\[[A-Za-z.]+\])\s/;
const rows = [];
for (const line of block.split('\n')) {
  if (!line.trim() || HEADER.test(line)) continue;
  const toks = [...line.matchAll(/\S+/g)].map((m) => m[0]);
  let i = 0;
  while (i < toks.length && [...toks[i]].every((c) => FACE.includes(c))) i++;
  const gender = toks.slice(i).join('');
  if (gender.length !== 12) break; // 12 letters = 6 arrangements x 2 letters (a Head row's pair is 1+1)
  rows.push(gender);
}
if (rows.length < 4) { console.log(`FAIL: read ${rows.length} source rows`); process.exit(1); }
console.log('=== the source rows, as flat gender streams (6 arrangements x 2 letters) ===');
rows.slice(0, 4).forEach((g, i) => console.log(`  row ${i}: ${g.match(/../g).join(' ')}`));

// The engine's cell columns per row, and All8's rule for reading a 2-letter cell onto them:
//   Head rows (0 and 3): the pair sits at the two MIDDLE columns -> cell 'xy' = column1=x, column2=y
//   Side rows (1 and 2): the pair sits at the two END columns    -> cell 'xy' = column0=x, column3=y
const ENGINE_ROWS = [
  { src: 0, cols: [1, 2] },
  { src: 1, cols: [0, 3] },
  { src: 2, cols: [0, 3] },
  { src: 3, cols: [1, 2] },
];

/** The full table under a cyclic column shift, as 4 rows x 6 arrangements of 4-char patterns. */
const tableFor = (shift) => ENGINE_ROWS.map(({ src, cols }) => {
  const cells = rows[src].match(/../g);
  return NUMBER_ORDER.map((_, c) => {
    const cell = cells[(c + shift) % 6];
    const out = ['.', '.', '.', '.'];
    out[cols[0]] = cell[0];
    out[cols[1]] = cell[1];
    return out.join('');
  });
});

console.log("\n=== every column shift: is arrangement 0 the home square? ===");
let chosen = null;
for (let shift = 0; shift < 6; shift++) {
  const t = tableFor(shift);
  const arr0 = t.map((r) => r[0]).join('/');
  const arr5 = t.map((r) => r[5]).join('/');
  const ok0 = arr0 === HOME0.join('/');
  const distinct = new Set(NUMBER_ORDER.map((_, c) => t.map((r) => r[c]).join('/'))).size;
  console.log(`  shift ${shift}: arr0 ${ok0 ? '= HOME' : arr0}   arr5 ${arr5}   ${distinct} distinct`);
  if (ok0 && distinct === 6) chosen = shift;
}
if (chosen === null) { console.log('\nno shift makes arrangement 0 home'); process.exit(1); }

console.log(`\n=== the TypeScript table (shift ${chosen}; arrangement 0 = home) ===`);
const t = tableFor(chosen);
console.log('  S: [');
ENGINE_FACING.forEach((facing, i) => {
  console.log(`    { facing: '${facing}', genders: [${t[i].map((g) => `'${g}'`).join(', ')}] },`);
});
console.log('  ],');

console.log('\n=== check ===');
NUMBER_ORDER.forEach((number, c) => {
  const g = t.map((r) => r[c]);
  const boys = g.join('').split('').filter((x) => x === 'B').length;
  const girls = g.join('').split('').filter((x) => x === 'g').length;
  console.log(`  [${number}S] ${g.join('/')}  boys ${boys} girls ${girls}${number === 0 ? '   <- must be the home square' : ''}`);
});
console.log(`  arrangement 0 is home: ${t.map((r) => r[0]).join('/') === HOME0.join('/')}`);
