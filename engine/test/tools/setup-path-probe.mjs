// WHAT SETUP DOES EACH INITIAL-FORMATION PATH ACTUALLY PRODUCE?
//
// Reported: "when I apply a module or a Call to a sequence and it is the first item in the sequence,
// when possible, always use the zero, all in-sequence FASROO to setup the dancers. Currently the
// sequencer seems to use a very unusual setup for some of the initial formations."
//
// Three paths can stand the dancers up, and they do NOT agree:
//   - `boardForFormation(name)` - the ANONYMOUS template (it is also `Sequencer.setFormation`, the path
//     the Formation-tab harnesses use to build identity-free boards ON PURPOSE). Geometry plus the
//     formation's DECLARED genders and nothing else: 129 of the 134 named formations carry NO home
//     couple at all, so there is no sequence and no relationship to be in.
//   - `boardForSetup(name)` - what the APP uses (the Set dropdown's `setSetup`, and the module start in
//     `sequencer-ui.ts`). Since the canonical-identity work it consults the setup registry first and
//     keeps the older `<letter>1` derivation as a fallback.
//   - `boardForFasrCode('<letter>1', template)` - the corpus start labels and the All8 figure loader.
//     Arrangement 0, sequence 1, and NO RELATIONSHIP LETTER.
//
// For every formation the app offers this prints what each path yields, so "unusual" is a measurement
// rather than a description.
//
// THE `[arr/seq/rel]` COLUMN USED TO READ 'error' ON EVERY SINGLE ROW. It called `seq.alignmentOf(b)`,
// a method that does not exist on `Sequencer`, inside a try/catch that turned the TypeError into that
// string - and because BOTH sides of every comparison were 'error', the column compared equal to
// itself and the `same`/`DIFFERS` verdicts beside it were silently decided by the identity count and
// the formation name alone. A missing method is a load-time error, not a runtime one, so the only
// reason it survived is that nothing failed loudly. It is built from the shipped readers now.
//
// Usage: node engine/test/tools/setup-path-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER,
  arrangementFor, sequenceFor, relationshipStateOf, letterForFormation, parseAlignmentId,
} from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};

/** A board's identity and its own reading of arrangement/sequence/relationship, in the user's terms. */
const describe = (b, letter) => {
  if (!b) return 'cannot be built';
  const known = b.dancers.filter((d) => (d.couple ?? 0) > 0).length;
  let align = 'no-letter';
  if (letter) {
    const a = arrangementFor(b, letter);
    const s = sequenceFor(b);
    const r = relationshipStateOf(b, letter);
    align = `${a.number ?? a.candidates.join('/') ?? '?'}${letter}${s.code ?? '?'}${r.code ?? '?'}`;
  }
  const formation = seq.knownFormation(b) ?? seq.recognize(b)?.name ?? '(unnamed)';
  return `identity ${known}/8  [${align}]  ${formation}`;
};

const letterFor = new Map();
for (const [letter, names] of Object.entries(FORMATIONS_FOR_LETTER)) for (const n of names) if (!letterFor.has(n)) letterFor.set(n, letter);

console.log('=== A. the offered formations: boardForFormation(name) vs the arrangement-0 in-sequence code ===');
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
  // Compared on the READING, not on the rendered string: the anonymous board and the code's board are
  // the same geometry by construction, so the formation name and the identity count are not what is in
  // question here - the arrangement/sequence/relationship are.
  const verdict = byCode ? (describe(byName, letter) === describe(byCode, letter) ? 'same' : 'DIFFERS') : 'no code';
  if (verdict === 'same') same++; else if (verdict === 'DIFFERS') differ++;
  if (verdict === 'DIFFERS') {
    console.log(`  ${name}  [${letter}]`);
    console.log(`      boardForFormation  : ${describe(byName, letter)}`);
    console.log(`      ${code} (arr 0, seq in) : ${describe(byCode, letter)}`);
  }
}
console.log(`\n  ${anonymous} of the offered formations are ANONYMOUS by name (no home couple at all)`);
console.log(`  ${differ} differ from their arrangement-0/in-sequence code, ${same} same`);

console.log('\n=== B. the three corpus start labels, and home ===');
for (const [label, spec] of [['Zero Line', 'L1o'], ['Zero Box', 'B1c'], ['Static Square', 'S1']]) {
  const b = boardForFasrCode(spec, templateForLetter).board;
  console.log(`  ${label.padEnd(14)} ${spec.padEnd(5)} ${describe(b, parseAlignmentId(spec)?.letter)}`);
}
console.log(`  ${'home'.padEnd(14)} ${'(none)'.padEnd(5)} ${describe(seq.boardForFormation('Static Square'), 'S')}`);

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

// ---------------------------------------------------------------------------------------------
// PIN. Two numbers, measured, and the instrument that produced them was BROKEN for every row before
// this commit - so the pin is what keeps the fix from regressing silently.
// ---------------------------------------------------------------------------------------------
console.log('\n=== D. pins ===');
let failures = 0;
const pin = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
};
pin('offered formations that are anonymous by name', anonymous, 129);
// Only the 9 names that carry an All8 LETTER can be compared at all - the other 125 offered formations
// have no letter, so there is no arrangement-0 code to differ FROM, and they are counted in neither
// column. Of those 9, 8 differ from their letter's arrangement-0/in-sequence code and 1 agrees.
pin('offered formations that differ from their arrangement-0/in-sequence code', differ, 8);
pin('offered formations the arrangement-0/in-sequence code reproduces', same, 1);
console.log(failures ? `\n${failures} PIN(S) MOVED` : '\nall pins hold');
process.exit(failures ? 1 : 0);
