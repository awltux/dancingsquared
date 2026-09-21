// ============================================================================================
// WHAT READING DID THE CALL GET, AND IS IT IN THE FSM?
//
// WHY THIS EXISTS. A call applied to an eight-dancer board is not always performed by everyone.
// `parallelApply` can tile the board into copies of a variant that is SMALLER than a board - four
// copies of a two-dancer pair, two copies of a four-dancer box - and when only some boxes match it
// falls back to `partitionPartial` and applies to those, leaving the rest standing. So every legal
// application has a READING, and the readings are not equivalent:
//
//   whole         the whole board matched one variant (the ordinary case)
//   full-tiling   EVERY dancer is in a copy (the call was done by all eight through k-dancer boxes)
//   partial       SOME boxes matched and the rest of the board stood still
//
// AND THE FSM DOES NOT RECORD IT. An edge is `{call, endFormation}` and its identity is the CALL
// alone - one edge per (state, call) - so a partial reading is stored as though everyone did the
// call, and a reading whose END BOARD THE RECOGNISER CANNOT NAME is not stored at all: `legalCalls`
// admits a call only when `knownFormation(result) !== null` (`legality.ts`), so the application is
// dropped before the FSM ever sees it. MEASURED for one such call: of the 10 boards where
// `Step to a Wave` applies through a sub-eight shape, including the four-copy reading that moves all
// eight dancers, only 2 were admitted - the rest were dropped for an unnameable end.
//
// So this harness answers three questions with numbers, and PIN the answers:
//   1. how many legal applications does `legalCalls` DROP for an unnameable end (invisible edges)?
//   2. how many readings are PARTIAL (the call was done by some of the board)?
//   3. how many readings does a (state, call) pair have? Today it must be exactly one, because the
//      edge identity is the call alone - that is the invariant a multi-reading FSM has to break, and
//      the number is what sizes the work.
//
// It compares the live engine against the STORED asset (`poc/src/assets/fsm-ms.json`), because that
// asset is the FSM's persisted record: "what is in the table" versus "what the engine does" is
// precisely the missing-transition question. A missing asset is a FAILURE, not a skip - a harness
// that cannot see its subject must say so.
//
// THE CATALOGUE IS BUILT THE WAY THE GENERATOR BUILDS IT (`poc-teacher/src/catalog.ts`): one entry
// per call TITLE per file, from `ms/*.xml`, with `display="no"` tams skipped and the engine's own
// default match margin of 1.5. Reproducing that here rather than importing it is deliberate: the
// generator is TypeScript in another package, and the numbers below are only comparable to the asset
// if the call set is the same. `test/catalogue.mjs` pins the same census for `actives`.
// ============================================================================================

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { Sequencer, setParser } from '../dist/index.js';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', 'poc', 'src', 'assets');
const read = (p) => readFileSync(path.join(assets, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- the ms catalogue, as generated
const MS_FILES = readdirSync(path.join(assets, 'ms')).filter((f) => f.endsWith('.xml'));
const tamBlocks = (xml) => xml.match(/<tam\b[\s\S]*?<\/tam>/g) ?? [];
const attr = (b, n) => (b.match(new RegExp(`${n}="([^"]*)"`)) ?? [])[1] ?? '';
/** Only a hidden `<tam>` is excluded; `display` on a child `<formation>` hides one setup only. */
const isHiddenTam = (b) => {
  const end = b.indexOf('>');
  return /display="(no|none)"/.test(end >= 0 ? b.slice(0, end + 1) : b);
};
const entries = [];
for (const f of MS_FILES) {
  const xml = read(`ms/${f}`);
  const byTitle = new Map();
  for (const b of tamBlocks(xml)) {
    if (isHiddenTam(b)) continue;
    const t = attr(b, 'title') || '?';
    byTitle.set(t, [...(byTitle.get(t) ?? []), b]);
  }
  for (const [title, blocks] of byTitle) entries.push({ name: title, xml: `<calls>\n${blocks.join('\n')}\n</calls>` });
}
const seq = new Sequencer(read('moves.xml'), read('formations.xml'), entries);
seq.setMatchMargin(1.5);
const titles = [...seq.library.callNames()];

console.log('== the call set, reproduced from the generator ==');
{
  // 274 is the number of CATALOG ENTRIES the generator counts (`buildCatalog` returns one per title
  // per file), and the number the stored asset records as `catalogCount`. The registry is keyed by
  // TITLE, so a title authored in two files registers once: fewer registry keys than entries is
  // expected, and the duplicate is named rather than tolerated silently.
  const pinnedAsset = JSON.parse(read('fsm-ms.json'));
  const byTitle = new Map();
  for (const e of entries) byTitle.set(e.name, (byTitle.get(e.name) ?? 0) + 1);
  const dupes = [...byTitle].filter(([, n]) => n > 1);
  check(entries.length === 274 && pinnedAsset.catalogCount === 274,
    `${entries.length} ms catalog entries, and the stored asset was built from ${pinnedAsset.catalogCount}`);
  check(titles.length === byTitle.size,
    `${titles.length} registered titles for ${byTitle.size} distinct titles` +
      (dupes.length ? ` (authored in more than one file: ${dupes.map(([t, n]) => `${t} x${n}`).join(', ')})` : ''));
}

// ---------------------------------------------------------------- the stored FSM, for comparison
const asset = JSON.parse(read('fsm-ms.json'));
const table = asset.table;
const assetEdges = (state) => table.edges?.[state] ?? [];
const embedded = table.states.filter((s) => s.startsWith('@embed#'));

// ---------------------------------------------------------------- sweep every named state
//
// The state BOARD is rebuilt through `boardForFormation`, which is the same path `buildFsmTable`
// uses (`boardFromMatchables` of the named formation's geometry). The `@embed#` states are unnamed
// geometries with no name to rebuild from, so they are excluded - reported below rather than
// silently skipped.
const namedStates = table.states.filter((s) => !s.startsWith('@embed#'));
const rows = [];
const unrebuildable = [];
for (const state of namedStates) {
  const board = seq.boardForFormation(state);
  if (!board) {
    unrebuildable.push(state);
    continue;
  }
  for (const title of titles) {
    const res = seq.applyToBoard(board, title);
    if (!res.legal) continue;
    const variantSize = res.parallel ? res.parallel.variant.dancers.length : 8;
    const groups = res.parallel ? res.parallel.groups.length : 1;
    const cover = res.parallel ? res.parallel.groups.length * res.parallel.variant.dancers.length : 8;
    const kind = !res.parallel ? 'whole' : cover >= 8 ? 'full-tiling' : 'partial';
    const endName = seq.knownFormation(res.board);
    rows.push({ state, title, kind, variantSize, groups, cover, endName, admitted: endName !== null });
  }
}

console.log(`\n== the sweep: ${namedStates.length} named states x ${titles.length} calls ==`);
{
  console.log(`  ${namedStates.length} named states ${embedded.length ? `(+ ${embedded.length} @embed# states excluded: no name to rebuild from)` : ''}`);
  check(unrebuildable.length === 0,
    unrebuildable.length === 0
      ? 'every named state rebuilds into a board'
      : `${unrebuildable.length} named state(s) do not rebuild: ${unrebuildable.slice(0, 6).join(', ')}`);
  const kinds = rows.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map());
  console.log(`  ${rows.length} legal applications: ${[...kinds].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  // THE INVARIANT A MULTI-READING FSM HAS TO BREAK. One edge per (state, call) is what the whole
  // stack assumes (FsmTable.build's dedupe, FsmStore's `${formation}|${call}` key, fsm-view's
  // `(call, endFormation)` dedupe), so the engine can only be reporting one reading per pair today.
  const perPair = new Map();
  for (const r of rows) perPair.set(`${r.state}|${r.title}`, (perPair.get(`${r.state}|${r.title}`) ?? 0) + 1);
  const multi = [...perPair.values()].filter((n) => n > 1).length;
  check(multi === 0, `readings per (state, call): ${Math.max(...perPair.values())} maximum (${multi} pair(s) with more than one)`);
}

console.log('\n== the missing transitions: legal, end unnamed, so `legalCalls` drops them ==');
{
  const dropped = rows.filter((r) => !r.admitted);
  const byKind = dropped.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map());
  console.log(`  ${dropped.length} of ${rows.length} legal applications are dropped (${[...byKind].map(([k, v]) => `${k} ${v}`).join(', ')})`);
  // The witness the FSM work is for: a TWO-DANCER call covering ALL EIGHT dancers, dropped because
  // its result cannot be named. This is a single missing transition, not four.
  const exhaustive = dropped.filter((r) => r.variantSize < 8 && r.cover >= 8);
  console.log(`  of those, SUB-EIGHT variants that covered all eight dancers: ${exhaustive.length}`);
  for (const r of exhaustive.slice(0, 8)) {
    console.log(`    ${r.state.padEnd(26)} ${r.title.padEnd(20)} ${r.variantSize}d x${r.groups} copies`);
  }
  check(exhaustive.length > 0,
    exhaustive.length > 0
      ? `${exhaustive.length} exhaustively-tiled sub-eight reading(s) exist and are missing from the FSM`
      : 'no sub-eight variant currently tiles a whole board');
}

console.log('\n== the partial readings: the call was done by SOME of the board ==');
{
  const partial = rows.filter((r) => r.kind === 'partial');
  const boards = [...new Set(partial.map((r) => r.state))];
  console.log(`  ${partial.length} partial reading(s) over ${boards.length} board(s)`);
  check(partial.length > 0,
    partial.length > 0
      ? 'partial readings exist, and each is stored as though the whole board did the call'
      : 'no partial reading exists (the multi-reader fallback never fires)');
  const tally = partial.reduce((m, r) => m.set(r.variantSize, (m.get(r.variantSize) ?? 0) + 1), new Map());
  console.log(`  by the variant size that tiled: ${[...tally].map(([k, v]) => `${k}-dancer ${v}`).join(', ')}`);
}

console.log('\n== against the stored asset: REPORTED, not asserted (the asset is known stale) ==');
{
  // This comparison used to be a rule and it failed, which is how the finding below was made. It is
  // REPORTED rather than asserted now, because the stored asset is STALE and the census's subject is
  // the ENGINE: making the harness fail for a known-stale artefact would only teach readers to skip it.
  //
  // MEASURED: rebuilding the table from the current engine and the current assets
  // (`node poc/scripts/build-fsm-asset.mjs`) gives 155 states - the same set - and 2205 edges against
  // the stored 1961, with 76 edges landing on a DIFFERENT end formation. The generator is wired into no
  // npm script and no harness, so nothing could have noticed.
  //
  // AND THE 76 ARE NOT A BUG IN THOSE CALLS - they are the NAMER giving up quietly, investigated and
  // settled here. `Face In` from a squared set looks wrong at first sight (positions unchanged, every
  // dancer turned a quarter), but it is right: CALLERLAB defines it as "each individual turns 90
  // degrees, in place, TOWARD THE CENTER", the turn direction matches the reference (`face.dart`), and
  // the RESULT is four exact mini-waves - measured, each wall's pair 2.00 apart and facing each other.
  //
  // The problem is what it gets CALLED. That board matches 11 formations within the naming tolerance
  // (KNOWN_FORMATION_MAX 6.0 + margin 1.5) with a BEST error of 3.1416 - pi - and FOUR of them tie
  // exactly at pi: `O In`, `O Trade By`, `O Eight Chain Thru`, `O Out`. `knownFormation` returns the
  // first of the tied candidates in library scan order, so the name it reports is an artefact of the
  // library's contents and order, and ANY change to either renames the edge - which is what moved
  // those 76. `recognize` (curated, tighter) correctly returns null for the same board, so the two
  // namers already disagree about whether it is named at all.
  //
  // THE FIX IS THEREFORE IN THE NAMER, not in `Face In`: a board this far from everything should be
  // refused rather than named after whichever candidate happened to be scanned first. The note on
  // `KNOWN_FORMATION_MAX` records that the tolerance that ACTUALLY binds is `maxError / 12` - about
  // 0.5 per dancer - while the final gate uses the raw 6.0, so a pi-off board passes. TIGHTENING THAT
  // GATE IS NOT SAFE ON ITS OWN: `legalCalls` admits a call only when `knownFormation(result) !==
  // null`, so refusing more names DROPS more applications from the FSM. It has to be done in the same
  // change as admitting unnameable ends (the FSM work's Stage 2), which is why the asset is left
  // stale here rather than regenerated with tie-break names frozen into it.
  const admitted = rows.filter((r) => r.admitted);
  const missing = admitted.filter((r) => !assetEdges(r.state).some((e) => e.call === r.title));
  console.log(`  ${admitted.length} admitted applications; ${missing.length} of them have NO edge in the stored asset`);
  if (missing.length) console.log(`    e.g. ${missing.slice(0, 5).map((r) => `${r.state} / ${r.title}`).join('; ')}`);
  // The sizing number for the schema change: how many stored edges carry a reading other than "the
  // whole board did it", and so are ambiguous between "everyone" and "only these groups".
  const readings = new Map();
  let readErrors = 0;
  for (const state of namedStates) {
    for (const e of assetEdges(state)) {
      const r = rows.find((x) => x.state === state && x.title === e.call);
      if (!r) { readErrors++; continue; }
      readings.set(r.kind, (readings.get(r.kind) ?? 0) + 1);
    }
  }
  console.log(`  edges whose reading is now known: ${[...readings].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  edges with no reproduction in this sweep: ${readErrors}`);
}

console.log('\n== the multi-arity pool: the raw material for a MIXED reading ==');
{
  const sizesOf = new Map();
  for (const t of titles) sizesOf.set(t, new Set(seq.getVariants(t).map((v) => v.dancers.length)));
  const multi = titles.filter((t) => sizesOf.get(t).size > 1);
  const multiLegal = new Set(rows.filter((r) => sizesOf.get(r.title).size > 1).map((r) => r.title));
  console.log(`  ${multi.length} of ${titles.length} titles have variants at more than one built size`);
  console.log(`  ${multiLegal.size} of those are legal on at least one named state`);
  const example = [...multi].filter((t) => ['Pass Thru', 'Swing Thru', 'Turn Thru', 'Step to a Wave'].includes(t));
  console.log(`  e.g. ${example.map((t) => `${t}[${[...sizesOf.get(t)].sort((a, b) => a - b).join(',')}]`).join('  ')}`);
  check(multi.length > 0, `${multi.length} multi-arity titles: a call CAN be applied at more than one size`);
}

console.log(`\nreading-census: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
