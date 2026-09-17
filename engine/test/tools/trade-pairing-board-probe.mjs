// DOES THE WAVE `Trade`'s PAIRING MATTER AT ALL? - comparing the BOARDS, not just the formation.
//
// `tradeRule`'s parity rule admits two pairings from a wave (same-column 2 apart, cross-column 4 apart)
// and they disagree about who trades with whom. Whether that matters depends on whether they leave the
// SAME BOARD, so this compares them pose by pose instead of by formation name.
//
// Usage: node engine/test/tools/trade-pairing-board-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, applyCodedMove } from '../../dist/index.js';
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

const pose = (b) => [...b.dancers].sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}(${d.x.toFixed(0)},${d.y.toFixed(0)})@${((d.heading * 180) / Math.PI).toFixed(0)}`).join(' ');
const key = (b) => [...b.dancers].sort((x, y) => x.id - y.id)
  .map((d) => `${d.id}:${d.x.toFixed(2)},${d.y.toFixed(2)},${d.heading.toFixed(4)}`).join('|');

const swap = (board, [aId, bId]) => {
  const a = board.dancers.find((d) => d.id === aId);
  const b = board.dancers.find((d) => d.id === bId);
  const out = board.dancers.map((d) => ({ ...d }));
  const oa = out.find((d) => d.id === aId);
  const ob = out.find((d) => d.id === bId);
  oa.x = b.x; oa.y = b.y; oa.heading = b.heading;
  ob.x = a.x; ob.y = a.y; ob.heading = a.heading;
  return { dancers: out };
};
const applyPairs = (start, pairs) => {
  let b = { dancers: start.dancers.map((d) => ({ ...d })) };
  for (const p of pairs) b = swap(b, p);
  return b;
};

for (const formation of ['Ocean Waves']) {
  const start = seq.boardForFormation(formation);
  const engine = applyCodedMove(start, 'Trade');
  console.log(`=== ${formation} ===`);
  console.log(`  start            ${pose(start)}`);
  console.log(`  engine Trade     ${engine?.legal ? pose(engine.board) : `REFUSED - ${engine?.reason}`}`);
  const candidates = {
    'A same-column 2': [[1, 2], [3, 4], [5, 6], [7, 8]],
    'B across 4': [[1, 8], [2, 7], [3, 6], [4, 5]],
    'C same-gender': [[1, 4], [2, 3], [5, 8], [6, 7]],
  };
  for (const [label, pairs] of Object.entries(candidates)) {
    const b = applyPairs(start, pairs);
    const same = engine?.legal && key(b) === key(engine.board);
    console.log(`  ${label.padEnd(16)} ${pose(b)}   same board as the engine? ${same ? 'YES' : 'NO'}`);
  }
  // And the wave the corpus actually cares about: are the two columns still waves?
  if (engine?.legal) {
    const cols = {};
    for (const d of engine.board.dancers) (cols[d.x] ??= []).push(`${d.id}${d.gender === 'boy' ? 'B' : 'g'}@${((d.heading * 180) / Math.PI).toFixed(0)}`);
    for (const [x, list] of Object.entries(cols).sort()) console.log(`  after, column x=${x}: ${list.sort().join(' ')}`);
  }
}
