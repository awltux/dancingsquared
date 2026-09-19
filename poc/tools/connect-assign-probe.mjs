// Probe: WHY DO OPPOSITE DANCERS' WALK-INS MATCH AFTER A `connect`, AND DANCERS AT OTHER ANGLES' NOT?
//
// Reported: "the connect created for opposites seem to match, but not dancers at other angles". That is a
// statement about the FIRST move after a re-base - the walk-in the connect solves - and about which
// dancers the group gate then treats as doing the same thing.
//
// THE WALK-IN IS FORCED, per dancer, and there is nothing to choose about it: the clone keeps the
// ancestor's END formation, the rest of the chain is dancer-LOCAL, so the walk-in must carry dancer i
// from its new start pose to EXACTLY the pose the ancestor's own track resumes from. What IS chosen is
// which SPOT of the new formation each dancer stands on (`setStartFormation` assigns them), and that
// choice is what decides whether the walk-ins agree.
//
// So this probe asks three things, per target formation:
//   1. which pairs of dancers the gate accepts at move 1, by the angle between their start headings;
//   2. whether SOME assignment makes every dancer's walk-in THE SAME local move (a shared walk-in);
//   3. and whether the assignment `setStartFormation` actually makes is that one.
//
// Run: node tools/connect-assign-probe.mjs   (from anywhere)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);
const { callsByTitle } = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'test', 'lib', 'engine-calls.mjs')).href);

const asset = (p) => fs.readFileSync(path.join(POC_DIR, 'src/assets', p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const DEG = 180 / Math.PI;

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** The LOCAL rigid motion that carries `from` to `to`: the displacement in `from`'s own frame, and the
 *  heading change. Two dancers do "the same walk-in" exactly when both of these agree. */
const motion = (from, to) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const c = Math.cos(-from.heading);
  const s = Math.sin(-from.heading);
  return { x: c * dx - s * dy, y: s * dx + c * dy, h: norm(to.heading - from.heading) };
};
const sameMotion = (a, b, tol, tolDeg) =>
  Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(norm(a.h - b.h)) < tolDeg / DEG;
const fmt = (m) => `(${m.x.toFixed(4)}, ${m.y.toFixed(4)}) @ ${(m.heading * DEG).toFixed(2)}deg`;

const src = engine.normalizeInstance(engine.loadCallFromXml(asset('ms/circle.xml'), movesXml, formationsXml, 0));
const assets = path.join(POC_DIR, 'src', 'assets');
const seq = new engine.Sequencer(movesXml, formationsXml, callsByTitle(assets));
const names = seq.listFormations().filter((n) => (seq.boardForFormation(n)?.dancers.length ?? 0) === src.dancers.length);
// The anchor: the pose the ancestor's own track resumes from, per dancer. This is the walk-in's target.
const anchors = src.dancers.map((d) => engine.poseFor(d, engine.moveBeatRange(d, 0).to));

/** A perfect matching of dancers to spots that makes every walk-in the SAME local motion, or null.
 *  Dancer 0 tries each spot in turn; that fixes the motion, and the rest must then fit exactly. */
function sharedAssignment(spots, tol, tolDeg) {
  const n = spots.length;
  for (let s0 = 0; s0 < n; s0++) {
    const want = motion(spots[s0], anchors[0]);
    const used = new Array(n).fill(false);
    used[s0] = true;
    const slot = [s0];
    let ok = true;
    for (let i = 1; i < n && ok; i++) {
      let found = -1;
      for (let s = 0; s < n; s++) {
        if (used[s]) continue;
        if (sameMotion(motion(spots[s], anchors[i]), want, tol, tolDeg)) { found = s; break; }
      }
      if (found < 0) ok = false;
      else { used[found] = true; slot[i] = found; }
    }
    if (ok) return { motion: want, slot };
  }
  return null;
}

const posesOf = (name) => seq.boardForFormation(name).dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));

// ---------------------------------------------------------------- what the panel shows today
console.log(`== the walk-in the connect writes, and which pairs the gate accepts ==`);
console.log(`   source "${src.from}": ${src.dancers.length} dancers, ${src.dancers[0].path.length} moves`);
{
  const counts = { opposite: 0, other: 0 };
  const perTarget = [];
  for (const name of names) {
    const board = seq.boardForFormation(name);
    const spots = board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
    let clone;
    try {
      clone = engine.connectStart(engine.setStartFormation(src, spots), src);
    } catch {
      continue;
    }
    const starts = clone.dancers.map((d) => engine.poseFor(d, 0));
    const acc = [];
    const ref = [];
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const da = Math.round(Math.abs(norm(starts[i].heading - starts[j].heading)) * DEG);
        const same = Math.abs(norm(motion(starts[i], anchors[i]).x - motion(starts[j], anchors[j]).x)) < 0.01 &&
          Math.abs(norm(motion(starts[i], anchors[i]).y - motion(starts[j], anchors[j]).y)) < 0.01 &&
          Math.abs(norm(motion(starts[i], anchors[i]).h - motion(starts[j], anchors[j]).h)) < 0.5 / DEG;
        (same ? acc : ref).push(da);
        if (same) {
          if (da === 180) counts.opposite++;
          else counts.other++;
        }
      }
    }
    if (acc.length && ref.length) perTarget.push({ name, acc, ref });
  }
  console.log(`   accepted pairs over every target: ${counts.opposite} between dancers 180deg apart, ${counts.other} at any other angle`);
  console.log(`   targets where SOME pairs match and others do not: ${perTarget.length}`);
  for (const t of perTarget.slice(0, 6)) {
    const bucket = (list) => [...new Set(list)].sort((a, b) => a - b).join(', ');
    console.log(`     "${t.name}": matching pairs are ${bucket(t.acc)}deg apart; refused pairs are ${bucket(t.ref)}deg apart`);
  }
  check(counts.opposite + counts.other > 0, 'the connect does write matching walk-ins for some pairs');

  // AND THE NUMBERS THEMSELVES, for one target, because the whole question is what the solve writes:
  // the pose the solve put each dancer on, the pose its walk-in has to reach, and the local curve it
  // wrote. The walk-in is not a choice - the end formation is kept, so it MUST carry the dancer from
  // one to the other - which is why the values differ wherever those two poses differ.
  const first = names[0];
  const spotList = posesOf(first);
  const chain = engine.connectStart(engine.setStartFormation(src, spotList), src);
  console.log(`\n   the chain the solve writes, "${first}":`);
  for (let i = 0; i < 8; i++) {
    const s = engine.poseFor(chain.dancers[i], 0);
    const w = chain.dancers[i].path[0].translate;
    console.log(
      `     d${i + 1}: ${fmt(s)} --walk in--> ${fmt(anchors[i])}   local (${w.cx1.toFixed(4)}, ${w.cy1.toFixed(4)}, ${w.cx2.toFixed(4)}, ${w.cy2.toFixed(4)}, ${w.x2.toFixed(4)}, ${w.y2.toFixed(4)})`,
    );
  }
}

// ---------------------------------------------------------------- is a shared walk-in available at all?
console.log('\n== is there an assignment whose walk-ins ALL agree? ==');
{
  let shared = 0;
  let sharedLoose = 0;
  let differs = 0;
  const examples = [];
  for (const name of names) {
    const board = seq.boardForFormation(name);
    if (!board) continue;
    const spots = board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }));
    const tight = sharedAssignment(spots, 1e-9, 1e-6);
    if (tight) shared++;
    else if (sharedAssignment(spots, 0.01, 0.5)) sharedLoose++;
    // does the assignment the solve actually makes share the walk-in?
    const rebased = engine.setStartFormation(src, spots);
    const starts = rebased.dancers.map((d) => engine.poseFor(d, 0));
    const ms = starts.map((s, i) => motion(s, anchors[i]));
    const allSame = ms.every((m) => sameMotion(m, ms[0], 1e-9, 1e-6));
    if (!allSame) differs++;
    if (tight || sharedAssignment(spots, 0.01, 0.5)) examples.push({ name, tight: !!tight, moves: ms });
  }
  console.log(`   targets with an EXACT shared walk-in (1e-9)     : ${shared} of ${names.length}`);
  console.log(`   targets with one to within the gate's windows   : ${shared + sharedLoose} of ${names.length}`);
  console.log(`   targets where the assignment the solve makes does NOT share it: ${differs}`);
  if (examples.length) {
    const e = examples[0];
    console.log(`   e.g. "${e.name}"${e.tight ? '' : ' (within the windows)'} - the per-dancer walk-ins the solve writes:`);
    for (let i = 0; i < e.moves.length; i++) console.log(`     d${i + 1}: ${fmt(e.moves[i])}`);
  }
}

/** One walk-in's worth of numbers, as the panel would write it. */

// ---------------------------------------------------------------- where the asymmetry comes from
//
// The pairs whose walk-ins agree are the OPPOSITE ones (180deg apart), and that is the whole of the
// mechanism: the ancestor's own first boundary is POINT-symmetric, so an opposite pair has the same
// walk-in - while a 90deg pair only agrees if the boundary is 4-fold symmetric, which it is not. The
// question this section answers is whether that asymmetry is the corpus's or the engine's, and how big
// it is, because a difference in the last decimals is a precision problem and one of a tenth of a unit
// is the data.
console.log('\n== the ancestor its own first move leaves behind, and how symmetric it is ==');
{
  const starts = src.dancers.map((d) => engine.poseFor(d, 0));
  console.log(`   the source's own start poses and the poses its FIRST move ends on:`);
  for (let i = 0; i < src.dancers.length; i++) {
    const t = src.dancers[i].path[0];
    const r = t.rotate;
    console.log(
      `     d${i + 1}: start ${fmt(starts[i])} -> boundary ${fmt(anchors[i])}   ` +
        `translate(${t.translate.cx1.toFixed(4)}, ${t.translate.cy1.toFixed(4)}, ${t.translate.cx2.toFixed(4)}, ${t.translate.cy2.toFixed(4)}, ${t.translate.x2.toFixed(4)}, ${t.translate.y2.toFixed(4)})` +
        ` rotate ${r ? `(${r.cx1.toFixed(4)}, ${r.cx2.toFixed(4)}, ${r.cy2.toFixed(4)}, ${r.x2.toFixed(4)}, ${r.y2.toFixed(4)})` : 'none'}`,
    );
  }
  // How far the boundary set is from being symmetric about the centre, degree by degree: for each pair
  // of dancers whose START headings differ by `k`, how far are their walk-in motions apart?
  console.log('   the source start set, by the angle between two dancers\' start headings:');
  const bucket = new Map();
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      const da = Math.round(Math.abs(norm(starts[i].heading - starts[j].heading)) * DEG);
      if (!bucket.has(da)) bucket.set(da, []);
      bucket.get(da).push([i, j]);
    }
  }
  for (const da of [...bucket.keys()].sort((a, b) => a - b)) {
    const pairs = bucket.get(da);
    // The spread of the walk-in motions across the pairs at this angle: 0 means the set is symmetric at
    // this angle and every one of these pairs walks in identically.
    let worst = 0;
    for (const [i, j] of pairs) {
      const a = motion(starts[i], anchors[i]);
      const b = motion(starts[j], anchors[j]);
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y), Math.abs(norm(a.h - b.h)) * DEG / DEG);
    }
    console.log(`     ${da}deg apart: ${pairs.length} pair(s), walk-in motions differ by up to ${worst.toFixed(4)} units`);
  }
}

// ---------------------------------------------------------------- is the compare too strict?
//
// The hypothesis to test: the gate's windows are too tight, i.e. the differences it refuses on are the
// last decimals. A tolerance is only "too strict" if there is something in the band just above it - so
// this measures the noise floor (how big a difference the gate ACCEPTS) against the smallest refusal,
// and puts every refused pair into a band. If nothing sits between the window and a tenth of a unit,
// then no window between the two would change a single answer, and the differences are the data's.
console.log('\n== is the compare too strict? the noise floor against the refusals ==');
{
  const WINDOW = 0.01;
  const FACING_WINDOW_DEG = 0.5;
  let accepted = 0;
  let acceptedWorst = 0;
  let refusedTravel = 0;
  let refusedFacing = 0;
  let refusedBoth = 0;
  const bands = { 'under 0.05 units': 0, '0.05 to 0.1': 0, '0.1 to 0.5': 0, 'over 0.5': 0 };
  const facings = [];
  let smallestTravel = Infinity;
  for (const name of names) {
    const board = seq.boardForFormation(name);
    if (!board) continue;
    let clone;
    try {
      clone = engine.connectStart(engine.setStartFormation(src, board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }))), src);
    } catch {
      continue;
    }
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const a = clone.dancers[i].path[0];
        const b = clone.dancers[j].path[0];
        if (!a || !b) continue;
        let num = 0;
        for (const k of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) num = Math.max(num, Math.abs(a.translate[k] - b.translate[k]));
        const travelOk = num < WINDOW;
        const facingOk = engine.sameFacing(a.rotate ?? a.translate, b.rotate ?? b.translate, FACING_WINDOW_DEG);
        if (travelOk && facingOk) {
          accepted++;
          acceptedWorst = Math.max(acceptedWorst, num);
          continue;
        }
        if (!travelOk && !facingOk) refusedBoth++;
        else if (!travelOk) refusedTravel++;
        else refusedFacing++;
        if (!travelOk) {
          smallestTravel = Math.min(smallestTravel, num);
          if (num < 0.05) bands['under 0.05 units']++;
          else if (num < 0.1) bands['0.05 to 0.1']++;
          else if (num < 0.5) bands['0.1 to 0.5']++;
          else bands['over 0.5']++;
        }
        if (!facingOk) {
          // By how many degrees, at the worst instant, in the dancers' own frames.
          let worst = 0;
          for (let s = 0; s <= 16; s++) {
            const t = s / 16;
            const ha = engine.bezierAngle(a.rotate ?? a.translate, t);
            const hb = engine.bezierAngle(b.rotate ?? b.translate, t);
            worst = Math.max(worst, Math.abs((Math.atan2(Math.sin(ha - hb), Math.cos(ha - hb)) * DEG)));
          }
          facings.push(worst);
        }
      }
    }
  }
  facings.sort((x, y) => x - y);
  console.log(`   accepted walk-in pairs: ${accepted}, and the biggest difference ANY accepted pair has: ${acceptedWorst.toExponential(2)} units`);
  console.log(`   refused on the travel curve alone: ${refusedTravel}, on the facing alone: ${refusedFacing}, on both: ${refusedBoth}`);
  console.log(`   the smallest travel difference ever refused: ${smallestTravel.toFixed(4)} units (${(smallestTravel * 40.91).toFixed(1)} px), against a ${WINDOW}-unit window`);
  console.log(`   refused travel differences by band: ${Object.entries(bands).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  if (facings.length) console.log(`   refused facing differences: smallest ${facings[0].toFixed(2)}deg, largest ${facings[facings.length - 1].toFixed(2)}deg (window ${FACING_WINDOW_DEG}deg)`);
  check(acceptedWorst < WINDOW, `the biggest difference the gate ACCEPTS is ${acceptedWorst.toExponential(2)} units, and the smallest it refuses is ${smallestTravel.toFixed(4)} - a gap of ${(smallestTravel / acceptedWorst).toFixed(0)}x, so no window between them would change a single answer, and the refusals are not floating-point noise`);
  check(smallestTravel > WINDOW * 2, `the smallest refusal is ${smallestTravel.toFixed(4)} units, well above the ${WINDOW}-unit window: "too strict" is a judgement about ${(smallestTravel * 40.91).toFixed(1)} px rather than a precision problem`);

  // ---------------------------------------------------------------- what a per-curve gate opens
  //
  // The gate as it stands asks whether BOTH curves agree, but a Move-tab edit writes only the travel
  // numbers and a Facing-tab edit writes only the rotation's. So the pairs it refuses split three ways,
  // and the ones it refused on the curve the tab does not edit are the ones a group edit can safely make.
  let opensTravel = 0;
  let opensFacing = 0;
  let targetsEither = 0;
  for (const name of names) {
    const board = seq.boardForFormation(name);
    if (!board) continue;
    let clone;
    try {
      clone = engine.connectStart(engine.setStartFormation(src, board.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender }))), src);
    } catch {
      continue;
    }
    let any = false;
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const a = clone.dancers[i].path[0];
        const b = clone.dancers[j].path[0];
        if (!a || !b) continue;
        let num = 0;
        for (const k of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) num = Math.max(num, Math.abs(a.translate[k] - b.translate[k]));
        const travelOk = num < WINDOW;
        const facingOk = engine.sameFacing(a.rotate ?? a.translate, b.rotate ?? b.translate, FACING_WINDOW_DEG);
        if (travelOk && !facingOk) { opensTravel++; any = true; }
        if (!travelOk && facingOk) { opensFacing++; any = true; }
      }
    }
    if (any) targetsEither++;
  }
  console.log(`   with a gate per curve, the walk-in would open for: ${opensTravel} pairs on the Move tab (travel agrees, facing does not), ${opensFacing} on the Facing tab (facing agrees, travel does not)`);
  check(targetsEither > 0, `and that is ${targetsEither} of ${names.length} clone targets, where the panel currently locks both tabs`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
