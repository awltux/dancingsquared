// A STEP THAT APPLIES MUST ANIMATE SOMETHING, and this probe is the gate for that sentence.
//
// WHY IT EXISTS. `Heads Do Sa Do` applied legally, charged its full 8 beats, and drew NOTHING: the scoped
// coded path drew `interpolateSegment(board, after)` in a straight line, and a call that RETURNS HOME has
// `after === board` for every dancer, so the "line" was a point. Reported from use as "it looks applied but
// the dancers don't move when I scrub". The fix falls through to the subset machinery when that line cannot
// draw the call - see `evaluateCallAt`.
//
// THE MEASUREMENT THE FIX IS SIZED ON: every coded move x the 6 whole-set selections from a `Static Square`,
// 138 rows of which 51 apply. BEFORE the fix 28 of those 51 were standstills; 24 of them are the heading-only
// `Face *` family (0 position travel BY CONSTRUCTION - they pivot in place, and their boards differ, so they
// keep the straight line) and `Join Hands` (0 beats), leaving the four `Do Sa Do` rows as the real ones.
// AFTER: those four travel 3.5 units and nothing else moved, no legality or beat count changed, and every
// last frame is still exactly the applied board.
//
// SO THE GATE IS: a legal, non-zero-beat step must move SOMETHING - position or heading.
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

let applied = 0;
let standstills = 0;
let worstDrift = 0;
const dead = [];
for (const call of CODED_MOVE_NAMES) {
  for (const selection of SELECTIONS) {
    const raw = `${selection} ${call}`;
    const r = seq.applyToBoard(home, { selection, call });
    if (!r.legal) continue;
    applied++;
    const beats = seq.sequenceBeats([raw], home);
    if (beats <= 0) continue; // a 0-beat step is not asked to draw anything
    let move = 0;
    for (let i = 0; i <= 32; i++) {
      const b = seq.evaluateSequence([raw], (i / 32) * beats, home).board;
      for (const d of b.dancers) {
        const s = home.dancers.find((x) => x.id === d.id);
        move = Math.max(move, Math.hypot(d.x - s.x, d.y - s.y), angDiff(d.heading, s.heading));
      }
    }
    // The last frame must still be the board the apply produced - the fix must not move the endpoint.
    const last = seq.evaluateSequence([raw], beats, home).board;
    for (const d of last.dancers) {
      const e = r.board.dancers.find((x) => x.id === d.id);
      worstDrift = Math.max(worstDrift, Math.hypot(d.x - e.x, d.y - e.y));
    }
    if (move < 1e-6) { standstills++; dead.push(`${raw} (${beats} beats)`); }
  }
}

console.log(`${applied} of ${CODED_MOVE_NAMES.length * SELECTIONS.length} scoped combinations apply from a Static Square`);
console.log(`${standstills} of those steps animate NOTHING (neither position nor heading)`);
console.log(`worst last-frame drift from the applied board: ${worstDrift.toExponential(2)}`);
for (const d of dead) console.log(`  standstill: ${d}`);
if (standstills) {
  console.log(`\nscoped-coded-animation: ${standstills} FAILURE(S) - a step that applies must animate something`);
  process.exit(1);
}
if (worstDrift > 1e-6) {
  console.log(`\nscoped-coded-animation: FAILED - the animation does not converge on the applied board`);
  process.exit(1);
}
console.log('\nscoped-coded-animation: all green.');
