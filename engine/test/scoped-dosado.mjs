// A SCOPED STEP MOVES ONLY THE DANCERS IT SELECTS, pinned.
//
// The reported defect: "heads dosado moves all dancers, not just heads. Same with sides dosado."
//
// MEASURED MECHANISM, because it is not where it looks. The selection was being resolved correctly the
// whole time (`splitSelection('Heads Dosado')` -> `{selection: 'Heads', call: 'Dosado'}`). The difference
// from a working scoped call is the SUBSET SIZE:
//
//   `Head Boys Dosado`  subset 2 dancers -> a variant matches the centred sub-board (`Opposite Boy`)
//                       -> `evaluateCallAt` animates the subset through `evaluateVariantAt` -> 2 dancers
//   `Heads Dosado`      subset 4 dancers -> NO variant matches the sub-board
//                       -> execution reached `evaluateParallelAt`, which poses EVERY dancer in the board
//
// So a scoped call whose subset happens to have no catalogue variant was animated board-wide, moving the
// dancers the call never touched. `evaluateParallelAt` now animates a scoped step on its own centred
// subset and pins everyone else.
//
// Usage: node engine/test/scoped-dosado.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, splitSelection } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assets = path.join(root, 'assets');

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
const home = seq.boardForFormation('Static Square');

/** The ids that move at any point during the animation, with the furthest any of them travels. */
function movers(name) {
  const beats = seq.sequenceBeats([name], home);
  const travel = new Map();
  for (let i = 0; i <= 32; i++) {
    const ds = seq.evaluateSequence([name], (i / 32) * beats, home).board.dancers;
    for (const d of ds) {
      const o = home.dancers.find((x) => x.id === d.id);
      const dy = Math.hypot(d.x - o.x, d.y - o.y);
      travel.set(d.id, Math.max(travel.get(d.id) ?? 0, dy));
    }
  }
  const moved = [...travel.entries()].filter(([, v]) => v > 0.01).map(([k, v]) => ({ id: k, travel: v }));
  return { moved, ids: moved.map((m) => m.id).sort((a, b) => a - b), beats };
}

console.log('== the split is still what we think ==');
check(JSON.stringify(splitSelection('Heads Dosado')) === '{"selection":"Heads","call":"Dosado"}',
  'Heads Dosado splits into a Heads selection and the Dosado call');
check(JSON.stringify(splitSelection('Sides Dosado')) === '{"selection":"Sides","call":"Dosado"}',
  'Sides Dosado splits into a Sides selection and the Dosado call');

console.log('\n== (1) the reported defect: ONLY the selected dancers move ==');
// Heads are couples 1 and 3: ids 1,2,5,6. Sides are couples 2 and 4: ids 3,4,7,8.
const heads = [1, 2, 5, 6];
const sides = [3, 4, 7, 8];
{
  const r = movers('Heads Dosado');
  check(JSON.stringify(r.ids) === JSON.stringify(heads),
    `Heads Dosado moves exactly ${heads.join(',')} (got ${r.ids.join(',') || 'none'})`);
  check(r.moved.every((m) => m.travel > 1.0), '...and each of them actually travels a real distance');
}
{
  const r = movers('Sides Dosado');
  check(JSON.stringify(r.ids) === JSON.stringify(sides),
    `Sides Dosado moves exactly ${sides.join(',')} (got ${r.ids.join(',') || 'none'})`);
}

console.log('\n== (2) the scoped call is not silently dropped instead ==');
// The cheap wrong fix is to refuse the call. Pin that it is APPLIED and walked.
for (const name of ['Heads Dosado', 'Sides Dosado']) {
  const r = seq.applyToBoard(home, name);
  check(r.legal, `${name} is still applied`);
  check(movers(name).beats > 0, `${name} still charges beats`);
}

console.log('\n== (3) the scopes that already worked must not regress ==');
{
  const r = movers('Head Boys Dosado');
  check(JSON.stringify(r.ids) === JSON.stringify([1, 5]),
    `Head Boys Dosado still moves only 1,5 (got ${r.ids.join(',') || 'none'})`);
}
{
  const r = movers('Heads Pass Thru');
  check(JSON.stringify(r.ids) === JSON.stringify(heads),
    `Heads Pass Thru still moves only the heads (got ${r.ids.join(',') || 'none'})`);
}

console.log('\n== (4) a WHOLE-BOARD call still moves everyone ==');
{
  const r = movers('Dosado');
  check(r.ids.length === 8, `bare Dosado still moves all eight (got ${r.ids.length})`);
}

console.log('\n== (5) the animation still CONVERGES on the applied board ==');
// The fix must not leave the last frame somewhere the completed call never reached.
for (const name of ['Heads Dosado', 'Sides Dosado', 'Head Boys Dosado', 'Dosado']) {
  const applied = seq.applyToBoard(home, name).board;
  const beats = seq.sequenceBeats([name], home);
  const last = seq.evaluateSequence([name], beats, home).board;
  let worst = 0;
  for (const d of last.dancers) {
    const e = applied.dancers.find((x) => x.id === d.id);
    worst = Math.max(worst, Math.hypot(d.x - e.x, d.y - e.y));
  }
  check(worst < 1e-6, `${name}: the last animated frame IS the applied board (worst ${worst.toExponential(1)})`);
}

console.log(failures === 0 ? '\nscoped-dosado: all green.' : `\nscoped-dosado: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
