// CEDER-7046 IN THE SEQUENCER: two reported defects, reproduced headlessly.
//
//   1. Playing the LAST call ("Right & Left Grand Resolve to a Right & Left Grand") walks the dancers
//      off into an unrecognised formation.
//   2. The last frame jumps the board BACK to `Double Pass Thru` - the board the PREVIOUS call
//      started from - instead of staying on the board the call produces.
//
// The report comes from the POC, which cannot be launched in this sandbox (the Vite/esbuild spawn is
// blocked), so this reproduces the same path the UI takes: load the module's steps, walk them with
// `applyToBoard`, and read the animation with `sequenceBeats` / `evaluateSequence`, exactly as
// `SequencerUI` does.
//
// Usage: node engine/test/tools/ceder-7046-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
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

// The POC's ceder corpus is `modules/**/*.json` (TRANSLATED names), not `sequences/**/*.json` (the
// raw ceder spelling) - `ceder-modules.ts` globs the former and hands `steps` straight to the engine.
const mod = JSON.parse(readFileSync(path.join(root, 'modules', 'zero_line', 'static_set', '7046.json'), 'utf8'));
const STEPS = mod.steps;
console.log(`module ${mod.name} (${mod.id}):`);
for (const [i, s] of STEPS.entries()) console.log(`  ${i + 1}. ${s}`);

const pose = (b) => b.dancers.slice().sort((x, y) => x.id - y.id)
  .map((d) => `#${d.id}(${d.x.toFixed(1)},${d.y.toFixed(1)})@${String(Math.round((d.heading * 180) / Math.PI)).padStart(4)}`)
  .join(' ');

// ---------------------------------------------------------------- the stored walk
console.log('\n=== the STORED walk (what `applyToBoard` does) ===');
let board = seq.boardForFormation('Static Square');
console.log(`  start [${seq.knownFormation(board)}]`);
for (const [i, s] of STEPS.entries()) {
  const r = seq.applyToBoard(board, s);
  if (!r.legal) { console.log(`  ${i + 1}. ${s}\n     REFUSED: ${r.reason}`); break; }
  board = r.board;
  console.log(`  ${i + 1}. ${s}`);
  console.log(`     -> [${seq.knownFormation(board)}] ${pose(board)}`);
}

// ---------------------------------------------------------------- the animated walk
console.log('\n=== the ANIMATED walk (what the sequencer UI shows) ===');
const total = seq.sequenceBeats(STEPS);
console.log(`  sequenceBeats = ${total.toFixed(1)} beats`);
let acc = 0;
for (const [i, s] of STEPS.entries()) {
  const info = seq.sequenceInfo(STEPS, acc + 0.5, seq.boardForFormation('Static Square'));
  const at = seq.evaluateSequence(STEPS, acc, seq.boardForFormation('Static Square'));
  const next = seq.evaluateSequence(STEPS, acc + 0.001, seq.boardForFormation('Static Square'));
  console.log(`  ${i + 1}. ${s}   (starts at beat ${acc.toFixed(1)})`);
  console.log(`     board at its start: [${seq.knownFormation(at.board)}]`);
  console.log(`     sequenceInfo says:  ${info ? info.name : '(none)'}`);
  acc += seq.sequenceBeats(STEPS.slice(0, i + 1)) - (i > 0 ? seq.sequenceBeats(STEPS.slice(0, i)) : 0);
}
console.log(`  board at the very END (beat ${total.toFixed(1)}): [${seq.knownFormation(seq.evaluateSequence(STEPS, total, seq.boardForFormation('Static Square')).board)}]`);

// ---------------------------------------------------------------- from the module's OWN start
//
// `startFormation: "Zero Line"` is All8's `L0`, and the engine's `Normal Lines` IS `L0` (the
// transcribed `[L]` table at column 0 is `gBgB`/`BgBg`, which is what that board classifies as). So
// the module CAN be replayed as published - the app was matching on ceder's LABEL rather than
// resolving it, and started everything from home. This is the run that matters.
console.log('\n=== the SAME five steps from the module\'s OWN start ("Zero Line" = [L0] = Normal Lines) ===');
{
  const start = seq.boardForFormation('Normal Lines');
  console.log(`  start [${seq.knownFormation(start)}] ${pose(start)}`);
  let b = start;
  for (const [i, s] of STEPS.entries()) {
    const r = seq.applyToBoard(b, s);
    if (!r.legal) { console.log(`  ${i + 1}. ${s}\n     REFUSED: ${r.reason}`); break; }
    b = r.board;
    console.log(`  ${i + 1}. ${s} -> [${seq.knownFormation(b)}] ${pose(b)}`);
  }
  const total = seq.sequenceBeats(STEPS, start);
  console.log(`  sequenceBeats = ${total.toFixed(1)} beats`);
  const end = seq.evaluateSequence(STEPS, total, start).board;
  console.log(`  board at the end (beat ${total.toFixed(1)}): [${seq.knownFormation(end)}] ${pose(end)}`);
}

// ---------------------------------------------------------------- the LAST call alone
console.log('\n=== the LAST call on its own, from the board it starts on ===');
const prefix = STEPS.slice(0, STEPS.length - 1);
let start = seq.boardForFormation('Static Square');
let acc2 = 0;
for (const s of prefix) {
  const r = seq.applyToBoard(start, s);
  if (!r.legal) break;
  start = r.board;
  acc2 += 0;
}
const LAST = STEPS[STEPS.length - 1];
console.log(`  board before it: [${seq.knownFormation(start)}] ${pose(start)}`);
const lr = seq.applyToBoard(start, LAST);
console.log(`  applyToBoard : ${lr.legal ? `LEGAL -> [${seq.knownFormation(lr.board)}] ${pose(lr.board)}` : `REFUSED - ${lr.reason}`}`);
const lb = seq.sequenceBeats([LAST], start);
console.log(`  sequenceBeats: ${lb.toFixed(1)} beats`);
if (lb > 0) {
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const b = seq.evaluateSequence([LAST], lb * t, start).board;
    console.log(`    t=${t.toFixed(2)} beat ${(lb * t).toFixed(2)}  [${seq.knownFormation(b)}] ${pose(b)}`);
  }
} else {
  console.log(`    NO BEATS - nothing animates, so the board stays where it was`);
}
