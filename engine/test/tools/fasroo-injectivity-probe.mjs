// INJECTIVITY OF FASROO, on the boards a code actually admits.
//
// All8's own worked pair says `[0P1cH+]` and `[0P1cH']` are DIFFERENT setups that share formation,
// arrangement, sequence, relationship AND Orientation, differing only in Occupation. That is a
// statement about the four boards `[0P1c]` admits, and it is measurable: enumerate them, read each with
// the shipped `fasrooOf`, and see whether two distinct boards share a notation.
//
// Usage: node engine/test/tools/fasroo-injectivity-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer,
  setParser,
  boardsForAlignment,
  fasrooOf,
  rotationBetweenBoards,
  FORMATIONS_FOR_LETTER,
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
const FORMATION = { B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', F: 'Two-Faced Lines', P: 'Double Pass Thru', 'L.F': 'Two-Faced Lines LH' };

let collisions = 0, codes = 0;
for (const [letter, formation] of Object.entries(FORMATION)) {
  const template = (() => { for (const n of FORMATIONS_FOR_LETTER[letter] ?? []) { const b = seq.boardForFormation(n); if (b) return b; } return null; })();
  if (!template) continue;
  console.log(`\n[${letter}] ${formation}`);
  for (const sequence of [1, 2, 3, 4]) {
    for (const relationship of ['p', 'o', 'c', 'r']) {
      const built = boardsForAlignment(template, { letter, arrangement: 0, sequence, relationship });
      if (!built.boards.length) continue;
      codes++;
      const seen = new Map();
      const notes = built.boards.map((b, i) => {
        const f = fasrooOf(b, formation);
        const key = f.notation;
        const dup = seen.get(key);
        seen.set(key, i);
        return `${i}:${key}${dup !== undefined ? ` == ${dup}` : ''}`;
      });
      const dups = [...seen.entries()].filter(([k]) => built.boards.filter((b) => fasrooOf(b, formation).notation === k).length > 1);
      if (dups.length) collisions++;
      const distinct = new Set(built.boards.map((b) => fasrooOf(b, formation).notation)).size;
      console.log(`  [${sequence}${relationship}] ${built.boards.length} board(s) -> ${distinct} distinct FASROO   ${notes.join('  ')}`);
    }
  }
}
console.log(`\n  ${codes} code(s) enumerated; ${collisions} where two boards share a notation.`);
