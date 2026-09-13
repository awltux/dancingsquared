// ANALYSIS TOOL (not a harness): is a `no setup matches` refusal a COVERAGE gap or a BODY error?
//
// The census ranks by the call that STOPPED, and that call can be entirely correct. `Pass Thru` is the
// worked example: its definition is "Starting formation: Facing Dancers", and four of the six figures
// that stop on it refuse because the board they hand it has NO TWO DANCERS FACING EACH OTHER - a board
// on which the call is not the call, so the fault is one call upstream. That is the class
// `setup-split.mjs` measures with a prefix scan; this is the cheaper one-line version of it, and it
// needs no tolerance and no chain replay:
//
//   * NO FACING PAIR  - no dancer has another directly in front. A `Facing Dancers` call cannot apply.
//   * COLLISION       - two dancers closer than `PROMENADE_COLLISION_MIN`, i.e. a body that fell apart.
//   * DIAGONAL        - facing pairs exist but not on the axes, which no square-dance formation uses.
//   * else            - the board looks well formed, so this one really is a coverage gap.
//
// Usage: node engine/test/tools/facing-audit.mjs                 (every `no setup matches` refusal)
//        node engine/test/tools/facing-audit.mjs "Pass Thru"     (just that call)
//        node engine/test/tools/facing-audit.mjs --list          (one line per figure)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
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

/** Dancers who have another dancer directly in front of them, within `tol` radians. */
function facingPairs(board, tol = 0.05) {
  const phys = board.dancers.filter((d) => !d.isGhost);
  const out = [];
  for (const a of phys) {
    for (const b of phys) {
      if (a.id === b.id) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.hypot(dx, dy) < 0.5) continue;
      let diff = Math.atan2(dy, dx) - a.heading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      if (Math.abs(diff) <= tol) out.push([a, b]);
    }
  }
  return out;
}

const closestPair = (board) => {
  const phys = board.dancers.filter((d) => !d.isGhost);
  let m = Infinity;
  for (let i = 0; i < phys.length; i++)
    for (let j = i + 1; j < phys.length; j++)
      m = Math.min(m, Math.hypot(phys[i].x - phys[j].x, phys[i].y - phys[j].y));
  return m;
};

/** Are the facings on the axes? A square-dance board faces N/S/E/W only. */
function offAxisFacings(board) {
  const phys = board.dancers.filter((d) => !d.isGhost);
  return phys.filter((d) => {
    const deg = ((d.heading * 180) / Math.PI) % 90;
    const off = Math.min(Math.abs(deg), Math.abs(Math.abs(deg) - 90));
    return off > 1;
  }).length;
}

const only = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? null;
const rows = [];
for (const f of data.figures) {
  const calls = figureEngineCalls(f);
  let board = start;
  let stop = null;
  for (let i = 0; i < calls.length; i++) {
    const r = seq.applyToBoard(board, calls[i]);
    if (!r.legal) { stop = { i, call: calls[i], reason: r.reason, board }; break; }
    board = r.board;
  }
  // The subject: every "no setup matches" refusal by default, or the one call named on the command line.
  if (!stop || !/^No setup in this call matches/.test(stop.reason ?? '')) continue;
  if (only && splitSelection(stop.call).call !== only) continue;
  const pairs = facingPairs(stop.board);
  const close = closestPair(stop.board);
  const off = offAxisFacings(stop.board);
  const verdict = close < 1.0 ? 'COLLISION'
    : pairs.length === 0 ? 'NO FACING PAIR'
      : off > 0 ? 'DIAGONAL'
        : 'coverage?';
  rows.push({ id: f.id, at: stop.i + 1, call: stop.call, board: seq.knownFormation(stop.board) ?? '(unnamed)', pairs: pairs.length, close, off, verdict });
}

if (process.argv.includes('--list')) {
  for (const r of rows) {
    console.log(`  ${r.id} #${r.at} ${r.call.padEnd(22)} [${r.board}] pairs=${r.pairs} closest=${r.close.toFixed(2)} offAxis=${r.off}  -> ${r.verdict}`);
  }
} else {
  const by = new Map();
  for (const r of rows) by.set(r.verdict, [...(by.get(r.verdict) ?? []), r.id]);
  console.log(`=== ${rows.length} figure(s), by the board they refuse on${only ? ` (${only})` : ''} ===`);
  for (const [v, ids] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(ids.length).padStart(3)}  ${v.padEnd(16)} ${ids.join(' ')}`);
  }
  console.log('\n(COLLISION / NO FACING PAIR / DIAGONAL are BODY errors - the fault is one call upstream.)');
}
