// The DynamoDB adapter: the same contract as the in-memory twin, over one table and two key attributes.
//
// THE COMPARE-AND-SET IS THE WHOLE FILE. DynamoDB has no revision of its own, so one is stored as a plain
// attribute and every write CARRIES THE REVISION IT EXPECTS in a `ConditionExpression`: `attribute_not_exists`
// for a create, `#rev = :rev` for a replace. That is what makes "two requests cannot both issue a drill" a
// property of one conditional write rather than of a lock nobody can test, and it is why `ItemStore.put`
// reports a boolean instead of throwing.
//
// CONDITIONAL-CHECK-FAILURE IS NOT AN ERROR. It is the answer "another writer moved first", which the caller
// handles by re-reading — so it returns false, and every other failure propagates. It is distinguished by NAME
// rather than by `instanceof`: a lambda runtime, a bundler and a local dev install can each give you a
// different copy of the SDK's error class, and only the name is stable across them.
//
// THE ITEM IS FLAT. `value`'s fields are stored as top-level attributes beside `PK`, `SK` and `rev`, so an item
// is readable in the console and a future GSI can key on a field of it. The three store-owned attributes are
// REMOVED on the way out, which is what keeps `value` the domain's shape rather than a union of both.
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { ItemKey, ItemQuery, ItemStore, StoreWrite, StoredItem } from '../ports.ts';
import { BOARD_INDEX, BOARD_INDEX_PK, BOARD_INDEX_SK, INDEX_ATTRIBUTES } from '../keys.ts';
import { plainItem } from './plain-item.ts';

/** The key attributes, as DESIGN.md 11's table writes them. */
const PK = 'PK';
const SK = 'SK';
/** The revision attribute. Always named in an expression, never interpolated into one. */
const REV = 'rev';

/** Whether a failed request failed for `name` — the only stable identity an SDK error has, see the header. */
function isNamed(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;
}

/**
 * The cancellation codes that mean "another writer moved first" rather than "this request is wrong".
 *
 * `ConditionalCheckFailed` IS THE MEASURED ONE: a transaction whose second condition was impossible came back
 * as `TransactionCanceledException` with `CancellationReasons: [{Code: 'None'}, {Code:
 * 'ConditionalCheckFailed'}]` — one reason per item, `None` for the items that were fine. `TransactionConflict`
 * is the other code that means a lost race, and it is named here from the service's documented set rather than
 * measured locally, because DynamoDB Local does not produce it. Everything else — a size limit, throttling, a
 * validation error — PROPAGATES, because treating a capacity failure as "you lost a race" would silently
 * discard a player's run.
 */
const LOST_RACE: ReadonlySet<string> = new Set(['None', 'ConditionalCheckFailed', 'TransactionConflict']);

/**
 * One returned item as the store's shape: the three store-owned attributes removed.
 *
 * IT IS ONE FUNCTION BECAUSE THERE ARE NOW THREE READERS. The store's own fields must not leak into `value`, and a
 * second copy of the strip list is how a fourth attribute ends up in the domain's shape without anyone noticing.
 */
function asStored(item: Record<string, unknown>): StoredItem {
  const rev = item[REV];
  const value: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(item)) {
    if (name === PK || name === SK || name === REV) continue;
    value[name] = field;
  }
  return { rev: typeof rev === 'number' ? rev : 0, value };
}

export class DynamoStore implements ItemStore {
  // NO CONSTRUCTOR PARAMETER PROPERTIES, AND THE COMPILER WILL NOT TELL YOU. Node runs this file by STRIPPING
  // types rather than compiling them, and strip-only mode refuses the syntax outright:
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported in strip-only mode` —
  // after `tsc -p api --noEmit` has passed, so the failure appears the first time a probe imports the file.
  // MEASURED exactly here. Explicit fields are the only form that both compiles and runs.
  private readonly client: DynamoDBDocumentClient;
  private readonly table: string;

  constructor(client: DynamoDBDocumentClient, table: string) {
    this.client = client;
    this.table = table;
  }

  async get(key: ItemKey): Promise<StoredItem | null> {
    const answer = await this.client.send(new GetCommand({ TableName: this.table, Key: { [PK]: key.pk, [SK]: key.sk } }));
    if (!answer.Item) return null;
    return asStored(answer.Item as Record<string, unknown>);
  }

  /**
   * Read one partition, in sort-key order — of the base table, or of a named INDEX.
   *
   * IT IS A `Query` AND NEVER A `Scan`, which is the whole reason the port's shape requires a partition: the board
   * is one partition, so this reads one board and cannot read another. `Limit` caps what comes back WITHOUT a
   * `FilterExpression`, so it is exact rather than "the first N evaluated" — the distinction the port's note warns
   * about. The name attributes are always used for the keys, never interpolated, and for an index the names come
   * from the same map the table definition builds the index from, so a read cannot address an index that is not
   * there. An index name THIS BUILD DOES NOT KNOW throws rather than querying the table by mistake: an empty answer
   * and an unreadable board must not look alike (the twin throws for the same input).
   */
  async query(request: ItemQuery): Promise<StoredItem[]> {
    const index = request.index === undefined ? null : INDEX_ATTRIBUTES[request.index];
    if (request.index !== undefined && index === undefined) {
      throw new Error(`no index named ${request.index} in this build`);
    }
    const keyPk = index ? index.pk : PK;
    const keySk = index ? index.sk : SK;
    const wholePartition = request.skPrefix === undefined;
    const answer = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        ...(index ? { IndexName: request.index } : {}),
        KeyConditionExpression: wholePartition ? '#pk = :pk' : '#pk = :pk AND begins_with(#sk, :sk)',
        ExpressionAttributeNames: { '#pk': keyPk, ...(wholePartition ? {} : { '#sk': keySk }) },
        ExpressionAttributeValues: { ':pk': request.pk, ...(wholePartition ? {} : { ':sk': request.skPrefix }) },
        Limit: request.limit,
        ScanIndexForward: request.descending !== true,
      }),
    );
    return (answer.Items ?? []).map((item) => asStored(item as Record<string, unknown>));
  }

  /**
   * Every write in one `TransactWriteItems`: all of them or none.
   *
   * THE CONDITIONS TRAVEL WITH THE WRITES, exactly as `put` sends them, so a transaction is the same
   * compare-and-set applied to several items at once — which is what lets the run handler read three rows,
   * decide, and have the decision land as one thing.
   */
  async transact(writes: readonly StoreWrite[]): Promise<boolean> {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: writes.map((write) => ({
            Put: {
              TableName: this.table,
              // THE DOMAIN VALUE IS CONVERTED FIRST, so an `undefined` nested in it is absent rather than fatal
              // (`plain-item.ts` has the measurement: the boot used to die here against DynamoDB Local).
              Item: { ...(plainItem(write.value) as Record<string, unknown>), [PK]: write.key.pk, [SK]: write.key.sk, [REV]: (write.expectedRev ?? 0) + 1 },
              ConditionExpression: write.expectedRev === null ? `attribute_not_exists(${PK})` : `#rev = :rev`,
              ...(write.expectedRev === null
                ? {}
                : { ExpressionAttributeNames: { '#rev': REV }, ExpressionAttributeValues: { ':rev': write.expectedRev } }),
            },
          })),
        }),
      );
      return true;
    } catch (error) {
      if (!isNamed(error, 'TransactionCanceledException')) throw error;
      const reasons = (error as { CancellationReasons?: readonly { Code?: string }[] }).CancellationReasons ?? [];
      if (reasons.length > 0 && reasons.every((reason) => LOST_RACE.has(reason.Code ?? ''))) return false;
      throw error;
    }
  }

  async put(key: ItemKey, value: Readonly<Record<string, unknown>>, expectedRev: number | null): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          // THE STORE'S OWN FIELDS COME LAST, so a value that happened to carry a `PK` cannot move the item — and the
          // domain value is converted first, so an `undefined` nested in it is absent rather than fatal
          // (`plain-item.ts` has the measurement: the boot used to die here against DynamoDB Local).
          Item: { ...(plainItem(value) as Record<string, unknown>), [PK]: key.pk, [SK]: key.sk, [REV]: (expectedRev ?? 0) + 1 },
          ConditionExpression: expectedRev === null ? `attribute_not_exists(${PK})` : `#rev = :rev`,
          ...(expectedRev === null
            ? {}
            : { ExpressionAttributeNames: { '#rev': REV }, ExpressionAttributeValues: { ':rev': expectedRev } }),
        }),
      );
      return true;
    } catch (error) {
      if (isNamed(error, 'ConditionalCheckFailedException')) return false;
      throw error;
    }
  }
}

/**
 * Build the client pair for a table.
 *
 * `DynamoDBDocumentClient` marshals plain JavaScript values, which is what `value` is, and its marshalling
 * options are left at their defaults on purpose: turning on `removeUndefinedValues` would silently drop a
 * field a caller meant to write, and turning on `convertClassInstanceToMap` would let a class instance in —
 * neither is a case this API has, and both would be invisible when it happened.
 */
export function dynamoClient(options: DynamoDBClientConfig): { raw: DynamoDBClient; document: DynamoDBDocumentClient } {
  const raw = new DynamoDBClient(options);
  return { raw, document: DynamoDBDocumentClient.from(raw) };
}

/**
 * Create the single table, or report that it already exists.
 *
 * PAY_PER_REQUEST RATHER THAN PROVISIONED, because this table is a small game's and provisioned capacity is a
 * bill for idle time. It is idempotent so a setup script can call it every time, and it is separate from the
 * store so a deployment can create the table from its template and never call this at all.
 *
 * THE BOARD INDEX IS PART OF THE TABLE rather than something a caller adds, and it is built from the same constants
 * `keys.ts` gives the stores, so the schema and the readers cannot disagree about what an index name means. Its
 * projection is ALL rather than a list of attributes, and that is a decision with a measurement behind it: the
 * in-memory twin returns the whole item for an index read (it projects nothing), so a GSI that projected a SUBSET
 * would make the two stores answer differently for the same query — and the contract suite runs the same checks
 * against both, which is the only reason that divergence would be found before production.
 *
 * A TABLE THAT ALREADY EXISTS IS NOT ALTERED, so an index added after the fact needs `UpdateTable` (or, in
 * development, a fresh container). This function reports false for that case and says nothing about the index: the
 * honest place for that is the deployment's template, which does not exist yet (DESIGN.md §13's stage 7).
 */
export async function createTable(raw: DynamoDBClient, table: string): Promise<boolean> {
  try {
    await raw.send(
      new CreateTableCommand({
        TableName: table,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: PK, AttributeType: 'S' },
          { AttributeName: SK, AttributeType: 'S' },
          { AttributeName: BOARD_INDEX_PK, AttributeType: 'S' },
          { AttributeName: BOARD_INDEX_SK, AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: PK, KeyType: 'HASH' },
          { AttributeName: SK, KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: BOARD_INDEX,
            KeySchema: [
              { AttributeName: BOARD_INDEX_PK, KeyType: 'HASH' },
              { AttributeName: BOARD_INDEX_SK, KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );
    return true;
  } catch (error) {
    if (isNamed(error, 'ResourceInUseException')) return false;
    throw error;
  }
}

/**
 * Whether the table is there.
 *
 * USED AT BOOT, so a missing table is reported with the command that creates it rather than surfacing as a
 * `ResourceNotFoundException` on the first request a player makes.
 */
export async function tableExists(raw: DynamoDBClient, table: string): Promise<boolean> {
  try {
    await raw.send(new DescribeTableCommand({ TableName: table }));
    return true;
  } catch (error) {
    if (isNamed(error, 'ResourceNotFoundException')) return false;
    throw error;
  }
}
