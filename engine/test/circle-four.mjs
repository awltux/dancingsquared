// `Circle Four` IS A CATALOGUE CALL, declared by the tams in `ms/circle.xml`, pinned.
//
// HISTORY, because this family's geometry was once derived in the engine. `coded-moves.ts` used to carry
// `circleFourDef`: the acting four had to be ONE RING - a common centre, equal radii, distinct bearings - and
// the call turned that ring by `-N*90` (Left) or `+N*90` (Right), heading included. It was written for a real
// report ("the Circle Four Left 3/4 seems to assign the wrong dancer from the correct group to each path...
// they also seem to rotate 90 degrees at the start") in the slot
// `Heads Promenade 3/4 to Home || All Except Heads ( Step Forward + Circle Four Left 3/4 )`: `Step Forward`
// leaves the sides on a 2x2 RING of four that NONE of the authored tams matched, so the scoped apply was
// refused and the lane drew 0.00 motion. The owner removed the derivation at request and is authoring explicit
// catalogue tams for the eight titles instead. This file now pins what survives that removal.
//
// MEASURED after the removal, from this file:
//   - `findCodedMove` is UNDEFINED for all eight titles. That is the negative control against re-introducing
//     the derivation, and it is the check a revert turns red.
//   - the catalogue answers all eight from `Static Square`, `Normal Lines` and `Eight Chain Thru` (8/8 each) at
//     CALLERLAB's 2N beats from a squared set - the timing the derived rule also used, now read from the tams'
//     own parts. The GROUPING differs per board and is measured below rather than generalised.
//   - the reported 2x2-ring SLOT IS STILL NOT COVERED: the group step applies and still costs its 12 beats,
//     but the circle lane does not move. That is the gap the removed rule filled and it is REPORTED below
//     rather than asserted - a gate must not turn red when the owner's tams close it.
//
// Usage: node engine/test/circle-four.mjs   (wants `npm run build --prefix engine`)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, findCodedMove, isCallTitle } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
const deg = (r) => (r * 180) / Math.PI;
const norm = (d) => { let x = ((d + 180) % 360 + 360) % 360 - 180; return x; };

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const square = seq.boardForFormation('Static Square');
const HEADS = [5, 6, 1, 2];
// THE EIGHT TITLES THE CORPUS ACTUALLY CARRIES, with the turn each one is. The FULL turn is the BARE name —
// `Circle Four Left`, not `Circle Four Left Full`, which no tam has ever carried: this file listed the ` Full`
// spellings, so `getVariants` returned `undefined` for the fourth name, `.length` threw, and EVERY CHECK BELOW
// THE THROW WAS INVISIBLE (the §11.2.1 failure mode, in the harness that reports it). The list is a table
// rather than a `split(' ').pop()` lookup because the full turn has no suffix to split off.
const NAMES = [
  ['Circle Four Left 1/4', 1],
  ['Circle Four Left 1/2', 2],
  ['Circle Four Left 3/4', 3],
  ['Circle Four Left', 4],
  ['Circle Four Right 1/4', 1],
  ['Circle Four Right 1/2', 2],
  ['Circle Four Right 3/4', 3],
  ['Circle Four Right', 4],
];

console.log('== the family is catalogue, not derived ==');
for (const [name, arc] of NAMES) {
  // THE PREMISE FIRST, so a rename is a FAIL that names the title instead of a crash: `isCallTitle` is the
  // corpus's own vocabulary (`CALL_TITLE`), and `getVariants` is guarded because it answers `undefined` for a
  // name the library does not register - which is exactly how this file used to die.
  check(isCallTitle(name), `${name} is a title the corpus carries`);
  check(findCodedMove(name) === undefined, `${name} is NOT a coded move (the derivation is gone)`);
  const variants = seq.getVariants(name)?.length ?? 0;
  check(variants > 0, `...and the catalogue registers it (${variants} variant(s))`);
  const beats = seq.sequenceBeats([name], square);
  check(beats === 2 * arc, `...charging CALLERLAB's ${2 * arc} beats from a squared set (got ${beats})`);
}

console.log('\n== where a tam matches, the call still applies ==');
for (const boardName of ['Static Square', 'Normal Lines', 'Eight Chain Thru']) {
  const board = seq.boardForFormation(boardName);
  check(!!board, `the start board "${boardName}" is in the library`);
  if (!board) continue;
  const legal = NAMES.filter(([n]) => seq.applyToBoard(board, n).legal).length;
  check(legal === NAMES.length, `all ${NAMES.length} titles apply from ${boardName} (${legal} legal)`);
}
// THE GROUPING IS MEASURED PER BOARD RATHER THAN GENERALISED. From a squared set the corpus's whole-board
// reading is TWO groups of four, for every title - the reading the removed rule was derived to match. On the
// 4-path authorings it is not: the partial turns match the whole board (`parallel` is absent), `Normal Lines`
// tiles the FULL turns as 4+4, and `Eight Chain Thru` applies a FULL turn to the whole board as ONE group of
// four. Assuming the squared-set shape everywhere would read those as failures of a rule nobody stated.
{
  const grouped = NAMES.filter(([n]) => {
    const r = seq.applyToBoard(square, n);
    return r.legal && r.parallel && r.parallel.groups.length === 2;
  }).length;
  check(grouped === NAMES.length, `from a squared set every title tiles as two groups of four (${grouped} of ${NAMES.length})`);
  const ln = seq.boardForFormation('Normal Lines');
  // THE FULL TURN IS THE BARE TITLE, which is the spelling this harness used to get wrong: `Circle Four Left
  // Full` is not a tam, so this lookup used to `undefined`-crash three lines into the section.
  const lnFull = seq.applyToBoard(ln, 'Circle Four Left');
  check(!!lnFull.parallel && lnFull.parallel.groups.map((g) => g.length).join('+') === '4+4',
    `and \`Normal Lines\` tiles the full turn as ${lnFull.parallel ? lnFull.parallel.groups.map((g) => g.length).join('+') : 'no groups'}`);
}

// THE CORPUS'S OWN ANSWER, and the authority the removed rule was derived to match: a `Left N/4` tam turns the
// group a quarter counter-clockwise per quarter, in BOTH position and heading, so `Left 3/4` ends a +90 turn of
// the heads' own ring - the same thing on a four-point ring. The comparison is not exact: the tam's authored end
// poses carry a ~0.01-unit and ~1-degree wobble (MEASURED: #5 ends at 3.00,-0.99 heading -179), which is the
// corpus's rounding rather than a disagreement.
{
  const r = seq.applyToBoard(square, 'Circle Four Left 3/4');
  check(r.legal, 'the whole squared set applies `Circle Four Left 3/4`');
  let worstPos = 0, worstHead = 0;
  for (const id of HEADS) {
    const a = square.dancers.find((d) => d.id === id);
    const b = r.board.dancers.find((d) => d.id === id);
    const want = { x: -a.y, y: a.x };
    worstPos = Math.max(worstPos, Math.hypot(b.x - want.x, b.y - want.y));
    worstHead = Math.max(worstHead, Math.abs(norm(deg(b.heading) - (deg(a.heading) + 90))));
  }
  check(worstPos < 0.05 && worstHead < 2,
    `and the authored tam turns the heads a +90 quarter, position and heading (worst ${worstPos.toFixed(3)} units, ${worstHead.toFixed(2)}deg)`);
}

console.log('\n== the reported 2x2-ring slot: the gap the removed rule filled, REPORTED ==');
// NOT asserted, on purpose. The slot applies and still costs its beats, so the step does not silently break -
// but the sides' circle lane does not move, because no tam matches the ring `Step Forward` leaves them on, and
// that is the owner's to close in the corpus. Asserting the standstill would make the gate turn red when the
// tams land; asserting the motion would make it red today.
{
  const step = { groups: [
    { selection: 'Heads', call: 'Promenade 3/4 to Home' },
    { selection: 'All Except Heads', calls: ['Step Forward', 'Circle Four Left 3/4'] },
  ] };
  const applied = seq.applyToBoard(square, step);
  check(applied.legal, 'the reported figure still applies (the catalogue does not refuse the step)');
  const beats = seq.sequenceBeats([step], square);
  check(beats === 12, `and still costs 12 beats - the heads' promenade (got ${beats})`);
  // GUARDED, because a REFUSED step has no lanes and this line used to throw on that - the second crash this
  // file had, and the reason its own failures could never be listed. It is REPORTED either way: the NOTE says
  // what the lane does when there is one, and why there is none when there is not.
  const lane = applied.lanes?.find((l) => l.selection !== 'Heads');
  if (!lane) {
    console.log(`  NOTE  nothing to inspect: the step reported no lane${applied.legal ? '' : `, because it was refused — ${applied.reason}`}`);
  } else {
    const before = lane.boards[1];
    const after = lane.boards[2];
    const moved = lane.boards[1].dancers.some((d) => {
      const e = after.dancers.find((x) => x.id === d.id);
      return Math.hypot(e.x - d.x, e.y - d.y) > 1e-6 || Math.abs(e.heading - d.heading) > 1e-6;
    });
    console.log(`  NOTE  the sides' circle lane ${moved ? 'MOVES - the gap is closed' : 'does NOT move - no tam matches the ring Step Forward leaves, and the owner is authoring tams for these calls'}`);
  }
}

console.log('\n== a board no tam matches is refused, not silently accepted ==');
{
  // A straight line of four: the corpus has no setup for it, so the apply refuses rather than doing nothing.
  const line = { dancers: [
    { id: 1, x: -3, y: 0, heading: 0, gender: 'boy' },
    { id: 2, x: -1, y: 0, heading: 0, gender: 'girl' },
    { id: 3, x: 1, y: 0, heading: Math.PI, gender: 'boy' },
    { id: 4, x: 3, y: 0, heading: Math.PI, gender: 'girl' },
  ] };
  const r = seq.applyToBoard(line, 'Circle Four Left 3/4');
  check(!r.legal, `a line of four is refused (${r.reason ?? 'legal'})`);
}

console.log(failures === 0 ? '\ncircle-four: all green.' : `\ncircle-four: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
