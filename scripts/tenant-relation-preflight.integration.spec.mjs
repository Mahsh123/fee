import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { buildTenantRelationInventory, runTenantRelationPreflight, TenantRelationPreflightError } from './tenant-relation-preflight.mjs';

const connectionString = process.env.TENANT_PREFLIGHT_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error('TENANT_PREFLIGHT_TEST_DATABASE_URL must point to a disposable PostgreSQL database');
}

function snapshotRows(rows) {
  return rows.map((row) => ({ ...row }));
}

test('PostgreSQL preflight accepts same-tenant and nullable edges, and rejects cross-tenant/orphan rows without mutation', async () => {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  const schemaName = `preflight_${randomUUID().replaceAll('-', '')}`;
  const q = (name) => `"${name.replaceAll('"', '""')}"`;
  const qualified = (table) => `${q(schemaName)}.${q(table)}`;
  const readSnapshot = async () => ({
    tenants: snapshotRows((await client.query(`SELECT id::text FROM ${qualified('Tenant')} ORDER BY id`)).rows),
    parents: snapshotRows((await client.query(`SELECT id::text, tenant_id::text FROM ${qualified('parents')} ORDER BY id`)).rows),
    children: snapshotRows((await client.query(`SELECT id::text, tenant_id::text, parent_id::text FROM ${qualified('children')} ORDER BY id`)).rows),
  });
  const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const parentA = '11111111-1111-4111-8111-111111111111';
  const parentB = '22222222-2222-4222-8222-222222222222';
  const childValid = '33333333-3333-4333-8333-333333333333';
  const childNull = '44444444-4444-4444-8444-444444444444';
  const childCross = '55555555-5555-4555-8555-555555555555';
  const childOrphan = '66666666-6666-4666-8666-666666666666';

  const schema = `
model Tenant {
  id String @id @db.Uuid
  parents Parent[]
  children Child[]
  @@schema("${schemaName}")
}
model Parent {
  id String @id @db.Uuid
  tenantId String @db.Uuid @map("tenant_id")
  tenant Tenant @relation(fields: [tenantId], references: [id])
  children Child[]
  @@unique([tenantId, id])
  @@map("parents")
  @@schema("${schemaName}")
}
model Child {
  id String @id @db.Uuid
  tenantId String @db.Uuid @map("tenant_id")
  tenant Tenant @relation(fields: [tenantId], references: [id])
  parentId String? @db.Uuid @map("parent_id")
  parent Parent? @relation(fields: [tenantId, parentId], references: [tenantId, id], onDelete: NoAction)
  @@index([tenantId, parentId])
  @@unique([tenantId, id])
  @@map("children")
  @@schema("${schemaName}")
}
`;
  const relations = buildTenantRelationInventory(schema, ['Parent', 'Child']);

  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query(`CREATE SCHEMA ${q(schemaName)}`);
    await client.query(`CREATE TABLE ${qualified('Tenant')} (id uuid PRIMARY KEY)`);
    await client.query(`CREATE TABLE ${qualified('parents')} (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES ${qualified('Tenant')}(id),
      UNIQUE (tenant_id, id)
    )`);
    await client.query(`CREATE TABLE ${qualified('children')} (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL REFERENCES ${qualified('Tenant')}(id),
      parent_id uuid NULL REFERENCES ${qualified('parents')}(id),
      UNIQUE (tenant_id, id)
    )`);
    await client.query(`INSERT INTO ${qualified('Tenant')} (id) VALUES ($1), ($2)`, [tenantA, tenantB]);
    await client.query(`INSERT INTO ${qualified('parents')} (id, tenant_id) VALUES ($1, $2), ($3, $4)`, [parentA, tenantA, parentB, tenantB]);
    await client.query(`INSERT INTO ${qualified('children')} (id, tenant_id, parent_id) VALUES ($1, $2, $3), ($4, $5, NULL)`, [childValid, tenantA, parentA, childNull, tenantB]);

    const beforeValidPreflight = await readSnapshot();
    assert.deepEqual(await runTenantRelationPreflight(client, relations), { checkedRelations: 1, sampleLimit: 10 });
    assert.deepEqual(await readSnapshot(), beforeValidPreflight);

    await client.query(`INSERT INTO ${qualified('children')} (id, tenant_id, parent_id) VALUES ($1, $2, $3)`, [childCross, tenantA, parentB]);
    const beforeCrossFailure = await readSnapshot();
    await assert.rejects(
      runTenantRelationPreflight(client, relations),
      (error) => error instanceof TenantRelationPreflightError && error.findings.some((finding) => finding.rows.some((row) => row.source_id === childCross && row.violation === 'cross_tenant')) &&
        !/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/.test(error.message) &&
        !/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/.test(JSON.stringify(error.findings)),
    );
    const afterCrossFailure = await readSnapshot();
    assert.deepEqual(afterCrossFailure, beforeCrossFailure);

    await client.query(`DELETE FROM ${qualified('children')} WHERE id = $1`, [childCross]);
    await client.query(`ALTER TABLE ${qualified('children')} DROP CONSTRAINT children_parent_id_fkey`);
    await client.query(`INSERT INTO ${qualified('children')} (id, tenant_id, parent_id) VALUES ($1, $2, $3)`, [childOrphan, tenantA, '77777777-7777-4777-8777-777777777777']);
    const beforeOrphanFailure = await readSnapshot();
    await assert.rejects(
      runTenantRelationPreflight(client, relations),
      (error) => error instanceof TenantRelationPreflightError && error.findings.some((finding) => finding.rows.some((row) => row.source_id === childOrphan && row.violation === 'orphan')),
    );
    const afterOrphanFailure = await readSnapshot();
    assert.deepEqual(afterOrphanFailure, beforeOrphanFailure);
  } finally {
    if (connected) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The preflight owns and rolls back its own read-only transaction.
      }
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${q(schemaName)} CASCADE`);
      } finally {
        await client.end();
      }
    } else {
      await client.end().catch(() => {});
    }
  }
});
