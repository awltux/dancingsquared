// THE POOL'S FAMILY CENSUS — the measurement that chooses `BASE_POOL`.
//
// WHY IT EXISTS. `poolFor` is the FIRST `poolSize` entries of the hand-curated teaching order, so the pool
// boundary is a COUNT and nothing in the type system stops that count landing in the middle of a family. It
// did: `BASE_POOL` was 20 and the order's first 24 titles are all Circle, so level 1 taught `Circle Four
// Left` (4 titles) and not `Circle Four Right` (4 more). The corpus groups calls one file per family, so a
// family is a FILE, and this tool reports the prefix lengths at which a level would teach whole families only.
//
// WHAT IT PRINTS. Every CUT POINT (a prefix after which the next title would open a half-taught family), the
// number of whole families at each, then the smallest cut point reaching the requested family count, with the
// ladder head and the level ceiling it implies.
//
// THE NUMBER IT PRINTS BECOMES `BASE_POOL` IN `levels.ts`, WITH THIS COMMAND IN THE COMMENT. The
// RELATIONSHIP ("the shipped boundary is a clean family boundary") is pinned by `test/pool-probe.mjs`,
// because a pin on the count would drift the moment the order is re-curated and would say nothing about WHY.
//
// Usage: node game/tools/pool-families.mjs [familiesWanted=10]
import { CALLS_IN_ORDER } from '../src/puzzle/calls-data.ts';
import { corpusFamilies } from '../src/data/corpus-node.ts';
import { levelSpec } from '../src/puzzle/levels.ts';

const wanted = Number(process.argv[2] ?? 10);

// ---- title -> family, and the conflicts that would make "its family" ambiguous
const fileOf = new Map();
const fileTitles = new Map();
const conflicts = [];
for (const { file, titles } of corpusFamilies()) {
  fileTitles.set(file, titles);
  for (const t of titles) {
    if (fileOf.has(t) && fileOf.get(t) !== file) conflicts.push(`${t}: ${fileOf.get(t)} + ${file}`);
    else fileOf.set(t, file);
  }
}

console.log(`=== ${CALLS_IN_ORDER.length} titles in the order, ${fileTitles.size} families in the corpus ===`);
if (conflicts.length) {
  console.log(`\n!! ${conflicts.length} title(s) authored in more than one file, so "its family" is ambiguous:`);
  for (const c of conflicts.slice(0, 10)) console.log(`   ${c}`);
  if (conflicts.length > 10) console.log(`   ... and ${conflicts.length - 10} more`);
}
const unknown = CALLS_IN_ORDER.filter((t) => !fileOf.has(t));
if (unknown.length) {
  console.log(`\n!! ${unknown.length} title(s) in the order that no corpus file authors:`);
  for (const t of unknown.slice(0, 10)) console.log(`   ${t}`);
}

// ---- clean(n): no family is SPLIT BY THE CUT.
//
// THE COMPARISON IS AGAINST THE FAMILY'S TITLES **THAT THE ORDER CONTAINS**, not against everything the file
// authors. The order is a curation: it omits 9 of the corpus's 322 titles on purpose, and a family with one
// omitted title can never be "entirely inside" a prefix — so the strict reading would report every such family
// as split and make the measurement useless. What a level must not do is teach HALF a family it teaches at
// all, and that is a property of the order's own membership.
const orderSet = new Set(CALLS_IN_ORDER);
const orderMembers = new Map();
for (const t of CALLS_IN_ORDER) {
  const f = fileOf.get(t);
  if (!f) continue;
  if (!orderMembers.has(f)) orderMembers.set(f, []);
  orderMembers.get(f).push(t);
}
const omitted = [...fileTitles.entries()]
  .map(([f, titles]) => ({ f, missing: titles.filter((t) => !orderSet.has(t)).length }))
  .filter((x) => x.missing > 0);

const included = (n) => new Set(CALLS_IN_ORDER.slice(0, n));
function clean(n) {
  const have = included(n);
  for (const t of have) {
    const f = fileOf.get(t);
    if (!f) continue;
    for (const sibling of orderMembers.get(f) ?? []) if (!have.has(sibling)) return false;
  }
  return true;
}
const familiesAt = (n) => {
  const have = included(n);
  const whole = new Set();
  for (const t of have) {
    const f = fileOf.get(t);
    if (f && (orderMembers.get(f) ?? []).every((s) => have.has(s))) whole.add(f);
  }
  return whole.size;
};

// ---- every prefix at which a family completes, provided it does not split one
const boundaries = [];
let lastFamilies = 0;
for (let n = 1; n <= CALLS_IN_ORDER.length; n++) {
  if (!clean(n)) continue;
  const families = familiesAt(n);
  if (families > lastFamilies) { boundaries.push({ n, families }); lastFamilies = families; }
}

console.log(`\n=== clean cut points (a pool boundary that teaches whole families) ===`);
for (const { n, families } of boundaries) {
  console.log(`  ${String(n).padStart(3)} titles = ${String(families).padStart(2)} families${n === 20 ? '   <- today' : ''}`);
}

const recommended = boundaries.find((c) => c.families >= wanted);
if (!recommended) {
  // THE ORDER AS CURATED CANNOT REACH IT, so report what a FAMILY-GROUPED order would give. The
  // transformation keeps the owner's sequence of families (each family at its first appearance) and each
  // family's own internal order — it only stops the families interleaving, which is what breaks the cut.
  console.log(`\n!! no clean cut point reaches ${wanted} whole families in the order AS CURATED`);
  const firstSeen = [];
  const members = new Map();
  for (const t of CALLS_IN_ORDER) {
    const f = fileOf.get(t) ?? `(unknown: ${t})`;
    if (!members.has(f)) { members.set(f, []); firstSeen.push(f); }
    members.get(f).push(t);
  }
  let running = 0;
  const groupedCuts = firstSeen.map((f, i) => {
    running += members.get(f).length;
    return { n: running, families: i + 1, file: f, titles: members.get(f).length };
  });
  console.log('\n=== if families were contiguous (same family sequence, same internal order) ===');
  for (const c of groupedCuts.slice(0, wanted + 2)) {
    console.log(`  ${String(c.families).padStart(2)} families = ${String(c.n).padStart(3)} titles   (${c.file}: ${c.titles})`);
  }
  const target = groupedCuts.find((c) => c.families >= wanted);
  console.log(`\n  => family-grouped BASE_POOL would be ${target ? target.n : '?'} titles`);
  process.exit(1);
}

console.log(`\n=== RECOMMENDED: BASE_POOL = ${recommended.n} (${recommended.families} whole families) ===`);
for (let i = 1; i <= 4; i++) {
  const spec = levelSpec(i);
  console.log(`  level ${i}: poolSize ${spec.poolSize}, depth ${spec.depth}, options ${spec.optionCount}`);
}
let ceiling = 0;
while (levelSpec(ceiling + 1) && levelSpec(ceiling + 1).poolSize <= CALLS_IN_ORDER.length) ceiling++;
console.log(`  level ceiling with the corpus's ${CALLS_IN_ORDER.length} titles: ${ceiling}`);
console.log(`\nSet BASE_POOL = ${recommended.n} in game/src/puzzle/levels.ts, bump POOL_VERSION, then re-bake.`);
