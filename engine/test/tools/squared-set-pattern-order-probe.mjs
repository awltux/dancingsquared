// TIER: none — one-shot diagnostic; nothing runs it. Recorded: engine/test/tools/README.md.
// WHAT ARE THE ENGINE'S ARRANGEMENT PATTERNS FOR A SQUARED SET, IN WHICH ORDER?
//
// The source page draws the square in one frame and the engine stores it in another, and the two are
// related by a symmetry that has to be MEASURED rather than reasoned about - the home square is
// invariant under all four rotations, so its facing layout cannot break the tie by itself. This brute
// forces it: for every symmetry of the engine's home square and every one of the source's six printed
// patterns, does the engine row equal the source pattern, holes included? The output names, for each
// engine row, which SOURCE row and which arrangement column it is.
//
// Usage: node engine/test/tools/squared-set-pattern-order-probe.mjs   (network needed)

import { HOME_DANCERS } from '../../dist/sequencer/identity.js';

const SOURCE = 'https://www.all8.com/sd/calling/arrngdia.htm';
const FACE = '^v<>';
const NUMBER_ORDER = [0, 5, 1, 2, 3, 4];

const res = await fetch(SOURCE);
if (!res.ok) { console.log(`FAIL: HTTP ${res.status}`); process.exit(1); }
const html = await res.text();
const anchor = html.indexOf('<a name="S"></a>');
const open = html.indexOf('<pre>', anchor);
const block = html.slice(open + 5, html.indexOf('</pre>', open));

const HEADER = /^\s*(Formation|\[[A-Za-z.]+\])\s/;
const sourceRows = [];
for (const line of block.split('\n')) {
  if (!line.trim()) continue;
  if (HEADER.test(line)) { console.log(`SKIP header: |${line}|`); continue; }
  const toks = [...line.matchAll(/\S+/g)].map((m) => m[0]);
  let i = 0;
  while (i < toks.length && [...toks[i]].every((c) => FACE.includes(c))) i++;
  const facing = toks.slice(0, i).join('');
  const rest = toks.slice(i);
  if (rest.length !== 6 && rest.length !== 12) { console.log(`STOP at: |${line}| (${rest.length} gender tokens)`); break; }
  const perCell = rest.length / 6;
  const cells = [];
  for (let k = 0; k < 6; k++) cells.push(rest.slice(k * perCell, (k + 1) * perCell).join(''));
  sourceRows.push({ facing, cells });
  console.log(`row ${sourceRows.length - 1}: facing ${facing.padEnd(4)} perCell ${perCell}  ${cells.join(' ')}`);
}

// A one-token cell is a Head row's pair at the two MIDDLE columns; a two-token cell is a Side row's
// pair at the two END columns. Either way the pattern is 4 characters wide once placed.
const wide = (row) => row.cells.map((c) => (c.length === 1 ? `.${c}.` : c));
console.log("\n=== the source's patterns per row (All8 column order 0,5,1,2,3,4) ===");
sourceRows.slice(0, 4).forEach((row, i) => {
  const w = wide(row);
  console.log(`row ${i}: facing ${row.facing.padEnd(4)} cells ${JSON.stringify(row.cells)} wide ${JSON.stringify(w)}`);
  console.log(`        as shown: ${w.map((p, k) => `${NUMBER_ORDER[k]}:${p}`).join('  ')}`);
});

const faceChar = (h) => '>^<v'[Math.round((((h / (Math.PI / 2)) % 4) + 4) % 4)];
const readings = [];
for (const mirrored of [false, true]) {
  for (const turns of [0, 1, 2, 3]) {
    const moved = HOME_DANCERS.map((d) => {
      let { x, y } = d;
      let h = d.heading;
      if (mirrored) { x = -x; h = Math.PI - h; }
      for (let t = 0; t < turns; t++) { [x, y] = [-y, x]; h += Math.PI / 2; }
      return { ...d, x, y, heading: h };
    });
    const xs = [...new Set(moved.map((d) => +d.x.toFixed(4)))].sort((p, q) => p - q);
    const ys = [...new Set(moved.map((d) => +d.y.toFixed(4)))].sort((p, q) => q - p);
    const grid = ys.map((y) => xs.map((x) => {
      const d = moved.find((q) => +q.x.toFixed(4) === x && +q.y.toFixed(4) === y);
      return { facing: d ? faceChar(d.heading) : '.', gender: d ? (d.gender === 'boy' ? 'B' : 'g') : '.' };
    }));
    readings.push({ mirrored, turns, grid });
  }
}

console.log('\n=== the engine home square in every symmetry ===');
for (const { mirrored, turns, grid } of readings) {
  console.log(`  mirror=${String(mirrored).padEnd(5)} turns=${turns}  facing ${grid.map((r) => r.map((c) => c.facing).join('')).join('/')}  genders ${grid.map((r) => r.map((c) => c.gender).join('')).join('/')}`);
}

console.log('\n=== for each engine row: which SOURCE row and arrangement column is it? ===');
for (const { mirrored, turns, grid } of readings) {
  const engRows = grid.map((r) => r.map((c) => c.gender).join(''));
  const owners = engRows.map((er) => {
    const hits = [];
    sourceRows.slice(0, 4).forEach((row, j) => {
      wide(row).forEach((p, k) => { if (p === er) hits.push(`src${j}#${NUMBER_ORDER[k]}`); });
    });
    return hits.length ? hits.join('|') : '-';
  });
  console.log(`  mirror=${String(mirrored).padEnd(5)} turns=${turns}  ${owners.join('  ')}`);
  // and the full-table relation: does some arrangement column reproduce ALL FOUR rows at once?
  const full = NUMBER_ORDER.filter((_, k) => {
    const src = sourceRows.slice(0, 4).map((row) => wide(row)[k]).join('/');
    return src === engRows.join('/');
  });
  if (full.length) console.log(`        ENTIRE TABLE equals source arrangement(s) ${full.join(', ')}`);
}
