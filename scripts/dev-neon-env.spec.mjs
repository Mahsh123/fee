import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDevelopmentTenantSeedEnvironment, buildNeonDevelopmentEnvironments } from './dev-neon-env.mjs';

function input(overrides = {}) {
  return {
    systemEnvironment: { PATH: 'path', TEMP: 'temp' },
    applicationEnvironment: {
      DATABASE_URL: 'postgresql://old_runtime:old@localhost:5432/fees',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'jwt-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      ENCRYPTION_KEY: 'encryption-secret',
      MIGRATION_DATABASE_URL: 'postgresql://fee_migrator:secret@db/fees',
      POSTGRES_PASSWORD: 'owner-secret',
      DATABASE_TARGET_HOST: 'db.internal',
    },
    runtimeEnvironment: {
      DATABASE_URL: 'postgresql://fee_runtime:runtime-secret@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require&schema=public',
    },
    localInfrastructure: { NOTIFICATION_WORKER_HMAC_SECRET: 'worker-hmac-secret-32-characters-long' },
    ...overrides,
  };
}

test('keeps migration and owner credentials out of every app process and strips database credentials from web/worker', () => {
  const { apiEnvironment, workerEnvironment, webEnvironment } = buildNeonDevelopmentEnvironments(input());
  assert.equal(new URL(apiEnvironment.DATABASE_URL).username, 'fee_runtime');
  assert.equal('MIGRATION_DATABASE_URL' in apiEnvironment, false);
  assert.equal('POSTGRES_PASSWORD' in apiEnvironment, false);
  assert.equal('DATABASE_TARGET_HOST' in apiEnvironment, false);
  for (const environment of [workerEnvironment, webEnvironment]) {
    assert.equal('DATABASE_URL' in environment, false);
    assert.equal('MIGRATION_DATABASE_URL' in environment, false);
    assert.equal('POSTGRES_PASSWORD' in environment, false);
    assert.equal('JWT_SECRET' in environment, false);
  }
  assert.equal(workerEnvironment.NOTIFICATION_WORKER_HMAC_SECRET, 'worker-hmac-secret-32-characters-long');
  assert.equal(webEnvironment.NEXT_PUBLIC_PLATFORM_SUBDOMAIN, 'platform');
});

test('passes the configured API platform subdomain to the host-based Next.js process', () => {
  const { apiEnvironment, webEnvironment } = buildNeonDevelopmentEnvironments(input({
    applicationEnvironment: { ...input().applicationEnvironment, PLATFORM_SUBDOMAIN: 'control' },
  }));
  assert.equal(apiEnvironment.PLATFORM_SUBDOMAIN, 'control');
  assert.equal(webEnvironment.NEXT_PUBLIC_PLATFORM_SUBDOMAIN, 'control');
});

test('requires the explicit TLS-verified Neon runtime role URL', () => {
  assert.throws(() => buildNeonDevelopmentEnvironments(input({
    runtimeEnvironment: { DATABASE_URL: 'postgresql://neondb_owner:secret@ep-example.region.aws.neon.tech/neondb?sslmode=require' },
})), /fee_runtime Neon URL/);
});

test('passes all configured development tenant logins into the one-shot seed process', () => {
  const apiEnvironment = {
    DATABASE_URL: 'postgresql://fee_runtime:secret@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require&schema=public',
    SEED_DEMO_EMAIL: 'admin@demo-academy.test',
    SEED_SCHOOL_EMAIL: 'admin@northstar.test',
    SEED_ACADEMY_EMAIL: 'admin@greenfield-academy.test',
    SEED_GYM_EMAIL: 'manager@northstar-fitness.test',
    SEED_DEMO_PASSWORD: 'configured-demo-password',
  };
  const seedEnvironment = buildDevelopmentTenantSeedEnvironment(apiEnvironment, { PATH: 'path', USERPROFILE: 'profile' });

  assert.deepEqual(seedEnvironment, {
    PATH: 'path',
    USERPROFILE: 'profile',
    DATABASE_URL: apiEnvironment.DATABASE_URL,
    NODE_ENV: 'development',
    SEED_DEVELOPMENT_TENANTS: 'true',
    SEED_DEMO_EMAIL: 'admin@demo-academy.test',
    SEED_SCHOOL_EMAIL: 'admin@northstar.test',
    SEED_ACADEMY_EMAIL: 'admin@greenfield-academy.test',
    SEED_GYM_EMAIL: 'manager@northstar-fitness.test',
    SEED_DEMO_PASSWORD: 'configured-demo-password',
  });
});

test('keeps bootstrap and demo passwords out of the long-running API environment', () => {
  const base = input();
  const { apiEnvironment, developmentTenantSeedEnvironment } = buildNeonDevelopmentEnvironments(input({
    applicationEnvironment: {
      ...base.applicationEnvironment,
      SEED_PLATFORM_ADMIN_EMAIL: 'platform@example.test',
      SEED_PLATFORM_ADMIN_PASSWORD: 'platform-bootstrap-secret',
      SEED_DEMO_EMAIL: 'admin@demo-academy.test',
      SEED_SCHOOL_EMAIL: 'admin@northstar.test',
    SEED_ACADEMY_EMAIL: 'admin@greenfield-academy.test',
    SEED_GYM_EMAIL: 'manager@northstar-fitness.test',
      SEED_DEMO_PASSWORD: 'configured-demo-password',
    },
  }));

  assert.equal('SEED_PLATFORM_ADMIN_PASSWORD' in apiEnvironment, false);
  assert.equal('SEED_DEMO_PASSWORD' in apiEnvironment, false);
  assert.equal('SEED_DEMO_EMAIL' in apiEnvironment, false);
  assert.equal('SEED_SCHOOL_EMAIL' in apiEnvironment, false);
  assert.equal('SEED_ACADEMY_EMAIL' in apiEnvironment, false);
  assert.equal('SEED_GYM_EMAIL' in apiEnvironment, false);
  assert.equal(developmentTenantSeedEnvironment.SEED_DEMO_EMAIL, 'admin@demo-academy.test');
  assert.equal(developmentTenantSeedEnvironment.SEED_DEMO_PASSWORD, 'configured-demo-password');
  assert.equal(developmentTenantSeedEnvironment.SEED_SCHOOL_EMAIL, 'admin@northstar.test');
  assert.equal(developmentTenantSeedEnvironment.SEED_ACADEMY_EMAIL, 'admin@greenfield-academy.test');
  assert.equal(developmentTenantSeedEnvironment.SEED_GYM_EMAIL, 'manager@northstar-fitness.test');
  assert.equal('SEED_PLATFORM_ADMIN_PASSWORD' in developmentTenantSeedEnvironment, false);
});
