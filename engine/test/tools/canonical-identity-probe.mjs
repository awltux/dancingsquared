// WHAT IDENTITY DOES EACH SETUP PATH PRODUCE?
//
// The setup registry (`FORMATION_SETUP_CODE` + `setupForFormation`) is what makes a formation's zero
// setup expressible at all, and it was built, gated, and then wired to NOTHING while the app used a
// different path. This probe measured that gap, and it keeps the two paths pinned together now that
// they are joined. Two DIFFERENT paths stand dancers up for a formation NAME:
//
//   - `boardForFormation(name)` - the ANONYMOUS template: geometry plus each slot's declared gender,
//     and no home couple at all for 129 of the 134 offered formations. Roughly sixty probes and
//     harnesses call this AS the anonymous path, on purpose (`zero-line-probe.mjs` says so in its
//     header: "`boardForFormation('Normal Lines')` is `[L0]` by its GENDER pattern, but it carries NO
//     identity"), so it is an instrument as much as a product. It is NOT what the app sets up from.
//   - `boardForSetup(name)` - what the app actually calls. The Set dropdown
//     (`sequencer-ui.ts` `setBoardFormation` -> `setSetup`) and the module start
//     (`replayModule` -> `boardForSetup`) both go here, and NOT through `boardForFormation`.
//
// `boardForSetup` used to build the code `<letter>1`: arrangement 0, sequence 1, and NO RELATIONSHIP
// LETTER. That omission was the defect, because `canonicalBoard` selects on
// (letter, sequence, relationship) - with no relationship in the spec its lookup is `undefined` and it
// falls back to `boards[0]`, the enumeration's first board rather than All8's. MEASURED, it agreed with
// the registry on THREE of ten keys and stood `Normal Lines` up reading `0L1p` where the zero line is
// `0L1o` - which is the reported "very unusual setup", live. It consults the registry first now, and
// the `<letter>1` derivation is the fallback for the five formations the registry has no entry for.
//
// Usage: node engine/test/tools/canonical-identity-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer, setParser, setupForFormation, rotationBetweenBoards,
  arrangementFor, sequenceFor, relationshipStateOf, letterForFormation, identifyByAssignment,
  parseAlignmentId, FORMATION_SETUP_CODE, CANONICAL_INDEX,
} from '../../dist/index.js';
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

/** The anonymous path, which is also what `setupForFormation` must be fed as its `templateFor`. */
const anonymous = (name) => seq.boardForFormation(name);

const identityOf = (b) => (b ? b.dancers.filter((d) => (d.couple ?? 0) > 0).length : -1);

/**
 * The `[arr/seq/rel]` reading, which `setup-path-probe.mjs` has never actually produced: it calls
 * `seq.alignmentOf(b)`, a method that does not exist on `Sequencer`, inside a try/catch that turns the
 * TypeError into the string 'error' - so the column reads 'error' on EVERY row and nobody noticed,
 * because the verdicts beside it were decided by the identity count and the name alone.
 */
const readingOf = (board, name) => {
  const letter = letterForFormation(name);
  if (!letter) return 'no letter';
  const a = arrangementFor(board, letter);
  return `${a.number ?? a.candidates.join('/') ?? '?'}${codeOf(board, name) ?? '??'}`;
};

/** The `LETTER[sequence][relationship]` half of the reading, which is exactly what a registry code is. */
const codeOf = (board, name) => {
  const letter = letterForFormation(name);
  if (!letter) return null;
  const s = sequenceFor(board);
  const r = relationshipStateOf(board, letter);
  return `${letter}${s.code ?? '?'}${r.code ?? '?'}`;
};

console.log('=== 1. per registry key: the two paths, and the registry ===');
console.log('    (identity = dancers carrying a home couple; rot = the +k couple relabelling that turns wired INTO registry)');
let agree = 0, disagree = 0, wiredNull = 0;
for (const name of Object.keys(FORMATION_SETUP_CODE)) {
  const anon = anonymous(name);
  const wired = seq.boardForSetup(name);
  const reg = setupForFormation(name, anonymous);
  if (!anon) { console.log(`  ${name}: no anonymous board`); continue; }
  if (!wired) wiredNull++;
  const rot = wired && reg ? rotationBetweenBoards(wired, reg.board) : null;
  const verdict = rot === 0 ? 'SAME as registry' : rot === null ? 'DIFFERENT (no rotation maps it)' : `DIFFERS by +${rot}`;
  if (rot === 0) agree++; else disagree++;
  console.log(`  ${name}  [${FORMATION_SETUP_CODE[name]}]`);
  console.log(`      anonymous : identity ${identityOf(anon)}/8  ${readingOf(anon, name)}`);
  console.log(`      wired     : identity ${identityOf(wired)}/8  ${readingOf(wired, name)}`);
  console.log(`      registry  : identity ${identityOf(reg?.board)}/8  ${readingOf(reg?.board, name)}`);
  console.log(`      -> ${verdict}`);
}
console.log(`\n  ${agree} of ${agree + disagree} registry keys: the WIRED board IS the registry's board`);
console.log(`  ${disagree} disagree${wiredNull ? `, ${wiredNull} cannot be built at all` : ''}`);

console.log('\n=== 1b. identifyByAssignment applied ON TOP OF the anonymous board ===');
console.log('    (the primitive: identity from the registry assignment, geometry and dancer ORDER untouched)');
let primOk = 0, primBad = 0;
for (const name of Object.keys(FORMATION_SETUP_CODE)) {
  const anon = anonymous(name);
  const reg = setupForFormation(name, anonymous);
  if (!anon || !reg) { console.log(`  ${name}: no anonymous board or no registry entry`); continue; }
  const got = identifyByAssignment(anon, reg.assignment);
  const samePose = got.dancers.length === anon.dancers.length
    && got.dancers.every((d, i) => d.x === anon.dancers[i].x && d.y === anon.dancers[i].y
      && d.heading === anon.dancers[i].heading && d.gender === anon.dancers[i].gender);
  const identified = identityOf(got) === 8;
  // Compared through `parseAlignmentId` rather than as a string, because `[S]` deliberately has NO
  // relationship component (`S1`): `relationshipStateOf` needs a reference pair, Callerlab records one
  // for `[L] [B] [F] [W]` only, so the reading's relationship half is legitimately '?' for a squared
  // set and a string compare against `S1` would report the ONE registry entry that is not lettered as
  // a failure.
  const want = parseAlignmentId(FORMATION_SETUP_CODE[name]);
  const reads = !!want
    && codeOf(got, name) === `${want.letter}${want.sequence}${want.relationship ?? '?'}`;
  const ok = samePose && identified && reads;
  if (ok) primOk++; else primBad++;
  console.log(`  ${name}: identity ${identityOf(got)}/8  ${readingOf(got, name)}  `
    + `pose-and-order-same=${samePose}  reads-own-code=${reads}  ${ok ? 'ok' : 'FAIL'}`);
}
console.log(`  ${primOk} of ${primOk + primBad} registry keys identified correctly by the primitive`);

console.log('\n=== 2. over every offered formation: who gets identity from which path ===');
let offered = 0, byWired = 0, byRegistry = 0;
const wiredOnly = [], registryOnly = [];
for (const name of seq.listFormations()) {
  const b = anonymous(name);
  if (!b || b.dancers.length !== 8) continue;
  offered++;
  const w = identityOf(seq.boardForSetup(name)) === 8;
  const reg = setupForFormation(name, anonymous);
  const r = reg ? identityOf(reg.board) === 8 : false;
  if (w) byWired++;
  if (r) byRegistry++;
  if (w && !r) wiredOnly.push(name);
  if (r && !w) registryOnly.push(name);
}
console.log(`  ${offered} offered formations of 8 dancers`);
console.log(`  ${byWired} identified by boardForSetup (the app's path)`);
console.log(`  ${byRegistry} identified by the registry (${Object.keys(FORMATION_SETUP_CODE).length} keys)`);
console.log(`  ${wiredOnly.length} identified by the wired path but NOT the registry: ${wiredOnly.join(', ') || '(none)'}`);
console.log(`  ${registryOnly.length} identified by the registry but NOT the wired path: ${registryOnly.join(', ') || '(none)'}`);

console.log('\n=== 3. does identity change what the FSM would enumerate? ===');
console.log('    (the named registry keys: legal-call delta between the ANONYMOUS state board and the identified one)');
const legalDeltas = {};
for (const name of Object.keys(FORMATION_SETUP_CODE)) {
  const anon = anonymous(name);
  const reg = setupForFormation(name, anonymous);
  if (!anon || !reg) { console.log(`  ${name}: cannot compare`); continue; }
  const a = new Set(seq.legalCalls(anon));
  const b = new Set(seq.legalCalls(reg.board));
  const gained = [...b].filter((c) => !a.has(c));
  const lost = [...a].filter((c) => !b.has(c));
  legalDeltas[name] = [a.size, b.size];
  console.log(`  ${name}: ${a.size} legal anonymous -> ${b.size} legal identified  (+${gained.length} gained, -${lost.length} lost)`);
  if (gained.length) console.log(`      gained: ${gained.join(', ')}`);
  if (lost.length) console.log(`      lost  : ${lost.join(', ')}`);
}

console.log('\n=== 4. the measured NON-ZERO canonical indices, and which registry key each one drives ===');
console.log('    (a non-zero index is exactly where "<letter>1" must land on a different board, since');
console.log('     `canonicalBoard` finds no relationship in that spec and falls back to `boards[0]`)');
const nonZeroIds = [];
for (const [letter, bySeq] of Object.entries(CANONICAL_INDEX)) {
  for (const [seqNum, byRel] of Object.entries(bySeq)) {
    for (const [rel, idx] of Object.entries(byRel)) {
      if (idx === 0) continue;
      nonZeroIds.push(`${letter}${seqNum}${rel}`);
      const drives = Object.entries(FORMATION_SETUP_CODE)
        .filter(([, code]) => code === `${letter}${seqNum}${rel}`).map(([n]) => n);
      console.log(`  ${letter}${seqNum}${rel} -> index ${idx}`
        + (drives.length ? `   drives registry key(s): ${drives.join(', ')}` : '   (no registry key names this code)'));
    }
  }
}
console.log(`  ${nonZeroIds.length} measured NON-ZERO indices: ${nonZeroIds.join(', ')}`);

// =====================================================================
// PINS. This is a gate, not a report: every number below was measured, and a movement in EITHER
// direction fails. An improvement is re-pinned deliberately, never absorbed.
// =====================================================================
console.log('\n=== 5. pins ===');
let failures = 0;
const pin = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
};
pin('registry keys', Object.keys(FORMATION_SETUP_CODE).length, 10);
pin('keys the primitive identifies from the assignment alone', primOk, 10);
// THE DEFECT THIS WAS WRITTEN FOR, and the number that says it is closed. It was 3: `boardForSetup`
// derived the setup from the letter alone (`<letter>1`), which names no relationship, so
// `canonicalBoard` fell back to `boards[0]` and only the three keys where `boards[0]` happens to be
// All8's board agreed. It is 10 now that `boardForSetup` consults the registry, and this pin is why
// the wiring cannot be quietly undone.
pin('registry keys where the WIRED board already IS the registry board', agree, 10);
pin('offered 8-dancer formations', offered, 134);
// 13 = the registry's 8, plus the 5 the `<letter>1` FALLBACK still carries. That the fallback is still
// load-bearing is the point of the pair of pins below.
pin('identified by boardForSetup', byWired, 13);
pin('identified by the registry', byRegistry, 8);
pin('identified by the wired path but NOT the registry', wiredOnly,
  ['Double Pass Thru', 'O Eight Chain Thru', 'O In', 'O Out', 'O Trade By']);
// WAS THREE - the compact variants the fallback left ANONYMOUS because the letter's code builds the
// first template for that letter, not the compact one, and the same-formation test then rejected it.
// The registry takes the NAME's own geometry as the template, so they are identified now.
pin('identified by the registry but NOT the wired path', registryOnly, []);
pin('measured non-zero canonical indices', nonZeroIds, [
  'B1p', 'B2p', 'L1p', 'L2p', 'L3c', 'L4r', 'W1p', 'W2p', 'F1p', 'F2p', 'L.F1p', 'L.F2p',
]);
// The legal-call delta identity buys each named registry key: [anonymous, identified]. All gains.
pin('legal calls, anonymous -> identified, per registry key', legalDeltas, {
  'Normal Lines': [347, 403],
  'Normal Lines Compact': [176, 224],
  'Eight Chain Thru': [249, 299],
  'Ocean Waves': [456, 483],
  'Two-Faced Lines': [305, 314],
  'Two-Faced Lines LH': [302, 311],
  'Two-Faced Lines RH Compact': [85, 88],
  'Ocean Waves RH BGGB Compact': [124, 135],
  'Static Square': [243, 243],
  'Squared Set': [243, 243],
});

console.log(failures ? `\n${failures} PIN(S) MOVED` : '\nall pins hold');
process.exit(failures ? 1 : 0);
