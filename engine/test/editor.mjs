// Call-editor headless test: synthesize a missing setup by padding core moves,
// verify the geometry (positions + headings at pad boundaries), and round-trip
// the exported <tam> XML through buildCall.
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setParser,
  parseMoves,
  parseFormations,
  parseCallXml,
  buildCall,
  loadCallFromXml,
  poseFor,
  dancerBeats,
  rigidFit,
  alignFormationToCore,
  synthesizeSetup,
  synthesizeSetupChain,
  setupToXml,
  callToXml,
  endPoses,
  closureDiscrepancy,
  correctEndTo,
  DEG,
} from '../dist/index.js';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const movesXml = read('../../poc/src/assets/moves.xml');
const formationsXml = read('../../poc/src/assets/formations.xml');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps;
const nearAng = (a, b, eps = 0.06) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d) < eps;
};

// Pick a full-set mainstream setup (no mirrored half). Circle Left from a
// squared set is authored for all 8 dancers.
const circleXml = read('../../poc/src/assets/ms/circle.xml');
const core = loadCallFromXml(circleXml, movesXml, formationsXml, 0, true);
console.log(`== core: ${core.title} (${core.dancers.length} dancers, beats ${core.beats}) ==`);
check(core.dancers.length === 8, 'core loads to a full 8-dancer set');

const PAD = 2;
const coreStart = core.dancers.map((d) => poseFor(d, 0));
const coreEnd = core.dancers.map((d) => poseFor(d, core.beats));

// New start = core start rigidly shifted +2 in x; new end = core end shifted -1.
const start = coreStart.map((p) => ({ x: p.x + 2, y: p.y, heading: p.heading }));
const end = coreEnd.map((p) => ({ x: p.x - 1, y: p.y, heading: p.heading }));

const syn = synthesizeSetup(core, { name: 'from Shifted Square', start, end, padBeats: PAD });
console.log('== synthesized setup ==');
check(syn.dancers.length === 8, 'has 8 dancers');
check(syn.beats === PAD + core.beats + PAD, `beats = ${syn.beats} (expect ${PAD + core.beats + PAD})`);
check(syn.totalBeats === core.leadin + syn.beats + core.leadout, 'totalBeats = leadin + beats + leadout');
check(syn.dancers.every((d) => dancerBeats(d) === syn.beats), 'every dancer has the full padded path');

// 1. At beat 0 -> newStart.
for (let i = 0; i < 8; i++) {
  const p = poseFor(syn.dancers[i], 0);
  check(near(p.x, start[i].x) && near(p.y, start[i].y) && nearAng(p.heading, start[i].heading), `dancer ${i + 1} starts at newStart (${p.x.toFixed(2)},${p.y.toFixed(2)} h=${(p.heading * 180 / Math.PI).toFixed(1)})`);
}

// 2. After pad-in -> coreStart.
for (let i = 0; i < 8; i++) {
  const p = poseFor(syn.dancers[i], PAD);
  check(near(p.x, coreStart[i].x) && near(p.y, coreStart[i].y) && nearAng(p.heading, coreStart[i].heading), `dancer ${i + 1} reaches coreStart after pad-in`);
}

// 3. At end of core -> coreEnd.
for (let i = 0; i < 8; i++) {
  const p = poseFor(syn.dancers[i], PAD + core.beats);
  check(near(p.x, coreEnd[i].x) && near(p.y, coreEnd[i].y) && nearAng(p.heading, coreEnd[i].heading), `dancer ${i + 1} reaches coreEnd before pad-out`);
}

// 4. At total path end -> newEnd.
for (let i = 0; i < 8; i++) {
  const p = poseFor(syn.dancers[i], syn.beats);
  check(near(p.x, end[i].x) && near(p.y, end[i].y) && nearAng(p.heading, end[i].heading), `dancer ${i + 1} ends at newEnd (${p.x.toFixed(2)},${p.y.toFixed(2)})`);
}

// 5. Mid-pad motion is a straight-line (rigid) shift for a congruent formation.
{
  const mid = poseFor(syn.dancers[0], PAD / 2);
  const expect = { x: (start[0].x + coreStart[0].x) / 2, y: (start[0].y + coreStart[0].y) / 2 };
  check(near(mid.x, expect.x) && near(mid.y, expect.y), 'mid-pad position is the midpoint (straight-line pad)');
}

// 6. XML round-trip.
console.log('== XML round-trip ==');
const xml = setupToXml(core, { name: 'from Shifted Square', start, end, padBeats: PAD });
const tams = parseCallXml('<calls>' + xml + '</calls>');
check(tams.length === 1, 'setupToXml emits one <tam>');
const rebuilt = buildCall(tams[0], parseFormations(formationsXml), parseMoves(movesXml), false);
check(rebuilt.dancers.length === 8, 'rebuilt tam has 8 dancers');
check(rebuilt.dancers.every((d) => dancerBeats(d) === syn.beats), 'rebuilt dancer beats match synthesis');
check(rebuilt.beats === syn.beats, 'rebuilt call beats match synthesis');
{
  const p = poseFor(rebuilt.dancers[0], rebuilt.beats);
  check(near(p.x, end[0].x, 0.25) && near(p.y, end[0].y, 0.25) && nearAng(p.heading, end[0].heading, 0.25), 'rebuilt call ends at newEnd');
}

// 7. alignment helper.
console.log('== alignFormationToCore ==');
{
  const formation = coreStart.map((p, i) => ({ x: p.x + 5, y: p.y - 3, heading: p.heading }));
  const aligned = alignFormationToCore(coreStart, formation);
  const fit = rigidFit(formation, coreStart);
  check(fit.error < 0.01, `rigid fit error small for congruent formation: ${fit.error.toFixed(3)}`);
  check(aligned.length === 8 && aligned.every((f, i) => near(f.x - coreStart[i].x, 5) && near(f.y - coreStart[i].y, -3)), 'aligned formation keeps identity + original frame');
}

// 7b. Rotation about the ORIGIN: a 90-degree-rotated copy must align to the same
// dancer identities (couple 1 still maps to couple 1).
{
  const cos = Math.cos(Math.PI / 2);
  const sin = Math.sin(Math.PI / 2);
  const rotated = coreStart.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos, heading: p.heading + Math.PI / 2 }));
  const aligned = alignFormationToCore(coreStart, rotated);
  let ok = true;
  for (let i = 0; i < 8; i++) {
    const ex = rotated[i].x;
    const ey = rotated[i].y;
    if (!(near(aligned[i].x, ex) && near(aligned[i].y, ey))) {
      ok = false;
      console.log(`    dancer ${i + 1}: got (${aligned[i].x.toFixed(2)},${aligned[i].y.toFixed(2)}) expect (${ex.toFixed(2)},${ey.toFixed(2)})`);
    }
  }
  check(ok, '90-degree (about-origin) rotated formation maps to matching identities');
}

// 8. Chain: concatenate two setups (use the same call twice) with a connector.
console.log('== synthesizeSetupChain ==');{
  const LEAD = 1;
  const CONN = 2;
  const s = start; // new start (pre-end), aligned
  const e = end; // new end (post-start), aligned
  const chain = synthesizeSetupChain(core, core, { name: 'chained', start: s, end: e, leadBeats: LEAD, connectorBeats: CONN });
  const total = LEAD + core.beats + CONN + core.beats + LEAD;
  check(chain.dancers.length === 8, 'chain has 8 dancers');
  check(chain.beats === total, `chain beats = ${chain.beats} (expect ${total})`);
  const b = LEAD + core.beats + CONN; // boundary into coreB
  for (let i = 0; i < 8; i++) {
    const p0 = poseFor(chain.dancers[i], 0);
    check(near(p0.x, s[i].x) && near(p0.y, s[i].y) && nearAng(p0.heading, s[i].heading), `chain dancer ${i + 1} starts at start`);
    const pA = poseFor(chain.dancers[i], LEAD + core.beats);
    check(near(pA.x, coreEnd[i].x) && near(pA.y, coreEnd[i].y), `chain dancer ${i + 1} at coreA end`);
    const pB = poseFor(chain.dancers[i], b);
    check(near(pB.x, coreStart[i].x) && near(pB.y, coreStart[i].y), `chain dancer ${i + 1} at coreB start (connector)`);
    const pE = poseFor(chain.dancers[i], total);
    check(near(pE.x, e[i].x) && near(pE.y, e[i].y) && nearAng(pE.heading, e[i].heading), `chain dancer ${i + 1} ends at end`);
  }
}

// 9. Closure fix: correct the (deliberately misaligned) Circle Left end back to
// a squared set. Uses the real circle.xml which, with its lead-ins, leaves the
// set rotated ~44deg.
console.log('== closure correction (correctEndTo) ==');
{
  const circleXml = read('../../poc/src/assets/b1/circle.xml');
  const circleLeft = loadCallFromXml(circleXml, movesXml, formationsXml, 0, true); // Circle Left (mirrored)
  // Intended end = each dancer's OWN start pose (a full circle returns home).
  const target = circleLeft.dancers.map((d) => {
    const p = poseFor(d, 0);
    return { x: p.x, y: p.y, heading: p.heading, gender: d.gender };
  });
  // Before: the call does NOT close (girls' headings off ~44deg).
  const disc = closureDiscrepancy(circleLeft, target);
  check(disc.maxHeadingErr > 0.2, `uncorrected Circle Left has heading discrepancy ${(disc.maxHeadingErr * 180 / Math.PI).toFixed(0)}deg`);
  check(disc.maxPosErr < 1.5, `uncorrected positions near home (max ${disc.maxPosErr.toFixed(2)})`);

  const fixed = correctEndTo(circleLeft, target);
  check(fixed.dancers.length === 8, 'fixed call keeps 8 dancers');
  check(fixed.beats === circleLeft.beats, `fixed call keeps its beat count (${fixed.beats} == ${circleLeft.beats})`);
  const fin = endPoses(fixed);
  let ok = true;
  for (let i = 0; i < 8; i++) {
    if (!(near(fin[i].x, target[i].x, 0.1) && near(fin[i].y, target[i].y, 0.1) && nearAng(fin[i].heading, target[i].heading, 0.1))) ok = false;
  }
  check(ok, 'corrected call ends at each dancer\'s home spot (all 8 dancers, incl. mirrored)');
}

// 10. callToXml round-trips a MIRRORED (half-set) call: the re-parsed start
// formation must match the original (so the sequencer can register it).
console.log('== callToXml mirror round-trip ==');
{
  const circleXml = read('../../poc/src/assets/b1/circle.xml');
  const cl = loadCallFromXml(circleXml, movesXml, formationsXml, 0, true);
  const xml = callToXml(cl, cl.title);
  const rt = buildCall(parseCallXml(xml)[0], parseFormations(formationsXml), parseMoves(movesXml), true);
  let ok = true;
  for (let i = 0; i < rt.dancers.length; i++) {
    const a = poseFor(cl.dancers[i], 0);
    const b = poseFor(rt.dancers[i], 0);
    if (!(near(a.x, b.x, 0.05) && near(a.y, b.y, 0.05))) ok = false;
  }
  check(ok, 'callToXml -> reparse preserves the start formation for a mirrored call');
}

console.log('\n=================');
if (failures === 0) console.log('EDITOR TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
