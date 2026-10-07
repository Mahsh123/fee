import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { parseForeignKeyDdl } from './generate-composite-tenant-constraints.mjs';

const connectionString = process.env.COMPOSITE_TENANT_FK_TEST_DATABASE_URL;
if (!connectionString) throw new Error('COMPOSITE_TENANT_FK_TEST_DATABASE_URL must point to a disposable PostgreSQL 17 database');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = resolve(root, 'prisma/migrations/20260930000100_tenant_composite_foreign_keys_add/migration.sql');
const deleteActionByCode = Object.freeze({ a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' });

function comparableConstraint(row) {
  return {
    name: row.name,
    sourceTable: row.source_table,
    sourceColumns: row.source_columns,
    targetTable: row.target_table,
    targetColumns: row.target_columns,
    onDelete: deleteActionByCode[row.on_delete],
    onUpdate: deleteActionByCode[row.on_update],
    validated: row.validated,
  };
}

test('PostgreSQL 17 has every validated tenant-equality FK and rejects cross-tenant references', async () => {
  const expectedMigration = parseForeignKeyDdl(await readFile(migrationPath, 'utf8'), 'Committed composite tenant migration');
  assert.equal(expectedMigration.length, 57, 'migration must install all Prisma tenant-to-tenant relations');

  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, application_name: 'fee-composite-tenant-fk-test' });
  let connected = false;
  let transactionOpen = false;
  try {
    await client.connect();
    connected = true;
    const version = Number((await client.query("SELECT current_setting('server_version_num')::int AS version")).rows[0].version);
    assert.ok(version >= 170000 && version < 180000, 'integration test requires PostgreSQL 17');

    const catalog = await client.query(`
      WITH foreign_key_columns AS (
        SELECT
          constraint_row.oid,
          constraint_row.conname AS name,
          source_table.relname AS source_table,
          target_table.relname AS target_table,
          array_agg(source_attribute.attname ORDER BY key_column.position)::text[] AS source_columns,
          array_agg(target_attribute.attname ORDER BY key_column.position)::text[] AS target_columns,
          constraint_row.confdeltype AS on_delete,
          constraint_row.confupdtype AS on_update,
          constraint_row.convalidated AS validated
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS source_table ON source_table.oid = constraint_row.conrelid
        JOIN pg_namespace AS source_namespace ON source_namespace.oid = source_table.relnamespace
        JOIN pg_class AS target_table ON target_table.oid = constraint_row.confrelid
        JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_table.relnamespace
        CROSS JOIN LATERAL unnest(constraint_row.conkey, constraint_row.confkey)
          WITH ORDINALITY AS key_column(source_attnum, target_attnum, position)
        JOIN pg_attribute AS source_attribute
          ON source_attribute.attrelid = source_table.oid AND source_attribute.attnum = key_column.source_attnum
        JOIN pg_attribute AS target_attribute
          ON target_attribute.attrelid = target_table.oid AND target_attribute.attnum = key_column.target_attnum
        WHERE constraint_row.contype = 'f'
          AND source_namespace.nspname = 'public'
          AND target_namespace.nspname = 'public'
        GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      )
      SELECT name, source_table, source_columns, target_table, target_columns, on_delete, on_update, validated
      FROM foreign_key_columns
      ORDER BY source_table, name
    `);
    const allForeignKeys = catalog.rows.map(comparableConstraint);
    const actual = allForeignKeys.filter((constraint) =>
      constraint.sourceColumns[0] === 'tenantId' &&
      constraint.targetColumns.length === 2 &&
      constraint.targetColumns[0] === 'tenantId' &&
      constraint.targetColumns[1] === 'id',
    );
    const expected = expectedMigration
      .map((constraint) => ({
        name: constraint.name,
        source_table: constraint.sourceTable,
        source_columns: constraint.sourceColumns,
        target_table: constraint.targetTable,
        target_columns: constraint.targetColumns,
        on_delete: Object.entries(deleteActionByCode).find(([, action]) => action === constraint.onDelete)?.[0],
        on_update: Object.entries(deleteActionByCode).find(([, action]) => action === constraint.onUpdate)?.[0],
        validated: true,
      }))
      .map(comparableConstraint)
      .sort((left, right) => left.sourceTable.localeCompare(right.sourceTable) || left.name.localeCompare(right.name));
    assert.deepEqual(actual, expected, 'catalog tuples, actions, names, and validation state must match the committed migration');
    assert.ok(actual.every((constraint) => constraint.validated));
    for (const constraint of expectedMigration) {
      const legacyColumns = constraint.sourceColumns.slice(1);
      assert.ok(!allForeignKeys.some((actualConstraint) =>
        actualConstraint.sourceTable === constraint.sourceTable &&
        actualConstraint.targetTable === constraint.targetTable &&
        JSON.stringify(actualConstraint.sourceColumns) === JSON.stringify(legacyColumns) &&
        JSON.stringify(actualConstraint.targetColumns) === JSON.stringify(constraint.targetColumns.slice(1)),
      ), `legacy ID-only FK remains for ${constraint.sourceTable}.${legacyColumns.join(',')}`);
    }

    const childIndexes = await client.query(`
      SELECT
        table_row.relname AS table_name,
        array_agg(attribute_row.attname ORDER BY index_key.position)::text[] AS index_columns,
        index_row.indisvalid AS valid,
        index_row.indisready AS ready,
        bool_and(index_row.indpred IS NULL) AS non_partial
      FROM pg_index AS index_row
      JOIN pg_class AS table_row ON table_row.oid = index_row.indrelid
      JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_row.relnamespace
      CROSS JOIN LATERAL unnest(index_row.indkey) WITH ORDINALITY AS index_key(attnum, position)
      LEFT JOIN pg_attribute AS attribute_row
        ON attribute_row.attrelid = table_row.oid AND attribute_row.attnum = index_key.attnum
      WHERE table_namespace.nspname = 'public' AND index_key.position <= index_row.indnkeyatts
      GROUP BY table_row.relname, index_row.indexrelid, index_row.indisvalid, index_row.indisready
    `);
    const usableIndexes = childIndexes.rows.filter((index) => index.valid && index.ready && index.non_partial);
    for (const constraint of expectedMigration) {
      const hasChildPrefix = usableIndexes.some((index) =>
        index.table_name === constraint.sourceTable &&
        index.index_columns.length >= constraint.sourceColumns.length &&
        constraint.sourceColumns.every((column, position) => index.index_columns[position] === column),
      );
      assert.ok(hasChildPrefix, `missing valid child index prefix for ${constraint.sourceTable}(${constraint.sourceColumns.join(', ')})`);
    }

    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const parentA = randomUUID();
    const parentB = randomUUID();
    const childA = randomUUID();
    const childCrossTenant = randomUUID();
    const childNullParent = randomUUID();
    const studentA = randomUUID();
    const studentB = randomUUID();
    const groupA = randomUUID();
    const groupB = randomUUID();
    const memberA = randomUUID();
    const memberCrossTenant = randomUUID();
    const memberCrossGroup = randomUUID();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(
      'INSERT INTO tenants (id, slug, name, "updatedAt") VALUES ($1, $2, $3, clock_timestamp()), ($4, $5, $6, clock_timestamp())',
      [tenantA, `fk-a-${suffix}`, 'FK fixture A', tenantB, `fk-b-${suffix}`, 'FK fixture B'],
    );
    await client.query(`
      INSERT INTO academic_units (id, "tenantId", "unitType", name, code)
      VALUES ($1, $2, 'CLASS', 'Parent A', $3), ($4, $5, 'CLASS', 'Parent B', $6)
    `, [parentA, tenantA, `A-${suffix}`, parentB, tenantB, `B-${suffix}`]);
    await client.query(`
      INSERT INTO academic_units (id, "tenantId", "unitType", name, code, "parentId")
      VALUES ($1, $2, 'SECTION', 'Child A', $3, $4), ($5, $2, 'SECTION', 'Null Parent Child', $6, NULL)
    `, [childA, tenantA, `C-${suffix}`, parentA, childNullParent, `N-${suffix}`]);

    await client.query('SAVEPOINT cross_tenant_reference');
    await assert.rejects(
      client.query(`
        INSERT INTO academic_units (id, "tenantId", "unitType", name, code, "parentId")
        VALUES ($1, $2, 'SECTION', 'Cross Tenant Child', $3, $4)
      `, [childCrossTenant, tenantA, `X-${suffix}`, parentB]),
      (error) => error.code === '23503',
    );
    await client.query('ROLLBACK TO SAVEPOINT cross_tenant_reference');

    await client.query('SAVEPOINT protected_parent_delete');
    await assert.rejects(
      client.query('DELETE FROM academic_units WHERE id = $1', [parentA]),
      (error) => error.code === '23503',
    );
    await client.query('ROLLBACK TO SAVEPOINT protected_parent_delete');
    await client.query(`
      INSERT INTO students (id, "tenantId", "admissionNumber", "firstName", "updatedAt")
      VALUES ($1, $2, $3, 'Student A', clock_timestamp()), ($4, $5, $6, 'Student B', clock_timestamp())
    `, [studentA, tenantA, `SA-${suffix}`, studentB, tenantB, `SB-${suffix}`]);
    await client.query(`
      INSERT INTO student_groups (id, "tenantId", name, code, "updatedAt")
      VALUES ($1, $2, 'FK fixture group A', $3, clock_timestamp()),
             ($4, $5, 'FK fixture group B', $6, clock_timestamp())
    `, [groupA, tenantA, `GA-${suffix}`, groupB, tenantB, `GB-${suffix}`]);
    await client.query(
      'INSERT INTO student_group_members (id, "tenantId", "groupId", "studentId") VALUES ($1, $2, $3, $4)',
      [memberA, tenantA, groupA, studentA],
    );
    await client.query('SAVEPOINT cross_tenant_join');
    await assert.rejects(
      client.query(
        'INSERT INTO student_group_members (id, "tenantId", "groupId", "studentId") VALUES ($1, $2, $3, $4)',
        [memberCrossTenant, tenantA, groupA, studentB],
      ),
      (error) => error.code === '23503',
    );
    await client.query('ROLLBACK TO SAVEPOINT cross_tenant_join');
    await client.query('SAVEPOINT cross_tenant_group_join');
    await assert.rejects(
      client.query(
        'INSERT INTO student_group_members (id, "tenantId", "groupId", "studentId") VALUES ($1, $2, $3, $4)',
        [memberCrossGroup, tenantA, groupB, studentA],
      ),
      (error) => error.code === '23503',
    );
    await client.query('ROLLBACK TO SAVEPOINT cross_tenant_group_join');

    const fixtureRows = await client.query(
      'SELECT id::text, "tenantId"::text, "parentId"::text FROM academic_units WHERE "tenantId" = ANY($1::uuid[]) ORDER BY id',
      [[tenantA, tenantB]],
    );
    assert.equal(fixtureRows.rows.length, 4, 'rejected cross-tenant insert and parent delete must leave fixture graph intact');
    assert.ok(fixtureRows.rows.some((row) => row.id === childNullParent && row.parentId === null), 'optional same-tenant relation remains nullable');
    const membershipRows = await client.query('SELECT id::text FROM student_group_members WHERE "tenantId" = $1', [tenantA]);
    assert.deepEqual(membershipRows.rows.map((row) => row.id), [memberA], 'rejected tenant-mismatched join insert leaves the valid join intact');
  } finally {
    if (connected) {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
      await client.end();
    } else {
      await client.end().catch(() => {});
    }
  }
});
