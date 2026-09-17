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
  // The page writes the same thing two ways: facing-first ("<G4", "<B2") and couple-first ("4B>",
  // "1G>"). Direction is which way the dancer FACES, so both orders carry it.
  const m = /^(?:([v^<>])([BG])(\d)|(\d)([BG])([v^<>]))$/.exec(t);
  if (!m) return null;
  const facing = m[1] ?? m[6];
  const gender = m[2] ?? m[5];
  const couple = Number(m[3] ?? m[4]);
  return { gender: gender === 'B' ? 'boy' : 'girl', heading: FACE[facing] * DEG, couple };
};

/**
 * The page's tile order -> the engine template's spot order.
 *
 * MEASURED, not guessed, and the FACINGS are what pin it: the page's slot grid is 2 tiles by 4 for
 * [B] (two `<br>`-separated rows) where the engine's is 4 by 2, and its facing sequence is
 * `> < > < | > < > <` while the template's own row-major order is `^ < ^ < | v > v >`. Reading the
 * page's rows in the opposite order and rotating the whole thing a half turn reproduces the page's
 * facings exactly, and the 45-degree diagonal slots take care of themselves (the page draws a
 * diagonal column, which is why its first cell of the pair is the same tile position as the second).
 */
function boardFromTiles(template, tiles) {
  const toks = tiles.map(token);
  if (toks.some((t) => !t)) {
    console.log(`      debug: unreadable tile(s): ${tiles.filter((t) => !token(t)).join(' ')}`);
    return null;
  }
  const spots = [...template.dancers].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  // The template's spots in the page's own reading order: its row pairs swapped (top row first on the
  // page is the SECOND row of the template's lattice because the page draws the frame half-turned).
  const rows = [0, 1, 2, 3].map((r) => spots.slice(r * 2, r * 2 + 2));
  const pageOrder = [...rows[1], ...rows[0], ...rows[3], ...rows[2]];
  const dancers = toks.map((t, i) => {
    const s = pageOrder[i];
    return { id: HOME_ID[`${t.couple}${t.gender}`], couple: t.couple, gender: t.gender, x: s.x, y: s.y, heading: s.heading };
  });
  return { dancers };
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
    const pageBoard = boardFromTiles(template, st.alt);
    if (!pageBoard) { unresolved++; console.log(`    ${st.label}: could not read the tiles`); continue; }
    const res2 = boardsForAlignment(template, spec);
    if (!res2.boards.length) { console.log(`    ${st.label.padEnd(6)} code admits no board`); continue; }
    // all8's board and the engine's are the same PHYSICAL board; they may differ in couple numbering,
    // which is the freedom the code leaves. `rotationBetween(x, y)` is the +k relabelling that turns x
    // INTO y, so the board we are looking for is the one that turns the PAGE's board into itself.
    const listed = res2.boards.findIndex((b) => rotationBetween(pageBoard, b) !== null);
    if (listed < 0) {
      notFound++;
      console.log(`    ${st.label}: all8's tiles are NOT in the enumeration, up to relabelling (${res2.boards.length} boards)`);
      const posMap = (b) => b.dancers.map((d) => `${d.x},${d.y}=${d.couple}${d.gender[0]}`).sort().join(' ');
      console.log(`        page board : ${posMap(pageBoard)}`);
      res2.boards.forEach((b, i) => console.log(`        boards[${i}]  : ${posMap(b)}`));
      continue;
    }
    const rot = rotationBetween(res2.boards[0], res2.boards[listed]);
    const readSeq = sequenceFor(pageBoard).code;
    const readArr = arrangementFor(pageBoard, letter).number;
    const corpusSays = CORPUS_RULE[readSeq];
    checked++;
    const ok = rot === corpusSays;
    if (ok) agree++;
    rows.push({ letter, label: st.label, idx: listed, count: res2.boards.length, rot, readSeq, readArr, corpusSays, ok, hint: st.hint });
    console.log(`    ${st.label.padEnd(6)} reads arr ${readArr ?? '?'} seq ${readSeq ?? '?'}  index ${listed}/${res2.boards.length}, relabel +${rot}  rule +${corpusSays}  ${ok ? 'ok' : 'DISAGREES'}  "${st.hint}"`);
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
