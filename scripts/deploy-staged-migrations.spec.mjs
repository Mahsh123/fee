import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { buildMigrationChildEnvironment, hasSuccessfulMigration, materializeMigrationHistory, validateMigrationConnectionTarget, validateMigrationStages } from './deploy-staged-migrations.mjs';

test('requires complete, unique migrations and timestamp order within each stage', () => {
  const names = ['001_init', '002_indexes', '003_constraints'];
  assert.deepEqual(validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['001_init', '002_indexes'],
    postIndexMigrations: ['003_constraints'],
  }), {
    preIndexMigrations: ['001_init', '002_indexes'],
    postIndexMigrations: ['003_constraints'],
    preIndexIndexBarriers: [],
    postIndexIndexBarriers: [],
  });
  assert.throws(() => validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['001_init'],
    postIndexMigrations: ['003_constraints'],
  }), /unclassified: 002_indexes/);
  assert.deepEqual(validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['001_init', '003_constraints'],
    postIndexMigrations: ['002_indexes'],
  }), {
    preIndexMigrations: ['001_init', '003_constraints'],
    postIndexMigrations: ['002_indexes'],
    preIndexIndexBarriers: [],
    postIndexIndexBarriers: [],
  });
  assert.throws(() => validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['003_constraints', '001_init'],
    postIndexMigrations: ['002_indexes'],
  }), /timestamp order/);

  const postBarrierStages = validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['001_init'],
    postIndexMigrations: ['002_indexes', '003_constraints'],
    postIndexIndexBarriers: [{ beforeMigration: '003_constraints', indexes: ['verified_events_key'] }],
  });
  assert.deepEqual(postBarrierStages.postIndexIndexBarriers, [
    { beforeMigration: '003_constraints', indexes: ['verified_events_key'] },
  ]);
  assert.throws(() => validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['001_init'],
    postIndexMigrations: ['002_indexes', '003_constraints'],
    postIndexIndexBarriers: [{ beforeMigration: '002_indexes', indexes: ['verified_events_key'] }],
  }), /must follow a migration that creates its index target/);
  assert.throws(() => validateMigrationStages(['001_init', '002_indexes', '003_constraints', '004_final'], {
    version: 1,
    preIndexMigrations: ['001_init', '002_indexes'],
    postIndexMigrations: ['003_constraints', '004_final'],
    preIndexIndexBarriers: [{ beforeMigration: '002_indexes', indexes: ['shared_index'] }],
    postIndexIndexBarriers: [{ beforeMigration: '004_final', indexes: ['shared_index'] }],
  }), /must not repeat an index requirement/);
  assert.throws(() => validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['001_init', '001_init'],
    postIndexMigrations: ['003_constraints'],
  }), /more than once/);

  const barrierStages = validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['001_init', '002_indexes'],
    postIndexMigrations: ['003_constraints'],
    preIndexIndexBarriers: [{ beforeMigration: '002_indexes', indexes: ['parents_tenant_id_id_key'] }],
  });
  assert.deepEqual(barrierStages.preIndexIndexBarriers, [
    { beforeMigration: '002_indexes', indexes: ['parents_tenant_id_id_key'] },
  ]);
  assert.throws(() => validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['001_init', '002_indexes'],
    postIndexMigrations: ['003_constraints'],
    preIndexIndexBarriers: [{ beforeMigration: '003_constraints', indexes: ['parents_tenant_id_id_key'] }],
  }), /not classified as pre-index/);
  assert.throws(() => validateMigrationStages(names, {
    version: 1,
    preIndexMigrations: ['001_init', '002_indexes'],
    postIndexMigrations: ['003_constraints'],
    preIndexIndexBarriers: [
      { beforeMigration: '002_indexes', indexes: ['parents_tenant_id_id_key'] },
      { beforeMigration: '002_indexes', indexes: ['children_tenant_id_id_key'] },
    ],
  }), /timestamp order/);
});

test('checked-in stage manifest classifies every repository migration', async () => {
  const manifest = JSON.parse(await readFile(resolve('prisma/migration-stages.json'), 'utf8'));
  const entries = await readdir(resolve('prisma/migrations'), { withFileTypes: true });
  const migrations = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const stages = validateMigrationStages(migrations, manifest);
  assert.deepEqual([...stages.preIndexMigrations, ...stages.postIndexMigrations].sort(), migrations.sort());
});

test('post-index barriers run only while their target migration is still pending', async () => {
  const migrationName = '20261005000200_verified_webhook_event_deduplication';
  const client = { query: async (_sql, values) => ({ rows: [{ applied: values[0] === migrationName }] }) };
  assert.equal(await hasSuccessfulMigration(client, migrationName), true);
  assert.equal(await hasSuccessfulMigration(client, '20261005000300_future_migration'), false);
  await assert.rejects(() => hasSuccessfulMigration(client, 'bad; migration'), /single Prisma migration identifier/);
});

test('migration child processes receive no runtime database URL or application secrets', () => {
  const childEnvironment = buildMigrationChildEnvironment({
    PATH: 'C:\\node',
    DATABASE_URL: 'postgresql://runtime-secret',
    JWT_SECRET: 'application-secret',
    MIGRATION_DATABASE_URL: 'postgresql://migration-secret',
  }, {
    MIGRATION_DATABASE_URL: 'postgresql://migration-secret',
  });
  assert.deepEqual(childEnvironment, {
    PATH: 'C:\\node',
    MIGRATION_DATABASE_URL: 'postgresql://migration-secret',
  });
  assert.equal('DATABASE_URL' in childEnvironment, false);
  assert.equal('JWT_SECRET' in childEnvironment, false);
});

test('migration target validation accepts only the configured URL, role, and public schema before connecting', () => {
  const valid = {
    connectionString: 'postgresql://fee_migrator:migration-secret@postgres:5432/feeplatform?schema=public',
    migrationRole: 'fee_migrator',
    runtimeRole: 'fee_runtime',
    target: { host: 'postgres', port: '5432', database: 'feeplatform', schema: 'public' },
  };
  assert.equal(validateMigrationConnectionTarget(valid).host, 'postgres');
  assert.throws(() => validateMigrationConnectionTarget({
    ...valid,
    connectionString: 'postgresql://fee_migrator:migration-secret@postgres:5432/feeplatform?schema=public&host=attacker.example',
  }), /unsupported or duplicate query parameters/);
  assert.throws(() => validateMigrationConnectionTarget({
    ...valid,
    connectionString: 'postgresql://fee_migrator:migration-secret@attacker.example:5432/feeplatform?schema=public',
  }), /does not match the shared database target/);
  assert.throws(() => validateMigrationConnectionTarget({
    ...valid,
    connectionString: 'postgresql://fee_runtime:migration-secret@postgres:5432/feeplatform?schema=public',
  }), /configured migration role/);
  assert.throws(() => validateMigrationConnectionTarget({
    ...valid,
    target: { ...valid.target, schema: 'public&host=attacker.example' },
  }), /currently require the public schema/);

  const neonDirectHost = 'ep-example.c-4.ap-southeast-1.aws.neon.tech';
  const neon = {
    ...valid,
    connectionString: `postgresql://fee_migrator:migration-secret@${neonDirectHost}:5432/neondb?sslmode=verify-full&schema=public`,
    target: { host: neonDirectHost, port: '5432', database: 'neondb', schema: 'public' },
  };
  assert.equal(validateMigrationConnectionTarget(neon).host, neonDirectHost);
  assert.throws(() => validateMigrationConnectionTarget({
    ...neon,
    connectionString: neon.connectionString.replace('?sslmode=verify-full&', '?'),
  }), /verified TLS for a Neon host/);
});

test('migration entry point rejects injected schema query options before attempting a database connection', () => {
  const result = spawnSync(process.execPath, [resolve('scripts/deploy-staged-migrations.mjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      MIGRATION_DATABASE_URL: 'postgresql://fee_migrator:migration-secret@postgres:5432/feeplatform?schema=public&host=attacker.example',
      MIGRATION_DATABASE_ROLE: 'fee_migrator',
      RUNTIME_DATABASE_ROLE: 'fee_runtime',
      BACKUP_DATABASE_ROLE: 'fee_backup',
      DATABASE_TARGET_HOST: 'postgres',
      DATABASE_TARGET_PORT: '5432',
      DATABASE_TARGET_NAME: 'feeplatform',
      DATABASE_TARGET_SCHEMA: 'public&host=attacker.example',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /unsupported or duplicate query parameters/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /attacker\.example|migration-secret/);
});

test('filtered migration history preserves exact migration bytes and migration lock', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'fee-stage-test-'));
  const sourceRoot = join(temporaryRoot, 'source');
  const outputRoot = join(temporaryRoot, 'output');
  const migrationNames = ['001_init', '002_index_journal'];
  try {
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, 'migration_lock.toml'), 'provider = "postgresql"\n');
    for (const [index, name] of migrationNames.entries()) {
      const migration = join(sourceRoot, name);
      await mkdir(join(migration, 'nested'), { recursive: true });
      await writeFile(join(migration, 'migration.sql'), `-- migration ${index}\nSELECT ${index};\n`);
      await writeFile(join(migration, 'nested', 'metadata.txt'), `opaque bytes ${index}\r\n`);
    }

    const result = await materializeMigrationHistory({
      sourceRoot,
      migrations: migrationNames,
      temporaryRoot: outputRoot,
    });
    assert.equal(await readFile(join(result.migrationsPath, 'migration_lock.toml'), 'utf8'), 'provider = "postgresql"\n');
    for (const name of migrationNames) {
      assert.equal(await readFile(join(result.migrationsPath, name, 'migration.sql'), 'utf8'), await readFile(join(sourceRoot, name, 'migration.sql'), 'utf8'));
      assert.equal(await readFile(join(result.migrationsPath, name, 'nested', 'metadata.txt'), 'utf8'), await readFile(join(sourceRoot, name, 'nested', 'metadata.txt'), 'utf8'));
    }
    await rm(result.temporaryDirectory, { recursive: true, force: true });
  } finally {
    const temporaryRootPath = resolve(temporaryRoot);
    const temporaryParentPath = resolve(tmpdir());
    const relativeTemporaryRoot = relative(temporaryParentPath, temporaryRootPath);
    assert.ok(!isAbsolute(relativeTemporaryRoot) && relativeTemporaryRoot !== '..' && !relativeTemporaryRoot.startsWith(`..${sep}`));
    await rm(temporaryRootPath, { recursive: true, force: true });
  }
});
