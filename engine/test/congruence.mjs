// THE ENGINE'S CONGRUENCE TEST: how far apart two boards are as ARRANGEMENTS, and the number that separates
// "the same arrangement, reached twice" from "two arrangements".
//
// WHY IT EXISTS. `geometryKey` is a BUCKET — positions and headings rounded to `CELL_ROUND` — so two boards the engine's
// own matcher would call congruent can key apart when the drift straddles a cell boundary. REPORTED from the game:
// "The game offered 'Circle Right 1/2 Home' from 'Circle' to 'Square Set' and reports '… does not leave the set on the
// goal board.' but to me it looks as if it does end on 'squared set'." MEASURED then, over the 108 baked drills: 10
// distractors were the goal's formation within 0.06 units and 0.06 rad of this metric — the reported one at 0.0364
// units and 0.0195 rad — while `reachedGoal`'s key equality called them different boards.
//
// SO THE ENGINE NOW EXPORTS A MEASUREMENT (`congruenceOf`) AND A PREDICATE (`congruentWithin`), and this harness pins
// both, plus the number a caller's tolerance has to stay under: THE MINIMUM DISTANCE BETWEEN TWO DISTINCT
// ARRANGEMENTS IN THE CORPUS. A tolerance wider than half of that would call two formations one.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { Sequencer, setParser, congruenceOf, congruentWithin, geometryKey, boardMatchables } from '../dist/index.js';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const assets = corpusRoot();

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
);
const square = seq.boardForFormation('Static Square');

/** The set turned about its own centroid, headings included — a turned set is a set whose dancers have turned. */
function turned(board, rad) {
  const cx = board.dancers.reduce((s, d) => s + d.x, 0) / board.dancers.length;
  const cy = board.dancers.reduce((s, d) => s + d.y, 0) / board.dancers.length;
  const norm = (a) => { let x = a % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; if (x <= -Math.PI) x += 2 * Math.PI; return x; };
  return {
    dancers: board.dancers.map((d) => {
      const x = d.x - cx;
      const y = d.y - cy;
      return { ...d, x: Math.cos(rad) * x - Math.sin(rad) * y, y: Math.sin(rad) * x + Math.cos(rad) * y, heading: norm(d.heading + rad) };
    }),
  };
}

console.log('== 1. the same arrangement is 0 apart, under every symmetry ==');
{
  check(congruenceOf(square, square) <= 1e-9, `a board against itself is 0 (${congruenceOf(square, square)})`);
  check(congruentWithin(square, square, 0), 'and `congruentWithin` accepts it at zero tolerance');
  // THE GROUP IS THE ONE `geometryKey` FOLDS: eight rotations x reflection. A TRUE reflection mirrors positions AND
  // headings (`heading -> PI - heading` about the y-axis); mirroring positions alone is a board whose dancers face away
  // from the ring, which is a different arrangement and is the control section 2 uses.
  const reflected = {
    dancers: square.dancers.map((d) => {
      const h = Math.PI - d.heading;
      const norm = (a) => { let x = a % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; if (x <= -Math.PI) x += 2 * Math.PI; return x; };
      return { ...d, x: -d.x, heading: norm(h) };
    }),
  };
  check(congruenceOf(square, reflected) <= 1e-9, `a reflected board is 0 apart (${congruenceOf(square, reflected).toExponential(2)})`);
  check(geometryKey(boardMatchables(square)) === geometryKey(boardMatchables(reflected)), '  which the key also folds, so the two agree about the group');
  for (const deg of [90, 180, 270]) {
    const r = (deg * Math.PI) / 180;
    check(congruenceOf(square, turned(square, r)) <= 1e-9, `  turned ${deg} deg: 0 apart (${congruenceOf(square, turned(square, r)).toExponential(2)})`);
  }
  // SYMMETRY OF THE PREDICATE ITSELF, because `matchFormations`' greedy assignment is not symmetric (see the note in
  // `congruenceOf`): the same two boards must answer the same way whichever is named first.
  const odd = { dancers: square.dancers.map((d) => ({ ...d, x: -d.x })) };
  check(congruenceOf(odd, square) === congruenceOf(square, odd), `the answer does not depend on the argument order (${congruenceOf(odd, square)} / ${congruenceOf(square, odd)})`);
}

console.log('\n== 2. a sub-tolerance drift is the same arrangement, a real displacement is not ==');
{
  // THE REPORTED SHAPE: ONE dancer drifting a couple of hundredths, which is what two call paths landing on the same
  // formation produce. Nudging every dancer equally is a translation and cancels under the centring, so it would prove
  // nothing — the drift has to be one dancer's to be drift.
  const drifted = { dancers: square.dancers.map((d, i) => (i === 0 ? { ...d, x: d.x + 0.03, y: d.y - 0.02 } : d)) };
  const drift = congruenceOf(square, drifted);
  check(congruentWithin(square, drifted, 0.1), `one dancer 0.036 off is congruent at 0.1 (${drift.toFixed(4)})`);
  const far = { dancers: square.dancers.map((d, i) => (i === 0 ? { ...d, x: d.x + 0.3 } : d)) };
  check(!congruentWithin(square, far, 0.1), `one dancer 0.3 off is not (${congruenceOf(square, far).toFixed(4)})`);
  // A FACING FLIP IS NOT DRIFT: the same spots with every dancer turned round is the case that keeps the comparison
  // from being positions-only (`Static Facing Out` against `Static Square`).
  const flipped = { dancers: square.dancers.map((d) => ({ ...d, heading: d.heading + Math.PI })) };
  const flip = congruenceOf(square, flipped);
  check(flip >= 1.5, `a facing flip is 0.5 per radian, well past any drift tolerance (${flip.toFixed(3)})`);
  check(!congruentWithin(square, flipped, 0.1), 'and is refused at 0.1');
  // AN UNEQUAL COUNT IS NEVER "THE SAME ARRANGEMENT", however well it tiles inside it.
  const four = { dancers: square.dancers.slice(0, 4) };
  check(congruenceOf(square, four) === Infinity, 'four dancers inside an eight-dancer set are Infinity apart, not a subset match');
}

console.log('\n== 3. THE SEPARATION: the closest two DISTINCT arrangements in the corpus ==');
{
  // THE NUMBER A TOLERANCE MUST STAY UNDER, and the reason this is a gate rather than a comment: a tolerance wider
  // than half of it would call two formations one, which is the failure the other side of the reported defect.
  const keys = new Map();
  for (const name of seq.listFormations()) {
    const board = seq.boardForFormation(name);
    if (!board) continue;
    const key = geometryKey(boardMatchables(board));
    if (!keys.has(key)) keys.set(key, board);
  }
  const boards = [...keys.values()];
  let min = Infinity;
  let witness = null;
  for (let i = 0; i < boards.length; i++) {
    for (let j = i + 1; j < boards.length; j++) {
      const d = congruenceOf(boards[i], boards[j]);
      if (d < min) { min = d; witness = [i, j]; }
    }
  }
  console.log(`  ${boards.length} distinct arrangements over ${seq.listFormations().length} named formations`);
  console.log(`  closest distinct pair: ${min.toFixed(4)} apart`);
  check(min > 0.2, `two distinct arrangements are at least ${min.toFixed(3)} apart, so the game's 0.1 tolerance is under half of it`);
  check(witness !== null, 'and a witness pair exists, so the sweep measured something');
  // THE CONTROL THAT MAKES IT A TOLERANCE TEST AND NOT A KEY: the two boards that ARE the goal's arrangement but keyed
  // apart are still found by this comparison. The drifted board is exactly that shape — one dancer 0.036 off.
  const bucketApart = geometryKey(boardMatchables(square)) !== geometryKey(boardMatchables({ dancers: square.dancers.map((d, i) => (i === 0 ? { ...d, x: d.x + 0.03, y: d.y - 0.02 } : d)) }));
  console.log(`  and the bucket separates the drifted board: ${bucketApart} (expected true — a key is not a tolerance)`);
  check(bucketApart, 'the bucket and the tolerance disagree on the drifted board, which is why both exist');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
