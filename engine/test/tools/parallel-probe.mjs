// WHY THE PARALLEL PATH SENDS TWO GROUPS THROUGH THE SAME POINT.
//
// `SequenceAnalyzer.evaluateParallelAt` partitions the board into the groups `parallelApply` would
// tile, animates EACH group pure-relative along its own variant's authored path, and converges on the
// applied board with a proportional residual. Each group is therefore blind to the others, and two
// groups can be aimed at the same point. This is the largest remaining class of walk-through fault:
// 30 of the 33 animation faults the survey keeps, with `Right and Left Thru` (8) the biggest owner.
//
// `Veer Left` from `Double Pass Thru` is the smallest instance: 2 beats, two dancers' worth of
// motion, and the end board is a healthy 2.00. If a 2-beat call can put two dancers on top of each
// other, the model is wrong rather than the call.
//
// Usage: node engine/test/tools/parallel-probe.mjs [formation] [call]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const FORMATION = process.argv[2] ?? 'Double Pass Thru';
const CALL = process.argv[3] ?? 'Veer Left';

const pose = (b) => b.dancers.slice().sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}(${d.x.toFixed(2)},${d.y.toFixed(2)})@${String(Math.round((d.heading * 180) / Math.PI)).padStart(4)}`)
  .join('  ');
const closest = (b) => {
  const ds = b.dancers;
  let m = Infinity, pair = null;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const g = Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y);
      if (g < m) { m = g; pair = [ds[i].id, ds[j].id]; }
    }
  }
  return { m, pair };
};

const start = seq.boardForFormation(FORMATION);
if (!start) { console.log(`no formation ${FORMATION}`); process.exit(1); }
const r = seq.applyToBoard(start, CALL);
console.log(`=== ${CALL} from ${FORMATION} ===`);
console.log(`start [${seq.knownFormation(start)}]  ${pose(start)}`);
if (!r.legal) { console.log(`REFUSED: ${r.reason}`); process.exit(0); }
console.log(`end   [${seq.knownFormation(r.board)}]  ${pose(r.board)}  end closest ${closest(r.board).m.toFixed(2)}`);

const total = seq.sequenceBeats([CALL], start);
console.log(`total ${total.toFixed(1)} beats   knownFormation(start)=${seq.knownFormation(start)}`);

// Which route does the analyzer take? `evaluateCallAt` prefers the WHOLE-board match and only falls
// to the parallel path when there is none.
const info = seq.sequenceInfo?.([CALL], 0.5 * total, start);
console.log(`\nframe by frame (closest pair in brackets):`);
let worst = Infinity, worstBeat = 0, worstPair = null;
for (let k = 0; k <= 20; k++) {
  const b = (total * k) / 20;
  const at = seq.evaluateSequence([CALL], b, start).board;
  const c = closest(at);
  if (c.m < worst) { worst = c.m; worstBeat = b; worstPair = c.pair; }
  const flag = c.m < 1.0 ? '  <-- CONVERGING' : '';
  console.log(`  t=${(total > 0 ? b / total : 0).toFixed(2)} beat ${b.toFixed(2)}  ${pose(at)}  [${c.pair[0]}/#${c.pair[1]} ${c.m.toFixed(2)}]${flag}`);
}
console.log(`\nworst ${worst.toFixed(3)} at beat ${worstBeat.toFixed(2)} between #${worstPair[0]} and #${worstPair[1]}`);
console.log(`per-sequenceInfo the playing call is: ${info ? info.name : '(coded / none)'}`);
