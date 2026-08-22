// Engine smoke test (Node). Build first: `npm run verify` runs tsc then this.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Engine, poseFor, computeHandholds } from '../dist/index.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(__dirname, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const movesXml = read('../../poc/src/assets/moves.xml');
const formationsXml = read('../../poc/src/assets/formations.xml');

const engine = new Engine(movesXml, formationsXml);

// --- Brace Thru (Lines, Boys Ends), mirrored -> 8 dancers ---
console.log('== Engine: load + poses ==');
const brace = engine.loadCall(read('../../poc/src/assets/a1/brace_thru.xml'), 0);
check(brace.dancers.length === 8, `Brace Thru mirrored -> ${brace.dancers.length} dancers`);
check(brace.totalBeats === brace.leadin + brace.beats + brace.leadout, 'totalBeats = leadin+beats+leadout');

const posesStart = engine.poses(brace, 0);
const posesEnd = engine.poses(brace, brace.beats);
posesStart.forEach((p, i) => {
  const pe = posesEnd[i];
  const moved = Math.hypot(pe.x - p.x, pe.y - p.y);
  check(Number.isFinite(p.x) && Number.isFinite(pe.heading), `dancer ${i} pose finite`);
  check(moved > 0.001, `dancer ${i} moves ${moved.toFixed(2)} units`);
});

// --- Hand holds: static start line = 3 holds, all 4 (half) joined ---
console.log('== Engine: hand holds ==');
const half = engine.loadCall(read('../../poc/src/assets/a1/brace_thru.xml'), 0, false); // no mirror
const h = engine.handholds(engine.poses(half, 0), 'static');
const covered = new Set(h.flatMap((e) => [e.i, e.j]));
check(h.length === 3, `start line derives ${h.length} holds (expect 3)`);
check(covered.size === half.dancers.length, `all ${covered.size} dancers joined`);

// --- Mirror 180 symmetry ---
const s0 = poseFor(brace.dancers[0], 2);
const s4 = poseFor(brace.dancers[4], 2);
check(Math.abs(s0.x + s4.x) < 1e-6 && Math.abs(s0.y + s4.y) < 1e-6, 'duplicate half is a 180-degree rotation');

// --- Circle Left forms a ring ---
console.log('== Engine: circle ring ==');
const circle = engine.loadCall(read('../../poc/src/assets/ms/circle.xml'), 0);
const cHolds = engine.handholds(engine.poses(circle, circle.beats * 0.5), 'active');
const cdeg = new Array(circle.dancers.length).fill(0);
cHolds.forEach((e) => { cdeg[e.i]++; cdeg[e.j]++; });
check(cHolds.length === 8 && cdeg.every((d) => d === 2), 'Circle Left forms a ring of 8 (each holds 2)');

console.log('\n=================');
if (failures === 0) console.log('ENGINE SMOKE TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
