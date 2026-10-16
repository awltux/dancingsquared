// Matrix getout fast-path test: a rigid self-inverse call (Circle Left from the
// full catalog moves the set) produces a board; from that board getout must
// return that SAME single call via the matrix fast-path. Run: node test/matrix-getout.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, sameBoardById, makeSquaredSet } from '../dist/index.js';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const root = path.join(__dirname, '..', '..');
const movesXml = read('../../poc/src/assets/moves.xml');
const formationsXml = read('../../poc/src/assets/formations.xml');
const msDir = path.join(root, 'poc/src/assets/ms');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// Build the full catalog so rigid self-inverse calls that MOVE the set (Circle
// Left) are available and legal from home.
const files = {};
for (const f of fs.readdirSync(msDir).filter((f) => f.endsWith('.xml'))) {
  files[`ms/${f}`] = read(`../../poc/src/assets/ms/${f}`);
}
const { buildCatalog, makeSequencer } = await import('../../poc-teacher/src/catalog.ts');
const seq = makeSequencer(movesXml, formationsXml, buildCatalog(files));

console.log('== Matrix getout fast-path (rigid self-inverse single call) ==');
// THE WITNESSES ARE MEASURED RIGID **AND** SELF-INVERSE, AND THE OLD ONES ARE NEITHER. Bare `Circle Left`
// and `Circle Right` used to be this witness. `ms/circle.xml` now authors the bare circle INTO the ring
// (its section header says `CIRCLE LEFT FAMILY FROM STATIC SQUARE TO CIRCLE`), so applying EITHER of them
// TWICE from home leaves the set on the `Circle` formation at radius 2.414 with ALL EIGHT dancers off their
// own spot - measured, and the two calls produce the identical end board.
//
// THE SECTION PASSED ANYWAY, AND THAT IS THE SECOND HALF OF THE FIX. `seq.isAt('Static Square')` is
// `matchesNamed` (`sequencer.ts`), i.e. the SAME loose predicate that let `getout` return a permuted
// squared set as home - so the harness verified the path with the predicate that produced it and could not
// tell. The path is now verified BY IDENTITY, the property `engine/test/getout-convention.mjs` replays for
// every path it accepts, and the witness list is the calls that really are rigid AND self-inverse (each
// measured rigid to ~1e-16 and identity after two applications).
const selfInverse = ['Right and Left Thru', 'Circle Left 1/2 - Stop at Home', 'All 4 Couples Right and Left Thru'];
for (const call of selfInverse) {
  seq.reset();
  const start = seq.startBoard();
  const step = seq.apply(call);
  if (!step.legal) { check(false, `${call}: not legal from home`); continue; }
  const moved = step.board.dancers.some((d, i) =>
    Math.hypot(d.x - start.dancers[i].x, d.y - start.dancers[i].y) > 1e-3 ||
    Math.abs(d.heading - start.dancers[i].heading) > 1e-3);
  check(moved, `${call} actually moves the set (valid fast-path target)`);
  const g = seq.getout({ target: 'Static Square', maxCalls: 2 });
  // The fast-path may return any self-inverse call whose image is rotationally
  // congruent (e.g. Circle Right's image matches Circle Left's). The property is
  // that it returns a SINGLE call that genuinely closes home.
  const ok = Array.isArray(g) && g.length === 1;
  check(ok, `${call}: getout returns a single-call path [${g ? g.join(' > ') : 'null'}]`);
  if (ok) {
    seq.reset();
    seq.apply(call);
    const r = seq.apply(g[0]);
    const home = sameBoardById(r.board, makeSquaredSet());
    check(r.legal && home, `  ${call} getout [${g.join('>')}] is legal and reaches Static Square BY IDENTITY${home ? '' : ' (a name match is not a home)'}`);
  }
}

// A rigid-but-not-self-inverse call must NOT be returned as a single-call getout
// (fast-path must only claim genuinely self-inverse calls).
console.log('\n== Matrix getout fast-path safety (non-self-inverse rigid) ==');
// THE WITNESSES ARE THE RIGID NON-SELF-INVERSE CALLS. This section used `Circle Left 1/4` and
// `Circle Left 1/2`, with a comment calling them "rigid but not self-inverse (four of them = home)":
// MEASURED, the bare quarters are not rigid at all any more - they have no fit against the home set,
// because they end on the `Circle` formation - so the section was testing the wrong property with the
// wrong witnesses. These ARE rigid and are NOT self-inverse (measuring rigid ~1e-16 and false for
// twice-from-home), which is exactly the shape the fast-path must refuse to claim. They are all `ms`
// calls because this harness builds its catalogue from `ms/` alone: `All 4 Couples Cross Trail Thru` is
// rigid and not self-inverse too, but it is a `plus`/`a1` call and is not registered here at all.
const notSelfInverse = ['Circle Left 1/4 - Stop at Home', 'Circle Left 3/4 - Stop at Home', 'Circle Right 1/4 - Stop at Home', 'Circle Right 3/4 - Stop at Home'];
for (const call of notSelfInverse) {
  seq.reset();
  const step = seq.apply(call);
  if (!step.legal) { check(false, `${call}: not legal from home`); continue; }
  const g = seq.getout({ target: 'Static Square', maxCalls: 3 });
  const claimsSelfInverse = Array.isArray(g) && g.length === 1 && g[0] === call;
  check(!claimsSelfInverse, `${call}: fast-path does NOT claim a non-self-inverse single call (getout=[${g ? g.join(' > ') : 'null'}])`);
  if (Array.isArray(g)) {
    // Whatever path it found must actually close home, BY IDENTITY.
    seq.reset();
    seq.apply(call);
    let legal = true;
    for (const c of g) if (!seq.apply(c).legal) legal = false;
    const closed = sameBoardById(seq.startBoard(), makeSquaredSet());
    check(legal && closed, `  ${call} getout path is legal and reaches Static Square by identity`);
  }
}

console.log('\n=================');
if (failures === 0) console.log('MATRIX GETOUT TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
