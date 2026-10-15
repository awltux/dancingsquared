// The API's configuration: one place that reads the environment, with the defaults that make it runnable.
//
// WHY A MODULE AND NOT `process.env` AT THE POINTS OF USE. Two adapters need the same answers — the local dev
// server and the Lambda handler — and a second reading of `process.env` is a second set of defaults, which is
// how a deployed function ends up pointed at a development table. Every name below is `DSQ_*` and every one
// has a default that works with no environment at all, so `npm run dev:api` needs no setup.
//
// NO SECRET IS READ HERE. Region, table and endpoint are identifiers rather than credentials: on AWS the
// function's role supplies the credentials (AGENTS.md 6 keeps them out of the repository entirely), and the
// local endpoint takes the dummy pair the SDK demands for a service that does not check one.
import type { DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';

export interface Config {
  /** Which store to build: the in-memory twin, or DynamoDB. */
  readonly store: 'memory' | 'dynamodb';
  /** The single table (DESIGN.md 11). One name for every item kind; the key shape distinguishes them. */
  readonly table: string;
  /** The DynamoDB endpoint override, or null to use the region's real service. */
  readonly endpoint: string | null;
  readonly region: string;
  /** The dev server's port. */
  readonly port: number;
}

/** The AWS region used when nothing says otherwise. `eu-west-2` because that is where the book deploys. */
export const DEFAULT_REGION = 'eu-west-2';

/** The table a developer gets with no configuration at all. */
export const DEFAULT_TABLE = 'dancing-squared-dev';

/** The port DynamoDB Local listens on in `api/docker-compose.yml`. */
export const DEFAULT_DDB_ENDPOINT = 'http://127.0.0.1:8000';

/**
 * Read the configuration.
 *
 * `DSQ_STORE=dynamodb` ALONE DOES NOT POINT AT AWS. With no `DSQ_DDB_ENDPOINT` the SDK resolves the real
 * service for the region — which is what a deployed function wants and what a developer must ask for
 * explicitly, since the local compose file is the default way to run this store. That asymmetry is deliberate:
 * a typo in an endpoint is a local annoyance, while a missing endpoint in production is an outage.
 */
export function configFromEnv(env: Record<string, string | undefined> = process.env): Config {
  const store = env['DSQ_STORE'] === 'dynamodb' ? 'dynamodb' : 'memory';
  const port = Number(env['DSQ_PORT'] ?? 8090);
  return {
    store,
    table: env['DSQ_TABLE'] ?? DEFAULT_TABLE,
    endpoint: env['DSQ_DDB_ENDPOINT'] ?? null,
    region: env['DSQ_REGION'] ?? DEFAULT_REGION,
    port: Number.isFinite(port) && port >= 0 ? port : 8090,
  };
}

/**
 * The SDK client options for a configuration.
 *
 * THE DUMMY PAIR IS FOR A LOCAL ENDPOINT ONLY, and it is set only when one is configured — so a real
 * deployment keeps its role and never sees a literal key. MEASURED (`api/tools/_measure-auth.mjs`, a throwaway
 * deleted after it was read): DynamoDB Local answered `DescribeTable` both WITH and WITHOUT credentials, so the
 * service checks nothing. The pair is still passed because it makes the local client independent of whatever
 * ambient AWS credentials the developer's machine happens to carry — the one thing that would make a local run
 * read a real table by accident.
 */
export function clientOptions(config: Config): DynamoDBClientConfig {
  return config.endpoint
    ? { region: config.region, endpoint: config.endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
    : { region: config.region };
}
