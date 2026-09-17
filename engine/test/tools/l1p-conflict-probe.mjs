// IS THE PLAN'S RECORDED `[L1p]` CONFLICT STILL TRUE?
//
// PLAN.md records, as an unresolved disagreement: "all8's text diagram for [L1p] has FACING couple-pairs
// {2,3} and {1,4} ... The engine's boardForFasrCode('L1p') produces facing pairs {1,2} and {3,4}, and it
// is L1o that produces {2,3}/{1,4}. So the engine's relationship letter for [L] is offset by one from
// all8's." On that basis the plan keeps `Zero Box` refused.
//
// A claim like that is checkable, so this checks it against the fixture (which holds all8's own diagram
// verbatim) and against the engine, for every [L] alignment rather than just the one.
//
// Usage: node engine/test/tools/l1p-conflict-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, boardFromDiagram, parseAlignmentId, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
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
const templateFor = (letter) => (FORMATIONS_FOR_LETTER[letter] ?? []).map((n) => seq.boardForFormation(n)).find(Boolean);

/** The facing couple-pairs: who each dancer faces straight ahead. */
const facingPairs = (board) => {
  const ahead = (d) => {
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
  const s = new Set();
  for (const d of board.dancers) { const o = ahead(d); if (o) s.add([d.couple, o.couple].sort((x, y) => x - y).join('-')); }
  return [...s].sort().join(' ');
};

/** all8's diagram drawn the way the page draws it, so it can be shown next to the claim. */
const draw = (d) => d.split('\n').map((l) => `      ${l}`).join('\n');

const corpus = JSON.parse(readFileSync(path.join(root, 'engine', 'test', 'fixtures', 'all8-getouts.json'), 'utf8'));
console.log('=== every [L] alignment: all8\'s diagram vs the engine, pair by pair ===');
console.log('  code     all8 pairs   engine pairs   same?');
for (const a of corpus.alignments) {
  const spec = parseAlignmentId(a.id);
  if (!spec || spec.letter !== 'L') continue;
  const template = templateFor('L');
  const fromDiagram = boardFromDiagram(template, 'L', spec.arrangement, a.diagram);
  const built = boardForFasrCode(a.id, templateFor);
  if (!fromDiagram.board || !built.board) { console.log(`  ${a.id.padEnd(8)} (not buildable)`); continue; }
  const all8Pairs = facingPairs(fromDiagram.board);
  const enginePairs = facingPairs(built.board);
  console.log(`  ${a.id.padEnd(8)} ${all8Pairs.padEnd(12)} ${enginePairs.padEnd(14)} ${all8Pairs === enginePairs ? 'YES' : 'no'}`);
}

console.log('\n=== the specific case the plan records ===');
const l1p = corpus.alignments.find((a) => a.id === 'L1p');
console.log('  the fixture\'s diagram for [L1p], verbatim:');
console.log(draw(l1p.diagram));
const template = templateFor('L');
const fromDiagram = boardFromDiagram(template, 'L', 0, l1p.diagram).board;
console.log(`\n  that diagram's facing couple-pairs (the COUPLE field): ${facingPairs(fromDiagram)}`);
for (const code of ['L1p', 'L1o']) {
  const built = boardForFasrCode(code, templateFor);
  console.log(`  boardForFasrCode('${code}') facing pairs (COUPLE field): ${built.board ? facingPairs(built.board) : '(refused)'}`);
}

// THE FIELD MATTERS, and this is the check that settles it. `couple` is the board's own couple number
// (which a FASR code does NOT pin - it is the orientation freedom); `id` is the home identity. All8's
// diagram assigns couple numbers, so the diagram's COUPLE field is the authority - but a probe that
// reads `id` instead would find every board "agreeing" with itself and prove nothing.
console.log('\n=== the two fields, per board, so the reading cannot be ambiguous ===');
const table = (board, label) => {
  const rows = [...board.dancers].sort((a, b) => (b.y - a.y) || (a.x - b.x))
    .map((d) => `${d.couple === 0 ? '-' : d.couple}${d.gender === 'boy' ? 'B' : 'G'}(id${d.id})`);
  console.log(`  ${label.padEnd(26)} ${rows.join(' ')}`);
};
table(fromDiagram, "all8's diagram");
table(boardForFasrCode('L1p', templateFor).board, "boardForFasrCode('L1p')");
table(boardForFasrCode('L1o', templateFor).board, "boardForFasrCode('L1o')");
console.log('\n  PLAN.md records that all8 draws {2,3}/{1,4} and that the engine\'s L1p produces {1,2}/{3,4}.');
console.log('  Read the couple field above, not the id field.');
