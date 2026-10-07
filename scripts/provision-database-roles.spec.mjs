import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createScramVerifier,
  validateDatabaseAdminIdentity,
  validateFinalizationConfig,
  validateProvisioningConfig,
} from './provision-database-roles.mjs';

function environment(overrides = {}) {
  return {
    DATABASE_CLUSTER_MODE: 'bundled',
    DATABASE_TARGET_HOST: 'postgres',
    DATABASE_TARGET_PORT: '5432',
    DATABASE_TARGET_NAME: 'feeplatform',
    DATABASE_TARGET_SCHEMA: 'public',
    POSTGRES_USER: 'fee_admin',
    POSTGRES_PASSWORD: 'admin-secret',
    MIGRATION_DATABASE_ROLE: 'fee_migrator',
    MIGRATION_DATABASE_PASSWORD_URI_ENCODED: 'migration%40secret',
    RUNTIME_DATABASE_ROLE: 'fee_runtime',
    RUNTIME_DATABASE_PASSWORD_URI_ENCODED: 'runtime%40secret',
    BACKUP_DATABASE_ROLE: 'fee_backup',
    BACKUP_DATABASE_PASSWORD: 'backup-secret',
    ...overrides,
  };
}

test('validates one bundled target and keeps configured credentials out of the public result', () => {
  const result = validateProvisioningConfig(environment());
  assert.deepEqual(result.target, {
    host: 'postgres', port: '5432', database: 'feeplatform', schema: 'public',
  });
  assert.deepEqual(result.loginRoles, ['fee_migrator', 'fee_runtime', 'fee_backup']);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('validates the administrator-only finalizer without requiring or returning application passwords', () => {
  const result = validateFinalizationConfig(environment());
  assert.deepEqual(result, {
    mode: 'bundled',
    adminRole: 'fee_admin',
    loginRoles: ['fee_migrator', 'fee_runtime', 'fee_backup'],
    target: { host: 'postgres', port: '5432', database: 'feeplatform', schema: 'public' },
  });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.throws(() => validateFinalizationConfig(environment({ DATABASE_CLUSTER_MODE: 'external' })), /bundled or managed/);
  assert.throws(() => validateFinalizationConfig(environment({ BACKUP_DATABASE_ROLE: 'fee_runtime' })), /role names must all be distinct/);
});

test('rejects external cluster provisioning and unsupported schemas before connecting', () => {
  assert.throws(() => validateProvisioningConfig(environment({ DATABASE_CLUSTER_MODE: 'external' })), /bundled or managed/);
  assert.throws(() => validateProvisioningConfig(environment({ DATABASE_TARGET_SCHEMA: 'tenant_data' })), /public schema/);
});

test('accepts explicit managed PostgreSQL mode while preserving the dedicated role contract', () => {
  const result = validateProvisioningConfig(environment({ DATABASE_CLUSTER_MODE: 'managed', POSTGRES_USER: 'neondb_owner' }));
  assert.equal(result.mode, 'managed');
  assert.equal(result.adminRole, 'neondb_owner');
  assert.deepEqual(result.loginRoles, ['fee_migrator', 'fee_runtime', 'fee_backup']);
  assert.deepEqual(result.ownerRoles, ['fee_audit_owner', 'fee_lifecycle_owner', 'fee_numbering_owner']);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('validates managed administrator ownership and scoped capabilities without requiring superuser', () => {
  const config = validateFinalizationConfig(environment({ DATABASE_CLUSTER_MODE: 'managed', POSTGRES_USER: 'neondb_owner' }));
  const identity = {
    database_name: 'feeplatform',
    role_name: 'neondb_owner',
    is_superuser: false,
    database_owner: 'neondb_owner',
    can_create_role: true,
    can_create_database_objects: true,
    can_create_public_objects: true,
  };
  assert.doesNotThrow(() => validateDatabaseAdminIdentity(identity, config, 'Bootstrap'));
  assert.throws(() => validateDatabaseAdminIdentity({ ...identity, database_owner: 'another_role' }, config, 'Bootstrap'), /must own the target/);
  assert.throws(() => validateDatabaseAdminIdentity({ ...identity, can_create_role: false }, config, 'Bootstrap'), /must own the target/);
  assert.throws(() => validateDatabaseAdminIdentity({ ...identity, can_create_public_objects: false }, config, 'Bootstrap'), /must own the target/);
});

test('bundled administrator mode still requires a PostgreSQL superuser', () => {
  const config = validateFinalizationConfig(environment());
  const identity = {
    database_name: 'feeplatform', role_name: 'fee_admin', is_superuser: false,
    database_owner: 'fee_admin', can_create_role: true,
    can_create_database_objects: true, can_create_public_objects: true,
  };
  assert.throws(() => validateDatabaseAdminIdentity(identity, config, 'Finalizer'), /bundled PostgreSQL superuser/);
  assert.doesNotThrow(() => validateDatabaseAdminIdentity({ ...identity, is_superuser: true }, config, 'Finalizer'));
});

test('rejects role aliases, reserved owner names, and unsafe identifiers', () => {
  assert.throws(() => validateProvisioningConfig(environment({ RUNTIME_DATABASE_ROLE: 'fee_migrator' })), /role names must all be distinct/);
  assert.throws(() => validateProvisioningConfig(environment({ BACKUP_DATABASE_ROLE: 'fee_audit_owner' })), /role names must all be distinct/);
  assert.throws(() => validateProvisioningConfig(environment({ BACKUP_DATABASE_ROLE: 'fee-backup' })), /lowercase PostgreSQL role identifier/);
});

test('rejects colliding, missing, and malformed role passwords without disclosing them', () => {
  assert.throws(() => validateProvisioningConfig(environment({ RUNTIME_DATABASE_PASSWORD_URI_ENCODED: 'migration%40secret' })), /passwords must be non-empty and distinct/);
  assert.throws(() => validateProvisioningConfig(environment({ BACKUP_DATABASE_PASSWORD: '' })), /passwords must be non-empty and distinct/);
  assert.throws(() => validateProvisioningConfig(environment({ RUNTIME_DATABASE_PASSWORD_URI_ENCODED: 'runtime%C2%A0secret' })), /printable ASCII/);
  assert.throws(() => validateProvisioningConfig(environment({ MIGRATION_DATABASE_PASSWORD_URI_ENCODED: '%' })), /valid URI-encoded text/);
});

test('rejects malformed connection targets and missing one-shot administrator credentials', () => {
  assert.throws(() => validateProvisioningConfig(environment({ DATABASE_TARGET_PORT: '5432;SELECT 1' })), /DATABASE_TARGET_\*/);
  assert.throws(() => validateProvisioningConfig(environment({ POSTGRES_PASSWORD: '' })), /POSTGRES_USER and POSTGRES_PASSWORD are required/);
});

test('builds a SCRAM-SHA-256 verifier without placing the cleartext password in the SQL credential value', () => {
  const password = 'Private test secret';
  const salt = Buffer.from('0123456789abcdef');
  const verifier = createScramVerifier(password, { salt });
  assert.match(verifier, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
  assert.equal(verifier.includes(password), false);
  assert.throws(() => createScramVerifier('A\u00a0B', { salt }), /printable ASCII/);
  assert.throws(() => createScramVerifier('A\u200BB', { salt }), /printable ASCII/);
  assert.notEqual(verifier, createScramVerifier('Different secret', { salt }));
  assert.throws(() => createScramVerifier('', { salt }), /non-empty text/);
  assert.throws(() => createScramVerifier(password, { salt: Buffer.alloc(8) }), /at least 16 random bytes/);
  assert.throws(() => createScramVerifier(password, { salt, iterations: 100 }), /iteration count/);
});
