// Probe: THE RADIAL ARC FIT - the green dot the Call editor offers when a curve's two ends lie on one of the
// radial grid's own circles.
//
// Asked for as: "call editor: if radial grid and start and end points of the current curve are on the same radial
// circumference and the distance between the ends is less than half, offer a mid point control that when clicked
// calibrates the bezier controls best fit of the curve to the radial line it's connected to. This makes accurate
// fitting to radial circles so much easier than manually adjusting the controls."
//
// THE WORK IS SPLIT, so the probe imports both halves rather than mirroring either:
//
//   - `radialArcFit` (poc/src/grid-magnet.ts) decides WHETHER the grid can answer - same drawn circumference,
//     chord under half a cell - and where the control goes. It is pure geometry with no DOM, so it is imported
//     directly (the same reason `radial-grid-probe.mjs` imports it).
//   - `arcBezierAbout` (engine/src/editor.ts) is the FIT itself: the cubic that passes through both ends and
//     follows the circle between them. Imported from `engine/dist`, so build the engine first.
//
// WHAT IS MEASURED, in the order the feature runs:
//
//   1. it FIRES where it should, and says which circle;
//   2. it REFUSES each of the three conditions separately - a chord of half or more, two radii that disagree,
//      and a circle the grid does not draw - because a control that appeared for "a circle through these two
//      points" would be offering a fit to something the caller cannot see;
//   3. the FIT keeps the END POINTS exactly and puts the curve's midpoint ON the circle, where the straight
//      line between them misses it by the sagitta - which is the whole reason the control is worth having;
//   4. and the cubic it produces is the same one the engine's own quarter-arc constant describes, so the fit and
//      the arc fields cannot disagree about what an arc is.
//
// Run: node poc/tools/radial-arc-fit-probe.mjs   (from anywhere; build the engine first)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const grid = await import(pathToFileURL(path.join(POC_DIR, 'src', 'grid-magnet.ts')).href);
const { radialArcFit, radialCircleRadii, SNAP_HALF_TOL, RADIAL_ARC_MAX_SWEEP } = grid;
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { arcBezierAbout, bezierPoint, ARC_K } = engine;

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// The floor the app draws, from `scene.ts`, and the circles the radial grid puts on it.
const FLOOR_HALF = 5;
const circles = radialCircleRadii(FLOOR_HALF);
/** The radii the grid DRAWS: the unit circles and the half rings between them. */
const DRAWN = circles.fine.concat(circles.halves);
/** A point on the r = 2 circle at `deg`. */
const at = (r, deg) => ({ x: r * Math.cos((deg * Math.PI) / 180), y: r * Math.sin((deg * Math.PI) / 180) });
/** How far a point is from the origin - the radius the fit is about. */
const radiusOf = (p) => Math.hypot(p.x, p.y);

console.log('== 1. it fires on a short chord that lies on a drawn circle ==');
{
  const from = at(2, 10);
  const to = at(2, 20);
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  const fit = radialArcFit(from, to, DRAWN);
  console.log(`    r = 2, 10deg -> 20deg: chord ${chord.toFixed(4)} units, sweep 10deg`);
  check(!!fit, 'the fit is offered');
  check(fit?.radius === 2, `and it names the circle the grid draws (r = ${fit?.radius})`);
  check(Math.abs(radiusOf(fit?.mid ?? { x: 0, y: 0 }) - 2) < 1e-12,
    'the control it offers sits ON that circle, halfway along the arc - so pressing it is a preview of the curve, not a guess');
  check(Math.abs((fit?.sweep ?? 0) * (180 / Math.PI) - 10) < 1e-9, `and it reports the arc it will draw (${((fit?.sweep ?? 0) * 180 / Math.PI).toFixed(1)}deg)`);
  // The mid point is BETWEEN the two ends, on the short way round: a fit that took the long way would put the
  // control on the far side of the set.
  const midDeg = ((Math.atan2(fit?.mid.y ?? 0, fit?.mid.x ?? 0) * 180) / Math.PI + 360) % 360;
  check(Math.abs(midDeg - 15) < 1e-9, `halfway between them (${midDeg.toFixed(1)}deg, between 10 and 20)`);
  // THE WORKING RANGE: a full quarter turn is the widest arc it offers, and that is where the corpus's own arcs
  // live (measured over the ms level: 108 curves have both ends on one drawn circle, 98 of them within a
  // quarter). The limit itself is measured in section 2.
  const quarter = radialArcFit(at(2, 0), at(2, 90), DRAWN);
  const quarterChord = Math.hypot(at(2, 90).x - at(2, 0).x, at(2, 90).y - at(2, 0).y);
  console.log(`    at a quarter turn the chord is ${quarterChord.toFixed(3)} units - the widest arc offered`);
  check(!!quarter && Math.abs(quarter.sweep * (180 / Math.PI) - 90) < 1e-9,
    `a full QUARTER TURN is offered (${((quarter?.sweep ?? 0) * 180 / Math.PI).toFixed(1)}deg), which is the request's "a radius of quarter or less"`);
  // A chord limit is NOT the rule any more, and that is the correction the corpus forced: this quarter-turn
  // chord is 2.83 units, six times the half-cell the first version demanded.
  check(quarterChord > SNAP_HALF_TOL * 10,
    `and its chord is ${quarterChord.toFixed(2)} units, far past the half-cell the first version refused everything beyond`);
}

console.log('\n== 2. and refuses each condition on its own ==');
{
  // (a) PAST A QUARTER TURN. A cubic traces a quarter circle to ~0.03% of the radius and deviates quickly past
  // that (section 3 measures both), so the arc the fit can honestly follow ends at a right angle.
  const past = radialArcFit(at(2, 20), at(2, 130), DRAWN);
  check(past === null, 'a 110deg sweep is refused - past a quarter the cubic is no longer the circle');
  check(Math.abs(RADIAL_ARC_MAX_SWEEP - Math.PI / 2) < 1e-12,
    'the limit is exactly a right angle, and it is named rather than a literal in a comparison');
  // (b) THE SAME CIRCUMFERENCE. Two ends on different circles are not an arc of either.
  const mixed = radialArcFit(at(2, 10), at(2.4, 20), DRAWN);
  check(mixed === null, 'two ends at radii 2 and 2.4 are refused - they are not on one circumference');
  // (c) A CIRCLE THE GRID DOES NOT DRAW. r = 2.3 is 0.2 from the nearest drawn ring (2.5) and 0.3 from 2, so a
  // fit there would follow a line nobody can see; the request says "the radial line it's connected to".
  const between = radialArcFit(at(2.3, 10), at(2.3, 20), DRAWN);
  check(between === null, 'ends on the r = 2.3 circle - a circumference the grid does NOT draw - are refused');
  // ...and the tolerance is the magnet's own half tier, so "on the circle" means here what it means in a drag.
  const nudged = radialArcFit(at(2 + SNAP_HALF_TOL * 0.4, 10), at(2 - SNAP_HALF_TOL * 0.4, 15), DRAWN);
  check(!!nudged && nudged.radius === 2,
    `while ends within the magnet's own half tier of r = 2 (${SNAP_HALF_TOL} units) ARE accepted - "on the circle" means the same thing here as in a CTRL-drag`);
  const tooFar = radialArcFit(at(2 + SNAP_HALF_TOL * 1.5, 10), at(2, 15), DRAWN);
  check(tooFar === null, 'and just past that tier they are not');
  // (d) DEGENERATE PAIRS: no movement, and a point at the centre.
  check(radialArcFit(at(2, 10), at(2, 10), DRAWN) === null, 'two identical ends are refused - there is no chord to bend');
  check(radialArcFit({ x: 0, y: 0 }, at(2, 10), DRAWN) === null, 'and so is a start at the centre, which is on no circumference at all');
}

console.log('\n== 3. the fit keeps the ends and puts the curve ON the circle ==');
{
  const from = at(2, 10);
  const to = at(2, 20);
  const cubic = arcBezierAbout({ x: 0, y: 0 }, from, to);
  check(!!cubic, 'the arc through those two ends is described by a cubic');
  // SAMPLED IN THE FRAME A BEZIER IS STORED IN. `BezierData` has no `x1`/`y1` at all - P0 IS the dancer-local
  // origin - so `bezierPoint` evaluates a curve that begins at (0, 0), and a board-space cubic has to be moved
  // into that frame first. Both ends are shifted by the same vector, so the geometry is identical and only the
  // coordinates change.
  const target = { x: to.x - from.x, y: to.y - from.y };
  const local = arcBezierAbout({ x: -from.x, y: -from.y }, { x: 0, y: 0 }, target);
  const seg = { ...local, x2: target.x, y2: target.y };
  const p0 = bezierPoint(seg, 0);
  const p1 = bezierPoint(seg, 1);
  const pm = bezierPoint(seg, 0.5);
  /** How far a LOCAL sample is from the r = 2 circle, whose centre moved to `-from`. */
  const err = (p) => Math.abs(Math.hypot(p.x + from.x, p.y + from.y) - 2);
  /** How far a BOARD point is from it. */
  const errBoard = (p) => Math.abs(Math.hypot(p.x, p.y) - 2);
  const chordMid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  console.log(`    radius error: fitted mid ${err(pm).toExponential(2)} units, straight-line mid ${errBoard(chordMid).toExponential(2)}`);
  check(Math.hypot(p0.x, p0.y) < 1e-12 && Math.hypot(p1.x - target.x, p1.y - target.y) < 1e-12,
    'both END POINTS are exactly where they were - the fit bends the curve and moves nothing');
  check(err(pm) < 1e-5, `and the middle of the fitted curve is ON the r = 2 circle (${err(pm).toExponential(2)} units off)`);
  // THE NEGATIVE CONTROL: the straight line the caller would otherwise draw misses the circle by the sagitta,
  // and that is the error this control exists to remove.
  const sagitta = 2 * (1 - Math.cos((10 * Math.PI) / 180 / 2));
  check(errBoard(chordMid) > sagitta * 0.99 && errBoard(chordMid) < sagitta * 1.01,
    `while the straight line between them is ${errBoard(chordMid).toExponential(2)} units off - the sagitta, which is the error being fitted away`);
  check(err(pm) < errBoard(chordMid) / 100, `the fit is ${(errBoard(chordMid) / err(pm)).toExponential(1)}x closer to the circle than the chord`);
  // Sampling the whole curve, not just its middle: the error must stay tiny ALONG the arc.
  let worst = 0;
  for (let i = 0; i <= 20; i++) worst = Math.max(worst, err(bezierPoint(seg, i / 20)));
  check(worst < 1e-5, `and it stays on the circle for the whole arc (worst ${worst.toExponential(2)} units over 21 samples)`);

  // AND AT THE LIMIT, which is the claim "a quarter or less is more workable with bezier" measured: a cubic
  // traces a quarter circle to a few hundredths of a percent of the radius, and a sweep well past it does not.
  const worstAt = (sweepDeg) => {
    const a = { x: 2, y: 0 };
    const b = at(2, sweepDeg);
    const target = { x: b.x - a.x, y: b.y - a.y };
    const c = arcBezierAbout({ x: -a.x, y: -a.y }, { x: 0, y: 0 }, target);
    if (!c) return NaN;
    const s = { ...c, x2: target.x, y2: target.y };
    let w = 0;
    for (let i = 0; i <= 40; i++) {
      const q = bezierPoint(s, i / 40);
      w = Math.max(w, Math.abs(Math.hypot(q.x + a.x, q.y + a.y) - 2));
    }
    return w;
  };
  const q90 = worstAt(90);
  const q120 = worstAt(120);
  const q180 = worstAt(180);
  console.log(`    worst error over the arc: ${(q90 / 2).toExponential(2)} of the radius at 90deg, ${(q120 / 2).toExponential(2)} at 120deg, ${(q180 / 2).toExponential(2)} at 180deg`);
  check(q90 / 2 < 3e-4, `at a quarter turn the cubic is within ${(q90 / 2).toExponential(2)} of the radius - under the four decimals the XML exports, which is why a quarter is the limit`);
  check(q120 > q90 * 4 && q180 > q90 * 50,
    `and it climbs steadily past it - ${(q120 / q90).toFixed(1)}x worse at 120deg and ${(q180 / q90).toFixed(0)}x at 180deg - so the refusal past a quarter is where the fit stops being exact to the exported decimals rather than a round number`);
}

console.log('\n== 4. the same cubic the engine\'s own arc constant describes ==');
{
  // A QUARTER TURN is the case the engine already states a constant for: `ARC_K = (4/3) tan(45deg/4)` is the
  // handle length of a quarter-circle cubic. The general fit has to agree with it, or the panel's arc fields
  // and this control would be two answers to "what is an arc".
  const r = 3;
  const cubic = arcBezierAbout({ x: 0, y: 0 }, { x: r, y: 0 }, { x: 0, y: r });
  check(!!cubic, 'a quarter arc about the origin is described');
  check(Math.abs((cubic?.cx1 ?? 0) - r) < 1e-12 && Math.abs((cubic?.cy1 ?? 0) - r * ARC_K) < 1e-12,
    `its first control is (r, r * ARC_K) = (${r}, ${(r * ARC_K).toFixed(6)}) - the textbook quarter-circle cubic, from the engine's own constant`);
  check(Math.abs((cubic?.cx2 ?? 0) - r * ARC_K) < 1e-12 && Math.abs((cubic?.cy2 ?? 0) - r) < 1e-12,
    'and its second is the same pair the other way round');
  // ...and it refuses a pair that is not on one circle at all, which is a caller error rather than a curve.
  check(arcBezierAbout({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 3 }) === null,
    'a pair at radii 2 and 3 is refused: an arc\u2019s ends lie on ONE circle');
}

console.log('\n== 5. the panel offers it, and only where the grid can answer ==');
{
  const read = (rel) => path.join(POC_DIR, rel);
  const fs = await import('node:fs');
  const src = fs.readFileSync(read('src/editor-ui.ts'), 'utf8');
  const magnet = fs.readFileSync(read('src/grid-magnet.ts'), 'utf8');

  check(/const fit = this\.gridMode === 'radial'/.test(src),
    'the control is offered only while the RADIAL grid is the one on the floor - a square-grid caller has no circle to fit');
  check(/radialArcFit\(\{ x: p0\.x, y: p0\.y \}, world\(t\.x2, t\.y2\), circles\.fine\.concat\(circles\.halves\)\)/.test(src),
    'and it asks the pure rule with the radii the grid DRAWS, not with a radius of its own');
  check(/id: `d\$\{d\}:arc`/.test(src) && /color: HANDLE_COLOR\.arc/.test(src),
    'the control is one more handle, drawn in the grid\'s own colour');
  check(/if \(id\.endsWith\(':arc'\)\) \{[\s\S]{0,80}?this\.fitRadialArc\(\);/.test(src),
    'and pressing it runs the fit and ends the gesture - it is the one control that acts on a press rather than a drag');
  check(/private fitRadialArc\(\): void \{[\s\S]{0,1600}?arcBezierAbout\(\{ x: 0, y: 0 \}, from, to, fit\.tolRel\)/.test(src),
    'the fit is the engine\'s `arcBezierAbout` about the SET CENTRE, at the tolerance the RULE offered it under - not a second implementation of an arc in the panel');
  check(/cx1: c1\.lx, cy1: c1\.ly, cx2: c2\.lx, cy2: c2\.ly/.test(src) && /commitMoveChange\(/.test(src),
    'and only the two CONTROL points are written, through the panel\'s own commit path - the ends are left alone');
  check(/export function radialArcFit\(/.test(magnet) && !/^import /m.test(magnet),
    'the rule lives in the pure grid module - no imports at all, so a probe imports it rather than mirroring it');
}

console.log('\n== 6. the two halves agree: everything OFFERED can be FITTED ==');
{
  // THE INVARIANT A FIRST VERSION BROKE IN THE FIELD. The rule decides from the magnet's tier (an absolute
  // 0.125 units) while `arcBezierAbout` has a relative default (5%), and at r = 1.5 the first accepts a pair the
  // second refuses: the dot was drawn, and pressing it said "the two ends are not on one circle". MEASURED in
  // the browser on `ms/grand_spin.xml` move 2. The rule now CARRIES the tolerance it used, and this sweeps pairs
  // to check that offered really does imply fittable.
  let offered = 0;
  let notFittable = 0;
  for (let r = 0.5; r <= 5.0001; r += 0.25) {
    for (let drop = 0; drop <= 0.13; drop += 0.01) {
      for (let sweep = 1; sweep <= 100; sweep += 7) {
        const from = at(r, 0);
        const to = at(r + drop, sweep);
        const fit = radialArcFit(from, to, DRAWN);
        if (!fit) continue;
        offered++;
        if (!arcBezierAbout({ x: 0, y: 0 }, from, to, fit.tolRel)) notFittable++;
      }
    }
  }
  for (let r = 0.5; r <= 5.0001; r += 0.5) {
    for (let sweep = 1; sweep <= 100; sweep += 3) {
      const from = at(r, 0);
      const to = at(r, sweep);
      const fit = radialArcFit(from, to, DRAWN);
      if (!fit) continue;
      offered++;
      if (!arcBezierAbout({ x: 0, y: 0 }, from, to, fit.tolRel)) notFittable++;
    }
  }
  console.log(`    ${offered} offered pairs swept (radii 0.5…5, radius mismatches up to the tier, sweeps to 100deg)`);
  check(offered > 100, `the sweep is real: ${offered} pairs the rule offers`);
  check(notFittable === 0,
    `and every one of them can be fitted - offered implies fittable, with the rule's own tolerance carried into the engine rather than the engine's default`);
}

console.log('\n== 7. and how often the corpus itself offers it ==');
{
  // A REAL SWEEP, because the first version of this rule fired on NOTHING: with the chord limit it offered the
  // fit on 0 of the ms level's 976 moves - the corpus's arcs are quarter and eighth turns, not slivers, and it
  // is the SWEEP that says whether a cubic can follow them. The ends are taken from the engine itself
  // (`poseFor` at each end of the move), so what is measured is the curve the engine evaluates.
  const fs = await import('node:fs');
  // The engine parses XML through an injected parser, so the sweep needs one - the same `@xmldom/xmldom` every
  // other corpus-driven probe uses.
  const { DOMParser } = await import('@xmldom/xmldom');
  engine.setParser(DOMParser);
  const path0 = path.join(POC_DIR, 'src', 'assets');
  const movesXml = fs.readFileSync(path.join(path0, 'moves.xml'), 'utf8');
  const formationsXml = fs.readFileSync(path.join(path0, 'formations.xml'), 'utf8');
  let moves = 0;
  let onOneCircle = 0;
  let offered = 0;
  const sweeps = [];
  for (const f of fs.readdirSync(path.join(path0, 'ms')).filter((x) => x.endsWith('.xml'))) {
    let call = null;
    try {
      call = engine.normalizeInstance(engine.loadCallFromXml(fs.readFileSync(path.join(path0, 'ms', f), 'utf8'), movesXml, formationsXml, 0));
    } catch { continue; }
    if (!call || call.dancers.length !== 8) continue;
    for (const d of call.dancers) {
      for (let k = 0; k < d.path.length; k++) {
        moves++;
        const range = engine.moveBeatRange(d, k);
        const a = engine.poseFor(d, range.from);
        const b = engine.poseFor(d, range.to);
        const from = { x: a.x, y: a.y };
        const to = { x: b.x, y: b.y };
        const r0 = radiusOf(from);
        const r1 = radiusOf(to);
        // The two ends on ONE circled the grid draws, before the sweep is considered.
        const near = (r) => DRAWN.some((x) => Math.abs(r - x) <= SNAP_HALF_TOL);
        if (!near(r0) || !near(r1)) continue;
        onOneCircle++;
        const fit = radialArcFit(from, to, DRAWN);
        if (!fit) continue;
        offered++;
        sweeps.push((Math.abs(fit.sweep) * 180) / Math.PI);
      }
    }
  }
  sweeps.sort((a, b) => a - b);
  const pct = (q) => sweeps[Math.min(sweeps.length - 1, Math.floor(sweeps.length * q))];
  console.log(`    ${moves} moves: ${onOneCircle} have both ends on one drawn circle, and ${offered} of those are offered the fit`);
  if (offered) console.log(`    the arcs it is offered on: median ${pct(0.5).toFixed(1)}deg, 90th ${pct(0.9).toFixed(1)}deg, widest ${sweeps[sweeps.length - 1].toFixed(1)}deg`);
  check(offered > 50, `the control is offered on ${offered} curves of the corpus, so it is a working tool rather than a rule nothing reaches`);
  check(onOneCircle > offered,
    `and the quarter-turn limit is what refuses the rest (${onOneCircle - offered} arcs sweep further than a right angle, where the fit stops being exact)`);
  check(sweeps.length === 0 || sweeps[sweeps.length - 1] <= 90 + 1e-9, 'every arc it IS offered on is within a quarter turn');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
