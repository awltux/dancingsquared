// IS THE CORPUS'S BARE `Trade` ALWAYS FROM A WAVE?
//
// The engine refuses bare `Trade` with "Trade names a group to trade ... it has no whole-set reading",
// and the call's own tams are marked `sequencer="no"` - the same mark that stood in the way of `Run`
// until it was DERIVED (see coded-moves.ts and trade-run.ts). Whether a whole-set reading is
// well-defined is a question about the CHOREOGRAPHY, so this measures the boards the corpus actually
// asks it from, rather than reasoning about them.
//
// All8's own name for the call is "Trade" with no designation, and its abbreviation key lists `Trd`
// for the family - but a derived whole-set reading is only safe if the corpus uses it where the
// dancers ARE in trading position, so that is what this checks.
//
// Usage: node engine/test/tools/trade-whole-set-probe.mjs

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardForFasrCode, sequenceFor } from '../../dist/index.js';
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

const LETTER_TEMPLATE = {
  B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', P: 'Double Pass Thru',
  F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH', S: 'Static Square',
};
const templateFor = (l) => (LETTER_TEMPLATE[l] ? seq.boardForFormation(LETTER_TEMPLATE[l]) : null);

// Every module in the corpus, whatever its start label, wherever it uses a bare `Trade`.
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json')) files.push(p);
  }
};
walk(path.join(root, 'modules'));

/** The formation of a board, by the engine's own recogniser. */
const nameOf = (b) => seq.knownFormation(b) ?? '(unnamed)';

/** What a whole-set Trade would need: adjacent same-gender pairs across the wave. */
const tradeable = (b) => {
  // Every dancer needs another dancer of the SAME GENDER straight ahead, at wave distance.
  let ok = 0;
  for (const d of b.dancers) {
    const hx = Math.cos(d.heading), hy = Math.sin(d.heading);
    let best = null;
    for (const o of b.dancers) {
      if (o.id === d.id) continue;
      const dx = o.x - d.x, dy = o.y - d.y, dist = Math.hypot(dx, dy);
      if (dist < 0.5 || (dx * hx + dy * hy) / dist < 0.99) continue;
      if (!best || dist < best.dist) best = { o, dist };
    }
    if (best && best.o.gender === d.gender) ok++;
  }
  return ok;
};

console.log('=== every module using a bare `Trade`, and the board it is called from ===');
const byFormation = new Map();
let uses = 0, reached = 0;
const samples = [];
for (const f of files) {
  let mod;
  try { mod = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  const steps = (mod.steps ?? []).map((s) => (typeof s === 'string' ? s : s.call ?? ''));
  if (!steps.some((s) => s.trim() === 'Trade')) continue;
  const spec = START_FORMATION_SPEC(mod.startFormation);
  if (spec === undefined) continue; // a label the app cannot start from: not this probe's question
  const start = spec === null ? null : (spec.formation ? seq.boardForFormation(spec.formation) : boardForFasrCode(spec.code, templateFor).board);
  if (!start) continue;
  seq.setBoard(start);
  uses++;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].trim() === 'Trade') {
      const name = nameOf(seq.board);
      const t = tradeable(seq.board);
      byFormation.set(name, (byFormation.get(name) ?? 0) + 1);
      if (samples.length < 10) samples.push({ module: mod.name ?? path.basename(f, '.json'), step: i + 1, formation: name, tradeable: t, of: seq.board.dancers.length });
      reached++;
      break; // the first bare Trade in the module is the one that stops it
    }
    const step = seq.applyStep(steps[i]);
    if (!step || step.legal === false) break;
  }
}
console.log(`  ${uses} module(s) use a bare Trade from a start the app can stand up`);
console.log(`  boards it is called from (${reached} reached): ${JSON.stringify([...byFormation].sort((a, b) => b[1] - a[1]))}`);
console.log('\n  samples (a whole-set Trade needs EVERY dancer to have a same-gender dancer straight ahead):');
for (const s of samples) console.log(`    ${String(s.module).padEnd(14)} step ${String(s.step).padStart(2)}  board "${s.formation}"  traders ${s.tradeable}/${s.of}`);

function START_FORMATION_SPEC(label) {
  const l = (label ?? '').trim().toLowerCase();
  if (!l) return undefined;
  if (l === 'static square' || l === 'squared set') return { formation: 'Static Square' };
  if (l === 'zero line') return { code: 'L1o' };
  if (l === 'zero box') return { code: 'B1c' };
  return undefined;
}
void sequenceFor;
