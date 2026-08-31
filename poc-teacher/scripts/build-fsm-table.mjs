// Build-time FSM transition table generator.
//
// Runs in the DEVELOPER environment (as part of `npm run build`) to precompute
// the FSM transition table and write it as a static JSON asset. The app then
// loads that asset at boot and never builds the table at runtime.
//
// Run: `node scripts/build-fsm-table.mjs` from poc-teacher/ (or via `npm run build`).

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser } from 'dancing-squared-engine';

import { buildCatalog, makeSequencer } from '../src/catalog.ts';

setParser(DOMParser);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const assetsDir = path.join(root, '..', 'poc', 'src', 'assets');
const read = (p) => readFileSync(path.join(assetsDir, p), 'utf8');

// The same ms catalog the app loads (mirrors main.ts's import.meta.glob).
const msFiles = {};
for (const f of readdirSync(path.join(assetsDir, 'ms')).filter((f) => f.endsWith('.xml'))) {
  msFiles[`ms/${f}`] = read(`ms/${f}`);
}
const catalog = buildCatalog(msFiles);
const seq = makeSequencer(read('moves.xml'), read('formations.xml'), catalog);

console.log(`Building FSM transition table from ${catalog.length} catalog calls...`);
const t0 = Date.now();
seq.transitionTable(); // build once
const buildMs = Date.now() - t0;
console.log(`  built in ${buildMs}ms: ${seq.transitionTable().stateCount()} states, ${seq.transitionTable().edgeCount()} edges`);

const data = seq.serializeFsmTable();

// A fingerprint of the catalog so the app can reject a stale asset if the
// catalog changed without a rebuild.
const catalogFingerprint = `${catalog.length}|${catalog[0]?.title ?? ''}|${catalog[Math.floor(catalog.length / 2)]?.title ?? ''}|${catalog[catalog.length - 1]?.title ?? ''}`;
const blob = { catalogFingerprint, table: data };

const outFile = path.join(root, 'src', 'assets', 'fsm-table.json');
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(blob));
console.log(`  wrote ${outFile} (${(blob.table.states?.length ?? 0)} states, ${(JSON.stringify(blob).length / 1024).toFixed(0)} KB)`);
