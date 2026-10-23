// [P] REFERENCE POSITION, part 2: All8's convention says to read relationship in the [0B] reached by
// mentally passing the centres thru. That fixes a pair of DANCERS; the question this probe answers is
// whether they also occupy a consistent POSITION on the [P] board itself (which is what a
// `REFERENCE_PAIR_SPOTS['P']` entry would need to record).
//
// Usage: node engine/test/tools/p-reference-position-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer,
  setParser,
  parseAlignmentId,
  boardFromDiagram,
  readLayout,
  adjacentPairs,
  arrangementFor,
  ARRANGEMENT_TABLES,
  REFERENCE_PAIR_SPOTS,
} from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateFor = (letter) => {
  for (const n of FORMATIONS_FOR_LETTER[letter] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};
import { FORMATIONS_FOR_LETTER } from '../../dist/index.js';
import { corpusRoot } from 'dancing-squared-corpus';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const headingDiff = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };

function centresPassThru(board) {
  const n = board.dancers.length;
  const cx = board.dancers.reduce((s, d) => s + d.x, 0) / n;
  const cy = board.dancers.reduce((s, d) => s + d.y, 0) / n;
  const inner = [...board.dancers].sort((a, b) => dist(a, { x: cx, y: cy }) - dist(b, { x: cx, y: cy })).slice(0, 4);
  const partners = new Map();
  for (const d of inner) {
    const facing = inner.filter((o) => o !== d && dist(o, d) < 2.1 && headingDiff(o.heading, d.heading) > Math.PI / 2);
    if (facing.length !== 1) return null;
    partners.set(d.id, facing[0]);
  }
  return { dancers: board.dancers.map((d) => { const to = partners.get(d.id); return to ? { ...d, x: to.x, y: to.y } : { ...d }; }) };
}

console.log('== the tables, as the engine reads them ==');
for (const letter of ['P', 'B']) {
  const t = ARRANGEMENT_TABLES[letter];
  console.log(`  [${letter}] table ${t.length} row(s) x ${t[0].facing.length} col(s)  facings ${t.map((r) => r.facing).join(' ')}`);
}
console.log(`  REFERENCE_PAIR_SPOTS.B = ${JSON.stringify(REFERENCE_PAIR_SPOTS.B)}`);

const corpus = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'all8-getouts.json'), 'utf8'));
const pTemplate = templateFor('P');

console.log('\n== where the [B] reference pair sits, on the reduced board and on the [P] board ==');
for (const a of corpus.alignments.filter((x) => parseAlignmentId(x.id)?.letter === 'P')) {
  const spec = parseAlignmentId(a.id);
  const r = boardFromDiagram(pTemplate, 'P', spec.arrangement, a.diagram);
  if (!r.board) continue;
  const pBoard = r.board;
  const reduced = centresPassThru(pBoard);
  console.log(`\n  [${a.id}] published '${spec.relationship}'`);

  const bPairs = adjacentPairs(reduced, 'B');
  if (!bPairs.pairs) { console.log(`      reduced board does not read as [B]: ${bPairs.reason}`); continue; }
  console.log('      [0B] adjacent pairs (table spots): ' + bPairs.pairs.map((p) => `c${p.boyCouple}@${JSON.stringify(p.boySpot)}-c${p.girlCouple}@${JSON.stringify(p.girlSpot)}:'${p.letter}'`).join('  '));
  const refSpots = REFERENCE_PAIR_SPOTS.B;
  const ref = bPairs.pairs.find((p) =>
    refSpots.some(([r2, c2]) => p.boySpot[0] === r2 && p.boySpot[1] === c2) &&
    refSpots.some(([r2, c2]) => p.girlSpot[0] === r2 && p.girlSpot[1] === c2));
  console.log(`      pair at the recorded [B] reference spots: ${ref ? `boy c${ref.boyCouple} (dancer id ${ref.boy}) - girl c${ref.girlCouple} (id ${ref.girl})` : 'NONE'}`);

  // Where is that same boy on the ORIGINAL [P] board, in the [P] table frame?
  const boyId = ref?.boy ?? bPairs.pairs[0].boy;
  const pLayout = readLayout(pBoard, 'P');
  let cell = '(not found)';
  pLayout?.cells.forEach((row, rr) => row.forEach((d, cc) => { if (d?.id === boyId) cell = `(row ${rr}, col ${cc})`; }));
  const pPairs = adjacentPairs(pBoard, 'P');
  const pPair = pPairs.pairs?.find((p) => p.boy === boyId);
  console.log(`      that boy on the [P] board: id ${boyId} (c${pBoard.dancers.find((d) => d.id === boyId)?.couple}), [P] table cell ${cell}`);
  if (pPair) console.log(`      his [P] adjacent pair: girl c${pPair.girlCouple} at ${JSON.stringify(pPair.girlSpot)} -> '${pPair.letter}'`);
}

console.log('\n== a fixed [P] spot pair, scored against the published letters ==');
console.log('   (the [P] table frame; every (boy spot, girl spot) that reproduces all four letters)');
const rows = [];
for (const a of corpus.alignments.filter((x) => parseAlignmentId(x.id)?.letter === 'P')) {
  const spec = parseAlignmentId(a.id);
  const r = boardFromDiagram(pTemplate, 'P', spec.arrangement, a.diagram);
  if (!r.board) continue;
  const layout = readLayout(r.board, 'P');
  rows.push({ id: a.id, want: spec.relationship, layout, board: r.board });
}
const R = rows[0].layout.cells.length, C = rows[0].layout.cells[0].length;
const relCode = (b, g) => (['p', 'r', 'o', 'c'])[(((g - b) % 4) + 4) % 4];
const hits = [];
for (let br = 0; br < R; br++) for (let bc = 0; bc < C; bc++) {
  for (let gr = 0; gr < R; gr++) for (let gc = 0; gc < C; gc++) {
    if (br === gr && bc === gc) continue;
    let ok = true;
    for (const row of rows) {
      const b = row.layout.cells[br][bc], g = row.layout.cells[gr][gc];
      if (!b || !g || b.gender !== 'boy' || g.gender !== 'girl' || relCode(b.couple, g.couple) !== row.want) { ok = false; break; }
    }
    if (ok) hits.push({ boy: [br, bc], girl: [gr, gc] });
  }
}
console.log(`   ${hits.length} fixed pair(s) work: ${hits.map((h) => `boy@${JSON.stringify(h.boy)} girl@${JSON.stringify(h.girl)}`).join('  ') || 'NONE'}`);
