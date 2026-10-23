// THE PATH GUARD, pinned on the calls it was written for.
//
// The reported defect: "all8 Dosado will apply to a Square Set, but this results in all dancers walking
// all over each other. What is the safeguard to prevent this happening?" There was none. The engine's
// only collision numbers were ENDPOINT checks (`adjustToSetup`'s `BODY_COLLISION_MIN`, reached only via
// the `foldRule` branch) and both measured CENTRE DISTANCE, which as `bodies.ts` shows cannot tell two
// dancers passing at the standard width from two in the same place.
//
// THE WITNESS IS CHOSEN BECAUSE ITS ENDPOINT IS INNOCENT. The squared-set `Dosado` ends at a clean
// 2.000 centre distance, so it is refused at NEITHER 1.0 NOR 0.6 — the overlap exists only between the
// endpoints, where nothing was looking. That is why lowering the constant could not have fixed this and
// why the guard has to be path-based.
//
// What this pins:
//   (1) the three corpus witnesses are detected, at the measured depths, with the offending pair;
//   (2) the reported case specifically — and that its ENDPOINTS stay clean, which is the whole point;
//   (3) a legitimate two-dancer Dosado is NOT flagged (the guard must not eat the calls it protects);
//   (4) 'report' (the default) records the overlap but still applies the call; 'guard' refuses it;
//   (5) 'off' skips the work entirely.
//
// Usage: node engine/test/body-collision.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, worstBodyGap } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();

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
const square = seq.boardForFormation('Static Square');
const call = (name, mode) => {
  if (mode) seq.setBodyCollisionMode(mode);
  const r = seq.applyToBoard(square, name);
  seq.setBodyCollisionMode('report');
  return r;
};

console.log('== (1) the corpus witnesses are DETECTED ==');
// The depths are the measured ones, pinned rather than asserted loosely, so a regression that silently
// stops measuring the path (and reports a mere endpoint value) shows up as a failure.
//
// THE DOSADO PAIR MOVED 1+4 -> 6+3, and the reason is recorded because the pin is about WHICH DANCERS. The
// path check now samples at least `PATH_SAMPLES` (24) points over a call instead of a fixed half beat, and
// the two pairs overlap at the SAME depth - the depth check is unmoved at -0.377 against -0.39 - so on this
// board the identity of the shallowest pair is a near-tie that the sampling grid used to settle. The grid is
// deterministic now, so the pin is too; the pair is a DIAGNOSTIC (the deferral reads only the gap).
// Two other candidates for stabilising it were tried and REFUTED by this file: breaking the tie by lowest id
// gave 1+4 for BOTH `Dosado` and `Right and Left Thru` and 1+8 for `Touch a Quarter`, contradicting two of
// the three pins, which is what showed the old answers were grid artefacts rather than a rule to keep.
const WITNESSES = [
  ['Dosado', -0.39, '6', '3'],
  ['Right and Left Thru', -0.28, '6', '7'],
  ['Touch a Quarter', -0.75, '6', '8'],
];
for (const [name, depth, id1, id2] of WITNESSES) {
  const r = call(name);
  const c = r.bodyCollision;
  const found = !!c;
  check(found, `${name}: an overlapping pair is reported`);
  if (!found) continue;
  check(Math.abs(c.gap - depth) < 0.06, `${name}: depth ${c.gap.toFixed(3)} is within 0.06 of the measured ${depth}`);
  check(`${c.id1}` === id1 && `${c.id2}` === id2, `${name}: the offending pair is ${id1}+${id2} (got ${c.id1}+${c.id2})`);
}

console.log('\n== (2) the reported case: the ENDPOINT is innocent ==');
// If this ever stops being true the guard could be an endpoint check — but it is not, so pin it.
{
  const r = call('Dosado');
  const end = worstBodyGap(r.board);
  check(end !== null && end.gap > 0.9,
    `squared-set Dosado ends CLEAN (worst endpoint body gap ${end ? end.gap.toFixed(3) : 'n/a'}), so an endpoint guard cannot see it`);
  check(r.bodyCollision && r.bodyCollision.gap < 0, '...yet the path guard reports the mid-motion overlap');
  // And prove `applyToBoard` considers it legal, i.e. the tiling was accepted at all.
  check(r.legal, 'the call is still accepted, so the tiling really was produced and then measured');
}

console.log('\n== (3) the guard must not eat a legitimate Dosado ==');
// `Head Boys Dosado` is the scoped working call from the recent selection work: a real two-dancer
// Dosado whose authored path keeps its bodies clear. Its variant passes at exactly +1.000, which is the
// value `BODY_COLLISION_MIN = 1.0` used to sit on and flag.
for (const name of ['Head Boys Dosado', 'Head Boys Pass Thru']) {
  const r = call(name);
  check(r.legal, `${name}: still legal`);
  check(!r.bodyCollision, `${name}: NOT flagged as a collision`);
}

console.log('\n== (4) the three modes ==');
{
  const report = call('Dosado', 'report');
  check(report.legal, 'report (default): the call is applied');
  check(!!report.bodyCollision, 'report: the overlap is still recorded on the result');

  const guard = call('Dosado', 'guard');
  check(!guard.legal, 'guard: the call is refused (bodies would interpenetrate)');

  const off = call('Dosado', 'off');
  check(off.legal, 'off: the call is applied');
  check(!off.bodyCollision, 'off: no collision work is done at all');
}

console.log('\n== (5) guard leaves clean calls alone ==');
for (const name of ['Head Boys Dosado', 'Head Boys Pass Thru']) {
  const r = call(name, 'guard');
  check(r.legal, `guard: ${name} is still applied`);
  check(!r.bodyCollision, `guard: ${name} is not refused`);
}

console.log(failures === 0 ? '\nbody-collision: all green.' : `\nbody-collision: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
