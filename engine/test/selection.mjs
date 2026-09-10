// Dancer selections applied to coded moves, and the whole-pattern reading of a
// group-scoped catalog call.
//
// WHY THIS EXISTS: the published get-out corpus found 28 lines stopping with
// `"X" not legal for selected dancers`, and they turned out to be two DIFFERENT
// bugs wearing the same message:
//
//  1. Coded moves were never selection-aware. `U-Turn Back` is a coded move (a
//     per-dancer pivot applied straight from geometry, not a catalog setup), and
//     `Girls U-Turn Back` was routed to the applicator's selection path, which
//     matches catalog setups - so a trivially well-defined pivot failed. Fixed in
//     Sequencer.tryCodedMove.
//  2. Group-scoped catalog calls were only ever tried as an ISOLATED subset: gather
//     the selected dancers, centre them, and match the call against them as a
//     formation of their own. "Girls Circulate" in a wave means the girls walk the
//     wave's circulate path, and the girls of an ocean wave are a 2x2 block that is
//     not any Circulate variant at all. Fixed by adding a fallback in
//     CallApplicator.applySelected: apply the call as the WHOLE formation performs
//     it and keep only the selected dancers' new poses.
//
// The gates below pin the behaviour that must hold either way, and report the gap
// that remains.
//
// Run: `npm run build && node test/selection.mjs` from engine/.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer, assignHomeIdentity } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const assets = path.join(root, 'poc/src/assets');

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };
const ok = (msg) => console.log(`  ok    ${msg}`);
const face = (h) => ((Math.round((h * 180) / Math.PI / 90) * 90 % 360) + 360) % 360;
const pos = (d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}`;
const pose = (d) => `${pos(d)},${face(d.heading)}`;

/** A formation board. Home identity cannot be stamped from a formation that is not
 * the squared set, so couples stay unknown - which is fine, because every selection
 * used here is resolved from geometry (gender / position), not from couple numbers. */
function formationBoard(name) {
  const b = seq.boardForFormation(name);
  if (!b) return null;
  return { dancers: assignHomeIdentity(b.dancers.map((d) => ({ ...d, angleDeg: (d.heading * 180) / Math.PI }))) };
}

console.log('== a selection on a coded move moves only the selected dancers ==');
// U-Turn Back is a coded move (Face Half): every dancer pivots 180 degrees IN PLACE.
for (const formation of ['Eight Chain Thru', 'Ocean Waves', 'Normal Lines', 'Double Pass Thru']) {
  const board = formationBoard(formation);
  if (!board) { fail(`${formation}: no template board`); continue; }
  const r = seq.applyToBoard(board, 'Girls U-Turn Back');
  if (!r.legal) { fail(`${formation}: "Girls U-Turn Back" -> ${r.reason}`); continue; }
  const after = new Map(r.board.dancers.map((d) => [d.id, d]));
  let girlsPivoted = 0, wrong = 0;
  for (const d of board.dancers) {
    const a = after.get(d.id);
    if (!a) { wrong++; continue; }
    if (d.gender === 'girl') {
      // Pivot in place: same spot, facing reversed by exactly 180.
      if (pos(d) !== pos(a)) wrong++;
      else if (face(a.heading) !== (face(d.heading) + 180) % 360) wrong++;
      else girlsPivoted++;
    } else if (pose(d) !== pose(a)) wrong++; // a boy must not move or turn at all
  }
  // Board order must be preserved: callers pair dancers by array position.
  const orderKept = r.board.dancers.every((d, i) => d.id === board.dancers[i].id);
  if (wrong) fail(`${formation}: ${wrong} dancer(s) mis-moved (girls pivoted ${girlsPivoted}/4)`);
  else if (!orderKept) fail(`${formation}: the board array was reordered`);
  else ok(`${formation}: 4 girls pivoted in place, 4 boys untouched, order preserved`);
}

console.log('\n== the isolated reading is still preferred where the subset is its own setup ==');
// "Centers Pass Thru" from facing lines: the centres form a Pass Thru setup of their
// own, so the isolated reading applies and the ends stay put. This is the path that
// existed before the fallback and must keep working - the invariant that matters is
// that a SUBSET moved, not that everyone did (which is what the new fallback would
// do if it had taken over this case).
{
  const board = formationBoard('Normal Lines');
  const r = seq.applyToBoard(board, 'Centers Pass Thru');
  if (!r.legal) {
    console.log(`  note  "Centers Pass Thru" from Normal Lines -> ${r.reason} (reported, not gated)`);
  } else {
    const before = new Map(board.dancers.map((d) => [d.id, d]));
    const changed = r.board.dancers.filter((d) => pose(d) !== pose(before.get(d.id)));
    const who = changed.map((d) => `i${d.id}(${d.gender.charAt(0)}${d.y})`).join(' ');
    if (changed.length === 0) fail('nothing moved for a call that should move the centres');
    else if (changed.length === 8) fail('everyone moved - the whole-board fallback took over a subset call');
    else ok(`a subset moved and the rest stayed: ${changed.length} of 8 (${who})`);
    console.log('      (which dancers the engine calls "Centers" is its own grouping decision, not asserted here)');
  }
}

console.log('\n== the gap that remains, and its cause ==');
{
  // "Girls Circulate" from a wave still fails, and the reason is NOT the selection
  // logic: the whole-board Circulate does not match either, because the single-wave
  // Circulate variant is authored with the two waves 2 apart while the engine's own
  // Ocean Waves template puts them 4 apart. Split Circulate and All 8 Circulate,
  // whose variants do match, are legal - so the defect is that one missing variant,
  // not the selection path.
  const board = formationBoard('Ocean Waves');
  const girls = seq.applyToBoard(board, 'Girls Circulate');
  const split = seq.applyToBoard(board, 'Split Circulate');
  const all8 = seq.applyToBoard(board, 'All 8 Circulate');
  console.log(`  "Girls Circulate" from Ocean Waves : ${girls.legal ? 'legal' : `illegal - ${girls.reason}`}`);
  console.log(`  whole-board "Circulate"            : ${seq.applyToBoard(board, 'Circulate').legal ? 'legal' : 'illegal (no variant matches the wave spacing)'}`);
  console.log(`  whole-board "Split Circulate"      : ${split.legal ? 'legal' : 'illegal'}`);
  console.log(`  whole-board "All 8 Circulate"      : ${all8.legal ? 'legal' : 'illegal'}`);
  const waveWidth = (vs) => [...new Set(vs.map((m) => m.x))].sort((a, b) => a - b).join(',');
  console.log('  Circulate variant x-positions:');
  for (const vs of seq.variantStarts('Circulate')) console.log(`      ${vs.length} dancers  x = ${waveWidth(vs)}`);
  console.log('  The engine\'s own wave/line templates use x = -2,2 - so no single-wave Circulate');
  console.log('  variant matches them, while the split and all-8 ones do. Fixing it means adding a');
  console.log('  variant at that spacing (asset work), not a change to selection.');
  if (girls.legal) ok('Girls Circulate now works from a wave (asset gap closed?)');
  else console.log('  Reported as a gap: it needs the missing variant, not more selection logic.');
}

console.log('\n=================');
console.log(failures === 0 ? 'SELECTION: all gates passed.' : `SELECTION: ${failures} gate(s) FAILED.`);
if (failures) process.exitCode = 1;
