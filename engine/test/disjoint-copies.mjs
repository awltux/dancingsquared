// THE TWO DISJOINT-COPY SEARCHES, ASKED THE SAME QUESTION — AND WHERE THEY DISAGREE ABOUT WHO DANCES WHAT.
//
// THE TWO PATHS, and they are genuinely two. Both cut a whole-set board into disjoint copies of a k-dancer setup,
// and they share nothing but the per-group primitive `matchFormations`:
//
//   A  the PICKER: `Sequencer.applyToBoard` -> `applicator.parallelApply` (`applicator.ts:1401` -> `partition`
//      :1623 / `partitionPartial` :1654). Anchored on the LOWEST UNPLACED INDEX and returns the FIRST full tiling in
//      index order; the partial reading packs as many groups as fit, per anchor lowest-error-then-gendered.
//   B  the VIRTUAL RESOLUTION: `Sequencer.virtualCall` -> `resolveVirtual` (`virtual-call.ts:194`) ->
//      `matchFormationsAll` (`match.ts:290`). Every k-subset, sorted by error, greedily packed; the `tiled` reading
//      needs n/k copies, the `partial` reading is ONE copy by construction; a reflected placement and any placement
//      whose END the engine cannot name are dropped (`virtual-call.ts:245,268,295`), and `chooseVirtual` picks.
//
// So they can disagree about who dances what, and NOTHING ELSE IN THE TREE COMPARES THEM. `virtual-call.mjs` pins a
// placement against the board and the source; `parallel-group-probe.mjs` compares the animator's predicate with the
// applicator, not these two. This harness asks both the same question and reports the answer.
//
// WHY A DIFFERENTIAL TEST IS THE RIGHT INSTRUMENT HERE. AGENTS.md §11.2.3 forbids a judge that re-asks the
// predicate under test, because that passes for as long as the defect does. This is the opposite: TWO independent
// implementations of one question are compared, and NEITHER is treated as the oracle. The harness reports the
// difference and the dimension it comes from; deciding which side is right is the owner's call (TODO.md item 41).
//
// WHAT THE QUESTION IS. For a named-formation board and a catalogue title whose authoring builds to fewer than
// eight dancers: "cut the board into disjoint copies of that setup". Both sides are normalised to a set of
// DANCER-POSITION SETS, so a difference in copy ORDER or in the order inside a copy is not a disagreement.
//
// THE DIMENSIONS are measured, not judged:
//   constraint          B found placements and dropped them all because the END is unnamed — the owner's
//                       start-and-end-named constraint (TODO item 39) doing its job. By design.
//   partial-copies      B's partial reading is ONE copy; A's packs as many as fit. By design (`virtual-call.ts:267`).
//   B-searches-nothing  B found no placement at all where A found a group. A real difference in the searches.
//   search              both placed the SAME number of dancers and picked DIFFERENT ones — the "who dances what"
//                       case, and the one a merge of the two searches would have to decide.
//   A-refused           A placed nothing and B did (the `allowsGoing` filter is A-only, `applicator.ts:1411`).
//
// WHAT IT MEASURED, on the tree it landed: 1140 (board, title) pairs in ~4 s — 954 both-refuse, 43 agree, 76 are
// WHOLE-BOARD readings (a different question: counted, never compared), and **67 DISAGREE**, digest
// `87de7fd0acdeaa49`. The 67 by dimension: 43 dropped by the resolver's unnamed-END constraint, 18 where the
// resolver finds NO placement at all, 4 where its partial reading is one copy against A's several, and **2 where
// both place four dancers and choose DIFFERENT fours** (`Quarter Tag` / `Left Square Thru 3 1/2`: A `{2,3,6,7}`,
// B `{0,1,4,5}`). That last class is the one a merge would have to decide, and it is why this harness is a
// MEASUREMENT rather than a first step to a merge: 24 of 1140 pairs move even after the two by-design classes are
// set aside. The decision is TODO.md item 41.
//
// RE-MEASURED when the RELATION RULE landed (`relations.ts`: a title that names your partner or your corner needs a
// board that carries home couples). The population, the sample and the row count are UNCHANGED — 1140 pairs, 66
// disagreeing rows — and the class of rows that NAMES a relation moved: 4 left `A-ONLY` (61 -> 57) and 3 arrived in a
// NEW class, `B-ONLY/A-refused`, because A now refuses a partner call on a board whose dancers are all
// `UNKNOWN_COUPLE` while the resolver's search never reads the relation at all. Its witness is `3 and 1 lines #1 /
// Partner Trade`. So the direction is stated: A is the STRICTER search by exactly these, and the class is a FACT this
// harness pins (it fails if it grows AND if it disappears). Digest `0646b122f16893e2`.
//
// TIER AND SAMPLE. LIGHT: every 7th named formation x every 7th sub-8 title, MEASURED at ~4 s. `--all` sweeps the
// whole population (138 x 409) and is a diagnostic, not a gate. The sample rule is printed, and the two are never
// compared as like-for-like (§11.2.10).
//
// Run: node test/disjoint-copies.mjs [--all]   (from engine/; needs `engine/dist`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, chooseVirtual, SEARCH_MATCH_MAX } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const read = (p) => fs.readFileSync(p, 'utf8');

setParser(DOMParser);
const seq = new Sequencer(read(path.join(assets, 'moves.xml')), read(path.join(assets, 'formations.xml')), callsByTitle(assets));

// THE TOLERANCES, AND WHY NEITHER IS A LITERAL HERE. `applyToBoard` calls the applicator with `rebase = true`
// (`sequencer.ts`: `applyStepInner(..., true)`), which selects `DEFAULT_MATCH_MAX + margin` — the SAME tolerance
// `virtualCall` defaults to. So the shipped comparison below is at EQUAL tolerance and needs no literal at all.
// `SEARCH_MATCH_MAX` is used only by the calibration check, and it is IMPORTED: the engine exports both tolerances
// now, and a copy here could only ever be a second spelling of the engine's number
// (`src/sequencer/constants.ts`).
//
// WHAT REPLACED THE OLD COPY-AS-GUARD. The calibration's job was to prove the literal was live; with the engine's
// own number it proves the sharper thing this harness actually relies on — that the two tolerances are NOT
// interchangeable on this sample — and the pinned `calibPairs` / `tolChanged` counts below are what go red if
// `SEARCH_MATCH_MAX` ever moves in a way that changes an answer. The pin is the guard; the copy never was.

const allTitles = [...new Set(callsByTitle(assets).map((c) => c.name))].sort();

/** A grouping as a comparable key: sorted copies, each sorted, joined; and the dancers it covers. */
const keyOf = (copies) => copies.map((c) => [...c].sort((x, y) => x - y).join(',')).sort().join('|');
const covered = (copies) => new Set(copies.flat()).size;

let failures = 0;
const check = (ok, msg, detail) => {
  if (ok) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`);
  }
};

// ---------------------------------------------------------------- 0. the comparator, before it is trusted
console.log('== 0. the comparator, with a control either way ==');
{
  const a = [[1, 6], [2, 5]];
  // ORDER INSENSITIVITY: copies permuted and dancers reordered inside a copy are the SAME grouping.
  check(keyOf([[6, 1], [5, 2]]) === keyOf(a), 'copies and dancers reordered inside a copy compare EQUAL (the key is order-insensitive)');
  // NOT BLIND: one dancer moved to the other copy is a DIFFERENT grouping.
  check(keyOf([[1, 2], [5, 6]]) !== keyOf(a), 'moving one dancer between copies compares UNEQUAL — the comparator is not blind');
  // COVERAGE IS PART OF THE ANSWER: a copy of two is not a copy of four.
  check(keyOf([[1, 6]]) !== keyOf(a), 'a smaller grouping compares UNEQUAL even when every dancer in it matches');
  check(keyOf([]) !== keyOf(a), 'an empty grouping compares UNEQUAL to a real one');
}

// ---------------------------------------------------------------- 1. the population
const subsetTitles = [];
const sizeHistogram = new Map();
for (const title of allTitles) {
  const sizes = seq.matchableVariants(title).map((v) => v.dancers.length);
  if (sizes.length === 0) continue;
  const k = Math.min(...sizes);
  if (k >= 8) continue;
  subsetTitles.push(title);
  sizeHistogram.set(k, (sizeHistogram.get(k) ?? 0) + 1);
}
const formations = seq.listFormations();
const ALL = process.argv.includes('--all');
const boardSample = ALL ? formations : formations.filter((_, i) => i % 7 === 0);
const titleSample = ALL ? subsetTitles : subsetTitles.filter((_, i) => i % 7 === 0);

console.log('\n== 1. the population, and what this run samples ==');
console.log(`    ${allTitles.length} catalogue titles; ${subsetTitles.length} have a variant that builds to fewer than eight dancers (${[...sizeHistogram].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join(' ')})`);
console.log(`    ${formations.length} named formations; sampling ${boardSample.length}${ALL ? ' (--all)' : ' (every 7th)'}; titles ${titleSample.length} of ${subsetTitles.length}${ALL ? '' : ' (every 7th)'}`);
// A ZERO FROM AN EMPTY POPULATION IS NOT A PASS (§11.2.2).
check(subsetTitles.length > 0 && boardSample.length > 0 && titleSample.length > 0,
  `the sample is not empty — ${subsetTitles.length} sub-8 titles, ${boardSample.length} boards, ${titleSample.length} titles`);

// ---------------------------------------------------------------- 2. the sweep
const indexOfDancer = (board, d) => board.dancers.indexOf(d);
const buckets = new Map();
const dims = new Map();
const rows = [];
const witnesses = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
let pairs = 0;
let skippedOdd = 0;
let unusable = 0;
let tolChanged = 0;
let calibPairs = 0;
const started = Date.now();

for (const name of boardSample) {
  const board = seq.boardForFormation(name);
  if (!board || board.dancers.filter((d) => !d.isGhost).length !== 8 || seq.knownFormation(board) === null) { unusable++; continue; }
  for (const title of titleSample) {
    const sizes = seq.matchableVariants(title).map((v) => v.dancers.length).filter((k) => k >= 2 && k < 8);
    // A FULL tiling is only askable when k divides 8; the rest are odd-division boards and are counted, not dropped.
    if (![...new Set(sizes)].some((k) => 8 % k === 0)) { skippedOdd++; continue; }
    pairs++;

    // A: the picker, as the interactive path calls it (rebase = true, so DEFAULT_MATCH_MAX + margin).
    const a = seq.applyToBoard(board, title);
    if (a.legal && !a.parallel) { bump(buckets, 'A-WHOLE-BOARD'); continue; } // a WHOLE-BOARD reading: not this question
    const aCopies = a.legal && a.parallel ? a.parallel.groups.map((g) => g.map((d) => indexOfDancer(board, d))) : null;

    // B: the virtual resolution, as a player gets it (DEFAULT_MATCH_MAX).
    const b = seq.virtualCall(board, title);
    const bPick = b.legal ? chooseVirtual(b.candidates) : { reason: b.reason };
    const bCopies = bPick.chosen ? bPick.chosen.placement : null;
    const bKind = bPick.chosen ? bPick.chosen.kind : null;

    // CALIBRATION: does the tolerance literal still move B's answer at all? (It must, or the constant has drifted.)
    // Sampled every 5th pair — proving the literal is LIVE is a fact about the number, not a census, and the
    // extra `virtualCall` per pair would otherwise nearly double this harness's cost in the light tier.
    if (pairs % 5 === 0) {
      const wide = seq.virtualCall(board, title, { matchTol: SEARCH_MATCH_MAX });
      const widePick = wide.legal ? chooseVirtual(wide.candidates) : { reason: wide.reason };
      const wideCopies = widePick.chosen ? widePick.chosen.placement : null;
      if (Boolean(bCopies) !== Boolean(wideCopies) || (bCopies && keyOf(bCopies) !== keyOf(wideCopies))) tolChanged++;
      calibPairs++;
    }

    let cls;
    if (!aCopies && !bCopies) cls = 'BOTH-REFUSE';
    else if (aCopies && !bCopies) cls = 'A-ONLY';
    else if (!aCopies && bCopies) cls = 'B-ONLY';
    else if (keyOf(aCopies) === keyOf(bCopies)) cls = 'SAME';
    else cls = 'DIFF-GROUP';
    bump(buckets, cls);
    if (cls === 'BOTH-REFUSE' || cls === 'SAME') continue;

    let dim;
    if (cls === 'B-ONLY') dim = 'A-refused';
    else if (cls === 'A-ONLY') {
      dim = String(b.reason ?? '').includes('ends on a board the engine does not name') ? 'constraint' : 'B-searches-nothing';
    } else if (bKind === 'partial' && aCopies.length >= 2) dim = 'partial-copies';
    else dim = 'search';
    bump(dims, `${cls}/${dim}`);

    const row = {
      key: `${name} / ${title} [${cls}/${dim}]`,
      cls,
      dim,
      a: aCopies ? `${aCopies.length}x${aCopies[0].length}/${covered(aCopies)}` : 'none',
      b: bCopies ? `${bCopies.length}x${bCopies[0].length}/${covered(bCopies)}/${bKind}` : 'none',
      aKey: aCopies ? keyOf(aCopies) : '',
      bKey: bCopies ? keyOf(bCopies) : '',
    };
    rows.push(row);
    const w = `${cls}/${dim}`;
    if (!witnesses.has(w)) witnesses.set(w, row);
  }
}

const ms = Date.now() - started;
const digest = createHash('sha256')
  .update(rows.map((r) => `${r.key} A=${r.aKey} B=${r.bKey}`).join('\n'))
  .digest('hex')
  .slice(0, 16);
const sortedBuckets = [...buckets].sort((x, y) => x[0].localeCompare(y[0]));
const sortedDims = [...dims].sort((x, y) => x[0].localeCompare(y[0]));

console.log(`\n== 2. the sweep: ${pairs} pairs in ${ms} ms (${skippedOdd} odd-division pairs skipped, ${unusable} unusable boards) ==`);
console.log(`    buckets: ${sortedBuckets.map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`    disagreements: ${rows.length} (${sortedDims.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}), digest ${digest}`);
console.log(`    tolerance calibration: B at the SEARCH tolerance (${SEARCH_MATCH_MAX}) differs from B at its own default on ${tolChanged} of ${calibPairs} sampled pairs`);

// ---------------------------------------------------------------- 3. the pins
// MEASURED on this tree, and every number here is a FACT (exact equality): a change to either search, to the
// catalogue, or to the named formations moves one of them.
const PINS = {
  titles: 2191,
  subEightTitles: 409,
  formations: 138,
  boards: 20,
  titlesSampled: 59,
  pairs: 1140,
  skippedOdd: 40,
  unusable: 0,
  buckets: { 'A-ONLY': 57, 'A-WHOLE-BOARD': 76, 'B-ONLY': 3, 'BOTH-REFUSE': 958, 'DIFF-GROUP': 6, SAME: 40 },
  dims: { 'A-ONLY/B-searches-nothing': 17, 'A-ONLY/constraint': 40, 'B-ONLY/A-refused': 3, 'DIFF-GROUP/partial-copies': 4, 'DIFF-GROUP/search': 2 },
  digest: '0646b122f16893e2',
  calibPairs: 214,
  tolChanged: 4,
  witnesses: {
    'A-ONLY/B-searches-nothing': { key: '3 and 1 lines #1 / Chase the Tag [A-ONLY/B-searches-nothing]', aKey: '1,2,5,6', bKey: '' },
    'A-ONLY/constraint': { key: '3 and 1 lines #1 / Dixie Grand [A-ONLY/constraint]', aKey: '1,2,5,6', bKey: '' },
    // THE RELATION RULE'S OWN ROW: `Partner Trade` needs to know who is whose partner, this board has no couples, so A
    // refuses it where the search still places four. The class arrived with the rule and this is its witness.
    'B-ONLY/A-refused': { key: '3 and 1 lines #1 / Partner Trade [B-ONLY/A-refused]', aKey: '', bKey: '1,2,5,6' },
    'DIFF-GROUP/partial-copies': { key: '3 and 1 lines #1 / Single Circle Left 1/2 [DIFF-GROUP/partial-copies]', aKey: '1,6|2,5', bKey: '1,6' },
    // THE "WHO DANCES WHAT" CASE: both place one group of four, covering four dancers, and each picks a different
    // four — the two search orders breaking a symmetric tie differently. This is the row a merge would have to decide.
    'DIFF-GROUP/search': { key: 'Quarter Tag / Left Square Thru 3 1/2 [DIFF-GROUP/search]', aKey: '2,3,6,7', bKey: '0,1,4,5' },
  },
};

console.log('\n== 3. the pins ==');
if (ALL) {
  console.log('    (--all: the pinned facts describe the DEFAULT sample, so they are not asserted on this run)');
} else {
  const fact = (label, got, want) => check(got === want, `${label} = ${want}`, `got ${got}`);
  console.log('    the population and the sample:');
  fact('  catalogue titles', allTitles.length, PINS.titles);
  fact('  sub-eight titles', subsetTitles.length, PINS.subEightTitles);
  fact('  named formations', formations.length, PINS.formations);
  fact('  boards sampled', boardSample.length, PINS.boards);
  fact('  titles sampled', titleSample.length, PINS.titlesSampled);
  fact('  pairs compared', pairs, PINS.pairs);
  fact('  odd-division pairs skipped', skippedOdd, PINS.skippedOdd);
  fact('  unusable boards', unusable, PINS.unusable);

  console.log('    the buckets (a FACT each, zeros included, so an empty class cannot grow unnoticed):');
  for (const k of ['BOTH-REFUSE', 'SAME', 'A-WHOLE-BOARD', 'A-ONLY', 'B-ONLY', 'DIFF-GROUP']) {
    fact(`  ${k}`, buckets.get(k) ?? 0, PINS.buckets[k]);
  }

  console.log('    the disagreements, by class and dimension (a FACT each):');
  for (const k of Object.keys(PINS.dims).sort()) fact(`  ${k}`, dims.get(k) ?? 0, PINS.dims[k]);
  check(dims.size === Object.keys(PINS.dims).length, 'and no dimension appeared that is not pinned', [...dims.keys()].join(', '));

  // THE WHOLE SET, not just its size: a digest over every row's pair, class, dimension and both groupings.
  check(digest === PINS.digest, `the disagreement SET is exactly the pinned one (${rows.length} rows, digest ${PINS.digest})`, `got ${digest}`);

  // THE TOLERANCE LITERAL IS LIVE: if `SEARCH_MATCH_MAX` moved, the calibration count would change, and this fails
  // rather than silently measuring against a constant the engine no longer uses. Sampled every 5th pair.
  fact('  calibration pairs sampled', calibPairs, PINS.calibPairs);
  fact('  tolerance changed B on', tolChanged, PINS.tolChanged);

  // A READABLE ANCHOR PER CLASS: the witness each class was measured on, with both groupings written out.
  for (const [k, want] of Object.entries(PINS.witnesses)) {
    const got = witnesses.get(k);
    check(got && got.key === want.key && got.aKey === want.aKey && got.bKey === want.bKey,
      `witness ${k}: ${want.key}`, got ? `got ${got.key} A=${got.aKey} B=${got.bKey}` : 'no witness');
  }
}

console.log('\n== the witnesses (one per class) ==');
for (const [k, r] of [...witnesses].sort((x, y) => x[0].localeCompare(y[0]))) {
  console.log(`  ${k}`);
  console.log(`    ${r.key}`);
  console.log(`    A ${r.a}  [${r.aKey}]`);
  console.log(`    B ${r.b}  [${r.bKey}]`);
}

console.log(`\n${failures === 0 ? 'disjoint-copies: all checks hold' : `disjoint-copies: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
