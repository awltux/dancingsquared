// Which store to build, and the boot-time question a missing table would otherwise raise later.
//
// THE DEV SERVER AND THE LAMBDA HANDLER MUST OPEN THE STORE THE SAME WAY, or a development run and a deployed
// one differ in the one thing that decides where the data goes. This is that one way: a `Config` in, an
// `ItemStore` plus a label for `/health` out.
import { clientOptions, type Config } from '../config.ts';
import type { ItemStore } from '../ports.ts';
import { MemoryStore } from './memory.ts';
import { DynamoStore, dynamoClient, tableExists } from './dynamo.ts';

export interface OpenedStore {
  readonly store: ItemStore;
  /** What `/health` and the boot line report, so a run says which store it is using rather than implying one. */
  readonly label: string;
}

/**
 * Open the configured store.
 *
 * A MISSING TABLE IS A BOOT FAILURE WITH THE FIX IN THE MESSAGE, not a 500 an hour into a development session:
 * `npm run api:table` creates it, and the name is in the error so two tables cannot be confused. The alternative
 * — creating the table here — would make a developer's convenience the thing that runs against production.
 */
export async function openStore(config: Config): Promise<OpenedStore> {
  if (config.store === 'memory') return { store: new MemoryStore(), label: 'memory' };
  const { raw, document } = dynamoClient(clientOptions(config));
  const where = config.endpoint ?? `the ${config.region} DynamoDB endpoint`;
  if (!(await tableExists(raw, config.table))) {
    throw new Error(`the table "${config.table}" does not exist at ${where}: run "npm run api:table" to create it`);
  }
  return { store: new DynamoStore(document, config.table), label: `dynamodb ${config.table} at ${where}` };
}
