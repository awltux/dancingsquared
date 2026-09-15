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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, CODED_MOVE_NAMES } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', 'poc', 'src', 'assets');
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

// How far before the end to sample. Large enough to survive the float arithmetic in the beat
// comparison, small enough that a leg's own motion is finished; a call whose LAST leg is shorter
// than this would be sampled inside its previous leg, so the tolerance below is set from what the
// correct calls actually measure rather than from a guess.
const TAIL = 1e-3;
const CONVERGE_TOL = 0.02;

const nonConvergent = [];
const silent = [];       // applied, moved the dancers, and the walk plays NOTHING
let played = 0;
let refused = 0;

for (const { name, b } of boards) {
  for (const call of CALLS) {
    const r = seq.applyToBoard(b, call);
    if (!r.legal) { refused++; continue; }

    const total = seq.sequenceBeats([call], b);
    const endWalk = seq.evaluateSequence([call], total, b).board;

    if (total <= 0) {
      // The applicator moved the board but the walk cannot play it. If the walk's own board is the
      // START board, the call is a silent no-op: legal, and nothing animates it.
      if (gap(endWalk, b) < 1e-9 && gap(r.board, b) > 1e-9) silent.push({ board: name, call });
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
    if (tail > CONVERGE_TOL) nonConvergent.push({ board: name, call, kind: 'convergence', gap: tail, total });
  }
}

console.log(`  applied ${played + silent.length}, refused ${refused}; played ${played}`);
console.log(`  (A) the walk finishes where the applicator does: ${played - nonConvergent.filter((x) => x.kind === 'agreement').length} of ${played} agree`);
console.log(`  (B) the last drawn frame is within ${CONVERGE_TOL} of the end board: ${played - nonConvergent.filter((x) => x.kind === 'convergence').length} of ${played} converge`);

let bad = 0;
if (nonConvergent.length) {
  bad++;
  console.log(`\nFAIL: ${nonConvergent.length} (board, call) pair(s) where the animation does not match the applied board.`);
  for (const f of nonConvergent.sort((a, c) => c.gap - a.gap).slice(0, 25)) {
    console.log(`  ${f.kind.padEnd(11)} gap ${f.gap.toFixed(4)}  ${f.call} from ${f.board} (${f.total.toFixed(1)} beats)`);
  }
  if (nonConvergent.length > 25) console.log(`  ... and ${nonConvergent.length - 25} more`);
}

// (C) NO SILENT NO-OPS, pinned as a LIST rather than a count so a swap cannot hide a fix. The
// residual is the APPLICATOR being permissive on boards the catalogue cannot read at all - Diamonds,
// Hourglass, Stars, Misshapen I-Beam, Tidal Wave of 6, Quarter H, 3/4 Tag - which is a different
// defect from an animation fault: there is no variant for the walk to draw, so the applicator
// claiming LEGAL is the questionable half. No standard Mainstream formation appears below.
//
// The list was 84 before `replayWalk` learned the `catalogueFallback` rule the applicator already
// had. Two names that LEFT it are the ones worth remembering, because both are real choreography:
// `Swing Thru` from `Normal Lines` and `Fan the Top` from `Normal Lines`.
const SILENT_KNOWN = [
  '3/4 Tag\u0000Left Swing Thru',
  '3/4 Tag\u0000Swing Thru',
  'Butterfly In\u0000Fan the Top',
  'Butterfly Trade By\u0000Fan the Top',
  'Concentric Diamonds Mixed\u0000Fan the Top',
  'Concentric Diamonds RH\u0000Fan the Top',
  'Diamonds\u0000Left Swing Thru',
  'Diamonds\u0000Swing Thru',
  'Diamonds 3 and 1 Girl Points\u0000Left Swing Thru',
  'Diamonds 3 and 1 Girl Points\u0000Swing Thru',
  'Diamonds LH Girl Points\u0000Left Swing Thru',
  'Diamonds LH Girl Points\u0000Swing Thru',
  'Hourglass Facing LH Box\u0000Fan the Top',
  'Hourglass Facing RH Box\u0000Fan the Top',
  'Hourglass LH BP\u0000Fan the Top',
  'Hourglass RH BP\u0000Fan the Top',
  'Misshapen I-Beam\u0000Fan the Top',
  'Misshapen I-Beam\u0000Left Swing Thru',
  'Misshapen I-Beam\u0000Swing Thru',
  'Quarter H\u0000Fan the Top',
  'Quarter H\u0000Left Swing Thru',
  'Quarter H\u0000Swing Thru',
  'Stars LH\u0000Fan the Top',
  'Stars RH\u0000Fan the Top',
  'Tidal Wave of 6\u0000Fan the Top',
  'Tidal Wave of 6\u0000Left Swing Thru',
  'Tidal Wave of 6\u0000Swing Thru',
];
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

if (bad) {
  console.log('\nanim-convergence: FAILED');
  process.exit(1);
}
console.log('\nanim-convergence: PASSED');
