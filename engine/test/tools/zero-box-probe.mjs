// IS `Zero Box` = `[B1c]` WHAT ALL8 SAYS IT IS, AND WHAT WOULD THE APP LOAD?
//
// The plan records All8's own naming, verbatim from its get-out diagram: "[B1c] ... Facing Corners /
// ZERO BOX / AL BOX / Box 1-4 / 'AL'". So the property that makes `B1c` the zero box is that the box
// works for an Allemande Left - "AL BOX" - which in the engine's own terms is the same relation the
// zero line is checked by: each dancer faces a CORNER couple, not their partner.
//
// This measures that property on the board `boardForFasrCode('B1c')` actually produces, through the
// exact call the app makes (`LETTER_TEMPLATE` -> `boardForFormation` -> `boardForFasrCode`), and then
// reports what the 71 `Zero Box` modules would replay from it: how far each gets, which calls stop,
// and whether the stops look like the "wrong start" signature or like the corpus's ordinary gaps.
//
// Usage: node engine/test/tools/zero-box-probe.mjs

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, arrangementFor, sequenceFor, relationshipStateOf } from '../../dist/index.js';
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

// The app's own map, verbatim from poc/src/modules.ts.
const LETTER_TEMPLATE = {
  B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves',
  P: 'Double Pass Thru', F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH',
};
const templateFor = (l) => {
  const name = LETTER_TEMPLATE[l];
  return name ? seq.boardForFormation(name) : null;
};

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
const relation = (from, to) => ['partner', 'right-hand', 'opposite', 'corner'][(((to - from) % 4) + 4) % 4];

console.log('=== 1. the board the app would load for `Zero Box` ===');
const built = boardForFasrCode('B1c', templateFor);
if (!built.board) { console.log(`  REFUSED: ${built.reason}`); process.exit(1); }
const b = built.board;
const known = b.dancers.filter((d) => d.couple !== 0).length;
console.log(`  boardForFasrCode('B1c'): identity ${known}/8, arrangement ${arrangementFor(b, 'B').number}, sequence ${sequenceFor(b).code}`);
for (const d of [...b.dancers].sort((x, y) => (y.y - x.y) || (x.x - y.x))) {
  const o = ahead(b, d);
  console.log(`    pos(${d.x},${d.y}) couple${d.couple} ${d.gender === 'boy' ? 'B' : 'G'} faces ${o ? `couple${o.couple}` : 'nothing'} -> ${o ? relation(d.couple, o.couple) : '-'}`);
}
const tally = {};
for (const d of b.dancers) {
  const o = ahead(b, d);
  const k = o && d.couple !== 0 && o.couple !== 0 ? relation(d.couple, o.couple) : '?';
  tally[k] = (tally[k] ?? 0) + 1;
}
console.log(`  what every dancer faces: ${JSON.stringify(tally)}`);
console.log(`  All8 calls [B1c] the "AL BOX" and the "ZERO BOX"; an allemande left works from a board where`);
console.log(`  every dancer faces a CORNER, so the property to require is corner === 8.`);

console.log('\n=== 2. the "AL BOX" property, tested the way All8 states it ===');
{
  seq.setBoard(b);
  const step = seq.applyStep('Allemande Left');
  console.log(`  applyStep('Allemande Left') from this board: legal=${step.legal}${step.reason ? ` (${step.reason})` : ''}`);
  if (step.legal) console.log(`  it resolves the box: end formation ${seq.knownFormation(step.board) ?? '(unnamed)'}`);
  // The reference pair's own relationship, which is how the engine classifies [0B1c].
  const rs = relationshipStateOf(b, 'B');
  console.log(`  relationshipStateOf(board, 'B') = ${rs.code ?? 'null'}${rs.reason ? ` (${rs.reason})` : ''}   All8's code says 'c' = corner`);
  console.log(`  (that is the SAME relation the zero line is checked by, but on a BOX: each dancer's partner`);
  console.log(`   faces their corner, so 4 dancers face a corner and 4 face their partner's. The code's own`);
  console.log(`   'c' is the reference PAIR's relation, which is what makes [B1c] the "AL BOX".)`);
}

console.log('\n=== 3. every corpus module labelled `Zero Box`, replayed from the board ===');
{
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
  const boxes = files.filter((f) => {
    try { return JSON.parse(readFileSync(f, 'utf8')).startFormation === 'Zero Box'; } catch { return false; }
  });
  console.log(`  ${files.length} corpus module file(s), ${boxes.length} labelled "Zero Box"`);

  const summarise = (label, board) => {
    if (!board) { console.log(`  ${label}: NO BOARD`); return; }
    let full = 0, stopped = 0, empty = 0;
    const stops = {};
    for (const f of boxes) {
      const mod = JSON.parse(readFileSync(f, 'utf8'));
      const steps = (mod.steps ?? []).map((s) => (typeof s === 'string' ? s : s.call ?? ''));
      if (!steps.length) { empty++; continue; }
      seq.setBoard(board);
      let at = -1;
      for (let i = 0; i < steps.length; i++) {
        const res = seq.applyStep(steps[i]);
        if (!res || res.legal === false) { at = i; break; }
      }
      if (at < 0) full++;
      else { stopped++; stops[steps[at]] = (stops[steps[at]] ?? 0) + 1; }
    }
    console.log(`  ${label}: ${full}/${boxes.length - empty} replay all the way, ${stopped} stop, ${empty} empty`);
    const top = Object.entries(stops).sort((a, c) => c[1] - a[1]).slice(0, 8);
    if (top.length) console.log(`      most common stopping call: ${top.map(([n, c]) => `${n} (${c})`).join(', ')}`);
  };

  summarise('from the B1c board (NEW)', built.board);
  // WHAT THE APP DID BEFORE: the label did not resolve, so there was no board at all. Shown for
  // contrast by replaying from home, which is what a fallback would have danced.
  summarise('from home, for contrast', seq.boardForFormation('Static Square'));
}
