// PHASE A ANALYSIS TOOL (not a harness): where do All8's 188 published figures actually fail?
//
// `all8-figures.mjs` reports the stop CALLS; this attributes each one to a CAUSE and to the board it
// happened on, because the same call name fails for entirely different reasons (a catalogue tam
// missing a setup, a derived call refusing on a precondition, a selection that will not resolve, a
// scale the matcher will not accept). Ranking by cause is what decides the next phase; ranking by
// call name is what the target suite already does.
//
// The walk here applies each call and asks nothing in between - the convention the target suite and
// PLAN.md's baselines use (8 of 188 run). `tools/fsm-getout-audit.mjs` uses the other convention and
// reports 20; Phase 10 in PLAN.md is about why those differ.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, CODED_MOVES, findCodedMove } from '../../dist/index.js';
import { splitSelection } from '../../dist/sequencer/selection.js';
import { callsByTitle } from '../lib/engine-calls.mjs';
import { figureEngineCalls, loadAll8Figures, unreadCells } from '../lib/all8-figures.mjs';
import { ALL8_FIGURE_START } from '../lib/all8-figures.mjs';

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
const coded = new Set(CODED_MOVES.map((m) => m.name));

/** The owner of a refusal: which part of the engine has to change. */
function cause(call, reason) {
  if (!reason) return 'other';
  if (/^Unknown call/.test(reason)) return 'unknown call (no catalogue entry)';
  const base = splitSelection(call).call;
  const move = findCodedMove(base);
  if (move) return `derived call refuses ("${base}")`;
  if (/^No setup in this call matches/.test(reason)) return 'catalogue tam has no setup for this board';
  if (/selection/i.test(reason)) return 'selection will not resolve on this board';
  if (/^Module/.test(reason)) return 'module';
  return `other: ${reason.slice(0, 60)}`;
}

const runs = [];
for (const f of data.figures) {
  const calls = figureEngineCalls(f);
  let board = start;
  let prev = null;
  let failed = null;
  for (let i = 0; i < calls.length; i++) {
    const r = seq.applyToBoard(board, calls[i]);
    if (!r.legal) { failed = { i, call: calls[i], reason: r.reason, formation: seq.knownFormation(board) }; break; }
    prev = board;
    board = r.board;
  }
  void prev;
  runs.push({ f, calls, failed });
}

const ran = runs.filter((r) => !r.failed);
console.log(`=== All8 figures: ${ran.length} of ${runs.length} run end-to-end ===\n`);

// ---- by CAUSE
const byCause = new Map();
for (const r of runs) {
  if (!r.failed) continue;
  const c = cause(r.failed.call, r.failed.reason);
  if (!byCause.has(c)) byCause.set(c, []);
  byCause.get(c).push(r);
}
console.log('=== figures blocked, by CAUSE ===');
for (const [c, rs] of [...byCause.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(rs.length).padStart(3)}  ${c}`);
}

// ---- by CALL and cause
const byCall = new Map();
for (const r of runs) {
  if (!r.failed) continue;
  const key = `${r.failed.call}  [${cause(r.failed.call, r.failed.reason)}]`;
  if (!byCall.has(key)) byCall.set(key, { n: 0, formations: new Map() });
  const e = byCall.get(key);
  e.n++;
  e.formations.set(r.failed.formation ?? '(unnamed)', (e.formations.get(r.failed.formation ?? '(unnamed)') ?? 0) + 1);
}
console.log('\n=== every blocking call, with its cause and the board it refused ===');
for (const [k, e] of [...byCall.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(e.n).padStart(3)}  ${k}`);
  for (const [fm, n] of [...e.formations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    console.log(`         from ${String(n).padStart(3)} x ${fm}`);
  }
}

// ---- the exact refusal sentences of the derived calls, which IS the specification of the fix
console.log('\n=== the derived calls\' own sentences, grouped ===');
for (const target of ['Swing Your Partner', 'Promenade', 'Trade', 'Swing Thru', 'Promenade Home']) {
  const rs = runs.filter((r) => r.failed && splitSelection(r.failed.call).call === target);
  if (!rs.length) continue;
  const reasons = new Map();
  for (const r of rs) {
    const key = String(r.failed.reason).replace(/\d+(\.\d+)?/g, 'N').slice(0, 110);
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  console.log(`  ${target} â€” ${rs.length} figure(s):`);
  for (const [k, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(3)}  ${k}`);
  }
}

// ---- how far each figure got
const depths = runs.filter((r) => r.failed).map((r) => r.failed.i);
console.log('\n=== how deep the blocked figures get ===');
console.log(`  blocked at call #1 (the board itself is unusable): ${depths.filter((d) => d === 0).length}`);
console.log(`  blocked at call #2-3:                              ${depths.filter((d) => d === 1 || d === 2).length}`);
console.log(`  blocked later (call #4+):                          ${depths.filter((d) => d >= 3).length}`);

// ---- decoder gaps, kept separate from engine gaps
const unread = unreadCells(data);
console.log(`\n=== the decoder's own gap (NOT an engine gap) ===`);
console.log(`  ${unread.length} unread call cells in the figure corpus`);
for (const u of unread.slice(0, 12)) console.log(`      ${u.figureId}  token ${JSON.stringify(u.token)}`);

// ---- the calls the figures exercise most, and whether the engine knows them
const freq = new Map();
for (const r of runs) for (const c of r.calls) freq.set(c, (freq.get(c) ?? 0) + 1);
console.log(`\n=== the 25 most-used calls in the corpus (figures), with their engine status ===`);
const status = (name) => {
  const variants = seq.variantStarts(name).length;
  if (coded.has(splitSelection(name).call) && variants === 0) return 'DERIVED only';
  if (variants === 0) return 'NOT KNOWN';
  return `${variants} variant setup(s)${coded.has(splitSelection(name).call) ? ' + derived' : ''}`;
};
for (const [c, n] of [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${String(n).padStart(3)}  ${c.padEnd(34)} ${status(c)}`);
}


