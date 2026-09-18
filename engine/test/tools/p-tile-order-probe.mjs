// SOLVE THE TILE ORDER of the 16-state page, decisively.
//
// The identity (and every rectangle symmetry) reads the four states that BOTH All8 sources draw
// correctly for P1c and P2r but produces an impossible board for P3p/P4p - under it couple 4's two
// dancers end up two columns apart with another couple's boy between them, which is not a couple at
// all. So the document order is not the lattice order. Rather than guess which traversal it is, this
// enumerates all 8! = 40320 bijections from the eight document slots to the eight template spots and
// keeps every one that reproduces ALL FOUR published get-out boards (up to the couple relabelling a
// FASR code leaves free). Anything the four cannot distinguish is then reported as still open.
//
// Usage: node engine/test/tools/p-tile-order-probe.mjs   (network needed)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer,
  setParser,
  parseAlignmentId,
  boardFromDiagram,
  rotationBetweenBoards,
  relationshipStateOf,
  sequenceFor,
  arrangementFor,
  centresPassThru,
  FORMATIONS_FOR_LETTER,
} from '../../dist/index.js';
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
const pTemplate = (() => { for (const n of FORMATIONS_FOR_LETTER.P ?? []) { const b = seq.boardForFormation(n); if (b) return b; } return null; })();
const SPOTS = [...pTemplate.dancers].sort((a, b) => (b.y - a.y) || (a.x - b.x));
const HOME_ID = { '1boy': 5, '1girl': 6, '2boy': 3, '2girl': 4, '3boy': 1, '3girl': 2, '4boy': 7, '4girl': 8 };
const DIR = { e: 0, n: Math.PI / 2, w: Math.PI, s: (3 * Math.PI) / 2 };

function statesOf(html) {
  const out = [];
  for (const m of html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    const body = m[1];
    const tiles = [...body.matchAll(/src=d1\/(\d)([nesw])\.gif/gi)].map((t) => ({ n: Number(t[1]), dir: t[2] }));
    if (tiles.length !== 8) continue;
    const label = (body.match(/\[([0-5]?[A-Za-z.]{1,3}[1-4]?[pocr]?)\]/) ?? [])[1];
    if (label) out.push({ label, tiles });
  }
  return out;
}

const html = await (await fetch('https://www.all8.com/sd/calling/16com_p.htm')).text();
const cells = statesOf(html).filter((s) => parseAlignmentId(s.label)?.letter === 'P');
const page = new Map(cells.map((c) => [c.label, c.tiles]));

const corpus = JSON.parse(readFileSync(path.join(here, '..', 'fixtures', 'all8-getouts.json'), 'utf8'));
const truth = new Map();
for (const a of corpus.alignments.filter((x) => parseAlignmentId(x.id)?.letter === 'P')) {
  const spec = parseAlignmentId(a.id);
  const g = boardFromDiagram(pTemplate, 'P', spec.arrangement, a.diagram);
  if (g.board) truth.set(a.id, g.board);
}
const labels = [...truth.keys()];

function boardFor(tiles, perm) {
  return {
    dancers: tiles.map((t, i) => {
      const couple = Math.floor(t.n / 2) + 1;
      const gender = t.n % 2 === 0 ? 'boy' : 'girl';
      const s = SPOTS[perm[i]];
      return { id: HOME_ID[`${couple}${gender}`], couple, gender, x: s.x, y: s.y, heading: DIR[t.dir] };
    }),
  };
}

// all permutations of 0..7
const perms = [];
(function rec(prefix, rest) {
  if (!rest.length) { perms.push(prefix); return; }
  for (let i = 0; i < rest.length; i++) rec([...prefix, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)]);
})([], [0, 1, 2, 3, 4, 5, 6, 7]);
console.log(`searching ${perms.length} orderings against the ${labels.length} published boards...`);

const survivors = [];
for (const perm of perms) {
  let ok = true;
  for (const id of labels) {
    const got = boardFor(page.get(id), perm);
    if (rotationBetweenBoards(truth.get(id), got) === null) { ok = false; break; }
  }
  if (ok) survivors.push(perm);
}

console.log(`\n${survivors.length} ordering(s) reproduce all ${labels.length} published boards.`);
for (const perm of survivors.slice(0, 12)) {
  console.log(`  document slot -> template spot: ${perm.join(',')}   (${perm.map((p) => `(${SPOTS[p].x},${SPOTS[p].y})`).join(' ')})`);
}
if (survivors.length > 12) console.log(`  ... and ${survivors.length - 12} more`);

if (survivors.length === 1) {
  const perm = survivors[0];
  console.log('\n== that ordering, over all sixteen states ==');
  let ruleOk = 0, refOk = 0, mixed = 0;
  for (const c of cells) {
    const spec = parseAlignmentId(c.label);
    const board = boardFor(c.tiles, perm);
    const own = relationshipStateOf(board, 'P');
    mixed++;
    const ok = own.code === spec.relationship;
    if (ok) ruleOk++;
    console.log(`  ${c.label.padEnd(5)} arr ${arrangementFor(board, 'P').number} seq ${sequenceFor(board).code} published '${spec.relationship}' -> '${own.code ?? 'mixed'}' ${ok ? 'ok' : 'DISAGREES'}`);
  }
  console.log(`\n  the recorded [P] rule reproduces ${ruleOk} of ${cells.length} published letters`);
}
