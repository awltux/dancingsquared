// Create the API's single table, or say it is already there.
//
//   npm run api:table
//
// IT PRINTS NOTHING BUT THE OUTCOME ON PURPOSE: an operator running this against a real account should see
// which table, at which endpoint, and whether it was created — and nothing else. The endpoint is in the line
// because "created" against the wrong endpoint is the mistake this command exists to make visible.
import { clientOptions, configFromEnv } from '../src/config.ts';
import { createTable, dynamoClient } from '../src/store/dynamo.ts';

const config = configFromEnv();
const { raw } = dynamoClient(clientOptions(config));
const created = await createTable(raw, config.table);
const where = config.endpoint ?? `the ${config.region} DynamoDB endpoint (the real service)`;
console.log(created ? `created table "${config.table}" at ${where}` : `table "${config.table}" already exists at ${where}`);
