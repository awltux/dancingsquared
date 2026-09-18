// THE LAST FRAME IS DRAWN TWICE, FROM TWO DIFFERENT BOARDS.
//
// `SequencerUI.renderPlayhead` draws the board `evaluateSequence` returns, and then:
//
//     if (res.beats > 0) this.render();
//
// `render()` draws `this.seq.board` - the sequencer's LIVE board, a different object with a different
// history behind it. At the sequence's END `evaluateSequence` returns `beats = totalBeats > 0`, so the
// live board is drawn LAST and wins. If the live replay refused a call that the walk accepted (they
// are two application paths), that last frame is the board BEFORE the call - which is exactly the
// start formation the UI prints for the selected call.
//
// This probe runs both paths on the same sequence and prints where they part.
//
// Usage: node engine/test/tools/sequence-live-vs-walk-probe.mjs

import { readFileSync } from 'node:fs';
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
const START = { 'zero line': 'L1o', 'zero box': 'B1c' };
const pose = (b) => [...b.dancers].sort((a, c) => a.id - c.id)
  .map((d) => `#${d.id}(${d.x.toFixed(2)},${d.y.toFixed(2)})`).join(' ');
const same = (a, b) => JSON.stringify([...a.dancers].sort((x, y) => x.id - y.id).map((d) => [+d.x.toFixed(3), +d.y.toFixed(3)]))
  === JSON.stringify([...b.dancers].sort((x, y) => x.id - y.id).map((d) => [+d.x.toFixed(3), +d.y.toFixed(3)]));

for (const rel of ['modules/zero_line/static_set/7046.json']) {
  const mod = JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
  const start = boardForFasrCode(START[mod.startFormation?.trim().toLowerCase()] ?? 'L1o', templateForLetter).board;
  const flat = seq.flatten(mod.steps);
  console.log(`\n${rel}  start ${mod.startFormation}  steps: ${mod.steps.join(' | ')}`);

  // --- the LIVE path, exactly as `openSequence` runs it
  seq.setBoard(start);
  console.log('  the LIVE path (seq.setBoard(start); applyStep each):');
  for (const h of seq.flatten(mod.steps)) {
    const r = seq.applyStep(h);
    console.log(`     ${r.legal ? 'ok ' : 'FAIL'} ${typeof h === 'string' ? h : h.call}  -> [${seq.knownFormation(seq.board)}]${r.legal ? '' : `   ${r.reason}`}`);
  }
  const liveEnd = { dancers: seq.board.dancers.map((d) => ({ ...d })) };

  // --- the WALK path, what `evaluateSequence` at the end returns
  const total = seq.sequenceBeats(flat, start);
  const walkEnd = seq.evaluateSequence(flat, total, start).board;
  console.log(`  the WALK path: sequenceBeats ${total} -> [${seq.knownFormation(walkEnd)}]`);
  console.log(`     live board : ${pose(liveEnd)}`);
  console.log(`     walk board : ${pose(walkEnd)}`);
  console.log(`     SAME BOARD: ${same(liveEnd, walkEnd) ? 'yes' : 'NO  <- renderPlayhead draws the live board last, so the last frame is the LIVE one'}`);
}
