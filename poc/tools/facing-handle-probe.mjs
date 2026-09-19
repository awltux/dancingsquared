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
// Run: node tools/facing-handle-probe.mjs   (from poc/)
import fs from 'node:fs';
import path from 'node:path';

const engine = await import('../../engine/dist/index.js');
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(process.cwd(), 'src/assets', p), 'utf8');
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
const levels = ['b1', 'b2', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
let calls = 0;
let explicitSegs = 0;
let totalSegs = 0;
const firstWithRotate = { call: null, seg: null };
for (const lv of levels) {
  const dir = path.join(process.cwd(), 'src/assets', lv);
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

  // A drag that ends where it started must leave the XML BYTE-IDENTICAL, or every touch of a handle
  // would dirty a call that was not changed.
  const samePlace = engine.setMove(base, d, k, { ...base.dancers[d].path[k], rotate: drags.r2(authored, authored.cx2, authored.cy2) });
  check(engine.callToXml(samePlace, samePlace.from) === engine.callToXml(base, base.from),
    'dropping a handle back on its own value exports byte-identically (a touch is not an edit)');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
