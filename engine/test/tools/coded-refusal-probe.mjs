// WHY SOME CALLS APPLIED BUT COULD NOT BE ANIMATED.
//
// A CODED move (`findCodedMove`) refuses a board whose shape its derived rule does not cover. When
// the move carries `catalogueFallback`, `sequencer.tryCodedMove` returns null on refusal and the
// APPLICATOR applies the call from the catalogue anyway - so `applyToBoard` says LEGAL.
//
// `SequenceAnalyzer.replayWalk` used to have no such fallback: it recorded the step
// `walkable: false` and BROKE, so the same call that applied could not be walked, animated zero
// beats, and left the last frame on the start board. The convergence check in
// `swing-thru-anim-probe.mjs` found this as a 2.5-unit gap for `Swing Thru` from `Normal Lines`.
// `replayWalk` now falls through to the catalogue step when `catalogueFallback` is set, which is
// what the applicator does, and the animatable count below went 0/84 -> 57/84.
//
// The probe still enumerates the RULE-level disagreement, because that is the population the walk
// has to stay in step with. What matters per row is whether the WALK can now play the call:
//
//   animatable (beats > 0)  the walk and the applicator agree
//   dead (beats == 0)       they still disagree - the catalogue has no variant matching at walk
//                           tolerance either, so `applyToBoard` calling these LEGAL is the
//                           questionable half. All 27 are exotic boards (Diamonds, Hourglass,
//                           Stars, Misshapen I-Beam, Tidal Wave of 6, 3/4 Tag); no standard
//                           Mainstream formation is among them.
//
// Usage: node engine/test/tools/coded-refusal-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, findCodedMove, codedMoveApplies, CODED_MOVE_NAMES } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const fallback = CODED_MOVE_NAMES.filter((n) => findCodedMove(n)?.catalogueFallback);
console.log(`coded moves carrying catalogueFallback: ${fallback.length}/${CODED_MOVE_NAMES.length}`);
console.log(`  ${fallback.join(', ')}`);

// Every named 8-dancer formation the library can hand back, deduplicated by board content.
const boards = [];
const seen = new Set();
for (const name of seq.listFormations()) {
  const b = seq.boardForFormation(name);
  if (!b || b.dancers.length !== 8) continue;
  const k = b.dancers.map((d) => `${d.id}@${d.x.toFixed(2)},${d.y.toFixed(2)},${d.heading.toFixed(2)}`).join('|');
  if (seen.has(k)) continue;
  seen.add(k);
  boards.push({ name, b });
}
console.log(`\ndistinct named boards: ${boards.length}\n`);

const rows = [];
for (const { name, b } of boards) {
  for (const call of fallback) {
    const coded = findCodedMove(call);
    if (codedMoveApplies(coded, b)) continue;          // the coded rule covers it; no disagreement
    const r = seq.applyToBoard(b, call);
    if (!r.legal) continue;                            // refused by both: consistent
    const beats = seq.sequenceBeats([call], b);        // what the ANIMATION thinks
    const end = seq.knownFormation(b);
    rows.push({ name, call, beats, end, out: seq.knownFormation(r.board), reason: coded.precondition(b) });
  }
}

console.log(`DISAGREEMENTS (applicator LEGAL, coded rule refuses): ${rows.length}\n`);
const byCall = new Map();
for (const r of rows) byCall.set(r.call, (byCall.get(r.call) ?? 0) + 1);
for (const [call, n] of [...byCall].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(3)}  ${call}`);
}

console.log('\nthe animatable subset (beats > 0) - these DO play:');
const plays = rows.filter((r) => r.beats > 0);
console.log(`  ${plays.length} of ${rows.length}`);
for (const r of plays.slice(0, 10)) console.log(`    ${r.call} from ${r.name}: ${r.beats.toFixed(1)} beats`);

console.log('\nthe DEAD subset (beats == 0) - applies, stores a new board, animates NOTHING:');
const dead = rows.filter((r) => r.beats === 0);
console.log(`  ${dead.length} of ${rows.length}`);
for (const r of dead) {
  console.log(`    ${r.call.padEnd(18)} from ${String(r.name).padEnd(22)} -> ${r.out}`);
  console.log(`      refused because: ${r.reason}`);
}
