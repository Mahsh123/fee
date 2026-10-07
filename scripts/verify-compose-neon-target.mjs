import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

function serviceEnvironment(service) {
  const entries = service?.environment;
  if (Array.isArray(entries)) {
    return Object.fromEntries(entries.map((entry) => {
      const separator = entry.indexOf('=');
      return separator < 0 ? [entry, undefined] : [entry.slice(0, separator), entry.slice(separator + 1)];
    }));
  }
  return entries && typeof entries === 'object' ? entries : {};
}

function required(environment, key, serviceName) {
  const value = environment[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Compose service ${serviceName} is missing ${key}`);
  }
  return value;
}

function postgresUrl(value, label, endpoint) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid PostgreSQL URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${label} must use PostgreSQL`);
  const queryKeys = [...url.searchParams.keys()];
  const allowed = new Set(['schema', 'sslmode', 'channel_binding']);
  if (queryKeys.some((key) => !allowed.has(key)) || new Set(queryKeys).size !== queryKeys.length) {
    throw new Error(`${label} contains unsupported or duplicate query parameters`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.endsWith('.neon.tech')) throw new Error(`${label} must use the configured Neon PostgreSQL project`);
  if (url.searchParams.get('sslmode') !== 'verify-full' || url.searchParams.get('channel_binding') !== 'require') {
    throw new Error(`${label} must require verified TLS and channel binding`);
  }
  if (endpoint === 'pooled' && !host.includes('-pooler.')) throw new Error(`${label} must use Neon's pooled endpoint`);
  if (endpoint === 'direct' && host.includes('-pooler.')) throw new Error(`${label} must use Neon's direct endpoint`);
  const schema = url.searchParams.get('schema') ?? 'public';
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!url.username || !url.password || !database || schema !== 'public') {
    throw new Error(`${label} must include credentials, a database, and the supported public schema`);
  }
  return {
    host,
    port: url.port || '5432',
    database,
    schema,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function directNeonHost(host) {
  const labels = host.split('.');
  labels[0] = labels[0].replace(/-pooler$/, '');
  if (/^c-\d+$/.test(labels[1] ?? '')) labels.splice(1, 1);
  return labels.join('.');
}

function dependency(service, name) {
  const value = service?.depends_on;
  if (Array.isArray(value)) return value.includes(name);
  return Boolean(value && typeof value === 'object' && value[name]);
}

function dependencyCondition(service, name) {
  const value = service?.depends_on;
  if (Array.isArray(value)) return value.includes(name) ? 'service_started' : undefined;
  return value?.[name]?.condition;
}

function dependencyRestart(service, name) {
  const value = service?.depends_on;
  if (!value || Array.isArray(value)) return false;
  return value[name]?.restart;
}

function assertNoDatabaseCredential(environment, serviceName) {
  const blocked = [
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'PLATFORM_BOOTSTRAP_DATABASE_URL',
    'MIGRATION_DATABASE_PASSWORD_URI_ENCODED',
    'RUNTIME_DATABASE_PASSWORD_URI_ENCODED',
    'BACKUP_DATABASE_PASSWORD',
    'POSTGRES_PASSWORD',
  ];
  if (blocked.some((key) => environment[key])) {
    throw new Error(`${serviceName} environment contains a database URL or credential it must not receive`);
  }
}

function assertNoDevelopmentSeedCredential(environment, serviceName) {
  const blocked = ['SEED_DEMO_EMAIL', 'SEED_SCHOOL_EMAIL', 'SEED_ACADEMY_EMAIL', 'SEED_GYM_EMAIL', 'SEED_DEMO_PASSWORD', 'SEED_DEVELOPMENT_TENANTS'];
  if (blocked.some((key) => Object.hasOwn(environment, key))) {
    throw new Error(`${serviceName} environment contains development-only tenant seed configuration`);
  }
}

function assertRuntimeOnlyApiCredentials(environment) {
  const blocked = [
    'MIGRATION_DATABASE_URL',
    'PLATFORM_BOOTSTRAP_DATABASE_URL',
    'MIGRATION_DATABASE_ROLE',
    'BACKUP_DATABASE_ROLE',
    'BACKUP_DATABASE_PASSWORD',
    'MIGRATION_DATABASE_PASSWORD_URI_ENCODED',
    'RUNTIME_DATABASE_PASSWORD_URI_ENCODED',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGSSLMODE',
    'PGCHANNELBINDING',
  ];
  if (blocked.some((key) => Object.hasOwn(environment, key))) {
    throw new Error('API environment contains migration, owner, backup, or bundled database credentials');
  }
}

export function verifyComposeNeonTarget(config) {
  const services = config.services ?? {};
  const forbiddenServices = ['postgres', 'database-roles', 'database-roles-finalize'];
  if (forbiddenServices.some((name) => services[name])) {
    throw new Error('Compose must not create a database server or provision Neon roles');
  }
  if (config.volumes?.['postgres-data']) throw new Error('Compose must not retain a bundled PostgreSQL data volume');
  if (!services.redis || !services.api || !services.worker || !services.web || !services.nginx) {
    throw new Error('Compose must define Redis, API, web, worker, and Nginx services');
  }

  for (const [serviceName, service] of Object.entries(services)) {
    const environment = serviceEnvironment(service);
    if (Object.keys(environment).some((key) => key.startsWith('POSTGRES_') || key === 'DATABASE_CLUSTER_MODE')) {
      throw new Error(`Compose service ${serviceName} contains a bundled PostgreSQL setting`);
    }
  }

  const api = serviceEnvironment(services.api);
  const worker = serviceEnvironment(services.worker);
  const web = serviceEnvironment(services.web);
  const platformSubdomain = (api.PLATFORM_SUBDOMAIN ?? 'platform').toLowerCase();
  const publicPlatformSubdomain = (web.NEXT_PUBLIC_PLATFORM_SUBDOMAIN ?? 'platform').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(platformSubdomain)
    || publicPlatformSubdomain !== platformSubdomain) {
    throw new Error('API PLATFORM_SUBDOMAIN and web NEXT_PUBLIC_PLATFORM_SUBDOMAIN must be the same valid DNS label');
  }
  const publicApiBase = required(web, 'NEXT_PUBLIC_API_BASE_URL', 'web');
  let publicApiUrl;
  try { publicApiUrl = new URL(publicApiBase); } catch { throw new Error('Web API base URL must be a valid browser-accessible URL'); }
  if (!['http:', 'https:'].includes(publicApiUrl.protocol)
    || (publicApiUrl.protocol === 'http:' && publicApiUrl.hostname !== `${platformSubdomain}.localhost`)
    || (publicApiUrl.protocol === 'https:' && !publicApiUrl.hostname.startsWith(`${platformSubdomain}.`))) {
    throw new Error('Web API base URL must use the configured platform hostname through the reverse proxy');
  }
  const webAppUrl = new URL(required(api, 'WEB_APP_URL', 'api'));
  const corsOrigins = required(api, 'CORS_ORIGINS', 'api').split(',').map((origin) => origin.trim());
  if (webAppUrl.origin !== publicApiUrl.origin || !corsOrigins.includes(webAppUrl.origin)) {
    throw new Error('WEB_APP_URL, CORS_ORIGINS, and NEXT_PUBLIC_API_BASE_URL must use the same platform origin');
  }
  assertRuntimeOnlyApiCredentials(api);
  for (const [serviceName, service] of Object.entries(services)) {
    if (serviceName !== 'development-seed') {
      assertNoDevelopmentSeedCredential(serviceEnvironment(service), serviceName);
    }
  }
  const runtimeUrl = postgresUrl(required(api, 'DATABASE_URL', 'api'), 'API DATABASE_URL', 'pooled');
  if (runtimeUrl.username !== 'fee_runtime') throw new Error('API DATABASE_URL must use the fee_runtime role');
  assertNoDatabaseCredential(worker, 'Worker');
  assertNoDatabaseCredential(serviceEnvironment(services.web), 'Web');

  if (!dependency(services.api, 'redis') || dependencyCondition(services.api, 'redis') !== 'service_healthy'
    || !dependency(services.worker, 'redis') || dependencyCondition(services.worker, 'redis') !== 'service_healthy') {
    throw new Error('API and worker must wait for the local Redis health check');
  }

  const migrationService = services.migration;
  const bootstrapService = services['platform-bootstrap'];
  const backupService = services.backup;
  const developmentSeedService = services['development-seed'];
  const managedDeployment = Boolean(migrationService || bootstrapService || backupService);
  if (!managedDeployment) {
    for (const serviceName of ['redis', 'development-seed', 'api', 'worker', 'web', 'nginx']) {
      if (services[serviceName]?.profiles?.length) {
        throw new Error(`Development service ${serviceName} must start with plain docker compose up`);
      }
    }
    if (!developmentSeedService) throw new Error('Local Neon Compose must seed development tenants before starting the API');
    for (const serviceName of ['development-seed', 'api', 'worker']) {
      if (services[serviceName].build?.target !== 'runtime') {
        throw new Error(`Development service ${serviceName} must use the tooling-enabled runtime image`);
      }
    }
    if (services.web.build?.target !== 'development'
      || !services.web.develop?.watch?.some((entry) => entry.action === 'sync')) {
      throw new Error('Development web must use the Next dev server with source watch sync');
    }
    if (serviceEnvironment(services.api).NODE_ENV !== 'development'
      || serviceEnvironment(services.worker).NODE_ENV !== 'development') {
      throw new Error('The local API and worker must run in development mode');
    }
    const developmentSeed = serviceEnvironment(developmentSeedService);
    const developmentSeedUrl = postgresUrl(required(developmentSeed, 'DATABASE_URL', 'development-seed'), 'DEVELOPMENT_SEED DATABASE_URL', 'pooled');
    if (developmentSeed.NODE_ENV !== 'development' || developmentSeed.SEED_DEVELOPMENT_TENANTS !== 'true'
      || developmentSeedUrl.username !== runtimeUrl.username || developmentSeedUrl.password !== runtimeUrl.password
      || developmentSeedUrl.host !== runtimeUrl.host || developmentSeedUrl.port !== runtimeUrl.port
      || developmentSeedUrl.database !== runtimeUrl.database || developmentSeedUrl.schema !== runtimeUrl.schema) {
      throw new Error('Development seed must use the same restricted Neon runtime target and run only in development mode');
    }
    const allowedSeedEnvironment = new Set([
      'NODE_ENV', 'DATABASE_URL', 'SEED_DEVELOPMENT_TENANTS', 'SEED_DEMO_EMAIL', 'SEED_SCHOOL_EMAIL',
      'SEED_ACADEMY_EMAIL', 'SEED_GYM_EMAIL', 'SEED_DEMO_PASSWORD',
    ]);
    if (Object.keys(developmentSeed).some((key) => !allowedSeedEnvironment.has(key))) {
      throw new Error('Development seed environment contains unapproved configuration or deployment credentials');
    }
    if (!dependency(developmentSeedService, 'api')
      || dependencyCondition(developmentSeedService, 'api') !== 'service_healthy') {
      throw new Error('Development seed must wait until the API confirms Neon readiness');
    }
    if (dependency(services.api, 'development-seed')) {
      throw new Error('API must start before the runtime development tenant seed');
    }
    if (!dependency(services.nginx, 'development-seed')
      || dependencyCondition(services.nginx, 'development-seed') !== 'service_completed_successfully') {
      throw new Error('Development proxy must wait for the tenant seed to finish');
    }
    const apiHealthCheck = [services.api.healthcheck?.test].flat(2).join(' ');
    const webHealthCheck = [services.web.healthcheck?.test].flat(2).join(' ');
    const nginxHealthCheck = [services.nginx.healthcheck?.test].flat(2).join(' ');
    if (!apiHealthCheck.includes('/health/ready') || !apiHealthCheck.includes('JSON.parse(b).data.status')
      || !webHealthCheck.includes(':3000/')) {
      throw new Error('API and web services must have working container health checks');
    }
    if (!nginxHealthCheck.includes('/healthz') || !nginxHealthCheck.includes('/api/v1/tenant-context')
      || !nginxHealthCheck.includes(`Host: ${platformSubdomain}.localhost`)) {
      throw new Error('Nginx health check must verify the platform UI and tenant-context API through the proxy');
    }
    for (const serviceName of ['api', 'web']) {
      if (dependencyRestart(services.nginx, serviceName) !== true) {
        throw new Error(`Development Nginx must restart when the ${serviceName} container is recreated`);
      }
    }
    for (const serviceName of ['api', 'worker', 'web']) {
      if (services[serviceName].ports?.length) throw new Error(`${serviceName} must not publish a duplicate host port`);
    }
    if (!services.api.expose?.map(String).includes('4000') || !services.web.expose?.map(String).includes('3000')) {
      throw new Error('API and web must expose their expected container ports behind Nginx');
    }
    const hostPorts = new Map();
    for (const [serviceName, service] of Object.entries(services)) {
      for (const port of service.ports ?? []) {
        const hostPort = typeof port === 'object' ? String(port.published ?? '')
          : String(port).split(':').slice(-2, -1)[0] ?? '';
        if (!hostPort) continue;
        if (hostPorts.has(hostPort)) throw new Error(`Host port ${hostPort} is shared by ${hostPorts.get(hostPort)} and ${serviceName}`);
        hostPorts.set(hostPort, serviceName);
      }
    }
    if (serviceEnvironment(services.api).REDIS_URL !== 'redis://redis:6379'
      || worker.REDIS_URL !== 'redis://redis:6379') {
      throw new Error('Container services must reach Redis through the Compose service name');
    }
    const developmentSeedCommand = [developmentSeedService.entrypoint, developmentSeedService.command].flat().filter(Boolean).join(' ');
    if (!developmentSeedCommand.includes('seed-development-tenants.ts')) {
      throw new Error('Development Compose must run the idempotent tenant seeder before API startup');
    }
    const devProxyConfig = resolve('infrastructure/nginx/nginx.dev.conf');
    const devProxyMounted = (services.nginx.volumes ?? []).some((volume) => {
      if (typeof volume === 'string') return volume.startsWith('./infrastructure/nginx/nginx.dev.conf:/etc/nginx/nginx.conf:ro');
      return volume?.target === '/etc/nginx/nginx.conf' && volume?.read_only === true
        && typeof volume?.source === 'string' && resolve(volume.source) === devProxyConfig;
    });
    if (!devProxyMounted || services.nginx.command) {
      throw new Error('Development Nginx must use the host-preserving plain-HTTP config without command overrides');
    }
    return { target: { host: runtimeUrl.host, port: runtimeUrl.port, database: runtimeUrl.database, schema: runtimeUrl.schema }, runtimeRole: runtimeUrl.username };
  }
  if (developmentSeedService) throw new Error('Production Neon Compose must not run the development tenant seeder');
  if (!migrationService || !bootstrapService || !backupService) {
    throw new Error('Managed Neon Compose must define migration, one-shot bootstrap, and encrypted backup services together');
  }

  const migration = serviceEnvironment(migrationService);
  const bootstrap = serviceEnvironment(bootstrapService);
  const backup = serviceEnvironment(backupService);
  const operationsImage = required(migrationService, 'image', 'migration');
  if (required(bootstrapService, 'image', 'platform-bootstrap') !== operationsImage
    || operationsImage === services.api.image || operationsImage === services.worker.image) {
    throw new Error('Migration and bootstrap must use the separate full-tooling operations image');
  }
  const migrationUrl = postgresUrl(required(migration, 'MIGRATION_DATABASE_URL', 'migration'), 'MIGRATION_DATABASE_URL', 'direct');
  if (migrationUrl.username !== required(migration, 'MIGRATION_DATABASE_ROLE', 'migration')
    || migrationUrl.username !== 'fee_migrator') {
    throw new Error('Migration URL must use the configured fee_migrator role');
  }
  if (migration.DATABASE_URL || migration.PLATFORM_BOOTSTRAP_DATABASE_URL || migration.BACKUP_DATABASE_PASSWORD
    || migration.POSTGRES_USER || migration.POSTGRES_PASSWORD
    || migration.MIGRATION_DATABASE_PASSWORD_URI_ENCODED || migration.RUNTIME_DATABASE_PASSWORD_URI_ENCODED) {
    throw new Error('Migration service contains an owner, runtime, or bundled database credential');
  }

  const target = {
    host: required(migration, 'DATABASE_TARGET_HOST', 'migration').toLowerCase().replace(/\.$/, ''),
    port: required(migration, 'DATABASE_TARGET_PORT', 'migration'),
    database: required(migration, 'DATABASE_TARGET_NAME', 'migration'),
    schema: required(migration, 'DATABASE_TARGET_SCHEMA', 'migration'),
  };
  if (target.schema !== 'public' || migrationUrl.host !== target.host || migrationUrl.port !== target.port
    || migrationUrl.database !== target.database || runtimeUrl.database !== target.database
    || runtimeUrl.schema !== target.schema || runtimeUrl.port !== target.port
    || directNeonHost(runtimeUrl.host) !== target.host) {
    throw new Error('Runtime and migration URLs must identify the same Neon database endpoint and public schema');
  }
  if (required(migration, 'RUNTIME_DATABASE_ROLE', 'migration') !== runtimeUrl.username
    || required(migration, 'BACKUP_DATABASE_ROLE', 'migration') !== required(backup, 'PGUSER', 'backup')) {
    throw new Error('Migration ACL metadata must match the runtime and backup roles');
  }

  const bootstrapUrl = postgresUrl(required(bootstrap, 'PLATFORM_BOOTSTRAP_DATABASE_URL', 'platform-bootstrap'), 'PLATFORM_BOOTSTRAP_DATABASE_URL', 'direct');
  if (bootstrapUrl.host !== target.host || bootstrapUrl.port !== target.port || bootstrapUrl.database !== target.database
    || bootstrapUrl.username === runtimeUrl.username || bootstrapUrl.username === migrationUrl.username
    || bootstrapUrl.username === backup.PGUSER) {
    throw new Error('Platform bootstrap URL must use a separate owner login on the same direct Neon target');
  }
  if (bootstrap.DATABASE_URL || bootstrap.MIGRATION_DATABASE_URL || bootstrap.RUNTIME_DATABASE_ROLE
    || bootstrap.MIGRATION_DATABASE_ROLE || bootstrap.BACKUP_DATABASE_ROLE) {
    throw new Error('Platform bootstrap environment contains application or migration database credentials');
  }

  if (required(backup, 'PGHOST', 'backup').toLowerCase().replace(/\.$/, '') !== target.host
    || required(backup, 'PGPORT', 'backup') !== target.port
    || required(backup, 'PGDATABASE', 'backup') !== target.database
    || backup.PGSSLMODE !== 'verify-full' || backup.PGCHANNELBINDING !== 'require'
    || !required(backup, 'BACKUP_AGE_RECIPIENT', 'backup')) {
    throw new Error('Encrypted backup must use the direct Neon target with verified TLS and the separate read-only role');
  }
  if ([runtimeUrl.password, migrationUrl.password, bootstrapUrl.password].includes(required(backup, 'PGPASSWORD', 'backup'))
    || runtimeUrl.password === migrationUrl.password || runtimeUrl.password === bootstrapUrl.password
    || migrationUrl.password === bootstrapUrl.password) {
    throw new Error('Runtime, migration, owner, and backup credentials must all be distinct');
  }

  if (!dependency(bootstrapService, 'migration') || dependencyCondition(bootstrapService, 'migration') !== 'service_completed_successfully'
    || !dependency(services.api, 'migration') || dependencyCondition(services.api, 'migration') !== 'service_completed_successfully'
    || !dependency(services.api, 'platform-bootstrap') || dependencyCondition(services.api, 'platform-bootstrap') !== 'service_completed_successfully'
    || !dependency(backupService, 'migration') || dependencyCondition(backupService, 'migration') !== 'service_completed_successfully') {
    throw new Error('Migration must complete before bootstrap, API, and backup services start');
  }

  const migrationCommand = [migrationService.entrypoint, migrationService.command].flat().filter(Boolean).join(' ');
  const bootstrapCommand = [bootstrapService.entrypoint, bootstrapService.command].flat().filter(Boolean).join(' ');
  const backupCommand = [backupService.entrypoint, backupService.command].flat().filter(Boolean).join(' ');
  if (!migrationCommand.includes('deploy-staged-migrations') || !bootstrapCommand.includes('db:seed')
    || !backupCommand.includes('backup-encrypted.sh')) {
    throw new Error('Neon migration, one-shot seed, and encrypted backup commands must be configured');
  }

  return { target, runtimeRole: runtimeUrl.username, migrationRole: migrationUrl.username, backupRole: backup.PGUSER };
}

export function verifyComposeFile({ composeFile, envFiles, profile }) {
  if (!composeFile || !Array.isArray(envFiles) || envFiles.length === 0) {
    throw new Error('Compose file and at least one env file are required');
  }
  const args = ['compose'];
  if (profile) args.push('--profile', profile);
  for (const envFile of envFiles) args.push('--env-file', resolve(envFile));
  args.push('-f', resolve(composeFile), 'config', '--format', 'json');
  const dockerConfig = mkdtempSync(resolve(tmpdir(), 'fee-compose-neon-config-'));
  let output;
  try {
    output = execFileSync('docker', ['--config', dockerConfig, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? error.status : 'unknown';
    throw new Error(`Unable to render the Compose configuration (exit ${status})`);
  } finally {
    rmSync(dockerConfig, { recursive: true, force: true });
  }
  return verifyComposeNeonTarget(JSON.parse(output));
}

function summary(label, result) {
  const roles = [result.runtimeRole, result.migrationRole, result.backupRole].filter(Boolean).join(', ');
  return `${label} Neon Compose verified: ${result.target.host}:${result.target.port}/${result.target.database}?schema=${result.target.schema}; roles ${roles}.`;
}

async function main() {
  const args = process.argv.slice(2);
  const options = { envFiles: [] };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!['--env-file', '--compose-file', '--profile'].includes(key) || !args[index + 1]) {
      throw new Error('Use --env-file PATH [--env-file PATH ...] --compose-file PATH [--profile NAME]');
    }
    if (key === '--env-file') options.envFiles.push(args[index + 1]);
    else if (key === '--compose-file') options.composeFile = args[index + 1];
    else options.profile = args[index + 1];
    index += 1;
  }

  if (options.composeFile || options.envFiles.length) {
    const result = verifyComposeFile(options);
    console.log(summary('Compose', result));
    return;
  }

  const configs = [
    ['development', { envFiles: ['.env.example', '.env.neon.example'], composeFile: 'docker-compose.yml' }],
    ['production', { envFiles: ['.env.production.example'], composeFile: 'docker-compose.prod.yml' }],
  ];
  for (const [label, config] of configs) console.log(summary(label, verifyComposeFile(config)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
