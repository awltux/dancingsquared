// MIRRORING A DANCER'S MOVES ACROSS ONE OF THE DANCER'S OWN AXES: the rule behind the Call editor's X and Y
// buttons.
//
// Asked for as: "Add a mirror feature. Add an X and Y button that mirrors the selected dancers Moves across
// the axis indicated by the button. Dont move the dancers start position or rotation, just their Moves. When
// multiple dancers are selected, the mirror must use the translation around the board centre to ensure the
// board maintains its balance. put the buttons below the Edit: line" - and then, after trying what that first
// sentence produced, as: "Currently the mirror is allong the boards X and Y, but after some experimentation I
// realise that it should be along the dancers local X and Y axis."
//
// THE AXES ARE THE DANCER'S OWN, which is the frame the moves are authored in (`engine/src/types.ts`: the
// origin is the dancer's spot when the move begins, +X is the facing at that instant and +Y is to the
// dancer's LEFT). So the rule is one quarter-turn reflection per move, and a quarter turn is one sign:
//
//     X:  (x, y) -> (x, -y)      reflect about the local X axis - the line the dancer faces along
//     Y:  (x, y) -> (-x, y)      reflect about the local Y axis - the line across the facing
//
// `X` is therefore the left-for-right mirror and `Y` the forward-for-back one. The rule is
// `mirrorDancerMoves` in `engine/src/editor.ts`, exported by the package; this probe measures THAT function,
// and section 5 reads the panel's source to pin that the panel calls it rather than restating it. The hand
// swap is the engine's own `swapLR` - the definition `reflect="-1"` uses - imported for the same reason. The
// ONLY place the arithmetic is written out in this file is section 6, and only ever as a rule to be refuted.
//
// TWO THINGS ARE EXACT, and section 1 measures both over the shipped corpus at every joint and mid-move
// instant of every move:
//
//   - POSITIONS. The mirrored world position is the original's mirror about the chosen axis through the
//     DANCER'S OWN START - for X the line they face along, for Y the line across it.
//   - HEADINGS. The mirrored heading is the original's mirror about the DANCER'S OWN START FACING, whichever
//     axis is chosen - because `poseFor` reads a facing curve as a TURN and a reflection negates every turn,
//     whichever line it is about.
//
// SO `X` IS A RIGID MIRROR OF THE WHOLE TRACK AND `Y` IS NOT, and the reason is the pinned start pose rather
// than the arithmetic: a reflection about a line at angle `theta` maps the start heading `h0` to
// `2*theta - h0`, which is `h0` itself only when that line IS the facing. `X` is that line - so for `X` the
// positions and the headings reflect about one axis - while for `Y` the positions reflect about the left-hand
// line and the facing profile stays mirrored about the facing. Section 6's last control measures the
// alternative: a true rigid mirror about the local Y axis, which has to TURN THE DANCER 180 degrees, and is
// refused because the start pose must not move.
//
// THE BOARD-AXIS READING WAS SHIPPED FIRST AND IS NOW REJECTED, and section 6 measures why it could not be the
// answer. That version reflected about the BOARD's axis as the dancer's frame sees it (`beta = phi - h0`),
// which is a quarter turn only for a dancer facing along the board's axis; for anyone else it writes a facing
// curve with `cy1 = sin(2*beta)*cx1`, and the format has no `cy3` to put it in (`bezRotAttr` writes
// `cx3 cx4 cy4 x4 y4`; `taminations.md` §7.3), so the reflected facing loses its first span the moment the
// file is re-read (AGENTS.md §8 trap 18). Its control here leaves **222 of 222** diagonal facings
// unrepresentable. THE LOCAL AXES CANNOT DO THAT: both are quarter turns, so `cy1` stays exactly 0 for every
// facing of every dancer, whatever way they face, and section 1f counts that where it is hardest - dancers
// re-headed 45 degrees off anything the corpus ships.
//
// THE REJECTED RULES ARE MEASURED (section 6), each as the control for the check that rules it out, and each
// with the check it must NOT trip named too:
//   - the BOARD-axis reading (the rule this replaced) breaks the POSITION property on every dancer not facing
//     along the board axis and writes unrepresentable facings, while leaving the headings perfect;
//   - the axis argument ignored makes X and Y the same edit;
//   - the hand state left alone is geometrically identical and caught only by section 2;
//   - the facing turn left alone breaks the headings and the positions with them, because the frames ARE the
//     accumulated turns;
//   - a RIGID mirror about the local Y axis, which turns the dancer 180 degrees to do it, breaks only the
//     promise that the start pose does not move.
//
// COST: one pass over the corpus, and all of it is loading the XML (`loadCallFromXml` + `normalizeInstance` of
// every call); the mirror and pose arithmetic is a fraction of a second. The controls reuse the calls the
// sweep already parsed rather than reading the corpus again, which keeps this in the fast tier.
//
// Run: node tools/mirror-moves-probe.mjs   (from poc/)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

const POC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC_DIR, '..', 'engine', 'dist', 'index.js')).href);
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
const sci = (n) => n.toExponential(3);

const DEG = Math.PI / 180;
/** The BOARD's own axes, kept for section 6's rejected reading only: the board frame is where the first
 *  version took its angles from, and that is exactly what went wrong. */
const BOARD_AXIS_ANGLE = { x: 0, y: Math.PI / 2 };
/** The shortest signed angle equal to `a`, in (-PI, PI]. Mirrored from `editor-ui.ts`. */
const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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

// ------------------------------------------------------------------ the reference reading
//
// WRITTEN OUT HERE, NOT TAKEN FROM THE ENGINE, or section 1 would be measuring the rule against itself. This
// is the requirement's own sentence: "the dancer's own X axis" is the line they face along and "their own Y
// axis" the line across it, and the mirror is taken about that line THROUGH THE DANCER'S OWN START - which is
// what keeps the start pose where it is.

/** The world angle of the dancer's own axis: local +X is the facing, local +Y is a quarter turn from it. */
const axisAngle = (h0, axis) => (axis === 'x' ? h0 : h0 + Math.PI / 2);

/** A world point reflected about the line through `S` at angle `theta`. */
const reflectWorld = (p, theta, S) => {
  const cos = Math.cos(2 * theta);
  const sin = Math.sin(2 * theta);
  const dx = p.x - S.x;
  const dy = p.y - S.y;
  return { x: S.x + cos * dx + sin * dy, y: S.y + sin * dx - cos * dy };
};

/** The selection the panel would use: the even-numbered dancers, or all of them if that leaves fewer than two. */
const selectionOf = (call) => {
  const even = call.dancers.map((_, i) => i).filter((i) => i % 2 === 0);
  return even.length >= 2 ? even : call.dancers.map((_, i) => i);
};

/**
 * THE INSTANTS A TRACK IS COMPARED AT: every joint the move chain defines, plus the middle of every move.
 *
 * The joints are where the frames are re-based, so an error in the frame algebra shows up there first; the
 * midpoints are where a curve's own control points are read rather than only its endpoint. A denser grid buys
 * nothing here - the map is affine on each local curve, so two tracks that agree at a joint and at mid-curve
 * agree everywhere between - and it would cost the sweep its place in the fast tier.
 */
function* instants(path_) {
  let acc = 0;
  for (const s of path_) {
    yield acc;
    yield acc + s.beats / 2;
    acc += s.beats;
  }
  yield acc;
}

/** The panel's own write, named once so every section below is measuring the same call. */
const mirrorDancer = (call, i, axis) => engine.mirrorDancerMoves(call, i, axis);

/** A track's world poses at every sampled instant. */
const poses = (d) => [...instants(d.path)].map((t) => engine.poseFor(d, t));

/**
 * HOW THE TWO PROPERTIES ARE READ OFF ONE MIRROR, and the one place a section's numbers come from so that the
 * corpus sweep, the diagonal witnesses and section 6's controls cannot drift apart.
 */
function compare(before, after, axis) {
  const out = { pos: 0, heading: 0, samples: 0, handsWrong: 0, cy1: 0, curves: 0 };
  const h0 = before.angleDeg * DEG;
  const theta = axisAngle(h0, axis);
  const S = { x: before.x, y: before.y };
  const a = poses(before);
  const b = poses(after);
  for (let s = 0; s < a.length; s++) {
    out.samples++;
    const want = reflectWorld(a[s], theta, S);
    out.pos = Math.max(out.pos, Math.hypot(b[s].x - want.x, b[s].y - want.y));
    // THE HEADING IS MIRRORED ABOUT THE DANCER'S OWN FACING, whichever of the two axes was asked for - see the
    // header; the axis enters the POSITION reference above and not this one.
    out.heading = Math.max(out.heading, Math.abs(normAngle(b[s].heading - (2 * h0 - a[s].heading))));
  }
  for (let k = 0; k < before.path.length && k < after.path.length; k++) {
    if (after.path[k].hands !== engine.swapLR(before.path[k].hands)) out.handsWrong++;
    if (after.path[k].rotate) {
      out.curves++;
      if (Math.abs(after.path[k].rotate.cy1) > 1e-12) out.cy1++;
    }
  }
  return out;
}

// ------------------------------------------------------------------ 1. the rule, over the corpus
console.log('== 1. the mirrored track is the mirror about the dancer\'s OWN axis, start pose untouched ==');

let nCalls = 0;
let nDancers = 0;
let nSamples = 0;
let worstPos = 0;
let worstHeading = 0;
let worstStart = 0;
let worstBeats = 0;
let worstUnselected = 0;
let nDancersWithMoves = 0;
let nMoves = 0;
let nPairDistances = 0;
let worstDistance = 0;
let nAxisDiffers = 0;
let worstHalfTurn = 0;
let worstHeadingAgrees = 0;
let nHanded = 0;
let nHandWrong = 0;
let nHandChanged = 0;
let worstDouble = 0;
let nDoubleHands = 0;
let nRotateCurves = 0;
let nRotateBadCy1 = 0;

/** THE CALLS AND DANCERS THE CONTROLS RUN OVER, taken from the sweep's own parsing rather than read again -
 *  every seventh call, so the sample is spread across the levels instead of being one level's first files. */
const pool = [];
/** THE DIAGONAL WITNESSES: one entry per selected dancer, its bundle RE-HEADED 45 degrees off the corpus's own
 *  axis-aligned starts, so the representability claim is measured where it is hardest. */
const diagonal = [];

for (const { where, call } of calls()) {
  if (call.dancers.length === 0) continue;
  const inPool = nCalls % 7 === 1 && pool.length < 80;
  nCalls++;
  const sel = selectionOf(call);
  const unsel = call.dancers.map((_, i) => i).filter((i) => !sel.includes(i));
  if (inPool) pool.push({ call, dancers: sel });
  for (const axis of ['x', 'y']) {
    const after = sel.reduce((c, i) => mirrorDancer(c, i, axis), call);
    const other = sel.reduce((c, i) => mirrorDancer(c, i, axis === 'x' ? 'y' : 'x'), call);
    for (const i of sel) {
      const d = call.dancers[i];
      const d2 = after.dancers[i];
      nDancers++;
      if (d.path.length === 0) continue;
      nDancersWithMoves++;
      // 1c. THE START POSE IS BIT-IDENTICAL, and no move is re-timed, added or dropped.
      worstStart = Math.max(worstStart, Math.abs(d2.x - d.x), Math.abs(d2.y - d.y), Math.abs(d2.angleDeg - d.angleDeg));
      if (d2.path.length !== d.path.length) worstBeats = Infinity;
      for (let k = 0; k < d.path.length; k++) worstBeats = Math.max(worstBeats, Math.abs(d2.path[k].beats - d.path[k].beats));
      // 1a/1b/1f. THE TWO PROPERTIES, instant by instant, against the requirement's own reading.
      const r = compare(d, d2, axis);
      nSamples += r.samples;
      nMoves += d.path.length;
      worstPos = Math.max(worstPos, r.pos);
      worstHeading = Math.max(worstHeading, r.heading);
      nRotateCurves += r.curves;
      nRotateBadCy1 += r.cy1;
      const a = poses(d);
      const b = poses(d2);
      // 1d. THE MIRROR IS AN ISOMETRY OF THE TRACK: every pair of sampled poses keeps its distance. Measured
      // without the reflection reference, so it is an independent reading of "the shape is not stretched" - and
      // it holds for BOTH axes, each of which reflects the floor path (about the facing for X, about the
      // left-hand line for Y).
      for (let s = 0; s < a.length; s++) {
        for (let t = s + 1; t < a.length; t++) {
          nPairDistances++;
          const was = Math.hypot(a[s].x - a[t].x, a[s].y - a[t].y);
          const now = Math.hypot(b[s].x - b[t].x, b[s].y - b[t].y);
          worstDistance = Math.max(worstDistance, Math.abs(now - was));
        }
      }
      // 1e. THE TWO BUTTONS ARE DIFFERENT EDITS, AND THEY DIFFER IN ONE WAY: Y is X with every local curve
      // turned a half turn (each is a single sign flip), so the headings come out IDENTICAL while the floor
      // paths do not. A rule that ignored its axis would pass every other check in this file.
      const alt = other.dancers[i];
      if (JSON.stringify(d2) !== JSON.stringify(alt)) nAxisDiffers++;
      for (const p of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) {
        // `d2` is the X (or Y) mirror and `alt` the other; they are negatives of each other either way.
        worstHalfTurn = Math.max(worstHalfTurn, Math.abs(alt.path[0].translate[p] + d2.path[0].translate[p]));
      }
      const altPoses = poses(alt);
      for (let s = 0; s < altPoses.length; s++) {
        worstHeadingAgrees = Math.max(worstHeadingAgrees, Math.abs(normAngle(altPoses[s].heading - b[s].heading)));
      }
      // 2. HANDS.
      for (let k = 0; k < d.path.length; k++) {
        const h = d.path[k].hands;
        if (h !== 'none' && h !== 'both' && h !== 'gripboth') nHanded++;
        if (d2.path[k].hands !== engine.swapLR(h)) nHandWrong++;
        if (d2.path[k].hands !== h) nHandChanged++;
      }
      // 3. MIRRORING TWICE.
      const back = mirrorDancer(after, i, axis);
      for (let k = 0; k < d.path.length; k++) {
        const was = d.path[k];
        const now = back.dancers[i].path[k];
        for (const p of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) {
          worstDouble = Math.max(worstDouble, Math.abs(now.translate[p] - was.translate[p]));
          if (was.rotate) worstDouble = Math.max(worstDouble, Math.abs(now.rotate[p] - was.rotate[p]));
        }
        if (now.hands !== was.hands) nDoubleHands++;
      }
    }
    // 1c. AN UNSELECTED DANCER IS NOT TOUCHED AT ALL.
    for (const i of unsel) {
      if (JSON.stringify(after.dancers[i]) !== JSON.stringify(call.dancers[i])) worstUnselected = Infinity;
    }
  }
  // THE DIAGONAL WITNESSES for section 1f and section 6's first control: the POOL's calls, with every selected
  // dancer re-headed 45 degrees off the corpus's own axis-aligned starts - a state the panel reaches from the
  // formation table's `head` column, and the case where the board-axis reading wrote facings the format cannot
  // carry. Built with the panel's own `setDancerStart` rather than looked for.
  if (inPool) {
    for (const i of sel) {
      if (call.dancers[i].path.length === 0) continue;
      const d = call.dancers[i];
      diagonal.push({
        where,
        i,
        moves: d.path.length,
        call: engine.setDancerStart(call, i, { x: d.x, y: d.y, heading: normAngle(d.angleDeg * DEG + Math.PI / 4) }),
        dancers: [i],
      });
    }
  }
}

console.log(`    swept ${nCalls} calls, ${nDancers} selected dancers (${nDancersWithMoves} with tracks) and ${nSamples} instants.`);
check(nCalls > 200, `the sweep is big enough to mean something (${nCalls} calls)`);
check(nDancersWithMoves > 500, `and enough dancers with tracks to test (${nDancersWithMoves})`);
check(nSamples > 5000, `and enough instants to test curves rather than endpoints (${nSamples})`);
check(worstPos < 1e-9,
  `1a every mirrored POSITION is the original's mirror about the DANCER'S OWN axis through their own start ` +
  `(worst ${sci(worstPos)} over ${nSamples} instants) - the facing line for X, the line across it for Y`);
check(worstHeading < 1e-9,
  `1b and every mirrored HEADING is the original's mirror about the dancer's own START FACING, for both axes ` +
  `(worst ${sci(worstHeading)} rad)`);
check(worstStart === 0, `1c the start pose does not move: x, y and the heading come back bit-identical (worst ${fmt(worstStart)})`);
check(worstBeats === 0, `1c and no move is re-timed, added or dropped (worst ${fmt(worstBeats)})`);
check(worstUnselected === 0, `1c an UNSELECTED dancer is not touched at all (worst ${fmt(worstUnselected)})`);
check(nPairDistances > 5000 && worstDistance < 1e-9,
  `1d the mirror is an ISOMETRY of the track: every one of ${nPairDistances} sampled pair distances is kept ` +
  `(worst ${sci(worstDistance)})`);
check(nAxisDiffers > 100, `1e and the two buttons are DIFFERENT edits: X and Y differ on ${nAxisDiffers} selected dancers`);
check(worstHalfTurn < 1e-12,
  `1e with Y exactly the half turn of X in each local curve - every control of one is the negation of the other ` +
  `(worst ${sci(worstHalfTurn)})`);
check(worstHeadingAgrees < 1e-9,
  `1e and the two axes give the SAME heading profile, so they differ in where the dancer goes and not in how ` +
  `they face (worst ${sci(worstHeadingAgrees)} rad)`);
check(nHandWrong === 0 && nHandChanged === nHanded && nHanded > 500,
  `2  every one of the ${nHanded} named hand states is the engine's own swapLR of the authored one and did change ` +
  `(${nHandWrong} wrong, ${nHandChanged} changed)`);
check(worstDouble < 1e-12,
  `3  mirroring twice restores every curve to where it started (worst ${sci(worstDouble)} over ${nMoves} moves)`);
check(nDoubleHands === 0, `3  and every hand comes back (${nDoubleHands} left swapped)`);

// ------------------------------------------------------------------ 1f. the facing the format can carry
console.log('\n== 1f. every mirrored facing is representable, including on a diagonal dancer ==');

let nDiag = 0;
let nDiagSamples = 0;
let worstDiagPos = 0;
let worstDiagHeading = 0;
let nDiagCurves = 0;
let nDiagCy1 = 0;
let witness = null;

for (const { where, call, i, moves } of diagonal) {
  for (const axis of ['x', 'y']) {
    const d = call.dancers[i];
    const after = mirrorDancer(call, i, axis);
    const r = compare(d, after.dancers[i], axis);
    nDiag++;
    nDiagSamples += r.samples;
    worstDiagPos = Math.max(worstDiagPos, r.pos);
    worstDiagHeading = Math.max(worstDiagHeading, r.heading);
    nDiagCurves += r.curves;
    nDiagCy1 += r.cy1;
    // THE EXPORT WITNESS prefers a track with SOME LENGTH to it: a one-move mirror would round-trip for
    // reasons that have nothing to do with the facing channel, and the chain is where the format's 4-decimal
    // writing accumulates.
    if (witness === null || (witness.moves < 4 && moves >= 4)) witness = { where, i, axis, call, moves };
  }
}
console.log(`    re-headed ${diagonal.length} dancers from ${pool.length} calls 45 degrees off the corpus's own starts, ` +
  `and mirrored ${nDiag} tracks of them.`);
check(nDiag > 100, `the diagonal sweep is big enough to mean something (${nDiag} mirrored tracks)`);
check(nDiagSamples > 1000, `and reaches every instant of them (${nDiagSamples})`);
check(worstDiagPos < 1e-9, `1a HOLDS on a diagonal dancer: the position is still the mirror about their own axis (worst ${sci(worstDiagPos)})`);
check(worstDiagHeading < 1e-9, `1b holds there too (worst ${sci(worstDiagHeading)} rad)`);
check(nRotateCurves > 1000 && nRotateBadCy1 === 0 && nDiagCy1 === 0,
  `1f and EVERY mirrored facing curve is representable - cy1 stays 0 for all ${nRotateCurves} corpus curves and ` +
  `all ${nDiagCurves} diagonal ones (${nRotateBadCy1 + nDiagCy1} are not), which is what the local axes buy: ` +
  `both of them are quarter turns`);

console.log('\n== 4. a mirrored track survives an export and a re-read ==');
check(witness !== null, 'a diagonal witness exists, because section 1f built one with the panel\'s own `setDancerStart`');
if (witness) {
  const { where, i, axis, call, moves } = witness;
  const after = mirrorDancer(call, i, axis);
  console.log(`    witness: ${where} dancer ${i + 1} (facing ${fmt(call.dancers[i].angleDeg)} deg, ${moves} moves), mirrored about local ${axis.toUpperCase()}`);
  const back = engine.normalizeInstance(
    engine.loadCallFromXml(`<calls>\n${engine.callToXml(after, after.from)}\n</calls>`, movesXml, formationsXml, 0),
  );
  let worst = 0;
  let samples = 0;
  for (const t of instants(after.dancers[i].path)) {
    const a = engine.poseFor(after.dancers[i], t);
    const b = engine.poseFor(back.dancers[i], t);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
    samples++;
  }
  // THE TOLERANCE IS THE FORMAT'S OWN: `rf` writes four decimals and a CHAIN of moves accumulates that along
  // the headings, which is why `editor.mjs` pins 0.0008 for a re-read circle rather than 0.
  check(samples >= 9 && worst < 1e-3,
    `the whole track reads back through the format's own 4-decimal coordinates (worst ${sci(worst)} over ${samples} instants)`);
  const dropped = back.dancers[i].path.filter((s) => s.rotate && Math.abs(s.rotate.cy1) > 1e-12).length;
  check(dropped === 0, `and nothing the writer had to drop (${dropped} re-read facings with a non-zero cy1)`);
}

// ------------------------------------------------------------------ 5. the panel
console.log('\n== 5. the panel: two buttons below the Edit row, one handler, the IMPORTED rule ==');

/**
 * ONE SOURCE FILE, WITH ITS LINE ENDINGS NORMALISED.
 *
 * The app's TypeScript and HTML are checked in with CRLF while this file is LF - the trap
 * `start-pose-drag-probe.mjs` records - so a structural check written with a literal "\n" can never match.
 * What these checks are about is the SHAPE of the code, and the line ending is not part of that.
 */
const readSource = (rel) => fs.readFileSync(path.join(POC_DIR, rel), 'utf8').replace(/\r\n/g, '\n');

const uiSrc = readSource('src/editor-ui.ts');
const htmlSrc = readSource('index.html');
/** The whole `<button …>X</button>` element for one of the pair, so its wording can be read. */
const buttonAt = (id) => {
  const at = htmlSrc.indexOf(`id="${id}"`);
  return at < 0 ? '' : htmlSrc.slice(at, htmlSrc.indexOf('</button>', at));
};

check(/id="edMirrorX"/.test(htmlSrc) && /id="edMirrorY"/.test(htmlSrc), 'index.html carries the X and Y buttons');
check(htmlSrc.indexOf('id="edMirrorX"') > htmlSrc.indexOf('id="edAxisHead"') &&
  htmlSrc.indexOf('id="edMirrorX"') < htmlSrc.indexOf('id="edMoveAdd"'),
  'and their row sits BELOW the Edit row - after its axis pair and above the next row - which is where it was asked for');
check(/<label[^>]*>Mirror<\/label>/.test(htmlSrc.slice(htmlSrc.indexOf('id="edMirrorRow"') - 40, htmlSrc.indexOf('id="edMirrorX"'))),
  'the row is labelled Mirror, so the two letters are not two anonymous buttons');
// THE TOOLTIPS STATE THE RULE, so they are part of it: a control still offering the BOARD's axes, or not
// promising that the start pose stays, would be describing an edit it does not make.
check(/the DANCER'S OWN X axis/.test(buttonAt('edMirrorX')) && /the DANCER'S OWN Y axis/.test(buttonAt('edMirrorY')),
  'the tooltips name the DANCER\'S OWN axis each button takes, which is the reading that replaced the board\'s');
check(/START POSITION and ROTATION/.test(buttonAt('edMirrorX')) && /hand swaps left for right/.test(buttonAt('edMirrorX')),
  'and say that the start pose does not move and that the hands swap');
check(!/BOARD's (horizontal|vertical) axis/.test(htmlSrc), 'and nothing in the markup still offers the board\'s axes');
// THE STATUS LINE THE PRESS WRITES IS PART OF THE RULE TOO, and TWO faults in it were found by pressing the
// buttons in a real browser rather than by any check here: the string still announced "the board's X axis" after
// the axes had moved to the dancer, and its possessive read "1 dancer' moves" for a single dancer. Both are
// pinned now.
check(/across the dancer's own \$\{axis\.toUpperCase\(\)\} axis/.test(uiSrc) && !/across the board's/.test(uiSrc),
  'the status line the press reports names the DANCER\'S OWN axis, so the report and the tooltip agree');
check(/dancer\$\{done === 1 \? "'s" : "s'"} moves/.test(uiSrc),
  'and its possessive is right for both counts - "1 dancer\'s moves", "4 dancers\' moves"');

check(/private mirrorXBtn = el<HTMLButtonElement>\('edMirrorX'\)/.test(uiSrc) &&
  /private mirrorYBtn = el<HTMLButtonElement>\('edMirrorY'\)/.test(uiSrc),
  'the two buttons are reached by `el()`, so a missing id fails loudly instead of silently doing nothing');
check(/this\.mirrorXBtn\.addEventListener\('click', \(\) => this\.mirrorSelectedMoves\('x'\)\);/.test(uiSrc) &&
  /this\.mirrorYBtn\.addEventListener\('click', \(\) => this\.mirrorSelectedMoves\('y'\)\);/.test(uiSrc),
  'and each listener names its own axis, both through the ONE handler');
check(/^  mirrorDancerMoves,$/m.test(uiSrc),
  'the handler uses the rule from the engine package rather than a private copy');
check(/for \(const d of targets\) \{[\s\S]{0,160}mirrorDancerMoves\(next, d, axis\)/.test(uiSrc),
  'and applies it to every SELECTED dancer, one engine call each');
check(/this\.commit\(next, 'mirror'\)/.test(uiSrc),
  'the write goes through `commit`, so it is one undo step and the panel re-renders');
check(/no dancers selected — pick dancers above the table, or the mirror has nowhere to write/.test(uiSrc),
  'and an empty selection is refused out loud rather than committing nothing');
// THE ARITHMETIC IS NOT HERE. This is the check that stops the reflection drifting back into the panel, where
// no probe could measure it - the same reason `board-transform.ts` exists.
check(!/Math\.cos\(2 \*|Math\.sin\(2 \*|beta|BOARD_CENTRE/.test(uiSrc),
  'the reflection arithmetic lives in the engine and is not restated in the panel');

{
  // AND THE SOURCE CHECKS FAIL ON THE FAULTS THEY WERE WRITTEN FOR - otherwise they are regexes that happen
  // to match a line.
  const renamed = htmlSrc.replace('id="edMirrorX"', 'id="edMirrorZ"');
  check(renamed !== htmlSrc && !/id="edMirrorX"/.test(renamed), 'renaming the X button fails the button check');
  const noRow = htmlSrc.replace(/<div class="row" id="edMirrorRow">[\s\S]*?<\/div>/, '');
  check(noRow !== htmlSrc && noRow.indexOf('id="edMirrorX"') < 0, 'deleting the row fails the placement check');
  const staleTip = htmlSrc.replace(/the DANCER'S OWN X axis/, "the BOARD's horizontal axis");
  check(staleTip !== htmlSrc && !/the DANCER'S OWN X axis/.test(staleTip),
    'restoring the board-axis wording fails the tooltip check');
  const staleStatus = uiSrc.replace("across the dancer's own ${axis.toUpperCase()} axis", "across the board's ${axis.toUpperCase()} axis");
  check(staleStatus !== uiSrc && !/across the dancer's own/.test(staleStatus),
    'and putting the old status wording back fails the check that the press reports what the tooltip promised');
  const staleCount = uiSrc.replace('${done === 1 ? "\'s" : "s\'"}', "${done === 1 ? '' : 's'}");
  check(staleCount !== uiSrc && !/dancer\$\{done === 1 \? "'s" : "s'"} moves/.test(staleCount),
    'and the count-blind possessive fails too - it is the one that read "1 dancer\' moves"');
  const noHandler = uiSrc.replace(/private mirrorSelectedMoves/, 'private mirrorGone');
  check(noHandler !== uiSrc && !/private mirrorSelectedMoves/.test(noHandler), 'removing the handler fails the checks that name it');
  const inlineMath = uiSrc.replace('private mirrorSelectedMoves', 'const u = Math.cos(2 * 0);\n  private mirrorSelectedMoves');
  check(!/Math\.cos\(2 \*|Math\.sin\(2 \*|beta|BOARD_CENTRE/.test(inlineMath) === false,
    'and restating the reflection in the panel fails the check that it is not there');
}

// ------------------------------------------------------------------ 6. the rejected rules
console.log('\n== 6. the rules that were rejected, each against the check that rules it out ==');

// THE ONLY ARITHMETIC WRITTEN OUT IN THIS FILE, and it is here to be WRONG in five measured ways. Each control
// rebuilds the track with `setDancerPath` - the engine's own write - so a control differs from the rule only in
// the reflection it asks for.
const applyMirror = (call, i, segOf) => engine.setDancerPath(call, i, call.dancers[i].path.map(segOf));

/** One local curve flipped about one of the two local axes - the rule, as the controls' building block. */
const flip = (b, axis) => (axis === 'x'
  ? { ...b, cy1: -b.cy1, cy2: -b.cy2, y2: -b.y2 }
  : { ...b, cx1: -b.cx1, cx2: -b.cx2, x2: -b.x2 });

/** One local curve reflected about the line through the local origin at angle `beta` - the BOARD reading. */
const flipAbout = (b, beta) => {
  const u = Math.cos(2 * beta);
  const v = Math.sin(2 * beta);
  return {
    cx1: u * b.cx1 + v * b.cy1,
    cy1: v * b.cx1 - u * b.cy1,
    cx2: u * b.cx2 + v * b.cy2,
    cy2: v * b.cx2 - u * b.cy2,
    x2: u * b.x2 + v * b.y2,
    y2: v * b.x2 - u * b.y2,
  };
};

/**
 * ONE CONTROL OVER ONE SET OF CALLS: the worst `compare` reading it produces, plus the counts that decide
 * which single check can see it.
 */
function control(name, makeSeg, callsToUse, axes) {
  const worst = { pos: 0, heading: 0, cy1: 0, curves: 0, handsWrong: 0, tracks: 0, axisDiffers: 0 };
  for (const { call, dancers } of callsToUse) {
    for (const axis of axes) {
      for (const i of dancers) {
        const d = call.dancers[i];
        if (d.path.length === 0) continue;
        const after = applyMirror(call, i, (s, k) => makeSeg(s, axis, d, k));
        const r = compare(d, after.dancers[i], axis);
        if (r.samples === 0) continue;
        worst.tracks++;
        worst.pos = Math.max(worst.pos, r.pos);
        worst.heading = Math.max(worst.heading, r.heading);
        worst.cy1 += r.cy1;
        worst.curves += r.curves;
        worst.handsWrong += r.handsWrong;
      }
    }
    // 1e's own reading: what this control makes of X against Y.
    const mirrorWith = (axis) => dancers.reduce((c, i) => {
      if (call.dancers[i].path.length === 0) return c;
      return applyMirror(c, i, (s, k) => makeSeg(s, axis, call.dancers[i], k));
    }, call);
    const x = mirrorWith('x');
    const y = mirrorWith('y');
    for (const i of dancers) if (JSON.stringify(x.dancers[i]) !== JSON.stringify(y.dancers[i])) worst.axisDiffers++;
  }
  console.log(`    ${name}: worst position ${sci(worst.pos)}, worst heading ${sci(worst.heading)}, ` +
    `non-zero cy1 ${worst.cy1}, hand violations ${worst.handsWrong}, X-vs-Y differences ${worst.axisDiffers} ` +
    `(${worst.tracks} tracks)`);
  return worst;
}

/** The rule, as a control's `makeSeg`. */
const segRule = (s, axis) => ({
  beats: s.beats,
  hands: engine.swapLR(s.hands),
  translate: flip(s.translate, axis),
  rotate: s.rotate ? flip(s.rotate, axis) : null,
});

check(pool.length >= 40 && diagonal.length >= 100,
  `the control samples are big enough to mean something (${pool.length} corpus calls, ${diagonal.length} diagonal tracks)`);

{
  // REJECTED 1: THE BOARD'S AXES, BOTH CHANNELS REFLECTED ABOUT `beta = phi - h0` - the consistent form of the
  // reading this feature replaced. It is a quarter turn only for a dancer facing along the board's axis, so the
  // POSITION property is what catches it on everyone else; the headings stay perfect, because a heading comes
  // only from the negated turns. On a DIAGONAL witness it does worse than a wrong shape: the facing curve comes
  // back with a `cy1` the format has nowhere to write.
  //
  // THE VERSION THAT SHIPPED SPLIT THE FACING ONTO THE LOCAL +X AXIS (which is what a quarter turn is), so it
  // stayed representable - and that split is the tell: the board's axes are not the frame the moves are written
  // in, and a reflection in that frame has to be re-expressed per dancer to be written back at all.
  const boardSeg = (s, axis, d) => {
    const beta = BOARD_AXIS_ANGLE[axis] - d.angleDeg * DEG;
    return {
      beats: s.beats,
      hands: engine.swapLR(s.hands),
      translate: flipAbout(s.translate, beta),
      rotate: s.rotate ? flipAbout(s.rotate, beta) : null,
    };
  };
  const corpus = control('the BOARD\'s axes, both channels about beta = phi - h0', boardSeg, pool, ['x', 'y']);
  const diag = control('  ...and the same on a DIAGONAL dancer', boardSeg, diagonal, ['x', 'y']);
  check(corpus.pos > 0.5, `it moves mirrored positions by up to ${fmt(corpus.pos)}, so 1a is what rules it out`);
  check(corpus.heading < 1e-9, `and it leaves every heading perfect (worst ${sci(corpus.heading)}), so 1b cannot`);
  check(diag.cy1 > 0 && diag.curves > 100,
    `and on a diagonal facing it writes ${diag.cy1} of ${diag.curves} facing curves the format cannot carry ` +
    `(cy1 != 0), where the local axes write none - the measurement AGENTS.md §8 trap 18 records`);
}
{
  // REJECTED 2: THE AXIS ARGUMENT IGNORED - both buttons applying the local X flip. Every pose it produces is a
  // correct mirror of ONE axis, so the only reading that catches it is 1e's "the two buttons are different".
  const alwaysX = (s) => segRule(s, 'x');
  const r = control('the axis argument ignored (always the local X flip)', alwaysX, pool, ['x']);
  check(r.axisDiffers === 0, `X and Y come out identical on every dancer (${r.axisDiffers} differences), so 1e is what rules it out`);
  check(r.pos < 1e-9, `and on the axis it does apply it is a self-consistent mirror (worst ${sci(r.pos)}), so no single-axis check can`);
}
{
  // REJECTED 3: THE HANDS LEFT ALONE. Geometry is untouched, so only section 2's count can catch it.
  const noHands = (s, axis) => ({ ...segRule(s, axis), hands: s.hands });
  const r = control('the hand state left alone', noHands, pool, ['x', 'y']);
  check(r.handsWrong > 100, `it leaves ${r.handsWrong} moves holding the wrong hand, so section 2 is what rules it out`);
  check(r.pos < 1e-9 && r.heading < 1e-9,
    `and it is geometrically identical (worst ${sci(r.pos)} / ${sci(r.heading)}), so no pose check can`);
}
{
  // REJECTED 4: THE FACING TURN LEFT ALONE. Each move's own floor shape is mirrored, but the FRAMES are the
  // accumulated turns, so a track that no longer turns is also no longer mirrored. Both are measured, because
  // the facing channel's own reading is the heading one and the position consequence is why this cannot be
  // dismissed as cosmetic.
  const noTurn = (s, axis) => ({ ...segRule(s, axis), rotate: s.rotate ? { ...s.rotate } : null });
  const r = control('the facing turn left alone', noTurn, pool, ['x', 'y']);
  check(r.heading > 1e-3, `it leaves every heading unreflected (worst ${sci(r.heading)} rad), which is 1b's own reading`);
  check(r.pos > 0.5, `and because the frames carry those turns the positions leave the mirror too (worst ${fmt(r.pos)})`);
}
{
  // REJECTED 5: THE RIGID MIRROR ABOUT THE LOCAL Y AXIS - the geometrically clean alternative, and the one the
  // pinned start pose forbids. A rigid mirror of the whole pose about the line across the facing maps the start
  // heading `h0` to `2*theta - h0`, which for the local Y axis is `h0 + PI`: THE DANCER HAS TO START FACING THE
  // OTHER WAY. Built that way (the local X flip, which reflects about the facing line, followed by the half turn
  // that carries that line onto the local Y one) the track is a perfect mirror of positions AND headings, and
  // the only thing wrong with it is the promise 1c makes. That is the reason the shipped rule splits the two
  // channels the way it does rather than turning anybody.
  const r = { pos: 0, heading: 0, startMoved: 0, tracks: 0 };
  for (const { call, dancers } of pool) {
    for (const i of dancers) {
      const d = call.dancers[i];
      if (d.path.length === 0) continue;
      const h0 = d.angleDeg * DEG;
      const theta = axisAngle(h0, 'y');
      const S = { x: d.x, y: d.y };
      const mirrored = applyMirror(call, i, (s, k) => segRule(s, 'x'));
      const turned = engine.setDancerStart(mirrored, i, { x: d.x, y: d.y, heading: normAngle(h0 + Math.PI) });
      // ITS OWN REFERENCE, not `compare`'s: a RIGID mirror reflects the positions AND the headings about the one
      // line, which is exactly what the shipped rule does not do for Y.
      const a = poses(d);
      const b = poses(turned.dancers[i]);
      r.tracks++;
      for (let s = 0; s < a.length; s++) {
        const want = reflectWorld(a[s], theta, S);
        r.pos = Math.max(r.pos, Math.hypot(b[s].x - want.x, b[s].y - want.y));
        r.heading = Math.max(r.heading, Math.abs(normAngle(b[s].heading - (2 * theta - a[s].heading))));
      }
      r.startMoved = Math.max(r.startMoved, Math.abs(turned.dancers[i].angleDeg - d.angleDeg));
    }
  }
  console.log(`    the rigid mirror about the local Y axis: worst position ${sci(r.pos)}, worst heading ${sci(r.heading)}, ` +
    `start heading moved ${fmt(r.startMoved)} (${r.tracks} tracks)`);
  check(r.pos < 1e-9 && r.heading < 1e-9,
    `it IS the perfect mirror - positions ${sci(r.pos)} and headings ${sci(r.heading)} - which is why no pose check can refuse it`);
  check(r.startMoved > 90, `and it has to TURN every dancer by ${fmt(r.startMoved)} degrees to do it, so 1c's promise is what rules it out`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
