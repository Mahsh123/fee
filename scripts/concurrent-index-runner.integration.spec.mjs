import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  concurrentIndexDefinitionHash,
  renderCreateIndexSql,
  renderIndexDefinition,
  runConcurrentIndexPlan,
  validateConcurrentIndexPlan,
  ConcurrentIndexBuildError,
} from './concurrent-index-runner.mjs';

const connectionString = process.env.SCHEMA_INDEX_TEST_DATABASE_URL;
if (!connectionString) throw new Error('SCHEMA_INDEX_TEST_DATABASE_URL must point to a disposable PostgreSQL 17 database');

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function qualified(schema, object) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(object)}`;
}

async function insertJournal(client, schema, plan, index, { attempt = 1, state = 'RUNNING' } = {}) {
  const canonical = validateConcurrentIndexPlan(plan);
  await client.query(
    `INSERT INTO ${qualified(schema, 'schema_index_builds')}
       (id, "stageChecksum", "indexName", "definitionHash", definition, attempt, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7::${qualified(schema, 'SchemaIndexBuildState')})`,
    [randomUUID(), canonical.checksum, index.indexName, concurrentIndexDefinitionHash(index), renderIndexDefinition(index), attempt, state],
  );
}

test('PostgreSQL 17 runner builds and recovers concurrent indexes without changing fixture rows', async () => {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, application_name: 'fee-schema-index-test' });
  const schema = `index_test_${randomUUID().replaceAll('-', '')}`;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const version = Number((await client.query('SELECT current_setting(\'server_version_num\')::int AS version')).rows[0].version);
    assert.ok(version >= 170000 && version < 180000, 'integration test requires PostgreSQL 17');

    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await client.query(`CREATE TYPE ${qualified(schema, 'SchemaIndexBuildState')} AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED')`);
    await client.query(`CREATE TABLE ${qualified(schema, 'schema_index_builds')} (
      id uuid PRIMARY KEY,
      "stageChecksum" char(64) NOT NULL,
      "indexName" text NOT NULL,
      "definitionHash" char(64) NOT NULL,
      definition text NOT NULL,
      attempt integer NOT NULL DEFAULT 1,
      state ${qualified(schema, 'SchemaIndexBuildState')} NOT NULL DEFAULT 'RUNNING',
      "startedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "completedAt" timestamptz,
      "errorCode" varchar(64),
      UNIQUE ("stageChecksum", "indexName", attempt)
    )`);
    await client.query(`CREATE TABLE ${qualified(schema, 'parents')} (id uuid NOT NULL, "tenantId" uuid NOT NULL, amount numeric(18,4) NOT NULL)`);
    await client.query(`CREATE TABLE ${qualified(schema, 'children')} (id uuid NOT NULL, "tenantId" uuid NOT NULL, "parentId" uuid NOT NULL, amount numeric(18,4) NOT NULL)`);
    await client.query(`CREATE TABLE ${qualified(schema, 'duplicates')} (id integer NOT NULL, value integer NOT NULL)`);
    await client.query(`CREATE TABLE ${qualified(schema, 'conflicts')} (left_key integer NOT NULL, right_key integer NOT NULL, amount numeric(18,4) NOT NULL)`);
    await client.query(`CREATE TABLE ${qualified(schema, 'empty_fixture')} (id uuid NOT NULL, "tenantId" uuid NOT NULL)`);
    await client.query(`CREATE TABLE ${qualified(schema, 'partial_fixture')} (id integer NOT NULL, nullable_key integer)`);
    await client.query(`CREATE TABLE ${qualified(schema, 'collation_fixture')} (value text NOT NULL)`);
    await client.query(`CREATE COLLATION ${qualified(schema, 'index_test_collation')} FROM pg_catalog."C"`);

    await client.query(`INSERT INTO ${qualified(schema, 'parents')} (id, "tenantId", amount)
      SELECT gen_random_uuid(), gen_random_uuid(), g::numeric / 100 FROM generate_series(1, 150) AS g`);
    await client.query(`INSERT INTO ${qualified(schema, 'children')} (id, "tenantId", "parentId", amount)
      SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), g::numeric / 100 FROM generate_series(1, 150) AS g`);
    await client.query(`INSERT INTO ${qualified(schema, 'duplicates')} VALUES (1, 10), (2, 10), (3, 11)`);
    await client.query(`INSERT INTO ${qualified(schema, 'conflicts')} VALUES (1, 9, 10.00), (2, 8, 20.00)`);
    await client.query(`INSERT INTO ${qualified(schema, 'partial_fixture')} VALUES (1, NULL), (2, 1)`);
    await client.query(`INSERT INTO ${qualified(schema, 'collation_fixture')} VALUES ('alpha'), ('beta')`);

    const readSnapshot = async () => ({
      parents: (await client.query(`SELECT id::text, "tenantId"::text, amount::text FROM ${qualified(schema, 'parents')} ORDER BY id`)).rows,
      children: (await client.query(`SELECT id::text, "tenantId"::text, "parentId"::text, amount::text FROM ${qualified(schema, 'children')} ORDER BY id`)).rows,
      duplicates: (await client.query(`SELECT id, value FROM ${qualified(schema, 'duplicates')} ORDER BY id`)).rows,
      conflicts: (await client.query(`SELECT left_key, right_key, amount::text FROM ${qualified(schema, 'conflicts')} ORDER BY left_key`)).rows,
      partialFixture: (await client.query(`SELECT id, nullable_key FROM ${qualified(schema, 'partial_fixture')} ORDER BY id`)).rows,
      collationFixture: (await client.query(`SELECT value FROM ${qualified(schema, 'collation_fixture')} ORDER BY value`)).rows,
    });
    const initialSnapshot = await readSnapshot();

    const recoveryIndex = { schema, table: 'parents', indexName: 'parents_tenant_id_id_key', columns: ['tenantId', 'id'], unique: true };
    const recoveryPlan = { version: 1, name: 'recover after concurrent DDL', indexes: [recoveryIndex] };
    await client.query(renderCreateIndexSql(recoveryIndex));
    await insertJournal(client, schema, recoveryPlan, recoveryIndex);
    const recovered = await runConcurrentIndexPlan(client, recoveryPlan, { journalSchema: schema });
    assert.equal(recovered.results[0].status, 'recovered_after_ddl');
    const recoveredReplay = await runConcurrentIndexPlan(client, recoveryPlan, { journalSchema: schema });
    assert.equal(recoveredReplay.results[0].status, 'already_succeeded');

    const childIndex = { schema, table: 'children', indexName: 'children_tenant_parent_idx', columns: ['tenantId', 'parentId'] };
    const childPlan = { version: 1, name: 'build child reference index', indexes: [childIndex] };
    await insertJournal(client, schema, childPlan, childIndex);
    const retried = await runConcurrentIndexPlan(client, childPlan, { journalSchema: schema });
    assert.equal(retried.results[0].status, 'built');
    const childJournal = (await client.query(`SELECT attempt, state, "errorCode" FROM ${qualified(schema, 'schema_index_builds')} WHERE "indexName" = $1 ORDER BY attempt`, [childIndex.indexName])).rows;
    assert.deepEqual(childJournal.map((row) => [row.attempt, row.state, row.errorCode]), [[1, 'FAILED', 'INTERRUPTED'], [2, 'SUCCEEDED', null]]);

    const invalidIndex = { schema, table: 'duplicates', indexName: 'duplicates_value_unique', columns: ['value'], unique: true };
    await assert.rejects(client.query(renderCreateIndexSql(invalidIndex)));
    const invalidBefore = await client.query(
      `SELECT i.indisvalid, i.indisready FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`,
      [schema, invalidIndex.indexName],
    );
    assert.equal(invalidBefore.rows.length, 1);
    assert.equal(invalidBefore.rows[0].indisvalid, false);
    await client.query(`DELETE FROM ${qualified(schema, 'duplicates')} WHERE id = 2`);
    const beforeRetry = await readSnapshot();
    assert.equal(beforeRetry.duplicates.length, initialSnapshot.duplicates.length - 1);
    const invalidPlan = { version: 1, name: 'repair interrupted unique index', indexes: [invalidIndex] };
    const rebuilt = await runConcurrentIndexPlan(client, invalidPlan, { journalSchema: schema });
    assert.equal(rebuilt.results[0].status, 'built');
    assert.deepEqual(await readSnapshot(), beforeRetry);

    const emptyIndex = { schema, table: 'empty_fixture', indexName: 'empty_fixture_tenant_id_id_key', columns: ['tenantId', 'id'], unique: true };
    const emptyPlan = { version: 1, name: 'build on an empty relation', indexes: [emptyIndex] };
    assert.equal((await runConcurrentIndexPlan(client, emptyPlan, { journalSchema: schema })).results[0].status, 'built');

    const partialIndex = { schema, table: 'partial_fixture', indexName: 'partial_fixture_null_key_idx', columns: ['nullable_key'], where: { column: 'nullable_key', isNull: true } };
    const partialPlan = { version: 1, name: 'verify normalized partial predicate', indexes: [partialIndex] };
    assert.equal((await runConcurrentIndexPlan(client, partialPlan, { journalSchema: schema })).results[0].status, 'built');
    const partialPredicate = await client.query(
      `SELECT pg_get_expr(index_meta.indpred, index_meta.indrelid, true) AS predicate
       FROM pg_index AS index_meta
       JOIN pg_class AS index_class ON index_class.oid = index_meta.indexrelid
       JOIN pg_namespace AS index_ns ON index_ns.oid = index_class.relnamespace
       WHERE index_ns.nspname = $1 AND index_class.relname = $2`,
      [schema, partialIndex.indexName],
    );
    const normalizedPartialPredicate = partialPredicate.rows[0]?.predicate?.replaceAll('"', '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    assert.equal(normalizedPartialPredicate, 'nullable_key is null');

    const transactionalIndex = { schema, table: 'empty_fixture', indexName: 'empty_fixture_transaction_guard_idx', columns: ['id'] };
    const transactionalPlan = { version: 1, name: 'reject transaction-bound connection', indexes: [transactionalIndex] };
    await client.query('BEGIN');
    await assert.rejects(
      runConcurrentIndexPlan(client, transactionalPlan, { journalSchema: schema }),
      (error) => error instanceof ConcurrentIndexBuildError && error.code === 'TRANSACTION_CONTEXT',
    );
    await client.query('ROLLBACK');
    const transactionalArtifacts = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM pg_class index_class JOIN pg_namespace index_ns ON index_ns.oid = index_class.relnamespace WHERE index_ns.nspname = $1 AND index_class.relname = $2) AS index_exists,
         EXISTS (SELECT 1 FROM ${qualified(schema, 'schema_index_builds')} WHERE "indexName" = $2) AS journal_exists`,
      [schema, transactionalIndex.indexName],
    );
    assert.deepEqual(transactionalArtifacts.rows[0], { index_exists: false, journal_exists: false });

    const conflictIndex = { schema, table: 'conflicts', indexName: 'conflicts_expected_idx', columns: ['right_key'] };
    await client.query(`CREATE INDEX CONCURRENTLY ${quoteIdentifier(conflictIndex.indexName)} ON ${qualified(schema, 'conflicts')} USING btree (left_key)`);
    const conflictPlan = { version: 1, name: 'reject same-name conflict', indexes: [conflictIndex] };
    await assert.rejects(
      runConcurrentIndexPlan(client, conflictPlan, { journalSchema: schema }),
      (error) => error instanceof ConcurrentIndexBuildError && error.code === 'INDEX_DEFINITION_CONFLICT',
    );
    const conflictJournal = await client.query(`SELECT count(*)::int AS count FROM ${qualified(schema, 'schema_index_builds')} WHERE "indexName" = $1`, [conflictIndex.indexName]);
    assert.equal(conflictJournal.rows[0].count, 0);

    const tamperedIndex = { schema, table: 'partial_fixture', indexName: 'partial_fixture_tampered_idx', columns: ['id'] };
    const tamperedPlan = { version: 1, name: 'reject tampered journal definition', indexes: [tamperedIndex] };
    await insertJournal(client, schema, tamperedPlan, tamperedIndex);
    await client.query(`UPDATE ${qualified(schema, 'schema_index_builds')} SET definition = 'CREATE INDEX altered' WHERE "indexName" = $1`, [tamperedIndex.indexName]);
    await assert.rejects(
      runConcurrentIndexPlan(client, tamperedPlan, { journalSchema: schema }),
      (error) => error instanceof ConcurrentIndexBuildError && error.code === 'JOURNAL_DEFINITION_CONFLICT',
    );
    const tamperedState = await client.query(`SELECT state, "errorCode" FROM ${qualified(schema, 'schema_index_builds')} WHERE "indexName" = $1`, [tamperedIndex.indexName]);
    assert.deepEqual(tamperedState.rows.map((row) => [row.state, row.errorCode]), [['FAILED', 'JOURNAL_DEFINITION_CONFLICT']]);
    const tamperedCatalog = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`, [schema, tamperedIndex.indexName]);
    assert.equal(tamperedCatalog.rows.length, 0);

    const tamperedHashIndex = { schema, table: 'partial_fixture', indexName: 'partial_fixture_tampered_hash_idx', columns: ['id'] };
    const tamperedHashPlan = { version: 1, name: 'reject tampered journal hash', indexes: [tamperedHashIndex] };
    const tamperedHashCanonical = validateConcurrentIndexPlan(tamperedHashPlan);
    await client.query(
      `INSERT INTO ${qualified(schema, 'schema_index_builds')}
         (id, "stageChecksum", "indexName", "definitionHash", definition, attempt, state)
       VALUES ($1, $2, $3, $4, $5, 1, 'RUNNING')`,
      [randomUUID(), tamperedHashCanonical.checksum, tamperedHashIndex.indexName, '0'.repeat(64), renderIndexDefinition(tamperedHashIndex)],
    );
    await assert.rejects(
      runConcurrentIndexPlan(client, tamperedHashPlan, { journalSchema: schema }),
      (error) => error instanceof ConcurrentIndexBuildError && error.code === 'JOURNAL_DEFINITION_CONFLICT',
    );

    const deferredIndex = 'conflicts_deferred_unique';
    await client.query(`ALTER TABLE ${qualified(schema, 'conflicts')} ADD CONSTRAINT ${quoteIdentifier(deferredIndex)} UNIQUE (left_key) DEFERRABLE INITIALLY DEFERRED`);
    const deferredPlan = { version: 1, name: 'reject a deferrable unique index', indexes: [{ schema, table: 'conflicts', indexName: deferredIndex, columns: ['left_key'], unique: true }] };
    await assert.rejects(
      runConcurrentIndexPlan(client, deferredPlan, { journalSchema: schema }),
      (error) => error instanceof ConcurrentIndexBuildError && error.code === 'INDEX_DEFINITION_CONFLICT',
    );

    const collationIndex = 'collation_fixture_expected_idx';
    await client.query(`CREATE INDEX CONCURRENTLY ${quoteIdentifier(collationIndex)} ON ${qualified(schema, 'collation_fixture')} USING btree (value COLLATE ${qualified(schema, 'index_test_collation')})`);
    const collationPlan = { version: 1, name: 'reject same-key collation conflict', indexes: [{ schema, table: 'collation_fixture', indexName: collationIndex, columns: ['value'] }] };
    await assert.rejects(
      runConcurrentIndexPlan(client, collationPlan, { journalSchema: schema }),
      (error) => error instanceof ConcurrentIndexBuildError && error.code === 'INDEX_DEFINITION_CONFLICT',
    );

    assert.deepEqual(await readSnapshot(), beforeRetry);

    const verified = await client.query(
      `SELECT c.relname, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) AS definition
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) ORDER BY c.relname`,
      [schema, [recoveryIndex.indexName, childIndex.indexName, invalidIndex.indexName, emptyIndex.indexName, partialIndex.indexName]],
    );
    assert.equal(verified.rows.length, 5);
    assert.ok(verified.rows.every((row) => row.indisvalid && row.indisready && row.definition.includes(schema)));
  } finally {
    if (connected) {
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      } finally {
        await client.end();
      }
    } else {
      await client.end().catch(() => {});
    }
  }
});
