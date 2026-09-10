// Author-time refresh for fixtures/all8-arrangements.json.
//
// Parses All8's per-formation arrangement tables (which positions are occupied by
// boys and which by girls, for each of the 6 arrangement numbers) straight out of
// the page, so the module's hand-written tables can be checked against the source
// rather than against a transcription of it. Run from anywhere; the network is
// only needed here, never in `npm run verify`.
//
//   node test/tools/fetch-arrangements.mjs
//
// The printed tables are worth eyeballing after a refresh: this is the file that
// decides what "arrangement 0" means for each formation.

import { writeFileSync } from 'node:fs';

const SOURCE = 'https://www.all8.com/sd/calling/arrngdia.htm';

const r = await fetch(SOURCE);
if (!r.ok) { console.log(`FAIL: HTTP ${r.status} from ${SOURCE}`); process.exit(1); }
const html = await r.text();
const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table|pre|td)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/\r/g, '').replace(/\n{2,}/g, '\n');

const FACE = new Set(['^', 'v', '<', '>']);
const NUMBER_ORDER = [0, 5, 1, 2, 3, 4];
const out = {};
let cur = null;

for (const raw of text.split('\n')) {
  // A table header is "[B]  0  5  1  2  3  4" - note the column order, which is
  // All8's printed order and NOT numeric order.
  const header = raw.match(/^\s*\[([A-Za-z.]+)\]\s+0\s+5\s+1\s+2\s+3\s+4\s*$/);
  if (header) { cur = header[1]; out[cur] = { letter: cur, rows: [] }; continue; }
  if (!cur) continue;
  const toks = raw.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) continue;
  if (!FACE.has(toks[0][0])) { cur = null; continue; } // any other line ends the table
  let i = 0;
  while (i < toks.length && [...toks[i]].every((c) => FACE.has(c))) i++;
  const facing = toks.slice(0, i).join('');
  // The 6 gender cells are printed as separate letters ("g B") for the narrow
  // formations and run together ("BggBBggB") for the tidal ones, so join them and
  // split into 6 cells of one column's width.
  const joined = toks.slice(i).join('');
  const width = facing.length;
  if (joined.length !== 6 * width) { cur = null; continue; }
  const gender = Array.from({ length: 6 }, (_, k) => joined.slice(k * width, (k + 1) * width));
  if (gender.some((g) => /[^Bg]/.test(g))) { cur = null; continue; }
  out[cur].rows.push({ facing, gender });
}

const formations = Object.fromEntries(Object.entries(out).filter(([, v]) => v.rows.length));
for (const [letter, t] of Object.entries(formations)) {
  console.log(`[${letter}] rows=${t.rows.length} width=${t.rows[0].facing.length}`);
  for (const row of t.rows) console.log(`    ${row.facing}   ${row.gender.join('  ')}`);
}
if (Object.keys(formations).length < 30) {
  console.log(`WARN: only ${Object.keys(formations).length} formations parsed - the page layout may have changed.`);
}

const fixture = {
  note: 'Per-formation arrangement tables: which positions in the formation are occupied by boys and which by girls, for each of the 6 arrangement numbers. Parsed from All8\'s arrangement diagrams; the numbers apply per formation, not by a universal rule.',
  source: SOURCE,
  method: 'Each printed table line is "<facing per column>  <6 gender cells>", the cells being in the printed column order 0,5,1,2,3,4. Facing chars: ^ north, v south, < west, > east. Gender chars: B boy, g girl. Rows are top-to-bottom as drawn.',
  keys: {
    numberOrder: NUMBER_ORDER,
    note: 'genders[k] in each row belongs to arrangement NUMBER_ORDER[k].',
  },
  formations,
};
writeFileSync(new URL('../fixtures/all8-arrangements.json', import.meta.url), JSON.stringify(fixture, null, 1) + '\n');
console.log(`written: ${Object.keys(formations).length} formations`);
