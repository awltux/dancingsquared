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
// 155 / 4656 was the shape before the level scope (Stage 0b). It is now 65 / 2260, and the shrink is
// the point of the change rather than a side effect: the state set's NAMED half used to be all of
// `formations.xml` (134 whole-set names), so 100 named formations no ms tam references were states -
// `Static Facing Out`, `Right-Hand Zs`, `Single File Promenade`, `Star Promenade` and the rest. A
// state is a formation a caller can be standing in, and a programme only lets a caller stand where
// its own calls begin, so the named half is now the names the REGISTERED calls declare (42 names) and
// the scope is the call set itself - which is where the level already lives (`poc/src/data.ts`
// `sequencerCallsUpTo`). 41 of the 42 are also registered start setups, so the named half adds no
// geometry at all; it supplies the human-readable KEYS for 42 of the 65 states, and the other 23 stay
// `@embed#N`.
//
// The unnamed-end share rises with it, and that is arithmetic rather than a regression: 1648 of 2260
// (72.9%) against 2937 of 4656 (63.1%). The edges that disappeared are the ones leaving the 100
// out-of-scope states; the ones that remain land off the (now smaller) lattice more often.
const EXPECTED_STATES = 65;
const EXPECTED_EDGES = 2260;
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

// ---------------------------------------------------------------- the level scope (Stage 0b)
//
// THE LEAK ASSERTION. A state is a formation a caller can be standing in, and the engine only lets a
// caller stand where a registered call begins - so no state may be a NAMED formation that no
// registered `<tam>` references through `formation="..."`. Before Stage 0b the named half was all of
// `formations.xml` and 100 of its 134 whole-set names failed this.
//
// It is asserted on the LIVE library rather than on the asset's text because the asset is a
// generated artefact and the question is about the generator. The `@embed#N` states are exempt by
// construction: they are start setups, which is the other, already-scoped source.
{
  const referenced = seq.library.referencedFormationNames();
  const whole = seq.library.getUniqueFormations().map((f) => f.name);
  const outOfScope = whole.filter((n) => !referenced.has(n));
  const states = fresh.states;
  const named = states.filter((s) => !s.startsWith('@embed#'));
  const leaked = named.filter((s) => !referenced.has(s));
  console.log(`\n== the level scope ==`);
  console.log(`  formations.xml whole-set names        : ${whole.length}`);
  console.log(`  referenced by a registered ms tam     : ${referenced.size}`);
  console.log(`  out of scope (no ms tam references it): ${outOfScope.length}`);
  console.log(`  states: ${states.length} (${named.length} named, ${states.length - named.length} @embed)`);
  // THE REPRESENTATIVE MOVES, and that is the scoping working rather than a side effect. A geometry
  // shared by several names is keyed by the FIRST in `formations.xml` order, and when that name is
  // out of scope the scoped dedupe keeps the first name that IS in scope - the level's own name for
  // the shape. MEASURED: 8 of the 42 named states are renamed this way (`Ocean Waves RH BGGB`,
  // `Two-Faced Lines RH`, `Diamonds RH Girl Points`, `Column RH GBGB`, `Tidal Wave RH BGGB` ...).
  // Reported, not asserted, because the count is a property of the corpus's alias order.
  const flatRep = new Map();
  for (const f of seq.library.getUniqueFormations()) flatRep.set(f.name, f);
  const renamed = named.filter((s) => !flatRep.has(s));
  console.log(`  named states that are in-scope ALIASES rather than the flat key: ${renamed.length}`);
  if (renamed.length) console.log(`    ${renamed.join(', ')}`);
  check(leaked.length === 0,
    leaked.length === 0
      ? `no state is a formation no registered call can be used from (${named.length} named states, all referenced)`
      : `${leaked.length} state(s) are out of scope, e.g. ${leaked.slice(0, 5).join(', ')}`);
  check(named.length <= referenced.size,
    `the named states (${named.length}) do not outnumber the referenced names (${referenced.size})`);
  // The scope is a SUBSET of what the corpus declares, never a superset: scoping may only remove.
  // Checked against ALL whole-set corpus names (`getNamedFormations`), not the flat dedupe, because
  // an in-scope alias is a declared name that simply was not the flat representative.
  const declared = new Set(seq.library.getNamedFormations().map((f) => f.name));
  const invented = named.filter((s) => !declared.has(s));
  check(invented.length === 0,
    invented.length === 0
      ? 'every named state is a formation the corpus declares (the scope removes, it does not invent)'
      : `${invented.length} named state(s) are not declared formations: ${invented.slice(0, 5).join(', ')}`);
}

console.log(`\nfsm-asset: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
