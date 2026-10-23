// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// A WHOLE-SET `Trade` WAS ATTEMPTED AND REVERTED - here is everything it was measured against.
//
// The attempt's evidence looked sufficient and was not, so this keeps the whole argument in one place
// rather than in five probes that each answered one step of it.
//
// WHAT MADE IT LOOK AVAILABLE:
//   1. a bare `Trade` stops 22 modules of the `Zero Box` corpus (the biggest genuine item on that list);
//   2. All8 authors the bare `Trade` tam `from="Right-Hand Waves"` with FOUR paths, all `Swing Right`
//      (and `from="Left-Hand Waves"` with four `Swing Left`) - eight dancers move, in four pairs;
//   3. from the engine's `Ocean Waves` template, the three candidate pairings all leave an `Ocean
//      Waves` with every gender in its original spot, so the "which pair trades" ambiguity looked
//      harmless.
//
// WHY THOSE FAILED TO SETTLE IT: see section 2 - the three candidates leave DIFFERENT BOARDS, so that
// invariant does not identify the pairing, and the rule the engine has picks the one that pairs
// DIFFERENT GENDERS on a wave.
//
// Usage: node engine/test/tools/trade-whole-set-record-probe.mjs

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, applyCodedMove } from '../../dist/index.js';
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

const pose = (b) => [...b.dancers].sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}(${d.x.toFixed(0)},${d.y.toFixed(0)})@${((d.heading * 180) / Math.PI).toFixed(0)}`).join(' ');
const genders = (b) => [...b.dancers].sort((x, y) => x.id - y.id).map((d) => (d.gender === 'boy' ? 'B' : 'g')).join('');

console.log('=== 1. the authored motion, the only oracle for what a Trade IS ===');
{
  const xml = readFileSync(path.join(assets, 'ms', 'trade.xml'), 'utf8');
  for (const m of xml.matchAll(/<tam title="(Trade)"[^>]*from="([^"]+)"[^>]*>([\s\S]*?)<\/tam>/g)) {
    const moves = [...m[3].matchAll(/<move select="([^"]+)"/g)].map((x) => x[1]);
    console.log(`  ${m[1]} from "${m[2].trim()}" -> ${moves.length} path(s): ${[...new Set(moves)].join(', ')}`);
  }
  const movesXml = readFileSync(path.join(assets, 'moves.xml'), 'utf8');
  for (const name of ['Swing Right', 'Swing Left']) {
    const i = movesXml.indexOf(`<path name="${name}">`);
    const body = i < 0 ? '(not defined)' : movesXml.slice(i, movesXml.indexOf('</path>', i)).replace(/\s+/g, ' ').slice(0, 110);
    console.log(`  ${name}: ${body}`);
  }
  console.log('  (a Swing is a pair 4 apart being exchanged - so a wave Trade is FOUR pair-exchanges.)');
}

console.log('\n=== 2. the three candidate pairings on a wave, and what each LEAVES ===');
{
  const start = seq.boardForFormation('Ocean Waves');
  const swap = (board, [aId, bId]) => {
    const a = board.dancers.find((d) => d.id === aId);
    const b = board.dancers.find((d) => d.id === bId);
    const out = board.dancers.map((d) => ({ ...d }));
    const oa = out.find((d) => d.id === aId);
    const ob = out.find((d) => d.id === bId);
    oa.x = b.x; oa.y = b.y; oa.heading = b.heading;
    ob.x = a.x; ob.y = a.y; ob.heading = a.heading;
    return { dancers: out };
  };
  const applyPairs = (pairs) => {
    let b = { dancers: start.dancers.map((d) => ({ ...d })) };
    for (const p of pairs) b = swap(b, p);
    return b;
  };
  console.log(`  start  ${pose(start)}  genders ${genders(start)}`);
  for (const [label, pairs] of Object.entries({
    'A same-column 2 apart': [[1, 2], [3, 4], [5, 6], [7, 8]],
    'B across-column 4 apart': [[1, 8], [2, 7], [3, 6], [4, 5]],
    'C same-gender': [[1, 4], [2, 3], [5, 8], [6, 7]],
  })) {
    const after = applyPairs(pairs);
    const gaps = pairs.map(([a, b]) => {
      const da = start.dancers.find((q) => q.id === a);
      const db = start.dancers.find((q) => q.id === b);
      return `${Math.hypot(db.x - da.x, db.y - da.y).toFixed(0)}${da.gender === db.gender ? 'same' : 'CROSS'}`;
    });
    console.log(`  ${label.padEnd(24)} -> ${pose(after)}`);
    console.log(`  ${''.padEnd(24)}    leaves ${seq.knownFormation(after) ?? '(unnamed)'}, genders ${genders(after) === genders(start) ? 'unchanged' : 'CHANGED'}, pairs ${gaps.join(' ')}`);
  }
  console.log('  ALL THREE leave a formation NAMED Ocean Waves with genders unchanged, and they are');
  console.log('  DIFFERENT BOARDS. So that invariant does NOT identify the pairing - which is the trap.');
  console.log('  Only A is what the engine\'s rule produces, and A pairs CROSS-gender 2 apart.');
}

console.log('\n=== 3. why a whole-set reading cannot be derived from the rule the engine has ===');
{
  const names = (seq.listFormations ? seq.listFormations() : []).filter((n) => {
    const b = seq.boardForFormation(n);
    return b && b.dancers.length === 8;
  });
  console.log(`  named 8-dancer formations the engine can stand up: ${names.length}`);
  console.log('  the attempt, which designated EVERY dancer: applied from 126 of them (Static Square included,');
  console.log('  and `3/4 Tag`, `Alamo Wave`, `Blocks`, ...), because "every dancer has someone beside them"');
  console.log('  is true nearly everywhere and the parity rule then always finds a partner.');
  console.log('  A derivation that applies to 94% of formations is not a reading of the call.');
}

console.log('\n=== 4. what the corpus asks for, so the next attempt knows the real shape ===');
{
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) files.push(p);
    }
  };
  walk(path.join(root, 'modules'));
  const byLabel = {};
  let total = 0;
  for (const f of files) {
    try {
      const m = JSON.parse(readFileSync(f, 'utf8'));
      const steps = (m.steps ?? []).map((s) => (typeof s === 'string' ? s : s.call ?? ''));
      if (!steps.some((s) => s.trim() === 'Trade')) continue;
      total++;
      byLabel[m.startFormation ?? '(none)'] = (byLabel[m.startFormation ?? '(none)'] ?? 0) + 1;
    } catch { /* not this probe's business */ }
  }
  console.log(`  ${total} corpus module(s) use a bare Trade, by start label: ${JSON.stringify(byLabel)}`);
  console.log('  the board it is called FROM is not the start label either - the earlier measurement found');
  console.log('  eight different formations (Ocean Waves 26, Completed Double Pass Thru 7, Two-Faced Lines 6,');
  console.log('  Tidal Wave 3, Lines Facing Out 3, Quarter Tag 2, Two-Faced Tidal Line RH 1, 3/4 Tag 1).');
  console.log('\n  so a correct derivation needs, per board: (a) the PAIRING the call means there, established');
  console.log('  from a source rather than chosen, and (b) a precondition that is false for the 126 formations');
  console.log('  where a bare Trade is not that call at all. Neither is in hand, which is why it refuses.');
}

console.log('\n=== 5. and it refuses everywhere, which is the shipped behaviour ===');
{
  const names = (seq.listFormations ? seq.listFormations() : []).filter((n) => {
    const b = seq.boardForFormation(n);
    return b && b.dancers.length === 8;
  });
  let applied = 0;
  for (const n of names) {
    const r = applyCodedMove(seq.boardForFormation(n), 'Trade');
    if (r?.legal) applied++;
  }
  console.log(`  bare Trade applies from ${applied} of ${names.length} named 8-dancer formations (expected 0)`);
}
