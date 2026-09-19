// Probe: how often is a call's END board actually nameable, and what does the FASROO read?
//
// This is the instrument behind the browse panel's end-formation field: the field can only offer
// "label this formation" if there ARE end boards the library cannot name, so the count is the
// thing to measure rather than assume.
//
// Usage: node engine/test/tools/end-formation-probe.mjs [level]
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setParser,
  Sequencer,
  buildCallVariants,
  boardAtBeat,
  fasrooOf,
  formationToXml,
  parseFormations,
} from '../../dist/index.js';
import { callsByTitle, callXmlFiles } from '../lib/engine-calls.mjs';
setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(__dirname, '..', '..', '..', 'poc', 'src', 'assets');
const read = (p) => fs.readFileSync(path.join(assets, p), 'utf8');
const movesXml = read('moves.xml');
const formationsXml = read('formations.xml');

const level = process.argv[2] ?? 'ms';
const calls = callsByTitle(assets);
const seq = new Sequencer(movesXml, formationsXml, calls.map((c) => c));
console.log(`== ${calls.length} pooled call titles registered; reading the ${level.toUpperCase()} level ==`);

const files = callXmlFiles(assets, [level]);
const variants = [];
for (const file of files) {
  const xml = fs.readFileSync(file, 'utf8');
  const rel = path.relative(assets, file);
  try {
    for (const call of buildCallVariants(xml, movesXml, formationsXml, true)) variants.push({ call, rel });
  } catch {
    /* a tam that does not build is reported by the catalogue harness, not here */
  }
}

const stats = { named: 0, curated: 0, unknown: 0 };
const unknownByShape = new Map();
const unnamed = [];
const bySize = new Map(); // dancer count -> { total, named }
for (const { call, rel } of variants) {
  const board = boardAtBeat(call, call.beats);
  const known = seq.knownFormation(board);
  const curated = seq.recognize(board).name;
  if (known) stats.named++;
  else stats.unknown++;
  if (curated) stats.curated++;
  const n = board.dancers.length;
  const row = bySize.get(n) ?? { total: 0, named: 0 };
  row.total++;
  if (known) row.named++;
  bySize.set(n, row);
  if (!known) {
    unnamed.push({ call, board, rel });
    const shape = board.dancers.map((d) => `${d.x},${d.y},${d.heading.toFixed(2)}`).join('|');
    unknownByShape.set(shape, (unknownByShape.get(shape) ?? 0) + 1);
  }
}

const total = variants.length;
const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
console.log(`\n== ${total} call variants at ${level.toUpperCase()} ==`);
console.log(`  END board has a LIBRARY name (knownFormation):  ${stats.named}  (${pct(stats.named)})`);
console.log(`  END board has a CURATED label (recognize):      ${stats.curated}  (${pct(stats.curated)})`);
console.log(`  END board is UNNAMEABLE:                        ${stats.unknown}  (${pct(stats.unknown)})`);
console.log(`  distinct unnameable shapes:                     ${unknownByShape.size}`);
// THE SPLIT THAT DECIDES WHETHER LABELLING IS USEFUL AT ALL. The formation library holds
// EIGHT-dancer geometries only (the constructor mirrors a 4-dancer entry to 8 and drops the
// original), and `bestFormationMatch` skips a formation whose dancer count differs - so a
// 4-dancer end board cannot be named by construction, and labelling one would create a formation
// that is just as unnameable. Whatever the label flow offers, it must know this.
console.log('\n  by dancer count:');
for (const [n, r] of [...bySize.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`    ${String(n).padStart(2)} dancers: ${String(r.total).padStart(5)} variants, ${String(r.named).padStart(5)} nameable (${((r.named / r.total) * 100).toFixed(1)}%)`);
}

// A few witnesses, with the geometry a user would be asked to name. EIGHT-dancer ones first,
// because those are the only ones the label flow can help with.
for (const { call, board, rel } of [...unnamed].sort((a, b) => b.board.dancers.length - a.board.dancers.length).slice(0, 8)) {
  const f = fasrooOf(board);
  console.log(
    `\n  ${call.title}  (from ${call.from || '(default)'})  ${rel}` +
      `\n    dancers: ${board.dancers.map((d) => `${d.x},${d.y}@${((d.heading * 180) / Math.PI).toFixed(0)}`).join('  ')}` +
      `\n    identity: ${board.dancers.filter((d) => d.couple).length}/8 read   FASROO: ${f.notation}`,
  );
}

// The readout the panel shows for a NAMED end, for comparison.
const named = variants.find(({ call }) => seq.knownFormation(boardAtBeat(call, call.beats)));
if (named) {
  const b = boardAtBeat(named.call, named.call.beats);
  console.log(
    `\n== a named end, for the shape of the readout ==\n  ${named.call.title} (from ${named.call.from}): ` +
      `${seq.knownFormation(b)} · curated ${seq.recognize(b).name ?? '—'} · ${fasrooOf(b).notation}`,
  );
}

// The corpus round trip a labelled formation has to survive.
{
  const b = boardAtBeat(unnamed[0].call, unnamed[0].call.beats);
  const xml = formationToXml('Probe Sample Shape', b.dancers.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender })));
  const back = parseFormations(`<formations>${xml}</formations>`);
  const round = back.get('Probe Sample Shape');
  const worst = Math.max(...round.map((d, i) => Math.hypot(d.x - b.dancers[i].x, d.y - b.dancers[i].y)));
  console.log(`\n== corpus round trip ==\n  formationToXml -> parseFormations: ${round.length} dancers, worst offset ${worst.toExponential(2)}`);
  console.log(xml.split('\n').slice(0, 2).join('\n'));
}
