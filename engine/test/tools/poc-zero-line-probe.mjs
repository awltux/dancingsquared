// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// IS THE POC'S "ZERO LINE" START BOARD STILL THE BOARD ITS OWN COMMENT CLAIMS?
//
// `poc/src/sequencer-ui.ts` loads the `Zero Line` label by calling
// `boardForFasrCode('L1o', ...)`, and its comment states the property that makes `L1o` the right code:
// identity 8/8, sequence `in`, and facing couple-pairs `1-4` and `2-3`.
//
// That goes through `boardForAlignment`, NOT through the new `canonicalBoard`, so it is worth asking
// directly whether the board the app loads has the property the app says it has. The POC cannot be run
// here, so this asks the engine the same question the app would.
//
// Usage: node engine/test/tools/poc-zero-line-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, boardsForAlignment, parseAlignmentId, sequenceFor, canonicalBoard, arrangementFor } from '../../dist/index.js';
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

const templateFor = (l) => {
  const names = { B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', P: 'Double Pass Thru', F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH', S: 'Static Square' };
  return names[l] ? seq.boardForFormation(names[l]) : null;
};

/** The facing couple-pair of each dancer, as "a-b" sorted. */
const facingPairs = (b) => {
  const ahead = (d) => {
    const hx = Math.cos(d.heading), hy = Math.sin(d.heading);
    let best = null;
    for (const o of b.dancers) {
      if (o.id === d.id) continue;
      const dx = o.x - d.x, dy = o.y - d.y, dist = Math.hypot(dx, dy);
      if (dist < 0.5 || (dx * hx + dy * hy) / dist < 0.99) continue;
      if (!best || dist < best.dist) best = { o, dist };
    }
    return best?.o ?? null;
  };
  const s = new Set();
  for (const d of b.dancers) { const o = ahead(d); if (o) s.add([d.couple, o.couple].sort((x, y) => x - y).join('-')); }
  return [...s].sort().join(' ');
};

const report = (label, board) => {
  if (!board) { console.log(`  ${label.padEnd(46)} NULL`); return; }
  const known = board.dancers.filter((d) => d.couple !== 0).length;
  const s = sequenceFor(board);
  const pairs = facingPairs(board);
  console.log(`  ${label.padEnd(46)} identity ${known}/8, sequence ${s.code}, facing pairs ${pairs}`);
  return pairs;
};

console.log('=== what the APP loads for "Zero Line" (boardForFasrCode, unchanged by the setup work) ===');
const viaPoc = boardForFasrCode('L1o', templateFor);
const pocPairs = report('boardForFasrCode("L1o").board', viaPoc.board);

console.log('\n=== what the SETUP registry stands up for the same label ===');
const res = boardsForAlignment(templateFor('L'), parseAlignmentId('L1o'));
const canonical = canonicalBoard(res.boards, 'L', parseAlignmentId('L1o'));
const setupPairs = report('canonicalBoard(L1o)', canonical);

console.log('\n=== the code\'s own four boards, for context ===');
res.boards.forEach((b, i) => report(`  L1o index ${i}`, b).toString());

console.log('\n=== the claim the app\'s comment makes ===');
const claimed = '1-4 2-3';
console.log(`  the app's comment says the facing pairs are ${claimed}`);
console.log(`  boardForFasrCode gives ${pocPairs}  -> ${pocPairs === claimed ? 'CLAIM HOLDS' : 'CLAIM DOES NOT HOLD'}`);
console.log(`  canonicalBoard gives   ${setupPairs}  -> ${setupPairs === claimed ? 'CLAIM HOLDS' : 'CLAIM DOES NOT HOLD'}`);
console.log(`\n  arrangement of the app's board: ${arrangementFor(viaPoc.board, 'L').number ?? 'null'}`);
