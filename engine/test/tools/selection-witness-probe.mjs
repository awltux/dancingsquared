// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// FIND A WORKING PRIMITIVE WITNESS for "a selection step animates only the selected dancers".
//
// `behaviour-audit` needs a (board, selection step) pair that APPLIES and moves only part of the board.
// The obvious ones are not legal through the selection path from a squared set, so this enumerates
// candidates and reports which apply, how many dancers they move, and whether the animation keeps the
// rest still.
//
// Usage: node engine/test/tools/selection-witness-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const SELECTIONS = ['Heads', 'Sides', 'Centers', 'Ends', 'Boys', 'Girls', 'Leaders', 'Trailers'];
const CALLS = ['Pass Thru', 'Right and Left Thru', 'Square Thru 3', 'Square Thru 4', 'Star Thru', 'Swing Thru',
  'Touch a Quarter', 'Circulate', 'Flutterwheel', 'Trade', 'Run', 'Scoot Back', 'Hinge', 'Bend the Line'];

const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

for (const formation of ['Static Square', 'Ocean Waves', 'Normal Lines', 'Two-Faced Lines', 'Eight Chain Thru', 'Double Pass Thru']) {
  const start = seq.boardForFormation(formation);
  if (!start) continue;
  for (const selection of SELECTIONS) {
    for (const call of CALLS) {
      const step = { selection, call };
      const r = seq.applyToBoard(start, step);
      if (!r.legal) continue;
      const moved = r.board.dancers.filter((d) => {
        const s = start.dancers.find((x) => x.id === d.id);
        return !s || Math.hypot(d.x - s.x, d.y - s.y) > 1e-9 || angDiff(d.heading, s.heading) > 1e-9;
      });
      if (moved.length === 0 || moved.length === 8) continue;
      const flat = [step];
      const beats = seq.sequenceBeats(flat, start);
      let still = 0;
      for (let b = 0; b <= beats + 1e-9; b += 0.25) {
        for (const d of seq.evaluateSequence(flat, Math.min(b, beats), start).board.dancers) {
          if (moved.some((m) => m.id === d.id)) continue;
          const s = start.dancers.find((x) => x.id === d.id);
          if (s) still = Math.max(still, Math.hypot(d.x - s.x, d.y - s.y));
        }
      }
      const end = seq.evaluateSequence(flat, beats, start).board;
      const gapEnd = Math.max(...r.board.dancers.map((d) => {
        const e = end.dancers.find((x) => x.id === d.id);
        return e ? Math.hypot(e.x - d.x, e.y - d.y) : 0;
      }));
      console.log(`${formation.padEnd(16)} ${selection.padEnd(9)} ${call.padEnd(20)} moves ${moved.length}  ${beats.toFixed(1)}b  unselected-move ${still.toFixed(3)}  end-gap ${gapEnd.toFixed(3)}`);
    }
  }
}
