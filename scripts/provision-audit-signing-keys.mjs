import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { verifyPostgresUrlTarget } from './compose-database-target.mjs';

/**
 * Copies API HMAC verifier material into the owner-only database table.
 * Existing key versions are immutable: replacing a version requires an
 * explicit version bump so in-flight signatures cannot change meaning.
 */
export async function provisionAuditSigningKeys({
  connectionString = process.env.MIGRATION_DATABASE_URL,
  migrationRole = process.env.MIGRATION_DATABASE_ROLE,
  activeVersion = process.env.AUDIT_ACTIVE_SIGNING_KEY_VERSION ?? '1',
  keysJson = process.env.AUDIT_SIGNING_KEYS_JSON,
  target = {
    host: process.env.DATABASE_TARGET_HOST,
    port: process.env.DATABASE_TARGET_PORT,
    database: process.env.DATABASE_TARGET_NAME,
    schema: process.env.DATABASE_TARGET_SCHEMA,
  },
  ClientConstructor = Client,
} = {}) {
  if (keysJson === undefined || keysJson === '') return { skipped: true, inserted: 0 };
  if (!connectionString || !migrationRole || !target) throw new Error('Audit key provisioning requires the migration connection and database target');
  const parsedUrl = verifyPostgresUrlTarget(connectionString, 'MIGRATION_DATABASE_URL', target);
  if (parsedUrl.username !== migrationRole || !parsedUrl.password) throw new Error('MIGRATION_DATABASE_URL does not use the configured migration role');

  let rawKeys;
  try { rawKeys = JSON.parse(keysJson); }
  catch { throw new Error('AUDIT_SIGNING_KEYS_JSON is invalid'); }
  if (!rawKeys || typeof rawKeys !== 'object' || Array.isArray(rawKeys)) throw new Error('AUDIT_SIGNING_KEYS_JSON must be a versioned key object');
  const keys = Object.entries(rawKeys).map(([version, hex]) => {
    if (!/^[1-9]\d{0,8}$/.test(version) || typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error('AUDIT_SIGNING_KEYS_JSON must map positive versions to 32-byte hexadecimal keys');
    }
    return { version: Number(version), material: Buffer.from(hex, 'hex') };
  }).sort((left, right) => left.version - right.version);
  if (!keys.length || !/^[1-9]\d{0,8}$/.test(String(activeVersion)) || !keys.some(({ version }) => version === Number(activeVersion))) {
    throw new Error('The active audit signing key version must exist in AUDIT_SIGNING_KEYS_JSON');
  }

  const client = new ClientConstructor({ connectionString, connectionTimeoutMillis: 5000, application_name: 'fee-audit-key-provisioner' });
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
      throw new Error('Audit key provisioner is not connected as the approved non-admin migration role and target');
    }
    await client.query('BEGIN');
    transaction = true;
    await client.query('SELECT pg_advisory_xact_lock_shared($1, $2)', [4605253, 1095058482]);
    await client.query('SET ROLE fee_audit_owner');
    let inserted = 0;
    for (const key of keys) {
      await client.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 741852963))`,
        [`audit-signing-key:${key.version}`],
      );
      const existing = await client.query(
        // The per-version transaction advisory lock above serializes this
        // immutable-key check. Avoid FOR UPDATE so the non-login audit owner
        // does not need UPDATE privileges on key material.
        'SELECT "keyMaterial" FROM public.audit_signing_keys WHERE "keyVersion" = $1',
        [key.version],
      );
      if (existing.rows.length) {
        const stored = existing.rows[0].keyMaterial;
        if (!Buffer.isBuffer(stored) || stored.length !== key.material.length || !timingSafeEqual(stored, key.material)) {
          throw new Error(`Audit signing key version ${key.version} already exists with different material; use a new version`);
        }
        continue;
      }
      await client.query(
        `INSERT INTO public.audit_signing_keys ("keyVersion", "keyMaterial", "notBefore", "notAfter", "retiredAt", "createdAt")
         VALUES ($1, $2, (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 seconds', NULL, NULL, pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')`,
        [key.version, key.material],
      );
      inserted += 1;
    }
    await client.query('RESET ROLE');
    await client.query('COMMIT');
    transaction = false;
    return { skipped: false, inserted, configured: keys.length };
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (connected) await client.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await provisionAuditSigningKeys();
    if (result.skipped) console.log('Audit signing-key provisioning skipped; no verifier keys are configured.');
    else console.log(`Audit signing-key provisioning completed (${result.inserted} new version${result.inserted === 1 ? '' : 's'}).`);
  } catch (error) {
    const code = error && typeof error === 'object' && typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? ` (${error.code})` : '';
    const message = error instanceof Error && !error.code ? error.message : 'database operation failed';
    console.error(`Audit signing-key provisioning failed${code}: ${message}`);
    process.exitCode = 1;
  }
}
