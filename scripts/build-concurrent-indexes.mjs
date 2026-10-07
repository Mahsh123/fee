import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { Client } from 'pg';
import { runConcurrentIndexPlan } from './concurrent-index-runner.mjs';

function parseArguments(arguments_) {
  const parsed = { journalSchema: 'public' };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--plan' || argument === '--journal-schema') {
      const value = arguments_[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      parsed[argument === '--plan' ? 'planPath' : 'journalSchema'] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!parsed.planPath) throw new Error('Usage: node scripts/build-concurrent-indexes.mjs --plan <path> [--journal-schema <schema>]');
  return parsed;
}

const args = parseArguments(process.argv.slice(2));
const planPath = resolve(process.cwd(), args.planPath);
const relativePlanPath = relative(process.cwd(), planPath);
if (relativePlanPath === '..' || relativePlanPath.startsWith(`..${sep}`) || relativePlanPath.startsWith(`../`)) {
  throw new Error('Index plan must be inside the workspace');
}

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const migrationRole = process.env.MIGRATION_DATABASE_ROLE;
const runtimeRole = process.env.RUNTIME_DATABASE_ROLE;
if (!migrationUrl || !migrationRole || !runtimeRole) {
  throw new Error('MIGRATION_DATABASE_URL, MIGRATION_DATABASE_ROLE, and RUNTIME_DATABASE_ROLE are required');
}
if (migrationRole === runtimeRole) {
  throw new Error('Migration and runtime credentials must use distinct database roles');
}

const plan = JSON.parse(await readFile(planPath, 'utf8'));
if (!plan || !Array.isArray(plan.indexes)) throw new Error('Index plan must contain an indexes array');
const targetSchemas = [...new Set([args.journalSchema, ...plan.indexes.map((index) => index.schema ?? 'public')])];
const client = new Client({ connectionString: migrationUrl, connectionTimeoutMillis: 5000, application_name: 'fee-schema-index-runner' });
let connected = false;
try {
  await client.connect();
  connected = true;
  const identity = await client.query('SELECT current_user AS role_name, session_user AS login_role FROM pg_roles WHERE rolname = current_user');
  if (identity.rows[0]?.role_name !== migrationRole || identity.rows[0]?.login_role !== migrationRole) {
    throw new Error('Connected database role does not match MIGRATION_DATABASE_ROLE');
  }

  const roleCheck = await client.query(
    `SELECT
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
       pg_has_role(runtime.oid, migration.oid, 'MEMBER') AS runtime_can_assume_migration,
       EXISTS (
         SELECT 1 FROM pg_roles AS privileged
         WHERE (
           privileged.rolsuper OR privileged.rolbypassrls OR privileged.rolcreatedb OR privileged.rolcreaterole OR privileged.rolreplication
           OR (left(privileged.rolname, 3) = 'pg_' AND privileged.rolname <> 'pg_database_owner')
         )
           AND pg_has_role(runtime.oid, privileged.oid, 'MEMBER')
       ) AS runtime_can_assume_privileged_role,
       EXISTS (
         SELECT 1 FROM pg_roles AS privileged
         WHERE (
           privileged.rolsuper OR privileged.rolbypassrls OR privileged.rolcreatedb OR privileged.rolcreaterole OR privileged.rolreplication
           OR (left(privileged.rolname, 3) = 'pg_' AND privileged.rolname <> 'pg_database_owner')
         )
           AND pg_has_role(migration.oid, privileged.oid, 'MEMBER')
       ) AS migration_can_assume_privileged_role,
       has_database_privilege(runtime.oid, current_database(), 'CREATE') AS runtime_database_create
     FROM pg_roles AS migration
     JOIN pg_roles AS runtime ON runtime.rolname = $1
     WHERE migration.rolname = current_user`,
    [runtimeRole],
  );
  const roles = roleCheck.rows[0];
  if (!roles) throw new Error('Migration or runtime database role does not exist');
  if (roles.migration_superuser || roles.migration_bypass_rls || roles.migration_createdb || roles.migration_createrole || roles.migration_replication || roles.migration_can_assume_privileged_role) {
    throw new Error('Migration role must not be superuser, bypass RLS, administer roles or databases, or assume a privileged role');
  }
  if (roles.runtime_superuser || roles.runtime_bypass_rls || roles.runtime_createdb || roles.runtime_createrole || roles.runtime_replication || roles.runtime_can_assume_migration || roles.runtime_can_assume_privileged_role || roles.runtime_database_create) {
    throw new Error('Runtime role has privileges incompatible with the migration/runtime boundary');
  }

  const schemaCheck = await client.query(
    `SELECT nspname AS schema_name,
       has_schema_privilege($1, oid, 'CREATE') AS runtime_schema_create,
       pg_has_role($1, nspowner, 'MEMBER') AS runtime_schema_owner
     FROM pg_namespace
     WHERE nspname <> 'information_schema'
       AND nspname !~ '^pg_'`,
    [runtimeRole],
  );
  if (targetSchemas.some((name) => !schemaCheck.rows.some((row) => row.schema_name === name))) {
    throw new Error('An application schema required by the index plan does not exist');
  }
  if (schemaCheck.rows.some((row) => row.runtime_schema_create || row.runtime_schema_owner)) {
    throw new Error('Runtime role can create objects in or owns an application schema');
  }

  const journalCheck = await client.query(
    `SELECT
       COALESCE(bool_or(has_table_privilege($1, relation.oid, 'SELECT')), false) AS runtime_journal_select,
       COALESCE(bool_or(has_table_privilege($1, relation.oid, 'INSERT')), false) AS runtime_journal_insert,
       COALESCE(bool_or(has_table_privilege($1, relation.oid, 'UPDATE')), false) AS runtime_journal_update,
       COALESCE(bool_or(has_table_privilege($1, relation.oid, 'DELETE')), false) AS runtime_journal_delete,
       COALESCE(bool_or(has_table_privilege($1, relation.oid, 'REFERENCES')), false) AS runtime_journal_references,
       COALESCE(bool_or(has_table_privilege($1, relation.oid, 'TRUNCATE')), false) AS runtime_journal_truncate,
       COALESCE(bool_or(has_any_column_privilege($1, relation.oid, 'SELECT')), false) AS runtime_journal_column_select,
       COALESCE(bool_or(has_any_column_privilege($1, relation.oid, 'INSERT')), false) AS runtime_journal_column_insert,
       COALESCE(bool_or(has_any_column_privilege($1, relation.oid, 'UPDATE')), false) AS runtime_journal_column_update,
       COALESCE(bool_or(has_table_privilege($1, relation.oid, 'TRIGGER')), false) AS runtime_journal_trigger,
       COALESCE(bool_or(has_any_column_privilege($1, relation.oid, 'REFERENCES')), false) AS runtime_journal_column_references
     FROM pg_class AS relation
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $2 AND relation.relname = 'schema_index_builds' AND relation.relkind IN ('r', 'p')`,
    [runtimeRole, args.journalSchema],
  );
  if (Object.values(journalCheck.rows[0] ?? {}).some(Boolean)) {
    throw new Error('Runtime role has direct access to the schema index build journal');
  }

  const relationCheck = await client.query(
    `SELECT relation.relname AS relation_name,
       pg_has_role($1, relation.relowner, 'MEMBER') AS runtime_relation_owner
     FROM pg_class AS relation
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`,
    [runtimeRole],
  );
  if (relationCheck.rows.some((row) => row.runtime_relation_owner)) {
    throw new Error('Runtime role owns an application relation');
  }

  const result = await runConcurrentIndexPlan(client, plan, { journalSchema: args.journalSchema });
  const counts = result.results.reduce((summary, entry) => {
    summary[entry.status] = (summary[entry.status] ?? 0) + 1;
    return summary;
  }, {});
  console.log(`Index stage ${result.stageChecksum.slice(0, 12)} complete: ${JSON.stringify(counts)}`);
} finally {
  if (connected) await client.end();
}
