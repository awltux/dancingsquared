// Probe: what the FACING curve can express, and therefore what a draggable handle for it may write.
//
// The translation curve is a path on the floor, so a control point has a floor position and dragging
// it is obviously meaningful. The facing curve is not: `poseFor` reads it with `bezierAngle`, so what
// the data encodes is the DIRECTION of a tangent vector, i.e. a heading profile. Before putting
// handles on it, the questions that decide the design are about the FORMAT, and they are measured
// here rather than assumed:
//
//   1. `cy1` IS NOT IN THE XML. The rotate element carries cx3/cx4/cy4/x4/y4 - there is no cy3 - and
//      the converter hardcodes `cy1: 0`, while `callToXml` emits no cy1. So the y of the facing
//      curve's FIRST control point cannot survive a round trip. A handle that wrote it would be a
//      handle whose edit is silently thrown away on export.
//   2. WHAT THAT DOES TO THE HEADING. With cy1 = 0 the tangent at t = 0 is (3*cx1, 0) - along the
//      dancer's own +x - so every authored facing curve starts with ZERO change of heading, and cx1
//      must be positive for that to be true.
//   3. WHICH NUMBERS A DRAG MUST REACH. The tile shows cx1, cx2, cy2, x2, y2 (five fields, no cy1 -
//      the tile already mirrors the format), so a gizmo that makes "the facing controls" draggable
//      has to expose all five.
//
// THE BYTE-IDENTITY CHECK USED TO BE RED, AND IT IS NOW THE FIX. A no-op handle touch must export
// BYTE-IDENTICALLY, and it did not: `requireDancer` (`engine/src/editor.ts`) calls `normalizeInstance`
// whenever any dancer carries `mirror`, so ANY touch re-derived the mirrored dancers' start pose and
// rewrote `angle="270"` as `angle="-90"` - the SAME facing, on lines that have nothing to do with the move
// that was edited (MEASURED then: 2 of 64 exported lines differed, witness `ms/alamo_style.xml` d0 m3).
// The repair is `rfAngle` in the exporter, which writes every dancer angle canonical in [0, 360): the
// spelling is a function of the geometry rather than of which code path built the bundle. Reverting it
// turns this check red again, and `engine/test/editor.mjs`'s half-set sweep (486 calls, 481 of them
// touched) turns red with it, so the rule is gated where it lives as well as here.
//
// Run: node tools/facing-handle-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot } from 'dancing-squared-corpus';

// Resolved from THIS FILE, so the probe runs from anywhere and not only from poc/.
const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');
// Half the floor grid, so "the drawn curve stays on the board" is a number rather than an impression.
const FLOOR_HALF_ASSUMED = 5;
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const moves = engine.parseMoves(movesXml);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// ---------------------------------------------------------------- collect every facing curve
// Kept apart because they are different populations: the moves registry is 57 hand-authored shapes,
// while the call segments are what a caller actually edits (named moves resolved into place).
const registry = [];
const fromCalls = [];
for (const [name, items] of moves) {
  for (const it of items) {
    if (it.kind === 'movement' && it.seg.rotate) registry.push([`moves.xml/${name}`, it.seg.rotate]);
  }
}
const levels = ['ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
let calls = 0;
let explicitSegs = 0;
let totalSegs = 0;
const firstWithRotate = { call: null, seg: null };
for (const lv of levels) {
  const dir = path.join(corpusRoot(), lv);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.xml')) continue;
    const xml = fs.readFileSync(path.join(dir, f), 'utf8');
    if (engine.callMeta(xml).setups.length === 0) continue;
    let call;
    try {
      call = engine.loadCallFromXml(xml, movesXml, formationsXml, 0);
    } catch {
      continue;
    }
    calls++;
    call.dancers.forEach((d, di) => {
      d.path.forEach((seg, si) => {
        totalSegs++;
        if (!seg.rotate) return;
        explicitSegs++;
        fromCalls.push([`${lv}/${f} d${di} m${si}`, seg.rotate]);
        if (!firstWithRotate.call && seg.rotate.cx1 > 0) { firstWithRotate.call = { xml, name: `${lv}/${f}` }; firstWithRotate.seg = { d: di, k: si }; }
      });
    });
  }
}
const curves = [...registry, ...fromCalls];
console.log(`== Population ==`);
console.log(`    ${curves.length} facing curves: ${explicitSegs} of ${totalSegs} resolved segments carry an EXPLICIT facing, across ${calls} calls`);
console.log(`    ${registry.length} come from the moves registry itself`);

// ---------------------------------------------------------------- 1. cy1 is not in the XML
console.log(`\n== 1. cy1 is not expressible ==`);
const cy1Bad = curves.filter(([, r]) => r.cy1 !== 0);
check(cy1Bad.length === 0,
  `every facing curve has cy1 === 0 exactly (${cy1Bad.length} of ${curves.length} do not)`);

// ---------------------------------------------------------------- 2. the heading starts at 0
console.log(`\n== 2. the heading change starts at 0 ==`);
const zeros = (list) => list.filter(([, r]) => !(r.cx1 > 0));
const zeroRegistry = zeros(registry);
const zeroCalls = zeros(fromCalls);
let minCx1 = Infinity;
let minCx1Where = '';
for (const [where, r] of curves) if (r.cx1 < minCx1) { minCx1 = r.cx1; minCx1Where = where; }
console.log(`    smallest cx1 over the corpus: ${minCx1} (${minCx1Where})`);
console.log(`    cx1 === 0: ${zeroRegistry.length} of ${registry.length} registry curves, ${zeroCalls.length} of ${fromCalls.length} call segments`);
check(zeros(curves).every(([, r]) => r.cx1 === 0),
  `NO facing curve has a negative cx1 (a negative one would start the move facing 180deg backwards); ${zeros(curves).length} of ${curves.length} are exactly 0: ${[...new Set(zeros(curves).map(([w]) => w.replace(/ d\d+ m\d+$/, '')))].join(', ')}`);
// At cx1 = 0 and cy1 = 0 BOTH derivative components vanish: the tangent is the zero vector and
// atan2(0, 0) is 0, so the zero start survives the degeneracy rather than by geometry. Said out loud
// because the rail handle sits exactly ON the dancer's own spot in those cases, and because the
// degenerate ones are not rare enough to dismiss: they are 12 CALL segments, not only registry shapes.
console.log(`    cx1 === 0 in ${zeroCalls.length} call segments (sashay and lateral substitute), where the rail handle sits on the dancer's own spot`);
let worstStartDelta = 0;
for (const [, r] of curves) worstStartDelta = Math.max(worstStartDelta, Math.abs(engine.bezierAngle(r, 0)));
check(worstStartDelta === 0, 'every authored facing curve starts with a ZERO heading change');

// Cross-check the other end: the heading change at t = 1 is the direction of the last derivative
// span, which is what the user is really setting when they drag the curve's endpoint.
const spread = new Map();
for (const [, r] of curves) {
  const end = engine.bezierAngle(r, 1);
  const deg = Math.round((end * 180) / Math.PI);
  spread.set(deg, (spread.get(deg) ?? 0) + 1);
}
const top = [...spread.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log(`    heading change at the END of the move, most common (deg: count): ${top.map(([d, n]) => `${d}:${n}`).join('  ')}`);
check(spread.size > 1, `the corpus uses ${spread.size} distinct end-of-move heading changes`);

// ---------------------------------------------------------------- 3. what a drag must write
console.log(`\n== 3. the five numbers the tile shows are the five a drag must reach ==`);
const SHOWN = ['cx1', 'cx2', 'cy2', 'x2', 'y2'];
// The three points of the facing curve's control polygon, in the order the gizmo draws them:
// P0 is the origin (the dancer's own spot when the move begins) and is not a handle.
const rebuild = (r) => ({ cx1: r.cx1, cy1: 0, cx2: r.cx2, cy2: r.cy2, x2: r.x2, y2: r.y2 });
console.log(`    the tile's facing fields are exactly ${SHOWN.join(', ')} - no cy1, so the gizmo needs three points (C1 on a rail, C2, P3)`);
// A drag writes the point's own local coordinates back, so the mapping has to be the identity on the
// numbers the tile shows, or the handle and the field would disagree about what was edited.
const identityOk = curves.every(([, r]) => {
  const back = rebuild(r);
  return SHOWN.every((k) => back[k] === r[k]) && back.cy1 === 0;
});
check(identityOk, 'writing the dragged point back into the curve is the identity on all five fields, and holds cy1 at 0');

// ---------------------------------------------------------------- 4. cy1 does not survive export
console.log(`\n== 4. a cy1 != 0 edit is THROWN AWAY by the export (the reason for the rail) ==`);
{
  const { xml, name, seg } = { ...firstWithRotate.call, seg: firstWithRotate.seg };
  const call = engine.loadCallFromXml(xml, movesXml, formationsXml, 0);
  const bent = engine.setMove(call, seg.d, seg.k, {
    ...call.dancers[seg.d].path[seg.k],
    rotate: { ...call.dancers[seg.d].path[seg.k].rotate, cy1: 0.5 },
  });
  const reparse = (c) => engine.buildCall(engine.parseCallXml('<calls>\n' + engine.callToXml(c, c.from) + '\n</calls>')[0], engine.parseFormations(formationsXml), engine.parseMoves(movesXml), false);
  const d = seg.d;
  // MEASURED AT t < 1, AND THAT IS THE POINT. The heading change at t = 1 is atan2 of the LAST
  // derivative span, (x2 - cx2, y2 - cy2), which does not contain C1 at all - so a test at t = 1
  // reports "no change" for an edit that plainly changes the turn. The first version of this probe
  // measured exactly there and failed its own check.
  const moveStart = call.dancers[d].path.slice(0, seg.k).reduce((s, x) => s + x.beats, 0);
  const moveBeats = call.dancers[d].path[seg.k].beats;
  const headingOf = (c, frac) => engine.poseFor(c.dancers[d], moveStart + frac * moveBeats).heading;
  const rad2deg = (r) => (r * 180) / Math.PI;
  const bentBack = reparse(bent);
  const cleanBack = reparse(call);
  console.log(`    witness ${name}: dancer ${d}, move ${seg.k + 1} of ${call.dancers[d].path.length}`);
  let worstEdit = 0;
  let worstDiscard = 0;
  for (const frac of [0.25, 0.5, 0.75]) {
    const edited = headingOf(bent, frac) - headingOf(call, frac);
    const kept = headingOf(bentBack, frac) - headingOf(cleanBack, frac);
    worstEdit = Math.max(worstEdit, Math.abs(rad2deg(edited)));
    worstDiscard = Math.max(worstDiscard, Math.abs(rad2deg(kept)));
    console.log(`    t=${frac}: cy1=0.5 turns the dancer by ${rad2deg(edited).toFixed(4)}deg, and after export by ${rad2deg(kept).toFixed(6)}deg`);
  }
  check(worstEdit > 1e-6, `cy1 = 0.5 really does change the facing mid-move (worst ${worstEdit.toFixed(4)}deg)`);
  check(worstDiscard < 1e-9,
    `and the export DISCARDS it: the re-parsed facing is the authored one (worst ${worstDiscard.toExponential(2)}deg)`);
}

// ---------------------------------------------------------------- 5. which numbers set which end
console.log(`\n== 5. which control points set which end of the facing ==`);
{
  // The derivative is a quadratic with control points 3*C1, 3*(C2-C1), 3*(P3-C2), so:
  //   the heading change at t = 0 is the direction of C1 (zero, because cy1 = 0 and cx1 >= 0);
  //   the heading change at t = 1 is the direction of (P3 - C2) ONLY.
  // That is what makes three points the right gizmo: C2 and P3 between them set the end facing, and
  // C1 shapes only the middle. Asserted on the corpus rather than derived from the formula.
  const r = curves.find(([, c]) => c.cx2 !== c.x2 && c.cy2 !== c.y2) ?? curves[0];
  const [, c] = r;
  // Move P3 only: the end heading must follow it, the start heading must not.
  const p3 = { ...c, x2: c.x2 + 1, y2: c.y2 + 1 };
  const c2 = { ...c, cx2: c.cx2 + 1, cy2: c.cy2 + 1 };
  const c1 = { ...c, cx1: c.cx1 + 1 };
  const endOf = (x) => engine.bezierAngle(x, 1);
  const midOf = (x) => engine.bezierAngle(x, 0.5);
  check(Math.abs(endOf(c1) - endOf(c)) < 1e-12, 'C1 does not touch the heading change at t=1');
  check(Math.abs(endOf(c2) - endOf(c)) > 1e-6, 'C2 does move the heading change at t=1 (it is an end of the last derivative span)');
  check(Math.abs(endOf(p3) - endOf(c)) > 1e-6, 'P3 moves the heading change at t=1');
  check(Math.abs(midOf(c1) - midOf(c)) > 1e-6, 'C1 does shape the middle of the turn (so the rail handle is worth having)');
  check(Math.abs(engine.bezierAngle(c1, 0)) < 1e-12 && Math.abs(engine.bezierAngle(c2, 0)) < 1e-12 && Math.abs(engine.bezierAngle(p3, 0)) < 1e-12,
    'and NOTHING moves the heading change at t=0: an authored facing always starts from the dancer facing where they already face');
}

// ---------------------------------------------------------------- 6. what a drag actually writes
console.log(`\n== 6. a drag of each of the three points ==`);
{
  // THE PLACEMENT MATH IS COPIED HERE, and that bound is the honest one: `editor-ui.ts` is TypeScript
  // inside the Vite app, which cannot run in this sandbox, so this is the same rotation written twice
  // rather than the app's own function under test. What it pins is that the formula the panel uses is
  // an invertible isometry (so placing a point and reading the pointer back is the identity) and that
  // the THREE WRITE RULES the panel applies produce data the corpus can express and the export keeps.
  // The write rules themselves live in `applyHandleDrag` and are the thing a reader should check by eye.
  const world = (p0, lx, ly) => ({
    x: p0.x + Math.cos(p0.heading) * lx - Math.sin(p0.heading) * ly,
    y: p0.y + Math.sin(p0.heading) * lx + Math.cos(p0.heading) * ly,
  });
  const toLocal = (p0, pt) => {
    const dx = pt.x - p0.x;
    const dy = pt.y - p0.y;
    return { lx: Math.cos(p0.heading) * dx + Math.sin(p0.heading) * dy, ly: -Math.sin(p0.heading) * dx + Math.cos(p0.heading) * dy };
  };
  let worstRound = 0;
  for (const heading of [0, 0.3, Math.PI / 2, -2.2, Math.PI]) {
    const p0 = { x: 1.5, y: -0.75, heading };
    for (const [lx, ly] of [[2, 1], [-1.25, 3], [0, 0], [0.5, -0.5]]) {
      const back = toLocal(p0, world(p0, lx, ly));
      worstRound = Math.max(worstRound, Math.abs(back.lx - lx), Math.abs(back.ly - ly));
    }
  }
  check(worstRound < 1e-14, `placing a point and reading the pointer back is the identity (worst ${worstRound.toExponential(2)} over 20 frames)`);

  const { xml, name, seg } = { ...firstWithRotate.call, seg: firstWithRotate.seg };
  const base = engine.loadCallFromXml(xml, movesXml, formationsXml, 0);
  const d = seg.d;
  const k = seg.k;
  const moveStart = base.dancers[d].path.slice(0, k).reduce((s, x) => s + x.beats, 0);
  const moveBeats = base.dancers[d].path[k].beats;
  const headingAt = (c, frac) => engine.poseFor(c.dancers[d], moveStart + frac * moveBeats).heading;
  const reparse = (c) => engine.buildCall(engine.parseCallXml('<calls>\n' + engine.callToXml(c, c.from) + '\n</calls>')[0], engine.parseFormations(formationsXml), engine.parseMoves(movesXml), false);
  const written = (c) => c.dancers[d].path[k].rotate;
  const authored = base.dancers[d].path[k].rotate;
  console.log(`    witness ${name}: dancer ${d}, move ${k + 1} - authored C1=(${authored.cx1}, 0) C2=(${authored.cx2}, ${authored.cy2}) P3=(${authored.x2}, ${authored.y2})`);

  // The three write rules, exactly as `applyHandleDrag` applies them.
  const drags = {
    r1: (r, lx) => ({ ...r, cx1: lx }),
    r2: (r, lx, ly) => ({ ...r, cx2: lx, cy2: ly }),
    r3: (r, lx, ly) => ({ ...r, x2: lx, y2: ly }),
  };
  const targets = { r1: [authored.cx1 + 1.5], r2: [authored.cx2 - 0.5, authored.cy2 + 1.25], r3: [authored.x2 + 0.5, authored.y2 - 1.25] };
  for (const [which, rule] of Object.entries(drags)) {
    const next = engine.setMove(base, d, k, { ...base.dancers[d].path[k], rotate: rule(authored, ...targets[which]) });
    const r = written(next);
    // The two invariants the panel relies on: cy1 is never written, and the fields the tile shows
    // carry exactly the numbers the drag was given.
    const kept = r.cy1 === 0;
    const applied =
      which === 'r1'
        ? r.cx1 === targets.r1[0] && r.cx2 === authored.cx2 && r.cy2 === authored.cy2 && r.x2 === authored.x2 && r.y2 === authored.y2
        : which === 'r2'
          ? r.cx2 === targets.r2[0] && r.cy2 === targets.r2[1] && r.cx1 === authored.cx1 && r.x2 === authored.x2 && r.y2 === authored.y2
          : r.x2 === targets.r3[0] && r.y2 === targets.r3[1] && r.cx1 === authored.cx1 && r.cx2 === authored.cx2 && r.cy2 === authored.cy2;
    // And it survives the export, which is the whole reason r1 is on a rail. The ERROR is the edit
    // against ITS OWN round trip; measuring the edit against the BASE would report the size of the
    // edit and call it an export error, which is what the first version of this block did.
    const back = reparse(next);
    let worst = 0;
    let moved = 0;
    for (const frac of [0.25, 0.5, 0.75]) {
      worst = Math.max(worst, Math.abs(((headingAt(back, frac) - headingAt(next, frac)) * 180) / Math.PI));
      moved = Math.max(moved, Math.abs(((headingAt(next, frac) - headingAt(base, frac)) * 180) / Math.PI));
    }
    console.log(`    ${which}: turns the dancer by ${moved.toFixed(3)}deg mid-move; the round trip changes it by ${worst.toFixed(6)}deg`);
    check(kept, `${which}: cy1 stays exactly 0 (the format cannot express it)`);
    check(applied, `${which}: writes its own control point's numbers and touches no other field`);
    check(moved > 1e-6, `${which}: the drag really changes the facing`);
    // 0.001 is the tolerance `engine/test/editor.mjs` pins for the same round trip.
    check(worst < 0.001, `${which}: the edit survives export + re-parse (worst ${worst.toFixed(6)} < 0.001)`);
  }

  // THE CONTROL, so the check below is not measuring the identity: the witness has to be one a touch
  // actually re-derives. `requireDancer` normalises a bundle carrying a `mirror` dancer through
  // `normalizeInstance`, which takes each start heading from `poseFor` - so the population the check can
  // fail on is exactly the calls whose normalised angle is not already in [0, 360). Measured here rather
  // than assumed: if the corpus ever stops supplying that spelling, this goes red instead of the check
  // below passing for the wrong reason (§11.2.2).
  const norm = engine.normalizeInstance(base);
  const otherSpelling = norm.dancers.filter((x) => x.angleDeg < 0 || x.angleDeg >= 360).length;
  check(otherSpelling > 0,
    `the witness supplies the second spelling: a touch re-derives ${otherSpelling} of its ${norm.dancers.length} start angles outside [0, 360), which is the case the exporter's canonical angle exists for`);

  // A drag that ends where it started must leave the XML BYTE-IDENTICAL, or every touch of a handle
  // would dirty a call that was not changed.
  const samePlace = engine.setMove(base, d, k, { ...base.dancers[d].path[k], rotate: drags.r2(authored, authored.cx2, authored.cy2) });
  check(engine.callToXml(samePlace, samePlace.from) === engine.callToXml(base, base.from),
    'dropping a handle back on its own value exports byte-identically (a touch is not an edit)');
}

// ---------------------------------------------------------------- 7. the drawn curve IS the heading
console.log(`\n== 7. the curve the panel draws, and what its direction means ==`);
{
  // The panel draws the facing curve as a sampled cubic (`bezierPoint`) and claims that ITS DIRECTION
  // at a point is the heading the dancer has there. That claim is checkable without the browser,
  // because both halves are engine functions: the drawn points are `bezierPoint`, and the heading is
  // `bezierAngle` - which is atan2 of the DERIVATIVE, so it is the direction of the curve's TANGENT.
  //
  // AN EARLIER VERSION OF THE PANEL'S OWN NOTE SAID THE OPPOSITE - that "the ray from the dancer to a
  // point of the curve is that heading". The same section measures how wrong that was, so the
  // correction is pinned rather than trusted.
  const angDiff = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const deg = (r) => (r * 180) / Math.PI;

  // The panel samples 32 segments; that number is repeated here so the measurement is of the drawing
  // the caller sees rather than of a finer curve that would flatter it.
  const SEGMENTS = 32;
  const sample = (r, n = SEGMENTS) => {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(engine.bezierPoint(r, i / n));
    return pts;
  };

  // 7a. The endpoints are exactly the data's: the curve starts at the dancer's own spot (the implicit
  // P0 = origin) and ends at (x2, y2).
  let worstStart = 0;
  let worstEnd = 0;
  for (const [, r] of curves) {
    const pts = sample(r);
    worstStart = Math.max(worstStart, Math.hypot(pts[0].x, pts[0].y));
    worstEnd = Math.max(worstEnd, Math.hypot(pts[pts.length - 1].x - r.x2, pts[pts.length - 1].y - r.y2));
  }
  check(worstStart === 0, `the drawn curve starts at the dancer's own spot, exactly (worst ${worstStart})`);
  check(worstEnd < 1e-15, `and ends on the endpoint the tile edits (worst ${worstEnd.toExponential(2)})`);

  // 7b. THE CLAIM: the direction of the curve at t is the heading at t. Measured as a chord against
  // `bezierAngle`, which is what the engine feeds the renderer.
  //
  // TWO THINGS MAKE THIS SUBTLER THAN IT LOOKS, and the first version of this check got both wrong.
  // Where the derivative is the near-zero vector - every curve whose cx1 is 0 at t = 0 - the tangent
  // has no well-defined direction at all, and the chord has an arbitrary one; and a chord ACROSS the
  // instant is second-order accurate in the interior but only FIRST-order at the two ends, where the
  // window has to be one-sided. So the endpoints are measured separately, and the convergence is
  // shown rather than asserted.
  const deriv = (r, t) => {
    const mt = 1 - t;
    const cy1 = r.cy1 ?? 0; // the format has no cy3; see section 1
    return {
      dx: 3 * mt * mt * r.cx1 + 6 * mt * t * (r.cx2 - r.cx1) + 3 * t * t * (r.x2 - r.cx2),
      dy: 3 * mt * mt * cy1 + 6 * mt * t * (r.cy2 - cy1) + 3 * t * t * (r.y2 - r.cy2),
    };
  };
  const chordGap = (r, t, h) => {
    const a = engine.bezierPoint(r, Math.max(0, t - h));
    const b = engine.bezierPoint(r, Math.min(1, t + h));
    return deg(angDiff(Math.atan2(b.y - a.y, b.x - a.x), engine.bezierAngle(r, t)));
  };
  const interior = [];
  for (const [where, r] of curves) {
    for (let i = 1; i < 20; i++) {
      const t = i / 20;
      const d = deriv(r, t);
      if (Math.hypot(d.dx, d.dy) < 1e-3) continue; // no direction to speak of; the engine has none either
      interior.push([where, r, t]);
    }
  }
  let worstChord = 0;
  let worstChordAt = '';
  let worstEndpoint = 0;
  for (const [where, r, t] of interior) {
    const gap = chordGap(r, t, 0.002);
    if (gap > worstChord) { worstChord = gap; worstChordAt = `${where} t=${t}`; }
  }
  for (const [, r] of curves) {
    worstEndpoint = Math.max(worstEndpoint, chordGap(r, 0, 0.002), chordGap(r, 1, 0.002));
  }
  // The convergence that makes it a proof rather than a coincidence: quarter the window and the
  // interior error must fall by roughly sixteen (second order), while the endpoint error falls by
  // roughly four (first order, one-sided).
  const worstAt = (h, onlyEnds) => {
    let w = 0;
    if (onlyEnds) {
      for (const [, r] of curves) w = Math.max(w, chordGap(r, 0, h), chordGap(r, 1, h));
    } else {
      for (const [, r, t] of interior) w = Math.max(w, chordGap(r, t, h));
    }
    return w;
  };
  const h2 = 0.002 / 4;
  const shrinkInterior = worstAt(0.002, false) / worstAt(h2, false);
  const shrinkEnd = worstAt(0.002, true) / worstAt(h2, true);
  console.log(`    the curve's own direction against the engine's heading, over ${curves.length} curves:`);
  console.log(`      interior instants (${interior.length}): worst ${worstChord.toFixed(5)}deg at h=0.002 (${worstChordAt})`);
  console.log(`      quartering the window shrinks that ${shrinkInterior.toFixed(1)}x (second order, as a symmetric chord must)`);
  console.log(`      the two ENDPOINTS are one-sided: worst ${worstEndpoint.toFixed(4)}deg, shrinking ${shrinkEnd.toFixed(1)}x (first order)`);
  check(worstChord < 0.01, `away from the ends the direction of the curve IS the heading - worst ${worstChord.toFixed(5)}deg`);
  check(shrinkInterior > 8, `and it converges: quartering the chord window cuts the error ${shrinkInterior.toFixed(1)}x, so the limit is the tangent`);
  check(shrinkEnd > 2 && shrinkEnd < 8, `the endpoint error is first order (${shrinkEnd.toFixed(1)}x), which is the finite difference and not the claim`);
  // And at the spacing the DRAWING actually has, so 32 segments can be judged rather than assumed.
  let worstDrawn = 0;
  const drawnGaps = [];
  for (const [, r] of curves) {
    const pts = sample(r);
    let local = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const gap = deg(angDiff(Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x), engine.bezierAngle(r, (i + 0.5) / SEGMENTS)));
      local = Math.max(local, gap);
    }
    drawnGaps.push(local);
    worstDrawn = Math.max(worstDrawn, local);
  }
  drawnGaps.sort((a, b) => a - b);
  console.log(`      the DRAWN chords (32 per curve, what the eye sees): median ${drawnGaps[Math.floor(drawnGaps.length / 2)].toFixed(3)}deg, worst ${worstDrawn.toFixed(3)}deg`);
  check(worstDrawn < 2, `32 drawn segments resolve the direction to ${worstDrawn.toFixed(3)}deg at worst - the polyline is the curve, not a lookalike`);

  // 7c. THE WRONG READING, MEASURED. The ray from the dancer out to a point of the curve is a
  // different angle from the curve's direction, and for a real share of the corpus it is a wildly
  // different one - which is why the note had to be rewritten rather than reworded.
  let over1 = 0;
  let over10 = 0;
  let over90 = 0;
  let worstRay = 0;
  for (const [, r] of curves) {
    for (const t of [0.25, 0.5, 0.75]) {
      const p = engine.bezierPoint(r, t);
      if (Math.hypot(p.x, p.y) < 1e-9) continue; // no ray to speak of
      const gap = deg(angDiff(Math.atan2(p.y, p.x), engine.bezierAngle(r, t)));
      worstRay = Math.max(worstRay, gap);
      if (gap > 1) over1++;
      if (gap > 10) over10++;
      if (gap > 90) over90++;
    }
  }
  const n = curves.length * 3;
  console.log(`    the "ray from the dancer to the curve" reading, same ${n} instants: >1deg at ${((over1 / n) * 100).toFixed(1)}%, >10deg at ${((over10 / n) * 100).toFixed(1)}%, >90deg at ${((over90 / n) * 100).toFixed(1)}%`);
  check(over10 / n > 0.25,
    `the ray reading is measurably NOT the heading (${((over10 / n) * 100).toFixed(1)}% of instants differ by more than 10deg) - the earlier note was wrong, not merely loose`);

  // 7d. How far the drawn curve reaches, which decides whether it is a local annotation beside the
  // dancer or a shape across the board - and whether it can run off the floor.
  const reaches = [];
  for (const [, r] of curves) {
    let far = 0;
    for (const p of sample(r)) far = Math.max(far, Math.hypot(p.x, p.y));
    reaches.push(far);
  }
  reaches.sort((a, b) => a - b);
  const pct = (q) => reaches[Math.min(reaches.length - 1, Math.floor(reaches.length * q))];
  const overFloor = reaches.filter((v) => v > FLOOR_HALF_ASSUMED).length;
  console.log(`    reach from the dancer: median ${pct(0.5).toFixed(2)} units, 90th ${pct(0.9).toFixed(2)}, 99th ${pct(0.99).toFixed(2)}, worst ${reaches[reaches.length - 1].toFixed(2)} (floor is 10 across, dancers about 2.5 apart)`);
  check(pct(0.9) < 7,
    `nine in ten curves are a LOCAL annotation: within ${pct(0.9).toFixed(2)} units of the dancer, a couple of dancer-spacings`);
  // THE TAIL IS REPORTED RATHER THAN ASSERTED AWAY - which is what this comment has always CLAIMED and
  // what the code did not do. It used to be `check(overFloor / reaches.length < 0.001, ...)`: a bound
  // tuned when 4 of 4145 curves (0.0965%) reached past the floor's half-width. The re-authoring of the
  // corpus took that to 281 of 3605 (7.795%), which is no longer a negligible tail and so no longer
  // something an assertion can dismiss. What survives is real and IS asserted above - nine in ten curves
  // are a local annotation - so the rest is a measurement, which is what the comment promised.
  console.log(`    ${overFloor} of ${reaches.length} curves reach past the floor's own half-width (${((overFloor / reaches.length) * 100).toFixed(3)}%) - MEASURED, against 0.097% when the bound this replaces was written`);
}

// ============================================================ the DRAWN arms
//
// Reported: "The bezier controls for the Facing curve display the connecting lines for the end point
// incorrectly. It connects from the control point to the other control point. It should connect to the end
// point."
//
// THE LINE FROM A HANDLE'S ANCHOR TO ITS DOT IS THE ARM OF THE CURVE - the segment from an END of the cubic out
// to one of its controls - so it has to join a control point to an endpoint. The facing curve's second control
// was anchored on `c1`, which drew control-point-to-control-point: a line that is not part of the curve and says
// nothing about where the dancer finishes, on the one shape whose whole meaning is where the dancer finishes
// facing.
//
// NOTHING CHECKED THIS BEFORE, which is why it survived: `facing-handle-probe` tests what a DRAG does to the
// numbers, and the numbers were always right - only the picture was wrong.
console.log('\n== the arms the handles are drawn with ==');
const uiSrc = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
check(/id: `d\$\{d\}:r1`, anchor: origin, point: c1/.test(uiSrc),
  'the facing curve\'s FIRST control is anchored on the point the curve starts at');
check(/id: `d\$\{d\}:r2`, anchor: p3, point: c2/.test(uiSrc),
  'and its SECOND on the point the curve ends at, which is what was wrong');
check(!/anchor: c1,/.test(uiSrc),
  'and no handle anywhere is anchored on a CONTROL POINT: a line from one control to the other is not an arm of the curve');
// The travel curve is the shape that was already right, and it is checked so the two cannot drift apart again.
check(/id: `d\$\{d\}:c1`, anchor: \{ x: p0\.x, y: p0\.y \}, point: world\(t\.cx1, t\.cy1\)/.test(uiSrc),
  'the travel curve\'s first control is anchored on the move\'s start');
check(/id: `d\$\{d\}:c2`, anchor: \{ x: p1\.x, y: p1\.y \}, point: world\(t\.cx2, t\.cy2\)/.test(uiSrc),
  'and its second on the move\'s end - so both shapes are drawn the same way');
// The END-POINT handle is the third arm of the same curve, anchored on its own exit control, and it is checked
// here because a fix to the other two could quietly move it.
check(/id: `d\$\{d\}:r3`, anchor: c2, point: p3/.test(uiSrc),
  'and the facing END POINT is still anchored on its own exit control, so its line IS the heading the move leaves on');
console.log('\n=================');

// AND THE CHECK FAILS ON THE BUG IT WAS WRITTEN FOR. Put the old anchor back in the source TEXT and both facing
// checks must go red - otherwise they are two regexes that happen to match a line, not a gate.
const buggy = uiSrc.replace('anchor: p3, point: c2', 'anchor: c1, point: c2');
check(!/id: `d\$\{d\}:r2`, anchor: p3, point: c2/.test(buggy) && /anchor: c1,/.test(buggy),
  'restoring the control-to-control anchor fails BOTH of the checks above, so neither is decoration');if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
