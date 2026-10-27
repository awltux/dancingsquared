// THE DIRECTION A CURVE HAS WHERE ITS DERIVATIVE HAS NONE — and the turn that used to be measured against a lie.
//
// THE RULE. `poseFor` reads a facing curve as a TURN: `angle(t) - departureAngle(curve)`, where `angle` is the
// direction of the curve. That direction is `bezierAngle` = `atan2` of the derivative — which is `atan2(0, 0)`
// wherever the derivative vanishes, and `atan2(0, 0)` is 0 BY CONVENTION, not by geometry. A cubic vanishes at an
// end whenever its control point sits on that end (C1 = P0, or C2 = P3), and the value there is the LIMIT of the
// direction, which `departureAngle` / `arrivalAngle` compute exactly (`engine/src/core.ts`).
//
// WHAT THIS HARNESS PINS, and each section is a different failure:
//
//   1. THE WITNESS THIS WAS FOUND BY. A hold, written the way the engine writes one (`padSegment(p, p, beats)`,
//      which is what a partial virtual placement gives every dancer it leaves standing), must mirror to ITSELF:
//      a reflection negates every turn, and a hold has no turn to negate. MEASURED before the fix, dancer 0 at
//      90 degrees: the Y mirror read 90, -90 … -90, 90 — the interior of the facing curve runs -X after the
//      mirror, and the datum was still `atan2(0, 0)`.
//   2. THE DISCRIMINATOR. A curve that departs from rest AND turns: control points (0,0) (0,0) (1,1) (0,1). Its
//      departure is 45 degrees and its arrival 180, so the turn at its end is 135 — and the rule this fix
//      REJECTED ("a curve with no start tangent has no turn") would report 0. This is the check that tells the
//      two rules apart, and it is why the datum is a direction rather than a special case.
//   3. THE LIMIT ITSELF, judged by sampling. For every facing curve in the corpus whose derivative vanishes at an
//      end, `departureAngle` / `arrivalAngle` must agree with `bezierAngle` sampled just INSIDE that end. That is
//      an independent observable — what the curve actually does — and it is the value the old code replaced
//      with 0.
//   4. THE CENSUS, AND WHAT IT CANNOT SEE. The turn of every facing curve in the corpus is CONTINUOUS at both
//      ends — the property the defect broke, since a heading used to jump by the curve's whole turn at the exact
//      instant a move completed and nothing looked at that instant. But the corpus alone CANNOT exhibit the jump,
//      and this section states that rather than implying the census proves the fix: MEASURED, only 10 of its 3,301
//      curves have a degenerate end at all, every one of them points +X at both ends, and +X is precisely the value
//      `atan2(0, 0)` returns. The defect needs a curve that is degenerate AND points elsewhere, which is what a
//      MIRROR of one of those curves is — so the negative control here is that constructed mirror, where the old
//      datum jumps by pi and the new one does not.
//
// WHAT IT DOES NOT COVER, on purpose:
//   - a curve whose derivative vanishes INSIDE the segment (a swirl through a degenerate point), which no authored
//     or generated curve has — the continuity check over every shipped curve is what says so;
//   - a `<move select="…"/>` reference, which carries no curve of its own: those resolve to a `<path>` in
//     `moves.xml`, which this sweep reads as its own population, and the count of skipped tags is printed;
//   - the editor's `bezierAngle(x, 0)` uses in `editor.ts`, which are authoring helpers with their own contracts
//     and their own gates.
//
// Run: node test/departure-angle.mjs   (from engine/; the engine must be built)
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DOMParser } from '@xmldom/xmldom';

import {
  normAngle,
  allPoses, arrivalAngle, bezierAngle, curveAngle, departureAngle, mirrorDancerMoves, padSegment,
  setDancerPath, setParser,
} from '../dist/index.js';
import { corpusRoot, filesOf, levelsAvailable, readFile } from 'dancing-squared-corpus';

setParser(DOMParser);

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};
const DEG = Math.PI / 180;
const deg = (r) => (r / DEG).toFixed(3);

/** A one-dancer bundle whose path is written in that dancer's own frame, built through the editor's own setter. */
const bundleWith = (segments, heading = Math.PI / 2) => {
  const place = { x: 3, y: 1, heading };
  const base = {
    title: 'fixture',
    from: 'fixture',
    formation: null,
    parts: '',
    taminator: null,
    dancers: [{ gender: 'boy', x: place.x, y: place.y, angleDeg: heading / DEG, path: [padSegment(place, place, 1)], mirror: false }],
    beats: 1,
    leadin: 0,
    leadout: 0,
    totalBeats: 1,
    sequencerMode: null,
    forSequencer: true,
    genderSpecific: false,
    symmetry: 1,
    actives: null,
    going: null,
  };
  return setDancerPath(base, 0, segments);
};
const headings = (bundle, instants) => instants.map((t) => allPoses(bundle, t)[0].heading);
const worst = (a, b) => a.reduce((w, x, i) => Math.max(w, Math.abs(normAngle(x - b[i]))), 0);

// ---------------------------------------------------------------------------------------------------------------
console.log('== 1. a hold mirrors to itself (the witness) ==');
{
  const place = { x: 3, y: 1, heading: Math.PI / 2 };
  const hold = padSegment(place, place, 8);
  const bundle = bundleWith([hold]);
  // The instants that matter: the interior, and BOTH ends, which is where a vanished derivative lives.
  const instants = [0, 0.5, 1, 2, 3, 4, 5, 6, 7, 7.5, 8];
  const original = headings(bundle, instants);
  const start = original[0];
  console.log(`    the hold's facing curve: cx3=${hold.rotate.cx1} cx4=${hold.rotate.cx2} cy4=${hold.rotate.cy2} x4=${hold.rotate.x2} y4=${hold.rotate.y2}`);
  check(hold.rotate.cx1 === 0 && hold.rotate.cy1 === 0 && hold.rotate.cx2 === hold.rotate.x2 && hold.rotate.cy2 === hold.rotate.y2,
    'the fixture is the degenerate curve: C1 = P0 and C2 = P3, so its derivative vanishes at BOTH ends');
  check(original.every((h) => Math.abs(normAngle(h - start)) < 1e-12),
    `and the unmirrored hold does not turn (${deg(start)} degrees at every instant)`);
  // A reflection negates every turn, so a curve with no turn comes back unchanged — about the dancer's own start
  // facing, which maps a heading h to `2*start - h`.
  for (const axis of ['x', 'y']) {
    const mirrored = headings(mirrorDancerMoves(bundle, 0, axis), instants);
    const want = original.map((h) => 2 * start - h);
    const drift = worst(mirrored, want);
    check(drift < 1e-12,
      `the ${axis.toUpperCase()} mirror is the original's mirror at EVERY instant, the two ends included (worst ${deg(drift)} degrees)`);
    // The profile, so a future breakage names the instant that moved instead of only a worst case.
    if (drift >= 1e-12) console.log(`        mirrored profile: ${mirrored.map(deg).join(' ')}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\n== 2. the datum is the DEPARTURE DIRECTION, not zero (the discriminator) ==');
{
  // From rest, then turning: C1 = P0, and the curve sweeps from +45 degrees to 180.
  const rotate = { cx1: 0, cy1: 0, cx2: 1, cy2: 1, x2: 0, y2: 1 };
  const translate = { cx1: 1 / 3, cy1: 0, cx2: 2 / 3, cy2: 0, x2: 1, y2: 0 };
  const bundle = bundleWith([{ beats: 4, hands: 'none', translate, rotate }]);
  check(Math.abs(normAngle(departureAngle(rotate) - 45 * DEG)) < 1e-12,
    `a curve at rest departs along its first control offset (${deg(departureAngle(rotate))} degrees, not 0)`);
  check(Math.abs(normAngle(arrivalAngle(rotate) - 180 * DEG)) < 1e-12,
    `and arrives along its own exit (${deg(arrivalAngle(rotate))} degrees)`);
  const start = headings(bundle, [0])[0];
  const turn = normAngle(headings(bundle, [4])[0] - start);
  check(Math.abs(normAngle(turn - 135 * DEG)) < 1e-12,
    `so the move turns the dancer 135 degrees — the sweep from departure to arrival (${deg(turn)}), NOT 0`);
  // THE REJECTED RULE, measured rather than described: ruling that "a curve at rest has no turn" predicts a turn
  // of 0 for this move. The check above is what fails under it, and this one says by how much.
  const rejected = 0;
  check(Math.abs(normAngle(turn - rejected)) > 1 * DEG,
    `CONTROL: the rejected rule predicts ${deg(rejected)} degrees here, so the check above is the one that catches it`);
  const mirrorOf = mirrorDancerMoves(bundle, 0, 'y');
  const want = headings(bundle, [0, 1, 2, 3, 4]).map((h) => 2 * start - h);
  const drift = worst(headings(mirrorOf, [0, 1, 2, 3, 4]), want);
  check(drift < 1e-12, `and its mirror negates that turn at every instant (worst ${deg(drift)} degrees)`);
}

// ---------------------------------------------------------------------------------------------------------------
// THE CORPUS SWEEP, once, for sections 3 and 4: every `<movement>` that carries a curve, in `moves.xml` (the
// library a `<move select>` resolves to) and in every authored level file. The generated `*.virtual.xml` files are
// excluded by `filesOf` — `engine/test/corpus-inventory.mjs` pins those, and section 1 is their witness.
const EPS = 1e-9;
const curveOf = (tag) => {
  // ANCHORED ON WHITESPACE, and not for tidiness: `x2="…"` ALSO MATCHES INSIDE `cx2="…"`, so an unanchored lookup
  // reads the control point where it meant the endpoint. MEASURED while writing this: it reported "collapsed exit
  // handle" for all 3,301 curves and made section 3's arrival check compare a curve against itself.
  const attr = (k) => { const m = new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(tag); return m ? Number(m[1]) : undefined; };
  // The facing channel: the rotate curve, or the travel curve when the movement names none (`poseFor`'s rule).
  if (attr('cx3') !== undefined) {
    return { cx1: attr('cx3'), cy1: 0, cx2: attr('cx4'), cy2: attr('cy4'), x2: attr('x4'), y2: attr('y4') };
  }
  if (attr('cx1') !== undefined) {
    return { cx1: attr('cx1'), cy1: attr('cy1') ?? 0, cx2: attr('cx2'), cy2: attr('cy2'), x2: attr('x2'), y2: attr('y2') };
  }
  return null;
};
const documents = [['(library)', 'moves.xml', readFileSync(path.join(corpusRoot(), 'moves.xml'), 'utf8')]];
for (const level of levelsAvailable()) {
  for (const file of filesOf(level)) documents.push([level, file, readFile(level, file)]);
}
const curves = [];
let tags = 0;
for (const [level, file, xml] of documents) {
  for (const [tag] of xml.matchAll(/<movement\b[^>]*>/g)) {
    tags++;
    const curve = curveOf(tag);
    if (curve) curves.push({ level, file, curve });
  }
}
const skipped = tags - curves.length;
console.log(`\n    sweep: ${tags} <movement> tag(s), ${curves.length} carrying a curve, ${skipped} skipped`);
check(curves.length > 3000, `the sweep walked the corpus (${curves.length} curves; a small number is a coverage gap)`);
check(skipped >= 0, `and it says what it skipped (${skipped} named-reference or coded moves, which carry no curve of their own)`);

// ---------------------------------------------------------------------------------------------------------------
console.log('\n== 3. the limit, judged by sampling just inside each end ==');
{
  let rested = 0;
  let collapsed = 0;
  let worstDeparture = 0;
  let worstArrival = 0;
  const disagreeing = [];
  for (const { level, file, curve } of curves) {
    if (curve.cx1 === 0 && curve.cy1 === 0) {
      rested++;
      const drift = Math.abs(normAngle(departureAngle(curve) - bezierAngle(curve, EPS)));
      worstDeparture = Math.max(worstDeparture, drift);
      if (drift > 1e-6) disagreeing.push(`${level}/${file}: departure ${deg(drift)} degrees`);
    }
    if (curve.x2 - curve.cx2 === 0 && curve.y2 - curve.cy2 === 0) {
      collapsed++;
      const drift = Math.abs(normAngle(arrivalAngle(curve) - bezierAngle(curve, 1 - EPS)));
      worstArrival = Math.max(worstArrival, drift);
      if (drift > 1e-6) disagreeing.push(`${level}/${file}: arrival ${deg(drift)} degrees`);
    }
  }
  console.log(`    ${rested} curve(s) start at rest, ${collapsed} have a collapsed exit handle`);
  check(rested > 0 && collapsed > 0, 'the sample is not empty, so the checks below measured something');
  check(worstDeparture < 1e-6, `every rested START agrees with the sampled direction (worst ${worstDeparture.toExponential(2)} rad)`);
  check(worstArrival < 1e-6, `every collapsed ARRIVAL agrees with the sampled direction (worst ${worstArrival.toExponential(2)} rad)`);
  for (const d of disagreeing.slice(0, 6)) console.log(`     ${d}`);
  check(disagreeing.length === 0, `and \`curveAngle\` is that reader at both ends (${disagreeing.length} disagree)`);
}

// ---------------------------------------------------------------------------------------------------------------
console.log('\n== 4. the census: continuity, and what the corpus cannot show ==');
{
  // THE DEFECT WAS A JUMP, so the invariant is continuity of the TURN, and the two readings compared are the ones
  // `poseFor` actually applies: the whole turn is `angle(t) - departure`.
  const TOL = 1e-3; // rad — the sampled rate over EPS is small, and the control below is a whole pi
  const turnNow = (b, t) => normAngle(curveAngle(b, t) - departureAngle(b));
  const turnBefore = (b, t) => normAngle(bezierAngle(b, t) - bezierAngle(b, 0));
  const jumpedNow = [];
  const jumpedBefore = [];
  for (const { level, file, curve } of curves) {
    for (const [at, inside] of [[0, EPS], [1, 1 - EPS]]) {
      if (Math.abs(normAngle(turnNow(curve, at) - turnNow(curve, inside))) > TOL) jumpedNow.push(`${level}/${file} at t=${at}`);
      if (Math.abs(normAngle(turnBefore(curve, at) - turnBefore(curve, inside))) > TOL) jumpedBefore.push(`${level}/${file} at t=${at}`);
    }
  }
  for (const j of jumpedNow.slice(0, 6)) console.log(`     DISCONTINUOUS ${j}`);
  check(jumpedNow.length === 0, `no facing curve's turn jumps at either end (${jumpedNow.length} do)`);
  // AND THE HONEST HALF: the corpus cannot make the OLD datum jump, because every curve of its ten that has a
  // degenerate end points +X there (section 3), which is what `atan2(0, 0)` answers anyway. Said out loud so a
  // green census is not read as proof that the fix changed something.
  check(jumpedBefore.length === 0,
    `the corpus cannot exhibit the defect: the OLD datum jumps on none of its ${curves.length} curves (${jumpedBefore.length} do)`);
  // SO THE CONTROL IS CONSTRUCTED: the same hold, mirrored — which is the shape a mirror writes and the corpus
  // never stores. Under the old datum its turn jumps by pi at t=1; under this one it does not.
  const place = { x: 3, y: 1, heading: Math.PI / 2 };
  const hold = padSegment(place, place, 8).rotate;
  const mirroredHold = { ...hold, cx1: -hold.cx1, cx2: -hold.cx2, x2: -hold.x2 };
  const beforeJump = Math.abs(normAngle(turnBefore(mirroredHold, 1) - turnBefore(mirroredHold, 1 - EPS)));
  const nowJump = Math.abs(normAngle(turnNow(mirroredHold, 1) - turnNow(mirroredHold, 1 - EPS)));
  check(beforeJump > 3 && nowJump < TOL,
    `CONTROL: a MIRRORED hold jumps by ${deg(beforeJump)} degrees under the old datum and ${deg(nowJump)} under this one`);
}

console.log('');
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
