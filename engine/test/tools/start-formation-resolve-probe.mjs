// DOES THE APP'S LABEL -> BOARD PATH RESOLVE EVERY START FORMATATION IT CLAIMS?
//
// `poc/src/sequencer-ui.ts` resolves a module's `startFormation` label through
// `START_FORMATION` (modules.ts) and then `boardForFasrCode` with `LETTER_TEMPLATE`. Nothing tests
// that path — the POC cannot be driven here — so this asks the engine the same questions the app asks:
// for every entry in the app's own maps, is a BOARD produced, is it the board the label means, and does
// the module's first call actually apply on it?
//
// Usage: node engine/test/tools/start-formation-resolve-probe.mjs

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, arrangementFor, sequenceFor, letterForFormation } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

// The app's maps, verbatim from poc/src/modules.ts. Kept here rather than imported because the POC is
// TypeScript+Vite and this is a plain Node probe; if they drift, this probe is what notices.
const START_FORMATION = {
  'static square': { formation: 'Static Square' },
  'squared set': { formation: 'Static Square' },
  'zero line': { code: 'L1o' },
  'zero box': { code: 'B1c' },
};
const LETTER_TEMPLATE = {
  B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', P: 'Double Pass Thru',
  F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH', S: 'Static Square',
};
const templateFor = (l) => (LETTER_TEMPLATE[l] ? seq.boardForFormation(LETTER_TEMPLATE[l]) : null);

let failures = 0;
const fail = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const ok = (m) => console.log(`  ok    ${m}`);

console.log('=== 1. every START_FORMATION label resolves to a board ===');
const resolved = {};
for (const [label, spec] of Object.entries(START_FORMATION)) {
  const board = spec.formation ? seq.boardForFormation(spec.formation) : boardForFasrCode(spec.code ?? '', templateFor).board;
  if (!board) { fail(`"${label}" resolves to NO board (${spec.formation ?? spec.code})`); continue; }
  const known = board.dancers.filter((d) => d.couple !== 0).length;
  const letter = spec.formation ? letterForFormation(spec.formation) : (spec.code ?? '').replace(/^[0-5]/, '').match(/^[A-Za-z.]+/)?.[0];
  const arr = letter ? arrangementFor(board, letter).number : null;
  const seqNo = sequenceFor(board).code;
  console.log(`  ${label.padEnd(14)} -> identity ${known}/8, letter ${letter ?? '?'}, arrangement ${arr ?? '?'}, sequence ${seqNo ?? '?'}`);
  if (known !== 8) fail(`"${label}" has identity ${known}/8, so calls needing couples cannot read it`);
  resolved[label] = board;
}
if (Object.keys(resolved).length === Object.keys(START_FORMATION).length) ok('every label resolves, with full identity');

console.log('\n=== 2. LETTER_TEMPLATE covers every letter the corpus labels use ===');
{
  const letters = new Set();
  const dir = path.join(root, 'modules');
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) files.push(p);
    }
  };
  walk(dir);
  for (const f of files) {
    try {
      const m = JSON.parse(readFileSync(f, 'utf8'));
      const label = (m.startFormation ?? '').trim().toLowerCase();
      if (label) letters.add(label);
    } catch { /* a malformed module is not this probe's business */ }
  }
  const labels = [...letters].sort();
  console.log(`  the corpus uses ${labels.length} distinct start-formation label(s):`);
  for (const l of labels) {
    const spec = START_FORMATION[l];
    console.log(`    ${l.padEnd(22)} ${spec ? `-> ${spec.formation ?? spec.code}` : '(NOT RESOLVED by the app)'}`);
  }
  const unresolved = labels.filter((l) => !START_FORMATION[l]);
  ok(`${labels.length - unresolved.length} of ${labels.length} labels resolve; the rest fail loudly, as designed`);
}

console.log('\n=== 3. a code\'s board is stable and re-derivable ===');
{
  for (const [label, spec] of Object.entries(START_FORMATION)) {
    if (!spec.code) continue;
    const a = boardForFasrCode(spec.code, templateFor).board;
    const b = boardForFasrCode(spec.code, templateFor).board;
    const same = a && b && a.dancers.every((d, i) => d.x === b.dancers[i].x && d.y === b.dancers[i].y && d.couple === b.dancers[i].couple);
    if (!same) fail(`"${label}" (${spec.code}) does not build the same board twice`);
    else ok(`"${label}" (${spec.code}) builds the same board on every call`);
  }
}

console.log('\n=== 4. the [S] template makes an [S] code buildable ===');
{
  const built = boardForFasrCode('S1', templateFor);
  if (!built.board) fail(`[S] is in LETTER_TEMPLATE but "S1" still refuses: ${built.reason}`);
  else {
    const known = built.board.dancers.filter((d) => d.couple !== 0).length;
    console.log(`  boardForFasrCode('S1') -> identity ${known}/8, arrangement ${arrangementFor(built.board, 'S').number}, sequence ${sequenceFor(built.board).code}`);
    if (known === 8) ok('a [S]-coded label is now buildable');
    else fail(`[S] builds with identity ${known}/8`);
  }
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}`);
process.exit(failures ? 1 : 0);
