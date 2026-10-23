// WHAT DO THE CORPUS'S `startFormation` VALUES ACTUALLY MEAN IN ENGINE FORMATIONS?
//
// `poc/src/ceder-modules.ts` hands `validCederModules()` only `{ name, steps }`, so the corpus's
// `startFormation` is DROPPED, and `SequencerUI.openSequence` starts every module "from home". The
// corpus splits 137 Static Square / 108 Zero Line / 71 Zero Box, so **179 of 316 modules are replayed
// from a formation they were not written for**.
//
// `boardForFormation("Zero Line")` returns null - the engine has no such formation - so honouring the
// field needs a mapping. This measures it instead of guessing: replay each module's own steps from
// every named 8-dancer formation and count how many modules in the group get through ALL of them.
// The formation that finishes the most modules is what that label means in engine terms.
//
// Usage: node engine/test/tools/start-formation-probe.mjs [--per-group N]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode } from '../../dist/index.js';
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

const arg = process.argv.indexOf('--per-group');
const PER_GROUP = arg >= 0 ? Number(process.argv[arg + 1]) : 30;

// ------------------------------------------------------------------ the corpus, grouped by start
const groups = new Map();
const walkDir = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { walkDir(p); continue; }
    if (!p.endsWith('.json')) continue;
    let v;
    try { v = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (!v || v.success !== true || !Array.isArray(v.steps) || v.steps.length === 0) continue;
    if (v.steps.includes('ALLEMANDE_LEFT')) continue;
    const key = v.startFormation ?? '(none)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v.steps);
  }
};
walkDir(path.join(root, 'modules'));

const FORMATIONS = seq.listFormations().filter((n) => {
  const b = seq.boardForFormation(n);
  return b !== null && b.dancers.length === 8;
});
console.log(`${FORMATIONS.length} named 8-dancer formations; ${[...groups.values()].reduce((a, g) => a + g.length, 0)} modules in ${groups.size} start-formation group(s)\n`);

/** How many of `modules` run end-to-end from `formation` (every step legal), and to a NAMED end. */
function score(formation, modules) {
  let done = 0, named = 0;
  for (const steps of modules) {
    let board = seq.boardForFormation(formation);
    let ok = true;
    for (const s of steps) {
      const r = seq.applyToBoard(board, s);
      if (!r.legal) { ok = false; break; }
      board = r.board;
    }
    if (ok) { done++; if (seq.knownFormation(board)) named++; }
  }
  return { done, named };
}

for (const [label, all] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const sample = all.slice(0, PER_GROUP);
  const rows = FORMATIONS.map((f) => ({ f, ...score(f, sample) }));
  rows.sort((a, b) => b.named - a.named || b.done - a.done);
  console.log(`=== startFormation ${JSON.stringify(label)}  (${all.length} modules, scoring the first ${sample.length}) ===`);
  for (const r of rows.slice(0, 6)) {
    const pct = ((100 * r.named) / sample.length).toFixed(0);
    console.log(`  ${String(r.named).padStart(3)}/${sample.length} to a named end (${pct.padStart(3)}%), ${String(r.done).padStart(3)} applied all  ${r.f}`);
  }
  console.log('');
}

// ---------------------------------------------------------------- the FASR-CODE candidates
//
// The named formations above are geometry plus per-slot gender and NOTHING else - 129 of the 134
// carry no couple identity, so no partner, no corner and no sequence. The engine's ARRANGEMENT
// machinery is elsewhere: `boardForFasrCode` builds a fully identified board from All8's published
// `[arrangement]LETTER[sequence][relationship]` code. So the labels may name a CODE, not a formation,
// and this scores the code candidates the same way. Let the corpus decide.
const TEMPLATE = {
  B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', P: 'Double Pass Thru',
  F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH',
};
function scoreCode(code, modules) {
  const built = boardForFasrCode(code, (l) => (TEMPLATE[l] ? seq.boardForFormation(TEMPLATE[l]) : null));
  if (!built.board) return null;
  let done = 0, named = 0;
  for (const steps of modules) {
    let board = built.board;
    let ok = true;
    for (const s of steps) {
      const r = seq.applyToBoard(board, s);
      if (!r.legal) { ok = false; break; }
      board = r.board;
    }
    if (ok) { done++; if (seq.knownFormation(board)) named++; }
  }
  return { done, named };
}

const CODES = [];
for (const letter of ['L', 'B', 'W', 'P', 'F']) {
  for (const seqNo of ['1', '2']) {
    for (const rel of ['p', 'c', 'r', 'o']) CODES.push(`${letter}${seqNo}${rel}`);
  }
  for (const rel of ['p', 'c']) CODES.push(`5${letter}1${rel}`, `5${letter}2${rel}`);
}

console.log('=== the FASR-CODE candidates, scored the same way ===');
console.log('  (boardForFasrCode builds a FULLY IDENTIFIED board - partner, corner and sequence included)');
for (const [label, all] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const sample = all.slice(0, PER_GROUP);
  const rows = CODES.map((c) => ({ c, s: scoreCode(c, sample) })).filter((r) => r.s);
  rows.sort((a, b) => b.s.named - a.s.named || b.s.done - a.s.done);
  console.log(`\n  startFormation ${JSON.stringify(label)}, best codes by modules reaching a NAMED end:`);
  for (const r of rows.slice(0, 5)) {
    const pct = ((100 * r.s.named) / sample.length).toFixed(0);
    console.log(`    ${r.c.padEnd(5)} ${String(r.s.named).padStart(3)}/${sample.length} named (${pct.padStart(3)}%), ${String(r.s.done).padStart(3)} applied all`);
  }
  const best = rows[0];
  if (best) console.log(`    -> best is ${best.c}; the best NAMED FORMATION scored ${[...FORMATIONS].map((f) => score(f, sample)).reduce((m, x) => Math.max(m, x.named), 0)}/${sample.length}`);
}

