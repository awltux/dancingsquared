// Probe: WHAT A WYSIWYG PATH EDITOR WOULD ACTUALLY HAVE TO EXPRESS.
//
// Asked for, as the bigger picture: "an intuitive mechanism to edit the dance path through a wysiwyg interface.
// Many of the paths are circular (so this has to be easy to achieve), and the dancers moves must start and end
// at fixed points (defined by a formation). There should be an easy way to make the dancer face the right
// direction."
//
// Three claims are sized against the WHOLE corpus rather than argued about:
//
//   1. "MANY PATHS ARE CIRCULAR" - and a circle has a SWEEP. The panel's arc lock is a QUARTER arc by
//      definition (`arcOf` demands a right angle between the handles), so part 1 asks how big one move's
//      circular travel actually is.
//   2. PART 2 IS THE INTERESTING ONE: an ORBIT - a dancer going round - is authored as a CHAIN of moves, and
//      a chain of moves is one object to a user and no object at all to the panel. Measured as: the maximal
//      runs of consecutive moves that lie on ONE circle, and how far they sweep. Circle Left and Swing are
//      360deg, which no quarter can express on its own.
//   3. "MOVES START AND END AT FIXED POINTS" - measured as: how many of a path's JOINTS (move boundaries)
//      land on a spot of the call's own start or end formation, and of those, how many also carry that
//      spot's declared HEADING. A joint pinned in position but free in heading is a different constraint
//      problem from one pinned in both, and a joint on NO spot is a different problem again.
//
// Run: node tools/wysiwyg-path-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const assets = path.join(POC_DIR, 'src', 'assets');
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const DEG = 180 / Math.PI;
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) : '0.0');
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ------------------------------------------------------------------ the corpus
//
// EVERY LEVEL, EVERY VARIANT. The ms level alone is 66 files of which only 17 build as 8-dancer setups, so a
// one-level sample would be a sample of a fifth of it; and the picker's unit is the VARIANT (one <tam>), not
// the file, so a call with several setups contributes several.
const moves = engine.parseMoves(movesXml);
const formations = engine.parseFormations(formationsXml);
const byLevel = {};
const calls = [];
for (const level of fs.readdirSync(assets, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'src').map((e) => e.name)) {
  const dir = path.join(assets, level);
  let built = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    let variants = [];
    try {
      variants = engine.parseCallXml(fs.readFileSync(path.join(dir, f), 'utf8')).map((tam) => engine.buildCall(tam, formations, moves, true));
    } catch { continue; }
    for (const raw of variants) {
      let call;
      try { call = engine.normalizeInstance(raw); } catch { continue; }
      if (call.dancers.length !== 8) continue;
      built++;
      const m = call.dancers[0].path.length;
      const beats = call.dancers.reduce((s, d) => s + d.path.reduce((a, g) => a + g.beats, 0), 0) / 8;
      calls.push({ level, file: f, call, moves: m, beats });
    }
  }
  byLevel[level] = built;
}
console.log('== The sample ==');
console.log(`    ${calls.length} 8-dancer variants built from ${Object.keys(byLevel).length} levels: ` + Object.entries(byLevel).map(([k, v]) => `${k} ${v}`).join(', '));
const allMoves = calls.reduce((s, c) => s + c.moves * 8, 0);
console.log(`    ${allMoves} dancer-moves, median ${median(calls.map((c) => c.moves))} moves per dancer, median ${median(calls.map((c) => c.beats)).toFixed(1)} beats`);
check(calls.length > 200 && Object.keys(byLevel).length > 5, 'the sample is the whole corpus, not one level');

// ------------------------------------------------------- circle fitting on points
//
// Kasa's algebraic fit: minimise sum (x^2 + y^2 + Dx + Ey + F)^2. Three normal equations, one 3x3 solve.
// It is used HERE rather than the engine's `fitCircle` because a RUN of moves is a polyline, not one Bezier -
// and the point of the run measurement is that the panel has nothing that can see it.
function kasa(pts) {
  let Suu = 0, Svv = 0, Suv = 0, Su = 0, Sv = 0, Sw = 0, Suw = 0, Svw = 0;
  const n = pts.length;
  for (const p of pts) {
    const w = p.x * p.x + p.y * p.y;
    Suu += p.x * p.x; Svv += p.y * p.y; Suv += p.x * p.y;
    Su += p.x; Sv += p.y; Sw += w;
    Suw += p.x * w; Svw += p.y * w;
  }
  const A = [[Suu, Suv, Su], [Suv, Svv, Sv], [Su, Sv, n]];
  const rhs = [-Suw, -Svw, -Sw];
  const det3 = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const det = det3(A);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const swap = (col) => A.map((row, i) => row.map((v, j) => (j === col ? rhs[i] : v)));
  const D = det3(swap(0)) / det;
  const E = det3(swap(1)) / det;
  const F = det3(swap(2)) / det;
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, Math.abs(Math.hypot(p.x - cx, p.y - cy) - r));
  return { cx, cy, r, maxDev, relDev: maxDev / r };
}

/** The signed angle swept about the centre, from the sample sequence. */
function sweepOf(pts, c) {
  let sum = 0;
  let prev = Math.atan2(pts[0].y - c.cy, pts[0].x - c.cx);
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i].y - c.cy, pts[i].x - c.cx);
    sum += norm(a - prev);
    prev = a;
  }
  return sum;
}

const SAMPLES_PER_MOVE = 12;
/** World samples across moves [s..e] of one dancer, inclusive; the shared joint is written once. */
function runSamples(dancer, s, e) {
  const pts = [];
  const ranges = [];
  for (let k = s; k <= e; k++) ranges.push(engine.moveBeatRange(dancer, k));
  for (let idx = 0; idx < ranges.length; idx++) {
    const r = ranges[idx];
    for (let i = 0; i <= SAMPLES_PER_MOVE; i++) {
      if (idx > 0 && i === 0) continue;
      const t = r.from + ((r.to - r.from) * i) / SAMPLES_PER_MOVE;
      const p = engine.poseFor(dancer, t);
      pts.push({ x: p.x, y: p.y });
    }
  }
  return pts;
}

const QUARTER = 90 + 0.5;

// ============================================================ 1. the sweep of a single move
//
// THREE READINGS OF THE SAME CURVES, and they are different questions:
//   `fitCircle`   - do the POINTS lie on a circle? (the caller's "this path is circular")
//   `arcOf`       - are the NUMBERS the conic family? (the panel's "this curve IS an arc")
//   `arcBlocker`  - would ticking the panel's arc checkbox be possible at all? (the disabled state)
// A curve can be circular to look at and still not be the conic the panel locks - and the first draft of this
// probe said otherwise because it handed `arcOf` the whole `Seg` instead of `seg.translate`, which reads
// `undefined` for all five coordinates and returns a NaN object for anything. The instrument lied; this is
// the corrected reading, checked here by asserting the two disagree.
console.log('\n== 1. How big is a circular MOVE, and can the panel lock it? ==');
const fits = [];
let canLock = 0;
let alreadyArc = 0;
const blockers = {};
for (const { call } of calls) {
  call.dancers.forEach((dancer) => {
    dancer.path.forEach((seg) => {
      const b = seg.translate;
      if (engine.arcOf(b)) alreadyArc++;
      const bl = engine.arcBlocker(b, true);
      if (bl === null) canLock++;
      else blockers[bl] = (blockers[bl] ?? 0) + 1;
      const fit = engine.fitCircle(b, 0.02);
      if (fit) fits.push(fit);
    });
  });
}
const sweeps = fits.map((f) => Math.abs(f.sweep) * DEG);
const atQuarter = fits.filter((f) => Math.abs(Math.abs(f.sweep) * DEG - 90) <= 0.5);
const shallow = fits.filter((f) => Math.abs(f.sweep) * DEG < 60);
console.log(`    ${fits.length} of ${allMoves} travel curves lie on a circle at 2% of the radius (${pct(fits.length, allMoves)}%)`);
console.log(`    their sweeps: min ${Math.min(...sweeps).toFixed(1)}deg, median ${median(sweeps).toFixed(1)}deg, MAX ${Math.max(...sweeps).toFixed(1)}deg`);
console.log(`    ${atQuarter.length} of them sweep a full quarter (${pct(atQuarter.length, fits.length)}%), ${shallow.length} sweep less than 60deg (${pct(shallow.length, fits.length)}%)`);
console.log(`    the panel's arc checkbox would be ENABLED for ${canLock} of ${allMoves} curves (${pct(canLock, allMoves)}%); blockers: ` + Object.entries(blockers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`    and ${alreadyArc} of ${allMoves} curves IS a quarter arc by the panel's own test (arcOf)`);
check(fits.length > 100, 'circular travel is common enough to matter');
check(Math.max(...sweeps) <= 90.5, 'NO single move sweeps more than a quarter of a circle - the corpus caps a MOVE at 90deg of turn, so a 360deg orbit is necessarily a CHAIN of moves (part 2)');
check(canLock > 0 && canLock < allMoves && alreadyArc === 0, 'the panel\'s lock is available for some curves and is ALWAYS a projection - there is no curve in the corpus that is already the quarter arc it would lock to');

// ============================================================ 2. circular RUNS across moves
console.log('\n== 2. And how often is an ORBIT spread over SEVERAL moves? ==');
const RUN_TOL = 0.02;
const MIN_SWEEP_DEG = 15;
const runs = [];
for (const { level, file, call } of calls) {
  call.dancers.forEach((dancer, i) => {
    const n = dancer.path.length;
    let s = 0;
    while (s < n) {
      let e = s;
      let best = null;
      for (let cand = s; cand < n; cand++) {
        const pts = runSamples(dancer, s, cand);
        if (pts.length < 8) continue;
        const c = kasa(pts);
        if (!c || c.relDev > RUN_TOL) break;
        best = { c, pts };
        e = cand;
      }
      if (best && e > s) {
        const sweep = Math.abs(sweepOf(best.pts, best.c) * DEG);
        if (sweep >= MIN_SWEEP_DEG) runs.push({ level, file, i, s, e, sweep, r: best.c.r, moves: e - s + 1, beats: 0 });
        s = e + 1;
      } else {
        s += 1;
      }
    }
  });
}
const runCalls = new Set(runs.map((r) => `${r.level}/${r.file}`));
console.log(`    ${runs.length} runs of TWO OR MORE consecutive moves lying on ONE circle at ${RUN_TOL} of its radius (sweep >= ${MIN_SWEEP_DEG}deg)`);
console.log(`    across ${runCalls.size} variants = ${pct(runCalls.size, calls.length)}% of the corpus; ${runs.filter((r) => r.moves >= 3).length} of the runs span 3 or more moves`);
console.log(`    run sweeps: median ${median(runs.map((r) => r.sweep)).toFixed(1)}deg, max ${Math.max(...runs.map((r) => r.sweep), 0).toFixed(1)}deg`);
for (const t of [90, 180, 270, 350]) console.log(`    ${runs.filter((r) => r.sweep > t).length} runs sweep more than ${t}deg`);
const perCall = new Map();
for (const r of runs) perCall.set(`${r.level}/${r.file}`, (perCall.get(`${r.level}/${r.file}`) ?? 0) + 1);
console.log(`    the variants with the most circular runs: ` + [...perCall.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join(' '));
const longest = [...runs].sort((a, b) => b.moves - a.moves || b.sweep - a.sweep).slice(0, 6);
console.log('    the longest / widest, first 6:');
for (const r of longest) console.log(`      ${(r.level + '/' + r.file).padEnd(34)} dancer ${r.i + 1} moves ${r.s + 1}..${r.e + 1} (${r.moves}) sweep ${r.sweep.toFixed(0)}deg r ${r.r.toFixed(2)}`);
check(runs.length > 20, 'an orbit spanning several moves is REAL and the panel has no object for it');
check(runs.filter((r) => r.sweep > 180).length > 0, 'and some of those orbits are MORE than half a turn - a quarter lock per move does not let a user say "that is a circle"');

// ============================================================ 3. joints on formation spots
console.log('\n== 3. Are a move\'s ends FIXED POINTS of a formation? ==');
const catalogue = [];
for (const [, poses] of formations) for (const p of poses) catalogue.push({ x: p.x, y: p.y, heading: p.angleDeg / DEG });
console.log(`    the picker offers ${formations.size} formations = ${catalogue.length} placed spots`);

const SPOT_TOL = 1e-3;
const HEAD_TOL = 1 / DEG; // 1 degree

const startSpots = (call) => call.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg / DEG }));
const endSpots = (call) => engine.endPoses(call).map((p) => ({ x: p.x, y: p.y, heading: p.heading }));

const J = { total: 0, interior: 0, onStart: 0, onStartHead: 0, onEnd: 0, onEndHead: 0, onAny: 0, onAnyHead: 0 };
const interiorOnSpot = [];
const headErrOwn = [];
for (const { call } of calls) {
  const S = startSpots(call);
  const E = endSpots(call);
  call.dancers.forEach((dancer) => {
    const n = dancer.path.length;
    for (let k = 0; k <= n; k++) {
      const t = k === 0 ? 0 : engine.moveBeatRange(dancer, k - 1).to;
      const p = engine.poseFor(dancer, t);
      const near = (spots) => spots.filter((s) => Math.hypot(s.x - p.x, s.y - p.y) <= SPOT_TOL);
      const headOk = (hits) => hits.some((h) => Math.abs(norm(h.heading - p.heading)) <= HEAD_TOL);
      const sHit = near(S);
      const eHit = near(E);
      const cHit = near(catalogue);
      J.total++;
      if (k > 0 && k < n) J.interior++;
      if (sHit.length) { J.onStart++; if (headOk(sHit)) { J.onStartHead++; headErrOwn.push(...sHit.map((h) => Math.abs(norm(h.heading - p.heading)) * DEG)); } }
      if (eHit.length) { J.onEnd++; if (headOk(eHit)) J.onEndHead++; }
      if (cHit.length) { J.onAny++; if (headOk(cHit)) J.onAnyHead++; }
      if (k > 0 && k < n) interiorOnSpot.push(cHit.length > 0);
    }
  });
}
console.log(`    ${J.total} joints over every dancer of every variant (${J.interior} of them interior)`);
console.log(`    ${J.onStart} land on one of the call's OWN START spots (${pct(J.onStart, J.total)}%), ${J.onStartHead} of those carry that spot's declared heading (${pct(J.onStartHead, J.onStart)}%)`);
console.log(`    ${J.onEnd} land on one of its OWN END spots (${pct(J.onEnd, J.total)}%), ${J.onEndHead} of those carry the spot's heading (${pct(J.onEndHead, J.onEnd)}%)`);
console.log(`    ${J.onAny} land on ANY spot the picker offers (${pct(J.onAny, J.total)}%), ${J.onAnyHead} with that spot's declared heading`);
console.log(`    of the ${J.interior} INTERIOR joints, ${pct(interiorOnSpot.filter(Boolean).length, J.interior)}% are on a catalogue spot and ${pct(interiorOnSpot.filter((x) => !x).length, J.interior)}% are on no spot at all`);
check(J.onAnyHead > 0, 'a joint can be pinned in BOTH position and heading by a formation');
check(interiorOnSpot.filter(Boolean).length > 0 && interiorOnSpot.filter((x) => !x).length > 0, 'and interior joints are BOTH - a third of them are on no spot at all, so the editor has to make free joints and pinned joints equally easy');

// ============================================================ 4. is a joint already smooth?
//
// THE QUESTION A DRAG HAS TO ANSWER: when a user moves a move's end, does anything have to happen at the JOINT?
// If the corpus's joints are already tangent-continuous, then smoothness is a property the authoring format
// already has and an editor that breaks it is doing damage; if they are mostly corners, then a corner is a
// normal thing to author and forcing smoothness would be the damage.
//
// MEASURED FROM THE POSES, NOT FROM THE ANGLES, because the angle arithmetic has a trap in it: `poseFor` reads
// the travel heading as the move's LOCAL tangent plus the FACING at the move's START, which is only the world
// direction if the frame does not rotate during the move - and a move with a facing curve rotates it. So the
// direction either side of the joint is read as a CHORD of the actual world path, which has no such assumption.
console.log('\n== 4. Is a joint already tangent-continuous? ==');
const DELTA = 1e-3; // beats either side of the joint
const dirOf = (dancer, a, b) => {
  const p = engine.poseFor(dancer, a);
  const q = engine.poseFor(dancer, b);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  return Math.hypot(dx, dy) > 1e-9 ? Math.atan2(dy, dx) : null;
};
const corners = [];
const cornersWithFacing = [];
const cornersWithoutFacing = [];
for (const { call } of calls) {
  call.dancers.forEach((dancer) => {
    const n = dancer.path.length;
    for (let k = 1; k < n; k++) {
      const b = engine.moveBeatRange(dancer, k - 1).to;
      const before = dirOf(dancer, b - DELTA, b);
      const after = dirOf(dancer, b, b + DELTA);
      if (before === null || after === null) continue;
      const c = Math.abs(norm(after - before)) * DEG;
      corners.push(c);
      (dancer.path[k - 1].rotate ? cornersWithFacing : cornersWithoutFacing).push(c);
    }
  });
}
const within = (xs, t) => pct(xs.filter((x) => x <= t).length, xs.length);
console.log(`    ${corners.length} interior joints, direction measured as a chord ${DELTA} beats either side`);
console.log(`    corner at the joint: median ${median(corners).toFixed(2)}deg, max ${Math.max(...corners).toFixed(1)}deg`);
console.log(`    ${within(corners, 0.01)}% are continuous within 0.01deg, ${within(corners, 1)}% within 1deg, ${within(corners, 5)}% within 5deg`);
console.log(`    ${cornersWithoutFacing.length} joints follow a move with NO facing curve: ${within(cornersWithoutFacing, 1)}% within 1deg, median ${median(cornersWithoutFacing).toFixed(2)}deg`);
console.log(`    ${cornersWithFacing.length} follow a move WITH one: ${within(cornersWithFacing, 1)}% within 1deg, median ${median(cornersWithFacing).toFixed(2)}deg`);
check(within(corners, 0.01) !== '100.0', 'the corpus does NOT keep every joint smooth - a corner is an authored thing here, so an editor may not force one away');
check(cornersWithoutFacing.length > 0 && cornersWithFacing.length > 0, 'and the two mechanisms both exist: a joint is smoothed BOTH by the handles lining up and by a facing curve turning the dancer');

// ============================================================ 5. does the dancer face where it is going?
//
// THE MEASUREMENT THAT DECIDES WHETHER FACING CAN BE FOLDED INTO THE TRAVEL TANGENT. Most path editors have one
// direction per point - the tangent - and a dancer would be unable to walk backwards. This engine has TWO
// channels, so the question is not whether that is possible but whether it is USED: if the corpus's dancers
// almost always face the way they travel, then the second channel is decoration and could be derived; if they
// often do not, the separation is load-bearing and any editor that shows one arrow per point is wrong.
//
// Read at the MIDDLE of each move, where the turn is well defined either way, and the travel direction is a
// chord of the real world path so that a facing curve rotating the frame cannot fool it.
console.log('\n== 5. Does the dancer face where it is going? ==');
const SIDE_TOL = 10; // degrees away from "walking forwards"
const facings = [];
for (const { call } of calls) {
  call.dancers.forEach((dancer) => {
    dancer.path.forEach((seg, k) => {
      const r = engine.moveBeatRange(dancer, k);
      const mid = r.from + (r.to - r.from) / 2;
      const travel = dirOf(dancer, mid - DELTA, mid + DELTA);
      if (travel === null) return;
      const p = engine.poseFor(dancer, mid);
      const off = Math.abs(norm(p.heading - travel)) * DEG;
      facings.push(Math.min(off, 360 - off));
    });
  });
}
const forward = facings.filter((x) => x <= SIDE_TOL).length;
const backward = facings.filter((x) => x >= 180 - SIDE_TOL).length;
const sideways = facings.filter((x) => Math.abs(x - 90) <= SIDE_TOL).length;
console.log(`    ${facings.length} poses sampled at the middle of every move`);
console.log(`    facing vs direction of travel: median ${median(facings).toFixed(1)}deg off, max ${Math.max(...facings).toFixed(0)}deg`);
console.log(`    ${pct(forward, facings.length)}% face FORWARD (within ${SIDE_TOL}deg of travel), ${pct(backward, facings.length)}% face BACKWARD, ${pct(sideways, facings.length)}% are SIDEWAYS`);
check(backward + sideways > 0, 'a dancer really does travel while NOT facing the way it goes - so a single direction per point (the tangent, as most path editors have) cannot express this corpus');

// ============================================================ 6. is LOCAL storage a restatement of WORLD paths?
//
// THE CLAIM EVERY "edit in world space" DESIGN RESTS ON, and it is checkable rather than arguable. The stored
// form is incremental: move k's six numbers are a curve in the frame the dancer stands in when move k STARTS,
// and the frames chain. If that chaining is exactly a rigid frame per move, then (boundary position, boundary
// heading, world curve) and (the stored local curves) carry the SAME information, and an editor may work in
// either - so a joint can be dragged in world space and the local numbers recomputed, instead of the other way
// round, which is what the panel does today and why editing a number moves the board.
//
// THE PREDICTION, stated so it can fail: for move k, with (pk, hk) the pose where the move starts,
//     world position at t = pk + R(hk) . translate_k(t)
//     world heading  at t = hk + bezierAngle(b_k, t) - bezierAngle(b_k, 0),   b_k = rotate_k ?? translate_k
// This is not how `poseFor` is written - it composes transforms - so agreement is a real check of the model,
// not a restatement of the code. The heading side is the one that matters, because it is where the facing
// channel and the path tangent meet.
//
// THE SECOND TERM IS ZERO FOR EVERY SHIPPED CURVE - all 4128 facing curves and all 5860 moves with no facing
// start at exactly 0 (`tools/start-facing-probe.mjs`) - so it costs this probe nothing and the corpus cannot
// say whether it is there. It is there because the two channels are read the same way and MEAN different
// things: a `rotate` curve is the turn the move makes, a `translate` curve is the direction it departs in,
// and only the first of those starts at zero. Without it a move with no facing SNAPS to face its own
// departure direction - 180 degrees for a back-up - instead of continuing the heading it arrived with.
console.log('\n== 6. Is the local (stored) form an exact restatement of the world path? ==');
let worstPos = 0;
let worstHead = 0;
let samples = 0;
let worstAt = null;
for (const { level, file, call } of calls) {
  call.dancers.forEach((dancer, i) => {
    dancer.path.forEach((seg, k) => {
      const r = engine.moveBeatRange(dancer, k);
      const start = engine.poseFor(dancer, k === 0 ? 0 : engine.moveBeatRange(dancer, k - 1).to);
      const cos = Math.cos(start.heading);
      const sin = Math.sin(start.heading);
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        const beat = r.from + (r.to - r.from) * t;
        const truth = engine.poseFor(dancer, beat);
        const lp = engine.bezierPoint(seg.translate, t);
        const pred = { x: start.x + cos * lp.x - sin * lp.y, y: start.y + sin * lp.x + cos * lp.y };
        const dp = Math.hypot(pred.x - truth.x, pred.y - truth.y);
        // The predicted heading is the frame's heading plus the local angle profile of the FACING curve,
        // read as a TURN - see the note above on why its own angle at t=0 is subtracted.
        const b = seg.rotate ?? seg.translate;
        const predHead = norm(start.heading + engine.bezierAngle(b, t) - engine.bezierAngle(b, 0));
        const dh = Math.abs(norm(predHead - truth.heading));
        samples++;
        if (dp > worstPos) worstPos = dp;
        if (dh > worstHead) { worstHead = dh; worstAt = `${level}/${file} dancer ${i + 1} move ${k + 1} t=${t}`; }
      }
    });
  });
}
console.log(`    ${samples} samples over every move of every dancer; worst position disagreement ${worstPos.toExponential(2)} units`);
console.log(`    worst HEADING disagreement ${(worstHead * DEG).toExponential(2)}deg${worstAt ? ` (${worstAt})` : ''}`);
check(worstPos < 1e-9 && worstHead < 1e-9, 'the stored local curves and (boundary pose + world curve) carry the SAME information to float precision, so an editor may freely choose which space the user works in');

// ============================================================ 7. are the panel's two primitives degraded?
//
// TWO THINGS THE PANEL OFFERS TODAY ARE SUSPECT FOR A MEASURABLE REASON, and both are cheap to check.
//
// (a) A HOLD WEARING A MOVE'S CLOTHES. If a hold is stored as an ordinary move with zero beats, or with a
//     travel curve of no length, then every editor that treats moves uniformly has to carry a degenerate case,
//     and this repo already has: the arc swing's 22 un-turnable joints are exactly collapsed exit handles.
// (b) THE ARC LOCK CAN NEVER BE A NO-OP. `arcOf` is the panel's "this curve IS a quarter arc" test, and part 1
//     found 0 curves in the corpus pass it - so ticking the box is ALWAYS a projection, which moves the
//     endpoint. If that is true of every curve the box is enabled for, then the lock is a control that always
//     deforms, and the user has no way to lock a curve that is already the shape they want.
console.log('\n== 7. Two primitives the panel offers today ==');
let zeroBeats = 0;
let zeroTravel = 0;
let noExit = 0;
let enabled = 0;
let moved = 0;
const endpointMoves = [];
const relMoves = [];
let worstMove = 0;
for (const { call } of calls) {
  call.dancers.forEach((dancer) => {
    dancer.path.forEach((seg) => {
      const b = seg.translate;
      if (seg.beats === 0) zeroBeats++;
      if (Math.hypot(b.x2, b.y2) <= 1e-9) zeroTravel++;
      if (!engine.hasExitDirection(b)) noExit++;
      if (engine.arcBlocker(b, true) !== null) return; // the box would be disabled
      enabled++;
      const p = engine.projectToArc(b, true);
      if (!p) return;
      const q = engine.arcBezier(p);
      const d = Math.hypot(q.x2 - b.x2, q.y2 - b.y2);
      const chord = Math.hypot(b.x2, b.y2);
      endpointMoves.push(d);
      relMoves.push(chord > 1e-9 ? d / chord : Infinity);
      if (d > 1e-9) moved++;
      worstMove = Math.max(worstMove, d);
    });
  });
}
console.log(`    HOLDS: ${zeroTravel} of ${allMoves} moves have a travel curve of ZERO LENGTH, and ${zeroBeats} have zero beats`);
console.log(`    ${noExit} moves end with the exit handle collapsed onto the endpoint, so their departure has no direction to turn`);
const over = (t) => endpointMoves.filter((d) => d > t).length;
console.log(`    ARC LOCK: enabled for ${enabled} curves; projecting moves the endpoint on ${moved} of them (${pct(moved, enabled)}%)`);
console.log(`    the move: >0.01 units ${over(0.01)} (${pct(over(0.01), enabled)}%), >0.1 units ${over(0.1)} (${pct(over(0.1), enabled)}%), >1 unit ${over(1)} (${pct(over(1), enabled)}%), worst ${worstMove.toFixed(2)}`);
console.log(`    as a fraction of the curve's own chord: median ${pct(median(relMoves), 1)}%`);
check(zeroTravel > 0 && zeroBeats === 0, 'a HOLD is a zero-length travel curve that still costs beats - never zero beats, so the timing channel cannot be used to spot one');
check(moved === enabled, 'the arc lock is enabled ONLY for curves it will change - it can never confirm a curve that is already the shape the user wants');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
