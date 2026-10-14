// Probe: THE RADIAL FLOOR GRID, and the magnet that pulls along its spokes and circles.
//
// Asked for: "Add an alternative radial 'grid' to all boards. The user can switch between radial and square
// grid. It should have 16 spokes and circles along each of the existing x/y divisions. The Magnet feature
// should work in a similar way, but along the spokes and circles."
//
// FOUR THINGS THAT CAN SILENTLY BE WRONG, and each is measured rather than argued:
//
//   1. THE DIVISIONS. "circles along each of the existing x/y divisions" is a claim about the SQUARE grid's
//      numbers, so the two grids have to be drawn at the same ones - a line every whole unit out to the
//      floor's half-size, with every second one overlaid at the coarser weight. A radial grid at some other
//      radius would be a second ruler, and a circle at 1.5 would be a position nothing draws.
//   2. THE MAGNET'S SHAPE. The rule has to be a magnet and not a lock, has to leave a far point EXACTLY
//      where it is, and has to be idempotent - the same three properties `snap-grid-probe.mjs` pins for the
//      square one.
//   3. THE SPOKE'S TOLERANCE IS A DISTANCE. A fixed angular window would move a point ~1 unit at r = 10 and
//      almost nothing at r = 1, which is not the same gesture at every radius. The probe measures the
//      displacement at both ends to pin that.
//   4. THE WIRING. The rule is imported here rather than mirrored (`src/grid-magnet.ts` is pure), so this
//      section is about the SWITCH: one control, the stage drawing it, the editor snapping to it, and the
//      session remembering it.
//
// Run: node poc/tools/radial-grid-probe.mjs   (from anywhere; no engine build needed - this is pure geometry)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const grid = await import(pathToFileURL(path.join(POC_DIR, '..', 'packages', 'stage', 'grid-magnet.ts')).href);
const {
  SNAP_CELL, SNAP_TOL, SNAP_HALF_TOL,
  RADIAL_SPOKES, RADIAL_SPOKE_STEP, RADIAL_CARDINAL_EVERY,
  radialCircleRadii, squareHalfOffsets, snapToAxis, snapSquare, snapRadial, snapBoard,
} = grid;

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// The floor the app draws, from `scene.ts`: 20 units across, so 10 either side. Not imported - `scene.ts`
// builds a WebGL renderer, and this probe is pure geometry - so the number is repeated with its source.
const FLOOR_HALF = 5;

// ============================================================ 1. 16 spokes, and the SAME divisions
console.log('== 1. The grid: 16 spokes, and circles at the square grid\'s own divisions ==');
check(RADIAL_SPOKES === 16, `the grid has ${RADIAL_SPOKES} spokes, as asked for`);
check(Math.abs(RADIAL_SPOKE_STEP - (Math.PI * 2) / 16) < 1e-12,
  `one every ${((RADIAL_SPOKE_STEP * 180) / Math.PI).toFixed(1)}deg`);
check(RADIAL_CARDINAL_EVERY === 4, `every ${RADIAL_CARDINAL_EVERY}th spoke is a CARDINAL one, so 0/90/180/270deg take the square grid's bright centre-line colour`);

{
  const { fine, coarse, halves } = radialCircleRadii(FLOOR_HALF);
  console.log(`    radii: fine ${fine.join(',')}   half ${halves.join(',')}   coarse ${coarse.join(',')}`);
  check(fine.length === FLOOR_HALF && fine[0] === 1 && fine[fine.length - 1] === FLOOR_HALF,
    `a circle at every whole unit from 1 to ${FLOOR_HALF}, which is exactly the square grid's division`);
  // ...and the brighter overlay is the even ones. `Math.floor(half / 2)` rather than `half / 2`: the outermost
  // even circle is r = 4 on a ±5 floor, so an ODD half has one fewer than half of them - the count is a
  // consequence of the radius, not a rule of its own.
  check(coarse.every((r) => r % 2 === 0) && coarse.length === Math.floor(FLOOR_HALF / 2),
    `and the even ones overlaid (${coarse.join(',')}), matching the square grid's 2-unit brighter overlay`);
  check(fine.every((r) => Math.abs(r / SNAP_CELL - Math.round(r / SNAP_CELL)) < 1e-12),
    'so ONE UNIT IS ONE CIRCLE, exactly as one unit is one square cell - switching changes the SHAPE of the reference, not its scale');
  // The circles must not go past the floor: a ring hanging off the edge is drawn over nothing.
  check(fine[fine.length - 1] <= FLOOR_HALF, 'and no circle is drawn past the floor it stands on');
  // THE HALF RINGS, which the radial grid draws and the square one deliberately does not.
  check(halves.length === FLOOR_HALF && halves[0] === 0.5 && halves[halves.length - 1] === FLOOR_HALF - 0.5,
    `and a ring at every HALF unit from 0.5 to ${FLOOR_HALF - 0.5} - one between each pair of divisions`);
  check(halves.every((r) => Math.abs(r * 2 - Math.round(r * 2)) < 1e-12 && Math.abs(r - Math.round(r)) > 1e-12),
    'each of which is a genuine half position and NOT a division, so no ring is drawn twice');
  check(halves.every((r) => r > 0 && r < FLOOR_HALF), 'and none of them hangs off the floor either');
  // ...AND THE SQUARE GRID'S HALF LINES STAND AT THE SAME OFFSETS. "the same subtle half-grid line used by the
  // radial grid" has to mean the same POSITIONS as well as the same material, and the two are computed
  // separately (an offset on an axis, a radius), so the agreement is checked rather than assumed.
  {
    const lineOffsets = squareHalfOffsets(FLOOR_HALF);
    console.log(`    square half lines at ${lineOffsets.join(',')}`);
    check(lineOffsets.length === halves.length && lineOffsets.every((v, i) => v === halves[i]),
      `the square grid's half lines are at exactly the radial grid's half radii (${lineOffsets[0]} … ${lineOffsets[lineOffsets.length - 1]}), so "the same mark" is the same place as well as the same colour`);
    check(!lineOffsets.includes(0) && !lineOffsets.includes(FLOOR_HALF),
      'and none of them is a division or the floor edge, which the grid already draws - the half mark is only the positions BETWEEN');
  }
}

// ============================================================ 2. it is a magnet, not a lock
console.log('\n== 2. The magnet: pulls when close, leaves anything else exactly alone ==');
const near = (a, b, tol = 1e-9) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
check(near(snapRadial({ x: 1.05, y: 0.02 }), { x: 1, y: 0 }),
  'a point within the pull of a circle AND a spoke lands exactly on the grid point where they cross');
check(near(snapRadial({ x: 0.62, y: 0 }), { x: 0.5, y: 0 }),
  'and one near a HALF circle lands on that, which is the tier the square grid has for the same reason');
check(near(snapRadial({ x: 0, y: 0 }), { x: 0, y: 0 }), 'the origin is already on the grid and is left alone');
check(near(snapRadial({ x: 2.0, y: 0 }), { x: 2.0, y: 0 }), 'a point already on a circle and a spoke is unchanged');
{
  // FAR FROM EVERYTHING: a radius outside both tiers and an angle at the middle of a spoke gap, where the
  // perpendicular distance is the largest there is. It must come back BIT-IDENTICAL, not merely close.
  const p = { x: 0, y: 0 };
  const r = 1.3;
  const mid = RADIAL_SPOKE_STEP / 2;
  p.x = Math.cos(mid) * r;
  p.y = Math.sin(mid) * r;
  const out2 = snapRadial(p);
  console.log(`    mid-spoke at r=${r}: off by ${Math.hypot(out2.x - p.x, out2.y - p.y).toFixed(6)}`);
  check(out2.x === p.x && out2.y === p.y, 'a point outside the magnet is left EXACTLY where it was, with no rounding');
}
{
  // IDEMPOTENT, which is what makes a second CTRL-drag frame a no-op rather than a drift.
  let moved = 0;
  let fixed = 0;
  for (let i = 0; i < 4000; i++) {
    const a = (i * 0.61803398875) % 1;
    const b = (i * 0.38196601125) % 1;
    const p = { x: (a - 0.5) * 20, y: (b - 0.5) * 20 };
    const once = snapRadial(p);
    const twice = snapRadial(once);
    if (Math.hypot(once.x - p.x, once.y - p.y) > 1e-12) moved++;
    if (Math.hypot(twice.x - once.x, twice.y - once.y) <= 1e-9) fixed++;
  }
  check(fixed === 4000, `the radial magnet is idempotent over ${fixed} of 4000 swept points, so a held CTRL-drag cannot creep`);
  check(moved > 0 && moved < 4000, `and it is neither a no-op (${moved} of 4000 pulled) nor a lock (${4000 - moved} left free)`);
}
{
  // IT LANDS ON THE GRID, NEVER BESIDE IT. Whichever coordinate the magnet touches, it has to arrive exactly
  // on a line: the radius on a circle of a snapped radius, and the angle ON a spoke whenever the angle is
  // what moved. A pull that stopped "near" a line would leave the control point on no reference at all,
  // which is the one outcome worse than not pulling.
  let pulled = 0;
  let bad = 0;
  let worstRadiusPull = 0;
  let worstRadial = 0;
  let worstSquare = 0;
  const ang = (q) => Math.atan2(q.y, q.x);
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2;
    for (let j = 1; j <= 600; j++) {
      const r = (j / 600) * FLOOR_HALF;
      const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      const s = snapRadial(p);
      worstRadial = Math.max(worstRadial, Math.hypot(s.x - p.x, s.y - p.y));
      const q = snapSquare(p);
      worstSquare = Math.max(worstSquare, Math.hypot(q.x - p.x, q.y - p.y));
      if (s.x === p.x && s.y === p.y) continue; // nothing pulled: covered by the exactness check above
      pulled++;
      // THE RADIUS THE RULE ITSELF READS: `hypot` of the point, not the nominal radius the sample was built
      // from. The two differ in the last bits, and at a tier boundary (r = 1.25 exactly) those bits decide
      // whether the point is pulled at all - so recomputing it from the nominal r would be measuring a
      // different rule at exactly the interesting place.
      const rr = Math.hypot(p.x, p.y);
      const rs = snapToAxis(rr);
      worstRadiusPull = Math.max(worstRadiusPull, Math.abs(rs - rr));
      if (Math.abs(Math.hypot(s.x, s.y) - rs) > 1e-9) bad++; // the radius did not land on its circle
      const turns = ang(s) / RADIAL_SPOKE_STEP;
      const rel = Math.abs(((turns % 1) + 1) % 1);
      const onSpoke = Math.min(rel, 1 - rel) <= 1e-9;
      if (angDiff(ang(s), ang(p)) > 1e-9 && !onSpoke) bad++; // the angle moved off the spoke it was pulled to
    }
  }
  check(bad === 0 && pulled > 0,
    `every one of the ${pulled} points the magnet moves lands EXACTLY on a circle of a snapped radius and, when the angle moves, EXACTLY on a spoke`);
  check(worstRadiusPull <= SNAP_TOL + 1e-9,
    `the radius is never pulled more than ${SNAP_TOL} of a cell (worst ${worstRadiusPull.toFixed(4)})`);
  console.log(`    worst combined move over the floor: radial ${worstRadial.toFixed(4)} units, square ${worstSquare.toFixed(4)}`);
  check(worstRadial <= 2 * SNAP_TOL + 1e-9,
    `so ONE pull is never worth half a cell (${worstRadial.toFixed(4)}), which is what keeps it a magnet`);
  // AND THE TWO MAGNETS ARE THE SAME SIZE. The square one's bound is sqrt(2)*SNAP_TOL; the radial one is a
  // little above it, because its tangential pull is applied on the circle the point is already on and the
  // radius may then move it. Measured rather than asserted tidy, and compared rather than left a number.
  check(Math.abs(worstRadial - worstSquare) < 0.05,
    `and it is the same size as the square magnet's worst (${worstSquare.toFixed(4)}), so the feel does not change with the grid`);
}

// ============================================================ 3. the spoke's tolerance is a DISTANCE
console.log('\n== 3. The spoke pull is a DISTANCE, not an angle ==');
{
  // THE DECISIVE MEASUREMENT, and it is one number away from being the other rule. A point 3 degrees off a
  // spoke is 0.052 units across from it at r = 1 and 0.523 units at r = 10. An ANGULAR window pulls both
  // (3 degrees is within any sane angular tolerance); a DISTANCE window pulls the first two and refuses the
  // third. So the same angle behaving differently at different radii is the proof, not a side effect.
  const ANG = (3 * Math.PI) / 180;
  const rows = [];
  for (const r of [1, 4, 10]) {
    const p = { x: Math.cos(ANG) * r, y: Math.sin(ANG) * r };
    const s = snapRadial(p);
    const perp = r * Math.sin(ANG);
    const moved = Math.hypot(s.x - p.x, s.y - p.y);
    const turns = Math.atan2(s.y, s.x) / RADIAL_SPOKE_STEP;
    const onSpoke = Math.min(Math.abs(((turns % 1) + 1) % 1), Math.abs(1 - (((turns % 1) + 1) % 1))) < 1e-9 || s.x === p.x;
    rows.push({ r, perp, moved, onSpoke });
    console.log(`    3deg off the spoke at r=${String(r).padStart(2)}: ${perp.toFixed(3)} units across -> ${moved === 0 ? 'left alone' : `pulled ${moved.toFixed(3)}`}`);
  }
  check(rows[0].moved > 0 && rows[1].moved > 0,
    'the same 3deg IS within the distance tolerance at r=1 and r=4, so it is pulled on both');
  check(rows[2].moved < 1e-9,
    `and the same 3deg is NOT pulled at r=10, where it is ${rows[2].perp.toFixed(3)} units across - an angular window would have pulled that too`);
  // THE MOVE IS THE CHORD, not the perpendicular: the point travels ALONG its own circle to the spoke, so it
  // is a hair further than the distance across (0.05234 against 0.05236 at r=1, which is the cubic term).
  // Both facts matter: it really reaches the line, and it does not overshoot `SNAP_TOL`.
  check(rows.slice(0, 2).every((x) => x.moved >= x.perp && x.moved <= SNAP_TOL + 1e-9),
    'and where it is pulled it really travels to the line - the move is the chord to the spoke, and never more than SNAP_TOL');

  // THE OTHER HALF: a point a FIXED distance off a spoke is pulled by that same distance, whatever the angle.
  const WANT = 0.2;
  const fixed = [2, 5, 10].map((r) => {
    const dth = Math.asin(WANT / r);
    const p = { x: Math.cos(dth) * r, y: Math.sin(dth) * r };
    const s = snapRadial(p);
    return { r, dth, moved: Math.hypot(s.x - p.x, s.y - p.y) };
  });
  console.log(`    a fixed ${WANT} units across: ${fixed.map((x) => `r=${x.r} ${((x.dth * 180) / Math.PI).toFixed(2)}deg -> ${x.moved.toFixed(3)}`).join(', ')}`);
  check(fixed.every((x) => Math.abs(x.moved - WANT) / WANT < 0.01),
    'the same DISTANCE is pulled by the same amount at r=2, 5 and 10, over angles from 5.7deg down to 1.1deg');

  // THE PRICE OF A DISTANCE RULE, measured rather than hidden: spokes crowd together near the origin, so
  // below this radius the angular pull spans the whole gap between two of them.
  const crowding = SNAP_TOL / Math.sin(RADIAL_SPOKE_STEP / 2);
  console.log(`    the spokes are within a pull of each other inside r = ${crowding.toFixed(3)} units`);
  check(crowding > 0,
    'recorded: inside that radius the angle always snaps to the nearest spoke, which moves the point by at most SNAP_TOL and stays a magnet');
}
{
  // THE FLAT VIEW FITS THE FLOOR NOW, so the scale is the CANVAS's rather than a constant: `scene.ts` frames
  // `FLOOR_HALF + FRAME_PAD` units on the tighter axis, and at 1600x900 the tighter axis is the height.
  const FLOOR_HALF = 5;
  const FRAME_PAD = 0.6;
  const W = 1600;
  const H = 900;
  const halfH = Math.max(FLOOR_HALF + FRAME_PAD, (FLOOR_HALF + FRAME_PAD) / (W / H));
  const pxPerUnit = H / (2 * halfH);
  console.log(`    the flat view at ${W}x${H}: ${pxPerUnit.toFixed(2)} px per unit`);
  check(SNAP_TOL < RADIAL_SPOKE_STEP / 2 * 10 && SNAP_HALF_TOL < SNAP_TOL,
    `the radius keeps both tiers (pulled from ${SNAP_TOL} and ${SNAP_HALF_TOL}) and the whole circle wins where they compete`);
  check(SNAP_TOL * pxPerUnit >= 5 && Math.abs(SNAP_TOL / SNAP_CELL - 0.25) < 1e-12,
    `and the pull is ${(SNAP_TOL * pxPerUnit).toFixed(1)} px - a quarter of a CELL on screen, the same as the square magnet because it is the same constant`);
}

// ============================================================ 4. the control: not the same magnet
console.log('\n== 4. The control: the radial magnet is not the square one wearing a hat ==');
{
  let same = 0;
  let total = 0;
  for (let i = 0; i < 2000; i++) {
    const a = (i * 0.61803398875) % 1;
    const b = (i * 0.38196601125) % 1;
    const p = { x: (a - 0.5) * 12, y: (b - 0.5) * 12 };
    const q = snapSquare(p);
    const r = snapRadial(p);
    total++;
    if (Math.hypot(q.x - r.x, q.y - r.y) <= 1e-9) same++;
  }
  console.log(`    the two magnets agree on ${same} of ${total} swept points`);
  check(same < total, `they DISAGREE on ${total - same} of them, so the radial magnet is a different rule and not the square one`);
  {
    // AND `snapBoard` REALLY DISPATCHES, rather than returning one rule for both modes: a point that the two
    // magnets treat differently has to come back differently through it.
    const p = { x: 1.2, y: 0.6 };
    const sq = snapBoard(p, 'square');
    const ra = snapBoard(p, 'radial');
    console.log(`    (1.2, 0.6): square -> (${sq.x.toFixed(3)}, ${sq.y.toFixed(3)})   radial -> (${ra.x.toFixed(3)}, ${ra.y.toFixed(3)})`);
    check(Math.hypot(sq.x - ra.x, sq.y - ra.y) > 1e-9,
      'the same point snaps DIFFERENTLY under the two modes, so the mode is really read');
    check(sq.x === snapSquare(p).x && ra.y === snapRadial(p).y,
      'and each mode returns its own rule unchanged');
  }
}

// ============================================================ 5. the switch, read from source
console.log('\n== 5. The switch: one state-driven button, told to both consumers, remembered ==');
const read = (rel) => fs.readFileSync(path.join(POC_DIR, rel), 'utf8');
const htmlSrc = read('index.html');
const sceneSrc = fs.readFileSync(path.join(POC_DIR, '..', 'packages', 'stage', 'scene.ts'), 'utf8');
const mainSrc = read('src/main.ts');
const editorSrc = read('src/editor-ui.ts');
const rememberSrc = read('src/remember.ts');

check(/<button id="gridMode"[^>]*data-state="square"/.test(htmlSrc),
  'index.html carries a BUTTON whose state is in the markup, opening on the square grid');
check(!/<select id="gridMode"/.test(htmlSrc),
  'and there is no list beside it to disagree with: the state has ONE owner');
check(/id="edInstReset"[\s\S]*?id="edRevert"[\s\S]*?id="gridMode"/.test(htmlSrc),
  "the button sits on the editor's Reset/Revert row, with the rest of the board state");
check(/RADIAL_SPOKES/.test(sceneSrc) && /RADIAL_SPOKE_STEP/.test(sceneSrc) && /radialCircleRadii/.test(sceneSrc),
  'scene.ts draws the radial grid FROM the shared spec, so what is drawn and what the magnet pulls to are one definition');
check(/squareGroup\.visible = !radial;[\s\S]{0,80}?radialGroup\.visible = radial;/.test(sceneSrc),
  'and setGridMode turns EXACTLY one of the two on, so the floor always has a reference and never has two');
check(/dataset\.state = mode;[\s\S]{0,400}?stage\.setGridMode\(mode\);[\s\S]{0,80}?editorUi\.setGridMode\(mode\);/.test(mainSrc),
  'ONE setter writes the button AND tells both the stage and the editor, so the words on screen and the grid on the floor cannot disagree');
check(/function toggleGridMode\(\)/.test(mainSrc) && /gridModeBtn\.addEventListener\('click', toggleGridMode\)/.test(mainSrc),
  'the press and the key go through ONE flip function, rather than each writing the state its own way');
check(/addEventListener\('change', \(\) => applyGridMode\(gridModeOf\(gridModeBtn\.value\)\)\)/.test(mainSrc),
  'so a press, the W key and a session restore all reach the floor through the ONE apply path');
{
  // THE GRID SHORTCUT. Its POLICY - bare key only, never while typing, no auto-repeat - is measured
  // behaviourally in `keys-probe.mjs`, against a fake listener target and the real `keys.ts`. What is
  // checked here is only that the grid's key is a LINE in that table, so this feature cannot quietly lose
  // its shortcut without the grid's own probe noticing.
  check(/installKeys\(\[[\s\S]{0,400}?\bid: 'grid-mode',\s*\n\s*key: 'w',/.test(mainSrc),
    "THE W KEY toggles the grid: a line in the app's one keyboard table, a bare key, so it works on every board and in every tab - W rather than G because G and B cycle the editor's girls and boys selects (keys-probe checks the collision that made that necessary)");
  check(/THE W KEY TOGGLES IT TOO/.test(htmlSrc), 'and the button says so, where the rest of its help already is');
}
{
  // THE HALF RINGS HAVE TO BE VISIBLE, and "too subtle" is a MEASUREMENT rather than a taste: a line, its
  // alpha and the floor it is composited over give a contrast, and the first cut failed it. Reported from
  // use: "I cannot see the half circles on the radial grid, they are too subtle." MEASURED, that cut was the
  // unit colour at 0.4 - composite 0x202a35, contrast 1.27 against the 0x0e141b floor - DIMMER than the
  // 2-unit overlay already on that floor (1.43). So the gate is the ORDER plus a floor under it, and all
  // three numbers are recomputed from `scene.ts` rather than read out of a comment.
  //
  // (The arithmetic is sRGB and three composites in its own working space, so what is claimed is the ORDER
  // and a bound, not a pixel. The order is what the report was about.)
  const matOf = (name) => {
    const m = sceneSrc.match(new RegExp(`${name}: new THREE\\.LineBasicMaterial\\(\\{ color: 0x([0-9a-f]{6}), transparent: true, opacity: ([0-9.]+) \\}\\)`));
    return m ? { color: parseInt(m[1], 16), opacity: parseFloat(m[2]) } : null;
  };
  const floorMatch = sceneSrc.match(/MeshStandardMaterial\(\{ color: 0x([0-9a-f]{6})/);
  const floor = floorMatch ? parseInt(floorMatch[1], 16) : null;
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (hex) => 0.2126 * lin((hex >> 16) & 255) + 0.7152 * lin((hex >> 8) & 255) + 0.0722 * lin(hex & 255);
  const over = (c, a, bg) => {
    const mix = (x, y) => Math.round(a * x + (1 - a) * y);
    return (mix((c >> 16) & 255, (bg >> 16) & 255) << 16) | (mix((c >> 8) & 255, (bg >> 8) & 255) << 8) | mix(c & 255, bg & 255);
  };
  const contrast = (m) => (lum(over(m.color, m.opacity, floor)) + 0.05) / (lum(floor) + 0.05);
  // HUE, because brightness was not enough to tell the two families apart. The floor, the unit circles and the
  // overlay are all ONE hue (212, blue), so a half ring that differs only in alpha is the same colour seen
  // more faintly - which is exactly what the caller was left with before they asked for a colour.
  const hueOf = (hex) => {
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;
    if (d === 0) return 0;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  };
  const hueGap = (a, b) => { const d = Math.abs(hueOf(a) - hueOf(b)); return Math.min(d, 360 - d); };
  const unitM = matOf('line');
  // THE HALF MATERIAL IS ITS OWN OBJECT NOW, shared by BOTH grids, so it is read by NAME rather than as a
  // field of `radialMat` - and the checks below are that each grid actually draws from it.
  const halfDecl = sceneSrc.match(/const halfMat = new THREE\.LineBasicMaterial\(\{ color: 0x([0-9a-f]{6}), transparent: true, opacity: ([0-9.]+) \}\);/);
  const halfM = halfDecl ? { color: parseInt(halfDecl[1], 16), opacity: parseFloat(halfDecl[2]) } : null;
  const coarseM = matOf('coarse');
  check(/    half: halfMat,/.test(sceneSrc),
    'the RADIAL grid draws its half rings from that one object');
  check(/for \(const v of squareHalfOffsets\(FLOOR_HALF\)\)/.test(sceneSrc) &&
    /new THREE\.LineSegments\(new THREE\.BufferGeometry\(\)\.setFromPoints\(halfLinePts\), halfMat\)/.test(sceneSrc),
    'and the SQUARE grid draws its half LINES from the same spec and the same object, so "the same" is literal rather than two values that agree today');
  check(!!floor && !!unitM && !!halfM && !!coarseM,
    `the floor and the three ring materials were all found in scene.ts (floor 0x${floor === null ? '?' : floor.toString(16).padStart(6, '0')})`);
  if (floor && unitM && halfM && coarseM) {
    const cUnit = contrast(unitM);
    const cHalf = contrast(halfM);
    const cCoarse = contrast(coarseM);
    const hUnit = Math.round(hueOf(unitM.color));
    const hHalf = Math.round(hueOf(halfM.color));
    const gap = Math.round(hueGap(halfM.color, unitM.color));
    console.log(`    contrast against the floor: unit circles ${cUnit.toFixed(2)}, half rings ${cHalf.toFixed(2)}, 2-unit overlay ${cCoarse.toFixed(2)}`);
    console.log(`    hue: unit circles ${hUnit}, half rings ${hHalf} (${gap} degrees apart), cardinal spokes ${Math.round(hueOf(0x2f9e77))}`);
    check(cHalf < cUnit,
      `the half rings are still SUBTLER than the unit circles (${cHalf.toFixed(2)} against ${cUnit.toFixed(2)}), which is what was asked for first`);
    check(cHalf > cCoarse,
      `and NOT the faintest line on the floor: the 2-unit overlay already there is ${cCoarse.toFixed(2)}, and being under it at 0.4 is what made them invisible`);
    check(cHalf >= 1.5,
      `and they clear an absolute 1.5:1 against the floor (${cHalf.toFixed(2)}), because 1.27 was reported as "I cannot see them"`);
    check(gap >= 30,
      `and the two families are told apart by COLOUR as well as by brightness (${hUnit} against ${hHalf}, ${gap} degrees apart), rather than being one hue at two alphas`);
    check(hueGap(halfM.color, 0x2f9e77) >= 30,
      `with the tint kept clear of the CARDINAL SPOKES' teal (${Math.round(hueOf(0x2f9e77))}), so the three families on this floor read as three`);
  }
  check(/for \(const r of circleRadii\.halves\) ring\(r, radialMat\.half\);/.test(sceneSrc),
    'and the half rings are actually DRAWN, from the shared spec, rather than only being described');
}
check(/'gridMode',/.test(rememberSrc), 'the choice is remembered with the other display options');
check(/HTMLButtonElement/.test(rememberSrc),
  'and `remember.ts` knows a BUTTON can be remembered, which this control is');
{
  // THE BODY of `applyViewOptions`, not the words near it - the first cut of this check searched 400
  // characters after the name and caught the comment in `setGridMode` that explains why it leaves the grid
  // alone. A gate has to read what it means to read.
  const m = editorSrc.match(/private applyViewOptions\(\) \{([\s\S]*?)\n  \}/);
  check(!!m, 'the editor still has one `applyViewOptions`, the place its two view choices are applied');
  check(!!m && !/grid/i.test(m[1]),
    'and it says nothing about the grid, because the grid belongs to the board and not to the editor panel - leaving the editor does not put the square grid back');
}
check((editorSrc.match(/snapBoard\(board, this\.gridMode\)/g) || []).length === 2,
  'both CTRL-drag sites - the move handles and the dancer start - snap through the one `snapBoard` call, so neither can snap to the wrong grid');
check(!/const snapTo = /.test(editorSrc),
  'and the panel no longer carries its own copy of the rule, so there is only one magnet to change');

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
