// The API's ports: the three things a handler is HANDED and must not reach for itself.
//
// WHY PORTS AND NOT IMPORTS. Every rule this package owns is a decision about plain data — which schedule
// entry a player is on, whether a drill may be advanced, what the hint balance owes — and DESIGN.md 14 says
// those are to be tested "as a pure function over a schedule, a run history and a fake progress record". A
// handler that imported `@aws-sdk/client-dynamodb` and `process.env` could not be driven by a probe at all,
// so the store, the clock and the identity are arguments, and the AWS shapes live in one adapter each.
//
// WHAT IS NOT A PORT, deliberately: nothing here fetches, parses or routes. A handler receives an
// `ApiRequest` and returns an `ApiResult`; turning an HTTP exchange or a Lambda event into one is the
// adapter's whole job (`src/dev-server.ts` today, `src/lambda.ts` with the deployment).

/** A single-table key: `PK`/`SK` as DESIGN.md 11's item table writes them. */
export interface ItemKey {
  readonly pk: string;
  readonly sk: string;
}

/**
 * One stored item, with the revision the store keeps for it.
 *
 * `rev` IS THE STORE'S, NOT THE DOMAIN'S. DynamoDB has no built-in revision, so the adapter writes one as a
 * plain attribute and conditions on it; a handler never reads it, it only hands the revision it read back to
 * `put` as the thing it expects to still be current. That is what makes "two requests cannot both issue a
 * drill" a property of one conditional write rather than of a lock nobody can test.
 */
export interface StoredItem {
  readonly rev: number;
  readonly value: Readonly<Record<string, unknown>>;
}

/**
 * One write inside a `transact`: the same compare-and-set as `put`, so `expectedRev: null` means "this key
 * must not exist" and a number means "it must still be at that revision".
 */
export interface StoreWrite {
  readonly key: ItemKey;
  readonly value: Readonly<Record<string, unknown>>;
  readonly expectedRev: number | null;
}

/**
 * A read of ONE PARTITION, for the endpoints that need more than a key.
 *
 * IT IS NOT A SCAN, AND THE TYPE IS WHAT SAYS SO: `pk` is required, so a caller cannot ask for the table, and there
 * is no filter — a caller that wants a subset asks for it in the sort key or filters the answer it was given. That
 * is deliberate for the leaderboard: a board IS one partition (`board#<mode>#<level>#<period>`), and a `query` that
 * could scan would be the operation this store has refused to have since it was written.
 *
 * `limit` CAPS WHAT IS RETURNED, in the order the keys give — so what it can return depends on WHICH keys. The base
 * table's sort key for a board is the PLAYER, which is why "the top N" needed `index` below; an index whose sort
 * key is the score returns the top N directly.
 */
export interface ItemQuery {
  readonly pk: string;
  /** Only rows whose sort key starts with this. Absent means the whole partition. */
  readonly skPrefix?: string;
  readonly limit: number;
  /** Sort-key DESCENDING order. Never a value order — see the note above. */
  readonly descending?: boolean;
  /**
   * The NAME of a secondary index to read instead of the base table, or absent for the table itself.
   *
   * A NAME, NOT AN ATTRIBUTE PAIR, because what an index IS belongs to the store and the table definition: both
   * resolve it through the same map (`keys.ts`'s `INDEX_ATTRIBUTES`), so a caller cannot ask for an index no table
   * has, and a store that does not know the name REFUSES the read rather than returning an empty answer that looks
   * like an empty board. When it is set, `pk` is the index's partition and the ordering is the index's sort key.
   */
  readonly index?: string;
}

/**
 * The item store, as the handlers need it.
 *
 * `put` IS A COMPARE-AND-SET AND RETURNS WHETHER IT LANDED. `expectedRev === null` means "this key must not
 * exist"; a number means "this key must still be at that revision". False is not an error — it is another
 * writer having moved first, and the caller re-reads and decides again (see `MAX_WRITE_ATTEMPTS`).
 *
 * THERE IS STILL NO DELETE AND NO SCAN. The `query` below is the one addition the leaderboard needed, and it was
 * added WITH that endpoint rather than before it (AGENTS.md §4.5: a rule that exists is a rule that is tested).
 */
export interface ItemStore {
  get(key: ItemKey): Promise<StoredItem | null>;
  query(query: ItemQuery): Promise<StoredItem[]>;
  put(key: ItemKey, value: Readonly<Record<string, unknown>>, expectedRev: number | null): Promise<boolean>;
  /**
   * Write several items as ONE UNIT: every write lands or none does. False means a condition failed — the
   * caller lost a race, or a key it meant to create already exists — and NOTHING was written.
   *
   * WHY THE PORT HAS THIS AT ALL. A completed run changes three or four rows (its own ledger entry, the
   * player's progress, the hint balance, the board), and those are different items: applied one at a time, a
   * failure on the third leaves the first two in place, which is a run that half happened. MEASURED, by the
   * contract probe's control: two plain `put`s leave the first behind when the second is refused.
   *
   * A KEY MAY APPEAR AT MOST ONCE in one transaction. DynamoDB refuses a transaction that touches the same
   * item twice, and the in-memory twin throws for the same input rather than quietly applying both — a
   * divergence between the two would be found in production otherwise.
   */
  transact(writes: readonly StoreWrite[]): Promise<boolean>;
}

/** Time, injected: a handler that called `Date.now()` could not be probed for its clock arithmetic. */
export interface Clock {
  nowMs(): number;
}

/** How a caller's identity was established. The three modes of DESIGN.md 11.2, named where they are produced. */
type IdentitySource = 'dev' | 'emulator' | 'cognito';

/**
 * Who is asking, and on what authority.
 *
 * IT IS AN OBJECT RATHER THAN A STRING BECAUSE THE AUTHORITY IS PART OF THE ANSWER. MEASURED, and it is the
 * whole of §11.1: this port used to return a bare `string`, and the dev adapter returned `dev:<name>` for any
 * request that carried `x-dev-player` — so a caller who could reach the port owned whatever player they named,
 * with that player's progress, hints and board, and nothing in the type or the code said which of the two it
 * had got. The source is now carried beside the id, so a probe can tell a header-derived identity from a
 * verified one and assert that a token mode produced the second; §11.1's audit row (A25) records the same field
 * when the refusal counters land.
 *
 * IT IS STILL NOT AN "AUTHENTICATED" FLAG. Whether a source is acceptable for a write is the adapter's
 * decision — the `dev` adapter is only ever built in development mode, and the token adapters never look at a
 * request header at all — so a handler asks "is there an identity" and gets the same answer in every mode.
 */
export interface Identity {
  readonly playerId: string;
  readonly source: IdentitySource;
}

/** The identity of a request, or null when the request proved none. */
export type IdentityOf = (request: ApiRequest) => Identity | null;

/** A request as the handlers see it: no socket, no event shape, no framework. */
export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  /** The query string as a plain map; a repeated key keeps the last value, which is what the endpoints want. */
  readonly query: Readonly<Record<string, string>>;
  /** The parsed JSON body, or null when there was none. Parsing is the adapter's job. */
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * A response as the handlers build it: a status and a JSON-serialisable body.
 *
 * THE BODY IS ALWAYS AN OBJECT, even for an error, so the client has one shape to read and the error path is
 * not a special case. `no-store` is added by the adapters, not here.
 */
export interface ApiResult {
  readonly status: number;
  readonly body: unknown;
}

/** Everything a handler is given. One argument, so a probe constructs a whole server in three lines. */
export interface Deps {
  readonly store: ItemStore;
  readonly clock: Clock;
  readonly identityOf: IdentityOf;
}

/** A handler: a pure-ish function of a request and its dependencies. */
export type Handler = (request: ApiRequest, deps: Deps) => Promise<ApiResult>;

/**
 * How many times a read-modify-write may lose a compare-and-set before the request gives up.
 *
 * THREE, because a lost race means another request just wrote the same key, and its write is the one that
 * should be observed: the retry re-reads and usually returns the winner's answer. A fourth attempt would only
 * matter under sustained contention on one player's row, which is a single user double-clicking, and the
 * caller gets a `contended` refusal rather than a silent overwrite.
 */
export const MAX_WRITE_ATTEMPTS = 3;
