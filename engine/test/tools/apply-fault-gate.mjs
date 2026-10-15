// THE APPLY FAULTS, PINNED. Every (formation, call) application that ends with two dancers on one spot,
// which no animation can repair - and the split that says whose fault each one is.
//
// WHY IT IS A GATE AND NOT ONLY A SURVEY. `walkthrough-survey.mjs` reported a COUNT and nothing failed
// when it moved: re-measured 2026-10-14 it had gone 22 -> 50 and no gate noticed. This pins it so the
// next movement is a red line rather than a number somebody has to think to re-read.
//
// THE PINS ARE IMPROVEMENT-SAFE BY CONSTRUCTION, which is the whole design constraint on a gate that
// pins a defect: a CEILING passes when the number falls (a fix) and fails when it grows (a regression),
// and the congruence check fails only for a fault a separation rule could legitimately refuse. There is
// deliberately NO floor on the count and no pin on the body/permission split: a corpus improvement must
// not turn this red.
//
// THE WORK LIST IS PRINTED, because a count is not a work list. The by-call tally says where the next hour
// goes: RE-MEASURED ON THE BODY MODEL at this revision, `Turn Thru` 4, `Touch a Quarter` 3, `Wheel and Deal`
// 3, `Lead Right` 2, `Box the Gnat` 2, `Square Thru 4` 2, `Chain Down the Line` 2, then six calls at one
// each - and 13 of the 23 are catalogue (authored) bodies, `Swing Thru` being the only coded move among them.
//
// THE MEASURE IS THE ENGINE'S BODY MODEL, and that is a change of WHOLE. This file used CENTRE distance
// (`closestPair < 0.1`), which `apply-faults.mjs`'s header now records as superseded, and the reason is
// measured: on `Tidal Line RH` + `Chain Down the Line` the centre measure preferred an application whose
// bodies pass through each other by **-0.700** over one that grazes at **+0.003**, because their centres read
// 0.136 against 0.062. The same change moves the animation half of the split by an order of magnitude:
// **295** applications put two bodies in the same space somewhere in their motion, of which **272** end on a
// healthy board (the path is the fault) and **23** end with the destination already broken (the call's own
// body). The 295 is consistent with the engine's own recorded figure - `BODY_PATH_CLEARANCE`'s note measures
// 723 of 1580 corpus modules overlapping, i.e. about 46%, which is why `'guard'` is not the default.
//
// THE CEILING TRACKS THE TREE. It was 50, then 37 on the centre measure, and it is **23** here; the gate's
// own instruction is to lower it in the same commit that re-measures, because a ceiling cannot report a fall.
//
// WHAT THIS SWEEP CANNOT SEE, measured rather than assumed. `SURVEY_CALLS` names the BARE `Lead Right`, so
// the authoring titles the corpus ALSO publishes (`Lead Right - Close` / `- Normal` / `- Far`, and
// `Lead Left - Normal` / `- Far`) are never applied here. They carry most of the family's faults: sweeping
// all seven titles over the same 138 formations measured 450 of 966 applications legal and **86 apply faults
// over 47 boards** on the CENTRE measure - the five variants 83, the two bare names 7. They are also
// UNGOVERNED by `PERMISSION_RULES`: each is offered on all 138 formations x 45 group names, against 20 of
// 6,210 for the bare names. Widening this sweep is a separate change; the 86 was taken on the old measure and
// has NOT been re-taken on this one.
//
// Run: node engine/test/tools/apply-fault-gate.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { classifyApplyFault, sweepApplyFaults } from '../lib/apply-faults.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}`); }
};

/**
 * The apply-fault count as last measured. A CEILING, not an equality: fewer faults is a fix and must not
 * fail here. Lower it in the same commit that fixes faults, so the pin keeps tracking the tree.
 */
const APPLY_FAULT_CEILING = 23;

const formations = seq.listFormations().filter((n) => {
  const b = seq.boardForFormation(n);
  return b !== null && b.dancers.length === 8;
});
const survey = sweepApplyFaults(seq, formations);
console.log(`== the apply faults ==`);
console.log(`   ${formations.length} formation(s) x 33 call(s): ${survey.applied} applied, ${survey.coincident.length} coincident`);
console.log(`   ANIMATION fault ${survey.animFault.length} (the end board is healthy - an animator's job)`);
console.log(`   APPLY fault     ${survey.applyFault.length} (the end board is already broken - the call's own body)`);

// COVERAGE FIRST: a sweep that applied nothing would pass every pin below while measuring air.
check(survey.applied > 300 && survey.applyFault.length > 0,
  `the sweep still measures something (${survey.applied} applied, ${survey.applyFault.length} apply faults)`);

// THE CEILING.
check(survey.applyFault.length <= APPLY_FAULT_CEILING,
  `the apply-fault count has not grown (${survey.applyFault.length}, ceiling ${APPLY_FAULT_CEILING})`);

// THE WORK LIST, and the classification that decides who owns it.
const byCall = new Map();
const tally = { body: 0, genderMiss: 0, mirrored: 0, loose: 0, noncongruent: 0, unmeasured: 0 };
let worstGap = 0;
let worstBodyError = 0;
const byTol = new Map();
for (const h of survey.applyFault) {
  byCall.set(h.call, (byCall.get(h.call) ?? 0) + 1);
  const c = classifyApplyFault(seq, h);
  if (!c) { tally.unmeasured++; continue; }
  tally[c.kind]++;
  byTol.set(c.congruentAt, (byTol.get(c.congruentAt) ?? 0) + 1);
  worstGap = Math.max(worstGap, c.worstDistanceGap);
  if (c.kind === 'body') worstBodyError = Math.max(worstBodyError, c.congruentError);
}
console.log(`\n   whose fault, per fault:`);
console.log(`     ${tally.body} BODY          congruent at the tightest 0.01, unreflected, gender-exact - no`);
console.log(`                     matching rule can refuse them: the call's own body collides them`);
console.log(`     ${tally.genderMiss} GENDER-MISS   congruent only with the gender requirement relaxed (a permission)`);
console.log(`     ${tally.mirrored} MIRRORED      congruent only as the set's mirror (a permission)`);
console.log(`     ${tally.loose} LOOSE         separated correctly in SHAPE, congruent only at the loosest 1.5`);
console.log(`     ${tally.noncongruent} NON-CONGRUENT a wrong separation - the only kind a separation rule can refuse`);
if (tally.unmeasured) console.log(`     ${tally.unmeasured} UNMEASURED    the application or its variant left the sweep`);
console.log(`   worst per-pair separation disagreement across all of them: ${worstGap.toFixed(4)} units`);
console.log(`   worst mean match error among the BODY faults: ${worstBodyError.toFixed(4)} units`);
console.log(`   congruent at: ${[...byTol].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)).map(([t, n]) => `${n} x ${t ?? 'never'}`).join(', ')}`);
console.log(`   by call:`);
for (const [call, n] of [...byCall].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(3)}  ${call}`);

// AND THE ONE CHECK THAT WOULD CATCH THIS BEING A SEPARATION DEFECT. A fault whose own group is not
// geometrically congruent with the setup it was applied through is a wrong-separation admission: it can
// be refused, and the refusal would belong in the matcher rather than in a body. MEASURED 2026-10-14:
// none of the 50, even at the loose 1.5 admission.
check(tally.noncongruent === 0,
  `no apply fault is caused by a NON-CONGRUENT admission (${tally.noncongruent})`);
// The body/permission split is REPORTED rather than pinned, for the reason in the header: a corpus
// improvement moves it and must not turn this red.
console.log(`   (measured split: ${tally.body} body / ${tally.genderMiss} genderMiss / ${tally.mirrored} mirrored / ${tally.loose} loose - reported, not pinned)`);

console.log('\n=================');
if (failures === 0) console.log('ALL CHECKS PASSED');
else console.log(`${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
