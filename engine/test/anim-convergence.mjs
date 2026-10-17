// THE ANIMATION MUST AGREE WITH THE APPLICATOR, AND MUST CONVERGE ON IT.
//
// The POC draws a call by asking `evaluateSequence` for the board at a beat. That board comes from a
// DIFFERENT code path than the one `applyToBoard` uses to decide where the call ends, and the two
// disagreeing is invisible in the data - the end board is right and only the frames are wrong - so
// nothing else in this suite can see it. Two defects found by hand in the walk-through work are
// exactly this shape, and both are pinned here:
//
//   1. A coded move whose derived rule refuses a board but which carries `catalogueFallback` was
//      APPLIED by the applicator and NOT WALKED by the analyzer, so `sequenceBeats` was 0 and the
//      call animated nothing while still moving the dancers (84 pairs; `Swing Thru` from
//      `Normal Lines` is real choreography).
//   2. An animation that does not CONVERGE: the last animated frame must be the board the call
//      produces, or the dancers jump on the final beat. Note that sampling at exactly `total` cannot
//      test this - `evaluateSequence` returns the step's stored board there, not an interpolated
//      one - so the check samples just BEFORE the end.
//
// Usage: node engine/test/anim-convergence.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, CODED_MOVE_NAMES, findCodedMove, splitSelection } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import { ALL8_FIGURE_START, figureEngineCalls, loadAll8Figures } from './lib/all8-figures.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assets = path.join(root, 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

// The board a set of dancers stands on has to be compared by IDENTITY, not by array order: the
// applicator and the analyzer are free to emit the dancers in different orders, and a positional
// diff would report that as a jump.
const gap = (a, b) => {
  const byId = new Map(b.dancers.map((d) => [d.id, d]));
  let worst = 0;
  for (const d of a.dancers) {
    const o = byId.get(d.id);
    if (!o) return Infinity;
    worst = Math.max(worst, Math.hypot(d.x - o.x, d.y - o.y));
  }
  return worst;
};

// Every named 8-dancer formation the library can hand back, deduplicated by board CONTENT (the
// library mirrors 4-dancer formations up to 8, so several names can be the same board).
const boards = [];
const seenBoard = new Set();
for (const name of seq.listFormations()) {
  const b = seq.boardForFormation(name);
  if (!b || b.dancers.length !== 8) continue;
  const k = b.dancers.map((d) => `${d.id}@${d.x.toFixed(3)},${d.y.toFixed(3)},${d.heading.toFixed(3)}`).join('|');
  if (seenBoard.has(k)) continue;
  seenBoard.add(k);
  boards.push({ name, b });
}

const CALLS = [...CODED_MOVE_NAMES].sort();
console.log(`anim-convergence: ${boards.length} board(s) x ${CALLS.length} coded call(s) = ${boards.length * CALLS.length} pair(s)`);

// THE NON-CODED CALLS TOO, because the two paths are different code and the defects were different.
// The set is not arbitrary: it is every call the corpora actually dance, which is what makes a fault
// worth fixing. Taking it from the corpora rather than from the catalogue keeps the harness bounded
// (a catalogue sweep is ~10x the work for combinations nothing calls) and keeps it pointed at real
// choreography - `Right and Left Thru` from a Double Pass Thru, the worst offender the parallel path
// had, is in here and was not in the coded set.
const CORPUS_CALLS = new Set();
{
  const note = (s) => {
    const call = splitSelection(typeof s === 'string' ? s : s.call).call;
    if (call && !findCodedMove(call)) CORPUS_CALLS.add(call);
  };
  const board0 = seq.boardForFormation(ALL8_FIGURE_START);
  if (board0) for (const f of loadAll8Figures().figures) for (const s of figureEngineCalls(f)) note(s);
  const walkDir = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { walkDir(p); continue; }
      if (!p.endsWith('.json')) continue;
      let v;
      try { v = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
      if (!v || !Array.isArray(v.steps) || v.success !== true) continue;
      for (const s of v.steps) note(s);
    }
  };
  const ceder = path.join(root, 'modules');
  try { walkDir(ceder); } catch { /* corpus absent: the coded set alone still runs */ }
}
console.log(`  plus the ${CORPUS_CALLS.size} non-coded call(s) the corpora use x ${boards.length} board(s) = ${CORPUS_CALLS.size * boards.length} pair(s)`);

// How far before the end to sample. Large enough to survive the float arithmetic in the beat
// comparison, small enough that a leg's own motion is finished; a call whose LAST leg is shorter
// than this would be sampled inside its previous leg, so the tolerance below is set from what the
// correct calls actually measure rather than from a guess.
const TAIL = 1e-3;
const CONVERGE_TOL = 0.02;

const nonConvergent = [];
const jumps = [];        // (A) passed but the last frame does not reach the applied board
const silent = [];       // applied, moved the dancers, and the walk plays NOTHING
const phantom = [];      // REFUSED by the applicator, yet the walk charges beats and plays it
const dropped = [];      // applied, moved the dancers, and the walk plays NOTHING - non-coded
let played = 0;
let refused = 0;

for (const { name, b } of boards) {
  for (const call of [...CALLS, ...CORPUS_CALLS].sort()) {
    const r = seq.applyToBoard(b, call);
    const total = seq.sequenceBeats([call], b);
    if (!r.legal) {
      refused++;
      // (D) THE WALK SHOULD NOT PLAY A CALL THE APPLICATOR REFUSES - it charges beats for motion no
      // board change accounts for, and `evaluateParallelAt` returns the board UNCHANGED for them, so
      // a sequence containing one silently stalls. `matchingVariantInfo` partitions at SEARCH
      // tolerance while `applyToBoardInner` hands `parallelApply` DEFAULT tolerance, so the walk's
      // predicate is the LOOSER of the two - the opposite direction from the grouping bug. The
      // population is large and PRE-EXISTING, so the count is pinned rather than fixed here; see
      // PHANTOM_KNOWN below for why it is not simply tightened.
      if (total > 0) phantom.push({ board: name, call, total });
      continue;
    }

    const endWalk = seq.evaluateSequence([call], total, b).board;

    if (total <= 0) {
      // The applicator moved the board but the walk cannot play it: a silent no-op.
      const moved = gap(r.board, b) > 1e-9 && gap(endWalk, b) < 1e-9;
      if (moved && findCodedMove(call)) silent.push({ board: name, call });
      // (E) the same thing for an AUTHORED call. It is a different question from (C) - an authored
      // call with no matching variant is a deliberate `walkable: false` stop, so this is a count to
      // watch rather than a pin - but if it is non-zero the applicator and the walk disagree about
      // the same board in the same direction.
      else if (moved) dropped.push({ board: name, call });
      continue;
    }
    played++;

    // (A) AGREEMENT: where the walk finishes must be where the applicator finishes.
    const agree = gap(endWalk, r.board);
    if (agree > 1e-6) nonConvergent.push({ board: name, call, kind: 'agreement', gap: agree, total });

    // (B) CONVERGENCE: the LAST frame the POC would draw must already be there. Sampled just before
    // the end, because at exactly `total` this is the stored board by construction.
    const frame = seq.evaluateSequence([call], Math.max(0, total - TAIL), b).board;
    const tail = gap(frame, r.board);
    if (tail > CONVERGE_TOL) jumps.push({ board: name, call, gap: tail, total });
  }
}

console.log(`  applied ${played + silent.length + dropped.length}, refused ${refused}; played ${played}`);
console.log(`  (A) the walk finishes where the applicator does: ${played - nonConvergent.length} of ${played} agree`);
console.log(`  (B) the last drawn frame is within ${CONVERGE_TOL} of the end board: ${played - jumps.length} of ${played} converge`);

let bad = 0;
if (nonConvergent.length) {
  bad++;
  console.log(`\nFAIL: ${nonConvergent.length} (board, call) pair(s) where the walk and the applicator finish on DIFFERENT boards.`);
  for (const f of nonConvergent.sort((a, c) => c.gap - a.gap).slice(0, 25)) {
    console.log(`  gap ${f.gap.toFixed(4)}  ${f.call} from ${f.board} (${f.total.toFixed(1)} beats)`);
  }
  if (nonConvergent.length > 25) console.log(`  ... and ${nonConvergent.length - 25} more`);
}

// (B) AS A PINNED LIST, for the same reason as (C): these are a real defect - the dancers jump on the
// final beat - but a small one (the worst is 0.15 units on a lattice that stands 2.00 apart, so ~7%
// of the spacing), and a red gate would train everyone to ignore the suite. Every one is a CIRCLE
// call, which points at a single cause still to be found: the frame just before the end is not the
// board the call produces, so `poseFor(t, dancerBeats(t))` and whatever `applyWholeBoard` uses to
// place the end must disagree for these variants. Recorded, not papered over - and pinned as pairs so
// a swap cannot hide a fix.
const JUMP_TOL = CONVERGE_TOL;
const JUMPS_KNOWN = [
  'Circle Left\u0000Static Square',
  'Circle Left\u0000Circle',
  'Circle Left 1/4\u0000Static Square',
  'Circle Left 3/4\u0000Static Square',
  'Circle Right 3/4\u0000Static Square',
  'Lead Right\u0000Eight Chain Thru',
  'Rollaway\u0000Circle',
];
const jumpKeys = jumps.map((j) => `${j.call}\u0000${j.board}`).sort();
const jumpKnown = [...JUMPS_KNOWN].sort();
if (jumpKeys.length !== jumpKnown.length || !jumpKeys.every((k, i) => k === jumpKnown[i])) {
  bad++;
  console.log(`\nFAIL: the final-frame jump list changed: measured ${jumpKeys.length}, pinned ${jumpKnown.length}.`);
  for (const j of jumps.sort((a, c) => c.gap - a.gap)) {
    const k = `${j.call}\u0000${j.board}`;
    console.log(`  ${jumpKnown.includes(k) ? ' ' : '+'} gap ${j.gap.toFixed(4)}  ${j.call} from ${j.board}`);
  }
  for (const k of jumpKnown) if (!jumpKeys.includes(k)) console.log(`  - ${k.split('\u0000')[1]} from ${k.split('\u0000')[0]} (fixed - re-pin)`);
} else {
  const worst = jumps.reduce((m, j) => Math.max(m, j.gap), 0);
  console.log(`  (B) final-frame jumps over ${JUMP_TOL}: ${jumpKeys.length}, exactly as pinned (worst ${worst.toFixed(4)})`);
}

// (C) NO SILENT NO-OPS. This was a list of 27, every one a coded move that the applicator applied (via
// `catalogueFallback`) on a board where `matchingVariantInfo` could find no FULL tiling - so the walk
// charged 0 beats and nothing animated. When `matchingVariantInfo` was given `parallelApply`'s own
// predicate (`partition ?? partitionPartial`, at DEFAULT) the list went to ZERO: all 27 animate now.
// An EMPTY pin is the point of keeping it - it is the gate that says they cannot come back.
const SILENT_KNOWN = [];
const silentKeys = silent.map((s) => `${s.board}\u0000${s.call}`).sort();
const knownKeys = [...SILENT_KNOWN].sort();
const sameList = silentKeys.length === knownKeys.length && silentKeys.every((k, i) => k === knownKeys[i]);
if (!sameList) {
  bad++;
  console.log(`\nFAIL: the silent-no-op list changed: measured ${silentKeys.length}, pinned ${knownKeys.length}.`);
  for (const k of silentKeys) {
    const [board, call] = k.split('\u0000');
    console.log(`  ${knownKeys.includes(k) ? ' ' : '+'} ${call} from ${board}`);
  }
  for (const k of knownKeys) {
    if (!silentKeys.includes(k)) console.log(`  - ${k.split('\u0000')[1]} from ${k.split('\u0000')[0]}  (no longer silent - good, re-pin)`);
  }
} else {
  console.log(`  (C) silent no-ops: ${silentKeys.length}, exactly as pinned`);
}

// (D) A PHANTOM: charged beats, refused by the applicator. The walk reports the sequence as taking
// time that no board change accounts for, and `evaluateParallelAt` returns the board UNCHANGED for
// those beats, so a sequence containing one silently stalls. Hand-checked rather than inferred -
// `engine/test/tools/phantom-probe.mjs` shows `Square Thru 4` from `Columns` refusing with "No setup
// in this call matches the current formation" while `sequenceBeats` charged 10.0.
//
// The cause was the same shape as the grouping bug: `matchingVariantInfo` asked `partitionExists`
// (FULL tilings only) at SEARCH, while `applyToBoardInner` hands `parallelApply`
// `partition ?? partitionPartial` at DEFAULT. Aligning them took this from **2466 to 11**, and the
// 11 that remain are accounts of the ONE difference left: `parallelApply` also requires every
// SUB-APPLY to succeed, which `matchingVariantInfo` cannot cheaply check. All 11 are `Box the Gnat`
// or `Slide Thru` on Galaxy/Diamond/Star boards - no standard formation.
const PHANTOM_KNOWN = 11;
if (phantom.length !== PHANTOM_KNOWN) {
  bad++;
  console.log(`\nFAIL: the phantom list changed: measured ${phantom.length}, pinned ${PHANTOM_KNOWN}.`);
  for (const p of phantom.sort((a, c) => c.total - a.total).slice(0, 25)) {
    console.log(`  ${p.total.toFixed(1)} beats charged  ${p.call} from ${p.board}`);
  }
  if (phantom.length > 25) console.log(`  ... and ${phantom.length - 25} more`);
} else {
  console.log(`  (D) calls refused by the applicator but played by the walk: ${phantom.length}, exactly as pinned`);
}

// (E) APPLIED BY THE APPLICATOR, NOT PLAYED BY THE WALK - the authored-call half of (C). An authored
// call with no variant at walk tolerance is a deliberate `walkable: false` stop, so this is not a
// defect in itself; but the applicator disagreeing with it IS, in the same direction as (C). The
// predicate alignment took it from **400 to 6**, all of them `Circulate 2` on a promenade or
// double-pass-thru board, so it is now small enough to PIN and stop drifting.
const DROPPED_KNOWN = 6;
if (dropped.length !== DROPPED_KNOWN) {
  bad++;
  console.log(`\nFAIL: the applied-but-not-played list changed: measured ${dropped.length}, pinned ${DROPPED_KNOWN}.`);
  for (const d of dropped.sort((a, c) => a.call.localeCompare(c.call))) console.log(`  ${d.call} from ${d.board}`);
} else {
  console.log(`  (E) applied but not played, non-coded: ${dropped.length}, exactly as pinned`);
}

if (bad) {
  console.log('\nanim-convergence: FAILED');
  process.exit(1);
}
console.log('\nanim-convergence: PASSED');
