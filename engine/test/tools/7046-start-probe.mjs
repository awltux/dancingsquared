// TIER: none — one-shot diagnostic; nothing runs it. Recorded: engine/test/tools/README.md.
// IS ceder-7046 VALID FROM ITS OWN START FORMATION, AND ONLY BROKEN FROM HOME?
//
// `modules/zero_line/static_set/7046.json` declares `"startFormation": "Zero Line"`, but
// `poc/src/ceder-modules.ts` hands `validCederModules()` only `{ name, steps }` - the start formation
// is DROPPED - and `SequencerUI.openSequence` deliberately starts a module "from home". So the POC
// always replays these modules from a Static Square, whatever the corpus recorded.
//
// If the sequence is clean from its declared formation and broken from home, then the "dancers
// wander off into an unknown formation" half of the report is a START-FORMATION bug, not a body bug,
// and no amount of call work will fix it. This measures that directly: walk the same five steps from
// every named formation and count how far it gets.
//
// Usage: node engine/test/tools/7046-start-probe.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
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

const mod = JSON.parse(readFileSync(path.join(root, 'modules', 'zero_line', 'static_set', '7046.json'), 'utf8'));
const STEPS = mod.steps;
console.log(`module ${mod.name}: startFormation=${JSON.stringify(mod.startFormation)} endFormation=${JSON.stringify(mod.endFormation)}`);
console.log(`  steps: ${STEPS.join(' | ')}\n`);

// Does the engine know a formation by that name at all?
for (const name of [mod.startFormation, mod.endFormation]) {
  if (!name) continue;
  const b = seq.boardForFormation(name);
  console.log(`boardForFormation(${JSON.stringify(name)}) -> ${b ? `[${seq.knownFormation(b)}] ${b.dancers.length} dancers` : 'null (NO SUCH FORMATION)'}`);
}

// How many of those startFormation values does the corpus actually carry, and do we honour any?
const dirs = path.join(root, 'modules');
const starts = new Map();
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.json')) continue;
    try {
      const v = JSON.parse(readFileSync(p, 'utf8'));
      if (!v || v.success !== true || !Array.isArray(v.steps)) continue;
      starts.set(v.startFormation ?? '(none)', (starts.get(v.startFormation ?? '(none)') ?? 0) + 1);
    } catch { /* skip */ }
  }
};
walk(dirs);
console.log(`\nthe corpus's startFormation values (${[...starts.values()].reduce((a, b) => a + b, 0)} modules):`);
for (const [k, n] of [...starts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);

// ---------------------------------------------------------------- walk from every named formation
const rows = [];
for (const name of seq.listFormations()) {
  const start = seq.boardForFormation(name);
  if (!start || start.dancers.length !== 8) continue;
  let board = start;
  let got = 0;
  let failedAt = '';
  for (const s of STEPS) {
    const r = seq.applyToBoard(board, s);
    if (!r.legal) { failedAt = `${s}: ${r.reason}`; break; }
    board = r.board;
    got++;
  }
  const total = seq.sequenceBeats(STEPS, start);
  rows.push({ name, got, failedAt, total, end: seq.knownFormation(board) });
}
rows.sort((a, b) => b.got - a.got || b.total - a.total);
console.log(`\nALL 8-dancer formations, best first (got = steps that applied, total = animated beats):`);
for (const r of rows.slice(0, 14)) {
  console.log(`  ${r.got}/5 applied  ${r.total.toFixed(1).padStart(5)} beats  from ${r.name.padEnd(26)} -> ${r.end}${r.failedAt ? `   [stuck: ${r.failedAt}]` : ''}`);
}
const full = rows.filter((r) => r.got === 5);
console.log(`\n  ${full.length} of ${rows.length} formations apply ALL FIVE steps`);
const anim = rows.filter((r) => r.total >= 30);
console.log(`  ${anim.length} formations also ANIMATE the whole thing (>= 30 beats)`);
