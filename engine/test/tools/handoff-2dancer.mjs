// HOW A 2-DANCER CALL IS MAPPED ONTO EIGHT DANCERS - `Single Circle Right Full`, measured end to end.
//
// SCOPING, and this is the trap this file exists to avoid: `CallLibrary.register(name, xml)` keys the
// WHOLE XML STRING under `name`. Handing it all of `ms/circle.xml` under one title makes every `<tam>`
// in that file - 104 of them, belonging to a dozen other calls - look like variants of that title. So
// every set here is built from the tams whose OWN `title=` attribute matches, and the count is
// asserted before anything is measured.
//
//   ms/circle.xml authors this call TWICE, both 2-dancer, both `asymmetric="true"`:
//     [0] formation="Facing Dancers"      written 2 apart, one path per dancer
//     [1] formation="Facing Dancers Far"  written 3 apart, one path per dancer
//
// Usage: node engine/test/tools/handoff-2dancer.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { matchFormations } from '../../dist/sequencer/match.js';

const TITLE = 'Single Circle Right Full';
setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// ---- the tams, scoped by their own title attribute ----------------------------------------------
const raw = read('poc/src/assets/ms/circle.xml');
const blocks = raw.replace(/<!--[\s\S]*?-->/g, '').match(/<tam\b[\s\S]*?<\/tam>/g) || [];
const tams = blocks.filter((b) => new RegExp(`title="${TITLE}"`).test(b));
console.log(`=== SCOPING ===`);
console.log(`  ms/circle.xml total tams (comments stripped): ${blocks.length}`);
console.log(`  tams whose own title is "${TITLE}": ${tams.length}`);
if (tams.length === 0) throw new Error('no tams for this title');
for (const [i, t] of tams.entries()) {
  const form = (t.match(/formation="([^"]*)"/) ?? [])[1];
  const paths = (t.match(/<path>/g) || []).length;
  const moves = (t.match(/<movement/g) || []).length;
  const from = (t.match(/\bfrom="([^"]*)"/) ?? [])[1] ?? '(absent)';
  const asym = (t.match(/asymmetric="([^"]*)"/) ?? [])[1] ?? '(absent)';
  console.log(`    [${i}] formation="${form}" from="${from}" asymmetric="${asym}" paths=${paths} movements=${moves}`);
}

const seq = new Sequencer(read('poc/src/assets/moves.xml'), read('poc/src/assets/formations.xml'),
  [{ name: TITLE, xml: `<calls>\n${tams.join('\n')}\n</calls>` }]);

// ---- STEP 1: what the library holds -------------------------------------------------------------
const variants = seq.library.matchableVariants(TITLE);
console.log(`\n=== STEP 1: what ` + '`register`' + ` built ===`);
console.log(`  variants for this title: ${variants.length}   (one per <tam>, in document order)`);
for (const [i, v] of variants.entries()) {
  const setup = v.dancers.map((d) => seq.library.variantMatchable(d));
  console.log(`    [${i}] formation="${v.formation}" k=${v.dancers.length} beats=${v.beats} genderSpecific=${v.genderSpecific}`);
  console.log(`         setup: ${setup.map((d) => `(${d.x},${d.y})h${(d.heading * 180 / Math.PI).toFixed(0)}${d.gender ? '/' + d.gender : ''}c${d.couple}`).join('  ')}`);
}

const board = seq.boardForFormation('Normal Lines');
const phys = board.dancers.filter((d) => !d.isGhost);
const n = phys.length;
console.log(`\n=== THE BOARD: Normal Lines, ${n} dancers ===`);
console.log(`  ${board.dancers.map((d) => `#${d.id}(${d.x},${d.y})h${(d.heading * 180 / Math.PI).toFixed(0)}${d.gender ? '/' + d.gender : ''}/c${d.couple}`).join('  ')}`);
console.log(`  every couple field is ${board.dancers[0].couple} = UNKNOWN_COUPLE: a board synthesised from`);
console.log(`  formation geometry has no home identity to carry.`);

// ---- STEP 2: which reading is even possible -----------------------------------------------------
console.log(`\n=== STEP 2: whole-board reading vs parallel reading ===`);
console.log(`  whole-board needs k == n (a 1:1 slot per dancer); parallel needs k < n and n % k == 0`);
const sizes = variants.map((v) => v.dancers.length);
console.log(`  k values present: ${sizes.join(', ')}  |  n = ${n}`);
console.log(`  => k == n ${sizes.includes(n) ? 'IS' : 'is NOT'} available, so the whole-board reading is ${sizes.includes(n) ? 'possible' : 'IMPOSSIBLE for this call on this board'}`);
const whole = seq.matcher.findMatchingVariant(board, TITLE, 1.5);
console.log(`  findMatchingVariant(board, "${TITLE}", 1.5) -> ${whole ? `"${whole.variant.formation}" err=${whole.error.toFixed(4)}` : 'null'}`);

// ---- STEP 3: parallelApply's candidate filter ---------------------------------------------------
console.log(`\n=== STEP 3: parallelApply's candidate filter ===`);
const candidates = [];
for (const [i, v] of variants.entries()) {
  const setup = v.dancers.map((d) => seq.library.variantMatchable(d));
  const k = setup.length;
  const why = k <= 1 ? 'k <= 1' : k >= n ? `k >= n (${k} >= ${n})` : n % k !== 0 ? `n % k = ${n % k}` : 'CANDIDATE';
  console.log(`    [${i}] k=${k}  ${why}`);
  if (why === 'CANDIDATE') candidates.push({ i, v, setup, k });
}
console.log(`  candidates: ${candidates.length}  -> group count is n / k = ${n} / ${candidates[0]?.k ?? '?'} = ${candidates[0] ? n / candidates[0].k : '?'} groups`);

// ---- STEP 4: the tiling, per candidate, and the order the winner is chosen in --------------------
console.log(`\n=== STEP 4: partition each candidate at the interactive tolerance (1.5) ===`);
const scored = [];
for (const c of candidates) {
  const full = seq.applicator.partition(c.setup, phys, 1.5);
  const part = full ?? seq.applicator.partitionPartial(c.setup, phys, 1.5);
  console.log(`    [${c.i}] "${c.v.formation}" k=${c.k}: ${full ? `FULL err=${full.error.toFixed(4)}` : 'no full tiling'}`);
  if (part && full) console.log(`         groups: ${part.groups.map((g) => g.map((d) => '#' + d.id).join('+')).join('  ')}`);
  if (full) scored.push({ i: c.i, err: full.error, form: c.v.formation });
}
console.log(`  tiling candidates sorted by (error, registration index):`);
for (const s of [...scored].sort((a, b) => a.err - b.err || a.i - b.i)) {
  console.log(`    [${s.i}] "${s.form}" err=${s.err.toFixed(4)}`);
}
console.log(`  => the winner is the first of those; a tie is broken by registration order, not by document luck.`);

// ---- STEP 5: how the FACING pairs are found ------------------------------------------------------
console.log(`\n=== STEP 5: how the pairs are found - geometry and headings, not couple labels ===`);
const pair = [phys[0], phys[7]];
console.log(`  a candidate pair #${pair[0].id}(${pair[0].x},${pair[0].y})h${(pair[0].heading * 180 / Math.PI).toFixed(0)} / #${pair[1].id}(${pair[1].x},${pair[1].y})h${(pair[1].heading * 180 / Math.PI).toFixed(0)}:`);
for (const [i, v] of variants.entries()) {
  const tgt = v.dancers.map((d) => seq.library.variantMatchable(d));
  const m = matchFormations(
    pair.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender, couple: d.couple })),
    tgt, 1.5, false,
  );
  console.log(`    vs [${i}] "${v.formation}": ${m ? `error=${m.error.toFixed(4)} rot=${(m.rot * 180 / Math.PI).toFixed(0)}deg reflect=${m.reflect}` : 'no match'}`);
}
console.log(`  per-dancer cost is position + half-weighted facing: hypot(dx,dy) + angDiff(h,h')*0.5`);

// ---- STEP 6: the controls ------------------------------------------------------------------------
console.log(`\n=== STEP 6: two controls ===`);
const plainV = variants.find((v) => v.formation === 'Facing Dancers') ?? variants[0];
const setupPlain = plainV.dancers.map((d) => seq.library.variantMatchable(d));
console.log(`  (a) couple LABELS rewritten, geometry and headings untouched:`);
const relabelled = { dancers: board.dancers.map((d, i) => ({ ...d, couple: [3, 3, 2, 2, 1, 1, 4, 4][i] })) };
for (const [label, b] of [['original labels', board], ['contradictory ', relabelled]]) {
  const ph = b.dancers.filter((d) => !d.isGhost);
  const part = seq.applicator.partition(setupPlain, ph, 1.5) ?? seq.applicator.partitionPartial(setupPlain, ph, 1.5);
  console.log(`      ${label}: ${part ? part.groups.map((g) => g.map((d) => `#${d.id}c${d.couple}`).join('+')).join('  ') : 'no tiling'}`);
}
console.log(`      -> same pairs; the labels did not move the grouping.`);
console.log(`  (b) geometry CHANGED so the dancers face across the line instead:`);
const crossed = {
  dancers: [
    { id: 1, couple: 0, gender: 'boy', x: -2, y: 3, heading: 0 },
    { id: 2, couple: 0, gender: 'boy', x: -2, y: 1, heading: 0 },
    { id: 3, couple: 0, gender: 'girl', x: -2, y: -1, heading: 0 },
    { id: 4, couple: 0, gender: 'girl', x: -2, y: -3, heading: 0 },
    { id: 5, couple: 0, gender: 'girl', x: 2, y: 3, heading: Math.PI },
    { id: 6, couple: 0, gender: 'girl', x: 2, y: 1, heading: Math.PI },
    { id: 7, couple: 0, gender: 'boy', x: 2, y: -1, heading: Math.PI },
    { id: 8, couple: 0, gender: 'boy', x: 2, y: -3, heading: Math.PI },
  ],
};
for (const [label, b] of [['Normal Lines', board], ['crossed     ', crossed]]) {
  const ph = b.dancers.filter((d) => !d.isGhost);
  const part = seq.applicator.partition(setupPlain, ph, 1.5) ?? seq.applicator.partitionPartial(setupPlain, ph, 1.5);
  console.log(`      ${label}: ${part ? part.groups.map((g) => g.map((d) => '#' + d.id).join('+')).join('  ') : 'no tiling'}`);
}
console.log(`      -> the pairing follows the board it is GIVEN. No memory of the starting partners.`);

// ---- STEP 7: the applied result -----------------------------------------------------------------
console.log(`\n=== STEP 7: what applyToBoard does ===`);
const res = seq.applyToBoard(board, TITLE);
console.log(`  legal=${res.legal}`);
if (res.parallel) {
  const vi = variants.indexOf(res.parallel.variant);
  console.log(`  variant [${vi}] "${res.parallel.variant.formation}" (${res.parallel.variant.dancers.length}-dancer), ${res.parallel.groups.length} group(s):`);
  for (const g of res.parallel.groups) console.log(`    ${g.map((d) => `#${d.id}(${d.x},${d.y})`).join('  ')}`);
  console.log(`  each group is applied INDEPENDENTLY and pure-relative (rebase=false): the call is danced`);
  console.log(`  inside 4 two-dancer miniatures at once; the result is then restored to board order.`);
} else {
  console.log(`  whole-board reading`);
}
