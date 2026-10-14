import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { verifyPostgresUrlTarget } from './compose-database-target.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const systemEnvironment = Object.fromEntries(
  ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]),
);

function readEnv(name, required) {
  try {
    return parse(readFileSync(resolve(root, name)));
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return {};
    throw new Error(`Required local environment file is missing or unreadable: ${name}`);
  }
}

const merged = {
  ...readEnv('.env', true),
  ...readEnv('.env.neon.local', true),
  ...readEnv('.env.neon.migration.local', true),
};
const recoveryArgs = process.argv.slice(2);
const recoverMigration = recoveryArgs.length === 2 && recoveryArgs[0] === '--recover-rolled-back'
  ? recoveryArgs[1]
  : null;
if (recoveryArgs.length && (!recoverMigration || recoveryArgs.length !== 2 || recoverMigration !== '20261013000800_fee_assignment_cycle_identity_guards')) {
  throw new Error('Only the reviewed failed billing-cycle identity migration can be recovered with --recover-rolled-back <migration-name>');
}
const requiredKeys = [
  'MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_ROLE', 'RUNTIME_DATABASE_ROLE', 'BACKUP_DATABASE_ROLE',
  'DATABASE_TARGET_HOST', 'DATABASE_TARGET_PORT', 'DATABASE_TARGET_NAME', 'DATABASE_TARGET_SCHEMA',
];
const missing = requiredKeys.filter((key) => !merged[key]);
if (missing.length) throw new Error(`Staged Neon migration configuration is missing: ${missing.join(', ')}`);

// The migration child receives only its dedicated target and signing-key
// settings. Application credentials, payment secrets, and owner URLs are not
// inherited into the deployment process.
const migrationEnvironment = { ...systemEnvironment };
for (const key of [
  ...requiredKeys,
  'AUDIT_ACTIVE_SIGNING_KEY_VERSION',
  'AUDIT_SIGNING_KEYS_JSON',
]) {
  if (merged[key] !== undefined) migrationEnvironment[key] = merged[key];
}

async function recoverRolledBackMigration(migrationName) {
  const target = {
    host: merged.DATABASE_TARGET_HOST,
    port: merged.DATABASE_TARGET_PORT,
    database: merged.DATABASE_TARGET_NAME,
    schema: merged.DATABASE_TARGET_SCHEMA,
  };
  const parsed = verifyPostgresUrlTarget(merged.MIGRATION_DATABASE_URL, 'MIGRATION_DATABASE_URL', target);
  if (parsed.username !== merged.MIGRATION_DATABASE_ROLE) throw new Error('Migration recovery URL does not use the configured migration role');
  const source = readFileSync(resolve(root, 'prisma/migrations', migrationName, 'migration.sql'), 'utf8');
  if (!/^\s*BEGIN;\s*$/im.test(source) || !/^\s*COMMIT;\s*$/im.test(source) || /\bCONCURRENTLY\b/i.test(source)) {
    throw new Error('Refusing to recover a migration that is not entirely transactional');
  }

  const client = new Client({ connectionString: merged.MIGRATION_DATABASE_URL, connectionTimeoutMillis: 5000, application_name: 'fee-neon-migration-recovery-check' });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const status = await client.query(
      `SELECT migration_name, finished_at, rolled_back_at
         FROM public._prisma_migrations
        WHERE migration_name = ANY($1::text[])`,
      [[
        '20261013000400_tenant_person_identity_guard_extensions',
        '20261013000600_fee_assignment_cycle_composite_foreign_keys_add',
        '20261013000700_fee_assignment_cycle_composite_foreign_keys_validate',
        migrationName,
      ]],
    );
    const byName = new Map(status.rows.map((row) => [row.migration_name, row]));
    for (const prior of [
      '20261013000400_tenant_person_identity_guard_extensions',
      '20261013000600_fee_assignment_cycle_composite_foreign_keys_add',
      '20261013000700_fee_assignment_cycle_composite_foreign_keys_validate',
    ]) {
      if (!byName.get(prior)?.finished_at || byName.get(prior)?.rolled_back_at) throw new Error('Migration recovery preconditions are not satisfied');
    }
    const failed = byName.get(migrationName);
    if (!failed || failed.finished_at || failed.rolled_back_at) throw new Error('The migration is not in the expected failed state');

    const triggerNames = ['fee_identity_29946eb72e62', 'fee_identity_049521c2e66d'];
    const triggers = await client.query(
      `SELECT trigger.tgname
         FROM pg_catalog.pg_trigger AS trigger
         JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal AND trigger.tgname = ANY($1::text[])`,
      [triggerNames],
    );
    if (triggers.rows.length) throw new Error('A billing-cycle identity guard already exists; manual state review is required');
  } finally {
    if (connected) await client.end();
    else await client.end().catch(() => {});
  }

  const prismaEntrypoint = resolve(root, 'node_modules/prisma/build/index.js');
  execFileSync(process.execPath, [prismaEntrypoint, 'migrate', 'resolve', '--rolled-back', migrationName], {
    cwd: root,
    env: { ...systemEnvironment, MIGRATION_DATABASE_URL: merged.MIGRATION_DATABASE_URL },
    stdio: 'inherit',
  });
}

if (recoverMigration) await recoverRolledBackMigration(recoverMigration);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'db:deploy'], {
  cwd: root,
  env: migrationEnvironment,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
});
child.once('error', (error) => {
  process.stderr.write(`Could not start the staged Neon migration: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code) => { process.exitCode = code ?? 1; });
