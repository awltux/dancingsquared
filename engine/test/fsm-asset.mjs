// ============================================================================================
// THE STORED FSM ASSET VS A REBUILD.
//
// WHY THIS EXISTS. `poc/src/assets/fsm-ms.json` is a GENERATED artefact: `poc/scripts/
// build-fsm-asset.mjs` builds the transition table from the shipped catalogue and serialises it, and
// the FSM view loads it so opening the view is instant instead of a ~40s runtime build. Nothing
// checked it. Rebuilding it once showed the drift in full: the SAME 155 states, but 2205 edges
// against the stored 1961, with 76 edges landing on a DIFFERENT end formation, 511 admitted
// applications with no edge at all, and 188 stored edges not reproduced. A generated artefact with
// no gate goes stale silently - this is the gate that was missing, and it is the reason the namer
// settlement could be measured at all.
//
// WHAT IT ASSERTS. The engine, building the table the way the generator builds it, must produce
// exactly what is on disk: the schema version, the state list (order included - the builder is
// deterministic), every state's outgoing edges as `(call, endFormation)` pairs, and the catalog
// count the asset records. Any difference in EITHER direction fails, so an improvement is re-pinned
// deliberately with its reason rather than absorbed silently.
//
// THE COUNTS ARE PINNED TOO, deliberately and separately from the equality check: equality alone
// would pass a rebuilt asset whose numbers had drifted, and the numbers are what the FSM's consumers
// are sized against. A change here is a decision to record, not a value to update.
//
// THE CATALOGUE IS BUILT THE GENERATOR'S WAY. `buildCatalog` is imported from
// `poc-teacher/src/catalog.ts` rather than re-implemented, so this gate cannot drift from the thing
// it guards. The engine is the WORKSPACE one (`../dist/index.js`), and `build-fsm-asset.mjs` imports
// the same module, so the parser both of them install is the same parser.
// ============================================================================================

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser } from '../dist/index.js';
import { buildCatalog, makeSequencer } from '../../poc-teacher/src/catalog.ts';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', 'poc', 'src', 'assets');
const read = (p) => readFileSync(path.join(assets, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// PINNED: the state and edge counts this asset is expected to hold. Re-pin with the reason.
//
// 155 / 1961 was the shape before the namer settlement. It is now 155 / 4656, and the growth is the
// point of the change rather than a side effect: `legalWithResults` admits every application that
// applies, so the 2937 applications that used to be dropped for an unnameable end are recorded - as
// edges whose `endFormation` is `null`, because the namer now REFUSES a tied best match and a board
// with a dancer outside the effective allowance instead of naming it after whichever candidate the
// library happened to hold first. `Face In` from a Static Square is the witness: it used to be
// `Static Square -> Static Square`, which it is not; it is now `null`.
const EXPECTED_STATES = 155;
const EXPECTED_EDGES = 4656;
const EXPECTED_CATALOG = 274;

const msFiles = {};
for (const f of readdirSync(path.join(assets, 'ms')).filter((f) => f.endsWith('.xml'))) {
  msFiles[`ms/${f}`] = read(`ms/${f}`);
}

const stored = JSON.parse(read('fsm-ms.json'));
const catalog = buildCatalog(msFiles);
const seq = makeSequencer(read('moves.xml'), read('formations.xml'), catalog);

console.log(`== the stored asset vs a rebuild (${catalog.length} catalog entries) ==`);
const t0 = Date.now();
const fresh = seq.transitionTable().serialize();
const seconds = ((Date.now() - t0) / 1000).toFixed(1);

const storedEdges = stored.table.edges ?? {};
const freshEdges = fresh.edges ?? {};

// ---------------------------------------------------------------- the counts
{
  const edgeTotal = (m) => Object.values(m).reduce((n, l) => n + l.length, 0);
  const nullEnds = (m) => Object.values(m).reduce((n, l) => n + l.filter((e) => e.endFormation == null).length, 0);
  const s = { states: stored.table.states.length, edges: edgeTotal(storedEdges) };
  const f = { states: fresh.states.length, edges: edgeTotal(freshEdges) };
  console.log(`  stored : ${s.states} states / ${s.edges} edges`);
  console.log(`  rebuilt: ${f.states} states / ${f.edges} edges   (${seconds}s)`);
  // REPORTED because it is the point of the namer settlement: an edge whose end the namer refuses is
  // RECORDED with `endFormation: null` instead of being dropped from the table. A silent count here
  // would be exactly the "instrument's silence" the repo keeps meeting.
  console.log(`  unnamed ends (recorded as null, not dropped): stored ${nullEnds(storedEdges)} of ${s.edges}, ` +
    `rebuilt ${nullEnds(freshEdges)} of ${f.edges}`);
  check(stored.catalogCount === catalog.length,
    `the asset was built from ${stored.catalogCount} catalog entries, the gate builds ${catalog.length}`);
  check(stored.catalogCount === EXPECTED_CATALOG && f.states === EXPECTED_STATES && f.edges === EXPECTED_EDGES,
    `the pinned counts hold (${EXPECTED_CATALOG} catalog / ${EXPECTED_STATES} states / ${EXPECTED_EDGES} edges)`);
}

// ---------------------------------------------------------------- structural equality
{
  check(stored.table.schemaVersion === fresh.schemaVersion,
    `schema version ${stored.table.schemaVersion} matches the engine's ${fresh.schemaVersion}`);

  const a = [...stored.table.states];
  const b = [...fresh.states];
  check(a.length === b.length && a.every((x, i) => x === b[i]),
    `the state list is identical, order included (${a.length})`);

  // Per state, compare the edge set as `call -> endFormation` pairs, both directions.
  const diffs = [];
  for (const state of fresh.states) {
    const sa = new Map((storedEdges[state] ?? []).map((e) => [e.call, e.endFormation ?? null]));
    const sb = new Map((freshEdges[state] ?? []).map((e) => [e.call, e.endFormation ?? null]));
    const onlyStored = [...sa.keys()].filter((k) => !sb.has(k));
    const onlyFresh = [...sb.keys()].filter((k) => !sa.has(k));
    const moved = [...sa.keys()].filter((k) => sb.has(k) && sa.get(k) !== sb.get(k));
    if (onlyStored.length || onlyFresh.length || moved.length) diffs.push({ state, onlyStored, onlyFresh, moved, sa, sb });
  }
  check(diffs.length === 0,
    diffs.length === 0
      ? `every state's edges are identical (${Object.values(freshEdges).reduce((n, l) => n + l.length, 0)} edges)`
      : `${diffs.length} state(s) differ from the stored asset`);
  for (const d of diffs.slice(0, 8)) {
    if (d.onlyStored.length) console.log(`      ${d.state}: ${d.onlyStored.length} stored edge(s) not rebuilt, e.g. ${d.onlyStored.slice(0, 3).join(', ')}`);
    if (d.onlyFresh.length) console.log(`      ${d.state}: ${d.onlyFresh.length} rebuilt edge(s) not stored, e.g. ${d.onlyFresh.slice(0, 3).join(', ')}`);
    if (d.moved.length) {
      console.log(`      ${d.state}: ${d.moved.length} edge(s) land elsewhere, e.g. ` +
        d.moved.slice(0, 3).map((c) => `${c}: ${d.sa.get(c) ?? '(none)'} -> ${d.sb.get(c) ?? '(none)'}`).join('; '));
    }
  }
}

console.log(`\nfsm-asset: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
