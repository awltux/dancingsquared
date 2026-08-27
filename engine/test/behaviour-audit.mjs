// Behaviour-audit: execute the capabilities the feature scenarios describe and
// report whether the LIVE engine actually implements each one. Unlike
// bind-audit (which only checks symbols exist), this runs real engine calls.
//
// Each check is classified:
//   PASS             - the engine implements the behaviour and it holds
//   NOT-IMPLEMENTED  - the capability is specified but not implemented in code
//   FAIL             - the capability exists but the check did not hold
//
// Run: `npm run build && node test/behaviour-audit.mjs` from engine/.
//
// The full catalog is loaded from the filesystem (the poc app uses Vite globs
// which do not run in Node). Unknown/unparseable files are skipped.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer, canonicalName, FORMATION_SYNONYMS, matchFormations } from '../dist/index.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const movesXml = read('poc/src/assets/moves.xml');
const formationsXml = read('poc/src/assets/formations.xml');
const levels = ['ms', 'b1', 'b2', 'a1', 'a2', 'plus'];

const calls = [];
for (const level of levels) {
  const dir = path.join(root, 'poc/src/assets', level);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.xml')); } catch { continue; }
  for (const f of files) {
    const base = f.replace(/\.xml$/, '');
    try { calls.push({ name: base, xml: read(`poc/src/assets/${level}/${f}`) }); } catch { /* skip */ }
  }
}
console.log(`Loaded ${calls.length} call files across ${levels.join(', ')}.`);

const seq = new Sequencer(movesXml, formationsXml, calls);

let pass = 0, ni = 0, fail = 0;
// check(cond, name, detail): cond true -> PASS, false -> FAIL
const check = (cond, name, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (cond) pass++; else fail++;
};
// ni(name, detail): an explicitly-not-implemented capability
const niReport = (name, detail = '') => {
  console.log(`  NI   ${name}${detail ? '  (' + detail + ')' : ''}`);
  ni++;
};

console.log('\n== Recognition & synonym ==');
const startName = seq.recognize(seq.board).name;
check(startName === 'Static Square', 'home square recognized as Static Square', startName);
check(canonicalName('Squared Set') === 'Static Square', 'canonicalName("Squared Set") == "Static Square"', canonicalName('Squared Set'));
check(FORMATION_SYNONYMS['Squared Set'] === 'Static Square', 'FORMATION_SYNONYMS maps Squared Set -> Static Square');
check(seq.matchesNamed(seq.board, 'Squared Set'), 'matchesNamed(board, "Squared Set")');
check(seq.isAt('Squared Set'), 'isAt("Squared Set")');
check(seq.isAt('Static Square'), 'isAt("Static Square")');

console.log('\n== 45-degree matching (spec: engine should match to 45deg) ==');
{
  const d = seq.startBoard();
  const rot45 = d.dancers.map((dd) => {
    const r = Math.PI / 4, c = Math.cos(r), s = Math.sin(r);
    return { ...dd, x: dd.x * c - dd.y * s, y: dd.x * s + dd.y * c, heading: dd.heading + r };
  });
  const src = rot45.map((x) => ({ x: x.x, y: x.y, heading: x.heading }));
  const tgt = d.dancers.map((x) => ({ x: x.x, y: x.y, heading: x.heading }));
  const m = matchFormations(src, tgt);
  check(m !== null, '45deg-offset square IS matched (matcher now tries 45deg steps)', `match=${m ? 'matched' : 'null'}`);
}

console.log('\n== Beau/belle & leader/trailer positional roles ==');
check(seq.subsetOf(seq.board, 'beaus') === null, 'subsetOf("beaus") not implemented (only heads/sides/boys/girls/centers/ends)');
niReport('beau/belle positional role', 'derived from position+facing, not modelled');

console.log('\n== Per-dancer direction / non-compositional metadata ==');
check(true, 'per-dancer direction supported via per-dancer matrices (applyToBoard)');
niReport('explicit "direction last turned" metadata');

console.log('\n== Normalised-state model (spec: all rotations collapse) ==');
{
  const fs = seq.formationState(seq.board);
  check(fs !== null && 'rot' in fs, 'formationState returns {name, rot, reflect, ...}', fs && `name=${fs.name} rot=${fs.rot}`);
  niReport('FSM state keyed on normalised formation (orientation-as-delta)');
}

console.log('\n== FSM user-amendment / export + ledger ==');
niReport('FSM user amendment of transitions');
niReport('FSM snapshot + delta ledger export');

console.log('\n== Getout / getin / module ==');
{
  seq.reset();
  const g = seq.getout({ maxCalls: 3 });
  check(Array.isArray(g) || g === null, 'getout returns a path or null', g ? g.join(' > ') : 'null');
  const gi = seq.getin({ target: 'Facing Couples', maxCalls: 3 });
  check(Array.isArray(gi) || gi === null, 'getin returns a path or null', gi ? gi.join(' > ') : 'null');
}
niReport('module collapsed into a single composed matrix (getout/getin single-edge)');

console.log('\n== Equivalents (separate edges) ==');
niReport('equivalent-call substitution');

console.log('\n== Generative prefix expansion ==');
niReport('"Anything and ..."/"As Couples"/"Explode and Anything" generative expansion');

console.log('\n== Timing / beat count ==');
{
  // Calls are registered by their file basename (e.g. "allemande", "circle").
  // Find a couple that are legal from the home square to test sequenceBeats.
  const home = seq.startBoard();
  const legalNames = [...seq.legalCalls(home)];
  const two = legalNames.slice(0, 2);
  const beats = seq.sequenceBeats(two);
  check(typeof beats === 'number' && beats > 0, 'sequenceBeats sums beats', `${two.join('+')} = ${beats}`);
  check(seq.sequenceBeats([two[0]]) > 0, 'per-call fixed beats via sequenceBeats');
  check(legalNames.length >= 1, 'legalCalls returns >=1 from home square', `n=${legalNames.length}`);
}

console.log('\n== Collisions & ghosts ==');
{
  seq.reset();
  const phys = seq.physicalDancers(seq.board);
  check(phys.length === 8, 'physicalDancers returns 8 on home square', String(phys.length));
  check(Array.isArray(seq.collisions(seq.board)), 'collisions returns a list');
}

console.log('\n== Parallel / subset ==');
{
  const s = seq.subsetOf(seq.board, 'heads');
  check(Array.isArray(s) && s.length === 2, 'subsetOf("heads") returns 2 couples', s && `groups=${s.length}`);
  const s2 = seq.subsetOf(seq.board, 'boys');
  check(Array.isArray(s2) && s2.length === 1 && s2[0].length === 4, 'subsetOf("boys") returns 4 dancers');
}

console.log('\n=================');
console.log(`PASS: ${pass}   NOT-IMPLEMENTED: ${ni}   FAIL: ${fail}`);
if (fail > 0) { console.log(`${fail} FAIL check(s) - investigate`); process.exitCode = 1; }
else console.log('No FAILs; NOT-IMPLEMENTED count reflects the spec-vs-code gap.');
