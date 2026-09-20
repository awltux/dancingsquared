// Probe: THE RUN-LEVEL CIRCLE IN THE PANEL - what it wires, and what the GROUP rule does.
//
// Asked for: "Are you ready to implement 'The run-level circle'", with two decisions taken - build the fields
// first and the drag after, and REFUSE a turn a move cannot carry in quarters rather than approximating it.
//
// The engine operation is gated separately (`engine/test/editor.mjs` 25: both ends kept, the turn spread by
// beats, every joint still joining). What is NOT covered there is the panel's own rule, which is different in
// one important way: THE ENGINE IS TOLD ONE CIRCLE PER DANCER, AND THE PANEL HAS ONLY ONE RADIUS TO SHARE.
// Eight dancers circling a centre start and finish in eight different places, so what a group edit can hold in
// common is the radius and the side; the centre has to follow from each dancer's own run. That rule is in
// `editor-ui.ts` and this probe is where it is measured, because a group edit that works for the first dancer
// and silently refuses the other seven is exactly the failure the status line exists to prevent.
//
// The panel's rule is MIRRORED here rather than imported - it is private to the controller and the controller
// needs a DOM - so section 1 audits the source to make sure the mirror is of the rule that is actually there.
//
// Run: node tools/run-circle-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
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

// ============================================================ 1. the wiring
console.log('== 1. Is the control wired, and wired to the rule this probe mirrors? ==');
const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
const has = (re, msg) => check(re.test(ui), msg);
has(/setRunCircle\s*\(/, 'the panel calls the engine\'s `setRunCircle` rather than rewriting curves itself');
has(/fitCircleRun\s*\(/, 'and it READS the run with `fitCircleRun`, so "make it circular" can default to the radius the run already has');
has(/circleThrough\s*\(/, 'and it builds the circle from the run\'s two ends with `circleThrough`');
has(/runCircleMoveCount\s*\(/, 'and it quotes `runCircleMoveCount` rather than re-deriving how many moves a turn needs');
has(/private async doRunCircle|private doRunCircle/, 'the group edit is one method');
has(/go\.addEventListener\('click', \(\) => this\.doRunCircle\(\)\)/, 'and a button calls it');
has(/selectMove\(k, ev\.shiftKey\)/, 'shift-click in the moves strip extends the run');
has(/this\.circleTo = k;/, 'and that is what the run end is set from');
has(/in-run/, 'the moves inside the run are drawn as part of the selection, so the range is visible before it is applied');
has(/this\.statusEl\.textContent = `✗ \$\{why\[0\]/, 'a run that no dancer accepted is reported, not swallowed');
// The refusal is the user's chosen rule, so its TEXT has to reach the screen rather than being replaced by a
// generic "could not".
has(/why\.push\(`dancer \$\{d \+ 1\}: \$\{\(err as Error\)\.message\}`\)/, 'and an engine refusal is carried to the status line with the engine\'s own words, which name the move and the angle');

// ============================================================ 2. the panel's rule, mirrored
//
// The exact rule from `circleFor`, including the closed-run branch, so what is measured is the panel's
// behaviour and not a convenient simplification of it.
function circleFor(call, d, from, to, radius, side) {
  const dancer = call.dancers[d];
  if (!dancer || to <= from || to >= dancer.path.length) return null;
  const p0 = engine.poseFor(dancer, from === 0 ? 0 : engine.moveBeatRange(dancer, from - 1).to);
  const p1 = engine.poseFor(dancer, engine.moveBeatRange(dancer, to).to);
  const through = engine.circleThrough(p0, p1, radius, side);
  if (through) return through;
  const fit = engine.fitCircleRun(call, d, from, to);
  if (!fit) return null;
  const dist = Math.hypot(p0.x - fit.cx, p0.y - fit.cy);
  if (!(dist > 1e-9)) return null;
  const k = radius / dist;
  const turns = Math.max(1, Math.round(Math.abs(fit.sweep) / (2 * Math.PI)));
  return {
    cx: p0.x + (fit.cx - p0.x) * k,
    cy: p0.y + (fit.cy - p0.y) * k,
    r: radius,
    sweep: (fit.sweep >= 0 ? 1 : -1) * side * turns * 2 * Math.PI,
  };
}

/** The panel's whole-call edit: ONE radius and ONE side, every selected dancer about its own ends. */
function groupCircle(call, targets, from, to, radius, side) {
  let next = call;
  let done = 0;
  const why = [];
  for (const d of targets) {
    const circle = circleFor(next, d, from, to, radius, side);
    if (!circle) { why.push(`dancer ${d + 1}: no circle of that radius joins this run's ends`); continue; }
    try { next = engine.setRunCircle(next, d, from, to, circle); done++; }
    catch (err) { why.push(`dancer ${d + 1}: ${err.message}`); }
  }
  return { next, done, why };
}

// ============================================================ 3. a whole call laid on one circle
console.log('\n== 3. Does the GROUP rule work for all eight at once? ==');
const files = [];
for (const lvl of ['ms', 'b1', 'b2', 'a2', 'c2']) {
  for (const f of fs.readdirSync(path.join(assets, lvl)).filter((x) => x.endsWith('.xml'))) files.push([lvl, f]);
}
let groupTried = 0;
let groupAll = 0;
let worstEndBeyond = -Infinity;
let worstRefit = 0;
let worstStart = 0;
let worstCorner = 0;
const partial = [];
for (const [lvl, f] of files) {
  let tams = [];
  try { tams = engine.parseCallXml(asset(`${lvl}/${f}`)); } catch { continue; }
  for (const tam of tams.slice(0, 3)) {
    let call;
    try { call = engine.normalizeInstance(engine.buildCall(tam, engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true)); } catch { continue; }
    if (call.dancers.length !== 8) continue;
    const from = 0;
    const to = call.dancers[0].path.length - 1;
    if (to - from < 1) continue;
    // Only calls where EVERY dancer's whole path is already a circle: that is the case where a single shared
    // radius is meaningful, and it is the one the control is for.
    const fits = call.dancers.map((_, d) => engine.fitCircleRun(call, d, from, to));
    if (fits.some((x) => !x)) continue;
    const radius = fits.reduce((a, x) => a + x.r, 0) / 8;
    const b0 = 0;
    const before = call.dancers.map((dancer) => ({
      p0: engine.poseFor(dancer, b0),
      p1: engine.poseFor(dancer, engine.moveBeatRange(dancer, to).to),
    }));
    const { next, done, why } = groupCircle(call, [0, 1, 2, 3, 4, 5, 6, 7], from, to, radius, 1);
    groupTried++;
    if (done !== 8) { partial.push({ lvl, f, done, why: why[0] }); continue; }
    groupAll++;
    for (let d = 0; d < 8; d++) {
      const nd = next.dancers[d];
      const q0 = engine.poseFor(nd, b0);
      const q1 = engine.poseFor(nd, engine.moveBeatRange(nd, to).to);
      worstStart = Math.max(worstStart, Math.hypot(q0.x - before[d].p0.x, q0.y - before[d].p0.y));
      worstEndBeyond = Math.max(worstEndBeyond, Math.hypot(q1.x - before[d].p1.x, q1.y - before[d].p1.y) - fits[d].maxDev);
      const refit = engine.fitCircleRun(next, d, from, to);
      if (!refit) worstRefit = Infinity;
      else worstRefit = Math.max(worstRefit, Math.abs(refit.r - radius) / radius);
      const dirOf = (dd, a, b) => {
        const u = engine.poseFor(dd, a);
        const v = engine.poseFor(dd, b);
        return Math.atan2(v.y - u.y, v.x - u.x);
      };
      for (let kk = from + 1; kk <= to; kk++) {
        const bb = engine.moveBeatRange(nd, kk - 1).to;
        const c = Math.abs(norm(dirOf(nd, bb + 1e-3, bb) - dirOf(nd, bb, bb - 1e-3)));
        worstCorner = Math.max(worstCorner, Math.min(c, 2 * Math.PI - c) * DEG);
      }
    }
  }
}
console.log(`    ${groupAll} of ${groupTried} whole-call runs took ONE shared radius for all eight dancers`);
if (partial.length) console.log(`    the ones that did not: ` + partial.slice(0, 4).map((p) => `${p.lvl}/${p.f} (${p.done}/8: ${p.why})`).join('; '));
console.log(`    the shared radius is hit to ${worstRefit.toExponential(1)} of itself, and a start moves by ${worstStart.toExponential(1)} units`);
console.log(`    an end moves by no more than the fit was already out by (worst excess ${worstEndBeyond.toExponential(1)}), worst joint corner ${worstCorner.toExponential(1)}deg`);
check(groupAll > 0, 'a whole call CAN be laid on one shared radius - the group rule is not a per-dancer accident');
check(worstRefit < 0.02, 'and every dancer ends up on the radius that was asked for, to within the fit tolerance');
check(worstStart < 1e-9, 'no dancer\'s run START moves - the radius is snapped to it, so the pinned ends stay pinned');

// ============================================================ 4. the run that closes on itself
console.log('\n== 4. The closed run: a 360deg orbit, whose ends are the SAME point ==');
let closed = null;
// EVERY (from, to) PAIR, not just the ones starting at move 0 - and that is not tidiness: `ms/circle.xml`'s
// 360deg orbit is moves 2..9 of a ten-move path, because the call has a lead-in and a lead-out. A search that
// only looked at move 0 reported that no closed run exists in the corpus, which is false.
outer:
for (const [lvl, f] of files) {
  let tams = [];
  try { tams = engine.parseCallXml(asset(`${lvl}/${f}`)); } catch { continue; }
  for (const tam of tams.slice(0, 3)) {
    let call;
    try { call = engine.normalizeInstance(engine.buildCall(tam, engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true)); } catch { continue; }
    if (call.dancers.length !== 8) continue;
    for (let d = 0; d < 8; d++) {
      const n = call.dancers[d].path.length;
      for (let from = 0; from < n - 2; from++) {
        const b0 = from === 0 ? 0 : engine.moveBeatRange(call.dancers[d], from - 1).to;
        const p0 = engine.poseFor(call.dancers[d], b0);
        for (let to = from + 2; to < n; to++) {
          const p1 = engine.poseFor(call.dancers[d], engine.moveBeatRange(call.dancers[d], to).to);
          if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1e-6) continue;
          const fit = engine.fitCircleRun(call, d, from, to);
          if (!fit || Math.abs(fit.sweep) < 2 * Math.PI - 0.1) continue;
          closed = { lvl, f, call, d, from, to, fit };
          break outer;
        }
      }
    }
  }
}
if (!closed) {
  check(false, 'a run whose ends COINCIDE was found in the corpus - without one, the closed branch is untested');
} else {
  const cf = closed.from;
  console.log(`    ${closed.lvl}/${closed.f} dancer ${closed.d + 1} moves ${cf + 1}–${closed.to + 1}: radius ${closed.fit.r.toFixed(3)}, one full turn`);
  // `circleThrough` has no answer here, which is the whole reason the branch exists.
  const p0 = engine.poseFor(closed.call.dancers[closed.d], cf === 0 ? 0 : engine.moveBeatRange(closed.call.dancers[closed.d], cf - 1).to);
  const p1 = engine.poseFor(closed.call.dancers[closed.d], engine.moveBeatRange(closed.call.dancers[closed.d], closed.to).to);
  check(engine.circleThrough(p0, p1, 3, 1) === null, 'the chord is a POINT and `circleThrough` correctly refuses it');
  const wanted = closed.fit.r * 2;
  const circle = circleFor(closed.call, closed.d, cf, closed.to, wanted, 1);
  check(!!circle, 'and the panel\'s closed-run branch still finds a circle to lay it on');
  // THE ENGINE REFUSES A FULL TURN OVER UNEVEN BEATS, and it is right to: a 360deg orbit spread over beats
  // [1.5, 3, 3, 1.5] asks the middle move for 120deg, and a move carries a quarter. So the widening is tested on
  // an EVEN-BEAT copy of the same run, and the refusal on the real one is asserted in section 5 - both are the
  // rule the user chose, and a probe that quietly used whichever run happened to work would test neither.
  const beats = closed.call.dancers[closed.d].path.slice(cf, closed.to + 1).map((g) => g.beats);
  const even = beats.every((b) => b === beats[0]);
  console.log(`    its beats are ${beats.join(', ')}${even ? '' : ' - uneven, so a full turn over them must be refused'}`);
  const evened = {
    ...closed.call,
    dancers: closed.call.dancers.map((x, j) => (j === closed.d
      ? { ...x, path: x.path.map((g, k) => (k >= cf && k <= closed.to ? { ...g, beats: 2 } : g)) }
      : x)),
  };
  const { next, done } = groupCircle(evened, [closed.d], cf, closed.to, wanted, 1);
  check(done === 1, `and the engine takes it once the beats are even (${beats.length} moves of 2 beats)`);
  const refit = engine.fitCircleRun(next, closed.d, cf, closed.to);
  check(!!refit && Math.abs(refit.r - wanted) / wanted < 0.02, `the orbit comes back at the radius asked for (${refit ? refit.r.toFixed(3) : 'not a circle'} against ${wanted.toFixed(3)})`);
  check(!!refit && Math.abs(Math.abs(refit.sweep) - 2 * Math.PI) < 0.05, `and it is still ONE full turn (${refit ? (Math.abs(refit.sweep) * DEG).toFixed(2) : '?'}deg)`);
  const nb0 = cf === 0 ? 0 : engine.moveBeatRange(next.dancers[closed.d], cf - 1).to;
  const q0 = engine.poseFor(next.dancers[closed.d], nb0);
  const q1 = engine.poseFor(next.dancers[closed.d], engine.moveBeatRange(next.dancers[closed.d], closed.to).to);
  check(Math.hypot(q1.x - q0.x, q1.y - q0.y) < 1e-6, 'and it still CLOSES - the ends coincide as they did, which is what makes it a circle rather than a spiral');
}

// ============================================================ 5. the refusal is the chosen rule
console.log('\n== 5. A turn a move cannot carry is refused, not approximated ==');
if (closed) {
  const d0 = closed.call.dancers[closed.d];
  const segs = d0.path.map((g, k) => (k >= closed.from && k <= closed.to ? { ...g, beats: k === closed.from + 1 ? 3 : 1 } : g));
  const call2 = { ...closed.call, dancers: closed.call.dancers.map((x, j) => (j === closed.d ? { ...x, path: segs } : x)) };
  let msg = null;
  try { engine.setRunCircle(call2, closed.d, closed.from, closed.to, { cx: closed.fit.cx, cy: closed.fit.cy, r: closed.fit.r, sweep: 2 * Math.PI }); }
  catch (e) { msg = e.message; }
  console.log(`    ${msg}`);
  const angle = msg ? Number((/turn ([\d.]+)deg/.exec(msg) ?? [])[1]) : NaN;
  check(!!msg && angle > 90 && angle <= 360, 'the refusal names the move and a REAL angle, so the caller can see what to change');
  check(/carries at most 90deg/.test(msg ?? ''), 'and says what the limit is, so the number means something');
} else {
  check(false, 'the refusal case could not be built without a closed run');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
