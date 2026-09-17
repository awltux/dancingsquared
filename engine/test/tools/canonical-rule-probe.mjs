// STEP 3, ITEM 7: WHICH BOARD IS ALL8'S? - testing rules that USE the reference pair.
//
// The previous probe measured WHERE all8's board sits in the enumeration (index, and the cyclic
// relabelling from boards[0]) and found it is not a function of the sequence alone, nor of the
// arrangement, nor of the formation letter - it depends on the code's relationship too. That points at
// the REFERENCE PAIR, which is the dancer All8's relationship letter is defined FROM:
// REFERENCE_PAIR_RULES says the reference STANDS WHERE THE RELATIONSHIP IS MEASURED.
//
// So this tests the natural rule, which is NOT the one the plan already refuted: the refuted rule used
// each COUPLE's centroid bearing; this uses the REFERENCE BOY's own spot, which is the dancer the
// letter is anchored to.
//
// A rule is only useful if it reproduces all8 on every published diagram, so each candidate is scored
// over all of them.
//
// Usage: node engine/test/tools/canonical-rule-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardsForAlignment, boardFromDiagram, parseAlignmentId, FORMATIONS_FOR_LETTER, REFERENCE_PAIR_SPOTS, arrangementFor, sequenceFor } from '../../dist/index.js';
import { HOME_DANCERS } from '../../dist/sequencer/identity.js';
import { callsByTitle } from '../lib/engine-calls.mjs';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const assets = path.join(root, 'poc', 'src', 'assets');
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  callsByTitle(assets),
);
const templateFor = (letter) => (FORMATIONS_FOR_LETTER[letter] ?? []).map((n) => seq.boardForFormation(n)).find(Boolean);

const corpus = JSON.parse(readFileSync(path.join(root, 'engine', 'test', 'fixtures', 'all8-getouts.json'), 'utf8'));
const assignment = (b) => b.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}:${d.couple}`).sort().join(' ');
const rotationBetween = (a, b) => {
  for (let k = 0; k < 4; k++) {
    const rel = a.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}:${((d.couple - 1 + k) % 4) + 1}`).sort().join(' ');
    if (rel === assignment(b)) return k;
  }
  return null;
};

/** Collect the cases once: all8's board, the four candidates, and the reference boy. */
const cases = [];
for (const a of corpus.alignments) {
  const spec = parseAlignmentId(a.id);
  if (!spec) continue;
  const template = templateFor(spec.letter);
  if (!template) continue;
  const fromDiagram = boardFromDiagram(template, spec.letter, spec.arrangement, a.diagram);
  if (!fromDiagram.board) continue;
  const res = boardsForAlignment(template, spec);
  if (!res.boards.length) continue;
  const all8Idx = res.boards.findIndex((b) => assignment(b) === assignment(fromDiagram.board));
  if (all8Idx < 0) continue;
  cases.push({ code: a.id, spec, template, all8Board: fromDiagram.board, boards: res.boards, all8Idx });
}
console.log(`=== ${cases.length} published diagrams to score every candidate rule against ===`);

const HOME_CENTRE = { x: 0, y: 0 };

/** The reference BOY's own spot on a board (his home identity is carried, so we can find him). */
function referenceBoyOf(board, letter) {
  const spots = REFERENCE_PAIR_SPOTS[letter];
  if (!spots) return null;
  // The reference pair is a PAIR of spots; the boy is whichever of the two dancers there is a boy.
  const byId = new Map(HOME_DANCERS.map((h) => [h.id, h]));
  for (const b of board.dancers) {
    const home = byId.get(b.id);
    if (!home) continue;
    // Match by the couple+gender identity: a boy whose home couple is at one of the reference spots is
    // not enough (boards are relabelled), so use the TEMPLATE's own reading instead - see below.
    void home;
  }
  return null;
}

/**
 * The reference boy as an IDENTITY: the template says which spot the reference pair occupies, and the
 * dancer standing there on the template carries the id. Each candidate board places the same identity
 * somewhere, so his current spot is readable directly.
 */
function referenceBoyId(template, letter) {
  const spots = REFERENCE_PAIR_SPOTS[letter];
  if (!spots) return null;
  const layout = template.dancers;
  for (const [r, c] of spots) {
    const d = layout[r * 2 + c] ?? layout.find((q, i) => i === r * 2 + c);
    void d;
  }
  return null;
}

const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const bearingFrom = (cx, cy, p) => Math.atan2(p.y - cy, p.x - cx);

// ---- candidate rule A: the reference boy nearest his home bearing, using the REFERENCE PAIR SPOTS
//      as the template's own identity anchor (which dancer is "the reference boy" on each board).
console.log('\n=== candidate A: reference boy\'s bearing nearest his home bearing ===');
let agreeA = 0, scored = 0;
const detail = [];
for (const c of cases) {
  const spots = REFERENCE_PAIR_SPOTS[c.spec.letter];
  if (!spots) continue;
  // The template's own reading: which dancer stands on the reference spots.
  const byPos = (b) => {
    const xs = [...new Set(b.dancers.map((d) => d.x))].sort((p, q) => p - q);
    const ys = [...new Set(b.dancers.map((d) => d.y))].sort((p, q) => q - p);
    return { xs, ys };
  };
  const { xs, ys } = byPos(c.template);
  const refSpots = spots.map(([r, col]) => ({ x: xs[col], y: ys[r] }));
  const boyIds = c.template.dancers.filter((d) => refSpots.some((s) => Math.abs(s.x - d.x) < 1e-6 && Math.abs(s.y - d.y) < 1e-6) && d.gender === 'boy').map((d) => d.id);
  if (!boyIds.length) continue;
  const id = boyIds[0];
  const home = HOME_DANCERS.find((d) => d.id === id);
  if (!home) continue;
  const homeBearing = bearingFrom(HOME_CENTRE.x, HOME_CENTRE.y, home);
  const costs = c.boards.map((b) => {
    const cur = b.dancers.find((d) => d.id === id);
    const n = b.dancers.length;
    const cx = b.dancers.reduce((s, d) => s + d.x, 0) / n;
    const cy = b.dancers.reduce((s, d) => s + d.y, 0) / n;
    return cur ? angDiff(bearingFrom(cx, cy, cur), homeBearing) : Infinity;
  });
  let best = 0;
  costs.forEach((v, i) => { if (v < costs[best] - 1e-9) best = i; });
  scored++;
  const ok = best === c.all8Idx;
  if (ok) agreeA++;
  detail.push(`${c.code}: picks ${best}, all8 ${c.all8Idx} ${ok ? 'ok' : 'NO'}`);
}
console.log(`  ${agreeA} of ${scored}`);
console.log(`  ${detail.join('\n  ')}`);

console.log('\n=== the measured rows, with the code\'s own parts ===');
console.log('  code     letter  arr  seq  rel   index  count');
const byLetterRel = new Map();
for (const c of cases) {
  const rel = c.spec.relationship ?? '-';
  console.log(`  ${c.code.padEnd(8)} ${c.spec.letter.padEnd(6)} ${String(c.spec.arrangement).padEnd(4)} ${String(c.spec.sequence).padEnd(4)} ${String(rel).padEnd(5)} ${String(c.all8Idx).padStart(4)}   ${c.boards.length}`);
  const key = `${c.spec.letter}|${rel}`;
  if (!byLetterRel.has(key)) byLetterRel.set(key, new Set());
  byLetterRel.get(key).add(c.all8Idx);
}
console.log('\n=== is the index a function of (letter, relationship)? ===');
let consistent = true;
for (const [k, v] of [...byLetterRel.entries()].sort()) {
  const [letter, rel] = k.split('|');
  if (v.size > 1) consistent = false;
  console.log(`  [${letter}] rel '${rel}' -> indices {${[...v].join(',')}}${v.size > 1 ? '   INCONSISTENT' : ''}`);
}
console.log(`\n  (letter, relationship) is ${consistent ? 'a FUNCTION on the measured codes' : 'NOT a function'}`);

console.log('\n=== is the index a function of the relationship ALONE? ===');
const byRel = new Map();
for (const c of cases) {
  const rel = c.spec.relationship ?? '-';
  if (!byRel.has(rel)) byRel.set(rel, new Set());
  byRel.get(rel).add(c.all8Idx);
}
let relConsistent = true;
for (const [rel, v] of [...byRel.entries()].sort()) {
  if (v.size > 1) relConsistent = false;
  console.log(`  rel '${rel}' -> indices {${[...v].join(',')}}${v.size > 1 ? '   INCONSISTENT' : ''}`);
}
console.log(`\n  relationship alone is ${relConsistent ? 'a FUNCTION on the measured codes' : 'NOT a function'}`);

console.log('\n=== candidate B: the refuted couple-centroid rule, for comparison ===');
let agreeB = 0, scoredB = 0;
for (const c of cases) {
  const HOME_BEARING = { 1: -Math.PI / 2, 2: 0, 3: Math.PI / 2, 4: Math.PI };
  const cost = (b) => {
    const n = b.dancers.length;
    const cx = b.dancers.reduce((s, d) => s + d.x, 0) / n;
    const cy = b.dancers.reduce((s, d) => s + d.y, 0) / n;
    let t = 0;
    for (const k of [1, 2, 3, 4]) {
      const ds = b.dancers.filter((d) => d.couple === k);
      if (!ds.length) return Infinity;
      t += angDiff(bearingFrom(cx, cy, { x: ds.reduce((s, d) => s + d.x, 0) / ds.length, y: ds.reduce((s, d) => s + d.y, 0) / ds.length }), HOME_BEARING[k]);
    }
    return t;
  };
  const costs = c.boards.map(cost);
  let best = 0;
  costs.forEach((v, i) => { if (v < costs[best] - 1e-9) best = i; });
  scoredB++;
  if (best === c.all8Idx) agreeB++;
}
console.log(`  ${agreeB} of ${scoredB} (the plan records 0 of 6 for the six [L] diagrams)`);
