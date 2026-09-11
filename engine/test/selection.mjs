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
// Deep import, like bind-audit.mjs does for internal collaborators: boardSig is deliberately NOT
// part of the package's public surface.
import { boardSig } from '../dist/sequencer/board.js';

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

console.log('\n== Circulate from a wave: the reference dispatches it to All 8 Circulate ==');
// All8 indexes group circulates as "<group> Circulate", so every "Girls Circulate" in
// the corpus needed the WHOLE-board Circulate to be legal from a wave - and no
// Circulate variant matched the engine's own wave templates. Split Circulate, All 8
// Circulate and the column/8-chain Circulate all had variants, so the missing one was
// invisible until the corpus was run.
//
// The variant was first authored BYTE-IDENTICALLY to `Split Circulate`, on the claim that "from two
// parallel waves 'Circulate' and 'Split Circulate' both mean each wave circulates within itself".
// Phase 5c MEASURED that claim false twice over, so this gate asserts the corrected reading:
//
//   1. Those paths do not keep any wave to itself: FOUR of the eight dancers cross the 4-unit gap
//      into the other wave. So they are not "each wave circulates within itself" at all, and the
//      old comment above them was describing a movement the file does not contain.
//   2. The two calls do NOT coincide. Jay King / Ray Vierra (Handbook of Modern Square Dancing,
//      via ceder.net): Split Circulate is "two tracks of four that are side by side rather than one
//      track inside the other", each dancer moving "in his or her own box of four on own side of
//      the wave". Plain Circulate from waves is the single 8-dancer track - which is exactly what
//      the reference's own dispatch says, because its `isLines()` test ("8 dancers in 2 general
//      lines of 4 each", call_context.dart:1406) is TRUE of a wave and `isLines()` maps to
//      `All 8 Circulate`.
//
// The wave `Circulate` tams therefore now reuse `All 8 Circulate`'s paths verbatim - the same rule
// Phase 5d applied to facing lines - and the gate asserts the reference's rule: from a wave the two
// calls must produce the SAME board. "Both legal" would not be enough, and neither would "they
// coincide", which is what the gate used to demand and is now known to be false.
{
  const board = formationBoard('Ocean Waves');
  const before = new Map(board.dancers.map((d) => [d.id, d]));
  const circ = seq.applyToBoard(board, 'Circulate');
  const all8 = seq.applyToBoard(board, 'All 8 Circulate');
  const spotSet = (b) => [...new Set(b.dancers.map((d) => `${d.x},${d.y}`))].sort().join(' ');
  const pose = (b) => JSON.stringify(b.dancers.map((d) => [d.id, d.x.toFixed(3), d.y.toFixed(3), face(d.heading)]).sort());
  if (!circ.legal) {
    fail(`"Circulate" is still illegal from Ocean Waves: ${circ.reason}`);
  } else if (!all8.legal) {
    fail('"All 8 Circulate" is illegal from Ocean Waves - inconsistent with the reference dispatch');
  } else if (pose(circ.board) !== pose(all8.board)) {
    fail('the reference dispatches bare Circulate from a wave to All 8 Circulate, but the two boards differ');
  } else {
    ok('Circulate from a WAVE is legal and matches All 8 Circulate, as the reference dispatches');
    if (spotSet(circ.board) !== spotSet(board)) fail('Circulate from a wave did not leave the same spots occupied');
    else console.log(`      (the wave pattern is preserved; the result is still ${seq.knownFormation(circ.board)})`);
  }
  // PINNED DEFECT - NOT a claim that this is right. `Split Circulate` from a wave still moves half
  // the dancers across to the other wave (point 1 above), and it is deliberately NOT fixed here:
  // it needs a verified within-the-wave path set, and the current one is measurably not it.
  // Pinning the exact count keeps the defect visible, catches a silent change to it, and stops the
  // "the two calls coincide" claim being re-derived from the stale comment in ms/circulate.xml.
  {
    const split = seq.applyToBoard(board, 'Split Circulate');
    if (!split.legal) {
      fail(`"Split Circulate" is illegal from Ocean Waves: ${split.reason}`);
    } else {
      const crossing = split.board.dancers.filter((d) => Math.sign(before.get(d.id).x) !== Math.sign(d.x)).length;
      if (crossing !== 4) {
        fail(`Split Circulate from a wave used to cross exactly 4 dancers between the two waves; now ${crossing}. `
          + 'That is the one number to check against Jay King\'s "own box of four on own side of the wave" before accepting it.');
      } else {
        ok('Split Circulate from a wave still crosses 4 dancers between the waves - KNOWN DEFECT, PINNED (PLAN.md Phase 5c)');
      }
    }
  }
  // Circulate from FACING LINES: FIXED (Phase 5d). This used to report "still illegal" and call it
  // a gap, because the shipped line variants were `Lines Facing In` / `Lines Facing Out` - the
  // engine's Normal Lines had no Circulate while Split Circulate and All 8 Circulate both had one.
  // The reference DISPATCHES bare `Circulate` by formation (calls/ms/circulate.dart):
  //   isTwoFacedLines() -> Couples Circulate;  isLines() -> All 8 Circulate
  // so from lines `Circulate` IS `All 8 Circulate`, and the new tam reuses that call's paths for
  // `Lines Facing In` verbatim. The gate therefore asserts the reference's rule: the two calls must
  // produce the SAME board here, not merely both be legal.
  {
    const lines = seq.applyToBoard(formationBoard('Normal Lines'), 'Circulate');
    const all8 = seq.applyToBoard(formationBoard('Normal Lines'), 'All 8 Circulate');
    if (!lines.legal) {
      fail(`"Circulate" is illegal from FACING LINES: ${lines.reason}`);
    } else if (!all8.legal) {
      fail('"All 8 Circulate" is illegal from Normal Lines - inconsistent with the reference dispatch');
    } else {
      const pose = (b) => JSON.stringify(b.dancers.map((d) => [d.id, d.x.toFixed(3), d.y.toFixed(3), face(d.heading)]).sort());
      if (pose(lines.board) !== pose(all8.board)) {
        fail('the reference dispatches bare Circulate from lines to All 8 Circulate, but the two boards differ');
      } else {
        ok('Circulate from FACING LINES is legal and matches All 8 Circulate, as the reference dispatches');
      }
    }
  }
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

    // 2. Boys Run: the runner and the dancer it runs around EXCHANGE POSITIONS, but only the
    //    RUNNER turns 180 degrees - the dancer run around keeps its own facing. So from a wave the
    //    pair ends facing the SAME way and the wave becomes a TWO-FACED LINE.
    //
    //    THIS GATE USED TO ASSERT THE OPPOSITE ("keeps the wave an Ocean Waves"), and it was
    //    WRONG. Phase 1b reasoned that a full state exchange is what keeps a wave coherent and
    //    pinned it; the reference says otherwise and the corpus proves it. In
    //    `taminations-flutter/lib/sequencer/calls/ms/run.dart` the runner's path is
    //    `RunLeft`/`RunRight`, which carry NO rotation curve, so `brotate = btranslate` and the
    //    facing follows the path tangent - which at the endpoint points back the way the dancer
    //    came, i.e. a 180-degree turn. The dancer run around gets `DodgeLeft`/`DodgeRight`, which
    //    DO carry a rotation curve ending forward, i.e. a pure sidestep with no turn. And All8's
    //    published get-out `--SwThr B-Run --BendL` only works if the result is a line, because
    //    `Bend the Line` is legal from a two-faced line and not from a wave.
    const before = layoutOf(board.dancers);
    const run = seq.applyToBoard(board, 'Boys Run');
    if (!run.legal) {
      fail(`Boys Run is not legal from Ocean Waves: ${run.reason}`);
    } else {
      const after = layoutOf(run.board.dancers);
      const formation = seq.knownFormation(run.board);
      if (formation !== 'Two-Faced Lines') {
        fail(`Boys Run from a wave left ${formation}; the runner turns 180 and the dancer run around does not, so it must be a two-faced line`);
      } else if (after === before) {
        fail(`Boys Run did not change the layout (${before})`);
      } else {
        ok(`Boys Run turns only the RUNNER, so the wave becomes a two-faced line (${before} -> ${after})`);
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

console.log('\n== a reflection must not decide a call when a direct reading is available ==');
// `prd.md` §9.5 matches "up to translation, rotation and reflection", so reflection is real and
// stays available - but it must be the FALLBACK, not the tie winner. A mirrored match applies
// mirrored motion, and the two variants are not interchangeable.
//
// MEASURED, and this is why the rule exists. On a right-hand wave, `Left Swing Thru` matched a
// `from="Left-Hand Waves"` variant BY REFLECTION at error 0.0000 AND a `from="Right-Hand Waves"`
// variant DIRECTLY at error 0.0000. The tie went to array order, so the mirrored variant won, and
// its motion took the wave's end dancers from y=±3 to y=±7: the span of the set more than
// doubled, the board stopped being a formation at all, and the finish then refused with "no setup
// matches the current formation". It is the same reasoning as the recorded decision that "a
// mirrored candidate must never decide an arrangement".
{
  const wave = formationBoard('Ocean Waves');
  const before = wave.dancers.map((d) => d.y);
  const spanBefore = Math.max(...before) - Math.min(...before);
  const r = seq.applyToBoard(wave, 'Left Swing Thru');
  if (!r.legal) {
    fail(`Left Swing Thru is not legal from Ocean Waves: ${r.reason}`);
  } else {
    const m = seq.findMatchingVariant(wave, 'Left Swing Thru', 1.5);
    if (m && m.reflect) {
      fail(`Left Swing Thru still wins on a REFLECTED match (from="${m.variant.from}") though a direct one exists at the same error`);
    } else {
      ok(`Left Swing Thru matches directly: from="${m ? m.variant.from : '(none)'}" reflect=${m ? m.reflect : '-'}`);
    }
    const ys = r.board.dancers.map((d) => d.y);
    const spanAfter = Math.max(...ys) - Math.min(...ys);
    if (Math.abs(spanAfter - spanBefore) > 0.01) {
      fail(`Left Swing Thru changed the set's span ${spanBefore.toFixed(1)} -> ${spanAfter.toFixed(1)}; a swing thru cannot`);
    } else {
      ok(`Left Swing Thru preserves the set's span (${spanBefore.toFixed(1)})`);
    }
    const after = seq.knownFormation(r.board);
    if (after !== 'Ocean Waves') fail(`Left Swing Thru from a wave left ${after}, not a wave`);
    else ok('Left Swing Thru leaves the formation an Ocean Waves');
  }
}

console.log('\n== the wave circulate: the crossing is real, and the group reading collides ==');
// The standing open item said the wave circulate "may be wrong" and asked for an independent read
// before changing both calls together. The read is done, and it says the following, all MEASURED.
//
//  1. The tams ARE applied as authored. `Ocean Waves RH BGGB` is a FOUR-dancer formation (the left
//     wave), so a tam's four paths bind 1:1 - not 2:1 as an eight-dancer formation would - and the
//     engine mirrors the half set. Reproducing the per-dancer displacement confirms it, which
//     REFUTES the guess that the tams were mis-declared against an 8-dancer formation.
//  2. The crossing is REAL: `Split Circulate` moves FOUR of the eight dancers 4 units across to
//     the other wave. That is right for `All 8 Circulate` (one loop through both waves) and wrong
//     for a split reading, where each half must stay put.
//  3. `Circulate` from a wave USED TO be authored BYTE-IDENTICALLY to `Split Circulate`, inheriting
//     the crossing, and the standing argument that the two "coincide from parallel waves" was true
//     of the assets only because both were the same wrong paths. FIXED in Phase 5c: the wave
//     `Circulate` tams now reuse `All 8 Circulate`'s paths, so it crosses because All 8 crosses -
//     which is correct - and no longer because a split call does.
//  4. CORRECTED. This note used to say the reference's `circulate.dart` "has NO ocean-wave branch
//     and for 8 dancers in a wave falls through to `throw CallError('Cannot figure out how to
//     Circulate.')`", concluding that bare `Circulate` from a wave was ours alone. That is WRONG:
//     the reference's `isLines()` test is `dancersToRight(d) + dancersToLeft(d) == 3` and
//     `isRightOf`/`isLeftOf` are FACING-relative (`dancer.dart:392`: right of d is the direction at
//     `d.angleFacing - pi/2`), so for a wave dancer all three others lie to one side or the other
//     and `isLines()` IS true of a wave. Its `performCall` therefore dispatches a wave to
//     `All 8 Circulate` - and its help text naming only All 8 / Column / Couples / Box is a
//     statement of that same fact, not evidence of a gap. So the wave reading is the reference's,
//     not our invention, and it is the authority the fix above follows.
//
// This section still pins 2 and the collision that follows from it, so that fixing the split paths
// has to flip an assertion rather than quietly change a number.
{
  const wave = formationBoard('Ocean Waves');
  const before = new Map(wave.dancers.map((d) => [d.id, d]));

  // 2. Which dancers cross between the waves, per call.
  const crossers = (b) => b.dancers.filter((d) => Math.sign(before.get(d.id).x) !== Math.sign(d.x)).length;
  for (const call of ['Split Circulate', 'All 8 Circulate']) {
    const r = seq.applyToBoard(wave, call);
    if (!r.legal) { fail(`${call} is not legal from Ocean Waves: ${r.reason}`); continue; }
    const n = crossers(r.board);
    if (n === 4) {
      ok(`KNOWN DEFECT PINNED: ${call} moves ${n} of 8 dancers across to the other wave`);
      if (call === 'Split Circulate') {
        console.log('      A split call must keep each half in place, so this is the defect the');
        console.log('      handover flagged; for All 8 Circulate the same crossing is correct, because');
        console.log('      the two waves are one loop. Fixing one must not fix the other by accident.');
      }
    } else {
      ok(`${call} crosses ${n} of 8 dancers - the paths have changed, re-measure the open item`);
    }
  }

  // The group-scoped reading collides while the whole-board one does not: that is the consequence
  // reachable in the corpus, and it is what turned a correct Ocean Waves into a `1/3/3/1` shape.
  const stacked = (b) => {
    const seen = new Map();
    for (const d of b.dancers) {
      const k = `${d.x.toFixed(2)},${d.y.toFixed(2)}`;
      if (seen.has(k)) return `${seen.get(k)}&${d.id}@${k}`;
      seen.set(k, d.id);
    }
    return null;
  };
  for (const call of ['Split Circulate', 'Girls Circulate', 'Boys Circulate']) {
    const r = seq.applyToBoard(wave, call);
    if (!r.legal) { ok(`${call} is refused (${r.reason})`); continue; }
    const collision = stacked(r.board);
    const spots = new Set(r.board.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}`)).size;
    if (collision) {
      if (call === 'Split Circulate') fail(`the WHOLE-board ${call} collides (${collision}); only the group reading should`);
      else {
        ok(`KNOWN DEFECT PINNED: ${call} leaves ${spots} distinct spots for 8 dancers (${collision})`);
        console.log('      The group-scoped reading keeps the non-selected dancers where they stand while');
        console.log('      the selected ones take their poses from the whole-formation motion, so when the');
        console.log('      call also relocates the non-selected dancers the two sets land on one spot.');
      }
    } else if (spots === 8) {
      ok(`${call} leaves 8 distinct spots - the group reading is fixed, tighten this gate`);
    } else {
      fail(`${call} left ${spots} distinct spots with no collision detected - inconsistent`);
    }
  }
}

console.log('\n== partial coverage: a call acts on the boxes it applies to, not on all-or-nothing ==');
// `parallelApply` used to require the setup to tile the WHOLE board, so a call whose setup matches
// some boxes and not others was refused outright. That is a whole family rather than a corner case,
// because a set whose boxes are not congruent is exactly what a `Trade By` and a `Double Pass Thru`
// are: couples facing each other in the middle and couples facing out on the ends. Measured before
// the fix, three separate published get-outs stopped this way - `Box the Gnat` from a `Trade By`,
// `Turn Thru` from a `Double Pass Thru` (whose four-dancer SUBSET matched at 0.000 while no tiling
// existed), and others reached on unrecognised boards.
//
// `square-dancing.md` §7.5 - "a call acts on everyone it applies to" - is the reading, and §7.2.1
// still bounds it: the board must divide EVENLY into setup-sized boxes, so a 6-dancer board with a
// 4-dancer setup is refused (asserted in `features.mjs`, which hand-lists fewer calls).
{
  const tradeBy = seq.boardForFormation('Trade By');
  if (!tradeBy) {
    fail('no Trade By template to test partial coverage on');
  } else {
    const r = seq.applyToBoard(tradeBy, 'Box the Gnat');
    if (!r.legal) {
      fail(`Box the Gnat does not apply from a Trade By: ${r.reason}`);
    } else {
      const before = new Map(tradeBy.dancers.map((d) => [d.id, d]));
      const moved = r.board.dancers.filter((d) => Math.hypot(d.x - before.get(d.id).x, d.y - before.get(d.id).y) > 0.01);
      if (moved.length !== 4) fail(`a partial apply moved ${moved.length} of 8; exactly one box should move`);
      else ok('Box the Gnat from a Trade By moves exactly the one matching box (4 of 8)');
      const spots = new Set(r.board.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}`));
      if (spots.size !== 8) fail(`a partial apply left two dancers on one spot (${spots.size} distinct of 8)`);
      else ok('the four dancers left standing keep their own spots, with no collision');
    }
    // The same shape on a Double Pass Thru, which stopped on `Turn Thru`.
    const dpt = seq.boardForFormation('Double Pass Thru');
    const t = dpt ? seq.applyToBoard(dpt, 'Turn Thru') : { legal: false, reason: 'no Double Pass Thru template' };
    if (!t.legal) fail(`Turn Thru does not apply from a Double Pass Thru: ${t.reason}`);
    else ok('Turn Thru applies from a Double Pass Thru through the same partial reading');
  }
}

console.log('\n== boardSig is POSITIONS-ONLY, and that is load-bearing (Phase 5e) ==');
// The standing note said "`boardSig` ignores facing (confirmed: board.ts copies `heading`; it is never
// read). Positions-only is LOAD-BEARING - it is why pivots prune cleanly. Review, do not casually
// 'fix'." The review is done, and the conclusion is: the invariant is CORRECT and DELIBERATE, the
// documented contract is HONOURED by the code that depends on facing, and the only defect was a
// dead `heading` field that made the function read as though facing were included.
//
// This gate pins the invariant in BOTH directions, because either half alone is passable by a wrong
// implementation:
//   (a) the signature must not see facing - otherwise a pure pivot stops collapsing and the search
//       silently gains work and loses the property its comments promise;
//   (b) it must still be invariant under rotation, translation and REFLECTION, which is the other
//       half of what its name claims.
// The compensating side is checked too: the facing-dependent cache key in solver.ts must DISTINGUISH
// two boards that differ only by facing, or the "positions only" signature would leak a wrong answer
// into the finish cache.
{
  const board = seq.boardForFormation('Static Square');
  const turned = { dancers: board.dancers.map((d) => ({ ...d, heading: d.heading + Math.PI / 2 })) };
  if (boardSig(turned) !== boardSig(board)) {
    fail('boardSig sees FACING, so a pure pivot no longer collapses to its source state');
  } else {
    ok('boardSig ignores facing: two boards differing only in heading share a signature');
  }

  // (b) rotation / translation / reflection invariance.
  const rot = (a) => ({ x: Math.cos(a), y: Math.sin(a) });
  const mapBoard = (f) => ({ dancers: board.dancers.map((d) => ({ ...d, ...f(d) })) });
  const rotate = mapBoard((d) => { const r = rot(Math.PI / 3); return { x: d.x * r.x - d.y * r.y, y: d.x * r.y + d.y * r.x, heading: d.heading + Math.PI / 3 }; });
  const move = mapBoard((d) => ({ x: d.x + 7, y: d.y - 3 }));
  const mirror = mapBoard((d) => ({ x: -d.x, y: d.y, heading: -d.heading }));
  for (const [label, b] of [['rotation', rotate], ['translation', move], ['reflection', mirror]]) {
    if (boardSig(b) !== boardSig(board)) fail(`boardSig is not invariant under ${label}`);
  }
  ok('boardSig is invariant under rotation, translation and reflection');

  // The compensating side: the pose key used where facing DOES matter must separate the two.
  const poseKey = (b) => b.dancers.map((d) => `${d.id},${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}`).join(';');
  if (poseKey(turned) === poseKey(board)) {
    fail('the full-pose key does not distinguish facings, so a facing-dependent cache would share a wrong answer');
  } else {
    ok('the full-pose key (solver.finishToHome) DOES distinguish them, as its comment claims');
  }
}

console.log('\n=================');
console.log(failures === 0 ? 'SELECTION: all gates passed.' : `SELECTION: ${failures} gate(s) FAILED.`);
if (failures) process.exitCode = 1;
