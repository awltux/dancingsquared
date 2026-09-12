// Matrix module test: per-dancer 5x5 affine exactness, rigid-fit detection,
// inverse, composition. Run: node test/matrix.mjs (after npm run build).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer, callMeta } from '../dist/index.js';
import {
  identity5,
  mul5,
  invert5,
  apply5,
  poseToVec,
  dancerMatrix,
  fitRigidMatrix,
  applyRigidToPose,
} from '../dist/matrix.js';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const movesXml = read('../../poc/src/assets/moves.xml');
const formationsXml = read('../../poc/src/assets/formations.xml');
const msDir = path.join(__dirname, '../../poc/src/assets/ms');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

console.log('== Matrix module: primitives ==');
const I = identity5();
let idOk = true;
for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (I[i][j] !== (i === j ? 1 : 0)) idOk = false;
check(idOk, 'identity5 is identity');

const A = dancerMatrix(1, 2, 0.3, 4, -1, 1.1);
const v = poseToVec(1, 2, 0.3);
const out = apply5(A, v);
const gotHeading = Math.atan2(out[3], out[2]);
check(Math.hypot(out[0] - 4, out[1] - (-1)) < 1e-12 && Math.abs(gotHeading - 1.1) < 1e-12, 'dancerMatrix maps start->end exactly');

const inv = invert5(A);
check(inv !== null, 'matrix invertible');
const roundTrip = apply5(mul5(inv, A), v);
check(Math.hypot(roundTrip[0] - v[0], roundTrip[1] - v[1]) < 1e-10, 'M^-1 * M = I on a vector');

console.log('\n== Matrix module: rigid fit ==');
// Use the full teacher catalog so calls that genuinely move the set are legal.
const files = {};
for (const f of fs.readdirSync(msDir).filter((f) => f.endsWith('.xml'))) {
  files[`ms/${f}`] = read(`../../poc/src/assets/ms/${f}`);
}
const { buildCatalog, makeSequencer } = await import('../../poc-teacher/src/catalog.ts');
const seq = makeSequencer(movesXml, formationsXml, buildCatalog(files));
// PHASE 9c MOVED `Right and Left Thru` FROM `nonRigid` TO `rigidCalls`, and it is a BEHAVIOUR
// CHANGE that is asserted rather than assumed. It used to be refused from home - so the `nonRigid`
// loop reported "not legal from home; skipped" - because no `Facing Couples` authoring matched two
// couples SIX apart. The separation-6 variant added in Phase 9c for `Heads Right and Left Thru`
// also lets the whole board tile (heads and sides are both facing-couple boxes at separation 6), so
// bare `Right and Left Thru` now applies to ALL FOUR couples, and the result is a single rigid
// transform of the home set: the 180-degree rotation, i.e. each couple trades with the couple
// across, which is what "everyone right and left thru" does. Measured, not assumed - the fit is
// exact, every couple stays 2.00 apart, and the get-out corpus does not regress.
//
// The open question is whether a caller SAYS it from a squared set without designating; that is a
// caller convention rather than a geometry fact and is recorded in PLAN.md Phase 9c. What is gated
// here is that IF it applies, it applies as ONE rigid motion, so a later change that makes it
// non-rigid from home has to be made deliberately.
const rigidCalls = ['Circle Left 1/4', 'Circle Right 1/4', 'All 4 Couples Promenade 1/4', 'Right and Left Thru'];
const nonRigid = ['Heads Promenade 1/2', 'Spin the Top', 'Star Thru'];
for (const call of rigidCalls) {
  seq.reset();
  const start = seq.startBoard();
  const st = seq.apply(call);
  if (!st.legal) { check(false, `${call}: not legal from home in catalog`); continue; }
  const moved = st.board.dancers.some((d, i) =>
    Math.hypot(d.x - start.dancers[i].x, d.y - start.dancers[i].y) > 1e-3 ||
    Math.abs(d.heading - start.dancers[i].heading) > 1e-3);
  if (!moved) { check(true, `${call} (no-op in this data; skipped)`); continue; }
  const fit = fitRigidMatrix(start.dancers, st.board.dancers, 1e-3);
  check(fit !== null, `${call} fits a single rigid matrix (residual=${fit ? fit.residual.toExponential(1) : 'n/a'})`);
  // The matrix, applied to the start, reproduces the end.
  if (fit) {
    let err = 0;
    for (let i = 0; i < start.dancers.length; i++) {
      const r = applyRigidToPose(fit.M, start.dancers[i]);
      err = Math.max(err, Math.hypot(r.x - st.board.dancers[i].x, r.y - st.board.dancers[i].y));
    }
    check(err < 1e-6, `  ${call} rigid matrix reproduces the end board (err=${err.toExponential(1)})`);
    // Inverse get-out: applying M^-1 to the end returns to start.
    const invFit = invert5(fit.M);
    let ierr = 0;
    for (let i = 0; i < st.board.dancers.length; i++) {
      const r = applyRigidToPose(invFit, st.board.dancers[i]);
      ierr = Math.max(ierr, Math.hypot(r.x - start.dancers[i].x, r.y - start.dancers[i].y));
    }
    check(ierr < 1e-6, `  ${call} M^-1 is an exact get-out (err=${ierr.toExponential(1)})`);
  }
}
for (const call of nonRigid) {
  seq.reset();
  const s = seq.startBoard();
  const st = seq.apply(call);
  if (!st.legal) { check(true, `${call} (not legal from home; skipped)`); continue; }
  const e = st.board;
  const fit = fitRigidMatrix(s.dancers, e.dancers, 1e-3);
  check(fit === null, `${call} does NOT fit a single rigid matrix (correctly non-rigid)`);
}

console.log('\n== Matrix module: composition (M_B∘M_A) ==');
function composeErr(A, B) {
  seq.reset();
  const home = seq.startBoard();
  const aend = seq.apply(A).board;
  const MA = fitRigidMatrix(home.dancers, aend.dancers, 1e-3);
  seq.reset();
  const bh = seq.startBoard();
  const bend = seq.apply(B).board;
  const MB = fitRigidMatrix(bh.dancers, bend.dancers, 1e-3);
  seq.reset();
  seq.apply(A);
  const ab = seq.apply(B).board;
  if (!MA || !MB) return null;
  const M = mul5(MB.M, MA.M);
  let err = 0;
  for (let i = 0; i < home.dancers.length; i++) {
    const r = applyRigidToPose(M, home.dancers[i]);
    err = Math.max(err, Math.hypot(r.x - ab.dancers[i].x, r.y - ab.dancers[i].y));
  }
  return err;
}
for (const B of ['Circle Right 1/4', 'All 4 Couples Promenade 1/4']) {
  const err = composeErr('Circle Left 1/4', B);
  check(err !== null && err < 1e-6, `Circle Left 1/4 -> ${B}: M_B∘M_A matches engine (err=${err === null ? 'n/a' : err.toExponential(1)})`);
}

console.log('\n=================');
if (failures === 0) console.log('MATRIX TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
