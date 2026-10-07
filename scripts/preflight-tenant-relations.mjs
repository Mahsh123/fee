import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { buildTenantRelationInventory, runTenantRelationPreflight } from './tenant-relation-preflight.mjs';

const connectionString = process.env.MIGRATION_DATABASE_URL;
const migrationRole = process.env.MIGRATION_DATABASE_ROLE;
if (!connectionString || !migrationRole) {
  throw new Error('MIGRATION_DATABASE_URL and MIGRATION_DATABASE_ROLE are required for tenant relation preflight');
}

const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const relations = buildTenantRelationInventory(schema);
const client = new Client({ connectionString });

try {
  await client.connect();
  const identity = await client.query('SELECT current_user AS role_name, session_user AS login_role');
  if (identity.rows[0]?.role_name !== migrationRole || identity.rows[0]?.login_role !== migrationRole) {
    throw new Error('Connected database role does not match MIGRATION_DATABASE_ROLE');
  }
  const result = await runTenantRelationPreflight(client, relations);
  process.stdout.write(`Tenant relation preflight passed for ${result.checkedRelations} relations.\n`);
} finally {
  await client.end();
}
