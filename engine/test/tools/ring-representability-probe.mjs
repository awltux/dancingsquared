// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// STEP 1 PROBE, PART A: the full-rectangle guard is what refuses a ring, and nothing else.
//
// A squared set is eight points on a 4x4 lattice - the opposite corners of each row and column are
// EMPTY. The guard in `toGrid` demands `distinct x * distinct y === dancers`, i.e. the occupied cells
// must BE a rectangle, so a squared set is refused before its facings or genders are ever looked at.
//
// This prints, for the home square and for a squared set rotated to each of the eight symmetries of
// the square, whether any symmetry gets past the guard. The answer is measured, not assumed: the
// lattice is 4x4 = 16 and there are 8 dancers, so no rotation can help.
//
// Usage: node engine/test/tools/ring-representability-probe.mjs

import { HOME_DANCERS } from '../../dist/sequencer/identity.js';

const sym = (d, mirrored, turns) => {
  let x = d.x;
  let y = d.y;
  let h = d.heading;
  if (mirrored) { x = -x; h = Math.PI - h; }
  for (let i = 0; i < turns; i++) { [x, y] = [-y, x]; h += Math.PI / 2; }
  return { ...d, x, y, heading: h };
};

const lattice = (dancers) => {
  const xs = [...new Set(dancers.map((d) => +d.x.toFixed(4)))].sort((a, b) => a - b);
  const ys = [...new Set(dancers.map((d) => +d.y.toFixed(4)))].sort((a, b) => b - a);
  return { xs, ys, product: xs.length * ys.length };
};

console.log('=== the home square lattice, as toGrid() sees it ===');
{
  const { xs, ys, product } = lattice(HOME_DANCERS);
  console.log(`  x columns: [${xs.join(', ')}]  y rows: [${ys.join(', ')}]`);
  console.log(`  lattice is ${xs.length} x ${ys.length} = ${product} cells, ${HOME_DANCERS.length} dancers`);
  console.log(`  full-rectangle guard (product === dancers): ${product === HOME_DANCERS.length}`);
  console.log('  occupied cells (row = y desc, col = x asc), # = a dancer, . = empty:');
  for (const y of ys) {
    let line = '    ';
    for (const x of xs) {
      const d = HOME_DANCERS.find((q) => q.x === x && q.y === y);
      line += d ? `${d.gender === 'boy' ? 'B' : 'g'} ` : '. ';
    }
    console.log(`${line} y=${y}`);
  }
}

console.log('\n=== every symmetry of the square: does any escape the guard? ===');
let escaped = 0;
for (const mirrored of [false, true]) {
  for (const turns of [0, 1, 2, 3]) {
    const { xs, ys, product } = lattice(HOME_DANCERS.map((d) => sym(d, mirrored, turns)));
    const passes = product === HOME_DANCERS.length;
    if (passes) escaped++;
    console.log(`  mirror=${String(mirrored).padEnd(5)} turns=${turns}  ${xs.length}x${ys.length}=${product} cells vs 8 dancers  guard ${passes ? 'PASSES' : 'refuses'}`);
  }
}
console.log(`\n  ${escaped} of 8 symmetries get past the guard.`);

console.log('\n=== what a hole-bearing row would have to say ===');
console.log('  A table row is a string with one character per column, so an empty spot needs an explicit');
console.log('  marker. With "." for empty, the home square projects to:');
for (const y of [3, 1, -1, -3]) {
  let gender = '';
  let facing = '';
  for (const x of [-3, -1, 1, 3]) {
    const d = HOME_DANCERS.find((q) => q.x === x && q.y === y);
    gender += d ? (d.gender === 'boy' ? 'B' : 'g') : '.';
    facing += d ? '>^<v'[Math.round((((d.heading / (Math.PI / 2)) % 4) + 4) % 4)] : '.';
  }
  console.log(`    y=${String(y).padStart(2)}  genders ${gender}   facing ${facing}`);
}
