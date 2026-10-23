// IS FASR INJECTIVE? Does a code name a board, or a class of boards?
//
// The user's question: "when the FASROO indicates out of sequence dancers, there is no exact way to
// specify how they are out of sequence, so two boards with the same out-of-sequence FASROO can be
// different." That is a claim about arithmetic, so this counts it rather than arguing it.
//
// Method: hold formation letter AND arrangement fixed, and enumerate EVERY board - 4! ways to place
// the four boys on the four boy-spots, 4! for the girls, 576 in all. Classify each with the engine's
// own reader (arrangement, sequence, relationship) and group. A class of size 1 would mean FASR names
// the board; a class of size 4 all related by whole-set relabelling means it names a 4-fold class
// (the orientations). Anything else - a bigger class, or one holding boards that are NOT relabellings
// of each other - is a board FASR cannot tell apart.
//
// Usage: node engine/test/tools/fasr-injectivity-probe.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import {
  Sequencer,
  setParser,
  arrangementFor,
  sequenceFor,
  relationshipStateOf,
  adjacentPairs,
  rotationBetweenBoards,
  readLayout,
  ARRANGEMENT_TABLES,
  ARRANGEMENT_NUMBER_ORDER,
  EMPTY_CELL,
  FORMATIONS_FOR_LETTER,
} from '../../dist/index.js';
import { HOME_DANCERS } from '../../dist/sequencer/identity.js';
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
const templateFor = (letter) => {
  for (const n of FORMATIONS_FOR_LETTER[letter] ?? []) { const b = seq.boardForFormation(n); if (b) return b; }
  return null;
};

const perms = (xs) => (xs.length <= 1 ? [xs.slice()] : xs.flatMap((v, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [v, ...r])));

function enumerate(letter, arrangement) {
  const template = templateFor(letter);
  const table = ARRANGEMENT_TABLES[letter];
  const column = ARRANGEMENT_NUMBER_ORDER.indexOf(arrangement);
  const layout = readLayout(template, letter);
  // spot -> gender from the arrangement table, in the table's own frame; pair with the template's
  // real metric by reading the template onto that frame.
  const spots = [];
  layout.cells.forEach((row, r) => row.forEach((cell, c) => {
    const g = table[r].genders[column][c];
    if (g === EMPTY_CELL || !cell) return;
    const orig = template.dancers.find((d) => d.id === cell.id) ?? cell;
    spots.push({ x: orig.x, y: orig.y, heading: orig.heading, gender: g === 'B' ? 'boy' : 'girl' });
  }));
  const boySpots = spots.filter((s) => s.gender === 'boy');
  const girlSpots = spots.filter((s) => s.gender === 'girl');
  const boys = HOME_DANCERS.filter((d) => d.gender === 'boy');
  const girls = HOME_DANCERS.filter((d) => d.gender === 'girl');
  const out = [];
  for (const bo of perms(boys)) {
    for (const go of perms(girls)) {
      const place = (sp, order) => sp.map((s, i) => ({ id: order[i].id, couple: order[i].couple, gender: order[i].gender, x: s.x, y: s.y, heading: s.heading }));
      out.push({ dancers: [...place(boySpots, bo), ...place(girlSpots, go)] });
    }
  }
  return out;
}

const CLASSES = { 1: 'in', 2: 'out', 3: 'boys in / girls out', 4: 'boys out / girls in' };

for (const letter of ['P', 'B', 'L', 'W']) {
  const boards = enumerate(letter, 0);
  const groups = new Map();
  let asym = 0;
  for (const b of boards) {
    const a = arrangementFor(b, letter).number;
    const s = sequenceFor(b).code;
    const rr = relationshipStateOf(b, letter).code;
    if (s === null) { asym++; continue; }
    const key = `${a}:${s}:${rr ?? '?'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const sizes = new Map();
  let split = 0; // classes holding boards that are NOT relabellings of each other
  for (const [, list] of groups) {
    sizes.set(list.length, (sizes.get(list.length) ?? 0) + 1);
    const first = list[0];
    if (list.some((b) => rotationBetweenBoards(first, b) === null)) split++;
  }
  console.log(`[${letter}] ${boards.length} boards at arrangement 0`);
  console.log(`    sequence read as ASYMMETRIC (no FASR digit at all): ${asym}`);
  console.log(`    named by a (sequence, relationship) code: ${boards.length - asym}   in ${groups.size} class(es)`);
  console.log(`    class sizes: ${[...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n} board(s) x ${c} class(es)`).join(', ')}`);
  console.log(`    classes holding boards that are NOT whole-set relabellings of each other: ${split}`);
  // How much a reader can RESOLVE, as opposed to how much the notation names: a board whose letter
  // cannot be read at all falls into a bucket keyed on (arrangement, sequence) alone, and the bucket
  // is as big as the blindness. This is the shape `[P]` used to have before All8's reduction was
  // recorded, so it is measured here both ways (`old` = unanimous-or-nothing, which is what the code
  // did before; `new` = the shipped reader).
  {
    const buckets = (rel) => {
      const m = new Map();
      for (const b of boards) {
        const s = sequenceFor(b).code;
        if (s === null) continue;
        const key = `${arrangementFor(b, letter).number}:${s}:${rel(b) ?? '?'}`;
        m.set(key, (m.get(key) ?? 0) + 1);
      }
      const sizes = {};
      for (const v of m.values()) sizes[v] = (sizes[v] ?? 0) + 1;
      return `${m.size} class(es), sizes ${JSON.stringify(sizes)}`;
    };
    const oldRel = (b) => {
      const a = adjacentPairs(b, letter);
      if (!a.pairs) return null;
      const set = new Set(a.pairs.map((p) => p.letter));
      return set.size === 1 && !set.has(null) ? [...set][0] : null;
    };
    console.log(`    resolution with the OLD reader (unanimous-or-nothing): ${buckets(oldRel)}`);
    console.log(`    resolution with the SHIPPED reader: ${buckets((b) => relationshipStateOf(b, letter).code)}`);
  }
  // the out-of-sequence classes specifically
  for (const s of [2, 3, 4]) {
    const out = [...groups.entries()].filter(([k]) => k.split(':')[1] === String(s));
    const counts = out.map(([k, v]) => `${k.split(':')[2]}x${v.length}`);
    console.log(`    sequence ${s} (${CLASSES[s]}): ${out.length} class(es)  ${counts.join(' ')}`);
  }
}
