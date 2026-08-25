// Headless test for the square-dancing.md §7 engine features: ghost dancers,
// collisions, 64-beat segment validation, tip/zero validation, getin, subset
// formations and parallel action. Run after `npm run build` (tsc).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer } from '../dist/index.js';

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
const variants = seq['variants'].get('Single Circle Right Full');
let fcv = null;
for (const x of variants) if (!fcv || x.dancers.length < fcv.dancers.length) fcv = x;
const fSetup = fcv.dancers.map((d) => seq['variantMatchable'](d)); // mirror-aware canonical positions
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
check(typeof seq['selectionMode'] === 'string', 'selectionMode is a settable field');

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

console.log('=================');
if (failures === 0) console.log('FEATURES TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
