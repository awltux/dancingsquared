// A TIDAL WAVE IS TWO WAVES, AND THIS CALL IS DANCED IN EACH OF THEM SEPARATELY.
//
// CALLERLAB Mainstream, `Swing Thru / Left Swing Thru`: "active dancers form one or more groups of four dancers
// each", and for the Tidal Wave the definitions page is explicit - "From a Tidal Wave, Swing Thru is danced in
// the Ocean Wave on each half; no dancers cross the center of the Tidal Wave."
//
// Reported from use: from a Tidal Wave the sequencer's dancers "spin to the initial wave instead of a straight
// walk". MEASURED before `waveGroups` existed: part 1 traded correctly inside the halves and part 2 then paired
// the inner dancers of the two halves (1.0 apart, facing opposite ways - geometrically indistinguishable from a
// real hand-pair), so TWO dancers crossed the centre and the end board was not the authored one. The corpus's
// two Tidal Wave tams cross nobody, and the project owner adjudicated them correct: "The tam is the correct
// version."
//
// WHAT MAKES THE SEAM FINDABLE AT ALL. It is not visible: the eight stand evenly spaced in one line and the
// pairing alternates straight through the centre, so the pair either side of the seam faces exactly as a pair
// inside a half does. The only information is the count - eight dancers, groups of four - so the wave is read
// as a CHAIN of mutual hand-holds and cut into consecutive fours. Section 1 pins that partition, section 2 pins
// what the call does with it, and section 3 is the control that the cut does not neuter a wave of four.
//
// Run: node test/swing-thru.mjs   (from engine/; the engine must be built)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, findCodedMove, loadCallFromXml, normalizeInstance, instanceBeats, poseFor, setParser, waveGroups } from '../dist/index.js';
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

const seq = new Sequencer(movesXml, formationsXml, callsByTitle(assets));
const tidal = seq.boardForFormation('Tidal Wave RH BGGB');
const coded = findCodedMove('Swing Thru');

/** The id sets the partition puts each dancer in, as a sorted list of sorted lists. */
const partition = (board) => {
  const g = waveGroups(board);
  const byGroup = new Map();
  for (const d of board.dancers) {
    const key = g.get(d.id);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(d.id);
  }
  return [...byGroup.values()].map((ids) => ids.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
};

// ---------------------------------------------------------------- 1. the partition
console.log('== 1. a Tidal Wave is partitioned into its two halves ==');
{
  check(tidal, 'the corpus carries `Tidal Wave RH BGGB` (a missing formation is a FAILURE, not a skip)');
  const parts = tidal ? partition(tidal) : [];
  check(JSON.stringify(parts) === JSON.stringify([[1, 2, 3, 4], [5, 6, 7, 8]]),
    `the eight are cut into {1,2,3,4} and {5,6,7,8}, the two halves the definition names - got ${JSON.stringify(parts)}`,
    'one group of eight is what an uncut chain gives, and it is the state in which two dancers cross the centre');

  // A WAVE OF FOUR IS ONE GROUP, which is the control for the cut: a rule that cut at four dancers regardless
  // would split nothing here but a rule that required a chain longer than four would leave the wave unpairable.
  const waves = seq.boardForFormation('Ocean Waves RH BGGB');
  const waveParts = waves ? partition(waves) : [];
  check(JSON.stringify(waveParts) === JSON.stringify([[1, 2, 3, 4], [5, 6, 7, 8]]),
    `two separate Ocean Waves are two groups of four, not one chain of eight - got ${JSON.stringify(waveParts)}`,
    'the two waves stand 4.0 apart, so no hand-hold joins them');
}

// ---------------------------------------------------------------- 2. the rule, on the corpus Tidal Wave
console.log('\n== 2. from that board both trades stay inside their half ==');
{
  const tam = normalizeInstance(loadCallFromXml(read('ms/swing_thru.xml'), movesXml, formationsXml,
    { title: 'Swing Thru', from: 'Right-Hand Tidal Wave' }));
  const tamStart = tam.dancers.map((d) => poseFor(d, 0));
  const tamEnd = tam.dancers.map((d) => poseFor(d, instanceBeats(tam)));
  // THE TAM IS PAIRED WITH THE BOARD BY INDEX, so the index pairing is measured rather than assumed.
  const startMiss = tidal.dancers.reduce((worst, d, i) =>
    Math.max(worst, Math.hypot(d.x - tamStart[i].x, d.y - tamStart[i].y)), 0);
  check(tamStart.length === tidal.dancers.length && startMiss < 1e-6,
    `the tam starts where the corpus board stands (worst ${fmt(startMiss)} units over ${tamStart.length} dancers)`);

  const end = coded.apply(tidal);
  // A CROSSING IS A DANCER ON THE OTHER SIDE OF THE CENTRE from where it started. The Tidal Wave's line runs
  // along y in the corpus board, so the centre is y = 0 and the sign of a dancer's y is its half.
  const crossed = tidal.dancers
    .filter((d) => Math.sign(end.dancers.find((e) => e.id === d.id).y) !== Math.sign(d.y))
    .map((d) => d.id);
  check(crossed.length === 0,
    `no dancer crosses the centre of the Tidal Wave (0 of 8)`,
    `crossed: ${crossed.join(', ')} - the pre-fix rule crossed #3 and #7, 1.5 units each way`);

  let worst = 0;
  tidal.dancers.forEach((d, i) => {
    const e = end.dancers.find((x) => x.id === d.id);
    worst = Math.max(worst, Math.hypot(e.x - tamEnd[i].x, e.y - tamEnd[i].y));
  });
  check(worst < 1e-6,
    `and the board it leaves is the authored tam's, to ${fmt(worst)} units over 8 dancers`,
    'the two Tidal Wave tams are the reference the rule exists to reproduce');

  // THE USER-VISIBLE CONSEQUENCE: the agreement gate now prefers the tam here, so the animation follows the
  // authored paths instead of the derived legs. Before the partition the two ended on different boards, the
  // gate refused the swap, and the step was drawn as `derived`.
  const sources = seq.stepSources(['Swing Thru'], tidal);
  check(sources.length === 1 && sources[0] === 'catalogue',
    `the step is served by the CATALOGUE, not the derived rule (${JSON.stringify(sources)})`,
    'the gate only prefers an authored tam where the rule agrees with it');

  // AND THE LEFT-HAND WAVE, whose two tams are the other half of the same adjudication.
  const leftBoard = seq.boardForFormation('Tidal Wave LH BGGB');
  const leftEnd = leftBoard ? coded.apply(leftBoard) : null;
  const leftCrossed = leftBoard
    ? leftBoard.dancers.filter((d) => Math.sign(leftEnd.dancers.find((e) => e.id === d.id).y) !== Math.sign(d.y)).length
    : -1;
  check(leftBoard !== null && leftCrossed === 0,
    `the same holds from the left-hand Tidal Wave (${leftCrossed} of 8 cross the centre)`);
}

// ---------------------------------------------------------------- 3. the control
console.log('\n== 3. the cut does not stop a wave of four from trading ==');
{
  const wave = seq.boardForFormation('Ocean Waves RH BGGB');
  const end = coded.apply(wave);
  let moved = 0;
  for (const d of wave.dancers) {
    const e = end.dancers.find((x) => x.id === d.id);
    if (Math.hypot(e.x - d.x, e.y - d.y) > 1) moved++;
  }
  check(moved === wave.dancers.length,
    `all ${wave.dancers.length} dancers of a plain Ocean Wave still end on a different spot (${moved} moved)`,
    'a partition that grouped a four-dancer wave wrongly would leave them all standing still');
}

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
