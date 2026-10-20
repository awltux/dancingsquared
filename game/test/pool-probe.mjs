// THE POOL, AS A HAND-CURATED LIST (`src/puzzle/calls-data.ts`): every title names a real call, twice over.
//
// WHY THIS IS A PROBE AND NOT A GENERATOR. The pool was generated until the owner took the order over by hand,
// and the generator's `--check` was what caught a corpus rename — it went with the generator
// (`game/tools/build-pool.mjs`, deleted). What a hand edit can get wrong is narrower than what a generator can,
// so this checks exactly that, and it checks it in two steps because `resolvable` has two meanings here:
//
//   1. THE CORPUS CARRIES A TAM WITH THAT TITLE. This is what "the call exists" means, and it is checked against
//      every `<tam>` in `assets/ms/*.xml` — 322 distinct titles — not against the 62 the level loader
//      happens to name. MEASURED: a pool of 97 hand-written titles resolves completely on this check.
//   2. THE LEVEL LOADER CAN REGISTER IT. `applierFor` builds each level from the FIRST tam of each file, named by
//      that tam's title, so the corpus's other 260 titles are unreachable however real they are. A pool title
//      that resolves but cannot be registered reduces its level's call set SILENTLY, which is the failure this
//      half exists to make loud.
//
// THE TWO DISAGREEING IS THE POINT OF HAVING BOTH, and step 1 is what says which of the two a failure is: a
// title no tam carries is a typo or a stale rename, and one that a tam carries but the loader does not name is a
// loader limit. Without step 1 the second reads as "this call does not exist", which is false.
//
// MEASURED, WHICH IS WHY THE SECOND HALF IS HERE AT ALL: `134ff33` renamed 43 `<tam title>` attributes in
// `circle.xml` and the pool kept naming `Circle Left - Stop at Home`; two probes went red with "every one of the
// level's 15 titles registered with the engine (14)", a count that points at the corpus rather than at the title.
//
// Usage: node game/test/pool-probe.mjs   (engine must be built)
import { CALLS_IN_ORDER, POOL_VERSION } from '../src/puzzle/calls-data.ts';
import { BASE_POOL, levelSpec } from '../src/puzzle/levels.ts';
import { poolFor } from '../src/puzzle/pool.ts';
import { applierFor, corpusFamilies, corpusTamTitles } from '../src/data/corpus-node.ts';

let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};

/**
 * The titles of `titles` that the level loader cannot register, in the order given.
 *
 * IT ASKS THE APPLIER through `candidateCalls()`, which is the list the SEQUENCER was actually built with —
 * not a second walk over the corpus. A helper that re-derived it would be the second implementation AGENTS.md
 * section 5 forbids, and it would keep passing after the loader changed.
 */
function unregisterable(titles) {
  const { applier } = applierFor(titles, titles.length);
  const registered = new Set(applier.candidateCalls());
  return titles.filter((title) => !registered.has(title));
}

console.log(`== the pool: ${CALLS_IN_ORDER.length} hand-curated titles, ${POOL_VERSION} ==`);

console.log('\n== 1. every title names a call the CORPUS carries ==');
{
  const carried = new Set(corpusTamTitles());
  const unknown = CALLS_IN_ORDER.filter((title) => !carried.has(title));
  check(unknown.length === 0, `all ${CALLS_IN_ORDER.length} titles are carried by some <tam> in assets/ms (${unknown.length} are not)`);
  for (const title of unknown.slice(0, 10)) console.log(`       not a tam title anywhere: ${title}`);
  // NEGATIVE CONTROL: a title no tam carries must land in the SAME list the loop above reads. Without this the
  // check above passes for a helper that returns nothing, which is the shape a broken filter always has.
  const bogus = [...CALLS_IN_ORDER, 'Circle Left Sideways To The Moon'];
  const caught = bogus.filter((title) => !carried.has(title));
  check(caught.length === 1 && caught[0] === 'Circle Left Sideways To The Moon', `NEGATIVE CONTROL: an invented title is caught by the same check (${caught.length} caught)`);
}

console.log('\n== 2. no title appears twice (a position into an authored list is not an identity) ==');
{
  const seen = new Set();
  const repeated = CALLS_IN_ORDER.filter((title) => (seen.has(title) ? true : (seen.add(title), false)));
  // A DUPLICATE IS NOT HARMLESS: `poolFor` is the first `poolSize` entries, so a title listed twice takes two
  // positions, gives one call, and shifts every later level's pool by one — with no other symptom.
  check(repeated.length === 0, `every title appears once (${repeated.length} repeat(s))`);
  for (const title of [...new Set(repeated)].slice(0, 10)) console.log(`       listed twice: ${title}`);
}

console.log('\n== 3. the level loader can register every title (the two resolutions AGREE) ==');
{
  const missing = unregisterable(CALLS_IN_ORDER);
  const carried = new Set(corpusTamTitles());
  // THE FAILURE IS SPLIT BY CAUSE, because the fixes differ: a title no tam carries is a data edit in this file,
  // and one the corpus carries but the loader does not name is a change to `data/corpus-node.ts` (which registers
  // ONE call per file, named by that file's first tam).
  const nonexistent = missing.filter((title) => !carried.has(title));
  const unreachable = missing.filter((title) => carried.has(title));
  check(missing.length === 0, `every one of the pool's ${CALLS_IN_ORDER.length} titles registers with the engine (${missing.length} do not)`);
  if (missing.length) {
    console.log(`       ${nonexistent.length} of them no tam carries, ${unreachable.length} are carried by a tam the loader does not name`);
    for (const title of unreachable.slice(0, 8)) console.log(`       unreachable: ${title}`);
    for (const title of nonexistent.slice(0, 8)) console.log(`       nonexistent: ${title}`);
  }
  const { registered } = applierFor(CALLS_IN_ORDER, CALLS_IN_ORDER.length);
  console.log(`       ${registered} of ${CALLS_IN_ORDER.length} register; the corpus carries ${corpusTamTitles().length} distinct tam titles`);
  // NEGATIVE CONTROL: the helper must see an invented title, or `missing.length === 0` above is a statement
  // about the helper rather than about the pool.
  const bogus = unregisterable([...CALLS_IN_ORDER, 'Circle Left Sideways To The Moon']);
  check(bogus.length === missing.length + 1, `NEGATIVE CONTROL: the registerability check sees an invented title too (${bogus.length} vs ${missing.length})`);
}

console.log('\n== 4. the level-1 pool boundary teaches WHOLE families ==');
{
  // A FAMILY IS A CORPUS FILE (see `corpusFamilies`): `circle.xml` authors every Circle variation. `poolFor` is
  // a PREFIX, so the boundary is a COUNT, and a count can land mid-family. THE DEFECT THIS PINS IS MEASURED:
  // at `BASE_POOL` 20 level 1 taught `Circle Four Left` and never `Circle Four Right`, because the corpus's
  // first 24 titles are all Circle. `node game/tools/pool-families.mjs 10` is how the boundary was chosen.
  //
  // THE COMPARISON IS AGAINST THE FAMILY'S TITLES THE ORDER CONTAINS, not everything the file authors: the
  // order deliberately omits 9 of the corpus's 322 titles, and a family with one omitted title could never be
  // "entirely inside" any prefix. What must never happen is teaching HALF a family the level teaches at all.
  const orderSet = new Set(CALLS_IN_ORDER);
  const members = new Map();
  for (const { file, titles } of corpusFamilies()) {
    const inOrder = titles.filter((t) => orderSet.has(t));
    if (inOrder.length) members.set(file, inOrder);
  }
  const splitBy = (titles) => {
    const have = new Set(titles);
    const split = [];
    for (const [file, all] of members) {
      const inside = all.filter((t) => have.has(t)).length;
      if (inside > 0 && inside < all.length) split.push(`${file} ${inside}/${all.length}`);
    }
    return split;
  };
  const first = poolFor(levelSpec(1));
  const split = splitBy(first);
  check(split.length === 0, `level 1's ${first.length} titles split no family (${split.join(', ') || 'none'})`);
  // THE OWNER'S RULE AS A CHECK: the first level must teach at least ten CALLS, and a call is a family.
  const whole = [...members.entries()].filter(([, all]) => all.every((t) => first.includes(t))).length;
  check(whole >= 10, `and they are ${whole} whole families, at least the ten a first level needs`);
  check(first.length === BASE_POOL, `the level-1 pool is BASE_POOL (${first.length} vs ${BASE_POOL})`);
  // NEGATIVE CONTROL: ONE TITLE FEWER MUST SPLIT ONE, or the checks above are vacuous.
  const shorter = poolFor({ ...levelSpec(1), poolSize: first.length - 1 });
  const shorterSplit = splitBy(shorter);
  check(shorterSplit.length > 0,
    `NEGATIVE CONTROL: ${first.length - 1} titles would split ${shorterSplit.length} family(ies) (${shorterSplit.join(', ')})`);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
