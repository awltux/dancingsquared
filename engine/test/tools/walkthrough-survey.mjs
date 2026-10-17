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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, findCodedMove, splitSelection } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { ALL8_FIGURE_START, figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';
import { CONTACT, NEAR_MISS, SURVEY_CALLS, classifyApplyFault, sweepApplyFaults } from '../lib/apply-faults.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const minArg = process.argv.indexOf('--min');
const THRESHOLD = minArg >= 0 ? Number(process.argv[minArg + 1]) : NEAR_MISS;
const SAMPLES = 24;

const CALLS = SURVEY_CALLS;

const formations = seq.listFormations().filter((n) => {
  const b = seq.boardForFormation(n);
  return b !== null && b.dancers.length === 8;
});
console.log(`=== ${formations.length} named 8-dancer formation(s) x ${CALLS.length} call(s) ===`);
console.log(`    flagging any whose BODIES come within ${THRESHOLD.toFixed(2)} units at some beat`);
console.log(`    (a BODY gap: 0 is contact, below 0 is two dancers in the same space)\n`);

// THE SWEEP AND THE CLASSIFICATION ARE A RULE AND LIVE IN `test/lib/apply-faults.mjs`, because
// `apply-fault-gate.mjs` asserts on the same numbers and two copies of a threshold is how a gate stops
// describing what the survey measures.
const survey = sweepApplyFaults(seq, formations, CALLS, SAMPLES, THRESHOLD);
const { hits, coincident, animFault, applyFault } = survey;
const applied = survey.applied;
const clean = survey.clean;
console.log(`  ${applied} (formation, call) pair(s) applied; ${clean} animated without a body pair below the flag`);
console.log(`  ${hits.length} pair(s) flagged:\n`);

// Severity, then by CALL. "Coincident" is the unambiguous case: two BODIES in the same space, which no dance
// path does. A near-miss may just be dancers passing.
console.log(`  COINCIDENT (body gap < ${CONTACT}): ${coincident.length}`);
console.log(`    ... of which the END board is healthy (body gap >= ${CONTACT}): ${animFault.length}  <- the ANIMATION is at fault`);
console.log(`    ... of which the END board is already broken:   ${applyFault.length}  <- the APPLY is at fault`);
console.log(`  near-miss (body gap < ${THRESHOLD.toFixed(2)}, >= ${CONTACT}): ${(hits.length - coincident.length)}\n`);

// THE APPLY FAULTS ARE NOT A WRONG-SEPARATION FAULT. Measured rather than argued: for every one of them,
// ask how well the group the applicator used actually IS the variant's setup. A congruent admission means
// the separation is right and the call's own body is what collides the dancers; the permissions that
// could be withdrawn instead (mirrored reading, gender-blind admission, interactive tolerance) are
// reported under their own names, in `test/lib/apply-faults.mjs`.
console.log('  THE APPLY FAULTS, AND WHOSE FAULT THEY ARE:');
const applyKinds = { body: 0, genderMiss: 0, mirrored: 0, loose: 0, noncongruent: 0 };
const applyByCall = new Map();
for (const h of applyFault) {
  applyByCall.set(h.call, (applyByCall.get(h.call) ?? 0) + 1);
  const c = classifyApplyFault(seq, h);
  if (c) applyKinds[c.kind]++;
}
console.log(`    of ${applyFault.length}: ${applyKinds.body} BODY (congruent at the tightest 0.01, unreflected,`);
console.log(`    gender-exact - no matching rule can refuse them), ${applyKinds.genderMiss} gender-miss,`);
console.log(`    ${applyKinds.mirrored} mirrored, ${applyKinds.loose} loose, ${applyKinds.noncongruent} non-congruent`);
console.log('    by CALL:');
for (const [call, n] of [...applyByCall].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)}  ${call}`);

const byCall = new Map();
for (const h of animFault) byCall.set(h.call, (byCall.get(h.call) ?? 0) + 1);
console.log('  ANIMATION-fault pairs, by CALL:');
for (const [call, n] of [...byCall].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(3)}  ${call}`);
}

// WHICH OF THESE CAN THE CODED PATH EVEN REACH? `evaluateSequence` dispatches a call that
// `findCodedMove` knows to `evaluateCodedAt`; everything else goes through `evaluateCallAt`, i.e.
// the whole-board authored path or the parallel per-group path. This matters because a change to
// `evaluateCodedAt` CANNOT affect a catalogue call, so the split says where the next work belongs:
// one is a routing problem, the other an authoring/matching problem.
const codedHits = animFault.filter((h) => findCodedMove(h.call));
const catHits = animFault.filter((h) => !findCodedMove(h.call));
console.log(`\n  reachable by evaluateCodedAt (CODED):     ${codedHits.length}`);
console.log(`  NOT coded (authored path / parallel):     ${catHits.length}`);
const catByCall = new Map();
for (const h of catHits) catByCall.set(h.call, (catByCall.get(h.call) ?? 0) + 1);
for (const [call, n] of [...catByCall].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`       ${String(n).padStart(3)}  ${call}`);
}

// DOES REAL CHOREOGRAPHY USE THE COMBINATION? The survey enumerates every LEGAL (formation, call)
// pair, and most of those no one ever calls. So the ranking above can be aimed at combinations that
// never occur - `Right and Left Thru from 3 and 1 lines #1` is the worst case on the list and the
// corpora use it ZERO times. This walks the ceder module corpus and All8's 188 figures, records the
// formation standing before each call, and marks the faults accordingly.
{
  const used = new Set();
  const note = (call, fm) => used.add(`${call}\u0000${fm}`);
  let board = seq.boardForFormation(ALL8_FIGURE_START);
  if (board) {
    for (const f of loadAll8Figures().figures) {
      let b = seq.boardForFormation(ALL8_FIGURE_START);
      for (const s of figureEngineCalls(f)) {
        const fm = seq.knownFormation(b);
        if (fm) note(splitSelection(typeof s === 'string' ? s : s.call).call, fm);
        const r = seq.applyToBoard(b, s);
        if (!r.legal) break;
        b = r.board;
      }
    }
  }
  const walkDir = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) { walkDir(p); continue; }
      if (!p.endsWith('.json')) continue;
      let v;
      try { v = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
      if (!v || !Array.isArray(v.steps) || v.success !== true) continue;
      if (v.steps.includes('ALLEMANDE_LEFT')) continue;
      let b = seq.boardForFormation(ALL8_FIGURE_START);
      for (const s of v.steps) {
        const fm = seq.knownFormation(b);
        if (fm) note(splitSelection(typeof s === 'string' ? s : s.call).call, fm);
        const r = seq.applyToBoard(b, s);
        if (!r.legal) break;
        b = r.board;
      }
    }
  };
  walkDir(path.join(root, 'modules'));
  const real = hits.filter((h) => used.has(`${h.call}\u0000${h.formation}`));
  const unused = hits.filter((h) => !used.has(`${h.call}\u0000${h.formation}`));
  console.log(`\n  COMBINATIONS REAL CHOREOGRAPHY ACTUALLY USES (of the flagged ones): ${real.length}`);
  console.log(`  flagged but NEVER used by any figure or module:                     ${unused.length}`);
  if (real.length) {
    console.log('\n  the ones that matter, worst first:');
    for (const h of real.slice(0, 15)) {
      console.log(`    ${h.worst.toFixed(2)} @${h.worstBeat.toFixed(1)}/${h.total.toFixed(1)}b  ${h.call}  from ${h.formation}  (end ${h.endGap.toFixed(2)})`);
    }
  }
}

// THE PERMUTATION STRUCTURE, which decides what kind of routing is needed. A position permutation
// decomposes into cycles; a 2-cycle is two dancers swapping (routable as a rigid half-turn about
// their midpoint, which is what the engine now does), a k-cycle is k dancers each moving to the next
// position, which a pair rotation cannot express. If the remaining failures are LONGER cycles then
// the fix has to generalise; if they are 2-cycles then the detection is what is failing.
console.log('\n  permutation structure of the animation-fault pairs:');
const shapes = new Map();
const POS_TOL = 0.35;
for (const h of animFault) {
  const start = seq.boardForFormation(h.formation);
  const r = seq.applyToBoard(start, h.call);
  const ends = r.board.dancers;
  const starts = start.dancers;
  const map = new Map(); // start dancer id -> end dancer id whose START it lands on
  for (const d of ends) {
    const p = starts.find((s) => Math.hypot(s.x - d.x, s.y - d.y) < POS_TOL);
    if (p) map.set(p.id, d.id);
  }
  const seen = new Set();
  const sizes = [];
  for (const id of map.keys()) {
    if (seen.has(id)) continue;
    let n = 0;
    let cur = id;
    while (!seen.has(cur)) {
      seen.add(cur);
      cur = map.get(cur);
      n++;
      if (cur === undefined) break;
    }
    sizes.push(n);
  }
  const key = sizes.sort((a, b) => a - b).join('+') || 'unmapped';
  if (!shapes.has(key)) shapes.set(key, []);
  shapes.get(key).push(`${h.call} from ${h.formation}`);
}
for (const [shape, list] of [...shapes].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${String(list.length).padStart(3)}  cycles ${shape}`);
  for (const x of list.slice(0, 3)) console.log(`           e.g. ${x}`);
}

console.log('\n  worst 12 in detail:');
for (const h of hits.slice(0, 12)) {
  console.log(
    `  ${h.worst.toFixed(2)} @${h.worstBeat.toFixed(1)}/${h.total.toFixed(1)}b  ${h.call}  from ${h.formation}  (end ${h.endGap.toFixed(2)})`,
  );
}
