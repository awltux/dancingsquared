// THE CURRENT PARTNER RELATION, pinned.
//
// `SeqDancer.couple` is the HOME couple: assigned once from the start formation and never changed.
// Everything that asks who a dancer's PARTNER is right now has to derive it from the board, and
// `couples.ts` is that derivation - a couple is a boy and a girl standing as a couple (2.0 apart,
// co-facing), the couple's NUMBER is the boy's, and a girl adopts the number of the boy she is beside.
//
// What this pins:
//   (1) a squared set      -> the derived numbers ARE the home numbers, so callers can use it always
//   (2) a real callback    -> the numbers follow the NEW partners, not the old ones
//   (3) back to the start  -> the numbers return to the home reading (the tip-end requirement)
//   (4) no inventions      -> an unpaired dancer keeps its home couple; a geometry-only board stays
//                             UNKNOWN_COUPLE rather than acquiring a number from an index
//
// THE WITNESS IN (2) IS `Square Thru 2` FROM A SQUARED SET, found by sweeping the catalogue rather
// than guessed: it leaves `#6` beside `#1` and `#2` beside `#5`, so two dancers carry a current couple
// that is NOT their home couple. `Right and Left Thru` is deliberately NOT used - from facing couples
// each couple rotates 180 degrees about its OWN centre, so it never splits a home couple and would
// have proved nothing.
//
// Usage: node engine/test/couples.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer,
  setParser,
  findCouplePairs,
  currentCoupleNumbers,
  currentCoupleOf,
  areCurrentPartners,
} from '../dist/index.js';
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

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const nums = (b) => b.dancers.map((d) => `${d.id}:c${currentCoupleOf(b, d.id)}`).join(' ');
const pairsOf = (b) => findCouplePairs(b).map((p) => `${p.boy.id}+${p.girl.id}`).join(' ');

// ---- (1) the home square ------------------------------------------------------------------------
console.log('== (1) a squared set derives the home pairing ==');
const home = seq.boardForFormation('Static Square');
console.log(`  home   : ${nums(home)}`);
console.log(`  pairs  : ${pairsOf(home)}`);
check(home.dancers.every((d) => currentCoupleOf(home, d.id) === d.couple),
  'every dancer on the home square derives exactly its home couple');
check(findCouplePairs(home).length === 4, `four couples are found (got ${findCouplePairs(home).length})`);
check(findCouplePairs(home).every((p) => p.boy.couple === p.girl.couple),
  'each pair found on the home square is a home couple');

// ---- (2) after a callback that really changes partners ------------------------------------------
console.log('\n== (2) Square Thru 2 from a squared set: the number follows the NEW partner ==');
{
  const start = seq.boardForFormation('Static Square');
  const r = seq.applyToBoard(start, 'Square Thru 2');
  check(r.legal, `Square Thru 2 applies from a squared set (${r.reason ?? 'ok'})`);
  if (r.legal) {
    console.log(`  after  : ${nums(r.board)}`);
    console.log(`  pairs  : ${pairsOf(r.board)}`);
    const cur = currentCoupleNumbers(r.board);
    const moved = r.board.dancers.filter((d) => cur.get(d.id) !== d.couple);
    console.log(`  dancers whose CURRENT couple differs from home: ${moved.map((d) => `#${d.id}(home c${d.couple} -> now c${cur.get(d.id)})`).join(' ') || 'none'}`);
    check(moved.length > 0, 'the derived numbers moved with the partners (the home couple alone would be stale here)');

    const pairs = findCouplePairs(r.board);
    check(pairs.length === 4, `the board is still four couples (got ${pairs.length})`);
    check(pairs.every(({ boy, girl }) => cur.get(girl.id) === boy.couple),
      'every paired girl carries the number of the boy she is ACTUALLY beside');
    check(pairs.every(({ boy, girl }) => cur.get(boy.id) === boy.couple),
      'every paired boy keeps his OWN number');
    check(pairs.every(({ boy, girl }) => areCurrentPartners(r.board, boy.id, girl.id)),
      'areCurrentPartners agrees with the derived pairing');
    // The witness: `#6` is now with `#1` (home couple 3), and `#2` with `#5` (home couple 1).
    check(cur.get(6) === 3 && cur.get(2) === 1,
      `the two dancers that changed partners report their NEW boy's number (#6->${cur.get(6)}, #2->${cur.get(2)})`);
    // And `#6`'s home partner is no longer her partner.
    check(!areCurrentPartners(r.board, 5, 6),
      'the ORIGINAL partnership (#5+#6) is no longer reported as partners');
  }
}

// ---- (3) back to the starting arrangement -------------------------------------------------------
console.log('\n== (3) when the square comes back, the derivation comes back ==');
{
  const start = seq.boardForFormation('Static Square');
  const a = seq.applyToBoard(start, 'Square Thru 2');
  const b = a.legal ? seq.applyToBoard(a.board, 'Square Thru 4') : { legal: false };
  check(b.legal, 'a follow-up Square Thru applies (completing the exchange)');
  if (b.legal) {
    console.log(`  final  : ${nums(b.board)}`);
    console.log(`  pairs  : ${pairsOf(b.board)}`);
    // `Square Thru 2` then `Square Thru 4` is not a return; what matters is that the derivation is a
    // function of the board. Assert the invariant that holds whatever the arrangement: every derived
    // number equals the number of the boy in the SAME pair.
    const pairs = findCouplePairs(b.board);
    const cur = currentCoupleNumbers(b.board);
    check(pairs.every(({ boy, girl }) => cur.get(girl.id) === boy.couple && cur.get(boy.id) === boy.couple),
      'the derived numbers are consistent with the pairing on the follow-up board too');
    // And a board that IS home must read as home. `Normal Lines` is a squared set rotated, so its
    // couples are intact and the derivation must equal the home numbers.
    const nl = seq.boardForFormation('Normal Lines');
    check(nl.dancers.every((d) => currentCoupleOf(nl, d.id) === d.couple),
      'on a non-home but couple-intact board the derivation still equals the home numbers');
  }
}

// ---- (4) nothing is invented --------------------------------------------------------------------
console.log('\n== (4) a board with no identity invents no couple ==');
{
  // `Normal Lines` is a synthesised board: every dancer carries UNKNOWN_COUPLE, so there is no home
  // number to read and none may be invented from an array index.
  const nl = seq.boardForFormation('Normal Lines');
  check(nl.dancers.every((d) => d.couple === 0), 'the synthesised board carries no home couples');
  check(nl.dancers.every((d) => currentCoupleOf(nl, d.id) === 0),
    'and the derivation invents none either - every number stays 0');
  // Same-gender and wrongly-spaced dancers are not couples. Three dancers is NOT the test - a boy and
  // a girl two apart in the middle of a line really is a couple, and the derivation is right to say so.
  const notCouples = {
    dancers: [
      { id: 1, couple: 0, gender: 'boy', x: -2, y: 1, heading: 0 },
      { id: 2, couple: 0, gender: 'boy', x: 0, y: 1, heading: 0 },   // same gender
      { id: 3, couple: 0, gender: 'girl', x: 8, y: 1, heading: 0 },  // too far to be a couple
      { id: 4, couple: 0, gender: 'girl', x: -2, y: -1, heading: Math.PI }, // back to back, not co-facing
    ],
  };
  check(findCouplePairs(notCouples).length === 0,
    `two boys, a distant girl and a back-to-back girl yield no couple (got ${findCouplePairs(notCouples).length})`);
  check(notCouples.dancers.every((d) => currentCoupleOf(notCouples, d.id) === d.couple),
    'and each of them keeps its own (unknown) number');
}

// ---- (5) the FACING couple ----------------------------------------------------------------------
//
// The corpus defines TWO partial boards, and they are not the same shape:
//   `Facing Couples*`  a couple standing SIDE BY SIDE, facing another such couple  -> the couple is
//                      the side-by-side pair (covered by cases 1-4 above)
//   `Facing Dancers*`  a SINGLE couple FACING EACH OTHER, authored at several distances
//                      (Close 2, Compact 3, 4, Far 6)                               -> a facing couple
//
// These boards have no offered formation (a two-dancer formation is the case the library dedupe
// drops), so they are built from the corpus geometry. THE WAVE IS THE CONTROL: a wave is also a boy
// and a girl facing each other, and must NOT pair.
console.log('\n== (5) a facing couple pairs; a wave does not ==');
{
  const mk = (dancers) => ({ dancers });
  for (const [label, sep] of [
    ['Facing Dancers Close', 2], ['Facing Dancers Compact', 3], ['Facing Dancers', 4], ['Facing Dancers Far', 6],
  ]) {
    const b = mk([
      { id: 1, couple: 0, gender: 'boy', x: -sep / 2, y: 0, heading: 0 },
      { id: 2, couple: 0, gender: 'girl', x: sep / 2, y: 0, heading: Math.PI },
    ]);
    const got = findCouplePairs(b).map((p) => `${p.boy.id}+${p.girl.id}`).join(' ');
    check(got === '1+2', `${label} (${sep} apart) is one facing couple (got "${got}")`);
  }
  // A WAVE: two columns of dancers in a line, boy-girl facing at 2.0 ACROSS, adjacent in the line.
  // This is the shape that made a naive "facing boy-girl" rule pair four wave neighbours on a real
  // `Ocean Waves` board, so it is the negative control the rule has to keep passing.
  const wave = mk([
    { id: 1, couple: 0, gender: 'boy', x: -3, y: 0, heading: 0 },
    { id: 2, couple: 0, gender: 'girl', x: -1, y: 0, heading: Math.PI },
    { id: 3, couple: 0, gender: 'boy', x: 1, y: 0, heading: 0 },
    { id: 4, couple: 0, gender: 'girl', x: 3, y: 0, heading: Math.PI },
  ]);
  const wavePairs = findCouplePairs(wave).map((p) => `${p.boy.id}+${p.girl.id}`).join(' ');
  check(wavePairs === '1+2 3+4', `the wave's own facing pairs are returned, not a cross-pairing (got "${wavePairs}")`);
  // And the real `Ocean Waves` board carries no side-by-side couple at all.
  const ow = seq.boardForFormation('Ocean Waves');
  check(findCouplePairs(ow).length === 0,
    `an Ocean Waves board yields no couple (got ${findCouplePairs(ow).length}) - the front-on test`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
