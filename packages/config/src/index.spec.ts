import { describe, expect, it } from 'vitest';
import { envSchema, loadEnv, loadWorkerEnv, RuntimeConfig } from './index';

const requiredEnv = {
  DATABASE_URL: 'postgresql://fee:fee@localhost:5432/fees',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEY: 'c'.repeat(32),
  NOTIFICATION_WORKER_HMAC_SECRET: 'd'.repeat(32),
};

describe('runtime configuration', () => {
  it('applies safe defaults and typed accessors', () => {
    const config = new RuntimeConfig(loadEnv(requiredEnv));
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(4000);
    expect(config.apiBasePath).toBe('/api/v1');
    expect(config.tenantBaseDomain).toBe('localhost');
    expect(config.platformHostname).toBe('platform.localhost');
    expect(config.corsOrigins).toEqual(['http://platform.localhost:3000']);
    expect(config.platformSubscriptionLifecycle).toEqual({ pollIntervalMs: 60_000, invoiceDueDays: 30, graceDays: 7 });
    expect(config.logPretty).toBe(true);
  });

  it('validates required secrets and positive integer settings', () => {
    expect(() => loadEnv({ ...requiredEnv, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...requiredEnv, API_PORT: '0' })).toThrow(/API_PORT/);
    expect(envSchema.parse({ ...requiredEnv, API_PORT: '4321', LOG_PRETTY: 'false' }).API_PORT).toBe(4321);
    expect(() => loadEnv({ ...requiredEnv, PLATFORM_BILLING_GRACE_DAYS: '0' })).toThrow(/PLATFORM_BILLING_GRACE_DAYS/);
  });

  it('normalizes production logging behavior without modifying source values', () => {
    const config = new RuntimeConfig(loadEnv({ ...requiredEnv, NODE_ENV: 'production', TENANT_BASE_DOMAIN: 'example.com', LOG_PRETTY: 'true' }));
    expect(config.logPretty).toBe(false);
    expect(config.raw().LOG_PRETTY).toBe(true);
  });

  it('loads the worker with its narrow runtime settings and required callback credential', () => {
    const workerSecret = 'e'.repeat(32);
    const workerDefaults = {
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      REDIS_URL: 'redis://localhost:6379',
      QUEUE_PREFIX: 'fee',
      QUEUE_MAX_ATTEMPTS: 5,
      QUEUE_BACKOFF_MS: 2_000,
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      NOTIFICATION_CALLBACK_URL: 'http://localhost:4000/api/v1/internal/notifications/delivery-result',
      NOTIFICATION_WORKER_HMAC_SECRET: workerSecret,
    };
    expect(() => loadWorkerEnv({})).toThrow(/NOTIFICATION_WORKER_HMAC_SECRET/);
    expect(loadWorkerEnv({ NOTIFICATION_WORKER_HMAC_SECRET: workerSecret })).toEqual(workerDefaults);
    expect(loadWorkerEnv({ NODE_ENV: 'production', LOG_LEVEL: 'warn', JWT_SECRET: 'must-not-be-required', NOTIFICATION_WORKER_HMAC_SECRET: workerSecret }))
      .toEqual({ ...workerDefaults, NODE_ENV: 'production', LOG_LEVEL: 'warn' });
  });
});
