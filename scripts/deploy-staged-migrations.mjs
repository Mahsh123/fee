import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPostgresUrlTarget } from './compose-database-target.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationRoot = resolve(root, 'prisma/migrations');
const stageManifestPath = resolve(root, 'prisma/migration-stages.json');

function ensureWithin(parent, candidate, label) {
  const rel = relative(parent, candidate);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`${label} must stay inside ${parent}`);
  }
}

function normalizeBarrierIndexes(indexes, label) {
  if (!Array.isArray(indexes) || !indexes.length) throw new Error(`Each ${label} barrier requires one or more index identifiers`);
  const normalized = indexes.map((index) => {
    const indexName = typeof index === 'string' ? index : index?.indexName;
    const schemaIndexName = typeof index === 'string' ? index : index?.schemaIndexName ?? indexName;
    if (typeof indexName !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/.test(indexName)
      || typeof schemaIndexName !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/.test(schemaIndexName)) {
      throw new Error(`Each ${label} barrier requires valid build index names and optional schemaIndexName aliases`);
    }
    return { indexName, schemaIndexName };
  });
  if (new Set(normalized.map(({ indexName }) => indexName)).size !== normalized.length) {
    throw new Error(`${label} barriers must not repeat an index requirement`);
  }
  return normalized;
}

export function validateMigrationStages(migrationNames, manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.preIndexMigrations) || !Array.isArray(manifest.postIndexMigrations)) {
    throw new Error('Migration stage manifest must have version 1 and preIndexMigrations/postIndexMigrations arrays');
  }
  const ordered = [...migrationNames].sort();
  const pre = manifest.preIndexMigrations;
  const post = manifest.postIndexMigrations;
  const barriers = manifest.preIndexIndexBarriers ?? [];
  const postBarriers = manifest.postIndexIndexBarriers ?? [];
  if (!Array.isArray(barriers)) throw new Error('preIndexIndexBarriers must be an array when provided');
  if (!Array.isArray(postBarriers)) throw new Error('postIndexIndexBarriers must be an array when provided');
  const all = [...pre, ...post];
  if (!ordered.length) throw new Error('No Prisma migration directories were found');
  if (new Set(all).size !== all.length) throw new Error('Migration stage manifest classifies a migration more than once');
  const outOfOrder = [pre, post].some((stage) => stage.some((name, index) => index > 0 && name < stage[index - 1]));
  if (outOfOrder) throw new Error('Migration stage lists must each remain in timestamp order');
  if (all.length !== ordered.length || ordered.some((name) => !all.includes(name))) {
    const missing = ordered.filter((name) => !all.includes(name));
    const unknown = all.filter((name) => !ordered.includes(name));
    throw new Error(`Migration stage manifest must classify every migration exactly once (unclassified: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'})`);
  }
  let previousBarrierPosition = -1;
  const barrierIndexes = new Set();
  const checkedBarriers = barriers.map((barrier) => {
    if (!barrier || typeof barrier.beforeMigration !== 'string') throw new Error('Each pre-index barrier requires beforeMigration and one or more index identifiers');
    const normalizedIndexes = normalizeBarrierIndexes(barrier.indexes, 'pre-index');
    const position = pre.indexOf(barrier.beforeMigration);
    if (position < 0) throw new Error(`Pre-index barrier migration is not classified as pre-index: ${barrier.beforeMigration}`);
    if (position === 0) throw new Error('A pre-index barrier must follow a migration that creates its index target');
    if (position <= previousBarrierPosition) throw new Error('Pre-index barriers must follow migration timestamp order');
    previousBarrierPosition = position;
    if (normalizedIndexes.some(({ indexName }) => barrierIndexes.has(indexName))) {
      throw new Error('Pre-index barriers must not repeat an index requirement');
    }
    for (const { indexName, schemaIndexName } of normalizedIndexes) {
      barrierIndexes.add(indexName);
      if (schemaIndexName !== indexName) barrierIndexes.add(schemaIndexName);
    }
    return {
      beforeMigration: barrier.beforeMigration,
      indexes: normalizedIndexes.map(({ indexName, schemaIndexName }) => indexName === schemaIndexName
        ? indexName
        : { indexName, schemaIndexName }),
    };
  });
  let previousPostBarrierPosition = -1;
  const checkedPostBarriers = postBarriers.map((barrier) => {
    if (!barrier || typeof barrier.beforeMigration !== 'string') throw new Error('Each post-index barrier requires beforeMigration and one or more index identifiers');
    const normalizedIndexes = normalizeBarrierIndexes(barrier.indexes, 'post-index');
    const position = post.indexOf(barrier.beforeMigration);
    if (position < 0) throw new Error(`Post-index barrier migration is not classified as post-index: ${barrier.beforeMigration}`);
    if (position === 0) throw new Error('A post-index barrier must follow a migration that creates its index target');
    if (position <= previousPostBarrierPosition) throw new Error('Post-index barriers must follow migration timestamp order');
    previousPostBarrierPosition = position;
    if (normalizedIndexes.some(({ indexName, schemaIndexName }) => barrierIndexes.has(indexName) || barrierIndexes.has(schemaIndexName))) {
      throw new Error('Index barriers must not repeat an index requirement');
    }
    for (const { indexName, schemaIndexName } of normalizedIndexes) {
      barrierIndexes.add(indexName);
      barrierIndexes.add(schemaIndexName);
    }
    return {
      beforeMigration: barrier.beforeMigration,
      indexes: normalizedIndexes.map(({ indexName, schemaIndexName }) => indexName === schemaIndexName
        ? indexName
        : { indexName, schemaIndexName }),
    };
  });
  return {
    preIndexMigrations: [...pre],
    postIndexMigrations: [...post],
    preIndexIndexBarriers: checkedBarriers,
    postIndexIndexBarriers: checkedPostBarriers,
  };
}

async function listRegularFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name);
    const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listRegularFiles(child, relativeName));
    else if (entry.isFile()) files.push(relativeName);
    else throw new Error(`Migration history contains a non-regular file: ${relativeName}`);
  }
  return files.sort();
}

async function checksum(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await copyFile(from, to);
    else throw new Error(`Migration history contains a non-regular file: ${from}`);
  }
}

export async function materializeMigrationHistory({ sourceRoot, migrations, temporaryRoot }) {
  const resolvedSource = resolve(sourceRoot);
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  await mkdir(resolvedTemporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(resolvedTemporaryRoot, 'prisma-filtered-history-'));
  ensureWithin(resolvedTemporaryRoot, temporaryDirectory, 'Temporary migration directory');
  const destination = join(temporaryDirectory, 'migrations');
  try {
    await mkdir(destination, { recursive: true });
    const lockFile = join(resolvedSource, 'migration_lock.toml');
    await copyFile(lockFile, join(destination, 'migration_lock.toml'));
    for (const migration of migrations) {
      const source = join(resolvedSource, migration);
      const target = join(destination, migration);
      await copyTree(source, target);
      const sourceFiles = await listRegularFiles(source);
      const targetFiles = await listRegularFiles(target);
      if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) {
        throw new Error(`Filtered migration files differ for ${migration}`);
      }
      for (const file of sourceFiles) {
        if (await checksum(join(source, file)) !== await checksum(join(target, file))) {
          throw new Error(`Filtered migration checksum differs for ${migration}/${file}`);
        }
      }
    }
    if (await checksum(lockFile) !== await checksum(join(destination, 'migration_lock.toml'))) {
      throw new Error('Filtered migration lock checksum differs from canonical history');
    }
    return { temporaryDirectory, migrationsPath: destination };
  } catch (error) {
    ensureWithin(resolvedTemporaryRoot, temporaryDirectory, 'Temporary migration directory');
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function materializePreIndexHistory(options) {
  return materializeMigrationHistory({
    sourceRoot: options.sourceRoot,
    migrations: options.preIndexMigrations,
    temporaryRoot: options.temporaryRoot,
  });
}

export function buildMigrationChildEnvironment(sourceEnvironment, additional = {}) {
  const allowed = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
  const environment = Object.fromEntries(allowed
    .filter((key) => typeof sourceEnvironment[key] === 'string')
    .map((key) => [key, sourceEnvironment[key]]));
  return { ...environment, ...additional };
}

function minimalEnvironment(additional = {}) {
  return buildMigrationChildEnvironment(process.env, additional);
}

export function validateMigrationConnectionTarget({ connectionString, migrationRole, runtimeRole, target }) {
  if (!connectionString || !migrationRole || !runtimeRole) {
    throw new Error('Migration connection URL and distinct migration/runtime roles are required');
  }
  for (const [key, envName] of Object.entries({
    host: 'DATABASE_TARGET_HOST',
    port: 'DATABASE_TARGET_PORT',
    database: 'DATABASE_TARGET_NAME',
    schema: 'DATABASE_TARGET_SCHEMA',
  })) {
    if (typeof target?.[key] !== 'string' || target[key].length === 0) throw new Error(`${envName} is required`);
  }
  if (migrationRole === runtimeRole) throw new Error('Migration and runtime roles must be distinct');
  const parsed = verifyPostgresUrlTarget(connectionString, 'MIGRATION_DATABASE_URL', target);
  if (parsed.username !== migrationRole || !parsed.password) {
    throw new Error('MIGRATION_DATABASE_URL must use the configured migration role and a non-empty password');
  }
  return parsed;
}

function runPrismaDeploy(migrationsPath) {
  const prismaEntrypoint = resolve(root, 'node_modules/prisma/build/index.js');
  const childEnvironment = minimalEnvironment({
    MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL,
    ...(migrationsPath ? { PRISMA_MIGRATIONS_PATH: migrationsPath } : {}),
  });
  execFileSync(process.execPath, [prismaEntrypoint, 'migrate', 'deploy'], {
    cwd: root,
    env: childEnvironment,
    stdio: 'inherit',
  });
}

function runMigrationScript(script, args, additionalEnvironment) {
  execFileSync(process.execPath, [resolve(root, script), ...args], {
    cwd: root,
    env: minimalEnvironment(additionalEnvironment),
    stdio: 'inherit',
  });
}

export async function verifyMigrationRoles({ migrationRole, runtimeRole, connectionString }) {
  if (migrationRole === runtimeRole) throw new Error('Migration and runtime roles must be distinct');
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, application_name: 'fee-migration-role-check' });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const result = await client.query(
      `SELECT migration.rolname AS current_role,
         session_user AS login_role,
         migration.rolsuper AS migration_superuser,
         migration.rolbypassrls AS migration_bypass_rls,
         migration.rolcreatedb AS migration_createdb,
         migration.rolcreaterole AS migration_createrole,
         migration.rolreplication AS migration_replication,
         runtime.rolsuper AS runtime_superuser,
         runtime.rolbypassrls AS runtime_bypass_rls,
         runtime.rolcreatedb AS runtime_createdb,
         runtime.rolcreaterole AS runtime_createrole,
         runtime.rolreplication AS runtime_replication,
         pg_has_role(migration.oid, privileged.oid, 'MEMBER') AS migration_privileged_membership,
         pg_has_role(runtime.oid, migration.oid, 'MEMBER') AS runtime_migration_membership,
         pg_has_role(runtime.oid, privileged.oid, 'MEMBER') AS runtime_privileged_membership,
         has_database_privilege(runtime.oid, current_database(), 'CREATE') AS runtime_database_create
       FROM pg_roles AS migration
       JOIN pg_roles AS runtime ON runtime.rolname = $2
       JOIN pg_roles AS privileged ON (
         privileged.rolsuper OR privileged.rolbypassrls OR privileged.rolcreatedb OR privileged.rolcreaterole
         OR privileged.rolreplication OR (left(privileged.rolname, 3) = 'pg_' AND privileged.rolname <> 'pg_database_owner')
       )
       WHERE migration.rolname = $1`,
      [migrationRole, runtimeRole],
    );
    const identity = await client.query('SELECT current_user AS role_name, session_user AS login_role');
    if (identity.rows[0]?.role_name !== migrationRole || identity.rows[0]?.login_role !== migrationRole) {
      throw new Error('Connected database role does not match MIGRATION_DATABASE_ROLE');
    }
    const rows = result.rows;
    if (!rows.length) throw new Error('Migration or runtime database role does not exist');
    if (rows.some((row) => row.migration_superuser || row.migration_bypass_rls || row.migration_createdb || row.migration_createrole || row.migration_replication || row.migration_privileged_membership)) {
      throw new Error('Migration role must be a non-admin role without superuser, bypass-RLS, database, role, replication, or privileged-role membership');
    }
    if (rows.some((row) => row.runtime_superuser || row.runtime_bypass_rls || row.runtime_createdb || row.runtime_createrole || row.runtime_replication || row.runtime_migration_membership || row.runtime_privileged_membership || row.runtime_database_create)) {
      throw new Error('Runtime role has privileges incompatible with the migration/runtime boundary');
    }
    const schema = await client.query(
      `SELECT has_schema_privilege($1, oid, 'CREATE') AS runtime_schema_create,
         nspname AS schema_name,
         pg_has_role($1, nspowner, 'MEMBER') AS runtime_schema_owner
       FROM pg_namespace
       WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'`,
      [runtimeRole],
    );
    if (!schema.rows.some((row) => row.schema_name === 'public')) {
      throw new Error('The public application schema does not exist');
    }
    if (schema.rows.some((row) => row.runtime_schema_create || row.runtime_schema_owner)) {
      throw new Error('Runtime role can create objects in or owns an application schema');
    }
    const relations = await client.query(
      `SELECT pg_has_role($1, relation.relowner, 'MEMBER') AS runtime_relation_owner
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`,
      [runtimeRole],
    );
    if (relations.rows.some((row) => row.runtime_relation_owner)) {
      throw new Error('Runtime role owns an application relation');
    }
  } finally {
    if (connected) await client.end();
    else await client.end().catch(() => {});
  }
}

export async function hasSuccessfulMigration(client, migrationName) {
  if (typeof migrationName !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(migrationName)) {
    throw new Error('Migration name must be a single Prisma migration identifier');
  }
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM public._prisma_migrations
       WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
     ) AS applied`,
    [migrationName],
  );
  return result.rows[0]?.applied === true;
}

async function readMigrationNames(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  const migrationRole = process.env.MIGRATION_DATABASE_ROLE;
  const runtimeRole = process.env.RUNTIME_DATABASE_ROLE;
  const backupRole = process.env.BACKUP_DATABASE_ROLE;
  const target = {
    host: process.env.DATABASE_TARGET_HOST,
    port: process.env.DATABASE_TARGET_PORT,
    database: process.env.DATABASE_TARGET_NAME,
    schema: process.env.DATABASE_TARGET_SCHEMA,
  };

  // Validate the effective driver target and credentials before opening any
  // network connection with the migration secret.
  if (!backupRole) throw new Error('BACKUP_DATABASE_ROLE is required for staged ACL synchronization');
  if (new Set([migrationRole, runtimeRole, backupRole]).size !== 3) {
    throw new Error('Migration, runtime, and backup database roles must be distinct');
  }
  validateMigrationConnectionTarget({ connectionString, migrationRole, runtimeRole, target });
  await verifyMigrationRoles({ migrationRole, runtimeRole, connectionString });
  const manifest = JSON.parse(await readFile(stageManifestPath, 'utf8'));
  const stages = validateMigrationStages(await readMigrationNames(migrationRoot), manifest);
  const temporaryRoot = resolve(root, '.tmp');
  async function deployMigrationHistory(migrations, stageLabel) {
    if (!migrations.length) return;
    const staged = await materializeMigrationHistory({
      sourceRoot: migrationRoot,
      migrations,
      temporaryRoot,
    });
    try {
      console.log(`Applying ${migrations.length} ${stageLabel} migrations with the migration role.`);
      runPrismaDeploy(staged.migrationsPath);
    } finally {
      ensureWithin(temporaryRoot, staged.temporaryDirectory, 'Temporary migration directory');
      await rm(staged.temporaryDirectory, { recursive: true, force: true });
    }
  }
  const deployPreIndexHistory = (migrations) => deployMigrationHistory(migrations, 'pre-index');

  async function buildBarrierIndexes(indexes) {
    const selections = indexes.map((index) => typeof index === 'string'
      ? index
      : `${index.indexName}=${index.schemaIndexName}`);
    runMigrationScript('scripts/generate-concurrent-index-plan.mjs', ['--only-index', selections.join(',')], {
      MIGRATION_DATABASE_URL: connectionString,
    });
    runMigrationScript('scripts/build-concurrent-indexes.mjs', ['--plan', '.tmp/tenant-relation-index-plan.json'], {
      MIGRATION_DATABASE_URL: connectionString,
      MIGRATION_DATABASE_ROLE: migrationRole,
      RUNTIME_DATABASE_ROLE: runtimeRole,
    });
  }

  let barrierPrefix = 0;
  for (const barrier of stages.preIndexIndexBarriers) {
    const beforePosition = stages.preIndexMigrations.indexOf(barrier.beforeMigration);
    if (beforePosition > barrierPrefix) {
      await deployPreIndexHistory(stages.preIndexMigrations.slice(0, beforePosition));
    }
    console.log(`Building pre-index prerequisite indexes before ${barrier.beforeMigration}.`);
    await buildBarrierIndexes(barrier.indexes);
    barrierPrefix = beforePosition;
  }
  if (barrierPrefix < stages.preIndexMigrations.length || !stages.preIndexIndexBarriers.length) {
    await deployPreIndexHistory(stages.preIndexMigrations);
  }

  runMigrationScript('scripts/preflight-tenant-relations.mjs', [], {
    MIGRATION_DATABASE_URL: connectionString,
    MIGRATION_DATABASE_ROLE: migrationRole,
  });
  runMigrationScript('scripts/generate-concurrent-index-plan.mjs', [], {
    MIGRATION_DATABASE_URL: connectionString,
  });
  runMigrationScript('scripts/build-concurrent-indexes.mjs', ['--plan', '.tmp/tenant-relation-index-plan.json'], {
    MIGRATION_DATABASE_URL: connectionString,
    MIGRATION_DATABASE_ROLE: migrationRole,
    RUNTIME_DATABASE_ROLE: runtimeRole,
  });

  for (const barrier of stages.postIndexIndexBarriers) {
    const checkClient = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      application_name: 'fee-post-index-barrier-check',
    });
    let checked = false;
    let alreadyApplied;
    try {
      await checkClient.connect();
      checked = true;
      alreadyApplied = await hasSuccessfulMigration(checkClient, barrier.beforeMigration);
    } finally {
      if (checked) await checkClient.end();
      else await checkClient.end().catch(() => {});
    }
    if (alreadyApplied) {
      console.log(`Skipping post-index barrier before ${barrier.beforeMigration}; the migration is already applied.`);
      continue;
    }
    const beforePosition = stages.postIndexMigrations.indexOf(barrier.beforeMigration);
    const prefix = [
      ...stages.preIndexMigrations,
      ...stages.postIndexMigrations.slice(0, beforePosition),
    ];
    await deployMigrationHistory(prefix, 'post-index prefix');
    console.log(`Building post-index prerequisite indexes before ${barrier.beforeMigration}.`);
    await buildBarrierIndexes(barrier.indexes);
  }

  console.log(`Applying canonical post-index history (${stages.postIndexMigrations.length} classified post-index migrations).`);
  runPrismaDeploy();
  runMigrationScript('scripts/provision-audit-signing-keys.mjs', [], {
    MIGRATION_DATABASE_URL: connectionString,
    MIGRATION_DATABASE_ROLE: migrationRole,
    DATABASE_TARGET_HOST: target.host,
    DATABASE_TARGET_PORT: target.port,
    DATABASE_TARGET_NAME: target.database,
    DATABASE_TARGET_SCHEMA: target.schema,
    AUDIT_ACTIVE_SIGNING_KEY_VERSION: process.env.AUDIT_ACTIVE_SIGNING_KEY_VERSION ?? '1',
    AUDIT_SIGNING_KEYS_JSON: process.env.AUDIT_SIGNING_KEYS_JSON ?? '',
  });
  console.log('Synchronizing exact runtime and backup database ACLs.');
  runMigrationScript('scripts/sync-database-acls.mjs', [], {
    MIGRATION_DATABASE_URL: connectionString,
    MIGRATION_DATABASE_ROLE: migrationRole,
    RUNTIME_DATABASE_ROLE: runtimeRole,
    BACKUP_DATABASE_ROLE: backupRole,
    DATABASE_TARGET_HOST: target.host,
    DATABASE_TARGET_PORT: target.port,
    DATABASE_TARGET_NAME: target.database,
    DATABASE_TARGET_SCHEMA: target.schema,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
