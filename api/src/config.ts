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
  /**
   * The address the dev server BINDS, `DSQ_HOST`.
   *
   * LOOPBACK BY DEFAULT, and that default is the boundary §6 relies on: this server answers `*` CORS with no cookies,
   * which is only safe while the port cannot be reached from anywhere else. A phone on the same network needs the APP
   * and this API bound wider, so this is the one switch that moves the boundary — `0.0.0.0` is the usual choice, and
   * `startFromEnv` says out loud when a run is reachable.
   */
  readonly host: string;
  /**
   * How a request's identity is established (DESIGN.md 11.2). The one setting that decides whether a header can
   * name a player, so it is read once here and never at a point of use.
   */
  readonly auth: AuthMode;
  /** Whether this configuration believes it is production. Only `authRefusal` reads it, and it is the guard. */
  readonly environment: 'development' | 'production';
  /** The one origin allowed by CORS, or null for the development server's `*`. */
  readonly corsOrigin: string | null;
  /** The emulator's signing secret. Null means "mint one for this process", which invalidates tokens on restart. */
  readonly authSecret: string | null;
  /** Whether the emulator's signup requires a confirmation code (`DSQ_AUTH_CONFIRM=1`). */
  readonly confirmAccounts: boolean;
  /** The expected `iss` of a deployed token, and its audience. Both are required by `authRefusal` in cognito mode. */
  readonly cognitoIssuer: string | null;
  readonly cognitoAudience: string | null;
  /** A JWKS document on disk, so the cognito path can be driven without a pool. The deployment fetches it instead. */
  readonly cognitoJwksFile: string | null;
}

/**
 * The identity modes of DESIGN.md 11.2.
 *
 * `dev` IS A DEVELOPMENT MODE AND NOT A FALLBACK: it trusts `x-dev-player`, so it is refused in production and
 * against a real endpoint (`authRefusal`). `emulate` signs and verifies real JWTs locally so the sign-in feature
 * is testable with no provider. `cognito` verifies a token against the pool's keys and is what a deployment uses.
 */
export type AuthMode = 'dev' | 'emulate' | 'cognito';

/** The AWS region used when nothing says otherwise. `eu-west-2` because that is where the book deploys. */
const DEFAULT_REGION = 'eu-west-2';

/** The table a developer gets with no configuration at all. */
const DEFAULT_TABLE = 'dancing-squared-dev';

/** The port DynamoDB Local listens on in `api/docker-compose.yml`. */
export const DEFAULT_DDB_ENDPOINT = 'http://127.0.0.1:8000';

/**
 * THE BIND ADDRESS OF EVERY RUN THAT DID NOT ASK FOR ANYTHING ELSE.
 *
 * It is the boundary, not a preference: the dev server answers `*` CORS and takes its identity from a header or a
 * locally-signed token, so a port that only this machine can reach is what makes those choices safe (`corsHeaders` in
 * `dev-server.ts` states the reasoning). A LAN run — a phone testing the app, MEASURED on 192.168.1.189 — sets
 * `DSQ_HOST=0.0.0.0` and is TOLD OUT LOUD that it is reachable.
 */
export const LOOPBACK = '127.0.0.1';

/**
 * Whether this configuration listens beyond loopback, which is what makes a run reachable from another device.
 *
 * `'::'` IS THE IPv6 WILDCARD and `'0.0.0.0'` the IPv4 one; a concrete interface address is reachable too, so the test
 * is what is NOT loopback rather than a list of what is wide.
 */
export function listensBeyondLoopback(config: Config): boolean {
  return config.host !== LOOPBACK && config.host !== 'localhost' && config.host !== '::1';
}

/** The opt-in that turns "no endpoint" from an accident into a decision. */
export const ALLOW_REAL_AWS = 'DSQ_ALLOW_REAL_AWS';

/**
 * Why this configuration must not run unattended, or null when it is safe.
 *
 * MEASURED, AND IT COST A REAL TABLE. `npm run api:table` with no `DSQ_DDB_ENDPOINT` resolved the REAL service
 * for the region and CREATED the table in the account this machine's ambient credentials belong to — a setup
 * tool whose default action was to make infrastructure somewhere the user never named. The same shape applies
 * to the dev server, which SEEDS the local fixture: with store=dynamodb and no endpoint it would write
 * development schedule rows into a production table. Reading is not the danger; creating and seeding are.
 *
 * SO AN ENDPOINT IS REQUIRED, OR AN EXPLICIT `DSQ_ALLOW_REAL_AWS=1`. A deployed Lambda passes neither and never
 * calls this — it is a guard for the two entry points that WORK on a store (the setup tool and the dev server),
 * not a rule inside the handlers.
 */
export function realServiceWarning(config: Config, env: Record<string, string | undefined> = process.env): string | null {
  if (config.endpoint !== null) return null;
  if (env[ALLOW_REAL_AWS] === '1') return null;
  return `no DSQ_DDB_ENDPOINT is set, so this would use the REAL AWS service in ${config.region}: set DSQ_DDB_ENDPOINT for a local run, or ${ALLOW_REAL_AWS}=1 to mean it`;
}

/**
 * Why the DEV SERVER must not start, or null when it may.
 *
 * THE STORE DECIDES, WHICH IS THE WHOLE POINT OF THIS FUNCTION EXISTING SEPARATELY. `realServiceWarning` answers
 * "would this configuration talk to the real service", which is the right question for a tool that always talks to
 * DynamoDB (`api:table`) — but the dev server only talks to it when it was asked to, and the memory store never
 * leaves the process. MEASURED, and it is how this was found: applying the warning unconditionally made
 * `npm run dev:api` REFUSE TO START with no endpoint, which is its normal, entirely local configuration.
 */
export function devServerRefusal(config: Config, env: Record<string, string | undefined> = process.env): string | null {
  // A URL IS NOT A BIND ADDRESS. `listen` takes a hostname, so `DSQ_HOST=http://0.0.0.0` would be resolved as one and
  // fail with an ENOENT that reads like a missing file rather than a configuration mistake (AGENTS.md §11.1: a refusal
  // is a value, and a degradation is loud).
  if (config.host.includes('://') || config.host.includes('/') || config.host.trim() === '') {
    return `DSQ_HOST is a bind address, not a URL — use 0.0.0.0 or an address of this machine (got "${config.host}")`;
  }
  return config.store === 'dynamodb' ? realServiceWarning(config, env) : null;
}

/**
 * Why this identity configuration must not run, or null when it may.
 *
 * MEASURED AND IT IS THE POINT OF THE WHOLE FILE (AGENTS.md §8 trap 23): the dev adapter accepts
 * `x-dev-player: <anyone>` as that player, so against a real store ANY caller who can reach the port owns that
 * player's progress, hints and board. The rule is therefore not "warn" but "do not start", with the same shape
 * as `realServiceWarning` — and for the same reason, which is that a developer's default is a local container
 * while a credential chain's default is production.
 *
 * `DSQ_ENV=production` IS THE OPERATOR'S ASSERTION and it is what makes a real endpoint unnecessary: a
 * deployment behind a domain may have no `DSQ_DDB_ENDPOINT` at all, and inferring production from the absence of
 * one would be exactly wrong. Both checks are kept because they fail in different directions — the environment
 * catches a misconfigured deploy, and the endpoint catches a local run pointed at a real table.
 *
 * COGNITO MODE WITHOUT A POOL IS REFUSED HERE TOO. A verifier with no issuer and no audience would accept a
 * token signed by anyone who guessed the shape, which is worse than not starting.
 */
export function authRefusal(config: Config, env: Record<string, string | undefined> = process.env): string | null {
  if (config.auth === 'dev') {
    if (config.environment === 'production') {
      return 'DSQ_AUTH=dev trusts the x-dev-player header, so ANY caller could name any player: use DSQ_AUTH=cognito in production';
    }
    const real = realServiceWarning(config, env);
    if (config.store === 'dynamodb' && real) return `DSQ_AUTH=dev against the real service is refused — ${real}`;
    return null;
  }
  if (config.auth === 'cognito') {
    const missing = [
      ...(config.cognitoIssuer ? [] : ['DSQ_COGNITO_ISSUER']),
      ...(config.cognitoAudience ? [] : ['DSQ_COGNITO_AUDIENCE']),
    ];
    if (missing.length) return `DSQ_AUTH=cognito needs ${missing.join(' and ')}: without them the verifier would accept a token from anywhere`;
  }
  return null;
}

/**
 * Read the configuration.
 *
 * `DSQ_STORE=dynamodb` ALONE DOES NOT POINT AT AWS. With no `DSQ_DDB_ENDPOINT` the SDK resolves the real
 * service for the region — which is what a deployed function wants and what a developer must ask for
 * explicitly, since the local compose file is the default way to run this store. That asymmetry is deliberate:
 * a typo in an endpoint is a local annoyance, while a missing endpoint in production is an outage.
 *
 * `DSQ_AUTH` DEFAULTS TO `dev` AND THAT IS A DELIBERATE DEFAULT FOR A LOCAL TOOL, which is why it is refused
 * everywhere it could matter rather than unset everywhere: the ordinary local run has to work with no setup
 * (that is the requirement that produced the emulator), and the guard, not the default, is what keeps it local.
 */
export function configFromEnv(env: Record<string, string | undefined> = process.env): Config {
  const store = env['DSQ_STORE'] === 'dynamodb' ? 'dynamodb' : 'memory';
  const port = Number(env['DSQ_PORT'] ?? 8090);
  const auth = env['DSQ_AUTH'];
  return {
    store,
    table: env['DSQ_TABLE'] ?? DEFAULT_TABLE,
    endpoint: env['DSQ_DDB_ENDPOINT'] ?? null,
    region: env['DSQ_REGION'] ?? DEFAULT_REGION,
    port: Number.isFinite(port) && port >= 0 ? port : 8090,
    // THE BIND ADDRESS, not a URL: `devServerRefusal` refuses a value that looks like one, because `listen` would take
    // `http://0.0.0.0` as a HOSTNAME and fail with an ENOENT that reads like a missing file.
    host: env['DSQ_HOST'] ?? LOOPBACK,
    auth: auth === 'emulate' || auth === 'cognito' ? auth : 'dev',
    environment: env['DSQ_ENV'] === 'production' ? 'production' : 'development',
    corsOrigin: env['DSQ_CORS_ORIGIN'] ?? null,
    authSecret: env['DSQ_AUTH_SECRET'] ?? null,
    confirmAccounts: env['DSQ_AUTH_CONFIRM'] === '1',
    cognitoIssuer: env['DSQ_COGNITO_ISSUER'] ?? null,
    cognitoAudience: env['DSQ_COGNITO_AUDIENCE'] ?? null,
    cognitoJwksFile: env['DSQ_COGNITO_JWKS_FILE'] ?? null,
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
