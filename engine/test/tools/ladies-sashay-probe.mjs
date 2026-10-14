// CAN THE SEQUENCER DANCE "Ladies In, Men Sashay" / "Girls Center, Boys Sashay"?
//
// Asked directly: "can the current sequencer now handle 'girls center, boys sashay'". The call is
// authored in this repo as `Ladies In, Men Sashay` (CALLERLAB's title, and what `poc/src/assets/src/
// calls.xml` registers at b1 and ssd); the ceder corpus writes it `Ladies Center & Men Sashay`; the
// user's wording is the modern gender-neutral one for the same figure. All8's notation table calls it
// `LyIMS` / "Ladies In And The Men Sashay".
//
// The engine has a `<tam>` for it - TWO of them, in `poc/src/assets/ms/sashay.xml`:
//
//   <tam title="Ladies In, Men Sashay" from="Circle Left"  formation="Circle" sequencer="gender-specific">
//   <tam title="Ladies In, Men Sashay" from="Circle Right" formation="Circle" sequencer="gender-specific">
//
// which is the crux: the two differ ONLY in which way the circle is turning, and that is a fact about
// the TAM's `from`, not about the board's geometry. A static board of eight dancers in a ring is the
// same board either way, so what the engine can and cannot distinguish here is worth measuring rather
// than describing.
//
// Usage: node engine/test/tools/ladies-sashay-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const TITLE = 'Ladies In, Men Sashay';
const show = (b) => (b ? b.dancers.map((d) => `${d.couple}${d.gender === 'boy' ? 'B' : 'G'}@${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' ') : '(none)');
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? `  ok    ${msg}` : `  FAIL  ${msg}`);
  if (!cond) failures++;
};

console.log(`== is the title in the vocabulary the sequencer resolves? ==`);
const names = seq.library.callNames();
console.log(`  known to the library : ${names instanceof Set ? names.has(TITLE) : [...names].includes(TITLE)}`);
console.log(`  variants for the title: ${seq.getVariants(TITLE).length}`);
for (const [i, v] of seq.getVariants(TITLE).entries()) {
  console.log(`    [${i}] ${v.dancers.length} dancer(s)`);
}

console.log(`\n== which named formations does the engine have that the tams ask for? ==`);
for (const name of ['Circle', 'Circle Left', 'Circle Right', 'Static Square']) {
  const b = seq.boardForFormation(name);
  console.log(`  boardForFormation(${JSON.stringify(name)}) -> ${b ? `${b.dancers.length} dancers  [${seq.knownFormation(b)}]` : 'null'}`);
}

console.log(`\n== from a circle: can it be applied? ==`);
const circle = seq.boardForFormation('Circle');
if (circle) {
  const legal = seq.legalCalls(circle);
  console.log(`  legalCalls(circle) includes the title: ${legal.includes(TITLE)}`);
  const res = seq.applyToBoard(circle, TITLE);
  console.log(`  applyToBoard(circle, ${JSON.stringify(TITLE)}): legal=${res.legal}${res.reason ? ` reason=${res.reason}` : ''}`);
  if (res.board) console.log(`    end formation: [${seq.knownFormation(res.board)}]`);
  const m = seq.findMatchingVariant(circle, TITLE, 6.0);
  console.log(`  findMatchingVariant: ${m ? `error ${m.error.toFixed(4)}` : 'null'}`);
} else {
  console.log('  the engine has NO `Circle` formation to build, so the tam can never be matched from a board it built');
}

console.log(`\n== from home (the way a caller actually reaches it: a circle is formed by Circulate-family or by the caller) ==`);
const home = seq.boardForFormation('Static Square');
console.log(`  legalCalls(home) includes the title: ${seq.legalCalls(home).includes(TITLE)}`);
console.log(`  applyToBoard(home): legal=${seq.applyToBoard(home, TITLE).legal}`);

console.log(`\n== the two tams (Circle Left / Circle Right): can the engine tell them apart? ==`);
console.log(`  Both declare formation="Circle" and sequencer="gender-specific"; they differ only in`);
console.log(`  from=("Circle Left" vs "Circle Right"), and boardForFormation('Circle Left') is NULL - the`);
console.log(`  tam's \`from\` is not a formation the engine can build. \`VariantMatch\` carries the matched`);
console.log(`  CallBundle, so which one wins is a measurement rather than a reading.`);
for (const [i, v] of seq.getVariants(TITLE).entries()) {
  console.log(`  variant[${i}]: from=${JSON.stringify(v.from)} formation=${JSON.stringify(v.formation)} title=${JSON.stringify(v.title ?? v.name)}`);
}
const m = circle ? seq.findMatchingVariant(circle, TITLE, 6.0) : null;
if (m) {
  console.log(`  findMatchingVariant matched: from=${JSON.stringify(m.variant.from)} ` +
    `formation=${JSON.stringify(m.variant.formation)} (error ${m.error.toFixed(4)}, rot ${m.rot}, reflect ${m.reflect})`);
} else {
  console.log('  findMatchingVariant matched nothing');
}

// ============================================================================================
// THE CALLER'S SEQUENCE: from a Static Square, "hold hands, ladies in, men sashay".
//
// A DIFFERENT QUESTION from the one above, and the answer is NOT the same. The figure itself is fine
// from a Circle; whether a caller can GET to one from a squared set is a question about the first
// step, and the FSM already says something about it: `Join Hands` is an edge FROM `Circle` TO `Circle`
// (joining hands is how a circle is formed), and `Static Square` has no edge to `Circle` at all.
// ============================================================================================
console.log(`\n== the caller's sequence: Static Square -> hold hands -> ladies in, men sashay ==`);
{
  // "Hold hands" is not the authored title; the engine's vocabulary spells the hand-join `Join Hands`.
  // Checked rather than assumed, because a title the library does not have cannot be applied at all.
  for (const t of ['Hold Hands', 'Join Hands', 'Circle Left', 'Ladies In, Men Sashay']) {
    console.log(`  ${t.padEnd(22)} variants ${String((seq.getVariants(t) ?? []).length).padStart(2)}   legal from Static Square: ${seq.legalCalls(home).includes(t)}`);
  }
  const step1 = seq.applyToBoard(home, 'Join Hands');
  console.log(`\n  step 1  applyToBoard(Static Square, "Join Hands"): legal=${step1.legal}${step1.reason ? ` reason=${step1.reason}` : ''}`);
  if (step1.board) {
    console.log(`          end formation: [${seq.knownFormation(step1.board)}]`);
    console.log(`          is it the Circle state? matchesNamed(board,'Circle') = ${seq.matchesNamed(step1.board, 'Circle')}`);
  }
  const step2 = step1.board ? seq.applyToBoard(step1.board, TITLE) : null;
  console.log(`  step 2  applyToBoard(<after Join Hands>, ${JSON.stringify(TITLE)}): legal=${step2 ? step2.legal : 'n/a'}${step2?.reason ? ` reason=${step2.reason}` : ''}`);
  if (step2?.board) console.log(`          end formation: [${seq.knownFormation(step2.board)}]`);
  // The whole sequence through the sequencer's own replay machinery, which is what the app uses.
  const replay = seq.evaluateSequence(['Join Hands', TITLE], 999, home);
  console.log(`  replay  evaluateSequence(['Join Hands', ${JSON.stringify(TITLE)}]) -> ${JSON.stringify(replay ? seq.knownFormation(replay.board) : null)}`);
  void replay;
  // And the direct route a caller WOULD have to use: make the circle first.
  console.log(`\n  the routes that DO reach it, from the FSM asset:`);
  console.log(`    Join Hands is an edge from Circle to Circle, i.e. it is how a circle is FORMED - the engine`);
  console.log(`    models "in a circle" as the state, so there is nothing to join hands from at a square.`);
  // THE STRUCTURAL REASON, read out of the asset: who can reach the Circle state at all?
  const asset = JSON.parse(readFileSync(path.join(assets, 'fsm-ms.json'), 'utf8'));
  const intoCircle = [];
  for (const s of asset.table.states) {
    for (const e of asset.table.edges[s] ?? []) if (e.endFormation === 'Circle') intoCircle.push(s);
  }
  const fromHome = (asset.table.edges['Static Square'] ?? []).filter((e) => e.endFormation === 'Circle');
  console.log(`\n  states with an edge INTO Circle: ${[...new Set(intoCircle)].join(', ') || '(none)'}`);
  console.log(`  edges Static Square -> Circle  : ${fromHome.length}`);
  check(intoCircle.length > 0 && [...new Set(intoCircle)].every((s) => s === 'Circle'),
    'EVERY edge into the Circle state comes from Circle itself - it is an ISLAND in the ms FSM');
  check(fromHome.length === 0,
    'and nothing leaves Static Square for Circle, so no sequence from a squared set can reach the figure');
  // The engine's own titles, measured from a squared set. `Hold Hands` is not what it is called here.
  check((seq.getVariants('Hold Hands') ?? []).length === 0,
    '"Hold Hands" is not a title in this vocabulary (the hand-join is authored as "Join Hands")');
  check(step1.legal && seq.knownFormation(step1.board) === 'Static Square',
    'Join Hands from a Static Square is legal but leaves the board a STATIC SQUARE, not a Circle');
  check(!!step2 && !step2.legal,
    `and the figure then REFUSES from there (${step2?.reason ?? 'no reason'})`);
  // The route that DOES work, for contrast: reach a Circle some other way, then the figure.
  const cl = seq.applyToBoard(home, 'Circle Left');
  console.log(`\n  for contrast, "Circle Left" from Static Square: legal=${cl.legal}, end [${seq.knownFormation(cl.board)}]`);
}
console.log(`\n== the answer, pinned ==`);
void show;
// TWO, NOT FOUR, and the four was never wrong about the tams - it was counting a SECOND LEVEL's copy of
// them. This pinned 4 from `b52f5b5` while `b1/sashay.xml` (2 tams) and `ms/sashay.xml` (2 tams) both
// existed and `callsByTitle` pools every level's tams under the title. `50d3e95` ("retire b1/b2 into ms
// 2026") removed the b1 copy, so the answer is the 2 tams that are actually there: one per direction.
// `loadVariants` builds exactly one variant per <tam> (`library.ts`), and `git grep -l` finds the title
// in `ms/sashay.xml` alone. Do not "fix" this back to 4 without a second level to point at.
check(seq.getVariants(TITLE).length === 2,
  `the title resolves to ${seq.getVariants(TITLE).length} variants (one tam per direction: Circle Left, Circle Right)`);
check(!!circle && circle.dancers.length === 8,
  'the engine has a named `Circle` formation to stand the figure up from');
check(!!circle && seq.legalCalls(circle).includes(TITLE),
  'it is LEGAL from a Circle - a caller can apply it');
{
  const res = circle ? seq.applyToBoard(circle, TITLE) : null;
  check(!!res && res.legal && seq.knownFormation(res.board) === 'Circle',
    'applying it leaves the dancers in a Circle, which is where the figure belongs');
  check(!!circle && seq.findMatchingVariant(circle, TITLE, 6.0)?.error === 0,
    'the Circle board matches a variant EXACTLY (error 0.0000), so this is an authored figure and not a fallback');
}
// NOT a call from a squared set, and the refusal is correct rather than a gap: this is a singing-call
// break figure that lives on a circle, and CALLERLAB's Mainstream list does not contain it.
check(!seq.legalCalls(home).includes(TITLE),
  'it is NOT legal from a Static Square - correct, because it is a circle figure');
// The limitation, measured. Both tams declare the SAME formation and differ only in `from`, and the
// matcher reports WHICH one it took - so this is not a claim about the matcher's internals.
{
  const froms = seq.getVariants(TITLE).map((v) => v.from);
  check(froms.includes('Circle Left') && froms.includes('Circle Right') && new Set(seq.getVariants(TITLE).map((v) => v.formation)).size === 1,
    'the two directions are distinguishable only by `from`, which is not a formation the engine builds');
  check(seq.boardForFormation('Circle Left') === null && seq.boardForFormation('Circle Right') === null,
    'so `Circle Left` / `Circle Right` are NOT formations here, and the engine always takes the FIRST match');
  check(!!circle && seq.boardForFormation('Circle')?.dancers.every((d) => (d.couple ?? 0) === 0),
    'and the Circle it stands up is ANONYMOUS (couple 0 for all eight): no sequence, no relationship, no partner');
}
// The FSM's own record of it, read from the stored asset rather than from this run's memory.
{
  const asset = JSON.parse(readFileSync(path.join(assets, 'fsm-ms.json'), 'utf8'));
  const edges = (asset.table.edges?.Circle ?? []).filter((e) => e.call === TITLE);
  check(edges.length === 1 && edges[0].endFormation === 'Circle' && edges[0].endKind === 'state',
    `the FSM carries it as a self-loop on the Circle state (${edges.length} edge, end ${edges[0]?.endFormation}, kind ${edges[0]?.endKind})`);
}

console.log(`\nladies-sashay-probe: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
