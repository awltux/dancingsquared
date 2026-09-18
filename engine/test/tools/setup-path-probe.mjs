// WHAT SETUP DOES EACH INITIAL-FORMATION PATH ACTUALLY PRODUCE?
//
// Reported: "when I apply a module or a Call to a sequence and it is the first item in the sequence,
// when possible, always use the zero, all in-sequence FASROO to setup the dancers. Currently the
// sequencer seems to use a very unusual setup for some of the initial formations."
//
// Three paths can stand the dancers up, and they do NOT agree:
//   - `boardForFormation(name)` - the Set dropdown, and `Sequencer.setFormation`. Geometry plus the
//     formation's DECLARED genders and nothing else: 129 of the 134 named formations carry NO home
//     couple at all, so there is no sequence and no relationship to be in.
//   - `boardForFasrCode('<letter>1', template)` - the corpus start labels (`L1o`, `B1c`) and the All8
//     figure loader. Arrangement 0, sequence 1 = BOTH IN SEQUENCE, fully identified 8/8.
//   - `Sequencer.startBoard()` - the home square, which is arrangement 0 and in sequence by being home.
//
// For every formation the app offers this prints what each path yields, so "unusual" is a measurement
// rather than a description.
//
// Usage: node engine/test/tools/setup-path-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};

/** A board's identity and sequence, in the terms the user's request is written in. */
const describe = (b) => {
  if (!b) return 'cannot be built';
  const known = b.dancers.filter((d) => (d.couple ?? 0) > 0).length;
  const f = seq.fasr ? null : null;
  void f;
  // `alignmentOf` is the engine's own reading of arrangement/sequence/relationship.
  let align = 'n/a';
  try {
    const a = seq.alignmentOf(b);
    align = a ? `${a.arrangement}/${a.sequence ?? '?'}/${a.relationship ?? '?'}` : 'none';
  } catch { align = 'error'; }
  const formation = seq.knownFormation(b) ?? seq.recognize(b)?.name ?? '(unnamed)';
  return `identity ${known}/8  [arr/seq/rel ${align}]  ${formation}`;
};

const letterFor = new Map();
for (const [letter, names] of Object.entries(FORMATIONS_FOR_LETTER)) for (const n of names) if (!letterFor.has(n)) letterFor.set(n, letter);

console.log('=== A. the Set dropdown: boardForFormation(name) vs the arrangement-0 in-sequence code ===');
let anonymous = 0, differ = 0, same = 0;
for (const name of seq.listFormations()) {
  const byName = seq.boardForFormation(name);
  if (!byName || byName.dancers.length !== 8) continue;
  const letter = letterFor.get(name);
  const known = byName.dancers.filter((d) => (d.couple ?? 0) > 0).length;
  if (known === 0) anonymous++;
  // The zero/in-sequence code for the letter: arrangement 0, sequence 1, no relationship named.
  const code = letter ? `${letter}1` : null;
  const byCode = code ? boardForFasrCode(code, templateForLetter).board : null;
  const verdict = byCode ? (describe(byName) === describe(byCode) ? 'same' : 'DIFFERS') : 'no code';
  if (verdict === 'same') same++; else if (verdict === 'DIFFERS') differ++;
  if (verdict === 'DIFFERS') {
    console.log(`  ${name}  [${letter}]`);
    console.log(`      boardForFormation  : ${describe(byName)}`);
    console.log(`      ${code} (arr 0, seq in) : ${describe(byCode)}`);
  }
}
console.log(`\n  ${anonymous} of the offered formations are ANONYMOUS by name (no home couple at all)`);
console.log(`  ${differ} differ from their arrangement-0/in-sequence code, ${same} same`);

console.log('\n=== B. the three corpus start labels, and home ===');
for (const [label, spec] of [['Zero Line', 'L1o'], ['Zero Box', 'B1c'], ['Static Square', 'S1']]) {
  const b = boardForFasrCode(spec, templateForLetter).board;
  console.log(`  ${label.padEnd(14)} ${spec.padEnd(5)} ${describe(b)}`);
}
console.log(`  ${'home'.padEnd(14)} ${'(none)'.padEnd(5)} ${describe(seq.boardForFormation('Static Square'))}`);

console.log('\n=== C. which arrangement-0/in-sequence codes exist per letter ===');
for (const letter of Object.keys(FORMATIONS_FOR_LETTER)) {
  const built = [];
  for (const rel of ['p', 'c', 'o', 'r', '']) {
    const code = `${letter}1${rel}`;
    const r = boardForFasrCode(code, templateForLetter);
    if (r.board) built.push(`${code}${rel === '' ? ' (no relationship named)' : ''}`);
  }
  console.log(`  [${letter}]  ${built.join(', ') || 'none build'}`);
}
