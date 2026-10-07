import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from 'pg';

const connectionString = process.env.PAYER_GUARDIAN_PREFLIGHT_TEST_DATABASE_URL;
if (!connectionString) throw new Error('PAYER_GUARDIAN_PREFLIGHT_TEST_DATABASE_URL must point to a disposable PostgreSQL 17 database');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationSql = await readFile(resolve(root, 'prisma/migrations/20261003000100_payer_guardian_identity_preflight/migration.sql'), 'utf8');

const fixtureSql = `
  CREATE TEMP TABLE payer_responsibility_rules (
    id uuid, "payerType" text, "payerGuardianId" uuid, active boolean,
    "deletedAt" timestamp, "effectiveTo" date
  ) ON COMMIT DROP;
  CREATE TEMP TABLE fee_demands (
    id uuid, "tenantId" uuid, status text, currency text
  ) ON COMMIT DROP;
  CREATE TEMP TABLE fee_demand_items (
    id uuid, "tenantId" uuid, "demandId" uuid, status text,
    "netAmount" numeric DEFAULT 100, "adjustmentAmount" numeric DEFAULT 0,
    "paidAmount" numeric DEFAULT 0, "waivedAmount" numeric DEFAULT 0
  ) ON COMMIT DROP;
  CREATE TEMP TABLE fee_demand_responsibilities (
    id uuid, "tenantId" uuid, "demandId" uuid, "demandItemId" uuid,
    "payerType" text, "payerGuardianId" uuid, amount numeric, priority integer DEFAULT 100
  ) ON COMMIT DROP;
  CREATE TEMP TABLE payment_allocations (
    id uuid, "tenantId" uuid, "responsibilityId" uuid, amount numeric, "reversedAt" timestamptz
  ) ON COMMIT DROP;
  CREATE TEMP TABLE credit_allocations (
    id uuid, "tenantId" uuid, "responsibilityId" uuid, amount numeric, "reversedAt" timestamptz
  ) ON COMMIT DROP;
  CREATE TEMP TABLE refund_allocations (
    id uuid, "tenantId" uuid, "paymentAllocationId" uuid, "creditAllocationId" uuid, amount numeric
  ) ON COMMIT DROP;
  CREATE TEMP TABLE payment_orders (
    id uuid, "tenantId" uuid, "payerType" text, "payerGuardianId" uuid, status text, "expiresAt" timestamptz
  ) ON COMMIT DROP;
`;

async function scenario(client, setup, expectedError) {
  await client.query('BEGIN');
  try {
    await client.query(fixtureSql);
    if (setup) await setup(client);
    if (expectedError) {
      await assert.rejects(client.query(migrationSql), (error) => {
        assert.equal(error.code, '23514');
        assert.match(error.message, /Guardian identity preflight blocked/);
        assert.match(error.detail ?? '', expectedError);
        return true;
      });
    } else {
      await client.query(migrationSql);
    }
  } finally {
    await client.query('ROLLBACK');
  }
}

test('guardian identity upgrade preflight blocks unsafe legacy payer data without mutating rows', async () => {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, application_name: 'fee-payer-guardian-preflight-test' });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const version = Number((await client.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version);
    assert.ok(version >= 170000 && version < 180000, 'integration test requires PostgreSQL 17');

    await scenario(client, null, null);
    await scenario(client, async (db) => {
      await db.query(`INSERT INTO payer_responsibility_rules (id, "payerType", "payerGuardianId", active, "deletedAt", "effectiveTo") VALUES ('00000000-0000-4000-8000-000000000001', 'PARENT', NULL, TRUE, NULL, NULL)`);
    }, /Unmapped active rules: 1; collectible open shares: 0; active online orders: 0/);

    await scenario(client, async (db) => {
      await db.query(`
        INSERT INTO fee_demands (id, "tenantId", status, currency)
        VALUES ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'ISSUED', 'INR');
        INSERT INTO fee_demand_items (id, "tenantId", "demandId", status)
        VALUES ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'UNPAID');
        INSERT INTO fee_demand_responsibilities (id, "tenantId", "demandId", "demandItemId", "payerType", "payerGuardianId", amount)
        VALUES ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011', 'GUARDIAN', NULL, 80);
      `);
    }, /Unmapped active rules: 0; collectible open shares: 1; active online orders: 0/);

    await scenario(client, async (db) => {
      await db.query(`
        INSERT INTO fee_demands (id, "tenantId", status, currency)
        VALUES ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'ISSUED', 'INR');
        INSERT INTO fee_demand_items (id, "tenantId", "demandId", status, "netAmount", "adjustmentAmount")
        VALUES ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'UNPAID', 100, -80);
        INSERT INTO fee_demand_responsibilities (id, "tenantId", "demandId", "demandItemId", "payerType", "payerGuardianId", amount, priority)
        VALUES
          ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011', 'SPONSOR', NULL, 20, 10),
          ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011', 'GUARDIAN', NULL, 80, 20);
      `);
    }, null);

    await scenario(client, async (db) => {
      await db.query(`
        INSERT INTO fee_demands (id, "tenantId", status, currency)
        VALUES ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'ISSUED', 'INR');
        INSERT INTO fee_demand_items (id, "tenantId", "demandId", status, "netAmount", "adjustmentAmount")
        VALUES ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'UNPAID', 100, -79);
        INSERT INTO fee_demand_responsibilities (id, "tenantId", "demandId", "demandItemId", "payerType", "payerGuardianId", amount, priority)
        VALUES
          ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011', 'SPONSOR', NULL, 20, 10),
          ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011', 'GUARDIAN', NULL, 80, 20);
      `);
    }, /Unmapped active rules: 0; collectible open shares: 1; active online orders: 0/);

    await scenario(client, async (db) => {
      await db.query(`
        INSERT INTO fee_demands (id, "tenantId", status, currency)
        VALUES ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'ISSUED', 'INR');
        INSERT INTO fee_demand_items (id, "tenantId", "demandId", status)
        VALUES ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'UNPAID');
        INSERT INTO fee_demand_responsibilities (id, "tenantId", "demandId", "demandItemId", "payerType", "payerGuardianId", amount)
        VALUES ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011', 'PARENT', NULL, 80);
        INSERT INTO payment_allocations (id, "tenantId", "responsibilityId", amount, "reversedAt")
        VALUES ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000012', 80, NULL);
      `);
    }, null);

    await scenario(client, async (db) => {
      await db.query(`
        INSERT INTO payment_orders (id, "tenantId", "payerType", "payerGuardianId", status, "expiresAt")
        VALUES ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000020', 'PARENT', NULL, 'INITIATED', CURRENT_TIMESTAMP - INTERVAL '5 minutes');
      `);
    }, /Unmapped active rules: 0; collectible open shares: 0; active online orders: 1/);

    await scenario(client, async (db) => {
      await db.query(`
        INSERT INTO payer_responsibility_rules (id, "payerType", "payerGuardianId", active, "deletedAt", "effectiveTo")
        VALUES ('00000000-0000-4000-8000-000000000001', 'PARENT', NULL, FALSE, NULL, NULL);
        INSERT INTO payment_orders (id, "tenantId", "payerType", "payerGuardianId", status, "expiresAt")
        VALUES ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000020', 'GUARDIAN', NULL, 'EXPIRED', CURRENT_TIMESTAMP - INTERVAL '5 minutes');
      `);
    }, null);
  } finally {
    if (connected) await client.end();
  }
});
