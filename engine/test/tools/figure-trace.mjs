// ANALYSIS TOOL (not a harness): step ONE figure, or a few, call by call.
//
// `figure-census.mjs` answers "where does the corpus fail, in aggregate". This answers the
// follow-up that always comes next: "and what exactly happened inside THIS figure?" It prints the
// board after every call - formation, the eight positions with facings - and, on a refusal, the
// reason and the board the call was asked to run on. That is the difference between knowing a
// figure stops at `Heads Square Thru 4` and knowing WHICH board it was asked to run on.
//
// Usage:
//   node engine/test/tools/figure-trace.mjs figm197 figm224
//   node engine/test/tools/figure-trace.mjs figm197 --verbose      # also print the raw source line
//
// Ids are `figm<N>` where N is the figure's line number on All8's page (see `all8-figures.mjs`).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, findCodedMove } from '../../dist/index.js';
import { splitSelection } from '../../dist/sequencer/selection.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { ALL8_FIGURE_START, figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const data = loadAll8Figures();
const start = seq.boardForFormation(ALL8_FIGURE_START);

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const ids = args.filter((a) => !a.startsWith('--'));
if (!ids.length) {
  console.error('usage: node engine/test/tools/figure-trace.mjs <figmN ...> [--verbose]');
  process.exit(2);
}

/** Render a board as one line per dancer, in id order, so a diff between two boards is readable. */
function pose(board) {
  return board.dancers
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((d) => `#${d.id}${d.gender ? d.gender[0].toUpperCase() : '?'}(${d.x.toFixed(2)},${d.y.toFixed(2)})@${Math.round(((d.heading ?? 0) * 180) / Math.PI)}`)
    .join(' ');
}

for (const id of ids) {
  const f = data.figures.find((x) => x.id === id);
  if (!f) { console.log(`${id}: NOT FOUND`); continue; }
  const calls = figureEngineCalls(f);
  console.log(`\n=== ${id} — ${calls.length} call(s) ===`);
  if (verbose) console.log(`source: ${JSON.stringify(f.raw)}`);
  console.log(`  start   [${seq.knownFormation(start)}] ${pose(start)}`);

  let board = start;
  let ok = true;
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const r = seq.applyToBoard(board, call);
    if (!r.legal) {
      const base = splitSelection(call).call;
      const coded = findCodedMove(base) ? ' (derived/coded move)' : '';
      console.log(`  #${i + 1} FAIL ${call}${coded}`);
      console.log(`      board it was asked to run on: [${seq.knownFormation(board)}]`);
      console.log(`      reason: ${r.reason}`);
      ok = false;
      break;
    }
    board = r.board;
    console.log(`  #${i + 1} ok   ${call}  -> [${seq.knownFormation(board)}] ${pose(board)}`);
  }
  console.log(`  RESULT: ${ok ? 'runs end-to-end' : 'BLOCKED'}`);
}
