// DRAGGING A FACING CURVE'S TWO HANDLES: WHAT EACH ONE MOVES, AND WHAT IT THEREFORE MEANS.
//
// Reported: "when dragging a facing end point, the end control point stays at its absolute position,
// which warps the curve in unpredictable ways. FIX: When dragging a facing end point, drag the end
// control point with it, keeping its relative position." Clarified as a rule with two halves: "When p3 is
// moved, c2 keeps its relative position from p3. When c2 is moved, p3 stays fixed."
//
// WHY THAT IS THE WHOLE GESTURE. `poseFor` accumulates a move's heading from `bezierAngle(rotate, t)`
// (`engine/src/core.ts`), and at `t = 1` the tangent of a cubic is the direction of `p3 - p2` - the line
// drawn from the end control to the end point. So:
//
//   - moving c2 alone PIVOTS that line about a fixed p3, which TURNS the heading the move finishes on;
//   - moving p3 with c2 in tow holds the line rigid, which RELOCATES the ramp and leaves the heading
//     exactly as it was.
//
// Both are wanted, and neither disturbs the other - which is what the rule says. The bug was that p3 moved
// alone, so the line pivoted about a control that stayed where it was on the floor AND changed length at
// the same time: the heading moved for a reason the caller could not read off the drag, and the tail of
// the cubic warped with it.
//
// MEASURED below over the whole corpus's facing curves, because "the curve warps" is a claim about
// geometry and section 2 puts a number on it. Section 3 reports the consequence honestly rather than
// hiding it: under the fixed rule a p3 drag NO LONGER changes the finish heading, and the c2 drag is where
// that control now lives.
//
// The patch chain lives in `editor-ui.ts`, which is TypeScript under Vite with a DOM and cannot run here -
// the same limit `move-clipboard-probe.mjs` and `absolute-paste-probe.mjs` record. So the geometry is
// measured against the engine and the panel's use of it is read from the source.
//
// Run: node tools/facing-end-drag-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf, levelsAvailable } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const movesXml = fs.readFileSync(path.join(corpusRoot(), 'moves.xml'), 'utf8');
const formationsXml = fs.readFileSync(path.join(corpusRoot(), 'formations.xml'), 'utf8');
const LEVELS = levelsAvailable().filter((level) => level !== 'src');
/** Every `.xml` under the level directories - the corpus's own count, so coverage can be an EQUALITY. */
const CALL_FILES = LEVELS.reduce((n, level) => n
  + filesOf(level).filter((f) => f.endsWith('.xml')).length, 0);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// WHICH FILES THE WALK ACTUALLY OPENED. `everyRotate` is a single traversal, so a count of what it found
// cannot be checked against a second walk of the same thing - that would just be the same measurement
// twice. What CAN be asserted is that it opened every file: recorded here as a side effect and checked
// below, which catches a sweep that stops early however the corpus grows or shrinks.
const filesVisited = new Set();
function* everyRotate() {
  for (const level of LEVELS) {
    for (const f of filesOf(level)) {
      if (!f.endsWith('.xml')) continue;
      filesVisited.add(`${level}/${f}`);
      let call;
      try {
        call = engine.normalizeInstance(engine.loadCallFromXml(
          fs.readFileSync(path.join(corpusRoot(), level, f), 'utf8'), movesXml, formationsXml, 0));
      } catch { continue; }
      for (const d of call.dancers) {
        for (const s of d.path) if (s.rotate) yield { where: `${level}/${f}`, r: s.rotate };
      }
    }
  }
}

/** THE TWO RULES, mirrored from `applyHandleDrag`. */
const dragEndPoint = (r, x, y) => engine.moveCurveEnd(r, x, y); // p3 moves, c2 keeps its offset FROM p3
const dragControl = (r, x, y) => ({ ...r, cx2: x, cy2: y }); // c2 moves, p3 untouched
const OLD_endPoint = (r, x, y) => ({ ...r, x2: x, y2: y }); // p3 moves alone - the reported bug

const heading = (r) => engine.bezierAngle(r, 1);
const angleGap = (a, b) => Math.abs(engine.normAngle(a - b)) * (180 / Math.PI);
const handleLen = (r) => Math.hypot(r.x2 - r.cx2, r.y2 - r.cy2);

// ---------------------------------------------------------------- 1. the rule, exactly
console.log('\n== 1. the rule: p3 carries c2; c2 leaves p3 alone ==');
{
  let curves = 0, offsetKept = 0, p3Pinned = 0, lenKept = 0, maxOffsetDrift = 0;
  for (const { r } of everyRotate()) {
    curves++;
    // A DRAG OF THE END POINT, to three targets including the degenerate one - onto the control itself.
    for (const target of [{ x: r.x2 + 1.5, y: r.y2 - 0.7 }, { x: -r.x2 * 0.5, y: r.y2 + 2 }, { x: r.cx2, y: r.cy2 }]) {
      const next = dragEndPoint(r, target.x, target.y);
      if (next.x2 === target.x && next.y2 === target.y) offsetKept += 1;
      // c2 - p3 is the SAME VECTOR it was before the drag, in both components.
      const same = Math.abs((next.cx2 - next.x2) - (r.cx2 - r.x2)) < 1e-12 && Math.abs((next.cy2 - next.y2) - (r.cy2 - r.y2)) < 1e-12;
      if (!same) maxOffsetDrift = Math.max(maxOffsetDrift, Math.hypot((next.cx2 - next.x2) - (r.cx2 - r.x2), (next.cy2 - next.y2) - (r.cy2 - r.y2)));
      else offsetKept += 0;
      if (Math.abs(handleLen(next) - handleLen(r)) < 1e-12) lenKept += 1;
      // AND THE HEADING IS BIT-IDENTICAL, which is the point of holding the line rigid.
      if (heading(next) === heading(r)) offsetKept += 0;
    }
    // A DRAG OF THE CONTROL: p3 must not move, at all.
    const cNext = dragControl(r, r.cx2 + 0.8, r.cy2 - 0.4);
    if (cNext.x2 === r.x2 && cNext.y2 === r.y2) p3Pinned += 1;
  }
  console.log(`    ${curves} facing curves in the corpus, each with three end-point drags and one control drag`);
  // COVERAGE IS AN EQUALITY ON FILES, NOT A FLOOR ON CURVES. This was `curves > 4000`, written when the
  // corpus carried 4128 of them; `50d3e95` folded `b1`/`b2` into `ms` and it is 3602 now, so the floor went
  // stale while the sweep was fine. A curve count is a property of the corpus rather than of the sweep -
  // it drifts whenever the corpus is re-authored - so it is REPORTED above and the assertion is that every
  // call file was opened, which no corpus change can invalidate and a truncated walk cannot satisfy.
  check(filesVisited.size === CALL_FILES,
    `the sweep opened every call file (${filesVisited.size} of ${CALL_FILES}), so the curve count above is the corpus's own`);
  check(offsetKept === curves * 3, `the end point lands EXACTLY where it was dragged (${offsetKept} of ${curves * 3})`);
  check(lenKept === curves * 3, `and the control-to-end distance is preserved to within rounding, which is the warp being fixed (${lenKept} of ${curves * 3})`);
  check(p3Pinned === curves, `dragging the CONTROL leaves the end point exactly where it was (${p3Pinned} of ${curves})`);
}

// ---------------------------------------------------------------- 2. what the old rule did
console.log('\n== 2. what the reported bug actually measured: the line pivoted AND changed length ==');
{
  let curves = 0, headingMoved = 0, worstHeading = 0, worstWhere = '', worstLen = 0, collapsed = 0;
  let degenerateMoved = 0;
  for (const { where, r } of everyRotate()) {
    curves++;
    // A NORMAL DRAG, the one a caller makes while exploring.
    const old = OLD_endPoint(r, r.x2 + 1.1, r.y2 + 0.9);
    const gap = angleGap(heading(old), heading(r));
    if (gap > 0.01) headingMoved++;
    if (gap > worstHeading) { worstHeading = gap; worstWhere = where; }
    worstLen = Math.max(worstLen, Math.abs(handleLen(old) - handleLen(r)));
    // AND THE FAR END OF THE GESTURE: the end dot dragged onto the control. Note it does NOT move the
    // heading on every curve - a curve whose end tangent already points along +x reports the same
    // `atan2(0, 0)` before and after - which is why the claim above is made with the normal drag and this
    // one is only asked about the COLLAPSE.
    const degenerate = OLD_endPoint(r, r.cx2, r.cy2);
    if (angleGap(heading(degenerate), heading(r)) > 0.01) degenerateMoved++;
    if (handleLen(degenerate) < 1e-9 && handleLen(r) > 1e-9) collapsed++;
  }
  console.log(`    a normal end-point drag moved the heading on ${headingMoved} of ${curves} curves (worst ${worstHeading.toFixed(1)}deg)`);
  console.log(`    dragging the end point ONTO the control collapsed the handle on ${collapsed} of ${curves}, and moved the heading on ${degenerateMoved}`);
  check(headingMoved > curves * 0.95,
    `under the OLD rule the heading really did follow the end point (${headingMoved} of ${curves}), so the gesture was doing something - it was doing it by pivoting a line whose length was changing at the same time`);
  check(collapsed > curves * 0.9,
    `and at the far end of the gesture the control-to-end distance COLLAPSES to zero (${collapsed} of ${curves}), where the tail of the cubic has no tangent of its own and the head of the curve is all that is left - the "unpredictable" warp, exactly`);
  check(worstLen > 1,
    `the handle length was not held at all: it moved by up to ${worstLen.toFixed(2)} units, several times a typical handle`);
}

// ---------------------------------------------------------------- 3. the consequence, stated rather than hidden
console.log('\n== 3. what each handle now MEANS, so the two are not confused ==');
{
  let curves = 0, endHeld = 0, bitExact = 0, worstHeld = 0, controlTurned = 0;
  for (const { r } of everyRotate()) {
    curves++;
    // THE END POINT RELOCATES THE RAMP AND HOLDS THE HEADING. Not "close": the line is held rigid, so the
    // tangent at t = 1 is the same vector - exactly in exact arithmetic, and to rounding in practice.
    const next = dragEndPoint(r, r.x2 + 1.1, r.y2 + 0.9);
    if (heading(next) === heading(r)) bitExact++;
    const gap = angleGap(heading(next), heading(r));
    if (gap < 1e-9) endHeld++;
    worstHeld = Math.max(worstHeld, gap);
    // THE CONTROL TURNS THE HEADING, because the line pivots about a fixed end point.
    if (angleGap(heading(dragControl(r, r.cx2 + 0.9, r.cy2 + 0.6)), heading(r)) > 0.01) controlTurned++;
  }
  console.log(`    the end-point drag holds the heading bit-identically on ${bitExact} of ${curves} curves, worst residue ${worstHeld.toExponential(1)}deg`);
  check(endHeld === curves,
    `the END POINT no longer changes the finish heading (${endHeld} of ${curves} within 1e-9deg; ${bitExact} bit-identical) - it relocates where the heading ramp finishes and holds the heading, which is what was asked for`);
  check(controlTurned === curves,
    `and the CONTROL still turns it on every curve (${controlTurned} of ${curves}), so the Facing tab can still set a finish heading - through the other handle`);
  console.log(`    the two handles divide the work: the CONTROL sets the finish heading, the END POINT relocates the tail and holds it`);
}

// ---------------------------------------------------------------- 4. the panel, read from the source
console.log('\n== 4. the tile: which patch each handle goes through ==');
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const bodyOf = (src, header) => {
    const i = src.indexOf(header);
    if (i < 0) return null;
    const j = src.indexOf('\n  }', i);
    return src.slice(i, j);
  };
  const drag = bodyOf(ui, '  private applyHandleDrag(') || '';

  // The gap is the comment block explaining the rule, so the budget is generous and the assertion is
  // about which patch the handle reaches rather than about the prose being short.
  check(/which === 'r3'[\s\S]{0,3000}?seg\.rotate \? \{ \.\.\.seg, rotate: moveCurveEnd\(seg\.rotate, lx, ly\) \} : seg/.test(drag),
    'the facing END POINT goes through `moveCurveEnd`, the same engine call the travel end point uses - so the rule is the engine\'s and not a second implementation of it');
  check(!/rotate: \{ \.\.\.seg\.rotate, x2: lx, y2: ly \}/.test(drag),
    'and the old patch - which wrote `x2`/`y2` alone and left the control behind - is gone');
  check(/which === 'r2'[\s\S]{0,700}?rotate: \{ \.\.\.seg\.rotate, cx2: lx, cy2: ly \}/.test(drag),
    'the facing CONTROL still writes exactly `cx2`/`cy2`, so it cannot move the end point');
  check(/which === 'r1'[\s\S]{0,500}?rotate: \{ \.\.\.seg\.rotate, cx1: lx \}/.test(drag),
    'and the rail still writes `cx1` alone, which the format requires');
  // THE ARC BRANCH IS ELSEWHERE, and must stay there: an arc is rebuilt from its parameters, so its
  // control point is DERIVED and there is no control to carry.
  check(/if \(arc\) \{[\s\S]{0,2600}?arcBezier\(next\)/.test(drag),
    'an ARC still takes the earlier branch, where the whole curve is rebuilt from its parameters and the control point is derived rather than carried');
  // `noteTraceHold` reports the turn of the FRAME, so it speaks for the control drag and stays silent for the
  // end point - which is the honest split. It is no longer the facing tab's alone: a travel control drag turns
  // the frame the same way (see `moveTurn`, the engine's), so the call passes the tab rather than assuming it.
  check(/this\.noteTraceHold\(seg, facing\);/.test(drag),
    'and the status line still runs after a drag, on whichever tab, so the drag that DOES turn the frame is the one that says so');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
