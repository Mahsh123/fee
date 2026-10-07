export function buildNeonDevelopmentEnvironments({
  systemEnvironment = {},
  applicationEnvironment = {},
  runtimeEnvironment = {},
  localInfrastructure = {},
}) {
  const app = { ...systemEnvironment, ...applicationEnvironment, ...runtimeEnvironment };
  for (const key of [
    'NOTIFICATION_WORKER_HMAC_SECRET',
    'AUDIT_SIGNING_KEYS_JSON',
    'AUDIT_ACTIVE_SIGNING_KEY_VERSION',
    'AUDIT_ENVELOPE_MAX_LIFETIME_MS',
    'AUDIT_ENVELOPE_CLOCK_SKEW_MS',
  ]) {
    if (!app[key] && localInfrastructure[key]) app[key] = localInfrastructure[key];
  }

  for (const key of Object.keys(app)) {
    if (/^(POSTGRES_|MIGRATION_|RUNTIME_DATABASE_|BACKUP_|DATABASE_TARGET_)/.test(key)) delete app[key];
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(app.DATABASE_URL);
  } catch {
    throw new Error('The local Neon runtime DATABASE_URL is missing or invalid.');
  }
  if (!databaseUrl.hostname.toLowerCase().endsWith('.neon.tech')
    || databaseUrl.username !== 'fee_runtime'
    || databaseUrl.searchParams.get('sslmode') !== 'verify-full'
    || databaseUrl.searchParams.get('channel_binding') !== 'require') {
    throw new Error('The local app must use the fee_runtime Neon URL with verified TLS and channel binding.');
  }
  if (!app.NOTIFICATION_WORKER_HMAC_SECRET) {
    throw new Error('NOTIFICATION_WORKER_HMAC_SECRET is required in the local app environment.');
  }

  const stripUndefined = (environment) => Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
  const apiEnvironment = stripUndefined({
    ...app,
    NODE_ENV: app.NODE_ENV ?? 'development',
  });
  const developmentTenantSeedEnvironment = buildDevelopmentTenantSeedEnvironment(app, systemEnvironment);
  for (const key of [
    'SEED_PLATFORM_ADMIN_EMAIL', 'SEED_PLATFORM_ADMIN_PASSWORD',
    'SEED_DEMO_EMAIL', 'SEED_SCHOOL_EMAIL', 'SEED_ACADEMY_EMAIL', 'SEED_GYM_EMAIL', 'SEED_DEMO_PASSWORD',
  ]) {
    delete apiEnvironment[key];
  }
  const workerEnvironment = stripUndefined({
    ...systemEnvironment,
    NODE_ENV: apiEnvironment.NODE_ENV,
    LOG_LEVEL: apiEnvironment.LOG_LEVEL ?? 'info',
    REDIS_URL: apiEnvironment.REDIS_URL ?? 'redis://localhost:6379',
    QUEUE_PREFIX: apiEnvironment.QUEUE_PREFIX ?? 'fee',
    QUEUE_MAX_ATTEMPTS: apiEnvironment.QUEUE_MAX_ATTEMPTS ?? '5',
    QUEUE_BACKOFF_MS: apiEnvironment.QUEUE_BACKOFF_MS ?? '2000',
    NOTIFICATION_WORKER_HMAC_SECRET: apiEnvironment.NOTIFICATION_WORKER_HMAC_SECRET,
    SMTP_HOST: apiEnvironment.SMTP_HOST,
    SMTP_PORT: apiEnvironment.SMTP_PORT ?? '587',
    SMTP_SECURE: apiEnvironment.SMTP_SECURE ?? 'false',
    SMTP_USER: apiEnvironment.SMTP_USER,
    SMTP_PASSWORD: apiEnvironment.SMTP_PASSWORD,
  });
  const webEnvironment = {
    ...systemEnvironment,
    NODE_ENV: apiEnvironment.NODE_ENV,
    NEXT_PUBLIC_API_BASE_URL: apiEnvironment.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1',
    NEXT_PUBLIC_PLATFORM_SUBDOMAIN: apiEnvironment.PLATFORM_SUBDOMAIN ?? 'platform',
  };

  return { apiEnvironment, workerEnvironment, webEnvironment, developmentTenantSeedEnvironment };
}

export function buildDevelopmentTenantSeedEnvironment(apiEnvironment, systemEnvironment = {}) {
  const environment = {
    ...systemEnvironment,
    DATABASE_URL: apiEnvironment.DATABASE_URL,
    NODE_ENV: 'development',
    SEED_DEVELOPMENT_TENANTS: 'true',
    SEED_DEMO_EMAIL: apiEnvironment.SEED_DEMO_EMAIL,
    SEED_SCHOOL_EMAIL: apiEnvironment.SEED_SCHOOL_EMAIL,
    SEED_ACADEMY_EMAIL: apiEnvironment.SEED_ACADEMY_EMAIL,
    SEED_GYM_EMAIL: apiEnvironment.SEED_GYM_EMAIL,
    SEED_DEMO_PASSWORD: apiEnvironment.SEED_DEMO_PASSWORD,
  };
  return Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined));
}
