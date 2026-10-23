// THE CHEAP HALF OF THE FSM ASSET'S GATE — the two facts whose drift actually happened, in the tier a change runs.
//
// WHY A SECOND GATE, when `test/fsm-asset.mjs` already compares the asset to a REBUILD edge by edge. Because that
// comparison costs ~55-95 s and is therefore `light: false`, and AGENTS.md §11.3 says the tier is a cost decision:
// **a gate that only runs in `all` cannot catch a change-time regression**. That is exactly how this repository
// shipped a stale FSM asset for ~20 commits: `assets/fsm-ms.json` sat at catalogue 290 / 70 states / 3958 edges
// against a rebuild of 291 / 68 / 3934, its stored state names were the PRE-RETITLING titles, and a SECOND copy
// (`poc-teacher/src/assets/fsm-table.json`, built by its own builder) had gone stale into a schema the engine
// refuses to load, so the teacher app silently built the table at runtime while 77.5 KB of dead data rode along.
//
// So this file asserts the facts a change can move in under a second, and nothing else:
//   * SCHEMA — the engine's `FSM_TABLE_SCHEMA_VERSION` is what the asset records. `d3c0800` bumped the schema to 3
//     without regenerating, and the teacher's copy stayed at 1, which `FsmTable.load` refuses: a stale asset that
//     LOOKS present and can never load.
//   * CATALOGUE COUNT — the asset was built from as many `ms` catalogue entries as the corpus has today. The gap
//     was 273 against 290, then 290 against 291, and either makes every state name suspect.
//   * NOT EMPTY — a zero must not read as a pass (§11.2.2).
//   * ONE COPY — the teacher has no local table any more and reads `@corpus/fsm-ms.json`. That is the structural
//     half of the consolidation: a gate cannot see a second copy reappear any other way, and one did reappear
//     before (two builders, two assets, one gate).
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: rebuild the table. The edge-by-edge equality lives in `fsm-asset.mjs`
// and only there — a third comparison implementation is the duplication the consolidation removed. Run it when the
// cheap facts move: `node test/fsm-asset.mjs` (or `npm run verify --prefix engine`, which includes it).
//
// Run: node engine/test/fsm-asset-freshness.mjs   (from anywhere; needs `engine/dist`)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FSM_TABLE_SCHEMA_VERSION, FsmTable } from '../dist/index.js';
import { buildCatalog } from '../../poc-teacher/src/catalog.ts';
import { corpusRoot, filesRecord } from 'dancing-squared-corpus';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assetPath = path.join(corpusRoot(), 'fsm-ms.json');

let failures = 0;
const check = (cond, msg, detail) => {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}${detail ? `\n        ${detail}` : ''}`);
  }
};

console.log('== the FSM asset, against the two facts that have actually drifted ==');

const asset = JSON.parse(readFileSync(assetPath, 'utf8'));
const table = asset.table ?? {};
const edgeTotal = Object.values(table.edges ?? {}).reduce((n, list) => n + list.length, 0);
const msCatalog = buildCatalog(filesRecord('ms'));

console.log(`  asset: level ${asset.level}, built ${asset.builtAt ?? '(no stamp)'}, table built ${table.builtAt ?? '(no stamp)'}`);
console.log(`  asset: ${asset.catalogCount} catalog entries / ${table.states?.length ?? 0} states / ${edgeTotal} edges`);
console.log(`  today: ${msCatalog.length} ms catalog entries, engine schema ${FSM_TABLE_SCHEMA_VERSION}`);

check(asset.level === 'ms', `the asset is the ms table (level ${JSON.stringify(asset.level)})`);

// THE SCHEMA. A mismatch here is the failure that cannot be seen from the app: `FsmTable.load` returns null, the
// app falls back to a runtime build, and the only symptom is a console warning nobody reads.
check(table.schemaVersion === FSM_TABLE_SCHEMA_VERSION,
  `the asset records schema ${table.schemaVersion} and the engine reads ${FSM_TABLE_SCHEMA_VERSION}`,
  `\`FsmTable.load\` REFUSES a schema it does not know, so this asset would silently never load — run \`npm run build:fsm\``);

// THE CATALOGUE COUNT, built the same way the builder builds it (`filesRecord('ms')` -> `buildCatalog`), so the
// two cannot disagree about what `ms/` holds. A mismatch means the corpus moved and the table did not.
check(asset.catalogCount === msCatalog.length,
  `the asset was built from ${asset.catalogCount} ms catalog entries, and there are ${msCatalog.length} today`,
  `run \`npm run build:fsm\` at the repo root, then \`node engine/test/fsm-asset.mjs\` for the edge-by-edge verdict`);

check((table.states?.length ?? 0) > 0 && edgeTotal > 0,
  `and it is not an empty table (${table.states?.length ?? 0} states, ${edgeTotal} edges)`,
  'a zero here would mean the asset parsed but described nothing, which must not read as a pass');

// AND THE ENGINE'S OWN LOADER ACCEPTS IT, which is the failure the teacher app could not report: `FsmTable.load`
// returns null for a schema it does not know, and the app then builds the table at runtime and says so in one
// console line. The teacher's dead copy was exactly that case, so this check is the one that would have shown it
// without opening a browser.
check(FsmTable.load(table) !== null,
  'and `FsmTable.load` accepts it — the schema check above matters because this is the call that refuses a stale asset');

// ONE COPY, AND THAT IS THE STRUCTURAL HALF. The teacher used to ship `src/assets/fsm-table.json` generated by its
// own `scripts/build-fsm-table.mjs`; both are gone and the app reads the one asset through the `@corpus` alias.
check(!existsSync(path.join(root, 'poc-teacher', 'src', 'assets', 'fsm-table.json')),
  'the teacher ships no FSM table of its own — the second copy is still absent');
check(!existsSync(path.join(root, 'poc-teacher', 'scripts', 'build-fsm-table.mjs')),
  'and no second builder — `scripts/build-fsm-asset.mjs` is the only writer');
check(!existsSync(path.join(root, 'poc', 'scripts', 'build-fsm-asset.mjs')),
  'and the builder is not back under `poc/scripts/` — its home is `scripts/`, where its readers are');

const teacherMain = readFileSync(path.join(root, 'poc-teacher', 'src', 'main.ts'), 'utf8');
check(teacherMain.includes('@corpus/fsm-ms.json'),
  'the teacher app reads the ONE asset through the `@corpus` alias',
  'a plain relative import would spell the corpus location a second time (AGENTS.md §1)');

console.log(`\nfsm-asset-freshness: ${failures === 0 ? 'all checks hold' : `${failures} FAILED`} — the deep edge-by-edge gate is engine/test/fsm-asset.mjs`);
process.exit(failures === 0 ? 0 : 1);
