// TIER: none — one-shot diagnostic; nothing runs it. Recorded: PLAN.md.
// IS THE FASR CODE UNDER-DETERMINED, AND IS `boards[0]` AN ARBITRARY PICK?
//
// The report: Taminations indexes dancers incrementally, and the engine may have assumed that the
// formation's indexing aligns with dancer indexing at setup. At setup the FASR properties should place
// the dancers, not the index.
//
// The suspect is `boardForAlignment`, which is documented as returning "the first board in the
// requested alignment" - and `boardsForAlignment` above it says it enumerates the whole alignment
// space "rather than one guess at it". If a spec admits MORE than one board, then `boards[0]` is a
// guess, and nothing in the code says which one all8's diagram would be.
//
// This measures, for every letter and code:
//   how many boards the spec admits            (1 = determined, >1 = a coin toss)
//   whether the TEMPLATE'S ARRAY ORDER changes the set or the pick
//   whether all8's own diagram for [L1p] is even in the set
//
// Usage: node engine/test/tools/fasr-determinism-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { normAngle,  Sequencer, setParser, boardsForAlignment, boardForAlignment, parseAlignmentId, arrangementFor, analyzeFasr } from '../../dist/index.js';
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

const TEMPLATE = { B: 'Eight Chain Thru', L: 'Normal Lines', W: 'Ocean Waves', P: 'Double Pass Thru', F: 'Two-Faced Lines', 'L.F': 'Two-Faced Lines LH' };

/** A board as a position -> couple map, so two boards can be compared regardless of array order. */
const shape = (b) => b.dancers
  .map((d) => `${d.couple === 0 ? '-' : d.couple}${d.gender === 'boy' ? 'B' : 'G'}@${d.x},${d.y}`)
  .sort()
  .join(' ');

console.log('=== (A) HOW MANY BOARDS DOES EACH CODE ADMIT? ===');
console.log('  a code that admits more than one board is not a specification of a board\n');
for (const [letter, formation] of Object.entries(TEMPLATE)) {
  const template = seq.boardForFormation(formation);
  if (!template) continue;
  for (const seqNo of [1, 2]) {
    for (const rl of ['p', 'c', 'o', 'r']) {
      const code = `${letter}${seqNo}${rl}`;
      const spec = parseAlignmentId(code);
      if (!spec) continue;
      const res = boardsForAlignment(template, spec);
      if (res.boards.length === 0) { console.log(`  ${code.padEnd(6)} 0 boards  (${res.reason ?? ''})`); continue; }
      const shapes = new Set(res.boards.map(shape));
      console.log(`  ${code.padEnd(6)} ${String(res.boards.length).padStart(3)} board(s), ${shapes.size} distinct shape(s) of ${res.attempted} assignments${res.boards.length > 1 ? '   <- UNDETERMINED' : ''}`);
    }
  }
}

// ---------------------------------------------------------------- (B) does the TEMPLATE's array order matter?
console.log('\n=== (B) DOES THE TEMPLATE\'S ARRAY ORDER CHANGE THE ANSWER? ===');
console.log('  the template is the FORMATION, whose dancers carry ids by ARRAY INDEX (boardFromMatchables)');
console.log('  if permuting that array changes the boards, the index is being used as identity\n');
{
  const template = seq.boardForFormation('Normal Lines');
  const perms = {
    'as authored': template,
    'reversed': { dancers: [...template.dancers].reverse() },
    'rotated by 3': { dancers: [...template.dancers.slice(3), ...template.dancers.slice(0, 3)] },
  };
  for (const code of ['L1p', 'L1o']) {
    const spec = parseAlignmentId(code);
    console.log(`  ${code}:`);
    for (const [label, t] of Object.entries(perms)) {
      const res = boardsForAlignment(t, spec);
      const pick = res.boards[0];
      console.log(`    ${label.padEnd(14)} ${String(res.boards.length).padStart(3)} board(s), boards[0] = ${pick ? shape(pick) : 'none'}`);
    }
  }
}

// ---------------------------------------------------------------- (C) is all8's [L1p] in the set?
console.log('\n=== (C) IS ALL8\'S OWN [L1p] EVEN IN THE SET? ===');
console.log('  all8 getoutd.htm draws [L1p] as (facing pairs, row by row):');
console.log('      3> <2      so the FACING couple-pairs are {2,3} and {1,4}');
console.log('      3> <2      and every dancer stands beside their partner');
console.log('      4> <1');
console.log('      4> <1\n');
{
  const template = seq.boardForFormation('Normal Lines');
  const spec = parseAlignmentId('L1p');
  const res = boardsForAlignment(template, spec);
  // Which boards in the SET have facing couple-pairs {2,3} and {1,4}?
  const ahead = (b, d) => {
    const hx = Math.cos(d.heading), hy = Math.sin(d.heading);
    let best = null;
    for (const o of b.dancers) {
      if (o.id === d.id) continue;
      const dx = o.x - d.x, dy = o.y - d.y, dist = Math.hypot(dx, dy);
      if (dist < 0.5 || (dx * hx + dy * hy) / dist < 0.99) continue;
      if (!best || dist < best.dist) best = { o, dist };
    }
    return best?.o ?? null;
  };
  const pairsOf = (b) => {
    const s = new Set();
    for (const d of b.dancers) { const o = ahead(b, d); if (o) s.add([d.couple, o.couple].sort().join('-')); }
    return [...s].sort().join(' ');
  };
  const partnersAdjacent = (b) => b.dancers.every((d) => {
    const p = b.dancers.find((o) => o.couple === d.couple && o.id !== d.id);
    return p ? Math.abs(Math.hypot(p.x - d.x, p.y - d.y) - 2) < 0.35 : false;
  });
  const all8 = res.boards.filter((b) => pairsOf(b) === '1-4 2-3' && partnersAdjacent(b));
  console.log(`  ${res.boards.length} board(s) admit [L1p]; ${all8.length} of them have all8's {2,3}/{1,4} facing pairs AND partners adjacent`);
  console.log(`  boards[0] (what boardForAlignment returns) has pairs: ${pairsOf(res.boards[0])}, partners adjacent: ${partnersAdjacent(res.boards[0])}`);
  if (all8.length) {
    console.log(`  all8's board IS in the set. One of them:`);
    console.log(`    ${shape(all8[0])}`);
    console.log(`  and boards[0] is:`);
    console.log(`    ${shape(res.boards[0])}`);
  }

  // ------------------------------------------------------------ (D) WHAT ARE THE 4, EXACTLY?
  // If they are related by a CYCLIC RELABELLING of the couples then the freedom the code leaves is
  // the whole-set rotation - which all8's own fasr.htm calls ORIENTATION and says is needed on top of
  // FASR to resolve "at home": "FASR alone" is not Total FASR.
  console.log('\n=== (D) ARE THE 4 BOARDS THE 4 ORIENTATIONS? ===');
  console.log('  relabel every couple c -> c+1 (mod 4) and see whether the result is another admitted board\n');
  const relabel = (b, k) => shape({ dancers: b.dancers.map((d) => ({ ...d, couple: ((d.couple - 1 + k) % 4) + 1 })) });
  const set = new Set(res.boards.map(shape));
  for (const [label, k] of [['+1', 1], ['+2', 2], ['+3', 3]]) {
    console.log(`  boards[0] relabelled by ${label}: ${set.has(relabel(res.boards[0], k)) ? 'IS another admitted board' : 'is NOT admitted'}`);
  }
  console.log(`  so the set is ${set.size} boards, i.e. the ORIENTATIONS of one board rather than 4 unrelated ones`);
}

// ---------------------------------------------------------------- (E) THE FOUR, RENDERED AS ALL8 DRAWS THEM
//
// all8's getoutd.htm prints [L1p] as two columns of four, each dancer as <couple><facing>:
//
//     3> <2
//     3> <2
//     4> <1
//     4> <1
//
// Printing the four admitted boards the same way says which one the page means, without anyone having
// to translate coordinates by hand.
console.log('\n=== (E) THE FOUR BOARDS FOR [L1p], DRAWN AS ALL8 DRAWS THEM ===');
{
  const FACE = ['>', '^', '<', 'v'];
  const faceChar = (h) => FACE[((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4];
  /** all8's two-column rendering: lines sorted by x, dancers within a line top to bottom. */
  const draw = (b) => {
    const cols = new Map();
    for (const d of b.dancers) {
      const key = d.x.toFixed(3);
      if (!cols.has(key)) cols.set(key, []);
      cols.get(key).push(d);
    }
    const lines = [...cols.entries()].sort((a, c) => Number(a[0]) - Number(c[0])).map(([, ds]) => ds.sort((a, c) => c.y - a.y));
    const rows = [];
    for (let r = 0; r < 4; r++) rows.push(lines.map((l) => `${l[r].couple}${faceChar(l[r].heading)}`).join(' '));
    return rows;
  };
  const template = seq.boardForFormation('Normal Lines');
  const spec = parseAlignmentId('L1p');
  const res = boardsForAlignment(template, spec);
  const ALL8 = ['3> <2', '3> <2', '4> <1', '4> <1'];
  // all8 puts the arrow on the INSIDE of each column (`3> <2`), the renderer here puts it after the
  // couple, so normalise every token to couple-then-facing before comparing.
  const norm = (s) => s
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => (/^[><^v]/.test(tok) ? tok.slice(1) + tok[0] : tok))
    .join(' ');
  const key = (rows) => rows.map(norm).join(' | ');
  console.log(`  all8 getoutd.htm says:   ${key(ALL8)}`);
  console.log('  the four the engine admits, in the order it enumerates them:');
  res.boards.forEach((b, i) => {
    const rows = draw(b);
    const match = key(rows) === key(ALL8);
    console.log(`    [${i}]${i === 0 ? ' <- boards[0], what boardForAlignment returns' : '                                                  '} ${key(rows)}${match ? "   *** THIS IS ALL8'S ***" : ''}`);
  });
  const idx = res.boards.findIndex((b) => key(draw(b)) === key(ALL8));
  console.log(`\n  all8's canonical board is at index ${idx} of ${res.boards.length}; boardForAlignment returns index 0.`);
}

// ---------------------------------------------------------------- (F) DOES THE CANDIDATE RULE REPRODUCE ALL8?
//
// One formation is not evidence. all8's getoutd.htm publishes SIX [L] diagrams, so the candidate rule
// - "the canonical board is the one that puts each couple on the side of the formation nearest its home
// position", i.e. orientation 0 - can be tested against all six rather than guessed from one.
//
// The decision from the report is that all8 is the authority where it and the Taminations-derived data
// disagree, so the rule has to REPRODUCE all8, not merely be plausible.
console.log('\n=== (F) DOES THE ORIENTATION RULE REPRODUCE ALL8 ON EVERY PUBLISHED [L] DIAGRAM? ===\n');

// Transcribed from all8 getoutd.htm, [L] section, exactly as printed.
const ALL8_L = {
  L1p: ['3> <2', '3> <2', '4> <1', '4> <1'],
  L2p: ['4> <1', '4> <1', '3> <2', '3> <2'],
  L4r: ['1> <1', '2> <2', '4> <4', '3> <3'],
  L3c: ['2> <2', '1> <1', '3> <3', '4> <4'],
  '5L1p': ['3> <2', '3> <2', '4> <1', '4> <1'],
  '5L2p': ['4> <1', '4> <1', '3> <2', '3> <2'],
};

{
  const FACE = ['>', '^', '<', 'v'];
  const faceChar = (h) => FACE[((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4];
  const norm = (s) => s.split(/\s+/).filter(Boolean).map((t) => (/^[><^v]/.test(t) ? t.slice(1) + t[0] : t)).join(' ');
  const key = (rows) => rows.map(norm).join(' | ');
  const draw = (b) => {
    const cols = new Map();
    for (const d of b.dancers) {
      const k = d.x.toFixed(3);
      if (!cols.has(k)) cols.set(k, []);
      cols.get(k).push(d);
    }
    const lines = [...cols.entries()].sort((a, c) => Number(a[0]) - Number(c[0])).map(([, ds]) => ds.sort((a, c) => c.y - a.y));
    const rows = [];
    for (let r = 0; r < 4; r++) rows.push(lines.map((l) => `${l[r].couple}${faceChar(l[r].heading)}`).join(' '));
    return rows;
  };

  // HOME_DANCERS: couple 3 north, 2 east, 1 south, 4 west.
  const HOME_BEARING = { 1: -Math.PI / 2, 2: 0, 3: Math.PI / 2, 4: Math.PI };
  const angDiff = (a, b) => Math.abs(normAngle(a - b));
  /** Orientation cost: how far each couple's centroid bearing is from its home bearing. Lower = more home-like. */
  const orientationCost = (b) => {
    const n = b.dancers.length;
    const cx = b.dancers.reduce((s, d) => s + d.x, 0) / n;
    const cy = b.dancers.reduce((s, d) => s + d.y, 0) / n;
    let cost = 0;
    for (const c of [1, 2, 3, 4]) {
      const ds = b.dancers.filter((d) => d.couple === c);
      if (!ds.length) return Infinity;
      const bx = ds.reduce((s, d) => s + d.x, 0) / ds.length - cx;
      const by = ds.reduce((s, d) => s + d.y, 0) / ds.length - cy;
      cost += angDiff(Math.atan2(by, bx), HOME_BEARING[c]);
    }
    return cost;
  };

  const template = seq.boardForFormation('Normal Lines');
  let agree = 0, total = 0;
  console.log('  code    all8 index   rule index   rule picks all8?');
  for (const [code, rows] of Object.entries(ALL8_L)) {
    const spec = parseAlignmentId(code);
    if (!spec) { console.log(`  ${code.padEnd(7)} not a parseable code`); continue; }
    const res = boardsForAlignment(template, spec);
    if (!res.boards.length) { console.log(`  ${code.padEnd(7)} 0 boards admitted`); continue; }
    const all8Idx = res.boards.findIndex((b) => key(draw(b)) === key(rows));
    // The rule's pick: lowest orientation cost (ties broken by enumeration order).
    let bestIdx = 0, bestCost = Infinity;
    res.boards.forEach((b, i) => { const c = orientationCost(b); if (c < bestCost - 1e-9) { bestCost = c; bestIdx = i; } });
    total++;
    const ok = all8Idx >= 0 && bestIdx === all8Idx;
    if (ok) agree++;
    console.log(`  ${code.padEnd(7)} ${String(all8Idx).padStart(10)}   ${String(bestIdx).padStart(10)}   ${ok ? 'yes' : 'NO'}`);
  }
  console.log(`\n  the orientation rule reproduces all8 on ${agree} of ${total} published [L] diagrams`);
  console.log(`  (${total < 6 ? 'some codes admitted no boards' : 'all six'})`);
}
