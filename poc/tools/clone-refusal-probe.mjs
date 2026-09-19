// Probe: THE REPORTED WITNESS, end to end - "All 4 Couples Promenade Full" | Clone | Start From
// "Grand Circle 3" | Connect | select dancers 1 and 3 | the coordinate fields are locked.
//
// The panel's clone path, exactly as the panel does it: the call instance as loaded, `setStartFormation`
// onto the poses `startFormations()` hands the picker (from `boardForSetup`), then `connectStart`. Then the
// question the report asks: WHY are dancers 1 and 3 refused, and is it the straight line the connect
// added - which is what a caller sees on the board - or something else about the move?
//
// Run: node tools/clone-refusal-probe.mjs [call title] [formation | call:<title>#<n>] [--sweep]
//
// The defaults are the reported witness: "Grand Circle 3" is a USER-LABELLED formation (kept in the
// browser's localStorage, so a headless probe cannot look it up by name), made from the END of `Right and
// Left Grand`, which is what `call:Right and Left Grand#1` reproduces.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);
const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);

const CALL = process.argv[2] ?? 'All 4 Couples Promenade Full';
const FORMATION = process.argv[3] ?? 'call:Right and Left Grand#1';

const assets = path.join(POC_DIR, 'src', 'assets');
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const DEG = 180 / Math.PI;

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const fmt = (p) => `(${p.x.toFixed(4)}, ${p.y.toFixed(4)}) @ ${(p.heading * DEG).toFixed(2)}deg`;
const bez = (t) => `(${t.cx1.toFixed(4)}, ${t.cy1.toFixed(4)}, ${t.cx2.toFixed(4)}, ${t.cy2.toFixed(4)}, ${t.x2.toFixed(4)}, ${t.y2.toFixed(4)})`;

const entry = callsByTitle(assets).find((c) => c.name === CALL);
if (!entry) {
  console.log(`✗ no call titled "${CALL}" in the catalogue`);
  process.exit(1);
}
const src = engine.normalizeInstance(engine.loadCallFromXml(entry.xml, movesXml, formationsXml, 0));

const seq = new engine.Sequencer(movesXml, formationsXml, callsByTitle(assets));
// THE FORMATION, from a name in the picker OR from the end of a call: the report's "Grand Circle 3" is a
// USER-LABELLED formation, made from the end of `Right and Left Grand` by the editor's own end-formation
// detection, so `call:Right and Left Grand` reproduces it without the browser's localStorage.
let poses;
let formationLabel = FORMATION;
if (FORMATION.startsWith('call:')) {
  // `call:<title>#<n>` picks the n-th authoring of that title (a call is pooled across levels, and the
  // editor can be showing any one of them when the ends are turned into a formation).
  const spec = FORMATION.slice(5);
  const hash = spec.lastIndexOf('#');
  const title = hash >= 0 ? spec.slice(0, hash) : spec;
  const idx = hash >= 0 ? Number(spec.slice(hash + 1)) : 0;
  const e = callsByTitle(assets).find((c) => c.name === title);
  if (!e) {
    console.log(`✗ no call titled "${title}" to take a formation from`);
    process.exit(1);
  }
  const howMany = (e.xml.match(/<tam\b/g) ?? []).length;
  const bundle = engine.normalizeInstance(engine.loadCallFromXml(e.xml, movesXml, formationsXml, idx));
  poses = bundle.dancers.map((d) => {
    const p = engine.poseFor(d, bundle.beats);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
  formationLabel = `the end of "${title}"#${idx} of ${howMany} (from "${bundle.from}") - a user-labelled formation`;
} else {
  const board = seq.boardForSetup(FORMATION);
  if (!board) {
    console.log(`✗ no formation named "${FORMATION}"`);
    process.exit(1);
  }
  poses = board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
}
const rebased = engine.setStartFormation(src, poses);
const connected = engine.connectStart(rebased, src);

console.log(`== the reported witness ==`);
console.log(`   "${CALL}" (from "${src.from}", ${src.dancers.length} dancers, ${src.dancers[0].path.length} moves)`);
console.log(`   cloned onto ${formationLabel} (${poses.length} dancers), then connected`);
console.log(`   its poses:`);
for (let i = 0; i < poses.length; i++) console.log(`     spot ${i + 1}: (${poses[i].x.toFixed(4)}, ${poses[i].y.toFixed(4)}) @ ${(poses[i].heading * DEG).toFixed(2)}deg ${poses[i].gender ?? ''}`);

// ---------------------------------------------------------------- what the connect wrote, dancer by dancer
console.log(`\n== the chain the connect writes ==`);
// THE PANEL'S OWN GATE, mirrored to the letter: the travel curves are compared as CURVES, at one pixel
// (0.025 board units at this view's 40.91 px per unit), and the facing through `sameFacing` at half a
// degree. `editor-ui.ts` `sameTravel` / `sameFacingCurve` are the definitions; keep these in step.
const WINDOW = 0.025;
const FACING_WINDOW_DEG = 0.5;
const travelGap = (a, b) => {
  let gap = 0;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const qa = engine.bezierPoint(a.translate, t);
    const qb = engine.bezierPoint(b.translate, t);
    gap = Math.max(gap, Math.hypot(qa.x - qb.x, qa.y - qb.y));
  }
  return gap;
};
const sameTravel = (a, b) => travelGap(a, b) < WINDOW;
const sameFacingCurve = (a, b) => engine.sameFacing(a.rotate ?? a.translate, b.rotate ?? b.translate, FACING_WINDOW_DEG);
const straight = (t) => {
  const p = [[0, 0], [t.cx1, t.cy1], [t.cx2, t.cy2], [t.x2, t.y2]];
  let worst = 0;
  for (let i = 0; i + 2 < p.length; i++) {
    const ax = p[i + 1][0] - p[i][0];
    const ay = p[i + 1][1] - p[i][1];
    const bx = p[i + 2][0] - p[i + 1][0];
    const by = p[i + 2][1] - p[i + 1][1];
    worst = Math.max(worst, Math.abs(ax * by - ay * bx) / Math.max(1e-12, Math.hypot(ax, ay) * Math.hypot(bx, by)));
  }
  return worst < 1e-12;
};
for (let i = 0; i < connected.dancers.length; i++) {
  const start = engine.poseFor(connected.dancers[i], 0);
  const anchor = engine.poseFor(src.dancers[i], engine.moveBeatRange(src.dancers[i], 0).to);
  const seg = connected.dancers[i].path[0];
  const s = src.dancers[i].path[0];
  console.log(
    `   d${i + 1}: ${fmt(start)} --walk in--> ${fmt(anchor)}  turn ${(norm(anchor.heading - start.heading) * DEG).toFixed(2)}deg` +
      `\n        the connect wrote  ${bez(seg.translate)} ${straight(seg.translate) ? '(a straight line)' : '(curved)'} rotate ${seg.rotate ? 'explicit' : 'none'}` +
      `\n        the call's own 1st  ${bez(s.translate)} ${straight(s.translate) ? '(a straight line)' : '(curved)'} rotate ${s.rotate ? 'explicit' : 'none'}`,
  );
}

// ---------------------------------------------------------------- the pair the report names
console.log(`\n== dancers 1 and 3, the pair the report selects ==`);
const A = connected.dancers[0].path[0];
const B = connected.dancers[2].path[0];
const travelOk = sameTravel(A, B);
const facingOk = sameFacingCurve(A, B);
console.log(`   the travel curves are ${travelOk ? 'the SAME to within the window' : 'DIFFERENT'}: ${bez(A.translate)} vs ${bez(B.translate)}`);
{
  // NUMBER BY NUMBER, and then the CURVE, because the two are not the same question: a Bezier is a
  // convex combination of its control points, so equal control points mean equal curves - but a control
  // point can differ by more than the window while the two curves stay inside it everywhere.
  let worstNum = 0;
  let worstKey = '';
  for (const k of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) {
    const d = Math.abs(A.translate[k] - B.translate[k]);
    if (d > worstNum) { worstNum = d; worstKey = k; }
  }
  let gap = 0;
  for (let s = 0; s <= 64; s++) {
    const t = s / 64;
    const qa = engine.bezierPoint(A.translate, t);
    const qb = engine.bezierPoint(B.translate, t);
    gap = Math.max(gap, Math.hypot(qa.x - qb.x, qa.y - qb.y));
  }
  console.log(`   the largest single-number difference is ${worstNum.toExponential(3)} (${worstKey}), against a ${WINDOW} window`);
  console.log(`   and the two CURVES are ${gap.toExponential(3)} units apart at their worst (${(gap * 40.91).toFixed(2)} px in the flat view)`);
  check(gap * 40.91 < 1, `the difference the old 0.01-unit window refused is ${(gap * 40.91).toFixed(2)} px - under one pixel, which is what "too strict" meant here`);
}
console.log(`   the facings are ${facingOk ? 'the same' : 'DIFFERENT'}`);
{
  let worst = 0;
  for (let s = 0; s <= 16; s++) {
    const t = s / 16;
    const ha = engine.bezierAngle(A.rotate ?? A.translate, t);
    const hb = engine.bezierAngle(B.rotate ?? B.translate, t);
    worst = Math.max(worst, Math.abs(norm(ha - hb) * DEG));
  }
  console.log(`   their headings differ by up to ${worst.toFixed(3)}deg at the same instant`);
}
console.log(
  `   so the panel locks: ${!travelOk ? 'the Move tab (the paths differ)' : ''}${!travelOk && !facingOk ? ' and ' : ''}${!facingOk ? 'the Facing tab (the turns differ)' : ''}`,
);

// ---------------------------------------------------------------- where the difference comes from
console.log(`\n== where the difference comes from ==`);
for (const i of [0, 2]) {
  const s = src.dancers[i].path[0];
  const turn = s.rotate ? engine.bezierAngle(s.rotate, 1) * DEG : 0;
  console.log(`   the call's own first move for d${i + 1}: ${bez(s.translate)}, ending at ${turn.toFixed(2)}deg of turn`);
}
{
  // The two dancers' own start-to-boundary motions in the SOURCE, which is what the walk-in must copy.
  const anchorA = engine.poseFor(src.dancers[0], engine.moveBeatRange(src.dancers[0], 0).to);
  const anchorB = engine.poseFor(src.dancers[2], engine.moveBeatRange(src.dancers[2], 0).to);
  const startA = engine.poseFor(src.dancers[0], 0);
  const startB = engine.poseFor(src.dancers[2], 0);
  console.log(`   the source's own boundary poses: d1 ${fmt(anchorA)}, d3 ${fmt(anchorB)}`);
  console.log(`   the source's own start poses    : d1 ${fmt(startA)}, d3 ${fmt(startB)}`);
  console.log(`   the call's own first move turns d1 by ${(norm(anchorA.heading - startA.heading) * DEG).toFixed(2)}deg and d3 by ${(norm(anchorB.heading - startB.heading) * DEG).toFixed(2)}deg`);
}
check(travelOk && facingOk,
  'dancers 1 and 3 ARE editable: their paths and their turns agree to within the windows, so the panel opens both tabs - this is the check that fails on the window it was reported against');

// ---------------------------------------------------------------- how big are the refusals, corpus-wide?
//
// The window is a claim about what a caller can SEE, so the number that decides it is the size of the
// differences the gate refuses. Every call here, onto every formation the picker offers: the worst gap
// between two dancers' walk-in curves, in px at the flat view's 40.91 px per unit. If the mass starts
// around a pixel, a 0.01-unit (0.4px) window is refusing differences nobody can see.
if (process.argv.includes('--sweep')) {
  const WINDOW_PX = 40.91;
  const CALLS = [
    [CALL, 1],
    ['Circle Left', 0],
    ['Right and Left Grand', 0],
    ['Pass Thru', 0],
    ['Square Thru', 0],
    ['Wheel Around', 0],
    ['Star Thru', 0],
    ['Swing', 0],
    ['Promenade', 0],
    ['California Twirl', 0],
    ['Do Sa Do', 0],
    ['Forward and Back', 0],
  ];
  const bands = { 'under 0.5px': 0, '0.5 to 1px': 0, '1 to 2px': 0, '2 to 4px': 0, '4 to 10px': 0, '10px and up': 0 };
  let refused = 0;
  let opens1px = 0;
  let opens2px = 0;
  let largestUnder2px = 0;
  let callsUsed = 0;
  for (const [title, idx] of CALLS) {
    const e = callsByTitle(assets).find((c) => c.name === title);
    if (!e) continue;
    let bundle;
    try {
      bundle = engine.normalizeInstance(engine.loadCallFromXml(e.xml, movesXml, formationsXml, idx));
    } catch {
      continue;
    }
    if (bundle.dancers.length !== 8) continue;
    callsUsed++;
    for (const name of seq.listFormations()) {
      const b = seq.boardForSetup(name);
      if (!b || b.dancers.length !== 8) continue;
      let clone;
      try {
        clone = engine.connectStart(engine.setStartFormation(bundle, b.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }))), bundle);
      } catch {
        continue;
      }
      const n = clone.dancers.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = clone.dancers[i].path[0];
          const bb = clone.dancers[j].path[0];
          if (!a || !bb) continue;
          let gap = 0;
          for (let s = 0; s <= 16; s++) {
            const t = s / 16;
            const qa = engine.bezierPoint(a.translate, t);
            const qb = engine.bezierPoint(bb.translate, t);
            gap = Math.max(gap, Math.hypot(qa.x - qb.x, qa.y - qb.y));
          }
          const facingOkHere = engine.sameFacing(a.rotate ?? a.translate, bb.rotate ?? bb.translate, FACING_WINDOW_DEG);
          if (gap < WINDOW && facingOkHere) continue;
          refused++;
          const px = gap * WINDOW_PX;
          if (gap < 0.025) { opens1px++; largestUnder2px = Math.max(largestUnder2px, px); }
          if (gap < 0.05) opens2px++;
          if (px < 0.5) bands['under 0.5px']++;
          else if (px < 1) bands['0.5 to 1px']++;
          else if (px < 2) bands['1 to 2px']++;
          else if (px < 4) bands['2 to 4px']++;
          else if (px < 10) bands['4 to 10px']++;
          else bands['10px and up']++;
        }
      }
    }
  }
  console.log(`\n== how big are the walk-in refusals a caller actually hits? ==`);
  console.log(`   ${callsUsed} calls x ${seq.listFormations().length} formations = ${refused} refused pairs`);
  console.log(`   by the gap between the two curves, at the flat view's ${WINDOW_PX} px per unit:`);
  for (const [k, v] of Object.entries(bands)) console.log(`     ${k.padEnd(12)}: ${v}`);
  console.log(`   a 0.025-unit (1.0px) window would open ${opens1px} pairs; a 0.05-unit (2.0px) window ${opens2px}`);
  check(true, 'measured (the numbers above are the window decision)');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
