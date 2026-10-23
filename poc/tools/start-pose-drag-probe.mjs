// DRAGGING A DANCER'S START POSE: WHAT THE DRAG DOES TO THE REST OF THE SELECTION.
//
// Asked for: "Currently drag and drop only applies to Moves. I also want to be able to drag the start point
// and change rotation of each dancer using the same mechanisms used by the Moves." Settled while planning:
// with several dancers selected the board draws the FOCUS dancer's handle (the lowest-numbered selected one)
// and writes EVERY selected dancer, and the write is measured against the pose each dancer had when the
// gesture began - not one absolute value copied onto all of them, which would collapse the selection onto a
// single spot.
//
// THEN REPORTED, and this is the rule the probe now pins: "When multiple dancers are selected and I've
// selected Edit: Dancers: Position, when I move the highlighted dancer all the other dancers move in lock
// step rather than using a board transform e.g. If I move a dancer towards the center of the board, all
// dancers should move towards the center of the board. Currently they move using global coordinates."
//
// SO THE RULE IS ONE BOARD TRANSFORM, and it lives in `src/board-transform.ts` - IMPORTED below, not
// mirrored, because a rule that has to be measured must not be a copy in the instrument (the same reason
// `grid-magnet.ts` exists). It is a scale about the board's centre plus a floor shift:
//
//     scale   = |p1| / |p0|                  the focus's distance from the centre, after over before
//     (dx,dy) = p1 - scale * p0              whatever motion is left over
//
// THE OLD SAME-DELTA RULE IS THE CONSTANT-RADIUS SLICE OF IT, and section 1a pins that rather than leaving
// it as a claim in a comment: a drag that keeps the focus on its own circle has scale == 1 and the whole
// selection takes the same shift, which is exactly what this axis did before. Section 1b then pins what is
// new - a radial drag scales every selected dancer about the centre by the same factor - and section 1c
// pins the thing that makes grid snapping still mean something: the focus lands EXACTLY where the pointer is.
//
// THE ROTATION HALF IS UNCHANGED, and section 2 measures why it is the bigger edit of the two. A dancer's
// moves are authored in the dancer's OWN frame: `poseFor` composes `fromPosAngle(x, y, angleDeg)` and then
// evaluates each move's local curve, so `x`, `y` and `angleDeg` are not a label on the track - they are the
// frame THE WHOLE TRACK IS DRAWN IN. A heading change therefore turns the entire path about the dancer's own
// start, which the probe measures as: the displacement `end - start` keeps its LENGTH and gains the ANGLE.
//
// THE REJECTED RULES ARE MEASURED TOO, each as the negative control for the check it would break, because a
// check that no alternative fails is a check that is not testing anything:
//
//   - "ALL SELECTED DANCERS TAKE THE FOCUS DANCER'S START POSE" (instead of the transform) keeps every
//     dancer's own numbers correct one at a time and still destroys the SET, because the dancers land on top
//     of each other. Section 1b's pairwise-scale check catches it.
//   - "SPIN THE POSITIONS ABOUT THEIR CENTROID while turning the headings" is the rule the centroid answer
//     would have meant for the ROTATION axis, and it is a perfectly rigid edit - so it preserves the track's
//     own shape exactly, and section 2's LENGTH check does NOT catch it. Section 2's "moves nobody" check does.
//   - "SCALE ABOUT THE POINT BEING DRAGGED" rather than about the board's centre is the control for 1b, and
//     it is the one an implementation would reach for by accident: the dragged dancer IS the pivot in the
//     caller's hand. It too preserves the set's shape up to a scale, so only the check that measures the
//     distance FROM THE CENTRE tells the two apart.
//
// The gesture itself lives in `editor-ui.ts`, which is TypeScript under Vite with a DOM and cannot run here -
// the same limit `facing-end-drag-probe.mjs` and `move-clipboard-probe.mjs` record. So the geometry is
// measured against the ENGINE, with the panel's write rules taken from the module the panel itself uses, and
// the panel's use of them is read from the source in section 5.
//
// Run: node tools/start-pose-drag-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
// THE RULE ITSELF, imported from the module the panel imports - see the header.
const board = await import(pathToFileURL(path.join(POC_DIR, 'src', 'board-transform.ts')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const movesXml = fs.readFileSync(path.join(corpusRoot(), 'moves.xml'), 'utf8');
const formationsXml = fs.readFileSync(path.join(corpusRoot(), 'formations.xml'), 'utf8');
const LEVELS = fs.readdirSync(path.join(corpusRoot())).filter((d) => !d.includes('.') && d !== 'src');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
const fmt = (n) => (Math.round(n * 1e6) / 1e6).toString();

const DEG = Math.PI / 180;
const ORIGIN = { x: 0, y: 0 };
/** The shortest signed angle equal to `a`, in (-PI, PI]. Mirrored from `editor-ui.ts`. */
const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const degGap = (a, b) => (Math.abs(normAngle(a - b)) * 180) / Math.PI;

/** EVERY CALL THAT LOADS. A file the asset edits have broken is skipped, not fatal - the sweep just has to
 *  end up big enough that a single skipped call cannot make any of the checks vacuous, which section 1 pins. */
function* calls() {
  for (const level of LEVELS) {
    const dir = path.join(corpusRoot(), level);
    for (const f of filesOf(level)) {
      if (!f.endsWith('.xml')) continue;
      let call;
      try {
        call = engine.normalizeInstance(
          engine.loadCallFromXml(fs.readFileSync(path.join(dir, f), 'utf8'), movesXml, formationsXml, 0),
        );
      } catch {
        continue;
      }
      yield { where: `${level}/${f}`, call };
    }
  }
}

// ------------------------------------------------------------------ the write rules
//
// All read the pose out of the BASE (`call`), never out of the bundle being built, which is the property
// that makes a drag idempotent: `dragDancerBase` holds the pose from pointerdown and every pointer move
// writes the transform of that base, so a hundred pointer moves land exactly where one does.

/**
 * `applyDancerStartDrag`, `dp` branch: every selected dancer carried by the drag's BOARD TRANSFORM.
 *
 * The transform comes from `board-transform.ts` - the module the panel itself calls - so this is the rule
 * and not a copy of it. The write is the panel's too: `setDancerStart` with the dancer's own heading.
 */
const transformStarts = (call, indices, p0, p1) => {
  const t = board.boardTransformOf(p0, p1, ORIGIN);
  let out = call;
  for (const i of indices) {
    const d = call.dancers[i];
    if (!d) continue;
    const p = board.applyBoardTransform(d, t, ORIGIN);
    out = engine.setDancerStart(out, i, { x: p.x, y: p.y, heading: d.angleDeg * DEG });
  }
  return out;
};

/** THE OLD RULE, kept as the reference `1a` compares against: the same floor shift on every selected dancer. */
const shiftStarts = (call, indices, dx, dy) => {
  let out = call;
  for (const i of indices) {
    const d = call.dancers[i];
    if (d) out = engine.setDancerStart(out, i, { x: d.x + dx, y: d.y + dy, heading: d.angleDeg * DEG });
  }
  return out;
};

/** `applyDancerStartDrag`, `dh` branch: each selected dancer's own start heading plus the drag's angle. */
const turnStarts = (call, indices, theta) => {
  let out = call;
  for (const i of indices) {
    const d = call.dancers[i];
    if (d) out = engine.setDancerStart(out, i, { x: d.x, y: d.y, heading: normAngle(d.angleDeg * DEG + theta) });
  }
  return out;
};

/** REJECTED 1, the negative control for the shape checks: every selected dancer takes the FOCUS one's pose. */
const copyFocusStart = (call, indices) => {
  const f = call.dancers[indices[0]];
  let out = call;
  for (const i of indices) {
    if (call.dancers[i]) out = engine.setDancerStart(out, i, { x: f.x, y: f.y, heading: f.angleDeg * DEG });
  }
  return out;
};

/** REJECTED 2, the negative control for section 2: headings turn AND positions orbit a pivot. */
const orbitStarts = (call, indices, theta, centre) => {
  let out = call;
  for (const i of indices) {
    const d = call.dancers[i];
    if (!d) continue;
    const px = d.x - centre.x;
    const py = d.y - centre.y;
    out = engine.setDancerStart(out, i, {
      x: centre.x + Math.cos(theta) * px - Math.sin(theta) * py,
      y: centre.y + Math.sin(theta) * px + Math.cos(theta) * py,
      heading: normAngle(d.angleDeg * DEG + theta),
    });
  }
  return out;
};

/** REJECTED 3, the negative control for 1b: the same scale, but pivoted on the DRAGGED DANCER. */
const scaleAbout = (call, indices, centre, k) => {
  let out = call;
  for (const i of indices) {
    const d = call.dancers[i];
    if (!d) continue;
    out = engine.setDancerStart(out, i, {
      x: centre.x + k * (d.x - centre.x),
      y: centre.y + k * (d.y - centre.y),
      heading: d.angleDeg * DEG,
    });
  }
  return out;
};

/** The selection the panel would use: the even-numbered dancers, or all of them if that leaves fewer than two. */
const selectionOf = (call) => {
  const even = call.dancers.map((_, i) => i).filter((i) => i % 2 === 0);
  return even.length >= 2 ? even : call.dancers.map((_, i) => i);
};

/** The derived start and end pose of every dancer, which is the same read the panel's table shows. */
const poses = (call) => engine.instanceTable(call).map((r) => ({ start: r.start, end: r.end }));

/**
 * ONE SOURCE FILE, WITH ITS LINE ENDINGS NORMALISED.
 *
 * The app's TypeScript and HTML are checked in with CRLF, while this file is LF - so a structural check
 * written as `"if (this.scope === 'dancer') {\n      this.foo()"` can never match, and FOUR of section 5's
 * checks were red for that reason alone before this probe was re-based (measured: every one of those checks
 * passes once the endings are normalised, with nothing else changed). What those checks are about is the
 * SHAPE of the code - which statement sits inside which branch - and the line ending is not part of that, so
 * it is normalised here rather than bolted onto every pattern as `\s*`.
 */
const readSource = (rel) => fs.readFileSync(path.join(POC_DIR, rel), 'utf8').replace(/\r\n/g, '\n');

const DX = 0.75;
const DY = -0.5;
const THETA = 0.6;
/** Below this, `end - start` is a direction made of rounding error and its angle means nothing. See section 2. */
const DISPLACEMENT_EPS = 1e-6;
/** The knob for 1b: one factor in, one factor out. */
const IN = 0.6;
const OUT = 2.0;
/** How far a constant-radius drag is turned to build the 1a witness. Irrelevant to the result: what matters
 *  is that the radius does not change, so `scale` is 1 to within floating point. */
const SLICE_TURN = 0.2;
const EPS = 1e-9;

// ------------------------------------------------------------------ 1. one board transform, on the whole selection
console.log('== 1. a position drag transforms the whole selection as ONE BOARD ==');

// ------------------------------------------------------------------ 1a. the old rule is the slice
console.log('\n-- 1a. a drag that keeps the focus on its own circle IS the old same-delta rule --');

let nSlice = 0;
let nSliceSkipped = 0;
let worstSlice = 0;
let worstSliceTrack = 0;
let worstSliceHeading = 0;

for (const { call } of calls()) {
  if (call.dancers.length < 2) continue;
  const sel = selectionOf(call);
  const f = call.dancers[sel[0]];
  if (Math.hypot(f.x, f.y) <= EPS) { nSliceSkipped++; continue; }
  // A TANGENTIAL DRAG: rotate the focus's own radius, so |p1| == |p0| and the scale is 1.
  const c = Math.cos(SLICE_TURN), s = Math.sin(SLICE_TURN);
  const p1 = { x: c * f.x - s * f.y, y: s * f.x + c * f.y };
  const after = poses(transformStarts(call, sel, f, p1));
  const old = poses(shiftStarts(call, sel, p1.x - f.x, p1.y - f.y));
  nSlice++;
  for (const i of sel) {
    worstSlice = Math.max(
      worstSlice,
      Math.abs(after[i].start.x - old[i].start.x),
      Math.abs(after[i].start.y - old[i].start.y),
      // ...and the whole track moves with it, which is what a start-pose write means.
      Math.abs(after[i].end.x - old[i].end.x),
      Math.abs(after[i].end.y - old[i].end.y),
    );
    worstSliceHeading = Math.max(worstSliceHeading, degGap(after[i].end.heading, old[i].end.heading));
    worstSliceTrack = Math.max(
      worstSliceTrack,
      Math.abs((after[i].end.x - after[i].start.x) - (old[i].end.x - old[i].start.x)),
    );
  }
}
console.log(`    swept ${nSlice} constant-radius drags; ${nSliceSkipped} skipped for a focus on the centre (see 1d).`);
check(nSlice > 100, `the sweep is big enough to mean something (${nSlice} drags)`);
check(worstSlice < 1e-9,
  `the board transform agrees with the old same-delta rule to floating point (worst ${fmt(worstSlice)}) - so ` +
  `nothing that used to be possible was lost, it is the scale == 1 slice`);
check(worstSliceTrack < 1e-9, `and each dancer's own track keeps its shape in that slice (worst ${fmt(worstSliceTrack)})`);
check(worstSliceHeading < 1e-9, `a position drag turns nobody (worst ${fmt(worstSliceHeading)} deg)`);

// ------------------------------------------------------------------ 1b. a radial drag is a uniform scale
console.log('\n-- 1b. a radial drag is a uniform scale about the BOARD centre --');

let nScale = 0;
let nScalePairs = 0;
let worstRadius = 0;
let worstPair = 0;
let worstCentreDancer = 0;
let worstScaleFocus = 0;

for (const { call } of calls()) {
  if (call.dancers.length < 2) continue;
  const sel = selectionOf(call);
  const f = call.dancers[sel[0]];
  if (Math.hypot(f.x, f.y) <= EPS) continue;   // no ratio to take; that case is 1d
  for (const k of [IN, OUT]) {
    const p1 = { x: k * f.x, y: k * f.y };
    const after = poses(transformStarts(call, sel, f, p1));
    const t = board.boardTransformOf(f, p1, ORIGIN);
    if (Math.abs(t.scale - k) > 1e-12) worstScaleFocus = Math.max(worstScaleFocus, Math.abs(t.scale - k));
    for (const i of sel) {
      nScale++;
      const d0 = Math.hypot(call.dancers[i].x, call.dancers[i].y);
      const d1 = Math.hypot(after[i].start.x, after[i].start.y);
      // EVERY DANCER'S DISTANCE FROM THE CENTRE IS MULTIPLIED BY k - which is the report's example: drag
      // the focus towards the centre and everybody moves towards the centre by the same factor.
      worstRadius = Math.max(worstRadius, Math.abs(d1 - k * d0));
      // AND THE SHAPE IS PRESERVED UP TO THAT SCALE, which is what replaces the old "every pair keeps its
      // offset" check: at k = 1 the two are the same statement, and this one is also true at k != 1.
      for (const j of sel) {
        if (i >= j) continue;
        const before = Math.hypot(call.dancers[i].x - call.dancers[j].x, call.dancers[i].y - call.dancers[j].y);
        const now = Math.hypot(after[i].start.x - after[j].start.x, after[i].start.y - after[j].start.y);
        nScalePairs++;
        worstPair = Math.max(worstPair, Math.abs(now - k * before));
      }
    }
    // A DANCER STANDING ON THE CENTRE IS THE PIVOT and stays there: the residual shift of a purely radial
    // drag is exactly zero, so nothing that is at the centre can be dragged off it.
    for (const i of sel) {
      if (Math.hypot(call.dancers[i].x, call.dancers[i].y) > EPS) continue;
      worstCentreDancer = Math.max(worstCentreDancer, Math.hypot(after[i].start.x, after[i].start.y));
    }
  }
}
console.log(`    swept ${nScale} selected dancers and ${nScalePairs} pairs over factors ${IN} and ${OUT}.`);
check(nScale > 200, `the sweep is big enough to mean something (${nScale} dancers)`);
check(nScalePairs > 200, `and enough pairs to test the shape (${nScalePairs})`);
check(worstScaleFocus < 1e-12, `a radial drag's scale IS the ratio it was asked for (worst ${fmt(worstScaleFocus)})`);
check(worstRadius < 1e-9, `every dancer's distance from the centre is multiplied by it (worst ${fmt(worstRadius)})`);
check(worstPair < 1e-9, `the set keeps its shape up to that scale - every pair scales by it (worst ${fmt(worstPair)})`);
check(worstCentreDancer < 1e-9, `and a selected dancer on the centre is the pivot, so it stays put (worst ${fmt(worstCentreDancer)})`);

// ------------------------------------------------------------------ 1c. the focus follows the pointer
console.log('\n-- 1c. the dragged dancer lands on the pointer, and nobody else is touched --');

let nDrags = 0;
let worstFocus = 0;
let worstUntouched = 0;

for (const { call } of calls()) {
  if (call.dancers.length < 2) continue;
  const sel = selectionOf(call);
  const unsel = call.dancers.map((_, i) => i).filter((i) => !sel.includes(i));
  const f = call.dancers[sel[0]];
  // A GENERAL DRAG - the old witness's shift, which changes the radius and the angle at once.
  const p1 = { x: f.x + DX, y: f.y + DY };
  const after = poses(transformStarts(call, sel, f, p1));
  const before = poses(call);
  nDrags++;
  worstFocus = Math.max(worstFocus, Math.hypot(after[sel[0]].start.x - p1.x, after[sel[0]].start.y - p1.y));
  for (const i of unsel) {
    worstUntouched = Math.max(
      worstUntouched,
      Math.abs(after[i].start.x - before[i].start.x),
      Math.abs(after[i].start.y - before[i].start.y),
      degGap(after[i].end.heading, before[i].end.heading),
    );
  }
}
console.log(`    swept ${nDrags} general drags.`);
check(nDrags > 100, `the sweep is big enough to mean something (${nDrags} drags)`);
check(worstFocus < 1e-12,
  `the FOCUS dancer lands exactly on the pointer (worst ${fmt(worstFocus)}) - which is what keeps grid ` +
  `snapping meaning what it says, since the snapped point is what the transform is taken from`);
check(worstUntouched < 1e-9, `and an UNSELECTED dancer is not touched at all (worst ${fmt(worstUntouched)})`);

// ------------------------------------------------------------------ 1d. edge cases
console.log('\n-- 1d. the two degenerate drags --');

{
  // A FOCUS ON THE CENTRE HAS NO RADIUS, so there is no ratio and the transform is a plain translation -
  // the old rule, and the only reading of "drag the pivot" that does anything sensible.
  let n = 0;
  let worst = 0;
  for (const { call } of calls()) {
    if (call.dancers.length < 2) continue;
    const sel = selectionOf(call);
    const at = { x: 0, y: 0 };
    const p1 = { x: DX, y: DY };
    const after = poses(transformStarts(call, sel, at, p1));
    const old = poses(shiftStarts(call, sel, DX, DY));
    n++;
    for (const i of sel) worst = Math.max(worst, Math.hypot(after[i].start.x - old[i].start.x, after[i].start.y - old[i].start.y));
  }
  check(n > 100, `the centre-focus case ran over ${n} calls`);
  check(worst < 1e-9,
    `with the focus on the centre the drag is the plain translation, scale 1 (worst ${fmt(worst)}) - so the ` +
    `gesture still does something predictable rather than dividing by zero`);
}

{
  // DRAGGING ONTO THE CENTRE IS scale == 0, so the selection collapses there. Reachable only by putting the
  // pointer on the origin, and continuous: everything is recomputed from the base, so dragging back out
  // restores it within the same gesture. Pinned so the behaviour is a decision rather than a surprise.
  const { call } = [...calls()].find((c) => c.call.dancers.length >= 4) ?? {};
  if (call) {
    const sel = selectionOf(call);
    const f = call.dancers[sel[0]];
    const after = poses(transformStarts(call, sel, f, ORIGIN));
    let worst = 0;
    for (const i of sel) worst = Math.max(worst, Math.hypot(after[i].start.x, after[i].start.y));
    check(board.boardTransformOf(f, ORIGIN, ORIGIN).scale === 0, 'a pointer on the centre means scale 0');
    check(worst < 1e-9, `and the selection collapses onto the centre (worst distance ${fmt(worst)})`);
  }
}

// ------------------------------------------------------------------ 2. a rotation drag turns the whole track
console.log('\n== 2. a rotation drag is a rigid rotation of each selected dancer about its OWN start ==');

let nTurns = 0;
let nTracks = 0;
let nDegenerate = 0;
let worstSpan = 0;
let worstTurn = 0;
let worstHeading2 = 0;
let worstStart2 = 0;
let worstUntouched2 = 0;

for (const { call } of calls()) {
  if (call.dancers.length < 2) continue;
  const sel = selectionOf(call);
  const unsel = call.dancers.map((_, i) => i).filter((i) => !sel.includes(i));
  const before = poses(call);
  const after = poses(turnStarts(call, sel, THETA));
  for (const i of sel) {
    nTurns++;
    // NOBODY MOVES: this is a heading edit, and the positions are the whole of what it must not touch. This
    // is the check that rejects the centroid/orbit rule - see section 4.
    worstStart2 = Math.max(worstStart2, Math.abs(after[i].start.x - before[i].start.x));
    worstStart2 = Math.max(worstStart2, Math.abs(after[i].start.y - before[i].start.y));
    const d0 = { x: before[i].end.x - before[i].start.x, y: before[i].end.y - before[i].start.y };
    const d1 = { x: after[i].end.x - after[i].start.x, y: after[i].end.y - after[i].start.y };
    const len0 = Math.hypot(d0.x, d0.y);
    // THE DISPLACEMENT KEEPS ITS LENGTH...
    worstSpan = Math.max(worstSpan, Math.abs(Math.hypot(d1.x, d1.y) - len0));
    nTracks++;
    // ...AND GAINS THE ANGLE. Together those two say `end` swung about `start` and nowhere else.
    //
    // A DANCER WHO ENDS THE CALL WHERE THEY STARTED HAS NO DIRECTION FOR THIS TO TURN, and the angle of a
    // 4e-16 vector is rounding error rather than a heading. 264 of this corpus's 3560 tracks are exactly
    // that, so they are COUNTED and excluded rather than quietly failing the check - the length check above
    // still covers them, and it is the angle that is undefined.
    if (len0 <= DISPLACEMENT_EPS) {
      nDegenerate++;
      continue;
    }
    const gap = degGap(Math.atan2(d1.y, d1.x), Math.atan2(d0.y, d0.x) + THETA);
    if (gap > worstTurn) worstTurn = gap;
    worstHeading2 = Math.max(worstHeading2, degGap(after[i].end.heading, before[i].end.heading + THETA));
  }
  for (const i of unsel) {
    worstUntouched2 = Math.max(
      worstUntouched2,
      Math.abs(after[i].start.x - call.dancers[i].x),
      Math.abs(after[i].start.y - call.dancers[i].y),
      degGap(after[i].end.heading, before[i].end.heading),
    );
  }
}

console.log(`    swept ${nTurns} selected dancers; ${nTracks} tracks, of which ${nDegenerate} end where they started.`);
check(nTurns > 300, `the sweep is big enough to mean something (${nTurns} dancers)`);
check(nTracks - nDegenerate > 1000, `and enough of the tracks have a direction to test (${nTracks - nDegenerate})`);
check(worstStart2 < 1e-9, `a rotation drag moves nobody: every start is exactly where it was (worst ${fmt(worstStart2)})`);
check(worstSpan < 1e-9, `the dancer's own track keeps its shape - |end - start| is unchanged (worst ${fmt(worstSpan)})`);
check(worstTurn < 1e-6,
  `and that displacement GAINS the drag's angle, so the track turned about the start (worst ${fmt(worstTurn)} deg)`);
check(worstHeading2 < 1e-6, `the heading the track finishes on gains the same angle (worst ${fmt(worstHeading2)} deg)`);
check(worstUntouched2 < 1e-9, `an UNSELECTED dancer is not touched at all (worst ${fmt(worstUntouched2)})`);

// ------------------------------------------------------------------ 3. the wrap, so a drag cannot spin the set
console.log('\n== 3. the shortest way round, so a drag past the far side cannot spin the set ==');

check(Math.abs(normAngle(-6.0) - (2 * Math.PI - 6.0)) < 1e-12,
  `the base angle -6.0 rad is read as +${fmt(2 * Math.PI - 6.0)} rad, the SHORT way round`);
check(Math.abs(normAngle(6.0) - (6.0 - 2 * Math.PI)) < 1e-12, `and +6.0 is read as ${fmt(6.0 - 2 * Math.PI)}`);
{
  // A dancer at heading 3.0 rad facing a pointer that lands at -3.0 rad: the raw difference is -6.0 rad, and
  // without the wrap that would turn the dancer by nearly a full circle the wrong way.
  const theta = normAngle(-3.0 - 3.0);
  check(Math.abs(theta) < Math.PI, `a raw delta of -6.0 rad becomes ${fmt(theta)} rad (|delta| < PI)`);
  check(degGap(theta, 2 * Math.PI - 6.0) < 1e-9, 'which is the SAME heading, reached the short way');
  check(degGap(3.0 + theta, -3.0) < 1e-9, 'and it lands on the heading the pointer asked for');
}

// ------------------------------------------------------------------ 4. the rejected rules go red
console.log('\n== 4. the rules that were rejected fail the checks above ==');

{
  // REJECTED 1: "uses the first in the list to modify all" read as SET THE VALUE rather than apply the
  // transform. Every dancer's own numbers are then exactly what the rule asks for - and the set is destroyed.
  let worstPerDancer = 0;
  let worstShapeCopy = 0;
  let n = 0;
  for (const { call } of calls()) {
    if (call.dancers.length < 4) continue;
    const sel = selectionOf(call);
    const f = call.dancers[sel[0]];
    const p1 = { x: f.x + DX, y: f.y + DY };
    const t = board.boardTransformOf(f, p1, ORIGIN);
    const after = poses(copyFocusStart(call, sel));
    n += sel.length;
    for (const i of sel) {
      worstPerDancer = Math.max(worstPerDancer, Math.abs(after[i].start.x - call.dancers[i].x));
    }
    for (const i of sel) {
      for (const j of sel) {
        if (i >= j) continue;
        const before = Math.hypot(call.dancers[i].x - call.dancers[j].x, call.dancers[i].y - call.dancers[j].y);
        const now = Math.hypot(after[i].start.x - after[j].start.x, after[i].start.y - after[j].start.y);
        worstShapeCopy = Math.max(worstShapeCopy, Math.abs(now - t.scale * before));
      }
    }
  }
  check(n > 100, `the set-the-value control ran over ${n} dancers`);
  check(worstPerDancer > 0.5 && worstShapeCopy > 0.5,
    `copying the focus pose onto everyone moves dancers by up to ${fmt(worstPerDancer)} and breaks the ` +
    `shape check by ${fmt(worstShapeCopy)} - so section 1's shape check is a real test of the transform, not a tautology`);
}

{
  // REJECTED 2: headings turn AND the positions orbit the selection's centroid. This one is a rigid edit, so
  // it passes section 2's length check exactly - and it is the "moves nobody" check that rules it out.
  let worstMoveOrbit = 0;
  let worstSpanOrbit = 0;
  let n = 0;
  for (const { call } of calls()) {
    if (call.dancers.length < 4) continue;
    const sel = selectionOf(call);
    const centre = sel.reduce(
      (a, i) => ({ x: a.x + call.dancers[i].x / sel.length, y: a.y + call.dancers[i].y / sel.length }),
      { x: 0, y: 0 },
    );
    const before = poses(call);
    const after = poses(orbitStarts(call, sel, THETA, centre));
    for (const i of sel) {
      n++;
      worstMoveOrbit = Math.max(worstMoveOrbit, Math.hypot(after[i].start.x - before[i].start.x, after[i].start.y - before[i].start.y));
      const d0 = { x: before[i].end.x - before[i].start.x, y: before[i].end.y - before[i].start.y };
      const d1 = { x: after[i].end.x - after[i].start.x, y: after[i].end.y - after[i].start.y };
      worstSpanOrbit = Math.max(worstSpanOrbit, Math.abs(Math.hypot(d1.x, d1.y) - Math.hypot(d0.x, d0.y)));
    }
  }
  check(n > 100, `the orbit control ran over ${n} dancers`);
  check(worstSpanOrbit < 1e-9,
    `orbiting the positions keeps every track's own shape too (worst ${fmt(worstSpanOrbit)}), which is why the ` +
    `LENGTH check cannot be what rules it out`);
  check(worstMoveOrbit > 0.5,
    `but it moves dancers by up to ${fmt(worstMoveOrbit)}, so section 2's "moves nobody" check is what does`);
}

{
  // REJECTED 3, and the reason 1b's radius check is not a tautology: scaling about the DANCER BEING DRAGGED
  // also preserves the shape up to a scale, so the pairwise check cannot tell it from the real rule. What
  // separates them is the distance from the BOARD centre - which is exactly what 1b measures.
  let worstRadiusPivot = 0;
  let worstPairPivot = 0;
  let n = 0;
  for (const { call } of calls()) {
    if (call.dancers.length < 4) continue;
    const sel = selectionOf(call);
    const f = call.dancers[sel[0]];
    if (Math.hypot(f.x, f.y) <= EPS) continue;
    const after = poses(scaleAbout(call, sel, f, IN));
    n++;
    for (const i of sel) {
      const d0 = Math.hypot(call.dancers[i].x, call.dancers[i].y);
      const d1 = Math.hypot(after[i].start.x, after[i].start.y);
      worstRadiusPivot = Math.max(worstRadiusPivot, Math.abs(d1 - IN * d0));
      for (const j of sel) {
        if (i >= j) continue;
        const before = Math.hypot(call.dancers[i].x - call.dancers[j].x, call.dancers[i].y - call.dancers[j].y);
        const now = Math.hypot(after[i].start.x - after[j].start.x, after[i].start.y - after[j].start.y);
        worstPairPivot = Math.max(worstPairPivot, Math.abs(now - IN * before));
      }
    }
  }
  check(n > 100, `the dragged-pivot control ran over ${n} selections`);
  check(worstPairPivot < 1e-9,
    `scaling about the dragged dancer preserves the shape up to the same factor too (worst ${fmt(worstPairPivot)}), ` +
    `so 1b's pair check cannot rule it out`);
  check(worstRadiusPivot > 0.5,
    `but it moves dancers off their own radius by up to ${fmt(worstRadiusPivot)}, so 1b's distance-from-the-` +
    `centre check is what does`);
}

// ------------------------------------------------------------------ 5. the panel's wiring, read from source
console.log('\n== 5. the panel: handles, dispatch, the IMPORTED rule, live numbers ==');

const uiSrc = readSource('src/editor-ui.ts');
const htmlSrc = readSource('index.html');
const sceneSrc = readSource('../packages/stage/scene.ts');
const ruleSrc = readSource('src/board-transform.ts');

check(/id: `d\$\{d\}:dp`/.test(uiSrc), 'the POSITION handle is drawn for the focused dancer');
check(/id: `d\$\{d\}:dh`/.test(uiSrc), 'and the HEADING handle, on the other axis');
check(/anchor: \{ x: dancer\.x, y: dancer\.y \},/.test(uiSrc),
  'the heading handle is anchored ON the start, so its line is the heading the drag turns');
check(/color: HANDLE_COLOR\.dancer/.test(uiSrc) && /dancer: 0xffd23f/.test(sceneSrc),
  'and both are drawn in a colour of their own, not the travel or facing one');
// THE POSITION HANDLE IS DRAWN FROM THE BOARD'S CENTRE, which is the pivot the transform turns about - the
// picture and the arithmetic have to be the same point or the drag would follow a line it is not on.
check(/anchor: \{ x: 0, y: 0 \},/.test(uiSrc),
  'the position handle is anchored on the board centre, which is the pivot the transform scales about');

{
  const branch = uiSrc.indexOf("if (this.scope === 'dancer') {\n      this.drawDancerHandles();");
  const gate = uiSrc.indexOf('if (!this.coordinatesAgree(');
  check(branch >= 0, 'the board takes the Dancer scope FIRST, before the move code');
  check(gate >= 0 && branch < gate,
    'and it does so ABOVE the coordinate gate, which is about curves and would refuse an edit that is not one');
  check(/private drawDancerHandles\(\)/.test(uiSrc), 'the dancer handles live in their own method');
  check(/const dancers = scope === 'dancer';/.test(uiSrc) && /this\.axisTabsEl\.hidden = !dancers;/.test(uiSrc),
    'and the axis pair is HIDDEN in the move scope rather than left lit and inert');
}

check(/if \(this\.scope === 'dancer'\) \{\n      this\.applyDancerStartDrag\(handle, board, snap\);/.test(uiSrc),
  'a handle drag is dispatched on the SCOPE, not on the id prefix - so no id can be read as a move control');
check(/which !== 'dp' && which !== 'dh'/.test(uiSrc),
  'and an unknown kind inside that scope is dropped, never falling through to the travel-endpoint branch');
check(/const theta = normAngle\(Math\.atan2\(board\.y - focus\.y, board\.x - focus\.x\) - focus\.heading\);/.test(uiSrc),
  'the rotation delta is measured from the FOCUS dancer against the pose captured at pointerdown');
// THE RULE IS IMPORTED, NOT RE-STATED. This is the check that stops the arithmetic drifting back into the
// pointer handler, where no probe could measure it - the same reason `grid-magnet.ts` exists.
check(/import \{ applyBoardTransform, boardTransformOf \} from '\.\/board-transform';/.test(uiSrc),
  'the panel IMPORTS the board transform rather than restating it');
check(/const t = boardTransformOf\(focus, at\);/.test(uiSrc) && /applyBoardTransform\(s, t\)/.test(uiSrc),
  'and applies it to every selected dancer\'s own start');
check(!/s\.x \+ dx/.test(uiSrc) && !/const dx = at\.x - focus\.x;/.test(uiSrc),
  'the old same-delta arithmetic is GONE from the dp branch, not left beside the new rule');
check(/export function boardTransformOf\(/.test(ruleSrc) && /export function applyBoardTransform\(/.test(ruleSrc),
  'and the module exports the two functions the panel imports');

// THE FOCUS NEEDS NO RE-ISSUE, AND THAT IS CHECKED RATHER THAN ASSUMED. The drag writes through the ordinary
// light path, whose `renderHandles` already dispatches to `drawDancerHandles` in this scope; the highlighted
// trail is re-made by `host.updateCall` -> `applyDisplay`, which re-derives it from the STORED focus. So the
// call is plain `applyLight(next)` and `applyLight` still ends in `this.renderHandles();` - no `resync`
// parameter, and no second gizmo rebuild per pointer move.
check(/this\.applyLight\(next\);/.test(uiSrc) && /if \(resync\)/.test(uiSrc) === false,
  'the drag writes through the ordinary light path: one argument, no resync branch');
check(/this\.host\.setPlayhead\(this\.absoluteEditBeat\(this\.instance\)\);\s*\n\s*this\.renderHandles\(\);/.test(uiSrc),
  'and `applyLight` still redraws the gizmo, which is what draws the dancer handles while this scope is on');
check(/this\.dragDancerBase = \{ call: this\.instance, starts \};/.test(uiSrc) && /this\.dragDancerBase = null;/.test(uiSrc),
  'the base is captured at pointerdown and cleared with the other drag state');
check(/\[`r\$\{n\}:sx`, r\.start\.x\]/.test(uiSrc),
  'the table\'s START columns follow the drag live, from `instanceTable` - the same source a rebuild uses');
check(/if \(this\.scope === 'dancer'\) return this\.refreshDancerNumbers\(call\);/.test(uiSrc) &&
  /private refreshDancerNumbers\(call: CallBundle\)/.test(uiSrc),
  'and the live numbers are reached from `refreshNumberFields`, so the Dancer scope cannot lose its fields');

check(/id="edScopeMove"/.test(htmlSrc) && /id="edScopeDancer"/.test(htmlSrc), 'index.html carries the scope pair');
check(/id="edAxisPos"/.test(htmlSrc) && /id="edAxisHead"/.test(htmlSrc) && /id="edAxisTabs" hidden/.test(htmlSrc),
  'and the axis pair, hidden until the Dancer scope is chosen');
check(htmlSrc.indexOf('id="edAxisTabs"') > htmlSrc.indexOf('id="edFormation"'),
  'the new row sits BELOW the formation table, so it cannot disturb the row ordering other probes pin');
// THE TOOLTIPS STATE THE RULES, so they are part of them: the position axis promised "the same floor shift
// is added to every selected dancer", which is a different gesture and, after this change, a false
// description of what the control does.
check(/dragging in or out from the centre scales every selected dancer about the centre/.test(htmlSrc),
  'the position axis says what it now does (scales about the centre)');
check(!/the same floor shift is added to every selected dancer/.test(htmlSrc)
  && !/Every selected dancer gets the same DELTA/.test(htmlSrc)
  && !/writes every selected dancer by the same delta/.test(htmlSrc),
  'and no control still describes the old global-coordinate position rule');

{
  // AND THE SOURCE CHECKS FAIL ON THE FAULTS THEY WERE WRITTEN FOR - otherwise they are regexes that happen
  // to match a line.
  const noGizmo = uiSrc.replace('    this.renderHandles();\n    this.refreshNumberFields();', '    this.refreshNumberFields();');
  check(noGizmo !== uiSrc && !/this\.renderHandles\(\);\s*\n\s*this\.refreshNumberFields\(\);/.test(noGizmo),
    'dropping the gizmo redraw from the light path fails the check that the dancer handles are drawn by it');
  const noNumbers = uiSrc.replace("if (this.scope === 'dancer') return this.refreshDancerNumbers(call);", "if (this.scope === 'dancer') return;");
  check(noNumbers !== uiSrc && !/return this\.refreshDancerNumbers\(call\);/.test(noNumbers),
    'orphaning the Dancer scope\'s live numbers fails the check that reaches them');
  const renamed = uiSrc.replace('id: `d${d}:dh`', 'id: `d${d}:r9`');
  check(renamed !== uiSrc && !/id: `d\$\{d\}:dh`/.test(renamed),
    'renaming the heading handle onto the move prefix fails the handle check');
  const noBranch = uiSrc.replace("if (this.scope === 'dancer') {\n      this.drawDancerHandles();", 'void 0;');
  check(noBranch !== uiSrc && noBranch.indexOf("if (this.scope === 'dancer') {\n      this.drawDancerHandles();") < 0,
    'removing the scope branch fails the ordering check');
  const inlined = uiSrc.replace(/import \{[^}]*\} from '\.\/board-transform';/, '');
  check(inlined !== uiSrc && !/from '\.\/board-transform'/.test(inlined),
    'going back to inline arithmetic fails the check that the rule is imported');
  const staleTip = htmlSrc.replace('dragging in or out from the centre scales every selected dancer about the centre', 'the same floor shift is added to every selected dancer');
  check(staleTip !== htmlSrc && /the same floor shift is added to every selected dancer/.test(staleTip),
    'and restoring the old tooltip wording fails the check that the controls describe the new rule');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
