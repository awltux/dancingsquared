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
//   2. it REFUSES each condition separately - a sweep past a quarter (plus the slack an AUTHORED quarter turn
//      needs), two radii that disagree, a circle the grid does not draw, and a degenerate pair - because a
//      control that appeared for "a circle through these two points" would be offering a fit to something the
//      caller cannot see;
//   3. the FIT keeps the END POINTS exactly and puts the curve's midpoint ON the circle, where the straight
//      line between them misses it by the sagitta - which is the whole reason the control is worth having;
//   4. and the cubic it produces is the same one the engine's own quarter-arc constant describes, so the fit and
//      the arc fields cannot disagree about what an arc is;
//   5. the panel offers it, and only where the grid can answer - the pure rule and the engine's fit, joined;
//   6. THE REPORTED MISS: the middle curve of `Promenade Full`. Reported as "the first and last curves with the
//      control, but missing on the middle curve", and it is the corpus's own authoring losing to an exact
//      quarter-turn limit - `ms/promenade.xml`'s quarter turns measure a hair PAST a right angle;
//   7. and that a fit leaves every LATER end point where it was, which is the property a caller fitting one
//      curve of a chain is relying on. The same report offered it as a hypothesis - "unless fixing one has
//      thrown out the end points of the other curves ... this should be prevented by pinning the subsequent end
//      point" - and it was right: the fit alone carries a later end point 0.49 units off the ring, and the
//      write path's hold is what pins it.
//
// TWO CHECKS ARE RED AND THE OWNER HAS RULED: LEAVE THEM AND RECORD THE ARITHMETIC. Both come from the
// 2026-10-09 re-authoring of `ms/promenade.xml`, which put quarter-turns in the corpus measuring
// 92.452deg and 93.498deg - about 3% PAST a right angle, against the 90.0003..90.0158deg spread the
// slack was chosen for. That is roughly 200x the precision noise `RADIAL_ARC_SWEEP_TOL` exists to cover,
// so calling it noise is what the measurement no longer supports.
//
//   `:437` "every dancer-move on a ring is offered the fit" measures SOME refusals, never none: it was
//          162 of 170 when this was written and 180 of 188 the same day, because the corpus is in flight.
//          The RATIO is the finding and the count is a snapshot - do not pin the count, and do not treat
//          either as the thing to fix.
//   `:359` "the limit sits in an EMPTY band wider than twice the slack" measures a band of 1.744deg.
//
// THEY CANNOT BOTH BE SATISFIED, AND THE INTERVAL IS EMPTY - this is arithmetic on the probe's own two
// measured populations, not an opinion:
//
//     to OFFER the 93.498deg arc:      slack >= 93.498 - 90          = 3.4982deg
//     to keep band > 2 x slack:        slack <  (100.389 - 93.498)/2 = 3.4454deg
//
// (100.389deg is the narrowest arc that is genuinely wider than a quarter.) No slack satisfies both, so
// one of the two must give. WIDENING THE SLACK WAS TRIED AND MEASURED at 4deg, and it was REVERTED
// because it fixes the caller-visible half at a price the probe also measures: the ring goes to 170 of
// 170 and the limit clears the genuine arcs by 6.39deg, but the fitted cubic's error rises from 2.71e-4
// of the radius at 90deg to 3.52e-4 at 94deg - 1.299x, past this file's own 1.1x bound and past the
// 3e-4 that justifies "a quarter is the limit".
//
// SO THE QUESTION IS THE CORPUS'S, not the constant's: either those promenade quarters are INTENDED to be
// wider than a quarter, in which case the lock should offer them and two safety guarantees have to be
// restated in trade, or they are MIS-AUTHORED and the repair is in `ms/promenade.xml`. Do NOT settle it
// by re-pinning either check: both are measuring something real, which is why they disagree.
//
// Run: node poc/tools/radial-arc-fit-probe.mjs   (from anywhere; build the engine first)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const grid = await import(pathToFileURL(path.join(POC_DIR, 'src', 'grid-magnet.ts')).href);
const { radialArcFit, radialCircleRadii, SNAP_HALF_TOL, RADIAL_ARC_MAX_SWEEP, RADIAL_ARC_SWEEP_TOL } = grid;
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
  // AND A QUARTER TURN AS THE ASSETS ACTUALLY AUTHOR ONE IS OFFERED, which is the whole of `RADIAL_ARC_SWEEP_TOL`
  // and the miss section 8 reproduces: a four-decimal file cannot write an exact right angle, so `Promenade
  // Full`'s own quarters measure 90.0003…90.0158deg and a bare `> PI/2` refused them. The pair here is the worst
  // overshoot measured over the corpus (section 8), so this is the boundary the slack was chosen against.
  const authored = radialArcFit(at(2, 0), at(2, 90.708), DRAWN);
  check(!!authored, 'a 90.708deg sweep IS offered - the worst overshoot an authored quarter turn measures');
  const justOver = radialArcFit(at(2, 0), at(2, 90.708 + (RADIAL_ARC_SWEEP_TOL * 180) / Math.PI + 0.1), DRAWN);
  check(justOver === null,
    `and a sweep past a quarter plus the slack (${((RADIAL_ARC_MAX_SWEEP + RADIAL_ARC_SWEEP_TOL) * 180 / Math.PI).toFixed(1)}deg) is still refused - the slack is bounded, not removed`);
  check(Math.abs(RADIAL_ARC_SWEEP_TOL * (180 / Math.PI) - 2) < 1e-9,
    'the slack is 2deg, which section 8 measures lying inside an empty band rather than at a round number somebody liked');
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
  const q91 = worstAt(91);
  const q120 = worstAt(120);
  const q180 = worstAt(180);
  console.log(`    worst error over the arc: ${(q90 / 2).toExponential(2)} of the radius at 90deg, ${(q91 / 2).toExponential(2)} at 91deg, ${(q120 / 2).toExponential(2)} at 120deg, ${(q180 / 2).toExponential(2)} at 180deg`);
  check(q90 / 2 < 3e-4, `at a quarter turn the cubic is within ${(q90 / 2).toExponential(2)} of the radius - under the four decimals the XML exports, which is why a quarter is the limit`);
  // WHAT THE SLACK COSTS, measured rather than asserted: the widest sweep the rule now offers beyond a quarter
  // buys 7% more error than the exact quarter did, which is nothing next to the quarter's own - so the tolerance
  // is not being paid for in fidelity.
  check(q91 < q90 * 1.1,
    `and the widest sweep the slack admits, 91deg, is ${(q91 / q90).toFixed(3)}x the exact quarter's error - the slack is free`);
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

console.log('\n== 7. how often the corpus offers it, and the band the slack sits in ==');
{
  // A REAL SWEEP, because the first version of this rule fired on NOTHING: with the chord limit it offered the
  // fit on 0 of the ms level's 976 moves - the corpus's arcs are quarter and eighth turns, not slivers, and it is
  // the SWEEP that says whether a cubic can follow them. The ends are taken from the engine itself (`poseFor` at
  // each end of the move), so what is measured is the curve the engine evaluates.
  //
  // EVERY LEVEL AND EVERY TAM, because the sweep limit needs a statement about the ARC the corpus writes, and
  // the ms level's own level is the wrong place to make it: `b1`/`b2` are retired but `plus`, `a1`, `a2`, `c1`,
  // `c2`, `c3a`, `c3b` and `discovered` are not, and the narrowest genuine arc past the quarter turns out to
  // live above ms. This is the heavy section of the probe (~10 s of its run); the numbers it prints are the ones
  // `RADIAL_ARC_SWEEP_TOL` is chosen against.
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
  const levels = fs.readdirSync(path0, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'src').map((e) => e.name);
  for (const level of levels) {
    for (const f of fs.readdirSync(path.join(path0, level)).filter((x) => x.endsWith('.xml'))) {
      let variants = [];
      try {
        variants = engine.buildCallVariants(fs.readFileSync(path.join(path0, level, f), 'utf8'), movesXml, formationsXml);
      } catch { continue; }
      for (const variant of variants) {
        let call = null;
        try { call = engine.normalizeInstance(variant); } catch { continue; }
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
            // The two ends on ONE circle the grid draws, and on one circumference: the rule's own two
            // conditions, taken before the sweep is considered so the sweep is what is being measured.
            const near = (r) => DRAWN.some((x) => Math.abs(r - x) <= SNAP_HALF_TOL);
            if (!near(r0) || !near(r1) || Math.abs(r0 - r1) > SNAP_HALF_TOL) continue;
            onOneCircle++;
            const fit = radialArcFit(from, to, DRAWN);
            let sweep = (Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) / Math.PI * 180;
            while (sweep > 180) sweep -= 360;
            while (sweep < -180) sweep += 360;
            sweeps.push(Math.abs(sweep));
            if (fit) offered++;
          }
        }
      }
    }
  }
  sweeps.sort((a, b) => a - b);
  const limit = ((RADIAL_ARC_MAX_SWEEP + RADIAL_ARC_SWEEP_TOL) * 180) / Math.PI;
  // THE BAND. "Past a right angle" is two populations, not one: the authoring's noise (a quarter turn written in
  // four decimals, which lands a hair over) and the arcs that are genuinely wider than a quarter. The slack has
  // to cover the first and stay clear of the second, so the gap between them is what it is chosen in.
  const noise = sweeps.filter((s) => s > 90 && s <= limit);
  const over = sweeps.filter((s) => s > limit);
  const worstNoise = noise[noise.length - 1] ?? 0;
  const narrowestOver = over[0] ?? Infinity;
  console.log(`    ${moves} moves over ${levels.length} levels: ${onOneCircle} have both ends on one drawn circle within the tier, and ${offered} of those are offered the fit`);
  console.log(`    past a right angle: ${noise.length} are authoring noise (up to ${worstNoise.toFixed(3)}deg - a quarter turn the assets cannot write exactly), and ${over.length} are genuinely wider (from ${narrowestOver.toFixed(3)}deg)`);
  console.log(`    the empty band between them is ${(narrowestOver - worstNoise).toFixed(2)}deg wide, and the limit of ${limit.toFixed(0)}deg sits ${(limit - worstNoise).toFixed(2)}deg above the noise and ${(narrowestOver - limit).toFixed(2)}deg below the shapes`);
  check(offered > 1000, `the control is offered on ${offered} curves of the corpus, so it is a working tool rather than a rule nothing reaches`);
  check(onOneCircle > offered,
    `and some are still refused (${onOneCircle - offered} of ${onOneCircle} on-circle pairs sweep past a quarter turn plus the slack)`);
  check(noise.length > 100 && worstNoise > 90,
    `the population the slack exists for is real: ${noise.length} authored quarter turns measure past an exact right angle`);
  check(worstNoise <= limit, `and every one of them is inside the limit now (worst ${worstNoise.toFixed(3)}deg of ${limit.toFixed(0)}deg)`);
  check(narrowestOver > limit,
    `while the narrowest arc that is genuinely wider than a quarter (${narrowestOver.toFixed(3)}deg) is outside it - a slack and a shape limit are still two different things`);
  check((narrowestOver - worstNoise) > 2 * ((limit - 90)),
    `and the limit sits in an EMPTY band wider than the slack itself (${(narrowestOver - worstNoise).toFixed(1)}deg against ${(limit - 90).toFixed(1)}deg of slack), so it is not a boundary anything real is near`);
  check(sweeps.length === 0 || Math.abs(sweeps.find((s) => s > limit) ?? Infinity) === narrowestOver,
    'the corpus agrees with the rule about which side of the limit every one of those pairs falls on');
}

console.log('\n== 8. the reported miss: the middle curve of `Promenade Full` ==');
{
  // THE WITNESS. Reported as: "The central control to fit to radial curve only seems to appear on the first full
  // curve of Promenade Full. It should appear on all four of the quarter moves", and then "I just saw the first
  // and last curves with the control, but missing on the middle curve." Both readings are of the SAME authoring,
  // and the corpus is what settles it: `ms/promenade.xml` writes the promenade's quarter turns in four decimals,
  // and every one of them measures a hair PAST a right angle, so an exact quarter-turn limit offered whichever
  // of a call's quarters happened to round the right way - which is exactly "the first and the last, but not the
  // middle".
  const fs = await import('node:fs');
  const { DOMParser } = await import('@xmldom/xmldom');
  engine.setParser(DOMParser);
  const path0 = path.join(POC_DIR, 'src', 'assets');
  const movesXml = fs.readFileSync(path.join(path0, 'moves.xml'), 'utf8');
  const formationsXml = fs.readFileSync(path.join(path0, 'formations.xml'), 'utf8');
  const variants = engine.buildCallVariants(
    fs.readFileSync(path.join(path0, 'ms', 'promenade.xml'), 'utf8'), movesXml, formationsXml,
  ).filter((v) => v.title.startsWith('Promenade Full'));
  console.log(`    ${variants.length} authorings of the call: ${variants.map((v) => `"${v.title}" (${v.formationName ?? v.formation})`).join(', ')}`);
  let ringMoves = 0;
  let ringOffered = 0;
  let offRingRefused = 0;
  const overNinety = [];
  for (const variant of variants) {
    const call = engine.normalizeInstance(variant);
    // PER MOVE INDEX, ONE LINE, carrying the DISTINCT answers the dancers gave - because a promenade's dancers
    // do not all walk the same circle (the outer couple is on r = 3.5 and the inner one on 2.5), so a move's
    // verdict is a set rather than a value and printing one dancer's would be printing one dancer's.
    const rows = [];
    for (let d = 0; d < call.dancers.length; d++) {
      const dancer = call.dancers[d];
      for (let k = 0; k < dancer.path.length; k++) {
        const range = engine.moveBeatRange(dancer, k);
        const a = engine.poseFor(dancer, range.from);
        const b = engine.poseFor(dancer, range.to);
        const from = { x: a.x, y: a.y };
        const to = { x: b.x, y: b.y };
        const r0 = radiusOf(from);
        const r1 = radiusOf(to);
        let sweep = (Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) * 180 / Math.PI;
        while (sweep > 180) sweep -= 360;
        while (sweep < -180) sweep += 360;
        sweep = Math.abs(sweep);
        const fit = radialArcFit(from, to, DRAWN);
        // ON A RING means both ends on one DRAWN circle within the tier, which is the rule's own two conditions.
        const onRing = r0 > 0 && r1 > 0 && Math.abs(r0 - r1) <= SNAP_HALF_TOL
          && DRAWN.some((x) => Math.abs(r0 - x) <= SNAP_HALF_TOL);
        while (rows.length <= k) rows.push({ total: 0, offered: 0, onRing: 0, kinds: [] });
        const row = rows[k];
        row.total++;
        if (fit) row.offered++;
        if (onRing) row.onRing++;
        const kind = `r ${r0.toFixed(3)}->${r1.toFixed(3)} sweep ${sweep.toFixed(4)}deg ${fit ? 'OFFERED' : 'refused'}`;
        const seen = row.kinds.find((x) => x.kind === kind);
        if (seen) seen.n++; else row.kinds.push({ kind, n: 1 });
        if (onRing) {
          ringMoves++;
          if (fit) ringOffered++;
          if (sweep > 90) overNinety.push(sweep);
        } else if (!fit) offRingRefused++;
      }
    }
    console.log(`    "${variant.title}" / ${variant.formationName ?? variant.formation}`);
    rows.forEach((row, k) => console.log(
      `      move ${k}: ${row.offered}/${row.total} dancers offered, ${row.onRing} on a ring - ${row.kinds.map((x) => `${x.n}x ${x.kind}`).join('; ')}`,
    ));
  }
  overNinety.sort((a, b) => a - b);
  console.log(`    over the three authorings: ${ringMoves} dancer-moves are ON a ring, ${ringOffered} of them are offered the fit, ${overNinety.length} measure past an exact right angle (worst ${overNinety[overNinety.length - 1]?.toFixed(4)}deg), and ${offRingRefused} off-ring moves are refused`);
  // WHAT THE EXACT LIMIT OFFERED, counted rather than remembered: every over-90 pair here is inside the slack, so
  // the difference IS the old rule's answer - the "first and the last, but not the middle" the report saw.
  console.log(`      under the bare \`> PI/2\` the same call was offered ${ringMoves - overNinety.length} of them`);
  check(overNinety.length >= 5,
    `the corpus's own quarter turns DO measure past an exact right angle (${overNinety.length} of them here), which is the whole of the miss`);
  check(ringOffered === ringMoves,
    `and every dancer-move on a ring is offered the fit (${ringOffered} of ${ringMoves}) - the "middle curve" is no longer the odd one out`);
  check(offRingRefused > 0,
    `while the moves that enter and leave the ring are still refused (${offRingRefused} of them): their two ends are not on one circle, so no fit exists - the first move of the Facing Couples Far path runs from r = 3.162 out at the formation's corner to r = 2.500 on the ring`);
}

console.log('\n== 9. and a fit leaves every later end point exactly where it was ==');
{
  // THE HYPOTHESIS THE REPORT OFFERED: "unless fixing one has thrown out the end points of the other curves, so
  // they no longer align with the radius. If so, this should be prevented by pinning the subsequent end point
  // while adjusting the controls." It was RIGHT, and this is the measurement of it. A move's end IS the next
  // move's start, and `poseFor` composes each move in the frame `angle(facing, 1) - angle(facing, 0)` turns -
  // read off the move's FACING if it has one and its TRAVEL if it has not. The fit rewrites both of a travel
  // curve's tangents, so the frame turns, so the rest of the track rotates with it and the next curve leaves the
  // ring the caller is fitting to.
  //
  // SO BOTH ARE MEASURED, in the order they happened: the write WITHOUT the hold, which is what the panel did
  // and what the report caught, and the write WITH it, which is what `foldMoveChange` does now. The hold is the
  // engine's own `holdFollowingTrace`, so this is the real compensation and not a second implementation of it.
  const fs = await import('node:fs');
  const { DOMParser } = await import('@xmldom/xmldom');
  engine.setParser(DOMParser);
  const path0 = path.join(POC_DIR, 'src', 'assets');
  const movesXml = fs.readFileSync(path.join(path0, 'moves.xml'), 'utf8');
  const formationsXml = fs.readFileSync(path.join(path0, 'formations.xml'), 'utf8');
  const variants = engine.buildCallVariants(
    fs.readFileSync(path.join(path0, 'ms', 'promenade.xml'), 'utf8'), movesXml, formationsXml,
  ).filter((v) => v.title.startsWith('Promenade Full'));
  // THE PANEL'S OWN TWO CONVERSIONS, from `editor-ui.ts`: a board point into a move's local frame and back. The
  // probe repeats them because they are the arithmetic the fit goes through on its way to the tile's numbers.
  const localToFloor = (f, lx, ly) => ({
    x: f.x + Math.cos(f.heading) * lx - Math.sin(f.heading) * ly,
    y: f.y + Math.sin(f.heading) * lx + Math.cos(f.heading) * ly,
  });
  const floorToLocal = (f, x, y) => {
    const dx = x - f.x;
    const dy = y - f.y;
    return {
      lx: Math.cos(f.heading) * dx + Math.sin(f.heading) * dy,
      ly: -Math.sin(f.heading) * dx + Math.cos(f.heading) * dy,
    };
  };
  /** Every dancer's every end point, in board coordinates - the whole chain, not just the fitted move's. */
  const endsOf = (call) => call.dancers.flatMap((d) => d.path.flatMap((_, k) => {
    const range = engine.moveBeatRange(d, k);
    const p0 = engine.poseFor(d, range.from);
    const p1 = engine.poseFor(d, range.to);
    return [p0.x, p0.y, p1.x, p1.y];
  }));
  /** How far the farthest end point moved, over every end of the call, after `step` wrote one curve. */
  const driftOf = (call, before, step) => {
    const after = step(call);
    let worst = 0;
    for (let i = 0; i * 2 + 1 < before.length; i++) {
      worst = Math.max(worst, Math.hypot(after[i * 2] - before[i * 2], after[i * 2 + 1] - before[i * 2 + 1]));
    }
    return { worst, ends: before.length / 2 };
  };
  let fitted = 0;
  let endsChecked = 0;
  let heldWrong = 0;
  let unheldWorst = 0;
  let heldWorst = 0;
  let unheldMoved = 0;
  for (const variant of variants) {
    const call = engine.normalizeInstance(variant);
    for (let d = 0; d < call.dancers.length; d++) {
      for (let k = 0; k < call.dancers[d].path.length; k++) {
        const dancer = call.dancers[d];
        const seg = dancer.path[k];
        const range = engine.moveBeatRange(dancer, k);
        const p0 = engine.poseFor(dancer, range.from);
        const from = { x: p0.x, y: p0.y };
        const to = localToFloor(p0, seg.translate.x2, seg.translate.y2);
        const fit = radialArcFit(from, to, DRAWN);
        if (!fit) continue;
        const cubic = arcBezierAbout({ x: 0, y: 0 }, from, to, fit.tolRel);
        if (!cubic) continue;
        const c1 = floorToLocal(p0, cubic.cx1, cubic.cy1);
        const c2 = floorToLocal(p0, cubic.cx2, cubic.cy2);
        // The panel's patch, in the panel's order: the two CONTROL points and nothing else.
        const patch = (s) => ({ ...s, translate: { ...s.translate, cx1: c1.lx, cy1: c1.ly, cx2: c2.lx, cy2: c2.ly } });
        // THE FRAME TURN THE FIT CAUSES, which is what the panel's guard reads and what the hold is built from.
        const turnOf = (s) => {
          const facing = s.rotate ?? s.translate;
          return engine.bezierAngle(facing, 1) - engine.bezierAngle(facing, 0);
        };
        const delta = Math.atan2(Math.sin(turnOf(patch(seg)) - turnOf(seg)), Math.cos(turnOf(patch(seg)) - turnOf(seg)));
        const before = endsOf(call);
        // (a) THE WRITE AS IT WAS: the patch alone, which is the reported defect.
        const asWas = driftOf(call, before, (c) => {
          c.dancers[d].path[k] = patch(c.dancers[d].path[k]);
          const ends = endsOf(c);
          c.dancers[d].path[k] = seg;
          return ends;
        });
        // (b) THE WRITE AS IT IS: the same patch, and the following trace held by the frame turn it caused.
        const withHold = driftOf(call, before, (c) => {
          c.dancers[d].path[k] = patch(c.dancers[d].path[k]);
          const held = delta === 0 ? c : engine.holdFollowingTrace(c, d, k, delta);
          const ends = endsOf(held);
          c.dancers[d].path[k] = seg;
          return ends;
        });
        fitted++;
        endsChecked += asWas.ends;
        if (asWas.worst > 1e-9) unheldMoved++;
        if (withHold.worst > 1e-12) heldWrong++;
        unheldWorst = Math.max(unheldWorst, asWas.worst);
        heldWorst = Math.max(heldWorst, withHold.worst);
      }
    }
  }
  console.log(`    ${fitted} fits over the promenade's three authorings, each measured against every end point of its call (${endsChecked} end points in all):`);
  console.log(`      with the fit alone (what the panel did):          the farthest end point moves ${unheldWorst.toExponential(2)} units, and ${unheldMoved} of ${fitted} fits move something`);
  console.log(`      with the following trace held (what it does now): the farthest end point moves ${heldWorst.toExponential(2)} units, and ${heldWrong} of ${fitted} fits move anything`);
  check(fitted >= 10, `the sweep is real: ${fitted} fitted curves, each one then measured against the whole chain`);
  check(endsChecked > 500, `and the comparison is a real one: ${endsChecked} end points re-evaluated`);
  check(unheldMoved > 10 && unheldWorst > 1e-2,
    `THE REPORT WAS RIGHT: the fit on its own DOES throw the later end points out - ${unheldMoved} of ${fitted} carry one up to ${unheldWorst.toFixed(4)} units, which is what took the next curve off its ring`);
  check(heldWrong === 0 && heldWorst < 1e-12,
    `and holding the trace by the frame turn the fit caused pins every one of them: the worst of ${endsChecked} end points moves ${heldWorst.toExponential(2)} units, which is the rounding of the rotation itself (11 orders below the 4th decimal the assets are written in), against ${unheldWorst.toFixed(4)} unheld - so fitting one quarter of a promenade leaves the other three on their circle`);
  // AND THE WRITE THAT MUST NOT BE COMPENSATED TWICE HOLDS ITSELF. Dragging an END POINT goes through
  // `moveCurveEnd`, which carries the exit handle as a vector, so the frame turn cannot change: the fold's delta
  // is 0 there and the hold is the identity, which is why the guard can be the angle rather than a flag saying
  // which tab the caller is on. Measured rather than argued, because "this gesture is already safe" is exactly
  // the claim that was wrong about the arc fit.
  const turnOf = (t) => engine.bezierAngle(t, 1) - engine.bezierAngle(t, 0);
  let dragged = 0;
  let worstTurn = 0;
  for (const variant of variants) {
    const call = engine.normalizeInstance(variant);
    for (const dancer of call.dancers) {
      for (const seg of dancer.path) {
        const moved = engine.moveCurveEnd(seg.translate, seg.translate.x2 + 0.37, seg.translate.y2 - 0.21);
        worstTurn = Math.max(worstTurn, Math.abs(turnOf(moved) - turnOf(seg.translate)));
        dragged++;
      }
    }
  }
  check(dragged > 20 && worstTurn < 1e-12,
    `while an END POINT drag needs no compensation at all: over ${dragged} moves of the same call, \`moveCurveEnd\` leaves the frame turn within ${worstTurn.toExponential(2)} of what it was, so the fold's delta is 0 and the hold is the identity there`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
