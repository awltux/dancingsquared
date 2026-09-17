// STEP 3, ITEM 7, SECOND SOURCE: all8's "16 Possible Pairings" pages, as identity-carrying boards.
//
// The canonical-board rule measured on the get-out corpus - the cyclic relabelling from boards[0] to
// all8's own board is a function of the SEQUENCE (1 -> +3, 2 -> +2, 3/4 -> +0) - rests on ONE corpus of
// 26 alignments. These pages are an independent source: every state's cell prints its FASR label and
// eight <img> tiles whose alt is "<gender><facing><couple>" ("Gv3" = girl, facing south, couple 3).
//
// HOW A CELL BECOMES A BOARD. The page lays the 8 tiles out in document order, and the tile's own
// gender tells us which of the template's spots can hold it: for a state whose arrangement the label
// fixes, the board's gender-per-spot pattern is known, so the document order is solved against that
// pattern rather than assumed. What this cannot fix is the OVERALL rotation of the reading; that is
// exactly what is being measured, so the solution is reported as "the board equals the template's
// arrangement-0 reading under relabelling +k", which is rotation-free.
//
// Usage: node engine/test/tools/sixteen-states-board-probe.mjs   (network needed)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser, boardsForAlignment, parseAlignmentId, arrangementFor, sequenceFor, FORMATIONS_FOR_LETTER, ARRANGEMENT_TABLES, ARRANGEMENT_NUMBER_ORDER } from '../../dist/index.js';
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
const templateFor = (letter) => {
  for (const n of FORMATIONS_FOR_LETTER[letter] ?? []) {
    const b = seq.boardForFormation(n);
    if (b) return b;
  }
  return null;
};

const FACE = { '>': 0, '^': 90, '<': 180, v: 270 };
const DEG = Math.PI / 180;
const HOME_ID = { '1boy': 5, '1girl': 6, '2boy': 3, '2girl': 4, '3boy': 1, '3girl': 2, '4boy': 7, '4girl': 8 };

/** Every state cell on a page: its FASR label, its hint, and the tiles in document order. */
function statesOf(html) {
  const out = [];
  // A state cell is one <td> containing a bracketed label, a hint, and 8 tiles.
  for (const m of html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    const body = m[1];
    const alt = [...body.matchAll(/alt="([^"]+)"/g)].map((a) => a[1]);
    if (alt.length !== 8) continue;
    const label = (body.match(/\[([0-5]?[A-Za-z.]{1,3}[1-4]?[pocr]?)\]/) ?? [])[1];
    if (!label) continue;
    const hint = (body.match(/<\/font><\/b>\s*<font size=-1>([^<]*)/) ?? [])[1] ?? '';
    out.push({ label, hint: hint.replace(/&nbsp;/g, ' ').trim(), alt });
  }
  return out;
}

const token = (t) => {
  const m = /^([v^<>])?([BG])(\d)([v^<>])?$/.exec(t);
  if (!m) return null;
  const facing = m[1] ?? m[4];
  return facing ? { gender: m[2] === 'B' ? 'boy' : 'girl', heading: FACE[facing] * DEG, couple: Number(m[3]) } : null;
};

/**
 * Solve the page's document order against the engine template's spot order for this arrangement.
 * The template's spots sorted the way the page reads them (top row first, left to right) is what is
 * tried; the gender sequence of the arrangement's own table picks the correct alignment.
 */
function boardsFromTiles(template, letter, arrangement, tiles) {
  const table = ARRANGEMENT_TABLES[letter];
  const column = ARRANGEMENT_NUMBER_ORDER.indexOf(arrangement);
  if (!table || column < 0) return [];
  const toks = tiles.map(token);
  if (toks.some((t) => !t)) return [];
  // The template's spots, in the page's reading order (row-major, top row first, left to right).
  const spots = [...template.dancers].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const wantGender = [];
  table.forEach((row) => [...row.facing].forEach((f, c) => { if (f !== '.') wantGender.push(row.genders[column][c] === 'B' ? 'boy' : 'girl'); }));
  // The tiles' gender sequence must equal the arrangement's, up to a CYCLIC rotation.
  const got = toks.map((t) => t.gender);
  const rotations = [];
  for (let k = 0; k < 8; k++) {
    const rot = [...got.slice(k), ...got.slice(0, k)];
    if (rot.join() === wantGender.join()) rotations.push(k);
  }
  const out = [];
  for (const k of rotations) {
    const dancers = [];
    for (let i = 0; i < 8; i++) {
      const t = toks[(i + k) % 8];
      const s = spots[i];
      dancers.push({ id: HOME_ID[`${t.couple}${t.gender}`], couple: t.couple, gender: t.gender, x: s.x, y: s.y, heading: s.heading });
    }
    out.push({ dancers });
  }
  return out;
}

const assignment = (b) => b.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}:${d.couple}:${d.gender}`).sort().join(' ');
const rotationBetween = (a, b) => {
  for (let k = 0; k < 4; k++) {
    const rel = a.dancers.map((d) => `${d.x.toFixed(2)},${d.y.toFixed(2)}:${((d.couple - 1 + k) % 4) + 1}:${d.gender}`).sort().join(' ');
    if (rel === assignment(b)) return k;
  }
  return null;
};

const CORPUS_RULE = { 1: 3, 2: 2, 3: 0, 4: 0 };

// --dump prints the raw tile order against the arrangement's own gender sequence, which is what says
// whether the page reads the board in row-major order or in some other layout.
if (process.argv.includes('--dump')) {
  const letter = 'B';
  const html = await (await fetch(`https://www.all8.com/sd/calling/16com_${letter.toLowerCase()}.htm`)).text();
  // The cell's HTML, verbatim, so the slot layout can be read off the markup rather than guessed.
  const cell = [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]).find((b) => [...b.matchAll(/alt="/g)].length === 8 && /\[0?B1p\]/.test(b));
  console.log('=== the raw cell for [B1p] ===');
  console.log(cell);
  const template = templateFor('B');
  console.log('\n=== the template\'s 8 spots (x, y, heading, gender) ===');
  [...template.dancers].sort((a, b) => (b.y - a.y) || (a.x - b.x)).forEach((d) => console.log(`  (${d.x}, ${d.y}) h=${d.heading} ${d.gender}`));
  process.exit(0);
}

let checked = 0, agree = 0, unresolved = 0, notFound = 0;
const rows = [];
for (const letter of ['B', 'L', 'W', 'F', 'P']) {
  const url = `https://www.all8.com/sd/calling/16com_${letter.toLowerCase()}.htm`;
  const res = await fetch(url);
  if (!res.ok) { console.log(`  ${letter}: HTTP ${res.status}`); continue; }
  const states = statesOf(await res.text());
  const template = templateFor(letter);
  console.log(`\n=== [${letter}] ${states.length} labelled state cell(s) with 8 tiles ===`);
  for (const st of states) {
    const spec = parseAlignmentId(st.label);
    if (!spec || spec.letter !== letter) continue;
    const candidates = boardsFromTiles(template, letter, spec.arrangement, st.alt);
    if (!candidates.length) { unresolved++; console.log(`    ${st.label}: could not place the tiles against the template`); continue; }
    // Keep the candidate that the module itself reads as this arrangement and sequence.
    const res2 = boardsForAlignment(template, spec);
    if (!res2.boards.length) { console.log(`    ${st.label.padEnd(6)} code admits no board`); continue; }
    const match = candidates.find((c) => res2.boards.some((b) => assignment(b) === assignment(c)));
    if (!match) { notFound++; console.log(`    ${st.label}: all8's tiles are NOT in the enumeration (${res2.boards.length} boards)`); continue; }
    const idx = res2.boards.findIndex((b) => assignment(b) === assignment(match));
    const rot = rotationBetween(res2.boards[0], res2.boards[idx]);
    const readSeq = sequenceFor(match).code;
    const readArr = arrangementFor(match, letter).number;
    const corpusSays = CORPUS_RULE[readSeq];
    checked++;
    const ok = rot === corpusSays;
    if (ok) agree++;
    rows.push({ letter, label: st.label, idx, count: res2.boards.length, rot, readSeq, readArr, corpusSays, ok, hint: st.hint });
    console.log(`    ${st.label.padEnd(6)} reads arr ${readArr ?? '?'} seq ${readSeq ?? '?'}  index ${idx}/${res2.boards.length}, relabel +${rot}  rule +${corpusSays}  ${ok ? 'ok' : 'DISAGREES'}  "${st.hint}"`);
  }
}

console.log('\n=== summary over the 16com pages ===');
console.log(`  states checked ${checked}; the corpus rule reproduces ${agree}`);
console.log(`  cells whose tiles could not be placed: ${unresolved}; all8's board not in the enumeration: ${notFound}`);
const bad = rows.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  DISAGREEMENTS:');
  for (const r of bad) console.log(`    [${r.letter}] ${r.label}: reads seq ${r.readSeq}, relabel +${r.rot}, rule said +${r.corpusSays}`);
}
