// Build a static FSM table asset for the poc FSM view, so opening the view is
// instant (no 12s runtime build). Run: `node poc/scripts/build-fsm-asset.mjs`
// from repo root. Writes assets/fsm-ms.json (serialised FsmTableData).

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
// The WORKSPACE engine, by path, deliberately. `poc/node_modules/dancing-squared-engine` is a
// pnpm copy of `engine/` (a junction into `poc/node_modules/.pnpm`), not a link to it, so importing
// the package name here picks up whatever the engine looked like when that copy was made — while
// `../../poc-teacher/src/catalog.ts` resolves the same package name from ITS directory and gets the
// live one. That is two engines in one process, and it fails loudly the first time the copied dist
// is older than a new module (`Cannot find module .../dist/sequencer/swing-thru.js`). A repo script
// has no reason to go through a package manager to reach its own sibling workspace.
import { setParser } from '../../engine/dist/index.js';
import { buildCatalog, makeSequencer } from '../../poc-teacher/src/catalog.ts';
// The corpus walk is the ONE reader's, so this script and the teacher's build cannot disagree about what `ms/`
// holds — and neither can count a commented-out tam as a call.
import { corpusRoot, filesRecord } from 'dancing-squared-corpus';

setParser(DOMParser);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');
const assetsDir = corpusRoot();
const read = (p) => readFileSync(path.join(assetsDir, p), 'utf8');

const msFiles = filesRecord('ms');
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
