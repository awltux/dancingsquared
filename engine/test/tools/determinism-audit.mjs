// P10 ANALYSIS TOOL: is the corpus result a property of the CORPUS, or of the PROCEDURE?
//
// PLAN.md Phase 10 exists because three walk procedures gave three different answers (8 / 20 / 17 of
// 188 figures). Before anything can be fixed, the variation has to be reproducible ON DEMAND and
// attributed, so this runs the SAME corpus through a set of deliberately different procedures, all
// with the random source pinned to the same constant, and compares:
//
//   - the number of figures that run,
//   - WHICH figures run,
//   - and, for each figure, the call it stops on.
//
// A procedure difference that changes any of those is the bug. Ordering is varied too (figures in
// reverse), because a per-instance cache that survives across figures is the prime suspect.
//
//   node test/tools/determinism-audit.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';
import { ALL8_FIGURE_START } from '../lib/all8-figures.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const movesX = readFileSync(path.join(assets, 'moves.xml'), 'utf8');
const formsX = readFileSync(path.join(assets, 'formations.xml'), 'utf8');
const catalog = callsByTitle(assets);
const data = loadAll8Figures();

const make = (freshCatalog) => {
  const s = new Sequencer(movesX, formsX, freshCatalog ? callsByTitle(assets) : catalog);
  s.setRandomSource(() => 0.5);
  return s;
};

/** Run every figure once and record, per figure, either 'ran' or the call it stopped on. */
function runCorpus({ reuseSequencer = true, freshBoardPerFigure = false, between = 'none', reverse = false, freshCatalog = false } = {}) {
  const shared = make(freshCatalog);
  const out = new Map();
  const figures = reverse ? [...data.figures].reverse() : data.figures;
  for (const f of figures) {
    const s = reuseSequencer ? shared : make(freshCatalog);
    let board = freshBoardPerFigure ? s.boardForFormation(ALL8_FIGURE_START) : (shared.__start ??= s.boardForFormation(ALL8_FIGURE_START));
    let stop = null;
    for (const c of figureEngineCalls(f)) {
      const r = s.applyToBoard(board, c);
      if (!r.legal) { stop = c; break; }
      board = r.board;
      if (between === 'knownFormation') s.knownFormation(board);
      if (between === 'recognize') s.recognize(board);
      if (between === 'legalCalls') s.legalCalls(board);
    }
    out.set(f.id, stop ?? 'ran');
  }
  return out;
}

const procedures = [
  ['baseline: one instance, one start board', {}],
  ['...fresh start board per figure', { freshBoardPerFigure: true }],
  ['...knownFormation after every call', { between: 'knownFormation' }],
  ['...recognize after every call', { between: 'recognize' }],
  ['...legalCalls after every call', { between: 'legalCalls' }],
  ['...fresh Sequencer per figure', { reuseSequencer: false }],
  ['...figures walked in REVERSE order', { reverse: true }],
  ['...fresh catalog objects', { freshCatalog: true }],
];

const baseline = runCorpus({});
const ran = (m) => [...m.values()].filter((v) => v === 'ran').length;
console.log(`=== ${procedures.length} procedures over ${data.figures.length} figures, random source pinned to 0.5 ===\n`);
console.log(`  ${'procedure'.padEnd(44)} runs  differences vs baseline`);
for (const [label, opts] of procedures) {
  const m = runCorpus(opts);
  const diffs = [];
  for (const [id, v] of m) if (baseline.get(id) !== v) diffs.push(`${id}: ${baseline.get(id)} -> ${v}`);
  console.log(`  ${label.padEnd(44)} ${String(ran(m)).padStart(4)}  ${diffs.length === 0 ? 'none' : `${diffs.length}: ${diffs.slice(0, 4).join(' ; ')}`}`);
}

// The same procedure twice, to prove the harness itself is stable.
const again = runCorpus({});
let selfDiff = 0;
for (const [id, v] of again) if (baseline.get(id) !== v) selfDiff++;
console.log(`\n  baseline repeated: ${selfDiff === 0 ? 'identical (the harness is stable)' : `${selfDiff} differences - the ENGINE is nondeterministic between identical runs`}`);
