// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// ANALYSIS TOOL (not a harness): which FIGURES carry a call the engine reports as `Unknown call`?
//
// `figure-census.mjs` reports this cause only in aggregate ("6 unknown call (no catalogue entry)")
// and then by CALL name. A disposition table in PLAN.md needs the figures, because a call can be
// reported unknown at exactly one board in one figure while being perfectly known in its own right.
//
// The walk HERE is deliberately identical to `figure-census.mjs`: the same start board, the same
// `figureEngineCalls`, the same `seq.applyToBoard`, and the same `^Unknown call` test on the reason
// (NOT `seq.hasCall`, which is false for every DERIVED move and would report all 188 figures).
//
// Usage: node engine/test/tools/unknown-calls.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { ALL8_FIGURE_START, figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const data = loadAll8Figures();
const start = seq.boardForFormation(ALL8_FIGURE_START);

const hits = [];
for (const f of data.figures) {
  const calls = figureEngineCalls(f);
  let board = start;
  for (const call of calls) {
    const r = seq.applyToBoard(board, call);
    if (!r.legal) {
      if (/^Unknown call/.test(r.reason ?? '')) {
        hits.push({ id: f.id, call, formation: seq.knownFormation(board), reason: r.reason });
      }
      break; // the census stops at the first refusal in a figure
    }
    board = r.board;
  }
}

console.log(`=== ${hits.length} figure(s) stop on an UNKNOWN call ===`);
for (const h of hits) {
  console.log(`  ${h.id}  ${h.call}   from [${h.formation}]   (${h.reason})`);
}
