// SURVEY: which calls actually make dancers walk through each other?
//
// The `Right and Left Thru` collapse and the `Promenade` one had different causes but ONE symptom -
// the closest two dancers during the animation falls far below the 2.0 spacing the formations use -
// and that symptom is testable without knowing the cause. So: every named 8-dancer formation the
// engine can build, against a spread of Mainland calls, sweeping the beats of a one-call sequence
// and recording the worst moment.
//
// WHY THIS AND NOT A TIGHTER `promenadeProblem`. That precondition governs ONE call: tightening it
// would make the `ceder-10530` promenade refuse, and would say nothing about any other call. The
// sweep is what generalises, and what it reports is the list of calls worth the same treatment.
//
// Usage: node engine/test/tools/walkthrough-survey.mjs [--min <units>]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const minArg = process.argv.indexOf('--min');
const THRESHOLD = minArg >= 0 ? Number(process.argv[minArg + 1]) : 1.0;
const SAMPLES = 24;

const closest = (b) => {
  const ds = b.dancers;
  let m = Infinity;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) m = Math.min(m, Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y));
  }
  return m;
};

const CALLS = [
  'Right and Left Thru', 'Pass Thru', 'Trade By', 'Square Thru 3', 'Square Thru 4', 'Star Thru',
  'Slide Thru', 'Wheel and Deal', 'Swing Thru', 'Box the Gnat', 'Dosado', 'Turn Thru', 'Lead Right',
  'Circulate', 'Ferris Wheel', 'Zoom', 'Veer Left', 'Veer Right', 'Bend the Line', 'Couples Circulate',
  'Flutterwheel', 'Sweep a Quarter', 'Fold', 'Rollaway', 'Promenade', 'Allemande Left', 'Right and Left Grand',
  'Touch a Quarter', 'Scoot Back', 'Walk and Dodge', 'Chain Down the Line', 'Courtesy Turn', 'Pass the Ocean',
];

const formations = seq.listFormations().filter((n) => {
  const b = seq.boardForFormation(n);
  return b !== null && b.dancers.length === 8;
});
console.log(`=== ${formations.length} named 8-dancer formation(s) x ${CALLS.length} call(s) ===`);
console.log(`    flagging any whose closest pair drops below ${THRESHOLD.toFixed(2)} units at some beat`);
console.log(`    (the formations sit at 2.00, so below that is dancers converging)\n`);

const hits = [];
let applied = 0;
let clean = 0;
for (const formation of formations) {
  const start = seq.boardForFormation(formation);
  if (!start) continue;
  for (const call of CALLS) {
    const r = seq.applyToBoard(start, call);
    if (!r.legal) continue;
    applied++;
    // Which route did it take? A whole-board match animates the authored path; otherwise the
    // parallel path runs, which is where the RLT collapse lived.
    const whole = seq.findMatchingVariant(start, call, 1.5);
    const total = seq.sequenceBeats([call], start);
    if (total <= 0) continue;
    let worst = Infinity;
    let worstBeat = 0;
    for (let k = 0; k <= SAMPLES; k++) {
      const b = (total * k) / SAMPLES;
      const c = closest(seq.evaluateSequence([call], b, start).board);
      if (c < worst) { worst = c; worstBeat = b; }
    }
    // The end board's own spacing is the fair floor: some formations legitimately stand closer.
    const endGap = closest(r.board);
    const floor = Math.min(2.0, endGap);
    if (worst < floor - 0.4 || worst < THRESHOLD) {
      hits.push({ formation, call, worst, worstBeat, total, route: whole ? 'whole' : 'PARALLEL', endGap });
    } else {
      clean++;
    }
  }
}

hits.sort((a, b) => a.worst - b.worst);
console.log(`  ${applied} (formation, call) pair(s) applied; ${clean} animated without converging below the floor`);
console.log(`  ${hits.length} pair(s) flagged:\n`);

// Severity, then by CALL. "Coincident" is the unambiguous case: two dancers on the same spot, which
// no dance path does. A near-miss may just be dancers passing.
const coincident = hits.filter((h) => h.worst < 0.1);
// TWO DIFFERENT DEFECTS SHARE THIS SYMPTOM. If the END board already has coincident dancers then the
// APPLY is broken and the animation cannot be blamed; only the pairs with a healthy destination are
// cases where the path is the fault.
const animFault = coincident.filter((h) => h.endGap >= 1.9);
const applyFault = coincident.filter((h) => h.endGap < 1.9);
console.log(`  COINCIDENT (< 0.1 units): ${coincident.length}`);
console.log(`    ... of which the END board is healthy (>= 1.9): ${animFault.length}  <- the ANIMATION is at fault`);
console.log(`    ... of which the END board is already broken:   ${applyFault.length}  <- the APPLY is at fault`);
console.log(`  near-miss (< ${THRESHOLD.toFixed(2)}, >= 0.1): ${(hits.length - coincident.length)}\n`);

const byCall = new Map();
for (const h of animFault) byCall.set(h.call, (byCall.get(h.call) ?? 0) + 1);
console.log('  ANIMATION-fault pairs, by CALL:');
for (const [call, n] of [...byCall].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(3)}  ${call}`);
}

console.log('\n  worst 12 in detail:');
for (const h of hits.slice(0, 12)) {
  console.log(
    `  ${h.worst.toFixed(2)} @${h.worstBeat.toFixed(1)}/${h.total.toFixed(1)}b  ${h.call}  from ${h.formation}  (end ${h.endGap.toFixed(2)})`,
  );
}
