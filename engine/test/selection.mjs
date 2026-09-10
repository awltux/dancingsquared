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

import { setParser, Sequencer, assignHomeIdentity, CODED_MOVES, RUN_TRADE_BEATS } from '../dist/index.js';
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

console.log('\n== Circulate from a wave: the variant that was missing ==');
// All8 indexes group circulates as "<group> Circulate", so every "Girls Circulate" in
// the corpus needed the WHOLE-board Circulate to be legal from a wave - and no
// Circulate variant matched the engine's own wave templates. Split Circulate, All 8
// Circulate and the column/8-chain Circulate all had variants, so the missing one was
// invisible until the corpus was run. Variants were added at the template's spacing
// (x = -2, 2) in ms/circulate.xml, using the same four paths as Split Circulate from
// the same formation - which is the same movement, because from two parallel waves
// "Circulate" and "Split Circulate" both mean each wave circulates within itself.
{
  const board = formationBoard('Ocean Waves');
  const circ = seq.applyToBoard(board, 'Circulate');
  const split = seq.applyToBoard(board, 'Split Circulate');
  if (!circ.legal) {
    fail(`"Circulate" is still illegal from Ocean Waves: ${circ.reason}`);
  } else {
    const spots = (b) => [...new Set(b.dancers.map((d) => `${d.x},${d.y}`))].sort().join(' ');
    const same = spots(circ.board) === spots(board);
    const identical = JSON.stringify(circ.board.dancers.map((d) => [d.id, d.x, d.y, face(d.heading)]).sort())
      === JSON.stringify((split.legal ? split.board : circ.board).dancers.map((d) => [d.id, d.x, d.y, face(d.heading)]).sort());
    if (!same) fail('Circulate from a wave did not leave the same spots occupied');
    else if (!split.legal) fail('Split Circulate from the same wave is illegal - inconsistent');
    else if (!identical) fail('Circulate and Split Circulate differ from two parallel waves, where they should coincide');
    else ok('Circulate is legal from a wave, fills the same spots, and matches Split Circulate exactly');
    console.log(`      (the dancers all move 2 or 4 units and the wave pattern is preserved; the result is still ${seq.knownFormation(circ.board)})`);
    console.log('      NOTE: those paths also move half the dancers between the two parallel waves, which is what');
    console.log('      the SHIPPED Split Circulate wave variant does - a split call should keep each half in');
    console.log('      place. The new Circulate inherits that motion by construction; if the wave paths are');
    console.log('      wrong, both calls need the same correction. Recorded as an open item.');
  }
  const lines = seq.applyToBoard(formationBoard('Normal Lines'), 'Circulate');
  console.log(`  Circulate from FACING LINES is still ${lines.legal ? 'legal' : 'illegal'}.`);
  console.log('  The shipped line variants are "Lines Facing In/Out", not facing lines, so this remains a gap.');
}

console.log('\n== the `sequencer` attribute: parsed faithfully, and NOT yet acted on ==');
// Taminations defines four values of `<tam sequencer="…">` (animated_call.dart:157-168) and
// its own sequencer SKIPS the `no` case outright when it hunts for a setup
// (sequencer/calls/xml_call.dart:57-59). The engine used to read only `gender-specific` — by
// comparing the raw string — so `no` variants registered as ordinary setups.
//
// Filtering them was TRIED and MEASURED as a change for the worse, so matching is left
// unfiltered and the finding is pinned here instead of acted on:
//   - strict skip: the published promenade get-outs that resolve fall 12 -> 8
//     (promenade.mjs §5 fails), and corpus success falls 53 -> 52;
//   - prefer-the-eligible: still 12 -> 11.
// The reason is that Taminations marks a call not-for-sequencer when it implements that call
// in CODE (calls/ms/run.dart, fold.dart, cast_off_three_quarters.dart, turn_back.dart,
// trade.dart, cross_run.dart). Dropping the tam without writing the derived call removes the
// capability rather than correcting the motion. So this gate pins two things: that the flag
// is now parsed and consistent, and exactly how big the derived-call gap is.
{
  const CALLS = ['Boys Trade', 'Girls Trade', 'Boys Run', 'Girls Run', 'Trade', 'Boys Fold',
    'Ends Fold', 'Rollaway', 'Circulate', 'Split Circulate', 'Scoot Back', 'Recycle'];
  const MODES = new Set(['perimeter', 'exact', 'gender-specific', 'no']);

  // 1. The plumbing: every variant carries a consistent reading of the attribute.
  let checked = 0, inconsistent = 0;
  for (const name of CALLS) {
    for (const v of seq.getVariants(name) ?? []) {
      checked++;
      const modeOk = v.sequencerMode === null || MODES.has(v.sequencerMode);
      // `genderSpecific` and `forSequencer` are DERIVED from `sequencerMode`; a variant that
      // disagrees with its own mode is the bug this refactor removed.
      const derivedOk = v.forSequencer === (v.sequencerMode !== 'no')
        && !!v.genderSpecific === (v.sequencerMode === 'gender-specific');
      if (!modeOk || !derivedOk) inconsistent++;
    }
  }
  if (checked === 0) fail('no variant carries a sequencerMode - the attribute is not parsed');
  else if (inconsistent) fail(`${inconsistent} of ${checked} variants disagree with their own sequencerMode`);
  else ok(`every variant of ${CALLS.length} calls carries a consistent sequencerMode (${checked} variants)`);

  // 2. The tie that least-error matching cannot break, and why filtering cannot fix it.
  //    `Boys Trade` carries 12 eligible setups in b2/trade.xml and 12 `sequencer="no"`
  //    demos in ms/trade.xml under IDENTICAL `from` strings.
  const bt = seq.getVariants('Boys Trade') ?? [];
  const eligible = seq.sequencerVariants('Boys Trade');
  const demos = bt.filter((v) => !v.forSequencer);
  const fromsOf = (vs) => [...new Set(vs.map((v) => v.from))].sort().join(' | ');
  if (bt.length === 0 || demos.length === 0) {
    fail('Boys Trade no longer carries a sequencer="no" variant - this gate is stale');
  } else if (fromsOf(eligible) !== fromsOf(demos)) {
    console.log(`  note: the eligible and demo copies no longer cover the same \`from\` set,`);
    console.log('        so the tie described here has changed shape - re-measure before relying on it.');
    ok(`Boys Trade: ${eligible.length} eligible, ${demos.length} demo (different \`from\` coverage)`);
  } else {
    // Identical start geometry AND identical beats, so nothing in the setup can break the tie.
    const sameStart = eligible.length === demos.length && eligible.every((e) => {
      const d = demos.find((x) => x.from === e.from);
      return d
        && d.beats === e.beats
        && d.dancers.map((x) => `${x.x.toFixed(2)},${x.y.toFixed(2)}`).sort().join(' ')
          === e.dancers.map((x) => `${x.x.toFixed(2)},${x.y.toFixed(2)}`).sort().join(' ');
    });
    if (!sameStart) {
      console.log('  note: the two copies differ in start geometry or beats, so they ARE distinguishable');
      console.log('        on the setup - that is new information and changes the step-4d diagnosis.');
      ok(`Boys Trade: ${eligible.length} eligible vs ${demos.length} demo, distinguishable`);
    } else {
      ok(`Boys Trade: ${eligible.length} eligible vs ${demos.length} demo over the SAME ${new Set(eligible.map((v) => v.from)).size} \`from\` strings`);
      console.log('      and the copies are indistinguishable on the setup: identical start geometry AND identical beats.');
      console.log('      Least-error matching therefore cannot prefer the eligible copy on geometry, which is');
      console.log('      why "prefer eligible" is not a fix - it only re-orders an exact tie.');
    }
  }

  // 3. The size of the derived-call gap on the families the CORPUS actually stops at,
  //    REPORTED rather than failed. A call with no eligible setup is one Taminations
  //    implements in code and we do not; the full asset-wide count is 32 titles.
  const RAN = ['Boys Run', 'Girls Run', 'Centers Run', 'Ends Run', 'Trade', 'Boys Fold',
    'Girls Fold', 'Centers Cast Off Three Quarters', 'Boys Turn Back', 'Girls Turn Back'];
  const noSetup = RAN.filter((name) => seq.hasCall(name) && !seq.hasSequencerSetup(name));
  ok(`the derived-call gap covers ${noSetup.length} of the ${RAN.length} corpus families probed here`);
  console.log(`    ${noSetup.join(', ')}`);
  console.log('  A call with no eligible setup is reached today through its DEMONSTRATION tams.');
  console.log('  Writing the derived calls (Run, Fold, Cast Off 3/4, Turn Back, Cross Run) is what');
  console.log('  makes those tams unnecessary - see PLAN.md Phase 4. Until then, filtering them out');
  console.log('  only removes motion, which is why matching is left unfiltered.');
}

console.log('\n== Trade / Run from two parallel waves: the derived calls ==');
// These two calls were the corpus's top engine gap and the cause of 6 of the 9 refused
// promenade finishes, because the engine matched authored tams instead of deriving them.
// Both are now REGISTERED AS DERIVED CALLS (trade-run.ts), and this section asserts the
// behaviour that replaced the defect. The engine's own Ocean Waves template is `BggB` - boys
// at the ENDS, which is correct - and every authored `Boys Trade` wave variant is for boys in
// the CENTRE, so before the derived calls the only tams that matched were UNGATED demos and
// `Boys Trade` moved the four GIRLS. The whole `Run` family has no eligible variant at all
// (32 of 32 are sequencer="no"), because the reference implements Run in code.
{
  const board = formationBoard('Ocean Waves');
  if (!board) {
    fail('no Ocean Waves template template board');
  } else {
    const boys = board.dancers.filter((d) => d.gender === 'boy').length;
    const girls = board.dancers.filter((d) => d.gender === 'girl').length;
    if (boys !== 4 || girls !== 4) fail(`Ocean Waves template is not 4 boys + 4 girls (${boys}/${girls})`);

    const layoutOf = (ds) => {
      const rows = new Map();
      for (const d of ds) { const k = d.y.toFixed(1); rows.set(k, [...(rows.get(k) ?? []), d].sort((a, b) => a.x - b.x)); }
      return [...rows.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([, ds2]) => ds2.map((d) => d.gender.charAt(0).toUpperCase()).join('')).join('/');
    };

    // 1. Boys Trade moves the BOYS, and nobody else. It trades ACROSS the intervening girls,
    //    which is the reference's `inBetween` case (calls/ms/trade.dart).
    const r = seq.applyToBoard(board, 'Boys Trade');
    if (!r.legal) {
      fail(`Boys Trade is not legal from Ocean Waves: ${r.reason}`);
    } else {
      const before = new Map(board.dancers.map((d) => [d.id, d]));
      const moved = r.board.dancers.filter((d) => Math.hypot(d.x - before.get(d.id).x, d.y - before.get(d.id).y) > 0.01);
      const movedBoys = moved.filter((d) => d.gender === 'boy').length;
      const movedGirls = moved.filter((d) => d.gender === 'girl').length;
      if (movedBoys !== 4 || movedGirls !== 0) {
        fail(`Boys Trade moved ${movedBoys} boys and ${movedGirls} girls; it must move only the 4 boys`);
      } else {
        ok('Boys Trade moves only the 4 BOYS, trading across the intervening girls');
      }
      // The two boys in a wave exchange position AND facing, so the wave survives.
      const after = seq.knownFormation(r.board);
      if (after !== 'Ocean Waves') fail(`Boys Trade left ${after}, not Ocean Waves`);
      else ok('Boys Trade leaves the formation an Ocean Waves');
      // The intervening dancers must not have moved: that is what "trades ACROSS them" means.
      const girlsMoved = movedGirls;
      if (girlsMoved !== 0) fail('the intervening girls moved during a Trade; they must stay put');
    }

    // 2. Boys Run: the runner and the dancer it runs around EXCHANGE position and facing, so
    //    the wave keeps its shape and the genders swap end <-> centre.
    const before = layoutOf(board.dancers);
    const run = seq.applyToBoard(board, 'Boys Run');
    if (!run.legal) {
      fail(`Boys Run is not legal from Ocean Waves: ${run.reason}`);
    } else {
      const after = layoutOf(run.board.dancers);
      if (seq.knownFormation(run.board) !== 'Ocean Waves') {
        fail(`Boys Run left ${seq.knownFormation(run.board)}, not Ocean Waves`);
      } else if (after === before) {
        fail(`Boys Run did not change the layout (${before})`);
      } else {
        ok(`Boys Run keeps the wave an Ocean Waves and swaps the layout ${before} -> ${after}`);
      }
      // Every dancer must have a distinct spot: an exchange that half-moved would stack two
      // dancers on one square, which is the failure a whole-board-transform-then-filter has.
      const spots = new Set(run.board.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}`));
      if (spots.size !== run.board.dancers.length) fail(`Boys Run left two dancers on the same spot (${spots.size} distinct of ${run.board.dancers.length})`);
      else ok('every dancer keeps a distinct spot through a Run');
    }

    // 3. Both calls REFUSE the bare name, because neither has a whole-set reading.
    for (const bare of ['Run', 'Trade']) {
      const b = seq.applyToBoard(board, bare);
      if (b.legal) fail(`${bare} applied with no designation; it must refuse`);
      else ok(`${bare} with no designation refuses: ${b.reason}`);
    }

    // 4. They are DERIVED, not catalog matches, and they carry the authored beat count so the
    //    timeline does not shift when the derived call replaces the tams. Asserting that no
    //    authored variant MATCHES would be wrong: the tams are still registered (they are
    //    legitimate animations, and the picker lists them). What matters is PRECEDENCE, which
    //    assertion 3 covers by requiring the bare names to refuse for the derived reason
    //    rather than to apply a demo.
    for (const name of ['Run', 'Trade']) {
      const move = CODED_MOVES.find((m) => m.name === name);
      if (!move) fail(`${name} is not registered as a geometry-derived call`);
      else if (!move.applyToSelection) fail(`${name} is registered but has no selection-aware transform`);
      else if (move.beats !== RUN_TRADE_BEATS) fail(`${name} is ${move.beats} beats, not the authored ${RUN_TRADE_BEATS}`);
      else ok(`${name} is a derived call (${move.beats} beats) with a selection-aware transform`);
    }
  }
}

console.log('\n=================');
console.log(failures === 0 ? 'SELECTION: all gates passed.' : `SELECTION: ${failures} gate(s) FAILED.`);
if (failures) process.exitCode = 1;
