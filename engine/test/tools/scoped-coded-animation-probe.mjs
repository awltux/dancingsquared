// A STEP THAT APPLIES MUST ANIMATE SOMETHING - AND IT MUST ANIMATE IT BEFORE THE LAST FRAME.
//
// WHY IT EXISTS. `Heads Do Sa Do` applied legally, charged its full 8 beats, and drew NOTHING: the scoped
// coded path drew `interpolateSegment(board, after)` in a straight line, and a call that RETURNS HOME has
// `after === board` for every dancer, so the "line" was a point. Reported from use as "it looks applied but
// the dancers don't move when I scrub". The fix falls through to the subset machinery when that line cannot
// draw the call - see `evaluateCallAt`.
//
// THE MEASUREMENT THE FIRST FIX WAS SIZED ON: every coded move x the 6 whole-set selections from a `Static
// Square`, of which 55 apply. BEFORE it, 28 were standstills; 24 of those are the heading-only `Face *`
// family (0 position travel BY CONSTRUCTION - they pivot in place, and their boards differ, so they kept the
// straight line) and `Join Hands` (0 beats), leaving the four `Do Sa Do` rows as the real ones. AFTER it, the
// four `Do Sa Do` rows travelled, nothing else moved, no legality or beat count changed, and every last frame
// was still exactly the applied board.
//
// AND THE GATE THAT FIX SHIPPED WITH COULD NOT SEE HALF THE PROBLEM, because it took the MAX over every
// sampled beat and the LAST sample IS the applied board - so a step that stands still for its whole duration
// and snaps on the final frame scored exactly the same as one that dances. MEASURED with the metric repaired
// (`max` over the samples BEFORE the last): **20 of the 51 steps that apply with non-zero beats moved NOTHING
// until the final frame** - `Heads`/`Sides`/`Boys`/`Girls` x `Face Right`/`Left`/`Half`/`In`/`Out`, 1 beat
// each, 1.571 or 3.142 radians of travel. Reported from use as "Heads Face right has a single transition
// between frame 0.9 and 1.0". The cause was `evaluateCallAt`'s scoped-coded guard testing POSITION only, so a
// pure pivot fell through to a subset re-apply the catalogue cannot author (measured:
// `applicator.applyToBoard(centredHeads, "Face Right")` is ILLEGAL) and the animation returned the board
// unchanged.
//
// SO THE GATE IS: a legal, non-zero-beat step must move something - position or heading - BEFORE its last
// frame. The midpoint ratio is printed beside it, because "how much of the move is done by half way" is what
// separates a paced animation from one that merely starts late; it is a REPORT rather than an assertion,
// since the honest floor for a reshaped path is a pacing question and not a fixed number.
//
// Usage: node engine/test/tools/scoped-coded-animation-probe.mjs   (wants `npm run build --prefix engine`)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, CODED_MOVE_NAMES } from '../../dist/index.js';
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
const home = seq.boardForFormation('Static Square');
const SELECTIONS = ['Heads', 'Sides', 'Centers', 'Ends', 'Boys', 'Girls'];
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** How far the board at `b` is from the board the step started on - WORST dancer, position or heading. */
const travel = (b) => b.dancers.reduce((m, d) => {
  const s = home.dancers.find((x) => x.id === d.id);
  return s ? Math.max(m, Math.hypot(d.x - s.x, d.y - s.y), angDiff(d.heading, s.heading)) : m;
}, 0);
const SAMPLES = 32;
// THE FLOOR IS A VISIBLE ONE, NOT AN EPSILON, and that repair is the second half of this probe's subject.
// With `1e-6` the probe was GREEN on `Heads Do Sa Do`, which is the very report it was written for: the step
// moved 2.0e-3 over 8 beats (a rebase residue, not motion) and 3.68 is what a dancing Dosado makes. MEASURED
// across the 47 applying scoped steps from a `Static Square`: the still rows move at most **2.060e-3**, the
// smallest row that genuinely animates moves **1.571e+0** (a `Face *` quarter-turn pivot), so 0.05 sits in a
// 762x gap. The probe now fails on anything below a tenth of a body-width.
const VISIBLE_TRAVEL = 0.05;

let applied = 0;
let timed = 0;          // ...of which have beats, so a timeline to animate over
let standstills = 0;    // motion ANYWHERE, including the last frame
let snaps = 0;          // motion ONLY in the last frame - the shape this gate exists to catch
let worstDrift = 0;
let worstHalfRatio = Infinity;
const dead = [];
const snapRows = [];
for (const call of CODED_MOVE_NAMES) {
  for (const selection of SELECTIONS) {
    const raw = `${selection} ${call}`;
    const r = seq.applyToBoard(home, { selection, call });
    if (!r.legal) continue;
    applied++;
    const beats = seq.sequenceBeats([raw], home);
    if (beats <= 0) continue; // a 0-beat step is not asked to draw anything
    timed++;
    const at = (i) => seq.evaluateSequence([raw], (i / SAMPLES) * beats, home).board;
    let anywhere = 0;
    let beforeLast = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = travel(at(i));
      anywhere = Math.max(anywhere, t);
      // THE SAMPLE AT `i === SAMPLES` IS THE APPLIED BOARD ITSELF, so it is excluded here. That exclusion is
      // the whole repair: including it is what let 20 snapping steps read as animated.
      if (i < SAMPLES) beforeLast = Math.max(beforeLast, t);
    }
    const half = beats > 0 ? travel(at(SAMPLES / 2)) : 1;
    if (anywhere > 1e-6) worstHalfRatio = Math.min(worstHalfRatio, half / anywhere);
    // The last frame must still be the board the apply produced - the fix must not move the endpoint.
    const last = at(SAMPLES);
    for (const d of last.dancers) {
      const e = r.board.dancers.find((x) => x.id === d.id);
      worstDrift = Math.max(worstDrift, Math.hypot(d.x - e.x, d.y - e.y));
    }
    if (anywhere < VISIBLE_TRAVEL) { standstills++; dead.push(`${raw} (${beats} beats, moved ${anywhere.toExponential(2)})`); }
    else if (beforeLast < VISIBLE_TRAVEL) { snaps++; dead.push(`${raw} (${beats} beats) - all ${anywhere.toFixed(3)} of its motion is in the FINAL frame`); snapRows.push(raw); }
  }
}

console.log(`${applied} of ${CODED_MOVE_NAMES.length * SELECTIONS.length} scoped combinations apply from a Static Square`);
console.log(`${timed} of those have beats to animate over; ${standstills} animate NOTHING at all and ${snaps} animate ONLY on the final frame`);
console.log(`worst last-frame drift from the applied board: ${worstDrift.toExponential(2)}`);
console.log(`least of the move already done at the halfway beat: ${worstHalfRatio === Infinity ? 'n/a' : worstHalfRatio.toFixed(3)}`);
for (const d of dead) console.log(`  dead step: ${d}`);
if (standstills || snaps) {
  console.log(`\nscoped-coded-animation-probe: ${standstills + snaps} FAILURE(S) - a step that applies must animate something, and must do it before its last frame`);
  process.exit(1);
}
if (worstDrift > 1e-6) {
  console.log(`\nscoped-coded-animation-probe: FAILED - the animation does not converge on the applied board`);
  process.exit(1);
}
// SHOWN TO FAIL: with the position-only guard this probe used to pass, `Heads Face Right` is one of the rows
// above - its heading went 270 -> 180 degrees entirely on the final sample. The named witness is asserted so
// the family cannot regress behind a green count.
const watch = seq.evaluateSequence(['Heads Face Right'], 0.5, home).board;
const watchStart = home.dancers.find((d) => d.id === 1);
const watchHalf = watch.dancers.find((d) => d.id === 1);
if (Math.abs(angDiff(watchHalf.heading, watchStart.heading)) < 1e-6) {
  console.log('\nscoped-coded-animation-probe: FAILED - "Heads Face Right" has not turned by the halfway beat');
  process.exit(1);
}
console.log(`\n"Heads Face Right" turns ${(angDiff(watchHalf.heading, watchStart.heading) * 180 / Math.PI).toFixed(1)} degrees by the halfway beat - the reported single-transition case`);

// SHOWN TO FAIL: the reported second case, and the one the epsilon floor could not see. `Heads Do Sa Do`
// charged its 8 beats and drew 2.0e-3 of a rebase residue, because `Do Sa Do` ends where it starts and the
// straight line between two nearly-identical boards is a point. The four heads must travel, and the four
// sides - who the call never touched - must not. The named witness is asserted so a future epsilon cannot
// hide the family behind a green count.
{
  const beats = seq.sequenceBeats(['Heads Dosado'], home);
  const mid = seq.evaluateSequence(['Heads Dosado'], beats / 2, home).board;
  const groupTravel = (ids) => ids.reduce((m, id) => {
    const s = home.dancers.find((d) => d.id === id);
    const e = mid.dancers.find((d) => d.id === id);
    return s && e ? Math.max(m, Math.hypot(e.x - s.x, e.y - s.y)) : m;
  }, 0);
  const HEADS = [1, 2, 5, 6];
  const SIDES = [3, 4, 7, 8];
  const headsMove = groupTravel(HEADS);
  const sidesMove = groupTravel(SIDES);
  if (headsMove < 1.0) {
    console.log(`\nscoped-coded-animation-probe: FAILED - "Heads Dosado" moved the heads only ${headsMove.toFixed(4)} units by half way (${beats} beats charged)`);
    process.exit(1);
  }
  if (sidesMove > 0.05) {
    console.log(`\nscoped-coded-animation-probe: FAILED - "Heads Dosado" moved a SIDE dancer by ${sidesMove.toFixed(4)}; the call never touched them`);
    process.exit(1);
  }
  console.log(`"Heads Dosado" moves the four heads ${headsMove.toFixed(3)} units by half way and leaves the sides still (worst ${sidesMove.toExponential(1)}) - the tiling, drawn`);
}
console.log('\nscoped-coded-animation-probe: all green.');
