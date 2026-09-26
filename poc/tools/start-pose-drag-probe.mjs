// DRAGGING A DANCER'S START POSE: WHAT THE DELTA DOES, AND WHY IT IS NOT A "SET THE VALUE" EDIT.
//
// Asked for: "Currently drag and drop only applies to Moves. I also want to be able to drag the start point
// and change rotation of each dancer using the same mechanisms used by the Moves." Settled while planning:
// with several dancers selected the board draws the FOCUS dancer's handle (the lowest-numbered selected one)
// and writes EVERY selected dancer, and the write is a DELTA applied to each dancer's OWN start - not one
// absolute value copied onto all of them, which would collapse the selection onto a single spot.
//
// THE ROTATION HALF IS BIGGER THAN IT SOUNDS, and that is what section 2 puts a number on. A dancer's moves
// are authored in the dancer's OWN frame: `poseFor` composes `fromPosAngle(x, y, angleDeg)` and then
// evaluates each move's local curve, so `x`, `y` and `angleDeg` are not a label on the track - they are the
// frame THE WHOLE TRACK IS DRAWN IN. A heading change therefore does not merely re-aim the dancer; it turns
// their entire path about their own start. The probe measures that as: the displacement `end - start` keeps
// its LENGTH and gains the ANGLE, which is a rigid rotation about the start and nothing else.
//
// THE TWO REJECTED RULES ARE MEASURED TOO, each as the negative control for the check it would break,
// because a check that no alternative fails is a check that is not testing anything:
//
//   - "ALL SELECTED DANCERS TAKE THE FOCUS DANCER'S START POSE" (instead of the delta) keeps every dancer's
//     own numbers correct one at a time and still destroys the SET, because the dancers land on top of each
//     other. Section 1's arrangement check is what catches it.
//   - "SPIN THE POSITIONS ABOUT THEIR CENTROID while turning the headings" is the rule the centroid answer
//     would have meant, and it is a perfectly rigid edit - so it preserves the track's own shape exactly,
//     and section 2's LENGTH check does NOT catch it. Section 2's "moves nobody" check does.
//
// The gesture itself lives in `editor-ui.ts`, which is TypeScript under Vite with a DOM and cannot run here -
// the same limit `facing-end-drag-probe.mjs` and `move-clipboard-probe.mjs` record. So the geometry is
// measured against the ENGINE, with the panel's two write rules mirrored verbatim, and the panel's use of
// them is read from the source in section 5.
//
// Run: node tools/start-pose-drag-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const movesXml = fs.readFileSync(path.join(POC_DIR, 'src/assets/moves.xml'), 'utf8');
const formationsXml = fs.readFileSync(path.join(POC_DIR, 'src/assets/formations.xml'), 'utf8');
const LEVELS = fs.readdirSync(path.join(POC_DIR, 'src/assets')).filter((d) => !d.includes('.') && d !== 'src');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};
const fmt = (n) => (Math.round(n * 1e6) / 1e6).toString();

const DEG = Math.PI / 180;
/** The shortest signed angle equal to `a`, in (-PI, PI]. Mirrored from `editor-ui.ts`. */
const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const degGap = (a, b) => (Math.abs(normAngle(a - b)) * 180) / Math.PI;

/** EVERY CALL THAT LOADS. A file the asset edits have broken is skipped, not fatal - the sweep just has to
 *  end up big enough that a single skipped call cannot make any of the checks vacuous, which section 1 pins. */
function* calls() {
  for (const level of LEVELS) {
    const dir = path.join(POC_DIR, 'src/assets', level);
    for (const f of fs.readdirSync(dir)) {
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

// ------------------------------------------------------------------ the write rules, mirrored VERBATIM
//
// Both read the pose out of the BASE (`call`), never out of the bundle being built, which is the property
// that makes a drag idempotent: `dragDancerBase` holds the pose from pointerdown and every pointer move
// writes base+delta, so a hundred pointer moves land exactly where one does.

/** `applyDancerStartDrag`, `dp` branch: each selected dancer's own start plus the drag's floor shift. */
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

/** REJECTED 1, kept as the negative control for section 1: every selected dancer takes the FOCUS one's pose. */
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

/** The selection the panel would use: the even-numbered dancers, or all of them if that leaves fewer than two. */
const selectionOf = (call) => {
  const even = call.dancers.map((_, i) => i).filter((i) => i % 2 === 0);
  return even.length >= 2 ? even : call.dancers.map((_, i) => i);
};

/** The derived start and end pose of every dancer, which is the same read the panel's table shows. */
const poses = (call) => engine.instanceTable(call).map((r) => ({ start: r.start, end: r.end }));

const DX = 0.75;
const DY = -0.5;
const THETA = 0.6;
/** Below this, `end - start` is a direction made of rounding error and its angle means nothing. See section 2. */
const DISPLACEMENT_EPS = 1e-6;

// ------------------------------------------------------------------ 1. the delta rule is a rigid translation
console.log('== 1. a position drag translates every selected dancer by the same delta ==');

let nCalls = 0;
let nDancers = 0;
let worstStart = 0;
let worstEnd = 0;
let worstEndHeading = 0;
let worstUntouched = 0;
let worstArrangement = 0;

for (const { call } of calls()) {
  if (call.dancers.length < 2) continue;
  const sel = selectionOf(call);
  const unsel = call.dancers.map((_, i) => i).filter((i) => !sel.includes(i));
  const before = poses(call);
  const after = poses(shiftStarts(call, sel, DX, DY));
  nCalls++;
  for (const i of sel) {
    nDancers++;
    // WHERE THE DANCER STANDS: the shift, and nothing else.
    worstStart = Math.max(worstStart, Math.abs(after[i].start.x - (before[i].start.x + DX)));
    worstStart = Math.max(worstStart, Math.abs(after[i].start.y - (before[i].start.y + DY)));
    // WHERE THE TRACK ENDS: the same shift, because the path is carried in the dancer's own frame and a
    // start move is therefore a translation of everything the dancer does.
    worstEnd = Math.max(worstEnd, Math.abs(after[i].end.x - (before[i].end.x + DX)));
    worstEnd = Math.max(worstEnd, Math.abs(after[i].end.y - (before[i].end.y + DY)));
    // AND NOTHING TURNS: a translation is a translation.
    worstEndHeading = Math.max(worstEndHeading, degGap(after[i].end.heading, before[i].end.heading));
  }
  // THE ARRANGEMENT, which is the requirement rather than a side effect: the SET is what is being placed, so
  // the offset between any two selected dancers must survive. This is the one the "copy the focus pose onto
  // everyone" rule destroys, and it does so while leaving every individual error above at zero.
  for (const i of sel) {
    for (const j of sel) {
      if (i >= j) continue;
      worstArrangement = Math.max(
        worstArrangement,
        Math.abs((after[i].start.x - after[j].start.x) - (before[i].start.x - before[j].start.x)),
        Math.abs((after[i].start.y - after[j].start.y) - (before[i].start.y - before[j].start.y)),
      );
    }
  }
  for (const i of unsel) {
    const d = call.dancers[i];
    worstUntouched = Math.max(worstUntouched, Math.abs(after[i].start.x - d.x), Math.abs(after[i].start.y - d.y));
    worstUntouched = Math.max(worstUntouched, degGap(after[i].end.heading, before[i].end.heading));
  }
}

console.log(`    swept ${nCalls} calls and ${nDancers} selected dancers.`);
check(nCalls > 100 && nDancers > 300, `the sweep is big enough to mean something (${nCalls} calls, ${nDancers} dancers)`);
check(worstStart < 1e-9, `every selected dancer's start is its own plus (${DX}, ${DY}) (worst error ${fmt(worstStart)})`);
check(worstEnd < 1e-9, `and its whole track moves with it - the end lands at the same offset (worst ${fmt(worstEnd)})`);
check(worstEndHeading < 1e-9, `a translation turns nobody: no end heading moved (worst ${fmt(worstEndHeading)} deg)`);
check(worstArrangement < 1e-9,
  `the ARRANGEMENT survives: every pair of selected dancers keeps its offset (worst ${fmt(worstArrangement)})`);
check(worstUntouched < 1e-9, `and an UNSELECTED dancer is not touched at all (worst ${fmt(worstUntouched)})`);

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
  // REJECTED 1: "uses the first in the list to modify all" read as SET THE VALUE rather than apply the delta.
  // Every dancer's own numbers are then exactly what the rule asks for - and the set is destroyed.
  let worstPerDancer = 0;
  let worstArrangementCopy = 0;
  let n = 0;
  for (const { call } of calls()) {
    if (call.dancers.length < 4) continue;
    const sel = selectionOf(call);
    const before = poses(call);
    const after = poses(copyFocusStart(call, sel));
    n += sel.length;
    for (const i of sel) {
      worstPerDancer = Math.max(worstPerDancer, Math.abs(after[i].start.x - before[i].start.x));
    }
    for (const i of sel) {
      for (const j of sel) {
        if (i >= j) continue;
        worstArrangementCopy = Math.max(
          worstArrangementCopy,
          Math.abs((after[i].start.x - after[j].start.x) - (before[i].start.x - before[j].start.x)),
        );
      }
    }
  }
  check(n > 100, `the set-the-value control ran over ${n} dancers`);
  check(worstPerDancer > 0.5 && worstArrangementCopy > 0.5,
    `copying the focus pose onto everyone moves dancers by up to ${fmt(worstPerDancer)} and destroys the ` +
    `arrangement by up to ${fmt(worstArrangementCopy)} - so section 1's arrangement check is a real test of ` +
    `the DELTA rule, not a tautology`);
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

// ------------------------------------------------------------------ 5. the panel's wiring, read from source
console.log('\n== 5. the panel: handles, dispatch, resync and live numbers ==');

const uiSrc = fs.readFileSync(path.join(POC_DIR, 'src/editor-ui.ts'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(POC_DIR, 'index.html'), 'utf8');
const sceneSrc = fs.readFileSync(path.join(POC_DIR, 'src/scene.ts'), 'utf8');

check(/id: `d\$\{d\}:dp`/.test(uiSrc), 'the POSITION handle is drawn for the focused dancer');
check(/id: `d\$\{d\}:dh`/.test(uiSrc), 'and the HEADING handle, on the other axis');
check(/anchor: \{ x: dancer\.x, y: dancer\.y \},/.test(uiSrc),
  'the heading handle is anchored ON the start, so its line is the heading the drag turns');
check(/color: HANDLE_COLOR\.dancer/.test(uiSrc) && /dancer: 0xffd23f/.test(sceneSrc),
  'and both are drawn in a colour of their own, not the travel or facing one');

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
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
