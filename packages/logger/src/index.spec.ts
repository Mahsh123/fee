import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from './index';

describe('structured logger', () => {
  it('redacts credential fields and records service context', () => {
    let output = '';
    const sink = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const logger = createLogger({ service: 'test-service', level: 'info', destination: sink });
    logger.info({
      tenantId: 'tenant-a',
      password: 'do-not-log',
      headers: { authorization: 'Bearer private' },
      JWT_SECRET: 'jwt-private',
      DATABASE_URL: 'postgresql://user:db-private@db/fees',
      SEED_DEMO_PASSWORD: 'seed-private',
      config: {
        ENCRYPTION_KEY: 'encryption-private',
        SMTP_PASSWORD: 'smtp-private',
        NOTIFICATION_WORKER_HMAC_SECRET: 'notification-worker-private',
        REDIS_URL: 'redis://:redis-private@cache:6379',
      },
    }, 'request');
    logger.flush();
    expect(output).toContain('test-service');
    expect(output).toContain('tenant-a');
    expect(output).not.toContain('do-not-log');
    expect(output).not.toContain('Bearer private');
    expect(output).not.toContain('jwt-private');
    expect(output).not.toContain('encryption-private');
    expect(output).not.toContain('smtp-private');
    expect(output).not.toContain('notification-worker-private');
    expect(output).not.toContain('db-private');
    expect(output).not.toContain('seed-private');
    expect(output).not.toContain('redis-private');
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(9);
  });
});
