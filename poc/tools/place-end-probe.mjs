// PLACING AN END POSE MUST NOT RE-AUTHOR THE MOVE'S FACING - except where the move cannot carry it.
//
// Reported as the "Place end" button: "Add a button to the start setup and end setup that just moves the
// dancers to the chosen formation position and rotation … The Connect buttons should remain, as it as it's
// own applications." Connect is `setDancerEnd`, which re-aims through `padSegment` and so ALWAYS writes an
// explicit `rotate` curve - a move authored to face along its travel (`rotate: null`) silently becomes an
// explicit one. That is the right trade for a connect (the track has to join) and the wrong one for a
// placement, where moving the dancers IS the whole intent.
//
// `placeDancerEnd` therefore has three cases and this probe measures all three:
//
//   1. the move HAS a facing curve        -> the turn rides that curve, mode unchanged;
//   2. the move faces along its travel    -> the PATH is aimed, `rotate` stays null;
//   3. the placement asks for NO translation -> there is no path to aim; the turn goes on a curve, and that
//      is the ONE case where the placement changes the move's facing mode.
//
// THE NEGATIVE CONTROL for case 2 is `setDancerEnd`, the engine's own alternative: it is measured to leave
// `rotate` non-null on the same move, which is the check that a `padSegment`-based placement would fail.
// For case 3 the control is the aimed-path branch itself: with a degenerate path its arrival tangent is
// `atan2(0, 0) = 0`, so the dancer would end facing where it already was instead of the spot's way.
//
// Run: node tools/place-end-probe.mjs   (from poc/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = await import(pathToFileURL(path.join(POC, '..', 'engine', 'dist', 'index.js')).href);
const { DOMParser } = await import('@xmldom/xmldom');
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(POC, '../assets', p), 'utf8');
const movesXml = asset('moves.xml');
const formationsXml = asset('formations.xml');

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures++; }
};
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
const fmt = (n) => (Math.round(n * 1e6) / 1e6).toString();

// The witness: a real call, so the moves BEFORE the placed one are the corpus's own and the placement's
// "every earlier move is untouched" claim is measured against something rather than against itself.
const src = engine.normalizeInstance(engine.loadCallFromXml(asset('ms/circle.xml'), movesXml, formationsXml, 0));
const D = 0;
const K = src.dancers[D].path.length - 1;
console.log(`    witness: "${src.title}" (${src.dancers.length} dancers, ${src.beats} beats), dancer ${D} has ${K + 1} moves`);
check(K >= 0, 'the witness dancer has at least one move to place an end pose on');

const hands = src.dancers[D].path[K].hands;
/** `setMove` at the LAST index, so the pose the move starts from is the corpus's own. */
const withLast = (seg) => engine.setMove(src, D, K, { beats: 2, hands, ...seg });

const travel = { cx1: 1, cy1: 0, cx2: 2, cy2: 0.2, x2: 3, y2: 0.4 };
const facing = { cx1: 0.4, cy1: 0.05, cx2: 0.9, cy2: 0.2, x2: 1.1, y2: 0.35 };
const pivot = { cx1: 0, cy1: 0, cx2: 0, cy2: 0, x2: 0, y2: 0 };

/** Where a dancer actually ends, and the error against the pose that was asked for. */
const placedErr = (call, pose) => {
  const p = engine.poseFor(call.dancers[D], engine.instanceBeats(call));
  return { p, err: Math.max(Math.hypot(p.x - pose.x, p.y - pose.y), Math.abs(norm(p.heading - pose.heading))) };
};
const lastSeg = (call) => call.dancers[D].path[call.dancers[D].path.length - 1];

const base = withLast({ translate: travel, rotate: facing });
const preStart = engine.poseFor(base.dancers[D], engine.instanceBeats(base) - 2);
const TARGET = { x: preStart.x + 2.5, y: preStart.y - 1.75, heading: norm(preStart.heading + 0.7) };
console.log(`    the last move starts at (${fmt(preStart.x)}, ${fmt(preStart.y)}) heading ${fmt(preStart.heading)}; the target is (${fmt(TARGET.x)}, ${fmt(TARGET.y)}) heading ${fmt(TARGET.heading)}`);

// How much of the move's own authorship survives: the number of translate control points unchanged.
const sameTranslate = (a, b) => ['cx1', 'cy1', 'cx2', 'cy2', 'x2', 'y2'].filter((k) => a.translate[k] !== b.translate[k]).length;

// ------------------------------------------------------------------ 1. an authored facing curve keeps it
console.log('\n== 1. the move has a facing curve, so the turn rides it (mode unchanged) ==');
{
  const out = engine.placeDancerEnd(base, D, TARGET);
  const seg = lastSeg(out);
  const { p, err } = placedErr(out, TARGET);
  console.log(`    ends at (${fmt(p.x)}, ${fmt(p.y)}) heading ${fmt(p.heading)}; worst pose error ${err.toExponential(1)}`);
  check(err < 1e-9, 'the placement lands on the target pose exactly, position AND rotation');
  check(seg.rotate !== null, 'the move still carries a facing curve: the mode is the one the author chose');
  check(seg.beats === 2 && seg.hands === hands, 'and the beats and hands are held, so the call is not re-timed');
  check(Math.abs(norm(engine.bezierAngle(seg.rotate, 1) - engine.bezierAngle(seg.rotate, 0) - (TARGET.heading - preStart.heading))) < 1e-9,
    'the turn written on that curve IS the heading change asked for');
  // AND IT IS `padSegment` THAT WAS USED, not a lucky coincidence: byte-for-byte the same segment.
  const pad = engine.padSegment({ x: preStart.x, y: preStart.y, heading: preStart.heading }, TARGET, 2);
  check(sameTranslate(seg, pad) === 0
    && seg.rotate.cx1 === pad.rotate.cx1 && seg.rotate.cy1 === pad.rotate.cy1
    && seg.rotate.cx2 === pad.rotate.cx2 && seg.rotate.cy2 === pad.rotate.cy2
    && seg.rotate.x2 === pad.rotate.x2 && seg.rotate.y2 === pad.rotate.y2,
    'and it is exactly the segment `padSegment` builds - the case with a facing curve is the existing rule');
}

// ------------------------------------------------------------------ 2. a travel move is AIMED, not re-authored
console.log('\n== 2. the move faces along its travel, so the PATH is aimed (rotate stays null) ==');
{
  const call = withLast({ translate: travel, rotate: null });
  const out = engine.placeDancerEnd(call, D, TARGET);
  const seg = lastSeg(out);
  const { p, err } = placedErr(out, TARGET);
  console.log(`    ends at (${fmt(p.x)}, ${fmt(p.y)}) heading ${fmt(p.heading)}; worst pose error ${err.toExponential(1)}`);
  check(err < 1e-9, 'the placement lands on the target pose exactly, position AND rotation');
  check(seg.rotate === null, 'AND THE MOVE STILL FACES ALONG ITS TRAVEL: the author\'s `rotate: null` is untouched');
  check(seg.beats === 2 && seg.hands === hands, 'beats and hands held here too');
  // The departure tangent is the facing the dancer already had, so the path does not snap it.
  check(Math.abs(engine.bezierAngle(seg.translate, 0)) < 1e-12,
    'the aimed path DEPARTS along the dancer\'s own +X, so the move does not snap the facing at its start');

  // THE NEGATIVE CONTROL: `setDancerEnd`, the engine's own re-aim, on the very same move. It reaches the
  // same pose by the other route - and converts the move to an explicit facing, which is the whole reason
  // this function exists. If this control ever reports `rotate === null`, case 2 is testing nothing.
  const viaConnect = engine.setDancerEnd(call, D, TARGET);
  const cSeg = lastSeg(viaConnect);
  const cErr = placedErr(viaConnect, TARGET).err;
  console.log(`    setDancerEnd on the same move: worst pose error ${cErr.toExponential(1)}, rotate=${cSeg.rotate === null ? 'null' : 'a curve'}`);
  check(cErr < 1e-9 && cSeg.rotate !== null,
    'the control reaches the same pose but writes a facing curve, so a `padSegment`-based placement WOULD fail the check above');
}

// ------------------------------------------------------------------ 3. a turn in place has no path to aim
console.log('\n== 3. a placement that asks for NO translation falls back to the facing curve (the one mode change) ==');
{
  const SPOT = { x: preStart.x, y: preStart.y, heading: norm(preStart.heading - 0.6) };
  const out = engine.placeDancerEnd(withLast({ translate: travel, rotate: null }), D, SPOT);
  const seg = lastSeg(out);
  const { p, err } = placedErr(out, SPOT);
  console.log(`    ends at (${fmt(p.x)}, ${fmt(p.y)}) heading ${fmt(p.heading)}; worst pose error ${err.toExponential(1)}`);
  check(err < 1e-9, 'the turn is landed exactly, on a placement that moves nobody');
  check(seg.rotate !== null, 'the move comes back with a facing curve: with no displacement there is no path to aim');
  check(sameTranslate(seg, engine.padSegment({ x: preStart.x, y: preStart.y, heading: preStart.heading }, SPOT, 2)) === 0,
    'and its path is the straight one `padSegment` builds, so nothing is silently re-shaped');

  // THE NEGATIVE CONTROL: what the aimed-path branch itself would do here. A degenerate cubic's arrival
  // tangent is `atan2(0, 0) = 0`, so the turn would be LOST - measured, not asserted.
  const turn = norm(SPOT.heading - preStart.heading);
  const degenerateTurn = engine.bezierAngle(pivot, 1) - engine.bezierAngle(pivot, 0);
  console.log(`    a degenerate path has no arrival tangent: the ${fmt(turn)} turn would read as ${fmt(degenerateTurn)}`);
  check(degenerateTurn === 0 && Math.abs(turn) > 0.1,
    'so the aimed branch would hold the position but NOT the rotation - which is why this case falls back');

  // AND THE CONDITION IS THE PLACEMENT'S DISPLACEMENT, NOT THE MOVE'S: a move authored as a pivot that is
  // asked to finish somewhere else gets the aimed path like any other travel move. Pinned because reading
  // the guard as "the move does not travel" is the natural mistake, and it would silently re-author here.
  const moved = engine.placeDancerEnd(withLast({ translate: pivot, rotate: null }), D, TARGET);
  const mSeg = lastSeg(moved);
  const mErr = placedErr(moved, TARGET).err;
  console.log(`    a pivot asked to MOVE: worst pose error ${mErr.toExponential(1)}, rotate=${mSeg.rotate === null ? 'null' : 'a curve'}`);
  check(mErr < 1e-9 && mSeg.rotate === null,
    'a move authored as a pivot but asked to travel is aimed like any other, because the caller asked for travel');
}

// ------------------------------------------------------------------ 4. the contract with everything else
console.log('\n== 4. earlier moves, other dancers and the call length are untouched ==');
{
  const call = withLast({ translate: travel, rotate: null });
  const out = engine.placeDancerEnd(call, D, TARGET);
  let beforeChanged = 0;
  for (let j = 0; j < K; j++) beforeChanged += sameTranslate(call.dancers[D].path[j], out.dancers[D].path[j]) > 0 ? 1 : 0;
  check(beforeChanged === 0, `no move BEFORE the placed one changes (${K} checked)`);
  let othersChanged = 0;
  for (let i = 0; i < call.dancers.length; i++) {
    if (i === D) continue;
    if (JSON.stringify(call.dancers[i].path) !== JSON.stringify(out.dancers[i].path)) othersChanged++;
  }
  check(othersChanged === 0, `and no other dancer is touched (${call.dancers.length - 1} checked)`);
  check(out.dancers[D].path.length === call.dancers[D].path.length, 'the move is replaced, not added or removed');
  check(out.dancers[D].x === call.dancers[D].x && out.dancers[D].y === call.dancers[D].y && out.dancers[D].angleDeg === call.dancers[D].angleDeg,
    'and the dancer\'s START is untouched: this places the END');
  // THE HEAVY HALF: a dancer with no moves at all is a refusal, not a silent no-op.
  let threw = '';
  try { engine.placeDancerEnd({ ...call, dancers: call.dancers.map((d, i) => (i === D ? { ...d, path: [] } : d)) }, D, TARGET); }
  catch (e) { threw = e.message; }
  check(/has no moves to place an end pose on/.test(threw), `a dancer with no moves refuses out loud: "${threw}"`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
