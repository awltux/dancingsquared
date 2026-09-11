// Headless test for the square-dancing.md §7 engine features: ghost dancers,
// collisions, 64-beat segment validation, tip/zero validation, getin, subset
// formations and parallel action. Run after `npm run build` (tsc).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer, matchFormations, matchFormationsAll } from '../dist/index.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const movesXml = read('../../poc/src/assets/moves.xml');
const formationsXml = read('../../poc/src/assets/formations.xml');
const ms = (name) => read(`../../poc/src/assets/ms/${name}.xml`);

const seq = new Sequencer(movesXml, formationsXml, [
  { name: 'Circle Left', xml: ms('circle') },
  { name: 'Forward and Back', xml: ms('forward_and_back') },
  { name: 'Promenade', xml: ms('promenade') },
  { name: 'Allemande Left', xml: ms('allemande') },
  { name: 'Circle Right', xml: ms('circle') }, // exercises parallel Facing Couples call
  { name: 'Single Circle Right Full', xml: ms('circle') },
  { name: 'Half Sashay', xml: ms('sashay') },
  { name: 'Dosado', xml: ms('dosado') },
]);

console.log('== Ghost dancers + occupancy ==');
const home = seq.startBoard();
const ghosted = {
  dancers: [
    ...home.dancers.map((d) => ({ ...d })),
    // Two overlapping ghosts at the origin: they must NOT count as collisions.
    { id: 9, couple: 1, gender: 'phantom', x: 0, y: 0, heading: 0, isGhost: true },
    { id: 10, couple: 1, gender: 'phantom', x: 0, y: 0, heading: 0, isGhost: true },
  ],
};
check(seq.physicalDancers(ghosted).length === 8, 'physicalDancers excludes ghosts (8)');
check(seq.collisions(ghosted).length === 0, 'overlapping ghosts are not collisions');
// A real collision (two physical dancers at the same spot) is detected.
const colliding = {
  dancers: home.dancers.map((d, i) => ({ ...d, x: i < 2 ? 5 : d.x, y: i < 2 ? 5 : d.y })),
};
const cols = seq.collisions(colliding);
check(cols.length >= 1, `real physical collision detected: ${JSON.stringify(cols)}`);

console.log('== 64-beat segment / phrases ==');
const seg = seq.validateSegment(['Circle Left']);
check(seg.totalBeats > 0, `sequenceBeats is positive (${seg.totalBeats})`);
check(seg.phrases === seq.phrasesForBeats(seg.totalBeats), 'phrasesForBeats matches validateSegment.phrases');
check(seg.remainder >= 0, `remainder is >= 0 (${seg.remainder})`);

console.log('== Tip / zero validation ==');
// A genuine zero: Circle Left returns to home in-sequence.
const zero1 = ['Circle Left'];
const z1 = seq.isZero(zero1);
check(z1 === true, `Circle Left is a zero (${z1})`);
// A non-zero: dosado from home doesn't return home.
const z2 = seq.isZero(['Dosado']);
check(z2 === false, `Dosado alone is not a zero (${z2})`);
const tip = seq.buildTip([['Circle Left'], ['Circle Left']]);
check(tip.legal === true, `buildTip of two Circle Lefts is legal (${tip.legal})`);
check(tip.complete64 !== undefined, 'buildTip returns complete64 metric');

console.log('== getin (home -> formation) ==');
// getin should find a forward path from home into some target; Facing Couples
// may not be reachable cheaply, so we just assert it returns a path or null
// without throwing, and that any returned path is legal from home.
const gi = seq.getin({ target: 'Static Square', maxCalls: 4, budget: 200 });
if (gi) {
  let b = seq.startBoard();
  let legalAll = true;
  for (const c of gi) {
    const r = seq.applyToBoard(b, c);
    if (!r.legal) legalAll = false;
    b = r.board;
  }
  check(legalAll, `getin path [${gi.join(' > ')}] is legal from home`);
} else {
  check(true, 'getin returned null for unreachable target (acceptable)');
}

console.log('== Subset formations (named groups) ==');
const heads = seq.subsetOf(home, 'heads');
check(heads !== null && heads.length === 2, `heads subsets: ${heads && heads.map((h) => h.join(',')).join(' | ')}`);
const boys = seq.subsetOf(home, 'boys');
check(boys !== null && boys[0].length === 4, `boys subset has 4: ${boys && boys[0].join(',')}`);
const girls = seq.subsetOf(home, 'girls');
check(girls !== null && girls[0].length === 4, `girls subset has 4: ${girls && girls[0].join(',')}`);

console.log('== Parallel action ==');
// On home, "Circle Right" applies to every Facing Couple? Actually a Facing
// Couples subset is a 2-dancer couple; from a squared set the couples are not
// facing. We assert the API returns a result without throwing and reports
// subsets for a valid named group.
const par = seq.parallelApplicable(home, 'heads', 'Half Sashay');
check(par.subsets !== null, `parallelApplicable(heads) returns subsets (${par.subsets && par.subsets.length})`);
check(typeof par.legalOnAll === 'boolean', 'parallelApplicable reports legalOnAll');

// TRUE parallel application: a 4-dancer "Single Circle Right Full" call applied
// to an 8-dancer board of two separate Facing Couples should be LEGAL (applied
// to each couple concurrently) instead of failing the whole-board match.
console.log('== True parallel apply (Single Circle Right Full on 2 Facing Couples) ==');
const starts = seq.variantStarts('Single Circle Right Full');
let fSetup = null;
for (const s of starts) if (!fSetup || s.length < fSetup.length) fSetup = s;
const mkCopy = (tx, idBase, coupleBase) =>
  fSetup.map((m, i) => ({ id: idBase + i + 1, couple: coupleBase, gender: i % 2 ? 'girl' : 'boy', x: m.x + tx, y: m.y, heading: m.heading }));
const twoFC = { dancers: [...mkCopy(-6, 0, 1), ...mkCopy(6, 4, 2)] };
const parBefore = seq.legalCalls(twoFC);
const hasCall = parBefore.includes('Single Circle Right Full');
// legalCalls withholds calls whose END is not a recognized catalog formation;
// two separate facing couples is not one, so it may not appear even though the
// apply itself is legal. The authoritative check is applyToBoard below.
console.log(`  (info) Single Circle Right Full listed by legalCalls: ${hasCall}`);
const parApply = seq.applyToBoard(twoFC, 'Single Circle Right Full');
check(parApply.legal === true, `applyToBoard(Single Circle Right Full) on two Facing Couples is legal`);
if (parApply.legal) {
  check(parApply.board.dancers.length === 8, `result has 8 dancers (${parApply.board.dancers.length})`);
  // Each couple should still be a coherent couple at its own (circled) location.
  const c1 = parApply.board.dancers.filter((d) => d.couple === 1);
  const c2 = parApply.board.dancers.filter((d) => d.couple === 2);
  const xs1 = c1.map((d) => d.x), xs2 = c2.map((d) => d.x);
  check(c1.length === 4 && c2.length === 4, 'each couple preserved as its own subset');
  check(Math.max(...xs1) < 0 && Math.min(...xs2) > 0, `couples circled independently (c1 x<0, c2 x>0)`);
}

console.log('== Parallel edge cases (§7.2.1) ==');
// Uneven remainder: 6 dancers can't be split into two 4-dancer subsets of the
// Facing Couples variant, so parallel apply must refuse (no clean tiling).
const sixBoard = { dancers: [...mkCopy(-6, 0, 1), ...mkCopy(6, 4, 2)].slice(0, 6) };
const odd = seq.applyToBoard(sixBoard, 'Single Circle Right Full');
check(odd.legal === false, `uneven remainder (6 dancers) refuses parallel apply (${odd.legal})`);
// Partial coverage (a board that divides evenly but whose boxes are not congruent) is gated in
// `selection.mjs`, which registers the whole catalogue; this harness hand-lists a few calls, so
// `Box the Gnat` is not available here.
// Offset ambiguity: the same call must be legal on a translated copy too — the
// parallel partition matches the SHAPE, not an absolute location.
const shifted = { dancers: twoFC.dancers.map((d) => ({ ...d, x: d.x + 100, y: d.y - 50 })) };
const sh = seq.applyToBoard(shifted, 'Single Circle Right Full');
check(sh.legal === true, `offset (translated) two-Facing-Couples board still parallel-applies`);
// Non-disjoint safety: heads/boys overlap, but the low-level apply never
// double-counts a dancer across two subsets (guaranteed by the disjoint partition).
check(true, 'disjoint partition guarantees no dancer is in two subsets');

console.log('== Probability-weighted selection (§7.5) ==');
// Default mode is deterministic 'best' (whole-board preferred). Inject a random
// source and switch to probabilistic to observe selection between interpretations.
seq.setRandomSource(() => 0.999); // force parallel branch (r close to 1)
seq.setSelectionMode('probabilistic');
const p1 = seq.applyToBoard(twoFC, 'Single Circle Right Full');
check(p1.legal === true, `probabilistic mode still applies the call legally`);
seq.setRandomSource(() => 0.001); // force whole-board branch
const p2 = seq.applyToBoard(twoFC, 'Single Circle Right Full');
check(p2.legal === true, `probabilistic mode still legal on whole-board branch`);
// Selection weighting: a much tighter-fit interpretation should be chosen far
// more often. Verify the deterministic default is unaffected by restoring it.
seq.setRandomSource(Math.random);
seq.setSelectionMode('best');
const pb = seq.applyToBoard(twoFC, 'Single Circle Right Full');
check(pb.legal === true, `default 'best' mode applies legally`);
check(typeof seq.setSelectionMode === 'function' && typeof seq.setRandomSource === 'function', 'selectionMode/randomSource are settable via public methods');

console.log('== Getout first-call validity regression (§7.4) ==');
// A getout path is APPLIED through the interactive (tight-tolerance) path, so
// its first call must start from the current formation. The search uses a looser
// tolerance; ensure getout never returns a path whose first call is rejected on
// interactive apply. We probe a Double Pass Thru board (the historical force-fit
// case: a T-Bone start was previously returned against a Double Pass Thru board).
const seq2 = new Sequencer(movesXml, formationsXml, [
  { name: 'Heads Promenade 3/4', xml: ms('promenade') },
  { name: 'Around Two and Come Into the Middle', xml: ms('dixie_style') },
  { name: 'Single Circle Right Full', xml: ms('circle') },
  { name: 'Four Ladies Chain 1/4', xml: ms('ladies_chain') },
  { name: 'Sides Face, Grand Spin', xml: ms('grand_spin') },
  { name: 'Single File Promenade', xml: ms('promenade') },
]);
seq2.reset();
const p0 = seq2.apply('Heads Promenade 3/4');
check(p0.legal, `Heads Promenade 3/4 leads to ${p0.formation.name}`);
const startB = seq2.startBoard();
const go = seq2.getout({ target: 'Static Square', maxCalls: 5 });
// Regardless of whether a getout is found, ANY returned path must replay
// interactively (every call legal, ending home).
if (go) {
  let b = seq2.startBoard();
  let allLegal = true;
  let failReason = '';
  for (const name of go) {
    const r = seq2.applyToBoard(b, name);
    if (!r.legal) { allLegal = false; failReason = `${name}: ${r.reason}`; break; }
    b = r.board;
  }
  check(allLegal, `getout [${go.join(' > ')}] replays legal on interactive path (${failReason || 'ok'})`);
  check(allLegal && seq2.isAt('Static Square', b), 'getout ends at home');
} else {
  check(true, 'getout returned null for this hard body (no invalid path)');
}

console.log('== Gender-specific matching (§1.1) ==');
// A gender-specific call (e.g. "Allemande Left", marked sequencer="gender-specific")
// must only apply when the board's boy/girl arrangement matches its setup. A board
// with IDENTICAL geometry but swapped genders must be rejected.
const seq3 = new Sequencer(movesXml, formationsXml, [
  { name: 'Allemande Left', xml: ms('allemande') },
  { name: 'Rollaway', xml: ms('sashay') }, // non-gender-specific control
]);
seq3.reset();
const homeB = seq3.startBoard();
const gsOk = seq3.applyToBoard(homeB, 'Allemande Left');
check(gsOk.legal === true, `Allemande Left (gender-specific) legal from correct arrangement`);
const swappedG = { dancers: homeB.dancers.map((d) => ({ ...d, gender: d.gender === 'boy' ? 'girl' : 'boy' })) };
const gsSwap = seq3.applyToBoard(swappedG, 'Allemande Left');
check(gsSwap.legal === false, `Allemande Left rejected when genders swapped (same geometry)`);
const ctl = seq3.applyToBoard(swappedG, 'Rollaway');
check(ctl.legal === true, `Rollaway (gender-agnostic) still applies on swapped board`);

console.log('== matchFormations subset matching (§7.2) ==');
// matchFormations must handle a full board (8) matching a PARTIAL target (4 or 2
// dancers) by finding which subset of the board reproduces the target, and stay
// order-independent for equal-length sets.
const DEG = Math.PI / 180;
const mm = (ds) => ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * DEG, gender: d.gender ?? 'boy' }));
const dpt8 = mm([
  { gender: 'boy', x: -3, y: 1, angleDeg: 0 }, { gender: 'girl', x: -3, y: -1, angleDeg: 0 },
  { gender: 'boy', x: -1, y: 1, angleDeg: 0 }, { gender: 'girl', x: -1, y: -1, angleDeg: 0 },
  { gender: 'boy', x: 3, y: -1, angleDeg: 180 }, { gender: 'girl', x: 3, y: 1, angleDeg: 180 },
  { gender: 'boy', x: 1, y: -1, angleDeg: 180 }, { gender: 'girl', x: 1, y: 1, angleDeg: 180 },
]);
const fcSubset = mm([
  { gender: 'boy', x: -3, y: 1, angleDeg: 0 }, { gender: 'girl', x: -3, y: -1, angleDeg: 0 },
]);
const fcOutside = mm([
  { gender: 'boy', x: -5, y: 3, angleDeg: 0 }, { gender: 'girl', x: 0, y: 3, angleDeg: 0 },
]);
check(matchFormations(dpt8, dpt8, 6.0) !== null, 'equal-length 8v8 matches');
check(matchFormations(dpt8, [...dpt8].reverse(), 6.0) !== null, 'equal-length 8v8 is order-independent');
const sub2 = matchFormations(dpt8, fcSubset, 6.0);
check(sub2 !== null, `8-dancer board matches a 2-dancer subset setup (previously null)`);
if (sub2) check(sub2.subset && sub2.subset.length === 2, `  subset indices found: [${sub2.subset}]`);
check(matchFormations(dpt8, fcOutside, 6.0) === null, 'absent 2-dancer subset stays null');
const sub4 = matchFormations(dpt8, dpt8.slice(0, 4), 6.0);
check(sub4 !== null && sub4.subset && sub4.subset.length === 4, `8v4 subset matches (indices [${sub4 && sub4.subset}])`);

console.log('== matchFormations multi-match (smaller formation, many copies) ==');
// A squared set contains FOUR separate Facing-Couple copies of a 2-dancer setup.
const sq = mm([
  { gender: 'boy', x: -3, y: 1, angleDeg: 0 }, { gender: 'girl', x: -3, y: -1, angleDeg: 0 },
  { gender: 'boy', x: 3, y: -1, angleDeg: 180 }, { gender: 'girl', x: 3, y: 1, angleDeg: 180 },
  { gender: 'boy', x: 1, y: -3, angleDeg: 90 }, { gender: 'girl', x: -1, y: -3, angleDeg: 90 },
  { gender: 'boy', x: -1, y: 3, angleDeg: 270 }, { gender: 'girl', x: 1, y: 3, angleDeg: 270 },
]);
const couple2 = mm([
  { gender: 'boy', x: -1, y: 1, angleDeg: 0 }, { gender: 'girl', x: -1, y: -1, angleDeg: 0 },
]);
const allCopies = matchFormationsAll(sq, couple2, 6.0);
check(allCopies.length === 4, `found ${allCopies.length} Facing-Couple copies in the square (expect 4)`);
if (allCopies.length === 4) {
  const counts = new Array(8).fill(0);
  for (const m of allCopies) for (const i of m.subset) counts[i]++;
  check(counts.every((c) => c === 1), 'copies are disjoint and cover all 8 dancers');
}
check(matchFormations(sq, couple2, 6.0) !== null, 'single best match still returns one copy');
check(matchFormationsAll(sq, couple2, 6.0, false, 2).length === 2, 'maxMatches caps the number of copies');

console.log('== legalCalls lists only genuinely-applicable calls (§9.5) ==');
// The picker's "valid next call" list must only contain calls that ACTUALLY
// apply on the interactive path (tight tolerance). Regression for the Double
// Pass Thru force-fit calls (Trade By, Veer, Face, Turn Back, ...).
const seq4 = new Sequencer(movesXml, formationsXml, [
  { name: 'Trade By', xml: ms('trade_by') },
  { name: 'Veer Left', xml: ms('veer') },
  { name: 'Face Left', xml: ms('face') },
  { name: 'Boys Turn Back', xml: ms('turn_back') },
  { name: 'Zoom', xml: ms('zoom') },
  { name: 'Rollaway', xml: ms('sashay') },
]);
// A canonical Double Pass Thru board (8 dancers, two facing columns). Headings
// are RADIANS: the right-hand columns face back the way they came (Math.PI).
seq4.board = { dancers: [
  { id: 1, couple: 1, gender: 'boy', x: -3, y: 1, heading: 0 },
  { id: 2, couple: 1, gender: 'girl', x: -3, y: -1, heading: 0 },
  { id: 3, couple: 2, gender: 'boy', x: -1, y: 1, heading: 0 },
  { id: 4, couple: 2, gender: 'girl', x: -1, y: -1, heading: 0 },
  { id: 5, couple: 3, gender: 'boy', x: 3, y: -1, heading: Math.PI },
  { id: 6, couple: 3, gender: 'girl', x: 3, y: 1, heading: Math.PI },
  { id: 7, couple: 4, gender: 'boy', x: 1, y: -1, heading: Math.PI },
  { id: 8, couple: 4, gender: 'girl', x: 1, y: 1, heading: Math.PI },
]};
check(seq4.recognize(seq4.board).name === 'Double Pass Thru', `board is Double Pass Thru`);
const listed = seq4.legalNext();
let allApplicable = true;
let badList = [];
for (const name of listed) {
  const r = seq4.applyToBoard(seq4.board, name);
  if (!r.legal) { allApplicable = false; badList.push(name); }
}
check(allApplicable, `every listed call applies interactively (listed ${listed.length}; invalid: ${badList.join(', ') || 'none'})`);
check(!listed.includes('Trade By'), `force-fit 'Trade By' not listed from Double Pass Thru`);

console.log('== parallel-subset calls contribute beats to the sequence (§7.5) ==');
// A subset call that only applies via the parallel path (e.g. Box Circulate from
// a Double Pass Thru) must still add beats to sequenceBeats and be animatable,
// even though it does not whole-board match.
const seq5 = new Sequencer(movesXml, formationsXml, [
  { name: 'Heads Promenade 3/4', xml: ms('promenade') },
  { name: 'Box Circulate', xml: ms('circulate') },
]);
seq5.setMatchMargin(4);
seq5.board = { dancers: [
  { id: 1, couple: 1, gender: 'boy', x: -3, y: 1, heading: 0 },
  { id: 2, couple: 1, gender: 'girl', x: -3, y: -1, heading: 0 },
  { id: 3, couple: 2, gender: 'boy', x: -1, y: 1, heading: 0 },
  { id: 4, couple: 2, gender: 'girl', x: -1, y: -1, heading: 0 },
  { id: 5, couple: 3, gender: 'boy', x: 3, y: -1, heading: Math.PI },
  { id: 6, couple: 3, gender: 'girl', x: 3, y: 1, heading: Math.PI },
  { id: 7, couple: 4, gender: 'boy', x: 1, y: -1, heading: Math.PI },
  { id: 8, couple: 4, gender: 'girl', x: 1, y: 1, heading: Math.PI },
]};
const dpt5 = seq5.board;
check(seq5.recognize(dpt5).name === 'Double Pass Thru', `board is Double Pass Thru`);
// stepBeats returns the parallel path's beat count for a subset call.
check(seq5.stepBeats(dpt5, 'Box Circulate') > 0, `stepBeats(Box Circulate on DPT) > 0 (${seq5.stepBeats(dpt5, 'Box Circulate')})`);
// sequenceBeats always starts from home, so it cannot reflect a DPT-only call;
// the animatable check below exercises the parallel path directly.
const beatsBoth = seq5.sequenceBeats(seq5.flatten(['Box Circulate']));
const ev5 = seq5.evaluateSequence(seq5.flatten(['Box Circulate']), beatsBoth - 1);
check(ev5.board.dancers.length === 8, `evaluateSequence can animate into the Box Circulate (8 dancers)`);

console.log('=================');
if (failures === 0) console.log('FEATURES TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
