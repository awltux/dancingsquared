// THE AUTHORED TAM SERVES A STEP WHERE IT AGREES WITH THE DERIVED RULE, AND THE RULE KEEPS EVERY OTHER BOARD.
//
// Reported from use: standing in an `Eight Chain Thru`, `All 8` + `Swing Thru` was added as a
// `derived+catalogue` step and "the dancers spin to the initial wave instead of a straight walk as seen in the
// call editor". MEASURED: both sources reach the same board (worst dancer 0.000 units) and their PATHS differ
// by up to 2.174 units - the rule animates the call as its two Trades, each drawn as a rigid half-turn about
// the pair's grip midpoint, where the authored tam walks out and back.
//
// WHY THE TAMS DO NOT SIMPLY WIN. MEASURED over the corpus: 47 of 5424 tams would switch, across 11 call
// titles, and only 34 of those 47 agree with the rule on the end board. ALL FOUR `Fan the Top` authorings
// disagree - 2.0 to 6.8 units and 180 degrees - and that derivation was shipped to FIX a measured wave defect
// (`6afbc16`), so preferring the tam there would reinstate it. Hence the gate: the authored paths are used
// exactly where the two compute the same board, and the rule keeps the rest.
//
// WHAT THIS HARNESS PINS, and each check has a control:
//   1. THE RULE ITSELF (`apply-source.ts`): same board by id, both sides present, nothing in / nothing out.
//   2. THE REPORTED CASE: `Swing Thru` from an Eight Chain Thru is walked as a CATALOGUE step, charged the
//      TAM's beats, and the animation follows the TAM's own poses - with the derived rule's beats as the
//      control that says the two really are different sources.
//   3. THE GATE DOING WORK: `Fan the Top` from a wave still walks as a CODED step, because its tams disagree.
//
// Run: node test/apply-source.mjs   (from engine/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, authoredTamWins, findCodedMove, loadCallFromXml, normalizeInstance, instanceBeats, poseFor, setParser } from '../dist/index.js';
import { callsByTitle } from './lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', 'assets');
const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`); }
};
const fmt = (n) => (Math.round(n * 1000) / 1000).toFixed(3);
const board = (poses) => ({ dancers: poses.map((p, i) => ({ id: i + 1, couple: (i % 4) + 1, gender: 'boy', x: p.x, y: p.y, heading: p.heading })) });

// ---------------------------------------------------------------- 1. the rule
console.log('== 1. the agreement gate itself ==');
{
  const a = board([{ x: 0, y: 0, heading: 0 }, { x: 2, y: 0, heading: 0 }]);
  const moved = board([{ x: 0, y: 0, heading: 0 }, { x: 2.5, y: 0, heading: 0 }]);
  const turned = board([{ x: 0, y: 0, heading: 0 }, { x: 2, y: 0, heading: Math.PI }]);
  check(authoredTamWins(a, a), 'the same board twice: the authored tam wins');
  check(!authoredTamWins(a, moved), 'a dancer half a unit out: it does not');
  check(!authoredTamWins(a, turned), 'the same spots facing the other way: it does not (a board is position AND heading)');
  check(!authoredTamWins(null, a), 'no coded result: the catalogue is not "preferred" against nothing');
  check(!authoredTamWins(a, null), 'no authored variant: the rule keeps the step');
}

// ---------------------------------------------------------------- 2. the reported case
console.log('\n== 2. "Swing Thru" from an Eight Chain Thru walks the AUTHORED call ==');
const seq = new Sequencer(movesXml, formationsXml, callsByTitle(assets));
{
  const ect = seq.boardForFormation('Eight Chain Thru');
  const coded = findCodedMove('Swing Thru');
  const tam = normalizeInstance(loadCallFromXml(read('ms/swing_thru.xml'), movesXml, formationsXml,
    { title: 'Swing Thru', from: 'Eight Chain Thru' }));
  const tamBeats = instanceBeats(tam);
  const beats = seq.stepBeats(ect, 'Swing Thru');
  check(beats === tamBeats && beats !== coded.beats,
    `the step costs the TAM's ${fmt(tamBeats)} beats, not the rule's ${fmt(coded.beats)}`);

  // THE WALK'S OWN RECORD decides the animation, so it is what is checked: a coded record draws the derived
  // legs (the spin), a catalogue record samples the authored paths.
  const total = seq.sequenceBeats(['Swing Thru'], ect);
  let worstPath = 0;
  for (let k = 0; k <= 24; k++) {
    const u = k / 24;
    const frame = seq.evaluateSequence(['Swing Thru'], u * total, ect);
    ect.dancers.forEach((d, i) => {
      const f = frame.board.dancers.find((x) => x.id === d.id);
      const t = poseFor(tam.dancers[i], u * tamBeats);
      worstPath = Math.max(worstPath, Math.hypot(f.x - t.x, f.y - t.y));
    });
  }
  check(worstPath < 1e-9,
    `and every drawn frame is the TAM's own pose (worst ${fmt(worstPath)} units over 25 frames, all 8 dancers)`,
    `a derived animation departs from the tam by up to 2.174 units, which is the reported spin`);
}

// ---------------------------------------------------------------- 3. the gate keeps the boards where the two disagree
console.log('\n== 3. where the authored tam is the measured-defective side, the RULE keeps the step ==');
{
  const wave = seq.boardForFormation('Ocean Waves RH BGGB') ?? seq.boardForFormation('Ocean Waves');
  const coded = findCodedMove('Fan the Top');
  const tam = normalizeInstance(loadCallFromXml(read('plus/fan_the_top.xml'), movesXml, formationsXml,
    { title: 'Fan the Top', formation: 'Wave RH' }));
  const tamEnd = tam.dancers.map((d) => poseFor(d, instanceBeats(tam)));
  const applied = seq.applyToBoard(wave, 'Fan the Top');
  // COMPARED AS SETS, because the tam's own dancer order is not the board's and this check is about the SHAPE:
  // for every dancer on the applied board, the distance to the NEAREST tam end pose, worst over the board.
  let worst = 0;
  for (const e of applied.legal ? applied.board.dancers : []) {
    worst = Math.max(worst, Math.min(...tamEnd.map((p) => Math.hypot(e.x - p.x, e.y - p.y))));
  }
  check(applied.legal, 'it applies');
  check(worst > 1,
    `and the board it leaves the rule's, not the tam's (they stand ${fmt(worst)} units apart, so the gate refuses the swap)`);
  check(seq.stepBeats(wave, 'Fan the Top') === coded.beats, `charged the rule's ${fmt(coded.beats)} beats`);
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
