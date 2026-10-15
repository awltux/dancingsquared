// MIRRORING A DANCER'S MOVES ACROSS A BOARD AXIS: the rule behind the Call editor's X and Y buttons.
//
// Asked for: "Add a mirror feature. Add an X and Y button that mirrors the selected dancers Moves across the
// axis indicated by the button. Dont move the dancers start position or rotation, just their Moves. When
// multiple dancers are selected, the mirror must use the translation around the board centre to ensure the
// board maintains its balance. put the buttons below the Edit: line"
//
// SETTLED WHILE PLANNING, and both are the caller's decisions rather than the arithmetic's:
//   - the buttons name the BOARD'S OWN axes - X the horizontal line through the board's centre, Y the
//     vertical one - and not the dancer's own frame;
//   - the hand state swaps left for right, which is what the corpus means by a mirror.
//
// THE RULE IS ONE REFLECTION PER MOVE, ABOUT A FIXED DIRECTION IN THE DANCER'S OWN FRAME:
//
//     beta       = phi - h0          the board axis (phi: 0 for X, a quarter turn for Y) in the DANCER's frame
//     local point -> R(2*beta) * diag(1, -1) * local point
//
// A path is authored in dancer-LOCAL coordinates (`engine/src/types.ts`: the origin is the dancer's spot when
// the move begins and +X is the facing at that instant), so `phi - h0` is the only reading of "the board's
// axis" that exists in this data - and it is the reading asked for, because a dancer already facing along the
// axis gets `beta = 0`, a plain left-for-right mirror. Every local curve of the track takes it: the travel
// curve as above, and the facing curve about the LOCAL +X axis (below).
//
// AND THE RESULT IS EXACT IN BOARD TERMS, which is the whole content of the requirement and what section 1
// measures over the shipped corpus, at every joint and mid-move instant of every move:
//
//   - POSITIONS. The mirrored world position is the original's mirror about the chosen board axis through
//     the DANCER'S OWN START: `p' = M * (p - S) + S`.
//   - HEADINGS. The mirrored heading is the original's mirror about the DANCER'S OWN FACING: `h' = 2*h0 - h`.
//
// READ THE FIRST ONE THE OTHER WAY ROUND AND IT IS THE REQUIREMENT. The axis is the board's, through the
// BOARD CENTRE, and the reflected track is then TRANSLATED back so it still begins at its own start - which
// is exactly what moves the axis onto `S`, so the centre cancels and the rule needs no centre argument. That
// is also why selecting several dancers mirrors the set about ONE line (the board's) rather than about each
// dancer's own centre, which is what "the board maintains its balance" asks for.
//
// A RIGID MIRROR OF THE WHOLE TRACK IS NOT AVAILABLE, and the pair above is the exact price of it - so this
// is a property of the requirement and not a shortcut. A reflection about the board axis maps the start
// heading `h0` to `2*phi - h0`; a track that both mirrored AND still began facing `h0` would have to be the
// reflection about `h0`'s OWN line, which is the dancer's axis and not the board's, and would make the two
// buttons the same edit. Pinning the start pose - which is what was asked for - splits the two channels as
// above, and sections 1a and 1b pin each of them separately.
//
// WHY THE FACING CHANNEL IS MIRRORED ABOUT THE LOCAL +X AXIS WHATEVER `beta` IS. `poseFor` reads a facing
// curve as `bezierAngle(f, t) - bezierAngle(f, 0)`, so only its TURN means anything, and a reflection
// negates the turn whichever line it is about - the board axis adds nothing to it. What DOES matter is that
// the format has no `cy3` (`bezRotAttr` writes `cx3 cx4 cy4 x4 y4`; `taminations.md` §7.3), so a facing
// reflected about a `beta` that is not a multiple of a quarter turn comes back with a non-zero `cy1` and
// loses its first span the moment the file is re-read. Section 1f is where that case is reachable at all and
// section 6 measures the control that gets it wrong.
//
// THE SHIPPED CORPUS BARELY REACHES THAT CASE: MEASURED, only 8 of its 3228 sampled dancer-tracks start off
// the board's axes at all, so a reflected facing curve stays representable by accident across almost all of
// it. That is a coverage gap and not a result, so section 1f BUILDS the case with the panel's own
// `setDancerStart`, re-heading sampled dancers 45 degrees off the axis.
//
// THE RULE IS IMPORTED, NOT MIRRORED: it is `mirrorDancerMoves` in `engine/src/editor.ts`, exported by the
// package, so this probe measures the function the panel calls - and section 5 reads the panel's source to
// pin that the panel calls it rather than restating the arithmetic. The hand swap is imported for the same
// reason: `swapLR` is the engine's own definition, the one `reflect="-1"` uses. The ONLY place the
// arithmetic is written out in this file is section 6, and only ever as a rule to be refuted.
//
// EVERY REJECTED RULE IS MEASURED (section 6), each as the control for the check that rules it out, and each
// with the check it must NOT trip named too:
//   - `beta = phi` (the board angle read as a local one) breaks the POSITION property and leaves headings
//     perfect, because a heading comes only from the negated turns;
//   - `beta` taken from each MOVE's own heading instead of the track's start heading breaks it the same way;
//   - the hand state left alone breaks section 2's count and nothing else;
//   - the facing mirrored about `beta` - instead of the local +X axis - breaks section 1f's representability
//     count and nothing else;
//   - the facing turn left alone breaks section 1b's headings and the positions with them, because the
//     frames ARE the accumulated turns;
//   - the axis argument ignored makes X and Y the same edit and breaks section 1e.
//
// COST: MEASURED at 10 s standalone and 15 s inside `verify-probes.mjs`, and all of it is loading the XML
// (`loadCallFromXml` + `normalizeInstance` of every call) - the mirror and pose arithmetic is under a tenth of
// a second. The controls reuse the calls the sweep already parsed rather than reading the corpus again, which
// is what keeps this in the fast tier.
//
// Run: node tools/mirror-moves-probe.mjs   (from poc/)

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
const sci = (n) => n.toExponential(3);

const DEG = Math.PI / 180;
/** Each board axis as an angle in the BOARD's frame - the `phi` the rule is written with. */
const AXIS_ANGLE = { x: 0, y: Math.PI / 2 };
/** The shortest signed angle equal to `a`, in (-PI, PI]. Mirrored from `editor-ui.ts`. */
const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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

// ------------------------------------------------------------------ the reference reading
//
// WRITTEN OUT HERE, NOT TAKEN FROM THE ENGINE, or section 1 would be measuring the rule against itself: this
// is the requirement's own sentence - reflect about the board's axis through the CENTRE, then carry the track
// back to its start - composed into one map, where the centre visibly cancels.

/** The board's own reflection of a world point: X keeps y and flips x's sign, Y keeps x and flips y's. */
const reflectAboutBoard = (p, axis) => (axis === 'x' ? { x: p.x, y: -p.y } : { x: -p.x, y: p.y });

/** Where the reflected point ends up once the track is carried back to the start `S`. */
const expectedPosition = (p, axis, S) => {
  const m = reflectAboutBoard(p, axis);
  const ms = reflectAboutBoard(S, axis);
  return { x: m.x - ms.x + S.x, y: m.y - ms.y + S.y };
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
 * midpoints are where a curve's own control points are read rather than only its endpoint. A denser grid
 * buys nothing here - the map is affine on each local curve, so two tracks that agree at a joint and at
 * mid-curve agree everywhere between - and it would cost the sweep its place in the fast tier.
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
 * HOW THE TWO PROPERTIES ARE READ OFF ONE MIRROR, and the one place a section's numbers come from so that
 * the corpus sweep, the diagonal sweep and section 6's controls cannot drift apart.
 */
function compare(before, after, axis, swapHands = true) {
  const out = { pos: 0, heading: 0, samples: 0, handsWrong: 0, cy1: 0, curves: 0 };
  const h0 = before.angleDeg * DEG;
  const a = poses(before);
  const b = poses(after);
  for (let s = 0; s < a.length; s++) {
    out.samples++;
    const want = expectedPosition(a[s], axis, before);
    out.pos = Math.max(out.pos, Math.hypot(b[s].x - want.x, b[s].y - want.y));
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

// ------------------------------------------------------------------ 1-4. one pass over the corpus
console.log('== 1. the mirrored track is the board mirror of the original, start pose untouched ==');

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
let nAxisDiffers = 0;
let nAlong = 0;
let nCorpusTwist = 0;
let worstLocalX = 0;
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
/** THE DIAGONAL WITNESSES: one entry per selected dancer, its bundle RE-HEADED 45 degrees off the axis. */
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
      // 1a/1b/4. THE TWO PROPERTIES, instant by instant, against the requirement's own reading.
      const r = compare(d, d2, axis);
      nSamples += r.samples;
      nMoves += d.path.length;
      worstPos = Math.max(worstPos, r.pos);
      worstHeading = Math.max(worstHeading, r.heading);
      nRotateCurves += r.curves;
      nRotateBadCy1 += r.cy1;
      // 1d. THE `beta = 0` CASE - up to a half turn, which is the same reflection - is the plain
      // left-for-right mirror, and it is checked on the CURVE rather than through the poses, so it is an
      // independent reading of "the board axis in the dancer's own frame" and not a restatement of 1a.
      // The count kept beside it is the coverage gap section 1f exists to fill: how many of the corpus's own
      // starts land on a `beta` that is NOT a multiple of a quarter turn, which is where a reflected facing
      // curve stops being representable at all.
      const beta = AXIS_ANGLE[axis] - d.angleDeg * DEG;
      if (Math.abs(Math.sin(beta)) < 1e-12) {
        nAlong++;
        for (let k = 0; k < d.path.length; k++) {
          const a = d.path[k].translate;
          const b = d2.path[k].translate;
          worstLocalX = Math.max(worstLocalX,
            Math.abs(b.cx1 - a.cx1), Math.abs(b.cy1 + a.cy1), Math.abs(b.cy2 + a.cy2), Math.abs(b.y2 + a.y2));
        }
      } else if (Math.abs(Math.sin(2 * beta)) > 1e-12) {
        nCorpusTwist++;
      }
      // 1e. THE TWO BUTTONS ARE DIFFERENT EDITS. A rule that ignored its axis argument would pass every
      // geometric check in this file - both readings are self-consistent - and fail this one.
      if (JSON.stringify(d2) !== JSON.stringify(other.dancers[i])) nAxisDiffers++;
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
        const a = d.path[k];
        const b = back.dancers[i].path[k];
        for (const p of ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2']) {
          worstDouble = Math.max(worstDouble, Math.abs(b.translate[p] - a.translate[p]));
          if (a.rotate) worstDouble = Math.max(worstDouble, Math.abs(b.rotate[p] - a.rotate[p]));
        }
        if (b.hands !== a.hands) nDoubleHands++;
      }
    }
    // 1c. AN UNSELECTED DANCER IS NOT TOUCHED AT ALL.
    for (const i of unsel) {
      if (JSON.stringify(after.dancers[i]) !== JSON.stringify(call.dancers[i])) worstUnselected = Infinity;
    }
  }
  // THE DIAGONAL WITNESSES for section 1f and section 6's fourth control: the POOL's calls, with every
  // selected dancer re-headed 45 degrees off the board's axes, so `beta` is not a multiple of a quarter turn.
  // A state the panel reaches from the formation table's `head` column and the corpus reaches 8 times in
  // 3288 dancer-tracks (the count section 1f prints) - so it is BUILT with the panel's own `setDancerStart`
  // rather than looked for.
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
check(nAlong > 20, `the corpus's own starts face along an axis, so the common case is covered (${nAlong} dancers)`);
check(worstPos < 1e-9,
  `1a every mirrored POSITION is the original reflected about that board axis through the dancer's own start ` +
  `(worst ${sci(worstPos)} over ${nSamples} instants) - the requirement's "about the board centre, then translated back"`);
check(worstHeading < 1e-9,
  `1b and every mirrored HEADING is the original reflected about the dancer's own facing (worst ${sci(worstHeading)} rad)`);
check(worstStart === 0, `1c the start pose does not move: x, y and the heading come back bit-identical (worst ${fmt(worstStart)})`);
check(worstBeats === 0, `1c and no move is re-timed, added or dropped (worst ${fmt(worstBeats)})`);
check(worstUnselected === 0, `1c an UNSELECTED dancer is not touched at all (worst ${fmt(worstUnselected)})`);
check(worstLocalX < 1e-12,
  `1d a dancer facing ALONG the axis is mirrored about its own forward axis - local x kept, y negated ` +
  `(worst ${sci(worstLocalX)} over ${nAlong} such dancers)`);
check(nAxisDiffers > 100,
  `1e and the two buttons are DIFFERENT edits: ${nAxisDiffers} selected dancers come out differently under X and Y`);
check(nHandWrong === 0 && nHandChanged === nHanded && nHanded > 500,
  `2  every one of the ${nHanded} named hand states is the engine's own swapLR of the authored one and did change ` +
  `(${nHandWrong} wrong, ${nHandChanged} changed)`);
check(worstDouble < 1e-12,
  `3  mirroring twice restores every curve to where it started (worst ${sci(worstDouble)} over ${nMoves} moves)`);
check(nDoubleHands === 0, `3  and every hand comes back (${nDoubleHands} left swapped)`);
check(nRotateCurves > 1000 && nRotateBadCy1 === 0,
  `4  every mirrored facing curve is still something the format can write - cy1 stays 0 (${nRotateBadCy1} of ${nRotateCurves} are not)`);

// ------------------------------------------------------------------ 1f. the case the corpus barely reaches
console.log('\n== 1f. the non-quarter-turn beta, which the corpus almost never reaches and the panel can ==');

let nDiag = 0;
let nDiagSamples = 0;
let worstDiagPos = 0;
let worstDiagHeading = 0;
let nDiagCurves = 0;
let nDiagCy1 = 0;
let diagStraight = 0;
let witness = null;

for (const { where, call, i, moves } of diagonal) {
  for (const axis of ['x', 'y']) {
    const d = call.dancers[i];
    const beta = AXIS_ANGLE[axis] - d.angleDeg * DEG;
    if (Math.abs(Math.sin(2 * beta)) < 0.5) { diagStraight++; continue; }
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
console.log(`    re-headed ${diagonal.length} dancers from ${pool.length} calls 45 degrees off the axis, and mirrored ` +
  `${nDiag} tracks of them: of the corpus's own ${nDancers} dancer-tracks only ${nCorpusTwist} land on a ` +
  `non-quarter-turn beta, so the case is built here rather than looked for.`);
check(nDiag > 200, `the diagonal sweep is big enough to mean something (${nDiag} mirrored tracks)`);
check(nDiagSamples > 2000, `and reaches every instant of them (${nDiagSamples})`);
check(diagStraight === 0, `and every one of them is a genuine non-quarter turn (${diagStraight} were not)`);
check(worstDiagPos < 1e-9,
  `1a HOLDS in the general case too: the mirrored position is the board mirror (worst ${sci(worstDiagPos)})`);
check(worstDiagHeading < 1e-9,
  `1b holds in the general case too: the mirrored heading is the facing mirror (worst ${sci(worstDiagHeading)} rad)`);
check(nDiagCurves > 100 && nDiagCy1 === 0,
  `4  and the local +X facing mirror leaves ${nDiagCy1} of ${nDiagCurves} diagonal facings unrepresentable (cy1 stays 0)`);

console.log('\n== 4b. a mirrored track survives an export and a re-read ==');
check(witness !== null, 'a diagonal witness exists, because section 1f built one with the panel\'s own `setDancerStart`');
if (witness) {
  const { where, i, axis, call, moves } = witness;
  const after = mirrorDancer(call, i, axis);
  console.log(`    witness: ${where} dancer ${i + 1} (facing ${fmt(call.dancers[i].angleDeg)} deg, ${moves} moves), mirrored about ${axis.toUpperCase()}`);
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
// THE TOOLTIPS STATE THE RULE, so they are part of it: a control that did not say the axis is the BOARD'S, or
// that the start pose does not move, would be describing an edit it does not make.
check(/the BOARD's horizontal axis/.test(buttonAt('edMirrorX')) && /the BOARD's vertical axis/.test(buttonAt('edMirrorY')),
  'the tooltips name the BOARD axis each button takes');
check(/START POSITION or START ROTATION/.test(buttonAt('edMirrorX')) && /hand swaps left for right/.test(buttonAt('edMirrorX')),
  'and say that the start pose does not move and that the hands swap');

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
check(!/Math\.cos\(2 \*|Math\.sin\(2 \*|beta/.test(uiSrc),
  'the reflection arithmetic lives in the engine and is not restated in the panel');

{
  // AND THE SOURCE CHECKS FAIL ON THE FAULTS THEY WERE WRITTEN FOR - otherwise they are regexes that happen
  // to match a line.
  const renamed = htmlSrc.replace('id="edMirrorX"', 'id="edMirrorZ"');
  check(renamed !== htmlSrc && !/id="edMirrorX"/.test(renamed), 'renaming the X button fails the button check');
  const noRow = htmlSrc.replace(/<div class="row" id="edMirrorRow">[\s\S]*?<\/div>/, '');
  check(noRow !== htmlSrc && noRow.indexOf('id="edMirrorX"') < 0, 'deleting the row fails the placement check');
  const staleTip = htmlSrc.replace(/the BOARD's horizontal axis/, "the dancer's own axis");
  check(staleTip !== htmlSrc && !/the BOARD's horizontal axis/.test(staleTip),
    'a tooltip that stops naming the board axis fails the wording check');
  const noHandler = uiSrc.replace(/private mirrorSelectedMoves/, 'private mirrorGone');
  check(noHandler !== uiSrc && !/private mirrorSelectedMoves/.test(noHandler), 'removing the handler fails the checks that name it');
  const inlineMath = uiSrc.replace('private mirrorSelectedMoves', 'const u = Math.cos(2 * 0);\n  private mirrorSelectedMoves');
  check(!/Math\.cos\(2 \*|Math\.sin\(2 \*|beta/.test(inlineMath) === false,
    'and restating the reflection in the panel fails the check that it is not there');
}

// ------------------------------------------------------------------ 6. the rejected rules
console.log('\n== 6. the rules that were rejected, each against the check that rules it out ==');

// THE ONLY ARITHMETIC WRITTEN OUT IN THIS FILE, and it is here to be WRONG in six measured ways. Each control
// rebuilds the track with `setDancerPath` - the engine's own write - so a control differs from the rule only
// in the reflection it asks for: the `beta` it uses, the line it mirrors the facing about, and whether it
// swaps the hands.
const applyMirror = (call, i, segOf) => engine.setDancerPath(call, i, call.dancers[i].path.map(segOf));

/** Reflect one segment by `R(2*beta) * diag(1, -1)`, with the facing about the local +X, about `beta`, or not at all. */
const controlSeg = (s, beta, facing, swapHands) => {
  const u = Math.cos(2 * beta);
  const v = Math.sin(2 * beta);
  const at = (x, y) => ({ x: u * x + v * y, y: v * x - u * y });
  const c1 = at(s.translate.cx1, s.translate.cy1);
  const c2 = at(s.translate.cx2, s.translate.cy2);
  const p3 = at(s.translate.x2, s.translate.y2);
  let rotate = null;
  if (s.rotate) {
    if (facing === 'none') rotate = { ...s.rotate };
    else if (facing === 'localX') rotate = { ...s.rotate, cy1: -s.rotate.cy1, cy2: -s.rotate.cy2, y2: -s.rotate.y2 };
    else {
      const r1 = at(s.rotate.cx1, s.rotate.cy1);
      const r2 = at(s.rotate.cx2, s.rotate.cy2);
      const r3 = at(s.rotate.x2, s.rotate.y2);
      rotate = { cx1: r1.x, cy1: r1.y, cx2: r2.x, cy2: r2.y, x2: r3.x, y2: r3.y };
    }
  }
  return {
    beats: s.beats,
    hands: swapHands ? engine.swapLR(s.hands) : s.hands,
    translate: { cx1: c1.x, cy1: c1.y, cx2: c2.x, cy2: c2.y, x2: p3.x, y2: p3.y },
    rotate,
  };
};

/** The frame heading when move `k` begins, which is what "each move's own heading" would use. */
const headingAt = (d, k) => engine.poseFor(d, engine.moveBeatRange(d, k).from).heading;

/**
 * ONE CONTROL OVER ONE SET OF CALLS: the worst `compare` reading it produces, plus the two counts that decide
 * which single check can see it - the hand violations and how differently X and Y come out.
 *
 * `facing` is the facing channel's reading: `localX` (the rule), `beta` (the control that is geometrically
 * right and unrepresentable) or `none` (the turn left alone).
 */
function control(name, makeBeta, facing, swapHands, samples, axes) {
  const worst = { pos: 0, heading: 0, cy1: 0, curves: 0, handsWrong: 0, calls: 0, axisDiffers: 0 };
  for (const { call, dancers } of samples) {
    for (const axis of axes) {
      for (const i of dancers) {
        const d = call.dancers[i];
        if (d.path.length === 0) continue;
        const h0 = d.angleDeg * DEG;
        const after = applyMirror(call, i, (s, k) => controlSeg(s, makeBeta(d, axis, k, h0), facing, swapHands));
        const r = compare(d, after.dancers[i], axis);
        if (r.samples === 0) continue;
        worst.calls++;
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
      const h0 = call.dancers[i].angleDeg * DEG;
      return applyMirror(c, i, (s, k) => controlSeg(s, makeBeta(call.dancers[i], axis, k, h0), facing, swapHands));
    }, call);
    const x = mirrorWith('x');
    const y = mirrorWith('y');
    for (const i of dancers) if (JSON.stringify(x.dancers[i]) !== JSON.stringify(y.dancers[i])) worst.axisDiffers++;
  }
  console.log(`    ${name}: worst position ${sci(worst.pos)}, worst heading ${sci(worst.heading)}, ` +
    `non-zero cy1 ${worst.cy1}, hand violations ${worst.handsWrong}, X-vs-Y differences ${worst.axisDiffers} (${worst.calls} tracks)`);
  return worst;
}

const betaRight = (d, axis) => AXIS_ANGLE[axis] - d.angleDeg * DEG;
const betaBoard = (d, axis) => AXIS_ANGLE[axis];
const betaPerMove = (d, axis, k) => AXIS_ANGLE[axis] - headingAt(d, k);
/** The X rule applied whatever the button says - the "ignore the axis argument" control. */
const betaAlwaysX = (d) => AXIS_ANGLE.x - d.angleDeg * DEG;

check(pool.length >= 40 && diagonal.length >= 100, `the control samples are big enough to mean something (${pool.length} corpus calls, ${diagonal.length} diagonal tracks)`);

{
  // REJECTED 1: THE BOARD ANGLE USED AS A LOCAL ONE (`beta = phi`). It ignores where the dancer is facing, and
  // the POSITION property is what catches it; 1b does NOT, because a heading comes only from the negated
  // turns, which this control still negates.
  const r = control('beta = phi (the board angle read as a local one)', betaBoard, 'localX', true, pool, ['x', 'y']);
  check(r.pos > 0.5, `it moves mirrored positions by up to ${fmt(r.pos)}, so 1a is what rules it out`);
  check(r.heading < 1e-9, `and it leaves every heading perfect (worst ${sci(r.heading)}), so 1b cannot`);
}
{
  // REJECTED 2: `beta` from EACH MOVE's OWN heading instead of the track's start heading. The plausible
  // reading of "mirror this move", and it does not compose: the tail is turned against the head.
  const r = control("beta from each move's own heading", betaPerMove, 'localX', true, pool, ['x', 'y']);
  check(r.pos > 0.5, `it moves mirrored positions by up to ${fmt(r.pos)}, so 1a is what rules it out`);
  check(r.heading < 1e-9, `and it leaves every heading perfect (worst ${sci(r.heading)}), so 1b cannot`);
}
{
  // REJECTED 3: THE HANDS LEFT ALONE. Geometry is untouched, so only section 2's count can catch it.
  const r = control('the hand state left alone', betaRight, 'localX', false, pool, ['x', 'y']);
  check(r.handsWrong > 100, `it leaves ${r.handsWrong} moves holding the wrong hand, so section 2 is what rules it out`);
  check(r.pos < 1e-9 && r.heading < 1e-9,
    `and it is geometrically identical (worst ${sci(r.pos)} / ${sci(r.heading)}), so no pose check can`);
}
{
  // REJECTED 4: THE FACING MIRRORED ABOUT `beta` AS WELL. The turn is still negated, so every pose is right -
  // what breaks is the FORMAT. Run over the DIAGONAL tracks, because on an axis-aligned facing the two
  // readings of the facing channel coincide and the control would be vacuous (measured: the corpus's own
  // starts are all axis-aligned, which is what section 1f records).
  const r = control('the facing mirrored about beta too', betaRight, 'beta', true, diagonal, ['x']);
  check(r.cy1 > 0 && r.curves > 100,
    `it writes ${r.cy1} of ${r.curves} facing curves with a non-zero cy1, so section 1f's count is what rules it out`);
  check(r.pos < 1e-9 && r.heading < 1e-9,
    `and it moves nothing (worst ${sci(r.pos)} / ${sci(r.heading)}), so no pose check can`);
}
{
  // REJECTED 5: THE FACING TURN LEFT ALONE. Each move's floor shape is untouched, but the FRAMES are the
  // accumulated turns, so a track that no longer turns is also no longer mirrored: this breaks 1b's headings
  // AND carries the positions off the mirror. Both are measured, because the facing channel's own reading is
  // the heading one and the position consequence is why this cannot be dismissed as cosmetic.
  const r = control('the facing turn left alone', betaRight, 'none', true, pool, ['x', 'y']);
  check(r.heading > 1e-3, `it leaves every heading unreflected (worst ${sci(r.heading)} rad), which is 1b's own reading`);
  check(r.pos > 0.5, `and because the frames carry those turns the positions leave the mirror too (worst ${fmt(r.pos)})`);
}
{
  // REJECTED 6: THE AXIS ARGUMENT IGNORED. Every pose is a correct mirror of ONE axis, so the only reading
  // that catches it is 1e's "the two buttons are different edits" - measured on X alone here, where this
  // control is exactly right and no single-axis check can see anything wrong.
  const r = control('the axis argument ignored', betaAlwaysX, 'localX', true, pool, ['x']);
  check(r.axisDiffers === 0, `X and Y come out identical on every dancer (${r.axisDiffers} differences), so 1e is what rules it out`);
  check(r.pos < 1e-9, `and on the axis it does apply it is a self-consistent mirror (worst ${sci(r.pos)}), so no single-axis check can`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else { console.log(`${failures} CHECK(S) FAILED`); process.exit(1); }
