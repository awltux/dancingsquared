// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
﻿// PHASE A, the current blocked-and-poisoned queue: diagnose the entries the plan has NOT yet
// adjudicated. Reach alone is a superset (it counts figures that pass through a legitimately unnamed
// board, like the allemande pose or a Fold), so the queue is the INTERSECTION of "blocked" and
// "poisoned", which is 19 figures - the same 19 the plan records, but with five offenders still
// unadjudicated: Girls Run (2), Centers Swing Thru (2), Star Thru (1), All Fold (1), Centers Star
// Thru (1).
//
// This probe prints, for each of those figures, the call that minted the first unnamed board, the
// board itself, and the two questions Phase A asks of it:
//   - is the board GEOMETRICALLY valid (no two dancers on a spot, a real shape), and
//   - is the call that follows it actually unable to apply to a valid board (a coverage gap), or is
//     the board itself wrong (a body error)?
//
// Usage: node engine/test/tools/phase-a-queue-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../../dist/index.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { ALL8_FIGURE_START, figureEngineCalls, loadAll8Figures } from '../lib/all8-figures.mjs';
import { corpusRoot } from 'dancing-squared-corpus';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = corpusRoot();
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);

const data = loadAll8Figures();
const byId = new Map(data.figures.map((f) => [f.id, f]));

const FACING = { 90: 'S', '-90': 'N', 0: 'E', 180: 'W' };
const dir = (d) => {
  const deg = Math.round(((d.heading * 180) / Math.PI + 360) % 360);
  return deg === 270 ? 'S' : deg === 90 ? 'N' : deg === 0 ? 'E' : 'W';
};
const pose = (b) => [...b.dancers]
  .sort((a, c) => (c.y - a.y) || (a.x - c.x))
  .map((d) => `#${d.id}${d.gender[0]}(${d.x.toFixed(1)},${d.y.toFixed(1)})${dir(d)}`)
  .join(' ');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Closest pair on a board, and any pair closer than 1.0 (the collision threshold the audit uses). */
function geometry(board) {
  let closest = Infinity;
  for (let i = 0; i < board.dancers.length; i++) {
    for (let j = i + 1; j < board.dancers.length; j++) closest = Math.min(closest, dist(board.dancers[i], board.dancers[j]));
  }
  return closest;
}

/** Walk a figure until the first board the engine cannot name; report the minting call and the stop. */
function firstUnnamed(id) {
  const fig = byId.get(id);
  if (!fig) return null;
  const calls = figureEngineCalls(fig);
  let board = seq.boardForFormation(ALL8_FIGURE_START) ?? seq.startBoard();
  let mintedBy = '(start)';
  for (const c of calls) {
    const r = seq.applyToBoard(board, c);
    if (!r.legal) return { id, mintedBy, board, stopCall: c, stopReason: r.reason, named: seq.knownFormation(board) };
    board = r.board;
    if (seq.knownFormation(board) === null) {
      // the next call is the one that will be asked to run on it
      const k = calls.indexOf(c);
      const next = calls[k + 1];
      const nr = next ? seq.applyToBoard(board, next) : null;
      return {
        id, mintedBy: c, board, named: null,
        stopCall: next ?? '(end)',
        stopReason: nr && !nr.legal ? nr.reason : null,
        nextLegal: nr ? nr.legal : null,
      };
    }
  }
  return { id, mintedBy, board, named: seq.knownFormation(board), stopCall: '(end)', stopReason: null };
}

const QUEUE = ['figm24', 'figm216', 'figm65', 'figm212', 'figm92', 'figm136', 'figm174'];
for (const id of QUEUE) {
  const r = firstUnnamed(id);
  if (!r) { console.log(`${id}: not found`); continue; }
  const g = geometry(r.board);
  console.log(`\n${id}`);
  console.log(`   first unnamed board minted by : ${r.mintedBy}`);
  console.log(`   board                        : ${pose(r.board)}`);
  console.log(`   closest pair                 : ${g.toFixed(2)}${g < 1.0 ? '  <- COLLISION' : ''}`);
  console.log(`   the next call                : ${r.stopCall}  ${r.stopReason ? `-> ${r.stopReason}` : '(legal)'}`);
}


