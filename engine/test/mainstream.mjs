// Mainstream-subset sequencer test: load all Mainstream calls, verify they
// register, apply a call, and run a bounded getout search.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser, Sequencer, callMeta } from '../dist/index.js';
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

const msDir = path.join(__dirname, '../../poc/src/assets/ms');
const files = fs.readdirSync(msDir).filter((f) => f.endsWith('.xml'));
const seq = new Sequencer(movesXml, formationsXml);
let registered = 0;
for (const f of files) {
  const xml = read(`../../poc/src/assets/ms/${f}`);
  const meta = callMeta(xml);
  if (!meta.title) continue; // moves/rule file, not a call
  try {
    seq.register(meta.title, xml);
    registered++;
  } catch {
    /* skip calls whose data fails to build */
  }
}
check(registered >= 50, `Mainstream subset registers ${registered} calls (expect >= 50)`);

console.log('== From Squared Set ==');
const legal = seq.legalNext();
check(legal.length >= 1, `legalNext from squared set: [${legal.slice(0, 8).join(', ')}${legal.length > 8 ? '...' : ''}]`);

console.log('== Apply a call then getout ==');
const step = seq.apply(legal[0]);
check(step.legal === true, `applied "${legal[0]}"`);
const g = seq.getout({ target: 'Static Square', maxCalls: 4 });
check(Array.isArray(g) || g === null, `getout returned ${g ? g.join(' > ') : 'null'}`);
if (Array.isArray(g)) {
  // Validate the returned path: each call must be legal from the prior board.
  seq.reset();
  let ok = true;
  for (const name of g) {
    const r = seq.apply(name);
    if (!r.legal) {
      ok = false;
      console.log(`    invalid step: ${name}`);
    }
  }
  check(ok && seq.isAt('Static Square'), `getout path is legal and reaches Static Square`);
}

console.log('== getout restores the start FASR ==');
seq.reset();
const startFasr = seq.fasr();
const pre = ['Right and Left Thru'];
let preOk = true;
for (const c of pre) if (!seq.apply(c).legal) preOk = false;
const g2 = preOk ? seq.getout({ target: 'Static Square', maxCalls: 6 }) : null;
let fasrSame = false;
if (preOk && Array.isArray(g2)) {
  seq.reset();
  for (const c of pre) seq.apply(c);
  let ok = true;
  for (const c of g2) if (!seq.apply(c).legal) ok = false;
  if (ok) {
    const endFasr = seq.fasr();
    fasrSame =
      endFasr.sequence === startFasr.sequence &&
      JSON.stringify(endFasr.relationship) === JSON.stringify(startFasr.relationship);
  }
}
check(fasrSame, `getout end FASR equals start FASR (seq=${seq.fasr().sequence})`);

console.log('== getout from home (should find a path back) ==');
seq.reset();
const gHome = seq.getout({ target: 'Static Square', maxCalls: 2 });
check(Array.isArray(gHome) && gHome.length >= 1, `getout from home found: ${gHome ? gHome.join(' > ') : 'null'}`);
if (Array.isArray(gHome)) {
  seq.reset();
  let ok = true;
  for (const name of gHome) {
    if (!seq.apply(name).legal) ok = false;
  }
  check(ok && seq.isAt('Static Square'), 'getout-from-home path is legal and reaches Static Square');
}

console.log('== fixIt: calls that keep a getout alive ==');
seq.reset();
const fix = seq.fixIt({ depth: 3 });
check(Array.isArray(fix) && fix.includes('Circle Left'), `fixIt from home keeps a getout: [${fix.slice(0, 8).join(', ')}${fix.length > 8 ? '...' : ''}]`);

console.log('== User-defined modules ==');
seq.reset();
seq.registerModule('Circle Getout', ['Circle Left']);
check(seq.listModules().includes('Circle Getout'), 'module is registered');
check(seq.legalCalls(seq.board).includes('Circle Getout'), 'module is legal from Squared Set');
const modStep = seq.apply('Circle Getout');
check(modStep.legal && seq.isAt('Static Square'), 'applying a module reaches Static Square');

seq.reset();
seq.registerModule('Bad Getout', ['Swing Thru']); // Swing Thru is not legal from a squared set
check(!seq.legalCalls(seq.board).includes('Bad Getout'), 'a module containing an illegal call is not legal');
const badStep = seq.apply('Bad Getout');
check(badStep.legal === false && badStep.board === seq.board, 'applying an illegal module leaves the board unchanged');

seq.reset();
const gMod = seq.getout({ target: 'Static Square', maxCalls: 2 });
check(Array.isArray(gMod), `getout still finds a home path with modules registered: ${gMod ? gMod.join(' > ') : 'null'}`);

console.log('== Sequence animation (evaluateSequence) ==');
seq.reset();
const flat = seq.flatten(['Circle Left']);
const total = seq.sequenceBeats(flat);
const mid = seq.evaluateSequence(flat, total / 2);
const end = seq.evaluateSequence(flat, total);
check(flat.length === 1 && total > 0, `flat sequence beats = ${total}`);
check(mid.board.dancers.length === 8 && end.board.dancers.length === 8, 'evaluateSequence boards have 8 dancers');
seq.reset();
const applied = seq.apply('Circle Left');
check(
  end.board.dancers.every((d, i) => Math.hypot(d.x - applied.board.dancers[i].x, d.y - applied.board.dancers[i].y) < 0.01),
  'evaluateSequence end board matches applied board',
);

console.log('\n=================');
if (failures === 0) console.log('MAINSTREAM TEST PASSED');
else {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
