import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health';
import type { PrismaService } from '../common/prisma.service';
import type { AppConfigService } from '../config/env';

type HealthChecks = Array<{ name: string; status: 'up' | 'down' | 'degraded' }>;

describe('health readiness', () => {
  const controller = new HealthController(
    { ping: vi.fn() } as unknown as PrismaService,
    { redisUrl: 'redis://localhost:6379', encryptionKey: 'e'.repeat(32) } as AppConfigService,
  );
  const privateController = controller as unknown as { runChecks: () => Promise<HealthChecks> };
  const runChecks = vi.spyOn(privateController, 'runChecks');

  afterEach(() => runChecks.mockReset());

  it('remains ready when an optional dependency is degraded', async () => {
    const checks: HealthChecks = [
      { name: 'database', status: 'up' },
      { name: 'redis', status: 'degraded' },
      { name: 'encryption-key', status: 'up' },
    ];
    runChecks.mockResolvedValue(checks);

    await expect(controller.ready()).resolves.toEqual({ status: 'ready', checks });
  });

  it('is not ready when a required dependency is down', async () => {
    const checks: HealthChecks = [
      { name: 'database', status: 'down' },
      { name: 'redis', status: 'up' },
      { name: 'encryption-key', status: 'up' },
    ];
    runChecks.mockResolvedValue(checks);

    await expect(controller.ready()).resolves.toEqual({ status: 'not_ready', checks });
  });
});
