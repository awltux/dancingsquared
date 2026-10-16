// THE ITEM STORE'S CONTRACT, run against BOTH implementations: the in-memory twin and DynamoDB.
//
// WHY THIS IS A GATE. `ItemStore.put` is a compare-and-set, and every rule the API has that matters — one
// issued drill per player, one entry per run id, advancing the drill that was issued — is built on it being
// one. The in-memory twin is what the other probes drive, so if the twin and DynamoDB disagree about the
// protocol, every one of those probes is measuring the twin rather than the behaviour that ships.
//
// THE SAME SUITE RUNS TWICE. Not "similar checks" — the same functions, parameterised by a store factory, so a
// divergence cannot hide in a hand-copied expectation. The DynamoDB half is skipped, LOUDLY, when nothing
// answers on its endpoint; `DSQ_REQUIRE_DDB=1` (what `npm run verify:api:ddb` sets) turns that skip into a
// failure, because a gate that silently reports nothing is the failure mode AGENTS.md 5 names.
//
// Usage: node api/test/store-probe.mjs
import { configFromEnv, clientOptions, DEFAULT_DDB_ENDPOINT } from '../src/config.ts';
import { BOARD_INDEX, boardIndexKeys, boardKey, boardPk } from '../src/keys.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { DynamoStore, createTable, dynamoClient, tableExists } from '../src/store/dynamo.ts';

let failures = 0;
let skipped = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ok   ' + msg : '  FAIL ' + msg);
  if (!cond) failures++;
};
const skip = (msg) => {
  console.log('  skip ' + msg);
  skipped++;
};

/**
 * A key for this RUN, not for this store.
 *
 * THE PORT HAS NO DELETE (nothing in the endpoints needs one), so a probe that reused its keys would find the
 * previous run's rows and measure them: MEASURED, the second run of this suite reported "an absent key reads as
 * null" failing against DynamoDB Local with the revision already at 3. A run stamp in the partition makes the
 * suite repeatable against a store that keeps what it is given, which is what DynamoDB Local does for the life
 * of its container.
 */
const RUN = Date.now().toString(36);
const KEY = (name, sk = 'item#1') => ({ pk: `probe#${RUN}#${name}`, sk });

/**
 * A value as JSON with keys SORTED at every level, so "the same data" is a comparison rather than an accident
 * of which store returned it.
 *
 * ATTRIBUTE ORDER IS NOT PART OF THE CONTRACT, and DynamoDB proves it: it returns the attributes of an item in
 * ITS OWN order, so `JSON.stringify(stored) === JSON.stringify(given)` fails while the values are identical.
 * MEASURED — the first version of this suite reported four failures per store on order alone, which is the same
 * trap the game's `save-probe.mjs` hit and records. What is being compared here is the SHAPE and the fields.
 */
const stable = (value) => JSON.stringify(value, (_, nested) =>
  nested && typeof nested === 'object' && !Array.isArray(nested)
    ? Object.fromEntries(Object.keys(nested).sort().map((key) => [key, nested[key]]))
    : nested);
const VALUE = { levelIndex: 1, finished: [0, 2], issued: { id: '1:2', seed: 7 } };

/**
 * The contract, driven by whichever store is handed in.
 *
 * THE NEGATIVE CONTROLS ARE RAW SDK WRITES, not a second implementation of the store: the plausible wrong rule
 * here is "write without a condition", and the way to demonstrate what that does is to perform exactly that
 * write against the real table and show it lands where the store's conditional one refused.
 */
async function contract(name, store, unconditional) {
  console.log(`\n== the contract against ${name} ==`);
  const key = KEY(name);

  check((await store.get(key)) === null, 'an absent key reads as null');
  check((await store.put(key, VALUE, null)) === true, 'a create on an absent key lands (true)');
  const first = await store.get(key);
  check(first.rev === 1, `and the stored revision is 1 (${first.rev})`);
  check(stable(first.value) === stable(VALUE), 'with the value it was given');

  // THE STORE'S OWN FIELDS DO NOT LEAK INTO `value`, which is what keeps a handler from seeing PK/SK/rev and
  // writing them back on the next update.
  check(!('PK' in first.value) && !('SK' in first.value) && !('rev' in first.value), `and no store-owned field is in it (${Object.keys(first.value).join(',')})`);

  check((await store.put(key, { other: true }, null)) === false, 'a second create on the same key is REFUSED (false)');
  check(stable((await store.get(key)).value) === stable(VALUE), 'and the refused write changed nothing');

  check((await store.put(key, { other: true }, 99)) === false, 'a replace expecting the WRONG revision is refused');
  check(stable((await store.get(key)).value) === stable(VALUE), 'and that refusal changed nothing either');
  check((await store.put(key, { levelIndex: 9 }, 1)) === true, 'a replace expecting the current revision lands');
  const second = await store.get(key);
  check(second.rev === 2, `and the revision advances (${second.rev})`);
  // REPLACED, NOT MERGED: a write is the whole value, which is what makes "the progress row is what the
  // handler built" true rather than "the fields it happened to set".
  check(stable(second.value) === stable({ levelIndex: 9 }), `and the value is replaced, not merged (${JSON.stringify(second.value)})`);

  // A COPY, NOT A REFERENCE. MEASURED on the memory twin by mutating what it returned; DynamoDB cannot do
  // anything else, which is exactly why the twin must not either.
  const held = await store.get(key);
  held.value.levelIndex = 12345;
  check((await store.get(key)).value.levelIndex === 9, 'what `get` returned is a copy: mutating it does not write through');

  // NESTED STRUCTURES, because a rendered board or a move list will be one, and a store that only round-trips
  // flat scalars would fail in production rather than here. `sessions` IS A LIST OF MAPS ON PURPOSE: the
  // emulator's account row holds its live refresh-token ids that way (`auth#<email>`), so the one shape an
  // account needs is pinned on BOTH stores here rather than assumed from the list-of-strings beside it.
  const nested = { moves: ['Allemande Left', 'Boys Run'], flags: { solved: false, attempts: 3 }, sessions: [{ id: 'a', at: 1 }], ratio: 0.25, nothing: null };
  check((await store.put(key, nested, 2)) === true, 'a nested value can be written');
  check(stable((await store.get(key)).value) === stable(nested), `and round-trips exactly (${JSON.stringify((await store.get(key)).value)})`);

  const other = KEY(name, 'item#2');
  await store.put(other, { levelIndex: 2 }, null);
  check((await store.get(other)).value.levelIndex === 2, 'a second sort key under the same partition is its own item');
  check((await store.get(key)).value.moves[0] === 'Allemande Left', 'and reading it did not disturb the first');

  // --- ONE PARTITION, WHICH IS WHAT A LEADERBOARD IS. `query` is the port's only read that is not a key, so it is
  // where a mistake becomes a SCAN: the checks below pin the order, the prefix, the limit and the direction, and the
  // negative control is that a partition nobody wrote returns nothing — a read that reached into another partition
  // would be one. Their values carry their own name because `StoredItem` has no key in it, which is also why the
  // board row names its player (`runs.ts`'s `asBoardRow`).
  const queryPk = KEY(`${name}#query`).pk;
  const QUERY_KEY = (sk) => ({ pk: queryPk, sk });
  // WRITTEN OUT OF ORDER ON PURPOSE: the store must order them, not the writer. The memory twin holds a `Map`, so a
  // reader that returned insertion order would pass every other check in this file and fail only this one.
  for (const [sk, marker] of [['player#b', 'b'], ['player#a', 'a'], ['player#c', 'c']]) await store.put(QUERY_KEY(sk), { marker }, null);

  const ascending = await store.query({ pk: queryPk, limit: 100 });
  check(ascending.map((row) => row.value.marker).join('') === 'abc', `a partition reads in SORT-KEY order, not insertion order (${ascending.map((row) => row.value.marker).join('')})`);
  const descending = await store.query({ pk: queryPk, limit: 100, descending: true });
  check(descending.map((row) => row.value.marker).join('') === 'cba', `and the direction reverses it (${descending.map((row) => row.value.marker).join('')})`);
  const capped = await store.query({ pk: queryPk, limit: 2 });
  check(capped.length === 2 && capped[0].value.marker === 'a' && capped[1].value.marker === 'b', `the limit caps the answer from the START of the order (${capped.length} row(s))`);
  const prefixed = await store.query({ pk: queryPk, skPrefix: 'player#b', limit: 100 });
  check(prefixed.length === 1 && prefixed[0].value.marker === 'b', `and a prefix selects a subset of the partition (${prefixed.length} row(s))`);
  const elsewhere = await store.query({ pk: KEY(`${name}#unwritten`).pk, limit: 100 });
  check(elsewhere.length === 0, 'NEGATIVE CONTROL: a partition nobody wrote holds nothing — an answer reaching another partition would be a scan');
  const fromQuery = ascending[0];
  fromQuery.value.marker = 'mutated';
  check((await store.get(QUERY_KEY('player#a'))).value.marker === 'a', 'and what a query returned is a copy, as `get` is');

  // --- AN INDEX IS A PROJECTION OF THE SAME ITEMS, AND THE SAME CHECKS HOLD OF IT. This is the read the leaderboard
  // uses to make "the top N scores" bounded: the base table's sort key for a board is the PLAYER, and an index whose
  // sort key is the SCORE is what turns that into a page. The keys are built by `keys.ts`'s `boardIndexKeys` rather
  // than spelled here — a probe that wrote its own index attributes would be measuring its own copy of the schema,
  // which is the one thing that has to agree between the twin, the adapter and the table definition.
  const boardRows = [
    ['p-low', 10],
    ['p-high', 900],
    ['p-mid', 400],
  ];
  for (const [playerId, score] of boardRows) {
    const ranked = boardIndexKeys('daily', 1, '2026-10-15', playerId, score);
    await store.put(boardKey('daily', 1, '2026-10-15', playerId), { playerId, score, runs: 1, ...ranked }, null);
  }
  const boardPkValue = boardPk('daily', 1, '2026-10-15');
  const topTwo = await store.query({ pk: boardPkValue, index: BOARD_INDEX, limit: 2 });
  check(topTwo.map((row) => row.value.playerId).join(',') === 'p-high,p-mid', `an index read returns the TOP of the board, not the first players (${topTwo.map((row) => row.value.playerId).join(',')})`);
  check(topTwo.every((row) => typeof row.value.score === 'number'), 'and its rows carry the projected attributes the rank is reported from');
  const wholeBoard = await store.query({ pk: boardPkValue, index: BOARD_INDEX, limit: 100 });
  check(wholeBoard.map((row) => row.value.score).join(',') === '900,400,10', `the whole index partition is in score order (${wholeBoard.map((row) => row.value.score).join(',')})`);
  // THE BASE TABLE IS STILL THE BASE TABLE: the same partition read without `index` is in PLAYER order, which is the
  // difference that made the index necessary. A store that ignored the field would fail one of these two.
  const baseOrder = await store.query({ pk: boardPkValue, limit: 100 });
  check(baseOrder.map((row) => row.value.playerId).join(',') === 'p-high,p-low,p-mid', `and the base table still orders by player, which is why the index exists (${baseOrder.map((row) => row.value.playerId).join(',')})`);
  // AN INDEX NAME NO TABLE HAS IS REFUSED, not answered empty: an empty answer is a board nobody is on.
  let refused = false;
  try {
    await store.query({ pk: boardPkValue, index: 'GSI9', limit: 10 });
  } catch {
    refused = true;
  }
  check(refused, 'NEGATIVE CONTROL: an index this store does not know is refused rather than answered empty');

  // --- SEVERAL ITEMS AT ONCE. A completed run changes three or four rows, so the port's `transact` is what
  // makes "the whole run landed" true rather than "most of it did".
  const t1 = KEY(name, 'item#t1');
  const t2 = KEY(name, 'item#t2');
  check(await store.transact([{ key: t1, value: { n: 1 }, expectedRev: null }, { key: t2, value: { n: 2 }, expectedRev: null }]) === true, 'a transaction of two creates lands');
  check((await store.get(t1)).value.n === 1 && (await store.get(t2)).value.n === 2, 'and both items are readable');

  const t3 = KEY(name, 'item#t3');
  check(await store.transact([{ key: t3, value: { n: 3 }, expectedRev: null }, { key: t1, value: { n: 99 }, expectedRev: null }]) === false, 'a transaction whose SECOND condition fails is refused');
  check((await store.get(t3)) === null, 'and its FIRST write did not land — which is the whole reason the port has it');
  check((await store.get(t1)).value.n === 1, 'and the item whose condition failed is untouched');

  check(await store.transact([{ key: t1, value: { n: 10 }, expectedRev: 1 }, { key: t2, value: { n: 20 }, expectedRev: 1 }]) === true, 'a transaction of two replaces lands');
  check((await store.get(t1)).rev === 2 && (await store.get(t2)).rev === 2, 'and both revisions advanced');
  check(await store.transact([{ key: t1, value: { n: 100 }, expectedRev: 2 }, { key: t2, value: { n: 200 }, expectedRev: 99 }]) === false, 'a transaction with one stale revision is refused');
  check((await store.get(t1)).value.n === 10, 'and the item whose revision was RIGHT did not change either');
  // THE ASSERTION IS "IT DOES NOT LAND", NOT "IT THROWS", AND THE TWO STORES GET THERE DIFFERENTLY: the twin
  // throws (writing one key twice is a programming error), while DynamoDB Local evaluates the conditions in
  // order and cancels the transaction when the second one fails — MEASURED, which is how the first version of
  // this check reported "landed" for a `false` return.
  const duplicate = await store.transact([{ key: t1, value: { n: 1 }, expectedRev: 2 }, { key: t1, value: { n: 2 }, expectedRev: 2 }]).then((landed) => landed, (error) => `threw ${error.name ?? ''}`);
  check(duplicate !== true, `a transaction cannot write the same key twice (${duplicate})`);

  // NEGATIVE CONTROL, MEASURED: the same two writes applied ONE AT A TIME leave the first behind when the
  // second is refused — a partially applied run, which is what `transact` exists to make impossible.
  const seqA = KEY(name, 'item#seqA');
  const seqB = KEY(name, 'item#seqB');
  await store.put(seqA, { present: true }, null);
  const oneAtATime = [await store.put(seqB, { n: 1 }, null), await store.put(seqA, { n: 2 }, null)];
  check(oneAtATime[0] === true && oneAtATime[1] === false, `NEGATIVE CONTROL: applied one at a time, the two writes give (${oneAtATime.join(', ')})`);
  check((await store.get(seqB)) !== null, 'NEGATIVE CONTROL: and the FIRST one is left behind, which a transaction would not do');

  // TWO CONCURRENT CREATES: EXACTLY ONE LANDS. This is the property the whole API rests on, and it is the last
  // check because it is the only one that needs the store to be genuinely concurrent.
  const race = KEY(name, 'item#race');
  const results = await Promise.all([store.put(race, { who: 'a' }, null), store.put(race, { who: 'b' }, null)]);
  check(results.filter(Boolean).length === 1, `two concurrent creates: exactly one lands (${results.filter(Boolean).length})`);
  const winner = (await store.get(race)).value;
  check(winner.who === 'a' || winner.who === 'b', `and the stored value is the winner's (${JSON.stringify(winner)})`);

  if (unconditional) {
    // NEGATIVE CONTROL, MEASURED WITH A RAW SDK WRITE. Every check above that says "refused" is a
    // `ConditionExpression`; this performs the same write with no condition at all and shows it succeeding, so
    // the checks that rule it out are the "is REFUSED"/"changed nothing" pairs — and the revision checks alone
    // would not catch it, because an unconditional write still advances the revision.
    const bare = KEY(name, 'item#bare');
    await store.put(bare, { first: true }, null);
    const landed = await unconditional(bare, { second: true });
    check(landed, 'NEGATIVE CONTROL: the same write with NO condition succeeds where the store refused');
    check(stable((await store.get(bare)).value) === stable({ second: true }), 'NEGATIVE CONTROL: and it overwrites a row the caller did not read');
  }
}

console.log('== 1. the in-memory twin ==');
await contract('memory', new MemoryStore(), null);

console.log('\n== 2. DynamoDB ==');
const config = configFromEnv();
const endpoint = config.endpoint ?? DEFAULT_DDB_ENDPOINT;
const { raw, document } = dynamoClient({ ...clientOptions({ ...config, endpoint }), maxAttempts: 1 });
let reachable = false;
try {
  reachable = await tableExists(raw, config.table);
  if (!reachable) {
    const created = await createTable(raw, config.table);
    console.log(`  note the table "${config.table}" ${created ? 'was created' : 'already existed'} at ${endpoint}`);
    reachable = true;
  }
} catch (error) {
  skip(`the DynamoDB half: nothing answers at ${endpoint} (${error.name ?? 'error'}) — start it with "docker compose -f api/docker-compose.yml up -d"`);
}

if (!reachable) {
  if (process.env['DSQ_REQUIRE_DDB'] === '1') {
    console.log('  FAIL DSQ_REQUIRE_DDB=1 and the DynamoDB half could not run');
    failures++;
  }
} else {
  console.log(`  note talking to the table "${config.table}" at ${endpoint}`);
  const store = new DynamoStore(document, config.table);
  await contract('dynamodb', store, async (key, value) => {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    await document.send(new PutCommand({ TableName: config.table, Item: { ...value, PK: key.pk, SK: key.sk, rev: 99 } }));
    return true;
  });
  // THE CONDITION IS THE ONLY DIFFERENCE, and it is worth stating in the log because it is the whole reason the
  // adapter exists in this shape: `PutItem` is an unconditional overwrite, and the store's `put` adds a
  // `ConditionExpression` that turns a lost race into `false`.
  console.log('  note the raw-SDK control above is the same PutItem the store sends, with the condition removed');
}

console.log(`\n${skipped ? `${skipped} section(s) SKIPPED — that is a COVERAGE GAP, not a pass\n` : ''}${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}`);
process.exit(failures ? 1 : 0);
