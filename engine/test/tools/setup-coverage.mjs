// P16 ANALYSIS TOOL: the (call, board, scale) triples behind "the catalogue tam has no setup for this
// board" - the single largest owner in the figure census.
//
// The phase's own first step is to enumerate the failures as DATA before touching the matcher,
// because that list decides whether the fix is a wider matching tolerance, a derived rule, or an
// authored setup. So each failure is classified by what is actually wrong:
//
//   SIZE        no variant of the call has the number of dancers the board (or the selection) has
//   SCALE       a variant of the right size exists but its spacing is a different distance apart
//   ARRANGEMENT the same size AND the same scale, but a different shape
//
//   node test/tools/setup-coverage.mjs [--all]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { splitSelection } from '../../dist/sequencer/selection.js';
import { Grouping } from '../../dist/sequencer/grouping.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';
import { ALL8_FIGURE_START } from '../lib/all8-figures.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const grouping = new Grouping(seq.applicator ?? null);
const data = loadAll8Figures();

/** The spacing a set of (x,y) points is laid out at: the largest gap between any two of them. */
const spread = (pts) => {
  let m = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.max(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
};
const phys = (b) => b.dancers.filter((d) => !d.isGhost);

const cases = [];
for (const f of data.figures) {
  const calls = figureEngineCalls(f);
  let b = seq.boardForFormation(ALL8_FIGURE_START);
  for (let i = 0; i < calls.length; i++) {
    const r = seq.applyToBoard(b, calls[i]);
    if (!r.legal) {
      if (/No setup in this call matches/.test(r.reason ?? '')) cases.push({ fig: f.id, call: calls[i], board: b });
      break;
    }
    b = r.board;
  }
}

const rows = [];
for (const c of cases) {
  const sel = splitSelection(c.call);
  const variants = seq.variantStarts(sel.call);
  const boardPts = phys(c.board);
  const ids = sel.selection ? grouping.resolveSelection(c.board, sel.selection) : null;
  const groupPts = ids ? boardPts.filter((d) => ids.includes(d.id)) : null;
  const target = groupPts && groupPts.length >= 2 ? groupPts : boardPts; // the isolated reading's four, else the whole board
  const n = target.length;
  const vSizes = [...new Set(variants.map((v) => v.length))].sort((a, b) => a - b);
  const sameSize = variants.filter((v) => v.length === n);
  let verdict, detail;
  if (variants.length === 0) { verdict = 'UNKNOWN'; detail = 'the call has no variants at all'; }
  else if (sameSize.length === 0) {
    verdict = 'SIZE';
    detail = `board/selection has ${n} dancers; the call's setups are ${vSizes.join('/')}`;
  } else {
    const boardSpread = spread(target);
    const vSpreads = sameSize.map((v) => spread(v));
    const nearest = vSpreads.reduce((a, b) => (Math.abs(b - boardSpread) < Math.abs(a - boardSpread) ? b : a));
    const rel = boardSpread === 0 ? 1 : Math.abs(nearest - boardSpread) / boardSpread;
    if (rel > 0.25) { verdict = 'SCALE'; detail = `board spans ${boardSpread.toFixed(1)}, nearest same-size setup spans ${nearest.toFixed(1)} (${(rel * 100).toFixed(0)}% off)`; }
    else { verdict = 'ARRANGEMENT'; detail = `both span ~${boardSpread.toFixed(1)} but the layout differs`; }
  }
  rows.push({ ...c, verdict, detail, formation: seq.knownFormation(c.board) ?? '(unnamed)', sel: sel.selection || '(whole board)' });
}

console.log(`=== ${rows.length} figures stop with "no setup in this call matches the current formation" ===\n`);
const byVerdict = new Map();
for (const r of rows) byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);
for (const [v, n] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${v}`);

console.log('\n=== by call, with the verdict and what the failure actually is ===');
const byCall = new Map();
for (const r of rows) {
  const k = `${r.call}  [${r.verdict}]`;
  byCall.set(k, (byCall.get(k) ?? 0) + 1);
}
for (const [k, n] of [...byCall.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);

console.log('\n=== the detail line per distinct call ===');
const seen = new Set();
for (const r of rows) {
  if (seen.has(r.call)) continue;
  seen.add(r.call);
  console.log(`  ${r.call.padEnd(26)} ${r.verdict.padEnd(12)} from ${String(r.formation).padEnd(20)} selection ${r.sel}`);
  console.log(`      ${r.detail}`);
}
if (process.argv.includes('--all')) {
  console.log('\n=== every case ===');
  for (const r of rows) console.log(`  ${r.fig}  ${r.call.padEnd(24)} ${r.verdict.padEnd(12)} ${r.formation.padEnd(20)} ${r.detail}`);
}
