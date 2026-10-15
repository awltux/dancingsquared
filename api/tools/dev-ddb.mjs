// The dev server against DynamoDB Local, with no environment to set by hand.
//
//   docker compose -f api/docker-compose.yml up -d
//   npm run api:table
//   npm run dev:api:ddb
//
// WHY THIS IS A SCRIPT RATHER THAN `DSQ_STORE=dynamodb npm run dev:api`. npm runs a script through `cmd` on
// Windows and `sh` elsewhere, so an inline environment assignment is a different command on each — and this is
// the run a developer types most often, so it should be the same everywhere. The endpoint is left alone when
// the caller has set one, because pointing this at a real table is a thing someone will want to do.
process.env['DSQ_STORE'] = 'dynamodb';
process.env['DSQ_DDB_ENDPOINT'] ??= 'http://127.0.0.1:8000';

const { startFromEnv } = await import('../src/dev-server.ts');
await startFromEnv();
