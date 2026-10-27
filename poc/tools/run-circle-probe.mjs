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
// COST, RE-MEASURED BECAUSE THE FIRST ATTEMPT AT IT WAS WRONG. Section 7 used to crash at line 369, so its
// last eight checks never ran; naming the witness restored them, and this header first claimed they cost
// 20.2 s - "24.4 s before, 44.6 s after" - taken from two runs of `verify-probes.mjs`. THOSE WERE THE
// RUNNER'S NUMBERS, and the runner shares ONE PROCESS across all 52 probes, so a per-probe delta between
// two suite runs is not a measurement of that probe. Re-measured as a clean A/B, timing the pre-fix file
// and the post-fix file back to back in the same directory on the same corpus: 28.6 s against 28.0 s. The
// eight restored checks cost NOTHING MEASURABLE, and the probe stays in the fast tier - whose only member
// is still `call-formations-probe.mjs` at 461 s. Recorded at this length because the wrong version is the
// kind of number that gets quoted.
//
// FOUR CHECKS ARE RED AND THE OWNER HAS RULED ON ALL OF THEM, so read this before "fixing" any of them.
// Section 7's two OFFSET pins — `but every one of those orbits is OFFSET from the origin` and
// `and the offsets match in size (…) while differing in direction` — are the ones `PLAN.md` already
// records in its "one POC probe is red at HEAD for a reason that is not this work" note, which quotes the
// same assertion (`offsets.every(o => o > 0.5)`): the corpus re-authoring took the offset out of those
// orbits and they now measure 0.000, so the assertions are false about today's corpus. The other two
// are LIVE AND ATTRIBUTED, and they were invisible until section 7 stopped crashing:
//
//   `and it still CLOSES` — a run whose ends gap is EXACTLY 0 comes back with a gap of 3.831e-3.
//   `and the run keeps the turn it had` — a re-laid run's radius drifts 7.766 -> 7.474 -> 7.183 and its
//   refit sweep goes -29.9 -> -56.4.
//
// THEY ARE ONE MECHANISM, MEASURED. `setRunCircle` advances the re-laid frame with
// `h = atan2(P3 - P2)` (its `seg.rotate ? … : atan2(…)` line in `engine/src/editor.ts`) for a move with
// no `rotate` curve - it assumes the frame heading IS the arc's tangent, which `fitCircleRun`'s own doc
// states as the intent. `poseFor` (in `engine/src/core.ts`), since `67bba6f`, advances the frame by the
// travel curve's RELATIVE turn instead, so it no longer snaps a no-facing move onto its tangent. The two
// agree only while the dancer's heading at the run's start is already tangent to the target circle.
// Letting `delta` be that mismatch, on the `and it still CLOSES` witness (re-laid at twice its own
// radius, beats evened as the probe does):
//
//     delta = -0.077deg   BEFORE sweep -360.000deg, ends gap 0.000e+0
//                         AFTER  sweep -359.923deg, ends gap 3.831e-3
//
// The sweep loses EXACTLY `delta`. On the `and the run keeps the turn it had` witness the mismatch is
// 111.5deg and the composed path is no longer an arc at all. THE OWNER'S RULING IS TO LEAVE IT RED AND
// RECORD IT rather than choose between the three repairs (make `poseFor` snap again - what `67bba6f`
// deliberately removed; make `setRunCircle` advance by the relative turn of the arc it wrote; or have it
// refuse a run whose start is not tangent, as it already refuses one that is not ON the circle). Do not
// re-pin either check.
//
// Run: node tools/run-circle-probe.mjs   (from anywhere; reads engine/dist, so build the engine first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const assets = corpusRoot();
const asset = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');
const DEG = 180 / Math.PI;

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
// THE REFLOW. `.ed-group` is a nowrap row and `.ed-grid` is the thing that wraps, so the six controls of the
// circle row in ONE group was a row that could not break and the button fell off the end of the pane. Each
// label+control pair is its own group now, and a regression to one group is a regression to the overflow.
has(/grid\.appendChild\(runWrap\)/, 'the circle controls are SEPARATE groups rather than one nowrap row, which is what pushed the button off the pane');
has(/grid\.appendChild\(goWrap\)/, 'and the buttons are in a group of their own, so they wrap like every other field');
has(/this\.circleCentre = \{ x: 0, y: 0 \};/, 'the centre can be put at the ORIGIN with one press');
has(/grid\.appendChild\(cWrap\)/, 'and the centre controls are their own group too, for the same reason');
has(/this\.circleCentre = null;/, 'and a named centre can be given back to the run that owns it');
has(/if \(!this\.circleCentre && \(radius === null/, 'a named centre needs no radius field, because the radius follows from the pinned start');
has(/this\.statusEl\.textContent = `✗ \$\{why\[0\]/, 'a run that no dancer accepted is reported, not swallowed');
// The refusal is the user's chosen rule, so its TEXT has to reach the screen rather than being replaced by a
// generic "could not".
has(/why\.push\(`dancer \$\{d \+ 1\}: \$\{\(err as Error\)\.message\}`\)/, 'and an engine refusal is carried to the status line with the engine\'s own words, which name the move and the angle');

// ============================================================ 2. the panel's rule, mirrored
//
// The exact rule from `circleFor`, so what is measured is the panel's behaviour and not a convenient
// simplification of it. A RUN THAT IS ALREADY A CIRCLE KEEPS ITS CENTRE and only its radius and turn move; a
// run that is not takes the circle through its ENDS. Getting this backwards is what section 6 exists to catch.
function circleFor(call, d, from, to, radius, side, centre) {
  const dancer = call.dancers[d];
  if (!dancer || to <= from || to >= dancer.path.length) return null;
  const p0 = engine.poseFor(dancer, from === 0 ? 0 : engine.moveBeatRange(dancer, from - 1).to);
  const p1 = engine.poseFor(dancer, engine.moveBeatRange(dancer, to).to);
  const own = engine.fitCircleRun(call, d, from, to);
  const turn = own ? (side === 1 ? own.sweep : -own.sweep) : engine.runTurn(call, d, from, to);
  if (centre) {
    // A NAMED CENTRE FIXES THE RADIUS at |start - centre|, because the start is pinned.
    const r = Math.hypot(p0.x - centre.x, p0.y - centre.y);
    if (!(r > 1e-9)) return null;
    return { cx: centre.x, cy: centre.y, r, sweep: turn };
  }
  if (own) {
    const dist = Math.hypot(p0.x - own.cx, p0.y - own.cy);
    if (!(dist > 1e-9)) return null;
    const k = radius / dist;
    return {
      cx: p0.x + (own.cx - p0.x) * k,
      cy: p0.y + (own.cy - p0.y) * k,
      r: radius,
      sweep: side === 1 ? own.sweep : -own.sweep,
    };
  }
  return engine.circleThrough(p0, p1, radius, side, engine.runTurn(call, d, from, to));
}

/** The panel's whole-call edit: one radius, one side and optionally one CENTRE, each dancer about its own ends. */
function groupCircle(call, targets, from, to, radius, side, centre = null) {
  let next = call;
  let done = 0;
  const why = [];
  for (const d of targets) {
    const circle = circleFor(next, d, from, to, radius, side, centre);
    if (!circle) { why.push(`dancer ${d + 1}: no circle of that radius joins this run's ends`); continue; }
    try { next = engine.setRunCircle(next, d, from, to, circle); done++; }
    catch (err) { why.push(`dancer ${d + 1}: ${err.message}`); }
  }
  return { next, done, why };
}

// ============================================================ 3. a whole call laid on one circle
console.log('\n== 3. Does the GROUP rule work for all eight at once? ==');
const files = [];
for (const lvl of ['ms', 'a2', 'c2']) {
  for (const f of filesOf(lvl).filter((x) => x.endsWith('.xml'))) files.push([lvl, f]);
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
        const c = Math.abs(engine.normAngle(dirOf(nd, bb + 1e-3, bb) - dirOf(nd, bb, bb - 1e-3)));
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
  const circle = circleFor(closed.call, closed.d, cf, closed.to, wanted, 1, null);
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

// ============================================================ 6. no run is DESTROYED
//
// THE REGRESSION GATE FOR A BUG A CALLER FOUND: "The Make Circle button seems to completely collapse the trace.
// After pressing all I see is a single drag point and no trace line." It was real, and it was the flagship
// case - `ms/circle.xml`'s 360deg `Circle Left`, whose ends are 0.055 apart on a radius of 2.595, so the arc
// chosen through those ends was 1.2deg and a 16.34-unit orbit became 0.06. TWO POINTS ON A CIRCLE ADMIT TWO
// ARCS and the endpoints do not say which; the run's own turn and its own centre do.
//
// So EVERY run the control is offered for, laid on its OWN circle at its OWN radius, must come back with the
// turn it had and the length it had. Section 3 could not have caught this: it only looked at runs whose WHOLE
// path fits a circle, which excludes the lead-in and lead-out of exactly the calls built around an orbit.
console.log('\n== 6. Is any run DESTROYED by being laid on its own circle? ==');
const pathLen = (dancer, t0, t1) => {
  let L = 0;
  let prev = engine.poseFor(dancer, t0);
  for (let i = 1; i <= 40; i++) {
    const q = engine.poseFor(dancer, t0 + ((t1 - t0) * i) / 40);
    L += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
  }
  return L;
};
let tested = 0;
let destroyed = 0;
let worstKeep = 1;
let worstTurn = 0;
let worstAt = '';
const losses = [];
for (const [lvl, f] of files) {
  let tams = [];
  try { tams = engine.parseCallXml(asset(`${lvl}/${f}`)); } catch { continue; }
  for (const tam of tams.slice(0, 2)) {
    let call;
    try { call = engine.normalizeInstance(engine.buildCall(tam, engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true)); } catch { continue; }
    if (call.dancers.length !== 8) continue;
    for (let d = 0; d < 8; d++) {
      const n = call.dancers[d].path.length;
      for (let from = 0; from < n - 1; from++) {
        for (let to = from + 1; to < n; to++) {
          const own = engine.fitCircleRun(call, d, from, to);
          // The panel only has a default radius when the run already fits a circle, so that is the population
          // the button acts on without the caller typing anything.
          if (!own) continue;
          const circle = circleFor(call, d, from, to, own.r, 1, null);
          if (!circle) continue;
          let next;
          try { next = engine.setRunCircle(call, d, from, to, circle); } catch { continue; }
          tested++;
          const dancer = call.dancers[d];
          const nd = next.dancers[d];
          const b0 = from === 0 ? 0 : engine.moveBeatRange(dancer, from - 1).to;
          const b1 = engine.moveBeatRange(dancer, to).to;
          const nb0 = from === 0 ? 0 : engine.moveBeatRange(nd, from - 1).to;
          const nb1 = engine.moveBeatRange(nd, to).to;
          const before = pathLen(dancer, b0, b1);
          const after = pathLen(nd, nb0, nb1);
          const keep = before > 1e-9 ? after / before : 1;
          if (keep < worstKeep) { worstKeep = keep; worstAt = `${lvl}/${f} d${d + 1} ${from + 1}..${to + 1}`; }
          if (keep < 0.9) { destroyed++; losses.push(`${lvl}/${f} ${from + 1}..${to + 1}: ${(keep * 100).toFixed(0)}%`); }
          // The turn, read off the re-laid run rather than assumed.
          const refit = engine.fitCircleRun(next, d, from, to);
          if (refit) worstTurn = Math.max(worstTurn, Math.abs(refit.sweep - own.sweep) * DEG);
        }
      }
    }
  }
}
console.log(`    ${tested} runs laid on their own circle at their own radius`);
console.log(`    the least of the path that survives: ${(worstKeep * 100).toFixed(1)}% (${worstAt})`);
console.log(`    the turn moves by at most ${worstTurn.toExponential(1)}deg`);
check(tested > 100, 'the sweep is every run the control would act on, not a witness');
check(destroyed === 0, `NO run is destroyed - none loses even a tenth of its length${losses.length ? ` (${losses.length} did: ${losses.slice(0, 3).join('; ')})` : ''}`);
check(worstKeep > 0.9, `and the worst case keeps ${(worstKeep * 100).toFixed(1)}% of its path, so this is a re-lay and not a rewrite`);
check(worstTurn < 1, 'and the run keeps the turn it had, so the call still goes as far round as it did');

// ============================================================ 7. naming the CENTRE
//
// Asked for, after the panel was working: "The Circle left call starting from Circle has a trace that is an
// offset circle. I want to select all the moves, create the circle and then put the center of the circle at the
// origin (or where i drag the circle center to)."
//
// The witness is `ms/circle.xml` tam #1, `from="Circle"`: its dancers stand on a ring of radius 2.613 about the
// origin and walk an orbit of radius 2.595 whose centre is 1.013 units off it - a DIFFERENT direction for each
// dancer, because the offset is authored in the dancer's own frame. A radius cannot correct that; the orbit is
// the right size and in the wrong place. Naming a centre can, and it needs no radius field at all: the run's
// start is pinned, so |start - centre| IS the radius.
console.log('\n== 7. Do the eight dancers\' orbits come back onto the ring they started on? ==');
// THE WITNESS IS NAMED, NOT TAKEN BY POSITION. This loop used to take the FIRST tam whose formation is
// `Circle` and break. That was `Circle Left` when it was written; `ms/circle.xml` carries SIXTEEN tams with
// `formation="Circle"`, and the first of them is the home-ending sibling - `Circle Left - Stop at Home` when
// this was found, `Circle Left Home` since the corpus renamed it - which is a DIFFERENT call. What that cost
// was loud and is recorded because it is the reason this loop is written the way it is: `before` came back
// all `null` (the sibling's first moves were not a circle then) and line 369's `f.cx` threw, which killed the
// run before this section's last EIGHT checks - the whole named-centre validation - could execute.
// MEASURED TODAY, AND IT IS NOW THE QUIETER FAILURE: the first three `formation="Circle"` tams are
// `Circle Left Home` | `Circle Left 3/4 Home` | `Circle Left 1/2 Home`, and `fitCircleRun` ACCEPTS the first
// (a circle) and refuses the third (`null`). So the position-based loop would no longer crash - it would
// silently validate the wrong call, which is worse than the throw that exposed it.
// AGENTS.md §8 trap 7: a position into an authored list is not an identity. The `check` below already
// names `Circle Left`, so this selects what it names.
const circleTams = engine.parseCallXml(asset('ms/circle.xml'));
let ring = null;
for (const tam of circleTams) {
  let call;
  try { call = engine.normalizeInstance(engine.buildCall(tam, engine.parseFormations(formationsXml), engine.parseMoves(movesXml), true)); } catch { continue; }
  if (call.dancers.length !== 8) continue;
  if (tam.title !== 'Circle Left') continue;
  if (!/^circle$/i.test((tam.formationAttr ?? '').trim())) continue;
  ring = call;
  break;
}
check(!!ring, 'ms/circle.xml has a `Circle Left` that starts FROM a Circle - the call the report names');
if (ring) {
  const starts = ring.dancers.map((d) => Math.hypot(d.x, d.y));
  const spread = Math.max(...starts) - Math.min(...starts);
  check(spread < 1e-9, `and its dancers really do stand on a ring about the origin (radius ${starts[0].toFixed(3)}, spread ${spread.toExponential(1)})`);
  const to = ring.dancers[0].path.length - 1;
  const before = ring.dancers.map((_, d) => engine.fitCircleRun(ring, d, 0, to));
  check(before.every(Boolean), 'and every one of them already walks a circle - the size is right');
  const offsets = before.map((f) => Math.hypot(f.cx, f.cy));
  console.log(`    before: each orbit has radius ${before[0].r.toFixed(3)} and its centre ${offsets[0].toFixed(3)} from the origin`);
  check(offsets.every((o) => o > 0.5), 'but every one of those orbits is OFFSET from the origin, which is the trace the caller described');
  // These are REFIT readings, so the tolerances are the fit's own sampling error and not machine epsilon: the
  // radius the engine was handed is exact by construction, but what `fitCircleRun` measures back carries the
  // sampling of the polyline it reads.
  check(Math.abs(Math.max(...offsets) - offsets[0]) < 1e-3 && offsets[0] > 0.5,
    `and the offsets match in size (${offsets[0].toFixed(3)}) while differing in direction, because the authored offset is in each dancer's own frame`);
  // The edit: select every move, name the origin.
  const startsBefore = ring.dancers.map((d) => engine.poseFor(d, 0));
  const { next, done, why } = groupCircle(ring, [0, 1, 2, 3, 4, 5, 6, 7], 0, to, null, 1, { x: 0, y: 0 });
  check(done === 8, `all eight take a named centre with NO radius given${why.length ? ` (${why[0]})` : ''}`);
  const after = next.dancers.map((_, d) => engine.fitCircleRun(next, d, 0, to));
  check(after.every(Boolean), 'and every one of them is still a circle afterwards');
  const afterCentre = Math.max(...after.map((f) => Math.hypot(f.cx, f.cy)));
  console.log(`    after: every orbit is centred ${afterCentre.toExponential(1)} from the origin`);
  check(afterCentre < 1e-4, 'so every orbit now goes round the MIDDLE OF THE SET, which is what was asked for');
  const radii = after.map((f) => f.r);
  const rSpread = Math.max(...radii) - Math.min(...radii);
  check(rSpread < 1e-4 && Math.abs(radii[0] - starts[0]) < 1e-3,
    `and each radius fell out of where that dancer starts (${radii[0].toFixed(3)} against the ring radius ${starts[0].toFixed(3)}), so no radius had to be given`);
  const movedStart = Math.max(...next.dancers.map((d, i) => {
    const p = engine.poseFor(d, 0);
    return Math.hypot(p.x - startsBefore[i].x, p.y - startsBefore[i].y);
  }));
  check(movedStart < 1e-9, `no dancer's START moved (worst ${movedStart.toExponential(1)} units) - that is what makes the radius follow rather than be chosen`);
  const sweepChange = Math.max(...after.map((f, d) => Math.abs(f.sweep - before[d].sweep) * DEG));
  check(sweepChange < 1e-2, `and every orbit still goes as far round as it did (worst change ${sweepChange.toExponential(1)}deg), so it still closes`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);