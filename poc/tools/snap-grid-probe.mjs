// Probe: WHAT IS "THE GRID" in the coordinates the Bezier handles are dragged in?
//
// A CTRL-snap needs a size, and the size has to come from the data rather than from taste. Three
// candidate grids exist in this app and they are not the same grid:
//
//   - the FLOOR grid, which is 20 units across in 20 divisions, so 1-unit cells;
//   - the DANCER SPACING, which decides whether 1 unit is a slot or half a set;
//   - the MOVE coordinates in `moves.xml`, which is the frame the handles are authored and dragged in.
//
// This measures all three so the snap can be stated as a fact about the dance rather than a number
// somebody liked. Run: node tools/snap-grid-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';

const engine = await import('../../engine/dist/index.js');
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(process.cwd(), 'src/assets', p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// The panel's own two constants (`poc/src/editor-ui.ts`), repeated here so the measurements below are
// about the numbers the code uses. They cannot be imported: that module is TypeScript inside a Vite
// app, and it builds DOM. What is measured with them is what they MEAN - the cell is the format's own
// unit, and the tolerance is a distance on screen.
const SNAP_CELL = 1;
const SNAP_TOL = SNAP_CELL / 4;

// ---------------------------------------------------------------- the home square
console.log('== The home square, in engine units ==');
// NOT `pass_thru`: that call is the one the POC gate already fails on (a half set that does not
// mirror), so it is the worst possible witness for a measurement about the standard set. And not a
// bare setup INDEX either - "setup 2" of allemande.xml is "after Dixie Grand", which is a different
// formation entirely. The squared set is found by name.
const alXml = asset('ms/allemande.xml');
const squaredIdx = engine.parseCallXml(alXml).findIndex((t) => t.from === 'Static Square');
check(squaredIdx >= 0, `witness: a tam whose start is a Static Square (setup ${squaredIdx})`);
const call = engine.loadCallFromXml(alXml, movesXml, formationsXml, squaredIdx);
const start = call.dancers.map((d) => engine.poseFor(d, 0));
const spacing = [];
for (let i = 0; i < start.length; i++) {
  for (let j = i + 1; j < start.length; j++) {
    const d = Math.hypot(start[i].x - start[j].x, start[i].y - start[j].y);
    if (d > 1e-6) spacing.push(d);
  }
}
console.log(`    ${call.dancers.length} dancers, from "${call.from}"`);
console.log(`    positions: ${start.map((p) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(' ')}`);
const distinct = [...new Set(spacing.map((s) => Math.round(s * 1000) / 1000))].sort((a, b) => a - b);
console.log(`    distinct separations: ${distinct.join(', ')}`);
const ring = spacing.filter((s) => Math.abs(s - distinct[0]) < 1e-9).length;
check(call.dancers.length === 8, `the witness is a full set (${call.dancers.length} dancers)`);
// THE AUTHORITY IS THE FORMAT'S OWN HEADER, quoted here so the snap size is not a preference:
//   "The scale is in dancer units, same as shown when the grid is on."
// and the floor this app draws is a 20-unit grid in 20 divisions (scene.ts), so ONE UNIT IS ONE CELL
// OF THE GRID THE CALLER IS LOOKING AT, and a `Forward` (x2 = 1) is one cell of travel.
check(distinct[0] === 2 && ring === 4,
  `couples stand ${distinct[0]} units apart (${ring} pairs), so the unit grid is the HALF-position grid of the set as well as one floor cell`);

// ---------------------------------------------------------------- the move scale
console.log('\n== The move coordinates, which are the frame the handles live in ==');
const byX2 = new Map();
for (const [name, items] of engine.parseMoves(movesXml)) {
  for (const it of items) {
    if (it.kind !== 'movement') continue;
    const key = `${it.seg.translate.x2},${it.seg.translate.y2}`;
    if (!byX2.has(key)) byX2.set(key, []);
    byX2.get(key).push(name);
  }
}
const common = [...byX2.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
for (const [key, names] of common) {
  console.log(`    end (${key}): ${names.length} moves, e.g. ${names.slice(0, 4).join(', ')}`);
}
const ones = [...byX2.keys()].filter((k) => /^1(\.0+)?,0(\.0+)?$/.test(k));
check(ones.length > 0, `a one-slot step is the move (${ones.join(' ')}, 0) - so ONE ENGINE UNIT IS ONE SLOT`);

// ---------------------------------------------------------------- what the corpus uses
console.log('\n== The coordinate values the corpus actually authors ==');
const values = [];
for (const [, items] of engine.parseMoves(movesXml)) {
  for (const it of items) {
    if (it.kind !== 'movement') continue;
    for (const v of Object.values(it.seg.translate)) values.push(v);
    if (it.seg.rotate) for (const v of Object.values(it.seg.rotate)) values.push(v);
  }
}
const nonZero = values.filter((v) => Math.abs(v) > 1e-9);
const onGrid = nonZero.filter((v) => Math.abs(v - Math.round(v)) < 1e-9).length;
const onHalf = nonZero.filter((v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9).length;
console.log(`    ${values.length} coordinates in the registry, ${nonZero.length} of them non-zero`);
console.log(`    on whole units: ${onGrid} (${((onGrid / nonZero.length) * 100).toFixed(1)}%)   on half units: ${onHalf} (${((onHalf / nonZero.length) * 100).toFixed(1)}%)`);
const sample = [...new Set(nonZero.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
console.log(`    distinct values (first 24): ${sample.slice(0, 24).join(', ')}`);
// The point of this: the authored numbers are NOT on a grid at all - they are 1/3s, 4/3s and
// 1/sqrt(2)s, which is what a Bezier approximation of an arc produces. So a snap cannot be justified
// as "the values the corpus uses"; it has to be the floor's own grid, which is a real thing the caller
// can see.
check(onGrid / nonZero.length < 0.5,
  `the authored coordinates are mostly OFF the unit grid (${((onGrid / nonZero.length) * 100).toFixed(1)}% on it), so a snap is a new convention rather than a restoration of one`);

// ---------------------------------------------------------------- the tolerance, on screen
console.log('\n== How big is "a quarter of a cell" on screen? ==');
{
  // THE MAGNET'S ROLL-OFF IS THE ONLY PART OF THE SNAP THAT IS A JUDGEMENT CALL rather than a fact
  // about the data: the cell is the floor's (1 unit, above), but how CLOSE the pointer must come
  // before it is pulled in is what makes the snap feel like help rather than a lock. So it is
  // converted to pixels in the flat view, where the editor does most of its dragging.
  //
  // The flat camera shows ORTHO_HALF_HEIGHT units above and below the centre; `view2d-probe.mjs`
  // measures the framing, and this uses the same numbers.
  const ORTHO_HALF_HEIGHT = 11;
  const W = 1600;
  const H = 900;
  const pxPerUnit = H / (2 * ORTHO_HALF_HEIGHT);
  // No parameter here: naming one `SNAP_TOL` would SHADOW the constant, and calling it with no argument
  // then silently measures `undefined * pxPerUnit` and reports NaN px - which is exactly what the first
  // version of this did, and why the check below reads a number rather than a truthy NaN comparison.
  const tolerancePx = SNAP_TOL * pxPerUnit;
  console.log(`    the flat view at ${W}x${H}: ${pxPerUnit.toFixed(2)} px per unit`);
  console.log(`    a ${SNAP_TOL}-unit magnet is ${tolerancePx.toFixed(1)} px of pull; the whole cell is ${pxPerUnit.toFixed(1)} px`);
  check(SNAP_TOL < SNAP_CELL / 2,
    `the magnet is a MAGNET and not a lock: it pulls from ${SNAP_TOL} of a ${SNAP_CELL}-unit cell, so the drag is free over ${(((SNAP_CELL - 2 * SNAP_TOL) / SNAP_CELL) * 100).toFixed(0)}% of it`);
  check(tolerancePx >= 5 && tolerancePx <= 20,
    `and that is ${tolerancePx.toFixed(1)} px at 1080p - enough to feel, small enough not to fight the pointer`);
  // The rule itself, restated as arithmetic on the two things that decide it. The panel's own two
  // lines are the same expression; this pins the BEHAVIOUR they must have.
  const snap = (v) => {
    const near = Math.round(v / SNAP_CELL) * SNAP_CELL;
    return Math.abs(v - near) <= SNAP_TOL ? near : v;
  };
  check(snap(0.9) === 1 && snap(1.2) === 1 && snap(-1.2) === -1, 'a point within the magnet is pulled exactly onto the line');
  check(snap(0.5) === 0.5 && snap(0.74) === 0.74, 'a point outside it is left EXACTLY where it was, with no rounding');
  check(snap(0) === 0 && snap(2.0) === 2.0, 'and a point already on a line is unchanged');
  let pulled = 0;
  for (let i = 0; i < 1000; i++) {
    const v = (i / 1000) * 4 - 2;
    if (snap(v) !== v) pulled++;
  }
  check(pulled / 1000 > 0.4 && pulled / 1000 < 0.6,
    `across two cells, ${((pulled / 1000) * 100).toFixed(0)}% of positions are pulled - half the cell is within a quarter of a line on either side`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
