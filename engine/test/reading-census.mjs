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
// AND THE FSM NOW RECORDS THE READING, IF NOT THE PARTIALITY. An edge is `{call, endFormation}` and
// its identity is the CALL alone - one edge per (state, call) - so a partial reading is stored as
// though everyone did the call. What has CHANGED (the namer settlement) is the other half: an
// application whose END THE NAMER REFUSES is no longer dropped from the list at all. `legalWithResults`
// admits every application that applies, and the FSM stores the ones with no name as an edge with
// `endFormation: null` - "the call applies and lands where the engine cannot name". MEASURED, over the
// 42 named states the scoped state set holds x 273 ms calls = 1885 legal applications:
//
//   named end       889   (whole 659, full-tiling 118, partial 112)
//   UNNAMED end     996   (whole 373, full-tiling 386, partial 237)  <- previously dropped entirely
//
// of which 386 are sub-eight readings that covered ALL EIGHT dancers: the call was performed by
// everyone and used to be recorded as nothing at all.
//
// THE STATE COUNT FELL FROM 133 TO 42, and that is Stage 0b rather than a change here: the named half
// of the FSM's state set is now the formations a REGISTERED ms CALL is used from (`library
// .referencedFormations()`), instead of the whole of `formations.xml`. The old sweep was 133 named
// states x 273 calls = 4416 applications, 2169 of them unnamed. Both figures are quoted in
// PLAN.md; this is the re-measurement after the scope.
//
// WHY THE NAMER REFUSES MORE THAN IT USED TO (and why that used to be unsafe). `knownFormation` now
// refuses a TIED best match (a tied best is not an identity - the `Face In` board ties `O In` with
// `O Trade By` at exactly pi) and a board with any single dancer outside the effective allowance
// (`maxError / 12`, the tolerance the match's own distance-signature filter already applies to
// positions but not to facings). Refusing more names ALONE would have silently removed applications,
// which is why it had to land with admitting unnamed ends.
//
// So this harness answers four questions with numbers, and PIN the answers:
//   1. how many legal applications end on a board the namer refuses (recorded as a null-end edge)?
//   2. how many readings are PARTIAL (the call was done by some of the board)?
//   3. how many readings does a (state, call) pair have? Today it must be exactly one, because the
//      edge identity is the call alone - that is the invariant a multi-reading FSM has to break, and
//      the number is what sizes the work.
//   4. what could a MIXED (multi-size) reading actually reach? MEASURED: nothing. The pool is two
//      titles, one shape, and every board where it matches is already applied. The zero is PINNED,
//      so a catalogue change that creates a witness fails here instead of silently unblocking a
//      mechanism with no evidence behind it. See the section itself for the size-set breakdown.
//
// It compares the live engine against the STORED asset (`poc/src/assets/fsm-ms.json`), because that
// asset is the FSM's persisted record. A missing asset is a FAILURE, not a skip - a harness that
// cannot see its subject must say so. The comparison here is REPORTED rather than asserted; the
// staleness ASSERTION lives in `test/fsm-asset.mjs`, which rebuilds the table and fails when the
// stored asset disagrees (that is the gate that was missing, and its absence is how the asset went
// stale in the first place).
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

import { Sequencer, setParser, matchFormations, partitionsFor, CODED_MOVE_NAMES } from '../dist/index.js';

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
// The state BOARD is rebuilt through `stateBoard`, which is the SAME board `buildFsmTable` enumerates
// from. It used to be `boardForFormation` - geometrically identical, so it made no difference, until
// the named states gained their canonical identity: identity is what the couple-dependent vocabulary
// reads, so a `Heads ...` call is ILLEGAL from the anonymous board and legal from the real one, and
// the 48 edges that change left the comparison below as "excluded". `stateBoard` is a Sequencer method
// rather than a rule re-stated here precisely so the two cannot drift.
//
// The `@embed#` states are unnamed geometries with no name to rebuild from, so they are excluded -
// reported below rather than silently skipped.
const namedStates = table.states.filter((s) => !s.startsWith('@embed#'));
const rows = [];
const unrebuildable = [];
for (const state of namedStates) {
  const board = seq.stateBoard(state);
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

console.log('\n== the unnamed ends: the namer refuses them, the FSM records them as a null end ==');
{
  const unnamed = rows.filter((r) => !r.admitted);
  const byKind = unnamed.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1), new Map());
  console.log(`  ${unnamed.length} of ${rows.length} legal applications end on a board the namer refuses (${[...byKind].map(([k, v]) => `${k} ${v}`).join(', ')})`);
  console.log(`  ${rows.length - unnamed.length} end on a named board, which is what the FSM's state key is built from`);
  // The witness the FSM work is for: a TWO-DANCER call covering ALL EIGHT dancers. Before the namer
  // settlement these were dropped from the list entirely; now each is one recorded edge with a null
  // end, which is the honest record until the schema change gives the READING its own edge identity.
  const exhaustive = unnamed.filter((r) => r.variantSize < 8 && r.cover >= 8);
  console.log(`  of those, SUB-EIGHT variants that covered all eight dancers: ${exhaustive.length}`);
  for (const r of exhaustive.slice(0, 8)) {
    console.log(`    ${r.state.padEnd(26)} ${r.title.padEnd(20)} ${r.variantSize}d x${r.groups} copies`);
  }
  check(exhaustive.length > 0,
    exhaustive.length > 0
      ? `${exhaustive.length} exhaustively-tiled sub-eight reading(s) are recorded with a null end`
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

console.log('\n== against the stored asset: REPORTED, not asserted (the staleness ASSERTION is fsm-asset.mjs) ==');
{
  // REPORTED rather than asserted here: the staleness ASSERTION is `test/fsm-asset.mjs`, which
  // rebuilds the table and fails when the stored asset disagrees. Before that gate existed the asset
  // went stale silently - 1961 stored edges against the 2205 the engine produced, with 76 edges
  // landing somewhere else - and nothing could have noticed.
  //
  // AND THE 76 WERE THE NAMER GIVING UP QUIETLY, which is the finding that settled it. `Face In` from
  // a squared set looked wrong at first sight (positions unchanged, every dancer turned a quarter),
  // but it is right: CALLERLAB defines it as "each individual turns 90 degrees, in place, TOWARD THE
  // CENTER", the turn direction matches the reference (`face.dart`), and the RESULT is four exact
  // mini-waves - measured, each wall's pair 2.00 apart and facing each other.
  //
  // The problem was what it got CALLED. That board matches `O In` and `O Trade By` at EXACTLY the
  // same error, pi, and `knownFormation` returned whichever the library happened to hold first - so
  // the name was an artefact of the library's contents and order, and any change to either renamed
  // the edge, which is what moved those 76. `knownFormation` now REFUSES a tied best match, and that
  // board is recorded with a null end instead of a false name. The note on `KNOWN_FORMATION_MAX`
  // already recorded that the tolerance that actually binds is `maxError / 12` - about 0.625 per
  // dancer - while the final gate used the raw sum; the namer now applies that allowance to each
  // dancer, which is what refuses `Boys Turn Back` from `Stars RH` being called `Stars RH` with one
  // dancer 180 degrees out.
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

  // ---------------------------------------------------------------- THE READING CROSS-CHECK
  //
  // THE STORED EDGE NOW SAYS WHAT THE APPLICATION DID, and this harness recomputes it. The join has to be
  // on THE APPLICATION THE TABLE SAYS IT PERFORMED, and getting that wrong is instructive enough to record.
  //
  // `buildFsmTable` uses the APPLICATOR for any call `legalCalls` admits, and the CODED rule only for a
  // name the catalogue does not have - deliberately, and its own comment says why. But `Sequencer.applyToBoard`
  // is CODED-FIRST, and SEVERAL coded moves are ALSO catalogue titles - the line below names the ones
  // shipped today. So a sweep that
  // applies every title through `applyToBoard` is measuring the CODED `Swing Thru` where the FSM recorded the
  // CATALOGUE one. MEASURED before this was noticed: 38 readings disagreed, EVERY ONE of them "table says
  // partial, sweep says whole" on `Stars RH` / `Stars LH`, and the cause is that the coded `Swing Thru`
  // reports no `parallel` structure while the catalogue authoring applies a 4-dancer variant to a quarter of
  // the board. Both readings are real; they are readings of DIFFERENT applications.
  //
  // So this file's own reading census above (whole 1032 / full-tiling 504 / partial 349) is the CODED-FIRST
  // census, and the FSM's is the applicator's. That is worth knowing on its own, and it is why the
  // comparison below dispatches the way the table did.
  {
    let compared = 0;
    let excluded = 0;
    let readingDiff = 0;
    const examples = [];
    const codedNames = new Set(CODED_MOVE_NAMES);
    let codedOnly = 0;
    for (const state of namedStates) {
      const board = seq.stateBoard(state);
      if (!board) continue;
      const legal = new Set(seq.legalCalls(board));
      for (const e of assetEdges(state)) {
        if (e.source !== 'build') { excluded++; continue; }
        // THE SAME APPLICATION THE TABLE PERFORMED: the applicator route for a call `legalCalls` admits
        // (`{call}` skips `tryCodedMove`), the coded route otherwise. `applyToBoard` with a bare string is
        // coded-first, which is exactly right for the second case.
        let res;
        try {
          res = legal.has(e.call) ? seq.applyToBoard(board, { call: e.call }) : seq.applyToBoard(board, e.call);
        } catch { excluded++; continue; }
        if (!res.legal) { excluded++; continue; }
        if (!legal.has(e.call)) codedOnly++;
        compared++;
        const variantSize = res.parallel ? res.parallel.variant.dancers.length : 8;
        const cover = res.parallel ? res.parallel.groups.length * variantSize : 8;
        const kind = !res.parallel ? 'whole' : cover >= 8 ? 'full-tiling' : 'partial';
        if (e.reading !== kind) {
          readingDiff++;
          if (examples.length < 5) examples.push(`${state} / ${e.call}: table says ${e.reading}, re-applied says ${kind}`);
        }
      }
    }
    console.log(`\n  the READING cross-check, re-applying each edge the way the table did:`);
    console.log(`    compared ${compared} build edges (${codedOnly} of them through the coded route), excluded ${excluded}`);
    for (const x of examples) console.log(`      MISMATCH ${x}`);
    check(readingDiff === 0,
      readingDiff === 0
        ? `every stored reading is the one a fresh application produces (${compared} compared)`
        : `${readingDiff} edge(s) disagree about the reading`);
    check(compared > 500,
      `${compared} edges were comparable - the cross-check is not vacuous`);
    // AND THE EXCLUSION IS ASSERTED, which is the hole this harness walked through. `excluded` counts
    // build edges the sweep could not reproduce, and it was REPORTED but never checked - so when the
    // named states gained their canonical identity, the 48 edges that changed (`Heads ...`/`Sides ...`
    // calls, illegal from a board with no couples) left the comparison without anything going red. A
    // cross-check that silently shrinks is the instrument's silence, not a smaller cross-check. Nothing
    // here builds amendment edges, so every build edge must be reproducible.
    check(excluded === 0,
      excluded === 0
        ? 'every build edge on a named state was reproducible, so none left the comparison'
        : `${excluded} build edge(s) were NOT reproducible and silently left the cross-check`);
    // And the reading is not vacuous either: the FSM must record MORE THAN the whole-board case, or the
    // field would be a constant and the cross-check would prove nothing.
    const storedReadings = new Map();
    for (const state of namedStates) for (const e of assetEdges(state)) storedReadings.set(e.reading, (storedReadings.get(e.reading) ?? 0) + 1);
    console.log(`    stored readings on the named states: ${[...storedReadings].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    check((storedReadings.get('partial') ?? 0) > 0 && (storedReadings.get('full-tiling') ?? 0) > 0,
      'the stored reading distinguishes all three cases, so the field is a measurement rather than a constant');
    // THE DIVERGENCE ITSELF, reported because it is a live fact about the engine and the reason this join
    // needed explaining: several coded moves are also catalogue titles, and the two authorings do not agree.
    console.log(`    coded moves that are also catalogue titles: ${[...codedNames].filter((n) => titles.includes(n)).join(', ')}`);
  }
}

console.log('\n== the multi-arity pool: what a MIXED reading could actually reach ==');
{
  // The plan called this "the pool for a MIXED reading" on the strength of a title COUNT, and the
  // count was misleading in a way that decides the next step. A mixed reading is a partition of the
  // board into blocks of MORE THAN ONE distinct size; `parallelApply` can only tile with copies of
  // ONE variant, so a call whose variants span sizes could in principle act on two dancers in one
  // place and four in another at once. MEASURED, it cannot reach anything the engine does not
  // already do, and the reason is the SIZE SETS rather than the boards:
  //
  //   {4,8}   104 titles  no mixed shape at all: 8 IS the whole-board apply, and [4,4] is already
  //                       reachable homogeneously. This is 104 of the 107 "multi-arity" titles.
  //   {6,8}     1 title   `Column Circulate`: 8 - 6 = 2 and it has no 2-dancer authoring.
  //   {2,4,8}   2 titles  `Step to a Wave`, `Step to a Left-Hand Wave` - the ENTIRE mixed pool, whose
  //                       only mixed shape is 4+2+2 (210 labelled partitions each).
  //
  // The yield is then a measurement rather than a hope: over the FSM's own boards, count the boards
  // where EVERY block of some mixed partition matches a variant of its own size AND the engine does
  // not already apply the call. It is ZERO, and the zero is pinned below - so a catalogue change that
  // creates a mixed pool fails this gate and forces the decision instead of silently unblocking it.
  // That is the plan's own rule ("each new reading has to be justified against a witness before it is
  // admitted") applied to the plan's own next step.
  const sizesOf = new Map();
  for (const t of titles) sizesOf.set(t, [...new Set(seq.getVariants(t).map((v) => v.dancers.length))].sort((a, b) => a - b));
  const multi = titles.filter((t) => sizesOf.get(t).length > 1);
  const setCounts = new Map();
  for (const t of multi) {
    const s = sizesOf.get(t).join(',');
    setCounts.set(s, (setCounts.get(s) ?? 0) + 1);
  }
  console.log(`  ${multi.length} of ${titles.length} titles have variants at more than one built size`);
  console.log(`  their size sets: ${[...setCounts].sort((a, b) => b[1] - a[1]).map(([s, n]) => `{${s}} x${n}`).join(', ')}`);
  check(multi.length === 107 && [...setCounts].map(([s, n]) => `${s}:${n}`).sort().join(' ') === '2,4,8:2 4,8:104 6,8:1',
    `the multi-arity pool is ${multi.length} titles in exactly the three measured size sets (104 of them a set that admits no mixed shape)`);

  // A title is only in the MIXED pool if it has two or more usable (non-8) sizes - 8 is the
  // whole-board apply and cannot share a partition with anything.
  const mixedTitles = multi.filter((t) => sizesOf.get(t).filter((k) => k >= 2 && k < 8).length >= 2);
  console.log(`  titles with two or more usable (non-8) sizes - the whole mixed pool: ${mixedTitles.join(', ') || 'none'}`);

  // The boards: the named FSM states AND the embedded (inline) setups, so the zero is not an artefact
  // of sweeping only the named half.
  const mixedBoards = [];
  for (const s of namedStates) {
    const b = seq.stateBoard(s);
    if (b) mixedBoards.push(b);
  }
  for (const setup of seq.library.allVariantSetups()) {
    mixedBoards.push({
      dancers: setup.map((d, i) => ({ id: i + 1, couple: d.couple ?? 0, gender: d.gender ?? 'phantom', x: d.x, y: d.y, heading: d.heading })),
    });
  }
  // `parallelApply`'s own tolerance: DEFAULT_MATCH_MAX + the generator's margin.
  const tol = 1.5 + 1.5;
  let matchingBoards = 0;
  let newApplications = 0;
  for (const title of mixedTitles) {
    const bySize = new Map();
    for (const v of seq.getVariants(title)) {
      const k = v.dancers.length;
      bySize.set(k, [...(bySize.get(k) ?? []), v]);
    }
    const usable = [...bySize.keys()].filter((k) => k >= 2 && k < 8);
    for (const board of mixedBoards) {
      const phys = board.dancers.filter((d) => !d.isGhost);
      if (phys.length !== 8) continue;
      const already = seq.applyToBoard(board, title).legal;
      const { partitions } = partitionsFor(phys, usable);
      for (const part of partitions) {
        if (new Set(part.map((b) => b.length)).size < 2) continue; // homogeneous: `parallelApply`'s job
        let all = true;
        for (const group of part) {
          const src = group.map((d) => ({ x: d.x, y: d.y, heading: d.heading, gender: d.gender, couple: d.couple }));
          let ok = false;
          for (const v of bySize.get(group.length) ?? []) {
            const m = matchFormations(src, v.dancers.map((d) => seq.library.variantMatchable(d)), tol);
            if (m && !m.subset) { ok = true; break; }
          }
          if (!ok) { all = false; break; }
        }
        if (!all) continue;
        matchingBoards++;
        if (!already) newApplications++;
        break; // one witness per board is enough
      }
    }
  }
  console.log(`  ${mixedBoards.length} boards swept (${namedStates.length} named + ${mixedBoards.length - namedStates.length} embedded setups)`);
  console.log(`  boards where every block of a MIXED partition matches a variant of its own size: ${matchingBoards}`);
  console.log(`  of those, boards the engine does NOT already apply the call on: ${newApplications}`);
  check(matchingBoards > 0 && newApplications === 0,
    newApplications === 0
      ? `a mixed reading finds ${matchingBoards} matching board(s) and ZERO the engine does not already apply - the mechanism has no witness`
      : `a mixed reading would add ${newApplications} application(s) - the pool is no longer empty, decide before admitting`);
}

console.log(`\nreading-census: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
