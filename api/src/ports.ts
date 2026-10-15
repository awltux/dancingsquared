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
 * The item store, as the handlers need it.
 *
 * `put` IS A COMPARE-AND-SET AND RETURNS WHETHER IT LANDED. `expectedRev === null` means "this key must not
 * exist"; a number means "this key must still be at that revision". False is not an error — it is another
 * writer having moved first, and the caller re-reads and decides again (see `MAX_WRITE_ATTEMPTS`).
 *
 * THERE IS NO DELETE AND NO SCAN, because nothing in the endpoints implemented so far needs one: a schedule
 * and a player's progress are both read by key. A leaderboard query would add a `query`, and it should be
 * added when the endpoint that needs it is written rather than now (AGENTS.md 4.5).
 */
export interface ItemStore {
  get(key: ItemKey): Promise<StoredItem | null>;
  put(key: ItemKey, value: Readonly<Record<string, unknown>>, expectedRev: number | null): Promise<boolean>;
}

/** Time, injected: a handler that called `Date.now()` could not be probed for its clock arithmetic. */
export interface Clock {
  nowMs(): number;
}

/**
 * Who is asking.
 *
 * ONE STRING, TWO SOURCES, AND THE ENDPOINTS DO NOT CARE WHICH. A signed-in player is their Cognito `sub`; an
 * anonymous one is a device id, because the Drill is the funnel and must work with no account (DESIGN.md 8).
 * That is why this returns a plain player id rather than an "authenticated" flag: the difference between the
 * two lives in what they are allowed to CLAIM (the score board), not in what they are allowed to play.
 */
export type PlayerIdOf = (request: ApiRequest) => string | null;

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
  readonly playerIdOf: PlayerIdOf;
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
