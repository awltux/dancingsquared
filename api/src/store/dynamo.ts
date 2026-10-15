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
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { ItemKey, ItemStore, StoreWrite, StoredItem } from '../ports.ts';

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
    const item = answer.Item as Record<string, unknown>;
    const rev = item[REV];
    const value: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(item)) {
      if (name === PK || name === SK || name === REV) continue;
      value[name] = field;
    }
    return { rev: typeof rev === 'number' ? rev : 0, value };
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
              Item: { ...write.value, [PK]: write.key.pk, [SK]: write.key.sk, [REV]: (write.expectedRev ?? 0) + 1 },
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
          // THE STORE'S OWN FIELDS COME LAST, so a value that happened to carry a `PK` cannot move the item.
          Item: { ...value, [PK]: key.pk, [SK]: key.sk, [REV]: (expectedRev ?? 0) + 1 },
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
        ],
        KeySchema: [
          { AttributeName: PK, KeyType: 'HASH' },
          { AttributeName: SK, KeyType: 'RANGE' },
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
