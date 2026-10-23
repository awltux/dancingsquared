// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
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
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { splitSelection } from '../../dist/sequencer/selection.js';
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

/**
 * Pairs of dancers who FACE EACH OTHER: opposite headings, each standing on the other's facing axis.
 *
 * This is NOT what `facingPairs` above measures. That one asks "has this dancer got someone directly in
 * front", which a TANDEM satisfies — both face the same way and one stands behind the other. Measured
 * on the canonical `Completed Double Pass Thru`: SIX calls (`Star Thru`, `Square Thru 3`, `Swing Thru`,
 * `Tag the Line`, `Square Thru 4`, `Pass Thru`) all refuse it, and the audit had reported the figures
 * that reach it as `coverage?` with `pairs = 4`, because a CDPT has no mutual facing at all — only
 * tandems. A `Facing Dancers` call cannot apply to such a board, so those rows are BODY errors.
 *
 * NOTE this column is still not a classification on its own: a call like `Tag the Line` legally starts
 * from `Lines Facing Out`, where nobody faces anybody either. `mutual = 0` is decisive only for a call
 * whose definition names Facing Dancers, which this tool does not model — so the column is DATA for the
 * reader and the one-way inference stays with the `NO FACING PAIR` verdict.
 */
function mutualFaces(board) {
  const phys = board.dancers.filter((d) => !d.isGhost);
  const faces = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 0.5) return false;
    let diff = Math.atan2(dy, dx) - a.heading;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return Math.abs(diff) <= 0.05;
  };
  let n = 0;
  for (let i = 0; i < phys.length; i++)
    for (let j = i + 1; j < phys.length; j++)
      if (faces(phys[i], phys[j]) && faces(phys[j], phys[i])) n++;
  return n;
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

/**
 * Couples whose two dancers are more than `gap` apart.
 *
 * This is NOT an error on its own - the corpus's legitimate pre-Promenade boards have partners six
 * apart, as a wave does, which is why `promenade.mjs` may not require partners to be together. It IS
 * an error when the board is one the engine NAMES as a formation whose couples stand side by side, and
 * that is the measured case below: `Allemande Left` refuses on a board named **Static Square** whose
 * every couple has its partners six apart, one dancer at the north side and the other at the south.
 */
function splitCouples(board, gap = 3) {
  const phys = board.dancers.filter((d) => !d.isGhost);
  const byCouple = new Map();
  for (const d of phys) {
    if (!d.couple) continue;
    byCouple.set(d.couple, [...(byCouple.get(d.couple) ?? []), d]);
  }
  let n = 0;
  for (const list of byCouple.values()) {
    if (list.length !== 2) continue;
    if (Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) > gap) n++;
  }
  return n;
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
  const named = seq.knownFormation(stop.board) ?? '(unnamed)';
  const split = splitCouples(stop.board);
  const mutual = mutualFaces(stop.board);
  const verdict = close < 1.0 ? 'COLLISION'
    : pairs.length === 0 ? 'NO FACING PAIR'
      : off > 0 ? 'DIAGONAL'
        : (split > 0 && named === 'Static Square') ? 'SPLIT COUPLES'
          : 'coverage?';
  rows.push({ id: f.id, at: stop.i + 1, call: stop.call, board: named, pairs: pairs.length, mutual, close, off, split, verdict });
}

if (process.argv.includes('--list')) {
  for (const r of rows) {
    console.log(`  ${r.id} #${r.at} ${r.call.padEnd(22)} [${r.board}] pairs=${r.pairs} closest=${r.close.toFixed(2)} offAxis=${r.off} split=${r.split} mutual=${r.mutual}  -> ${r.verdict}`);
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
