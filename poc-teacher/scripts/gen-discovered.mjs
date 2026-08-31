// Generate discovered/*.xml files: plain-titled calls with a home (Static Square)
// setup, by extracting the matching "Heads X" / "All 8 X" home variant from the
// catalog and re-titling it. This makes calls like "Pass Thru", "Square Thru 4",
// "Flutterwheel", "Recycle" legal from the FSM home state.
//
// Run: `node scripts/gen-discovered.mjs` from poc-teacher/ (or repo root).

import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..'); // repo root (poc and poc-teacher are siblings)
const assets = path.join(root, 'poc/src/assets');
const outDir = path.join(assets, 'discovered');
const read = (p) => readFileSync(path.join(assets, p), 'utf8');

const tamBlocks = (xml) => xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
const attr = (b, n) => (b.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] ?? '';

// plain call name -> { file, homeVariantTitle }
const SPEC = {
  'Pass Thru': { file: 'b1/pass_thru.xml', homeVariant: 'Heads Pass Thru' },
  'Square Thru 2': { file: 'b1/square_thru.xml', homeVariant: 'Heads Square Thru 2' },
  'Square Thru 3': { file: 'b1/square_thru.xml', homeVariant: 'Heads Square Thru 3' },
  'Square Thru 4': { file: 'b1/square_thru.xml', homeVariant: 'Heads Square Thru 4' },
  'Flutterwheel': { file: 'b2/flutterwheel.xml', homeVariant: 'All 8 Flutterwheel' },
  'Recycle': { file: 'a2/recycle.xml', homeVariant: 'All 8 Recycle' },
};

// Group specs by output file so a base file with several variants (e.g. Square
// Thru 2/3/4) produces ONE discovered file with all home tams.
const grouped = new Map(); // baseFile -> { plainTitles: [{plain, homeVariant}], sourceFile }
for (const [plain, { file, homeVariant }] of Object.entries(SPEC)) {
  const base = file.split('/').pop().replace('.xml', '');
  if (!grouped.has(base)) grouped.set(base, { sourceFile: file, items: [] });
  grouped.get(base).items.push({ plain, homeVariant });
}

mkdirSync(outDir, { recursive: true });

for (const [base, { sourceFile, items }] of grouped) {
  const xml = read(sourceFile);
  const tamsOut = [];
  for (const { plain, homeVariant } of items) {
    const tam = tamBlocks(xml).find((b) => attr(b, 'title') === homeVariant && b.includes('Static Square'));
    if (!tam) { console.log(`SKIP ${plain}: no home variant "${homeVariant}"`); continue; }
    const retitled = tam
      .replace(new RegExp(`title="${homeVariant}"`), `title="${plain}"`)
      .replace(/\s+group="[^"]*"/, '')
      .replace(/\s+display="[^"]*"/, '')
      .trim();
    tamsOut.push(retitled);
  }
  if (!tamsOut.length) { console.log(`SKIP ${base}: no home variants`); continue; }
  const discovered = `<?xml version="1.0"?>
<!DOCTYPE tamination SYSTEM "../src/tamination.dtd">
<!--
    Discovered call${items.length > 1 ? 's' : ''}: ${items.map((i) => i.plain).join(', ')} (home squared-set setup${items.length > 1 ? 's' : ''}).

    The catalog authors these calls' home applications under Heads/All-8 titles.
    This discovered file provides plain-titled entries with the same Static Square
    setups so they are legal from the FSM home state and their home->end edges are
    defined.
-->
<tamination title="${items[0].plain}">

  ${tamsOut.join('\n\n')}

</tamination>
`;
  const outFile = path.join(outDir, `${base}.xml`);
  writeFileSync(outFile, discovered);
  console.log(`WROTE ${path.relative(root, outFile)} (${tamsOut.length} tam(s))`);
}
console.log('Done.');

