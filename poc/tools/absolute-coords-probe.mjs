// ABSOLUTE COORDINATES IN THE MOVE TILE: the board pair beside the relative one, each editable.
//
// Asked for: "in the selected move, display absolute coordinates alongside the existing relative
// coordinates. Both can be edited, updating the other."
//
// THE CLAIM THAT NEEDS MEASURING is that the board pair is the ENGINE'S OWN frame and not a plausible second
// opinion about it. `poseFor` composes a dancer's chain as `m = m * translateBy(bezierPoint(translate, tt))`,
// so at `tt = 0` the local origin lands on the pose the move starts from and at `tt = 1` the local endpoint
// `(x2, y2)` lands on the pose it ends at. That is checkable, and it is checked here against real calls -
// with the tile's own helpers copied, because they live in `editor-ui.ts`, which is TypeScript inside Vite
// with a DOM and cannot run in this sandbox. That is the same limit `facing-handle-probe.mjs` records for the
// drag write rules, and the same answer: the arithmetic is measured here, and the panel's use of it is read
// from the source.
//
// Run: node tools/absolute-coords-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
};

// ---- the tile's own two helpers, copied (see the note at the top) --------------------------
const localToFloor = (f, lx, ly) => ({
  x: f.x + Math.cos(f.heading) * lx - Math.sin(f.heading) * ly,
  y: f.y + Math.sin(f.heading) * lx + Math.cos(f.heading) * ly,
});
const floorToLocal = (f, x, y) => {
  const dx = x - f.x;
  const dy = y - f.y;
  return {
    lx: Math.cos(f.heading) * dx + Math.sin(f.heading) * dy,
    ly: -Math.sin(f.heading) * dx + Math.cos(f.heading) * dy,
  };
};

// ---------------------------------------------------------------- 1. it IS the engine's frame
console.log('== 1. the board pair agrees with the pose the engine composes ==');
{
  const dir = path.join(corpusRoot(), 'ms');
  let calls = 0;
  let moves = 0;
  let worstStart = 0;
  let worstEnd = 0;
  let worstStartAt = '';
  let worstEndAt = '';
  let rotFrames = 0;
  for (const f of filesOf('ms').filter((x) => x.endsWith('.xml'))) {
    let call;
    try {
      call = engine.normalizeInstance(engine.loadCallFromXml(fs.readFileSync(path.join(dir, f), 'utf8'), movesXml, formationsXml, 0));
    } catch { continue; }
    calls++;
    for (let i = 0; i < call.dancers.length; i++) {
      const d = call.dancers[i];
      for (let k = 0; k < d.path.length; k++) {
        const range = engine.moveBeatRange(d, k);
        const frame = engine.poseFor(d, range.from);
        // A frame that is TURNED, or the check would pass on an axis-aligned accident.
        if (Math.abs(Math.sin(frame.heading)) > 0.05) rotFrames++;
        const t = d.path[k].translate;
        const start = localToFloor(frame, 0, 0);
        const end = localToFloor(frame, t.x2, t.y2);
        const poseEnd = engine.poseFor(d, range.to);
        const sErr = Math.hypot(start.x - frame.x, start.y - frame.y);
        const eErr = Math.hypot(end.x - poseEnd.x, end.y - poseEnd.y);
        if (sErr > worstStart) { worstStart = sErr; worstStartAt = `${f} d${i} m${k}`; }
        if (eErr > worstEnd) { worstEnd = eErr; worstEndAt = `${f} d${i} m${k}`; }
        moves++;
      }
    }
  }
  console.log(`    ${moves} moves over ${calls} calls, ${rotFrames} of them in a TURNED frame`);
  check(moves > 1000, `the sweep is not trivial (${moves} moves)`);
  check(rotFrames > 100, `and it covers turned frames, where the two sets of numbers are genuinely different (${rotFrames})`);
  // 1e-12 is loose enough for the export's rounding and tight enough that a wrong frame could not pass it.
  check(worstStart < 1e-12, `the LOCAL ORIGIN is the pose the move starts from, on every one (worst ${worstStart.toExponential(1)} units at ${worstStartAt})`);
  check(worstEnd < 1e-12, `and the local ENDPOINT is the pose it ends at - so the board pair is the engine's own frame (worst ${worstEnd.toExponential(1)} at ${worstEndAt})`);
}

// ---------------------------------------------------------------- 2. the round trip is exact
console.log('\n== 2. the two sets of numbers are one point, so either can be edited ==');
{
  const headings = [0, 0.3, Math.PI / 2, -2.2, Math.PI, 1.1];
  let worst = 0;
  let changedBoth = 0;
  let tried = 0;
  for (const heading of headings) {
    const f = { x: 1.5, y: -0.75, heading };
    for (const [lx, ly] of [[2, 1], [-1.25, 3], [0.5, -0.5], [0, 0], [3.5, -2.25]]) {
      const at = localToFloor(f, lx, ly);
      const back = floorToLocal(f, at.x, at.y);
      worst = Math.max(worst, Math.abs(back.lx - lx), Math.abs(back.ly - ly));

      // AN EDIT NAMING AN X MUST LAND ON THAT X, and keep the Y it was showing.
      for (const v of [at.x + 1.75, at.x - 0.5]) {
        tried++;
        const want = { x: v, y: at.y };
        const nl = floorToLocal(f, want.x, want.y);
        const got = localToFloor(f, nl.lx, nl.ly);
        worst = Math.max(worst, Math.hypot(got.x - want.x, got.y - want.y));
        // And it is a real move in BOTH local numbers whenever the frame is turned - which is the point of
        // showing the pair at all: on a turned dancer, moving a point sideways is not one local edit.
        if (Math.abs(nl.lx - lx) > 1e-9 && Math.abs(nl.ly - ly) > 1e-9) changedBoth++;
      }
    }
  }
  check(worst < 1e-13, `placing a point and reading it back is the identity (worst ${worst.toExponential(2)} over ${tried} edits)`);
  check(changedBoth > 15, `and ${changedBoth} of those edits move BOTH local numbers, so the two views are not the same pair of fields twice`);
}

// ---------------------------------------------------------------- 3. the panel, read from the source
console.log('\n== 3. the tile shows the pair, and writes back through the same map ==');
{
  const ui = fs.readFileSync(path.join(POC_DIR, 'src', 'editor-ui.ts'), 'utf8');
  const css = fs.readFileSync(path.join(POC_DIR, 'src', 'style.css'), 'utf8');
  check(/const localToFloor = \(f: MoveFrame[\s\S]*?const floorToLocal = \(f: MoveFrame/.test(ui),
    'the frame is mapped in ONE place, and it is inverted right beside it');
  // BOTH the drawing and the drag go through it, so a field and a dot cannot disagree about the frame.
  check(/const world = \(lx: number, ly: number\) => localToFloor\(p0, lx, ly\);/.test(ui),
    'the handles that are DRAWN on the board use it');
  check(/const \{ lx, ly \} = floorToLocal\(p0, snapped\.x, snapped\.y\);/.test(ui),
    'and so does the drag that reads a pointer off it - one frame, not three copies');
  check(/const CURVE_POINTS[\s\S]{0,600}?point: 'C1'[\s\S]{0,200}?point: 'C2'[\s\S]{0,200}?point: 'P3'/.test(ui),
    'the three points are named once - C1, C2, P3, the vocabulary the probes and the engine already use');
  check(/table\.appendChild\(heading\);[\s\S]{0,900}?for \(const p of CURVE_POINTS\)/.test(ui),
    'the tile heads two columns and then builds a row per coordinate, so the absolute pair reads ACROSS from the relative one');
  check(/hRel\.textContent = 'relative';/.test(ui) && /hAbs\.textContent = 'absolute';/.test(ui),
    'and a two-word heading says which column is which, rather than a paragraph above the block');
  // THE WRITE, both directions: it converts the named point back through the SAME map, writes BOTH local
  // keys, and leaves the other axis alone.
  check(/const want = axis === 'x' \? \{ x: v, y: at\.y \} : \{ x: at\.x, y: v \};/.test(ui),
    'an edit keeps the axis it did not name, so naming an X does not silently reset the Y');
  check(/const local = floorToLocal\(frame as MoveFrame, want\.x, want\.y\);/.test(ui),
    'and converts back through the same map the numbers were read with');
  check(/\[p\.lx\]: local\.lx, \[lyKey\]: local\.ly/.test(ui),
    'writing BOTH local coordinates, because on a turned dancer a sideways move is not one local edit');
  // The rail: the facing curve's first control has no `cy3` in the format, so its pair is a readout.
  check(/const railedAxis = railedY && axis === 'y';/.test(ui) && /relLocked \|\| railedAxis/.test(ui),
    'and only the one NUMBER the FORMAT pins - the facing curve\'s first control\'s Y - is locked, with its own reason');
  check(/const relative: Record<string, \{ key: Slot; label: string \} \| null> = facing/.test(ui) && /C1x: \{ key: 'cx1', label: 'cx3' \}/.test(ui),
    'while that control\'s X (cx3, which the DTD does carry) keeps its row and stays editable, as it was before this table');
  check(/this control is pinned to the dancer/.test(ui),
    'said in the field itself rather than left as a dead input');
  // The spinner: asked for, and this is the only place a coordinate input is built.
  check(/input\.classList\.add\('no-step'\)/.test(ui) && /\.ed-coords input\.no-step::-webkit-inner-spin-button/.test(css),
    'there are no increment/decrement arrows on either column - the class is applied AND the CSS hides them');

  // A drag rewrites the local numbers on every pointer move, so the floor pair has to follow in the same tick.
  check(/values\.push\(\[`m\$\{i\}:\$\{k\}:a\.\$\{p\.point\}x`, at\.x\], \[`m\$\{i\}:\$\{k\}:a\.\$\{p\.point\}y`, at\.y\]\);/.test(ui),
    'and the board pair is refreshed with the local numbers during a drag, not left describing the previous frame');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
