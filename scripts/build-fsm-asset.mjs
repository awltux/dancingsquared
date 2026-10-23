// BUILD THE REPOSITORY'S ONE FSM TRANSITION TABLE — `assets/fsm-ms.json`.
//
// WHAT IT IS. The resolve state machine built from the shipped Mainstream catalogue: every state a caller can
// stand in, and every call that can be made from it, classified by how much of the board the call moves
// (`reading`) and where it lands (`endKind`). Serialised once so the POC's FSM view and the teacher app open
// instantly instead of paying a ~55-85 s runtime build.
//
// WHO READS IT. Eight Node readers (`engine/test/fsm-asset.mjs`, `reading-census`, `cell-census`, `level-census`,
// `fsm-getout-audit`, `ladies-sashay-probe`, `poc/tools/emit-fsm-view`, `poc/tools/fsm-open-probe`), the POC app
// itself through `import.meta.glob('@corpus/fsm-*.json')`, and the teacher app — which used to ship its OWN copy
// (`poc-teacher/src/assets/fsm-table.json`, built by its own script) until `agent/one-fsm-asset` deleted it: a
// second artefact generated from the same table by a second builder, and gone stale into a schema the engine
// refuses to load. One fact, one file, one builder.
//
// WHY IT LIVES IN `scripts/`. Its readers are the engine's harnesses, the POC's tools and the teacher, so neither
// `poc/scripts/` (where it started) nor `poc-teacher/scripts/` (where its copy started) is its owner. This is the
// repo-level home the other generators use (`scripts/call-titles.mjs`, `scripts/reorder-formation.mjs`).
//
// WHY THE ENGINE IS IMPORTED BY PATH. `poc/node_modules/dancing-squared-engine` and the teacher's are pnpm copies
// of `engine/`, so importing the package NAME here picks up whatever the engine looked like when that copy was
// made, while `poc-teacher/src/catalog.ts` resolves the same name from ITS directory and gets the live one. That
// is two engines in one process, and it fails loudly the first time a copied dist is older than a new module. A
// repo script has no reason to go through a package manager to reach its own sibling workspace.
//
// RUN:
//   node scripts/build-fsm-asset.mjs                  write assets/fsm-ms.json
//   node scripts/build-fsm-asset.mjs --out <path>     write somewhere else (a migration, or a stale-copy probe)
//   node scripts/build-fsm-asset.mjs --check          build in memory and compare the CHEAP FACTS with the file
//
// `--check` COMPARES THE CHEAP FACTS ONLY — level, schema version, catalog count, state count, edge total — and
// names the command for the deep check. The edge-by-edge equality lives in `engine/test/fsm-asset.mjs` and only
// there: a second full comparison would be exactly the duplication this consolidation removed.
//
// `builtAt` IS WRITTEN AND IS IGNORED BY `--check`. Both the blob and the table carry a stamp (provenance: which
// build produced this file), and a byte comparison of two runs can therefore never pass. The cheap facts are
// what a checker may compare; the stamps are not facts about the table.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, FSM_TABLE_SCHEMA_VERSION } from '../engine/dist/index.js';
import { buildCatalog, makeSequencer } from '../poc-teacher/src/catalog.ts';
// The corpus walk is the ONE reader's, so this script and every harness that checks its output cannot disagree
// about what `ms/` holds — and neither can count a commented-out tam as a call.
import { corpusRoot, filesRecord } from 'dancing-squared-corpus';

setParser(DOMParser);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const assetsDir = corpusRoot();
const read = (p) => readFileSync(path.join(assetsDir, p), 'utf8');

const argv = process.argv.slice(2);
const wantCheck = argv.includes('--check');
const outIdx = argv.indexOf('--out');
const outFile = outIdx >= 0 && argv[outIdx + 1]
  ? path.resolve(root, argv[outIdx + 1])
  : path.join(assetsDir, 'fsm-ms.json');
const edgeTotal = (table) => Object.values(table.edges ?? {}).reduce((n, list) => n + list.length, 0);

const msFiles = filesRecord('ms');
const catalog = buildCatalog(msFiles);
const seq = makeSequencer(read('moves.xml'), read('formations.xml'), catalog);

console.log(`Building ms FSM from ${catalog.length} catalog calls...`);
const t0 = Date.now();
const table = seq.transitionTable().serialize();
const buildMs = Date.now() - t0;
const fresh = { states: table.states.length, edges: edgeTotal(table) };
console.log(`  built in ${buildMs}ms: ${fresh.states} states, ${fresh.edges} edges`);

const blob = {
  level: 'ms',
  catalogCount: catalog.length,
  builtAt: new Date().toISOString(),
  table,
};

if (wantCheck) {
  // THE CHEAP FACTS, and each one is a failure mode that has actually happened in this tree: a stale schema
  // (the teacher's copy went to schema 3 while its asset stayed at 1 and was silently refused at load), a stale
  // catalogue (290 against 291), and a table that moved with neither.
  let stored;
  try {
    stored = JSON.parse(readFileSync(outFile, 'utf8'));
  } catch (err) {
    console.error(`  STALE: cannot read ${outFile} (${String(err.message ?? err)}) — run \`npm run build:fsm\` from the repo root`);
    process.exit(1);
  }
  const problems = [];
  if (stored.level !== blob.level) problems.push(`level ${JSON.stringify(stored.level)} vs ${JSON.stringify(blob.level)}`);
  if (stored.table?.schemaVersion !== table.schemaVersion) problems.push(`table schemaVersion ${stored.table?.schemaVersion} vs ${table.schemaVersion}`);
  if (stored.table?.schemaVersion !== FSM_TABLE_SCHEMA_VERSION) problems.push(`schemaVersion ${stored.table?.schemaVersion} is not the engine's ${FSM_TABLE_SCHEMA_VERSION}`);
  if (stored.catalogCount !== blob.catalogCount) problems.push(`catalogCount ${stored.catalogCount} vs ${blob.catalogCount}`);
  const storedStates = stored.table?.states?.length ?? 0;
  const storedEdges = edgeTotal(stored.table ?? {});
  if (storedStates !== fresh.states) problems.push(`states ${storedStates} vs ${fresh.states}`);
  if (storedEdges !== fresh.edges) problems.push(`edges ${storedEdges} vs ${fresh.edges}`);
  if (problems.length) {
    console.error(`  STALE: ${path.relative(root, outFile)}`);
    for (const p of problems) console.error(`    ${p}`);
    console.error('    run `npm run build:fsm` from the repo root, and for the edge-by-edge verdict `node engine/test/fsm-asset.mjs`');
    process.exit(1);
  }
  console.log(`  fresh: ${blob.catalogCount} catalog / ${fresh.states} states / ${fresh.edges} edges (builtAt ${stored.builtAt ?? 'absent'}; the deep edge-by-edge check is engine/test/fsm-asset.mjs)`);
  process.exit(0);
}

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(blob));
console.log(`  wrote ${path.relative(root, outFile)} (${(JSON.stringify(blob).length / 1024).toFixed(0)} KB)`);
