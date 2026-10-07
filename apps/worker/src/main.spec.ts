import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationRuntime } from './notification-runtime';

const { waitForShutdown } = vi.hoisted(() => ({ waitForShutdown: vi.fn() }));
vi.mock('./shutdown', () => ({ waitForShutdown }));

import { runWorker } from './main';

describe('worker application lifecycle', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'info');
    vi.stubEnv('NOTIFICATION_WORKER_HMAC_SECRET', 'f'.repeat(32));
    waitForShutdown.mockResolvedValue('SIGTERM');
    vi.spyOn(NotificationRuntime.prototype, 'onModuleInit').mockResolvedValue();
    vi.spyOn(NotificationRuntime.prototype, 'onModuleDestroy').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('starts a Nest application context and closes it after shutdown is requested', async () => {
    await expect(runWorker()).resolves.toBeUndefined();
    expect(waitForShutdown).toHaveBeenCalledOnce();
  });
});
