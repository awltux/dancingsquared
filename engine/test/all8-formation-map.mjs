// Step 1 of the get-out conformance work: reconcile the engine's formation
// templates with All8's published alignment diagrams.
//
// WHY: the fixture's get-outs are indexed by alignment ([B1p], [L1p], ...), so
// running any of them needs a board in that alignment. Before building one we have
// to know whether the engine's named formation is even the SAME SHAPE as the All8
// family letter (B/L/P/W/F). If the templates disagree, nothing downstream can work.
//
// HOW: All8's text diagrams are SCHEMATIC - they show which dancer stands where and
// which way each faces, but no distances. So this compares a METRIC-FREE signature:
// each dancer's (column rank, row rank, facing), as a set, under all 8 symmetries of
// the rectangle (4 rotations x mirror). Aspect ratio is therefore discarded, which
// is correct for these diagrams but means this check can confirm topology and
// facing, never exact geometry.
//
// Output: the All8 family -> engine formation name map, or a report that no engine
// formation has that shape. Reported, never failed - this is a finding, not a gate.
//
// Run: `npm run build && node test/all8-formation-map.mjs` from engine/.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, Sequencer } from '../dist/index.js';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// Arrows -> heading in degrees, CCW from +x (east), matching the engine's convention:
// > east, ^ north, < west, v south.
const FACING = { '>': 0, '^': 90, '<': 180, 'v': 270 };

/** Parse an All8 text diagram into cells {c, r, dancer, facing} with r = 0 at the
 * TOP (north) because the diagrams are drawn with the caller at the bottom. */
function parseDiagram(diagram) {
  const lines = String(diagram ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const cells = [];
  lines.forEach((line, top) => {
    line.split(/\s+/).filter(Boolean).forEach((tok, c) => {
      const m = /^([v^<>])?(\d+)([v^<>])?$/.exec(tok);
      if (!m) return;
      const arrow = m[1] ?? m[3];
      if (!arrow) return;
      cells.push({ c, r: top, dancer: Number(m[2]), facing: FACING[arrow] });
    });
  });
  return cells;
}

/** A template's cells from its own geometry: column rank west->east, row rank
 * north->south, facing rounded to the nearest degree. */
function templateCells(dancers) {
  const xs = [...new Set(dancers.map((d) => +d.x.toFixed(3)))].sort((a, b) => a - b);
  const ys = [...new Set(dancers.map((d) => +d.y.toFixed(3)))].sort((a, b) => b - a);
  return dancers.map((d) => ({
    c: xs.indexOf(+d.x.toFixed(3)),
    r: ys.indexOf(+d.y.toFixed(3)),
    facing: ((Math.round((d.heading * 180) / Math.PI) % 360) + 360) % 360,
  }));
}

/** All 8 orientations of a cell set, each re-normalised to the top-left. */
function orientations(cells) {
  const out = [];
  for (let k = 0; k < 4; k++) {
    for (const reflect of [false, true]) {
      const turned = cells.map(({ c, r, facing }) => {
        let x = c, y = -r, f = facing;                       // y up
        if (reflect) { x = -x; f = (180 - f + 360) % 360; }  // mirror across the vertical
        for (let i = 0; i < k; i++) { const nx = -y, ny = x; x = nx; y = ny; f = (f + 90) % 360; }
        return { x, y, facing: f };
      });
      const minX = Math.min(...turned.map((p) => p.x));
      const maxY = Math.max(...turned.map((p) => p.y));
      out.push(turned.map((p) => ({ c: p.x - minX, r: maxY - p.y, facing: p.facing })));
    }
  }
  return out;
}

const sig = (cells) => cells.map((p) => `${p.c},${p.r},${p.facing}`).sort().join('|');
const dims = (cells) => `${Math.max(...cells.map((p) => p.c)) + 1}x${Math.max(...cells.map((p) => p.r)) + 1}`;

// --------------------------------------------------------------- the corpus

const FIXTURE = path.join(__dirname, 'fixtures', 'all8-getouts.json');
if (!existsSync(FIXTURE)) { console.log(`FAIL: no fixture at ${FIXTURE}`); process.exit(1); }
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

console.log('== All8 diagrams -> shape signature (topology + facing, metric-free) ==');
const byFamily = new Map();
for (const a of fixture.alignments) {
  const cells = parseDiagram(a.diagram);
  if (cells.length !== 8) {
    console.log(`  skip ${a.id}: diagram parsed to ${cells.length} dancers (not 8)`);
    continue;
  }
  if (!byFamily.has(a.family)) byFamily.set(a.family, []);
  byFamily.get(a.family).push({ id: a.id, cells, signature: sig(cells), dims: dims(cells) });
}
for (const [family, entries] of byFamily) {
  const shapes = new Set(entries.map((e) => e.signature));
  console.log(`  ${family.padEnd(20)} ${entries.length} alignments, ${shapes.size} distinct shape(s), ${entries[0].dims}`);
  if (shapes.size !== 1) {
    console.log(`      NOTE: alignments in one family disagree on shape - ${entries.map((e) => e.id).join(', ')}`);
  }
}
console.log('  (a family SHOULD have one shape: arrangement/sequence/relationship only relabel which dancer is where)');

// --------------------------------------------------------------- the engine

const assets = path.join(root, 'poc/src/assets');
const levels = ['discovered', 'b1', 'b2', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
const calls = [];
for (const lv of levels) {
  const dir = path.join(assets, lv);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
    calls.push({ name: f.replace(/\.xml$/, ''), xml: readFileSync(path.join(dir, f), 'utf8') });
  }
}
const seq = new Sequencer(
  readFileSync(path.join(assets, 'moves.xml'), 'utf8'),
  readFileSync(path.join(assets, 'formations.xml'), 'utf8'),
  calls,
);

const templates = seq.getUniqueFormations()
  .filter((f) => f.dancers.length === 8)
  .map((f) => ({ name: f.name, cells: templateCells(f.dancers) }))
  .map((t) => ({ ...t, signature: sig(t.cells), dims: dims(t.cells) }));
console.log(`\n== Engine templates ==\n  ${templates.length} named formations with 8 dancers`);

// --------------------------------------------------------------- the mapping

console.log('\n== All8 family -> engine formation ==');
const MAP_PATH = path.join(__dirname, 'fixtures', 'all8-formation-map.json');
const recorded = existsSync(MAP_PATH) ? JSON.parse(readFileSync(MAP_PATH, 'utf8')) : null;
const write = process.argv.includes('--write');
const computed = {};

for (const [family, entries] of [...byFamily.entries()].sort()) {
  const al = entries[0];
  const hits = [];
  for (const t of templates) {
    if (t.signature === al.signature) { hits.push({ name: t.name, how: 'identical (no rotation needed)' }); continue; }
    for (const o of orientations(al.cells)) {
      if (sig(o) === t.signature) { hits.push({ name: t.name, how: 'rotated/mirrored' }); break; }
    }
  }
  computed[family] = hits.map((h) => h.name);
  const label = `${family} (${entries.map((e) => e.id).join(', ')})`;
  if (hits.length === 0) {
    console.log(`  ${label}\n      NO engine formation has this shape`);
  } else {
    console.log(`  ${label}\n      -> ${hits.map((h) => `${h.name} [${h.how}]`).join(' | ')}`);
  }
}

// Compare against the recorded map, so a template rename or geometry change is
// caught rather than silently invalidating every later step.
console.log('\n== Recorded map ==');
let mapFailures = 0;
if (write) {
  const out = { ...(recorded ?? {}), families: {} };
  for (const [family, names] of Object.entries(computed)) out.families[family] = { engine: names };
  writeFileSync(MAP_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`  wrote ${path.relative(root, MAP_PATH)}`);
} else if (!recorded) {
  console.log('  no map recorded yet - run with --write to create it');
} else {
  for (const [family, names] of Object.entries(computed)) {
    const want = recorded.families?.[family]?.engine ?? [];
    const same = want.length === names.length && want.every((n) => names.includes(n));
    console.log(`  ${same ? 'ok  ' : 'FAIL'}  ${family}: ${names.join(', ') || '(none)'}`);
    if (!same) { mapFailures++; console.log(`          recorded: ${want.join(', ') || '(none)'}`); }
  }
  for (const [family, rec] of Object.entries(recorded.families ?? {})) {
    if (!(family in computed)) console.log(`  note: recorded family "${family}" has no diagram to check`);
  }
  if (mapFailures) console.log(`  ${mapFailures} famil${mapFailures === 1 ? 'y' : 'ies'} drifted from the recorded map - re-run with --write after checking.`);
}

console.log('\n=================');
const unmatched = Object.entries(computed).filter(([, names]) => names.length === 0).map(([f]) => f);
if (unmatched.length) {
  console.log(`${unmatched.length} of ${Object.keys(computed).length} All8 families have no congruent engine formation:`);
  for (const f of unmatched) console.log(`  - ${f}`);
  console.log('Those families cannot be set up at all until a template exists for them.');
} else {
  console.log('every All8 family with a diagram maps onto an engine formation.');
}
console.log('Reminder: this compares topology + facing only - the diagrams carry no distances,');
console.log('so a match does NOT prove the engine\'s lattice spacing is the same.');
if (mapFailures) process.exitCode = 1;
