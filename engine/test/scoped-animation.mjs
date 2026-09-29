// A SCOPED CALL MUST CHARGE ITS BEATS **AND MOVE**.
//
// `Head Boys Dosado` used to be applied and charged ZERO beats, and `evaluateSequence` returned the
// start board on every frame - "it appeared in the list of applied calls, but nothing animates, beats
// remains zero". The cause was that the walk could not find a variant for a SCOPED step: `Do Sa Do` is
// derived with the IDENTITY transform, so there is no motion in the coded rule, while the AUTHORED tams
// carry real paths (`Opposite Boy`: 2 dancers, 8 beats).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { Sequencer, setParser } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const board = seq.boardForFormation('Static Square');

/** The furthest any dancer gets from where it started, over the whole call. */
function maxTravel(step, b) {
  const total = seq.sequenceBeats([step], b);
  if (total <= 0) return { total, travel: 0 };
  let travel = 0;
  for (let t = 0; t <= total; t += total / 16) {
    const f = seq.evaluateSequence([step], t, b);
    for (const d of f.board.dancers) {
      const s = b.dancers.find((x) => x.id === d.id);
      if (s) travel = Math.max(travel, Math.hypot(d.x - s.x, d.y - s.y));
    }
  }
  return { total, travel };
}

console.log('== the two named scoped calls ==');
for (const step of ['Head Boys Dosado', 'Head Girls Dosado']) {
  const { total, travel } = maxTravel(step, board);
  console.log(`  ${step.padEnd(20)} beats=${total}  furthest travel=${travel.toFixed(2)}`);
  check(total > 0, `${step} is charged beats (${total})`);
  check(travel > 0.1, `${step} actually MOVES its dancers (travel ${travel.toFixed(2)})`);
}

console.log('\n== the whole-board call is unchanged ==');
{
  const { total, travel } = maxTravel('Dosado', board);
  console.log(`  Dosado               beats=${total}  furthest travel=${travel.toFixed(2)}`);
  check(total > 0, `whole-board Dosado still charged beats (${total})`);
}

console.log('\n== a NON-identity scoped call still works ==');
{
  const { total, travel } = maxTravel('Head Boys Pass Thru', board);
  console.log(`  Head Boys Pass Thru  beats=${total}  furthest travel=${travel.toFixed(2)}`);
  check(total > 0 && travel > 0.1, `Head Boys Pass Thru charges beats and moves (${total}, ${travel.toFixed(2)})`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
