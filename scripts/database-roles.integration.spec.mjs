import assert from 'node:assert/strict';
import { Client } from 'pg';
import test from 'node:test';
import {
  finalizeMigrationDatabasePrivileges,
  provisionDatabaseRoles,
} from './provision-database-roles.mjs';
import { synchronizeDatabaseAcls } from './sync-database-acls.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decode(value, name) {
  try {
    return decodeURIComponent(required(name));
  } catch {
    throw new Error(`${name} must be valid URI-encoded text`);
  }
}

function secret(passwordKey) {
  return passwordKey.endsWith('_URI_ENCODED')
    ? decode(process.env[passwordKey], passwordKey)
    : required(passwordKey);
}

function options(roleKey, passwordKey, database = process.env.DATABASE_TARGET_NAME) {
  return {
    host: required('DATABASE_TARGET_HOST'),
    port: Number(required('DATABASE_TARGET_PORT')),
    database,
    user: required(roleKey),
    password: secret(passwordKey),
    connectionTimeoutMillis: 3000,
    application_name: 'fee-database-role-integration-test',
  };
}

function adminClient() {
  return new Client({
    host: required('DATABASE_TARGET_HOST'),
    port: Number(required('DATABASE_TARGET_PORT')),
    database: required('DATABASE_TARGET_NAME'),
    user: required('POSTGRES_USER'),
    password: required('POSTGRES_PASSWORD'),
    connectionTimeoutMillis: 5000,
  });
}

test('PostgreSQL 17 role bootstrap has the exact base identities, owner membership, and private crypto ACL', async () => {
  await provisionDatabaseRoles();
  const admin = adminClient();
  await admin.connect();
  try {
    const names = [
      required('MIGRATION_DATABASE_ROLE'),
      required('RUNTIME_DATABASE_ROLE'),
      required('BACKUP_DATABASE_ROLE'),
      'fee_audit_owner', 'fee_lifecycle_owner', 'fee_numbering_owner',
    ];
    const roles = await admin.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb,
         rolcreaterole, rolreplication, rolinherit
       FROM pg_roles WHERE rolname = ANY($1::text[])`,
      [names],
    );
    assert.equal(roles.rows.length, names.length);
    for (const role of roles.rows) {
      assert.equal(role.rolsuper, false, role.rolname);
      assert.equal(role.rolbypassrls, false, role.rolname);
      assert.equal(role.rolcreatedb, false, role.rolname);
      assert.equal(role.rolcreaterole, false, role.rolname);
      assert.equal(role.rolreplication, false, role.rolname);
    }
    for (const role of roles.rows.filter(({ rolname }) => rolname.endsWith('_owner'))) {
      assert.equal(role.rolcanlogin, false, role.rolname);
      assert.equal(role.rolinherit, false, role.rolname);
    }
    for (const name of names.slice(0, 3)) {
      assert.equal(roles.rows.find(({ rolname }) => rolname === name).rolcanlogin, true, name);
    }

    const passwordStorage = await admin.query(
      `SELECT rolname, rolpassword LIKE 'SCRAM-SHA-256$%' AS uses_scram_verifier
       FROM pg_authid WHERE rolname = ANY($1::text[])`,
      [names.slice(0, 3)],
    );
    assert.equal(passwordStorage.rows.length, 3);
    assert.ok(passwordStorage.rows.every(({ uses_scram_verifier }) => uses_scram_verifier));

    const members = await admin.query(
      `SELECT member.rolname AS member, granted.rolname AS granted,
         membership.admin_option, membership.inherit_option, membership.set_option
       FROM pg_auth_members AS membership
       JOIN pg_roles AS member ON member.oid = membership.member
       JOIN pg_roles AS granted ON granted.oid = membership.roleid
       WHERE member.rolname = $1`,
      [required('MIGRATION_DATABASE_ROLE')],
    );
    assert.deepEqual(members.rows.map(({ granted }) => granted).sort(), names.slice(3).sort());
    for (const membership of members.rows) {
      assert.equal(membership.admin_option, false);
      assert.equal(membership.inherit_option, false);
      assert.equal(membership.set_option, true);
    }

    const { rows: acl } = await admin.query(
      `SELECT has_schema_privilege('fee_audit_owner', 'app_private', 'USAGE') AS audit_usage,
         has_schema_privilege($1, 'app_private', 'USAGE') AS migration_usage,
         has_schema_privilege($2, 'app_private', 'USAGE') AS runtime_usage,
         has_schema_privilege($3, 'public', 'CREATE') AS runtime_public_create,
         has_schema_privilege($4, 'public', 'CREATE') AS migration_public_create,
         has_function_privilege('fee_audit_owner', 'app_private.digest(bytea,text)', 'EXECUTE') AS audit_digest,
         has_function_privilege('fee_audit_owner', 'app_private.hmac(bytea,bytea,text)', 'EXECUTE') AS audit_hmac,
         has_function_privilege($2, 'app_private.digest(bytea,text)', 'EXECUTE') AS runtime_digest,
         has_database_privilege($5, current_database(), 'CONNECT') AS backup_target_connect`,
      [required('MIGRATION_DATABASE_ROLE'), required('RUNTIME_DATABASE_ROLE'),
        required('RUNTIME_DATABASE_ROLE'), required('MIGRATION_DATABASE_ROLE'), required('BACKUP_DATABASE_ROLE')],
    );
    assert.deepEqual(acl[0], {
      audit_usage: true,
      migration_usage: false,
      runtime_usage: false,
      runtime_public_create: false,
      migration_public_create: true,
      audit_digest: true,
      audit_hmac: true,
      runtime_digest: false,
      backup_target_connect: true,
    });
    const extension = await admin.query(
      `SELECT namespace.nspname AS schema_name, extension.extowner::regrole::text AS owner
       FROM pg_extension AS extension JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
       WHERE extension.extname = 'pgcrypto'`,
    );
    assert.equal(extension.rows[0]?.schema_name, 'app_private');
    assert.equal(extension.rows[0]?.owner, required('POSTGRES_USER'));
  } finally {
    await admin.end();
  }

  for (const [roleKey, passwordKey] of [
    ['MIGRATION_DATABASE_ROLE', 'MIGRATION_DATABASE_PASSWORD_URI_ENCODED'],
    ['RUNTIME_DATABASE_ROLE', 'RUNTIME_DATABASE_PASSWORD_URI_ENCODED'],
    ['BACKUP_DATABASE_ROLE', 'BACKUP_DATABASE_PASSWORD'],
  ]) {
    const roleClient = new Client(options(roleKey, passwordKey));
    await roleClient.connect();
    try {
      const identity = await roleClient.query('SELECT current_user AS role');
      assert.equal(identity.rows[0].role, required(roleKey));
      if (roleKey === 'MIGRATION_DATABASE_ROLE') {
        const before = await roleClient.query("SELECT has_schema_privilege(current_user, 'app_private', 'USAGE') AS usage");
        assert.equal(before.rows[0].usage, false);
        await roleClient.query('SET ROLE fee_audit_owner');
        const after = await roleClient.query("SELECT current_user AS role, has_schema_privilege(current_user, 'app_private', 'USAGE') AS usage");
        assert.equal(after.rows[0].role, 'fee_audit_owner');
        assert.equal(after.rows[0].usage, true);
        await roleClient.query('RESET ROLE');
      }
    } finally {
      await roleClient.end();
    }
  }

  await finalizeMigrationDatabasePrivileges();
  const finalizedAdmin = adminClient();
  await finalizedAdmin.connect();
  try {
    const finalized = await finalizedAdmin.query(
      `SELECT has_database_privilege($1, current_database(), 'CREATE') AS migration_create,
         has_database_privilege($2, current_database(), 'CREATE') AS runtime_create,
         has_database_privilege($3, current_database(), 'CREATE') AS backup_create`,
      [required('MIGRATION_DATABASE_ROLE'), required('RUNTIME_DATABASE_ROLE'), required('BACKUP_DATABASE_ROLE')],
    );
    assert.deepEqual(finalized.rows[0], { migration_create: false, runtime_create: false, backup_create: false });
  } finally {
    await finalizedAdmin.end();
  }
});

test('migration, runtime, and backup roles cannot connect to another database on their dedicated cluster', async () => {
  const secondDatabase = process.env.DATABASE_ROLE_TEST_SECOND_DATABASE ?? 'postgres';
  assert.notEqual(secondDatabase, required('DATABASE_TARGET_NAME'));
  const admin = adminClient();
  await admin.connect();
  try {
    const roles = [required('MIGRATION_DATABASE_ROLE'), required('RUNTIME_DATABASE_ROLE'), required('BACKUP_DATABASE_ROLE')];
    const databaseId = `"${secondDatabase.replaceAll('"', '""')}"`;
    const roleIds = roles.map((role) => `"${role.replaceAll('"', '""')}"`).join(', ');
    await admin.query(`GRANT CONNECT ON DATABASE ${databaseId} TO ${roleIds}`);
  } finally {
    await admin.end();
  }

  await provisionDatabaseRoles();

  const verificationAdmin = adminClient();
  await verificationAdmin.connect();
  try {
    const { rows } = await verificationAdmin.query(
      `SELECT role_grant.role_name,
         has_database_privilege(role_grant.role_name::name, db.oid, 'CONNECT') AS can_connect
       FROM pg_database AS db
       CROSS JOIN unnest($1::text[]) AS role_grant(role_name)
       WHERE db.datname = $2`,
      [[required('MIGRATION_DATABASE_ROLE'), required('RUNTIME_DATABASE_ROLE'), required('BACKUP_DATABASE_ROLE')], secondDatabase],
    );
    assert.equal(rows.length, 3);
    assert.ok(rows.every(({ can_connect }) => !can_connect));
  } finally {
    await verificationAdmin.end();
  }

  await finalizeMigrationDatabasePrivileges();

  for (const [roleKey, passwordKey] of [
    ['MIGRATION_DATABASE_ROLE', 'MIGRATION_DATABASE_PASSWORD_URI_ENCODED'],
    ['RUNTIME_DATABASE_ROLE', 'RUNTIME_DATABASE_PASSWORD_URI_ENCODED'],
    ['BACKUP_DATABASE_ROLE', 'BACKUP_DATABASE_PASSWORD'],
  ]) {
    const client = new Client(options(roleKey, passwordKey, secondDatabase));
    await assert.rejects(client.connect(), undefined, `${roleKey} should be denied on ${secondDatabase}`);
    await client.end().catch(() => {});
  }
});

test('ACL sync rejects large objects before changing any grants', async () => {
  const admin = adminClient();
  await admin.connect();
  let largeObjectId;
  try {
    const object = await admin.query('SELECT lo_create(0)::text AS oid');
    largeObjectId = object.rows[0].oid;
    await admin.query('CREATE TABLE public.db_role_acl_sentinel (id integer PRIMARY KEY)');
    await admin.query(
      `GRANT SELECT ON TABLE public.db_role_acl_sentinel TO "${required('RUNTIME_DATABASE_ROLE').replaceAll('"', '""')}"`,
    );
    const before = await admin.query(
      "SELECT has_table_privilege($1, 'public.db_role_acl_sentinel', 'SELECT') AS granted",
      [required('RUNTIME_DATABASE_ROLE')],
    );
    assert.equal(before.rows[0].granted, true);

    await assert.rejects(
      synchronizeDatabaseAcls({
        connectionString: required('MIGRATION_DATABASE_URL'),
        migrationRole: required('MIGRATION_DATABASE_ROLE'),
        runtimeRole: required('RUNTIME_DATABASE_ROLE'),
        backupRole: required('BACKUP_DATABASE_ROLE'),
        target: {
          host: required('DATABASE_TARGET_HOST'),
          port: required('DATABASE_TARGET_PORT'),
          database: required('DATABASE_TARGET_NAME'),
          schema: required('DATABASE_TARGET_SCHEMA'),
        },
      }),
      /large objects require an explicit backup and ACL policy/,
    );

    const after = await admin.query(
      "SELECT has_table_privilege($1, 'public.db_role_acl_sentinel', 'SELECT') AS granted",
      [required('RUNTIME_DATABASE_ROLE')],
    );
    assert.equal(after.rows[0].granted, true, 'grant state should not change when inventory rejects the large object');
  } finally {
    await admin.query('DROP TABLE IF EXISTS public.db_role_acl_sentinel').catch(() => {});
    if (largeObjectId) await admin.query('SELECT lo_unlink($1::oid)', [largeObjectId]).catch(() => {});
    await admin.end();
  }
});
