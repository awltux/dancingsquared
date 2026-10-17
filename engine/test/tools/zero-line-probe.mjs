// WHICH [L] FASR CODE IS THE ZERO LINE ceder-7046 IS WRITTEN FOR?
//
// `boardForFormation('Normal Lines')` is `[L0]` by its GENDER pattern, but it carries NO identity -
// couple is UNKNOWN for all eight, so `sequence` reads `unknown` and the couples sit in whatever
// order the formation array happened to list them. A zero line is `L0` PLUS the home arrangement:
// sequence IN, everyone with their original partner and corner. So the start board has to come from
// `boardForFasrCode`, not from the formation library - and the question is which code.
//
// THE CORPUS ANSWERS IT. `ceder-7046` declares `endFormation: "Static Square"`, so the right start is
// the code from which the module's own five steps actually finish there. This runs the module from
// every candidate and reports where it lands.
//
// Usage: node engine/test/tools/zero-line-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, analyzeFasr, boardForFasrCode } from '../../dist/index.js';
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

const mod = JSON.parse(readFileSync(path.join(root, 'modules', 'zero_line', 'static_set', '7046.json'), 'utf8'));
const STEPS = mod.steps;
console.log(`module ${mod.name}: startFormation=${JSON.stringify(mod.startFormation)} endFormation=${JSON.stringify(mod.endFormation)}`);
console.log(`  steps: ${STEPS.join(' | ')}\n`);

const TEMPLATE = { B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', P: 'Double Pass Thru', F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH' };
const templateForLetter = (l) => (TEMPLATE[l] ? seq.boardForFormation(TEMPLATE[l]) : null);

const g = (d) => (d.gender === 'boy' ? 'B' : d.gender === 'girl' ? 'G' : '?');
const pose = (b) => b.dancers.slice().sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}${g(d)}c${d.couple === 0 ? '-' : d.couple}(${d.x},${d.y})@${Math.round((d.heading * 180) / Math.PI)}`)
  .join(' ');

// The home relation of couple `from` to couple `to`, up to gender:
//   +0 partner | +1 right-hand | +2 opposite | +3 corner
const rel = (from, to) => ['partner', 'right-hand', 'opposite', 'corner'][((to - from) % 4 + 4) % 4];

/** The dancer straight ahead of `d`, or null. */
function ahead(board, d) {
  const hx = Math.cos(d.heading), hy = Math.sin(d.heading);
  let best = null;
  for (const o of board.dancers) {
    if (o.id === d.id) continue;
    const dx = o.x - d.x, dy = o.y - d.y, dist = Math.hypot(dx, dy);
    if (dist < 0.5 || (dx * hx + dy * hy) / dist < 0.99) continue;
    if (!best || dist < best.dist) best = { o, dist };
  }
  return best?.o ?? null;
}

const CANDIDATES = ['(plain Normal Lines)', 'L1p', 'L1c', 'L1r', 'L1o', 'L2p', 'L2c', 'L2r', 'L2o', '5L1p', '5L1c', '5L2p', '5L2c'];
const rows = [];
for (const code of CANDIDATES) {
  const built = code === '(plain Normal Lines)'
    ? { board: seq.boardForFormation('Normal Lines') }
    : boardForFasrCode(code, templateForLetter);
  if (!built.board) { rows.push({ code, note: 'REFUSED' }); continue; }
  const start = built.board;
  const f = analyzeFasr(start, null);
  let board = start, ok = true, failedAt = '';
  for (const s of STEPS) {
    const r = seq.applyToBoard(board, s);
    if (!r.legal) { ok = false; failedAt = s; break; }
    board = r.board;
  }
  // Does every dancer FACE a corner-relationship partner? That is the zero line's defining property
  // for the pairs standing across from each other.
  // WHICH COUPLES FACE EACH OTHER. A zero line's statement is specific about this: the pairs are
  // {1,4} and {2,3}, because corner(1)=4, corner(2)=3, and the partners stand side by side in the
  // same line. Both a {1,2}/{3,4} layout and a {1,4}/{2,3} layout have every dancer facing SOMEBODY
  // at a corner-relationship offset, so "faces a corner" cannot tell them apart - the PAIR SET can.
  const facingPairs = new Set();
  let cornerPairs = 0, facing = 0;
  for (const d of start.dancers) {
    const o = ahead(start, d);
    if (!o) continue;
    facing++;
    if (d.couple === 0 || o.couple === 0) continue;
    facingPairs.add([d.couple, o.couple].sort().join('-'));
    if (rel(d.couple, o.couple) === 'corner' || rel(o.couple, d.couple) === 'corner') cornerPairs++;
  }
  rows.push({
    code,
    seqState: f.sequence,
    identity: start.dancers.filter((d) => d.couple !== 0).length,
    cornerPairs,
    facing,
    pairs: [...facingPairs].sort().join(' '),
    ok,
    failedAt,
    end: ok ? seq.knownFormation(board) : null,
    matches: ok && seq.knownFormation(board) === mod.endFormation,
    beats: seq.sequenceBeats(STEPS, start),
  });
}

console.log('candidate            identity  sequence  facing a corner  facing couple-pairs  applied 5/5  END');
for (const r of rows) {
  if (r.note) { console.log(`  ${r.code.padEnd(20)} ${r.note}`); continue; }
  console.log(
    `  ${r.code.padEnd(20)} ${String(r.identity).padStart(4)}/8  ${String(r.seqState).padEnd(8)}  ` +
    `${String(r.cornerPairs).padStart(4)}/${r.facing}          ${r.pairs.padEnd(20)}` +
    `${r.ok ? '  yes   ' : '  no    '}  ${r.end}`,
  );
}
console.log(`\n  a ZERO LINE must show facing couple-pairs "1-4 2-3" (partners side by side, facing a corner)`);

const winner = rows.find((r) => r.matches);
console.log(`\nstart boards, the two that matter:`);
for (const code of ['(plain Normal Lines)', winner?.code].filter(Boolean)) {
  const built = code === '(plain Normal Lines)' ? { board: seq.boardForFormation('Normal Lines') } : boardForFasrCode(code, templateForLetter);
  if (!built.board) continue;
  console.log(`  ${code}`);
  console.log(`    ${pose(built.board)}`);
  console.log(`    analyzeFasr: sequence=${analyzeFasr(built.board, null).sequence}, relationships=${JSON.stringify(analyzeFasr(built.board, null).relationship[1])} for #1`);
}

// ---------------------------------------------------------------- is the ZERO setup derivable per letter?
//
// `L1o` was not guessed: it is the one `[L]` code whose FACING COUPLES are the corner couples
// ({1,4} and {2,3}) with the couples in sequence. If that is what "zero" means, it is a PROPERTY, not
// a datum - and it should pick the canonical code for every letter without anyone supplying one.
// This tests that on all six transcribed formations, which is what a per-formation FASR SETUP would
// need in order to be filled in rather than hand-written.
console.log('\n=== is the "zero" setup DERIVABLE for every letter? ===');
console.log('  the rule: sequence IN, and every facing couple-pair must be a CORNER pair');
console.log('  (corner(c) = c+3, so the corner pairs are exactly {1,4} and {2,3})\n');
const CORNER = new Set(['1-4', '2-3']);
for (const [letter, formation] of Object.entries(TEMPLATE)) {
  const hits = [];
  for (const seqNo of ['1', '2']) {
    for (const rl of ['p', 'c', 'r', 'o']) {
      const code = `${letter}${seqNo}${rl}`;
      const built = boardForFasrCode(code, templateForLetter);
      if (!built.board) continue;
      const b = built.board;
      const f = analyzeFasr(b, null);
      const pairs = new Set();
      let all = true;
      for (const d of b.dancers) {
        const o = ahead(b, d);
        if (!o || d.couple === 0 || o.couple === 0) { all = false; break; }
        pairs.add([d.couple, o.couple].sort().join('-'));
      }
      const cornerOnly = all && [...pairs].every((p) => CORNER.has(p));
      if (cornerOnly) hits.push(`${code} (${f.sequence}, pairs ${[...pairs].sort().join(' ')})`);
    }
  }
  console.log(`  [${letter.padEnd(3)}] ${formation.padEnd(26)} -> ${hits.length ? hits.join('  |  ') : 'NO code satisfies it'}`);
}
