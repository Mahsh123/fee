import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { verifyComposeFile, verifyComposeNeonTarget } from './verify-compose-neon-target.mjs';

const directHost = 'ep-sample.ap-southeast-1.aws.neon.tech';
const pooledHost = 'ep-sample-pooler.c-4.ap-southeast-1.aws.neon.tech';
const runtimeUrl = `postgresql://fee_runtime:runtime-pass@${pooledHost}/neondb?sslmode=verify-full&channel_binding=require`;
const migrationUrl = `postgresql://fee_migrator:migration-pass@${directHost}/neondb?sslmode=verify-full&channel_binding=require`;
const ownerUrl = `postgresql://neondb_owner:owner-pass@${directHost}/neondb?sslmode=verify-full&channel_binding=require`;

function developmentConfig(platformSubdomain = 'platform') {
  return {
    services: {
      redis: { healthcheck: {} },
      'development-seed': {
        build: { target: 'runtime' },
        environment: { NODE_ENV: 'development', DATABASE_URL: runtimeUrl, SEED_DEVELOPMENT_TENANTS: 'true' },
        depends_on: { api: { condition: 'service_healthy' } },
        command: ['node', 'node_modules/tsx/dist/cli.mjs', 'scripts/seed-development-tenants.ts'],
      },
      api: {
        build: { target: 'runtime' },
        environment: {
          NODE_ENV: 'development', DATABASE_URL: runtimeUrl, REDIS_URL: 'redis://redis:6379', PLATFORM_SUBDOMAIN: platformSubdomain,
          WEB_APP_URL: `http://${platformSubdomain}.localhost:8080`, CORS_ORIGINS: `http://${platformSubdomain}.localhost:8080`,
        },
        expose: ['4000'],
        depends_on: {
          redis: { condition: 'service_healthy' },
        },
        healthcheck: { test: ['CMD', 'node', '-e', "require('http').get('http://127.0.0.1:4000/health/ready',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{process.exit(r.statusCode===200&&JSON.parse(b).data.status==='ready'?0:1)}catch{process.exit(1)}})}).on('error',()=>process.exit(1))"] },
      },
      worker: {
        build: { target: 'runtime' },
        environment: { NODE_ENV: 'development', REDIS_URL: 'redis://redis:6379' },
        depends_on: { redis: { condition: 'service_healthy' } },
      },
      web: { build: { target: 'development' }, environment: { NEXT_PUBLIC_API_BASE_URL: `http://${platformSubdomain}.localhost:8080/api/v1`, NEXT_PUBLIC_PLATFORM_SUBDOMAIN: platformSubdomain }, expose: ['3000'], healthcheck: { test: ['CMD', 'node', '-e', 'http://localhost:3000/'] }, develop: { watch: [{ action: 'sync' }] } },
      nginx: {
        volumes: ['./infrastructure/nginx/nginx.dev.conf:/etc/nginx/nginx.conf:ro'],
        depends_on: {
          api: { condition: 'service_healthy', restart: true },
          web: { condition: 'service_healthy', restart: true },
          'development-seed': { condition: 'service_completed_successfully' },
        },
        healthcheck: { test: ['CMD-SHELL', `wget /healthz && wget --header='Host: ${platformSubdomain}.localhost' http://127.0.0.1/ && wget --header='Host: ${platformSubdomain}.localhost' http://127.0.0.1/api/v1/tenant-context`] },
      },
    },
  };
}

function productionConfig() {
  const config = developmentConfig();
  delete config.services['development-seed'];
  config.services.migration = {
    image: 'fee-platform/operations:latest',
    environment: {
      MIGRATION_DATABASE_URL: migrationUrl,
      MIGRATION_DATABASE_ROLE: 'fee_migrator',
      RUNTIME_DATABASE_ROLE: 'fee_runtime',
      BACKUP_DATABASE_ROLE: 'fee_backup',
      DATABASE_TARGET_HOST: directHost,
      DATABASE_TARGET_PORT: '5432',
      DATABASE_TARGET_NAME: 'neondb',
      DATABASE_TARGET_SCHEMA: 'public',
    },
    command: ['node', 'scripts/deploy-staged-migrations.mjs'],
  };
  config.services['platform-bootstrap'] = {
    image: 'fee-platform/operations:latest',
    environment: { PLATFORM_BOOTSTRAP_DATABASE_URL: ownerUrl, SEED_PLATFORM_ADMIN_EMAIL: 'admin@example.com' },
    depends_on: { migration: { condition: 'service_completed_successfully' } },
    command: ['npm', 'run', 'db:seed'],
  };
  config.services.api.image = 'fee-platform/api:latest';
  config.services.worker.image = 'fee-platform/worker:latest';
  config.services.api.environment.WEB_APP_URL = 'https://platform.example.com';
  config.services.api.environment.CORS_ORIGINS = 'https://platform.example.com';
  config.services.web.environment.NEXT_PUBLIC_API_BASE_URL = 'https://platform.example.com/api/v1';
  config.services.api.depends_on = {
    redis: { condition: 'service_healthy' },
    migration: { condition: 'service_completed_successfully' },
    'platform-bootstrap': { condition: 'service_completed_successfully' },
  };
  config.services.backup = {
    environment: {
      PGHOST: directHost,
      PGPORT: '5432',
      PGUSER: 'fee_backup',
      PGPASSWORD: 'backup-pass',
      PGDATABASE: 'neondb',
      PGSSLMODE: 'verify-full',
      PGCHANNELBINDING: 'require',
      BACKUP_AGE_RECIPIENT: 'age1example',
    },
    depends_on: { migration: { condition: 'service_completed_successfully' } },
    entrypoint: ['/usr/local/bin/backup-encrypted.sh'],
  };
  return config;
}

test('accepts the Neon-backed development Compose stack without a database container', () => {
  const result = verifyComposeNeonTarget(developmentConfig());
  assert.equal(result.runtimeRole, 'fee_runtime');
  assert.equal(result.target.database, 'neondb');
  assert.equal(result.target.host, pooledHost);
});

test('accepts a custom control-plane subdomain when API and Next web configuration agree', () => {
  verifyComposeNeonTarget(developmentConfig('control'));

  const mismatched = developmentConfig('control');
  mismatched.services.web.environment.NEXT_PUBLIC_PLATFORM_SUBDOMAIN = 'platform';
  assert.throws(() => verifyComposeNeonTarget(mismatched), /must be the same valid DNS label/);

  const production = productionConfig();
  production.services.api.environment.PLATFORM_SUBDOMAIN = 'control';
  production.services.api.environment.WEB_APP_URL = 'https://control.example.com';
  production.services.api.environment.CORS_ORIGINS = 'https://control.example.com';
  production.services.web.environment.NEXT_PUBLIC_PLATFORM_SUBDOMAIN = 'control';
  production.services.web.environment.NEXT_PUBLIC_API_BASE_URL = 'https://control.example.com/api/v1';
  verifyComposeNeonTarget(production);
});

test('keeps the configured platform label aligned across Compose and the Next production image build', async () => {
  const [dockerfile, workflow, developmentCompose, productionCompose] = await Promise.all([
    readFile(resolve('infrastructure/docker/web.Dockerfile'), 'utf8'),
    readFile(resolve('.github/workflows/ci.yml'), 'utf8'),
    readFile(resolve('docker-compose.yml'), 'utf8'),
    readFile(resolve('docker-compose.prod.yml'), 'utf8'),
  ]);
  assert.match(dockerfile, /ARG NEXT_PUBLIC_PLATFORM_SUBDOMAIN=platform/);
  assert.match(dockerfile, /NEXT_PUBLIC_PLATFORM_SUBDOMAIN=\$\{NEXT_PUBLIC_PLATFORM_SUBDOMAIN\}/);
  assert.match(workflow, /NEXT_PUBLIC_PLATFORM_SUBDOMAIN=\$\{\{ vars\.PLATFORM_SUBDOMAIN \|\| 'platform' \}\}/);
  assert.match(developmentCompose, /NEXT_PUBLIC_PLATFORM_SUBDOMAIN: \$\{PLATFORM_SUBDOMAIN:-platform\}/);
  assert.match(productionCompose, /NEXT_PUBLIC_PLATFORM_SUBDOMAIN: \$\{PLATFORM_SUBDOMAIN:-platform\}/);
});

test('requires the host-preserving development proxy config without a TLS redirect command', () => {
  const wrongConfig = developmentConfig();
  wrongConfig.services.nginx.volumes = ['./infrastructure/nginx/nginx.conf:/etc/nginx/nginx.conf:ro'];
  assert.throws(() => verifyComposeNeonTarget(wrongConfig), /plain-HTTP config/);

  const commandOverride = developmentConfig();
  commandOverride.services.nginx.command = ['nginx', '-g', 'daemon off;'];
  assert.throws(() => verifyComposeNeonTarget(commandOverride), /plain-HTTP config/);
});

test('starts API before the runtime tenant seed and gates the proxy on seed completion', () => {
  const missingSeed = developmentConfig();
  delete missingSeed.services['development-seed'];
  assert.throws(() => verifyComposeNeonTarget(missingSeed), /must seed development tenants/);

  const wrongSeedTarget = developmentConfig();
  wrongSeedTarget.services['development-seed'].environment.DATABASE_URL = runtimeUrl.replace('ep-sample-pooler', 'ep-other-pooler');
  assert.throws(() => verifyComposeNeonTarget(wrongSeedTarget), /same restricted Neon runtime target/);

  const apiWithSeedPassword = developmentConfig();
  apiWithSeedPassword.services.api.environment.SEED_DEMO_PASSWORD = 'demo-password';
  assert.throws(() => verifyComposeNeonTarget(apiWithSeedPassword), /development-only tenant seed configuration/);

  for (const key of ['SEED_SCHOOL_EMAIL', 'SEED_ACADEMY_EMAIL', 'SEED_GYM_EMAIL']) {
    const apiWithSeedEmail = developmentConfig();
    apiWithSeedEmail.services.api.environment[key] = 'admin@sample.test';
    assert.throws(() => verifyComposeNeonTarget(apiWithSeedEmail), /development-only tenant seed configuration/);
  }

  const seedWithMigrationRole = developmentConfig();
  seedWithMigrationRole.services['development-seed'].environment.MIGRATION_DATABASE_ROLE = 'fee_migrator';
  assert.throws(() => verifyComposeNeonTarget(seedWithMigrationRole), /unapproved configuration or deployment credentials/);

  const seedWithOwnerUrl = developmentConfig();
  seedWithOwnerUrl.services['development-seed'].environment.PLATFORM_BOOTSTRAP_DATABASE_URL = ownerUrl;
  assert.throws(() => verifyComposeNeonTarget(seedWithOwnerUrl), /unapproved configuration or deployment credentials/);

  const seedCredentialOnProxy = developmentConfig();
  seedCredentialOnProxy.services.nginx.environment = { SEED_DEMO_PASSWORD: '' };
  assert.throws(() => verifyComposeNeonTarget(seedCredentialOnProxy), /development-only tenant seed configuration/);

  const seedStartsTooEarly = developmentConfig();
  seedStartsTooEarly.services['development-seed'].depends_on.api.condition = 'service_started';
  assert.throws(() => verifyComposeNeonTarget(seedStartsTooEarly), /API confirms Neon readiness/);

  const proxyStartsTooEarly = developmentConfig();
  delete proxyStartsTooEarly.services.nginx.depends_on['development-seed'];
  assert.throws(() => verifyComposeNeonTarget(proxyStartsTooEarly), /proxy must wait for the tenant seed/);

  const staleProxy = developmentConfig();
  delete staleProxy.services.nginx.depends_on.web.restart;
  assert.throws(() => verifyComposeNeonTarget(staleProxy), /must restart when the web container is recreated/);
});

test('requires the complete development stack to start by default with distinct host port publishing', () => {
  const profiled = developmentConfig();
  profiled.services.web.profiles = ['full'];
  assert.throws(() => verifyComposeNeonTarget(profiled), /plain docker compose up/);

  const duplicatePort = developmentConfig();
  duplicatePort.services.api.ports = ['4000:4000'];
  assert.throws(() => verifyComposeNeonTarget(duplicatePort), /must not publish a duplicate host port/);

  const collidingHostPort = developmentConfig();
  collidingHostPort.services.redis.ports = ['6379:6379'];
  collidingHostPort.services.nginx.ports = ['6379:80'];
  assert.throws(() => verifyComposeNeonTarget(collidingHostPort), /Host port 6379 is shared/);

  const badHealth = developmentConfig();
  badHealth.services.api.healthcheck.test = ['CMD', 'true'];
  assert.throws(() => verifyComposeNeonTarget(badHealth), /working container health checks/);

  const wrongRuntimeTarget = developmentConfig();
  wrongRuntimeTarget.services['development-seed'].build.target = 'production-runtime';
  assert.throws(() => verifyComposeNeonTarget(wrongRuntimeTarget), /tooling-enabled runtime image/);
});

test('rejects migration, owner, and backup credentials on the development API', () => {
  for (const key of [
    'MIGRATION_DATABASE_URL', 'PLATFORM_BOOTSTRAP_DATABASE_URL', 'BACKUP_DATABASE_PASSWORD',
    'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGCHANNELBINDING',
  ]) {
    const config = developmentConfig();
    config.services.api.environment[key] = 'unexpected-secret';
    assert.throws(() => verifyComposeNeonTarget(config), /API environment contains migration, owner, backup/);
  }
});

test('development proxy preserves the tenant host and routes app/API traffic over local HTTP', async () => {
  const proxy = await readFile(resolve('infrastructure/nginx/nginx.dev.conf'), 'utf8');
  assert.match(proxy, /listen 80;/);
  assert.match(proxy, /proxy_pass http:\/\/fee_api;/);
  assert.match(proxy, /proxy_pass http:\/\/fee_web;/);
  assert.match(proxy, /proxy_set_header Host \$http_host;/);
  assert.doesNotMatch(proxy, /return 301|listen 443 ssl|ssl_certificate/);
});

test('rejects the previous bundled PostgreSQL service, volume, and role bootstrap services', () => {
  for (const change of [
    (config) => { config.services.postgres = {}; },
    (config) => { config.volumes = { 'postgres-data': {} }; },
    (config) => { config.services['database-roles'] = {}; },
    (config) => { config.services['database-roles-finalize'] = {}; },
  ]) {
    const config = developmentConfig();
    change(config);
    assert.throws(() => verifyComposeNeonTarget(config), /must not create a database server|must not retain|must not create a database server/i);
  }
});

test('rejects a local PostgreSQL URL and a Neon URL without verified TLS/channel binding', () => {
  const local = developmentConfig();
  local.services.api.environment.DATABASE_URL = 'postgresql://fee_runtime:secret@postgres:5432/neondb';
  assert.throws(() => verifyComposeNeonTarget(local), /configured Neon/);

  const weakTls = developmentConfig();
  weakTls.services.api.environment.DATABASE_URL = runtimeUrl.replace('sslmode=verify-full&channel_binding=require', 'sslmode=require&channel_binding=require');
  assert.throws(() => verifyComposeNeonTarget(weakTls), /verified TLS/);
});

test('keeps database credentials out of worker and web services', () => {
  const config = developmentConfig();
  config.services.worker.environment.DATABASE_URL = runtimeUrl;
  assert.throws(() => verifyComposeNeonTarget(config), /Worker environment contains a database URL/);
});

test('accepts production Neon runtime, direct migration, one-shot owner bootstrap, and encrypted backup', () => {
  const result = verifyComposeNeonTarget(productionConfig());
  assert.equal(result.runtimeRole, 'fee_runtime');
  assert.equal(result.migrationRole, 'fee_migrator');
  assert.equal(result.backupRole, 'fee_backup');
  assert.equal(result.target.host, directHost);
});

test('rejects pooled migration URLs, target drift, owner credential leakage, and reused passwords', () => {
  const pooledMigration = productionConfig();
  pooledMigration.services.migration.environment.MIGRATION_DATABASE_URL = migrationUrl.replace(directHost, pooledHost);
  assert.throws(() => verifyComposeNeonTarget(pooledMigration), /direct endpoint/);

  const targetDrift = productionConfig();
  targetDrift.services.migration.environment.DATABASE_TARGET_NAME = 'otherdb';
  assert.throws(() => verifyComposeNeonTarget(targetDrift), /same Neon database/);

  const runtimeEndpointDrift = productionConfig();
  runtimeEndpointDrift.services.api.environment.DATABASE_URL = runtimeUrl.replace('ep-sample-pooler', 'ep-other-project-pooler');
  assert.throws(() => verifyComposeNeonTarget(runtimeEndpointDrift), /same Neon database/);

  const runtimePortDrift = productionConfig();
  runtimePortDrift.services.api.environment.DATABASE_URL = runtimeUrl.replace('/neondb?', ':6543/neondb?');
  assert.throws(() => verifyComposeNeonTarget(runtimePortDrift), /same Neon database/);

  const ownerLeak = productionConfig();
  ownerLeak.services.api.environment.PLATFORM_BOOTSTRAP_DATABASE_URL = ownerUrl;
  assert.throws(() => verifyComposeNeonTarget(ownerLeak), /API environment contains/);

  const reusedPassword = productionConfig();
  reusedPassword.services.backup.environment.PGPASSWORD = 'runtime-pass';
  assert.throws(() => verifyComposeNeonTarget(reusedPassword), /credentials must all be distinct/);

  for (const key of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGCHANNELBINDING']) {
    const apiLeak = productionConfig();
    apiLeak.services.api.environment[key] = 'unexpected-secret';
    assert.throws(() => verifyComposeNeonTarget(apiLeak), /API environment contains migration, owner, backup/);
  }
});

test('requires separate production tooling image for migrations and bootstrap', () => {
  const sharedImage = productionConfig();
  sharedImage.services.migration.image = sharedImage.services.api.image;
  sharedImage.services['platform-bootstrap'].image = sharedImage.services.api.image;
  assert.throws(() => verifyComposeNeonTarget(sharedImage), /separate full-tooling operations image/);
});

test('production config rendering uses the checked-in non-secret Neon example', async () => {
  const example = await readFile(resolve('.env.production.example'), 'utf8');
  assert.ok(example.includes('DATABASE_URL=postgresql://fee_runtime:'));
  const result = verifyComposeFile({ envFiles: ['.env.production.example'], composeFile: 'docker-compose.prod.yml' });
  assert.equal(result.runtimeRole, 'fee_runtime');
  assert.equal(result.migrationRole, 'fee_migrator');
});

test('docker:up validates the root Compose env file before building the default stack', async () => {
  const rootPackage = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const command = rootPackage.scripts['docker:up'];
  assert.ok(command.startsWith('node scripts/verify-compose-neon-target.mjs '));
  assert.ok(command.includes('--env-file .env'));
  assert.ok(!command.includes('.env.docker.local'));
  assert.ok(!command.includes('.env.neon.local'));
  assert.ok(!command.includes('--profile full'));
  assert.ok(command.indexOf('&& docker compose') > 0);
  const watchCommand = rootPackage.scripts['docker:watch'];
  assert.ok(watchCommand.includes('--env-file .env'));
  assert.ok(watchCommand.includes('--watch'));
});
