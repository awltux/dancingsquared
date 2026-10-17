// ============================================================================================
// THE LEVEL DIMENSION: which formations may a call of a programme be used FROM?
//
// WHY THIS EXISTS. A programme/level restricts the formations and arrangements a call may be used
// from; later levels ADD to that vocabulary and a lower level must not see the additions. The engine
// has no level concept and needs none - the level IS the call set (`poc/src/data.ts`
// `sequencerCallsUpTo` builds one per level) - but the STATE SET was level-blind: `buildFsmTable` took
// its named half from `getUniqueFormations()`, which is all of `formations.xml`. MEASURED before the
// fix: 100 of the corpus's 134 whole-set names are referenced by no Mainstream tam, so about half of
// the ms FSM's nodes were formations no ms call is authored from.
//
// THE QUESTION THIS SETTLES, BY MEASUREMENT, and it is the reason the file is a gate rather than a
// note. "Introduced at level L" has two readings:
//
//   STRICT     a formation is in L's vocabulary when a call of L declares it - `formation="Name"`.
//              This is what the corpus DATA says, it needs no sweep, and it is what ships.
//   PERMISSIVE a formation is in L's vocabulary when a call of L can REACH it from a declared start.
//              This needs a closure, and it sounds more generous for free.
//
// PERMISSIVE WAS MEASURED AND REFUSED. Seeding with the 42 named geometries ms declares and applying
// the 273 ms calls reaches 78 of the 131 declared named geometries - and 34 of those are geometries
// only a level ABOVE Mainstream names. `Static MiniWaves RH` is reached by `Boys Run`, `T-Bone DRDR`
// by `All 8 Circulate`, `T-Bone RDRD` by `Face Left`, `3/4 Lines RH` by `Boys Run`. So "reachable"
// admits 34 formations no Mainstream call is authored from and destroys the gate it was proposed to
// keep. The closure is still worth knowing: 78 reached minus 42 declared leaves 36 geometries that
// are REACHABLE BUT NOT DECLARED, and those are exactly the transients Stage 3's modules have to
// ABSORB so they never become states.
//
// WHAT IT ASSERTS.
//   1. the vocabulary GROWS with the level and never shrinks - the "later levels ADD" half;
//   2. the level-scoped state set is exactly the named formations the level's own calls declare, plus
//      the registered start setups: no state is out of scope, and nothing in scope is missing;
//   3. the permissive closure still ESCAPES the level (the ratio is pinned), so the refusal above
//      stays a measurement rather than a memory. If a catalogue change ever stops the escape, this
//      fails and the decision has to be taken again.
//
// THE NAME SET IS CROSS-CHECKED, because the per-level table is derived from the XML here (the only
// way to see all twelve levels at once without building twelve sequencers) while the state set comes
// from the ENGINE's own derivation. If the two ever disagree about the ms level, the XML reading
// below has drifted from `parseCallXmlImpl` and fails rather than silently reporting a different
// corpus. `from=` is deliberately NOT counted: it is free text for the user and `buildCallImpl` never
// resolves a formation from it.
// ============================================================================================

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

import { setParser, buildCellLattice } from '../../dist/index.js';
import { buildCatalog, makeSequencer } from '../../../poc-teacher/src/catalog.ts';

setParser(DOMParser);
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '..', '..', '..', 'assets');
const read = (p) => readFileSync(path.join(assets, p), 'utf8');

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

const byTag = (node, tag) => {
  const out = [];
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) { if (n.tagName === tag) out.push(n); out.push(...byTag(n, tag)); }
  }
  return out;
};
const isHidden = (tam) => { const d = tam.getAttribute('display'); return d === 'no' || d === 'none'; };

// The level ORDER is `poc/src/data.ts`'s own `levelOrder`, copied rather than imported: that file is
// browser code (Vite `import.meta.glob`) and cannot be loaded here.
const ORDER = ['discovered', 'ssd', 'ms', 'plus', 'a1', 'a2', 'c1', 'c2', 'c3a', 'c3b'];
const msFiles = {};
const perLevelFiles = new Map();
const perLevelNames = new Map();
for (const lv of ORDER) {
  let files = [];
  try { files = readdirSync(path.join(assets, lv)).filter((f) => f.endsWith('.xml')); } catch { continue; }
  perLevelFiles.set(lv, files);
  const names = new Set();
  for (const f of files) {
    const xml = read(`${lv}/${f}`);
    if (lv === 'ms') msFiles[`ms/${f}`] = xml;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    for (const tam of byTag(doc, 'tam')) {
      if (isHidden(tam)) continue;
      // INLINE WINS OVER THE ATTRIBUTE (`buildCallImpl`): a tam that carries its own `<formation>`
      // child has declared a setup, not a name, and referencing a name as well would be dead data.
      if (byTag(tam, 'formation').length) continue;
      const n = tam.getAttribute('formation');
      if (n) names.add(n);
    }
  }
  perLevelNames.set(lv, names);
}

const declared = new Set();
for (const m of read('formations.xml').matchAll(/<formation name="([^"]*)"/g)) declared.add(m[1]);

// ---------------------------------------------------------------- 1. the vocabulary grows
console.log(`== 1. the declared vocabulary, per level (formations.xml declares ${declared.size} names) ==`);
console.log('level       own-names  cum-names  cum-declared  cumulative-TITLES');
const cumNames = new Set();
const firstAt = new Map();
for (const lv of ORDER) for (const n of perLevelNames.get(lv) ?? []) if (!firstAt.has(n)) firstAt.set(n, lv);
{
  const cumTitles = new Set();
  let prev = 0;
  let monotone = true;
  for (const lv of ORDER) {
    if (!perLevelNames.has(lv)) continue;
    for (const n of perLevelNames.get(lv)) cumNames.add(n);
    for (const f of perLevelFiles.get(lv)) {
      for (const b of read(`${lv}/${f}`).match(/<tam\b[\s\S]*?<\/tam>/g) ?? []) {
        const end = b.indexOf('>');
        if (/display="(no|none)"/.test(end >= 0 ? b.slice(0, end + 1) : b)) continue;
        cumTitles.add((b.match(/title="([^"]*)"/) ?? [])[1] ?? '?');
      }
    }
    const cumDeclared = [...firstAt.keys()].filter((n) => declared.has(n) && ORDER.indexOf(firstAt.get(n)) <= ORDER.indexOf(lv)).length;
    console.log(`${lv.padEnd(11)} ${String(perLevelNames.get(lv).size).padStart(9)} ${String(cumNames.size).padStart(10)} ${String(cumDeclared).padStart(13)} ${String(cumTitles.size).padStart(18)}`);
    if (cumTitles.size < prev) monotone = false;
    prev = cumTitles.size;
  }
  check(monotone, 'the cumulative call pool never shrinks as the level rises (a later level ADDS)');
}
const referencedSomewhere = [...firstAt.keys()].filter((n) => declared.has(n));
const never = [...declared].filter((n) => !firstAt.has(n));
console.log(`\n  referenced by some level's tam : ${referencedSomewhere.length}`);
console.log(`  declared and NEVER referenced  : ${never.length}`);
check(referencedSomewhere.length > 0 && never.length > 0,
  `${referencedSomewhere.length} of ${declared.size} declared names are referenced, ${never.length} are not (the corpus is not a closed vocabulary)`);

// ---------------------------------------------------------------- 2. the state set at ms
console.log('\n== 2. the state set, and the scope it is derived from ==');
const catalog = buildCatalog(msFiles);
const seq = makeSequencer(read('moves.xml'), read('formations.xml'), catalog);
const referenced = seq.library.referencedFormationNames();
const xmlNames = perLevelNames.get('ms') ?? new Set();
const cumMs = new Set();
for (const lv of ORDER) {
  if (ORDER.indexOf(lv) > ORDER.indexOf('ms')) break;
  for (const n of perLevelNames.get(lv) ?? []) cumMs.add(n);
}
// The cross-check is against `ms/` ITSELF, because that is the call set the sequencer (and therefore
// the shipped asset) is built from - `poc/scripts/build-fsm-asset.mjs` reads only `ms/*.xml`. The
// cumulative figure is reported next to it because it is NOT the same: the app's own `sequencerCallsUpTo
// ('ms')` pools ms and everything below, which is 99 names and one more title than the asset sees. The
// two are compared below by title count rather than conflated.
const unresolved = [...xmlNames].filter((n) => !declared.has(n));
console.log(`  ms/ tams reference           : ${xmlNames.size} names`);
console.log(`  ms and below reference       : ${cumMs.size} names (the app's own "ms" pools the levels below)`);
console.log(`  the ENGINE derives           : ${referenced.size} referenced names`);
console.log(`  referenced by ms/ but not declared: ${unresolved.length}${unresolved.length ? ` (${unresolved.join(', ')})` : ''}`);
check(referenced.size === xmlNames.size - unresolved.length,
  `the engine's scope is the ms/ XML's minus the names the corpus does not declare (${referenced.size} = ${xmlNames.size} - ${unresolved.length})`);
for (const n of unresolved) {
  const failed = seq.library.registrationFailures().some((f) => f.reason.includes(`"${n}"`));
  check(failed, `the tam referencing the undeclared "${n}" is recorded as a registration failure rather than silently dropped`);
}

const named = seq.library.getNamedFormations();
const namedByName = new Map(named.map((f) => [f.name, f]));
const scoped = buildCellLattice([
  ...seq.library.referencedFormations().map((f) => ({ name: f.name, dancers: f.dancers })),
  ...seq.library.allVariantSetups().map((s, i) => ({ name: `@embed#${i}`, dancers: s })),
]);
const states = seq.transitionTable();
const stateList = states.states();
const asset = JSON.parse(read('fsm-ms.json'));
console.log(`  the FSM's state set          : ${stateList.length} states (asset: ${asset.table.states.length})`);
console.log(`  of which named / @embed      : ${stateList.filter((s) => !s.startsWith('@embed#')).length} / ${stateList.filter((s) => s.startsWith('@embed#')).length}`);
check(stateList.length === asset.table.states.length,
  `the live state count matches the stored asset (${stateList.length})`);
// THE LEAK ASSERTION, at the level that introduced the dimension. It is asserted here as well as in
// `fsm-asset.mjs` because this file is where the RULE lives; that one is where the ARTEFACT lives.
const outOfScope = stateList.filter((s) => !s.startsWith('@embed#') && !referenced.has(s));
check(outOfScope.length === 0,
  outOfScope.length === 0
    ? `every named state is a formation an ms call is used from (${referenced.size} referenced names)`
    : `${outOfScope.length} state(s) are out of scope: ${outOfScope.slice(0, 5).join(', ')}`);
// The scope is not vacuous: the corpus declares far more than the level uses.
const flat = seq.library.getUniqueFormations().map((f) => f.name);
const excluded = flat.filter((n) => !referenced.has(n));
console.log(`  corpus whole-set names not states at ms: ${excluded.length} of ${flat.length}`);
check(excluded.length > 50,
  `${excluded.length} declared formations are outside the ms vocabulary - a level-blind state set would hold them all`);

// ---------------------------------------------------------------- 3. strict vs permissive
//
// The decision, kept as a gate. The closure is over the DECLARED named formations (the whole-set
// corpus), seeded by the geometries ms declares, using the level's own registered calls.
console.log('\n== 3. strict vs permissive, MEASURED (the decision this file exists for) ==');
{
  const full = buildCellLattice(named.map((f) => ({ name: f.name, dancers: f.dancers })));
  const geoOf = (n) => full.byName.get(n);
  const inScope = [...referenced].filter((n) => namedByName.has(n));
  const seed = new Set(inScope.map((n) => geoOf(n)?.id).filter((x) => x !== undefined));
  const aboveMs = new Set();
  for (const n of named) {
    const first = firstAt.get(n.name);
    if (first && ORDER.indexOf(first) > ORDER.indexOf('ms')) { const g = geoOf(n.name); if (g) aboveMs.add(g.id); }
  }
  console.log(`  the level's declared geometries      : ${seed.size}`);
  console.log(`  geometries a HIGHER level names      : ${aboveMs.size} of ${full.geometries.length}`);

  const titles = [...seq.library.callNames()].sort();
  const reach = new Set(seed);
  const queue = [...seed];
  const leaks = new Set();
  let apps = 0;
  const t0 = Date.now();
  while (queue.length) {
    const id = queue.shift();
    const board = seq.boardForFormation(full.geometries[id].name);
    if (!board) continue;
    for (const t of titles) {
      const res = seq.applyToBoard(board, t);
      if (!res.legal) continue;
      apps++;
      const cell = full.cellOf(res.board);
      if (cell.geometryId === null || reach.has(cell.geometryId)) continue;
      reach.add(cell.geometryId);
      queue.push(cell.geometryId);
      if (aboveMs.has(cell.geometryId)) leaks.add(cell.geometryId);
    }
  }
  const undeclaredReachable = reach.size - seed.size;
  console.log(`  ${apps} legal applications in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  PERMISSIVE closure                   : ${reach.size} of ${full.geometries.length} declared`);
  console.log(`  of those, named only ABOVE ms        : ${leaks.size}  <- the escape`);
  console.log(`  reachable but NOT declared           : ${undeclaredReachable}  <- the transient pool Stage 3 must absorb`);
  // PINNED, and a movement in EITHER direction re-opens the decision: fewer leaks would make
  // permissive affordable, more would make the gate weaker than it looked when it was chosen.
  //
  // MEASURED ON THE ms/ CALL SET, which is what the shipped asset and therefore this FSM are built
  // from. The APP's own "Mainstream" is `sequencerCallsUpTo('ms')`, which pools the levels below and
  // is 18 titles more; run over that set the closure is 79 and leaks 35 rather than 78 and 34. Same
  // answer, one geometry more, and the difference is recorded in PLAN.md rather than averaged away.
  //
  // 42 / 78 / 34 -> 45 / 86 / 38 IS THE CORPUS GROWING, AND THE DIRECTION IS THE ONE THE DECISION NEEDS.
  // The ms catalogue went 274 -> 290 entries when the asset was regenerated, so the declared set is 45
  // names rather than 42, the permissive closure reaches 86 of 136 declared geometries, and the escape -
  // the whole reason STRICT was chosen - grows 34 -> 38 rather than shrinking. A shrinking escape would
  // have re-opened the decision in the other direction; this one makes the case for STRICT stronger, and
  // the two checks below it still pass (leaks > 0 and undeclaredReachable > 0).
  const PINNED = { seed: 45, closure: 86, aboveMsReached: 38 };
  const measured = { seed: seed.size, closure: reach.size, aboveMsReached: leaks.size };
  let moved = 0;
  for (const [k, want] of Object.entries(PINNED)) {
    if (measured[k] !== want) { moved++; console.log(`    ${k}: pinned ${want}, measured ${measured[k]}`); }
  }
  check(moved === 0, moved === 0
    ? `the permissive closure still escapes the level (${PINNED.aboveMsReached} of the ${PINNED.closure} it reaches are named only above ms) - re-measure before revisiting`
    : `${moved} pinned number(s) moved - the STRICT-vs-PERMISSIVE decision has to be taken again`);
  check(leaks.size > 0,
    'permissive admits formations no Mainstream call is authored from, which is why STRICT ships');
  check(undeclaredReachable > 0,
    `${undeclaredReachable} geometries are reachable from the ms vocabulary without being declared - the transients a module edge has to absorb`);
}

console.log(`\nlevel-census: ${failures === 0 ? 'all green' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
