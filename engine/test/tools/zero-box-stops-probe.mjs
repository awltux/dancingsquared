// WHY DOES EACH `Zero Box` MODULE STOP WHERE IT DOES?
//
// `test/tools/zero-box-probe.mjs` measured that 54 of the corpus's 324 `Zero Box` modules replay all the
// way from All8's `[B1c]` board, and named the calls they stop on. This asks the next question: for each
// stop, WHY? Three causes look identical in a count and are owned by different work:
//
//   NAMING      - the engine has no call by that title (a bridge/synonym gap)
//   ENGINE      - the call exists but will not apply from the board it was reached from
//   UNNAMED     - the call applies and the board it leaves is a legitimate dance state the engine has
//                 no template for, so `knownFormation` says null. The get-out report counts these
//                 separately, and conflating them is the mistake the plan records.
//
// It also reports, for each stopping call, the FIRST board it fails on, so the owner can be checked.
//
// Usage: node engine/test/tools/zero-box-stops-probe.mjs

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, canonicalName } from '../../dist/index.js';
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

const LETTER_TEMPLATE = {
  B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', P: 'Double Pass Thru',
  F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH', S: 'Static Square',
};
const templateFor = (l) => (LETTER_TEMPLATE[l] ? seq.boardForFormation(LETTER_TEMPLATE[l]) : null);
const start = boardForFasrCode('B1c', templateFor).board;
if (!start) { console.log('FAIL: no Zero Box board'); process.exit(1); }

// Every module labelled Zero Box, in file order so a run is reproducible.
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json')) files.push(p);
  }
};
walk(path.join(root, 'modules'));
const boxes = files.filter((f) => {
  try { return JSON.parse(readFileSync(f, 'utf8')).startFormation === 'Zero Box'; } catch { return false; }
});

/** Every title the catalogue registers, for the "same words, different order" hunt. */
const implementedTitles = (assetDir) => {
  const levels = ['ms', 'ssd', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b', 'discovered'];
  const out = [];
  for (const lv of levels) {
    const d = path.join(assetDir, lv);
    let names;
    try { names = readdirSync(d); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith('.xml')) continue;
      try {
        const xml = readFileSync(path.join(d, f), 'utf8');
        for (const m of xml.matchAll(/title="([^"]+)"/g)) out.push(m[1]);
      } catch { /* unreadable file is not this probe's business */ }
    }
  }
  return [...new Set(out)];
};
void canonicalName;

const stops = new Map(); // call -> { count, samples: [{module, step, boardFormation, reason, legal}] }
let fullReplay = 0;
for (const f of boxes) {
  const mod = JSON.parse(readFileSync(f, 'utf8'));
  const steps = (mod.steps ?? []).map((s) => (typeof s === 'string' ? s : s.call ?? ''));
  seq.setBoard(start);
  for (let i = 0; i < steps.length; i++) {
    const step = seq.applyStep(steps[i]);
    if (!step || step.legal === false) {
      const entry = stops.get(steps[i]) ?? { count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < 3) {
        entry.samples.push({
          module: mod.name ?? path.basename(f, '.json'),
          index: i,
          boardFormation: seq.knownFormation(seq.board) ?? '(unnamed)',
          reason: step?.reason ?? '(no reason)',
        });
      }
      stops.set(steps[i], entry);
      break;
    }
    if (i === steps.length - 1) fullReplay++;
  }
}

const total = [...stops.values()].reduce((n, e) => n + e.count, 0);
console.log(`=== Zero Box modules: ${boxes.length} total, ${fullReplay} replay all the way, ${total} stop ===`);
console.log('\n=== every stopping call, with WHY, and the board it failed on ===');
const ordered = [...stops.entries()].sort((a, b) => b[1].count - a[1].count);
console.log('  call                          n    first failure');
for (const [name, e] of ordered) {
  const s = e.samples[0];
  console.log(`  ${name.padEnd(28)} ${String(e.count).padStart(3)}  board "${s.boardFormation}" at step ${s.index + 1} of ${s.module}`);
  console.log(`  ${''.padEnd(32)} reason: ${s.reason}`);
}

console.log('\n=== the head of the list, classified ===');
console.log('  call                          n    class     first failure');
for (const [name, e] of ordered.slice(0, 14)) {
  const s = e.samples[0];
  // The engine's own answer to "do you have this call?" - `legalCalls` is not usable (the board may be
  // one it cannot classify), so this asks the catalogue directly.
  let resolves = true;
  try { resolves = seq.hasCall(name); } catch { resolves = true; }
  const cls = /Unknown call/i.test(s.reason) ? 'NAMING'
    : /not legal for selected dancers/i.test(s.reason) ? 'NAMING|ENGINE'
      : 'ENGINE';
  console.log(`  ${name.padEnd(28)} ${String(e.count).padStart(3)}  ${cls.padEnd(9)} ${s.reason.slice(0, 78)}`);
}

console.log('\n=== the NAMING stops, and what the engine DOES have that looks like them ===');
for (const [name, e] of ordered) {
  const s = e.samples[0];
  if (!/Unknown call/i.test(s.reason)) continue;
  // Look for a registered title whose words are the same set - the classic differently-named call.
  const want = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const candidates = [];
  for (const t of implementedTitles(assets)) {
    const got = t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    if (got === want) candidates.push(t);
  }
  console.log(`  ${name.padEnd(28)} n=${String(e.count).padStart(3)}  ${candidates.length ? `-> the catalogue titles it "${candidates.join('", "')}"` : 'no title with the same words'}`);
}
