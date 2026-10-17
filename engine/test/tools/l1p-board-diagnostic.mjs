// The two probes above disagree about which board `boardForFasrCode('L1p')` returns and what its
// facing pairs are, so this prints ONE board completely: every dancer's position, heading, couple and
// home identity, plus the facing pair of each dancer computed one step at a time.
//
// Usage: node engine/test/tools/l1p-board-diagnostic.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, boardsForAlignment, parseAlignmentId, canonicalBoard, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateFor = (letter) => (FORMATIONS_FOR_LETTER[letter] ?? []).map((n) => seq.boardForFormation(n)).find(Boolean);

const ahead = (board, d) => {
  const hx = Math.cos(d.heading), hy = Math.sin(d.heading);
  let best = null;
  for (const o of board.dancers) {
    if (o.id === d.id) continue;
    const dx = o.x - d.x, dy = o.y - d.y, dist = Math.hypot(dx, dy);
    if (dist < 0.5 || (dx * hx + dy * hy) / dist < 0.99) continue;
    if (!best || dist < best.dist) best = { o, dist };
  }
  return best?.o ?? null;
};

const dump = (label, b) => {
  console.log(`\n${label}`);
  for (const d of [...b.dancers].sort((a, c) => (c.y - a.y) || (a.x - c.x))) {
    const o = ahead(b, d);
    console.log(`  pos(${d.x},${d.y}) h=${((d.heading * 180) / Math.PI).toFixed(0).padStart(4)} couple${d.couple} id${d.id} ${d.gender === 'boy' ? 'B' : 'G'}  faces ${o ? `couple${o.couple}/id${o.id}` : 'nothing'}`);
  }
  const s = new Set();
  for (const d of b.dancers) { const o = ahead(b, d); if (o) s.add([d.couple, o.couple].sort((x, y) => x - y).join('-')); }
  console.log(`  facing couple-pairs: ${[...s].sort().join(' ')}`);
};

const template = templateFor('L');
const spec = parseAlignmentId('L1p');
const res = boardsForAlignment(template, spec);
console.log(`boardsForAlignment(L1p) -> ${res.boards.length} boards`);
res.boards.forEach((b, i) => dump(`--- enumeration board [${i}] ---`, b));

const built = boardForFasrCode('L1p', templateFor).board;
dump('--- boardForFasrCode(\'L1p\').board ---', built);

const canonical = canonicalBoard(res.boards, 'L', spec);
const idx = res.boards.indexOf(canonical);
console.log(`\ncanonicalBoard picks enumeration index ${idx}`);
console.log(`is boardForFasrCode's board the same object as that index? ${built === canonical}`);
