// PARALLEL CALLS FOR THE REMAINING DANCERS, pinned.
//
// The reported need: "When calling `Sides Promenade Home` the heads are in their path, unless they are
// called into the middle of the set. Currently, there is no way to apply a second call to the remaining
// dancers in the same time slot."
//
// THE ENGINE ALREADY HAD THE CONSTRUCT - this harness is about the pieces that were MISSING, because
// `modules.mjs` already pins the `GroupStep` rules themselves (disjoint, atomic, calls-only,
// simultaneous, mergeable). What was not pinned, and what this adds:
//
//   1. THE REMAINDER IS NAMEABLE. `Sequencer.remainingSelection` derives the selector for the dancers a
//      selection does not cover. It is derived from the resolved IDS rather than looked up, because the
//      complement of a named group frequently has no name of its own - `Head Boys` leaves SIX dancers in
//      no arrangement the vocabulary describes.
//   2. A COMPOSED STEP MOVES BOTH GROUPS. Pinned with a witness where both groups demonstrably move, so
//      a bug that dropped the second group could not pass. (The existing `modules.mjs` witness would not
//      catch that: `Star Thru` CLOSES - it ends where it started - so a position-only "did it move"
//      check reads it as a no-op, which is exactly the trap this file avoids.)
//   3. ONE UNDO. A composed step is ONE history entry, so a single undo removes both calls. Nothing
//      pinned that before.
//   4. THE TARGET SHAPE. `Sides Promenade Full` while the heads do something else - the case that
//      prompted this - applies as one step today.
//
// Usage: node engine/test/parallel-calls.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, stepLabel, isGroupStep, splitSelection } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, '..', '..', 'poc', 'src', 'assets');
const read = (p) => readFileSync(path.join(assets, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(read('moves.xml'), read('formations.xml'), callsByTitle(assets));
const square = seq.boardForFormation('Static Square');
// THE BOARD IS LIVE ENGINE STATE. `applyStep` mutates `seq.board`, so every section below starts by
// re-establishing the square - otherwise a later witness is applied to whatever an earlier one left
// behind, and fails for a reason that has nothing to do with what it is testing. (Measured: without
// this, `Sides Promenade Full` reports "not legal for selected dancers" purely because the board had
// already been walked.) `seq.board` is READ-only for the same reason; `square` is the frozen copy.
const atSquare = () => seq.setBoard(square);
const ids = (b) => b.dancers.filter((d) => !d.isGhost).map((d) => d.id).sort((a, b) => a - b);
const norm = (x) => {
  let d = x;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};
/** Who a board visibly changes against `from`: position and facing are separate, because a CLOSING call
 *  moves everyone's facing and nobody's position, and a position-only test reads that as "no motion". */
const touched = (from, board) => {
  const pos = [], face = [];
  for (const d of board.dancers) {
    const o = from.dancers.find((x) => x.id === d.id);
    if (!o) continue;
    if (Math.hypot(d.x - o.x, d.y - o.y) > 1e-3) pos.push(d.id);
    if (norm(d.heading - o.heading) > 1e-3) face.push(d.id);
  }
  return { pos: pos.sort((a, b) => a - b), face: face.sort((a, b) => a - b) };
};
const poseKey = (b) => b.dancers.map((d) => `${d.id}:${d.x.toFixed(6)},${d.y.toFixed(6)},${d.heading.toFixed(6)}`).join(';');

// ------------------------------------------------------------------ 1. the remainder is nameable
console.log('== 1. the remaining dancers are nameable ==');
{
  const cases = ['Heads', 'Sides', 'Head Boys', 'Head Boys and Side Girls'];
  for (const sel of cases) {
    const rest = seq.remainingSelection(square, sel);
    const claimed = new Set(seq.selectionIds(square, sel) ?? []);
    const want = ids(square).filter((id) => !claimed.has(id));
    const got = seq.selectionIds(square, rest ?? '') ?? [];
    check(rest !== null && JSON.stringify([...got].sort((a, b) => a - b)) === JSON.stringify(want),
      `"${sel}" leaves ${want.length} dancer(s) and "${rest}" resolves to exactly them ([${[...got].sort((a, b) => a - b).join(',')}])`);
  }
  // The case with NO name of its own: the complement of Head Boys is six dancers in no described shape.
  const six = seq.remainingSelection(square, 'Head Boys');
  check(six === 'All Except Head Boys' && (seq.selectionIds(square, six) ?? []).length === 6,
    `a complement with no vocabulary entry still resolves (Head Boys -> "${six}", 6 dancers)`);
  // A whole-board selection leaves nobody, so there is no partner for a "while".
  check(seq.remainingSelection(square, 'All 8') === null || seq.remainingSelection(square, 'All 8') === undefined,
    'a selection covering everyone has no remainder');
  check(seq.remainingSelection(square, 'Not A Group At All') === null,
    'an unresolvable selection has no remainder rather than inventing one');
}

// --------------------------------------------------- 2. a composed step moves BOTH groups
console.log('\n== 2. a composed step moves both groups ==');
{
  // BOTH groups demonstrably move, in position AND facing - so a bug that dropped the second group, or
  // that applied the first group's call to the whole board, could not pass this.
  const groups = [
    { selection: 'Heads', call: 'Right and Left Thru' },
    { selection: 'All Except Heads', call: 'Touch a Quarter' },
  ];
  atSquare();
  const solo = groups.map((g) => seq.applyToBoard(square, `${g.selection} ${g.call}`));
  const step = { groups };
  atSquare();
  const grouped = seq.applyStep(step);
  check(solo.every((r) => r.legal), `each group is legal alone (${solo.map((r, i) => `${groups[i].selection}:${r.legal}`).join(', ')})`);
  check(grouped.legal, `the composed step applies (${grouped.reason ?? 'legal'})`);
  check(isGroupStep(step), 'and it IS the grouped form, not two sequential calls');
  check(stepLabel(step) === 'Heads Right and Left Thru || All Except Heads Touch a Quarter',
    `it labels as one "while" step: "${stepLabel(step)}"`);
  if (grouped.legal) {
    const t = touched(square, grouped.board);
    // Together the two groups are the whole board, so every dancer must move.
    check(t.pos.length === 8, `every dancer moves, because the groups partition the board (${t.pos.length} of 8)`);
    check(t.face.length === 8, `...and every dancer's facing changes (${t.face.length} of 8)`);

    // THE MERGE INVARIANT at this witness: the composed board is the solo boards merged by id.
    const merged = new Map();
    for (let i = 0; i < groups.length; i++) {
      const sel = new Set(seq.selectionIds(square, groups[i].selection) ?? []);
      for (const d of solo[i].board.dancers) if (sel.has(d.id)) merged.set(d.id, d);
    }
    let wrong = 0;
    for (const d of grouped.board.dancers) {
      const want = merged.get(d.id);
      if (!want) continue;
      if (Math.hypot(d.x - want.x, d.y - want.y) > 1e-9) wrong++;
      if (Math.abs(d.heading - want.heading) > 1e-9) wrong++;
    }
    check(wrong === 0, `the composed board IS the two solo boards merged by id (${wrong} disagree)`);
  }
}

// ------------------------------------------------------------------ 3. beats are the LONGEST group
console.log('\n== 3. the step costs the longest group, not the sum ==');
{
  const groups = [
    { selection: 'Head Boys and Side Girls', call: 'Right and Left Thru' },
    { selection: 'All Except Head Boys and Side Girls', call: 'Touch a Quarter' },
  ];
  const soloBeats = groups.map((g) => seq.sequenceBeats([`${g.selection} ${g.call}`], square));
  const stepBeats = seq.sequenceBeats([{ groups }], square);
  check(stepBeats === Math.max(...soloBeats),
    `simultaneous, so the cost is the longest (${soloBeats.join(' + ')} -> ${stepBeats})`);
}

// ------------------------------------------------------------------------------------ 4. one undo
console.log('\n== 4. the composed step is ONE undo ==');
{
  // A minimal history, the way the POC holds it: an array of steps that is replayed from the start.
  const history = [];
  const replay = () => {
    seq.setBoard(square);
    for (const s of history) seq.applyStep(s);
    return seq.startBoard();
  };
  replay();
  const before = seq.board;
  const groups = [
    { selection: 'Heads', call: 'Right and Left Thru' },
    { selection: 'All Except Heads', call: 'Touch a Quarter' },
  ];
  const r = seq.applyStep({ groups });
  check(r.legal, 'the composed step applies');
  history.push({ groups });
  const after = replay();  check(poseKey(after) !== poseKey(before), 'the board changed');
  check(history.length === 1, `the pair is ONE history entry, so one undo removes both (length ${history.length})`);
  // One pop - exactly what `SequencerUi.undo` does.
  history.pop();
  const undone = replay();
  check(poseKey(undone) === poseKey(before), 'one undo restores the board to before BOTH calls');
}

// ------------------------------------------------------------------------- 5. the target shape
console.log('\n== 5. the reported case: Sides promenade while the heads do something else ==');
{
  // `Promenade Full` is the 4-dancer group call (authored `Facing Couples Far`) that the in-progress
  // Promenade redesign is introducing, and it already reaches a subset here.
  const groups = [
    { selection: 'Sides', call: 'Promenade Full' },
    { selection: 'Heads', call: 'Star Thru' },
  ];
  atSquare();
  const applied = seq.applyStep({ groups });
  check(applied.legal, `"Sides Promenade Full while Heads Star Thru" applies (${applied.reason ?? 'legal'})`);
  if (applied.legal) {
    const t = touched(square, applied.board);
    const sides = new Set(seq.selectionIds(square, 'Sides') ?? []);
    const heads = new Set(seq.selectionIds(square, 'Heads') ?? []);
    check(t.face.some((id) => sides.has(id)), 'the SIDES are touched by the promenade');
    check(t.face.some((id) => heads.has(id)), '...and the HEADS are touched at the same time');
    const beats = seq.sequenceBeats([{ groups }], square);
    check(beats >= 8, `the step is charged the promenade's own length, in ONE slot (${beats} beats)`);
    check(stepLabel({ groups }) === 'Sides Promenade Full || Heads Star Thru',
      `one sequence entry reads as one step: "${stepLabel({ groups })}"`);
  }
}

// ------------------------------------------------------------------------------- 6. convergence
console.log('\n== 6. a composed step still converges on the board it produced ==');
{
  // `evaluateGroupAt` interpolates straight lines and says so - it is correct by construction at both
  // ends. This pins the end, which is the guarantee the rest of the engine relies on.
  for (const groups of [
    [{ selection: 'Heads', call: 'Right and Left Thru' }, { selection: 'All Except Heads', call: 'Touch a Quarter' }],
    [{ selection: 'Sides', call: 'Promenade Full' }, { selection: 'Heads', call: 'Star Thru' }],
  ]) {
    const step = { groups };
    atSquare();
    const applied = seq.applyStep(step);
    if (!applied.legal) { check(false, `witness applies: ${applied.reason}`); continue; }
    const beats = seq.sequenceBeats([step], square);
    const last = seq.evaluateSequence([step], beats, square).board;
    let worst = 0;
    for (const d of last.dancers) {
      const e = applied.board.dancers.find((x) => x.id === d.id);
      worst = Math.max(worst, Math.hypot(d.x - e.x, d.y - e.y));
    }
    check(worst < 1e-6, `${stepLabel(step)}: the last animated frame IS the applied board (worst ${worst.toExponential(1)})`);
  }
}

// ---------------------------------------------------- 7. a call that NAMES its own dancers
console.log('\n== 7. a call carrying its own selection still leaves a nameable remainder ==');
{
  // THE REPORTED FAILURE. "Heads Promenade Full", then "Sides Forward and Back", and the parallel button
  // did nothing.
  //
  // The APPLICATOR was never the problem - both calls carry their own designator and both apply. What
  // broke was the caller's own gate: it read the group from the GROUP SELECTOR alone, which is null for a
  // call the catalogue publishes WITH its designator, so the remainder was computed as null and the
  // button stayed dead. `remainingSelection` was never asked.
  //
  // A subset call has TWO sources for "who acts": the group selector, and the call's own name. This pins
  // that the second one yields a remainder too, which is the whole of the fix.
  for (const written of ['Sides Forward and Back', 'Heads Promenade Full']) {
    const spec = splitSelection(written);
    check(!!spec.selection && !!spec.call,
      `"${written}" carries its own selection ("${spec.selection}" + "${spec.call}")`);
    atSquare();
    const applied = seq.apply(written);
    check(applied.legal, `"${written}" applies from a square (${applied.reason ?? 'legal'})`);
    // The gate must be able to name the remainder FROM THE CALL'S OWN SELECTION.
    const remaining = seq.remainingSelection(square, spec.selection);
    check(remaining !== null, `...and its remainder is nameable ("${remaining}")`);
    const claimed = new Set(seq.selectionIds(square, spec.selection) ?? []);
    const rest = ids(square).filter((id) => !claimed.has(id));
    const got = (seq.selectionIds(square, remaining) ?? []).slice().sort((a, b) => a - b);
    check(JSON.stringify(got) === JSON.stringify(rest),
      `...naming exactly the ${rest.length} dancers it leaves ([${got.join(',')}])`);
  }
  // The concrete pair from the report composes with a real second call on the remainder. `atSquare`
  // before EVERY applyStep: it mutates the live board, so a second witness applied without it runs on a
  // board the first one already moved - which is how this section first failed, for a reason that had
  // nothing to do with what it tests.
  const groups = [
    { selection: 'Sides', call: 'Forward and Back' },
    { selection: 'All Except Sides', call: 'Right and Left Thru' },
  ];
  // The picker's own filter: the remainder must be offered only what IT can perform. Asking this is the
  // difference between "the button enables" and "the second list has something usable in it".
  for (const g of groups) {
    atSquare();
    check(seq.groupCanPerform(square, g.selection, g.call),
      `the remainder's list can offer "${g.selection} ${g.call}" (groupCanPerform)`);
  }
  atSquare();
  const applied = seq.applyStep({ groups });
  check(applied.legal, `"Sides Forward and Back while All Except Sides Right and Left Thru" applies (${applied.reason ?? 'legal'})`);
  if (applied.legal) {
    // THE INVARIANT THAT ACTUALLY BROKE, and the reason the step now applies: the DECOMPOSED reading and
    // the STRING reading agree. Before the fix `apply("Sides Forward and Back")` applied and
    // `applyStep({groups:[{selection:'Sides',call:'Forward and Back'}]})` refused, because the scoped
    // lookup was hardcoded to `Centers`/`Ends` and guarded by "the base name is unknown". A group step
    // carries the decomposed form, so the picker's own `groupCanPerform` said legal while the step
    // refused - which is how the button came to do nothing.
    atSquare();
    const asString = seq.apply('Sides Forward and Back');
    atSquare();
    const asScopedGroup = seq.applyStep({ groups: [{ selection: 'Sides', call: 'Forward and Back' }] });
    check(asString.legal && asScopedGroup.legal,
      `the decomposed reading agrees with the string one (${asScopedGroup.reason ?? 'both legal'})`);
    if (asString.legal && asScopedGroup.legal) {
      check(poseKey(asString.board) === poseKey(asScopedGroup.board),
        '...and produces the same board');
    }
    // `Sides Forward and Back` closes - it steps out and back onto the spot it left - so it contributes
    // no endpoint motion of its own. The remainder group must still be danced in the same slot.
    const t = touched(square, applied.board);
    const both = new Set([...t.pos, ...t.face]);
    const heads = new Set(seq.selectionIds(square, 'All Except Sides') ?? []);
    check([...both].some((id) => heads.has(id)), 'the remainder group is danced in the same slot');
    check(stepLabel({ groups }) === 'Sides Forward and Back || All Except Sides Right and Left Thru',
      `one step: "${stepLabel({ groups })}"`);
  }
}

// ---------------------------------------------------------------- 8. a lane: several calls, one slot
console.log('\n== 8. a group may dance SEVERAL calls in the same slot ==');
{
  // ASKED FOR AS: "how difficult would it be to allow multiple calls in a parallel set. If heads take 16
  // beats to do one call, the sides could do two 4-beat calls."
  //
  // THE ALIGNMENT RULE, which is what this section pins: every lane starts at beat 0; a lane's calls run
  // back to back from the board the one before left; the step costs the LONGEST lane; a lane that finishes
  // early STANDS at its own end pose. MEASURED, so the witness is real: `Heads Promenade Full` is 16 beats
  // and `Sides Trade` + `Sides Pass Thru` are 4 + 4 (4 beats each from a square, both legal in that order).
  const groups = [
    { selection: 'Heads', call: 'Promenade Full' },
    { selection: 'Sides', calls: ['Trade', 'Pass Thru'] },
  ];
  const step = { groups };
  atSquare();
  const headsAlone = seq.stepBeats(square, 'Heads Promenade Full');
  const trade = seq.stepBeats(square, 'Sides Trade');
  const passed = seq.applyToBoard(square, 'Sides Trade');
  const passThru = passed.legal ? seq.stepBeats(passed.board, 'Sides Pass Thru') : -1;
  console.log(`    beats: Heads Promenade Full ${headsAlone}, Sides Trade ${trade}, then Sides Pass Thru ${passThru}`);
  check(headsAlone === 16 && trade === 4 && passThru === 4,
    `the witness is the report's own shape: a ${headsAlone}-beat call beside ${trade} + ${passThru} beats`);
  check(stepLabel(step) === 'Heads Promenade Full || Sides ( Trade + Pass Thru )',
    `the lane labels with "then": "${stepLabel(step)}"`);
  atSquare();
  const applied = seq.applyStep(step);
  check(applied.legal, `the lane step applies (${applied.reason ?? 'legal'})`);
  // THE COST IS THE LONGEST LANE, not the sum: the step is over when the promenade is.
  const beats = seq.sequenceBeats([step], square);
  check(beats === 16, `the step costs the LONGEST lane (${beats} beats, against 16 + 8 summed)`);
  if (applied.legal) {
    // EACH LANE IS ITS OWN CALLS, ONE AFTER ANOTHER, from the step's start board: the sides' end pose is
    // what `Trade` then `Pass Thru` produce, which is NOT what either produces alone.
    let sides = square;
    for (const call of ['Sides Trade', 'Sides Pass Thru']) {
      const r = seq.applyToBoard(sides, call);
      if (r.legal) sides = r.board;
    }
    const sideIds = new Set(seq.selectionIds(square, 'Sides') ?? []);
    let worstSides = 0;
    let worstHeads = 0;
    for (const d of applied.board.dancers) {
      const isSide = sideIds.has(d.id);
      const want = isSide ? sides.dancers.find((x) => x.id === d.id) : null;
      const heads = seq.applyToBoard(square, 'Heads Promenade Full');
      const wantHeads = heads.legal ? heads.board.dancers.find((x) => x.id === d.id) : null;
      const target = isSide ? want : wantHeads;
      if (!target) continue;
      const err = Math.hypot(d.x - target.x, d.y - target.y);
      if (isSide) worstSides = Math.max(worstSides, err);
      else worstHeads = Math.max(worstHeads, err);
    }
    check(worstSides < 1e-9, `the sides end where their TWO calls put them (worst ${worstSides.toExponential(1)} units)`);
    check(worstHeads < 1e-9, `...and the heads where their ONE call puts them (worst ${worstHeads.toExponential(1)})`);
    // THE APPLY REPORTS ITS OWN LANES, so a caller building a lane can ask where the next call starts.
    const lane = applied.lanes?.find((l) => l.selection === 'Sides');
    check(!!lane && lane.calls.length === 2 && lane.boards.length === 3,
      `the apply reports the lane's boards (${lane ? `${lane.calls.length} calls, ${lane.boards.length} boards` : 'none'})`);
  }
  // ------------------------------------------------------------------ the pacing, on a witness that moves
  //
  // `Sides Trade then Touch a Quarter` is 4 + 2 beats, and BOTH of its calls animate. The report's own pair
  // is used above for the beat arithmetic and the applied board, and NOT for this, for a measured reason:
  // `Sides Pass Thru` on the board `Sides Trade` leaves is one of the subset calls whose BARE name also
  // matches the whole board, and `evaluateCallAt` takes that whole-board branch - a pre-existing animator
  // wart (`Sides Pass Thru` alone shows the same 0.00 mid-call motion), not something a lane introduces.
  // Pinning "the early lane holds" against it would be pinning that wart.
  const movingGroups = [
    { selection: 'Heads', call: 'Promenade Full' },
    { selection: 'Sides', calls: ['Trade', 'Touch a Quarter'] },
  ];
  const movingStep = { groups: movingGroups };
  atSquare();
  const moving = seq.applyStep(movingStep);
  check(moving.legal, `the pacing witness applies (${moving.reason ?? 'legal'})`);
  if (moving.legal) {
    const beats2 = seq.sequenceBeats([movingStep], square);
    const sideIds = new Set(seq.selectionIds(square, 'Sides') ?? []);
    const driftAt = (t) => {
      const board = seq.evaluateSequence([movingStep], t, square).board;
      let worst = 0;
      for (const id of sideIds) {
        const a = board.dancers.find((d) => d.id === id);
        const b = moving.board.dancers.find((d) => d.id === id);
        worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
      }
      return worst;
    };
    // mid-lane the sides are BETWEEN the two calls, so they are nowhere near the lane's end...
    check(driftAt(2) > 1 && driftAt(5) > 0.1,
      `mid-lane the sides are still dancing (beat 2 ${driftAt(2).toFixed(2)} units from their end, beat 5 ${driftAt(5).toFixed(2)})`);
    // ...and at their own total (6) and for the other ten beats they STAND there, which is the whole point.
    check(driftAt(6) < 1e-9 && driftAt(10) < 1e-9 && driftAt(12) < 1e-9,
      `a lane that finishes early STANDS on its end pose (drift ${driftAt(6).toExponential(1)} at its own beat 6, ${driftAt(12).toExponential(1)} at beat 12)`);
    // ...and the last frame is still the board the applicator produced.
    const last = seq.evaluateSequence([movingStep], beats2, square).board;
    let worst = 0;
    for (const d of last.dancers) {
      const e = moving.board.dancers.find((x) => x.id === d.id);
      worst = Math.max(worst, Math.hypot(d.x - e.x, d.y - e.y));
    }
    check(worst < 1e-6, `the last animated frame IS the applied board (worst ${worst.toExponential(1)})`);
  }
  // ONE ACCOUNTING OF THE BEATS: a lane is charged its own sum, which is what the walk records too.
  atSquare();
  const laneOnly = { groups: [{ selection: 'Sides', calls: ['Trade', 'Pass Thru'] }] };
  check(seq.stepBeats(square, laneOnly) === 8, `a lane of two 4-beat calls costs 8 (${seq.stepBeats(square, laneOnly)})`);
  // ATOMIC, WITH THE OFFENDING CALL NAMED. `Sides Hinge` after `Sides Trade` is illegal (measured), so the
  // refusal has to say WHICH call of the lane refused - a lane has several places to look.
  atSquare();
  const bad = seq.applyStep({ groups: [{ selection: 'Heads', call: 'Promenade Full' }, { selection: 'Sides', calls: ['Trade', 'Hinge'] }] });
  check(!bad.legal && /call 2 of 2 \(Hinge\)/.test(bad.reason ?? ''),
    `a lane whose SECOND call refuses says so: "${bad.reason ?? 'legal'}"`);
  // A DEFERRED CALL CANNOT SIT MID-LANE: its answer depends on the other groups' END poses, which do not
  // exist half way through a lane. A lane of its own is still exactly what it was.
  atSquare();
  const midDeferred = seq.applyStep({
    groups: [
      { selection: 'Heads', call: 'Right and Left Thru' },
      { selection: 'Sides', calls: ['Step Forward and Back if Possible', 'Trade'] },
    ],
  });
  check(!midDeferred.legal && /END poses/.test(midDeferred.reason ?? ''),
    `a deferred call in the middle of a lane is refused: "${midDeferred.reason ?? 'legal'}"`);
  // THE LEGACY SHAPE STILL WORKS, byte for byte: a module saved before lanes existed holds
  // `{selection, call}`, and it must apply and label exactly as it did.
  const legacy = { groups: [{ selection: 'Heads', call: 'Right and Left Thru' }, { selection: 'All Except Heads', call: 'Touch a Quarter' }] };
  atSquare();
  const legacyApplied = seq.applyStep(legacy);
  check(legacyApplied.legal && stepLabel(legacy) === 'Heads Right and Left Thru || All Except Heads Touch a Quarter',
    `the legacy lane - a group with a single call field - still applies and labels ("${stepLabel(legacy)}")`);
}

console.log(failures === 0 ? '\nparallel-calls: all green.' : `\nparallel-calls: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
