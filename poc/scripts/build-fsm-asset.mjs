// Build a static FSM table asset for the poc FSM view, so opening the view is
// instant (no 12s runtime build). Run: `node poc/scripts/build-fsm-asset.mjs`
// from repo root. Writes poc/src/assets/fsm-ms.json (serialised FsmTableData).

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { setParser } from 'dancing-squared-engine';
import { buildCatalog, makeSequencer } from '../../poc-teacher/src/catalog.ts';

setParser(DOMParser);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const assetsDir = path.join(root, 'poc', 'src', 'assets');
const read = (p) => readFileSync(path.join(assetsDir, p), 'utf8');

const msFiles = {};
for (const f of readdirSync(path.join(assetsDir, 'ms')).filter((f) => f.endsWith('.xml'))) {
  msFiles[`ms/${f}`] = read(`ms/${f}`);
}
const catalog = buildCatalog(msFiles);
const seq = makeSequencer(read('moves.xml'), read('formations.xml'), catalog);

console.log(`Building ms FSM from ${catalog.length} catalog calls...`);
const t0 = Date.now();
const fsm = seq.transitionTable();
console.log(`  built in ${Date.now() - t0}ms: ${fsm.stateCount()} states, ${fsm.edgeCount()} edges`);

const blob = {
  level: 'ms',
  catalogCount: catalog.length,
  builtAt: new Date().toISOString(),
  table: fsm.serialize(),
};
const outFile = path.join(assetsDir, 'fsm-ms.json');
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(blob));
console.log(`  wrote ${outFile} (${(JSON.stringify(blob).length / 1024).toFixed(0)} KB)`);
