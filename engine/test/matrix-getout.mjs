// Matrix getout fast-path test: a rigid self-inverse call (Circle Left from the
// full catalog moves the set) produces a board; from that board getout must
// return that SAME single call via the matrix fast-path. Run: node test/matrix-getout.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser } from '../dist/index.js';
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
// Circle Left/Right from the catalog are rigid, self-inverse, and move the set.
for (const call of ['Circle Left', 'Circle Right']) {
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
    check(r.legal && seq.isAt('Static Square'), `  ${call} getout [${g.join('>')}] is legal and reaches Static Square`);
  }
}

// A rigid-but-not-self-inverse call must NOT be returned as a single-call getout
// (fast-path must only claim genuinely self-inverse calls). Circle Left 1/4 is
// rigid but not self-inverse (four of them = home), so from its image getout
// must NOT return [Circle Left 1/4].
console.log('\n== Matrix getout fast-path safety (non-self-inverse rigid) ==');
for (const call of ['Circle Left 1/4', 'Circle Left 1/2']) {
  seq.reset();
  const step = seq.apply(call);
  if (!step.legal) { check(false, `${call}: not legal from home`); continue; }
  const g = seq.getout({ target: 'Static Square', maxCalls: 3 });
  const claimsSelfInverse = Array.isArray(g) && g.length === 1 && g[0] === call;
  check(!claimsSelfInverse, `${call}: fast-path does NOT claim a non-self-inverse single call (getout=[${g ? g.join(' > ') : 'null'}])`);
  if (Array.isArray(g)) {
    // Whatever path it found must actually close home.
    seq.reset();
    seq.apply(call);
    let legal = true;
    for (const c of g) if (!seq.apply(c).legal) legal = false;
    check(legal && seq.isAt('Static Square'), `  ${call} getout path is legal and reaches Static Square`);
  }
}

console.log('\n=================');
if (failures === 0) console.log('MATRIX GETOUT TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
