// DOES THE CORPUS'S `Promenade` EVER ANIMATE?
//
// The corpus-wide collision scan (`sequence-anim-collision-scan.mjs`) returned byte-identical numbers
// before and after the ring-travel fix, even though 113 of the 1607 modules carry a `Promenade` step.
// That is either "the fix has no collision cost" or "the instrument cannot see the fix", and those
// are very different claims. This settles which, by asking of every module that carries a promenade
// step: does the WALK reach it, how many beats is it charged, and does a dancer actually move
// through it.
//
// Usage: node engine/test/tools/promenade-corpus-play-probe.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, FORMATIONS_FOR_LETTER } from '../../dist/index.js';
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
const templateForLetter = (l) => {
  for (const n of FORMATIONS_FOR_LETTER[l] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};
const START = { 'static square': null, 'squared set': null, 'zero line': 'L1o', 'zero box': 'B1c' };

function walkJson(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

const maxMoveOver = (flat, start, fromBeat, toBeat, step = 0.25) => {
  let prev = null;
  let most = 0;
  for (let b = fromBeat; b <= toBeat + 1e-9; b += step) {
    const board = seq.evaluateSequence(flat, Math.min(b, toBeat), start).board;
    if (prev) {
      const by = new Map(board.dancers.map((d) => [d.id, d]));
      for (const d of prev.dancers) {
        const e = by.get(d.id);
        if (e) most = Math.max(most, Math.hypot(e.x - d.x, e.y - d.y));
      }
    }
    prev = board;
  }
  return most;
};

const rows = [];
for (const file of walkJson(path.join(root, 'modules'))) {
  let mod;
  try { mod = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  if (!Array.isArray(mod.steps) || !mod.steps.length) continue;
  const steps = mod.steps.filter((s) => /promenade/i.test(typeof s === 'string' ? s : s.call));
  if (!steps.length) continue;

  const label = mod.startFormation?.trim().toLowerCase();
  const code = START[label];
  const start = code === null
    ? seq.boardForFormation('Static Square')
    : boardForFasrCode(code ?? '', templateForLetter).board;
  const flat = seq.flatten(mod.steps);
  const total = seq.sequenceBeats(flat, start);
  const stop = seq.sequenceStop(flat, start);

  // The step's own beat window: everything before the promenade, up to the total.
  const before = seq.sequenceBeats(seq.flatten(mod.steps.slice(0, mod.steps.length - steps.length)), start);
  const promBeats = total - before;
  const moved = promBeats > 0 ? maxMoveOver(flat, start, before, total) : 0;

  rows.push({
    file: path.relative(root, file).replace(/\\/g, '/'),
    name: steps.map((s) => (typeof s === 'string' ? s : s.call)).join('+'),
    reached: !stop || stop.index >= mod.steps.length - steps.length,
    promBeats,
    moved,
    stopReason: stop?.reason ?? '',
  });
}

const seen = new Set(rows.map((r) => r.name));
console.log(`${rows.length} module(s) carry a promenade step; names: ${[...seen].join(', ')}`);
const reached = rows.filter((r) => r.reached);
const charged = rows.filter((r) => r.promBeats > 0.5);
const animated = rows.filter((r) => r.moved > 0.05);
console.log(`  the walk reaches the promenade step:  ${reached.length}`);
console.log(`  it is charged real beats:             ${charged.length}`);
console.log(`  a dancer actually moves through it:   ${animated.length}`);
const byReason = new Map();
for (const r of rows) {
  if (r.reached && r.promBeats > 0.5) continue;
  const key = r.reached ? 'reached but charged 0 beats' : (r.stopReason || 'stopped');
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}
for (const [k, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)}  ${k}`);
console.log('\n  the modules that DO animate it, with the largest half-second move inside the call:');
for (const r of animated.sort((a, b) => b.moved - a.moved).slice(0, 12)) {
  console.log(`      ${r.moved.toFixed(3)}  ${r.file}  ${r.name}  (${r.promBeats.toFixed(1)}b)`);
}
