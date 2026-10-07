import { Client } from 'pg';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOOTSTRAP_LOCK = [4605254, 1095058483];
const OWNER_ROLES = Object.freeze(['fee_audit_owner', 'fee_lifecycle_owner', 'fee_numbering_owner']);
const NEON_PROVIDER_ROLES = Object.freeze(['neon_service', 'neon_superuser']);
const LOGIN_ROLE_KEYS = Object.freeze([
  ['MIGRATION_DATABASE_ROLE', 'MIGRATION_DATABASE_PASSWORD_URI_ENCODED'],
  ['RUNTIME_DATABASE_ROLE', 'RUNTIME_DATABASE_PASSWORD_URI_ENCODED'],
  ['BACKUP_DATABASE_ROLE', 'BACKUP_DATABASE_PASSWORD'],
]);

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const SCRAM_ITERATIONS = 4096;

function validateScramPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('SCRAM password must be non-empty text');
  }
  // Printable ASCII is unchanged by SASLprep, avoiding verifier mismatches and
  // canonicalization collisions between configured deployment credentials.
  if (!/^[\x20-\x7E]+$/.test(password)) {
    throw new Error('Database role passwords must contain only printable ASCII characters');
  }
}

export function createScramVerifier(password, { salt = randomBytes(16), iterations = SCRAM_ITERATIONS } = {}) {
  validateScramPassword(password);
  if (!Buffer.isBuffer(salt) || salt.length < 16) throw new Error('SCRAM salt must contain at least 16 random bytes');
  if (!Number.isInteger(iterations) || iterations < 4096 || iterations > 1_000_000) {
    throw new Error('SCRAM iteration count is outside the supported range');
  }
  const saltedPassword = pbkdf2Sync(Buffer.from(password, 'ascii'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

function decodeUriSecret(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} must be valid URI-encoded text`);
  }
}

function validateRoleName(value, label) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${label} must be a lowercase PostgreSQL role identifier`);
  }
  return value;
}

function buildProvisioningConfig(environment) {
  const target = {
    host: environment.DATABASE_TARGET_HOST,
    port: environment.DATABASE_TARGET_PORT,
    database: environment.DATABASE_TARGET_NAME,
    schema: environment.DATABASE_TARGET_SCHEMA,
  };
  const mode = environment.DATABASE_CLUSTER_MODE;
  if (!['bundled', 'managed'].includes(mode)) {
    throw new Error('DATABASE_CLUSTER_MODE must explicitly be bundled or managed');
  }
  if (!target.host || !/^[a-zA-Z0-9.-]+$/.test(target.host)
    || !target.port || !/^\d{1,5}$/.test(target.port) || Number(target.port) < 1 || Number(target.port) > 65535
    || !target.database || target.database.length > 63 || /[\u0000-\u001f]/.test(target.database)
    || target.schema !== 'public') {
    throw new Error('DATABASE_TARGET_* must identify a PostgreSQL database using the public schema');
  }
  if (!environment.POSTGRES_USER || !environment.POSTGRES_PASSWORD) {
    throw new Error('POSTGRES_USER and POSTGRES_PASSWORD are required for the one-shot bootstrap process');
  }
  const adminRole = validateRoleName(environment.POSTGRES_USER, 'POSTGRES_USER');
  const loginRoles = LOGIN_ROLE_KEYS.map(([roleKey, passwordKey]) => ({
    name: validateRoleName(environment[roleKey], roleKey),
    password: passwordKey.endsWith('_URI_ENCODED')
      ? decodeUriSecret(environment[passwordKey], passwordKey)
      : environment[passwordKey],
    roleKey,
  }));
  const names = [adminRole, ...loginRoles.map(({ name }) => name), ...OWNER_ROLES];
  if (new Set(names).size !== names.length) throw new Error('Bootstrap, login, and function-owner role names must all be distinct');
  const passwords = [environment.POSTGRES_PASSWORD, ...loginRoles.map(({ password }) => password)];
  if (passwords.some((password) => typeof password !== 'string' || password.length === 0)) {
    throw new Error('Bootstrap, migration, runtime, and backup passwords must be non-empty and distinct');
  }
  for (const password of passwords) validateScramPassword(password);
  if (new Set(passwords).size !== passwords.length) {
    throw new Error('Bootstrap, migration, runtime, and backup passwords must be non-empty and distinct');
  }
  return { adminRole, loginRoles, ownerRoles: [...OWNER_ROLES], target, mode };
}

export function validateProvisioningConfig(environment) {
  const config = buildProvisioningConfig(environment);
  return {
    mode: config.mode,
    adminRole: config.adminRole,
    loginRoles: config.loginRoles.map(({ name }) => name),
    ownerRoles: [...config.ownerRoles],
    target: { ...config.target },
  };
}

function ensureSafeExistingRoles(rows, config) {
  const roles = new Map(rows.map((row) => [row.rolname, row]));
  for (const { name } of config.loginRoles) {
    const role = roles.get(name);
    if (role && (!role.rolcanlogin || role.rolsuper || role.rolbypassrls || role.rolcreatedb
      || role.rolcreaterole || role.rolreplication || !role.rolinherit)) {
      throw new Error(`Existing login role ${name} has unsafe attributes; refusing implicit role repair`);
    }
  }
  for (const name of config.ownerRoles) {
    const role = roles.get(name);
    if (role && (role.rolcanlogin || role.rolsuper || role.rolbypassrls || role.rolcreatedb
      || role.rolcreaterole || role.rolreplication || role.rolinherit)) {
      throw new Error(`Existing owner role ${name} has unsafe attributes; refusing implicit role repair`);
    }
  }
}

async function validateExistingMemberships(client, config) {
  const expected = new Map(config.loginRoles.map(({ name }) => [name, new Set()]));
  const migrationName = config.loginRoles[0].name;
  expected.set(migrationName, new Set(config.ownerRoles));
  const { rows } = await client.query(
    `SELECT member.rolname AS member_name, granted.rolname AS granted_name,
       membership.admin_option, membership.inherit_option, membership.set_option
     FROM pg_auth_members AS membership
     JOIN pg_roles AS member ON member.oid = membership.member
     JOIN pg_roles AS granted ON granted.oid = membership.roleid
     WHERE member.rolname = ANY($1::text[])
       OR granted.rolname = ANY($2::text[])
       OR granted.rolname = ANY($1::text[])`,
    [[...expected.keys(), ...config.ownerRoles], config.ownerRoles],
  );
  const actualByMember = new Map([...expected.keys()].map((name) => [name, new Map()]));
  for (const row of rows) {
    if (expected.has(row.member_name)) {
      actualByMember.get(row.member_name).set(row.granted_name, row);
    }
    if (config.ownerRoles.includes(row.member_name)) {
      throw new Error(`Function-owner role ${row.member_name} has an unexpected membership`);
    }
    if (config.ownerRoles.includes(row.granted_name) && row.member_name !== migrationName) {
      throw new Error(`Function-owner role ${row.granted_name} has an unexpected member`);
    }
    if (expected.has(row.granted_name)) {
      throw new Error(`Login role ${row.granted_name} has an unexpected member role`);
    }
  }
  for (const [memberName, expectedRoles] of expected) {
    const actual = actualByMember.get(memberName);
    if ([...actual.keys()].some((name) => !expectedRoles.has(name))) {
      throw new Error(`Role ${memberName} has memberships outside the approved owner-role contract`);
    }
    for (const row of actual.values()) {
      if (row.admin_option || row.inherit_option || !row.set_option) {
        throw new Error(`Membership from ${memberName} to ${row.granted_name} has unsafe options`);
      }
    }
  }
}

async function ensureRoles(client, config) {
  const names = [...config.loginRoles.map(({ name }) => name), ...config.ownerRoles];
  const existing = await client.query(
    `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
       rolreplication, rolinherit
     FROM pg_roles WHERE rolname = ANY($1::text[])`,
    [names],
  );
  ensureSafeExistingRoles(existing.rows, config);
  await validateExistingMemberships(client, config);
  const existingNames = new Set(existing.rows.map((row) => row.rolname));

  for (const role of config.ownerRoles) {
    if (!existingNames.has(role)) {
      await client.query(`CREATE ROLE ${quoteIdentifier(role)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`);
    }
  }
  for (const { name, password } of config.loginRoles) {
    // Neon forwards role-password changes to its control plane, which accepts
    // plaintext input and generates the server-side verifier itself. This value
    // stays in memory and is never included in safe operation diagnostics.
    const credential = config.mode === 'managed' ? password : createScramVerifier(password);
    if (!existing.rows.some((row) => row.rolname === name)) {
      if (config.mode === 'managed') {
        await client.query(`CREATE ROLE ${quoteIdentifier(name)} WITH LOGIN PASSWORD ${quoteLiteral(credential)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT`);
      } else {
        await client.query(`CREATE ROLE ${quoteIdentifier(name)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT`);
        const sql = `ALTER ROLE ${quoteIdentifier(name)} WITH LOGIN PASSWORD ${quoteLiteral(credential)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT`;
        await client.query(sql);
      }
    } else if (config.mode === 'bundled') {
      const sql = `ALTER ROLE ${quoteIdentifier(name)} WITH LOGIN PASSWORD ${quoteLiteral(credential)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT`;
      await client.query(sql);
    }
  }
  const migration = quoteIdentifier(config.loginRoles[0].name);
  for (const owner of config.ownerRoles) {
    await client.query(`GRANT ${quoteIdentifier(owner)} TO ${migration} WITH INHERIT FALSE, SET TRUE`);
  }
}

async function ensureDatabaseAcl(client, config) {
  const { target, loginRoles, adminRole } = config;
  const targetId = quoteIdentifier(target.database);
  const [migration, runtime, backup] = loginRoles.map(({ name }) => quoteIdentifier(name));
  await client.query(`REVOKE CONNECT, TEMP ON DATABASE ${targetId} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${targetId} TO ${migration}, ${runtime}, ${backup}`);
  // Prisma's immutable baseline starts with CREATE SCHEMA IF NOT EXISTS public,
  // which PostgreSQL gates on database-level CREATE even when public exists.
  // This grant is deployment-only: database-roles-finalize revokes it before app
  // processes are allowed to start.
  await client.query(`REVOKE CREATE ON DATABASE ${targetId} FROM PUBLIC, ${runtime}, ${backup}`);
  await client.query(`GRANT CREATE ON DATABASE ${targetId} TO ${migration}`);

  if (config.mode === 'bundled') {
  const { rows: roles } = await client.query(
    `SELECT rolname FROM pg_roles
     WHERE NOT rolsuper AND rolname <> ALL($1::text[])
       AND rolname <> 'pg_database_owner'
       AND (has_database_privilege(oid, current_database(), 'CONNECT')
         OR has_database_privilege(oid, current_database(), 'TEMP'))`,
    [[adminRole, ...loginRoles.map(({ name }) => name)]],
  );
  for (const { rolname } of roles) {
    await client.query(`REVOKE CONNECT, TEMP ON DATABASE ${targetId} FROM ${quoteIdentifier(rolname)}`);
  }

  const { rows: databases } = await client.query(
    'SELECT datname FROM pg_database WHERE datname <> $1',
    [target.database],
  );
  const nonTargetRoleNames = loginRoles.map(({ name }) => name);
  const nonTargetGrantees = `PUBLIC, ${nonTargetRoleNames.map(quoteIdentifier).join(', ')}`;
  for (const { datname } of databases) {
    const databaseId = quoteIdentifier(datname);
    await client.query(`REVOKE CONNECT ON DATABASE ${databaseId} FROM ${nonTargetGrantees}`);
  }
  const { rows: access } = await client.query(
    `SELECT datname, role_name,
       has_database_privilege(role_grant.role_name::name, db.oid, 'CONNECT') AS can_connect
     FROM pg_database AS db
     CROSS JOIN unnest($1::text[]) AS role_grant(role_name)
     WHERE db.datname <> $2`,
    [nonTargetRoleNames, target.database],
  );
  if (access.some((row) => row.can_connect)) {
    throw new Error('An application login role retains effective CONNECT on a non-target database');
  }
  }

  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(`REVOKE CREATE ON SCHEMA public FROM ${runtime}, ${backup}`);
  await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${migration}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${runtime}, ${backup}`);
  for (const owner of config.ownerRoles) {
    await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(owner)}`);
  }
  const { rows: schemaCreators } = await client.query(
    `SELECT rolname FROM pg_roles
     WHERE NOT rolsuper AND rolname <> ALL($1::text[])
       AND rolname <> 'pg_database_owner'
       AND has_schema_privilege(oid, 'public', 'CREATE')`,
    [[adminRole, config.loginRoles[0].name]],
  );
  if (config.mode === 'bundled') {
    for (const { rolname } of schemaCreators) {
      await client.query(`REVOKE CREATE ON SCHEMA public FROM ${quoteIdentifier(rolname)}`);
    }
  } else if (schemaCreators.length) {
    throw new Error('Unexpected provider role has CREATE on the target public schema; review ACLs before bootstrap');
  }
  const createCheck = await client.query(
    `SELECT has_schema_privilege($1, 'public', 'CREATE') AS runtime_create,
       has_schema_privilege($2, 'public', 'CREATE') AS backup_create,
       has_schema_privilege($3, 'public', 'CREATE') AS migration_create`,
    [loginRoles[1].name, loginRoles[2].name, loginRoles[0].name],
  );
  if (createCheck.rows[0].runtime_create || createCheck.rows[0].backup_create || !createCheck.rows[0].migration_create) {
    throw new Error('Public schema CREATE privileges differ from the migration/runtime boundary');
  }

  const databaseCreateCheck = await client.query(
    `SELECT has_database_privilege($1, current_database(), 'CREATE') AS migration_create,
       has_database_privilege($2, current_database(), 'CREATE') AS runtime_create,
       has_database_privilege($3, current_database(), 'CREATE') AS backup_create,
       EXISTS (
         SELECT 1 FROM pg_database AS database
         CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) AS privilege
         WHERE database.datname = current_database() AND privilege.grantee = 0
           AND privilege.privilege_type = 'CREATE'
       ) AS public_create`,
    [loginRoles[0].name, loginRoles[1].name, loginRoles[2].name],
  );
  const databaseAcl = databaseCreateCheck.rows[0];
  if (!databaseAcl.migration_create || databaseAcl.runtime_create || databaseAcl.backup_create || databaseAcl.public_create) {
    throw new Error('Temporary database CREATE privilege differs from the migration bootstrap boundary');
  }
  const unexpectedDatabaseCreators = await client.query(
    `SELECT rolname FROM pg_roles
     WHERE NOT rolsuper AND rolname <> 'pg_database_owner'
       AND rolname <> ALL($1::text[])
       AND has_database_privilege(oid, current_database(), 'CREATE')`,
    [[adminRole, config.loginRoles[0].name, ...managedProviderRoles(config)]],
  );
  if (unexpectedDatabaseCreators.rows.length) {
    throw new Error('An unapproved non-admin role retains database CREATE');
  }

  const unexpected = await client.query(
    `SELECT rolname FROM pg_roles
     WHERE rolname <> ALL($1::text[])
       AND rolname <> $2
       AND has_database_privilege(oid, current_database(), 'CONNECT')
       AND NOT rolsuper`,
    [[...loginRoles.map(({ name }) => name), adminRole, ...managedProviderRoles(config)], adminRole],
  );
  if (unexpected.rows.some(({ rolname }) => !['pg_database_owner', 'pg_read_all_data', 'pg_write_all_data'].includes(rolname))) {
    throw new Error('An unapproved non-admin role has effective CONNECT on the target database');
  }
}

function buildFinalizationConfig(environment) {
  const target = {
    host: environment.DATABASE_TARGET_HOST,
    port: environment.DATABASE_TARGET_PORT,
    database: environment.DATABASE_TARGET_NAME,
    schema: environment.DATABASE_TARGET_SCHEMA,
  };
  const mode = environment.DATABASE_CLUSTER_MODE;
  if (!['bundled', 'managed'].includes(mode)) {
    throw new Error('DATABASE_CLUSTER_MODE must explicitly be bundled or managed');
  }
  if (!target.host || !/^[a-zA-Z0-9.-]+$/.test(target.host)
    || !target.port || !/^\d{1,5}$/.test(target.port) || Number(target.port) < 1 || Number(target.port) > 65535
    || !target.database || target.database.length > 63 || /[\u0000-\u001f]/.test(target.database)
    || target.schema !== 'public') {
    throw new Error('DATABASE_TARGET_* must identify a PostgreSQL database using the public schema');
  }
  if (!environment.POSTGRES_USER || !environment.POSTGRES_PASSWORD) {
    throw new Error('POSTGRES_USER and POSTGRES_PASSWORD are required for privilege finalization');
  }
  const adminRole = validateRoleName(environment.POSTGRES_USER, 'POSTGRES_USER');
  const loginRoles = ['MIGRATION_DATABASE_ROLE', 'RUNTIME_DATABASE_ROLE', 'BACKUP_DATABASE_ROLE']
    .map((key) => validateRoleName(environment[key], key));
  if (new Set([adminRole, ...loginRoles]).size !== loginRoles.length + 1) {
    throw new Error('Bootstrap and application database role names must all be distinct');
  }
  validateScramPassword(environment.POSTGRES_PASSWORD);
  return { adminRole, loginRoles, target, password: environment.POSTGRES_PASSWORD, mode };
}

export function validateFinalizationConfig(environment) {
  const config = buildFinalizationConfig(environment);
  return {
    mode: config.mode,
    adminRole: config.adminRole,
    loginRoles: [...config.loginRoles],
    target: { ...config.target },
  };
}

export function validateDatabaseAdminIdentity(identity, config, operation) {
  const matchesTarget = identity?.database_name === config.target.database
    && identity?.role_name === config.adminRole;
  if (!matchesTarget) {
    throw new Error(`${operation} connection identity does not match the configured database administrator and target`);
  }
  if (config.mode === 'bundled' && !identity.is_superuser) {
    throw new Error(`${operation} requires the configured bundled PostgreSQL superuser`);
  }
  if (config.mode === 'managed' && (identity.database_owner !== config.adminRole
    || !identity.can_create_role || !identity.can_create_database_objects || !identity.can_create_public_objects)) {
    throw new Error(`${operation} managed database administrator must own the target and have reviewed role/object creation capabilities`);
  }
}

function databaseAdminIdentityQuery() {
  return `SELECT current_database() AS database_name, current_user AS role_name,
    role.rolsuper AS is_superuser, role.rolcreaterole AS can_create_role,
    pg_get_userbyid(database.datdba) AS database_owner,
    has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public_objects
   FROM pg_roles AS role CROSS JOIN pg_database AS database
   WHERE role.rolname = current_user AND database.datname = current_database()`;
}

function managedSsl(config) {
  return config.mode === 'managed' ? { rejectUnauthorized: true } : undefined;
}

function managedProviderRoles(config) {
  return config.mode === 'managed' && config.target.host.toLowerCase().endsWith('.neon.tech')
    ? [...NEON_PROVIDER_ROLES]
    : [];
}

function trackSafeQueryOperation(client) {
  let operation = 'CONNECT';
  let firstFailedOperation = null;
  const query = client.query.bind(client);
  client.query = (statement, ...parameters) => {
    const sql = typeof statement === 'string' ? statement : statement?.text;
    const currentOperation = sql?.trim().match(/^[A-Za-z]+(?:\s+[A-Za-z]+)?/)?.[0]?.toUpperCase() ?? 'DATABASE QUERY';
    operation = currentOperation;
    return query(statement, ...parameters).catch((error) => {
      firstFailedOperation ??= currentOperation;
      throw error;
    });
  };
  return () => firstFailedOperation ?? operation;
}

export async function finalizeMigrationDatabasePrivileges({ environment = process.env, ClientConstructor = Client } = {}) {
  const config = buildFinalizationConfig(environment);
  const client = new ClientConstructor({
    host: config.target.host,
    port: Number(config.target.port),
    database: config.target.database,
    user: config.adminRole,
    password: config.password,
    ...(managedSsl(config) ? { ssl: managedSsl(config) } : {}),
    application_name: 'fee-database-role-finalizer',
    connectionTimeoutMillis: 5000,
  });
  const lastOperation = trackSafeQueryOperation(client);
  let connected = false;
  let transaction = false;
  try {
    await client.connect();
    connected = true;
    const identity = await client.query(databaseAdminIdentityQuery());
    validateDatabaseAdminIdentity(identity.rows[0], config, 'Finalizer');
    await client.query('BEGIN');
    transaction = true;
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', BOOTSTRAP_LOCK);
    const targetId = quoteIdentifier(config.target.database);
    const roleIds = config.loginRoles.map(quoteIdentifier).join(', ');
    await client.query(`REVOKE CREATE ON DATABASE ${targetId} FROM PUBLIC, ${roleIds}`);
    await client.query(`REVOKE USAGE ON SCHEMA app_private FROM ${quoteIdentifier(config.loginRoles[0])}`);
    await client.query('COMMIT');
    transaction = false;

    const verification = await client.query(
      `SELECT role_name,
         has_database_privilege(role_name::name, current_database(), 'CREATE') AS can_create
       FROM unnest($1::text[]) AS roles(role_name)`,
      [config.loginRoles],
    );
    const publicPrivilege = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_database AS database
         CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) AS privilege
         WHERE database.datname = current_database() AND privilege.grantee = 0
           AND privilege.privilege_type = 'CREATE'
       ) AS public_create`,
    );
    const unexpectedRoles = await client.query(
      `SELECT rolname FROM pg_roles
       WHERE NOT rolsuper AND rolname <> 'pg_database_owner'
         AND rolname <> ALL($1::text[])
         AND has_database_privilege(oid, current_database(), 'CREATE')`,
      [[config.adminRole, ...config.loginRoles, ...managedProviderRoles(config)]],
    );
    const privateSchema = await client.query(
      `SELECT has_schema_privilege($1, 'app_private', 'USAGE') AS migration_usage`,
      [config.loginRoles[0]],
    );
    if (verification.rows.some(({ can_create }) => can_create)
      || publicPrivilege.rows[0]?.public_create || unexpectedRoles.rows.length
      || privateSchema.rows[0]?.migration_usage) {
      throw new Error('Application login or PUBLIC retains temporary database/schema privileges after migration finalization');
    }
    return { database: config.target.database, loginRoles: config.loginRoles };
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    const safeCode = typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? ` (${error.code})` : '';
    if (error instanceof Error && !error.code) throw error;
    throw new Error(`Database privilege finalization failed during ${lastOperation()}${safeCode}`);
  } finally {
    if (connected) await client.end().catch(() => {});
  }
}

async function ensurePrivateCrypto(client, config) {
  const adminRole = quoteIdentifier(config.adminRole);
  const schema = await client.query(
    `SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'app_private'`,
  );
  if (!schema.rows.length) await client.query(`CREATE SCHEMA app_private AUTHORIZATION ${adminRole}`);
  else if (schema.rows[0].owner !== config.adminRole) throw new Error('Existing app_private schema has an incompatible owner');

  const extension = await client.query(
    `SELECT extension.extversion, extension.extowner::regrole::text AS owner,
       namespace.nspname AS schema_name, available.default_version
     FROM pg_extension AS extension
     JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
     LEFT JOIN pg_available_extensions AS available ON available.name = extension.extname
     WHERE extension.extname = 'pgcrypto'`,
  );
  if (!extension.rows.length) {
    await client.query('CREATE EXTENSION pgcrypto WITH SCHEMA app_private');
  } else {
    const current = extension.rows[0];
    if (current.schema_name !== 'app_private' || current.owner !== config.adminRole
      || !current.default_version || current.extversion !== current.default_version) {
      throw new Error('Existing pgcrypto installation differs from the approved private extension contract');
    }
  }
  const verified = await client.query(
    `SELECT extension.extversion, extension.extowner::regrole::text AS owner,
       namespace.nspname AS schema_name, available.default_version
     FROM pg_extension AS extension
     JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
     LEFT JOIN pg_available_extensions AS available ON available.name = extension.extname
     WHERE extension.extname = 'pgcrypto'`,
  );
  const current = verified.rows[0];
  if (!current || current.schema_name !== 'app_private' || current.owner !== config.adminRole
    || !current.default_version || current.extversion !== current.default_version) {
    throw new Error('pgcrypto could not be verified in the private extension schema');
  }

  const principals = [
    ...config.loginRoles.map(({ name }) => name),
    ...config.ownerRoles,
  ];
  const roleSql = principals.map(quoteIdentifier).join(', ');
  await client.query(`REVOKE ALL ON SCHEMA app_private FROM PUBLIC${roleSql ? `, ${roleSql}` : ''}`);
  await client.query('GRANT USAGE, CREATE ON SCHEMA app_private TO fee_audit_owner');
  await client.query('GRANT USAGE, CREATE ON SCHEMA app_private TO fee_numbering_owner');
  await client.query(`GRANT USAGE ON SCHEMA app_private TO ${quoteIdentifier(config.loginRoles[0].name)}`);
  await client.query(`GRANT USAGE ON SCHEMA app_private TO ${quoteIdentifier(config.loginRoles[1].name)}`);
  await client.query('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC');
  if (roleSql) await client.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM ${roleSql}`);
  await client.query('GRANT EXECUTE ON FUNCTION app_private.digest(bytea, text), app_private.hmac(bytea, bytea, text) TO fee_audit_owner');

  const schemaAcl = await client.query(
    `SELECT has_schema_privilege('fee_audit_owner', 'app_private', 'USAGE') AS audit_usage,
       has_schema_privilege('fee_audit_owner', 'app_private', 'CREATE') AS audit_create,
       has_schema_privilege('fee_numbering_owner', 'app_private', 'USAGE') AS numbering_usage,
       has_schema_privilege('fee_numbering_owner', 'app_private', 'CREATE') AS numbering_create,
       has_schema_privilege($1, 'app_private', 'USAGE') AS migration_usage,
       has_schema_privilege($2, 'app_private', 'USAGE') AS runtime_usage,
       has_schema_privilege($2, 'app_private', 'CREATE') AS runtime_create,
       has_schema_privilege($3, 'app_private', 'USAGE') AS backup_usage,
       EXISTS (
         SELECT 1 FROM pg_namespace AS namespace
         CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS privilege
         WHERE namespace.nspname = 'app_private' AND privilege.grantee = 0
           AND privilege.privilege_type IN ('USAGE', 'CREATE')
       ) AS public_schema_privilege`,
    config.loginRoles.map(({ name }) => name),
  );
  const acl = schemaAcl.rows[0];
  if (!acl.audit_usage || !acl.audit_create || !acl.numbering_usage || !acl.numbering_create
    || !acl.migration_usage || !acl.runtime_usage || acl.runtime_create || acl.backup_usage || acl.public_schema_privilege) {
    throw new Error('Private extension schema privileges differ from the temporary migration/runtime boundary');
  }
}

export async function provisionDatabaseRoles({ environment = process.env, ClientConstructor = Client } = {}) {
  const config = buildProvisioningConfig(environment);
  const client = new ClientConstructor({
    host: config.target.host,
    port: Number(config.target.port),
    database: config.target.database,
    user: config.adminRole,
    password: environment.POSTGRES_PASSWORD,
    ...(managedSsl(config) ? { ssl: managedSsl(config) } : {}),
    application_name: 'fee-database-role-bootstrap',
    connectionTimeoutMillis: 5000,
  });
  const lastOperation = trackSafeQueryOperation(client);
  let connected = false;
  let transaction = false;
  try {
    await client.connect();
    connected = true;
    const identity = await client.query(databaseAdminIdentityQuery());
    validateDatabaseAdminIdentity(identity.rows[0], config, 'Bootstrap');
    await client.query('BEGIN');
    transaction = true;
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', BOOTSTRAP_LOCK);
    await ensureRoles(client, config);
    await ensureDatabaseAcl(client, config);
    await ensurePrivateCrypto(client, config);
    await client.query('COMMIT');
    transaction = false;
    return { database: config.target.database, loginRoles: config.loginRoles.map(({ name }) => name) };
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    // Never emit a driver message here: it can contain connection details.
    const safeCode = typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? ` (${error.code})` : '';
    if (error instanceof Error && !error.code) throw error;
    throw new Error(`Database role provisioning failed during ${lastOperation()}${safeCode}`);
  } finally {
    if (connected) await client.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--finalize') {
      if (process.argv.length !== 3) throw new Error('Finalizer accepts only the --finalize option');
      const result = await finalizeMigrationDatabasePrivileges();
      console.log(`Temporary database CREATE privilege revoked for ${result.database}`);
    } else {
      if (process.argv.length !== 2) throw new Error('Use --finalize or run the database role bootstrap with no options');
      const result = await provisionDatabaseRoles();
      console.log(`Database roles provisioned for ${result.database}: ${result.loginRoles.join(', ')}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database role provisioning failed');
    process.exitCode = 1;
  }
}
