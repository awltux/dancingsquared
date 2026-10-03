// The MODULE model and the "while" step. Run after `npm run build` (tsc).
//
// WHY THIS EXISTS. `GroupStep` is the engine's first way to say CALLERLAB's "Centers Square Thru while
// Outsides Trade". Until now the only way to express one was to hand-author every dancer's full path
// inside a single `<tam>` - which is what `ms/running_bear.xml` is, 248 lines of it, with the sub-calls
// named only in COMMENTS - so the structure was invisible, could not be reused, and could not be
// composed. The catalogue's `CURATED_MODULE_CALLS` already lists `Running Bear` as "conceptually
// sequences of multiple smaller calls but authored in the data as a single call", which is the same
// observation from the other end.
//
// THE RULES THE STEP PROMISES (`GroupStep`'s own doc comment) are what this harness pins, and each one
// is a way for the construct to be silently wrong rather than obviously broken:
//
//   DISJOINT      an overlapping group would let one group's result overwrite the other's
//   ATOMIC        a partially-danced "while" is not something a caller can call
//   CALLS ONLY    a module inside a group would invent a synchronisation rule the art does not have
//   SIMULTANEOUS  so the step costs the LONGEST group, not the sum
//   MERGEABLE     the grouped result must equal merging each group's own solo result by dancer id
//
// The last one is the load-bearing check: it is what makes "the groups did not interact" a measurement
// instead of an assumption.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer, stepLabel, stepCall, stepSelection, isGroupStep, groupCalls, boardSig } from '../dist/index.js';
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

const poseKey = (b) => b.dancers.map((d) => `${d.id}:${d.x.toFixed(4)},${d.y.toFixed(4)},${d.heading.toFixed(4)}`).join(';');
const byId = (b) => new Map(b.dancers.map((d) => [d.id, d]));

// ---------------------------------------------------------------- the step forms
console.log('== the step forms ==');
{
  check(stepLabel('Pass Thru') === 'Pass Thru', 'a bare string labels as itself');
  check(stepLabel({ selection: 'Heads', call: 'Pass Thru' }) === 'Heads Pass Thru', 'a CallStep labels with its selection');
  check(stepLabel({ groups: [{ selection: 'Centers', call: 'Square Thru' }, { selection: 'Outsides', call: 'Trade' }] })
    === 'Centers Square Thru while Outsides Trade', 'a GroupStep labels as a "while"');
  check(isGroupStep({ groups: [] }) && !isGroupStep({ selection: 'Heads', call: 'X' }) && !isGroupStep('X'),
    'isGroupStep separates the three forms');
  check(stepCall('Pass Thru') === 'Pass Thru' && stepCall({ selection: 'H', call: 'C' }) === 'C' && stepCall({ groups: [] }) === null,
    'stepCall answers the call, and null for a grouped step (which has no single one)');
}

// ---------------------------------------------------------------- the "while" witness
//
// A witness where the two groups dance DIFFERENT calls, so a bug that applied one call to the whole
// board could not pass. Found by searching the engine's own formations for a board where both groups
// are legal on their own AND the grouped step applies.
console.log('\n== the "while" witness ==');
const WITNESS = {
  board: 'Double Pass Thru',
  groups: [{ selection: 'Centers', call: 'Box the Gnat' }, { selection: 'Ends', call: 'California Twirl' }],
};
{
  const board = seq.boardForFormation(WITNESS.board);
  if (!board) {
    check(false, `the witness board "${WITNESS.board}" builds`);
  } else {
    const solo = WITNESS.groups.map((g) => seq.applyToBoard(board, g));
    const grouped = seq.applyToBoard(board, { groups: WITNESS.groups });
    check(solo.every((r) => r.legal), `each group is legal on its own (${WITNESS.groups.map((g, i) => `${g.selection} ${g.call}:${solo[i].legal}`).join(', ')})`);
    check(grouped.legal, `the grouped step applies (${grouped.reason ?? 'legal'})`);
    if (grouped.legal && solo.every((r) => r.legal)) {
      // THE MERGE INVARIANT: the grouped board must be exactly the per-group solo boards merged by id.
      // If a group's apply had leaked into the other's dancers, this is where it shows.
      const merged = new Map();
      for (let i = 0; i < WITNESS.groups.length; i++) {
        const sel = new Set(seq.selectionIds(board, WITNESS.groups[i].selection) ?? []);
        for (const d of solo[i].board.dancers) if (sel.has(d.id)) merged.set(d.id, d);
      }
      let moved = 0;
      let wrong = 0;
      const got = byId(grouped.board);
      for (const [id, want] of merged) {
        const have = got.get(id);
        if (!have) { wrong++; continue; }
        if (Math.hypot(have.x - want.x, have.y - want.y) > 1e-9) wrong++;
        if (Math.abs(have.heading - want.heading) > 1e-9) wrong++;
        if (Math.hypot(have.x - board.dancers.find((d) => d.id === id).x, have.y - board.dancers.find((d) => d.id === id).y) > 1e-9) moved++;
      }
      check(wrong === 0, `the grouped board IS the two solo boards merged by id (${merged.size} merged, ${moved} actually moved, ${wrong} disagree)`);

      // The two groups must not be doing the same thing - otherwise the witness proves nothing.
      const selA = new Set(seq.selectionIds(board, WITNESS.groups[0].selection) ?? []);
      const selB = new Set(seq.selectionIds(board, WITNESS.groups[1].selection) ?? []);
      const overlap = [...selA].filter((id) => selB.has(id));
      check(overlap.length === 0, `the witness groups are disjoint (${selA.size} + ${selB.size} of ${board.dancers.length})`);

      // Array order is the renderer's binding, so it must survive.
      check(grouped.board.dancers.map((d) => d.id).join(',') === board.dancers.map((d) => d.id).join(','),
        'the grouped result keeps the board\'s dancer ARRAY order');
    }
  }
}

// ---------------------------------------------------------------- the refusals
console.log('\n== the rules, each refused with a reason ==');
{
  const board = seq.boardForFormation('Static Square');
  const overlap = seq.applyToBoard(board, { groups: [{ selection: 'Heads', call: 'Pass Thru' }, { selection: 'Boys', call: 'Pass Thru' }] });
  check(!overlap.legal && /disjoint/.test(overlap.reason ?? ''), `overlapping groups refuse (${overlap.reason ?? 'NO REASON'})`);

  seq.registerModule('while-audit-module', ['Pass Thru']);
  const moduleGroup = seq.applyToBoard(board, { groups: [{ selection: 'Heads', call: 'while-audit-module' }, { selection: 'Sides', call: 'Trade' }] });
  check(!moduleGroup.legal && /must name calls, not the module/.test(moduleGroup.reason ?? ''),
    `a group naming a MODULE refuses (${moduleGroup.reason ?? 'NO REASON'})`);

  const atomic = seq.applyToBoard(board, { groups: [{ selection: 'Heads', call: 'Pass Thru' }, { selection: 'Sides', call: 'This Is Not A Call' }] });
  check(!atomic.legal, `a group whose call is illegal makes the WHOLE step refuse (${atomic.reason ?? 'NO REASON'})`);

  const empty = seq.applyToBoard(board, { groups: [] });
  check(!empty.legal && /at least one group/.test(empty.reason ?? ''), `an empty step refuses (${empty.reason ?? 'NO REASON'})`);
}

// ---------------------------------------------------------------- beats, animation, flatten, matrix
console.log('\n== beats, animation, flatten and the matrix transform ==');
{
  const board = seq.boardForFormation(WITNESS.board);
  const step = { groups: WITNESS.groups };
  const soloBeats = WITNESS.groups.map((g) => seq.stepBeats(board, g));
  const groupedBeats = seq.stepBeats(board, step);
  check(groupedBeats === Math.max(...soloBeats),
    `a "while" costs the LONGEST group, not the sum (${soloBeats.join(' + ')} -> ${groupedBeats})`);

  // THE FINAL FRAME CANNOT DISAGREE WITH THE APPLIED BOARD, by construction: the evaluator interpolates
  // to the applied board's own poses. This pins it anyway, because "by construction" is a claim.
  const flat = seq.flatten([step]);
  const applied = seq.applyToBoard(board, step);
  const total = seq.sequenceBeats(flat, board);
  const end = seq.evaluateSequence(flat, total, board).board;
  const mid = seq.evaluateSequence(flat, total / 2, board).board;
  check(applied.legal && boardSig(end) === boardSig(applied.board),
    `the animated final frame lands on the applied board (${boardSig(end) === boardSig(applied.board) ? 'exact' : 'GAP'})`);
  check(mid.dancers.some((d) => { const f = board.dancers.find((x) => x.id === d.id); return Math.hypot(d.x - f.x, d.y - f.y) > 1e-9; }) ||
    applied.board.dancers.every((d) => { const f = board.dancers.find((x) => x.id === d.id); return Math.hypot(d.x - f.x, d.y - f.y) < 1e-9; }),
    'half way through, the dancers are between where they started and where they end (or the step moves nobody)');

  check(flat.length === 1 && isGroupStep(flat[0]),
    'flatten passes a grouped step through WHOLE - it is simultaneous, so linearising it would turn "while" into "then"');

  seq.registerModule('while-audit-collapse', [step]);
  const collapsible = seq.moduleCollapsible('while-audit-collapse', WITNESS.board);
  const collapsed = seq.collapseModule('while-audit-collapse', WITNESS.board);
  check(collapsible, 'moduleCollapsible accepts a module containing a "while" step');
  check(collapsed !== null && collapsed.matrices.size === 8,
    `collapseModule composes a per-dancer matrix ACROSS the grouped step (n=${collapsed?.matrices.size ?? 'null'}) - the matrix transform survives the new form`);

  // ---------------------------------------------------------------- and a LANE inside it
  //
  // A group may dance SEVERAL calls back to back (`GroupLane`), which is how a long call is filled by two
  // short ones. The rules that matter here are the ones the module machinery reads: the label, the flatten
  // pass-through, and the collapse - which must count EVERY lane call, since each dancer dances them all.
  const laneStep = { groups: [{ selection: 'Centers', calls: ['Box the Gnat', 'Trade'] }, { selection: 'Ends', calls: ['California Twirl', 'Trade'] }] };
  check(stepLabel(laneStep) === 'Centers Box the Gnat then Trade while Ends California Twirl then Trade',
    `a lane labels with "then", selection once: "${stepLabel(laneStep)}"`);
  check(isGroupStep(laneStep) && stepCall(laneStep) === null && stepSelection(laneStep) === null,
    'and it is still the GROUPED form, naming no single call or selection');
  const laneFlat = seq.flatten([laneStep]);
  check(laneFlat.length === 1 && isGroupStep(laneFlat[0]) && groupCalls(laneFlat[0].groups[0]).length === 2,
    'flatten passes a lane through WHOLE, with both of its calls intact - linearising it would turn the lane\'s "then" into the step\'s "while"');
  seq.registerModule('while-audit-lane', [laneStep]);
  const laneCollapsible = seq.moduleCollapsible('while-audit-lane', WITNESS.board);
  const laneCollapsed = seq.collapseModule('while-audit-lane', WITNESS.board);
  check(laneCollapsible === collapsible,
    `moduleCollapsible reads every lane call (${laneCollapsible} against ${collapsible} for the single-call form)`);
  check(laneCollapsed !== null && laneCollapsed.matrices.size === 8,
    `and collapseModule composes across a lane too (n=${laneCollapsed?.matrices.size ?? 'null'})`);
}

// ---------------------------------------------------------------- Running Bear, measured not assumed
console.log('\n== Running Bear: is the hand-authored tam the composition of its own sub-calls? ==');
{
  // The plan's Stage 1 wanted a `Running Bear` module that reproduces the authored tam's end board.
  // MEASURED, THAT IS NOT POSSIBLE, and the measurement is the finding: the tam's sub-calls are named
  // only in COMMENTS, and the comments annotate CHUNKS OF ONE PATH rather than a shared timeline (the
  // second path's first comment is `Ladies Chain`; `Ladies Chain` is not even legal on the board the
  // tam starts from). So there is no mechanically recoverable call sequence to recompose, and the
  // honest conclusion is that a composed "while" is a NEW capability rather than a refactor of an
  // existing authoring. Reported and asserted as that, rather than compared board-to-board in a way
  // that would pass vacuously.
  const board = seq.boardForFormation('Static Square');
  const tam = seq.applyToBoard(board, 'Running Bear');
  const firstNamed = 'Ladies Chain';
  const first = seq.applyToBoard(board, firstNamed);
  console.log(`  note  "Running Bear" applies from a Static Square: ${tam.legal}`);
  console.log(`  note  its own first named sub-call "${firstNamed}" from the same board: ${first.legal}${first.legal ? '' : ` (${first.reason})`}`);
  check(tam.legal && !first.legal,
    `the tam applies where its own first named sub-call does not - the hand-authored "while" is move PATHS annotated by comments, not a composition, so no call-level recomposition of it exists to compare against`);
}

console.log(`\nmodules: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
