// A DOMAIN VALUE AS A DYNAMODB ITEM, PINNED — because the DDB path could not boot without it and no memory-store probe could
// see it.
//
// MEASURED, on the first attempt to run the API against DynamoDB Local (`npm run dev:api:ddb`, table created, container up):
// the boot died in `@aws-sdk/util-dynamodb` with "Pass options.removeUndefinedValues=true to remove undefined values from
// map/array/set", publishing the local fixture. The value it choked on is the shape the engine emits: a board's dancers
// carry `lastTurnDir` PRESENT-AND-UNDEFINED on the waypoints a turn did not touch, and ABSENT on the start board. An object
// in memory holds that key happily, which is why every memory-store probe and the whole game were green.
//
// WHAT IS PINNED:
//   1. AN UNDEFINED ENTRY OF A MAP IS OMITTED and the rest of the map survives, at any depth — the measured case is three
//      levels down (`puzzle.path[1].dancers[0].lastTurnDir`).
//   2. AN UNDEFINED ELEMENT OF A LIST BECOMES null, because dropping it would renumber every later element. The length is
//      preserved, and that is checked.
//   3. FALSY BUT DEFINED VALUES ARE KEPT. This is the negative control for the plausible shortcut (`if (!field) continue`),
//      which would silently drop `0`, `false` and `''` — three values a run row genuinely holds (`score: 0`,
//      `skipped: false`, an empty `label`). It fails exactly the check that names them.
//   4. THE INPUT IS NOT MUTATED: the caller still holds the object it passed, because the in-memory twin keeps a reference
//      and a store that edited it would change what the caller sees.
//
// Usage: node api/test/plain-item-probe.mjs   (pure: no SDK, no store, no container)
import { plainItem } from '../src/store/plain-item.ts';

let failures = 0;
const check = (cond, msg, detail = '') => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg + (cond || !detail ? '' : ` — ${detail}`));
  if (!cond) failures++;
};

/** The shape that actually broke the boot, cut down to the part that mattered. */
const board = () => ({
  dancers: [
    { id: 1, x: -2, y: 3, lastTurnDir: undefined },
    { id: 2, x: -3, y: 0, lastTurnDir: 'left' },
  ],
});

console.log('\n== 1. an undefined entry of a map is absent, at any depth ==');
{
  // THE MEASURED SHAPE: the puzzle row, three levels down.
  const item = plainItem({ puzzle: { path: [board()] } });
  const first = item.puzzle.path[0].dancers[0];
  check(!('lastTurnDir' in first), 'the undefined key is gone from the nested dancer');
  check(first.id === 1 && first.x === -2 && first.y === 3, 'and its neighbours survive');
  check(item.puzzle.path[0].dancers[1].lastTurnDir === 'left', 'while the defined one on the next dancer is kept');
  check(plainItem({ a: undefined }).a === undefined && !('a' in plainItem({ a: undefined })), 'a top-level undefined is gone too');
  check(plainItem({ a: null }).a === null, 'and null is a VALUE, so it is kept');
}

console.log('\n== 2. an undefined element of a list becomes null and keeps its index ==');
{
  const list = plainItem({ xs: [1, undefined, 3] }).xs;
  check(list.length === 3, `the length is preserved (${list.length})`);
  check(list[1] === null, `and the hole is null (${JSON.stringify(list[1])})`);
  check(list[2] === 3, 'so the element after it did not move');
}

console.log('\n== 3. falsy but DEFINED values are kept (the negative control) ==');
{
  const item = plainItem({ score: 0, skipped: false, label: '', attempts: 0 });
  check(item.score === 0 && item.skipped === false && item.label === '' && item.attempts === 0,
    `0, false and '' all survive (${JSON.stringify(item)})`);
  // THE WRONG RULE, measured on the same input: a truthiness filter drops three of the four, and this is why the check above
  // can tell the rule from the coincidence.
  const naive = (value) => Object.fromEntries(Object.entries(value).filter(([, field]) => field));
  check(Object.keys(naive({ score: 0, skipped: false, label: '', attempts: 0 })).length === 0,
    'CONTROL: a truthiness filter drops every one of them, which is the bug this check catches');
}

console.log('\n== 4. the input the caller still holds is untouched ==');
{
  const original = board();
  const copy = plainItem({ board: original });
  check('lastTurnDir' in original.dancers[0], 'the caller\'s own dancer still carries the key');
  check(copy.board !== original, 'and the store got a copy, not the caller\'s object');
  // THE WHOLE POINT: the item is JSON-safe, which is the property DynamoDB needs and the one the boot failed on.
  const roundTripped = JSON.parse(JSON.stringify(copy));
  check(JSON.stringify(roundTripped) === JSON.stringify(copy), 'and the item survives a JSON round trip, which is what a DDB attribute is');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
