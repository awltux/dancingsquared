// `Circle Four` IS A TURN OF THE RING THE ACTING FOUR STAND ON, pinned.
//
// Reported from use: "the Circle Four Left 3/4 seems to assign the wrong dancer from the correct group to each
// path in the call. They also seem to rotate 90 degrees at the start of the call." The slot was
// `Heads Promenade 3/4 to Home || All Except Heads ( Step Forward + Circle Four Left 3/4 )`.
//
// MEASURED MECHANISM, because the cause is not where the report looks. `Step Forward` leaves the sides on a 2x2
// RING of four, and `ms/circle.xml`'s tams for this call are three HALF-SET 2-path tams (`Facing Couples` at
// x=-2, `Compact` at -1.5, `Far` at -3, doubled to four dancers by the 180-degree mirror) plus 4-path
// `Lines`/`Eight Chain Thru` tams. The match error is a SUM over dancers, so the nearest half-set (`Compact`,
// 0.5 per dancer = 2.0) missed the 1.5 tolerance: the sub-board matched NOTHING to a tolerance of 8, the bare
// apply on it was refused, and the lane charged 6 beats and drew 0.00 motion. Scoped to the HEADS the same
// call DID match - the doubled `Facing Couples Far` - with `mapping=[2,3,0,1]`, turning ~22 degrees in the
// first frame and walking the heads onto the SIDE positions: that fit is the wrong-dancer-and-rotation report.
//
// The rule now derives the turn from the ring itself (`circleFourDef` in coded-moves.ts): `Left N/4` is -N*90
// degrees and `Right N/4` +N*90, position AND heading, which is exactly what the corpus's own whole-board apply
// answers for its two groups of four.
//
// Usage: node engine/test/circle-four.mjs   (wants `npm run build --prefix engine`)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, findCodedMove, CIRCLE_FOUR_QUARTER_BEATS } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
const deg = (r) => (r * 180) / Math.PI;
const norm = (d) => { let x = ((d + 180) % 360 + 360) % 360 - 180; return x; };
const sig = (b) => b.dancers.map((d) => `${d.id}:${d.x.toFixed(4)},${d.y.toFixed(4)},${d.heading.toFixed(4)}`).join('|');

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const square = seq.boardForFormation('Static Square');
const SIDES = [3, 4, 7, 8];
const HEADS = [5, 6, 1, 2];
const show = (b, ids) => ids.map((id) => { const d = b.dancers.find((x) => x.id === id); return `#${id}(${d.x.toFixed(2)},${d.y.toFixed(2)},${deg(d.heading).toFixed(0)})`; }).join(' ');

console.log('== the family is derived, at the corpus\'s own timing ==');
for (const name of ['Circle Four Left 1/4', 'Circle Four Left 1/2', 'Circle Four Left 3/4', 'Circle Four Left Full',
  'Circle Four Right 1/4', 'Circle Four Right 1/2', 'Circle Four Right 3/4', 'Circle Four Right Full']) {
  const move = findCodedMove(name);
  // The corpus spells the halves `1/2`, so the arc is a lookup rather than a number in the title.
  const arc = { '1/4': 1, '1/2': 2, '3/4': 3, Full: 4 }[name.split(' ').pop()];
  const want = CIRCLE_FOUR_QUARTER_BEATS * arc;
  check(!!move, `${name} is a derived rule`);
  if (move) check(move.beats === want, `...charging ${want} beats (got ${move.beats})`);
}

console.log('\n== the reported slot: the sides\' 2x2 ring now turns instead of standing still ==');
{
  const step = { groups: [
    { selection: 'Heads', call: 'Promenade 3/4 to Home' },
    { selection: 'All Except Heads', calls: ['Step Forward', 'Circle Four Left 3/4'] },
  ] };
  const applied = seq.applyToBoard(square, step);
  check(applied.legal, 'the reported figure applies');
  const lane = applied.lanes.find((l) => l.selection !== 'Heads');
  const before = lane.boards[1];
  const after = lane.boards[2];
  check(sig(before) !== sig(after), 'and the Circle MOVES the sides (the apply is no longer a no-op)');
  // A 3/4 LEFT circle is -270 degrees, which on a four-point ring is the same place as +90: position AND
  // heading, which is what the corpus's own whole-board apply answers.
  let worstPos = 0, worstHead = 0;
  for (const id of SIDES) {
    const a = before.dancers.find((d) => d.id === id);
    const b = after.dancers.find((d) => d.id === id);
    // rotate the start about the ring centre by +90 and compare
    const want = { x: -a.y, y: a.x };
    worstPos = Math.max(worstPos, Math.hypot(b.x - want.x, b.y - want.y));
    worstHead = Math.max(worstHead, Math.abs(norm(deg(b.heading) - (deg(a.heading) + 90))));
  }
  check(worstPos < 1e-9, `each side lands where a 90-degree turn of the ring puts it (worst ${worstPos.toExponential(1)})`);
  check(worstHead < 1e-9, `and faces the same 90 degrees round (worst ${worstHead.toExponential(1)}deg)`);
  console.log(`    before: ${show(before, SIDES)}`);
  console.log(`    after : ${show(after, SIDES)}`);

  // THE ANIMATION IS AN ARC, NOT A CHORD. The ring's radius is sqrt(2), so a 270-degree journey reaches
  // 2r = 2.828 units from the start at its furthest; the straight chord to the end board is 2.0.
  const beats = seq.sequenceBeats([step], square);
  check(beats === 12, `the step costs 12 beats - the heads' promenade (got ${beats})`);
  let far = 0, startOfCall = null;
  for (let t = 2; t <= 8 + 1e-9; t += 0.1) {
    const b = seq.evaluateSequence([step], t, square).board;
    if (startOfCall === null) startOfCall = b;
    for (const id of SIDES) {
      const s = before.dancers.find((d) => d.id === id);
      const d = b.dancers.find((x) => x.id === id);
      far = Math.max(far, Math.hypot(d.x - s.x, d.y - s.y));
    }
  }
  check(far > 2.5, `the dancers go ROUND the ring (furthest ${far.toFixed(3)} units, against a 2.000 chord)`);
  const last = seq.evaluateSequence([step], beats, square).board;
  let drift = 0;
  for (const d of last.dancers) { const e = applied.board.dancers.find((x) => x.id === d.id); drift = Math.max(drift, Math.hypot(d.x - e.x, d.y - e.y)); }
  check(drift < 1e-9, `and the last frame IS the applied board (worst ${drift.toExponential(1)})`);
  // The heads' promenade is untouched by the rule.
  const headBefore = lane.boards[0];
  let headMoved = 0;
  for (const id of HEADS) {
    const s = headBefore.dancers.find((d) => d.id === id);
    const d = seq.evaluateSequence([step], 5, square).board.dancers.find((x) => x.id === id);
    headMoved = Math.max(headMoved, Math.hypot(d.x - s.x, d.y - s.y));
  }
  check(headMoved > 0.1, 'while the heads keep promenading (the rule only turns the acting four)');
}

console.log('\n== the corpus\'s own answer is reproduced, not replaced ==');
{
  // The whole board is EIGHT dancers, so the rule declines (a ring of eight is two circles of four) and the
  // catalogue's own two-group reading still applies. Its end poses are the authority for the turn direction.
  const r = seq.applyToBoard(square, 'Circle Four Left 3/4');
  check(r.legal, 'the whole board still applies `Circle Four Left 3/4`');
  check(!!r.parallel && r.parallel.groups.length === 2, `...as TWO groups of four (got ${r.parallel ? r.parallel.groups.length : 0})`);
  // The heads' group, by the catalogue, is a +90 turn of the heads' own ring - the same answer the rule gives.
  // The comparison is not exact: the tam's own authored end poses carry a ~0.01-unit and ~1-degree wobble
  // (MEASURED: #5 ends at 3.00,-0.99 heading -179), which is the corpus's rounding rather than a disagreement.
  let worstPos = 0, worstHead = 0;
  for (const id of HEADS) {
    const a = square.dancers.find((d) => d.id === id);
    const b = r.board.dancers.find((d) => d.id === id);
    const want = { x: -a.y, y: a.x };
    worstPos = Math.max(worstPos, Math.hypot(b.x - want.x, b.y - want.y));
    worstHead = Math.max(worstHead, Math.abs(norm(deg(b.heading) - (deg(a.heading) + 90))));
  }
  check(worstPos < 0.05 && worstHead < 2,
    `and its turn is the +90 the rule derives (worst ${worstPos.toFixed(3)} units, ${worstHead.toFixed(2)}deg)`);
}

console.log('\n== four dancers who are NOT on a ring are refused ==');
{
  // A straight line of four: no common centre, so the rule declines. The catalogue has no setup for it either,
  // so the scoped apply refuses rather than silently doing nothing.
  const line = { dancers: [
    { id: 1, x: -3, y: 0, heading: 0, gender: 'boy' },
    { id: 2, x: -1, y: 0, heading: 0, gender: 'girl' },
    { id: 3, x: 1, y: 0, heading: Math.PI, gender: 'boy' },
    { id: 4, x: 3, y: 0, heading: Math.PI, gender: 'girl' },
  ] };
  const r = seq.applyToBoard(line, 'Circle Four Left 3/4');
  check(!r.legal, `a line of four is refused (${r.reason ?? 'legal'})`);
  // AND THE RULE SAYS WHY. `catalogueFallback` lets the catalogue answer a board the rule declines (the
  // corpus's own `Lines` tams are a legal start for this call), so the rule's reason is asked for directly.
  const pre = findCodedMove('Circle Four Left 3/4').precondition(line);
  check(typeof pre === 'string' && /ring/i.test(pre), `...and the rule's own precondition says why: "${pre}"`);
}

console.log(failures === 0 ? '\ncircle-four: all green.' : `\ncircle-four: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
