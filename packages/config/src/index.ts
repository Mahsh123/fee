import { z } from 'zod';
import { isAllowedTenantOrigin } from './tenant-host';

export { isAllowedTenantOrigin, resolveTenantHost, type HostTenantResolution } from './tenant-host';

/**
 * Environment configuration.
 *
 * Validated once, at boot, against a schema. A misconfigured deployment fails
 * immediately with a readable list of problems rather than at 3am when the first
 * payment webhook arrives and the encryption key turns out to be missing.
 *
 * Nothing in the application reads `process.env` directly; it reads this service.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : ['true', '1', 'yes', 'on'].includes(value.toLowerCase())));

const positiveInt = (fallback: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => (value === undefined ? fallback : Number(value)))
    .pipe(z.number().int().positive());

const auditSigningKeysJson = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().optional(),
).superRefine((raw, context) => {
  if (raw === undefined) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    context.addIssue({ code: 'custom', message: 'AUDIT_SIGNING_KEYS_JSON must be a JSON object of versioned 32-byte hexadecimal keys.' });
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    context.addIssue({ code: 'custom', message: 'AUDIT_SIGNING_KEYS_JSON must be a JSON object of versioned 32-byte hexadecimal keys.' });
    return;
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.some(([version, key]) =>
    !/^[1-9]\d{0,8}$/.test(version) || typeof key !== 'string' || !/^[0-9a-f]{64}$/i.test(key))) {
    context.addIssue({ code: 'custom', message: 'AUDIT_SIGNING_KEYS_JSON must map positive key versions to 32-byte hexadecimal keys.' });
  }
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: positiveInt(4000),
  API_GLOBAL_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('v1'),
  WEB_APP_URL: z.string().default('http://platform.localhost:3000'),
  CORS_ORIGINS: z.string().default('http://platform.localhost:3000'),
  TENANT_BASE_DOMAIN: z.string().min(1).default('localhost'),
  PLATFORM_SUBDOMAIN: z.string().default('platform').transform((value) => value.toLowerCase()).pipe(
    z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'PLATFORM_SUBDOMAIN must be one valid DNS label.'),
  ),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: positiveInt(900),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_TTL: positiveInt(2_592_000),
  /** Hex or base64, 32 bytes. Encrypts gateway secrets with AES-256-GCM. */
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),

  // Optional until the database v2 audit cutover is installed. The one-shot
  // migration provisioner writes these exact key bytes into the owner-only verifier table.
  AUDIT_SIGNING_KEYS_JSON: auditSigningKeysJson,
  AUDIT_ACTIVE_SIGNING_KEY_VERSION: positiveInt(1),
  AUDIT_ENVELOPE_MAX_LIFETIME_MS: positiveInt(30_000),
  AUDIT_ENVELOPE_CLOCK_SKEW_MS: positiveInt(5_000),

  SEED_PLATFORM_ADMIN_EMAIL: z.string().optional(),
  SEED_PLATFORM_ADMIN_PASSWORD: z.string().optional(),
  SEED_DEMO_TENANT: booleanish.default(false),
  SEED_DEMO_EMAIL: z.string().optional(),
  SEED_DEMO_PASSWORD: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: positiveInt(587),
  SMTP_SECURE: booleanish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('Wasl <no-reply@example.com>'),
  NOTIFICATION_WORKER_HMAC_SECRET: z.string().min(32, 'NOTIFICATION_WORKER_HMAC_SECRET must be at least 32 characters'),

  PAYMENT_DEFAULT_PROVIDER: z.enum(['RAZORPAY', 'CASHFREE', 'PAYU', 'STRIPE', 'MOCK']).default('MOCK'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  CASHFREE_APP_ID: z.string().optional(),
  CASHFREE_SECRET_KEY: z.string().optional(),
  CASHFREE_WEBHOOK_SECRET: z.string().optional(),
  PAYU_KEY: z.string().optional(),
  PAYU_SALT: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  QUEUE_PREFIX: z.string().default('fee'),
  QUEUE_MAX_ATTEMPTS: positiveInt(5),
  QUEUE_BACKOFF_MS: positiveInt(2_000),

  GATEWAY_STATUS_POLL_INTERVAL_MS: positiveInt(60_000),
  GATEWAY_STATUS_MAX_AUTO_ATTEMPTS: positiveInt(8),
  GATEWAY_STATUS_RETRY_INITIAL_MS: positiveInt(300_000),
  GATEWAY_STATUS_RETRY_MAX_MS: positiveInt(21_600_000),
  GATEWAY_STATUS_LEASE_MS: positiveInt(90_000),

  PLATFORM_SUBSCRIPTION_LIFECYCLE_POLL_INTERVAL_MS: positiveInt(60_000),
  PLATFORM_INVOICE_DUE_DAYS: positiveInt(30),
  PLATFORM_BILLING_GRACE_DAYS: positiveInt(7),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: booleanish.default(true),
  RATE_LIMIT_TTL_SECONDS: positiveInt(60),
  RATE_LIMIT_MAX: positiveInt(120),
  WEBHOOK_RATE_LIMIT_MAX: positiveInt(600),
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && env.TENANT_BASE_DOMAIN.toLowerCase() === 'localhost') {
    context.addIssue({
      code: 'custom',
      path: ['TENANT_BASE_DOMAIN'],
      message: 'Set TENANT_BASE_DOMAIN to the platform domain in production.',
    });
  }
  if (env.AUDIT_ENVELOPE_MAX_LIFETIME_MS > 30_000) {
    context.addIssue({
      code: 'custom',
      path: ['AUDIT_ENVELOPE_MAX_LIFETIME_MS'],
      message: 'The signed audit database wrapper accepts a maximum envelope lifetime of 30 seconds.',
    });
  }
  if (env.AUDIT_ENVELOPE_CLOCK_SKEW_MS > 5_000) {
    context.addIssue({
      code: 'custom',
      path: ['AUDIT_ENVELOPE_CLOCK_SKEW_MS'],
      message: 'The signed audit database wrapper accepts at most 5 seconds of clock skew.',
    });
  }
  if (!env.AUDIT_SIGNING_KEYS_JSON) return;
  let versions: string[];
  try {
    versions = Object.keys(JSON.parse(env.AUDIT_SIGNING_KEYS_JSON) as Record<string, unknown>);
  } catch {
    return;
  }
  if (!versions.includes(String(env.AUDIT_ACTIVE_SIGNING_KEY_VERSION))) {
    context.addIssue({
      code: 'custom',
      path: ['AUDIT_ACTIVE_SIGNING_KEY_VERSION'],
      message: 'The active audit signing key version must exist in AUDIT_SIGNING_KEYS_JSON.',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * The worker is delivery-only. It receives Redis/SMTP settings and one
 * callback-authentication secret; it must never inherit API, database, JWT,
 * audit-signing, or payment-gateway credentials.
 */
export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_PREFIX: z.string().default('fee'),
  QUEUE_MAX_ATTEMPTS: positiveInt(5),
  QUEUE_BACKOFF_MS: positiveInt(2_000),
  NOTIFICATION_CALLBACK_URL: z.string().url().default('http://localhost:4000/api/v1/internal/notifications/delivery-result'),
  NOTIFICATION_WORKER_HMAC_SECRET: z.string().min(32, 'NOTIFICATION_WORKER_HMAC_SECRET must be at least 32 characters'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: positiveInt(587),
  SMTP_SECURE: booleanish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\n\nSee .env.example for the full list.`);
  }
  return result.data;
}

/** Load only the worker's currently required, non-secret runtime settings. */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid worker environment configuration:\n${problems}`);
  }
  return result.data;
}

/** Typed accessors, so a caller never has to remember a string key. */
export class RuntimeConfig {
  private readonly env: Env;

  constructor(env: Env = loadEnv()) {
    this.env = env;
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get port(): number {
    return this.env.API_PORT;
  }

  get globalPrefix(): string {
    return this.env.API_GLOBAL_PREFIX;
  }

  get apiVersion(): string {
    return this.env.API_VERSION;
  }

  get webAppUrl(): string {
    return this.env.WEB_APP_URL;
  }

  /** Full mount path, e.g. `/api/v1`. */
  get apiBasePath(): string {
    return `/${this.env.API_GLOBAL_PREFIX}/${this.env.API_VERSION}`;
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get tenantBaseDomain(): string {
    return this.env.TENANT_BASE_DOMAIN.toLowerCase().replace(/\.$/, '');
  }

  get platformSubdomain(): string {
    return this.env.PLATFORM_SUBDOMAIN;
  }

  get platformHostname(): string {
    return `${this.platformSubdomain}.${this.tenantBaseDomain}`;
  }

  allowsBrowserOrigin(origin: string | undefined, requestHost?: string): boolean {
    return isAllowedTenantOrigin(origin, requestHost, this.tenantBaseDomain, this.corsOrigins, this.env.WEB_APP_URL, this.platformSubdomain);
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get jwtSecret(): string {
    return this.env.JWT_SECRET;
  }

  get jwtAccessTtlSeconds(): number {
    return this.env.JWT_ACCESS_TTL;
  }

  get jwtRefreshSecret(): string {
    return this.env.JWT_REFRESH_SECRET;
  }

  get jwtRefreshTtlSeconds(): number {
    return this.env.JWT_REFRESH_TTL;
  }

  get encryptionKey(): string {
    return this.env.ENCRYPTION_KEY;
  }

  get auditSigning(): { keysByVersion: Readonly<Record<number, string>>; activeKeyVersion: number; maxLifetimeMs: number; clockSkewMs: number } {
    let keysByVersion: Record<number, string> = {};
    if (this.env.AUDIT_SIGNING_KEYS_JSON) {
      const parsed = JSON.parse(this.env.AUDIT_SIGNING_KEYS_JSON) as Record<string, string>;
      keysByVersion = Object.fromEntries(Object.entries(parsed).map(([version, key]) => [Number(version), key]));
    }
    return {
      keysByVersion,
      activeKeyVersion: this.env.AUDIT_ACTIVE_SIGNING_KEY_VERSION,
      maxLifetimeMs: this.env.AUDIT_ENVELOPE_MAX_LIFETIME_MS,
      clockSkewMs: this.env.AUDIT_ENVELOPE_CLOCK_SKEW_MS,
    };
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get logPretty(): boolean {
    return this.env.LOG_PRETTY && !this.isProduction;
  }

  get queuePrefix(): string {
    return this.env.QUEUE_PREFIX;
  }

  get queueMaxAttempts(): number {
    return this.env.QUEUE_MAX_ATTEMPTS;
  }

  get queueBackoffMs(): number {
    return this.env.QUEUE_BACKOFF_MS;
  }

  get gatewayStatusReconciliation(): { pollIntervalMs: number; maxAutomaticAttempts: number; initialRetryMs: number; maxRetryMs: number; leaseMs: number } {
    return {
      pollIntervalMs: this.env.GATEWAY_STATUS_POLL_INTERVAL_MS,
      maxAutomaticAttempts: this.env.GATEWAY_STATUS_MAX_AUTO_ATTEMPTS,
      initialRetryMs: this.env.GATEWAY_STATUS_RETRY_INITIAL_MS,
      maxRetryMs: this.env.GATEWAY_STATUS_RETRY_MAX_MS,
      leaseMs: this.env.GATEWAY_STATUS_LEASE_MS,
    };
  }

  get platformSubscriptionLifecycle(): { pollIntervalMs: number; invoiceDueDays: number; graceDays: number } {
    return {
      pollIntervalMs: this.env.PLATFORM_SUBSCRIPTION_LIFECYCLE_POLL_INTERVAL_MS,
      invoiceDueDays: this.env.PLATFORM_INVOICE_DUE_DAYS,
      graceDays: this.env.PLATFORM_BILLING_GRACE_DAYS,
    };
  }

  get rateLimit(): { ttlSeconds: number; max: number; webhookMax: number } {
    return {
      ttlSeconds: this.env.RATE_LIMIT_TTL_SECONDS,
      max: this.env.RATE_LIMIT_MAX,
      webhookMax: this.env.WEBHOOK_RATE_LIMIT_MAX,
    };
  }

  get mail(): { host?: string; port: number; secure: boolean; user?: string; password?: string; from: string } {
    return {
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_SECURE,
      user: this.env.SMTP_USER,
      password: this.env.SMTP_PASSWORD,
      from: this.env.SMTP_FROM,
    };
  }

  get notificationWorkerHmacSecret(): string {
    return this.env.NOTIFICATION_WORKER_HMAC_SECRET;
  }

  /** Raw value access for the few places that need something not surfaced above. */
  raw(): Readonly<Env> {
    return this.env;
  }
}
