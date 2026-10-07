import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import test from 'node:test';
import { verifyMigrationRoles } from './deploy-staged-migrations.mjs';

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const migrationRole = process.env.MIGRATION_DATABASE_ROLE;
const runtimeRole = process.env.RUNTIME_DATABASE_ROLE;
const adminUrl = process.env.MIGRATION_ROLE_TEST_ADMIN_URL;
if (!migrationUrl || !migrationRole || !runtimeRole || !adminUrl) {
  throw new Error('MIGRATION_DATABASE_URL, MIGRATION_DATABASE_ROLE, RUNTIME_DATABASE_ROLE, and MIGRATION_ROLE_TEST_ADMIN_URL are required');
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

test('native PostgreSQL migration-role guard accepts the split roles and rejects privilege drift', async () => {
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  await admin.connect();
  const quotedMigrationRole = quoteIdentifier(migrationRole);
  const quotedRuntimeRole = quoteIdentifier(runtimeRole);
  const runIndexCli = () => spawnSync(process.execPath, [
    'scripts/build-concurrent-indexes.mjs', '--plan', '.tmp/tenant-relation-index-plan.json',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: Object.fromEntries(Object.entries({
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      MIGRATION_DATABASE_URL: migrationUrl,
      MIGRATION_DATABASE_ROLE: migrationRole,
      RUNTIME_DATABASE_ROLE: runtimeRole,
    }).filter(([, value]) => typeof value === 'string')),
  });

  try {
    await verifyMigrationRoles({ migrationRole, runtimeRole, connectionString: migrationUrl });

    await admin.query(`ALTER ROLE ${quotedMigrationRole} SUPERUSER`);
    try {
      await assert.rejects(
        verifyMigrationRoles({ migrationRole, runtimeRole, connectionString: migrationUrl }),
        /Migration role must be a non-admin role/,
      );
    } finally {
      await admin.query(`ALTER ROLE ${quotedMigrationRole} NOSUPERUSER`);
    }

    await admin.query(`GRANT pg_monitor TO ${quotedMigrationRole}`);
    try {
      await assert.rejects(
        verifyMigrationRoles({ migrationRole, runtimeRole, connectionString: migrationUrl }),
        /Migration role must be a non-admin role/,
      );
    } finally {
      await admin.query(`REVOKE pg_monitor FROM ${quotedMigrationRole}`);
    }

    await admin.query(`ALTER ROLE ${quotedRuntimeRole} CREATEDB`);
    try {
      await assert.rejects(
        verifyMigrationRoles({ migrationRole, runtimeRole, connectionString: migrationUrl }),
        /Runtime role has privileges incompatible/,
      );
    } finally {
      await admin.query(`ALTER ROLE ${quotedRuntimeRole} NOCREATEDB`);
    }

    await admin.query(`GRANT pg_read_all_data TO ${quotedRuntimeRole}`);
    try {
      await assert.rejects(
        verifyMigrationRoles({ migrationRole, runtimeRole, connectionString: migrationUrl }),
        /Runtime role has privileges incompatible/,
      );
    } finally {
      await admin.query(`REVOKE pg_read_all_data FROM ${quotedRuntimeRole}`);
    }

    await admin.query(`GRANT CREATE ON SCHEMA public TO ${quotedRuntimeRole}`);
    try {
      await assert.rejects(
        verifyMigrationRoles({ migrationRole, runtimeRole, connectionString: migrationUrl }),
        /Runtime role can create objects/,
      );
    } finally {
      await admin.query(`REVOKE CREATE ON SCHEMA public FROM ${quotedRuntimeRole}`);
    }

    await admin.query(`ALTER TABLE public.tenants OWNER TO ${quotedRuntimeRole}`);
    try {
      await assert.rejects(
        verifyMigrationRoles({ migrationRole, runtimeRole, connectionString: migrationUrl }),
        /Runtime role owns an application relation/,
      );
    } finally {
      await admin.query(`ALTER TABLE public.tenants OWNER TO ${quotedMigrationRole}`);
    }

    await admin.query(`GRANT SELECT ON TABLE public.schema_index_builds TO ${quotedRuntimeRole}`);
    try {
      const result = runIndexCli();
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /Runtime role has direct access to the schema index build journal/);
    } finally {
      await admin.query(`REVOKE ALL ON TABLE public.schema_index_builds FROM ${quotedRuntimeRole}`);
    }

    await admin.query(`GRANT REFERENCES ("stageChecksum") ON TABLE public.schema_index_builds TO ${quotedRuntimeRole}`);
    try {
      const result = runIndexCli();
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /Runtime role has direct access to the schema index build journal/);
    } finally {
      await admin.query(`REVOKE REFERENCES ("stageChecksum") ON TABLE public.schema_index_builds FROM ${quotedRuntimeRole}`);
    }
  } finally {
    await admin.query(`ALTER ROLE ${quotedMigrationRole} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await admin.query(`ALTER ROLE ${quotedRuntimeRole} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await admin.query(`REVOKE CREATE ON SCHEMA public FROM ${quotedRuntimeRole}`);
    await admin.query(`ALTER TABLE public.tenants OWNER TO ${quotedMigrationRole}`);
    await admin.query(`REVOKE ALL ON TABLE public.schema_index_builds FROM ${quotedRuntimeRole}`);
    await admin.query(`REVOKE REFERENCES ("stageChecksum") ON TABLE public.schema_index_builds FROM ${quotedRuntimeRole}`);
    await admin.query(`REVOKE pg_monitor FROM ${quotedMigrationRole}`);
    await admin.query(`REVOKE pg_read_all_data FROM ${quotedRuntimeRole}`);
    await admin.end();
  }
});
