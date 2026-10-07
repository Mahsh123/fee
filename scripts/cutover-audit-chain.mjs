import { timingSafeEqual } from 'node:crypto';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPostgresUrlTarget } from './compose-database-target.mjs';

const AUDIT_CUTOVER_LOCK = [4605253, 1095058482];
const AUDIT_TABLES = [
  'public.audit_logs',
  'public.audit_chain_heads',
  'public.audit_signing_keys',
  'public.audit_request_nonces',
];

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function safeRole(value, name) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${name} must be a lowercase PostgreSQL role identifier`);
  }
  return value;
}

function activeSignerKeyVersion(environment) {
  const version = environment.AUDIT_ACTIVE_SIGNING_KEY_VERSION ?? '1';
  if (!/^[1-9]\d{0,8}$/.test(version)) throw new Error('AUDIT_ACTIVE_SIGNING_KEY_VERSION must be a positive integer');
  const signerKeys = environment.AUDIT_SIGNING_KEYS_JSON;
  if (!signerKeys) throw new Error('The active API signing key must be configured before audit cutover');
  let parsed;
  try { parsed = JSON.parse(signerKeys); } catch { throw new Error('AUDIT_SIGNING_KEYS_JSON is invalid'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      !/^[0-9a-f]{64}$/i.test(parsed[version] ?? '')) {
    throw new Error('AUDIT_SIGNING_KEYS_JSON does not contain the configured active key version');
  }
  return { version: Number(version), material: Buffer.from(parsed[version], 'hex') };
}

function parseVerification(result) {
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  if (!parsed || parsed.intact !== true || parsed.limited !== false) {
    throw new Error('Legacy audit verification failed; cutover was rolled back');
  }
}

async function verifyTenantChains(client) {
  const { rows: tenants } = await client.query(
    `SELECT tenant.id::text AS id
       FROM public.tenants AS tenant
       LEFT JOIN public.audit_chain_heads AS head ON head."tenantId" = tenant.id
      WHERE head.id IS NULL
      ORDER BY tenant.id`,
  );
  if (tenants.length) throw new Error(`Tenant audit heads are missing for ${tenants.length} tenant(s); cutover was rolled back`);

  const { rows } = await client.query('SELECT id::text AS id FROM public.tenants ORDER BY id');
  await client.query('SET ROLE fee_audit_owner');
  try {
    for (const tenant of rows) {
      await client.query("SELECT pg_catalog.set_config('fee.current_tenant', $1, true)", [tenant.id]);
      const verified = await client.query(
        'SELECT app_private.fee_audit_verify_tenant($1::uuid, 100000) AS result',
        [tenant.id],
      );
      parseVerification(verified.rows[0]?.result);
    }
  } finally {
    await client.query('RESET ROLE');
  }
  return rows.length;
}

async function assertActiveVerifierKey(client, signerKey) {
  await client.query('SET ROLE fee_audit_owner');
  try {
    const result = await client.query(
      `SELECT "keyMaterial", EXISTS (
         SELECT 1 FROM public.audit_signing_keys
          WHERE "keyVersion" = $1 AND "notBefore" <= (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
            AND ("notAfter" IS NULL OR "notAfter" > (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'))
            AND "retiredAt" IS NULL
       ) AS ready
         FROM public.audit_signing_keys WHERE "keyVersion" = $1`,
      [signerKey.version],
    );
    const stored = result.rows[0]?.keyMaterial;
    if (!result.rows[0]?.ready || !Buffer.isBuffer(stored) || stored.length !== signerKey.material.length ||
        !timingSafeEqual(stored, signerKey.material)) {
      throw new Error('The active signing key is not provisioned, valid, and consistent in the database');
    }
  } finally {
    await client.query('RESET ROLE');
  }
}

async function revokeRuntimeAuditTableAccess(client, runtimeRole, backupRole) {
  const runtime = quoteIdentifier(runtimeRole);
  for (const table of AUDIT_TABLES) {
    await client.query(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, ${runtime}`);
    const { rows } = await client.query(
      `SELECT attribute.attname AS name
         FROM pg_attribute AS attribute
        WHERE attribute.attrelid = $1::regclass AND attribute.attnum > 0 AND NOT attribute.attisdropped
        ORDER BY attribute.attnum`,
      [table],
    );
    if (rows.length) {
      const columns = rows.map(({ name }) => quoteIdentifier(name)).join(', ');
      await client.query(`REVOKE ALL PRIVILEGES (${columns}) ON TABLE ${table} FROM PUBLIC, ${runtime}`);
    }
  }

  const checks = await client.query(
    `SELECT relation_name,
       has_table_privilege($1, relation_name, 'SELECT') AS can_select,
       has_table_privilege($1, relation_name, 'INSERT') AS can_insert,
       has_table_privilege($1, relation_name, 'UPDATE') AS can_update,
       has_table_privilege($1, relation_name, 'DELETE') AS can_delete,
       has_table_privilege($1, relation_name, 'TRUNCATE') AS can_truncate,
       has_table_privilege($1, relation_name, 'REFERENCES') AS can_reference,
       has_table_privilege($1, relation_name, 'TRIGGER') AS can_trigger
     FROM unnest($2::text[]) AS tables(relation_name)`,
    [runtimeRole, AUDIT_TABLES],
  );
  if (checks.rows.some((row) => Object.entries(row).some(([column, allowed]) =>
    column.startsWith('can_') && allowed !== false))) {
    throw new Error('The runtime role retains direct access to an audit table; cutover was rolled back');
  }

  const columnAccess = await client.query(
    `SELECT relation.relname AS table_name, attribute.attname AS column_name
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
      WHERE namespace.nspname = 'public' AND relation.oid = ANY($2::regclass[])
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
        AND (has_column_privilege($1, relation.oid, attribute.attname, 'SELECT')
          OR has_column_privilege($1, relation.oid, attribute.attname, 'INSERT')
          OR has_column_privilege($1, relation.oid, attribute.attname, 'UPDATE')
          OR has_column_privilege($1, relation.oid, attribute.attname, 'REFERENCES'))
      LIMIT 1`,
    [runtimeRole, AUDIT_TABLES],
  );
  if (columnAccess.rows.length) {
    throw new Error('The runtime role retains column-level audit-table access; cutover was rolled back');
  }

  const wrappers = await client.query(
    `SELECT has_function_privilege($1, 'app_private.fee_audit_append_api(jsonb,bytea)', 'EXECUTE') AS can_append,
       has_function_privilege($1, 'app_private.fee_audit_verify_tenant(uuid,integer)', 'EXECUTE') AS can_verify,
       has_function_privilege($1, 'app_private.fee_audit_read_tenant(uuid,uuid,jsonb,integer,integer,jsonb)', 'EXECUTE') AS can_read,
       has_function_privilege($2, 'app_private.fee_audit_append_api(jsonb,bytea)', 'EXECUTE') AS backup_append,
       has_function_privilege($2, 'app_private.fee_audit_verify_tenant(uuid,integer)', 'EXECUTE') AS backup_verify,
       has_function_privilege($2, 'app_private.fee_audit_read_tenant(uuid,uuid,jsonb,integer,integer,jsonb)', 'EXECUTE') AS backup_read,
       EXISTS (
         SELECT 1 FROM pg_proc AS procedure
         CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
         WHERE procedure.oid IN (
           'app_private.fee_audit_append_api(jsonb,bytea)'::regprocedure,
           'app_private.fee_audit_verify_tenant(uuid,integer)'::regprocedure,
           'app_private.fee_audit_read_tenant(uuid,uuid,jsonb,integer,integer,jsonb)'::regprocedure
         ) AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
       ) AS public_execute,
       has_function_privilege($1, 'app_private.fee_audit_append_core(jsonb)', 'EXECUTE') AS runtime_core,
       has_function_privilege($1, 'app_private.fee_audit_anchor_legacy_snapshots()', 'EXECUTE') AS runtime_anchor`,
    [runtimeRole, backupRole],
  );
  const wrapper = wrappers.rows[0];
  if (!wrapper?.can_append || !wrapper.can_verify || !wrapper.can_read || wrapper.backup_append ||
      wrapper.backup_verify || wrapper.backup_read || wrapper.public_execute || wrapper.runtime_core || wrapper.runtime_anchor) {
    throw new Error('Signed audit wrapper EXECUTE grants are not ready; run ACL synchronization before cutover');
  }
}

export async function cutoverAuditChain({
  environment = process.env,
  ClientConstructor = Client,
} = {}) {
  if (environment.AUDIT_CUTOVER_CONFIRM_ALL_API_INSTANCES_USE_SIGNED_AUDIT !== 'true') {
    throw new Error('Set AUDIT_CUTOVER_CONFIRM_ALL_API_INSTANCES_USE_SIGNED_AUDIT=true only after all legacy API instances are drained');
  }
  const migrationRole = safeRole(environment.MIGRATION_DATABASE_ROLE, 'MIGRATION_DATABASE_ROLE');
  const runtimeRole = safeRole(environment.RUNTIME_DATABASE_ROLE, 'RUNTIME_DATABASE_ROLE');
  const backupRole = safeRole(environment.BACKUP_DATABASE_ROLE, 'BACKUP_DATABASE_ROLE');
  if (new Set([migrationRole, runtimeRole, backupRole]).size !== 3) {
    throw new Error('Migration, runtime, and backup database roles must be distinct');
  }
  const activeKey = activeSignerKeyVersion(environment);
  const connectionString = environment.MIGRATION_DATABASE_URL;
  const target = {
    host: environment.DATABASE_TARGET_HOST,
    port: environment.DATABASE_TARGET_PORT,
    database: environment.DATABASE_TARGET_NAME,
    schema: environment.DATABASE_TARGET_SCHEMA,
  };
  if (!connectionString || !target.host || !target.port || !target.database || !target.schema) {
    throw new Error('Audit cutover requires the migration connection and complete shared database target');
  }
  const parsedUrl = verifyPostgresUrlTarget(connectionString, 'MIGRATION_DATABASE_URL', target);
  if (parsedUrl.username !== migrationRole || !parsedUrl.password) {
    throw new Error('MIGRATION_DATABASE_URL does not use the configured migration role');
  }

  const client = new ClientConstructor({
    connectionString,
    connectionTimeoutMillis: 5000,
    application_name: 'fee-audit-chain-cutover',
  });
  let connected = false;
  let transaction = false;
  try {
    await client.connect();
    connected = true;
    const identity = await client.query(
      `SELECT current_database() AS database_name, current_user AS current_role, session_user AS login_role,
         (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged`,
    );
    if (identity.rows[0]?.database_name !== target.database || identity.rows[0]?.current_role !== migrationRole ||
        identity.rows[0]?.login_role !== migrationRole || identity.rows[0]?.privileged) {
      throw new Error('Audit cutover is not connected as the approved non-admin migration role and target');
    }

    await client.query('BEGIN');
    transaction = true;
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock($1, $2)', AUDIT_CUTOVER_LOCK);
    await client.query('LOCK TABLE public.audit_logs IN ACCESS EXCLUSIVE MODE');
    await assertActiveVerifierKey(client, activeKey);

    const marker = await client.query(
      "SELECT EXISTS (SELECT 1 FROM public.app_schema_capabilities WHERE key = 'audit-chain-v2') AS installed",
    );
    let anchoredTenants = 0;
    if (!marker.rows[0]?.installed) {
      await client.query('SET ROLE fee_audit_owner');
      try {
        const anchored = await client.query('SELECT app_private.fee_audit_anchor_legacy_snapshots() AS count');
        anchoredTenants = Number(anchored.rows[0]?.count);
        if (!Number.isSafeInteger(anchoredTenants) || anchoredTenants < 0) {
          throw new Error('Database returned an invalid audit anchor count');
        }
      } finally {
        await client.query('RESET ROLE');
      }
      await verifyTenantChains(client);
      await client.query(
        "INSERT INTO public.app_schema_capabilities (key) VALUES ('audit-chain-v2')",
      );
    }

    await revokeRuntimeAuditTableAccess(client, runtimeRole, backupRole);
    await client.query('COMMIT');
    transaction = false;
    return { alreadyCutOver: Boolean(marker.rows[0]?.installed), anchoredTenants };
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    const safeCode = typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? ` (${error.code})` : '';
    if (error instanceof Error && !error.code) throw error;
    throw new Error(`Audit chain cutover failed${safeCode}`);
  } finally {
    if (connected) await client.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cutoverAuditChain()
    .then(({ alreadyCutOver, anchoredTenants }) => {
      console.log(alreadyCutOver
        ? 'Audit chain v2 cutover was already installed; access checks passed.'
        : `Audit chain v2 cutover committed after anchoring ${anchoredTenants} tenant(s).`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Audit chain cutover failed');
      process.exitCode = 1;
    });
}
