// THE NEAR END LOOKUP: the named formations a board ALMOST stands on, and the margin that makes "almost" mean something.
//
// Asked for as: "When the end setup displays Unknown formation, offer a filter icon button ... This button filters the
// listed setups to those that are close matches. I find I need this because some call moves leave the dancers in
// positions that are just outside a matching formation ... If this list is empty, then that also tells me that this is
// a completely new formation."
//
// WHY IT IS NOT `endFormationName` WITH A BIGGER TOLERANCE, and this is the property the whole file exists to pin: the
// namer GATES. Given a margin it answers "yes, that name" for the boards inside it and "no" for every other board, so a
// wider margin only moves the cliff - it cannot say which shape is 0.1 units away and which is 0.9. `nearEndFormations`
// reports each spot's nearest dancer, so the caller reads a distance, and an empty list is a measurement rather than a
// refusal.
//
// THE JUDGE IS INDEPENDENT OF THE THING JUDGED: every distance below is a nudge this file applied to the board or to the
// formation, and "is it outside the named margin" is asked of `endsOnFormation` at `END_BOARD_TOL` - the namer, not the
// filter (AGENTS §11.2.3).
//
// WHAT IS MEASURED:
//   1. the reported case - a board 0.1 units off a named shape is INSIDE the relaxed margin and OUTSIDE the named one;
//   2. the margin decides on BOTH axes: exactly at it is in, 0.01 past it is out;
//   3. the list is nearest-first and the number is the nudge itself;
//   4. an empty list on a scattered board (and the namer agreeing), and a size mismatch skipped;
//   5. the corpus: how many eight-dancer ends the NAMER names are in the near list too (it must be all of them), how
//      many are near-but-unnamed - the population the filter exists for - and how many are nowhere near a named shape.
//
// Usage: node engine/test/end-near.mjs   (after `npm run build --prefix engine`)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { corpusRoot, filesOf } from 'dancing-squared-corpus';

import {
  buildCallVariants,
  completedFormation,
  endFormationName,
  endPoses,
  endsOnFormation,
  END_BOARD_TOL,
  NEAR_END_BOARD_TOL,
  nearEndFormations,
  normalizeInstance,
  parseFormations,
  setParser,
} from '../dist/index.js';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(corpusRoot(), p), 'utf8');
const RAD = Math.PI / 180;

let failures = 0;
const check = (cond, msg, detail = '') => {
  if (cond) console.log('  ok   ' + msg);
  else {
    failures++;
    console.log('  FAIL ' + msg + (detail ? `\n         ${detail}` : ''));
  }
};

const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');

/** Every eight-dancer named formation, completed exactly as the editor's picker completes them. */
function eightDancerFormations() {
  const out = [];
  for (const [name, ds] of parseFormations(formationsXml)) {
    const poses = completedFormation(ds.map((d) => ({ x: d.x, y: d.y, heading: d.angleDeg * RAD, gender: d.gender })));
    if (poses.length === 8) out.push({ name, poses });
  }
  return out;
}
const FORMATIONS = eightDancerFormations();

/** One real eight-dancer call, from the corpus, so the fixture is an authored track rather than a made-up bundle. */
function firstEightDancerCall(level, file) {
  for (const variant of buildCallVariants(read(`${level}/${file}`), movesXml, formationsXml)) {
    const call = normalizeInstance(variant);
    if (call.dancers.length === 8) return call;
  }
  return null;
}
const PROBE = firstEightDancerCall('ms', 'pass_thru.xml') ?? firstEightDancerCall('ms', 'circle.xml');
check(PROBE !== null, 'an eight-dancer corpus call was found to measure against');

/** The call's own END poses - the board the near lookup is asked about. */
const ENDS = endPoses(PROBE);

/** The same poses with every dancer moved by `d` units and/or `dh` radians: a formation "just outside" the board. */
const nudged = (d, dh = 0) => ENDS.map((p, i) => (i === 0 ? { ...p, x: p.x + d, heading: p.heading + dh } : p));
const one = (name, poses) => [{ name, poses }];

console.log('\n== 1. a board just outside a named shape is found, and the namer still refuses it ==');
{
  const near = nudged(0.1);
  const list = nearEndFormations(PROBE, one('Probe Shape', near));
  check(list.length === 1, `the shape is in the near list (${list.length})`);
  check(list[0] !== undefined && Math.abs(list[0].worst.position - 0.1) < 1e-9,
    `and the number it reports is the nudge itself (${list[0]?.worst.position.toFixed(4)} units)`);
  // THE INDEPENDENT JUDGE: the namer at its own margin says no - which is the state the filter explains.
  check(!endsOnFormation(PROBE, near, END_BOARD_TOL) && endFormationName(PROBE, one('Probe Shape', near)) === null,
    'while the NAMER refuses it at its tight margin, so the filter answers a question the namer cannot');
  check(0.1 > END_BOARD_TOL.position && 0.1 < NEAR_END_BOARD_TOL.position,
    `the nudge sits between the two margins (${END_BOARD_TOL.position} named, ${NEAR_END_BOARD_TOL.position} near)`);
}

console.log('\n== 2. the margin is what decides, on BOTH axes ==');
{
  const list = (d, dh = 0) => nearEndFormations(PROBE, one('Probe Shape', nudged(d, dh)));
  check(list(NEAR_END_BOARD_TOL.position).length === 1, `a position nudge of exactly ${NEAR_END_BOARD_TOL.position} is inside`);
  check(list(NEAR_END_BOARD_TOL.position + 0.01).length === 0,
    `and ${(NEAR_END_BOARD_TOL.position + 0.01).toFixed(2)} is outside, so the constant is the boundary rather than a range a slack comparison slips through`);
  check(list(0, NEAR_END_BOARD_TOL.heading).length === 1, `a heading nudge of exactly ${NEAR_END_BOARD_TOL.heading} rad is inside`);
  check(list(0, NEAR_END_BOARD_TOL.heading + 0.01).length === 0,
    'and 0.01 rad past it is outside, so the facing axis is judged and not only the position');
}

console.log('\n== 3. nearest first, and the distance is the caller\'s own unit ==');
{
  const list = nearEndFormations(PROBE, [
    { name: 'Far', poses: nudged(0.18) },
    { name: 'Close', poses: nudged(0.15) },
    { name: 'Middle', poses: nudged(0.16) },
  ]);
  check(list.map((f) => f.name).join(',') === 'Close,Middle,Far',
    `the list is ordered by how far outside the shape it is (${list.map((f) => f.name).join(', ')})`);
  check(list.length === 3 && list.every((f) => f.worst.position <= NEAR_END_BOARD_TOL.position),
    'and every entry is inside the margin, which is what makes it a filter rather than a ranking of everything');
}

console.log('\n== 4. an empty list is a measurement: this is a new shape ==');
{
  // EVERY dancer moved, so no assignment of the board to this silhouette is near.
  const scattered = ENDS.map((p, i) => ({ ...p, x: p.x + (i % 2 ? 0.6 : -0.6), y: p.y + (i % 4 < 2 ? 0.6 : -0.6) }));
  check(nearEndFormations(PROBE, one('Probe Shape', scattered)).length === 0,
    'a board no formation spot is under comes back EMPTY');
  check(!endsOnFormation(PROBE, scattered, NEAR_END_BOARD_TOL),
    'and the namer agrees at the RELAXED margin too, so the empty list is not this function being stricter than the engine');
  check(nearEndFormations(PROBE, [one('Four Dancers', ENDS.slice(0, 4))[0]]).length === 0,
    'a formation of another SIZE is skipped rather than compared');
}

console.log('\n== 5. the corpus: named ends are all in the list, near-but-unnamed is a real population ==');
{
  const totals = { calls: 0, named: 0, nearOnly: 0, none: 0, namedNotNear: 0, skipped: 0 };
  const examples = [];
  // EVERY FIFTH eight-dancer variant of `ms`: a sample stated with its denominator rather than an implied sweep.
  const every = 5;
  let seen = 0;
  for (const file of filesOf('ms')) {
    let variants;
    try {
      variants = buildCallVariants(read(`ms/${file}`), movesXml, formationsXml);
    } catch {
      totals.skipped++;
      continue;
    }
    for (const variant of variants) {
      let call;
      try {
        call = normalizeInstance(variant);
      } catch {
        totals.skipped++;
        continue;
      }
      if (call.dancers.length !== 8) continue;
      if (seen++ % every !== 0) continue;
      totals.calls++;
      const name = endFormationName(call, FORMATIONS);
      const near = nearEndFormations(call, FORMATIONS);
      if (name !== null) {
        totals.named++;
        if (!near.some((f) => f.name === name)) {
          totals.namedNotNear++;
          if (examples.length < 3) examples.push(`${file} ${call.title}: named ${name}, missing from the near list`);
        }
      } else if (near.length > 0) {
        totals.nearOnly++;
        if (examples.length < 6) {
          const f = near[0];
          examples.push(`${file} ${call.title}: near ${f.name} at ${f.worst.position.toFixed(3)} u / ${f.worst.heading.toFixed(3)} rad`);
        }
      } else {
        totals.none++;
      }
    }
  }
  console.log(`    ${totals.calls} of ${seen} eight-dancer ms variants (every ${every}th): ${totals.named} named, ${totals.nearOnly} NEAR but unnamed, ${totals.none} nowhere near a named shape`);
  if (examples.length) console.log(`    e.g. ${examples.join(' | ')}`);
  check(totals.calls > 0, `the sample has a population (${totals.calls} eight-dancer variants)`);
  check(totals.namedNotNear === 0,
    `every end the NAMER names is in the near list too (${totals.namedNotNear} of ${totals.named} were not) - the filter never contradicts the name the row already shows`);
  check(totals.nearOnly > 0,
    `and ${totals.nearOnly} ends are near a named shape without being it, which is the population the filter is for`);
  check(totals.none > 0,
    `while ${totals.none} ends are nowhere near one - the measurement "a completely new formation" reads as`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nend-near: all checks hold');
process.exit(failures ? 1 : 0);
