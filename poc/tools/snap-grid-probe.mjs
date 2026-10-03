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
// somebody liked. Run: node tools/snap-grid-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// RESOLVED FROM THIS FILE, NOT THE WORKING DIRECTORY: every probe here reads the POC's assets or its
// source, and `process.cwd()` made them runnable only from `poc/` - so `node poc/tools/x.mjs` from the
// repository root died with ENOENT and looked like a broken probe rather than a misplaced one.
const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(POC_DIR, 'src/assets', p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// The panel's own two constants, IMPORTED rather than repeated.
//
// THE RULE LIVES IN A PURE MODULE NOW (`poc/src/grid-magnet.ts`): no DOM, no `three`, so node's type
// stripping loads it and this probe measures the rule the drags actually run. It used to restate the numbers
// and the expression, which is one edit away from checking a copy - and now that the board has a second grid
// (`radial-grid-probe.mjs`) there would be two copies of a rule that is meant to have one definition.
const grid = await import(pathToFileURL(path.join(POC_DIR, 'src', 'grid-magnet.ts')).href);
const { SNAP_CELL, SNAP_TOL, SNAP_HALF_TOL, snapToAxis } = grid;

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
  // THE FLAT VIEW FITS THE FLOOR NOW, so the scale is the CANVAS's rather than a constant: `scene.ts` frames
  // `FLOOR_HALF + FRAME_PAD` units on the tighter axis, and at 1600x900 the tighter axis is the height.
  const FLOOR_HALF = 5;
  const FRAME_PAD = 0.6;
  const W = 1600;
  const H = 900;
  const halfH = Math.max(FLOOR_HALF + FRAME_PAD, (FLOOR_HALF + FRAME_PAD) / (W / H));
  const pxPerUnit = H / (2 * halfH);
  const tolerancePx = SNAP_TOL * pxPerUnit;
  const halfPx = SNAP_HALF_TOL * pxPerUnit;
  console.log(`    the flat view at ${W}x${H}: ${pxPerUnit.toFixed(2)} px per unit`);
  console.log(`    pull: ${tolerancePx.toFixed(1)} px around a drawn line, ${halfPx.toFixed(1)} px around a half position; the whole cell is ${pxPerUnit.toFixed(1)} px`);
  check(SNAP_TOL < SNAP_CELL / 2 && SNAP_HALF_TOL < SNAP_CELL / 4,
    `each tier is a magnet and not a lock: the whole grid pulls from ${SNAP_TOL} of a cell and the half grid from ${SNAP_HALF_TOL}, so neither covers the gap between its own lines`);
  // THE PULL IS A QUARTER OF A CELL, WHICH IS SCALE-INVARIANT, and that is the check now that the framing
  // FITS the floor: a fixed band in pixels would have been a statement about the OLD fixed frame (11 units,
  // 40.9 px per unit) and pinning it would refuse the fitted one for no reason. The one absolute bound left is
  // that a quarter of a cell is big enough to hit.
  check(tolerancePx >= 5 && Math.abs(tolerancePx / (SNAP_CELL * pxPerUnit) - 0.25) < 1e-12,
    `and that is ${tolerancePx.toFixed(1)} px on the ${W}x${H} canvas above, a quarter of the CELL on screen - so it scales with the frame rather than being a fixed number of pixels`);
  // The rule itself, now the IMPORTED one: the panel's own lines are the same expression, and this is that
  // expression rather than a restatement of it.
  const snap = snapToAxis;
  check(snap(0.9) === 1 && snap(1.2) === 1 && snap(-1.2) === -1, 'a point within the magnet is pulled exactly onto the line');
  check(snap(0.5) === 0.5 && snap(0.74) === 0.74, 'a point outside it is left EXACTLY where it was, with no rounding');
  check(snap(0) === 0 && snap(2.0) === 2.0, 'and a point already on a line is unchanged');
  // THE HALF TIER, which the caller asked for because half positions are popular in this dance.
  check(snap(0.6) === 0.5 && snap(-1.4) === -1.5, 'a point near a HALF position is pulled onto it');
  check(snap(0.25) === 0 && snap(0.75) === 1, 'and the DRAWN line wins where both are in range: a quarter of a unit from each lands on the whole');
  let pulled = 0;
  let pulledWhole = 0;
  let pulledHalf = 0;
  for (let i = 0; i < 1000; i++) {
    const v = (i / 1000) * 4 - 2;
    if (snap(v) === v) continue;
    pulled++;
    if (Number.isInteger(snap(v))) pulledWhole++;
    else pulledHalf++;
  }
  console.log(`    over two cells at 1000 positions: ${pulledWhole} pulled to a DRAWN line, ${pulledHalf} to a half position, ${1000 - pulled} left free`);
  check(pulled / 1000 > 0.6 && pulled / 1000 < 0.85,
    `the magnet pulls ${((pulled / 1000) * 100).toFixed(0)}% of positions and leaves ${(100 - (pulled / 1000) * 100).toFixed(0)}% free - sticky, but still a magnet rather than a lock`);
  check(pulledWhole > pulledHalf, 'and the drawn grid is the stronger tier, so it wins where they compete');
  // Where the half positions come from: the corpus's own coordinates.
  check(onHalf / nonZero.length > onGrid / nonZero.length,
    `the half grid is worth having because the assets use it MORE than the whole one (${((onHalf / nonZero.length) * 100).toFixed(1)}% against ${((onGrid / nonZero.length) * 100).toFixed(1)}%)`);
}

// ---------------------------------------------------------------- the visible grid, and the frame
console.log('\n== The grid the caller can SEE, and which frame the snap is in ==');
{
  const THREE = await import('three');

  // FIRST THE PREMISE: the drawn floor grid really is 1-unit lines at WHOLE coordinates. If it were not,
  // "snap to the visible grid" would mean something else entirely - so this reads the geometry three's
  // GridHelper actually builds rather than trusting the constructor arguments.
  // THE APP'S OWN GRID: `FLOOR_HALF * 2` units in as many divisions (see `scene.ts`), so this reads the
  // geometry three's GridHelper actually builds for the board as it is now - 8 units across, 8 divisions.
  const g = new THREE.GridHelper(8, 8);
  const pos = g.geometry.attributes.position;
  const xs = new Set();
  const zs = new Set();
  for (let i = 0; i < pos.count; i++) {
    xs.add(Math.round(pos.getX(i) * 1e6) / 1e6);
    zs.add(Math.round(pos.getZ(i) * 1e6) / 1e6);
  }
  const lines = [...new Set([...xs, ...zs])].sort((a, b) => a - b);
  const spacing = [];
  for (let i = 1; i < lines.length; i++) spacing.push(Math.round((lines[i] - lines[i - 1]) * 1e6) / 1e6);
  console.log(`    the floor grid: ${lines.length} distinct line coordinates from ${lines[0]} to ${lines[lines.length - 1]}, spacing ${[...new Set(spacing)].join(',')}`);
  check(lines.every((v) => Number.isInteger(v)) && lines[0] === -4 && lines[lines.length - 1] === 4,
    'the drawn grid is whole coordinates from -4 to 4: eight cells, which with the half lines at 0.5 … 3.5 is the 16 x 16 grid');
  check(new Set(spacing).size === 1 && spacing[0] === SNAP_CELL,
    `so a ${SNAP_CELL}-unit cell IS the drawn cell, and a whole coordinate IS a drawn line`);

  const STEPS = 24;
  // SEVERAL POINTERS, because how far the local snap misses depends on where in the cell the pointer is
  // as well as on the pose - one pointer near a line on both axes measured a worst miss of 0.196 units,
  // which is a real miss but not the whole story of how wrong it can look.
  const POINTERS = [
    { x: 2.1, y: 3.15 },
    { x: -1.05, y: 0.9 },
    { x: 4.2, y: -2.1 },
    { x: 0.15, y: 0.2 },
  ];
  const toLocal = (pose, p) => {
    const dx = p.x - pose.x;
    const dy = p.y - pose.y;
    return { x: Math.cos(pose.heading) * dx + Math.sin(pose.heading) * dy, y: -Math.sin(pose.heading) * dx + Math.cos(pose.heading) * dy };
  };
  const toBoard = (pose, l) => ({
    x: pose.x + Math.cos(pose.heading) * l.x - Math.sin(pose.heading) * l.y,
    y: pose.y + Math.sin(pose.heading) * l.x + Math.cos(pose.heading) * l.y,
  });
  // THE WHOLE-UNIT TIER ON ITS OWN, which is what this section asks about: the drawn lines are the whole
  // units, so a snap that also knew the half positions could land a point between two of them and the
  // question "is the board snap on a drawn line" would be unanswerable. (The full rule, both tiers, is the
  // imported `snapToAxis` used in the section above.)
  const magnet = (v) => {
    const near = Math.round(v / SNAP_CELL) * SNAP_CELL;
    return Math.abs(v - near) <= SNAP_TOL ? near : v;
  };
  /** How far a point is from the nearest drawn line: 0 means it is ON the board's grid. */
  const offLine = (p) => Math.min(Math.abs(p.x - Math.round(p.x)), Math.abs(p.y - Math.round(p.y)));
  const sweep = (pose) => {
    let worstBoard = 0;
    let worstLocal = 0;
    let localOnLine = 0;
    let same = 0;
    let total = 0;
    for (let s = 0; s < STEPS; s++) {
      for (const quarter of [0, 1, 2, 3]) {
        const heading = (s / STEPS) * 2 * Math.PI + (quarter * Math.PI) / 2;
        const at = { ...pose, heading };
        for (const pointer of POINTERS) {
          const boardSnapped = { x: magnet(pointer.x), y: magnet(pointer.y) };
          const l = toLocal(at, pointer);
          const localSnapped = toBoard(at, { x: magnet(l.x), y: magnet(l.y) });
          worstBoard = Math.max(worstBoard, offLine(boardSnapped));
          worstLocal = Math.max(worstLocal, offLine(localSnapped));
          if (offLine(localSnapped) < 1e-9) localOnLine++;
          if (Math.hypot(boardSnapped.x - localSnapped.x, boardSnapped.y - localSnapped.y) < 1e-9) same++;
          total++;
        }
      }
    }
    return { pose, worstBoard, worstLocal, localOnLine, same, total };
  };

  // TWO POSES, and the second is the one that makes the case: the local frame's grid ORIGIN is the
  // dancer, so it is offset from the board's grid by the dancer's own position as well as turned by
  // their heading. A dancer on a WHOLE coordinate square to the floor has the two grids in step; a
  // dancer on a half coordinate has them half a cell apart however they face.
  const homeSquare = sweep({ x: 1, y: -3 }); // a real squared-set position, measured above
  const halfCell = sweep({ x: 1.5, y: -0.5 });
  for (const r of [homeSquare, halfCell]) {
    console.log(`    dancer at (${r.pose.x}, ${r.pose.y}), ${r.total} headings:`);
    console.log(`      BOARD snap: worst distance from a drawn line ${r.worstBoard.toFixed(4)}`);
    console.log(`      LOCAL snap: worst ${r.worstLocal.toFixed(4)}, exactly on a line in ${r.localOnLine} of ${r.total}, identical to the board snap in ${r.same}`);
  }
  check(homeSquare.worstBoard === 0 && halfCell.worstBoard === 0,
    'snapping the BOARD point lands exactly ON a drawn line at every heading and from either stance - the snap cannot look wrong because of where the dancer is or how they face');
  check(halfCell.same === 0,
    `and from a half coordinate the two grids never agree at any heading (${halfCell.same} of ${halfCell.total}), because the local grid ORIGIN is the dancer: being square to the floor is not enough, the dancer has to stand on a whole coordinate too`);
  check(halfCell.localOnLine > 0 && halfCell.localOnLine < halfCell.total / 4,
    `the local snap does land on a line in ${halfCell.localOnLine} of ${halfCell.total} cases anyway - coincidences where the half-cell offset in position happens to cancel the local rounding, and in NONE of them does it agree with the board snap`);
  check(homeSquare.same > 0 && homeSquare.same === homeSquare.localOnLine,
    `they coincide only on a whole coordinate square to the floor (${homeSquare.same} of ${homeSquare.total} headings, every multiple of 90deg) - the usual stance at the start of a move, and the only one where the local snap was not misleading`);
  check(homeSquare.worstLocal > 0.1,
    `off that stance the LOCAL snap misses by up to ${homeSquare.worstLocal.toFixed(3)} units - a fifth of a cell, about ${(homeSquare.worstLocal * 40.91).toFixed(0)} px on screen, so the control point sits visibly beside the line it claims to be on`);
  // The cost, measured rather than waved at: the tile's numbers are the local coordinates of a grid
  // point, so they are not round when the dancer is turned away from the board's axes.
  {
    const at = { x: 1, y: -3, heading: 0.6 };
    const pointer = POINTERS[0];
    const boardLocal = toLocal(at, { x: magnet(pointer.x), y: magnet(pointer.y) });
    const localLocal = { x: magnet(toLocal(at, pointer).x), y: magnet(toLocal(at, pointer).y) };
    console.log(`      the tile numbers for a dancer facing 34deg: BOARD snap leaves (${boardLocal.x.toFixed(4)}, ${boardLocal.y.toFixed(4)}), LOCAL snap leaves (${localLocal.x.toFixed(4)}, ${localLocal.y.toFixed(4)})`);
    check(Math.abs(boardLocal.x - Math.round(boardLocal.x)) > 0.05,
      'the trade is real: a turned dancer means the tile shows the local coordinates of a grid point, which are not round - said out loud rather than hidden');
  }
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
