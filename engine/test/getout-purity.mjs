// A SEARCH IS A QUERY: `getout()` MUST NOT CHANGE WHAT A LATER `apply()` ANSWERS.
//
// TODO item 35, re-measured. At `8cfe8a1` the same three-step path was legal when replayed interactively and REFUSED
// on its first two steps when a `getout` search had run first - `No setup in this call matches the current formation.`
// - and `reset()` did not clear it. That is a CONTRACT violation: a caller asks "what gets me home from here", and the
// answer changes what "apply this call" means.
//
// IT DOES NOT REPRODUCE ON TODAY'S TREE, and that is a measurement rather than a hope: `mainstream.mjs` - where the
// fifth red was seen - now PASSES its two `getout` replay checks, and the three-step witness itself cannot be built any
// more (`Cast Off Three Quarters` is refused from a Static Square with NO search in the process, so the path the item
// quotes is not a path today). What was NOT there is the gate: nothing in the tree asserted the property in general,
// so a regression would have been invisible until another harness happened to notice. This harness is that gate.
//
// WHAT IT ASSERTS, per witness:
//   1. THE BOARD IS THE SEQUENCER'S OWN, unchanged: `boardSig` before and after the search must be equal. A query that
//      moves the board is the mechanism the item was looking for (match memo, FSM store, `adjustToNextSetup`).
//   2. THE PATH REPLAYS: `reset()`, then `apply()` each call in order - every step legal, and the run ends where the
//      search said it would.
//   3. THE ANSWER IS THE SAME WITH AND WITHOUT THE SEARCH: the same prefix and path on a sequencer that never ran one
//      produces the SAME verdict at every step. That is the contract, and it is what item 35 says was broken.
//   4. THE SAMPLE IS NAMED AND NOT EMPTY: every witness is printed with its path length, a run that finds none is a
//      FAILURE (AGENTS §11.2.2), and section 3 proves the equality check can fail by giving one run a different start
//      board - so "identical" is not vacuously true.
//
// THIS HARNESS IS NON-LIGHT because it builds a whole-catalogue sequencer, which is the expensive half of the run.
//
// Run: node engine/test/getout-purity.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { corpusRoot } from 'dancing-squared-corpus';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = await import(pathToFileURL(path.join(here, '..', 'dist', 'index.js')).href);
const { callsByTitle } = await import(pathToFileURL(path.join(here, 'lib', 'engine-calls.mjs')).href);
engine.setParser(DOMParser);

const asset = (p) => fs.readFileSync(path.join(corpusRoot(), p), 'utf8');
const moves = asset('moves.xml');
const formations = asset('formations.xml');
const library = callsByTitle(corpusRoot());

let failures = 0;
const check = (cond, msg, detail = '') => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};

/** A sequencer with the whole Mainstream catalogue registered, which is what both `mainstream.mjs` and the app have. */
const built = () => new engine.Sequencer(moves, formations, library);

/**
 * THE WITNESS MATRIX. A search that finds a SHORT path exercises little: the state the item suspected is populated by
 * exploring, so the targets below are the ones a home square needs four and five calls for. `prefix` moves the
 * sequencer off home first, which is the case the item reported (a search part-way through a dance).
 */
const CASES = [
  { target: 'Static Square', maxCalls: 4, prefix: [] },
  { target: 'Normal Lines', maxCalls: 5, prefix: [] },
  { target: 'Eight Chain Thru', maxCalls: 5, prefix: [] },
  { target: 'Right and Left Grand Circle', maxCalls: 5, prefix: [] },
  { target: 'Normal Lines', maxCalls: 5, prefix: ['Mirror All 4 Couples Right and Left Thru'] },
  { target: 'Right and Left Grand Circle', maxCalls: 5, prefix: ['All 8 Hinge the Lock'] },
];

console.log('\n== 1. the search does not move the sequencer\'s board ==');
const witnesses = [];
for (const { target, maxCalls, prefix } of CASES) {
  const seq = built();
  seq.reset();
  if (!prefix.every((c) => seq.apply(c).legal)) continue;
  const sigBefore = engine.boardSig(seq.board);
  const got = seq.getout({ target, maxCalls });
  const sigAfter = engine.boardSig(seq.board);
  if (!Array.isArray(got)) continue;
  const label = `[${prefix.join(' > ') || 'home'}] -> ${target} (${got.length} call(s), maxCalls=${maxCalls})`;
  check(sigBefore === sigAfter, `the board is UNCHANGED by the search: ${label}`);
  console.log(`    ${label}: ${got.join(' > ')}`);
  witnesses.push({ target, prefix, got, label });
}
check(witnesses.length >= 4, `the sweep found ${witnesses.length} witnesses - an empty or thin sample would measure little`);
check(witnesses.some((w) => w.got.length >= 3),
  `and ${Math.max(...witnesses.map((w) => w.got.length))} is the deepest path in it, so the search really did explore`);

console.log('\n== 2. the path replays, and the answer is the same as if no search had run ==');
for (const { target, prefix, got, label } of witnesses) {
  // THE SEARCHED RUN: apply the prefix, search, reset, replay the prefix and then the path.
  const searched = built();
  searched.reset();
  for (const c of prefix) searched.apply(c);
  searched.getout({ target, maxCalls: 5 });
  searched.reset();
  const after = [];
  for (const c of prefix) after.push(searched.apply(c).legal);
  for (const c of got) after.push(searched.apply(c).legal);

  // THE CONTROL: the identical replay in a sequencer that never ran a search.
  const clean = built();
  clean.reset();
  const without = [];
  for (const c of prefix) without.push(clean.apply(c).legal);
  for (const c of got) without.push(clean.apply(c).legal);

  check(after.every(Boolean), `every step is legal after a search (${label})`, JSON.stringify({ after }));
  check(JSON.stringify(after) === JSON.stringify(without),
    `and the verdicts are IDENTICAL to the run with no search (${label})`,
    `searched ${JSON.stringify(after)} against ${JSON.stringify(without)}`);
  check(searched.isAt(target) === clean.isAt(target),
    `and the two runs agree about whether the path reaches ${target} (${label}): ${searched.isAt(target)} vs ${clean.isAt(target)}`);
}

console.log('\n== 3. the equality check is not vacuous: a different START BOARD changes the answer ==');
{
  // THE CONTROL for assertion 3, and it uses the OBSERVABLE the harness compares rather than the verdicts: a call list
  // that reaches the target from the board it was searched from must NOT reach it from a different board. If both
  // agreed, "the same with and without the search" would be true of any two runs and would prove nothing.
  const { target, got } = witnesses[0];
  const home = built();
  home.reset();
  for (const c of got) home.apply(c);
  const elsewhere = built();
  elsewhere.reset();
  elsewhere.setBoard(elsewhere.boardForFormation('Normal Lines'));
  for (const c of got) elsewhere.apply(c);
  check(got.length > 0 && home.isAt(target), `the witness path reaches ${target} from home (${got.join(' > ')})`);
  check(home.isAt(target) !== elsewhere.isAt(target),
    `and NOT from a board it was not searched from, so the comparison above is sensitive (${target}: home ${home.isAt(target)}, Normal Lines ${elsewhere.isAt(target)})`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
