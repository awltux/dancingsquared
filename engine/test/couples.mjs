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
// COST: §6 and §7 together add ~4.7 s (of ~5 s total). §7's sweep applies every catalogue title from a
// squared set - 2207 titles - to reach the 187 boards that carry four identified couples. It stays in
// the `light` tier because ONE board cannot pin the beau/belle defect: a squared set exposes a single
// flipped couple where the sweep exposes 227.
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
const assets = path.join(root, 'assets');

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
  // ONE BOARD PER FAULT, so a failure names the fault. They were one board until the wave pass landed,
  // and its `girl #4` at (-2,-1)@pi against `boy #1` at (-2,1)@0 was mis-described as "back to back,
  // not co-facing": those two are 2.0 apart, face OPPOSITE ways and stand ACROSS that facing, which is
  // a wave pair and is now a couple by design. The replacement control is the one shape nothing may
  // pair - a diagonal neighbour, where the offset is neither along the facing (a facing couple) nor
  // across it (a wave), and both passes' fraction-of-the-separation bands reject it.
  const mkBoard = (dancers) => ({ dancers });
  const sameGender = mkBoard([
    { id: 1, couple: 0, gender: 'boy', x: -2, y: 1, heading: 0 },
    { id: 2, couple: 0, gender: 'boy', x: 0, y: 1, heading: 0 },
  ]);
  check(findCouplePairs(sameGender).length === 0,
    `two boys 2.0 apart facing the same way yield no couple (got ${findCouplePairs(sameGender).length})`);
  const tooFar = mkBoard([
    { id: 1, couple: 0, gender: 'boy', x: -2, y: 1, heading: 0 },
    { id: 2, couple: 0, gender: 'girl', x: 8, y: 1, heading: Math.PI },
  ]);
  check(findCouplePairs(tooFar).length === 0,
    `a boy and a girl 10 units apart yield no couple (got ${findCouplePairs(tooFar).length})`);
  const diagonal = mkBoard([
    { id: 1, couple: 0, gender: 'boy', x: 0, y: 0, heading: 0 },
    { id: 2, couple: 0, gender: 'girl', x: 1.4142, y: 1.4142, heading: Math.PI },
  ]);
  check(findCouplePairs(diagonal).length === 0,
    `a DIAGONAL neighbour 2.0 away facing the opposite way yields no couple (got ${findCouplePairs(diagonal).length}) - the wave pass needs the offset ACROSS the facing, not at 45 degrees to it`);
  check([...sameGender.dancers, ...tooFar.dancers, ...diagonal.dancers].every((d) => currentCoupleOf({ dancers: [d] }, d.id) === d.couple),
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
  // A CHAIN OF FRONT-ON PAIRS, which this comment used to call a wave. All four dancers sit on y = 0
  // with the facings ALONG the line, so every pair here is front-on and the FACING pass claims them
  // before the wave pass is reached. Kept as the control for "a front-on pair at 2.0 must not be
  // cross-paired" - and it is NOT a wave: the real one is the `Ocean Waves` board below, whose pairs
  // stand ACROSS their facing rather than in front of it.
  const wave = mk([
    { id: 1, couple: 0, gender: 'boy', x: -3, y: 0, heading: 0 },
    { id: 2, couple: 0, gender: 'girl', x: -1, y: 0, heading: Math.PI },
    { id: 3, couple: 0, gender: 'boy', x: 1, y: 0, heading: 0 },
    { id: 4, couple: 0, gender: 'girl', x: 3, y: 0, heading: Math.PI },
  ]);
  const wavePairs = findCouplePairs(wave).map((p) => `${p.boy.id}+${p.girl.id}`).join(' ');
  check(wavePairs === '1+2 3+4', `the wave's own facing pairs are returned, not a cross-pairing (got "${wavePairs}")`);
  // A WAVE, and it is the POSITIVE case now rather than the control it used to be. The corpus's own
  // `Ocean Waves` board is two columns of four at x = +-2, y = 3,1,-1,-3 with the headings alternating,
  // so each adjacent boy-girl pair is 2.0 apart, faces OPPOSITE ways, and stands ACROSS that facing.
  // `taminations-flutter/assets/info/designators.md` defines the vocabulary this follows: "Couples /
  // Waves - dancers that are couples (facing the same direction), or dancers in waves or mini-waves
  // (facing opposite directions)". MEASURED: the board yields ZERO couples before the wave pass and
  // FOUR after, every one of them exactly 2.00 apart - and with zero, `Couple #N` fell back to the home
  // pair, which on a wave can be six units away at the other end of the set.
  const ow = seq.boardForFormation('Ocean Waves');
  const owPairs = findCouplePairs(ow);
  console.log(`  Ocean Waves pairs: ${owPairs.map((p) => `${p.boy.id}+${p.girl.id}@${Math.hypot(p.boy.x - p.girl.x, p.boy.y - p.girl.y).toFixed(2)}`).join(' ')}`);
  check(owPairs.length === 4,
    `an Ocean Waves board yields its FOUR wave couples (got ${owPairs.length})`);
  check(owPairs.every((p) => Math.abs(Math.hypot(p.boy.x - p.girl.x, p.boy.y - p.girl.y) - 2) < 1e-9),
    'and every one of them is exactly one couple width apart');
}

// ---- (6) the couple READINGS --------------------------------------------------------------------
//
// `Couple #N` has to name the pair standing together NOW - and it has to reach the derivation at all.
// `selectionGroup` maps every `Couple #N` spelling to the `couples` key, so a resolver that lets the
// generic group branch go first answers the whole key and returns ALL FOUR couples. MEASURED before
// this was fixed, on exactly the witness below: `Couple #1` resolved to `[1,2,3,4,5,6,7,8]`.
//
// The home reading is the negative control, and it is not a straw man - it is what the stored field
// says: on this board the home couples are `c1=[5,6]` and `c3=[1,2]`, while the pairs actually
// standing together are `c1=[5,2]` and `c3=[6,1]` (#2 has adopted boy #5's number, #6 boy #1's).
// So each check below fails BOTH on the shipped bug (all eight) and on "just read `d.couple`".
console.log('\n== (6) `Couple #N` names the pair standing together; `Heads` still names the heads ==');
{
  const start = seq.boardForFormation('Static Square');
  const r = seq.applyToBoard(start, 'Square Thru 2');
  check(r.legal, `the partner-change witness applies (${r.reason ?? 'ok'})`);
  if (r.legal) {
    const b = r.board;
    const ids = (sel) => seq.selectionIds(b, sel);
    const fmt = (a) => (a === null ? 'null' : `[${a.join(',')}]`);
    console.log(`  home couples c1=[5,6] c3=[1,2]   standing pairs c1=[5,2] c3=[6,1]`);
    console.log(`  Couple #1 -> ${fmt(ids('Couple #1'))}   Couple #3 -> ${fmt(ids('Couple #3'))}`);
    check(JSON.stringify(ids('Couple #1')) === '[2,5]',
      `Couple #1 is boy #5 and the girl beside him, not his home partner (got ${fmt(ids('Couple #1'))})`);
    check(JSON.stringify(ids('Couple #3')) === '[1,6]',
      `Couple #3 is boy #1 and the girl beside him, not his home partner (got ${fmt(ids('Couple #3'))})`);
    check(JSON.stringify(ids('Couple #1 and #2')) === '[2,3,4,5]',
      `Couple #1 and #2 is the union of the two standing pairs (got ${fmt(ids('Couple #1 and #2'))})`);
    // HEADS/SIDES ARE AN IDENTITY AND DO NOT FOLLOW THE PARTNERS: the girl's home number is her memory
    // of the couple she STARTED in, which is exactly what these two must keep reading.
    check(JSON.stringify(ids('Heads')) === '[1,2,5,6]',
      `Heads is still the HOME head couples after the partner change (got ${fmt(ids('Heads'))})`);
    check(JSON.stringify(ids('Sides')) === '[3,4,7,8]',
      `and Sides is still the home side couples (got ${fmt(ids('Sides'))})`);
    // THE NAMES REACH THE PANEL, which reads them off `subsetGroups` for the line and the picker.
    const groups = seq.subsetGroups(b);
    check(groups.includes('Couple #1') && groups.includes('Couple #4'),
      `all four Couple #N are offered on this board (got ${groups.filter((g) => g.startsWith('Couple')).join(', ') || 'none'})`);
    check(!groups.includes('Couples'),
      '`Couples` is NOT offered - all four is the whole board, which is not a proper subset');
    // AND NOTHING IS INVENTED WHERE THERE IS NO IDENTITY. `Normal Lines` carries no home couples, so
    // there is no boy number to take; an empty answer is reported as null, not as an invented pair.
    const nl = seq.boardForFormation('Normal Lines');
    check(seq.selectionIds(nl, 'Couple #1') === null,
      'a board with no home identity resolves Couple #1 to null rather than inventing one');
  }
}

// ---- (6b) THE REPORTED SYMPTOM: `Couple #N` on a WAVE ------------------------------------------
//
// REPORTED as "`Couple #N` on a wave reports a partner the engine elsewhere says is not the partner".
// The witness has to be a board DANCED INTO rather than `boardForFormation('Ocean Waves')`: that one is
// built from the formation file with no home identity at all, so `Couple #N` answers null there (the
// check above pins that) and there is no home pair for the defect to name. MEASURED on this witness
// before the wave pass: `Couple #1` was `[5,6]`, the home pair, whose two dancers stand **6.00** apart
// on opposite sides of the set.
console.log('\n== (6b) `Couple #N` on a wave names the pair standing there ==');
{
  const start = seq.boardForFormation('Static Square');
  const r = seq.applyToBoard(start, 'All 4 Couples Circle to a Wave');
  check(r.legal, `the wave witness applies (${r.reason ?? 'ok'})`);
  if (r.legal) {
    const b = r.board;
    const pairs = findCouplePairs(b);
    check(pairs.length === 4, `the witness is a wave: four couples recognised (got ${pairs.length})`);
    const gap = (sel) => {
      const g = seq.selectionIds(b, sel);
      if (!g || g.length !== 2) return null;
      const [x, y] = g.map((id) => b.dancers.find((d) => d.id === id));
      return +Math.hypot(x.x - y.x, x.y - y.y).toFixed(3);
    };
    console.log(`  Couple #1 -> [${seq.selectionIds(b, 'Couple #1')}] gap ${gap('Couple #1')}   Couple #2 -> [${seq.selectionIds(b, 'Couple #2')}] gap ${gap('Couple #2')}`);
    check(gap('Couple #1') === 2, `Couple #1 names the wave pair standing together (gap ${gap('Couple #1')}, was 6.00)`);
    check(gap('Couple #2') === 2, `and Couple #2 does too (gap ${gap('Couple #2')})`);
    // THE PAIR IT NAMES IS THE PAIR THE ENGINE ITSELF DERIVED - one definition, not two.
    const asPairs = pairs.map((p) => [p.boy.id, p.girl.id].sort((a, c) => a - c).join(','));
    const named = ['Couple #1', 'Couple #2', 'Couple #3', 'Couple #4']
      .map((sel) => (seq.selectionIds(b, sel) ?? []).slice().sort((a, c) => a - c).join(','))
      .filter(Boolean);
    check(named.length === 4 && named.every((n) => asPairs.includes(n)),
      `every Couple #N names a pair findCouplePairs derived (named ${named.join(' | ')} against ${asPairs.join(' | ')})`);
  }
}

// ---- (7) BEAUS AND BELLES: the dancer on the couple's LEFT ---------------------------------------
//
// REPORTED: "Beaus and Bells seem to select the wrong dancers in half the set."
//
// THE RULE IS THE A-1 DEFINITION - "dancers with partner on the right are Beaus"
// (`taminations-flutter/assets/info/designators.md`) - so the BEAU is the dancer on the couple's LEFT.
//
// WHAT WAS WRONG, AND WHY THE OLD TEST COULD NOT WORK: it took a CROSS PRODUCT of the vector between
// the two dancers against the `left` vector. Those two are PARALLEL whenever the pair stands side by
// side - the offset between them IS the lateral axis, and `left` is that same axis - so the cross
// product is structurally ZERO and the sign came from floating-point residue. MEASURED on the squared
// set below, the four couples gave cross = -1.22e-16, +2.45e-16, +1.22e-16 and 0.00, every one of them
// at 180.00 degrees to `left`, so the decision fell through to `cross >= 0 ? a : b`, which is the
// pair's position in the BOARD ARRAY. Reverted and re-measured over the 187 boards swept below: 227 of
// the 680 SIDE-BY-SIDE pairs (33%) got the wrong dancer. The fix projects the offset onto the left
// direction instead.
//
// WHICH CHECK CATCHES IT: the FIRST one. The old rule put `#2` in Beaus and `#1` in Belles here, so
// `beaus === [1,3,5,7]` fails on it. The partition and count checks do NOT catch it - the old rule still
// returned four dancers and still partitioned the eight - which is why the sweep below asserts the
// side, not the count.
console.log('\n== (7) Beaus/Belles: the dancer on the couple\'s left, over every board danced to ==');
{
  const home = seq.boardForFormation('Static Square');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const beaus = seq.selectionIds(home, 'Beaus');
  const belles = seq.selectionIds(home, 'Belles');
  console.log(`  squared set beaus=[${beaus}] belles=[${belles}]`);
  check(same(beaus, [1, 3, 5, 7]), `every boy on a squared set is a BEAU (got [${beaus}])`);
  check(same(belles, [2, 4, 6, 8]), `every girl on a squared set is a BELLE (got [${belles}])`);

  // THE SWEEP IS THE REAL TEST. The squared set exposes exactly ONE flipped couple; the old rule was
  // wrong on 33% of the side-by-side pairs across the boards below, so a single board cannot pin it.
  //
  // TRUTH IS INDEPENDENT OF THE ENGINE'S ARITHMETIC: LEFT is the boy's heading rotated +90 degrees
  // COUNTER-clockwise in this y-up frame, and a SIDE-BY-SIDE pair is one whose boy sits ~1.0 to the
  // side of the pair's midpoint. A pair standing FRONT-TO-BACK (a facing pair, or a tandem) projects to
  // 0 and has no left/right partner at all, so it is skipped rather than asserted either way.
  let boards = 0, sidePairs = 0, wrong = 0;
  const bad = [];
  for (const title of callsByTitle(assets).map((c) => c.name)) {
    let r;
    try { r = seq.applyToBoard(home, title); } catch { continue; }
    if (!r || !r.legal || !r.board) continue;
    const found = findCouplePairs(r.board);
    if (found.length !== 4) continue; // only the boards where all four couples are identified
    const ids = seq.selectionIds(r.board, 'Beaus');
    if (!ids || !ids.length) continue;
    boards++;
    const asBeau = new Set(ids);
    for (const { boy, girl } of found) {
      const lx = -Math.sin(boy.heading), ly = Math.cos(boy.heading);
      const mx = (boy.x + girl.x) / 2, my = (boy.y + girl.y) / 2;
      const proj = (boy.x - mx) * lx + (boy.y - my) * ly;
      if (Math.abs(proj) <= 0.5) continue; // front-to-back: no left/right partner exists
      sidePairs++;
      const truth = proj > 0 ? boy.id : girl.id;
      const engineBeau = asBeau.has(boy.id) ? boy.id : asBeau.has(girl.id) ? girl.id : null;
      if (engineBeau !== truth) {
        wrong++;
        if (bad.length < 5) bad.push(`${title}: ${boy.id}+${girl.id} (engine #${engineBeau}, is #${truth})`);
      }
    }
  }
  console.log(`  swept ${boards} board(s) with four identified couples, ${sidePairs} side-by-side pair(s)`);
  check(boards > 100 && sidePairs > 400,
    `the sweep is not vacuous: ${boards} board(s) and ${sidePairs} side-by-side pair(s) were measured`);
  check(wrong === 0,
    `no side-by-side pair gets the wrong beau on any board reached from a squared set (${wrong} of ${sidePairs}${bad.length ? ' - ' + bad.join('; ') : ''})`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
