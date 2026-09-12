// The transcribed `Swing Thru` rule, and the evidence that it is right — kept as a tool rather than
// thrown away with the probe that produced it, because PLAN.md Phase 9e-2 rests on it.
//
//   node test/tools/swing-thru-rule.mjs
//
// WHAT THIS IS. `Swing Thru` is the top of the Phase 9e-2 port list. The rule below is a
// transcription of the reference (`taminations-flutter/lib/sequencer/calls/ms/swing_thru.dart`) and
// of CALLERLAB's definition ("Those who can turn 1/2 by the right; then those who can turn 1/2 by
// the left", working "in one or more groups of four"): part 1 = `Trade` the dancers who hold RIGHT
// hands with each other, part 2 = `Trade` the dancers who hold LEFT hands. A half arm turn with your
// hand-neighbour puts you exactly where they were, so each part IS a Trade.
//
// It is written in JS here, not in the engine, because it is not shippable yet: a coded move
// SHADOWS the catalogue (`Sequencer.applyToBoard` tries coded moves first and does NOT fall through
// on refusal), so the wave arm alone would refuse boards the catalogue currently handles correctly
// via the Facing Couples Rule. See PLAN.md. It is a validated specification for the next round.
//
// WHAT IT SHOWS:
//   * on `Ocean Waves` the rule reproduces the engine's own authored tam EXACTLY, 8 of 8 dancers in
//     positions and facings — so the wave arm is right, not merely plausible;
//   * on `Eight Chain Thru` the box has no hand pairs at all, so the arm that acts there is the
//     Facing Couples Rule; and
//   * two candidate answers for that second arm are REFUTED (trade the facing pairs in place, and
//     `Pass the Ocean` then the wave rule), with `Pass the Ocean` on a box picking the Tidal Wave
//     variant and on a Double Pass Thru landing two dancers on the same spot.
//
// The hand primitives, from `call_context.dart` (note MUTUAL right-to-right, which the first draft
// got wrong as right-to-left — the measurement caught it):
//     dancersHoldingRightHands = { d : d2 = dancerToRight(d, minDistance 3.0); dancerToRight(d2) == d }
//     dancersHoldingLeftHands  = { d : d2 = dancerToLeft(d,  minDistance 3.0); dancerToLeft(d2)  == d }
//     isRightOf / isLeftOf are FACING-RELATIVE (bearing -pi/2 / +pi/2 in the dancer's own frame),
//     tolerance 0.1 rad (`extensions.dart`); isInWave(d,w) requires each to sit at the same relative
//     bearing from the other, which is what excludes a side-by-side couple (+pi/2 and -pi/2).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const DELTA = 0.1; // the reference's isAround tolerance, in radians
const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d < -Math.PI) d += 2 * Math.PI; if (d > Math.PI) d -= 2 * Math.PI; return Math.abs(d); };
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const phys = (board) => board.dancers.filter((d) => !d.isGhost);

/** Bearing of `b` in `a`'s own frame: 0 = in front, -pi/2 = right, +pi/2 = left. */
function bearing(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const c = Math.cos(a.heading), s = Math.sin(a.heading);
  return Math.atan2(-dx * s + dy * c, dx * c + dy * s);
}

function nearest(from, cands) {
  let best = null, bd = Infinity;
  for (const c of cands) { const dd = dist(from, c); if (dd < bd) { bd = dd; best = c; } }
  return best;
}

/** `dancerToRight` / `dancerToLeft`: the nearest dancer at bearing -pi/2 / +pi/2. */
function sideNeighbour(board, d, side, maxDist = Infinity) {
  const target = side === 'right' ? -Math.PI / 2 : Math.PI / 2;
  const cands = phys(board).filter((o) => o.id !== d.id && dist(d, o) <= maxDist && angDiff(bearing(d, o), target) < DELTA);
  return nearest(d, cands);
}

/** `dancersHoldingRightHands` / `dancersHoldingLeftHands`: MUTUAL same-side pairs. */
function handPairs(board, side) {
  const out = [];
  const used = new Set();
  for (const d of phys(board)) {
    if (used.has(d.id)) continue;
    const w = sideNeighbour(board, d, side, 3.0);
    if (!w) continue;
    const back = sideNeighbour(board, w, side);
    if (!back || back.id !== d.id) continue;
    used.add(d.id); used.add(w.id);
    out.push([d, w]);
  }
  return out;
}

/** A dancer exchange: both movers swap complete state (position AND facing), which is what a
 *  half arm turn with the hand-neighbour comes to. */
function exchange(board, pairs) {
  const swap = new Map();
  for (const [a, b] of pairs) {
    swap.set(a.id, { x: b.x, y: b.y, heading: b.heading });
    swap.set(b.id, { x: a.x, y: a.y, heading: a.heading });
  }
  return { dancers: board.dancers.map((d) => { const s = swap.get(d.id); return s ? { ...d, ...s } : d; }) };
}

/** The transcribed rule. */
function swingThru(board) {
  const p1 = handPairs(board, 'right');
  if (p1.length === 0) return null;
  const after1 = exchange(board, p1);
  const p2 = handPairs(after1, 'left');
  return { board: exchange(after1, p2), p1, p2 };
}

/** Facing pairs (each directly in front of the other, mutual nearest, within 2.5). */
function facingPairs(board) {
  const out = [];
  const used = new Set();
  for (const d of phys(board)) {
    if (used.has(d.id)) continue;
    const cands = phys(board).filter((o) => o.id !== d.id && dist(d, o) <= 2.5 && angDiff(bearing(d, o), 0) < DELTA);
    const w = nearest(d, cands);
    if (!w || angDiff(bearing(w, d), 0) >= DELTA) continue;
    used.add(d.id); used.add(w.id);
    out.push([d, w]);
  }
  return out;
}

const faceOf = (h) => (((Math.round((h * 180) / Math.PI / 90) * 90 % 360) + 360) % 360);
const pose = (d) => `(${d.x.toFixed(2)},${d.y.toFixed(2)})${faceOf(d.heading)}`;
const row = (b) => b.dancers.map((d) => `i${d.id}${pose(d)}`).join(' ');
const pairsText = (pairs) => pairs.length ? pairs.map(([a, b]) => `${a.id}-${b.id}`).join(',') : '(none)';

let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${msg}`); if (!ok) failures++; };

console.log('== the transcribed rule vs the engine\'s authored wave motion ==');
for (const form of ['Ocean Waves', 'Right-Hand Waves', 'Left-Hand Waves']) {
  const b = seq.boardForFormation(form);
  if (!b) { console.log(`  skip  ${form}: no template`); continue; }
  const tam = seq.applyToBoard(b, 'Swing Thru');
  const mine = swingThru(b);
  if (!tam.legal) { console.log(`  skip  ${form}: engine refuses the call`); continue; }
  if (!mine) { check(false, `${form}: the rule found no hand pairs`); continue; }
  const A = new Map(tam.board.dancers.map((d) => [d.id, d]));
  const wrong = b.dancers.filter((d) => pose(A.get(d.id)) !== pose(mine.board.dancers.find((x) => x.id === d.id))).length;
  check(wrong === 0, `${form}: rule == tam on ${8 - wrong}/8 dancers  (right ${pairsText(mine.p1)} | left ${pairsText(mine.p2)})`);
}

console.log('\n== the Facing Couples Rule arm, which is NOT implemented (see PLAN.md) ==');
for (const form of ['Eight Chain Thru', 'Trade By', 'Double Pass Thru']) {
  const b = seq.boardForFormation(form);
  if (!b) continue;
  const hands = handPairs(b, 'right').length + handPairs(b, 'left').length;
  const facing = facingPairs(b);
  console.log(`  ${form.padEnd(18)} hand pairs on the box: ${hands};  facing pairs: ${pairsText(facing)}`);
  // The refuted first hypothesis: trading the facing pairs in place leaves no left pairs.
  if (facing.length) {
    const after1 = exchange(b, facing);
    const p2 = handPairs(after1, 'left');
    check(p2.length === 0, `${form}: trading the facing pairs in place leaves ${p2.length} left pair(s) - the in-place model cannot work (needs 0 to stay refuted)`);
  }
}

console.log('\n== a separate defect this found: Pass the Ocean on these boxes ==');
{
  const b = seq.boardForFormation('Eight Chain Thru');
  const po = seq.applyToBoard(b, 'Pass the Ocean');
  console.log(`  Eight Chain Thru + Pass the Ocean -> ${po.legal ? `${row(po.board)} (${seq.knownFormation(po.board)})` : 'refused'}`);
  const dpt = seq.boardForFormation('Double Pass Thru');
  const po2 = seq.applyToBoard(dpt, 'Pass the Ocean');
  if (po2.legal) {
    const spots = po2.board.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}`);
    const dup = spots.length !== new Set(spots).size;
    check(dup, `Double Pass Thru + Pass the Ocean puts ${dup ? 'TWO DANCERS ON THE SAME SPOT' : 'every dancer on its own spot'}`);
  }
}

console.log(failures ? `\nSWING THRU RULE: ${failures} check(s) FAILED` : '\nSWING THRU RULE: all checks passed');
process.exitCode = failures ? 1 : 0;
